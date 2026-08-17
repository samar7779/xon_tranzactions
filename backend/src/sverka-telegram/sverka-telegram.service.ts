import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReconcileService } from '../transactions/reconcile.service';
import { SverkaAgentService } from '../transactions/sverka-agent.service';

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
        await this.notifyNewMismatches(result.items, result.date);
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
    const messageId: number | undefined = cbq?.message?.message_id;
    if (!data.startsWith('fix:')) { await this.answerCb(cbId, "Noma'lum amal"); return; }

    // Ruxsat — faqat tasdiqlovchi (approver) chatlar
    const chats = await this.getChats();
    const chat = chats.find((c) => String(c.chatId) === chatId);
    if (!chat || chat.role !== 'approver') {
      await this.answerCb(cbId, "Sizda ruxsat yo'q — faqat tasdiqlovchi to'g'rilay oladi", true);
      return;
    }

    const parts = data.split(':');
    const accountId = parts[1];
    const date = parts[2];
    if (!accountId || !date) { await this.answerCb(cbId, "Xato ma'lumot"); return; }

    await this.answerCb(cbId, "To'g'rilanmoqda...");

    try {
      const reconcile = this.moduleRef.get(ReconcileService, { strict: false });

      // Hisob ma'lumoti — barcha xabarlarda ko'rsatamiz
      const acc = await this.prisma.bankAccount.findUnique({
        where: { id: accountId }, include: { bank: true },
      }).catch(() => null);
      const accLine = acc
        ? `🏦 <b>Bank:</b> ${acc.bank?.name || '—'}\n💳 <b>Hisob:</b> <code>${acc.accountNo}</code>\n${acc.ownerName ? `👤 <b>Egasi:</b> ${acc.ownerName}\n` : ''}`
        : '';
      const nowTk = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

      const diag: any = await reconcile.diagnoseDay(accountId, date);
      const bankOnly: any[] = diag?.bankOnly || [];
      const insertable = bankOnly.filter((it) => !it.existsOnDate && (it.b2Id || it.generalId));

      // ── Qo'shib bo'lmaydigan farq — tugma bilan to'g'rilab bo'lmaydi ──
      if (insertable.length === 0) {
        const dateShift = bankOnly.filter((it) => it.existsOnDate).length;
        const dbExtra = Array.isArray(diag?.dbOnly) ? diag.dbOnly.length : 0;
        let reason: string;
        if (dateShift > 0) {
          reason = `📅 ${dateShift} ta tranzaksiya <b>boshqa sana</b> ostida saqlangan — saytdagi sverka'da <b>"Sanani tuzatish"</b> kerak.`;
        } else if (dbExtra > 0) {
          reason = `📊 DB'da <b>${dbExtra} ta ortiqcha</b> yozuv bor (bankda yo'q) — saytda tekshiring.`;
        } else {
          reason = `Farq qo'shish orqali hal bo'lmaydi (boshqa sababdan) — saytda tekshiring.`;
        }
        await this.editMsg(
          chatId, messageId,
          `⚠️ <b>Avtomatik to'g'rilab bo'lmadi</b>\n\n` +
          accLine +
          `📅 <b>Sverka sanasi:</b> ${date}\n\n` +
          `${reason}\n\n` +
          `🌐 transactions.xonapps.uz/uz/check\n` +
          `<i>Tekshirdi: ${chat.name || chatId} · ${nowTk}</i>`,
        );
        return;
      }

      const items = insertable.map((it) => ({ b2Id: it.b2Id || undefined, generalId: it.generalId || undefined }));
      const res: any = await reconcile.fixAllMissing(accountId, date, items);
      const insertedRows: any[] = Array.isArray(res?.results) ? res.results.filter((r: any) => r.inserted) : [];
      const added = insertedRows.length;
      // Qo'shilgan tranzaksiyalarning ID lari (externalId — composite bank ID)
      const addedIds: string[] = insertedRows
        .map((r) => r.externalId || r.transactionId)
        .filter((x): x is string => !!x);

      const idLines = addedIds.length > 0
        ? '\n🆔 <b>ID lar:</b>\n' + addedIds.slice(0, 15).map((id) => `  • <code>${id}</code>`).join('\n') +
          (addedIds.length > 15 ? `\n  • … va yana ${addedIds.length - 15} ta` : '')
        : '';

      const resultText =
        `✅ <b>To'g'rilandi</b>\n\n` +
        accLine +
        `📅 <b>Sverka sanasi:</b> ${date}\n` +
        `➕ <b>Qo'shildi:</b> ${added} ta tranzaksiya` +
        idLines + `\n\n` +
        `👤 <b>Kim to'g'riladi:</b> ${chat.name || chatId}\n` +
        `🕐 <b>Qachon:</b> ${nowTk}`;

      // Joriy xabar — natija bilan tahrirlanadi (tugma yo'qoladi)
      await this.editMsg(chatId, messageId, resultText);

      // BOSHQA tasdiqlovchilardagi SHU farq xabarlari ham — tugma yo'qolsin,
      // kim to'g'rilagani ko'rinsin. Keyin store'dan olib tashlaymiz.
      try {
        const store = await this.getNotifiedStore(date);
        const entry = store.accounts[accountId];
        if (entry?.msgs) {
          for (const m of entry.msgs) {
            if (String(m.chatId) === chatId && m.messageId === messageId) continue; // joriy — yuqorida
            await this.editMsg(String(m.chatId), m.messageId, resultText);
          }
          delete store.accounts[accountId];
          await this.saveNotifiedStore(store);
        }
      } catch { /* ignore */ }

      await this.appendHistory({
        action: 'telegram_fix_missing',
        source: 'telegram',
        actorId: null,
        actorName: chat.name || chatId,
        chatId,
        details: { accountId, date, added, attempted: items.length, addedIds },
      });
      this.log.log(`Telegram fix: account=${accountId} date=${date} added=${added} (chat=${chatId})`);
    } catch (e: any) {
      await this.editMsg(chatId, messageId, `❌ <b>Xato:</b> ${e?.message || "noma'lum"}`);
      this.log.warn(`Telegram fix xato: ${e?.message}`);
    }
  }

  /** Callback dispatcher — prefiksga qarab yo'naltiradi. */
  private async handleCallback(cbq: any): Promise<void> {
    const data: string = cbq?.data || '';
    if (data.startsWith('apply:')) return this.handleApplyCallback(cbq);
    if (data.startsWith('close:')) return this.handleCloseCallback(cbq);
    if (data.startsWith('fix:')) return this.handleFixCallback(cbq);
    await this.answerCb(cbq?.id, "Noma'lum amal");
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
    const messageId: number | undefined = cbq?.message?.message_id;

    const chats = await this.getChats();
    const chat = chats.find((c) => String(c.chatId) === chatId);
    if (!chat || chat.role !== 'approver') {
      await this.answerCb(cbId, "Sizda ruxsat yo'q — faqat tasdiqlovchi tuzatadi", true);
      return;
    }
    const parts = data.split(':');
    const accountId = parts[1];
    const date = parts[2];
    if (!accountId || !date) { await this.answerCb(cbId, "Xato ma'lumot"); return; }

    await this.answerCb(cbId, 'Tuzatilmoqda...');
    try {
      const agent = this.getSverkaAgent();
      if (!agent) throw new Error('AI agent mavjud emas');

      const store = await this.getNotifiedStore(date);
      const entry = store.accounts[accountId];
      const which = entry?.apply || { addMissing: true, fixDates: true, fixAmounts: true };

      const acc = await this.prisma.bankAccount.findUnique({
        where: { id: accountId }, include: { bank: true },
      }).catch(() => null);
      const accLine = acc
        ? `🏦 <b>${acc.bank?.name || '—'}</b>\n💳 <code>${acc.accountNo}</code>\n${acc.ownerName ? `👤 ${acc.ownerName}\n` : ''}`
        : '';
      const nowTk = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

      const res: any = await agent.applyRecommended(accountId, date, which, `agent:tg:${chat.name || chatId}`);
      const c = res?.counts || { addMissing: 0, fixDates: 0, fixAmounts: 0 };
      const totalApplied = (c.addMissing || 0) + (c.fixDates || 0) + (c.fixAmounts || 0);
      const nowOk = res?.rec?.status === 'ok';
      const newDiff = Math.abs(Number(res?.rec?.diff?.formula) || 0);
      const parts2: string[] = [];
      if (c.addMissing) parts2.push(`➕ ${c.addMissing} qo‘shildi`);
      if (c.fixDates) parts2.push(`📅 ${c.fixDates} sana`);
      if (c.fixAmounts) parts2.push(`⚖️ ${c.fixAmounts} summa`);

      // Barcha nusxalar (joriy + boshqa chatlardagi)
      const copies = [
        { chatId, messageId },
        ...(entry?.msgs || [])
          .filter((m) => !(String(m.chatId) === chatId && m.messageId === messageId))
          .map((m) => ({ chatId: String(m.chatId), messageId: m.messageId })),
      ];
      try {
        // To'liq yoki qisman — xabar(lar)ni O'CHIRAMIZ (guruhda qolmasin). Qisman bo'lsa
        // qolgan farq keyingi tekshiruvda YANGI (aniq) xabar bo'lib keladi.
        for (const m of copies) await this.deleteMsg(m.chatId, m.messageId);
        delete store.accounts[accountId];
        await this.saveNotifiedStore(store);
      } catch { /* ignore */ }

      await this.appendHistory({
        action: 'telegram_agent_apply', source: 'telegram', actorId: null,
        actorName: chat.name || chatId, chatId,
        details: { accountId, date, counts: c, nowOk, newDiff },
      });
      this.log.log(`Telegram AI apply: account=${accountId} date=${date} applied=${totalApplied} ok=${nowOk}`);
    } catch (e: any) {
      await this.editMsg(chatId, messageId, `❌ <b>Xato:</b> ${e?.message || "noma'lum"}`);
      this.log.warn(`Telegram AI apply xato: ${e?.message}`);
    }
  }

  /** Farqni e'tiborsiz qoldirish — callback_data: close:<accountId>:<date>. */
  private async handleCloseCallback(cbq: any): Promise<void> {
    const data: string = cbq?.data || '';
    const cbId: string = cbq?.id;
    const chatId = String(cbq?.message?.chat?.id ?? cbq?.from?.id ?? '');
    const messageId: number | undefined = cbq?.message?.message_id;

    const chats = await this.getChats();
    const chat = chats.find((c) => String(c.chatId) === chatId);
    if (!chat || chat.role !== 'approver') {
      await this.answerCb(cbId, "Sizda ruxsat yo'q", true);
      return;
    }
    const parts = data.split(':');
    const accountId = parts[1];
    const date = parts[2];
    if (!accountId || !date) { await this.answerCb(cbId, "Xato ma'lumot"); return; }

    await this.answerCb(cbId, 'Yopildi');
    try {
      // Xabar(lar)ni O'CHIRAMIZ + dismissed (shu kuni qayta chiqmaydi; ertaga store yangi).
      const store = await this.getNotifiedStore(date);
      const entry = store.accounts[accountId];
      if (entry) {
        for (const m of (entry.msgs || [])) await this.deleteMsg(String(m.chatId), m.messageId);
        entry.dismissed = true;
        entry.apply = undefined;
        entry.msgs = [];
        await this.saveNotifiedStore(store);
      } else {
        await this.deleteMsg(chatId, messageId);
      }
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

  // ─── NOTIFIED STORE (farq holatini + xabar message_id'larini saqlash) ──
  private async getNotifiedStore(date: string): Promise<{ date: string; accounts: Record<string, { diffKey: string; msgs: Array<{ chatId: string; messageId: number; role?: 'approver' | 'watcher' }>; apply?: { addMissing: boolean; fixDates: boolean; fixAmounts: boolean }; dismissed?: boolean }> }> {
    const s = await this.prisma.setting.findUnique({ where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY } });
    if (s?.value) {
      try {
        const parsed = JSON.parse(s.value);
        if (parsed?.date === date && parsed.accounts && typeof parsed.accounts === 'object') return parsed;
      } catch { /* ignore */ }
    }
    return { date, accounts: {} };
  }

  private async saveNotifiedStore(store: { date: string; accounts: Record<string, any> }): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY },
      create: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY, value: JSON.stringify(store), updatedBy: 'system' },
      update: { value: JSON.stringify(store), updatedBy: 'system' },
    });
  }

  /** Bitta mismatch uchun Telegram xabar matni — yuborish va JOYIDA tahrir bir xil matn ishlatsin. */
  private renderMismatch(
    it: { accountNo?: string; ownerName?: string | null; bankName?: string | null;
          diff?: { formula?: number }; bank?: { debit?: number; credit?: number };
          db?: { inflow?: number; outflow?: number; inCount?: number; outCount?: number } },
    date: string,
    fmt: (n: number | undefined) => string,
  ): string {
    const bankKirim = Number(it.bank?.credit) || 0;
    const bankChiqim = Number(it.bank?.debit) || 0;
    const dbKirim = Number(it.db?.inflow) || 0;
    const dbChiqim = Number(it.db?.outflow) || 0;
    const farqKirim = bankKirim - dbKirim;   // + = bankda ko'p, − = DB'da ko'p
    const farqChiqim = bankChiqim - dbChiqim;
    const totalFarq = Math.abs(Number(it.diff?.formula) || 0);

    const lines: string[] = [];
    lines.push(`⚠️ <b>Sverka farq aniqlandi</b>`);
    lines.push('');
    if (it.bankName) lines.push(`🏦 <b>Bank:</b> ${it.bankName}`);
    if (it.accountNo) lines.push(`💳 <b>Hisob:</b> <code>${it.accountNo}</code>`);
    if (it.ownerName) lines.push(`👤 <b>Egasi:</b> ${it.ownerName}`);
    lines.push(`📅 <b>Sana:</b> ${date}`);
    lines.push('');

    if (Math.abs(farqKirim) > 0.01) {
      const sign = farqKirim > 0 ? '+' : '−';
      const who = farqKirim > 0 ? '(bankda ortiq)' : '(DBda ortiq)';
      lines.push(`📥 <b>Kirim oborot:</b>`);
      lines.push(`  • Bank: <code>${fmt(bankKirim)}</code>`);
      lines.push(`  • DB:   <code>${fmt(dbKirim)}</code> (${it.db?.inCount || 0} ta)`);
      lines.push(`  • Farq: <code>${sign}${fmt(Math.abs(farqKirim))}</code> ${who}`);
    }
    if (Math.abs(farqChiqim) > 0.01) {
      const sign = farqChiqim > 0 ? '+' : '−';
      const who = farqChiqim > 0 ? '(bankda ortiq)' : '(DBda ortiq)';
      lines.push(`📤 <b>Chiqim oborot:</b>`);
      lines.push(`  • Bank: <code>${fmt(bankChiqim)}</code>`);
      lines.push(`  • DB:   <code>${fmt(dbChiqim)}</code> (${it.db?.outCount || 0} ta)`);
      lines.push(`  • Farq: <code>${sign}${fmt(Math.abs(farqChiqim))}</code> ${who}`);
    }

    lines.push('');
    lines.push(`💰 <b>UMUMIY FARQ:</b> <code>${fmt(totalFarq)}</code> UZS`);
    lines.push('');
    lines.push(`❓ <b>To'g'rilaysizmi?</b>`);
    lines.push(`<i>Tasdiqlovchilar quyidagi tugma orqali (bankda bor, DBda yo'q yozuvlarni qo'shadi) yoki saytda to'g'rilashi mumkin.</i>`);
    return lines.join('\n');
  }

  /** SverkaAgentService — moduleRef orqali (circular dep bo'lmasin). */
  private getSverkaAgent(): SverkaAgentService | null {
    try { return this.moduleRef.get(SverkaAgentService, { strict: false }); }
    catch { return null; }
  }

  /** Culprit (ayb) → emoji + so'z (uz). */
  private culpritLabel(c: string): string {
    switch (c) {
      case 'bank': return '🔴 <b>Bank tomonda xato</b>';
      case 'us': return '🔵 <b>Biz tomonda xato</b>';
      case 'mixed': return '🟠 <b>Aralash sabab</b>';
      case 'none': return '🟢 <b>Farq yo‘q</b>';
      default: return '⚪ <b>Sabab aniqlanmadi</b>';
    }
  }

  /** Culprit — qisqa (sarlavha uchun). */
  private culpritShort(c: string): string {
    switch (c) {
      case 'bank': return '🔴 Bank xatosi';
      case 'us': return '🔵 Biz tomonda';
      case 'mixed': return '🟠 Aralash';
      case 'none': return '🟢 Farq yo‘q';
      default: return '⚪ Noaniq';
    }
  }

  private truncate(s: string | undefined, n: number): string {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /**
   * AI-boyitilgan mismatch matni (Telegram, HTML) — QISQA (guruh to'lmasin).
   * Faqat muhim: kim/qancha/nega(qisqa xulosa)/ayb + tuzatish rejasi. To'liq tafsilot
   * (findings, tavsiya) saytda ko'rinadi.
   */
  private renderAiMismatch(
    it: any, date: string, fmt: (n: number | undefined) => string,
    d: any, p: any, which: { addMissing: boolean; fixDates: boolean; fixAmounts: boolean },
  ): string {
    const totalFarq = Math.abs(Number(it.diff?.formula) || 0);
    const lines: string[] = [];
    lines.push(`⚠️ <b>Sverka farq</b> · ${this.culpritShort(d.culprit)}`);
    lines.push(`🏦 ${it.bankName || '—'} · <code>${it.accountNo || ''}</code>`);
    if (it.ownerName) lines.push(`👤 ${it.ownerName}`);
    lines.push(`💰 <b>${fmt(totalFarq)}</b> UZS · 📅 ${date}`);
    if (d.summary) { lines.push(''); lines.push(this.truncate(d.summary, 320)); }
    if (d.cautionNote) lines.push(`⚠️ ${this.truncate(d.cautionNote, 160)}`);
    const parts: string[] = [];
    if (which.addMissing) parts.push(`➕ ${p.addMissing.length} qo‘shish`);
    if (which.fixDates) parts.push(`📅 ${p.fixDates.length} sana`);
    if (which.fixAmounts) parts.push(`⚖️ ${p.fixAmounts.length} summa`);
    if (parts.length) { lines.push(''); lines.push(`🔧 ${parts.join(' · ')}`); }
    else if (p.unresolved?.length) { lines.push(''); lines.push(`🔎 ${p.unresolved.length} ta qo‘lda ko‘rish kerak`); }
    return lines.join('\n');
  }

  /**
   * Bitta mismatch uchun Telegram xabari + tugmalar + apply qarori.
   * useAi=true bo'lsa AI tahlil qiladi (sabab + tavsiya + [Tuzatish]/[Yopish]).
   * AI o'chirilgan yoki xato bersa — eski oddiy matn + legacy "qo'shish" tugmasi.
   */
  private async buildMismatchNotif(
    it: any, date: string, fmt: (n: number | undefined) => string, useAi: boolean,
  ): Promise<{ text: string; replyMarkup: any; apply: { addMissing: boolean; fixDates: boolean; fixAmounts: boolean } | null; ai: boolean; resolved: boolean }> {
    if (useAi) {
      const agent = this.getSverkaAgent();
      if (agent) {
        try {
          // withSync=false — cron (autoSverkaNotify) allaqachon syncMismatched qildi
          const a: any = await agent.analyze(it.accountId, date, 'uz', false);
          const d = a?.diagnosis;
          const p = a?.proposed;
          // Tahlil (sync bilan) farqni HAL qilган bo'lsa — xabar yubormaymiz/o'chiramiz.
          if (a?.status === 'ok') {
            return { text: '', replyMarkup: { inline_keyboard: [] }, apply: null, ai: true, resolved: true };
          }
          if (d && p) {
            const act = d.actions || {};
            const which = {
              addMissing: p.addMissing.length > 0 && act.addMissing !== 'skip',
              fixDates: p.fixDates.length > 0 && act.fixDates !== 'skip',
              fixAmounts: p.fixAmounts.length > 0 && act.fixAmounts !== 'skip',
            };
            const hasFix = which.addMissing || which.fixDates || which.fixAmounts;
            const text = this.renderAiMismatch(it, date, fmt, d, p, which);
            const replyMarkup = hasFix
              ? { inline_keyboard: [[
                  { text: '✅ Tuzatish', callback_data: `apply:${it.accountId}:${date}` },
                  { text: '❌ Yopish', callback_data: `close:${it.accountId}:${date}` },
                ]] }
              : { inline_keyboard: [[
                  { text: '❌ Yopish', callback_data: `close:${it.accountId}:${date}` },
                ]] };
            return { text, replyMarkup, apply: hasFix ? which : null, ai: true, resolved: false };
          }
        } catch (e: any) {
          this.log.warn(`Telegram AI tahlil xato (${it.accountNo}): ${e?.message} — oddiy xabar`);
        }
      }
    }
    // Fallback — eski xatti-harakat (bankda bor DBda yo'q yozuvni qo'shish)
    return {
      text: this.renderMismatch(it, date, fmt),
      replyMarkup: { inline_keyboard: [[{ text: "✅ To'g'rilash (qo'shish)", callback_data: `fix:${it.accountId}:${date}` }]] },
      apply: null,
      ai: false,
      resolved: false,
    };
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
  ): Promise<void> {
    try {
      // MUHIM: reconcile har bir item'da `ok: true` ni hardcode qaytaradi
      // (bu "amal bajarildi" degani, "mos keldi" emas). Haqiqiy holat — `status`.
      // Farq = status === 'mismatch'.
      const mismatches = (items || []).filter((it) => it.status === 'mismatch');

      const store = await this.getNotifiedStore(date);
      const nowTk = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
      const fmt = (n: number | undefined) => (n != null ? Number(n).toLocaleString('ru-RU') : '0');

      // ─── 1) HAL QILINDI: store'da bor, lekin endi MOS (ok) bo'lgan hisoblar ───
      // Hal bo'lgan farq guruhni to'ldirmasin — xabarni O'CHIRAMIZ (tarix admin'da qoladi).
      const currentMismatchIds = new Set(mismatches.map((m) => m.accountId));
      let resolved = 0;
      for (const accId of Object.keys(store.accounts)) {
        if (currentMismatchIds.has(accId)) continue; // hali ham farq — tegmaymiz
        const cur = (items || []).find((it) => it.accountId === accId);
        if (cur && cur.status === 'ok') {
          const entry = store.accounts[accId];
          for (const m of (entry.msgs || [])) {
            await this.deleteMsg(m.chatId, m.messageId);
          }
          delete store.accounts[accId];
          resolved++;
        }
      }

      if (mismatches.length === 0) {
        if (resolved > 0) await this.saveNotifiedStore(store);
        return;
      }

      // ─── 2) Har farq uchun: BIRINCHI marta bo'lsa yuboramiz, farq O'ZGARGAN bo'lsa
      //     mavjud xabarni JOYIDA tahrirlaymiz (yangi xabar EMAS), bir xil bo'lsa tegmaymiz.
      //     Shu bilan bitta hisob = bitta xabar bo'ladi — guruh tolmaydi va eski
      //     "orphan" xabarlar qolmaydi (avval har o'zgarishda yangi xabar ketardi).
      let sentCount = 0;
      let editedCount = 0;
      let aiCount = 0;
      const MAX_AI = 15; // storm himoyasi — bitta tsiklda maksimal AI tahlil soni
      for (const it of mismatches) {
        const diffKey = String(Math.round(Number(it.diff?.formula) || 0));
        const existing = store.accounts[it.accountId];

        if (!existing) {
          // BIRINCHI marta — AI-boyitilgan xabar (cap ichida), watcher tugmasiz.
          const notif = await this.buildMismatchNotif(it, date, fmt, aiCount < MAX_AI);
          if (notif.ai) aiCount++;
          // Tahlil (sync bilan) farqni HAL qilган bo'lsa — xabar YUBORMAYMIZ (guruh to'lmasin).
          if (notif.resolved) {
            this.log.log(`Mismatch sync bilan hal bo'ldi — xabar yuborilmadi: ${it.accountNo}`);
            continue;
          }
          const rApprover = await this.sendNotification({ text: notif.text, role: 'approver', replyMarkup: notif.replyMarkup });
          const rWatcher = await this.sendNotification({ text: notif.text, role: 'watcher' });
          const msgs = [
            ...rApprover.messages.map((m) => ({ ...m, role: 'approver' as const })),
            ...rWatcher.messages.map((m) => ({ ...m, role: 'watcher' as const })),
          ];
          if (msgs.length > 0) {
            store.accounts[it.accountId] = { diffKey, msgs, apply: notif.apply || undefined };
            sentCount++;
            this.log.log(`Mismatch notification yuborildi: ${it.accountNo} (ai=${notif.ai}, sent=${rApprover.sent + rWatcher.sent})`);
          } else {
            const errors = [...rApprover.errors, ...rWatcher.errors];
            this.log.warn(`Mismatch notification YUBORILMADI ${it.accountNo}: errors=${errors.join(' | ')}`);
          }
        } else if (existing.diffKey !== diffKey && !existing.dismissed) {
          // Farq O'ZGARGAN (va yopilmagan) — joyida qayta AI tahlil + yangilash.
          const notif = await this.buildMismatchNotif(it, date, fmt, aiCount < MAX_AI);
          if (notif.ai) aiCount++;
          if (notif.resolved) {
            // Endi hal bo'lgan — xabar(lar)ni o'chiramiz (bu yerda qolmasin).
            for (const m of (existing.msgs || [])) await this.deleteMsg(m.chatId, m.messageId);
            delete store.accounts[it.accountId];
            this.log.log(`Mismatch endi hal bo'ldi — xabar o'chirildi: ${it.accountNo}`);
            continue;
          }
          for (const m of (existing.msgs || [])) {
            await this.editMsg(m.chatId, m.messageId, notif.text, m.role === 'approver' ? notif.replyMarkup : { inline_keyboard: [] });
          }
          existing.diffKey = diffKey;
          existing.apply = notif.apply || undefined;
          editedCount++;
          this.log.log(`Mismatch joyida yangilandi: ${it.accountNo} → ${diffKey} (ai=${notif.ai})`);
        }
        // diffKey bir xil (yoki dismissed) — hech narsa qilmaymiz (spam yo'q).
      }

      await this.saveNotifiedStore(store);
      await this.appendHistory({
        action: 'mismatch_detected',
        source: 'web',
        actorId: null,
        actorName: 'system',
        details: {
          date,
          sent: sentCount,
          edited: editedCount,
          resolved,
          total: mismatches.length,
        },
      });

      this.log.log(`Mismatch notification: ${sentCount} yuborildi, ${editedCount} yangilandi, ${resolved} hal qilindi (jami ${mismatches.length} farq, sana ${date})`);
    } catch (e: any) {
      this.log.warn(`notifyNewMismatches xato: ${e?.message}`);
    }
  }

  /**
   * Web'dan to'g'rilanganda — botdagi SHU farq xabarlarini DARROV "Hal qilindi"
   * deb yangilaydi (barcha chatlarda, tugma yo'qoladi). reconcile'ni kutmaydi.
   */
  async markResolvedFromWeb(accountId: string, date: string, actorName?: string | null): Promise<void> {
    try {
      if (!accountId || !date) return;
      const store = await this.getNotifiedStore(date);
      const entry = store.accounts[accountId];
      if (!entry?.msgs?.length) return; // bu farq uchun bot xabari yo'q
      // Hal bo'lgan farq — bot xabar(lar)ini O'CHIRAMIZ (guruh to'lmasin; tarix admin'da qoladi).
      for (const m of entry.msgs) {
        await this.deleteMsg(String(m.chatId), m.messageId);
      }
      delete store.accounts[accountId];
      await this.saveNotifiedStore(store);
      await this.appendHistory({
        action: 'sverka_resolved_web', source: 'web', actorId: null,
        actorName: actorName || null, details: { accountId, date },
      });
      this.log.log(`Web fix → bot xabari o'chirildi: account=${accountId} date=${date}`);
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
        const accounts = parsed?.accounts || {};
        for (const accId of Object.keys(accounts)) {
          cleared++;
          for (const m of (accounts[accId]?.msgs || [])) {
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
      create: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY, value: JSON.stringify({ date: '', accounts: {} }), updatedBy: actor?.name || 'system' },
      update: { value: JSON.stringify({ date: '', accounts: {} }), updatedBy: actor?.name || 'system' },
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
    if (!stored?.accounts || !stored.accounts[accountId]) return;
    delete stored.accounts[accountId];
    await this.prisma.setting.update({
      where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY },
      data: { value: JSON.stringify(stored) },
    });
  }
}
