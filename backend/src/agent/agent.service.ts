import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { SettingsService } from '../sync/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CategorizationService } from '../categorization/categorization.service';
import { CrmService } from '../crm/crm.service';
import { CorrectionService } from '../correction/correction.service';

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
    private readonly prisma: PrismaService,
    private readonly categorization: CategorizationService,
    private readonly crm: CrmService,
    private readonly correction: CorrectionService,
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
    let botUsername: string | null = null;
    if (enc) {
      try {
        const t = this.crypto.decrypt(enc);
        hasToken = !!t;
        tokenHint = t ? `…${t.slice(-4)}` : null;
        if (t) { const me = await this.getMe(t); botUsername = me?.username ? `@${me.username}` : null; }
      } catch { /* skip */ }
    }
    const pendingCount = await this.oplataKv.countXatoForAgent(dateFrom || null);
    return {
      ok: true,
      enabled: enabled === '1',
      hasToken,
      tokenHint,
      botUsername,
      groupId: groupId || null,
      dateFrom: dateFrom || null,
      dailyTime: this.validTime(dailyTime) || '09:00',
      lastResult: lastResult || null,
      pendingCount,
      whitelist: await this.getWhitelist(),
    };
  }

  async saveConfig(
    body: {
      botToken?: string; groupId?: string; enabled?: boolean; dateFrom?: string | null; dailyTime?: string;
      whitelist?: Array<{ id: string; name: string }>;
    },
    updatedBy?: string,
  ) {
    if (body.botToken !== undefined && body.botToken.trim()) {
      await this.settings.set(this.K_TOKEN, this.crypto.encrypt(body.botToken.trim()), updatedBy);
    }
    if (body.groupId !== undefined) await this.settings.set(this.K_GROUP, body.groupId.trim() || null, updatedBy);
    if (body.enabled !== undefined) await this.settings.set(this.K_ENABLED, body.enabled ? '1' : null, updatedBy);
    if (body.dateFrom !== undefined) await this.settings.set(this.K_DATEFROM, body.dateFrom || null, updatedBy);
    if (body.dailyTime !== undefined) await this.settings.set(this.K_DAILY_TIME, this.validTime(body.dailyTime), updatedBy);
    if (body.whitelist !== undefined) await this.setWhitelist(body.whitelist, updatedBy);
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

    const base = (this.config.get<string>('APP_URL') || 'https://transactions.xonapps.uz').replace(/\/+$/, '');
    const text = this.formatDigest(count);

    // 1) login_url (chat_id auth) — BotFather /setdomain ulangan bo'lsa ishlaydi.
    const loginBtn = { inline_keyboard: [[{ text: '📋 Ro\'yxat', login_url: { url: `${base}/uz/xato-list` } }]] };
    let sent = await this.sendMessage(token, groupId, text, loginBtn);

    // 2) Fallback — login_url qabul qilinmasa (domen ulanmagan yoki guruh cheklovi),
    //    maxfiy kalit havolasi bilan jo'natamiz (agent ishlashda davom etadi).
    if (!sent) {
      const keyBtn = { inline_keyboard: [[{ text: '📋 Ro\'yxat', url: await this.xatoLink() }]] };
      sent = await this.sendMessage(token, groupId, text, keyBtn);
    }
    if (!sent) return { ok: false, error: "Telegram jo'natilmadi (bot/guruh tekshiring)" };

    await this.saveResult(`${count} ta XATO — kunlik xabar jo'natildi`);
    this.log.log(`Agent digest jo'natildi: ${count} ta XATO`);
    return { ok: true, count };
  }

  // Qo'lda "Hozir ishga tushirish"
  async runOnce() {
    return this.runDigest();
  }

  private async xatoLink(): Promise<string> {
    const base = (this.config.get<string>('APP_URL') || 'https://transactions.xonapps.uz').replace(/\/+$/, '');
    const token = await this.getListToken();
    return `${base}/uz/xato-list?key=${token}`;
  }

  /** Maxfiy kalit — public XATO ro'yxati sahifasi uchun (yo'q bo'lsa generatsiya). */
  private async getListToken(): Promise<string> {
    let t = await this.settings.get('agent.listToken');
    if (!t) {
      t = crypto.randomBytes(24).toString('hex');
      await this.settings.set('agent.listToken', t, 'agent');
    }
    return t;
  }

  // ─── Whitelist (chat_id + ism) — login_url auth uchun ─────────────
  private readonly K_WHITELIST = 'agent.whitelist';

  async getWhitelist(): Promise<Array<{ id: string; name: string }>> {
    const raw = await this.settings.get(this.K_WHITELIST);
    if (!raw) return [];
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  async setWhitelist(list: Array<{ id: string; name: string }>, updatedBy?: string) {
    const clean = (list || [])
      .map((x) => ({ id: String(x.id || '').replace(/\D/g, ''), name: String(x.name || '').slice(0, 60).trim() }))
      .filter((x) => x.id);
    await this.settings.set(this.K_WHITELIST, JSON.stringify(clean), updatedBy);
    return clean;
  }

  // ─── Auth ──────────────────────────────────────────────────────────
  private async assertKey(key: string) {
    const token = await this.getListToken();
    if (!key || key !== token) throw new UnauthorizedException("Kalit noto'g'ri yoki eskirgan");
  }

  /** Telegram login_url auth (Login Widget algoritmi): secret=SHA256(botToken), HMAC tekshiradi. */
  private async validateTgAuth(params: Record<string, any>): Promise<{ userId: string; name: string } | null> {
    const { token } = await this.getRaw();
    if (!token || !params?.hash || !params?.id) return null;
    const hash = String(params.hash);
    const pairs = Object.keys(params)
      .filter((k) => k !== 'hash' && params[k] != null && params[k] !== '')
      .sort()
      .map((k) => `${k}=${params[k]}`);
    const secret = crypto.createHash('sha256').update(token).digest();
    const computed = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    if (computed !== hash) return null;
    const authDate = Number(params.auth_date);
    if (authDate && Date.now() / 1000 - authDate > 86400) return null; // 1 kundan eski emas
    const name = [params.first_name, params.last_name].filter(Boolean).join(' ').trim() || String(params.username || params.id);
    return { userId: String(params.id), name };
  }

  /** login_url params → hash tekshiruvi → whitelist → ruxsatli foydalanuvchi ismi. */
  private async authorizeTg(auth: Record<string, any>): Promise<{ userId: string; name: string }> {
    const v = await this.validateTgAuth(auth || {});
    if (!v) throw new UnauthorizedException('Telegram tekshiruvi muvaffaqiyatsiz');
    const wl = await this.getWhitelist();
    const entry = wl.find((w) => w.id === v.userId);
    if (!entry) throw new UnauthorizedException("Sizda ruxsat yo'q");
    return { userId: v.userId, name: entry.name || v.name };
  }

  // ─── Ma'lumot yadrosi (auth'siz) ───────────────────────────────────
  private async _crmSearch(q: string) {
    const query = (q || '').trim();
    if (query.length < 2) return { ok: true, items: [] };
    try {
      const r: any = await this.crm.searchContracts(query, 8);
      return { ok: true, items: r?.items || [] };
    } catch (e: any) {
      return { ok: false, items: [], error: e?.message };
    }
  }

  /**
   * Ariza yuborish — DARROV tasdiqlanmaydi. Tasdiqlovchi xodim keyin
   * ko'rib fayl + kategoriya bilan tasdiqlaydi (2 bosqichli oqim).
   */
  private async _submit(
    oplataKvId: string, contractNo: string,
    actorName?: string, chatId?: string,
    source: 'telegram' | 'web' = 'telegram',
  ) {
    const contract = (contractNo || '').trim();
    if (!oplataKvId || !contract) return { ok: false, error: "To'lov yoki shartnoma raqami yo'q" };
    try {
      const res = await this.correction.createRequest({
        oplataKvId,
        proposedContractNo: contract,
        source,
        submittedByName: actorName || 'Telegram',
        submittedByChatId: chatId || null,
      });
      return { ok: true, id: res.id, alreadyPending: !!res.alreadyPending, pending: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Ariza yuborishda xato' };
    }
  }

  /** Ariza yuborish + majburiy ariza fayli bilan (web/telegram modal). */
  private async _submitWithFile(
    oplataKvId: string, contractNo: string, file: any,
    actorName?: string, chatId?: string,
    source: 'telegram' | 'web' = 'telegram',
  ) {
    const contract = (contractNo || '').trim();
    if (!oplataKvId || !contract) return { ok: false, error: "To'lov yoki shartnoma raqami yo'q" };
    if (!file?.buffer) return { ok: false, error: 'Ariza fayli majburiy' };
    try {
      const res = await this.correction.createRequestWithFile({
        oplataKvId, proposedContractNo: contract, source,
        submittedByName: actorName || 'Telegram', submittedByChatId: chatId || null,
      }, file);
      return { ok: true, id: res.id, alreadyPending: !!res.alreadyPending, pending: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Ariza yuborishda xato' };
    }
  }

  private async _list() {
    const dateFrom = await this.settings.get(this.K_DATEFROM);
    const [rows, count] = await Promise.all([
      this.oplataKv.getXatoRows({ dateFrom: dateFrom || null, limit: 2000 }),
      this.oplataKv.countXatoForAgent(dateFrom || null),
    ]);
    const ids = rows.map((r) => r.id);
    const [pendingMap, rejectedSet] = await Promise.all([
      this.correction.pendingInfoByOplataKvId(ids),
      this.correction.rejectedOplataKvIds(ids),
    ]);
    return {
      ok: true,
      count,
      rows: rows.map((r) => {
        const p = pendingMap.get(r.id);
        return {
          id: r.id, date: r.date, contractNo: r.contractNo,
          amount: r.paymentAmount != null ? Number(r.paymentAmount) : null,
          client: r.client, object: r.object, txType: r.txType, purpose: r.purpose,
          pending: !!p,
          rejected: !p && rejectedSet.has(r.id),
          pendingInfo: p ? {
            by: p.by,
            at: p.at,
            contractNo: p.contractNo,
            attachmentId: p.attachmentId,
            attachmentName: p.attachmentName,
          } : null,
        };
      }),
    };
  }

  // ─── Public: maxfiy kalit bilan (fallback/test) ────────────────────
  async getPublicXatoList(key: string) { await this.assertKey(key); return this._list(); }
  async crmSearch(key: string, q: string) { await this.assertKey(key); return this._crmSearch(q); }
  async assignContract(key: string, oplataKvId: string, contractNo: string, actorName?: string) {
    await this.assertKey(key); return this._submit(oplataKvId, contractNo, actorName, undefined, 'web');
  }

  // ─── Public: Telegram login_url (chat_id whitelist) ────────────────
  async tgList(auth: Record<string, any>) {
    const who = await this.authorizeTg(auth);
    return { ...(await this._list()), me: who.name };
  }
  async tgCrmSearch(auth: Record<string, any>, q: string) { await this.authorizeTg(auth); return this._crmSearch(q); }
  async tgAssign(auth: Record<string, any>, oplataKvId: string, contractNo: string) {
    const who = await this.authorizeTg(auth);
    return this._submit(oplataKvId, contractNo, who.name, who.userId, 'telegram');
  }

  // ─── Public: ariza + fayl bilan yuborish (majburiy fayl) ───────────
  async tgSubmitFile(auth: Record<string, any>, oplataKvId: string, contractNo: string, file: any) {
    const who = await this.authorizeTg(auth);
    return this._submitWithFile(oplataKvId, contractNo, file, who.name, who.userId, 'telegram');
  }
  async submitFile(key: string, oplataKvId: string, contractNo: string, file: any) {
    await this.assertKey(key);
    return this._submitWithFile(oplataKvId, contractNo, file, undefined, undefined, 'web');
  }

  // ─── Public: ariza faylini ko'rish (pending modal) ─────────────────
  async tgFile(auth: Record<string, any>, attachmentId: string) {
    await this.authorizeTg(auth);
    return this.correction.getArizaFile(attachmentId);
  }
  async keyFile(key: string, attachmentId: string) {
    await this.assertKey(key);
    return this.correction.getArizaFile(attachmentId);
  }

  private async saveResult(text: string) {
    try { await this.settings.set(this.K_LAST_RESULT, `${new Date().toISOString()} · ${text}`, 'agent'); }
    catch { /* skip */ }
  }

  // ─── Telegram xabar ────────────────────────────────────────────────
  private formatDigest(count: number): string {
    return `📊 <b>${count} ta</b> CRM'da tasdiqlanmagan to'lov`;
  }

  private async getMe(token: string): Promise<{ id: number; username: string } | null> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data: any = await res.json().catch(() => ({}));
      if (!data?.ok || !data?.result) return null;
      return { id: data.result.id, username: data.result.username };
    } catch { return null; }
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
