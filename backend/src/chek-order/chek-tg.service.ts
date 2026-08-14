import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { SettingsService } from '../sync/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';

const S_ENABLED = 'chekorder.tg.enabled';
const S_TOKEN = 'chekorder.tg.botToken'; // shifrlangan
const S_GROUP = 'chekorder.tg.groupId';
const S_USERNAME = 'chekorder.tg.botUsername'; // Login Widget uchun (ochiq)

/**
 * Chek order — Telegram Mini App (WebApp) orqali kirish.
 * Guruh a'zolari (AdminUser'siz) faqat "Tekshirish" bo'limiga kira oladi.
 *  1) Telegram `initData` bot token bilan imzolangan — HMAC tekshiriladi
 *     (soxta bo'lsa yoki Telegramdan tashqarida ochilsa — rad).
 *  2) getChatMember bilan foydalanuvchi guruhda a'zomi tekshiriladi.
 *  3) A'zo bo'lsa — cheklangan (chekorder:view+manage) guest JWT beriladi.
 */
const S_WEBHOOK = 'chekorder.tg.webhookSecret';

@Injectable()
export class ChekTgService {
  private readonly log = new Logger(ChekTgService.name);
  // Bir martalik kirish tokenlari (bot yuborgan shaxsiy havola) — 10 daqiqa
  private readonly redeemStore = new Map<string, { userId: number; name: string; exp: number }>();
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
    const [enabled, group, tokenEnc, username] = await Promise.all([
      this.settings.get(S_ENABLED),
      this.settings.get(S_GROUP),
      this.settings.get(S_TOKEN),
      this.settings.get(S_USERNAME),
    ]);
    return {
      ok: true,
      enabled: enabled === '1' || enabled === 'true',
      groupId: group || '',
      botUsername: (username || '').replace(/^@/, ''),
      hasToken: !!tokenEnc,
    };
  }

  /** Ochiq konfiguratsiya — Login Widget uchun (sir emas). */
  async publicConfig() {
    const [enabled, username] = await Promise.all([this.settings.get(S_ENABLED), this.settings.get(S_USERNAME)]);
    return {
      ok: true,
      enabled: enabled === '1' || enabled === 'true',
      botUsername: (username || '').replace(/^@/, ''),
    };
  }

  async setConfig(dto: { enabled?: boolean; botToken?: string; groupId?: string; botUsername?: string }) {
    if (dto.enabled !== undefined) await this.settings.set(S_ENABLED, dto.enabled ? '1' : '0');
    if (dto.groupId !== undefined) await this.settings.set(S_GROUP, String(dto.groupId).trim());
    if (dto.botUsername !== undefined) await this.settings.set(S_USERNAME, String(dto.botUsername).trim().replace(/^@/, ''));
    if (dto.botToken !== undefined && String(dto.botToken).trim()) {
      await this.settings.set(S_TOKEN, this.crypto.encrypt(String(dto.botToken).trim()));
    }
    // Bot token bor bo'lsa — webhookni (qayta) o'rnatamiz (deep-link /start uchun)
    let webhook: any = null;
    if (await this.getBotToken()) webhook = await this.ensureWebhook();
    const cfg = await this.getConfig();
    return { ...cfg, webhook };
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

  // ── Telegram LOGIN WIDGET tekshirish (web tugma — Mini App emas) ──
  //   secret = SHA256(botToken); hash = HMAC_SHA256(dataCheckString, secret)
  private verifyLoginWidget(data: Record<string, any>, botToken: string): boolean {
    const hash = data?.hash;
    if (!hash) return false;
    const pairs = Object.keys(data)
      .filter((k) => k !== 'hash' && data[k] !== undefined && data[k] !== null)
      .sort()
      .map((k) => `${k}=${data[k]}`);
    const dataCheckString = pairs.join('\n');
    const secret = crypto.createHash('sha256').update(botToken).digest();
    const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    try {
      return computed.length === String(hash).length &&
        crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(String(hash), 'hex'));
    } catch { return false; }
  }

  /** Telegram Login Widget orqali kirish (web'da tugma bosib). */
  async loginWidget(data: any) {
    const cfg = await this.getConfig();
    if (!cfg.enabled) throw new BadRequestException('Telegram orqali kirish yoqilmagan');
    const botToken = await this.getBotToken();
    if (!botToken || !cfg.groupId) throw new BadRequestException('Telegram sozlanmagan (bot token / guruh ID)');
    if (!data?.id || !data?.hash) throw new UnauthorizedException("Telegram ma'lumoti yo'q");
    if (!this.verifyLoginWidget(data, botToken)) {
      throw new UnauthorizedException("Telegram imzosi noto'g'ri");
    }
    const now = Math.floor(Date.now() / 1000);
    if (data.auth_date && now - Number(data.auth_date) > 86400) {
      throw new UnauthorizedException('Sessiya eskirgan — qayta kiring');
    }
    const status = await this.getChatMemberStatus(botToken, cfg.groupId, data.id);
    const okStatuses = ['creator', 'administrator', 'member', 'restricted'];
    if (!status || !okStatuses.includes(status)) {
      throw new UnauthorizedException("Siz bu Telegram guruhda a'zo emassiz");
    }
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || `tg${data.id}`;
    const token = await this.jwt.signAsync(
      { sub: `tg:${data.id}`, tgGuest: true, name },
      { expiresIn: '12h' },
    );
    return { ok: true, token, user: { name, telegramId: data.id } };
  }

  // ═════════ BOT DEEP-LINK: /start → guruh tekshir → shaxsiy havola yubor ═════════
  private appUrl() { return (process.env.APP_PUBLIC_URL || 'https://transactions.xonapps.uz').replace(/\/+$/, ''); }
  private apiUrl() { return (process.env.API_PUBLIC_URL || `${this.appUrl()}/api`).replace(/\/+$/, ''); }

  private async sendMessage(botToken: string, chatId: number | string, text: string, replyMarkup?: any) {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup, disable_web_page_preview: true }),
      });
    } catch (e: any) { this.log.warn(`sendMessage xato: ${e?.message}`); }
  }

  /** Bot webhookni o'rnatadi (config saqlanganda chaqiriladi). */
  async ensureWebhook(): Promise<{ ok: boolean; url?: string; error?: string }> {
    const botToken = await this.getBotToken();
    if (!botToken) return { ok: false, error: 'Bot token yo\'q' };
    let secret = await this.settings.get(S_WEBHOOK);
    if (!secret) { secret = crypto.randomBytes(24).toString('hex'); await this.settings.set(S_WEBHOOK, secret); }
    const url = `${this.apiUrl()}/chek-order/tg/webhook/${secret}`;
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, allowed_updates: ['message'] }),
      });
      const data: any = await res.json();
      if (!data?.ok) return { ok: false, error: data?.description || 'setWebhook rad etildi' };
      return { ok: true, url };
    } catch (e: any) { return { ok: false, error: e?.message }; }
  }

  /** Telegram webhook — /start kelganda guruhni tekshirib shaxsiy havola yuboradi. */
  async handleWebhook(secret: string, update: any): Promise<{ ok: boolean }> {
    const stored = await this.settings.get(S_WEBHOOK);
    if (!stored || secret !== stored) return { ok: false };
    const msg = update?.message;
    const text = String(msg?.text || '');
    if (!msg?.from?.id || !msg?.chat?.id || !text.startsWith('/start')) return { ok: true };

    const cfg = await this.getConfig();
    const botToken = await this.getBotToken();
    if (!cfg.enabled || !botToken || !cfg.groupId) return { ok: true };

    const userId = msg.from.id;
    const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || msg.from.username || `tg${userId}`;
    const status = await this.getChatMemberStatus(botToken, cfg.groupId, userId);
    const okStatuses = ['creator', 'administrator', 'member', 'restricted'];
    if (!status || !okStatuses.includes(status)) {
      await this.sendMessage(botToken, msg.chat.id, "❌ Kechirasiz, siz ruxsat berilgan guruhda a'zo emassiz.");
      return { ok: true };
    }
    // Shaxsiy chatда web_app tugma RUXSAT etiladi (guruhда emas) — Mini App'ni to'g'ridan-to'g'ri ochadi.
    const url = `${this.appUrl()}/uz/tg/chek`;
    await this.sendMessage(botToken, msg.chat.id,
      `✅ <b>Chek order</b> — kirish tayyor, ${name}.\nTekshirish uchun tugmani bosing:`,
      { inline_keyboard: [[{ text: '🔍 Tekshirish', web_app: { url } }]] });
    return { ok: true };
  }

  /** Shaxsiy havoladagi (bir martalik) tokenni guest JWT'ga almashtiradi. */
  async redeemToken(token: string) {
    const key = String(token || '');
    const e = this.redeemStore.get(key);
    if (!e || e.exp < Date.now()) {
      this.redeemStore.delete(key);
      throw new UnauthorizedException("Havola eskirgan yoki noto'g'ri — botga /start yozib qayta oling");
    }
    this.redeemStore.delete(key); // bir martalik
    const jwt = await this.jwt.signAsync({ sub: `tg:${e.userId}`, tgGuest: true, name: e.name }, { expiresIn: '12h' });
    return { ok: true, token: jwt, user: { name: e.name, telegramId: e.userId } };
  }

  /**
   * GURUHGA "Tekshirish" tugmasini yuboradi — inline web_app tugma.
   * Guruh a'zosi guruhда tugmani bosadi → Mini App ochiladi (o'zini taniydi).
   * Botга kirish/start kerak emas; /setdomain ham shart emas.
   */
  async postGroupButton() {
    const cfg = await this.getConfig();
    if (!cfg.enabled) throw new BadRequestException('Telegram orqali kirish yoqilmagan');
    const botToken = await this.getBotToken();
    if (!botToken || !cfg.groupId) throw new BadRequestException("Bot token / guruh ID yo'q");
    // Guruhда web_app tugma MUMKIN EMAS (BUTTON_TYPE_INVALID). Shu bois URL tugma
    // botга yo'naltiradi (t.me/<bot>?start=chek) — bot /start'ni olib, shaxsiy chatда
    // web_app tugma yuboradi (u yerда ruxsat etiladi). "Configure Mini App" kerak emas.
    const uname = (cfg.botUsername || '').replace(/^@/, '');
    if (!uname) throw new BadRequestException('Bot username kiritilmagan (guruh havolasi uchun kerak)');
    const link = `https://t.me/${uname}?start=chek`;
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.groupId,
          text: "📋 <b>Chek order — to'lovni tekshirish</b>\nTugmani bosing → bot sizga kirish tugmasini yuboradi:",
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '🔍 Tekshirish', url: link }]] },
        }),
      });
      const data: any = await res.json();
      if (!data?.ok) throw new BadRequestException(`Guruhga yuborilmadi: ${data?.description || 'xato'}`);
      return { ok: true, messageId: data.result?.message_id };
    } catch (e: any) {
      if (e?.response) throw e;
      throw new BadRequestException(`Guruhga yuborishда xato: ${e?.message || ''}`);
    }
  }
}
