import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { SettingsService } from '../sync/settings.service';
import { ReconcileService } from './reconcile.service';

/**
 * Sverka AI agenti.
 *
 * Bir hisob + bir kun uchun sverka natijasini (bank vs DB) va diagnostikani
 * (bankOnly / dbOnly / amountMismatch / sana-siljish) o'qib, Claude yordamida:
 *   1) farqning sababini ODAM TILIDA tushuntiradi,
 *   2) AYB kimda (bank / biz) ekanini tasniflaydi,
 *   3) aniq tuzatishni TAKLIF qiladi.
 *
 * MUHIM: agent hech qachon o'zi tuzatish targetlarini "o'ylab topmaydi" —
 * tuzatiladigan yozuvlar ro'yxati DIAGNOSE'dan (server, haqiqat manbai) quriladi.
 * Agent faqat tasnif + tavsiya beradi. Foydalanuvchi tasdiqlaydi, keyin apply().
 */
@Injectable()
export class SverkaAgentService {
  private readonly log = new Logger(SverkaAgentService.name);

  // analyze natijasi keshi (account:date:locale) — TTL 5 daq; apply'da invalidatsiya.
  private analyzeCache = new Map<string, { expiresAt: number; result: any }>();
  private static readonly ANALYZE_TTL_MS = 5 * 60 * 1000;
  // apply lock (account:date) — bir vaqtda ikki tuzatish (race) bo'lmasin.
  private applyLocks = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private settings: SettingsService,
    private reconcile: ReconcileService,
  ) {}

  /** ANTHROPIC kalit — agent.aiKey (shifrlangan) yoki env (chek-order bilan bir xil) */
  private async getAiKey(): Promise<string | null> {
    const enc = await this.settings.get('agent.aiKey');
    if (enc) { try { return this.crypto.decrypt(enc); } catch { /* skip */ } }
    return process.env.ANTHROPIC_API_KEY || null;
  }

  private async getAiModel(): Promise<string> {
    const m = await this.settings.get('agent.aiModel');
    return m || 'claude-sonnet-4-6';
  }

  private money(n: any): number {
    return Math.round(Number(n || 0) * 100) / 100;
  }

  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  private cacheReturn(key: string, result: any): any {
    this.analyzeCache.set(key, { expiresAt: Date.now() + SverkaAgentService.ANALYZE_TTL_MS, result });
    return result;
  }
  /** apply'dan keyin — shu hisob+kun uchun keshni bekor qilamiz (yangi tahlil aniq bo'lsin). */
  private invalidateAnalyze(accountId: string, date: string): void {
    for (const k of this.analyzeCache.keys()) {
      if (k.startsWith(`${accountId}:${date}:`)) this.analyzeCache.delete(k);
    }
  }

  /**
   * Claude Messages API — 429/5xx/tarmoq xatosida retry + backoff (batch yiqilmasin).
   * Muvaffaqiyatда tool_use.input qaytaradi.
   */
  private async claudeCall(apiKey: string, body: any, attempts = 3): Promise<any> {
    let lastErr: any = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`Claude ${res.status}`);
          if (i < attempts - 1) { await this.sleep(600 * Math.pow(2, i)); continue; } // 600ms, 1.2s
          throw lastErr;
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new BadRequestException(`Claude API xatosi (${res.status}): ${errText.slice(0, 200)}`);
        }
        const data: any = await res.json();
        return (data?.content || []).find((c: any) => c.type === 'tool_use')?.input || null;
      } catch (e: any) {
        lastErr = e;
        // AbortError yoki tarmoq — retry; BadRequestException (4xx) — darrov tashla
        if (e instanceof BadRequestException) throw e;
        if (i < attempts - 1) { await this.sleep(600 * Math.pow(2, i)); continue; }
      }
    }
    throw lastErr || new Error('Claude javob bermadi');
  }

  /**
   * Diagnose ma'lumotidan SERVER tomonda tuzatish takliflarini quradi.
   * Agent bularni o'zgartira olmaydi — faqat tasnif/tavsiya qo'shadi.
   */
  private buildProposedActions(diag: any, date: string) {
    const bankOnly: any[] = diag?.bankOnly || [];
    const dbOnly: any[] = diag?.dbOnly || [];
    const amountMismatch: any[] = diag?.amountMismatch || [];

    // ① Qo'shish: bankda bor, bizda yo'q (boshqa sana ostida ham saqlanmagan)
    const addMissing = bankOnly
      .filter((it) => !it.existsOnDate && (it.b2Id || it.generalId))
      .map((it) => ({
        b2Id: it.b2Id || null,
        generalId: it.generalId || null,
        amount: this.money(it.amount),
        direction: it.direction || null,
        docNumber: it.docNumber || null,
        name: it.fromName || it.toName || null,
        purpose: it.purpose || it.description || null,
      }));

    // ② Sana tuzatish — ikki yo'nalish:
    //   (a) bankOnly.existsOnDate: bank shu kunda ko'rsatyapti, biz boshqa kunda → shu kunga ko'chir
    //   (b) dbOnly.foundOnBankDate: biz shu kunda, bank qo'shni kunda → bank kuniga ko'chir
    const fixDates: any[] = [];
    for (const it of bankOnly) {
      if (it.existsOnDate && it.existingTxId && it.existsOnDate !== date) {
        fixDates.push({
          txId: it.existingTxId, newDate: date, fromDate: it.existsOnDate,
          amount: this.money(it.amount), direction: it.direction || null,
          docNumber: it.docNumber || null, name: it.fromName || it.toName || null,
        });
      }
    }
    for (const it of dbOnly) {
      if (it.foundOnBankDate && it.id && it.foundOnBankDate !== date) {
        fixDates.push({
          txId: it.id, newDate: it.foundOnBankDate, fromDate: date,
          amount: this.money(it.amount), direction: it.direction || null,
          docNumber: it.docNumber || null, name: it.fromName || it.toName || null,
        });
      }
    }

    // ③ Summa tuzatish — bir xil ID, boshqa summa → DB'ni bankka tenglash
    const fixAmounts = amountMismatch
      .filter((it) => it.txId)
      .map((it) => ({
        txId: it.txId,
        newAmount: this.money(it.bankAmount),
        dbAmount: this.money(it.dbAmount),
        bankAmount: this.money(it.bankAmount),
        diff: this.money(it.diff),
        direction: it.direction || null,
        docNumber: it.docNumber || null,
        name: it.fromName || it.toName || null,
        purpose: it.purpose || null,
      }));

    // ④ Hal qilib bo'lmaydigan: bizda bor, bankda yo'q, qo'shni kunda ham topilmadi
    //    → fantom (bizniki xato) yoki bank o'chirgan (bank xatosi) — inson ko'rigi kerak
    const unresolved = dbOnly
      .filter((it) => !it.foundOnBankDate && !it.existsOnDate)
      .map((it) => ({
        txId: it.id || null,
        amount: this.money(it.amount),
        direction: it.direction || null,
        docNumber: it.docNumber || null,
        name: it.fromName || it.toName || null,
        purpose: it.purpose || it.description || null,
      }));

    return { addMissing, fixDates, fixAmounts, unresolved };
  }

  /**
   * Tahlil — sverka + diagnose'ni o'qib, Claude tashxisini qaytaradi.
   * status='ok' bo'lsa Claude chaqirilmaydi (token tejash).
   */
  async analyze(accountId: string, date: string, locale = 'uz', withSync = true) {
    if (!accountId) throw new BadRequestException('accountId kerak');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException("date YYYY-MM-DD bo'lishi kerak");
    }

    // Kesh — 5 daq ichida takroriy tahlil (batch qayta ochish, telegram edit,
    // qayta bosish) Claude'ni qayta chaqirmaydi. apply'da invalidatsiya bo'ladi.
    const cacheKey = `${accountId}:${date}:${locale}`;
    const cached = this.analyzeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    // 1) Sverka (bir kun) — bank vs DB umumiy.
    // withSync=true (default): AVVAL bankdan sync qilamiz — hali AllTranzactions'ga
    // tushmagan tranzaksiyalar qo'shiladi va "sync-lag" farqlari o'z-o'zidan yo'qoladi,
    // AI faqat HAQIQIY xatoni ko'rsatadi.
    const rec: any = await this.reconcile.reconcile(accountId, date, date, { withSync });
    if (rec?.status === 'error') {
      return { ok: true, status: 'error', error: rec.error || "Sverka bajarilmadi", diagnosis: null, proposed: null, rec };
    }

    // 2) Diagnostika (yozuv darajasida)
    const diag: any = await this.reconcile.diagnoseDay(accountId, date);
    const proposed = this.buildProposedActions(diag, date);

    const creditDiff = this.money(rec?.diff?.credit);
    const debitDiff = this.money(rec?.diff?.debit);
    const formulaDiff = this.money(rec?.diff?.formula);
    const noItemIssues =
      proposed.addMissing.length === 0 &&
      proposed.fixDates.length === 0 &&
      proposed.fixAmounts.length === 0 &&
      proposed.unresolved.length === 0;

    // Mos — Claude'siz
    if (rec?.status === 'ok' && noItemIssues) {
      return this.cacheReturn(cacheKey, {
        ok: true, status: 'ok',
        diagnosis: {
          summary: locale === 'ru' ? 'Банк и база полностью совпадают.'
            : locale === 'en' ? 'Bank and database fully match.'
            : 'Bank va baza to‘liq mos — farq yo‘q.',
          culprit: 'none', severity: 'info', findings: [],
          recommendation: '', actions: {}, cautionNote: '',
        },
        proposed, rec,
      });
    }

    const apiKey = await this.getAiKey();
    if (!apiKey) throw new BadRequestException('AI kaliti sozlanmagan (agent.aiKey yoki ANTHROPIC_API_KEY)');
    const model = await this.getAiModel();

    // ── Claude uchun ixcham kontekst ──
    const cap = (arr: any[], n = 15) => arr.slice(0, n);
    const ctx = {
      sana: date,
      hisob: { bank: rec?.bankName, raqam: rec?.accountNo, egasi: rec?.ownerName },
      bank_oborot: {
        ochilish: this.money(rec?.bank?.opening),
        yopilish: this.money(rec?.bank?.closing),
        kirim: this.money(rec?.bank?.credit),
        chiqim: this.money(rec?.bank?.debit),
      },
      db_oborot: {
        kirim: this.money(rec?.db?.inflow), kirim_soni: rec?.db?.inCount,
        chiqim: this.money(rec?.db?.outflow), chiqim_soni: rec?.db?.outCount,
      },
      farq: { kirim: creditDiff, chiqim: debitDiff, formula: formulaDiff },
      guruhlar_soni: {
        qoshish_kerak: proposed.addMissing.length,
        sana_tuzatish: proposed.fixDates.length,
        summa_tuzatish: proposed.fixAmounts.length,
        hal_qilib_bolmaydigan: proposed.unresolved.length,
      },
      namunalar: {
        qoshish_kerak: cap(proposed.addMissing),
        sana_tuzatish: cap(proposed.fixDates),
        summa_tuzatish: cap(proposed.fixAmounts),
        hal_qilib_bolmaydigan: cap(proposed.unresolved),
      },
    };

    const langName = locale === 'ru' ? 'RUS' : locale === 'en' ? 'INGLIZ' : 'O‘ZBEK (lotin)';
    const system = [
      'Sen — "Xon Saroy" g‘aznachilik tizimining SVERKA (bank ↔ baza solishtiruvi) tahlilchi agentisan.',
      `Javobni FAQAT ${langName} tilida yoz. Aniq raqamlar bilan, qisqa va tushunarli.`,
      '',
      'KONTEKST: bir bank hisobi, bir kun. Bank rasmiy kunlik oborotni (kirim/chiqim/saldo) beradi,',
      'biz uni bazamiz (AllTranzactions) bilan solishtiramiz. Farq guruhlari:',
      '• qoshish_kerak (bankda bor, bizda yo‘q): deyarli har doim BIZ tomon — sync yetib bormagan. Yechim: qo‘shish.',
      '• sana_tuzatish (bir xil tranzaksiya, sana farqli): BIZ tomon — sana noto‘g‘ri biriktirilgan. Yechim: sanani tuzatish.',
      '• summa_tuzatish (bir xil ID, boshqa summa): bank — haqiqat manbai. Odatda DB‘ni bankka tenglash kerak,',
      '  LEKIN EHTIYOT bo‘l — bu bank tomon xato (masalan noto‘g‘ri o‘tkazma) bo‘lishi ham mumkin. "caution" ber.',
      '• hal_qilib_bolmaydigan (bizda bor, bankda umuman yo‘q, qo‘shni kunda ham yo‘q): yo fantom/dublikat (BIZ xato),',
      '  yo bank yozuvni o‘chirgan (BANK xato). Avtomatik tuzatib bo‘lmaydi — inson ko‘rigi kerak.',
      '• formula (ochilish + kirim − chiqim ≠ yopilish, bank raqamlarida): BANK ichki nomuvofiqligi → BANK xatosi.',
      '',
      'AYB (culprit): agar asosiy farq qoshish/sana bo‘lsa → "us"; formula buzilgan yoki bankда ortiqcha bo‘lsa → "bank";',
      'ikkalasi ham bo‘lsa → "mixed"; farq yo‘q → "none"; aniqlab bo‘lmasa → "unknown".',
      'ISHONCH (confidence): ayb dalili ANIQ va yagona bo‘lsa "high" ber. Bir nechta ehtimol bo‘lsa, yoki',
      'hal_qilib_bolmaydigan/summa_tuzatish ustun bo‘lsa (bank yoki biz — noaniq) → "low" yoki "medium".',
      'Faqat "high" bo‘lganda foydalanuvchiga aniq ayb ko‘rsatiladi — shubha bo‘lsa "high" BERMA.',
      'Har bir guruh uchun actions‘da "recommend" (bemalol tuzatish), "caution" (ehtiyot, avval ko‘rib chiq) yoki "skip" ber.',
      'Faqat mavjud guruhlar bo‘yicha gapir — yo‘q narsani o‘ylab topma.',
    ].join('\n');

    const tools = [{
      name: 'sverka_diagnosis',
      description: 'Sverka farqi bo‘yicha tashxis: sabab, ayb, tavsiya, guruh bo‘yicha maslahat',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Farqning asosiy sababi, 1-3 jumla, odam tilida, aniq raqamlar bilan' },
          culprit: { type: 'string', enum: ['bank', 'us', 'mixed', 'none', 'unknown'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Ayb (culprit) qanchalik ishonchli. Dalil aniq bo‘lsa "high"; shubha bo‘lsa "low".' },
          severity: { type: 'string', enum: ['info', 'low', 'medium', 'high'] },
          findings: {
            type: 'array',
            description: 'Har bir aniq muammo bo‘yicha qisqa tushuntirish',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                culprit: { type: 'string', enum: ['bank', 'us', 'unknown'] },
                detail: { type: 'string' },
              },
              required: ['title', 'detail'],
            },
          },
          recommendation: { type: 'string', description: 'Nima qilish kerakligi bo‘yicha aniq, amaliy tavsiya' },
          actions: {
            type: 'object',
            description: 'Har bir tuzatish guruhi bo‘yicha tavsiya (recommend / caution / skip)',
            properties: {
              addMissing: { type: 'string', enum: ['recommend', 'caution', 'skip'] },
              fixDates: { type: 'string', enum: ['recommend', 'caution', 'skip'] },
              fixAmounts: { type: 'string', enum: ['recommend', 'caution', 'skip'] },
            },
          },
          cautionNote: { type: 'string', description: 'Ehtiyot qilinadigan holat bo‘lsa (ixtiyoriy)' },
        },
        required: ['summary', 'culprit', 'confidence', 'severity', 'recommendation'],
      },
    }];

    const messages = [{ role: 'user', content: 'Quyidagi sverka natijasini tahlil qil:\n```json\n' + JSON.stringify(ctx, null, 1) + '\n```' }];

    let out: any;
    try {
      // retry/backoff bilan (429/5xx da yiqilmasin)
      out = await this.claudeCall(apiKey, { model, max_tokens: 1400, system, messages, tools, tool_choice: { type: 'tool', name: 'sverka_diagnosis' } });
    } catch (e: any) {
      this.log.warn(`Sverka agent Claude xato: ${e?.message}`);
      throw new BadRequestException(e?.message || 'AI tahlil bajarilmadi');
    }
    if (!out) throw new BadRequestException('AI javob bermadi');

    return this.cacheReturn(cacheKey, {
      ok: true,
      status: rec?.status || 'mismatch',
      diagnosis: {
        summary: String(out.summary || ''),
        culprit: out.culprit || 'unknown',
        confidence: out.confidence || 'low',
        severity: out.severity || 'medium',
        findings: Array.isArray(out.findings) ? out.findings : [],
        recommendation: String(out.recommendation || ''),
        actions: out.actions || {},
        cautionNote: String(out.cautionNote || ''),
      },
      proposed,
      rec,
    });
  }

  /**
   * Tuzatishni bajaradi — FAQAT foydalanuvchi tasdiqlagan guruhlar.
   * Har biri mavjud, sinovdan o‘tgan primitivlar orqali (fixAllMissing /
   * fixAllTxDate / fixAllTxAmount). Oxirida yangi sverka natijasini qaytaradi.
   */
  async apply(
    accountId: string,
    date: string,
    groups: {
      addMissing?: Array<{ b2Id?: string | null; generalId?: string | null }>;
      fixDates?: Array<{ txId: string; newDate: string }>;
      fixAmounts?: Array<{ txId: string; newAmount: number }>;
    },
    actor = 'manual',
  ) {
    if (!accountId) throw new BadRequestException('accountId kerak');
    if (!date) throw new BadRequestException('date kerak');
    const results: any = {};

    if (groups?.addMissing?.length) {
      results.addMissing = await this.reconcile.fixAllMissing(
        accountId, date,
        groups.addMissing.map((i) => ({ b2Id: i.b2Id || undefined, generalId: i.generalId || undefined })),
      );
    }
    if (groups?.fixDates?.length) {
      results.fixDates = await this.reconcile.fixAllTxDate(
        groups.fixDates.map((i) => ({ txId: i.txId, newDate: i.newDate })), actor,
      );
    }
    if (groups?.fixAmounts?.length) {
      results.fixAmounts = await this.reconcile.fixAllTxAmount(
        groups.fixAmounts.map((i) => ({ txId: i.txId, newAmount: Number(i.newAmount) })), actor,
      );
    }

    // Tuzatishdan keyin — yangi sverka (bank fresh olinmaydi, tez)
    const rec: any = await this.reconcile.reconcile(accountId, date, date, { withSync: false });
    return { ok: true, results, rec };
  }

  /**
   * Telegram uchun — tugma bosilganda tanlangan guruhlarni bajaradi.
   * Targetlar FRESH diagnose'dan quriladi (eski tugma bosilса ham to'g'ri),
   * `which` esa qaysi guruhlarni bajarishni belgilaydi (AI tavsiyasi asosida).
   */
  async applyRecommended(
    accountId: string,
    date: string,
    which: { addMissing?: boolean; fixDates?: boolean; fixAmounts?: boolean },
    actor = 'agent',
  ) {
    if (!accountId || !date) throw new BadRequestException('accountId va date kerak');
    // RACE LOCK — bir hisob+kun uchun bir vaqtda faqat bitta tuzatish (web+telegram+
    // ko'p approver bir vaqtda bosса — ikki marta qo'shilish/konflikt bo'lmasin).
    const lockKey = `${accountId}:${date}`;
    if (this.applyLocks.has(lockKey)) {
      throw new BadRequestException("Bu hisob hozir tuzatilmoqda — biroz kuting");
    }
    this.applyLocks.add(lockKey);
    try {
      // Targetlar FRESH diagnose'dan — eski/stale target ishlatilmaydi.
      const diag: any = await this.reconcile.diagnoseDay(accountId, date);
      const p = this.buildProposedActions(diag, date);
      const groups: any = {};
      if (which.addMissing && p.addMissing.length) {
        groups.addMissing = p.addMissing.map((i) => ({ b2Id: i.b2Id, generalId: i.generalId }));
      }
      if (which.fixDates && p.fixDates.length) {
        groups.fixDates = p.fixDates.map((i) => ({ txId: i.txId, newDate: i.newDate }));
      }
      if (which.fixAmounts && p.fixAmounts.length) {
        groups.fixAmounts = p.fixAmounts.map((i) => ({ txId: i.txId, newAmount: i.newAmount }));
      }
      const counts = {
        addMissing: groups.addMissing?.length || 0,
        fixDates: groups.fixDates?.length || 0,
        fixAmounts: groups.fixAmounts?.length || 0,
      };
      const applied = await this.apply(accountId, date, groups, actor);
      this.invalidateAnalyze(accountId, date); // ma'lumot o'zgardi — kesh eskirdi
      return { ...applied, counts };
    } finally {
      this.applyLocks.delete(lockKey);
    }
  }
}
