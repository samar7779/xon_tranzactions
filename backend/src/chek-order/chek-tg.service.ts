import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { SettingsService } from '../sync/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';

const S_ENABLED = 'chekorder.tg.enabled';
const S_TOKEN = 'chekorder.tg.botToken'; // shifrlangan
const S_GROUP = 'chekorder.tg.groupId';

/**
 * Chek order — Telegram Mini App (WebApp) orqali kirish.
 * Guruh a'zolari (AdminUser'siz) faqat "Tekshirish" bo'limiga kira oladi.
 *  1) Telegram `initData` bot token bilan imzolangan — HMAC tekshiriladi
 *     (soxta bo'lsa yoki Telegramdan tashqarida ochilsa — rad).
 *  2) getChatMember bilan foydalanuvchi guruhda a'zomi tekshiriladi.
 *  3) A'zo bo'lsa — cheklangan (chekorder:view+manage) guest JWT beriladi.
 */
@Injectable()
export class ChekTgService {
  private readonly log = new Logger(ChekTgService.name);
  constructor(
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
  ) {}

  private async getBotToken(): Promise<string | null> {
    const enc = await this.settings.get(S_TOKEN);
    if (enc) { try { return this.crypto.decrypt(enc); } catch { return null; } }
    return null;
  }

  async getConfig() {
    const [enabled, group, tokenEnc] = await Promise.all([
      this.settings.get(S_ENABLED),
      this.settings.get(S_GROUP),
      this.settings.get(S_TOKEN),
    ]);
    return {
      ok: true,
      enabled: enabled === '1' || enabled === 'true',
      groupId: group || '',
      hasToken: !!tokenEnc,
    };
  }

  async setConfig(dto: { enabled?: boolean; botToken?: string; groupId?: string }) {
    if (dto.enabled !== undefined) await this.settings.set(S_ENABLED, dto.enabled ? '1' : '0');
    if (dto.groupId !== undefined) await this.settings.set(S_GROUP, String(dto.groupId).trim());
    if (dto.botToken !== undefined && String(dto.botToken).trim()) {
      await this.settings.set(S_TOKEN, this.crypto.encrypt(String(dto.botToken).trim()));
    }
    return this.getConfig();
  }

  // ── Telegram WebApp initData imzosini tekshirish (rasmiy algoritm) ──
  private verifyInitData(initData: string, botToken: string): { ok: boolean; user?: any; authDate?: number } {
    if (!initData) return { ok: false };
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { ok: false };
    params.delete('hash');
    const pairs: string[] = [];
    for (const [k, v] of Array.from(params.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      pairs.push(`${k}=${v}`);
    }
    const dataCheckString = pairs.join('\n');
    // secret = HMAC_SHA256(key="WebAppData", msg=botToken); hash = HMAC_SHA256(key=secret, msg=dataCheckString)
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    let equal = false;
    try {
      equal = computed.length === hash.length &&
        crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
    } catch { equal = false; }
    if (!equal) return { ok: false };
    const authDate = Number(params.get('auth_date') || 0);
    let user: any = null;
    try { user = JSON.parse(params.get('user') || 'null'); } catch { /* skip */ }
    return { ok: true, user, authDate };
  }

  private async getChatMemberStatus(botToken: string, chatId: string, userId: number | string): Promise<string | null> {
    const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(String(userId))}`;
    try {
      const res = await fetch(url);
      const data: any = await res.json();
      if (!data?.ok) { this.log.warn(`getChatMember javob: ${JSON.stringify(data).slice(0, 200)}`); return null; }
      return data.result?.status || null;
    } catch (e: any) {
      this.log.warn(`getChatMember xato: ${e?.message}`);
      return null;
    }
  }

  /** Telegram Mini App auth — imzoni + guruh a'zoligini tekshirib, guest token beradi. */
  async auth(initData: string) {
    const cfg = await this.getConfig();
    if (!cfg.enabled) throw new BadRequestException('Telegram orqali kirish yoqilmagan');
    const botToken = await this.getBotToken();
    const groupId = cfg.groupId;
    if (!botToken || !groupId) throw new BadRequestException('Telegram sozlanmagan (bot token / guruh ID)');

    const v = this.verifyInitData(initData || '', botToken);
    if (!v.ok || !v.user?.id) {
      throw new UnauthorizedException("Telegram imzosi noto'g'ri — faqat Telegram ichidan oching");
    }
    // Replay himoyasi — 24 soatdan eski sessiya rad
    const now = Math.floor(Date.now() / 1000);
    if (v.authDate && now - v.authDate > 86400) {
      throw new UnauthorizedException('Sessiya eskirgan — Telegramdan qayta oching');
    }

    const status = await this.getChatMemberStatus(botToken, groupId, v.user.id);
    const okStatuses = ['creator', 'administrator', 'member', 'restricted'];
    if (!status || !okStatuses.includes(status)) {
      throw new UnauthorizedException("Siz bu Telegram guruhda a'zo emassiz");
    }

    const name = [v.user.first_name, v.user.last_name].filter(Boolean).join(' ') || v.user.username || `tg${v.user.id}`;
    const token = await this.jwt.signAsync(
      { sub: `tg:${v.user.id}`, tgGuest: true, name },
      { expiresIn: '12h' },
    );
    return { ok: true, token, user: { name, telegramId: v.user.id } };
  }
}
