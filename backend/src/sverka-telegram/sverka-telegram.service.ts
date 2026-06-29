import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import axios from 'axios';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReconcileService } from '../transactions/reconcile.service';

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

const DEFAULT_BOT_TOKEN = '8204664457:AAEuJHtbENHB7adP1TUL4ySgf2ia3radUjY';

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

  private static readonly HISTORY_LIMIT = 500;
  private static readonly DEFAULT_PASSWORD = '7779';

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

  private async pollLoop() {
    // getUpdates va webhook bir vaqtda ishlamaydi — webhook'ni o'chiramiz
    try {
      const token = await this.getBotToken();
      if (token) {
        await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`, {}, { timeout: 10_000 }).catch(() => {});
      }
    } catch { /* ignore */ }

    this.log.log('Sverka Telegram long-polling boshlandi');
    while (this.polling) {
      try {
        const token = await this.getBotToken();
        if (!token) { await this.sleep(5000); continue; }
        const res = await axios.post(
          `https://api.telegram.org/bot${token}/getUpdates`,
          { offset: this.pollOffset, timeout: 30, allowed_updates: ['callback_query'] },
          { timeout: 40_000 },
        );
        const updates: any[] = res.data?.result || [];
        for (const u of updates) {
          this.pollOffset = u.update_id + 1;
          try {
            if (u.callback_query) await this.handleFixCallback(u.callback_query);
          } catch (e: any) {
            this.log.warn(`Callback handle xato: ${e?.message}`);
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

  private async editMsg(chatId: string, messageId: number | undefined, text: string): Promise<void> {
    if (!messageId) return;
    // reply_markup: { inline_keyboard: [] } — inline tugmani olib tashlaydi
    // (amal bajarilgach tugma kerak emas, qayta bosib bo'lmasin).
    await this.tgCall('editMessageText', {
      chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] },
    });
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
      const diag: any = await reconcile.diagnoseDay(accountId, date);
      const bankOnly: any[] = diag?.bankOnly || [];
      const insertable = bankOnly.filter((it) => !it.existsOnDate && (it.b2Id || it.generalId));
      if (insertable.length === 0) {
        await this.editMsg(chatId, messageId, "✅ <b>Qo'shish uchun yangi yozuv yo'q</b> — ehtimol allaqachon qo'shilgan yoki farq boshqa sababdan.");
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

      const nowTk = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
      const idLines = addedIds.length > 0
        ? '\n🆔 <b>ID lar:</b>\n' + addedIds.slice(0, 15).map((id) => `  • <code>${id}</code>`).join('\n') +
          (addedIds.length > 15 ? `\n  • … va yana ${addedIds.length - 15} ta` : '')
        : '';

      // Hisob ma'lumoti — natijada ham ko'rinsin
      const acc = await this.prisma.bankAccount.findUnique({
        where: { id: accountId }, include: { bank: true },
      }).catch(() => null);
      const accLine = acc
        ? `🏦 <b>Bank:</b> ${acc.bank?.name || '—'}\n💳 <b>Hisob:</b> <code>${acc.accountNo}</code>\n${acc.ownerName ? `👤 <b>Egasi:</b> ${acc.ownerName}\n` : ''}`
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

  // ─── BOT TOKEN ────────────────────────────────────────────
  async getBotToken(): Promise<string> {
    const s = await this.prisma.setting.findUnique({
      where: { key: SverkaTelegramService.KEY_BOT_TOKEN },
    });
    return s?.value || DEFAULT_BOT_TOKEN;
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
    const expected = s?.value || SverkaTelegramService.DEFAULT_PASSWORD;
    return password === expected;
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

    return { ok: failed === 0, sent, failed, errors, messages };
  }

  // ─── NOTIFIED STORE (farq holatini + xabar message_id'larini saqlash) ──
  private async getNotifiedStore(date: string): Promise<{ date: string; accounts: Record<string, { diffKey: string; msgs: Array<{ chatId: string; messageId: number }> }> }> {
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
    const result = await this.sendNotification({ text, role: 'all' });
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
      // Foydalanuvchi tugma bosmasdan saytda o'zi to'g'rilagan bo'lsa —
      // botdagi xabarni "Hal qilindi" deb yangilaymiz (tugma yo'qoladi).
      const currentMismatchIds = new Set(mismatches.map((m) => m.accountId));
      let resolved = 0;
      for (const accId of Object.keys(store.accounts)) {
        if (currentMismatchIds.has(accId)) continue; // hali ham farq — tegmaymiz
        const cur = (items || []).find((it) => it.accountId === accId);
        if (cur && cur.status === 'ok') {
          const entry = store.accounts[accId];
          for (const m of (entry.msgs || [])) {
            await this.editMsg(m.chatId, m.messageId,
              `✅ <b>Hal qilindi</b>\n\nBu farq saytda to'g'rilandi — endi mos.\n\n📅 Sverka sanasi: ${date}\n🕐 ${nowTk}`);
          }
          delete store.accounts[accId];
          resolved++;
        }
      }

      if (mismatches.length === 0) {
        if (resolved > 0) await this.saveNotifiedStore(store);
        return;
      }

      // ─── 2) YANGI yoki O'ZGARGAN (diff boshqa) farqlar — xabar yuboramiz ───
      // Bir xil farq (diffKey bir xil) → qayta yubormaymiz (spam emas).
      // Diff o'zgarsa → yangi xabar (avtomatik, reset shart emas).
      const newOnes = mismatches.filter((it) => {
        const diffKey = String(Math.round(Number(it.diff?.formula) || 0));
        const existing = store.accounts[it.accountId];
        return !existing || existing.diffKey !== diffKey;
      });

      let sentCount = 0;
      // Notification yuborish (har biri uchun alohida, BATAFSIL)
      for (const it of newOnes) {
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

        // Tafsilot — kirim
        if (Math.abs(farqKirim) > 0.01) {
          const sign = farqKirim > 0 ? '+' : '−';
          const who = farqKirim > 0 ? '(bankda ortiq)' : '(DBda ortiq)';
          lines.push(`📥 <b>Kirim oborot:</b>`);
          lines.push(`  • Bank: <code>${fmt(bankKirim)}</code>`);
          lines.push(`  • DB:   <code>${fmt(dbKirim)}</code> (${it.db?.inCount || 0} ta)`);
          lines.push(`  • Farq: <code>${sign}${fmt(Math.abs(farqKirim))}</code> ${who}`);
        }

        // Tafsilot — chiqim
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

        // Inline tugma — faqat TASDIQLOVCHI (approver) chatlarga.
        // callback_data: fix:<accountId>:<date> (64 baytdan kam bo'lishi shart).
        const button = {
          inline_keyboard: [[
            { text: "✅ To'g'rilash (qo'shish)", callback_data: `fix:${it.accountId}:${date}` },
          ]],
        };

        // SEND — approver tugma bilan, watcher faqat matn. Yuborilgan
        // message_id'lar store'ga yoziladi (keyin "Hal qilindi" deb tahrirlash uchun).
        const diffKey = String(Math.round(Number(it.diff?.formula) || 0));
        const rApprover = await this.sendNotification({ text: lines.join('\n'), role: 'approver', replyMarkup: button });
        const rWatcher = await this.sendNotification({ text: lines.join('\n'), role: 'watcher' });
        const msgs = [...rApprover.messages, ...rWatcher.messages];
        const sent = rApprover.sent + rWatcher.sent;
        if (sent > 0) {
          store.accounts[it.accountId] = { diffKey, msgs };
          sentCount++;
          this.log.log(`Mismatch notification yuborildi: ${it.accountNo} (sent=${sent})`);
        } else {
          const errors = [...rApprover.errors, ...rWatcher.errors];
          this.log.warn(`Mismatch notification YUBORILMADI ${it.accountNo}: errors=${errors.join(' | ')}`);
        }
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
          resolved,
          total: mismatches.length,
        },
      });

      this.log.log(`Mismatch notification: ${sentCount} yuborildi, ${resolved} hal qilindi (jami ${mismatches.length} farq, sana ${date})`);
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

      const acc = await this.prisma.bankAccount.findUnique({
        where: { id: accountId },
        include: { bank: true },
      }).catch(() => null);
      const accLine = acc
        ? `🏦 <b>Bank:</b> ${acc.bank?.name || '—'}\n💳 <b>Hisob:</b> <code>${acc.accountNo}</code>\n${acc.ownerName ? `👤 <b>Egasi:</b> ${acc.ownerName}\n` : ''}`
        : '';
      const nowTk = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
      const text =
        `✅ <b>Hal qilindi</b>\n\n` +
        accLine +
        `📅 <b>Sverka sanasi:</b> ${date}\n\n` +
        `Bu farq <b>saytda</b> to'g'rilandi.\n` +
        `👤 <b>Kim:</b> ${actorName || 'web'}\n` +
        `🕐 <b>Qachon:</b> ${nowTk}`;

      for (const m of entry.msgs) {
        await this.editMsg(String(m.chatId), m.messageId, text);
      }
      delete store.accounts[accountId];
      await this.saveNotifiedStore(store);
      await this.appendHistory({
        action: 'sverka_resolved_web', source: 'web', actorId: null,
        actorName: actorName || null, details: { accountId, date },
      });
      this.log.log(`Web fix → bot xabari yangilandi: account=${accountId} date=${date}`);
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
  async resetNotifiedToday(actor?: { id: string | null; name: string | null }): Promise<{ ok: true; cleared: number }> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY },
    });
    let cleared = 0;
    if (setting?.value) {
      try {
        const parsed = JSON.parse(setting.value);
        cleared = Array.isArray(parsed?.keys)
          ? parsed.keys.length
          : (parsed?.accounts ? Object.keys(parsed.accounts).length : 0);
      } catch {}
    }
    await this.prisma.setting.upsert({
      where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY },
      create: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY, value: JSON.stringify({ date: '', keys: [] }), updatedBy: actor?.name || 'system' },
      update: { value: JSON.stringify({ date: '', keys: [] }), updatedBy: actor?.name || 'system' },
    });
    await this.appendHistory({
      action: 'notified_reset',
      source: 'web',
      actorId: actor?.id || null,
      actorName: actor?.name || null,
      details: { cleared },
    });
    return { ok: true, cleared };
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
