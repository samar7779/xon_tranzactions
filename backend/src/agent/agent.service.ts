import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../sync/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';

/**
 * AI Agent (1-bosqich: XATO to'lov kunlik digest).
 *
 * Kuniga BIR marta (sozlangan vaqtda) sozlangan Telegram guruhga BITTA xabar:
 * «N ta XATO to'lov» + inline tugma. Tugma bosilganda ОплатыКв sahifasi XATO
 * filtri bilan ochiladi — barcha XATO to'lovlar ko'rinadi, xodim hal qiladi.
 *
 * Boshqaruv (Admin > Agent): bot token, guruh ID, qaysi sanadan, kunlik vaqt.
 */
@Injectable()
export class AgentService {
  private readonly log = new Logger(AgentService.name);

  private readonly K_ENABLED = 'agent.enabled';
  private readonly K_TOKEN = 'agent.botToken';
  private readonly K_GROUP = 'agent.groupId';
  private readonly K_DATEFROM = 'agent.dateFrom';
  private readonly K_DAILY_TIME = 'agent.dailyTime';
  private readonly K_LAST_RESULT = 'agent.lastResult';

  // Kuniga 1 marta guard — qaysi Tashkent kuni jo'natildi
  private lastRunDay: number | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly oplataKv: OplataKvService,
    private readonly config: ConfigService,
  ) {}

  // ─── Sozlama ───────────────────────────────────────────────────────
  async getConfig() {
    const [enc, groupId, enabled, dateFrom, dailyTime, lastResult] = await Promise.all([
      this.settings.get(this.K_TOKEN),
      this.settings.get(this.K_GROUP),
      this.settings.get(this.K_ENABLED),
      this.settings.get(this.K_DATEFROM),
      this.settings.get(this.K_DAILY_TIME),
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
      dailyTime: this.validTime(dailyTime) || '09:00',
      lastResult: lastResult || null,
      pendingCount,
    };
  }

  async saveConfig(
    body: { botToken?: string; groupId?: string; enabled?: boolean; dateFrom?: string | null; dailyTime?: string },
    updatedBy?: string,
  ) {
    if (body.botToken !== undefined && body.botToken.trim()) {
      await this.settings.set(this.K_TOKEN, this.crypto.encrypt(body.botToken.trim()), updatedBy);
    }
    if (body.groupId !== undefined) await this.settings.set(this.K_GROUP, body.groupId.trim() || null, updatedBy);
    if (body.enabled !== undefined) await this.settings.set(this.K_ENABLED, body.enabled ? '1' : null, updatedBy);
    if (body.dateFrom !== undefined) await this.settings.set(this.K_DATEFROM, body.dateFrom || null, updatedBy);
    if (body.dailyTime !== undefined) await this.settings.set(this.K_DAILY_TIME, this.validTime(body.dailyTime), updatedBy);
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

  // ─── Cron — har daqiqa tekshiradi, kuniga 1 marta jo'natadi ────────
  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    try {
      const enabled = await this.settings.get(this.K_ENABLED);
      if (enabled !== '1') return;

      const dailyTime = this.validTime(await this.settings.get(this.K_DAILY_TIME)) || '09:00';
      const wantHm = dailyTime.length === 4 ? `0${dailyTime}` : dailyTime; // "9:00" → "09:00"

      const tash = new Date(Date.now() + 5 * 60 * 60 * 1000); // UTC+5
      const hm = `${String(tash.getUTCHours()).padStart(2, '0')}:${String(tash.getUTCMinutes()).padStart(2, '0')}`;
      if (hm !== wantHm) return;

      const day = tash.getUTCDate();
      if (this.lastRunDay === day) return; // shu kun jo'natilgan
      this.lastRunDay = day;

      const r = await this.runDigest();
      this.log.log(`Agent kunlik digest (${hm}): ${r.ok ? `${r.count} ta XATO` : `xato ${r.error}`}`);
    } catch (e: any) {
      this.log.warn(`Agent cron xato: ${e?.message}`);
    }
  }

  // ─── Kunlik digest jo'natish (cron yoki qo'lda) ────────────────────
  async runDigest(): Promise<{ ok: boolean; count?: number; error?: string }> {
    const { token, groupId } = await this.getRaw();
    if (!token || !groupId) return { ok: false, error: 'Bot token yoki guruh ID sozlanmagan' };

    const dateFrom = await this.settings.get(this.K_DATEFROM);
    const count = await this.oplataKv.countXatoForAgent(dateFrom || null);

    if (count === 0) {
      await this.saveResult('0 ta XATO — xabar jo\'natilmadi (hammasi joyida)');
      return { ok: true, count: 0 };
    }

    const button = {
      inline_keyboard: [[{ text: "📋 Barcha XATO to'lovlarni ko'rish", url: this.xatoLink() }]],
    };
    const sent = await this.sendMessage(token, groupId, this.formatDigest(count), button);
    if (!sent) return { ok: false, error: "Telegram jo'natilmadi (bot/guruh tekshiring)" };

    await this.saveResult(`${count} ta XATO — kunlik xabar jo'natildi`);
    this.log.log(`Agent digest jo'natildi: ${count} ta XATO`);
    return { ok: true, count };
  }

  // Qo'lda "Hozir ishga tushirish"
  async runOnce() {
    return this.runDigest();
  }

  private xatoLink(): string {
    const base = (this.config.get<string>('APP_URL') || 'https://transactions.xonapps.uz').replace(/\/+$/, '');
    return `${base}/uz/oplatykv?xatoOnly=1`;
  }

  private async saveResult(text: string) {
    try { await this.settings.set(this.K_LAST_RESULT, `${new Date().toISOString()} · ${text}`, 'agent'); }
    catch { /* skip */ }
  }

  // ─── Telegram xabar ────────────────────────────────────────────────
  private formatDigest(count: number): string {
    return (
      `⚠️ <b>XATO to'lovlar — ariza/shartnoma kerak</b>\n\n` +
      `📊 Jami: <b>${count} ta</b> CRM'da tasdiqlanmagan to'lov\n\n` +
      `👇 Ro'yxatni ko'rish va hal qilish uchun tugmani bosing.`
    );
  }

  private async sendMessage(token: string, chatId: string, text: string, replyMarkup?: any): Promise<boolean> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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
