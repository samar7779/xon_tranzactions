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
  async analyze(accountId: string, date: string, locale = 'uz') {
    if (!accountId) throw new BadRequestException('accountId kerak');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException("date YYYY-MM-DD bo'lishi kerak");
    }

    // 1) Sverka (bir kun) — bank vs DB umumiy
    const rec: any = await this.reconcile.reconcile(accountId, date, date, { withSync: false });
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
      return {
        ok: true, status: 'ok',
        diagnosis: {
          summary: locale === 'ru' ? 'Банк и база полностью совпадают.'
            : locale === 'en' ? 'Bank and database fully match.'
            : 'Bank va baza to‘liq mos — farq yo‘q.',
          culprit: 'none', severity: 'info', findings: [],
          recommendation: '', actions: {}, cautionNote: '',
        },
        proposed, rec,
      };
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
        required: ['summary', 'culprit', 'severity', 'recommendation'],
      },
    }];

    const messages = [{ role: 'user', content: 'Quyidagi sverka natijasini tahlil qil:\n```json\n' + JSON.stringify(ctx, null, 1) + '\n```' }];

    let out: any;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 1400, system, messages, tools, tool_choice: { type: 'tool', name: 'sverka_diagnosis' } }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new BadRequestException(`Claude API xatosi (${res.status}): ${errText.slice(0, 200)}`);
      }
      const data: any = await res.json();
      const toolUse = (data?.content || []).find((c: any) => c.type === 'tool_use');
      out = toolUse?.input || null;
    } catch (e: any) {
      this.log.warn(`Sverka agent Claude xato: ${e?.message}`);
      throw new BadRequestException(e?.message || 'AI tahlil bajarilmadi');
    }
    if (!out) throw new BadRequestException('AI javob bermadi');

    return {
      ok: true,
      status: rec?.status || 'mismatch',
      diagnosis: {
        summary: String(out.summary || ''),
        culprit: out.culprit || 'unknown',
        severity: out.severity || 'medium',
        findings: Array.isArray(out.findings) ? out.findings : [],
        recommendation: String(out.recommendation || ''),
        actions: out.actions || {},
        cautionNote: String(out.cautionNote || ''),
      },
      proposed,
      rec,
    };
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
}
