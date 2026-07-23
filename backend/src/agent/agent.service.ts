import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SettingsService } from '../sync/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';

/**
 * AI Agent (1-vazifa: XATO to'lov notifikatori).
 *
 * CRM'da tasdiqlanmagan (XATO) to'lovlarni topib, sozlangan Telegram guruhga
 * tashlaydi — xodim ariza/shartnomani hal qilishi uchun. Takror jo'natmaslik
 * uchun har qator agentNotifiedAt bilan belgilanadi.
 *
 * Boshqaruv (Admin > Agent): bot token, guruh ID, qaysi sanadan, interval (daqiqa),
 * ish soatlari (HH:MM–HH:MM), bir martada nechta.
 */
@Injectable()
export class AgentService {
  private readonly log = new Logger(AgentService.name);

  // Settings kalitlari
  private readonly K_ENABLED = 'agent.enabled';
  private readonly K_TOKEN = 'agent.botToken';
  private readonly K_GROUP = 'agent.groupId';
  private readonly K_DATEFROM = 'agent.dateFrom';
  private readonly K_INTERVAL = 'agent.intervalMin';
  private readonly K_WORK_START = 'agent.workStart';
  private readonly K_WORK_END = 'agent.workEnd';
  private readonly K_MAX = 'agent.maxPerRun';
  private readonly K_LAST_RUN = 'agent.lastRunAt';
  private readonly K_LAST_RESULT = 'agent.lastResult';

  constructor(
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly oplataKv: OplataKvService,
  ) {}

  // ─── Sozlama ───────────────────────────────────────────────────────
  async getConfig() {
    const [enc, groupId, enabled, dateFrom, interval, wStart, wEnd, maxPerRun, lastRunAt, lastResult] =
      await Promise.all([
        this.settings.get(this.K_TOKEN),
        this.settings.get(this.K_GROUP),
        this.settings.get(this.K_ENABLED),
        this.settings.get(this.K_DATEFROM),
        this.settings.get(this.K_INTERVAL),
        this.settings.get(this.K_WORK_START),
        this.settings.get(this.K_WORK_END),
        this.settings.get(this.K_MAX),
        this.settings.get(this.K_LAST_RUN),
        this.settings.get(this.K_LAST_RESULT),
      ]);
    let hasToken = false;
    let tokenHint: string | null = null;
    if (enc) {
      try { const t = this.crypto.decrypt(enc); hasToken = !!t; tokenHint = t ? `…${t.slice(-4)}` : null; }
      catch { /* skip */ }
    }
    const pendingCount = await this.oplataKv.countXatoForAgent(dateFrom || null);
    return {
      ok: true,
      enabled: enabled === '1',
      hasToken,
      tokenHint,
      groupId: groupId || null,
      dateFrom: dateFrom || null,
      intervalMin: Number(interval) > 0 ? Number(interval) : 15,
      workStart: this.validTime(wStart) || '09:00',
      workEnd: this.validTime(wEnd) || '18:00',
      maxPerRun: Number(maxPerRun) > 0 ? Number(maxPerRun) : 10,
      lastRunAt: lastRunAt || null,
      lastResult: lastResult || null,
      pendingCount,
    };
  }

  async saveConfig(
    body: {
      botToken?: string; groupId?: string; enabled?: boolean; dateFrom?: string | null;
      intervalMin?: number; workStart?: string; workEnd?: string; maxPerRun?: number;
    },
    updatedBy?: string,
  ) {
    if (body.botToken !== undefined && body.botToken.trim()) {
      await this.settings.set(this.K_TOKEN, this.crypto.encrypt(body.botToken.trim()), updatedBy);
    }
    if (body.groupId !== undefined) await this.settings.set(this.K_GROUP, body.groupId.trim() || null, updatedBy);
    if (body.enabled !== undefined) await this.settings.set(this.K_ENABLED, body.enabled ? '1' : null, updatedBy);
    if (body.dateFrom !== undefined) await this.settings.set(this.K_DATEFROM, body.dateFrom || null, updatedBy);
    if (body.intervalMin !== undefined) {
      await this.settings.set(this.K_INTERVAL, String(Math.max(1, Math.min(1440, Math.floor(body.intervalMin || 15)))), updatedBy);
    }
    if (body.workStart !== undefined) await this.settings.set(this.K_WORK_START, this.validTime(body.workStart), updatedBy);
    if (body.workEnd !== undefined) await this.settings.set(this.K_WORK_END, this.validTime(body.workEnd), updatedBy);
    if (body.maxPerRun !== undefined) {
      await this.settings.set(this.K_MAX, String(Math.max(1, Math.min(50, Math.floor(body.maxPerRun || 10)))), updatedBy);
    }
    return this.getConfig();
  }

  private validTime(s?: string | null): string | null {
    if (!s) return null;
    return /^\d{1,2}:\d{2}$/.test(s) ? s : null;
  }

  private async getRaw(): Promise<{ token: string | null; groupId: string | null }> {
    const [enc, groupId] = await Promise.all([
      this.settings.get(this.K_TOKEN),
      this.settings.get(this.K_GROUP),
    ]);
    let token: string | null = null;
    if (enc) { try { token = this.crypto.decrypt(enc); } catch { /* skip */ } }
    return { token, groupId };
  }

