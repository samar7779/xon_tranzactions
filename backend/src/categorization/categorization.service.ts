import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmContractCacheService } from './crm-contract-cache.service';
import { extractContractNumber } from './contract-parser';

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
  async setContract(txId: string, contractNumber: string | null, actorId: string): Promise<{ ok: true; verified: boolean; customerName: string | null }> {
    const old = await this.prisma.transaction.findUnique({
      where: { id: txId },
      select: { contractNumber: true, categoryId: true, subcategoryId: true },
    });
    if (!old) throw new BadRequestException('Tranzaksiya topilmadi');

    const newContract = contractNumber?.trim().toUpperCase() || null;
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
      data: { contractNumber: newContract },
    });

    // Tarixga to'g'ridan-to'g'ri yozish (logHistory'da kategoriya o'zgarmagani uchun skip bo'lar edi)
    if (old.contractNumber !== newContract) {
      const u = await this.prisma.adminUser.findUnique({ where: { id: actorId }, select: { email: true } });
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

    return { ok: true, verified, customerName };
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

    // ── 1) Shartnoma raqamini ajratamiz (description'dan)
    if (!contractNumber) {
      contractNumber = extractContractNumber(tx.description);
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
