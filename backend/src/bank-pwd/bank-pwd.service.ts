import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { SettingsService } from '../sync/settings.service';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';

/**
 * Bank paroli AVTOMAT topish/almashtirish.
 *
 * Banklar vaqti-vaqti bilan parolni majburan o'zgartiradi — har safar qo'lda
 * kirib almashtirish o'rniga: har bank uchun oldindan TAXMINIY parollar ro'yxati
 * saqlanadi. Ulanish parol xatosi bersa — o'sha bankning taxminiy parollari
 * KETMA-KET sinaladi (kb.apiLogin), qay biri ishlasa — shu parol saqlanadi va
 * Telegram guruhga xabar beriladi. Kirish 7779 kodi bilan himoyalangan.
 */
@Injectable()
export class BankPwdService {
  private readonly log = new Logger(BankPwdService.name);
  private readonly K_CANDIDATES = 'bankpwd.candidates'; // shifrlangan {bankId: [passwords]}
  private readonly K_TOKEN = 'bankpwd.botToken';
  private readonly K_GROUP = 'bankpwd.groupId';
  private readonly GATE = '7779';

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly kb: KapitalbankClient,
  ) {}

  private assertGate(password?: string) {
    if (String(password || '').trim() !== this.GATE) {
      throw new ForbiddenException('Kod noto\'g\'ri');
    }
  }

  // ─── Taxminiy parollar (bank bo'yicha) ────────────────────────────
  private async getCandidates(): Promise<Record<string, string[]>> {
    const enc = await this.settings.get(this.K_CANDIDATES);
    if (!enc) return {};
    try {
      const raw = this.crypto.decrypt(enc);
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : {};
    } catch {
      return {};
    }
  }

  private async setCandidates(map: Record<string, string[]>, by?: string) {
    const clean: Record<string, string[]> = {};
    for (const [bankId, arr] of Object.entries(map || {})) {
      const list = (Array.isArray(arr) ? arr : []).map((s) => String(s).trim()).filter(Boolean);
      if (list.length) clean[bankId] = [...new Set(list)];
    }
    await this.settings.set(this.K_CANDIDATES, Object.keys(clean).length ? this.crypto.encrypt(JSON.stringify(clean)) : null, by);
  }

  private async getToken(): Promise<string | null> {
    const enc = await this.settings.get(this.K_TOKEN);
    if (enc) { try { return this.crypto.decrypt(enc); } catch { /* */ } }
    return null;
  }

  // ─── Config (7779 bilan ochiladi) ─────────────────────────────────
  async getConfig(password?: string) {
    this.assertGate(password);
    const banks = await this.prisma.bank.findMany({
      where: { apiBaseUrl: { not: null } },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
    const candidates = await this.getCandidates();
    const [tokenEnc, groupId] = await Promise.all([this.settings.get(this.K_TOKEN), this.settings.get(this.K_GROUP)]);
    let hasToken = false; let tokenHint: string | null = null;
    if (tokenEnc) { try { const t = this.crypto.decrypt(tokenEnc); hasToken = !!t; tokenHint = t ? `…${t.slice(-4)}` : null; } catch { /* */ } }
    return {
      ok: true,
      banks: banks.map((b) => ({ id: b.id, name: b.name, code: b.code, candidates: candidates[b.id] || [] })),
      hasToken, tokenHint, groupId: groupId || null,
    };
  }

  async saveConfig(body: { password?: string; candidates?: Record<string, string[]>; botToken?: string; groupId?: string }, by?: string) {
    this.assertGate(body?.password);
    if (body.candidates !== undefined) await this.setCandidates(body.candidates, by);
    if (body.botToken !== undefined && body.botToken.trim()) await this.settings.set(this.K_TOKEN, this.crypto.encrypt(body.botToken.trim()), by);
    if (body.groupId !== undefined) await this.settings.set(this.K_GROUP, body.groupId.trim() || null, by);
    return this.getConfig(body.password);
  }

  // ─── Parolni sinab topish (ketma-ket) ─────────────────────────────
  async tryCandidates(body: { password?: string; credentialId?: string }) {
    this.assertGate(body?.password);
    const candidates = await this.getCandidates();

    // Nishon: berilgan credential YOKI hozir xato bergan (lastError) barchasi
    const creds = body.credentialId
      ? await this.prisma.bankCredential.findMany({ where: { id: body.credentialId }, include: { bank: true } })
      : await this.prisma.bankCredential.findMany({ where: { lastError: { not: null } }, include: { bank: true } });

    const results: Array<{ label: string; bank: string; status: 'fixed' | 'not-fixed' | 'no-candidates'; tried?: number }> = [];
    let fixedCount = 0;

    for (const c of creds) {
      const label = c.label || c.loginName || c.id;
      const bankName = c.bank?.name || '—';
      const bankCands = candidates[c.bankId] || [];
      if (!bankCands.length) { results.push({ label, bank: bankName, status: 'no-candidates' }); continue; }
      if (!c.bank?.apiBaseUrl) { results.push({ label, bank: bankName, status: 'no-candidates' }); continue; }

      const login = (c.loginPrefix || '') + c.loginName;
      let fixed = false;
      let tried = 0;
      for (const pwd of bankCands) {
        tried++;
        try {
          const r: any = await this.kb.apiLogin({ baseUrl: c.bank.apiBaseUrl, login, password: pwd, useProxy: c.useProxy === true });
          if (r?.sid || (r?.clients && r.clients.length)) {
            await this.prisma.bankCredential.update({
              where: { id: c.id },
              data: {
                passwordEnc: this.crypto.encrypt(pwd),
                lastError: null,
                lastVerifiedAt: new Date(),
                ...(r.sid ? { sid: r.sid, sidExpiresAt: new Date(Date.now() + 30 * 60 * 1000) } : {}),
              },
            });
            await this.notify(label, bankName);
            this.log.log(`Bank parol topildi: ${label} (${bankName}) — ${tried}-urinishda`);
            results.push({ label, bank: bankName, status: 'fixed', tried });
            fixedCount++;
            fixed = true;
            break;
          }
        } catch { /* keyingi parolni sinaymiz */ }
      }
      if (!fixed) results.push({ label, bank: bankName, status: 'not-fixed', tried });
    }
    return { ok: true, fixed: fixedCount, total: creds.length, results };
  }

  // ─── Telegram xabar (parol o'zgardi) ──────────────────────────────
  private async notify(label: string, bankName: string) {
    try {
      const token = await this.getToken();
      const groupId = await this.settings.get(this.K_GROUP);
      if (!token || !groupId) return;
      const text = `🔐 Bank paroli avtomat yangilandi\n\nKorxona: ${label}\nBank: ${bankName}\nHolat: yangi parol topildi va o'rnatildi ✅`;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: groupId, text }),
      });
    } catch (e: any) {
      this.log.warn(`Telegram xabar xato: ${e?.message}`);
    }
  }
}