  // ─── Cron — har daqiqa tekshiradi ──────────────────────────────────
  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    try {
      const enabled = await this.settings.get(this.K_ENABLED);
      if (enabled !== '1') return;

      // Ish soatlari (Toshkent, UTC+5)
      const tash = new Date(Date.now() + 5 * 60 * 60 * 1000);
      const nowMin = tash.getUTCHours() * 60 + tash.getUTCMinutes();
      const wStart = this.toMin(this.validTime(await this.settings.get(this.K_WORK_START)) || '09:00');
      const wEnd = this.toMin(this.validTime(await this.settings.get(this.K_WORK_END)) || '18:00');
      if (!(nowMin >= wStart && nowMin < wEnd)) return;

      // Interval
      const intervalMin = Number(await this.settings.get(this.K_INTERVAL)) || 15;
      const lastRunStr = await this.settings.get(this.K_LAST_RUN);
      if (lastRunStr) {
        const elapsed = (Date.now() - new Date(lastRunStr).getTime()) / 60000;
        if (elapsed < intervalMin) return;
      }
      await this.settings.set(this.K_LAST_RUN, new Date().toISOString(), 'agent-cron');
      const r = await this.runOnce();
      this.log.log(`Agent cron: posted=${r.posted ?? 0}${r.error ? ` xato=${r.error}` : ''}`);
    } catch (e: any) {
      this.log.warn(`Agent cron xato: ${e?.message}`);
    }
  }

  private toMin(hm: string): number {
    const [h, m] = hm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  // ─── Bitta ishga tushirish (cron yoki qo'lda) ──────────────────────
  async runOnce(opts?: { limit?: number }): Promise<{ ok: boolean; posted?: number; error?: string; pending?: number }> {
    const startedAt = Date.now();
    const { token, groupId } = await this.getRaw();
    if (!token || !groupId) {
      return { ok: false, error: "Bot token yoki guruh ID sozlanmagan" };
    }
    const dateFrom = await this.settings.get(this.K_DATEFROM);
    const maxPerRun = opts?.limit || Number(await this.settings.get(this.K_MAX)) || 10;

    const rows = await this.oplataKv.getXatoForAgent({ dateFrom: dateFrom || null, limit: maxPerRun });
    if (rows.length === 0) {
      await this.saveResult(`0 ta jo'natildi (kutayotgan yo'q)`);
      return { ok: true, posted: 0 };
    }

    let posted = 0;
    const postedIds: string[] = [];
    for (const r of rows) {
      const sent = await this.sendMessage(token, groupId, this.formatMessage(r));
      if (sent) { posted++; postedIds.push(r.id); }
      else break; // Telegram xato — to'xtaymiz, belgilamaymiz (keyingi safar qayta urinadi)
    }
    if (postedIds.length) await this.oplataKv.markAgentNotified(postedIds);

    const dur = Math.round((Date.now() - startedAt) / 1000);
    await this.saveResult(`${posted} ta XATO to'lov jo'natildi (${dur}s)`);
    this.log.log(`Agent runOnce: ${posted}/${rows.length} jo'natildi`);
    return { ok: true, posted };
  }

  private async saveResult(text: string) {
    try { await this.settings.set(this.K_LAST_RESULT, `${new Date().toISOString()} · ${text}`, 'agent'); }
    catch { /* skip */ }
  }

  // ─── Telegram xabar ────────────────────────────────────────────────
  private esc(s: any): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  private fmtDate(d: any): string {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return `${String(dt.getUTCDate()).padStart(2, '0')}.${String(dt.getUTCMonth() + 1).padStart(2, '0')}.${dt.getUTCFullYear()}`;
  }
  private fmtMoney(v: any): string {
    if (v == null) return '—';
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('ru-RU');
  }

  private formatMessage(r: any): string {
    return (
      `⚠️ <b>XATO to'lov — ariza/shartnoma kerak</b>\n` +
      `📅 Sana: <b>${this.fmtDate(r.date)}</b>\n` +
      `💰 Summa: <b>${this.fmtMoney(r.paymentAmount)}</b>\n` +
      `📄 Shartnoma: <code>${this.esc(r.contractNo)}</code> (CRM'da tasdiqlanmagan)\n` +
      (r.client ? `👤 Klient: ${this.esc(r.client)}\n` : '') +
      (r.object ? `🏠 Obyekt: ${this.esc(r.object)}\n` : '') +
      (r.purpose ? `📝 Izoh: ${this.esc(String(r.purpose).slice(0, 200))}\n` : '') +
      `🆔 <code>${this.esc(r.id)}</code>`
    );
  }

  private async sendMessage(token: string, chatId: string, text: string): Promise<boolean> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!data?.ok) {
        this.log.warn(`Telegram xato: ${data?.description || `HTTP ${res.status}`}`);
        return false;
      }
      return true;
    } catch (e: any) {
      this.log.warn(`Telegram send xato: ${e?.message}`);
      return false;
    }
  }
}
