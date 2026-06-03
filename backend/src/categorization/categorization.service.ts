import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmContractCacheService } from './crm-contract-cache.service';
import { extractContractNumber, extractContractCandidates } from './contract-parser';

/**
 * Tranzaksiya kategoriyalash xizmati.
 *
 * Legacy Google Sheets logikasi (8 qoida — runner.py) NestJS portasi.
 * Qoidalar ketma-ket tatbiq qilinadi. Birinchi mos kelgan to'xtatadi.
 *
 * MUHIM: Agar tranzaksiyada `categoryId` allaqachon bor bo'lsa — TEGILMAYDI.
 * Faqat `force=true` paytida qayta hisoblanadi.
 */

type Direction = 'IN' | 'OUT';

interface CategorizationInput {
  id: string;
  description: string | null;
  fromName: string | null;
  toName: string | null;
  fromInn: string | null;
  toInn: string | null;
  fromAccount: string | null;
  toAccount: string | null;
  direction: string;
  amount: any;
  categoryId: string | null;
  subcategoryId: string | null;
  contractNumber: string | null;
}

interface CategoryRefs {
  // top-level
  CLIENT: string;
  BANK: string;
  SALARY: string;
  TRANSFER: string;
  MINFIN: string;
  LOAN: string;
  COUNTERPARTY_RETURN: string;
  COUNTERPARTY: string;
  // sub-level
  CLIENT_VZNOS_KV: string;
  CLIENT_VZNOS_AVTO: string;
  CLIENT_VOZVRAT: string;
  CLIENT_SCHETCHIK: string;
  CLIENT_PEREOFORM: string;
  BANK_USLUGI: string;
  MINFIN_NDS: string;
  MINFIN_NDFL: string;
  MINFIN_NDFL_DIV: string;
  MINFIN_WATER: string;
  MINFIN_ESP: string;
  MINFIN_WATER_RES: string;
  MINFIN_LAND: string;
  MINFIN_PROPERTY: string;
  MINFIN_PENALTY: string;
  MINFIN_PROFIT: string;
  MINFIN_PENSION: string;
  LOAN_VYDACHA: string;
}

const KEYWORDS_SALARY = [
  'ПЕРЕЧИСЛЯЕТСЯ ЗАРПЛАТА', 'ТРУДОВОЙ ОТПУСК', 'ТУРДОВОЙ ОТПУСК',
  'АЛИМЕНТ', 'БОЛЬНИЧНОГО', 'БОЛНИЧНОГО',
];
const KEYWORDS_BANK = ['CORPORATE', 'ТАРИФ', 'TARIF'];
const KEYWORDS_LOAN = ['(ЗАЙМ)', '(ЗАЕМ)'];
const KEYWORDS_SCHETCHIK = ['HISOBLAGICH', 'ХИСОБЛАГИЧ', 'СЧЕТЧИК'];
const KEYWORD_PEREOFORM = 'ПЕРЕОФОРМЛЕНИЕ';

// Молия Вазирлиги — E ustun (fromName) aniq matn bilan
const MINFIN_FROM_NAMES = [
  'МОЛИЯ ВАЗИРЛИГИ ЯГОНА ГАЗНА ХИСОБВАРАГИ',
  'ЎЗБЕКИСТОН РЕСПУБЛИКАСИ МОЛИЯ ВАЗИРЛИГИ',
];

// Soliq turi → MINFIN subkategoriya keyi (legacy 8 finance_tools.py)
// Bank izohlarida Uzbek Kirill (Қ,Ў,Ғ,Ҳ) va sodda Kirill (К,У,Г,Х) aralash uchraydi
// — har ikki variantni ham kiritamiz. Description UPPER bo'lganidan keyin tekshiriladi.
const TAX_KEYWORDS: Array<[string, keyof CategoryRefs]> = [
  // Suv
  ['ВОДОСНАБЖЕНИЕМ', 'MINFIN_WATER'],
  ['ВОДОСНАБЖЕНИЕ',  'MINFIN_WATER'],
  // ЕСП (Yagona ijtimoiy to'lov)
  ['36 ИЖТИМОИЙ',    'MINFIN_ESP'],
  ['ЯТМФ',           'MINFIN_ESP'],
  ['ЕСП',            'MINFIN_ESP'],
  // Suv resurslari
  ['52 СУВ РЕСУРС',  'MINFIN_WATER_RES'],
  ['СУВ РЕСУРС',     'MINFIN_WATER_RES'],
  // Yer solig'i
  ['53 ЮРИДИК ШАХСЛАР ЕР',  'MINFIN_LAND'],
  ['ЕР СОЛИ',               'MINFIN_LAND'],
  ['НАЛОГ НА ЗЕМЛЮ',        'MINFIN_LAND'],
  // Mol-mulk solig'i
  ['44 ЮРИДИК ШАХСЛАР МОЛ-МУЛК', 'MINFIN_PROPERTY'],
  ['МОЛ-МУЛК',                    'MINFIN_PROPERTY'],
  ['МОЛ МУЛК',                    'MINFIN_PROPERTY'],
  ['НАЛОГ НА ИМУЩЕСТВО',          'MINFIN_PROPERTY'],
  // QQS / NDS
  ['ҚЎШИЛГАН ҚИЙМАТ', 'MINFIN_NDS'],
  ['КУШИЛГАН КИЙМАТ', 'MINFIN_NDS'],
  ['ҚИЙМАТ СОЛИ',     'MINFIN_NDS'],
  ['КИЙМАТ СОЛИ',     'MINFIN_NDS'],
  ['НДС',             'MINFIN_NDS'],
  ['QQS',             'MINFIN_NDS'],
  // NDFL (jismoniy shaxs daromadidan) — dividend BIRINCHI tekshiriladi (specific)
  ['138 ЖИСМОНИЙ',                     'MINFIN_NDFL_DIV'],
  ['ДИВИДЕНД',                         'MINFIN_NDFL_DIV'],
  ['46 ЖИСМОНИЙ ШАХСЛАР ДАРОМАДИДАН', 'MINFIN_NDFL'],
  ['ЖИСМОНИЙ ШАХСЛАР ДАРОМАД',         'MINFIN_NDFL'],
  ['НДФЛ',                              'MINFIN_NDFL'],
  // Jarima
  ['199 СОРЖ',     'MINFIN_PENALTY'],
  ['ЖАРИМА',        'MINFIN_PENALTY'],
  ['ПЕНЯ',          'MINFIN_PENALTY'],
  ['ШТРАФ',         'MINFIN_PENALTY'],
  // Foyda solig'i
  ['100 АЙЛАНМА',  'MINFIN_PROFIT'],
  ['АЙЛАНМАДАН',    'MINFIN_PROFIT'],
  ['ФОЙДА СОЛИ',    'MINFIN_PROFIT'],
  ['НАЛОГ НА ПРИБЫЛЬ', 'MINFIN_PROFIT'],
  // Pensiya badali (101) — fuqarolarning jamg'arib boriladigan pensiya badali
  ['101 ФУҚАРО',                    'MINFIN_PENSION'],
  ['101 ФУКАРО',                    'MINFIN_PENSION'],
  ['ЖАМҒАРИБ БОРИЛАДИГАН ПЕНСИЯ',  'MINFIN_PENSION'],
  ['ЖАМГАРИБ БОРИЛАДИГАН ПЕНСИЯ',  'MINFIN_PENSION'],
  ['ПЕНСИЯ БАДАЛ',                  'MINFIN_PENSION'],
  ['НАКОПИТЕЛЬНОЙ ПЕНСИИ',          'MINFIN_PENSION'],
  ['НАКОПИТЕЛЬНАЯ ПЕНСИЯ',          'MINFIN_PENSION'],
];

export interface CategorizeResult {
  ok: true;
  categoryCode: string | null;
  subcategoryCode: string | null;
  contractNumber: string | null;
  reason: string; // qaysi qoida tatbiq qilingani
}

@Injectable()
export class CategorizationService {
  private readonly log = new Logger(CategorizationService.name);

  // Lock — bir vaqtda bitta toplu run
  private runAllRunning = false;
  private runAllStartedAt: Date | null = null;
  private runAllFinishedAt: Date | null = null;
  private runAllProgress: { done: number; total: number; matched: number; errors: number } | null = null;
  private runAllLastError: string | null = null;
  private runAllRecentErrors: Array<{ txId: string; reason: string; at: string }> = [];

