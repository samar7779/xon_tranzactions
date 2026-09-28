import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeaderConfigService } from './leader-config.service';
import { LeaderTelegramApi, escapeHtml } from './leader-telegram.api';
import { LeaderOrchestratorService } from './leader-orchestrator.service';
import { LeaderMemoryService } from './leader-memory.service';
import { LeaderHealthService } from './leader-health.service';
import { CheckResult } from './leader.types';

/**
 * Leader Telegram boti — long-polling (namuna: sverka-telegram pollLoop).
 *
 * - Faqat egasi: from.id ∈ LEADER_OWNER_TG_IDS, chat.type === 'private', chat.id === from.id.
 *   Boshqa hamma — jim e'tiborsiz (javob ham yo'q).
 * - Offset Setting 'leader.pollOffset' da (restartda eski xabarlar qayta ishlanmaydi). Oxirgi update'dan
 *   6 kundan ko'p o'tsa offset 0 dan boshlanadi: Telegram bir haftalik jimlikdan keyin update_id'ni
 *   tasodifiy tanlaydi va u eski offset'dan kichik bo'lsa, bot "kar" bo'lib qoladi.
 * - Boot'da 120 s dan eski xabarlar javobsiz tashlanadi.
 * - ok:false / HTTP xato (409 ham) -> 5 s kutish; 401 -> 60 s (token xato).
 * - Bir chatda bir vaqtda bitta so'rov (promise navbati), ishlash paytida har 4 s "typing".
 */
