import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../common/prisma/prisma.service';

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
export class SverkaTelegramService {
  private readonly log = new Logger(SverkaTelegramService.name);

  // Setting keys
  private static readonly KEY_BOT_TOKEN = 'sverka.telegram.botToken';
  private static readonly KEY_CHATS     = 'sverka.telegram.chats';
  private static readonly KEY_HISTORY   = 'sverka.telegram.history';
  private static readonly KEY_PASSWORD  = 'sverka.telegram.password';
  private static readonly KEY_NOTIFIED_TODAY = 'sverka.telegram.notifiedToday';

  private static readonly HISTORY_LIMIT = 500;
  private static readonly DEFAULT_PASSWORD = '7779';

  constructor(private prisma: PrismaService) {}

  // ─── BOT TOKEN ────────────────────────────────────────────
  async getBotToken(): Promise<string> {
    const s = await this.prisma.setting.findUnique({
      where: { key: SverkaTelegramService.KEY_BOT_TOKEN },
    });
    return s?.value || DEFAULT_BOT_TOKEN;
  }

  async setBotToken(token: string, actor?: { name: string | null }): Promise<{ ok: true }> {
    await this.prisma.setting.upsert({
      where: { key: SverkaTelegramService.KEY_BOT_TOKEN },
      create: { key: SverkaTelegramService.KEY_BOT_TOKEN, value: token, updatedBy: actor?.name || 'system' },
      update: { value: token, updatedBy: actor?.name || 'system' },
    });
    return { ok: true };
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
  }): Promise<{ ok: boolean; sent: number; failed: number; errors: string[] }> {
    const chats = await this.getChats();
    if (chats.length === 0) {
      return { ok: true, sent: 0, failed: 0, errors: ['No chats configured'] };
    }
    const filtered = opts.role && opts.role !== 'all'
      ? chats.filter((c) => c.role === opts.role)
      : chats;

    const token = await this.getBotToken();
    if (!token) {
      return { ok: false, sent: 0, failed: filtered.length, errors: ['No bot token'] };
    }

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    await Promise.all(filtered.map(async (chat) => {
      try {
        await axios.post(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            chat_id: chat.chatId,
            text: opts.text,
            parse_mode: 'HTML',
            disable_notification: !!opts.silent,
          },
          { timeout: 10_000 },
        );
        sent++;
      } catch (e: any) {
        failed++;
        const msg = e?.response?.data?.description || e?.message || 'Unknown error';
        errors.push(`${chat.chatId}: ${msg}`);
        this.log.warn(`Telegram send xato ${chat.chatId}: ${msg}`);
      }
    }));

    return { ok: failed === 0, sent, failed, errors };
  }

  /** Test notification — admin UI'dan chaqiriladi. */
  async sendTestNotification(actor?: { name: string | null }): Promise<{ ok: boolean; sent: number; failed: number; errors: string[] }> {
    const text = `🧪 <b>Test xabarnomasi</b>\n\nSverka bot to'g'ri ishlayapti.\n\n<i>Yuborgan: ${actor?.name || 'admin'}</i>\n<i>Vaqt: ${new Date().toLocaleString('ru-RU')}</i>`;
    const result = await this.sendNotification({ text, role: 'all' });
    await this.appendHistory({
      action: 'test_notification',
      source: 'web',
      actorId: null,
      actorName: actor?.name || null,
      details: { sent: result.sent, failed: result.failed },
    });
    return result;
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
      bank?: { credit?: number; debit?: number };
    }>,
    date: string,
  ): Promise<void> {
    try {
      const mismatches = (items || []).filter(
        (it) => it.status === 'mismatch' && !it.ok,
      );
      if (mismatches.length === 0) return;

      // Bugungi notified set'ni o'qish
      const setting = await this.prisma.setting.findUnique({
        where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY },
      });
      let stored: { date: string; keys: string[] } | null = null;
      if (setting?.value) {
        try { stored = JSON.parse(setting.value); } catch { stored = null; }
      }
      const notifiedKeys = new Set<string>(
        stored && stored.date === date ? stored.keys : [],
      );

      const newOnes: typeof mismatches = [];
      for (const it of mismatches) {
        if (!notifiedKeys.has(it.accountId)) {
          newOnes.push(it);
          notifiedKeys.add(it.accountId);
        }
      }
      if (newOnes.length === 0) return;

      // Notification yuborish (har biri uchun alohida)
      for (const it of newOnes) {
        const farqAmount =
          Math.abs(Number(it.diff?.formula) || 0) ||
          Math.abs(Number(it.diff?.credit) || 0) ||
          Math.abs(Number(it.diff?.debit) || 0);

        const lines: string[] = [];
        lines.push(`⚠️ <b>Sverka farq aniqlandi</b>`);
        lines.push('');
        if (it.bankName) lines.push(`<b>Bank:</b> ${it.bankName}`);
        if (it.accountNo) lines.push(`<b>Hisob:</b> <code>${it.accountNo}</code>`);
        if (it.ownerName) lines.push(`<b>Egasi:</b> ${it.ownerName}`);
        lines.push(`<b>Sana:</b> ${date}`);
        if (farqAmount > 0) {
          lines.push(`<b>Farq:</b> <code>${farqAmount.toLocaleString('ru-RU')}</code> UZS`);
        }
        lines.push('');
        lines.push(`<i>Tekshiring va kerakli amalni bajaring.</i>`);

        this.sendNotification({ text: lines.join('\n'), role: 'all' }).catch((e) => {
          this.log.warn(`Mismatch notification yuborish xato: ${e?.message}`);
        });
      }

      // History'ga yozish — bitta umumiy yozuv (har biriga alohida emas — spam emas)
      await this.appendHistory({
        action: 'mismatch_detected',
        source: 'web',
        actorId: null,
        actorName: 'system',
        details: {
          date,
          new: newOnes.length,
          total: mismatches.length,
        },
      });

      // Yangi notified set'ni saqlash
      await this.prisma.setting.upsert({
        where: { key: SverkaTelegramService.KEY_NOTIFIED_TODAY },
        create: {
          key: SverkaTelegramService.KEY_NOTIFIED_TODAY,
          value: JSON.stringify({ date, keys: [...notifiedKeys] }),
          updatedBy: 'system',
        },
        update: {
          value: JSON.stringify({ date, keys: [...notifiedKeys] }),
          updatedBy: 'system',
        },
      });

      this.log.log(
        `Mismatch notification: ${newOnes.length} yangi (jami ${mismatches.length} mismatch, sana ${date})`,
      );
    } catch (e: any) {
      this.log.warn(`notifyNewMismatches xato: ${e?.message}`);
    }
  }

  /**
   * Sverka actions uchun notification — backend chaqiradi action bajarilganda.
   * Misol: fix-tx-date, fix-all-missing va h.k.
   */
  async notifySverkaAction(p: {
    action: string;                 // 'fix-tx-date' | 'fix-all-missing' | h.k.
    label: string;                  // foydalanuvchi tushuna oladigan nom
    accountInfo?: string;           // Hisob nomi yoki raqami
    count?: number;                 // tuzatilgan soni
    actorName: string;              // kim
    extra?: Record<string, any>;    // qo'shimcha ma'lumotlar
  }): Promise<void> {
    const lines: string[] = [];
    lines.push(`⚙️ <b>Sverka amal bajarildi</b>`);
    lines.push('');
    lines.push(`<b>Amal:</b> ${p.label}`);
    if (p.accountInfo) lines.push(`<b>Hisob:</b> ${p.accountInfo}`);
    if (p.count != null) lines.push(`<b>Miqdor:</b> ${p.count}`);
    lines.push(`<b>Bajardi:</b> ${p.actorName}`);
    lines.push(`<b>Vaqt:</b> ${new Date().toLocaleString('ru-RU')}`);

    if (p.extra) {
      lines.push('');
      lines.push('<i>Tafsilot:</i>');
      for (const [k, v] of Object.entries(p.extra)) {
        lines.push(`  • ${k}: <code>${String(v)}</code>`);
      }
    }

    const text = lines.join('\n');

    // Avval history'ga yozamiz
    await this.appendHistory({
      action: p.action,
      source: 'web',
      actorId: null,
      actorName: p.actorName,
      details: { accountInfo: p.accountInfo, count: p.count, ...p.extra },
    });

    // Keyin notification yuboramiz (xato bo'lsa ham asosiy oqim tushmaydi)
    this.sendNotification({ text, role: 'all' }).catch((e) => {
      this.log.warn(`notifySverkaAction yuborish xato: ${e?.message}`);
    });
  }
}
