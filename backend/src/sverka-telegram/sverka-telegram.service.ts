import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReconcileService } from '../transactions/reconcile.service';
import { SverkaAgentService } from '../transactions/sverka-agent.service';
import { renderDigest, DigestAccount } from './digest';

/**
 * Sverka uchun Telegram bot servisi.
 *
 * Bot ma'lumotlari va chat ID'lar Setting model'da JSON sifatida saqlanadi
 * (yangi schema migratsiya kerak emas).
 *
 * Rollar:
 *   - approver  (tasdiqlovchi): inline tugmali notification oladi
 *   - watcher   (kuzatuvchi):   faqat matnli notification oladi
 *
 * Notification yuborish: Sverka actions (sanani tuzatish, hammasini
 * qo'shish) bajarilganda avtomatik chaqiriladi.
 */

export type ChatRole = 'approver' | 'watcher';

export interface SverkaChat {
  chatId: string;
  role: ChatRole;
  name: string | null;
  addedAt: string;
  addedBy: string | null;
}

export interface HistoryEntry {
  timestamp: string;
  action: string;
  source: 'web' | 'telegram';
  actorId: string | null;
  actorName: string | null;
  chatId?: string;
  details: any;
}

/** Digest store — bir hisob uchun saqlanadigan holat (xabar YO'Q; yagona digest xabari alohida). */
interface DigestStoreAccount {
  accountNo?: string;
  ownerName?: string | null;
  bankName?: string | null;
  diffKey: string;             // yaxlitlangan farq (o'zgarganini bilish uchun)
  totalFarq: number;           // farq magnitudasi (so'm)
  culprit?: string;
  confidence?: string;
  apply?: { addMissing: boolean; fixDates: boolean; fixAmounts: boolean } | null;
  actionKind?: 'ai' | 'add';   // tugma callback turi
  dismissed?: boolean;         // bugunga yopilgan (ertaga qayta ko'rinadi)
}

/** Digest store — bir kunlik holat: yagona digest xabari (chat bo'yicha) + hisoblar. */
interface DigestStore {
  date: string;
  digest: { msgs: Array<{ chatId: string; messageId: number; role?: 'approver' | 'watcher' }> };
  accounts: Record<string, DigestStoreAccount>;
}

@Injectable()
export class SverkaTelegramService implements OnModuleInit {
  private readonly log = new Logger(SverkaTelegramService.name);
  private pollOffset = 0;
  private polling = false;

  // Setting keys
  private static readonly KEY_BOT_TOKEN = 'sverka.telegram.botToken';
  private static readonly KEY_CHATS     = 'sverka.telegram.chats';
  private static readonly KEY_HISTORY   = 'sverka.telegram.history';
  private static readonly KEY_PASSWORD  = 'sverka.telegram.password';
  private static readonly KEY_NOTIFIED_TODAY = 'sverka.telegram.notifiedToday';
  private static readonly KEY_SENT_LOG = 'sverka.telegram.sentLog'; // /clear uchun — chat bo'yicha message_id'lar
  private static readonly KEY_EVENING_REMINDER = 'sverka.telegram.eveningReminder'; // 20:00 eslatma xabar id'lari (23:00da o'chirish uchun)

  private static readonly HISTORY_LIMIT = 500;

  // autoSverkaNotify run-lock — cron endi og'ir (sync + AI), 30 daqiqada tugamаsa
  // keyingi run bilan ustma-ust ketmasin.
  private notifyRunning = false;

  constructor(
    private prisma: PrismaService,
    private moduleRef: ModuleRef,
  ) {}

  // ─── TELEGRAM LONG-POLLING (tugma bosishlarini eshitish) ──────────────
  async onModuleInit() {
    // Bot tugma bosishlarini (callback_query) qabul qilish uchun long-polling.
    // Webhook ishlatilmaydi — getUpdates outbound (xabar yuborish bilan bir xil yo'l).
    this.startPolling();
  }

  private startPolling() {
    if (this.polling) return;
    this.polling = true;
    // Fire-and-forget — onModuleInit'ni bloklamaydi
    void this.pollLoop();
  }

  /**
   * AVTOMATIK sverka + xabar — sahifadan mustaqil (hech kim web'da bo'lmasa ham).
   * Har 30 daqiqada barcha hisoblar sverkasini qilib, yangi/o'zgargan farqlarni
   * Telegram'ga yuboradi (notifiedToday dedup spam'ni oldini oladi).
   */
  @Cron(process.env.SVERKA_NOTIFY_CRON || '*/30 * * * *')
  async autoSverkaNotify(): Promise<void> {
    if (this.notifyRunning) {
      this.log.warn("autoSverkaNotify: oldingi run hali tugamadi — o'tkazib yuborildi");
      return;
    }
    this.notifyRunning = true;
    try {
      const chats = await this.getChats();
      if (chats.length === 0) return; // chat yo'q — sverka qilishning hojati yo'q
      const reconcile = this.moduleRef.get(ReconcileService, { strict: false });
      // syncMismatched: avval farqli hisoblarni bankdan sync qilamiz — hali
      // AllTranzactions'ga tushmagan tranzaksiyalar qo'shiladi, "soxta" farqlar
      // (sync-lag) yo'qoladi va faqat HAQIQIY farqlar qoladi (kam xabar).
      const result: any = await reconcile.reconcileToday(undefined, { syncMismatched: true });
      if (result?.items && Array.isArray(result.items) && result.date) {
        await this.notifyNewMismatches(result.items, result.date, { synced: true });
      }
    } catch (e: any) {
      this.log.warn(`autoSverkaNotify xato: ${e?.message}`);
    } finally {
      this.notifyRunning = false;
    }
  }

  /**
   * KECHKI ESLATMA — har kuni soat 20:00 (Toshkent) guruhga "otmetka": bugun hali
   * tuzatilmagan farqlar ro'yxatini yuboradi ("mana bu kamchiliklarni ko'rib chiqing").
   * Xabar id'lari saqlanadi — soat 23:00da avtomat o'chiriladi (deleteEveningReminder).
   */
  @Cron('0 20 * * *', { name: 'sverkaEveningReminder', timeZone: 'Asia/Tashkent' })
  async eveningReminder(): Promise<void> {
    try {
      const chats = await this.getChats();
      if (chats.length === 0) return;
      const reconcile = this.moduleRef.get(ReconcileService, { strict: false });
      // syncMismatched: avval farqli hisoblarni bankdan sync qilamiz — hali
      // AllTranzactions'ga tushmagan tranzaksiyalar qo'shiladi, "soxta" farqlar
      // (sync-lag) yo'qoladi va faqat HAQIQIY farqlar qoladi (kam xabar).
      const result: any = await reconcile.reconcileToday(undefined, { syncMismatched: true });
      const items: any[] = Array.isArray(result?.items) ? result.items : [];
      const date: string = result?.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
      const mismatches = items.filter((it) => it.status === 'mismatch');

      // Avvalgi eslatma qolib ketgan bo'lsa (o'chirilmagan) — tozalab yuboramiz
      await this.deleteEveningReminderMessages();

      if (mismatches.length === 0) {
        this.log.log('Kechki eslatma: tuzatilmagan farq yo\'q — yuborilmadi');
        return;
      }

      const fmt = (n: number | undefined) => (n != null ? Number(n).toLocaleString('ru-RU') : '0');
      const lines: string[] = [];
      lines.push(`🔔 <b>Kunlik otmetka — tuzatilmagan farqlar</b>`);
      lines.push(`📅 ${date} · 🕗 20:00`);
      lines.push('');
      lines.push(`Quyidagi <b>${mismatches.length} ta</b> hisobда farq bor. Iltimos, kun yakunlanmasдан ko'rib chiqing va to'g'rilang:`);
      lines.push('');
      const LIMIT = 40;
      for (const it of mismatches.slice(0, LIMIT)) {
        const totalFarq = fmt(Math.abs(Number(it.diff?.formula) || 0));
        const owner = it.ownerName ? ` · ${it.ownerName}` : '';
        const bank = it.bankName ? ` · ${it.bankName}` : '';
        lines.push(`• <code>${it.accountNo || '?'}</code>${bank} — farq <code>${totalFarq}</code> UZS${owner}`);
      }
      if (mismatches.length > LIMIT) lines.push(`… va yana <b>${mismatches.length - LIMIT}</b> ta`);
      lines.push('');
      lines.push(`<i>Bu eslatma soat 23:00da avtomat o'chiriladi.</i>`);

      const r = await this.sendNotification({ text: lines.join('\n'), role: 'all' });
      await this.prisma.setting.upsert({
        where: { key: SverkaTelegramService.KEY_EVENING_REMINDER },
        create: { key: SverkaTelegramService.KEY_EVENING_REMINDER, value: JSON.stringify({ date, msgs: r.messages }), updatedBy: 'system' },
        update: { value: JSON.stringify({ date, msgs: r.messages }), updatedBy: 'system' },
      });
      await this.appendHistory({
        action: 'evening_reminder', source: 'web', actorId: null, actorName: 'system',
        details: { date, count: mismatches.length, sent: r.sent },
      });
      this.log.log(`Kechki eslatma yuborildi: ${mismatches.length} farq (${r.sent} chat, sana ${date})`);
    } catch (e: any) {
      this.log.warn(`eveningReminder xato: ${e?.message}`);
    }
  }