@Injectable()
export class LeaderBotService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(LeaderBotService.name);

  private static readonly KEY_OFFSET = 'leader.pollOffset';
  /** Setting'ga yozish faqat shu texnik kalitga (biznes sozlamalariga tegilmaydi). */
  private static readonly WRITABLE_SETTINGS = new Set<string>(['leader.pollOffset']);
  /** Telegram: 7 kun update bo'lmasa keyingi update_id tasodifiy — 6 kundan keyin offset eskirgan. */
  private static readonly OFFSET_TTL_MS = 6 * 24 * 60 * 60 * 1000;
  private static readonly STALE_MS = 120_000;
  private static readonly MAX_PENDING_PER_CHAT = 5;
  private static readonly TYPING_EVERY_MS = 4000;

  private stopped = false;
  private running = false;
  private initialized = false;
  private offset = 0;
  private savedOffset = 0;
  /** Oxirgi update kelgan (yoki offset saqlangan) vaqt — offset eskirishini aniqlash uchun. */
  private lastUpdateAt = Date.now();
  private readonly bootAt = Date.now();
  private abort: AbortController | null = null;
  private lastErrLogAt = 0;

  private queues = new Map<string, Promise<void>>();
  private pending = new Map<string, number>();

  constructor(
    private readonly config: LeaderConfigService,
    private readonly api: LeaderTelegramApi,
    private readonly orchestrator: LeaderOrchestratorService,
    private readonly memory: LeaderMemoryService,
    private readonly health: LeaderHealthService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (this.running) return;
    this.running = true;
    // Fire-and-forget — onModuleInit'ni bloklamaydi
    void this.pollLoop()
      .catch((e) => this.log.warn(`Leader poll loop tugadi: ${e?.message}`))
      .finally(() => {
        this.running = false;
      });
  }

  onModuleDestroy() {
    this.stopped = true;
    try {
      this.abort?.abort();
    } catch {
      /* ignore */
    }
  }

  // ─── Long-polling ────────────────────────────────────────────────────
  private async pollLoop() {
    while (!this.stopped) {
      if (!this.config.enabled()) {
        // Token/egasi yo'q yoki LEADER_ENABLED=0 — jim uxlaymiz
        await this.sleep(30_000);
        continue;
      }
      const token = this.config.botToken();

      if (!this.initialized) {
        await this.init();
        this.initialized = true;
        this.log.log('Leader Telegram long-polling boshlandi');
      }

      // Uzoq jimlikdan keyin eski offset yangi (tasodifiy, kichik) update_id'larni yutib yubormasin
      if (this.offset > 0 && Date.now() - this.lastUpdateAt > LeaderBotService.OFFSET_TTL_MS) {
        this.log.log("pollOffset eskirgan (6 kundan ko'p update yo'q) — 0 dan boshlanadi");
        this.offset = 0;
      }

      let data: any;
      try {
        this.abort = new AbortController();
        const res = await axios.post(
          `https://api.telegram.org/bot${token}/getUpdates`,
          { offset: this.offset || undefined, timeout: 30, allowed_updates: ['message'] },
          { timeout: 40_000, signal: this.abort.signal, validateStatus: () => true },
        );
        data = res.data && typeof res.data === 'object' ? res.data : { ok: false, error_code: res.status, description: `HTTP ${res.status}` };
      } catch (e: any) {
        if (this.stopped) break;
        data = { ok: false, error_code: 0, description: String(e?.code || e?.message || 'tarmoq xatosi') };
      } finally {
        this.abort = null;
      }

      if (!data?.ok) {
        const code = Number(data?.error_code || 0);
        const desc = String(data?.description || '').slice(0, 200);
        if (code === 401 || code === 404) {
          this.logThrottled(`getUpdates ${code}: ${desc} — LEADER_BOT_TOKEN noto'g'ri, 60 s kutiladi`);
          await this.sleep(60_000);
        } else {
          // 409 (boshqa instance poll qilyapti / webhook), tarmoq va h.k. — tinimsiz so'rov YO'Q
          this.logThrottled(`getUpdates ${code || 'tarmoq'}: ${desc}`);
          await this.sleep(5000);
        }
        continue;
      }

      const updates: any[] = Array.isArray(data.result) ? data.result : [];
      if (updates.length) this.lastUpdateAt = Date.now();
      for (const u of updates) {
        if (typeof u?.update_id === 'number' && u.update_id + 1 > this.offset) this.offset = u.update_id + 1;
        try {
          this.dispatch(u);
        } catch (e: any) {
          this.log.warn(`Update xato: ${e?.message}`);
        }
      }
      if (this.offset !== this.savedOffset) await this.saveOffset();
    }
    this.log.log('Leader Telegram long-polling to\'xtadi');
  }

  private async init() {
    // getUpdates va webhook bir vaqtda ishlamaydi
    await this.api.call('deleteWebhook', { drop_pending_updates: false }, 10_000);
    await this.api.call(
      'setMyCommands',
      {
        commands: [
          { command: 'status', description: 'Bugungi ish, tokenlar va limit' },
          { command: 'health', description: 'Tizim tekshiruvi (bank, sync, sverka, disk)' },
          { command: 'reset', description: 'Suhbat tarixini tozalash' },
          { command: 'xotira', description: "Doimiy xotira ro'yxati, o'chirish: /xotira ochir <id>" },
        ],
      },
      10_000,
    );
    try {
      const row = await this.prisma.setting.findUnique({ where: { key: LeaderBotService.KEY_OFFSET } });
      const n = Number(row?.value);
      // updatedAt = offset oxirgi marta surilgan (update kelgan) vaqt
      const at = row?.updatedAt ? new Date(row.updatedAt).getTime() : 0;
      if (Number.isFinite(n) && n > 0) {
        if (at && Date.now() - at > LeaderBotService.OFFSET_TTL_MS) {
          this.log.log("Saqlangan pollOffset eskirgan (6 kundan ko'p) — 0 dan boshlanadi");
        } else {
          this.offset = Math.floor(n);
          this.savedOffset = this.offset;
          if (at) this.lastUpdateAt = at;
        }
      }
    } catch (e: any) {
      this.log.warn(`pollOffset o'qilmadi: ${e?.message}`);
    }
  }

  private async saveOffset() {
    try {
      await this.writeSetting(LeaderBotService.KEY_OFFSET, String(this.offset));
      this.savedOffset = this.offset;
    } catch (e: any) {
      this.log.warn(`pollOffset saqlanmadi: ${e?.message}`);
    }
  }

  /** Setting'ga yozish — faqat oq ro'yxatdagi texnik kalit (agent.aiKey, sync.* kabi biznes sozlamalari himoyalangan). */
  private async writeSetting(key: string, value: string): Promise<void> {
    if (!LeaderBotService.WRITABLE_SETTINGS.has(key)) {
      throw new Error(`Setting kaliti yozish uchun ruxsat etilmagan: ${key}`);
    }
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value, updatedBy: 'leader' },
      update: { value, updatedBy: 'leader' },
    });
  }

  // ─── Update -> navbat ────────────────────────────────────────────────
  private dispatch(u: any) {
    const msg = u?.message;
    if (!msg) return;
    const from = msg.from;
    const chat = msg.chat;
    if (!from || !chat || from.is_bot) return;

    // Faqat egasi, faqat shaxsiy chat — boshqalar jim e'tiborsiz
    const fromId = String(from.id);
    if (chat.type !== 'private' || String(chat.id) !== fromId || !this.config.ownerIds().includes(fromId)) return;

    // Boot paytida to'plangan eski xabarlar javobsiz tashlanadi (offset baribir suriladi)
    const msgAt = Number(msg.date || 0) * 1000;
    if (msgAt && msgAt < this.bootAt && Date.now() - msgAt > LeaderBotService.STALE_MS) {
      this.log.log(`Eski xabar tashlandi (update ${u.update_id})`);
      return;
    }

    const chatId = String(chat.id);
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';

    if (!text) {
      void this.api.sendHtml(chatId, 'Shefim, hozircha faqat matn o\'qiyman.');
      return;
    }

    const cmd = this.parseCommand(text);
    if (cmd === 'start') {
      void this.api.sendHtml(chatId, this.startText());
      return;
    }
    if (cmd === 'status') {
      void this.safeReply(chatId, () => this.orchestrator.statusText());
      return;
    }
    if (cmd === 'health') {
      void this.safeReply(chatId, () => this.healthText(), true);
      return;
    }
    if (cmd === 'reset') {
      this.enqueue(chatId, async () => {
        await this.memory.reset(chatId);
        await this.api.sendHtml(chatId, 'Suhbat tarixi tozalandi, shefim. Doimiy xotira saqlanib qoldi.');
      });
      return;
    }
    if (cmd === 'xotira') {
      this.enqueue(chatId, async () => {
        await this.api.sendHtml(chatId, await this.memoryCommand(text));
      });
      return;
    }
    if (cmd) {
      void this.api.sendHtml(chatId, "Shefim, bunday buyruq yo'q. Mavjudlari: /status, /health, /reset, /xotira.");
      return;
    }

    const replyToText = String(msg.reply_to_message?.text || msg.reply_to_message?.caption || '').trim() || undefined;
    const forwarded = !!(msg.forward_origin || msg.forward_from || msg.forward_from_chat || msg.forward_sender_name || msg.forward_date);

    this.enqueue(chatId, async () => {
      const html = await this.withTyping(chatId, () =>
        this.orchestrator.handleOwnerMessage(chatId, text, { replyToText, forwarded }),
      );
      await this.api.sendHtml(chatId, html);
    });
  }

  /** Bir chatda bitta so'rov: yangi xabar oldingisi tugagach ishlaydi. */
  private enqueue(chatId: string, job: () => Promise<void>) {
    const n = this.pending.get(chatId) || 0;
    if (n >= LeaderBotService.MAX_PENDING_PER_CHAT) {
      void this.api.sendHtml(chatId, "Shefim, oldingi savollar hali navbatda. Biroz kutib yozing.");
      return;
    }
    this.pending.set(chatId, n + 1);
    const prev = this.queues.get(chatId) || Promise.resolve();
    const next: Promise<void> = prev
      .then(() => job())
      .catch(async (e: any) => {
        this.log.warn(`Leader so'rov xato: ${e?.message}`);
        await this.api
          .sendHtml(chatId, `Shefim, ichki xato yuz berdi: <code>${escapeHtml(String(e?.message || e).slice(0, 200))}</code>`)
          .catch(() => undefined);
      })
      .finally(() => {
        const left = (this.pending.get(chatId) || 1) - 1;
        if (left <= 0) this.pending.delete(chatId);
        else this.pending.set(chatId, left);
        if (this.queues.get(chatId) === next) this.queues.delete(chatId);
      });
    this.queues.set(chatId, next);
  }

  /** Ish davomida har 4 s "typing". */
  private async withTyping<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    void this.api.typing(chatId);
    const timer = setInterval(() => void this.api.typing(chatId), LeaderBotService.TYPING_EVERY_MS);
    try {
      return await fn();
    } finally {
      clearInterval(timer);
    }
  }

  private async safeReply(chatId: string, fn: () => Promise<string>, typing = false) {
    try {
      const html = typing ? await this.withTyping(chatId, fn) : await fn();
      await this.api.sendHtml(chatId, html);
    } catch (e: any) {
      this.log.warn(`Buyruq xato: ${e?.message}`);
      await this.api
        .sendHtml(chatId, `Shefim, ichki xato yuz berdi: <code>${escapeHtml(String(e?.message || e).slice(0, 200))}</code>`)
        .catch(() => undefined);
    }
  }

  /** '/status' yoki '/status@BotName' -> 'status'; buyruq bo'lmasa null. */
  private parseCommand(text: string): string | null {
    const m = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s|$)/.exec(text);
    return m ? m[1].toLowerCase() : null;
  }

  private startText(): string {
    return [
      '<b>Assalomu alaykum, shefim.</b>',
      "Men tranzaksiya tizimi bo'yicha Leader yordamchingizman. Bank tushumlari, hisob qoldiqlari, sync, sverka, " +
        "xatolar va kod haqida so'rang: faktlar bilan javob beraman. Hech narsani o'zgartirmayman, faqat ko'raman va tahlil qilaman.",
      '',
      "Eslab qolishim uchun: <code>eslab qol: ...</code>",
      'Buyruqlar: /status, /health, /reset, /xotira',
    ].join('\n');
  }

  /**
   * /xotira — faol doimiy xotira (manbasi bilan); /xotira ochir <id> — yozuvni nofaol qilish.
   * LLM'siz: xotiraga begona matn tushgan bo'lsa, shefim uni o'zi ko'rib o'chira oladi.
   */
  private async memoryCommand(text: string): Promise<string> {
    const args = text.replace(/^\/xotira(?:@\w+)?/i, '').trim();
    const m = /^(o['‘’`]?chir|ochir|del|off)\s+(\S+)$/i.exec(args);
    if (m) {
      const r = await this.memory.deactivate(m[2]);
      return r.ok
        ? `Xotiradan olindi: <i>${escapeHtml(String(r.text || '').slice(0, 200))}</i>`
        : `Shefim, o'chirilmadi: ${escapeHtml(r.error || "noma'lum sabab")}.`;
    }
    if (args) return "Shefim, buyruq: <code>/xotira</code> yoki <code>/xotira ochir id</code>.";

    const rows = await this.memory.listActive(30);
    if (!rows.length) return "Shefim, doimiy xotira bo'sh.";
    const label: Record<string, string> = { owner: 'shefim', leader: 'Leader orqali', teacher_daily: 'Teacher' };
    const lines = [`<b>Doimiy xotira</b> (${rows.length} ta, eng yangisi birinchi)`];
    for (const r of rows) {
      lines.push(
        `<code>${escapeHtml(r.id.slice(-8))}</code> [${escapeHtml(r.kind)}, ${escapeHtml(label[r.source] || r.source)}] ` +
          escapeHtml(String(r.text).slice(0, 160)),
      );
    }
    lines.push('', "O'chirish: <code>/xotira ochir id</code>");
    return lines.join('\n');
  }

  /** /health — LLM'siz, deterministik format. */
  private async healthText(): Promise<string> {
    const results: CheckResult[] = await this.health.runAll();
    if (!Array.isArray(results) || !results.length) return "Shefim, tekshiruv natijasi bo'sh.";
    const order: Record<string, number> = { critical: 0, warn: 1, unknown: 2, ok: 3 };
    const label: Record<string, string> = { critical: 'KRITIK', warn: 'DIQQAT', unknown: "NOMA'LUM", ok: 'OK' };
    const sorted = [...results].sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
    const counts = { critical: 0, warn: 0, unknown: 0, ok: 0 } as Record<string, number>;
    for (const r of results) counts[r.level] = (counts[r.level] || 0) + 1;

    const lines = [
      '<b>Tizim holati</b>',
      `Kritik: ${counts.critical}, diqqat: ${counts.warn}, noma'lum: ${counts.unknown}, ok: ${counts.ok}`,
      '',
    ];
    for (const r of sorted) {
      lines.push(`<b>[${label[r.level] || escapeHtml(r.level)}]</b> ${escapeHtml(r.title)}: ${escapeHtml(r.summary)}`);
      if (r.level !== 'ok' && Array.isArray(r.details)) {
        for (const d of r.details.slice(0, 3)) lines.push(`  - ${escapeHtml(String(d).slice(0, 200))}`);
      }
    }
    return lines.join('\n');
  }

  private logThrottled(msg: string) {
    const now = Date.now();
    if (now - this.lastErrLogAt < 5 * 60_000) return;
    this.lastErrLogAt = now;
    this.log.warn(msg);
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
