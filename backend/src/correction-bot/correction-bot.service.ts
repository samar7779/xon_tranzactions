import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../sync/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';

/**
 * Tuzatish (correction) Telegram bot — SOZLAMA qismi.
 *
 * Bot foydalanuvchi bilan AI AGENT (Claude) orqali TABIIY suhbatlashadi (robot
 * javoblar emas): XATO to'lovlar ro'yxati, to'lov ma'lumoti, CRM'dan shartnoma
 * qidirish, biriktirish, guruhga "tuzatildi" xabari. Bu yerda faqat konfiguratsiya:
 * bot token, guruh ID, kimlar ishlata olishi (whitelist — chat ID + ism).
 *
 * Suhbat oqimi (long-polling + agent tool'lari) keyingi bosqichda qo'shiladi.
 */
@Injectable()
export class CorrectionBotService {
  private readonly log = new Logger(CorrectionBotService.name);

  private readonly K_TOKEN = 'corrbot.botToken';
  private readonly K_GROUP = 'corrbot.groupId';
  private readonly K_ENABLED = 'corrbot.enabled';
  private readonly K_WHITELIST = 'corrbot.whitelist';

  constructor(
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
  ) {}

  /** Ruxsat berilgan foydalanuvchilar (chat ID + ism = "kim bajardi"). */
  async getWhitelist(): Promise<Array<{ id: string; name: string }>> {
    const raw = await this.settings.get(this.K_WHITELIST);
    if (!raw) return [];
    try {
      const a = JSON.parse(raw);
      return Array.isArray(a) ? a.map((x: any) => ({ id: String(x.id ?? ''), name: String(x.name ?? '') })) : [];
    } catch {
      return [];
    }
  }

  private async setWhitelist(list: Array<{ id: string; name: string }>, by?: string): Promise<void> {
    const clean = (list || [])
      .map((x) => ({ id: String(x.id || '').trim(), name: String(x.name || '').trim().slice(0, 80) }))
      .filter((x) => x.id);
    await this.settings.set(this.K_WHITELIST, clean.length ? JSON.stringify(clean) : null, by);
  }

  /** Ochiq (decrypted) bot token — bot xizmati uchun. */
  async getToken(): Promise<string | null> {
    const enc = await this.settings.get(this.K_TOKEN);
    if (enc) { try { return this.crypto.decrypt(enc); } catch { /* skip */ } }
    return null;
  }

  async getGroupId(): Promise<string | null> {
    return (await this.settings.get(this.K_GROUP)) || null;
  }

  async isEnabled(): Promise<boolean> {
    return (await this.settings.get(this.K_ENABLED)) === '1';
  }

  /** Chat ID whitelist'da bormi (begonalarni to'sish). Bo'sh whitelist = hech kim. */
  async isAllowed(chatId: string | number): Promise<{ ok: boolean; name?: string }> {
    const id = String(chatId);
    const wl = await this.getWhitelist();
    const hit = wl.find((x) => x.id === id);
    return hit ? { ok: true, name: hit.name || id } : { ok: false };
  }

  async getMe(token: string): Promise<{ username?: string; first_name?: string } | null> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const d: any = await res.json();
      return d?.ok ? d.result : null;
    } catch {
      return null;
    }
  }

  async getConfig() {
    const [enc, groupId, enabled] = await Promise.all([
      this.settings.get(this.K_TOKEN),
      this.settings.get(this.K_GROUP),
      this.settings.get(this.K_ENABLED),
    ]);
    let hasToken = false;
    let tokenHint: string | null = null;
    let botUsername: string | null = null;
    if (enc) {
      try {
        const t = this.crypto.decrypt(enc);
        hasToken = !!t;
        tokenHint = t ? `…${t.slice(-4)}` : null;
        if (t) { const me = await this.getMe(t); botUsername = me?.username ? `@${me.username}` : null; }
      } catch { /* skip */ }
    }
    return {
      ok: true,
      enabled: enabled === '1',
      hasToken,
      tokenHint,
      botUsername,
      groupId: groupId || null,
      whitelist: await this.getWhitelist(),
    };
  }

  async saveConfig(
    body: { botToken?: string; groupId?: string; enabled?: boolean; whitelist?: Array<{ id: string; name: string }> },
    updatedBy?: string,
  ) {
    if (body.botToken !== undefined && body.botToken.trim()) {
      await this.settings.set(this.K_TOKEN, this.crypto.encrypt(body.botToken.trim()), updatedBy);
    }
    if (body.groupId !== undefined) await this.settings.set(this.K_GROUP, body.groupId.trim() || null, updatedBy);
    if (body.enabled !== undefined) await this.settings.set(this.K_ENABLED, body.enabled ? '1' : null, updatedBy);
    if (body.whitelist !== undefined) await this.setWhitelist(body.whitelist, updatedBy);
    return this.getConfig();
  }
}