  /** Har kuni 23:00 (Toshkent) — 20:00 dagi kechki eslatma xabarini o'chiradi. */
  @Cron('0 23 * * *', { name: 'sverkaEveningReminderDelete', timeZone: 'Asia/Tashkent' })
  async deleteEveningReminder(): Promise<void> {
    try {
      const n = await this.deleteEveningReminderMessages();
      if (n > 0) this.log.log(`Kechki eslatma o'chirildi: ${n} xabar`);
    } catch (e: any) {
      this.log.warn(`deleteEveningReminder xato: ${e?.message}`);
    }
  }

  /** Saqlangan kechki eslatma xabarlarini o'chirib, sozlamani tozalaydi. Nechta o'chirilganini qaytaradi. */
  private async deleteEveningReminderMessages(): Promise<number> {
    const s = await this.prisma.setting.findUnique({ where: { key: SverkaTelegramService.KEY_EVENING_REMINDER } });
    if (!s?.value) return 0;
    let stored: { date?: string; msgs?: Array<{ chatId: string; messageId: number }> } = {};
    try { stored = JSON.parse(s.value) || {}; } catch { stored = {}; }
    const msgs = stored.msgs || [];
    let deleted = 0;
    for (const m of msgs) {
      const ok = await this.tgCall('deleteMessage', { chat_id: m.chatId, message_id: m.messageId }).then(() => true).catch(() => false);
      if (ok) deleted++;
    }
    await this.prisma.setting.upsert({
      where: { key: SverkaTelegramService.KEY_EVENING_REMINDER },
      create: { key: SverkaTelegramService.KEY_EVENING_REMINDER, value: JSON.stringify({ msgs: [] }), updatedBy: 'system' },
      update: { value: JSON.stringify({ msgs: [] }), updatedBy: 'system' },
    });
    return deleted;
  }