  // XATO shartnomalarni qayta tekshirish progress'i
  private recheckRunning = false;
  private recheckCancelRequested = false;
  private recheckStartedAt: Date | null = null;
  private recheckFinishedAt: Date | null = null;
  private recheckProgress: { done: number; total: number; fixed: number; stillXato: number; errors: number } | null = null;
  private recheckLastError: string | null = null;
  private recheckFilter: { dateFrom?: string; dateTo?: string } | null = null;
  // Tuzatilgan shartnomalar ro'yxati (tekshirish uchun)
  private recheckFixedContracts: Array<{ contractNumber: string; customerName: string | null; objectName: string | null; fixedAt: string }> = [];

  // Kategoriya ID'lari keshi — har safar DB'dan o'qimaslik uchun
  private categoryRefs: CategoryRefs | null = null;
  // O'z hisob raqamlarimiz keshi (Переброска aniqlash uchun)
  private ownAccountsCache: { numbers: Set<string>; loadedAt: number } | null = null;
  private static OWN_ACCOUNTS_TTL = 5 * 60 * 1000; // 5 daqiqa

  constructor(
    private prisma: PrismaService,
    private crmCache: CrmContractCacheService,
  ) {}

  // ────────────────────────── PUBLIC API ──────────────────────────

  /**
   * Bitta tranzaksiyani kategoriyalash.
   *
   * @param txId  tranzaksiya ID
   * @param opts.force  true bo'lsa, mavjud kategoriya ham qayta hisoblanadi (qo'lda override emas)
   * @param opts.actor  'auto' | 'manual' | 'cron' | 'sync'
   */
  async categorizeOne(
    txId: string,
    opts?: { force?: boolean; actor?: 'auto' | 'manual' | 'cron' | 'sync'; actorId?: string },
  ): Promise<CategorizeResult> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      select: this.txSelectFields(),
    });
    if (!tx) throw new Error('Transaction topilmadi');

    return this.runRules(tx as any, opts);
  }

  /**
   * Toplu kategoriyalash — fonda ishlaydi (lock bilan).
   *
   * @param opts.onlyUncategorized  true (default) — faqat categoryId bo'sh bo'lganlarini
   * @param opts.limit  faqat shu sondagi tranzaksiyani (debug uchun)
   */
  runAll(opts?: {
    onlyUncategorized?: boolean;
    limit?: number;
    actorId?: string;
  }): { ok: true; started: boolean; message: string; runningSince?: string } {
    if (this.runAllRunning) {
      const since = this.runAllStartedAt;
      const mins = since ? Math.floor((Date.now() - since.getTime()) / 60000) : 0;
      const p = this.runAllProgress;
      const progStr = p ? ` (${p.done}/${p.total}, mos: ${p.matched})` : '';
      return {
        ok: true,
        started: false,
        message: `Kategoriyalash allaqachon ishlamoqda${progStr} — ${mins} daqiqadan beri.`,
        runningSince: since?.toISOString(),
      };
    }
    this.runInBackground(opts).catch((e) => {
      this.log.error(`runAll background xato: ${e?.message || e}`);
    });
    return {
      ok: true,
      started: true,
      message: 'Kategoriyalash fonda boshlandi.',
    };
  }

  getStatus() {
    return {
      running: this.runAllRunning,
      startedAt: this.runAllStartedAt?.toISOString() || null,
      finishedAt: this.runAllFinishedAt?.toISOString() || null,
      progress: this.runAllProgress,
      lastError: this.runAllLastError,
      recentErrors: this.runAllRecentErrors,
    };
  }

  /**
   * XATO shartnomalarni qayta tekshirish — fonda ishlaydi.
   * Logika:
   *   1) DB'dan barcha uniq XATO shartnomalarni topadi (contractNumber bor, lekin CrmContract.found=false yoki yo'q)
   *   2) Har biri uchun crmCache.lookup() ni majburiy yangilaydi (cache'ni shu shartnoma uchun bekor qilib)
   *   3) Yangi natija topilsa — cache yangilanadi, frontend tx'ni qayta o'qisa 'verified' bo'ladi
   *
   * Kategoriya va shartnoma raqamlariga TEGMAYDI.
   */
  recheckXatoContracts(opts?: { dateFrom?: string; dateTo?: string }): { ok: true; started: boolean; message: string } {
    if (this.recheckRunning) {
      const since = this.recheckStartedAt;
      const mins = since ? Math.floor((Date.now() - since.getTime()) / 60000) : 0;
      const p = this.recheckProgress;
      const progStr = p ? ` (${p.done}/${p.total}, tuzatildi: ${p.fixed})` : '';
      return {
        ok: true,
        started: false,
        message: `Qayta tekshirish allaqachon ishlamoqda${progStr} — ${mins} daqiqadan beri. Avval /cancel chaqiring.`,
      };
    }
    this.recheckFilter = opts && (opts.dateFrom || opts.dateTo) ? opts : null;
    this.runRecheckInBackground().catch((e) => {
      this.log.error(`recheckXato xato: ${e?.message || e}`);
    });
    const dateMsg = this.recheckFilter
      ? ` (${this.recheckFilter.dateFrom || '...'} → ${this.recheckFilter.dateTo || '...'})`
      : '';
    return { ok: true, started: true, message: `XATO shartnomalarni qayta tekshirish fonda boshlandi${dateMsg}.` };
  }

  cancelRecheck(): { ok: true; cancelled: boolean; message: string } {
    if (!this.recheckRunning) {
      return { ok: true, cancelled: false, message: 'Qayta tekshirish ishlamayapti.' };
    }
    this.recheckCancelRequested = true;
    return { ok: true, cancelled: true, message: "Bekor qilish so'raldi — joriy batch tugagandan keyin to'xtaydi (~3-5 sek)." };
  }

  getRecheckStatus() {
    return {
      running: this.recheckRunning,
      cancelRequested: this.recheckCancelRequested,
      startedAt: this.recheckStartedAt?.toISOString() || null,
      finishedAt: this.recheckFinishedAt?.toISOString() || null,
      filter: this.recheckFilter,
      progress: this.recheckProgress,
      lastError: this.recheckLastError,
      fixedCount: this.recheckFixedContracts.length,
      // Faqat oxirgi 20 ta — preview uchun
      recentFixed: this.recheckFixedContracts.slice(-20).reverse(),
    };
  }

  /**
   * Tuzatilgan shartnomalarning to'liq ro'yxati (CSV export uchun ham mos).
   * Har bir shartnomaga taalluqli tx ID lari (internal + external) ham qaytariladi.
   * @param limit max 5000 (xavfsizlik)
   * @param withTxIds  true (default) — har bir shartnoma uchun tx ID larni ham qaytaradi
   * @param maxTxPerContract  har bir shartnomaga max nechta tx ID (default 50)
   */
  async getRecheckFixedList(limit = 5000, withTxIds = true, maxTxPerContract = 50): Promise<{
    ok: true;
    total: number;
    items: Array<{
      contractNumber: string;
      customerName: string | null;
      objectName: string | null;
      fixedAt: string;
      txCount: number;
      txIds?: Array<{ id: string; externalId: string | null; txnDate: string | null; amount: string }>;
    }>;
  }> {
    const safeLimit = Math.min(Math.max(limit, 1), 5000);
    const fixed = this.recheckFixedContracts.slice(-safeLimit).reverse();

    const contracts = fixed.map((f) => f.contractNumber);
    const txCounts = new Map<string, number>();
    const txsByContract = new Map<string, Array<{ id: string; externalId: string | null; txnDate: string | null; amount: string }>>();

    if (contracts.length > 0) {
      // 1) Count: groupBy 500/chunk
      for (let i = 0; i < contracts.length; i += 500) {
        const chunk = contracts.slice(i, i + 500);
        const grouped = await this.prisma.transaction.groupBy({
          by: ['contractNumber'],
          where: { contractNumber: { in: chunk } },
          _count: true,
        });
        for (const g of grouped) {
          if (g.contractNumber) txCounts.set(g.contractNumber, g._count);
        }
      }

      // 2) Tx ID lar (har shartnoma uchun maxTxPerContract tagacha)
      if (withTxIds) {
        for (let i = 0; i < contracts.length; i += 500) {
          const chunk = contracts.slice(i, i + 500);
          const txs = await this.prisma.transaction.findMany({
            where: { contractNumber: { in: chunk } },
            select: { id: true, externalId: true, txnDate: true, amount: true, contractNumber: true },
            orderBy: { txnDate: 'desc' },
          });
          for (const tx of txs) {
            if (!tx.contractNumber) continue;
            const list = txsByContract.get(tx.contractNumber) || [];
            if (list.length < maxTxPerContract) {
              list.push({
                id: tx.id,
                externalId: tx.externalId,
                txnDate: tx.txnDate?.toISOString().slice(0, 10) || null,
                amount: tx.amount.toString(),
              });
              txsByContract.set(tx.contractNumber, list);
            }
          }
        }
      }
    }

    return {
      ok: true,
      total: this.recheckFixedContracts.length,
      items: fixed.map((f) => ({
        ...f,
        txCount: txCounts.get(f.contractNumber) || 0,
        ...(withTxIds ? { txIds: txsByContract.get(f.contractNumber) || [] } : {}),
      })),
    };
  }

  private async runRecheckInBackground(): Promise<void> {
    this.recheckRunning = true;
    this.recheckCancelRequested = false;
    this.recheckStartedAt = new Date();
    this.recheckFinishedAt = null;
    this.recheckLastError = null;
    this.recheckProgress = { done: 0, total: 0, fixed: 0, stillXato: 0, errors: 0 };
    this.recheckFixedContracts = []; // yangi run — eski ro'yxatni tozalaymiz

    try {
      // 1) Verified shartnomalar ro'yxati (bularni o'tkazib yuboramiz)
      const verified = await this.prisma.crmContract.findMany({
        where: { found: true },
        select: { contractNumber: true },
      });
      const verifiedSet = new Set(verified.map((c) => c.contractNumber));

      // 2) DB'dan uniq XATO shartnomalarni topamiz — sana filtri bilan
      const txWhere: any = { contractNumber: { not: null } };
      if (this.recheckFilter?.dateFrom || this.recheckFilter?.dateTo) {
        txWhere.txnDate = {};
        if (this.recheckFilter.dateFrom) {
          txWhere.txnDate.gte = new Date(`${this.recheckFilter.dateFrom}T00:00:00+05:00`);
        }
        if (this.recheckFilter.dateTo) {
          txWhere.txnDate.lte = new Date(`${this.recheckFilter.dateTo}T23:59:59.999+05:00`);
        }
      }
      const allTxContracts = await this.prisma.transaction.findMany({
        where: txWhere,
        select: { contractNumber: true },
        distinct: ['contractNumber'],
      });
      const xatoContracts = allTxContracts
        .map((t) => t.contractNumber!)
        .filter((c) => !verifiedSet.has(c));

      this.recheckProgress.total = xatoContracts.length;
      this.log.log(
        `recheckXato: ${xatoContracts.length} ta uniq XATO shartnoma tekshiriladi` +
        (this.recheckFilter ? ` (filter: ${this.recheckFilter.dateFrom || '...'} → ${this.recheckFilter.dateTo || '...'})` : ''),
      );

      // 3) Har birini cache'dan o'chirib (force refresh uchun), lookup chaqiramiz
      const CONCURRENCY = 3; // CRM API rate limit uchun ehtiyot
      for (let i = 0; i < xatoContracts.length; i += CONCURRENCY) {
        // CANCEL CHECK — har batch boshlanishidan oldin
        if (this.recheckCancelRequested) {
          this.log.log(`recheckXato bekor qilindi (${this.recheckProgress.done}/${this.recheckProgress.total})`);
          break;
        }
        const batch = xatoContracts.slice(i, i + CONCURRENCY);
        await Promise.allSettled(
          batch.map(async (contract) => {
            try {
              // Avval keshdan o'chiramiz — fresh lookup uchun
              await this.prisma.crmContract.deleteMany({
                where: { contractNumber: contract, found: false },
              });
              const result = await this.crmCache.lookup(contract);
              if (result?.found) {
                this.recheckProgress!.fixed++;
                this.recheckFixedContracts.push({
                  contractNumber: contract,
                  customerName: result.customerName || null,
                  objectName: result.objectName || null,
                  fixedAt: new Date().toISOString(),
                });
              } else {
                this.recheckProgress!.stillXato++;
              }
            } catch (e: any) {
              this.recheckProgress!.errors++;
              this.log.warn(`recheckXato shartnoma xato (${contract}): ${e?.message}`);
            }
          }),
        );
        this.recheckProgress.done = Math.min(i + CONCURRENCY, xatoContracts.length);
      }
    } catch (e: any) {
      this.recheckLastError = e?.message || String(e);
      this.log.error(`recheckXato umumiy xato: ${this.recheckLastError}`);
    } finally {
      this.recheckRunning = false;
      this.recheckCancelRequested = false;
      this.recheckFinishedAt = new Date();
      this.log.log(`recheckXato yakunlandi: ${JSON.stringify(this.recheckProgress)}`);
    }
  }

  /**
   * Bir martalik: DB dagi Transaction.contractNumber larda № yoki bo'shliq bo'lganlarni
   * tozalaydi (eski qatorlar uchun, yangi yozuvlar avtomatik tozalanadi).
   * Returns: nechta qator yangilangani.
   */
  async cleanupContractNumberSymbols(): Promise<{ ok: true; cleaned: number; samples: Array<{ id: string; old: string; new: string }> }> {
    // № yoki bo'shliq bo'lgan contractNumber li tx larni topamiz
    const dirty = await this.prisma.transaction.findMany({
      where: {
        OR: [
          { contractNumber: { contains: '№' } },
          { contractNumber: { contains: ' ' } },
        ],
      },
      select: { id: true, contractNumber: true },
      take: 5000,
    });

    let cleaned = 0;
    const samples: Array<{ id: string; old: string; new: string }> = [];

    for (const tx of dirty) {
      if (!tx.contractNumber) continue;
      const newContract = tx.contractNumber
        .replace(/№/g, '')
        .replace(/N°/g, '')
        .replace(/\s+/g, '')
        .trim()
        .toUpperCase();
      if (newContract === tx.contractNumber) continue;
      if (!newContract) continue;
      try {
        await this.prisma.transaction.update({
          where: { id: tx.id },
          data: { contractNumber: newContract },
        });
        if (samples.length < 10) {
          samples.push({ id: tx.id, old: tx.contractNumber, new: newContract });
        }
        cleaned++;
      } catch (e: any) {
        this.log.warn(`cleanupContractNumberSymbols xato (${tx.id}): ${e?.message}`);
      }
    }
    this.log.log(`cleanupContractNumberSymbols: ${cleaned}/${dirty.length} qator yangilandi`);
    return { ok: true, cleaned, samples };
  }

  /**
   * Bitta shartnomani CRM da QAYTA tekshirish — eski cache o'chiriladi va fresh lookup.
   * Foydalanuvchi 'CRM topmadi' deb hisoblangan shartnoma haqiqatda CRM da bor deb
   * o'ylaganda chaqiriladi (cache stale bo'lsa).
   */
  async refreshContractCache(contractNumber: string): Promise<{
    ok: boolean;
    found: boolean;
    customerName: string | null;
    objectName: string | null;
    contractNumber: string;
  }> {
    const key = contractNumber.trim().toUpperCase();
    if (!key) throw new BadRequestException('Shartnoma raqami bo\'sh');

    // Eski cache (found=false ham, true ham) o'chiramiz — fresh lookup
    await this.prisma.crmContract.deleteMany({
      where: { contractNumber: key },
    });

    // Yangi lookup
    const result = await this.crmCache.lookup(key);
    return {
      ok: true,
      found: !!result?.found,
      customerName: result?.customerName || null,
      objectName: result?.objectName || null,
      contractNumber: key,
    };
  }

  /**
   * Foydalanuvchi qo'lda kategoriya qo'yadi — har doim ustidan yoziladi.
   * subcategoryId null bo'lsa, faqat top-level qo'yiladi.
   */
  async setManual(
    txId: string,
    body: { categoryId: string | null; subcategoryId?: string | null },
    actorId: string,
  ): Promise<{ ok: true }> {
    // Subkategoriya parent'i — top kategoriya bo'lishi kerak
    if (body.subcategoryId) {
      const sub = await this.prisma.category.findUnique({ where: { id: body.subcategoryId } });
      if (!sub) throw new Error('Subkategoriya topilmadi');
      if (body.categoryId && sub.parentId !== body.categoryId) {
        throw new Error("Subkategoriya tanlangan top kategoriyaga tegishli emas");
      }
      if (!body.categoryId) body.categoryId = sub.parentId;
    }

    // Eskisini olamiz (tarix uchun)
    const old = await this.prisma.transaction.findUnique({
      where: { id: txId },
      select: { categoryId: true, subcategoryId: true, contractNumber: true },
    });

    await this.prisma.transaction.update({
      where: { id: txId },
      data: {
        categoryId: body.categoryId,
        subcategoryId: body.subcategoryId || null,
        categorizedAt: new Date(),
        categorizedBy: 'manual',
        categorizedById: actorId,
      },
    });

    // Tarix yozish
    await this.logHistory(txId, {
      action: 'manual',
      actorId,
      oldCategoryId: old?.categoryId || null,
      oldSubcategoryId: old?.subcategoryId || null,
      newCategoryId: body.categoryId,
      newSubcategoryId: body.subcategoryId || null,
      contractNumber: old?.contractNumber || null,
      reason: "qo'lda o'zgartirildi",
    });

    return { ok: true };
  }

  /**
   * Shartnoma raqamini qo'lda o'zgartirish — CRM'da tasdiqlanmasa rad etadi.
   * Faqat verified shartnomalarni qabul qiladi (yoki null — o'chirish).
   */
  async setContract(txId: string, contractNumber: string | null, actorId: string): Promise<{
    ok: true;
    verified: boolean;
    customerName: string | null;
    oplataKvSync?: Awaited<ReturnType<typeof this.syncContractChangeToOplataKv>>;
  }> {
    const old = await this.prisma.transaction.findUnique({
      where: { id: txId },
      select: { contractNumber: true, categoryId: true, subcategoryId: true, externalId: true },
    });
    if (!old) throw new BadRequestException('Tranzaksiya topilmadi');

    // № va N° simbollarini olib tashlaymiz + bo'shliqlarni tozalaymiz
    const newContract = contractNumber
      ? contractNumber.replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').trim().toUpperCase() || null
      : null;
    let verified = false;
    let customerName: string | null = null;

    // CRM'da tekshirish — manual saqlashda majburiy
    if (newContract) {
      const cached = await this.crmCache.lookup(newContract);
      verified = !!cached?.found;
      customerName = cached?.customerName || null;
      if (!verified) {
        throw new BadRequestException(
          `Shartnoma "${newContract}" CRM'da topilmadi. Qayta tekshiring yoki Tozalash bilan o'chiring.`,
        );
      }
    }

    await this.prisma.transaction.update({
      where: { id: txId },
      data: {
        contractNumber: newContract,
        isContractManual: false, // CRM bilan tasdiqlangan
      },
    });

    const u = await this.prisma.adminUser.findUnique({ where: { id: actorId }, select: { email: true } });

    // Tarixga to'g'ridan-to'g'ri yozish (logHistory'da kategoriya o'zgarmagani uchun skip bo'lar edi)
    if (old.contractNumber !== newContract) {
      try {
        await this.prisma.transactionCategoryHistory.create({
          data: {
            txId,
            action: 'manual',
            actorId,
            actorName: u?.email || null,
            oldCategoryId: old.categoryId,
            oldSubcategoryId: old.subcategoryId,
            newCategoryId: old.categoryId,
            newSubcategoryId: old.subcategoryId,
            contractNumber: newContract,
            reason: newContract
              ? `shartnoma → ${newContract}${verified ? ` (CRM: ${customerName})` : ' (CRM xato)'}`
              : "shartnoma o'chirildi",
          },
        });
      } catch (e: any) {
        this.log.warn(`setContract history yozishda xato (${txId}): ${e?.message}`);
      }
    }

    // OplataKv propagation — HAR safar ishlaydi (user feedback uchun)
    const oplataKvSync = await this.syncContractChangeToOplataKv({
      txId,
      externalId: old.externalId,
      oldContract: old.contractNumber,
      newContract,
      actorEmail: u?.email || null,
      reason: 'setContract',
    });

    return { ok: true, verified, customerName, oplataKvSync };
  }

  /**
   * Kontragentni qo'lda biriktirish (Counterparty jadvalidan).
   * INN avto-lookup ustidan ishlaydi — list/detail display'da bu birikma ustun.
   * null bo'lsa — biriktirish o'chiriladi (qaytadan avto-lookup).
   */
  async setCounterparty(txId: string, counterpartyId: string | null, actorId: string): Promise<{ ok: true; counterparty: { id: string; inn: string; name: string } | null }> {
    const old = await this.prisma.transaction.findUnique({
      where: { id: txId },
      select: {
        manualCounterpartyId: true,
        manualCounterparty: { select: { id: true, inn: true, name: true } },
      },
    });
    if (!old) throw new BadRequestException('Tranzaksiya topilmadi');

    let cp: { id: string; inn: string; name: string } | null = null;
    if (counterpartyId) {
      const found = await this.prisma.counterparty.findUnique({
        where: { id: counterpartyId },
        select: { id: true, inn: true, name: true },
      });
      if (!found) throw new BadRequestException('Kontragent topilmadi');
      cp = found;
    }

    await this.prisma.transaction.update({
      where: { id: txId },
      data: { manualCounterpartyId: counterpartyId },
    });

    // Tarixga yozish — action='counterparty' (frontend alohida render qiladi)
    // Eski/yangi nomlar oldCategoryName/newCategoryName ga yoziladi (schema o'zgarishsiz)
    if (old.manualCounterpartyId !== counterpartyId) {
      const u = await this.prisma.adminUser.findUnique({ where: { id: actorId }, select: { email: true } });
      const oldName = old.manualCounterparty?.name || null;
      const newName = cp?.name || null;
      try {
        await this.prisma.transactionCategoryHistory.create({
          data: {
            txId,
            action: 'counterparty',
            actorId,
            actorName: u?.email || null,
            // Counterparty nomini category name maydoniga yozamiz (schema o'zgartirmasdan, UI tushunadi)
            oldCategoryName: oldName,
            newCategoryName: newName,
            reason: cp
              ? `Kontragent biriktirildi (INN ${cp.inn})`
              : "Kontragent biriktirilishi o'chirildi",
          },
        });
      } catch (e: any) {
        this.log.warn(`setCounterparty history yozishda xato (${txId}): ${e?.message}`);
      }
    }

    return { ok: true, counterparty: cp };
  }

  /**
   * Shartnoma raqamini qo'lda kiritish — CRM tekshirilmaydi.
   * setContract() dan farqi: CRM'da bo'lmasa ham qabul qiladi.
   * Foydalanuvchi javobgar (masalan, CRM'ga hali qo'shilmagan yangi shartnoma).
   */
  async setContractManual(txId: string, contractNumber: string | null, actorId: string): Promise<{
    ok: true;
    contractNumber: string | null;
    oplataKvSync?: Awaited<ReturnType<typeof this.syncContractChangeToOplataKv>>;
  }> {
    const old = await this.prisma.transaction.findUnique({
      where: { id: txId },
      select: { contractNumber: true, isContractManual: true, externalId: true },
    });
    if (!old) throw new BadRequestException('Tranzaksiya topilmadi');

    // № va N° simbollarini olib tashlaymiz + bo'shliqlarni tozalaymiz
    const newContract = contractNumber
      ? contractNumber.replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').trim().toUpperCase() || null
      : null;
    if (newContract && newContract.length > 128) {
      throw new BadRequestException('Shartnoma raqami juda uzun (max 128 belgi)');
    }

    await this.prisma.transaction.update({
      where: { id: txId },
      data: {
        contractNumber: newContract,
        isContractManual: !!newContract, // qo'lda kiritildi marker
      },
    });

    const u = await this.prisma.adminUser.findUnique({ where: { id: actorId }, select: { email: true } });

    // Tarixga yozish — faqat haqiqiy o'zgarish bo'lganda
    if (old.contractNumber !== newContract) {
      try {
        await this.prisma.transactionCategoryHistory.create({
          data: {
            txId,
            action: 'contract',
            actorId,
            actorName: u?.email || null,
            oldCategoryName: old.contractNumber,
            newCategoryName: newContract,
            contractNumber: newContract,
            reason: newContract
              ? `Shartnoma qo'lda kiritildi (CRM tekshirilmagan)`
              : "Shartnoma raqami o'chirildi",
          },
        });
      } catch (e: any) {
        this.log.warn(`setContractManual history yozishda xato (${txId}): ${e?.message}`);
      }
    }

    // OplataKv propagation — HAR safar ishlaydi (user feedback uchun)
    // Eski shartnoma = yangi bo'lsa ham, OplataKv qaytarilgan ma'lumotlarni ko'rsatish
    // foydalanuvchiga shartnoma sinxron ekanligini bildiradi.
    const oplataKvSync = await this.syncContractChangeToOplataKv({
      txId,
      externalId: old.externalId,
      oldContract: old.contractNumber,
      newContract,
      actorEmail: u?.email || null,
      reason: 'setContractManual',
    });

    return { ok: true, contractNumber: newContract, oplataKvSync };
  }

  /**
   * Tranzaksiyaning contractNumber'i o'zgarganda, OplatyKv'dagi shu source tx
   * uchun yaratilgan qatorni TO'LIQ yangilaydi.
   *
   * User talabi: "qachonki bu xato tolovlar tranzaksiyada togrlnsa oplata kvda
   * xam togrlanish kere ... update bolganda barcha malumoti update olish kere"
   * — barcha maydonlar tranzaksiyadan qayta o'qib yangilanadi (faqat contractNo
   * emas).
   *
   * Yangilanadi: contractNo, date, paymentAmount, purpose, txType, client,
   * object. firstInstallment/monthlyAmount — tozalanadi, keyingi background
   * splitInstallments yangi shartnoma asosida qayta hisoblaydi (CRM
   * payment_histories API kerak).
   */
  private async syncContractChangeToOplataKv(p: {
    txId: string;
    externalId: string | null;
    oldContract: string | null;
    newContract: string | null;
    actorEmail: string | null;
    reason: string;
  }): Promise<{
    updated: boolean;
    skipped?: 'not-client' | 'no-row' | 'no-new-contract' | 'multiple-matches' | 'error';
    oplataKvId?: string;
    contractNo?: string;
    date?: string;
    paymentAmount?: string;
    object?: string | null;
    client?: string | null;
    txType?: string | null;
  }> {
    // Agar yangi shartnoma null bo'lsa — bog'langan OplataKv qatorni tozalash:
    // contractNo='xato' qilamiz va sourceTxId'ni uzamiz. Foydalanuvchi keyin
    // OplataKv'da qo'lda tartibga solishi mumkin.
    if (!p.newContract) {
      const dedupKeys = Array.from(new Set([p.externalId, p.txId].filter((x): x is string => !!x)));
      if (dedupKeys.length === 0) return { updated: false, skipped: 'no-new-contract' };
      try {
        const linked = await this.prisma.oplataKv.findFirst({
          where: { sourceTxId: { in: dedupKeys } },
          select: { id: true, contractNo: true },
        });
        if (linked) {
          await this.prisma.oplataKv.update({
            where: { id: linked.id },
            data: {
              contractNo: 'xato',  // shartnoma noma'lum belgi
              sourceTxId: null,    // bog'lanish uziladi
              firstInstallment: null,
              monthlyAmount: null,
              paymentCategory: null,
              object: null,
            },
          });
          await this.prisma.oplataKvHistory.create({
            data: {
              oplataKvId: linked.id,
              action: 'edited',
              actorType: 'system',
              actorId: null,
              actorName: p.actorEmail ? `tranzaksiyadan (${p.actorEmail})` : 'tranzaksiyadan',
              fieldsChanged: ['contractNo', 'sourceTxId', 'firstInstallment', 'monthlyAmount', 'object'],
              changes: { contractNo: { old: linked.contractNo, new: 'xato' } } as any,
              note: `Tranzaksiyada shartnoma raqami tozalandi (${p.reason}, txId: ${p.txId}) — OplataKv qator XATO holatga qaytarildi`,
            },
          });
          this.log.log(`OplataKv ${linked.id} reset to xato — tx ${p.txId} contract cleared`);
        }
      } catch (e: any) {
        this.log.warn(`OplataKv reset xato (txId=${p.txId}): ${e?.message}`);
      }
      return { updated: false, skipped: 'no-new-contract' };
    }

    try {
      const dedupKeys = Array.from(new Set([p.externalId, p.txId].filter((x): x is string => !!x)));

      // 1) Tranzaksiyaning to'liq holatini o'qish — barcha qaytariladigan maydonlar
      const tx = await this.prisma.transaction.findUnique({
        where: { id: p.txId },
        select: {
          txnDate: true,
          amount: true,
          direction: true,
          description: true,
          fromName: true,
          toName: true,
          source: true,
          subcategory: { select: { name: true } },
          category: { select: { code: true, name: true } },
          importCounterpartyText: true,
        },
      });
      if (!tx || !tx.txnDate) return { updated: false, skipped: 'error' };

      // CLIENT (Клиент/Физ.Л/Юр.Л) belgisini tekshirish — barcha mumkin
      // bo'lgan kanallar bo'yicha:
      //   1) category.code === 'CLIENT' (auto-categorization)
      //   2) category.name matn 'Клиент' yoki 'Физ.Л' yoki 'Юр.Л' bilan boshlanadi
      //   3) IMPORT manbada importCounterpartyText shu pattern'ga mos
      // Boshqa kategoriyalar (BANK, MINFIN, SALARY...) — OplatyKv'da yo'q,
      // shuning uchun propagation kerak emas.
      const clientPattern = /клиент|физ\.?\s*л|юр\.?\s*л/i;
      const isClient =
        tx.category?.code === 'CLIENT' ||
        (tx.category?.name && clientPattern.test(tx.category.name)) ||
        (tx.source === 'IMPORT' && tx.importCounterpartyText && clientPattern.test(tx.importCounterpartyText));
      if (!isClient) {
        this.log.log(`OplatyKv propagation skipped (not CLIENT): txId=${p.txId}, ` +
          `code=${tx.category?.code}, name=${tx.category?.name}, source=${tx.source}, ` +
          `importCp=${tx.importCounterpartyText}`);
        return { updated: false, skipped: 'not-client' };
      }

      // 2) OplatyKv qatorini topish — 2 ta strategiya:
      //    a) sourceTxId bo'yicha (tx-sync orqali yaratilgan qatorlar)
      //    b) Excel-import qatorlar (sourceTxId=null) — eski shartnoma + sana + summa orqali
      let row: { id: string; contractNo: string } | null = null;

      if (dedupKeys.length > 0) {
        row = await this.prisma.oplataKv.findFirst({
          where: { sourceTxId: { in: dedupKeys } },
          select: { id: true, contractNo: true },
        });
      }

      // Fallback — Excel-import qatorlar uchun
      // 2 ta strategiya:
      //   (a) Eski shartnoma + sana + summa bo'yicha (eski shartnoma "xato" deb saqlangan bo'lsa)
      //   (b) Faqat sana + summa bo'yicha (har qanday shartnoma) — agar (a) topa olmasa
      if (!row) {
        const rawAmount = Math.abs(Number(tx.amount));
        const signedAmount = tx.direction === 'IN' ? rawAmount : -rawAmount;
        // Sana — Tashkent kalendari kuni
        const tashTime = new Date(tx.txnDate.getTime() + 5 * 60 * 60 * 1000);
        const dayStart = new Date(Date.UTC(
          tashTime.getUTCFullYear(), tashTime.getUTCMonth(), tashTime.getUTCDate(),
        ));
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

        // Strategy (a) — old contract + date + amount
        if (p.oldContract && p.oldContract !== p.newContract) {
          const candidates = await this.prisma.oplataKv.findMany({
            where: {
              contractNo: p.oldContract,
              date: { gte: dayStart, lte: dayEnd },
              paymentAmount: new Prisma.Decimal(signedAmount),
              sourceTxId: null,
            },
            select: { id: true, contractNo: true },
            take: 2,
          });
          if (candidates.length === 1) {
            row = candidates[0];
          } else if (candidates.length > 1) {
            this.log.warn(`OplatyKv strategy-a: ${candidates.length} ta moslik (txId=${p.txId})`);
          }
        }

        // Strategy (b) — faqat sana + summa (har qanday contractNo, lekin newContract'dan farqli)
        // Bu hol: foydalanuvchi avval shartnomani to'g'irlagan (Transaction'da), lekin
        // o'sha vaqtda propagation ishlamagan (OplataKv'da hali eski "xato" turibdi).
        if (!row) {
          const candidates = await this.prisma.oplataKv.findMany({
            where: {
              date: { gte: dayStart, lte: dayEnd },
              paymentAmount: new Prisma.Decimal(signedAmount),
              sourceTxId: null,
              NOT: { contractNo: p.newContract }, // Yangi shartnoma bilan teng emas — yangilanish kerak
            },
            select: { id: true, contractNo: true },
            take: 2,
          });
          if (candidates.length === 1) {
            row = candidates[0];
            this.log.log(`OplatyKv strategy-b: matched by date+amount, old contractNo=${row.contractNo} (txId=${p.txId})`);
          } else if (candidates.length > 1) {
            this.log.warn(`OplatyKv strategy-b: ${candidates.length} ta moslik (txId=${p.txId})`);
          }
        }

        // Topgan qatorni tx ga bog'laymiz (kelajakda dublikat sync bo'lmasin)
        if (row && (p.externalId || p.txId)) {
          try {
            await this.prisma.oplataKv.update({
              where: { id: row.id },
              data: { sourceTxId: p.externalId || p.txId },
            });
            this.log.log(`OplatyKv ${row.id} linked to tx ${p.txId} via fallback match`);
          } catch (e: any) {
            this.log.warn(`OplatyKv sourceTxId link xato: ${e?.message}`);
          }
        }
      }

      if (!row) return { updated: false, skipped: 'no-row' };

      // 3) CRM ma'lumotlarini olish — multi-layer fallback
      //    a) Cache'dan o'qish (oddiy lookup)
      //    b) DB'dagi yozuvni o'qish
      //    c) Object yo'q bo'lsa — forceRefresh bilan LIVE CRM API'ga
      //       so'rov yuborish (cache'ni majburiy yangilash)
      let crmCustomer: string | null = null;
      let crmObject: string | null = null;
      try {
        const cached = await this.crmCache.lookup(p.newContract);
        if (cached) {
          crmCustomer = cached.customerName || null;
          crmObject = cached.objectName || null;
        }
      } catch (e: any) {
        this.log.warn(`CRM lookup xato (${p.newContract}): ${e?.message}`);
      }
      if (!crmCustomer || !crmObject) {
        const fromDb = await this.prisma.crmContract.findFirst({
          where: { contractNumber: p.newContract },
          select: { customerName: true, objectName: true },
        });
        if (fromDb) {
          crmCustomer = crmCustomer || fromDb.customerName;
          crmObject = crmObject || fromDb.objectName;
        }
      }
      // Agar object hali ham bo'sh bo'lsa — forceRefresh bilan CRM API'dan tortish
      if (!crmObject) {
        try {
          const fresh = await this.crmCache.lookup(p.newContract, { forceRefresh: true });
          if (fresh) {
            crmCustomer = crmCustomer || fresh.customerName || null;
            crmObject = fresh.objectName || null;
            this.log.log(`CRM forceRefresh (${p.newContract}): customer=${crmCustomer ? 'set' : 'NULL'}, object=${crmObject || 'NULL'}`);
          }
        } catch (e: any) {
          this.log.warn(`CRM forceRefresh xato (${p.newContract}): ${e?.message}`);
        }
      }
      const crm = { customerName: crmCustomer, objectName: crmObject };

      // 4) Object mapping (CRM nomi -> OplatyKv nomi)
      let mappedObject: string | null = null;
      if (crm.objectName) {
        const mapping = await this.prisma.oplataKvObjectMapping.findFirst({
          where: { crmName: { equals: crm.objectName, mode: 'insensitive' } },
          select: { oplataName: true },
        });
        mappedObject = mapping?.oplataName || crm.objectName;
      }

      // 5) Yangi qiymatlarni hisoblash (syncFromTransactions bilan bir xil mantiq)
      const finalRawAmount = Math.abs(Number(tx.amount));
      const finalSignedAmount = tx.direction === 'IN' ? finalRawAmount : -finalRawAmount;
      const txParty = tx.direction === 'IN' ? tx.fromName : tx.toName;
      const txTypeName = (tx as any).subcategory?.name
        || (tx.direction === 'IN' ? 'Взносы за квартиры' : 'Возврат взносов за кв.');

      // Sana — Tashkent kalendari (timezone shift'ni oldini olish)
      const tashTimeUpd = new Date(tx.txnDate.getTime() + 5 * 60 * 60 * 1000);
      const tashkentDateUpd = new Date(Date.UTC(
        tashTimeUpd.getUTCFullYear(), tashTimeUpd.getUTCMonth(), tashTimeUpd.getUTCDate(),
      ));

      // 6) Atomic update — barcha derivat maydonlar
      await this.prisma.oplataKv.update({
        where: { id: row.id },
        data: {
          contractNo: p.newContract,
          date: tashkentDateUpd,
          paymentAmount: new Prisma.Decimal(finalSignedAmount),
          purpose: tx.description || null,
          txType: txTypeName,
          client: crm?.customerName || txParty || null,
          object: mappedObject,
          // Splitni reset qilamiz — frontend'dan /oplata-kv/:id/split chaqirib
          // (yoki background splitInstallments) qayta hisoblanadi
          firstInstallment: null,
          monthlyAmount: null,
          paymentCategory: null,
          // MANBA ustunida "Qo'lda" badge ko'rsatish uchun
          wasManuallyEdited: true,
        },
      });

      await this.prisma.oplataKvHistory.create({
        data: {
          oplataKvId: row.id,
          action: 'edited',
          actorType: 'system',
          actorId: null,
          actorName: p.actorEmail ? `tranzaksiyadan (${p.actorEmail})` : 'tranzaksiyadan',
          fieldsChanged: [
            'contractNo', 'date', 'paymentAmount', 'purpose', 'txType',
            'client', 'object', 'firstInstallment', 'monthlyAmount',
          ],
          changes: {
            contractNo: { old: row.contractNo, new: p.newContract },
          } as any,
          note: `Tranzaksiya contractNumber o'zgartirildi (${p.reason}, txId: ${p.txId}) — barcha maydonlar tranzaksiyadan qayta o'qildi`,
        },
      });

      return {
        updated: true,
        oplataKvId: row.id,
        contractNo: p.newContract,
        date: tashkentDateUpd.toISOString().slice(0, 10),
        paymentAmount: String(finalSignedAmount),
        object: mappedObject,
        client: crm?.customerName || txParty || null,
        txType: txTypeName,
      };
    } catch (e: any) {
      // Bu bog'liq operatsiya — asosiy setContract muvaffaqiyatli qaytishi kerak
      this.log.warn(`syncContractChangeToOplataKv xato (txId=${p.txId}): ${e?.message}`);
      return { updated: false, skipped: 'error' };
    }
  }

  /** Tranzaksiya kategoriya tarixi (eng yangidan oldingiga) */
  async getHistory(txId: string, limit = 50) {
    const items = await this.prisma.transactionCategoryHistory.findMany({
      where: { txId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { ok: true, items };
  }

  /**
   * Tarixga yozuv qo'shadi — eski va yangi kategoriya nomlarini ham resolve qiladi.
   * O'zgarish bo'lmasa (eski va yangi bir xil) — skip.
   */
  private async logHistory(
    txId: string,
    p: {
      action: string;
      actorId?: string | null;
      oldCategoryId: string | null;
      oldSubcategoryId: string | null;
      newCategoryId: string | null;
      newSubcategoryId: string | null;
      contractNumber: string | null;
      reason: string;
    },
  ): Promise<void> {
    // O'zgarish bo'lmasa — yozmaymiz (shovqin kamaytirish)
    if (
      p.oldCategoryId === p.newCategoryId &&
      p.oldSubcategoryId === p.newSubcategoryId
    ) {
      return;
    }

    // Kategoriya nomlarini olamiz
    const ids = [p.oldCategoryId, p.oldSubcategoryId, p.newCategoryId, p.newSubcategoryId].filter(Boolean) as string[];
    const cats = ids.length > 0
      ? await this.prisma.category.findMany({ where: { id: { in: Array.from(new Set(ids)) } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(cats.map((c) => [c.id, c.name]));

    // Actor email olamiz (manual uchun)
    let actorName: string | null = null;
    if (p.action === 'manual' && p.actorId) {
      const u = await this.prisma.adminUser.findUnique({ where: { id: p.actorId }, select: { email: true } });
      actorName = u?.email || null;
    } else if (p.action === 'sync') actorName = 'sync';
    else if (p.action === 'cron') actorName = 'cron';
    else if (p.action === 'auto') actorName = 'auto';

    try {
      await this.prisma.transactionCategoryHistory.create({
        data: {
          txId,
          action: p.action,
          actorId: p.actorId || null,
          actorName,
          oldCategoryId: p.oldCategoryId,
          oldCategoryName: p.oldCategoryId ? nameById.get(p.oldCategoryId) || null : null,
          oldSubcategoryId: p.oldSubcategoryId,
          oldSubcategoryName: p.oldSubcategoryId ? nameById.get(p.oldSubcategoryId) || null : null,
          newCategoryId: p.newCategoryId,
          newCategoryName: p.newCategoryId ? nameById.get(p.newCategoryId) || null : null,
          newSubcategoryId: p.newSubcategoryId,
          newSubcategoryName: p.newSubcategoryId ? nameById.get(p.newSubcategoryId) || null : null,
          contractNumber: p.contractNumber,
          reason: p.reason,
        },
      });
    } catch (e: any) {
      this.log.warn(`logHistory xato (${txId}): ${e?.message}`);
    }
  }

  // ────────────────────────── CORE RULES ──────────────────────────

  private async runRules(
    tx: CategorizationInput,
    opts?: { force?: boolean; actor?: 'auto' | 'manual' | 'cron' | 'sync'; actorId?: string },
  ): Promise<CategorizeResult> {
    // Skip — agar allaqachon kategoriyalangan va force=false
    // LEKIN: agar shartnoma raqami bor lekin CRM tekshirilmagan bo'lsa — CRM lookup qilamiz
    if (!opts?.force && tx.categoryId) {
      // Mavjud shartnoma bor bo'lsa, CRM keshini tekshiramiz (cache hit/miss, agar yo'q bo'lsa lookup qilinadi)
      if (tx.contractNumber) {
        try {
          await this.crmCache.lookup(tx.contractNumber);
        } catch (e: any) {
          this.log.warn(`CRM lookup xato (${tx.id}, ${tx.contractNumber}): ${e?.message}`);
        }
      }
      return {
        ok: true,
        categoryCode: 'EXISTING',
        subcategoryCode: null,
        contractNumber: tx.contractNumber,
        reason: 'allaqachon kategoriyalangan (shartnoma CRM tekshirildi)',
      };
    }

    const refs = await this.getRefs();
    const desc = (tx.description || '').toUpperCase();
    const fromName = (tx.fromName || '').toUpperCase().trim();
    const direction = (tx.direction || 'IN') as Direction;

    let categoryId: string | null = null;
    let subcategoryId: string | null = null;
    let contractNumber: string | null = tx.contractNumber;
    let reason = '';

    // ── 1) Shartnoma raqamini ajratamiz (description'dan) — bir nechta variantlarni sinab ko'ramiz
    // User talabi: "shartnomadan keyin probel bor ekan ... shuni xato devoti"
    // Misol: "985VTN24GX P АХИМОВ" — bu yerda "P" shartnomaning bir qismi bo'lishi mumkin.
    // extractContractCandidates: ["985VTN24GX", "985VTN24GXP", "985VTN24GXPA"]
    // CRM da qaysi biri verified bo'lsa shuni tanlaymiz. Hech biri topilmasa — birinchisi.
    if (!contractNumber) {
      const candidates = extractContractCandidates(tx.description);
      if (candidates.length > 0) {
        contractNumber = candidates[0];  // default asosiy
        for (const cand of candidates) {
          const c = await this.crmCache.lookup(cand);
          if (c?.found) {
            contractNumber = cand;  // verified topildi — uni ishlatamiz
            break;
          }
        }
      }
    }

    // ── 2) Klient/Физ.Л/Юр.Л — shartnoma raqami description'da topilsa, CLIENT
    // CRM tasdiqlasa — subkategoriya CRM ma'lumoti bo'yicha (parking/kvartira)
    // CRM topa olmasa ("xato" hol — legacy 1h-cloumn.py) — baribir CLIENT, default VZNOS_KV
    if (contractNumber) {
      const cached = await this.crmCache.lookup(contractNumber);
      const inCrm = cached?.found && !this.isExcludedClientStatus(cached.status);
      if (inCrm || cached) {
        // Status excluded bo'lsa — CLIENT emas (reinvestiция / фиктивный)
        if (cached?.found && this.isExcludedClientStatus(cached.status)) {
          // skip — CLIENT emas, boshqa qoidalarga o'tamiz
        } else {
          categoryId = refs.CLIENT;
          subcategoryId = inCrm
            ? this.pickClientSubcategory(desc, direction, cached!, refs)
            : this.pickClientSubcategory(desc, direction, { objectName: null, apartmentNumber: null }, refs);
          reason = inCrm
            ? `CRM topdi: ${cached!.customerName || cached!.contractNumber}`
            : `Shartnoma topildi (${contractNumber}) — CRM'da tasdiqlanmagan`;
        }
      }
    }

    // ── 3) Молия Вазирлиги — fromName aniq matn YOKI desc'da soliq kalit so'zi
    if (!categoryId) {
      const isMolia = MINFIN_FROM_NAMES.some((m) => fromName.includes(m));
      const taxSubKey = this.pickMinfinSubcategory(desc, refs);
      if (isMolia || taxSubKey) {
        categoryId = refs.MINFIN;
        subcategoryId = taxSubKey;
        reason = isMolia
          ? `fromName Molia Vazirligi${taxSubKey ? ' + soliq turi' : ''}`
          : 'desc soliq kalit soz';
      }
    }

    // ── 4) Bank xizmati — CORPORATE/TARIF
    if (!categoryId && KEYWORDS_BANK.some((k) => desc.includes(k))) {
      categoryId = refs.BANK;
      subcategoryId = refs.BANK_USLUGI;
      reason = 'desc bank xizmati (CORPORATE/TARIF)';
    }

    // ── 5) Zarplata
    if (!categoryId && KEYWORDS_SALARY.some((k) => desc.includes(k))) {
      categoryId = refs.SALARY;
      reason = 'desc zarplata';
    }

    // ── 6) Финансовый займ
    if (!categoryId && KEYWORDS_LOAN.some((k) => desc.includes(k))) {
      categoryId = refs.LOAN;
      subcategoryId = refs.LOAN_VYDACHA;
      reason = 'desc fin.zaim';
    }

    // ── 7) Переброска — fromAccount yoki toAccount o'z hisoblarimiz bo'lsa
    if (!categoryId) {
      const ownAccs = await this.getOwnAccounts();
      const otherAcc = direction === 'IN' ? tx.fromAccount : tx.toAccount;
      if (otherAcc && ownAccs.has(otherAcc.trim())) {
        categoryId = refs.TRANSFER;
        reason = "o'z hisoblarimiz orasida (Переброска)";
      }
    }

    // Topilmadi — bo'sh qoldiramiz
    if (!categoryId) {
      return {
        ok: true,
        categoryCode: null,
        subcategoryCode: null,
        contractNumber,
        reason: 'qoida topilmadi',
      };
    }

    // Yozish
    await this.prisma.transaction.update({
      where: { id: tx.id },
      data: {
        categoryId,
        subcategoryId,
        contractNumber,
        categorizedAt: new Date(),
        categorizedBy: opts?.actor || 'auto',
        categorizedById: opts?.actorId || null,
      },
    });

    // Tarix yozish (faqat o'zgarish bo'lganda)
    await this.logHistory(tx.id, {
      action: opts?.actor || 'auto',
      actorId: opts?.actorId,
      oldCategoryId: tx.categoryId,
      oldSubcategoryId: tx.subcategoryId,
      newCategoryId: categoryId,
      newSubcategoryId: subcategoryId,
      contractNumber,
      reason,
    });

    return {
      ok: true,
      categoryCode: this.reverseCode(categoryId, refs),
      subcategoryCode: subcategoryId ? this.reverseCode(subcategoryId, refs) : null,
      contractNumber,
      reason,
    };
  }

  // ────────────────────────── SUB-CATEGORY PICKERS ──────────────────────────

  private pickClientSubcategory(
    desc: string,
    direction: Direction,
    cached: { objectName: string | null; apartmentNumber: string | null },
    refs: CategoryRefs,
  ): string | null {
    if (KEYWORDS_SCHETCHIK.some((k) => desc.includes(k))) return refs.CLIENT_SCHETCHIK;
    if (desc.includes(KEYWORD_PEREOFORM)) return refs.CLIENT_PEREOFORM;
    if (direction === 'OUT') return refs.CLIENT_VOZVRAT;
    // Avtostoянka — agar object yoki apartment 'парковка' bo'lsa
    const obj = (cached.objectName || '').toUpperCase();
    if (obj.includes('ПАРКОВКА') || obj.includes('АВТОСТОЯН') || obj.includes('PARKING')) {
      return refs.CLIENT_VZNOS_AVTO;
    }
    return refs.CLIENT_VZNOS_KV;
  }

  private pickMinfinSubcategory(desc: string, refs: CategoryRefs): string | null {
    for (const [kw, refKey] of TAX_KEYWORDS) {
      if (desc.includes(kw)) return refs[refKey] as string;
    }
    return null;
  }

  private isExcludedClientStatus(status: string | null | undefined): boolean {
    if (!status) return false;
    const s = status.toLowerCase();
    return s.includes('реинвестиц') || s.includes('фиктив');
  }

  // ────────────────────────── BACKGROUND RUNNER ──────────────────────────

  private async runInBackground(opts?: {
    onlyUncategorized?: boolean;
    limit?: number;
    actorId?: string;
  }): Promise<void> {
    if (this.runAllRunning) {
      this.log.warn('runInBackground: allaqachon ishlamoqda — o\'tkazib yuborildi');
      return;
    }
    this.runAllRunning = true;
    this.runAllStartedAt = new Date();
    this.runAllFinishedAt = null;
    this.runAllProgress = { done: 0, total: 0, matched: 0, errors: 0 };
    this.runAllLastError = null;
    this.runAllRecentErrors = [];

    try {
      // Default: kategoriya YOKI shartnoma raqami yo'qlar (har biri alohida tekshiriladi)
      // Force (all=true): hamma tranzaksiyalar qayta hisoblanadi
      const where: any = opts?.onlyUncategorized === false
        ? {}
        : { OR: [{ categoryId: null }, { contractNumber: null }] };
      const total = await this.prisma.transaction.count({ where });
      const take = opts?.limit && opts.limit > 0 ? opts.limit : total;
      this.runAllProgress = { done: 0, total: Math.min(take, total), matched: 0, errors: 0 };

      const PAGE = 500;
      let matched = 0;
      let done = 0;
      let errors = 0;
      let cursor: string | undefined;

      while (done < take) {
        const batch = await this.prisma.transaction.findMany({
          where,
          select: this.txSelectFields(),
          take: Math.min(PAGE, take - done),
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (batch.length === 0) break;

        for (const tx of batch) {
          try {
            const r = await this.runRules(tx as any, {
              force: opts?.onlyUncategorized === false,
              actor: opts?.actorId ? 'manual' : 'cron',
              actorId: opts?.actorId,
            });
            if (r.categoryCode && r.categoryCode !== 'EXISTING') matched++;
          } catch (e: any) {
            errors++;
            const reason = (e?.message || 'noma\'lum xato').slice(0, 300);
            this.log.warn(`tx ${tx.id} kategoriyalashda xato: ${reason}`);
            // Oxirgi 20 xatoni eslab qolamiz (UI uchun)
            this.runAllRecentErrors.unshift({ txId: tx.id, reason, at: new Date().toISOString() });
            if (this.runAllRecentErrors.length > 20) this.runAllRecentErrors.length = 20;
            this.runAllLastError = reason;
          }
          done++;
          this.runAllProgress = { done, total: Math.min(take, total), matched, errors };
        }
        cursor = batch[batch.length - 1].id;
      }

      const dur = Math.round((Date.now() - (this.runAllStartedAt?.getTime() || Date.now())) / 1000);
      this.log.log(`runAll tugadi: ${done}/${total} ko'rib chiqildi, ${matched} ta kategoriyalandi, ${errors} ta xato (${dur}s)`);
    } catch (e: any) {
      // Umumiy fatal xato — UI uchun saqlaymiz
      this.runAllLastError = (e?.message || 'noma\'lum fatal xato').slice(0, 500);
      this.log.error(`runInBackground fatal: ${this.runAllLastError}`);
    } finally {
      // Tugagandan keyin 5 daqiqa progress ko'rinib tursin (UI ulgursin)
      this.runAllFinishedAt = new Date();
      this.runAllRunning = false;
      // runAllStartedAt va runAllProgress'ni saqlab qolamiz (status uchun)
      setTimeout(() => {
        // Yangi run boshlanmagan bo'lsa — tozalaymiz
        if (!this.runAllRunning) {
          this.runAllStartedAt = null;
          this.runAllProgress = null;
          this.runAllFinishedAt = null;
          this.runAllLastError = null;
          this.runAllRecentErrors = [];
        }
      }, 5 * 60 * 1000);
    }
  }

  // ────────────────────────── HELPERS ──────────────────────────

  private txSelectFields() {
    return {
      id: true,
      description: true,
      fromName: true,
      toName: true,
      fromInn: true,
      toInn: true,
      fromAccount: true,
      toAccount: true,
      direction: true,
      amount: true,
      categoryId: true,
      subcategoryId: true,
      contractNumber: true,
    };
  }

  private async getRefs(): Promise<CategoryRefs> {
    if (this.categoryRefs) return this.categoryRefs;
    const all = await this.prisma.category.findMany({ select: { id: true, code: true } });
    const map: Record<string, string> = {};
    for (const c of all) map[c.code] = c.id;

    const requiredCodes: (keyof CategoryRefs)[] = [
      'CLIENT', 'BANK', 'SALARY', 'TRANSFER', 'MINFIN', 'LOAN', 'COUNTERPARTY_RETURN', 'COUNTERPARTY',
      'CLIENT_VZNOS_KV', 'CLIENT_VZNOS_AVTO', 'CLIENT_VOZVRAT', 'CLIENT_SCHETCHIK', 'CLIENT_PEREOFORM',
      'BANK_USLUGI',
      'MINFIN_NDS', 'MINFIN_NDFL', 'MINFIN_NDFL_DIV', 'MINFIN_WATER', 'MINFIN_ESP',
      'MINFIN_WATER_RES', 'MINFIN_LAND', 'MINFIN_PROPERTY', 'MINFIN_PENALTY', 'MINFIN_PROFIT',
      'MINFIN_PENSION',
      'LOAN_VYDACHA',
    ];
    const refs = {} as CategoryRefs;
    for (const code of requiredCodes) {
      if (!map[code]) {
        throw new Error(`Kategoriya seed qilinmagan: ${code} — npm run seed ishga tushiring`);
      }
      (refs as any)[code] = map[code];
    }
    this.categoryRefs = refs;
    return refs;
  }

  private reverseCode(id: string, refs: CategoryRefs): string {
    for (const [code, refId] of Object.entries(refs)) {
      if (refId === id) return code;
    }
    return id;
  }

  private async getOwnAccounts(): Promise<Set<string>> {
    const now = Date.now();
    if (this.ownAccountsCache && (now - this.ownAccountsCache.loadedAt) < CategorizationService.OWN_ACCOUNTS_TTL) {
      return this.ownAccountsCache.numbers;
    }
    const accs = await this.prisma.bankAccount.findMany({
      select: { accountNo: true },
    });
    const set = new Set<string>();
    for (const a of accs) {
      if (a.accountNo) set.add(a.accountNo.trim());
    }
    this.ownAccountsCache = { numbers: set, loadedAt: now };
    return set;
  }

  /** Refs keshini tozalash (test/seed o'zgargandan keyin chaqirish). */
  resetCache(): void {
    this.categoryRefs = null;
    this.ownAccountsCache = null;
  }
}