  private async pollLoop() {
    // getUpdates va webhook bir vaqtda ishlamaydi — webhook'ni o'chiramiz
    try {
      const token = await this.getBotToken();
      if (token) {
        await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`, {}, { timeout: 10_000 }).catch(() => {});
        // Bot menyusiga komandalarni ro'yxatdan o'tkazamiz (/ tugmasida ko'rinadi)
        await this.tgCall('setMyCommands', {
          commands: [
            { command: 'clear', description: 'Chatni tozalash (bot xabarlarini o\'chirish)' },
            { command: 'start', description: 'Botni ishga tushirish' },
          ],
        });
      }
    } catch { /* ignore */ }

    this.log.log('Sverka Telegram long-polling boshlandi');
    while (this.polling) {
      try {
        const token = await this.getBotToken();
        if (!token) { await this.sleep(5000); continue; }
        const res = await axios.post(
          `https://api.telegram.org/bot${token}/getUpdates`,
          { offset: this.pollOffset, timeout: 30, allowed_updates: ['callback_query', 'message'] },
          { timeout: 40_000 },
        );
        const updates: any[] = res.data?.result || [];
        for (const u of updates) {
          this.pollOffset = u.update_id + 1;
          try {
            if (u.callback_query) await this.handleCallback(u.callback_query);
            else if (u.message) await this.handleMessage(u.message);
          } catch (e: any) {
            this.log.warn(`Update handle xato: ${e?.message}`);
          }
        }
      } catch (e: any) {
        // 409 (boshqa instance poll qilyapti) yoki network — kut va davom et
        const desc = e?.response?.data?.description || e?.message || '';
        if (!String(desc).includes('terminated by other')) {
          this.log.debug?.(`getUpdates: ${desc}`);
        }
        await this.sleep(3000);
      }
    }
  }

  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  private async tgCall(method: string, payload: any): Promise<void> {
    const token = await this.getBotToken();
    if (!token) return;
    try {
      await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: 10_000 });
    } catch (e: any) {
      this.log.warn(`tg ${method} xato: ${e?.response?.data?.description || e?.message}`);
    }
  }

  private async answerCb(id: string, text: string, alert = false): Promise<void> {
    await this.tgCall('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert });
  }

  private async editMsg(chatId: string, messageId: number | undefined, text: string, replyMarkup?: any): Promise<void> {
    if (!messageId) return;
    // replyMarkup berilmasa — { inline_keyboard: [] } (tugmani olib tashlaydi, hal bo'lganda).
    // Farq hali ham bor-u xabar joyida yangilanayotgan bo'lsa — approver tugmasini SAQLAB
    // qolish uchun replyMarkup uzatiladi (aks holda editMessageText tugmani o'chirib yuboradi).
    await this.tgCall('editMessageText', {
      chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
      reply_markup: replyMarkup ?? { inline_keyboard: [] },
    });
  }

  /** Xabarni o'chiradi — hal bo'lgan/yopilgan farqlar guruhni to'ldirmasin. */
  private async deleteMsg(chatId: string, messageId: number | undefined): Promise<void> {
    if (!messageId) return;
    await this.tgCall('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  // ─── SENT LOG (/clear uchun bot xabarlarini kuzatish) ─────────────────
  private async trackSentMessages(msgs: Array<{ chatId: string; messageId: number }>): Promise<void> {
    if (!msgs.length) return;
    try {
      const s = await this.prisma.setting.findUnique({ where: { key: SverkaTelegramService.KEY_SENT_LOG } });
      let log: Record<string, number[]> = {};
      if (s?.value) { try { log = JSON.parse(s.value) || {}; } catch { log = {}; } }
      for (const m of msgs) {
        const cid = String(m.chatId);
        const arr = log[cid] || [];
        arr.push(m.messageId);
        // Har chat uchun oxirgi 300 ta — cheksiz o'smasin
        log[cid] = arr.slice(-300);
      }
      await this.prisma.setting.upsert({
        where: { key: SverkaTelegramService.KEY_SENT_LOG },
        create: { key: SverkaTelegramService.KEY_SENT_LOG, value: JSON.stringify(log), updatedBy: 'system' },
        update: { value: JSON.stringify(log), updatedBy: 'system' },
      });
    } catch (e: any) {
      this.log.warn(`trackSentMessages xato: ${e?.message}`);
    }
  }

  /** Kelgan oddiy xabarlar — /clear, "Chatni tozalash" tugmasi va /start. */
  private async handleMessage(message: any): Promise<void> {
    const text: string = (message?.text || '').trim();
    const chatId = String(message?.chat?.id ?? '');
    if (!chatId) return;
    const cmd = text.split(/[\s@]/)[0].toLowerCase();

    if (cmd === '/clear' || text === SverkaTelegramService.CLEAR_BTN) {
      await this.handleClear(chatId, message?.message_id);
    } else if (cmd === '/start') {
      // Xush kelibsiz + pastdagi doimiy "Chatni tozalash" tugmasini o'rnatamiz
      await this.tgCall('sendMessage', {
        chat_id: chatId,
        text: "👋 <b>Sverka bot</b> ishga tushdi.\n\nBu yerga sverka farqlari haqida xabar keladi.\n\nChatni tozalash uchun pastdagi <b>🧹 Chatni tozalash</b> tugmasini bosing (yoki /clear yuboring).",
        parse_mode: 'HTML',
        reply_markup: this.clearKeyboard,
      });
    }
  }

  // Chat ostidagi doimiy "Tozalash" tugmasi
  private static readonly CLEAR_BTN = '🧹 Chatni tozalash';
  private get clearKeyboard() {
    return { keyboard: [[{ text: SverkaTelegramService.CLEAR_BTN }]], resize_keyboard: true, is_persistent: true };
  }

  /**
   * Botning shu chatdagi BUTUN xabarlarini o'chiradi (/clear yoki tugma).
   * Telegram'da "chatni tozalash" API yo'q — shuning uchun joriy message_id'dan
   * pastga qarab ID oralig'ini supurib o'chiramiz (bot + foydalanuvchi xabarlari,
   * 48 soatgача bo'lganlari). Kuzatilgan bot ID'lari ham qo'shiladi.
   */
  private async handleClear(chatId: string, triggerMessageId?: number): Promise<void> {
    const chats = await this.getChats();
    if (!chats.find((c) => String(c.chatId) === chatId)) return;

    // Kuzatilgan bot xabar ID'lari
    const s = await this.prisma.setting.findUnique({ where: { key: SverkaTelegramService.KEY_SENT_LOG } });
    let log: Record<string, number[]> = {};
    if (s?.value) { try { log = JSON.parse(s.value) || {}; } catch { log = {}; } }
    const trackedIds = log[chatId] || [];

    // ID oralig'i — joriy xabardan ~400 ta pastga (butun chatni qamrash uchun)
    const ids = new Set<number>(trackedIds);
    if (triggerMessageId) {
      const RANGE = 400;
      for (let i = triggerMessageId; i > triggerMessageId - RANGE && i > 0; i--) ids.add(i);
    }

    // Parallel o'chirish (20 talik to'plamlarda) — xatolarni e'tiborsiz qoldiramiz
    const arr = Array.from(ids).sort((a, b) => b - a);
    let deleted = 0;
    const BATCH = 20;
    for (let i = 0; i < arr.length; i += BATCH) {
      const batch = arr.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((mid) =>
        this.tgCall('deleteMessage', { chat_id: chatId, message_id: mid }).then(() => true).catch(() => false),
      ));
      deleted += results.filter(Boolean).length;
    }

    // Log'ni tozalaymiz
    log[chatId] = [];
    await this.prisma.setting.upsert({
      where: { key: SverkaTelegramService.KEY_SENT_LOG },
      create: { key: SverkaTelegramService.KEY_SENT_LOG, value: JSON.stringify(log), updatedBy: 'system' },
      update: { value: JSON.stringify(log), updatedBy: 'system' },
    });

    // Qisqa tasdiq + pastdagi tugmani qayta o'rnatamiz
    await this.tgCall('sendMessage', {
      chat_id: chatId,
      text: `🧹 <b>Chat tozalandi</b>`,
      parse_mode: 'HTML',
      reply_markup: this.clearKeyboard,
    });
    this.log.log(`/clear: chat=${chatId} — ${deleted} ta xabar o'chirildi`);
  }

  /**
   * "To'g'rilash" tugmasi bosilganda — faqat TASDIQLOVCHI (approver) chatlar.
   * callback_data: fix:<accountId>:<date>. diagnoseDay + fixAllMissing ishga tushadi.
   */
  private async handleFixCallback(cbq: any): Promise<void> {
    const data: string = cbq?.data || '';
    const cbId: string = cbq?.id;
    const chatId = String(cbq?.message?.chat?.id ?? cbq?.from?.id ?? '');
    if (!data.startsWith('fix:')) { await this.answerCb(cbId, "Noma'lum amal"); return; }

    const chat = await this.approverChat(chatId);
    if (!chat) { await this.answerCb(cbId, "Sizda ruxsat yo'q — faqat tasdiqlovchi to'g'rilay oladi", true); return; }

    const [, accountId, date] = data.split(':');
    if (!accountId || !date) { await this.answerCb(cbId, "Xato ma'lumot"); return; }

    await this.answerCb(cbId, "To'g'rilanmoqda...");

    try {
      const reconcile = this.moduleRef.get(ReconcileService, { strict: false });
      const store = await this.getNotifiedStore(date);

      const diag: any = await reconcile.diagnoseDay(accountId, date);
      const bankOnly: any[] = diag?.bankOnly || [];
      const insertable = bankOnly.filter((it) => !it.existsOnDate && (it.b2Id || it.generalId));

      // ── Qo'shib bo'lmaydigan farq — digestga izoh (keyingi yangilashda tozalanadi) ──
      if (insertable.length === 0) {
        const dateShift = bankOnly.filter((it) => it.existsOnDate).length;
        const note = dateShift > 0
          ? `⚠️ Avtomatik qo'shib bo'lmadi — ${dateShift} ta boshqa sanada (saytda "Sanani tuzatish").`
          : `⚠️ Avtomatik qo'shib bo'lmadi — saytda ko'ring.`;
        await this.refreshDigest(store, note);
        await this.saveNotifiedStore(store);
        return;
      }

      const items = insertable.map((it) => ({ b2Id: it.b2Id || undefined, generalId: it.generalId || undefined }));
      const res: any = await reconcile.fixAllMissing(accountId, date, items);
      const added = Array.isArray(res?.results) ? res.results.filter((r: any) => r.inserted).length : 0;

      // Hal bo'ldimi — qayta tekshiramiz (sync'siz, qo'shish DB'ga tushdi)
      const rec: any = await reconcile.reconcile(accountId, date, date, { withSync: false }).catch(() => null);
      if (!rec || rec.status === 'ok') {
        delete store.accounts[accountId];
      } else if (store.accounts[accountId]) {
        store.accounts[accountId].diffKey = String(Math.round(Number(rec.diff?.formula) || 0));
        store.accounts[accountId].totalFarq = this.farqOf(rec);
      }

      await this.refreshDigest(store, `✅ ${chat.name || chatId}: ${added} ta qo'shildi`);
      await this.saveNotifiedStore(store);

      await this.appendHistory({
        action: 'telegram_fix_missing', source: 'telegram', actorId: null,
        actorName: chat.name || chatId, chatId,
        details: { accountId, date, added, attempted: items.length },
      });
      this.log.log(`Telegram fix: account=${accountId} date=${date} added=${added} (chat=${chatId})`);
    } catch (e: any) {
      this.log.warn(`Telegram fix xato: ${e?.message}`);
      await this.refreshDigestForDate(date).catch(() => {});
    }
  }

  /** Callback dispatcher — prefiksga qarab yo'naltiradi. */
  private async handleCallback(cbq: any): Promise<void> {
    const data: string = cbq?.data || '';
    if (data.startsWith('apply:')) return this.handleApplyCallback(cbq);
    if (data.startsWith('closeall:')) return this.handleCloseAllCallback(cbq);
    if (data.startsWith('close:')) return this.handleCloseCallback(cbq);
    if (data.startsWith('fix:')) return this.handleFixCallback(cbq);
    if (data.startsWith('refresh:')) return this.handleRefreshCallback(cbq);
    await this.answerCb(cbq?.id, "Noma'lum amal");
  }

  /** Chat approver (tasdiqlovchi) bo'lsa qaytaradi, aks holda null. */
  private async approverChat(chatId: string): Promise<SverkaChat | null> {
    const chats = await this.getChats();
    const chat = chats.find((c) => String(c.chatId) === chatId);
    return chat && chat.role === 'approver' ? chat : null;
  }

  /** "❌ Yopish" — barcha ko'rsatilgan farqni bugunga yopadi (digest o'chadi). */
  private async handleCloseAllCallback(cbq: any): Promise<void> {
    const cbId: string = cbq?.id;
    const chatId = String(cbq?.message?.chat?.id ?? cbq?.from?.id ?? '');
    const [, date] = String(cbq?.data || '').split(':');
    const chat = await this.approverChat(chatId);
    if (!chat) { await this.answerCb(cbId, "Sizda ruxsat yo'q", true); return; }
    if (!date) { await this.answerCb(cbId, "Xato ma'lumot"); return; }
    try {
      const store = await this.getNotifiedStore(date);
      let n = 0;
      for (const a of Object.values(store.accounts)) {
        if (!a.dismissed) { a.dismissed = true; a.apply = null; n++; }
      }
      await this.refreshDigest(store); // count → 0 → digest o'chadi
      await this.saveNotifiedStore(store);
      await this.answerCb(cbId, `${n} ta farq bugunga yopildi (ertaga qayta ko'rinadi)`, true);
      await this.appendHistory({
        action: 'telegram_dismiss_all', source: 'telegram', actorId: null,
        actorName: chat.name || chatId, chatId, details: { date, count: n },
      });
    } catch (e: any) {
      await this.answerCb(cbId, 'Xato');
      this.log.warn(`Telegram closeall xato: ${e?.message}`);
    }
  }

  /** "🔄 Yangilash" — sverkani qayta ishga tushiradi (sync bilan) va digestni yangilaydi. */
  private async handleRefreshCallback(cbq: any): Promise<void> {
    const cbId: string = cbq?.id;
    const chatId = String(cbq?.message?.chat?.id ?? cbq?.from?.id ?? '');
    const [, date] = String(cbq?.data || '').split(':');
    const chat = await this.approverChat(chatId);
    if (!chat) { await this.answerCb(cbId, "Sizda ruxsat yo'q", true); return; }
    if (!date) { await this.answerCb(cbId, "Xato ma'lumot"); return; }
    await this.answerCb(cbId, 'Yangilanmoqda...');
    try {
      const reconcile = this.moduleRef.get(ReconcileService, { strict: false });
      const result: any = await reconcile.reconcileToday(date, { syncMismatched: true });
      if (result?.items && Array.isArray(result.items) && result.date) {
        await this.notifyNewMismatches(result.items, result.date, { synced: true });
      }
      this.log.log(`Telegram refresh: date=${date} (chat=${chatId})`);
    } catch (e: any) {
      this.log.warn(`Telegram refresh xato: ${e?.message}`);
    }
  }

  /**
   * AI tuzatishni bajaradi — callback_data: apply:<accountId>:<date>.
   * Qaysi guruhlar — store'dagi AI qaroridan (bo'lmasa hammasi). Targetlar FRESH
   * diagnose'dan (SverkaAgentService.applyRecommended).
   */
  private async handleApplyCallback(cbq: any): Promise<void> {
    const data: string = cbq?.data || '';
    const cbId: string = cbq?.id;
    const chatId = String(cbq?.message?.chat?.id ?? cbq?.from?.id ?? '');

    const chat = await this.approverChat(chatId);
    if (!chat) { await this.answerCb(cbId, "Sizda ruxsat yo'q — faqat tasdiqlovchi tuzatadi", true); return; }

    const [, accountId, date] = data.split(':');
    if (!accountId || !date) { await this.answerCb(cbId, "Xato ma'lumot"); return; }

    await this.answerCb(cbId, 'Tuzatilmoqda...');
    try {
      const agent = this.getSverkaAgent();
      if (!agent) throw new Error('AI agent mavjud emas');

      const store = await this.getNotifiedStore(date);
      const which = store.accounts[accountId]?.apply || { addMissing: true, fixDates: true, fixAmounts: true };

      const res: any = await agent.applyRecommended(accountId, date, which, `agent:tg:${chat.name || chatId}`);
      const c = res?.counts || { addMissing: 0, fixDates: 0, fixAmounts: 0 };
      const totalApplied = (c.addMissing || 0) + (c.fixDates || 0) + (c.fixAmounts || 0);
      const nowOk = res?.rec?.status === 'ok';

      if (nowOk) {
        delete store.accounts[accountId];
      } else if (store.accounts[accountId]) {
        store.accounts[accountId].diffKey = String(Math.round(Number(res?.rec?.diff?.formula) || 0));
        store.accounts[accountId].totalFarq = this.farqOf(res?.rec);
      }

      const parts2: string[] = [];
      if (c.addMissing) parts2.push(`➕${c.addMissing}`);
      if (c.fixDates) parts2.push(`📅${c.fixDates}`);
      if (c.fixAmounts) parts2.push(`⚖️${c.fixAmounts}`);
      const note = `✅ ${chat.name || chatId}: ${parts2.join(' ') || '0'} ${nowOk ? "(hal bo'ldi)" : '(qisman)'}`;
      await this.refreshDigest(store, note);
      await this.saveNotifiedStore(store);

      await this.appendHistory({
        action: 'telegram_agent_apply', source: 'telegram', actorId: null,
        actorName: chat.name || chatId, chatId,
        details: { accountId, date, counts: c, nowOk },
      });
      this.log.log(`Telegram AI apply: account=${accountId} date=${date} applied=${totalApplied} ok=${nowOk}`);
    } catch (e: any) {
      this.log.warn(`Telegram AI apply xato: ${e?.message}`);
      await this.refreshDigestForDate(date).catch(() => {});
    }
  }

  /** Yakka farqni bugunga yopish — callback_data: close:<accountId>:<date> (moslik uchun). */
  private async handleCloseCallback(cbq: any): Promise<void> {
    const data: string = cbq?.data || '';
    const cbId: string = cbq?.id;
    const chatId = String(cbq?.message?.chat?.id ?? cbq?.from?.id ?? '');

    const chat = await this.approverChat(chatId);
    if (!chat) { await this.answerCb(cbId, "Sizda ruxsat yo'q", true); return; }

    const [, accountId, date] = data.split(':');
    if (!accountId || !date) { await this.answerCb(cbId, "Xato ma'lumot"); return; }

    await this.answerCb(cbId, 'Yopildi');
    try {
      const store = await this.getNotifiedStore(date);
      const entry = store.accounts[accountId];
      if (entry) { entry.dismissed = true; entry.apply = null; } // bugunga yopildi (ertaga qayta)
      await this.refreshDigest(store);
      await this.saveNotifiedStore(store);
      await this.appendHistory({
        action: 'telegram_dismiss', source: 'telegram', actorId: null,
        actorName: chat.name || chatId, chatId, details: { accountId, date },
      });
    } catch (e: any) {
      this.log.warn(`Telegram close xato: ${e?.message}`);
    }
  }

  // ─── BOT TOKEN ────────────────────────────────────────────
  async getBotToken(): Promise<string> {
    const s = await this.prisma.setting.findUnique({
      where: { key: SverkaTelegramService.KEY_BOT_TOKEN },
    });
    return s?.value || process.env.SVERKA_BOT_TOKEN || '';
  }

  async setBotToken(token: string, actor?: { name: string | null }): Promise<{ ok: true; username?: string }> {
    const clean = (token || '').trim();
    if (!clean) throw new BadRequestException("Token bo'sh");

    // Telegram'da tekshiramiz — token haqiqiy ekanini va bot kimligini bilamiz
    let username: string | undefined;
    try {
      const res = await axios.post(`https://api.telegram.org/bot${clean}/getMe`, {}, { timeout: 10_000 });
      if (!res.data?.ok) throw new Error('getMe ok emas');
      username = res.data.result?.username;
    } catch (e: any) {
      const desc = e?.response?.data?.description || e?.message || 'tekshirib bo\'lmadi';
      throw new BadRequestException(`Token noto'g'ri yoki bot topilmadi: ${desc}`);
    }

    await this.prisma.setting.upsert({
      where: { key: SverkaTelegramService.KEY_BOT_TOKEN },
      create: { key: SverkaTelegramService.KEY_BOT_TOKEN, value: clean, updatedBy: actor?.name || 'system' },
      update: { value: clean, updatedBy: actor?.name || 'system' },
    });

    // Yangi bot uchun polling'ni qayta sozlaymiz — eski offset va webhook'ni tozalaymiz
    this.pollOffset = 0;
    try { await axios.post(`https://api.telegram.org/bot${clean}/deleteWebhook`, {}, { timeout: 10_000 }); } catch { /* ignore */ }
    if (!this.polling) this.startPolling();

    this.log.log(`Bot token yangilandi: @${username || '?'} (${actor?.name || 'system'})`);
    return { ok: true, username };
  }

  // ─── PASSWORD ───────────────────────────────────────────
  async verifyPassword(password: string): Promise<boolean> {
    const s = await this.prisma.setting.findUnique({
      where: { key: SverkaTelegramService.KEY_PASSWORD },
    });
    const expected = s?.value || process.env.ADMIN_ACTION_PASSWORD || '';
    return !!expected && password === expected;
  }

  // ─── CHATS ──────────────────────────────────────────────
  async getChats(): Promise<SverkaChat[]> {
    const s = await this.prisma.setting.findUnique({
      where: { key: SverkaTelegramService.KEY_CHATS },
    });
    if (!s?.value) return [];
    try {
      const arr = JSON.parse(s.value);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  async addChat(
    body: { chatId: string; role: ChatRole; name?: string },
    actor?: { id: string | null; name: string | null },
  ): Promise<SverkaChat> {
    if (!body.chatId?.trim()) throw new BadRequestException('chatId kerak');
    if (!['approver', 'watcher'].includes(body.role)) {
      throw new BadRequestException('role: approver yoki watcher bo\'lishi kerak');
    }
    const chats = await this.getChats();
    // Mavjud chatId bo'lsa, rolni va nomni yangilash
    const ix = chats.findIndex((c) => c.chatId === body.chatId.trim());
    const entry: SverkaChat = {
      chatId: body.chatId.trim(),
      role: body.role,
      name: body.name?.trim() || null,
      addedAt: ix >= 0 ? chats[ix].addedAt : new Date().toISOString(),
      addedBy: actor?.name || actor?.id || 'system',
    };
    if (ix >= 0) chats[ix] = entry;
    else chats.push(entry);

    await this.saveChats(chats);
    await this.appendHistory({
      action: ix >= 0 ? 'chat_updated' : 'chat_added',
      source: 'web',
      actorId: actor?.id || null,
      actorName: actor?.name || null,
      details: { chatId: entry.chatId, role: entry.role, name: entry.name },
    });
    return entry;
  }

  async removeChat(chatId: string, actor?: { id: string | null; name: string | null }): Promise<{ ok: true }> {
    const chats = await this.getChats();
    const filtered = chats.filter((c) => c.chatId !== chatId);
    if (filtered.length === chats.length) {
      throw new BadRequestException('Chat topilmadi');
    }
    await this.saveChats(filtered);
    await this.appendHistory({
      action: 'chat_removed',
      source: 'web',
      actorId: actor?.id || null,
      actorName: actor?.name || null,
      details: { chatId },
    });
    return { ok: true };
  }

  private async saveChats(chats: SverkaChat[]): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: SverkaTelegramService.KEY_CHATS },
      create: { key: SverkaTelegramService.KEY_CHATS, value: JSON.stringify(chats), updatedBy: 'system' },
      update: { value: JSON.stringify(chats), updatedBy: 'system' },
    });
  }

  // ─── HISTORY ────────────────────────────────────────────
  async getHistory(opts: {
    page?: number;
    perPage?: number;
    q?: string;
    actorName?: string;
    source?: 'web' | 'telegram';
  } = {}): Promise<{ items: HistoryEntry[]; total: number; page: number; perPage: number; actors: string[]; actions: string[] }> {
    const page = Math.max(1, Number(opts.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(opts.perPage) || 20));

    const s = await this.prisma.setting.findUnique({
      where: { key: SverkaTelegramService.KEY_HISTORY },
    });
    let all: HistoryEntry[] = [];
    try { all = s?.value ? JSON.parse(s.value) : []; if (!Array.isArray(all)) all = []; } catch { all = []; }

    const actorsSet = new Set<string>();
    const actionsSet = new Set<string>();
    for (const e of all) {
      actorsSet.add(e.actorName || (e.source === 'telegram' ? 'telegram' : 'system'));
      if (e.action) actionsSet.add(e.action);
    }

    let filtered = all;
    if (opts.actorName) {
      filtered = filtered.filter((e) => (e.actorName || (e.source === 'telegram' ? 'telegram' : 'system')) === opts.actorName);
    }
    if (opts.source) {
      filtered = filtered.filter((e) => e.source === opts.source);
    }
    if (opts.q) {
      const q = opts.q.toLowerCase().trim();
      if (q) {
        filtered = filtered.filter((e) => {
          const hay = [e.action, e.actorName || '', e.chatId || '', JSON.stringify(e.details || {})].join(' ').toLowerCase();
          return hay.includes(q);
        });
      }
    }

    const total = filtered.length;
    const start = (page - 1) * perPage;
    const items = filtered.slice(start, start + perPage);

    return {
      items,
      total,
      page,
      perPage,
      actors: [...actorsSet].sort(),
      actions: [...actionsSet].sort(),
    };
  }

  async appendHistory(entry: Omit<HistoryEntry, 'timestamp'>): Promise<void> {
    try {
      const cur = await this.prisma.setting.findUnique({
        where: { key: SverkaTelegramService.KEY_HISTORY },
      });
      let arr: HistoryEntry[] = [];
      try { arr = cur?.value ? JSON.parse(cur.value) : []; if (!Array.isArray(arr)) arr = []; } catch { arr = []; }

      arr.unshift({ timestamp: new Date().toISOString(), ...entry });
      if (arr.length > SverkaTelegramService.HISTORY_LIMIT) {
        arr = arr.slice(0, SverkaTelegramService.HISTORY_LIMIT);
      }

      await this.prisma.setting.upsert({
        where: { key: SverkaTelegramService.KEY_HISTORY },
        create: { key: SverkaTelegramService.KEY_HISTORY, value: JSON.stringify(arr), updatedBy: 'system' },
        update: { value: JSON.stringify(arr), updatedBy: 'system' },
      });
    } catch (e: any) {
      this.log.warn(`History yozish xato: ${e?.message}`);
    }
  }

  // ─── NOTIFICATION ──────────────────────────────────────
  async sendNotification(opts: {
    text: string;
    role?: ChatRole | 'all'; // default: 'all' (har ikkala rolga)
    silent?: boolean;
    replyMarkup?: any; // inline tugmalar (faqat approver uchun)
  }): Promise<{ ok: boolean; sent: number; failed: number; errors: string[]; messages: Array<{ chatId: string; messageId: number }> }> {
    const chats = await this.getChats();
    if (chats.length === 0) {
      return { ok: true, sent: 0, failed: 0, errors: ['No chats configured'], messages: [] };
    }
    const filtered = opts.role && opts.role !== 'all'
      ? chats.filter((c) => c.role === opts.role)
      : chats;

    const token = await this.getBotToken();
    if (!token) {
      return { ok: false, sent: 0, failed: filtered.length, errors: ['No bot token'], messages: [] };
    }

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    const messages: Array<{ chatId: string; messageId: number }> = [];

    await Promise.all(filtered.map(async (chat) => {
      try {
        const res = await axios.post(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            chat_id: chat.chatId,
            text: opts.text,
            parse_mode: 'HTML',
            disable_notification: !!opts.silent,
            ...(opts.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
          },
          { timeout: 10_000 },
        );
        sent++;
        const mid = res.data?.result?.message_id;
        if (mid) messages.push({ chatId: String(chat.chatId), messageId: mid });
      } catch (e: any) {
        failed++;
        const msg = e?.response?.data?.description || e?.message || 'Unknown error';
        errors.push(`${chat.chatId}: ${msg}`);
        this.log.warn(`Telegram send xato ${chat.chatId}: ${msg}`);
      }
    }));

    // /clear uchun yuborilgan xabarlarni kuzatamiz
    await this.trackSentMessages(messages);

    return { ok: failed === 0, sent, failed, errors, messages };
  }

  // ─── NOTIFIED STORE (digest holati: yagona xabar + farqli hisoblar) ──
  private async getNotifiedStore(date: string): Promise<DigestStore> {
    const s = await this.prisma.setting.findUnique({ where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY } });
    if (s?.value) {
      try {
        const parsed = JSON.parse(s.value);
        if (parsed?.date === date && parsed.accounts && typeof parsed.accounts === 'object') {
          // Eski shakl bilan moslik — digest bo'lmasa bo'sh qo'shamiz
          if (!parsed.digest || !Array.isArray(parsed.digest.msgs)) parsed.digest = { msgs: [] };
          return parsed as DigestStore;
        }
      } catch { /* ignore */ }
    }
    return { date, digest: { msgs: [] }, accounts: {} };
  }

  private async saveNotifiedStore(store: DigestStore): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY },
      create: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY, value: JSON.stringify(store), updatedBy: 'system' },
      update: { value: JSON.stringify(store), updatedBy: 'system' },
    });
  }

  /** Store'dagi (yopilmagan) hisoblardan DigestAccount[] tuzadi. */
  private storeToDigestAccounts(store: DigestStore): DigestAccount[] {
    const out: DigestAccount[] = [];
    for (const [accountId, a] of Object.entries(store.accounts)) {
      if (a.dismissed) continue;
      out.push({
        accountId,
        accountNo: a.accountNo,
        ownerName: a.ownerName,
        bankName: a.bankName,
        totalFarq: Number(a.totalFarq) || 0,
        culprit: a.culprit,
        confidence: a.confidence,
        actionable: !!a.apply || a.actionKind === 'add',
        actionKind: a.actionKind || 'ai',
      });
    }
    return out;
  }

  /**
   * Digest xabarini JORIY store holatiga keltiradi:
   *  - farqli hisob bor → yagona xabarni yuboradi (yo'q bo'lsa) yoki JOYIDA tahrirlaydi;
   *  - hech farq qolmasa → xabarni o'chiradi (guruh toza bo'ladi).
   * Approver chatlar tugmali, watcher chatlar tugmasiz digest oladi.
   */
  private async refreshDigest(store: DigestStore, note?: string): Promise<void> {
    const nowTk = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
    const accounts = this.storeToDigestAccounts(store);
    const { text, keyboard, count } = renderDigest(accounts, store.date, nowTk, { note });

    // Farq qolmadi — mavjud digest xabarlarini o'chiramiz
    if (count === 0) {
      for (const m of (store.digest?.msgs || [])) await this.deleteMsg(String(m.chatId), m.messageId);
      store.digest = { msgs: [] };
      return;
    }

    const existing = store.digest?.msgs || [];
    if (existing.length > 0) {
      // JOYIDA tahrir — approver tugmali, watcher tugmasiz
      for (const m of existing) {
        await this.editMsg(String(m.chatId), m.messageId, text, m.role === 'approver' ? keyboard : { inline_keyboard: [] });
      }
      return;
    }

    // Birinchi marta — yuboramiz (approver tugmali, watcher tugmasiz)
    const rApprover = await this.sendNotification({ text, role: 'approver', replyMarkup: keyboard });
    const rWatcher = await this.sendNotification({ text, role: 'watcher' });
    store.digest = {
      msgs: [
        ...rApprover.messages.map((m) => ({ ...m, role: 'approver' as const })),
        ...rWatcher.messages.map((m) => ({ ...m, role: 'watcher' as const })),
      ],
    };
  }

  /** Store'ni diskdan qayta o'qib, digestни yangilaydi (callback'lardan keyin). */
  private async refreshDigestForDate(date: string): Promise<void> {
    const store = await this.getNotifiedStore(date);
    await this.refreshDigest(store);
    await this.saveNotifiedStore(store);
  }

  /** SverkaAgentService — moduleRef orqali (circular dep bo'lmasin). */
  private getSverkaAgent(): SverkaAgentService | null {
    try { return this.moduleRef.get(SverkaAgentService, { strict: false }); }
    catch { return null; }
  }

  /** Farq magnitudasi (so'm) — formula/kirim/chiqim farqlarining eng kattasi. */
  private farqOf(rec: any): number {
    const f = Math.abs(Number(rec?.diff?.formula) || 0);
    const c = Math.abs(Number(rec?.diff?.credit) || 0);
    const d = Math.abs(Number(rec?.diff?.debit) || 0);
    return Math.max(f, c, d);
  }

  /**
   * Bir hisob uchun tahlil → digest maydonlari.
   * useSync=true → AI/reconcile avval bankdan sync qilib QAYTA tekshiradi (soxta farq shu yerda yo'qoladi).
   * resolved=true → sync'dan keyin farq YO'Q (soxta edi) — digestga qo'shilmaydi.
   */
  private async analyzeAccount(
    it: any, date: string, useAi: boolean, useSync: boolean,
  ): Promise<{
    resolved: boolean;
    usedAi: boolean;
    culprit?: string;
    confidence?: string;
    totalFarq?: number;
    apply: { addMissing: boolean; fixDates: boolean; fixAmounts: boolean } | null;
    actionKind: 'ai' | 'add';
  }> {
    if (useAi) {
      const agent = this.getSverkaAgent();
      if (agent) {
        try {
          const a: any = await agent.analyze(it.accountId, date, 'uz', useSync);
          // Sync bilan farq HAL bo'ldi (soxta edi) → digestga qo'shmaymiz
          if (a?.status === 'ok') return { resolved: true, usedAi: true, apply: null, actionKind: 'ai' };
          const d = a?.diagnosis;
          const p = a?.proposed;
          if (d && p) {
            const act = d.actions || {};
            const which = {
              addMissing: p.addMissing.length > 0 && act.addMissing !== 'skip',
              fixDates: p.fixDates.length > 0 && act.fixDates !== 'skip',
              fixAmounts: p.fixAmounts.length > 0 && act.fixAmounts !== 'skip',
            };
            const hasFix = which.addMissing || which.fixDates || which.fixAmounts;
            return {
              resolved: false, usedAi: true,
              culprit: d.culprit, confidence: d.confidence,
              totalFarq: a?.rec ? this.farqOf(a.rec) : undefined,
              apply: hasFix ? which : null,
              actionKind: 'ai',
            };
          }
        } catch (e: any) {
          this.log.warn(`Digest AI tahlil xato (${it.accountNo}): ${e?.message} — oddiy`);
        }
      }
    }
    // Fallback (AI o'chiq/xato): qo'shish tugmasi (legacy). Ayb yo'q → "noaniq" ko'rsatiladi.
    if (useSync) {
      // AI yo'q, lekin sync bilan qayta tekshiramiz — soxta farqni tashlaymiz
      const reconcile = this.moduleRef.get(ReconcileService, { strict: false });
      const rec: any = await reconcile.reconcile(it.accountId, date, date, { withSync: true }).catch(() => null);
      if (rec && rec.status === 'ok') return { resolved: true, usedAi: false, apply: null, actionKind: 'add' };
      if (rec) return { resolved: false, usedAi: false, totalFarq: this.farqOf(rec), apply: null, actionKind: 'add' };
    }
    return { resolved: false, usedAi: false, apply: null, actionKind: 'add' };
  }

  /** Test notification — admin UI'dan chaqiriladi. */
  async sendTestNotification(actor?: { name: string | null }): Promise<{
    ok: boolean; sent: number; failed: number; errors: string[];
    botOk: boolean; botUsername?: string; chatCount: number;
  }> {
    // 1) Bot tekshiruvi — token haqiqiy va Telegram'ga ulanish bormi (getMe)
    let botOk = false;
    let botUsername: string | undefined;
    try {
      const token = await this.getBotToken();
      const me = await axios.post(`https://api.telegram.org/bot${token}/getMe`, {}, { timeout: 10_000 });
      botOk = !!me.data?.ok;
      botUsername = me.data?.result?.username;
    } catch (e: any) {
      botOk = false;
      this.log.warn(`getMe xato (test): ${e?.response?.data?.description || e?.message}`);
    }

    const chats = await this.getChats();
    const text = `🧪 <b>Test xabarnomasi</b>\n\nSverka bot to'g'ri ishlayapti.\n\n<i>Yuborgan: ${actor?.name || 'admin'}</i>\n<i>Vaqt: ${new Date().toLocaleString('ru-RU')}</i>`;
    // Pastdagi doimiy "Chatni tozalash" tugmasini ham o'rnatamiz
    const result = await this.sendNotification({ text, role: 'all', replyMarkup: this.clearKeyboard });
    await this.appendHistory({
      action: 'test_notification',
      source: 'web',
      actorId: null,
      actorName: actor?.name || null,
      details: { sent: result.sent, failed: result.failed, botOk, botUsername },
    });
    return { ...result, botOk, botUsername, chatCount: chats.length };
  }

  /**
   * Yangi farq topilgan bo'lsa Telegram'ga xabar yuboradi.
   * Spam'ni oldini olish: shu kun ichida bir kontrakt uchun
   * bir martagina xabar ketadi (notifiedToday set).
   *
   * @param items reconcileToday natijasi (status='mismatch' bo'lganlar)
   * @param date  sverka sanasi
   */
  async notifyNewMismatches(
    items: Array<{
      accountId: string;
      status: string;
      ok?: boolean;
      accountNo?: string;
      ownerName?: string | null;
      bankName?: string | null;
      diff?: { credit?: number; debit?: number; formula?: number };
      bank?: { opening?: number; closing?: number; debit?: number; credit?: number };
      db?: { inflow?: number; outflow?: number; inCount?: number; outCount?: number };
    }>,
    date: string,
    opts: { synced?: boolean } = {},
  ): Promise<void> {
    try {
      // synced=true — chaqiruvchi ALLAQACHON bankdan sync qilib bo'lgan (cron 2-pass).
      // synced=false (web) — bu yerda AI/reconcile withSync bilan QAYTA tekshiradi
      // (sync-lag'dan yuzaga kelgan SOXTA farqlar shu bosqichda tashlanadi).
      const synced = !!opts.synced;

      // Haqiqiy holat — `status` (reconcile item'da `ok:true` hardcode bo'lishi mumkin).
      const mismatches = (items || []).filter((it) => it.status === 'mismatch');
      const store = await this.getNotifiedStore(date);

      // ─── 1) HAL BO'LGAN: store'da bor, lekin endi MOS (ok) — olib tashlaymiz ───
      const currentMismatchIds = new Set(mismatches.map((m) => m.accountId));
      for (const accId of Object.keys(store.accounts)) {
        if (currentMismatchIds.has(accId)) continue; // hali ham farq
        const cur = (items || []).find((it) => it.accountId === accId);
        if (cur && cur.status === 'ok') delete store.accounts[accId];
        // status='error' yoki umuman yo'q → tegmaymiz (bank olinmagan bo'lishi mumkin)
      }

      // ─── 2) Har mismatch: yangi yoki farq O'ZGARGAN bo'lsa tahlil (cap ichida) ───
      let aiCount = 0;
      const MAX_AI = 15; // storm himoyasi — bitta tsiklda maksimal AI tahlil soni
      for (const it of mismatches) {
        const diffKey = String(Math.round(Number(it.diff?.formula) || 0));
        const existing = store.accounts[it.accountId];
        if (existing?.dismissed) continue;                // bugunga yopilgan — tegmaymiz
        if (existing && existing.diffKey === diffKey) continue; // o'zgarmagan — qayta tahlil shart emas

        const res = await this.analyzeAccount(it, date, aiCount < MAX_AI, !synced);
        if (res.usedAi) aiCount++;
        if (res.resolved) {
          // Sync bilan hal bo'ldi (soxta farq edi) — digestga qo'shmaymiz
          delete store.accounts[it.accountId];
          continue;
        }
        store.accounts[it.accountId] = {
          accountNo: it.accountNo,
          ownerName: it.ownerName,
          bankName: it.bankName,
          diffKey,
          totalFarq: res.totalFarq ?? this.farqOf(it),
          culprit: res.culprit,
          confidence: res.confidence,
          apply: res.apply,
          actionKind: res.actionKind,
          dismissed: false,
        };
      }

      // ─── 3) Yagona digest xabarini JORIY holatga keltiramiz ───
      await this.refreshDigest(store);
      await this.saveNotifiedStore(store);

      const shown = Object.values(store.accounts).filter((a) => !a.dismissed).length;
      await this.appendHistory({
        action: 'mismatch_detected', source: 'web', actorId: null, actorName: 'system',
        details: { date, total: mismatches.length, shown },
      });
      this.log.log(`Digest yangilandi: ${shown} farq ko'rsatildi (jami ${mismatches.length} mismatch, sana ${date})`);
    } catch (e: any) {
      this.log.warn(`notifyNewMismatches xato: ${e?.message}`);
    }
  }

  /**
   * Web'dan to'g'rilangandan keyin — botdagi SHU farq xabarini JORIY holatga keltiradi:
   *   - hisob endi MOS bo'lsa → xabarni o'chiradi;
   *   - hali farqli bo'lsa → xabarni QAYTA tahlil qilib yangilaydi (eski "qo'shish
   *     kerak" stale xabar qolmasin — foydalanuvchini chalkashtirmasin);
   *   - bank olinmasa → tegmaydi (keyingi cron hal qiladi).
   */
  async markResolvedFromWeb(accountId: string, date: string, actorName?: string | null): Promise<void> {
    try {
      if (!accountId || !date) return;
      const store = await this.getNotifiedStore(date);
      const entry = store.accounts[accountId];
      if (!entry) return; // bu farq digestda yo'q

      // HAQIQIY holatni tekshiramiz (web fix to'liq hal qildimi?)
      const reconcile = this.moduleRef.get(ReconcileService, { strict: false });
      const rec: any = await reconcile.reconcile(accountId, date, date, { withSync: false }).catch(() => null);
      if (!rec) return; // bank olinmadi — digestga tegmaymiz

      if (rec.status === 'ok') {
        delete store.accounts[accountId];               // hal bo'ldi — digestdan chiqadi
        await this.appendHistory({
          action: 'sverka_resolved_web', source: 'web', actorId: null,
          actorName: actorName || null, details: { accountId, date },
        });
      } else {
        // Hali farqli — digest qatorini yangilaymiz (stale summa qolmasin)
        entry.diffKey = String(Math.round(Number(rec.diff?.formula) || 0));
        entry.totalFarq = this.farqOf(rec);
        entry.dismissed = false;
      }
      await this.refreshDigest(store);
      await this.saveNotifiedStore(store);
      this.log.log(`Web fix → digest yangilandi: ${accountId} ${date} (status=${rec.status})`);
    } catch (e: any) {
      this.log.warn(`markResolvedFromWeb xato: ${e?.message}`);
    }
  }

  /**
   * Sverka actions uchun — faqat history'ga yozish.
   * Telegram'ga xabar YUBORILMAYDI (foydalanuvchi web'dan o'zi bajaradi,
   * o'ziga echo kelishi shart emas).
   *
   * Telegram'ga xabar faqat notifyNewMismatches() orqali (yangi farq
   * topilganda) ketadi — bu "to'g'rilang" deb eslatuvchi xabar.
   */
  async notifySverkaAction(p: {
    action: string;
    label: string;
    accountInfo?: string;
    count?: number;
    actorName: string;
    extra?: Record<string, any>;
  }): Promise<void> {
    // Faqat history — Telegram yuborilmaydi
    await this.appendHistory({
      action: p.action,
      source: 'web',
      actorId: null,
      actorName: p.actorName,
      details: { accountInfo: p.accountInfo, count: p.count, ...p.extra },
    });

    // ESLATMA: Agar web'dan bajarilgan amal hisob uchun farqni TUZATIB
    // qo'ysa, keyingi reconcileToday'da notifiedKeys'dan o'sha hisob OLINIB
    // tashlanadi — chunki bu hisob endi mismatch emas, kelajakda yangi
    // farq paydo bo'lsa qayta xabar boradi.
    if (p.accountInfo) {
      this.removeFromNotified(p.accountInfo).catch(() => {});
    }
  }

  /**
   * Notified set'ni tozalash — keyingi sverka'da barcha mismatchlar
   * yangidan xabar yuboriladi. Test va qayta-yuborish uchun.
   */
  async resetNotifiedToday(actor?: { id: string | null; name: string | null }): Promise<{ ok: true; cleared: number; deleted: number }> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY },
    });
    let cleared = 0;
    // MUHIM: faqat store'ni tozalash yetarli emas — guruhdagi eski bot xabarlari
    // "orphan" bo'lib qoladi (endi hech qachon "Hal qilindi" bo'lmaydi) va keyingi cron
    // ularni yangidan yuboradi (dublikat). Shu bois avval o'sha xabarlarni O'CHIRAMIZ,
    // keyin store'ni tozalaymiz — guruh toza bo'ladi, cron esa toza holatdan boshlaydi.
    const toDelete: Array<{ chatId: string; messageId: number }> = [];
    if (setting?.value) {
      try {
        const parsed = JSON.parse(setting.value);
        cleared = Object.keys(parsed?.accounts || {}).length;
        // Yagona digest xabar(lar)ini o'chiramiz
        for (const m of (parsed?.digest?.msgs || [])) {
          if (m?.chatId && m?.messageId) toDelete.push({ chatId: String(m.chatId), messageId: Number(m.messageId) });
        }
        // Eski shakl (har hisob alohida xabar) qolgan bo'lsa — ularni ham
        for (const accId of Object.keys(parsed?.accounts || {})) {
          for (const m of (parsed.accounts[accId]?.msgs || [])) {
            if (m?.chatId && m?.messageId) toDelete.push({ chatId: String(m.chatId), messageId: Number(m.messageId) });
          }
        }
      } catch {}
    }

    // Parallel o'chirish (20 talik to'plamlarda) — xatolarni e'tiborsiz qoldiramiz
    let deleted = 0;
    const BATCH = 20;
    for (let i = 0; i < toDelete.length; i += BATCH) {
      const batch = toDelete.slice(i, i + BATCH);
      const res = await Promise.all(batch.map((m) =>
        this.tgCall('deleteMessage', { chat_id: m.chatId, message_id: m.messageId }).then(() => true).catch(() => false),
      ));
      deleted += res.filter(Boolean).length;
    }

    await this.prisma.setting.upsert({
      where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY },
      create: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY, value: JSON.stringify({ date: '', digest: { msgs: [] }, accounts: {} }), updatedBy: actor?.name || 'system' },
      update: { value: JSON.stringify({ date: '', digest: { msgs: [] }, accounts: {} }), updatedBy: actor?.name || 'system' },
    });
    await this.appendHistory({
      action: 'notified_reset',
      source: 'web',
      actorId: actor?.id || null,
      actorName: actor?.name || null,
      details: { cleared, deleted },
    });
    return { ok: true, cleared, deleted };
  }

  /**
   * Account uchun notified set'dan olib tashlash — qaytib farq paydo
   * bo'lsa, xabar berish uchun.
   */
  private async removeFromNotified(accountId: string): Promise<void> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY },
    });
    if (!setting?.value) return;
    let stored: any = null;
    try { stored = JSON.parse(setting.value); } catch { return; }
    const date = stored?.date;
    if (!date || !stored?.accounts || !stored.accounts[accountId]) return;
    // Store'ni qayta o'qib, hisobni olib tashlaymiz va digestni yangilaymiz
    const store = await this.getNotifiedStore(date);
    if (!store.accounts[accountId]) return;
    delete store.accounts[accountId];
    await this.refreshDigest(store);
    await this.saveNotifiedStore(store);
  }
}
