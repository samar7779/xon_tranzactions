import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, HttpException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as ExcelJS from 'exceljs';
import { Prisma, OplataKvCategory } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { buildSchedule, allocatePayment, categoryOf } from './installment-split';
import { CrmContractCacheService, ReverifyStatus } from '../categorization/crm-contract-cache.service';
import { CategorizationService } from '../categorization/categorization.service';
import { SettingsService } from '../sync/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { decideTransferAmount, namesMatch } from './perereboska-amounts';
import {
  CreateOplataKvDto, UpdateOplataKvDto, ListOplataKvDto,
} from './dto/oplata-kv.dto';

type Actor = { id?: string | null; name?: string | null };

export interface ImportResult {
  total: number;
  added: number;
  skipped: number;
  errors: number;
  errorRows: Array<{ row: number; reason: string; id?: string; contractNo?: string }>;
  skippedRows: Array<{ row: number; id: string; contractNo: string; reason: string }>;
  batchId?: string;
  duration: number; // sekund
}

export interface ImportPreview {
  previewId: string;
  fileName: string | null;
  total: number;
  willInsert: number;     // bazaga qo'shiladigan yangi qatorlar
  duplicatesInDb: number; // DB'da allaqachon ID bo'lganlar
  duplicatesInFile: number; // Fayl ichida takror ID
  errors: number;
  errorRows: Array<{ row: number; reason: string; id?: string; contractNo?: string }>;
  skippedRows: Array<{ row: number; id: string; contractNo: string; reason: string }>;
  duration: number; // parse vaqti (sekund)
  expiresAt: string; // ISO sana — qachongacha cache'da turadi
}

// Cache'dagi preview ma'lumotlari
interface PreviewState {
  fileName: string | null;
  fileSize: number;
  toInsert: any[];        // bazaga qo'shilishi kerak bo'lgan qatorlar (Prisma data)
  preview: ImportPreview;
  expiresAt: number;       // ms timestamp
  actor: Actor;
}

@Injectable()
export class OplataKvService {
  private readonly log = new Logger(OplataKvService.name);
  private readonly uploadsDir: string;
  private readonly tgToken: string;
  private readonly tgChat: string;
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crmService: CrmService,
    private readonly crmCache: CrmContractCacheService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly categorization: CategorizationService,
    private readonly crypto: CryptoService,
  ) {
    this.uploadsDir = this.config.get<string>('UPLOADS_DIR') || '/var/www/xon_tranzactions/uploads';
    this.tgToken = this.config.get<string>('TG_BOT_TOKEN') || '';
    this.tgChat = this.config.get<string>('ATTACHMENTS_NOTIFY_CHAT') || '-5150947522';
    this.appUrl = this.config.get<string>('APP_URL') || 'https://transactions.xonapps.uz';
  }

  // Auto-sync uchun oxirgi ishga tushgan vaqt
  private lastAutoSyncAt: Date | null = null;
  private lastNightBatchDay: number | null = null;  // Tunda 1 marta — qaysi sana

  /**
   * Tashkent kunidagi sanani UTC-midnight Date ko'rinishida qaytaradi.
   * Bu @db.Date ustunlariga saqlash uchun zarur — aks holda timezone shift
   * sodir bo'ladi: masalan Transaction.txnDate = 2026-06-01T00:00:00+05:00
   * (Tashkent yarim tuni) = 2026-05-31T19:00:00Z UTC. To'g'ridan-to'g'ri
   * @db.Date'ga saqlasak Prisma UTC sanasini olib '2026-05-31' qiladi.
   * Bu funksiya orqali esa to'g'ri '2026-06-01' bo'lib saqlanadi.
   */
  private toTashkentDateOnly(d: Date): Date {
    const tashTime = new Date(d.getTime() + 5 * 60 * 60 * 1000);
    return new Date(Date.UTC(
      tashTime.getUTCFullYear(),
      tashTime.getUTCMonth(),
      tashTime.getUTCDate(),
    ));
  }

  /**
   * Tashkent vaqti bo'yicha hour qaytaradi (UTC+5)
   */
  private getTashkentHourMinute(): { hour: number; minute: number } {
    const now = new Date();
    // UTC + 5
    const tashkent = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    return { hour: tashkent.getUTCHours(), minute: tashkent.getUTCMinutes() };
  }

  /**
   * Har daqiqada tekshiradi.
   * DAY mode (08:00-22:00 Tashkent): har user belgilangan interval'da (default 15), max 1000 ta
   * NIGHT mode (01:00-07:50 Tashkent): kuniga 1 marta — limit'siz batch (barcha tx-status)
   */
  /**
   * HH:MM string -> {hour, minute}
   */
  private parseTime(s: string): { hour: number; minute: number } {
    const [h, m] = s.split(':').map(Number);
    return { hour: h || 0, minute: m || 0 };
  }
  /** Joriy vaqt (minute) berilgan range ichidami? */
  private isInRange(nowH: number, nowM: number, startStr: string, endStr: string): boolean {
    const start = this.parseTime(startStr);
    const end = this.parseTime(endStr);
    const nowMin = nowH * 60 + nowM;
    const startMin = start.hour * 60 + start.minute;
    const endMin = end.hour * 60 + end.minute;
    return nowMin >= startMin && nowMin < endMin;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async autoSyncTick() {
    try {
      const { hour, minute } = this.getTashkentHourMinute();
      const intervalMin = await this.settings.getOplatyKvAutoSyncMinutes();
      const minDate = await this.settings.getOplatyKvTxMinDate();
      // Settings'dan vaqt oraliqlari
      const dayStart   = await this.settings.getOplatyKvDayStart();   // '08:00'
      const dayEnd     = await this.settings.getOplatyKvDayEnd();     // '22:00'
      const nightStart = await this.settings.getOplatyKvNightStart(); // '01:00'
      const nightEnd   = await this.settings.getOplatyKvNightEnd();   // '07:50'
      // autoXato olib tashlandi — user: 'tolovlarni ochirish keremas'

      // ─── DAY MODE — every intervalMin daqiqada, limit 1000 ───
      if (this.isInRange(hour, minute, dayStart, dayEnd)) {
        if (!intervalMin || intervalMin < 1) return;
        const now = new Date();
        if (this.lastAutoSyncAt) {
          const elapsedMin = (now.getTime() - this.lastAutoSyncAt.getTime()) / 60000;
          if (elapsedMin < intervalMin) return;
        }
        this.lastAutoSyncAt = now;
        this.log.log(`Auto-sync DAY (${dayStart}-${dayEnd}, interval ${intervalMin}min): boshlandi`);
        const result = await this.syncFromTransactions({
          minDate, limit: 1000,
          actor: { id: null, name: 'cron · day' },
        });
        this.log.log(`Auto-sync DAY DONE: added=${result.added} updated=${result.updated} skipped=${result.skipped}`);
        // Auto XATO cleanup OLIB TASHLANDI — user xohlamadi (tolovlar o'chmasin)
        return;
      }

      // ─── NIGHT BATCH — kuniga 1 marta, FULL ───
      if (this.isInRange(hour, minute, nightStart, nightEnd)) {
        const tashkentDay = new Date(Date.now() + 5 * 60 * 60 * 1000).getUTCDate();
        if (this.lastNightBatchDay === tashkentDay) return;
        this.lastNightBatchDay = tashkentDay;
        this.log.log(`Auto-sync NIGHT BATCH (${nightStart}-${nightEnd}): boshlandi`);
        const result = await this.syncFromTransactions({
          minDate,
          actor: { id: null, name: 'cron · night-batch' },
        });
        this.log.log(`Auto-sync NIGHT BATCH DONE: added=${result.added} updated=${result.updated} skipped=${result.skipped}`);
        // Auto XATO cleanup OLIB TASHLANDI — user xohlamadi (tolovlar o'chmasin)
      }
    } catch (e: any) {
      this.log.warn(`Auto-sync xato: ${e?.message}`);
    }
  }

  // "Счётчик → Ежемесячный" avto-rejim — sozlangan vaqt oralig'ida har intervalMin daqiqada
  private lastSchotchikAt: Date | null = null;

  /**
   * Kelajakdagi updated_at qiymatlarini HOZIRgacha "clamp" qiladi (DB soati skew bo'lsa yakuniy tozalash).
   * Sabab: agar biror yozuv updated_at > now() bo'lsa, delta-sync (updatedSince) kursori kelajakka
   * sakraydi va oradagi haqiqiy to'lovlar butunlay o'tkazib yuboriladi ("ko'r" sync). DB NOW() emas,
   * APP soatidan (parametr) foydalanamiz. Tuzatilgan qatorlar updated_at=now bo'lib, iste'molchilarga
   * to'g'ri vaqtda qayta yetkaziladi (avval o'tkazib yuborilgan bo'lsa — endi ko'rinadi).
   */
  private async clampFutureUpdatedAt(): Promise<number> {
    const appNow = new Date();
    const n: number = await this.prisma.$executeRaw`
      UPDATE oplata_kv SET updated_at = ${appNow} WHERE updated_at > ${appNow}
    `;
    if (Number(n) > 0) this.log.warn(`clampFutureUpdatedAt: ${n} qator — kelajakdagi updated_at hozirgacha tuzatildi`);
    return Number(n);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async schotchikAutoTick() {
    try {
      // Har minut: kelajakdagi updated_at bo'lsa tuzatamiz (schotchik yoqilgan-yoqilmaganidan
      // qat'i nazar). Fix 1'dan keyin yangi buzuq yozuv chiqmaydi — bu faqat eskilarni tozalaydi.
      await this.clampFutureUpdatedAt();
      const cfg = await this.settings.getSchotchikAutoConfig();
      if (!cfg.enabled) return;
      const { hour, minute } = this.getTashkentHourMinute();
      if (!this.isInRange(hour, minute, cfg.dayStart, cfg.dayEnd)) return;
      const now = new Date();
      if (this.lastSchotchikAt) {
        const elapsedMin = (now.getTime() - this.lastSchotchikAt.getTime()) / 60000;
        if (elapsedMin < cfg.intervalMin) return;
      }
      this.lastSchotchikAt = now;
      const r = await this.schotchikToMonthly({
        dateFrom: cfg.dateFrom || undefined,
        dryRun: false,
        actor: { id: null, name: 'cron · schotchik' },
      });
      if (r.updated > 0) this.log.log(`Schotchik auto: ${r.updated} qator oylikka o'tkazildi`);
    } catch (e: any) {
      this.log.warn(`Schotchik auto-tick xato: ${e?.message}`);
    }
  }

  // ─── crm_status backfill — virtual_status hali tekshirilmagan (NULL) shartnomalarni
  //     CRM'dan asta to'ldiradi. Konvergent: har shartnoma tekshirilgach '' yoki qiymat
  //     bo'ladi (NULL emas), shu bois qayta olinmaydi va ish tugagach cron bo'sh yuradi.
  private crmStatusBackfillRunning = false;

  @Cron(CronExpression.EVERY_MINUTE)
  async crmStatusBackfillTick() {
    if (this.crmStatusBackfillRunning) return;
    this.crmStatusBackfillRunning = true;
    try {
      const batch = await this.prisma.crmContract.findMany({
        where: { found: true, virtualStatus: null },
        select: { contractNumber: true },
        take: 200,
      });
      if (batch.length === 0) return; // konvergensiya — qiladigan ish yo'q

      // Cheklangan konkurentlik — CRM'ni bo'kmaslik (8 tadan ketma-ket chunk)
      const CONC = 8;
      let answered = 0;
      for (let i = 0; i < batch.length; i += CONC) {
        const chunk = batch.slice(i, i + CONC);
        const rs = await Promise.allSettled(
          chunk.map((c) => this.crmCache.refreshVirtualStatus(c.contractNumber)),
        );
        answered += rs.filter((r) => r.status === 'fulfilled' && r.value === true).length;
      }
      this.log.log(`crm_status backfill: ${batch.length} ta ishlandi, ${answered} ta CRM javob berdi (bu tsikl)`);
    } catch (e: any) {
      this.log.warn(`crm_status backfill xato: ${e?.message}`);
    } finally {
      this.crmStatusBackfillRunning = false;
    }
  }

  // ─── Preview cache (in-memory) ───────────────────────────
  // Foydalanuvchi katta Excel yuklasa → avval tekshiramiz va cache'da turamiz.
  // Foydalanuvchi tasdiqlasa → cache'dan o'qib bazaga qo'shamiz.
  // TTL 30 daqiqa, tasdiqlangach yoki TTL tugagach evict qilamiz.
  private previewCache = new Map<string, PreviewState>();
  private readonly PREVIEW_TTL_MS = 30 * 60 * 1000; // 30 daqiqa

  private cleanExpiredPreviews() {
    const now = Date.now();
    for (const [k, v] of this.previewCache) {
      if (v.expiresAt < now) this.previewCache.delete(k);
    }
  }

  // ───────────────── WHERE BUILDER (sharedmaroq) ─────────────────
  /** Vergul bilan ajratilgan string'ni massivga aylantiradi. */
  private parseList(s?: string | null): string[] | null {
    if (!s) return null;
    const arr = s.split(',').map((x) => x.trim()).filter(Boolean);
    return arr.length > 0 ? arr : null;
  }

  /** Barcha filterlardan WHERE yasaydi — list/export/distinct shu metodni ishlatadi. */
  private buildWhere(q: ListOplataKvDto): Prisma.OplataKvWhereInput {
    const where: Prisma.OplataKvWhereInput = {};

    if (q.q && q.q.trim()) {
      const s = q.q.trim();
      const ors: Prisma.OplataKvWhereInput[] = [
        { contractNo:    { contains: s, mode: 'insensitive' } },
        { client:        { contains: s, mode: 'insensitive' } },
        { object:        { contains: s, mode: 'insensitive' } },
        { purpose:       { contains: s, mode: 'insensitive' } },
        { note:          { contains: s, mode: 'insensitive' } },
        { paymentMethod: { contains: s, mode: 'insensitive' } },
        { txType:        { contains: s, mode: 'insensitive' } },
        { id:            { contains: s, mode: 'insensitive' } },
      ];
      // Raqam bo'lsa — summalar bo'yicha ham qidiramiz (aniq tenglik)
      const n = Number(s.replace(/[\s,]/g, ''));
      if (Number.isFinite(n) && n > 0) {
        ors.push(
          { paymentAmount:    n as any },
          { firstInstallment: n as any },
          { monthlyAmount:    n as any },
        );
      }
      where.OR = ors;
    }
    if (q.dateFrom) where.date = { ...(where.date as object), gte: new Date(q.dateFrom) };
    if (q.dateTo)   where.date = { ...(where.date as object), lte: new Date(q.dateTo) };
    if (q.contractNo) where.contractNo = { contains: q.contractNo, mode: 'insensitive' };
    if (q.paymentCategory) where.paymentCategory = q.paymentCategory as OplataKvCategory;
    if (q.client) where.client = { contains: q.client, mode: 'insensitive' };
    if (q.object) where.object = { contains: q.object, mode: 'insensitive' };

    // ─── Per-ustun multi-select (vergul bilan), '__null__' = bo'sh qiymatlar ───
    // Helper: list -> Prisma where clause (null bo'lsa OR with null)
    const buildListFilter = (list: string[] | null) => {
      if (!list) return null;
      const hasNull = list.includes('__null__');
      const realValues = list.filter((v) => v !== '__null__');
      if (hasNull && realValues.length > 0) {
        return { OR: [{ in: realValues }, null] }; // special — we expand below
      }
      if (hasNull) return null; // marker — will be set as null filter
      return { in: realValues };
    };
    const applyFieldFilter = (field: string, list: string[] | null) => {
      if (!list) return;
      const hasNull = list.includes('__null__');
      const realValues = list.filter((v) => v !== '__null__');
      if (hasNull && realValues.length > 0) {
        // Both null AND specific values — needs OR
        const ors: any[] = [{ [field]: { in: realValues } }, { [field]: null }];
        if (where.OR) where.AND = [{ OR: where.OR }, { OR: ors }];
        else where.OR = ors;
      } else if (hasNull) {
        (where as any)[field] = null;
      } else if (realValues.length > 0) {
        (where as any)[field] = { in: realValues };
      }
    };

    const contractNos = this.parseList(q.contractNos);
    if (contractNos) applyFieldFilter('contractNo', contractNos);

    const paymentCategories = this.parseList(q.paymentCategories);
    if (paymentCategories) {
      const hasNull = paymentCategories.includes('__null__');
      const realValues = paymentCategories.filter((v) => v !== '__null__') as OplataKvCategory[];
      if (hasNull && realValues.length > 0) {
        const ors: any[] = [{ paymentCategory: { in: realValues } }, { paymentCategory: null }];
        if (where.OR) where.AND = [{ OR: where.OR }, { OR: ors }];
        else where.OR = ors;
      } else if (hasNull) {
        where.paymentCategory = null;
      } else if (realValues.length > 0) {
        where.paymentCategory = { in: realValues };
      }
    }

    applyFieldFilter('client', this.parseList(q.clients));
    applyFieldFilter('object', this.parseList(q.objects));
    applyFieldFilter('paymentMethod', this.parseList(q.paymentMethods));
    applyFieldFilter('txType', this.parseList(q.txTypes));
    // buildListFilter unused — placeholder
    void buildListFilter;

    // ─── Manba filter: manual | excel | transaction ───
    const sources = this.parseList(q.sources);
    if (sources) {
      const ors: Prisma.OplataKvWhereInput[] = [];
      if (sources.includes('transaction')) ors.push({ sourceTxId: { not: null } });
      if (sources.includes('excel'))       ors.push({ sourceTxId: null, importBatchId: { not: null } });
      if (sources.includes('manual'))      ors.push({ sourceTxId: null, importBatchId: null });
      if (ors.length === 1) Object.assign(where, ors[0]);
      else if (ors.length > 1) {
        // Hozirgi OR'ni saqlab, qo'shimcha OR sifatida AND qilamiz
        if (where.OR) {
          where.AND = [{ OR: where.OR }, { OR: ors }];
          delete where.OR;
        } else {
          where.OR = ors;
        }
      }
    }

    // ─── Summa oraliq filtrlari (aniq summa = min=max) ───
    const applyAmountRange = (field: 'paymentAmount' | 'firstInstallment' | 'monthlyAmount', min?: number, max?: number) => {
      if (min == null && max == null) return;
      const cond: any = {};
      if (min != null) cond.gte = min;
      if (max != null) cond.lte = max;
      (where as any)[field] = cond;
    };
    applyAmountRange('paymentAmount',    q.paymentAmountMin,    q.paymentAmountMax);
    applyAmountRange('firstInstallment', q.firstInstallmentMin, q.firstInstallmentMax);
    applyAmountRange('monthlyAmount',    q.monthlyAmountMin,    q.monthlyAmountMax);

    return where;
  }

  /**
   * XATO filter — tx-manba qator (sourceTxId bor) + CRM'da found=true EMAS
   * + manual/ariza EMAS. List va export bir xil ishlatadi.
   * `notIn: verified` — verified bo'sh bo'lsa ham noto'g'ri "0 qator" qaytmaydi.
   */
  private async buildXatoFilter(): Promise<Prisma.OplataKvWhereInput> {
    const verified = await this.prisma.crmContract.findMany({
      where: { found: true },
      select: { contractNumber: true },
    });
    const verifiedNos = verified.map((c) => c.contractNumber);

    // FAQAT XATO ro'yxatidan YASHIRILGAN (xatoHidden) chiqmaydi.
    // Qo'lda shartnoma berilgan (isContractManual) bo'lsa ham — agar shartnoma CRM'da
    // topilmagan bo'lsa (contractNo notIn verifiedNos) — bu hali XATO, ro'yxatda ko'rinsin.
    // (CRM'da tasdiqlangan qo'lda shartnomalar baribir verifiedNos orqali chiqib ketadi.)
    const hiddenTx = await this.prisma.transaction.findMany({
      where: { xatoHidden: true },
      select: { id: true, externalId: true },
    });
    const hiddenIds: string[] = [];
    hiddenTx.forEach((t) => { hiddenIds.push(t.id); if (t.externalId) hiddenIds.push(t.externalId); });

    return {
      sourceTxId: { not: null },
      contractNo: { notIn: verifiedNos },
      ...(hiddenIds.length > 0 ? { NOT: { sourceTxId: { in: hiddenIds } } } : {}),
    };
  }

  /**
   * "Split yo'q" filtri — shartnomasi CRM'da FOUND, lekin ustunlari BO'SH:
   * paymentCategory (Оплата) / firstInstallment (1 взнос) / monthlyAmount (ежемесячный) = null.
   * XATO → CRM modulining 2-sub-tabi uchun (CRM'dan tip topib splitlash kerak bo'lganlar).
   */
  private async buildUnsplitFilter(): Promise<Prisma.OplataKvWhereInput> {
    const verified = await this.prisma.crmContract.findMany({
      where: { found: true },
      select: { contractNumber: true },
    });
    const verifiedNos = verified.map((c) => c.contractNumber);
    // "Оплата ustuni bo'sh" = paymentCategory null (asosiy belgi — main ro'yxat ham
    // shunday filtrlaydi). `sourceTxId not null` SHART QILINMAYDI — Excel-import
    // qatorlarda u null bo'lishi mumkin (o'shalar tushib qolardi). Shartnoma CRM'da
    // FOUND bo'lishi kifoya (splitlash mumkin).
    return {
      contractNo: { in: verifiedNos.length ? verifiedNos : ['__no_match__'] },
      paymentCategory: null,
    };
  }

  /**
   * crm_status (virtual_status) bo'yicha OplataKv filtri.
   * CSV: "Бартер,Ипотека" — CrmContract.virtualStatus IN → contractNo IN.
   * '__none__' marker — crm_status bo'sh qatorlar (found=false yoki virtual_status yo'q):
   *   contractNo NOT IN (virtualStatus bor bo'lgan barcha shartnomalar).
   * CRM-verified qatorda OplataKv.contractNo === CrmContract.contractNumber (kanonik),
   * shu bois aniq `in`/`notIn` ishlaydi.
   */
  private async buildCrmStatusFilter(csv: string): Promise<Prisma.OplataKvWhereInput | null> {
    const wanted = csv.split(',').map((s) => s.trim()).filter(Boolean);
    if (!wanted.length) return null;

    const wantNone = wanted.some((w) => w === '__none__');
    const named = wanted.filter((w) => w !== '__none__');

    // Barcha virtual_status'li shartnomalar (bo'sh filtri uchun ham kerak).
    // '' (bo'sh string) = "tekshirildi, status yo'q" — bu ham "bo'sh" hisoblanadi.
    const withStatusRaw = await this.prisma.crmContract.findMany({
      where: { found: true, virtualStatus: { not: null } },
      select: { contractNumber: true, virtualStatus: true },
    });
    const withStatus = withStatusRaw.filter((c) => c.virtualStatus && c.virtualStatus.trim());

    if (wantNone && named.length === 0) {
      // Faqat "bo'sh" — haqiqiy status'li barcha shartnomalarni chiqarib tashlaymiz
      const allWithStatus = withStatus.map((c) => c.contractNumber);
      return { contractNo: { notIn: allWithStatus } };
    }

    // Tanlangan statuslarga mos shartnomalar (case-insensitive taqqoslash)
    const namedLc = new Set(named.map((s) => s.toLowerCase()));
    const matchNos = withStatus
      .filter((c) => c.virtualStatus && namedLc.has(c.virtualStatus.toLowerCase()))
      .map((c) => c.contractNumber);

    if (!wantNone) {
      // Faqat nomli statuslar — hech biri mos kelmasa hech nima chiqmasin
      return { contractNo: { in: matchNos.length ? matchNos : ['__no_match__'] } };
    }

    // Nomli statuslar + bo'sh — ikkalasi (OR)
    const allWithStatus = withStatus.map((c) => c.contractNumber);
    return {
      OR: [
        { contractNo: { in: matchNos.length ? matchNos : ['__no_match__'] } },
        { contractNo: { notIn: allWithStatus } },
      ],
    };
  }

  /**
   * Тип (parking/apartment) filtri — to'lovning MAQSAD matni (purpose) + txType + obyektidagi
   * parking kalit so'zlariga qarab (obyekt/kompleks nomi ishonchsiz edi — frontend display bilan bir xil).
   * parking = kalit so'z bor; apartment (жилой) = kalit so'z yo'q (NOT).
   */
  private async buildPropertyTypeFilter(csv: string): Promise<Prisma.OplataKvWhereInput | null> {
    const wanted = csv.split(',').map((s) => s.trim()).filter(Boolean);
    if (!wanted.length) return null;
    const wantParking = wanted.includes('parking');
    const wantApartment = wanted.includes('apartment');
    if (wantParking === wantApartment) return null; // ikkalasi yoki hech biri → filtr shart emas
    // Parking shartnomalar OZ — ularni olamiz; apartment = NOT parking (ikkalasi ham kichik IN/NOT IN).
    const rows = await this.prisma.crmContract.findMany({
      where: { found: true, propertyType: 'parking' },
      select: { contractNumber: true },
    });
    const parkingNos = rows.map((r) => r.contractNumber);
    if (wantParking) return { contractNo: { in: parkingNos.length ? parkingNos : ['__no_match__'] } };
    return { contractNo: { notIn: parkingNos } }; // apartment
  }

  /**
   * Сотув бўлими filtri — CrmContract.branchName bo'yicha contractNo IN/NOT IN.
   * TEZLASHTIRILGAN: faqat TANLANGAN bo'limlar shartnomalarini oladi (kichik IN),
   * avval BARCHA (5000+) branchli qatorni yuklab, ulkan IN qurardi — filtr osilardi.
   */
  private async buildBranchFilter(csv: string): Promise<Prisma.OplataKvWhereInput | null> {
    const wanted = csv.split(',').map((s) => s.trim()).filter(Boolean);
    if (!wanted.length) return null;
    const wantNone = wanted.includes('__none__');
    const named = wanted.filter((w) => w !== '__none__');

    let matchNos: string[] = [];
    if (named.length) {
      const rows = await this.prisma.crmContract.findMany({
        where: { found: true, branchName: { in: named } }, // faqat tanlangan bo'limlar
        select: { contractNumber: true },
      });
      matchNos = rows.map((r) => r.contractNumber);
    }

    if (!wantNone) {
      return { contractNo: { in: matchNos.length ? matchNos : ['__no_match__'] } };
    }

    // __none__ tanlansa — branchli barcha shartnomalarni chiqarib tashlaymiz (NOT IN)
    const withBranch = await this.prisma.crmContract.findMany({
      where: { found: true, AND: [{ branchName: { not: null } }, { branchName: { not: '' } }] },
      select: { contractNumber: true },
    });
    const allWithBranch = withBranch.map((r) => r.contractNumber);
    if (!named.length) return { contractNo: { notIn: allWithBranch } };
    return { OR: [{ contractNo: { in: matchNos } }, { contractNo: { notIn: allWithBranch } }] };
  }

  /**
   * Hozir XATO bo'lgan oplata_kv qatorlarining DISTINCT shartnoma raqamlari.
   * "Qayta tekshirish" shu ro'yxatni CRM'ga tekshiradi — butun DB'даги 5000+
   * eski found=false qatorni emas, faqat haqiqiy XATO to'lovlarning shartnomalarini.
   */
  /**
   * Tuzatish boti — to'g'ridan-to'g'ri shartnoma biriktirish (admin bajaruvchi).
   * tx'ga setContractManual → oplata_kv AVTOMAT sinxronlanadi (contractNo/obyekt/klient).
   * CRM'da bor bo'lsa kanonik shaklda saqlaydi va XATO'dan chiqadi.
   */
  async botAssignContract(
    oplataKvId: string, contractNo: string, actorName: string,
  ): Promise<{ ok: boolean; error?: string; contractNo?: string; client?: string | null; object?: string | null; found?: boolean }> {
    const row = await this.prisma.oplataKv.findUnique({ where: { id: oplataKvId }, select: { id: true, sourceTxId: true } });
    if (!row) return { ok: false, error: "To'lov topilmadi" };
    const cc = await this.crmCache.lookup(contractNo);
    const finalNo = (cc?.found && cc.contractNumber) ? cc.contractNumber : String(contractNo || '').trim();
    if (!finalNo) return { ok: false, error: "Shartnoma raqami bo'sh" };
    let txId: string | null = null;
    if (row.sourceTxId) {
      const tx = await this.prisma.transaction.findFirst({
        where: { OR: [{ externalId: row.sourceTxId }, { id: row.sourceTxId }] },
        select: { id: true },
      });
      txId = tx?.id ?? null;
    }
    if (txId) {
      await this.categorization.setContractManual(txId, finalNo, ''); // tx + oplata_kv sinxron
    } else {
      await this.prisma.oplataKv.update({
        where: { id: row.id },
        data: { contractNo: finalNo, object: cc?.objectName ?? undefined, client: cc?.customerName ?? undefined },
      });
    }
    this.log.log(`Bot: to'lov ${oplataKvId} → shartnoma ${finalNo} biriktirildi (bajardi: ${actorName})`);
    return { ok: true, contractNo: finalNo, client: cc?.customerName ?? null, object: cc?.objectName ?? null, found: !!cc?.found };
  }

  /**
   * XATO tuzatish moduli — CRM'dan topilgan shartnomani XATO to'lovga biriktiradi
   * VA CRM grafigi bo'yicha split qiladi (boshlang'ich/oylik). Ketma-ketlik muhim:
   * avval shartnoma (botAssignContract split'ni tozalaydi), keyin splitSingleRow.
   */
  async assignFromCrm(
    id: string, contractNo: string | undefined, actor?: Actor,
    split?: { initialAmount?: number; monthlyAmount?: number },
  ): Promise<{ ok: boolean; error?: string; assign?: any; split?: any; found?: boolean }> {
    if (!id) return { ok: false, error: 'id kerak' };
    // 1) Shartnoma biriktirish (XATO uchun; Split yo'q'da shartnoma bor — o'tkaziladi)
    let assign: any = null;
    if (contractNo && String(contractNo).trim()) {
      assign = await this.botAssignContract(id, String(contractNo).trim(), actor?.name || 'web');
      if (!assign.ok) return { ok: false, error: assign.error || 'Biriktirib bo\'lmadi', assign };
    }
    // 2) Split — CRM qiymatlari (initial/monthly) berilsa AYNAN o'shani qo'yamiz
    //    (qayta hisoblamaymiz — waterfall CRM bilan zid bo'lishi mumkin); berilmasa waterfall.
    let splitRes: any = null;
    if (split && (split.initialAmount != null || split.monthlyAmount != null)) {
      splitRes = await this.applyCrmSplit(id, split, actor);
    } else {
      try { splitRes = await this.splitSingleRow(id, actor); }
      catch (e: any) { splitRes = { ok: false, error: e?.message || 'split xatosi' }; }
    }
    return { ok: true, assign, split: splitRes, found: assign?.found };
  }

  /**
   * CRM aytgan boshlang'ich/oylik qiymatini AYNAN qo'yadi (grafik waterfall'siz).
   * CRM nisbatini saqlab paymentAmount ga moslaydi (first + monthly = paymentAmount).
   */
  async applyCrmSplit(
    id: string, split: { initialAmount?: number; monthlyAmount?: number }, actor?: Actor,
  ): Promise<{ ok: boolean; error?: string; item?: any }> {
    const row = await this.prisma.oplataKv.findUnique({ where: { id }, select: { id: true, paymentAmount: true } });
    if (!row) return { ok: false, error: 'Qator topilmadi' };
    const total = Number(row.paymentAmount || 0);
    const ci = Math.abs(Number(split.initialAmount || 0));
    const cm = Math.abs(Number(split.monthlyAmount || 0));
    const ct = ci + cm;
    const first = ct > 0 ? Math.round(total * (ci / ct)) : 0; // ci=0 → 0 (hammasi oylik)
    const monthly = total - first;
    const category = categoryOf(Math.abs(first), Math.abs(monthly));
    await this.prisma.oplataKv.update({
      where: { id },
      data: {
        firstInstallment: first !== 0 ? new Prisma.Decimal(first) : null,
        monthlyAmount: monthly !== 0 ? new Prisma.Decimal(monthly) : null,
        paymentCategory: category as OplataKvCategory,
      },
    });
    try {
      await this.prisma.oplataKvHistory.create({
        data: {
          oplataKvId: id, action: 'edited',
          actorType: actor?.id ? 'user' : 'system', actorId: actor?.id || null,
          actorName: actor?.name || 'crm-split',
          fieldsChanged: ['firstInstallment', 'monthlyAmount', 'paymentCategory'],
          changes: {
            firstInstallment: { new: first },
            monthlyAmount: { new: monthly },
            paymentCategory: { new: category },
          } as any,
        },
      });
    } catch { /* history — muhim emas */ }
    return { ok: true, item: { firstInstallment: first, monthlyAmount: monthly, paymentCategory: category } };
  }

  /**
   * BULK: barcha XATO (yoki Split yo'q) qatorlarni CRM'dan topib, topilganlarga
   * shartnoma + CRM aytgan ustun (boshlang'ich/oylik) qo'yadi — HAMMASI serverda
   * (client round-trip yo'q → tez). Har sana CRM'dan bir marta so'raladi.
   */
  async bulkCrmFix(
    mode: 'xato' | 'unsplit', actor?: Actor,
  ): Promise<{ ok: boolean; total: number; matched: number; fixed: number }> {
    const where = mode === 'xato' ? await this.buildXatoFilter() : await this.buildUnsplitFilter();
    const rows = await this.prisma.oplataKv.findMany({
      where,
      select: { id: true, sourceTxId: true, purpose: true, date: true },
      take: 8000,
      orderBy: { date: 'desc' },
    });
    if (!rows.length) return { ok: true, total: 0, matched: 0, fixed: 0 };

    const items = rows.map((r) => ({
      id: r.sourceTxId || r.id,
      purpose: r.purpose || '',
      date: r.date ? new Date(r.date).toISOString().slice(0, 10) : '',
    }));
    const matches = await this.crmService.bulkMatch(items);
    const matchMap = new Map(matches.map((m) => [m.id, m.crm]));

    let matched = 0;
    let fixed = 0;
    for (const r of rows) {
      const crm: any = matchMap.get(r.sourceTxId || r.id);
      if (!crm) continue;
      matched++;
      try {
        if (mode === 'xato' && crm.contract) {
          const a = await this.botAssignContract(r.id, crm.contract, actor?.name || 'web');
          if (!a.ok) continue;
        }
        await this.applyCrmSplit(r.id, { initialAmount: crm.initialAmount, monthlyAmount: crm.monthlyAmount }, actor);
        fixed++;
      } catch { /* keyingisi */ }
    }
    this.log.log(`bulkCrmFix(${mode}): total=${rows.length} matched=${matched} fixed=${fixed}`);
    return { ok: true, total: rows.length, matched, fixed };
  }

  async getXatoContractNumbers(): Promise<string[]> {
    const xatoFilter = await this.buildXatoFilter();
    const rows = await this.prisma.oplataKv.findMany({
      where: xatoFilter,
      select: { contractNo: true },
      distinct: ['contractNo'],
    });
    return rows.map((r) => r.contractNo).filter((c): c is string => !!c);
  }

  // ───────────── XATO to'lovlarni TO'LIQ qayta kategoriyalash (manba pipeline) ─────────────

  private readonly SAMPLE_CAP = 200;
  private reverifyStatus: ReverifyStatus = {
    running: false, startedAt: null, finishedAt: null,
    total: 0, done: 0, fixed: 0, notFound: 0, errors: 0,
    fixedSamples: [], notFoundSamples: [],
  };

  getReverifyStatus(): ReverifyStatus {
    return this.reverifyStatus;
  }

  /**
   * XATO to'lovlarni TO'LIQ qayta kategoriyalaydi — xuddi to'lov yangi tushgandek.
   * Har XATO qator uchun categorizeOne(force + forceRefresh): izohдан qayta ekstraksiya
   * (/SH suffiks, I↔1, probel), fresh CRM lookup (buzuq param tuzatilган), ism bo'yicha
   * dublikat dizambiguatsiya — HAMMASI qo'llanadi. Topilса tx.contractNumber yangilanadi
   * va oplata_kv qatori ham yangilanib XATO'dan chiqadi. Fonда ishlaydi.
   */
  async reverifyXato(): Promise<{ pending: number; alreadyRunning: boolean }> {
    if (this.reverifyStatus.running) {
      return { pending: Math.max(0, this.reverifyStatus.total - this.reverifyStatus.done), alreadyRunning: true };
    }
    const xatoFilter = await this.buildXatoFilter();
    const rows = await this.prisma.oplataKv.findMany({
      where: xatoFilter,
      select: { id: true, sourceTxId: true, contractNo: true },
    });
    this.reverifyStatus = {
      running: true, startedAt: new Date().toISOString(), finishedAt: null,
      total: rows.length, done: 0, fixed: 0, notFound: 0, errors: 0,
      fixedSamples: [], notFoundSamples: [],
    };
    this.runReverifyXato(rows)
      .catch((e) => this.log.warn(`reverifyXato xato: ${e?.message}`))
      .finally(() => {
        this.reverifyStatus.running = false;
        this.reverifyStatus.finishedAt = new Date().toISOString();
      });
    return { pending: rows.length, alreadyRunning: false };
  }

  private async runReverifyXato(
    rows: Array<{ id: string; sourceTxId: string | null; contractNo: string | null }>,
  ): Promise<void> {
    const CONCURRENCY = 4;
    const st = this.reverifyStatus;

    // sourceTxId → Transaction.id (bulk)
    const txIds = rows.map((r) => r.sourceTxId).filter((v): v is string => !!v);
    const txMap = new Map<string, string>();
    if (txIds.length) {
      const txs = await this.prisma.transaction.findMany({
        where: { OR: [{ externalId: { in: txIds } }, { id: { in: txIds } }] },
        select: { id: true, externalId: true },
      });
      for (const t of txs) { if (t.externalId) txMap.set(t.externalId, t.id); txMap.set(t.id, t.id); }
    }

    let idx = 0;
    const worker = async () => {
      while (idx < rows.length) {
        const row = rows[idx++];
        try {
          const txId = row.sourceTxId ? txMap.get(row.sourceTxId) : null;
          if (!txId) {
            st.notFound++;
            if (st.notFoundSamples.length < this.SAMPLE_CAP) st.notFoundSamples.push({ contract: row.contractNo || '—', reason: 'Tranzaksiya topilmadi (oplata_kv qatori bank tx bilan bog\'lanmagan)' });
          } else {
            // TO'LIQ qayta kategoriyalash — manba pipeline (yangi to'lov kabi)
            const res = await this.categorization.categorizeOne(txId, { force: true, forceRefresh: true, actor: 'sync' });
            const resolvedNo = res?.contractNumber || row.contractNo || null;
            const cc = resolvedNo ? await this.crmCache.lookup(resolvedNo) : null;
            if (cc?.found) {
              // oplata_kv qatorini yangilaymiz → XATO filtridan (found=true) chiqadi
              await this.prisma.oplataKv.update({
                where: { id: row.id },
                data: {
                  contractNo: cc.contractNumber,
                  object: cc.objectName ?? undefined,
                  client: cc.customerName ?? undefined,
                },
              });
              st.fixed++;
              if (st.fixedSamples.length < this.SAMPLE_CAP) {
                const changed = row.contractNo && row.contractNo !== cc.contractNumber ? row.contractNo : null;
                st.fixedSamples.push({ contract: cc.contractNumber, from: changed, client: cc.customerName, object: cc.objectName, status: cc.status });
              }
            } else {
              st.notFound++;
              if (st.notFoundSamples.length < this.SAMPLE_CAP) {
                // Aniq sabab: raqam umuman ajratilmadimi yoki ajratildi-yu CRM'да yo'qmi
                const reason = !resolvedNo
                  ? "Izohдан shartnoma raqami ajratilmadi (purpose'да № yo'q/noaniq)"
                  : `CRM'да yo'q — qidirildi: ${resolvedNo}`;
                st.notFoundSamples.push({ contract: resolvedNo || row.contractNo || '—', reason });
              }
            }
          }
        } catch (e: any) {
          st.errors++;
          if (st.notFoundSamples.length < this.SAMPLE_CAP) st.notFoundSamples.push({ contract: row.contractNo || '—', reason: 'Xato: ' + String(e?.message || '').slice(0, 80) });
        }
        st.done++;
        if (st.done % 50 === 0) this.log.log(`reverifyXato: ${st.done}/${rows.length} (tuzatildi ${st.fixed})`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    this.log.log(`reverifyXato tugadi: ${rows.length} ko'rildi, tuzatildi ${st.fixed}, topilmadi ${st.notFound}, xato ${st.errors}`);
  }

  // ───────────────── LIST ─────────────────
  async list(q: ListOplataKvDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const perPage = Math.min(200, Math.max(1, Number(q.perPage) || 50));

    const where = this.buildWhere(q);

    // ─── XATO ONLY filter — faqat XATO qatorlarni ko'rsatish ───
    // XATO = tx-manba qator (sourceTxId bor) + contract CRM'da found=true EMAS
    //        + manual/ariza EMAS. (Badge bilan bir xil mantiq.)
    // MUHIM: `notIn: verified` ishlatamiz — agar verified bo'sh bo'lsa ham
    // (yoki xato ro'yxati bo'sh bo'lsa) noto'g'ri "0 qator" qaytmaydi.
    const xatoOnly = q.xatoOnly === 'true' || q.xatoOnly === '1';
    if (xatoOnly) {
      const xatoFilter = await this.buildXatoFilter();
      if (where.AND) (where.AND as any[]).push(xatoFilter);
      else where.AND = [xatoFilter];
    }

    // ─── SPLIT YO'Q filter — shartnomasi bor, lekin ustunlar bo'sh ───
    const unsplitOnly = q.unsplitOnly === 'true' || q.unsplitOnly === '1';
    if (unsplitOnly) {
      const f = await this.buildUnsplitFilter();
      if (where.AND) (where.AND as any[]).push(f);
      else where.AND = [f];
    }

    // ─── crm_status (virtual_status) filtri — vergul bilan ko'p tanlov ───
    // '__none__' = crm_status bo'sh (XATO yoki virtual_status yo'q).
    if (q.crmStatuses && q.crmStatuses.trim()) {
      const crmFilter = await this.buildCrmStatusFilter(q.crmStatuses);
      if (crmFilter) {
        if (where.AND) (where.AND as any[]).push(crmFilter);
        else where.AND = [crmFilter];
      }
    }
    if (q.crmPropertyTypes && q.crmPropertyTypes.trim()) {
      const f = await this.buildPropertyTypeFilter(q.crmPropertyTypes);
      if (f) { if (where.AND) (where.AND as any[]).push(f); else where.AND = [f]; }
    }
    if (q.crmBranches && q.crmBranches.trim()) {
      const f = await this.buildBranchFilter(q.crmBranches);
      if (f) { if (where.AND) (where.AND as any[]).push(f); else where.AND = [f]; }
    }

    const sortBy = q.sortBy || 'date';
    const sortDir: 'asc' | 'desc' = q.sortDir || 'desc';
    const orderBy: Prisma.OplataKvOrderByWithRelationInput = { [sortBy]: sortDir } as any;

    const [items, total, sums] = await Promise.all([
      this.prisma.oplataKv.findMany({
        where, orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.oplataKv.count({ where }),
      this.prisma.oplataKv.aggregate({
        where,
        _sum: { paymentAmount: true, firstInstallment: true, monthlyAmount: true },
      }),
    ]);

    // CRM XATO status + Manba (manual/ariza) — har qator uchun
    // Manba = Transaction'da contract qanday belgilanganini ko'rsatadi:
    //   'ariza'  — isContractManual=true + attachment bor (qog'oz hujjat bilan)
    //   'manual' — isContractManual=true + attachment yo'q (sof qo'lda kiritilgan)
    //   null     — avto-extract yoki CRM verified
    // XATO logikasi: faqat manual va ariza emas bo'lgan unverified contractlar XATO bo'ladi.
    // (Excel eksport bilan bir xil bo'lishi uchun umumiy helper — computeContractXato)
    const { isXato, sourceOf } = await this.computeContractXato(items);

    // crm_status (virtual_status: Бартер, Ипотека...) — CrmContract keshidan, contractNo bo'yicha.
    // Faqat CRM'da topilган (found=true) shartnomalar uchun; XATO'да bo'sh qoladi.
    const cns = Array.from(new Set(items.map((i) => (i.contractNo || '').toUpperCase()).filter(Boolean)));
    const crmRows = cns.length
      ? await this.prisma.crmContract.findMany({
          where: { contractNumber: { in: cns }, found: true },
          select: { contractNumber: true, virtualStatus: true, branchName: true, propertyType: true },
        })
      : [];
    // Faqat haqiqiy (bo'sh bo'lmagan) qiymatlar. '' = "tekshirildi, yo'q" → ko'rsatilmaydi.
    // Hali tekshirilmagan (NULL) shartnomalarni backfill cronlari to'ldiradi.
    const crmStatusMap = new Map<string, string>();
    const crmBranchMap = new Map<string, string>();
    const crmTypeMap = new Map<string, string>();
    for (const c of crmRows) {
      const key = c.contractNumber.toUpperCase();
      if (c.virtualStatus && c.virtualStatus.trim()) crmStatusMap.set(key, c.virtualStatus);
      if (c.branchName && c.branchName.trim()) crmBranchMap.set(key, c.branchName);
      if (c.propertyType) crmTypeMap.set(key, c.propertyType);
    }

    const itemsWithStatus = items.map((i) => {
      const key = (i.contractNo || '').toUpperCase();
      return {
        ...i,
        crmXato: isXato(i),
        contractSource: sourceOf(i),  // 'manual' | 'ariza' | null
        crmStatus: crmStatusMap.get(key) || null,
        crmBranch: crmBranchMap.get(key) || null,          // sotuv bo'limi
        crmPropertyType: crmTypeMap.get(key) || null,      // 'parking' | 'apartment'
      };
    });

    return {
      ok: true,
      page, perPage, total,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      items: itemsWithStatus,
      sums: {
        paymentAmount:    Number(sums._sum.paymentAmount    ?? 0),
        firstInstallment: Number(sums._sum.firstInstallment ?? 0),
        monthlyAmount:    Number(sums._sum.monthlyAmount    ?? 0),
      },
    };
  }

  // ───────────────── OBYEKT BO'YICHA HISOBOT (dashboard) ─────────────────
  /**
   * Obyektlar bo'yicha to'lovlar yig'indisi — Telegram hisobotidagi kabi:
   * har obyekt uchun Сумма оплаты / 1 взнос / Ойлик, + umumiy ЖАМИ.
   */
  async byObject(opts: { dateFrom?: string; dateTo?: string; mode?: 'normal' | 'refund'; includeSchotchik?: boolean; crmStatuses?: string; propertyTypes?: string; branches?: string } = {}) {
    const where: any = {};
    if (opts.dateFrom || opts.dateTo) {
      const range: any = {};
      if (opts.dateFrom) range.gte = new Date(opts.dateFrom);
      if (opts.dateTo) range.lte = new Date(`${opts.dateTo}T23:59:59.999`);
      where.date = range;
    }
    if (opts.mode === 'refund') {
      // ВОЗВРАТ: 0 dan kichik summalar + "возврат" bilan boshlanadigan tiplar
      where.paymentAmount = { lt: 0 };
      where.txType = { startsWith: 'возврат', mode: 'insensitive' };
    } else {
      // Oddiy: 0 dan katta summalar + "взнос" qatnashgan tiplar
      // (masalan "Взносы за автостоянку", "Взносы за квартиры")
      where.paymentAmount = { gt: 0 };
      if (opts.includeSchotchik) {
        // Toggle yoqilsa — "За счетчик" (счётчик) to'lovlarni ham qo'shamiz
        where.OR = [
          { txType: { contains: 'взнос', mode: 'insensitive' } },
          { txType: { contains: 'счетчик', mode: 'insensitive' } },
          { txType: { contains: 'счётчик', mode: 'insensitive' } },
        ];
      } else {
        where.txType = { contains: 'взнос', mode: 'insensitive' };
      }
      // "Взнос от имени клиента" — mijoz nomidan boshqa odam to'lagan, obyekt tushumiga KIRMAYDI
      where.NOT = { txType: { contains: 'от имени', mode: 'insensitive' } };
    }

    // crm_status (virtual_status) filtri — tanlangan CRM statusdagi to'lovlar
    if (opts.crmStatuses && opts.crmStatuses.trim()) {
      const cf = await this.buildCrmStatusFilter(opts.crmStatuses);
      if (cf) where.AND = [...(where.AND || []), cf];
    }
    // Тип (жилой / парковка) — CrmContract.propertyType
    if (opts.propertyTypes && opts.propertyTypes.trim()) {
      const pf = await this.buildPropertyTypeFilter(opts.propertyTypes);
      if (pf) where.AND = [...(where.AND || []), pf];
    }
    // Сотув бўлими — CrmContract.branchName
    if (opts.branches && opts.branches.trim()) {
      const bf = await this.buildBranchFilter(opts.branches);
      if (bf) where.AND = [...(where.AND || []), bf];
    }

    // groupBy — Prisma'ning `having` mapped-type'i TS'da circular reference
    // beradi (ma'lum quirk), shuning uchun cast qilamiz.
    const grouped = await (this.prisma.oplataKv.groupBy as any)({
      by: ['object'],
      where,
      _sum: { paymentAmount: true, firstInstallment: true, monthlyAmount: true },
      _count: true,
    });

    const rows = (grouped as Array<{ object: string | null; _sum: { paymentAmount: any; firstInstallment: any; monthlyAmount: any }; _count: number }>)
      .map((g) => ({
        object: g.object || '—',
        paymentAmount:    Number(g._sum.paymentAmount    ?? 0),
        firstInstallment: Number(g._sum.firstInstallment ?? 0),
        monthlyAmount:    Number(g._sum.monthlyAmount    ?? 0),
        count: g._count,
      }))
      // Obyekt nomi bo'yicha alifbo tartibida (Telegram hisobotidagi kabi)
      .sort((a, b) => a.object.localeCompare(b.object, 'ru'));

    const total = rows.reduce(
      (acc, r) => ({
        paymentAmount:    acc.paymentAmount    + r.paymentAmount,
        firstInstallment: acc.firstInstallment + r.firstInstallment,
        monthlyAmount:    acc.monthlyAmount    + r.monthlyAmount,
        count:            acc.count            + r.count,
      }),
      { paymentAmount: 0, firstInstallment: 0, monthlyAmount: 0, count: 0 },
    );

    return { ok: true, rows, total };
  }

  /**
   * Kunlik xulosa — tanlangan kun uchun tushum + solishtirish:
   *   kun, kecha, oy boshidan (MTD), o'tgan oyning shu davri + 14 kunlik trend
   *   + top obyektlar. FAQAT oplata-kv'dan. "normal" filter (paymentAmount>0,
   *   txType 'взнос') — "Obyektlar bo'yicha to'lovlar" bilan bir xil manba.
   */
  async dailySummary(dateStr?: string) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const parsed = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
    const day = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    day.setHours(12, 0, 0, 0);
    const shift = (offset: number) => { const d = new Date(day); d.setDate(d.getDate() + offset); return d; };

    // oplata_kv.date — DATE-only (vaqtsiz), shu bois vaqtni FAQAT createdAt (yozib
    // olingan vaqt) beradi. Tanlangan kun BUGUN bo'lsa — kechani xuddi shu vaqtgacha
    // (createdAt) cheklab, adolatli solishtiramiz (bugun hozirgacha ↔ kecha shu vaqtgacha).
    const now = new Date();
    const isToday = fmt(day) === fmt(now);

    const baseWhere: any = { paymentAmount: { gt: 0 }, txType: { contains: 'взнос', mode: 'insensitive' } };
    const sumRange = async (fromStr: string, toStr: string, createdBefore?: Date | null) => {
      const where: any = { ...baseWhere, date: { gte: new Date(fromStr), lte: new Date(`${toStr}T23:59:59.999`) } };
      if (createdBefore) where.createdAt = { lte: createdBefore };
      const a = await this.prisma.oplataKv.aggregate({
        where,
        _sum: { paymentAmount: true, firstInstallment: true, monthlyAmount: true },
        _count: true,
      });
      return {
        total: Number(a._sum.paymentAmount || 0),
        first: Number(a._sum.firstInstallment || 0),
        monthly: Number(a._sum.monthlyAmount || 0),
        count: a._count,
      };
    };

    const dayKey = fmt(day);
    const dayS = await sumRange(dayKey, dayKey);
    const yKey = fmt(shift(-1));
    // Bugun bo'lsa: kechagi tushumni kechagi kun 00:00 → shu vaqt (soat:daqiqa) oralig'ida olamiz.
    const prevCutoff = isToday
      ? new Date(`${yKey}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.999`)
      : null;
    const prevDayS = await sumRange(yKey, yKey, prevCutoff);

    const monthStart = new Date(day.getFullYear(), day.getMonth(), 1, 12);
    const mtdS = await sumRange(fmt(monthStart), dayKey);
    const prevMonthStart = new Date(day.getFullYear(), day.getMonth() - 1, 1, 12);
    const prevMonthSame = new Date(day.getFullYear(), day.getMonth() - 1, day.getDate(), 12);
    const prevMtdS = await sumRange(fmt(prevMonthStart), fmt(prevMonthSame));

    // 14 kunlik trend (kun bo'yicha)
    const seriesFrom = shift(-13);
    const grp = await this.prisma.oplataKv.groupBy({
      by: ['date'],
      where: { ...baseWhere, date: { gte: new Date(fmt(seriesFrom)), lte: new Date(`${dayKey}T23:59:59.999`) } },
      _sum: { paymentAmount: true },
    });
    const byDate = new Map<string, number>();
    for (const g of grp) byDate.set(fmt(new Date(g.date as Date)), Number(g._sum.paymentAmount || 0));
    const series: { date: string; total: number }[] = [];
    for (let i = 13; i >= 0; i--) { const k = fmt(shift(-i)); series.push({ date: k, total: byDate.get(k) || 0 }); }

    // Top obyektlar (o'sha kun)
    const byObj = await this.byObject({ dateFrom: dayKey, dateTo: dayKey, mode: 'normal' });
    const topObjects = ((byObj.rows as any[]) || [])
      .filter((r) => r.paymentAmount > 0)
      .sort((a, b) => b.paymentAmount - a.paymentAmount)
      .slice(0, 6)
      .map((r) => ({ object: r.object, amount: r.paymentAmount }));

    return { ok: true, date: dayKey, day: dayS, prevDay: prevDayS, mtd: mtdS, prevMtd: prevMtdS, series, topObjects };
  }

  /**
   * "Счётчик → Ежемесячный" — Тип (txType) = 'За счетчик' bo'lgan ОплатыКв qatorlarni
   * (sana >= dateFrom) OYLIKKA majburlaydi:
   *   monthlyAmount = paymentAmount (Сумма оплаты → ежемесячный),
   *   firstInstallment = null,
   *   paymentCategory = MONTHLY (Оплата = ежемесячный).
   * FAQAT ОплатыКв o'zgaradi (tranzaksiyaga tegilmaydi — u allaqachon 'За счетчик').
   * dryRun=true (default) — faqat nechta topilishini ko'rsatadi, o'zgartirmaydi.
   */
  async schotchikToMonthly(opts: { dateFrom?: string; dryRun?: boolean; actor?: Actor } = {}) {
    const dryRun = opts.dryRun !== false;
    const from = opts.dateFrom ? new Date(opts.dateFrom) : new Date('2024-01-01');
    const fromStr = from.toISOString().slice(0, 10);

    const total = await this.prisma.oplataKv.count({
      where: { txType: 'За счетчик', date: { gte: from } },
    });

    // Yangilanishi kerak (hali oylik emas) — apply bilan bir xil shart
    const needRows: Array<{ n: number }> = await this.prisma.$queryRaw`
      SELECT COUNT(*)::int AS n FROM oplata_kv
      WHERE tx_type = 'За счетчик' AND date >= ${from} AND payment_amount IS NOT NULL
        AND (payment_category IS DISTINCT FROM 'MONTHLY'::"OplataKvCategory"
             OR first_installment IS NOT NULL
             OR monthly_amount IS DISTINCT FROM payment_amount)
    `;
    const needsUpdate = Number(needRows?.[0]?.n || 0);

    const sampleRows = await this.prisma.oplataKv.findMany({
      where: {
        txType: 'За счетчик', date: { gte: from }, paymentAmount: { not: null },
        OR: [
          { paymentCategory: null },
          { paymentCategory: { not: OplataKvCategory.MONTHLY } },
          { firstInstallment: { not: null } },
        ],
      },
      orderBy: { date: 'desc' }, take: 6,
      select: { contractNo: true, date: true, paymentAmount: true, object: true, client: true },
    });
    const samples = sampleRows.map((s) => ({
      contractNo: s.contractNo,
      date: s.date.toISOString().slice(0, 10),
      amount: Number(s.paymentAmount || 0),
      object: s.object,
      client: s.client,
    }));

    if (dryRun || needsUpdate === 0) {
      return { ok: true, dryRun, dateFrom: fromStr, total, needsUpdate, updated: 0, samples };
    }

    // APPLY — column-to-column (monthly_amount = payment_amount) — raw SQL (Prisma updateMany qila olmaydi)
    // MUHIM: updated_at ni DB NOW() emas, APP soati (appNow) bilan yozamiz. Agar DB server
    // soati UTC bo'lmasa (masalan +5s Toshkent skew), NOW() KELAJAKDAGI qiymat beradi va bu
    // delta-sync (updatedSince) kursorini kelajakka sakratib, oradagi haqiqiy to'lovlarni
    // "ko'r" qilib o'tkazib yuboradi. Prisma @updatedAt (qolgan barcha yozuv) app soatini
    // ishlatadi — izchillik uchun bu yerda ham shuni beramiz.
    const appNow = new Date();
    const updated: number = await this.prisma.$executeRaw`
      UPDATE oplata_kv
      SET monthly_amount = payment_amount,
          first_installment = NULL,
          payment_category = 'MONTHLY'::"OplataKvCategory",
          updated_at = ${appNow}
      WHERE tx_type = 'За счетчик' AND date >= ${from} AND payment_amount IS NOT NULL
        AND (payment_category IS DISTINCT FROM 'MONTHLY'::"OplataKvCategory"
             OR first_installment IS NOT NULL
             OR monthly_amount IS DISTINCT FROM payment_amount)
    `;
    this.log.log(`schotchikToMonthly APPLY: ${updated} qator oylikka o'tkazildi (dateFrom=${fromStr}, actor=${opts.actor?.name || '-'})`);
    return { ok: true, dryRun: false, dateFrom: fromStr, total, needsUpdate, updated: Number(updated), samples };
  }

  /** "Счётчик → Ежемесячный" avto-rejim sozlamalarini o'qish. */
  getSchotchikConfig() {
    return this.settings.getSchotchikAutoConfig();
  }

  /** "Счётчик → Ежемесячный" avto-rejim sozlamalarini saqlash. */
  setSchotchikConfig(
    vals: { enabled?: boolean; dateFrom?: string | null; dayStart?: string; dayEnd?: string; intervalMin?: number },
    updatedBy?: string,
  ) {
    return this.settings.setSchotchikAutoConfig(vals, updatedBy);
  }

  /**
   * byObject hisobotining bitta obyekt qatoriga drill-down —
   * o'sha summani tashkil qilgan alohida to'lovlar (aynan bir xil filter mantiqi).
   */
  async byObjectDetail(opts: {
    object: string;
    dateFrom?: string;
    dateTo?: string;
    mode?: 'normal' | 'refund';
    includeSchotchik?: boolean;
    crmStatuses?: string;
    propertyTypes?: string;
    branches?: string;
  }) {
    const where: any = {};

    // Obyekt filtri:
    //   '__ALL__' → barcha obyektlar (filtr yo'q, JAMI drill-down uchun)
    //   '—'/bo'sh → obyekti yo'q (null/bo'sh) qatorlar
    //   aks holda → aniq obyekt
    if (opts.object === '__ALL__') {
      // filtr qo'shilmaydi
    } else if (!opts.object || opts.object === '—') {
      where.OR = [{ object: null }, { object: '' }];
    } else {
      where.object = opts.object;
    }

    if (opts.dateFrom || opts.dateTo) {
      const range: any = {};
      if (opts.dateFrom) range.gte = new Date(opts.dateFrom);
      if (opts.dateTo) range.lte = new Date(`${opts.dateTo}T23:59:59.999`);
      where.date = range;
    }
    if (opts.mode === 'refund') {
      where.paymentAmount = { lt: 0 };
      where.txType = { startsWith: 'возврат', mode: 'insensitive' };
    } else {
      where.paymentAmount = { gt: 0 };
      if (opts.includeSchotchik) {
        // object filtri where.OR ni band qilishi mumkin — shuning uchun
        // txType shartini AND ichiga qo'yamiz (взнос YOKI счётчик)
        where.AND = [
          ...(where.AND || []),
          {
            OR: [
              { txType: { contains: 'взнос', mode: 'insensitive' } },
              { txType: { contains: 'счетчик', mode: 'insensitive' } },
              { txType: { contains: 'счётчик', mode: 'insensitive' } },
            ],
          },
        ];
      } else {
        where.txType = { contains: 'взнос', mode: 'insensitive' };
      }
      // "Взнос от имени клиента" — obyekt tushumiga kirmaydi (byObject summary bilan mos)
      where.NOT = { txType: { contains: 'от имени', mode: 'insensitive' } };
    }

    // crm_status (virtual_status) filtri — byObject bilan bir xil
    if (opts.crmStatuses && opts.crmStatuses.trim()) {
      const cf = await this.buildCrmStatusFilter(opts.crmStatuses);
      if (cf) where.AND = [...(where.AND || []), cf];
    }
    // Тип (жилой / парковка) — ОплатыКв jadvalidagi filtr bilan bir xil qoida
    if (opts.propertyTypes && opts.propertyTypes.trim()) {
      const pf = await this.buildPropertyTypeFilter(opts.propertyTypes);
      if (pf) where.AND = [...(where.AND || []), pf];
    }
    // Сотув бўлими — CrmContract.branchName
    if (opts.branches && opts.branches.trim()) {
      const bf = await this.buildBranchFilter(opts.branches);
      if (bf) where.AND = [...(where.AND || []), bf];
    }

    const ROW_CAP = 5000;
    const [rows, agg] = await Promise.all([
      this.prisma.oplataKv.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          contractNo: true,
          date: true,
          paymentAmount: true,
          firstInstallment: true,
          monthlyAmount: true,
          paymentCategory: true,
          txType: true,
          client: true,
          object: true,
          purpose: true,
          paymentMethod: true,
        },
        take: ROW_CAP,
      }),
      // Jami — aggregate bilan (qatorlar cheklansa ham JAMI to'g'ri bo'ladi)
      this.prisma.oplataKv.aggregate({
        where,
        _sum: { paymentAmount: true, firstInstallment: true, monthlyAmount: true },
        _count: true,
      }),
    ]);

    const total = {
      paymentAmount:    Number(agg._sum.paymentAmount    ?? 0),
      firstInstallment: Number(agg._sum.firstInstallment ?? 0),
      monthlyAmount:    Number(agg._sum.monthlyAmount    ?? 0),
    };

    return {
      ok: true,
      object: opts.object,
      count: agg._count,
      truncated: agg._count > rows.length,
      rows,
      total,
    };
  }

  /** byObjectDetail drill-down'ni Excel (.xlsx) sifatida eksport qilish. */
  async byObjectDetailXlsx(opts: {
    object: string;
    dateFrom?: string;
    dateTo?: string;
    mode?: 'normal' | 'refund';
    includeSchotchik?: boolean;
    crmStatuses?: string;
    propertyTypes?: string;
    branches?: string;
  }): Promise<{ buffer: Buffer; filename: string }> {
    const { rows, total } = await this.byObjectDetail(opts);
    const isAll = opts.object === '__ALL__';

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet('Объект');

    const cols: Partial<ExcelJS.Column>[] = [
      { header: 'Дог №', key: 'contractNo', width: 16 },
      { header: 'Дата',  key: 'date',       width: 12 },
    ];
    if (isAll) cols.push({ header: 'Объект', key: 'object', width: 20 });
    cols.push(
      { header: 'Тип',         key: 'txType',           width: 24 },
      { header: 'Клиент',      key: 'client',           width: 30 },
      { header: 'Оплата',      key: 'paymentCategory',  width: 14 },
      { header: 'Сумма',       key: 'paymentAmount',    width: 18 },
      { header: '1 взнос',     key: 'firstInstallment', width: 18 },
      { header: 'Ежемесячный', key: 'monthlyAmount',    width: 18 },
    );
    ws.columns = cols;

    // Sarlavha ustidagi qator — obyekt nomi + davr
    const objLabel = isAll
      ? 'Все объекты'
      : (!opts.object || opts.object === '—' ? 'Без объекта' : opts.object);
    const label = `${objLabel}  ·  ${opts.dateFrom || '—'} → ${opts.dateTo || '—'}  ·  ${opts.mode === 'refund' ? 'Возврат' : 'Платежи'}`;
    ws.spliceRows(1, 0, [label]);
    const lastColLetter = String.fromCharCode(64 + cols.length);
    ws.mergeCells(`A1:${lastColLetter}1`);
    const titleCell = ws.getCell('A1');
    titleCell.font = { bold: true, size: 12 };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(1).height = 24;

    const head = ws.getRow(2);
    head.font = { bold: true, size: 10 };
    head.height = 22;
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    const categoryLabel: Record<string, string> = {
      MONTHLY: 'ежемесячный',
      FIRST:   '1 взнос',
      GENERAL: 'Общий',
    };

    for (const it of rows) {
      let date = '';
      if (it.date) {
        const d = new Date(it.date);
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        date = `${dd}.${mm}.${d.getUTCFullYear()}`;
      }
      const row = ws.addRow({
        contractNo: it.contractNo || '',
        date,
        object: it.object || '',
        txType: it.txType || '',
        client: it.client || '',
        paymentCategory: it.paymentCategory ? (categoryLabel[it.paymentCategory] || it.paymentCategory) : '',
        paymentAmount:    it.paymentAmount    != null ? Number(it.paymentAmount)    : null,
        firstInstallment: it.firstInstallment != null ? Number(it.firstInstallment) : null,
        monthlyAmount:    it.monthlyAmount    != null ? Number(it.monthlyAmount)    : null,
      });
      row.font = { size: 9 };
      row.getCell('paymentAmount').numFmt    = '#,##0.00';
      row.getCell('firstInstallment').numFmt = '#,##0.00';
      row.getCell('monthlyAmount').numFmt    = '#,##0.00';
      row.getCell('date').numFmt = '@';
      row.getCell('date').alignment = { horizontal: 'center' };
    }

    if (rows.length > 0) {
      const totalRow = ws.addRow({
        contractNo: 'ИТОГО:',
        paymentAmount:    total.paymentAmount,
        firstInstallment: total.firstInstallment,
        monthlyAmount:    total.monthlyAmount,
      });
      totalRow.font = { bold: true, size: 10 };
      totalRow.getCell('paymentAmount').numFmt    = '#,##0.00';
      totalRow.getCell('firstInstallment').numFmt = '#,##0.00';
      totalRow.getCell('monthlyAmount').numFmt    = '#,##0.00';
      totalRow.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      });
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const safeObj = isAll
      ? 'barcha'
      : (opts.object || 'obyekt').replace(/[^\wа-яёА-ЯЁa-zA-Z0-9]+/g, '_').slice(0, 40);
    const ts = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `obyekt-${safeObj}-${ts}.xlsx` };
  }

  // ───────────────── SPLIT KERAK SHARTNOMALAR ─────────────────
  /**
   * CRM'da topilgan (verified), lekin to'lovi hali split bo'lmagan shartnomalar.
   * "Split bo'lmagan" = paymentAmount bor, lekin firstInstallment/monthlyAmount/
   * paymentCategory NULL (qo'lda qo'yilmagan). Har shartnoma uchun qator soni + summa.
   */
  /**
   * API order_id (crm_order_id) qamrovi — nechta to'lovda order_id bor/yo'q + shartnoma darajasi.
   * order_id = contractNo → CrmContract.crm_order_id (katta harf bilan mos).
   * API'da ko'rinadigan qatorlar = paymentCategory != null (split qilingan).
   */
  async orderIdCoverage() {
    const [rowTotal, rowWithRaw, foundTotal, filled, xato] = await Promise.all([
      this.prisma.oplataKv.count({ where: { paymentCategory: { not: null } } }),
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*)::bigint AS n
        FROM oplata_kv o
        JOIN crm_contracts c ON upper(o.contract_no) = upper(c.contract_number)
        WHERE o.payment_category IS NOT NULL AND c.crm_order_id IS NOT NULL`,
      this.prisma.crmContract.count({ where: { found: true } }),
      this.prisma.crmContract.count({ where: { found: true, crmOrderId: { not: null } } }),
      this.prisma.crmContract.count({ where: { found: false } }),
    ]);
    const rowWith = Number(rowWithRaw?.[0]?.n ?? 0);
    const pct = rowTotal > 0 ? Math.round((rowWith / rowTotal) * 1000) / 10 : 0;
    return {
      ok: true,
      rows: { total: rowTotal, withOrderId: rowWith, withoutOrderId: Math.max(0, rowTotal - rowWith), percent: pct },
      contracts: { foundTotal, filled, pending: Math.max(0, foundTotal - filled), xato },
    };
  }

  async unsplitContracts() {
    // CRM verified shartnoma raqamlari
    const verified = await this.prisma.crmContract.findMany({
      where: { found: true },
      select: { contractNumber: true },
    });
    const verifiedSet = new Set(verified.map((c) => c.contractNumber));

    // СЧЁТЧИК to'lovlarini ro'yxatdan chiqaramiz — ular split qilinmaydi
    // (ularga split paytida Оплата=Общий qo'yiladi, lekin "split kerak" emas).
    const schetchikTxs = await this.prisma.transaction.findMany({
      where: { subcategory: { code: 'CLIENT_SCHETCHIK' } },
      select: { id: true, externalId: true },
    });
    const schetchikIds: string[] = [];
    for (const tx of schetchikTxs) {
      schetchikIds.push(tx.id);
      if (tx.externalId) schetchikIds.push(tx.externalId);
    }

    const splitWhere: any = {
      sourceTxId: { not: null },
      paymentAmount: { not: null },
      firstInstallment: null,
      monthlyAmount: null,
      paymentCategory: null,
    };
    // notIn juda katta bo'lmasa — счётчик manbalarini chiqaramiz
    if (schetchikIds.length > 0 && schetchikIds.length <= 30000) {
      splitWhere.sourceTxId = { not: null, notIn: schetchikIds };
    }

    // Split bo'lmagan qatorlar — splitInstallments where bilan bir xil
    const grouped = await (this.prisma.oplataKv.groupBy as any)({
      by: ['contractNo'],
      where: splitWhere,
      _count: true,
      _sum: { paymentAmount: true },
    });

    const items = (grouped as Array<{ contractNo: string | null; _count: number; _sum: { paymentAmount: any } }>)
      .filter((g) => g.contractNo && verifiedSet.has(g.contractNo))
      .map((g) => ({
        contractNo: g.contractNo as string,
        count: g._count,
        totalAmount: Number(g._sum.paymentAmount ?? 0),
      }))
      .sort((a, b) => b.count - a.count);

    return { ok: true, count: items.length, items };
  }

  // ───────────────── EXPORT UCHUN QATORLAR (Google Sheets) ─────────────────
  /**
   * Google Sheets eksporti uchun barcha mos qatorlarni qaytaradi (pagination'siz).
   * Sana oralig'i + obyekt / kategoriya / tip filtrlari bilan.
   *   dateFrom / dateTo — YYYY-MM-DD (dateTo o'sha kun oxirigacha qamraydi)
   *   objects / categories / txTypes — bo'sh bo'lsa filtr qo'llanmaydi.
   * Tartib: sana o'sish bo'yicha (eng eski tepada), keyin yaratilgan vaqt.
   */
  async getRowsForExport(filter: {
    dateFrom?: string | null;
    dateTo?: string | null;
    objects?: string[] | null;
    categories?: string[] | null;
    txTypes?: string[] | null;
    amountSign?: 'pos' | 'neg' | null; // Сумма оплаты: pos = >0, neg = <0 (0 skip)
    limit?: number;
  }) {
    const where: Prisma.OplataKvWhereInput = {};
    if (filter.dateFrom || filter.dateTo) {
      const range: any = {};
      if (filter.dateFrom) range.gte = new Date(filter.dateFrom);
      if (filter.dateTo)   range.lte = new Date(`${filter.dateTo}T23:59:59.999`);
      where.date = range;
    }
    if (filter.objects && filter.objects.length > 0) {
      where.object = { in: filter.objects };
    }
    if (filter.categories && filter.categories.length > 0) {
      where.paymentCategory = { in: filter.categories as OplataKvCategory[] };
    }
    if (filter.txTypes && filter.txTypes.length > 0) {
      where.txType = { in: filter.txTypes };
    }
    // Сумма оплаты bo'yicha filtr — 0 dan baland yoki 0 dan kichik (0 ga tenglar tashlanadi)
    if (filter.amountSign === 'pos') where.paymentAmount = { gt: 0 };
    else if (filter.amountSign === 'neg') where.paymentAmount = { lt: 0 };

    const take = Math.min(Math.max(1, filter.limit || 100000), 200000);
    const rows = await this.prisma.oplataKv.findMany({
      where,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take,
    });
    // XATO status — tranzaksiyadan kelgan, CRM'da tasdiqlanmagan (found≠true,
    // manual/ariza emas) shartnomalar. List bilan bir xil mantiq. Eksportda
    // bunday qatorlarda contractNo o'rniga "XATO" yoziladi.
    const { isXato } = await this.computeContractXato(rows);
    return rows.map((r) => ({ ...r, crmXato: isXato(r) }));
  }

  /**
   * Export "oldindan ko'rish" — filtr bilan nechta qator mos kelishini (yozmasdan) sanaydi.
   * `filtered` = barcha filtr qo'llangan holdagi son (eksport shuncha yozadi),
   * `total` = FAQAT sana oralig'idagi son (filtrsiz baseline — solishtirish uchun).
   */
  async countForExport(filter: {
    dateFrom?: string | null; dateTo?: string | null;
    objects?: string[] | null; categories?: string[] | null;
    txTypes?: string[] | null; amountSign?: 'pos' | 'neg' | null;
  }): Promise<{ filtered: number; total: number }> {
    const dateWhere: Prisma.OplataKvWhereInput = {};
    if (filter.dateFrom || filter.dateTo) {
      const range: any = {};
      if (filter.dateFrom) range.gte = new Date(filter.dateFrom);
      if (filter.dateTo)   range.lte = new Date(`${filter.dateTo}T23:59:59.999`);
      dateWhere.date = range;
    }
    const where: Prisma.OplataKvWhereInput = { ...dateWhere };
    if (filter.objects && filter.objects.length > 0) where.object = { in: filter.objects };
    if (filter.categories && filter.categories.length > 0) where.paymentCategory = { in: filter.categories as OplataKvCategory[] };
    if (filter.txTypes && filter.txTypes.length > 0) where.txType = { in: filter.txTypes };
    if (filter.amountSign === 'pos') where.paymentAmount = { gt: 0 };
    else if (filter.amountSign === 'neg') where.paymentAmount = { lt: 0 };
    const [filtered, total] = await Promise.all([
      this.prisma.oplataKv.count({ where }),
      this.prisma.oplataKv.count({ where: dateWhere }),
    ]);
    return { filtered, total };
  }

  /** Export filtrlari uchun mavjud (distinct) Объект va Тип qiymatlari — dropdown uchun. */
  async distinctExportFilters() {
    const [objs, types] = await Promise.all([
      this.prisma.oplataKv.findMany({
        where: { object: { not: null } }, distinct: ['object'],
        select: { object: true }, orderBy: { object: 'asc' }, take: 1000,
      }),
      this.prisma.oplataKv.findMany({
        where: { txType: { not: null } }, distinct: ['txType'],
        select: { txType: true }, orderBy: { txType: 'asc' }, take: 1000,
      }),
    ]);
    // MUHIM: qiymatlarni TRIM QILMAYMIZ — filtr DB'dagi AYNAN qiymat bilan solishtiradi.
    // (trim qilsak, DB'da probelli qiymat bo'lsa, tanlangan qiymat mos kelmay bo'sh qaytardi.)
    const clean = (arr: (string | null)[]) => Array.from(new Set(arr.filter((x): x is string => !!x && !!x.trim()))).sort();
    return {
      objects: clean(objs.map((o) => o.object)),
      txTypes: clean(types.map((t) => t.txType)),
    };
  }

  // ───────────────── AGENT: XATO to'lovlar (Telegram notifikatori) ─────────────────
  /**
   * Agent uchun XATO to'lovlar — CRM'da tasdiqlanmagan + hali guruhga jo'natilmagan
   * (agentNotifiedAt=null), dateFrom'dan boshlab. Eng eski birinchi.
   */
  async getXatoForAgent(opts: { dateFrom?: string | null; limit?: number }) {
    const xatoFilter = await this.buildXatoFilter();
    const where: Prisma.OplataKvWhereInput = {
      ...(xatoFilter as Prisma.OplataKvWhereInput),
      agentNotifiedAt: null,
    };
    if (opts.dateFrom) where.date = { gte: new Date(opts.dateFrom) };
    const take = Math.min(Math.max(1, opts.limit || 20), 100);
    return this.prisma.oplataKv.findMany({
      where,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take,
    });
  }

  /** Agent guruhga jo'natgan qatorlarni belgilaydi (qayta jo'natmaslik uchun). */
  async markAgentNotified(ids: string[]) {
    if (!ids.length) return { count: 0 };
    return this.prisma.oplataKv.updateMany({
      where: { id: { in: ids } },
      data: { agentNotifiedAt: new Date() },
    });
  }

  /** Kutayotgan (hali jo'natilmagan) XATO to'lovlar soni — agent status uchun. */
  async countXatoForAgent(dateFrom?: string | null) {
    const xatoFilter = await this.buildXatoFilter();
    const where: Prisma.OplataKvWhereInput = {
      ...(xatoFilter as Prisma.OplataKvWhereInput),
      agentNotifiedAt: null,
    };
    if (dateFrom) where.date = { gte: new Date(dateFrom) };
    return this.prisma.oplataKv.count({ where });
  }

  /** XATO qatorlar ro'yxati — Agent mini web (public list) uchun. Eng yangi birinchi. */
  async getXatoRows(opts: { dateFrom?: string | null; limit?: number }) {
    const xatoFilter = await this.buildXatoFilter();
    const where: Prisma.OplataKvWhereInput = { ...(xatoFilter as Prisma.OplataKvWhereInput) };
    if (opts.dateFrom) where.date = { gte: new Date(opts.dateFrom) };
    const take = Math.min(Math.max(1, opts.limit || 1000), 2000);
    return this.prisma.oplataKv.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take,
      select: {
        id: true, date: true, contractNo: true, paymentAmount: true,
        client: true, object: true, txType: true, purpose: true,
      },
    });
  }

  /**
   * Agent web ro'yxati: XATO qatorlar + count'ni BITTA buildXatoFilter bilan
   * (ilgari getXatoRows + countXatoForAgent alohida 2 marta qurardi — sekin edi).
   */
  async getXatoListForAgent(opts: { dateFrom?: string | null; limit?: number }) {
    const xatoFilter = await this.buildXatoFilter();
    const dateWhere = opts.dateFrom ? { date: { gte: new Date(opts.dateFrom) } } : {};
    const rowsWhere: Prisma.OplataKvWhereInput = { ...(xatoFilter as Prisma.OplataKvWhereInput), ...dateWhere };
    const countWhere: Prisma.OplataKvWhereInput = { ...(xatoFilter as Prisma.OplataKvWhereInput), ...dateWhere, agentNotifiedAt: null };
    const take = Math.min(Math.max(1, opts.limit || 1000), 2000);
    const [rows, count] = await Promise.all([
      this.prisma.oplataKv.findMany({
        where: rowsWhere,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take,
        select: {
          id: true, date: true, contractNo: true, paymentAmount: true,
          client: true, object: true, txType: true, purpose: true, sourceTxId: true,
        },
      }),
      this.prisma.oplataKv.count({ where: countWhere }),
    ]);

    // ── Qabul qiluvchi HISOB (obyekt filtri uchun) ──
    // XATO to'lovlarда `object` (CRM'дан) null bo'ladi. Lekin foydalanuvchi hisob
    // (masalan "VATAN RESIDENCE" / "ЗУРСАН") bo'yicha filtrlashni xohlaydi — u tranzaksiyada
    // har doim bor. sourceTxId → Transaction (kirimда qabul qiluvchi = toName, chiqimда = fromName).
    const txIds = rows.map((r) => r.sourceTxId).filter((v): v is string => !!v);
    const txMap = new Map<string, { direction: string; toName: string | null; fromName: string | null }>();
    if (txIds.length) {
      const txs = await this.prisma.transaction.findMany({
        where: { OR: [{ externalId: { in: txIds } }, { id: { in: txIds } }] },
        select: { id: true, externalId: true, direction: true, toName: true, fromName: true },
      });
      for (const t of txs) {
        const rec = { direction: t.direction as string, toName: t.toName, fromName: t.fromName };
        if (t.externalId) txMap.set(t.externalId, rec);
        txMap.set(t.id, rec);
      }
    }
    const enriched = rows.map((r) => {
      const t = r.sourceTxId ? txMap.get(r.sourceTxId) : undefined;
      const account = t ? (t.direction === 'IN' ? t.toName : t.fromName) : null;
      return { ...r, account: (account && account.trim()) || null };
    });
    return { rows: enriched, count };
  }

  // ───────────────── FIND ONE ─────────────────
  async findOne(id: string) {
    const row = await this.prisma.oplataKv.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ОплатыКв qator topilmadi');
    return { ok: true, item: row };
  }

  // ───────────────── SYNC FROM TRANSACTIONS (avto-import) ─────────────────
  /**
   * Tranzaksiyalardan OplatyKv'ga avto-import.
   * Shartlar:
   *  - direction = 'IN' (kirim)
   *  - category.code = 'CLIENT' (Клиент / Физ.Л / Юр.Л)
   *  - contractNumber not null (shartnoma raqami bor)
   *  - txnDate > minDate (foydalanuvchi sozlamasi)
   *
   * Dedup: sourceTxId (unique) orqali — mavjud bo'lsa update, bo'lmasa create.
   */
  /**
   * "Hozir sync" — sozlangan min sanani (getOplatyKvTxMinDate) hurmat qilib to'liq sync.
   * ОплатыКв sahifasidagi tugma uchun (admin "HAMMASI" tugmasi bilan bir xil xatti-harakat).
   */
  async syncNowRespectingSettings(actor?: Actor) {
    const minDate = await this.settings.getOplatyKvTxMinDate();
    return this.syncFromTransactions({ minDate, actor });
  }

  /**
   * Bitta tranzaksiyani ID (yoki externalId) bo'yicha ОплатыКв'ga qo'shish.
   * Sana chegarasini (min date) INOBATGA OLMAYDI — tarixiy to'lovni qo'lda qo'shish uchun.
   * Idempotent: ОплатыКв'da allaqachon bo'lsa qo'shmaydi (log qaytaradi).
   */
  async addOneFromTransaction(txRef: string, actor?: Actor): Promise<{
    ok: boolean;
    status: 'added' | 'exists' | 'not_found' | 'no_contract' | 'not_client';
    message: string;
    oplataKvId?: string;
  }> {
    const ref = (txRef || '').trim();
    if (!ref) return { ok: false, status: 'not_found', message: "To'lov ID kiritilmagan" };

    // 1) Tranzaksiyani topamiz — id yoki externalId bo'yicha
    const tx = await this.prisma.transaction.findFirst({
      where: { OR: [{ id: ref }, { externalId: ref }] },
      include: { category: { select: { code: true } }, subcategory: { select: { name: true } } },
    });
    if (!tx) return { ok: false, status: 'not_found', message: `Tranzaksiya topilmadi: ${ref}` };

    // 2) ОплатыКв'da bormi (sourceTxId = externalId yoki id)
    const dedupKey = tx.externalId || tx.id;
    const keys = Array.from(new Set([dedupKey, tx.id, tx.externalId].filter(Boolean))) as string[];
    const existing = await this.prisma.oplataKv.findFirst({ where: { sourceTxId: { in: keys } }, select: { id: true } });
    if (existing) return { ok: true, status: 'exists', message: "Bu to'lov allaqachon ОплатыКв'da bor", oplataKvId: existing.id };

    // 3) Shartlar — CLIENT + shartnoma bo'lishi kerak
    if (tx.category?.code !== 'CLIENT') {
      return { ok: false, status: 'not_client', message: `Faqat CLIENT to'lovlar qo'shiladi (bu: ${tx.category?.code || 'kategoriyasiz'})` };
    }
    if (!tx.contractNumber) {
      return { ok: false, status: 'no_contract', message: "Shartnoma raqami yo'q — avval tranzaksiyaga shartnoma biriktiring" };
    }

    // 4) CRM ma'lumot (klient/obyekt) + qatorni yaratamiz (auto-import bilan bir xil mantiq)
    const crm = await this.crmCache.lookup(tx.contractNumber).catch(() => null);
    const rawAmount = Math.abs(Number(tx.amount));
    const signedAmount = tx.direction === 'IN' ? rawAmount : -rawAmount; // IN=+, OUT=- (refund)
    const txParty = tx.direction === 'IN' ? tx.fromName : tx.toName;
    const txTypeName = tx.subcategory?.name || (tx.direction === 'IN' ? 'Взносы за квартиры' : 'Возврат взносов за кв.');
    const actorName = actor?.name || 'qo\'lda qo\'shildi';

    const created = await this.prisma.oplataKv.create({
      data: {
        id: tx.externalId || randomUUID(),
        contractNo: tx.contractNumber,
        date: this.toTashkentDateOnly(tx.txnDate),
        paymentAmount: new Prisma.Decimal(signedAmount),
        purpose: tx.description || null,
        txType: txTypeName,
        client: crm?.customerName || txParty || null,
        object: crm?.objectName || null,
        sourceTxId: dedupKey,
        createdByName: actorName,
      },
      select: { id: true },
    });

    // 5) Shu shartnoma bo'yicha split — 1-vznos/oylik kategoriyalash (best-effort)
    try { await this.splitInstallments({ contractNo: tx.contractNumber, actor }); } catch { /* split keyin ham ishlaydi */ }

    return {
      ok: true, status: 'added', oplataKvId: created.id,
      message: `Qo'shildi: ${tx.contractNumber} · ${signedAmount.toLocaleString('ru-RU')} · ${txTypeName}`,
    };
  }

  async syncFromTransactions(opts: { minDate?: Date | null; limit?: number; actor?: Actor; runInline?: boolean } = {}) {
    const startedAt = Date.now();
    const minDate = opts.minDate ?? null;
    const limit = opts.limit && opts.limit > 0 ? opts.limit : undefined;

    // CLIENT kategoriya — IKKALA direction (IN = to'lov, OUT = refund/qaytarish)
    const where: Prisma.TransactionWhereInput = {
      category: { code: 'CLIENT' },
      contractNumber: { not: null },
    };
    if (minDate) {
      // MUHIM: minDate "YYYY-MM-DD" — Tashkent (UTC+5) sanasini bildiradi.
      // Tashkent end-of-day = 23:59:59 +05:00 = 18:59:59 UTC shu sanada.
      // Avval setUTCHours(23,59,59) edi — bu UTC tunini ifodalardi va 01.05 ning 00:00–05:00 Tashkent
      // tranzaksiyalari (UTC da 30.04 19:00–00:00) skip bo'lardi.
      const dayEnd = new Date(minDate);
      dayEnd.setUTCHours(18, 59, 59, 999);  // 23:59:59 Tashkent (UTC+5)
      where.txnDate = { gt: dayEnd };
    }

    const txList = await this.prisma.transaction.findMany({
      where,
      select: {
        id: true,
        externalId: true,
        txnDate: true,
        amount: true,
        direction: true,         // IN/OUT — sign uchun
        contractNumber: true,
        isContractManual: true,  // Qo'lda tuzatilganmi
        description: true,
        fromName: true,
        toName: true,
        subcategory: { select: { name: true } },  // 'Взносы за квартиры' yoki 'Возврат взносов за кв.'
      },
      orderBy: { txnDate: 'desc' },  // Yangilar avval (limit bilan eng yangilarini olamiz)
      take: limit,
    });

    if (txList.length === 0) {
      // Yangi tx yo'q — tezda XATO cleanup + bg fill/split ishga tushiramiz
      let xatoQuickClean2 = 0;
      try { xatoQuickClean2 = await this.cleanupSplitsForXatoContracts(); } catch {}

      if (!OplataKvService.fillingInProgress) {
        OplataKvService.fillingInProgress = true;
        OplataKvService.bgStartedAt = Date.now();
        OplataKvService.bgPhase = 'fill';
        OplataKvService.bgResult = null;
        setImmediate(async () => {
          try {
            const fillR = await this.fillMissingObjects({ limit: 20000, actor: opts.actor });
            OplataKvService.bgPhase = 'split';
            const splitR = await this.splitInstallments({ limit: 20000, actor: opts.actor });
            OplataKvService.bgResult = { fill: fillR, split: splitR, finishedAt: Date.now() };
            OplataKvService.bgPhase = 'done';
          } catch (e: any) {
            OplataKvService.bgPhase = 'error';
            OplataKvService.bgResult = { error: e?.message };
          } finally {
            OplataKvService.fillingInProgress = false;
          }
        });
      }

      return {
        ok: true,
        version: 'v8-bg-poll',
        total: 0, added: 0, updated: 0, skipped: 0,
        xatoQuickClean: xatoQuickClean2,
        objectsBackground: true,
        duration: Math.round((Date.now() - startedAt) / 1000),
        minDate: minDate ? minDate.toISOString().slice(0, 10) : null,
      };
    }

    // CRM contract cache'dan object va client'larni olamiz (bir martalik query)
    const contractNos = Array.from(new Set(txList.map((t) => t.contractNumber).filter((c): c is string => !!c)));
    const crmContracts = await this.prisma.crmContract.findMany({
      where: { contractNumber: { in: contractNos } },
      select: { contractNumber: true, customerName: true, objectName: true },
    });
    const crmByContract = new Map(crmContracts.map((c) => [c.contractNumber, c]));

    // Object mapping (CRM nomi -> OplatyKv nomi)
    const mappings = await this.prisma.oplataKvObjectMapping.findMany();
    const objMap = new Map(mappings.map((m) => [m.crmName.trim().toLowerCase(), m.oplataName]));
    const mapObject = (crmName: string | null | undefined): string | null => {
      if (!crmName) return null;
      const mapped = objMap.get(crmName.trim().toLowerCase());
      return mapped || crmName;
    };

    let added = 0;
    let updated = 0;
    let skippedNoData = 0;
    let skippedExists = 0;
    let skippedError = 0;
    const errorSamples: Array<{ txId: string; reason: string }> = [];
    const actorName = opts.actor?.name || 'auto · tranzaksiyadan';

    // ─── BATCH: barcha valid tx'lar (XATO ham kiritiladi — keyin tuzatilganda update bo'ladi) ───
    const validTxs = txList.filter((t) => t.contractNumber && t.txnDate);
    skippedNoData = txList.length - validTxs.length;

    const allDedupKeys = validTxs.map((t) => t.externalId || t.id);
    const existingRows = await this.prisma.oplataKv.findMany({
      where: { sourceTxId: { in: allDedupKeys } },
      select: { id: true, sourceTxId: true, paymentAmount: true, contractNo: true, date: true, txType: true },
    });
    const existingMap = new Map(existingRows.map((r) => [r.sourceTxId!, r]));

    // Yangi qatorlar — bulk createMany uchun
    const toCreate: Prisma.OplataKvCreateManyInput[] = [];
    const toCreateHistory: Prisma.OplataKvHistoryCreateManyInput[] = [];
    // Yangilanadigan qatorlar — har biri alohida update (history ham)
    const toUpdate: Array<{
      id: string;
      data: any;
      changedFields: string[];
      historyNote: string;
    }> = [];

    for (const tx of validTxs) {
      const crm = crmByContract.get(tx.contractNumber!);
      // IN = positive (to'lov), OUT = negative (refund)
      const rawAmount = Math.abs(Number(tx.amount));
      const signedAmount = tx.direction === 'IN' ? rawAmount : -rawAmount;
      const amount = new Prisma.Decimal(signedAmount);
      const oplataId = tx.externalId || randomUUID();
      const dedupKey = tx.externalId || tx.id;
      const existing = existingMap.get(dedupKey);
      // Client nomi — IN bo'lsa yuboruvchi, OUT bo'lsa qabul qiluvchi
      const txParty = tx.direction === 'IN' ? tx.fromName : (tx as any).toName;

      // txType — Transaction subcategory.name dan olinadi (default fallback)
      // Misol: 'Взносы за квартиры' (kirim), 'Возврат взносов за кв.' (chiqim/refund)
      const txTypeName = (tx as any).subcategory?.name
        || (tx.direction === 'IN' ? 'Взносы за квартиры' : 'Возврат взносов за кв.');

      // Sana — Tashkent timezone bo'yicha (txnDate UTC bo'lishi mumkin,
      // shuning uchun toTashkentDateOnly orqali to'g'ri kalendar sanasini olamiz)
      const tashkentDate = this.toTashkentDateOnly(tx.txnDate!);

      const baseData = {
        contractNo: tx.contractNumber!,
        date: tashkentDate,
        paymentAmount: amount,
        purpose: tx.description || null,
        txType: txTypeName,
        client: crm?.customerName || txParty || null,
        object: mapObject(crm?.objectName),
      };

      if (existing) {
        const amountChanged   = Number(existing.paymentAmount || 0) !== Number(amount);
        const contractChanged = existing.contractNo !== tx.contractNumber;
        const dateChanged     = new Date(existing.date).getTime() !== tashkentDate.getTime();
        const txTypeChanged   = (existing.txType || '') !== txTypeName;
        if (amountChanged || contractChanged || dateChanged || txTypeChanged) {
          const changedFields = [
            amountChanged && 'paymentAmount',
            contractChanged && 'contractNo',
            dateChanged && 'date',
            txTypeChanged && 'txType',
          ].filter(Boolean) as string[];
          // client'ni faqat CRM egasi mavjud bo'lsa yangilaymiz (agregator nomiga
          // downgrade qilmaslik uchun mavjud client saqlanadi)
          const updateData: any = { ...baseData };
          if (!crm?.customerName) delete updateData.client;
          toUpdate.push({
            id: existing.id,
            data: updateData,
            changedFields,
            historyNote: `Tranzaksiyadan yangilandi (txId: ${tx.id})`,
          });
        } else {
          skippedExists++;
        }
      } else {
        toCreate.push({
          id: oplataId,
          ...baseData,
          sourceTxId: dedupKey,
          createdByName: actorName,
        });
        toCreateHistory.push({
          oplataKvId: oplataId,
          action: 'created',
          actorType: 'system',
          actorId: null,
          actorName,
          fieldsChanged: ['contractNo', 'date', 'paymentAmount', 'client', 'object', 'sourceTxId'],
          changes: this.serializeForHistory({ ...baseData, sourceTxId: dedupKey }) as any,
          note: `Tranzaksiyadan avto-import (txId: ${tx.id}, ext: ${tx.externalId || '—'})`,
        });
      }
    }

    // BULK createMany — chunks 500
    const CHUNK_SIZE = 500;
    for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
      const chunk = toCreate.slice(i, i + CHUNK_SIZE);
      try {
        const res = await this.prisma.oplataKv.createMany({ data: chunk, skipDuplicates: true });
        added += res.count;
      } catch (e: any) {
        skippedError += chunk.length;
        if (errorSamples.length < 5) {
          errorSamples.push({ txId: 'batch', reason: e?.message || 'createMany xato' });
        }
        this.log.warn(`createMany chunk[${i}] xato: ${e?.message}`);
      }
    }

    // BULK history createMany
    if (toCreateHistory.length > 0) {
      try {
        await this.prisma.oplataKvHistory.createMany({ data: toCreateHistory });
      } catch (e: any) {
        this.log.warn(`historyCreateMany xato: ${e?.message}`);
      }
    }

    // Updates — alohida (bir nechta bo'lsa concurrency limit bilan)
    const CONCURRENCY = 10;
    for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
      const batch = toUpdate.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (u) => {
        try {
          await this.prisma.oplataKv.update({ where: { id: u.id }, data: u.data });
          await this.prisma.oplataKvHistory.create({
            data: {
              oplataKvId: u.id,
              action: 'edited',
              actorType: 'system',
              actorId: null,
              actorName,
              fieldsChanged: u.changedFields,
              changes: this.serializeForHistory(u.data) as any,
              note: u.historyNote,
            },
          });
          updated++;
        } catch (e: any) {
          skippedError++;
          if (errorSamples.length < 5) {
            errorSamples.push({ txId: u.id, reason: e?.message || 'update xato' });
          }
        }
      }));
    }

    const syncDuration = Math.round((Date.now() - startedAt) / 1000);
    const skippedTotal = skippedNoData + skippedExists + skippedError;
    this.log.log(
      `syncFromTransactions: total=${txList.length} added=${added} updated=${updated} ` +
      `skipped=${skippedTotal} (noData=${skippedNoData} exists=${skippedExists} error=${skippedError}) ` +
      `syncDuration=${syncDuration}s`,
    );

    // ── SINXRON: XATO splitlarni tezda tozalash (tez updateMany, ~100ms) ──
    let xatoQuickClean = 0;
    try {
      xatoQuickClean = await this.cleanupSplitsForXatoContracts();
    } catch {}

    // ── BG: obyekt/client to'ldirish + split (nginx timeoutdan saqlanish) ──
    // FILL+SPLIT 5-15 daqiqa davom etishi mumkin — orqada ishlatamiz, response tez qaytadi.
    // User modal'da bg jarayonni /oplata-kv/bg-status orqali poll qiladi.
    const fillResult: any = { total: 0, filled: 0, notFound: 0, errors: 0, duration: 0 };
    const splitResult: any = { total: 0, contracts: 0, filled: 0, notFound: 0, errors: 0, duration: 0, xatoCleaned: xatoQuickClean };
    if (!OplataKvService.fillingInProgress) {
      OplataKvService.fillingInProgress = true;
      OplataKvService.bgStartedAt = Date.now();
      OplataKvService.bgPhase = 'fill';
      OplataKvService.bgResult = null;
      setImmediate(async () => {
        try {
          // KAMAYTIRILGAN limit (DB connection pool'ni saqlash uchun)
          // 20000 emas 3000 — boshqa requestlar 502 olmasin
          const fillR = await this.fillMissingObjects({ limit: 3000, actor: opts.actor });
          // КЛИЕНТ nomlarini CRM shartnoma egasiga tuzatish (agregator nomi o'rniga).
          // found=true lekin ismi yo'q shartnomalar uchun jonli so'rov (chegara 400) —
          // bir necha sync ichida barcha tarixiy qatorlar tuzaladi, keyin konvergensiya.
          try {
            const clientR = await this.fixClientNamesFromCrm({ maxLive: 400 });
            this.log.log(`bg client-fix: updated=${clientR.updated}/${clientR.processed} live=${clientR.liveFetched}`);
          } catch (e: any) {
            this.log.warn(`bg client-fix xato: ${e?.message}`);
          }
          OplataKvService.bgPhase = 'split';
          const splitR = await this.splitInstallments({ limit: 3000, actor: opts.actor });
          OplataKvService.bgResult = {
            fill: fillR,
            split: splitR,
            finishedAt: Date.now(),
            duration: Math.round((Date.now() - (OplataKvService.bgStartedAt || Date.now())) / 1000),
          };
          OplataKvService.bgPhase = 'done';
          this.log.log(`bg DONE: fill=${fillR.filled}/${fillR.total} split=${splitR.filled}/${splitR.total} xatoCleaned=${splitR.xatoCleaned}`);
        } catch (e: any) {
          OplataKvService.bgPhase = 'error';
          OplataKvService.bgResult = { error: e?.message || 'bg xato' };
          this.log.warn(`bg job xato: ${e?.message}`);
        } finally {
          OplataKvService.fillingInProgress = false;
        }
      });
    }

    const totalDuration = Math.round((Date.now() - startedAt) / 1000);
    this.log.log(
      `syncFromTransactions DONE: syncDuration=${syncDuration}s totalDuration=${totalDuration}s`,
    );
    return {
      ok: true,
      version: 'v8-bg-poll',
      total: txList.length,
      added,
      updated,
      skipped: skippedTotal,
      skippedBreakdown: {
        noData: skippedNoData,
        exists: skippedExists,
        error:  skippedError,
      },
      errorSamples,
      objectsBackground: true,
      xatoQuickClean,  // Sinxron tozalangan XATO splitlar (response qaytishidan oldin)
      duration: totalDuration,
      syncDuration,
      minDate: minDate ? minDate.toISOString().slice(0, 10) : null,
    };
  }

  // Static flag — bir vaqtda faqat 1 ta background fill ishlaydi (DB raqobatidan saqlanish)
  private static fillingInProgress = false;
  // BG holati — frontend modal poll qiladi
  private static bgStartedAt: number | null = null;
  private static bgPhase: 'fill' | 'split' | 'done' | 'error' | null = null;
  private static bgResult: any = null;

  /** Bg job holati — sync modal'da progress poll uchun */
  getBgStatus() {
    return {
      ok: true,
      running: OplataKvService.fillingInProgress,
      phase: OplataKvService.bgPhase,
      startedAt: OplataKvService.bgStartedAt,
      elapsed: OplataKvService.bgStartedAt
        ? Math.round((Date.now() - OplataKvService.bgStartedAt) / 1000)
        : 0,
      result: OplataKvService.bgResult,
    };
  }

  /**
   * Tranzaksiya-manba qatorlardan obyekt nomi yo'q bo'lganlarni CRM dan to'ldirish.
   * Concurrency-limited bilan: bir vaqtda 5 ta CRM lookup.
   * Cache populate qiladi (keyingi sync'larda foydaliroq).
   */
  async fillMissingObjects(opts: { limit?: number; actor?: Actor } = {}) {
    const startedAt = Date.now();
    const limit = Math.min(opts.limit || 5000, 20000);

    // Source=tx va (object null YOKI client null) — ikkalasini ham to'ldiramiz
    const rows = await this.prisma.oplataKv.findMany({
      where: {
        sourceTxId: { not: null },
        OR: [{ object: null }, { client: null }],
      },
      select: { id: true, contractNo: true, object: true, client: true },
      take: limit,
    });
    if (rows.length === 0) {
      return { ok: true, total: 0, uniqueContracts: 0, filled: 0, notFound: 0, errors: 0, duration: 0 };
    }

    // ContractNo bo'yicha guruhlash + qaysi maydonlarni yangilash kerakligi
    const byContract = new Map<string, Array<{ id: string; needsObject: boolean; needsClient: boolean }>>();
    for (const r of rows) {
      const arr = byContract.get(r.contractNo) || [];
      arr.push({ id: r.id, needsObject: !r.object, needsClient: !r.client });
      byContract.set(r.contractNo, arr);
    }
    const uniqueContracts = Array.from(byContract.keys());

    // Object mapping
    const mappings = await this.prisma.oplataKvObjectMapping.findMany();
    const objMap = new Map(mappings.map((m) => [m.crmName.trim().toLowerCase(), m.oplataName]));

    let filled = 0;
    let notFound = 0;
    let errors = 0;

    // Helper: detail objektidan obyekt nomini topish
    const extractObjectFromDetail = (d: any): string | null => {
      if (!d) return null;
      const candidates = [
        d.object_name, d.object,
        d.info?.object, d.info?.object_name,
        d.client?.object_name, d.client?.object,
      ];
      for (const c of candidates) {
        if (!c) continue;
        if (typeof c === 'string' && c.trim()) return c.trim();
        if (typeof c === 'object') {
          const nm = c.name || c.value || c.uz || c.ru || c.lotin || c.kirill || c.title;
          if (nm && typeof nm === 'string' && nm.trim()) return nm.trim();
        }
      }
      return null;
    };

    // Helper: detail dan client (mijoz) FULL NAME ni qurish
    const extractClientFromDetail = (d: any): string | null => {
      if (!d) return null;
      const c = d.client || {};
      const f = (v: any): string => {
        if (!v) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'object') return v.kirill || v.lotin || v.uz || v.ru || v.name || v.value || '';
        return '';
      };
      const parts = [f(c.last_name), f(c.first_name), f(c.middle_name)].filter(Boolean);
      if (parts.length > 0) return parts.join(' ').trim();
      return c.full_name_kirill || c.full_name_lotin || c.full_name || c.name || c.fio || d.fio || null;
    };

    // ─── TEZLIK OPTIMIZATSIYA ───
    // 1. Avval BARCHA cached contractlarni BITTA query bilan olamiz (DB lookup'lar kamayadi)
    const cachedAll = await this.prisma.crmContract.findMany({
      where: { contractNumber: { in: uniqueContracts.map((c) => c.toUpperCase().trim()) } },
      select: { contractNumber: true, customerName: true, objectName: true, found: true },
    });
    const cachedMap = new Map(cachedAll.map((c) => [c.contractNumber.toUpperCase(), c]));

    // 2. Concurrency 5 -> 25 (5x tezroq, CRM API ham yetadi)
    const CONCURRENCY = 25;
    for (let i = 0; i < uniqueContracts.length; i += CONCURRENCY) {
      const batch = uniqueContracts.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (cn) => {
        try {
          // 1. Cache'dan boshlaymiz — DB query'siz, oldindan yuklangan
          const cached = cachedMap.get(cn.toUpperCase().trim());
          let objName: string | null = cached?.objectName || null;
          let clientName: string | null = cached?.customerName || null;

          // 2. Agar cache to'liq emas (yoki yo'q) — CRM live so'rov
          if (!objName || !clientName) {
            try {
              const resp: any = await this.crmService.show({ contract: cn });
              if (resp?.ok && resp.detail) {
                if (!objName)    objName = extractObjectFromDetail(resp.detail);
                if (!clientName) clientName = extractClientFromDetail(resp.detail);
              }
            } catch { /* CRM xato */ }
          }

          // Mapping qo'llaymiz (faqat obyekt uchun)
          if (objName) {
            const mapped = objMap.get(objName.trim().toLowerCase());
            if (mapped) objName = mapped;
          }

          if (!objName && !clientName) {
            notFound++;
            return;
          }

          const items = byContract.get(cn)!;
          // Har qator uchun update — agar mavjud bo'lsa
          const idsNeedObject = items.filter((it) => it.needsObject).map((it) => it.id);
          const idsNeedClient = items.filter((it) => it.needsClient).map((it) => it.id);

          if (objName && idsNeedObject.length > 0) {
            await this.prisma.oplataKv.updateMany({
              where: { id: { in: idsNeedObject } },
              data: { object: objName },
            });
          }
          if (clientName && idsNeedClient.length > 0) {
            await this.prisma.oplataKv.updateMany({
              where: { id: { in: idsNeedClient } },
              data: { client: clientName },
            });
          }
          filled += items.length;
        } catch (e: any) {
          this.log.warn(`fillMissingObjects ${cn} xato: ${e?.message}`);
          errors++;
        }
      }));
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    this.log.log(
      `fillMissingObjects: total=${rows.length} unique=${uniqueContracts.length} ` +
      `filled=${filled} notFound=${notFound} errors=${errors} duration=${duration}s`,
    );
    return {
      ok: true,
      total: rows.length,
      uniqueContracts: uniqueContracts.length,
      filled,
      notFound,
      errors,
      duration,
    };
  }

  /** CRM detail objektidan mijoz (F.I.O.) ismini quradi. */
  private extractCrmClientName(d: any): string | null {
    if (!d) return null;
    const c = d.client || {};
    const f = (v: any): string => {
      if (!v) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return v.kirill || v.lotin || v.uz || v.ru || v.name || v.value || '';
      return '';
    };
    const parts = [f(c.last_name), f(c.first_name), f(c.middle_name)].filter(Boolean);
    if (parts.length > 0) return parts.join(' ').trim();
    return c.full_name_kirill || c.full_name_lotin || c.full_name || c.name || c.fio || d.fio || null;
  }

  /**
   * Tranzaksiya-manba qatorlarda КЛИЕНТ nomini CRM shartnoma egasi ismiga tuzatadi.
   * To'lov agregatori nomi (masalan "XONSAROY PAYMENTS AJ") o'rniga CRM'dagi haqiqiy
   * shartnoma egasi yoziladi.
   *   - Cache-first: crmContract.customerName (tez, pure DB).
   *   - Cache'da nom yo'q bo'lsa — jonli CRM so'rov (chegara bilan) + cache'ga yozib qo'yiladi.
   * Cursor bilan barcha qatorlarni bir marta aylanadi (konvergensiya kafolatlangan).
   */
  async fixClientNamesFromCrm(opts: { maxRows?: number; maxLive?: number } = {}): Promise<{
    ok: true; processed: number; updated: number; liveFetched: number; duration: number;
  }> {
    const startedAt = Date.now();
    const maxRows = Math.min(opts.maxRows || 200000, 1000000);
    const maxLive = opts.maxLive ?? 1500; // bir yugurishdagi jonli CRM so'rovlar chegarasi
    const BATCH = 2000;
    let processed = 0;
    let updated = 0;
    let liveFetched = 0;
    let cursor: string | undefined;

    while (processed < maxRows) {
      const batch: Array<{ id: string; contractNo: string; client: string | null }> =
        await this.prisma.oplataKv.findMany({
          where: { sourceTxId: { not: null } },
          select: { id: true, contractNo: true, client: true },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;
      processed += batch.length;

      // Shu batchdagi shartnomalar uchun CRM egasi ismini olamiz (cache'da nomi bor bo'lganlar)
      const contractNos = Array.from(new Set(batch.map((r) => r.contractNo)));
      const crm = await this.prisma.crmContract.findMany({
        where: { contractNumber: { in: contractNos }, customerName: { not: null } },
        select: { contractNumber: true, customerName: true },
      });
      const nameByContract = new Map(crm.map((c) => [c.contractNumber, c.customerName as string]));

      // Cache'da nomi yo'q, lekin CRM'da TASDIQLANGAN (found=true) shartnomalar —
      // jonli CRM so'rov (chegara bilan) + cache'ga yozib qo'yamiz. found=true bilan
      // cheklash: XATO/tasdiqlanmagan shartnomalarni behuda so'ramaymiz + konvergensiya.
      const missing = contractNos.filter((cn) => !nameByContract.has(cn));
      if (missing.length > 0 && liveFetched < maxLive) {
        const verifiedMissing = await this.prisma.crmContract.findMany({
          where: { contractNumber: { in: missing }, found: true },
          select: { contractNumber: true },
        });
        const toFetch = verifiedMissing.map((c) => c.contractNumber).slice(0, maxLive - liveFetched);
        const CONC = 20;
        for (let i = 0; i < toFetch.length; i += CONC) {
          const slice = toFetch.slice(i, i + CONC);
          await Promise.all(slice.map(async (cn) => {
            try {
              const resp: any = await this.crmService.show({ contract: cn });
              if (resp?.ok && resp.detail) {
                const name = this.extractCrmClientName(resp.detail);
                if (name) {
                  nameByContract.set(cn, name);
                  const key = cn.trim().toUpperCase();
                  await this.prisma.crmContract.upsert({
                    where: { contractNumber: key },
                    create: { contractNumber: key, customerName: name, found: true },
                    update: { customerName: name },
                  }).catch(() => { /* ignore */ });
                }
              }
            } catch { /* CRM xato — o'tkazib yuboramiz */ }
          }));
          liveFetched += slice.length;
        }
      }

      // client != CRM egasi bo'lganlarni CRM ismi bo'yicha guruhlab yangilaymiz
      const idsByName = new Map<string, string[]>();
      for (const r of batch) {
        const crmName = nameByContract.get(r.contractNo);
        if (crmName && (r.client || '') !== crmName) {
          const arr = idsByName.get(crmName) || [];
          arr.push(r.id);
          idsByName.set(crmName, arr);
        }
      }
      for (const [crmName, ids] of idsByName) {
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const res = await this.prisma.oplataKv.updateMany({
            where: { id: { in: chunk } },
            data: { client: crmName },
          });
          updated += res.count;
        }
      }

      if (batch.length < BATCH) break;
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    this.log.log(`fixClientNamesFromCrm: processed=${processed} updated=${updated} liveFetched=${liveFetched} duration=${duration}s`);
    return { ok: true, processed, updated, liveFetched, duration };
  }

  /**
   * XATO shartnomalardagi (CRM da topilmagan) eski split qiymatlarini tozalash.
   * Avvalgi "all-monthly" fallback tufayli to'lgan bo'lishi mumkin —
   * endi user qoidasi: CRM da yo'q bo'lsa, split umuman qo'yilmaydi.
   *
   * Atomar raw SQL — bitta UPDATE statement bilan barcha XATO qatorlar
   * tozalanadi. Bu Prisma updateMany dan ko'ra ishonchli (race condition yo'q,
   * distinct query'siz).
   *
   * Returns: tozalangan qatorlar soni.
   */
  async cleanupSplitsForXatoContracts(contractNo?: string): Promise<number> {
    // XATO = source_tx_id li qator, contract_no CRM da found=true emas
    // (qator bor lekin found=false, yoki cache'da umuman yo'q — ikkalasi ham XATO)
    let affected: number;
    if (contractNo) {
      affected = await this.prisma.$executeRaw`
        UPDATE oplata_kv
           SET first_installment = NULL,
               monthly_amount    = NULL,
               payment_category  = NULL
         WHERE source_tx_id IS NOT NULL
           AND contract_no = ${contractNo}
           AND (first_installment IS NOT NULL OR monthly_amount IS NOT NULL OR payment_category IS NOT NULL)
           AND NOT EXISTS (
             SELECT 1 FROM crm_contracts c
             WHERE c.contract_number = oplata_kv.contract_no
               AND c.found = true
           )
      `;
    } else {
      affected = await this.prisma.$executeRaw`
        UPDATE oplata_kv
           SET first_installment = NULL,
               monthly_amount    = NULL,
               payment_category  = NULL
         WHERE source_tx_id IS NOT NULL
           AND (first_installment IS NOT NULL OR monthly_amount IS NOT NULL OR payment_category IS NOT NULL)
           AND NOT EXISTS (
             SELECT 1 FROM crm_contracts c
             WHERE c.contract_number = oplata_kv.contract_no
               AND c.found = true
           )
      `;
    }
    this.log.log(`cleanupSplitsForXatoContracts: affected=${affected}`);
    return affected;
  }

  /**
   * DIAGNOSTIC: Tranzaksiyalar va OplatyKv ortasidagi farqni tahlil qilish.
   * Sync sharti: category=CLIENT + contractNumber NOT NULL + direction IN|OUT
   * Bu yerda nima nima sababdan tushib qolganini sanaymiz.
   */
  async debugSyncDiff(opts: { dateFrom?: string; dateTo?: string } = {}) {
    // Tashkent (UTC+5) sana oralig'i: 00:00 Tashkent = 19:00 UTC oldingi kuni
    const dateFilter: any = {};
    if (opts.dateFrom) {
      const df = new Date(opts.dateFrom);
      df.setUTCHours(-5, 0, 0, 0);  // 00:00 Tashkent = -5:00 UTC same date (= 19:00 oldingi UTC kuni)
      dateFilter.gte = df;
    }
    if (opts.dateTo) {
      const dt = new Date(opts.dateTo);
      dt.setUTCHours(18, 59, 59, 999);  // 23:59:59 Tashkent (UTC+5)
      dateFilter.lte = dt;
    }
    const txWhereBase: any = { category: { code: 'CLIENT' } };
    if (Object.keys(dateFilter).length > 0) txWhereBase.txnDate = dateFilter;

    // 1) Tranzaksiyalar — CLIENT toifa, sana oralig'i
    const txTotal = await this.prisma.transaction.count({ where: txWhereBase });

    // 2) Sync sharti: contractNumber NOT NULL
    const txSyncable = await this.prisma.transaction.count({
      where: { ...txWhereBase, contractNumber: { not: null } },
    });

    // 3) Shartnoma yo'q — sync ololmaydi
    const txNoContract = await this.prisma.transaction.count({
      where: { ...txWhereBase, contractNumber: null },
    });

    // 4) Tranzaksiyaning direction bo'yicha taqsimi
    const txByDirection = await this.prisma.transaction.groupBy({
      by: ['direction'],
      where: txWhereBase,
      _count: true,
    });

    // 5) OplatyKv da source=transaction qatorlar (shu oraliqda)
    const oplataWhere: any = { sourceTxId: { not: null } };
    if (Object.keys(dateFilter).length > 0) oplataWhere.date = dateFilter;
    const oplataFromTx = await this.prisma.oplataKv.count({ where: oplataWhere });

    // 6) Sample: shartnomasi yo'q CLIENT tx (5 ta)
    const sampleNoContract = await this.prisma.transaction.findMany({
      where: { ...txWhereBase, contractNumber: null },
      select: { id: true, externalId: true, txnDate: true, amount: true, direction: true, description: true, fromName: true, toName: true },
      orderBy: { txnDate: 'desc' },
      take: 5,
    });

    return {
      ok: true,
      dateRange: { from: opts.dateFrom || null, to: opts.dateTo || null },
      transactions: {
        total: txTotal,                    // CLIENT toifa, sana oralig'i (Tranzaksiyalar UI ko'rsatadi)
        syncable: txSyncable,              // contractNumber bor (sync olishi mumkin)
        skippedNoContract: txNoContract,   // contractNumber NULL (sync ololmaydi)
        byDirection: txByDirection.map((d) => ({ direction: d.direction, count: d._count })),
      },
      oplataKv: {
        fromTransactions: oplataFromTx,    // shu oraliqda tx-manba qatorlar soni
      },
      diff: {
        txMinusOplata: txTotal - oplataFromTx,
        syncableMinusOplata: txSyncable - oplataFromTx,  // bu kichikroq bo'lishi kerak — sync hali yetib bormagan / xato
      },
      sampleNoContract,
    };
  }

  /**
   * DIAGNOSTIC: XATO splitlar holatini batafsil ko'rsatadi.
   * - BEFORE: nechta qator XATO + split bor
   * - SAMPLE: 5 ta misol qator (contract + summalar + CRM holati)
   * - AFTER cleanup: qanchasi tozalandi
   */
  async debugXatoSplits(): Promise<any> {
    // 1) BEFORE: source_tx_id li, splitlari bor qatorlar
    const beforeRowsRaw: any[] = await this.prisma.$queryRaw`
      SELECT id, contract_no, payment_amount, first_installment, monthly_amount, payment_category, source_tx_id
        FROM oplata_kv
       WHERE source_tx_id IS NOT NULL
         AND (first_installment IS NOT NULL OR monthly_amount IS NOT NULL OR payment_category IS NOT NULL)
       LIMIT 1000
    `;

    // 2) Bu qatorlar uchun CRM holati
    const allContracts = Array.from(new Set(beforeRowsRaw.map((r) => r.contract_no)));
    const crmRows: any[] = allContracts.length > 0
      ? await this.prisma.$queryRaw`
          SELECT contract_number, found
            FROM crm_contracts
           WHERE contract_number = ANY(${allContracts}::text[])
        `
      : [];
    const crmMap = new Map(crmRows.map((c) => [c.contract_number, c.found]));

    // 3) Klassifikatsiya
    const classified = beforeRowsRaw.map((r) => ({
      id: r.id,
      contractNo: r.contract_no,
      amount: r.payment_amount,
      first: r.first_installment,
      monthly: r.monthly_amount,
      category: r.payment_category,
      crmFound: crmMap.has(r.contract_no) ? crmMap.get(r.contract_no) : null,
      // 'XATO' (crm da yo'q yoki found=false), 'VERIFIED' (found=true), 'MANUAL' nazariy
      isXato: crmMap.get(r.contract_no) !== true,
    }));

    const xatoCount = classified.filter((c) => c.isXato).length;
    const verifiedCount = classified.filter((c) => !c.isXato).length;
    const sampleXato = classified.filter((c) => c.isXato).slice(0, 10);

    // 4) RUN cleanup
    const cleaned = await this.cleanupSplitsForXatoContracts();

    // 5) AFTER state
    const afterCountRaw: any[] = await this.prisma.$queryRaw`
      SELECT COUNT(*)::int AS cnt
        FROM oplata_kv
       WHERE source_tx_id IS NOT NULL
         AND (first_installment IS NOT NULL OR monthly_amount IS NOT NULL OR payment_category IS NOT NULL)
    `;
    const afterCount = Number(afterCountRaw[0]?.cnt || 0);

    return {
      ok: true,
      before: {
        totalWithSplits: beforeRowsRaw.length,
        xatoCount,
        verifiedCount,
        sampleXato,
      },
      cleanupRun: {
        rowsAffected: cleaned,
      },
      after: {
        totalWithSplits: afterCount,
      },
    };
  }

  /**
   * Tranzaksiyadan kelgan qatorlarda paymentAmount BOR lekin firstInstallment va
   * monthlyAmount yo'q bo'lganlarni CRM payment_histories asosida ajratish.
   *
   * Mantiq:
   * - amount > 0: CRM payment_histories'dan date+amount bilan mos kelgan history topiladi
   *   - type=initial -> firstInstallment, paymentCategory=FIRST
   *   - type=monthly -> monthlyAmount, paymentCategory=MONTHLY
   *   - Mos kelmasa -> default monthly
   * - amount < 0 (refund): avval monthly'ga, yetmasa qolgani initial'ga
   *   - running_monthly (shu contractda shu sanagacha jami monthlyAmount)
   *   - refund <= running_monthly -> hammasi monthly
   *   - refund > running_monthly -> monthly=running_monthly, qolgan -> initial
   *
   * MUHIM: Agar CRM da shartnoma topilmasa (XATO) — split qilinmaydi (skip).
   * Mavjud qiymatlar cleanupSplitsForXatoContracts() da tozalanadi.
   */
  async splitInstallments(opts: { limit?: number; contractNo?: string; force?: boolean; actor?: Actor } = {}) {
    const startedAt = Date.now();
    const limit = Math.min(opts.limit || 5000, 20000);

    // ─── CLEANUP: XATO shartnomalardan eski split qiymatlarini olib tashlash ───
    // User talabi: "shartnoma raqami bolmasa tolovlarni bolish muymkin emas"
    // CRM da topilmagan shartnomalar (found=false yoki cache'da yo'q) bo'lganlar
    // firstInstallment/monthlyAmount ga ega bo'lib qolgan bo'lishi mumkin (eski "all-monthly"
    // fallback dan). Ularni tozalaymiz — split mumkin emas.
    const xatoCleanup = await this.cleanupSplitsForXatoContracts(opts.contractNo);
    if (xatoCleanup > 0) {
      this.log.log(`splitInstallments: XATO cleanup — ${xatoCleanup} qator tozalandi`);
    }

    // Filter: agar contractNo berilsa — faqat shu shartnoma uchun
    // force=true bo'lsa firstInstallment/monthlyAmount bor bo'lsa ham qayta hisoblaydi
    // !force: faqat hech narsa qo'yilmaganlarni (foydalanuvchining qo'lda qo'yganlariga tegmaymiz)
    const where: Prisma.OplataKvWhereInput = {
      sourceTxId: { not: null },
      paymentAmount: { not: null },
    };
    if (opts.contractNo) where.contractNo = opts.contractNo;
    if (!opts.force) {
      where.firstInstallment = null;
      where.monthlyAmount = null;
      where.paymentCategory = null;  // Qo'lda qo'yilgan paymentCategory'ga tegmaymiz
    }

    // Agar contractNo bo'yicha force re-split bo'lsa, hozirgi qiymatlarni reset qilamiz
    if (opts.contractNo && opts.force) {
      await this.prisma.oplataKv.updateMany({
        where: { contractNo: opts.contractNo, sourceTxId: { not: null } },
        data: { firstInstallment: null, monthlyAmount: null, paymentCategory: null },
      });
    }

    // ── XATO shartnomalarni split query'dan CHETLATAMIZ — raw SQL bilan tezroq ──
    // Avvalgi yondashuv (findMany + IN clause katta array) DB pool'ni egallab,
    // boshqa requestlar 502 olardi. Endi NOT EXISTS subquery — atomar, tez.
    if (opts.contractNo) {
      // Single contract — cache tekshirish (kichik query)
      const verified = await this.prisma.crmContract.findUnique({
        where: { contractNumber: opts.contractNo },
        select: { found: true },
      });
      if (!verified || !verified.found) {
        // XATO — split yo'q
        return { total: 0, contracts: 0, filled: 0, notFound: 0, errors: 0, duration: 0, xatoCleaned: xatoCleanup };
      }
    }
    // For batch case: raw SQL bilan filter qo'shamiz (Prisma'ning JOIN/EXISTS sintaksisi yo'q)
    let rows: Array<{ id: string; contractNo: string; date: Date; paymentAmount: any; sourceTxId: string | null }>;
    if (opts.contractNo) {
      rows = await this.prisma.oplataKv.findMany({
        where,
        select: { id: true, contractNo: true, date: true, paymentAmount: true, sourceTxId: true },
        orderBy: { date: 'asc' },
        take: limit,
      });
    } else {
      // Raw SQL — XATO kontraktlar SQL darajasida tashlanadi (no IN array)
      const forceClause = opts.force
        ? ''
        : 'AND first_installment IS NULL AND monthly_amount IS NULL AND payment_category IS NULL';
      const rawRows: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT id, contract_no AS "contractNo", date, payment_amount AS "paymentAmount", source_tx_id AS "sourceTxId"
          FROM oplata_kv
         WHERE source_tx_id IS NOT NULL
           AND payment_amount IS NOT NULL
           ${forceClause}
           AND EXISTS (
             SELECT 1 FROM crm_contracts c
             WHERE c.contract_number = oplata_kv.contract_no
               AND c.found = true
           )
         ORDER BY date ASC
         LIMIT $1
      `, limit);
      rows = rawRows;
    }

    // ─── SCHOTCHIK FILTER: Transaction subcategory CLIENT_SCHETCHIK bo'lganlarni ajratish ──
    // Bunday qatorlar split qilinmaydi — first/monthly NULL, running totals'ga qo'shilmaydi.
    // Source_tx_id Transaction.externalId yoki Transaction.id ga ishora qiladi.
    const sourceIdsAll = rows.map((r) => r.sourceTxId).filter((s): s is string => !!s);
    const schetchikSourceIds = new Set<string>();
    if (sourceIdsAll.length > 0) {
      const schetchikTxs = await this.prisma.transaction.findMany({
        where: {
          OR: [
            { id: { in: sourceIdsAll } },
            { externalId: { in: sourceIdsAll } },
          ],
          subcategory: { code: 'CLIENT_SCHETCHIK' },
        },
        select: { id: true, externalId: true },
      });
      for (const tx of schetchikTxs) {
        if (tx.externalId) schetchikSourceIds.add(tx.externalId);
        schetchikSourceIds.add(tx.id);
      }
    }
    if (rows.length === 0) {
      return { total: 0, contracts: 0, filled: 0, notFound: 0, errors: 0, duration: 0, xatoCleaned: xatoCleanup };
    }

    // Contract bo'yicha guruhlash
    const byContract = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byContract.get(r.contractNo) || [];
      arr.push(r);
      byContract.set(r.contractNo, arr);
    }

    let filled = 0;
    let notFound = 0;
    let errors = 0;

    const sameDate = (a: any, b: any): boolean => {
      if (!a || !b) return false;
      try {
        const da = new Date(a).toISOString().slice(0, 10);
        const db = new Date(b).toISOString().slice(0, 10);
        return da === db;
      } catch { return false; }
    };

    const CONCURRENCY = 10;
    const contractsArr = Array.from(byContract.entries());
    for (let i = 0; i < contractsArr.length; i += CONCURRENCY) {
      const batch = contractsArr.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async ([contractNo, items]) => {
        try {
          // CRM'dan detail (initial plan summasi va payment_histories)
          // User talabi: shartnoma CRM da bo'lmasa — split umuman qilinmaydi (1-vznos va
          // ежемесячный bo'sh qoladi). Hech qanday fallback yo'q.
          const resp: any = await this.crmService.show({ contract: contractNo }).catch(() => null);
          const detail = resp?.ok ? resp.detail : null;
          if (!detail) {
            // CRM da topilmadi — bu XATO shartnoma. Split mumkin emas.
            // Mavjud qiymatlar (agar bo'lsa) cleanupSplitsForXatoContracts() da tozalangan.
            notFound += items.length;
            return;
          }
          // CRM to'lov grafigi — SANA tartibida boshlang'ich+oylik qadamlar (ARALASH).
          // Split shu grafik bo'ylab waterfall qilinadi (bitta yaxlit initial.total EMAS).
          const schedule = buildSchedule(detail);

          // Eski running totals — shu contractda BU BATCH'gacha bo'lgan jami
          const firstDate = items[0].date;
          const existingSums = await this.prisma.oplataKv.aggregate({
            where: { contractNo, date: { lt: firstDate } },
            _sum: { firstInstallment: true, monthlyAmount: true },
          });
          let runningInitial = Number(existingSums._sum.firstInstallment || 0);
          let runningMonthly = Number(existingSums._sum.monthlyAmount || 0);

          // Date asc tartibida — running balance to'g'ri ishlashi uchun
          // FIX (B#6): sana + id bo'yicha barqaror tartib — bir xil sanadagi qatorlar izchil ishlansin
          items.sort((a, b) => {
            const d = new Date(a.date).getTime() - new Date(b.date).getTime();
            return d !== 0 ? d : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
          });

          // FIX (B#5): shartnoma qatorlarini ATOMIK yangilaymiz — updatelarni yig'ib,
          // bitta $transaction'da bajaramiz (yarim yozilish bo'lmaydi, running-balance izchil).
          const updates: any[] = [];
          for (const item of items) {
            const amount = Number(item.paymentAmount);

            // ── SCHOTCHIK: bog'langan Transaction CLIENT_SCHETCHIK bo'lsa ──
            // Kvartira badali emas — split QILINMAYDI (first/monthly = NULL),
            // lekin Оплата ustuniga "Общий" (GENERAL) qo'yiladi. Running totals'ga
            // qo'shilmaydi.
            if (item.sourceTxId && schetchikSourceIds.has(item.sourceTxId)) {
              updates.push(this.prisma.oplataKv.update({
                where: { id: item.id },
                data: {
                  firstInstallment: null,
                  monthlyAmount:    null,
                  paymentCategory:  'GENERAL' as OplataKvCategory,
                },
              }));
              continue; // running totals'ga qo'shmaymiz
            }

            if (amount === 0) continue; // 0 — hech narsa

            // WATERFALL — grafik bo'ylab taqsimlash (auto = qo'lda tugma, BIR XIL shared qoida).
            // alreadyPaid = shu shartnomada shu to'lovgacha jami NET (running first + monthly).
            const { firstInstallment, monthlyAmount } = allocatePayment(schedule, runningInitial + runningMonthly, amount);
            runningInitial += firstInstallment;
            runningMonthly += monthlyAmount;
            const category = categoryOf(firstInstallment, monthlyAmount);

            updates.push(this.prisma.oplataKv.update({
              where: { id: item.id },
              data: {
                firstInstallment: firstInstallment !== 0 ? new Prisma.Decimal(firstInstallment) : null,
                monthlyAmount:    monthlyAmount    !== 0 ? new Prisma.Decimal(monthlyAmount)    : null,
                paymentCategory:  category as OplataKvCategory,
              },
            }));
          }
          // FIX (B#5): barcha yangilanishlar bitta transactionда — atomik (xatoda rollback)
          if (updates.length) await this.prisma.$transaction(updates);
          filled += updates.length;
        } catch (e: any) {
          this.log.warn(`splitInstallments ${contractNo} xato: ${e?.message}`);
          errors += items.length;
        }
      }));
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    this.log.log(
      `splitInstallments: scanned=${rows.length} contracts=${contractsArr.length} ` +
      `filled=${filled} notFound=${notFound} errors=${errors} xatoCleaned=${xatoCleanup} duration=${duration}s`,
    );
    return {
      total: rows.length,
      contracts: contractsArr.length,
      filled,
      notFound,
      errors,
      duration,
      xatoCleaned: xatoCleanup,
    };
  }

  /**
   * BITTA qator uchun split — modal'dan Re-split bosilganda ishlatiladi.
   * User talabi: "qolda bita tolov uchun split qilinsa shu shartnomani barcha
   * tolovi emas aynan shu toilovni ozini split qilasan qolgan tolovlaridan
   * malumot olib".
   *
   * Mantiq:
   *  1) Shartnoma CRM da bo'lishi shart (XATO bo'lsa — xato qaytaradi)
   *  2) Bu qatordan ilgariga (date < shu qator sanasi) jami initial/monthly
   *     summalari boshqa qatorlardan olinadi (running total)
   *  3) initialPlan asosida shu qator uchun split hisoblanadi
   *  4) Faqat shu qator yangilanadi — boshqa qatorlarga tegmaymiz
   */
  async splitSingleRow(id: string, actor?: Actor): Promise<{
    ok: boolean;
    error?: string;
    item?: { firstInstallment: number; monthlyAmount: number; paymentCategory: string | null };
  }> {
    const row = await this.prisma.oplataKv.findUnique({
      where: { id },
      select: { id: true, contractNo: true, date: true, paymentAmount: true, sourceTxId: true },
    });
    if (!row) return { ok: false, error: 'Qator topilmadi' };
    if (!row.paymentAmount) return { ok: false, error: 'paymentAmount yo\'q' };

    // ── SCHOTCHIK: bog'langan Transaction CLIENT_SCHETCHIK bo'lsa ──
    // Bu kvartira badali emas — split shart emas (first/monthly = NULL),
    // lekin Оплата ustuniga "Общий" (GENERAL) qo'yamiz.
    if (row.sourceTxId) {
      const linkedTx = await this.prisma.transaction.findFirst({
        where: {
          OR: [{ id: row.sourceTxId }, { externalId: row.sourceTxId }],
          subcategory: { code: 'CLIENT_SCHETCHIK' },
        },
        select: { id: true },
      });
      if (linkedTx) {
        await this.prisma.oplataKv.update({
          where: { id: row.id },
          data: { firstInstallment: null, monthlyAmount: null, paymentCategory: 'GENERAL' as OplataKvCategory },
        });
        return {
          ok: true,
          item: { firstInstallment: 0, monthlyAmount: 0, paymentCategory: 'GENERAL' },
        };
      }
    }

    // CRM tekshirish — XATO shartnoma uchun split mumkin emas
    const resp: any = await this.crmService.show({ contract: row.contractNo }).catch(() => null);
    const detail = resp?.ok ? resp.detail : null;
    if (!detail) {
      return { ok: false, error: 'Shartnoma CRM da topilmadi — split mumkin emas (XATO)' };
    }
    // CRM grafigi — SANA tartibida boshlang'ich+oylik qadamlar (waterfall uchun).
    const schedule = buildSchedule(detail);

    // Running totals — shu shartnomadagi date < shu_qator.date bo'lganlardan
    const existingSums = await this.prisma.oplataKv.aggregate({
      where: {
        contractNo: row.contractNo,
        id: { not: row.id },
        // FIX (B#6): oldingi kunlar + BIR XIL sanadagi "oldingi" qatorlar (id bo'yicha barqaror tartib).
        // Avval date:{lt} edi — bir xil sanadagi qatorlar bir-birini running-balansiga qo'shmасди.
        OR: [
          { date: { lt: row.date } },
          { date: row.date, id: { lt: row.id } },
        ],
      },
      _sum: { firstInstallment: true, monthlyAmount: true },
    });
    let runningInitial = Number(existingSums._sum.firstInstallment || 0);
    let runningMonthly = Number(existingSums._sum.monthlyAmount || 0);

    const amount = Number(row.paymentAmount);
    if (amount === 0) return { ok: false, error: 'Summa 0 — split kerak emas' };

    // WATERFALL — grafik bo'ylab taqsimlash (auto splitInstallments bilan BIR XIL shared qoida).
    // alreadyPaid = shu qatorgacha jami NET (running first + monthly).
    const { firstInstallment, monthlyAmount } = allocatePayment(schedule, runningInitial + runningMonthly, amount);
    const category = categoryOf(firstInstallment, monthlyAmount);

    await this.prisma.oplataKv.update({
      where: { id: row.id },
      data: {
        firstInstallment: firstInstallment !== 0 ? new Prisma.Decimal(firstInstallment) : null,
        monthlyAmount:    monthlyAmount    !== 0 ? new Prisma.Decimal(monthlyAmount)    : null,
        paymentCategory:  category as OplataKvCategory,
      },
    });

    // History
    try {
      await this.prisma.oplataKvHistory.create({
        data: {
          oplataKvId: row.id,
          action: 'edited',
          actorType: actor?.id ? 'user' : 'system',
          actorId: actor?.id || null,
          actorName: actor?.name || 'split (single)',
          fieldsChanged: ['firstInstallment', 'monthlyAmount', 'paymentCategory'],
          changes: {
            firstInstallment: { new: firstInstallment },
            monthlyAmount: { new: monthlyAmount },
            paymentCategory: { new: category },
          } as any,
          note: `Bitta qator uchun split qayta hisoblandi (runningInitial=${runningInitial}, runningMonthly=${runningMonthly}, grafik-qadam=${schedule.length})`,
        },
      });
    } catch (e: any) {
      this.log.warn(`splitSingleRow history xato (${id}): ${e?.message}`);
    }

    return {
      ok: true,
      item: { firstInstallment, monthlyAmount, paymentCategory: category },
    };
  }

  /**
   * QO'LDA TAQSIMOT — bitta ОплатыКв qatorining boshlang'ich/oylik ulushini
   * ANIQ qiymatlarga o'rnatadi (murojaat/agent orqali tuzatish uchun).
   * INVARIANT (MUHIM): firstInstallment + monthlyAmount === paymentAmount.
   * Yig'indi to'langan summadan kam yoki ko'p bo'lsa — RAD etadi (pul
   * yo'qolmasin/qo'shilmasin). Tarixga yoziladi.
   */
  async manualSplit(
    id: string,
    firstInstallmentInput: number,
    monthlyInput: number,
    actor?: Actor,
  ): Promise<{ ok: boolean; error?: string; item?: { firstInstallment: number; monthlyAmount: number; paymentCategory: string | null; paymentAmount: number } }> {
    const row = await this.prisma.oplataKv.findUnique({
      where: { id },
      select: { id: true, paymentAmount: true },
    });
    if (!row) return { ok: false, error: 'Qator topilmadi' };
    if (row.paymentAmount == null) return { ok: false, error: "paymentAmount yo'q" };

    const total = Math.round(Number(row.paymentAmount) * 100) / 100;
    const first = Math.round(Number(firstInstallmentInput || 0) * 100) / 100;
    const monthly = Math.round(Number(monthlyInput || 0) * 100) / 100;
    if (!Number.isFinite(first) || !Number.isFinite(monthly)) return { ok: false, error: "Summa noto'g'ri" };

    // ── INVARIANT: boshlang'ich + oylik = to'langan summa (aynan) ──
    const sum = Math.round((first + monthly) * 100) / 100;
    if (Math.abs(sum - total) > 0.01) {
      return { ok: false, error: `Taqsimot yig'indisi (${sum}) to'langan summaga (${total}) teng emas — boshlang'ich + oylik = ${total} bo'lishi SHART` };
    }
    // Musbat to'lovда ulushlar manfiy bo'lmasin (refund/manfiy holatда teskarisi ruxsat)
    if (total >= 0 && (first < 0 || monthly < 0)) return { ok: false, error: "Musbat to'lovда ulush manfiy bo'lmaydi" };
    if (total < 0 && (first > 0 || monthly > 0)) return { ok: false, error: "Refund (manfiy) to'lovда ulush musbat bo'lmaydi" };

    // Kategoriya — kattasi bo'yicha (absolyut qiymat)
    let category: 'FIRST' | 'MONTHLY' | 'GENERAL';
    if (first === 0 && monthly === 0) category = 'GENERAL';
    else if (monthly === 0) category = 'FIRST';
    else if (first === 0) category = 'MONTHLY';
    else category = Math.abs(monthly) > Math.abs(first) ? 'MONTHLY' : 'FIRST';

    await this.prisma.oplataKv.update({
      where: { id: row.id },
      data: {
        firstInstallment: first !== 0 ? new Prisma.Decimal(first) : null,
        monthlyAmount:    monthly !== 0 ? new Prisma.Decimal(monthly) : null,
        paymentCategory:  category as OplataKvCategory,
        wasManuallyEdited: true,
      },
    });
    try {
      await this.prisma.oplataKvHistory.create({
        data: {
          oplataKvId: row.id,
          action: 'edited',
          actorType: actor?.id ? 'user' : 'system',
          actorId: actor?.id || null,
          actorName: actor?.name || 'manual split',
          fieldsChanged: ['firstInstallment', 'monthlyAmount', 'paymentCategory'],
          changes: { firstInstallment: { new: first }, monthlyAmount: { new: monthly }, paymentCategory: { new: category } } as any,
          note: `Qo'lda taqsimot (murojaat orqali): boshlang'ich=${first}, oylik=${monthly}, jami=${total}`,
        },
      });
    } catch (e: any) {
      this.log.warn(`manualSplit history xato (${id}): ${e?.message}`);
    }
    return { ok: true, item: { firstInstallment: first, monthlyAmount: monthly, paymentCategory: category, paymentAmount: total } };
  }

  /**
   * UI uchun — oxirgi sync vaqti.
   */
  async getLastSyncInfo() {
    const lastTx = await this.prisma.oplataKv.findFirst({
      where: { sourceTxId: { not: null } },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true, createdAt: true },
    });
    const txCount = await this.prisma.oplataKv.count({
      where: { sourceTxId: { not: null } },
    });
    return {
      ok: true,
      lastUpdate: lastTx?.updatedAt || null,
      lastCreated: lastTx?.createdAt || null,
      txSourceCount: txCount,
    };
  }

  /**
   * ORFAN QATORLAR — tranzaksiyadan kelgan (sourceTxId bor), lekin manba
   * tranzaksiya endi mavjud EMAS bo'lgan ОплатыКв qatorlari.
   *
   * Bunday qatorlar bank to'lovni bekor qilганда paydo bo'lgan: tranzaksiya
   * o'chgan, ОплатыКв qatori esa qolib ketgan (cascade kategoriya sharti bilan
   * cheklangan edi — 2026-08-22 da tuzatildi). Bu funksiya FAQAT SANAYDI va
   * namuna ko'rsatadi, hech narsani o'chirmaydi.
   */
  async findOrphanTxRows(limit = 50) {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string; contract_no: string; date: Date; payment_amount: any;
      source_tx_id: string; client: string | null; object: string | null; created_at: Date;
    }>>(Prisma.sql`
      SELECT o.id, o.contract_no, o.date, o.payment_amount, o.source_tx_id,
             o.client, o.object, o.created_at
        FROM oplata_kv o
       WHERE o.source_tx_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM transactions t
            WHERE t.external_id = o.source_tx_id OR t.id = o.source_tx_id
         )
       ORDER BY o.date DESC
       LIMIT ${Math.min(Math.max(limit, 1), 500)}
    `);

    const agg = await this.prisma.$queryRaw<Array<{ n: bigint; sum: any }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n, COALESCE(SUM(o.payment_amount), 0) AS sum
        FROM oplata_kv o
       WHERE o.source_tx_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM transactions t
            WHERE t.external_id = o.source_tx_id OR t.id = o.source_tx_id
         )
    `);

    return {
      ok: true as const,
      count: Number(agg[0]?.n || 0),
      totalAmount: Number(agg[0]?.sum || 0),
      items: rows.map((r) => ({
        id: r.id,
        contractNo: r.contract_no,
        date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
        amount: Number(r.payment_amount || 0),
        sourceTxId: r.source_tx_id,
        client: r.client,
        object: r.object,
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * Mavjud OplatyKv qatorlardan CRM da topilmaganlarni (XATO) topib o'chirish.
   * Foydalanish: avval sync XATO contractlarni ham olardi, endi olmaydi —
   * eski xato yozuvlarni tozalash uchun.
   */
  async cleanupXatoContracts(opts: { actor?: Actor } = {}) {
    const startedAt = Date.now();
    // Faqat tranzaksiya-manba qatorlarni qaraymiz
    const rows = await this.prisma.oplataKv.findMany({
      where: { sourceTxId: { not: null } },
      select: { id: true, contractNo: true, sourceTxId: true, client: true, object: true, paymentAmount: true, date: true, purpose: true, txType: true },
    });
    const contractNos = Array.from(new Set(rows.map((r) => r.contractNo)));
    const verified = await this.prisma.crmContract.findMany({
      where: { contractNumber: { in: contractNos } },
      select: { contractNumber: true, found: true },
    });
    const verifiedSet = new Set(verified.filter((c) => c.found).map((c) => c.contractNumber));

    // Manual fix qilinganlar — Transaction'da isContractManual=true bo'lganlar
    // Bu OplatyKv qatorning sourceTxId orqali Transaction'ga bog'lab tekshirish kerak
    // Lekin oson uchun — faqat CRM verified asosida cleanup qilamiz
    const toDelete = rows.filter((r) => !verifiedSet.has(r.contractNo));
    if (toDelete.length === 0) {
      return { ok: true, scanned: rows.length, deleted: 0, duration: 0 };
    }

    const ids = toDelete.map((r) => r.id);
    // Tarix yozish
    try {
      await this.prisma.oplataKvHistory.createMany({
        data: toDelete.map((r) => ({
          oplataKvId: r.id,
          action: 'deleted',
          actorType: opts.actor?.id ? 'user' : 'system',
          actorId: opts.actor?.id ?? null,
          actorName: opts.actor?.name || 'system · cleanupXato',
          fieldsChanged: [],
          changes: { snapshot: {
            id: r.id, sourceTxId: r.sourceTxId, contractNo: r.contractNo, client: r.client, object: r.object,
            paymentAmount: r.paymentAmount?.toString() ?? null, date: r.date ? r.date.toISOString().slice(0, 10) : null,
            purpose: r.purpose, txType: r.txType,
          } } as any,
          note: `XATO contract cleanup — CRM'da topilmagan`,
        })),
      });
    } catch (e: any) {
      this.log.warn(`cleanupXato history xato: ${e?.message}`);
    }
    const result = await this.prisma.oplataKv.deleteMany({ where: { id: { in: ids } } });
    const duration = Math.round((Date.now() - startedAt) / 1000);
    this.log.warn(`cleanupXatoContracts: scanned=${rows.length} deleted=${result.count} duration=${duration}s`);
    return {
      ok: true,
      scanned: rows.length,
      deleted: result.count,
      duration,
    };
  }

  // ───────────────── FORM AUTO-FILL — CRM lookup by contractNo ─────────────────
  /**
   * Yangi qator qo'shish formi uchun: shartnoma raqami yozilganda
   * mijoz va obyekt nomini avto to'ldirish uchun.
   * Cache (crm_contracts) -> live CRM (agar kerak bo'lsa) -> object mapping qo'llaniladi.
   */
  async crmLookupForForm(contractNo: string): Promise<{
    ok: boolean;
    found: boolean;
    contractNo: string;
    customerName: string | null;
    objectName: string | null;       // OplatyKv'ga yoziladigan (mapping qo'llanilgan)
    objectNameOriginal: string | null; // CRM dan kelgan asl nom (mappingsiz)
    error?: string;
  }> {
    if (!contractNo || !contractNo.trim()) {
      return {
        ok: false, found: false, contractNo: '',
        customerName: null, objectName: null, objectNameOriginal: null,
        error: "contractNo bo'sh",
      };
    }
    const cn = contractNo.trim().toUpperCase();

    // 0) ASOSIY MANBA: CRM /index (getContractMeta) — shartnoma EGASI (bank to'lovchisi emas),
    //    _debug/crm-raw "index" bilan AYNAN bir xil manba. Kesh yoki oplata_kv fallback ba'zan
    //    boshqa (to'lovchi) ismni ko'rsatardi — Переброска endi CRM /index javobiga mos keladi.
    let metaName: string | null = null;
    let metaObject: string | null = null;
    let metaFound = false;
    try {
      const meta: any = await this.crmService.getContractMeta(cn);
      if (meta?.ok && meta?.found) {
        metaFound = true;
        const cf = meta.clientFullName ? String(meta.clientFullName).trim() : '';
        if (cf) metaName = cf;
        const ob = meta.object ? String(meta.object).trim() : '';
        if (ob) metaObject = ob;
      }
    } catch { /* /index xato — pastdagi kesh/show fallback */ }

    // 1) Cache (fallback — /index bermasa)
    const cached = await this.prisma.crmContract.findFirst({
      where: { contractNumber: cn },
      select: { customerName: true, objectName: true, found: true },
    });

    let customerName: string | null = metaName || cached?.customerName || null;
    let objectNameOriginal: string | null = metaObject || cached?.objectName || null;
    let foundInCrm = metaFound || !!cached?.found;

    // 2) Ma'lumot to'liq emas (na /index, na kesh berdi) — live /show fallback
    if (!customerName || !objectNameOriginal) {
      try {
        const resp: any = await this.crmService.show({ contract: cn });
        const detail = resp?.detail || null;
        if (resp?.ok && detail) {
          foundInCrm = true;
          // Mijoz (FIO) yig'ish
          if (!customerName) {
            const c = detail.client || {};
            const f = (v: any): string => {
              if (!v) return '';
              if (typeof v === 'string') return v;
              if (typeof v === 'object') return v.kirill || v.lotin || v.uz || v.ru || v.name || v.value || '';
              return '';
            };
            const parts = [f(c.last_name), f(c.first_name), f(c.middle_name)].filter(Boolean);
            customerName = parts.length > 0
              ? parts.join(' ').trim()
              : (c.full_name_kirill || c.full_name_lotin || c.full_name || c.name || c.fio || detail.fio || null);
          }
          // Obyekt nomi
          if (!objectNameOriginal) {
            const candidates = [
              detail.object_name, detail.object,
              detail.info?.object, detail.info?.object_name,
              detail.client?.object_name, detail.client?.object,
            ];
            for (const cand of candidates) {
              if (!cand) continue;
              if (typeof cand === 'string' && cand.trim()) { objectNameOriginal = cand.trim(); break; }
              if (typeof cand === 'object') {
                const nm = cand.name || cand.value || cand.uz || cand.ru || cand.lotin || cand.kirill || cand.title;
                if (nm && typeof nm === 'string' && nm.trim()) { objectNameOriginal = nm.trim(); break; }
              }
            }
          }
        }
      } catch (e: any) {
        // CRM xato — cache'da bo'lgani bilan qaytaramiz
        if (!cached) {
          return {
            ok: false, found: false, contractNo: cn,
            customerName: null, objectName: null, objectNameOriginal: null,
            error: e?.message || 'CRM xatosi',
          };
        }
      }
    }

    // 3) Object mapping qo'llash: CRM nomidan OplatyKv nomiga
    let objectName: string | null = objectNameOriginal;
    if (objectNameOriginal) {
      const mapping = await this.prisma.oplataKvObjectMapping.findFirst({
        where: { crmName: { equals: objectNameOriginal, mode: 'insensitive' } },
        select: { oplataName: true },
      });
      if (mapping?.oplataName) {
        objectName = mapping.oplataName;
      }
    }

    return {
      ok: true,
      found: foundInCrm,
      contractNo: cn,
      customerName,
      objectName,
      objectNameOriginal,
    };
  }

  // ───────────────── OBJECT MAPPING (CRM nomi → OplatyKv nomi) ─────────────────
  async listObjectMappings() {
    const items = await this.prisma.oplataKvObjectMapping.findMany({
      orderBy: { crmName: 'asc' },
    });
    return { ok: true, items };
  }

  async createObjectMapping(crmName: string, oplataName: string, actor: Actor) {
    const cn = crmName?.trim();
    const on = oplataName?.trim();
    if (!cn || !on) throw new BadRequestException("CRM va OplatyKv nomi bo'sh bo'lmasligi kerak");
    try {
      const item = await this.prisma.oplataKvObjectMapping.create({
        data: {
          crmName: cn,
          oplataName: on,
          createdByName: actor.name ?? null,
        },
      });
      return { ok: true, item };
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException(`'${cn}' uchun mapping allaqachon mavjud`);
      throw e;
    }
  }

  async deleteObjectMapping(id: string) {
    try {
      await this.prisma.oplataKvObjectMapping.delete({ where: { id } });
      return { ok: true };
    } catch {
      throw new NotFoundException('Mapping topilmadi');
    }
  }

  /**
   * Tranzaksiya-manba (sourceTxId not null) OplatyKv qatorlarini o'chirish.
   * Optional: belgilangan sana bo'yicha filter.
   * Foydalanish: noto'g'ri sana bilan sync qilinganni tozalab, qaytadan sync qilish.
   */
  async cleanupTxSource(opts: { dateFrom?: string | null; dateTo?: string | null; actor?: Actor } = {}) {
    const where: Prisma.OplataKvWhereInput = {
      sourceTxId: { not: null },
    };
    if (opts.dateFrom || opts.dateTo) {
      const dateFilter: any = {};
      if (opts.dateFrom) {
        const d = new Date(opts.dateFrom);
        if (isNaN(d.getTime())) throw new BadRequestException("Noto'g'ri dateFrom");
        d.setUTCHours(0, 0, 0, 0);
        dateFilter.gte = d;
      }
      if (opts.dateTo) {
        const d = new Date(opts.dateTo);
        if (isNaN(d.getTime())) throw new BadRequestException("Noto'g'ri dateTo");
        d.setUTCHours(23, 59, 59, 999);
        dateFilter.lte = d;
      }
      where.date = dateFilter;
    }
    // BATCH approach — katta tozalashda timeout va memory'dan saqlanish
    const actorName = opts.actor?.name || 'system · cleanup';
    const noteText = `Tranzaksiya-manba tozalash${
      opts.dateFrom || opts.dateTo
        ? ` (${opts.dateFrom || '∞'}…${opts.dateTo || '∞'})`
        : ''
    }`;
    const totalCount = await this.prisma.oplataKv.count({ where });
    let totalDeleted = 0;
    let totalHistory = 0;
    const CHUNK = 500;

    while (true) {
      const batch = await this.prisma.oplataKv.findMany({
        where,
        select: { id: true, contractNo: true, paymentAmount: true, date: true, sourceTxId: true },
        take: CHUNK,
      });
      if (batch.length === 0) break;

      // History (chunk uchun)
      try {
        await this.prisma.oplataKvHistory.createMany({
          data: batch.map((r) => ({
            oplataKvId: r.id,
            action: 'deleted',
            actorType: opts.actor?.id ? 'user' : 'system',
            actorId: opts.actor?.id ?? null,
            actorName,
            fieldsChanged: [],
            changes: {
              contractNo: { old: r.contractNo, new: null },
              paymentAmount: { old: r.paymentAmount?.toString() ?? null, new: null },
              date: { old: r.date?.toISOString() ?? null, new: null },
              sourceTxId: { old: r.sourceTxId, new: null },
            } as any,
            note: noteText,
          })),
        });
        totalHistory += batch.length;
      } catch (e: any) {
        this.log.warn(`cleanup history chunk xato (jiddiy emas): ${e?.message}`);
      }

      // Delete chunk
      const ids = batch.map((r) => r.id);
      const res = await this.prisma.oplataKv.deleteMany({ where: { id: { in: ids } } });
      totalDeleted += res.count;
    }

    const range = opts.dateFrom || opts.dateTo
      ? `${opts.dateFrom || '∞'}…${opts.dateTo || '∞'}`
      : 'ALL';
    this.log.warn(`cleanupTxSource: matched=${totalCount} deleted=${totalDeleted} history=${totalHistory} range=${range}`);
    return {
      ok: true,
      deleted: totalDeleted,
      matched: totalCount,
      dateFrom: opts.dateFrom || null,
      dateTo: opts.dateTo || null,
    };
  }

  // ───────────────── CRM SVERKA (OplatyKv vs XonSaroy CRM taqqoslash) ─────────────────
  /**
   * Bitta shartnoma uchun:
   * - OplatyKv qatorlari + jami (bizning DB)
   * - XonSaroy CRM payment_histories (tashqi API)
   * - Taqqoslash: jami summa, boshlangich, oylik
   */
  async crmSverka(contractNo: string) {
    if (!contractNo || !contractNo.trim()) {
      return { ok: false, error: "contractNo bo'sh" };
    }
    const cn = contractNo.trim();

    const [oplataItems, crmResp] = await Promise.all([
      this.prisma.oplataKv.findMany({
        where: { contractNo: cn },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      this.crmService.show({ contract: cn }).catch((e) => ({ ok: false, error: e?.message || 'CRM xato' })),
    ]);

    // OplatyKv summalari (kategoriya bo'yicha)
    const oplataInitial = oplataItems.reduce((s, i) => s + Number(i.firstInstallment || 0), 0);
    const oplataMonthly = oplataItems.reduce((s, i) => s + Number(i.monthlyAmount    || 0), 0);
    const oplataTotalPayment = oplataItems.reduce((s, i) => s + Number(i.paymentAmount || 0), 0);

    // CRM payment_histories'ni boshlangich/oylik bo'yicha guruhlash
    const detail: any = (crmResp as any)?.detail || null;
    const histories: any[] = Array.isArray(detail?.payment_histories) ? detail.payment_histories : [];

    const crmHistInitial: any[] = [];
    const crmHistMonthly: any[] = [];
    for (const h of histories) {
      const k = String(h?.type?.key || '').toLowerCase();
      if (k.includes('init') || k.includes('boshlang') || k.includes('перво')) crmHistInitial.push(h);
      else crmHistMonthly.push(h);
    }

    const crmInitialSum = crmHistInitial.reduce((s, h) => s + Number(h?.amount || 0), 0);
    const crmMonthlySum = crmHistMonthly.reduce((s, h) => s + Number(h?.amount || 0), 0);
    const crmTotalPaid  = crmInitialSum + crmMonthlySum;

    // Taqqoslash — har kategoriya
    const diffTotal   = oplataTotalPayment - crmTotalPaid;
    const diffInitial = oplataInitial - crmInitialSum;
    const diffMonthly = oplataMonthly - crmMonthlySum;
    const matched     = Math.abs(diffTotal) < 0.01;

    return {
      ok: true,
      contractNo: cn,
      crmConnected: (crmResp as any)?.ok !== false,
      oplata: {
        items: oplataItems,
        count: oplataItems.length,
        totalPayment: oplataTotalPayment,
        initial: oplataInitial,
        monthly: oplataMonthly,
      },
      crm: {
        connected: (crmResp as any)?.ok !== false,
        error: (crmResp as any)?.ok === false ? (crmResp as any).error : null,
        contractInfo: detail ? {
          price:        Number(detail?.price || 0),
          contractDate: detail?.contract_date || null,
          status:       detail?.status?.key || null,
          initialPlan:  Number(detail?.initial?.total?.amount || 0),
          initialPaid:  Number(detail?.initial?.total?.paid   || 0),
          monthlyPlan:  Number(detail?.monthly?.total?.amount || 0),
          monthlyPaid:  Number(detail?.monthly?.total?.paid   || 0),
        } : null,
        // Xonadon va mijoz ma'lumotlari — 3D bino qurish uchun (qavat, blok, xonalar, m²)
        apartmentInfo: detail?.info ? {
          number:    detail.info.number    ?? null,
          rooms:     detail.info.rooms     ?? null,
          area:      detail.info.area      ?? null,
          building:  detail.info.building  ?? null,
          block:     detail.info.block     ?? null,
          floor:     detail.info.floor     ?? null,
          object:    detail.info.object    ?? null,
        } : null,
        clientInfo: detail?.client ? {
          fullName: detail.client.full_name || detail.client.fullName || null,
          phone:    detail.client.phone     || null,
        } : null,
        histories: histories.map((h) => ({
          amount:    Number(h?.amount || 0),
          datePaid:  h?.date_paid || null,
          typeKey:   String(h?.type?.key || ''),
          typeLabel: h?.type?.value?.name?.uz || h?.type?.value?.name?.ru || '',
        })),
        count: histories.length,
        initialSum: crmInitialSum,
        monthlySum: crmMonthlySum,
        totalPaid:  crmTotalPaid,
      },
      comparison: {
        oplataTotal: oplataTotalPayment,
        crmTotal:    crmTotalPaid,
        diff:        diffTotal,
        diffInitial,
        diffMonthly,
        matched,
        status: matched ? 'ok' : (diffTotal > 0 ? 'oplata-more' : 'crm-more'),
      },
    };
  }

  // ───────────────── BY CONTRACT (Akt Sverka) ─────────────────
  /**
   * Bitta shartnoma bo'yicha barcha to'lovlar tarixi + jami summalar.
   * Akt sverka modal'i uchun.
   */
  /** Shartnoma planirovka rasm(lar)i va hujjat URL'lari (CRM). */
  contractPlan(contractNo: string) {
    return this.crmService.contractMedia(contractNo);
  }

  /** Planirovka rasmini backend orqali yuklab beradi (proxy). */
  streamPlanImage(url: string, filename: string, res: any) {
    return this.crmService.streamPlanImage(url, filename, res);
  }

  async findByContract(contractNo: string) {
    if (!contractNo || !contractNo.trim()) {
      return { ok: false, error: "contractNo bo'sh", items: [], sums: null, meta: null };
    }
    const rawItems = await this.prisma.oplataKv.findMany({
      where: { contractNo: contractNo.trim() },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    // Tasdiqlanmagan (XATO) to'lovlarni chiqarib tashlaymiz — shartnoma CRM'da
    // tasdiqlanmagan bo'lsa, o'sha tx-manba to'lovlar Akt Sverka tarixida ko'rinmaydi.
    const { isXato } = await this.computeContractXato(rawItems);
    const items = rawItems.filter((it) => !isXato(it));
    const excludedXato = rawItems.length - items.length;

    const sums = {
      paymentAmount:    items.reduce((s, i) => s + Number(i.paymentAmount    || 0), 0),
      firstInstallment: items.reduce((s, i) => s + Number(i.firstInstallment || 0), 0),
      monthlyAmount:    items.reduce((s, i) => s + Number(i.monthlyAmount    || 0), 0),
    };
    // Eng so'nggi mijoz/obyekt ma'lumotini olamiz (eng yangi qatordan)
    const latest = items[items.length - 1];
    const meta = latest ? {
      client:        latest.client,
      object:        latest.object,
      paymentMethod: latest.paymentMethod,
      firstDate:     items[0]?.date || null,
      lastDate:      latest.date,
    } : null;
    return {
      ok: true,
      contractNo: contractNo.trim(),
      count: items.length,
      excludedXato,
      items,
      sums,
      meta,
    };
  }

  // ───────────────── EXPORT (Excel / JSON) ─────────────────
  /** Filtr bo'yicha BARCHA qatorlarni qaytaradi (export uchun). */
  private async fetchAllForExport(q: ListOplataKvDto) {
    const where = this.buildWhere(q);

    // XATO ONLY filter — list bilan bir xil logika
    const xatoOnly = q.xatoOnly === 'true' || q.xatoOnly === '1';
    if (xatoOnly) {
      const xatoFilter = await this.buildXatoFilter();
      if (where.AND) (where.AND as any[]).push(xatoFilter);
      else where.AND = [xatoFilter];
    }

    // SPLIT YO'Q filter — list bilan bir xil (bo'lmasa eksport butun bazani oladi → xato)
    const unsplitOnly = q.unsplitOnly === 'true' || q.unsplitOnly === '1';
    if (unsplitOnly) {
      const f = await this.buildUnsplitFilter();
      if (where.AND) (where.AND as any[]).push(f);
      else where.AND = [f];
    }

    // crm_status filtri — list bilan bir xil
    if (q.crmStatuses && q.crmStatuses.trim()) {
      const crmFilter = await this.buildCrmStatusFilter(q.crmStatuses);
      if (crmFilter) {
        if (where.AND) (where.AND as any[]).push(crmFilter);
        else where.AND = [crmFilter];
      }
    }
    if (q.crmPropertyTypes && q.crmPropertyTypes.trim()) {
      const f = await this.buildPropertyTypeFilter(q.crmPropertyTypes);
      if (f) { if (where.AND) (where.AND as any[]).push(f); else where.AND = [f]; }
    }
    if (q.crmBranches && q.crmBranches.trim()) {
      const f = await this.buildBranchFilter(q.crmBranches);
      if (f) { if (where.AND) (where.AND as any[]).push(f); else where.AND = [f]; }
    }

    const sortBy = q.sortBy || 'date';
    const sortDir: 'asc' | 'desc' = q.sortDir || 'desc';
    return this.prisma.oplataKv.findMany({
      where,
      orderBy: { [sortBy]: sortDir } as any,
    });
  }

  /**
   * Qatorlar uchun XATO holati + shartnoma manbasini (manual/ariza) hisoblaydi.
   * list() va Excel eksport bir xil natija berishi uchun umumiy helper.
   *   crmXato = tx-manbali (sourceTxId) + CRM'da tasdiqlanmagan (found≠true) + qo'lda/ariza emas
   */
  private async computeContractXato(
    items: Array<{ sourceTxId: string | null; contractNo: string }>,
  ): Promise<{
    isXato: (it: { sourceTxId: string | null; contractNo: string }) => boolean;
    sourceOf: (it: { sourceTxId: string | null }) => 'manual' | 'ariza' | null;
  }> {
    const txSourceItems = items.filter((i) => i.sourceTxId);
    const txContractNos = Array.from(new Set(txSourceItems.map((i) => i.contractNo)));
    const sourceTxIds = Array.from(new Set(
      txSourceItems.map((i) => i.sourceTxId).filter((x): x is string => !!x),
    ));

    const sourceByTxId = new Map<string, 'manual' | 'ariza'>();
    let xatoSet = new Set<string>();

    // Postgres bind-limit (32767): katta eksportda `in` ro'yxatini bo'laklarga bo'lamiz.
    // OR: [externalId in, id in] — bir bo'lak 2× bind ishlatadi, shuning uchun 10000.
    if (sourceTxIds.length > 0) {
      const CHUNK = 10000;
      for (let i = 0; i < sourceTxIds.length; i += CHUNK) {
        const part = sourceTxIds.slice(i, i + CHUNK);
        const tx = await this.prisma.transaction.findMany({
          where: {
            OR: [{ externalId: { in: part } }, { id: { in: part } }],
            isContractManual: true,
          },
          select: { id: true, externalId: true, _count: { select: { attachments: true } } },
        });
        tx.forEach((t) => {
          const src: 'manual' | 'ariza' = t._count.attachments > 0 ? 'ariza' : 'manual';
          if (t.externalId) sourceByTxId.set(t.externalId, src);
          sourceByTxId.set(t.id, src);
        });
      }
    }

    if (txContractNos.length > 0) {
      const CHUNK = 20000;
      const verifiedSet = new Set<string>();
      for (let i = 0; i < txContractNos.length; i += CHUNK) {
        const part = txContractNos.slice(i, i + CHUNK);
        const verified = await this.prisma.crmContract.findMany({
          where: { contractNumber: { in: part } },
          select: { contractNumber: true, found: true },
        });
        verified.forEach((c) => { if (c.found) verifiedSet.add(c.contractNumber); });
      }
      xatoSet = new Set(txContractNos.filter((cn) => !verifiedSet.has(cn)));
    }

    const sourceOf = (it: { sourceTxId: string | null }) =>
      it.sourceTxId ? (sourceByTxId.get(it.sourceTxId) || null) : null;
    const isXato = (it: { sourceTxId: string | null; contractNo: string }) =>
      !!(it.sourceTxId && xatoSet.has(it.contractNo) && !sourceOf(it));

    return { isXato, sourceOf };
  }

  // ───────────────── DISTINCT (column filter popover) ─────────────────
  /**
   * Berilgan ustun uchun distinct qiymatlar.
   * SELF-EXCLUSION: shu ustunning o'z filtri istisno qilinadi (foydalanuvchi qaytadan tanlay olsin).
   */
  async distinctValues(
    column: string,
    q: ListOplataKvDto,
    search?: string,
  ): Promise<{ ok: true; values: Array<{ id: string; name: string }> }> {
    // Column → DTO field nomi va self-exclusion uchun
    const COLUMN_TO_PARAM: Record<string, keyof ListOplataKvDto> = {
      contractNo:      'contractNos',
      paymentCategory: 'paymentCategories',
      client:          'clients',
      object:          'objects',
      paymentMethod:   'paymentMethods',
      txType:          'txTypes',
    };

    // Column DB field
    const COLUMN_TO_FIELD: Record<string, keyof Prisma.OplataKvScalarFieldEnum | string> = {
      contractNo:      'contractNo',
      paymentCategory: 'paymentCategory',
      client:          'client',
      object:          'object',
      paymentMethod:   'paymentMethod',
      txType:          'txType',
    };

    // Source ustun — fixed options (DB'dan emas)
    if (column === 'source') {
      const fixed = [
        { id: 'manual',      name: "Qo'lda" },
        { id: 'excel',       name: 'Excel' },
        { id: 'transaction', name: 'Tranzaksiya' },
      ];
      const filtered = search
        ? fixed.filter((v) => v.name.toLowerCase().includes(search.toLowerCase()))
        : fixed;
      return { ok: true, values: filtered };
    }

    // crm_status ustun — CrmContract.virtualStatus (Бартер, Ипотека...) + bo'sh
    if (column === 'crmStatus') {
      const rows = await this.prisma.crmContract.findMany({
        where: { found: true, virtualStatus: { not: null } },
        select: { virtualStatus: true },
        distinct: ['virtualStatus'],
        take: 100,
      });
      let values: Array<{ id: string; name: string }> = rows
        .map((r) => r.virtualStatus)
        .filter((v): v is string => !!v)
        .map((v) => ({ id: v, name: v }));
      values.push({ id: '__none__', name: "— (bo'sh)" });
      if (search) {
        const s = search.toLowerCase();
        values = values.filter((v) => v.name.toLowerCase().includes(s));
      }
      return { ok: true, values };
    }

    // Тип — maqsad matni bo'yicha: жилой / парковка (har qator biriga tegishli)
    if (column === 'crmPropertyType') {
      let values: Array<{ id: string; name: string }> = [
        { id: 'apartment', name: 'Жилой' },
        { id: 'parking',   name: 'Парковка' },
      ];
      if (search) { const s = search.toLowerCase(); values = values.filter((v) => v.name.toLowerCase().includes(s)); }
      return { ok: true, values };
    }

    // Сотув бўлими — CrmContract.branchName (distinct) + bo'sh
    if (column === 'crmBranch') {
      const rows = await this.prisma.crmContract.findMany({
        where: { found: true, branchName: { not: null } },
        select: { branchName: true }, distinct: ['branchName'], take: 300,
      });
      let values: Array<{ id: string; name: string }> = rows
        .map((r) => r.branchName)
        .filter((v): v is string => !!v && !!v.trim())
        .map((v) => ({ id: v, name: v }));
      values.push({ id: '__none__', name: "— (bo'sh)" });
      if (search) { const s = search.toLowerCase(); values = values.filter((v) => v.name.toLowerCase().includes(s)); }
      return { ok: true, values };
    }

    const field = COLUMN_TO_FIELD[column];
    if (!field) return { ok: true, values: [] };

    // Self-exclusion: shu ustunning filtri olib tashlanadi
    const queryCopy: any = { ...q };
    const selfParam = COLUMN_TO_PARAM[column];
    if (selfParam) delete queryCopy[selfParam];

    // PaymentCategory enum — alohida ko'rib chiqamiz (contains qabul qilmaydi)
    if (column === 'paymentCategory') {
      const rows = await this.prisma.oplataKv.findMany({
        where: this.buildWhere(queryCopy),
        select: { paymentCategory: true },
        distinct: ['paymentCategory'],
        take: 50,
      });
      const labels: Record<string, string> = {
        MONTHLY: 'ежемесячный',
        FIRST:   '1 взнос',
        GENERAL: 'Общий',
      };
      let values: Array<{ id: string; name: string }> = rows
        .map((r) => r.paymentCategory)
        .filter((v): v is OplataKvCategory => !!v)
        .map((v) => ({ id: v as string, name: labels[v] || v }));
      // Bo'sh (paymentCategory = NULL) qatorlar ham bo'lsa — alohida filtr opsiyasi.
      // buildWhere '__null__' markerini qabul qiladi (NULL bo'yicha filtrlaydi).
      if (rows.some((r) => !r.paymentCategory)) {
        values.push({ id: '__null__', name: '— (bo\'sh)' });
      }
      if (search) {
        const s = search.toLowerCase();
        values = values.filter((v) => v.name.toLowerCase().includes(s));
      }
      return { ok: true, values };
    }

    // Boshqa text columnlar
    // Qaysi maydon nullable — schema bo'yicha (contractNo required, qolganlar nullable)
    const NULLABLE_FIELDS = new Set(['client', 'object', 'paymentMethod', 'purpose', 'note', 'txType']);

    const where = this.buildWhere(queryCopy);

    // Search filterini qo'shamiz (lekin not:null faqat nullable maydonlar uchun)
    const fieldFilter: any = {};
    if (NULLABLE_FIELDS.has(String(field))) fieldFilter.not = null;
    if (search) {
      fieldFilter.contains = search;
      fieldFilter.mode = 'insensitive';
    }
    if (Object.keys(fieldFilter).length > 0) {
      (where as any)[field] = fieldFilter;
    }

    const rows = await this.prisma.oplataKv.findMany({
      where,
      select: { [field]: true } as any,
      distinct: [field as any],
      take: 300,
    });
    let values = rows
      .map((r: any) => r[field])
      .filter((v: any) => v !== null && v !== undefined && String(v).trim() !== '')
      .map((v: any) => ({ id: String(v), name: String(v) }));

    // Alifbo tartibida
    values.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    // Null/bo'sh qiymatlar bormi? Bor bo'lsa "(bo'sh)" optionni yuqoriga qo'shamiz
    if (NULLABLE_FIELDS.has(String(field))) {
      const whereForNull = this.buildWhere(queryCopy);
      const nullCount = await this.prisma.oplataKv.count({
        where: { ...whereForNull, [field]: null },
      });
      if (nullCount > 0) {
        values.unshift({ id: '__null__', name: `(bo'sh)` });
      }
    }

    // contractNo uchun MAXSUS: 'XATO' tanlash imkoniyati (CRM da topilmaganlar)
    // Frontend buni xatoOnly=true ga aylantiradi
    if (column === 'contractNo') {
      // Search bilan ham mos kelishi kerak ("xato" yozsa chiqsin)
      if (!search || 'XATO'.toLowerCase().includes(search.toLowerCase())) {
        values.unshift({ id: 'XATO', name: '⚠ XATO — CRM da topilmadi' });
      }
    }

    return { ok: true, values };
  }

  async exportXlsx(q: ListOplataKvDto): Promise<{ buffer: Buffer; filename: string }> {
    const items = await this.fetchAllForExport(q);
    // XATO holati — web bilan bir xil (tasdiqlanmagan shartnoma raqami "XATO" bo'lib chiqadi)
    const { isXato } = await this.computeContractXato(items);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet('ОплатыКв');

    ws.columns = [
      { header: 'Дог №',          key: 'contractNo',       width: 16 },
      { header: 'Дата',           key: 'date',             width: 12 },
      { header: 'Сумма оплаты',   key: 'paymentAmount',    width: 18 },
      { header: '1 взнос',        key: 'firstInstallment', width: 18 },
      { header: 'Ежемесячный',    key: 'monthlyAmount',    width: 18 },
      { header: 'Оплата',         key: 'paymentCategory',  width: 14 },
      { header: 'Клиент',         key: 'client',           width: 28 },
      { header: 'Объект',         key: 'object',           width: 22 },
      { header: 'Способ оплаты',  key: 'paymentMethod',    width: 22 },
      { header: 'Назначение',     key: 'purpose',          width: 42 },
      { header: 'Тип',            key: 'txType',           width: 14 },
      { header: 'Примечание',     key: 'note',             width: 28 },
      { header: 'ID',             key: 'id',               width: 38 },
    ];

    const head = ws.getRow(1);
    head.font = { bold: true, size: 10 };
    head.height = 22;
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    const categoryLabel: Record<string, string> = {
      MONTHLY: 'ежемесячный',
      FIRST:   '1 взнос',
      GENERAL: 'Общий',
    };

    for (const it of items) {
      let date = '';
      if (it.date) {
        const d = new Date(it.date);
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        date = `${dd}.${mm}.${d.getUTCFullYear()}`;
      }
      const xatoRow = isXato(it);
      const row = ws.addRow({
        contractNo: xatoRow ? 'XATO' : (it.contractNo || ''),
        date,
        paymentAmount:    it.paymentAmount    ? Number(it.paymentAmount)    : null,
        firstInstallment: it.firstInstallment ? Number(it.firstInstallment) : null,
        monthlyAmount:    it.monthlyAmount    ? Number(it.monthlyAmount)    : null,
        paymentCategory:  it.paymentCategory ? (categoryLabel[it.paymentCategory] || it.paymentCategory) : '',
        client: it.client || '',
        object: it.object || '',
        paymentMethod: it.paymentMethod || '',
        purpose: it.purpose || '',
        txType: it.txType || '',
        note: it.note || '',
        id: it.id,
      });
      row.font = { size: 9 };
      // XATO — qizil bold (tekshirilmagan shartnoma raqamini ko'rsatmaymiz)
      if (xatoRow) {
        row.getCell('contractNo').font = { size: 9, bold: true, color: { argb: 'FFBE123C' } };
      }
      row.getCell('paymentAmount').numFmt    = '#,##0.00';
      row.getCell('firstInstallment').numFmt = '#,##0.00';
      row.getCell('monthlyAmount').numFmt    = '#,##0.00';
      row.getCell('date').numFmt = '@';
      row.getCell('date').alignment = { horizontal: 'center' };
    }

    // Yakuniy yig'indi qatori
    if (items.length > 0) {
      const totalRow = ws.addRow({
        contractNo: 'ИТОГО:',
        paymentAmount:    items.reduce((s, x) => s + Number(x.paymentAmount || 0), 0),
        firstInstallment: items.reduce((s, x) => s + Number(x.firstInstallment || 0), 0),
        monthlyAmount:    items.reduce((s, x) => s + Number(x.monthlyAmount || 0), 0),
      });
      totalRow.font = { bold: true, size: 10 };
      totalRow.getCell('paymentAmount').numFmt    = '#,##0.00';
      totalRow.getCell('firstInstallment').numFmt = '#,##0.00';
      totalRow.getCell('monthlyAmount').numFmt    = '#,##0.00';
      totalRow.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      });
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ts = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `oplaty-kv-${ts}.xlsx` };
  }

  async exportJson(q: ListOplataKvDto): Promise<{ buffer: Buffer; filename: string }> {
    const items = await this.fetchAllForExport(q);
    const json = JSON.stringify({
      exportedAt: new Date().toISOString(),
      total: items.length,
      filter: { q: q.q || null, dateFrom: q.dateFrom || null, dateTo: q.dateTo || null, paymentCategory: q.paymentCategory || null },
      items,
    }, null, 2);
    const buffer = Buffer.from(json, 'utf8');
    const ts = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `oplaty-kv-${ts}.json` };
  }

  // ───────────────── HISTORY ─────────────────
  async getHistory(id: string, limit = 100) {
    const items = await this.prisma.oplataKvHistory.findMany({
      where: { oplataKvId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
    });
    return { ok: true, items };
  }

  // ───────────────── CREATE ─────────────────
  async create(dto: CreateOplataKvDto, actor: Actor) {
    const data: any = {
      contractNo: dto.contractNo,
      date: new Date(dto.date),
      paymentAmount:    dto.paymentAmount    != null ? new Prisma.Decimal(dto.paymentAmount)    : null,
      firstInstallment: dto.firstInstallment != null ? new Prisma.Decimal(dto.firstInstallment) : null,
      monthlyAmount:    dto.monthlyAmount    != null ? new Prisma.Decimal(dto.monthlyAmount)    : null,
      purpose:        dto.purpose         ?? null,
      txType:         dto.txType          ?? null,
      note:           dto.note            ?? null,
      paymentCategory: dto.paymentCategory ?? null,
      object:         dto.object          ?? null,
      client:         dto.client          ?? null,
      paymentMethod:  dto.paymentMethod   ?? null,
      createdById:    actor.id   ?? null,
      createdByName:  actor.name ?? null,
    };

    const created = await this.prisma.oplataKv.create({ data });

    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: created.id,
        action: 'created',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: Object.keys(data).filter((k) => k !== 'createdById' && k !== 'createdByName'),
        changes: this.serializeForHistory(data) as any,
        note: 'Yangi qator yaratildi',
      },
    });

    return { ok: true, item: created };
  }

  // ───────────────── UPDATE ─────────────────
  async update(id: string, dto: UpdateOplataKvDto, actor: Actor) {
    const before = await this.prisma.oplataKv.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('ОплатыКв qator topilmadi');

    const data: any = {};
    if (dto.contractNo       !== undefined) data.contractNo       = dto.contractNo;
    if (dto.date             !== undefined) data.date             = new Date(dto.date as string);
    if (dto.paymentAmount    !== undefined) data.paymentAmount    = dto.paymentAmount    === null ? null : new Prisma.Decimal(dto.paymentAmount as number);
    if (dto.firstInstallment !== undefined) data.firstInstallment = dto.firstInstallment === null ? null : new Prisma.Decimal(dto.firstInstallment as number);
    if (dto.monthlyAmount    !== undefined) data.monthlyAmount    = dto.monthlyAmount    === null ? null : new Prisma.Decimal(dto.monthlyAmount as number);
    if (dto.purpose          !== undefined) data.purpose          = dto.purpose;
    if (dto.txType           !== undefined) data.txType           = dto.txType;
    if (dto.note             !== undefined) data.note             = dto.note;
    if (dto.paymentCategory  !== undefined) data.paymentCategory  = dto.paymentCategory ?? null;
    if (dto.object           !== undefined) data.object           = dto.object;
    if (dto.client           !== undefined) data.client           = dto.client;
    if (dto.paymentMethod    !== undefined) data.paymentMethod    = dto.paymentMethod;

    const diff: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of Object.keys(data)) {
      const beforeVal = this.normalizeForDiff((before as any)[key]);
      const afterVal  = this.normalizeForDiff((data as any)[key]);
      if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
        diff[key] = { old: beforeVal, new: afterVal };
      }
    }

    if (Object.keys(diff).length === 0) {
      return { ok: true, item: before, message: 'Hech qanday o\'zgarish yo\'q' };
    }

    const updated = await this.prisma.oplataKv.update({ where: { id }, data });

    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: id,
        action: 'edited',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: Object.keys(diff),
        changes: diff as any,
        note: `Tahrirlandi (${Object.keys(diff).length} ta maydon)`,
      },
    });

    return { ok: true, item: updated };
  }

  // ───────────────── DELETE ─────────────────
  async remove(id: string, actor: Actor) {
    const before = await this.prisma.oplataKv.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('ОплатыКв qator topilmadi');

    // History yozuvini saqlash uchun oldin yozib qoyamiz, keyin onDelete: Cascade
    // tarixni ham o'chiradi — shuning uchun snapshotni alohida arxivga yozamiz.
    // Hozircha: history yozib keyin o'chiramiz.
    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: id,
        action: 'deleted',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: ['*'],
        changes: { snapshot: this.serializeForHistory(before) } as any,
        note: `O'chirildi (${before.contractNo} · ${before.date.toISOString().slice(0, 10)})`,
      },
    });

    await this.prisma.oplataKv.delete({ where: { id } });
    return { ok: true, deletedId: id };
  }

  // ───────────────── helpers ─────────────────
  private normalizeForDiff(v: any) {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object' && 'toFixed' in v) return Number(v); // Decimal
    return v;
  }

  private serializeForHistory(obj: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = this.normalizeForDiff(v);
    }
    return out;
  }

  // ───────────────── IMPORT (Excel) ─────────────────
  /**
   * Excel ustunlari (rus sarlavhalar):
   *   A: Дог №                — Shartnoma raqami (majburiy)
   *   B: Дата                 — dd.MM.yyyy (majburiy)
   *   C: Сумма оплаты         — +/- (bo'sh bo'lishi mumkin)
   *   D: 1 взнос              — +/-
   *   E: ежемесячный          — +/-
   *   F: Назначение платежа   — purpose
   *   G: Тип                  — type
   *   H: Примечание           — note
   *   I: Оплата               — ежемесячный | 1 взнос | Общий (mapped)
   *   J: Объект               — object
   *   K: Клиент               — client
   *   L: Способ оплаты        — paymentMethod
   *   M: ID                   — uniq id (majburiy, dublikat skip)
   */
  /**
   * Preview — fayldagi qatorlarni o'qiydi va tekshiradi, lekin BAZAGA QO'SHMAYDI.
   * Cache'ga saqlaydi va previewId qaytaradi. Foydalanuvchi tasdiqlagach commitImport
   * chaqirilib bazaga qo'shiladi.
   *
   * Bu yondashuvning sabablari:
   *   - 230k qatorlik kabi katta fayllarda xato bo'lsa hech narsa qo'shilmaydi
   *   - Foydalanuvchi xatolarni ko'rib qaror qabul qiladi
   *   - Tasodifiy/no'noqlik bilan import qilingan ma'lumot keyin tozalashga to'g'ri kelmaydi
   */
  async previewImport(
    buffer: Buffer,
    actor: Actor,
    fileName?: string,
  ): Promise<ImportPreview> {
    this.cleanExpiredPreviews();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException("Excel bo'sh");

    const startTs = Date.now();
    const preview: ImportPreview = {
      previewId: '',
      fileName: fileName?.slice(0, 255) || null,
      total: 0,
      willInsert: 0,
      duplicatesInDb: 0,
      duplicatesInFile: 0,
      errors: 0,
      errorRows: [],
      skippedRows: [],
      duration: 0,
      expiresAt: '',
    };

    const { validRows, allCandidateIds } = await this.parseExcelRows(ws, preview);

    // DB'dagi mavjud ID'larni topish
    const existingIdSet = new Set<string>();
    if (allCandidateIds.length > 0) {
      const CHUNK = 5000;
      for (let i = 0; i < allCandidateIds.length; i += CHUNK) {
        const chunk = allCandidateIds.slice(i, i + CHUNK);
        const found = await this.prisma.oplataKv.findMany({
          where: { id: { in: chunk } },
          select: { id: true },
        });
        for (const f of found) existingIdSet.add(f.id);
      }
    }
    preview.duplicatesInDb = existingIdSet.size;

    // Fayl ichidagi takror ID'lar va yakuniy insert ro'yxati
    const seenInFile = new Set<string>();
    const toInsert: any[] = [];
    for (const v of validRows) {
      const id: string = v.data.id;
      if (existingIdSet.has(id)) {
        if (preview.skippedRows.length < 100) {
          preview.skippedRows.push({
            row: v.row, id, contractNo: v.data.contractNo,
            reason: "ID DB'da allaqachon bor",
          });
        }
        continue;
      }
      if (seenInFile.has(id)) {
        preview.duplicatesInFile++;
        if (preview.skippedRows.length < 100) {
          preview.skippedRows.push({
            row: v.row, id, contractNo: v.data.contractNo,
            reason: 'Fayl ichida takror ID',
          });
        }
        continue;
      }
      seenInFile.add(id);
      toInsert.push(v.data);
    }
    preview.willInsert = toInsert.length;
    preview.duration = Math.round((Date.now() - startTs) / 1000);

    // Cache'ga saqlaymiz — foydalanuvchi tasdiqlasa shu yerdan o'qiymiz
    const previewId = randomUUID();
    const expiresAt = Date.now() + this.PREVIEW_TTL_MS;
    preview.previewId = previewId;
    preview.expiresAt = new Date(expiresAt).toISOString();

    this.previewCache.set(previewId, {
      fileName: preview.fileName,
      fileSize: buffer.length,
      toInsert,
      preview,
      expiresAt,
      actor,
    });

    this.log.log(
      `ОплатыКв preview ${previewId.slice(0, 8)}: ${preview.total} jami, ${preview.willInsert} qo'shiladigan, ${preview.duplicatesInDb} DB-dub, ${preview.duplicatesInFile} fayl-dub, ${preview.errors} xato — ${preview.duration}s`,
    );

    return preview;
  }

  /**
   * Commit — previewImport'dagi cache'dan o'qib bazaga BULK qo'shadi.
   * Cache'dan o'chiriladi (yana ishlatib bo'lmaydi).
   */
  async commitImport(previewId: string, actor: Actor): Promise<ImportResult> {
    this.cleanExpiredPreviews();
    const state = this.previewCache.get(previewId);
    if (!state) {
      throw new BadRequestException('Preview topilmadi yoki muddati o\'tgan — qaytadan yuklang');
    }
    // Cache'ni darrov olib tashlaymiz (qayta commit'dan saqlash uchun)
    this.previewCache.delete(previewId);

    const startTs = Date.now();
    const batch = await this.prisma.importBatch.create({
      data: {
        kind: 'oplata-kv',
        fileName: state.fileName,
        fileSize: state.fileSize,
        importedBy: actor.name?.slice(0, 190) || state.actor.name?.slice(0, 190) || null,
      },
    });

    const result: ImportResult = {
      total: state.preview.total,
      added: 0,
      skipped: state.preview.duplicatesInDb + state.preview.duplicatesInFile,
      errors: state.preview.errors,
      errorRows: state.preview.errorRows,
      skippedRows: state.preview.skippedRows,
      batchId: batch.id,
      duration: 0,
    };

    // toInsert'ga importBatchId qo'shamiz
    const toInsert = state.toInsert.map((d) => ({ ...d, importBatchId: batch.id }));

    const INSERT_CHUNK = 1000;
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      const chunk = toInsert.slice(i, i + INSERT_CHUNK);
      try {
        const r = await this.prisma.oplataKv.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        result.added += r.count;
      } catch (e: any) {
        this.log.error(`Bulk insert xato (chunk ${i}): ${e?.message}`);
        for (const item of chunk) {
          result.errors++;
          if (result.errorRows.length < 200) {
            result.errorRows.push({
              row: -1, reason: `Bulk insert xato: ${e?.message || 'noma\'lum'}`,
              id: item.id, contractNo: item.contractNo,
            });
          }
        }
      }
      if (i % (INSERT_CHUNK * 5) === 0) {
        this.log.log(`ОплатыКв commit: ${i + chunk.length} / ${toInsert.length} qoshildi`);
      }
    }

    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: `BATCH-${batch.id}`,
        action: 'imported',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: ['*'],
        changes: { batchId: batch.id, fileName: state.fileName, count: result.added } as any,
        note: `Excel'dan ${result.added} ta qator import qilindi (batch ${batch.id.slice(0, 8)}, previewId ${previewId.slice(0, 8)})`,
      },
    });

    result.duration = Math.round((Date.now() - startTs) / 1000);

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        rowsTotal:   result.total,
        rowsAdded:   result.added,
        rowsSkipped: result.skipped,
        rowsErrors:  result.errors,
      },
    });

    this.log.log(`ОплатыКв commit ${previewId.slice(0, 8)}: ${result.added} qoshildi, ${result.duration}s`);
    return result;
  }

  /** Cache'dan preview'ni olib tashlash (bekor qilish) */
  cancelPreview(previewId: string): { ok: boolean; canceled: boolean } {
    const had = this.previewCache.has(previewId);
    this.previewCache.delete(previewId);
    return { ok: true, canceled: had };
  }

  /**
   * Asl bir bosqichli import — preview + commit'ni birga bajaradi.
   * Eski client'lar uchun saqlanadi (backwards compat).
   */
  async importExcel(
    buffer: Buffer,
    actor: Actor,
    fileName?: string,
  ): Promise<ImportResult> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException("Excel bo'sh");

    const batch = await this.prisma.importBatch.create({
      data: {
        kind: 'oplata-kv',
        fileName: fileName?.slice(0, 255) || null,
        fileSize: buffer.length,
        importedBy: actor.name?.slice(0, 190) || null,
      },
    });

    const startTs = Date.now();
    const result: ImportResult = {
      total: 0, added: 0, skipped: 0, errors: 0,
      errorRows: [],
      skippedRows: [],
      batchId: batch.id,
      duration: 0,
    };

    // ─── 1-bosqich: barcha qatorlarni Excel'dan o'qib, valid yozuvlarni to'plash ───
    const { validRows, allCandidateIds } = await this.parseExcelRows(ws, result);
    // importBatchId va createdBy ma'lumotlarini har bir qatorga qo'shamiz
    for (const v of validRows) {
      v.data.createdById    = actor.id   ?? null;
      v.data.createdByName  = actor.name ?? null;
      v.data.importBatchId  = batch.id;
    }
    this.log.log(`ОплатыКв import: ${result.total} qator, ${validRows.length} valid, ${result.errors} xato`);

    // ─── 2-bosqich: barcha ID'larni bitta zaprosda tekshirish ───
    const existingIdSet = new Set<string>();
    if (allCandidateIds.length > 0) {
      const CHUNK = 5000;
      for (let i = 0; i < allCandidateIds.length; i += CHUNK) {
        const chunk = allCandidateIds.slice(i, i + CHUNK);
        const found = await this.prisma.oplataKv.findMany({
          where: { id: { in: chunk } },
          select: { id: true },
        });
        for (const f of found) existingIdSet.add(f.id);
      }
    }
    this.log.log(`ОплатыКв import: ${existingIdSet.size} ta dublikat ID topildi`);

    // Dublikatlarni va fayl ichidagi takrorlarni ajratish
    const seenInFile = new Set<string>();
    const toInsert: any[] = [];
    for (const v of validRows) {
      const id: string = v.data.id;
      if (existingIdSet.has(id) || seenInFile.has(id)) {
        result.skipped++;
        if (result.skippedRows.length < 100) {
          result.skippedRows.push({
            row: v.row,
            id,
            contractNo: v.data.contractNo,
            reason: existingIdSet.has(id) ? 'ID DB\'da allaqachon bor' : 'Fayl ichida takror ID',
          });
        }
        continue;
      }
      seenInFile.add(id);
      toInsert.push(v.data);
    }

    // ─── 3-bosqich: BULK INSERT (chunk'larda) ───
    const INSERT_CHUNK = 1000;
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      const chunk = toInsert.slice(i, i + INSERT_CHUNK);
      try {
        const r = await this.prisma.oplataKv.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        result.added += r.count;
      } catch (e: any) {
        this.log.error(`Bulk insert xato (chunk ${i}): ${e?.message}`);
        // Chunk xato bersa, qatorlarni alohida xato qilamiz
        for (const item of chunk) {
          result.errors++;
          if (result.errorRows.length < 200) {
            result.errorRows.push({
              row: -1, reason: `Bulk insert xato: ${e?.message || 'noma\'lum'}`,
              id: item.id, contractNo: item.contractNo,
            });
          }
        }
      }
      if (i % (INSERT_CHUNK * 5) === 0) {
        this.log.log(`ОплатыКв import: ${i + chunk.length} / ${toInsert.length} qoshildi`);
      }
    }

    // ─── 4-bosqich: BULK HISTORY (bitta yozuv har 1000 qator uchun emas, batch summary uchun) ───
    // Har bir qator uchun alohida history yozuvi yaratish o'rniga, bitta batch summary yozamiz.
    // Bu 70k qator uchun 70k → 1 yozuv (juda tez).
    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: `BATCH-${batch.id}`, // batch-level marker
        action: 'imported',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: ['*'],
        changes: { batchId: batch.id, fileName, count: result.added } as any,
        note: `Excel'dan ${result.added} ta qator import qilindi (batch ${batch.id.slice(0, 8)})`,
      },
    });

    result.duration = Math.round((Date.now() - startTs) / 1000);

    // Batch ma'lumotlarini yangilab qoyamiz
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        rowsTotal:   result.total,
        rowsAdded:   result.added,
        rowsSkipped: result.skipped,
        rowsErrors:  result.errors,
      },
    });

    this.log.log(`ОплатыКв import: ${result.added} qoshildi, ${result.skipped} skip, ${result.errors} xato`);
    return result;
  }

  /**
   * Importni o'chirish — batch'dagi barcha oplata_kv qatorlarini va batch'ning o'zini o'chiradi.
   * History (oplata_kv_history) qoladi — audit log uchun.
   */
  async deleteImportBatch(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new BadRequestException('Import batch topilmadi');
    if (batch.kind !== 'oplata-kv') {
      throw new BadRequestException('Bu batch oplata-kv emas');
    }

    const CHUNK = 500;
    let totalDeleted = 0;
    while (true) {
      const rows = await this.prisma.oplataKv.findMany({
        where: { importBatchId: batchId },
        select: { id: true, sourceTxId: true, contractNo: true, client: true, object: true, paymentAmount: true, date: true, purpose: true, txType: true },
        take: CHUNK,
      });
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);

      // Audit yozuvi — har qatorning TO'LIQ snapshot'i (mijoz aynan qaysi to'lovligini bilsin) + audit.
      const historyData: any[] = rows.map((row) => ({
        oplataKvId: row.id,
        action: 'deleted',
        actorType: 'system',
        actorId: null,
        actorName: `import-batch-delete (${batchId.slice(0, 8)})`,
        fieldsChanged: ['*'],
        changes: { snapshot: {
          id: row.id, sourceTxId: row.sourceTxId, contractNo: row.contractNo, client: row.client, object: row.object,
          paymentAmount: row.paymentAmount?.toString() ?? null, date: row.date ? row.date.toISOString().slice(0, 10) : null,
          purpose: row.purpose, txType: row.txType,
        }, reason: 'Import batch o\'chirildi' },
        note: `Import batch ${batchId.slice(0, 8)} bilan birga o'chirildi`,
      }));
      await this.prisma.oplataKvHistory.createMany({ data: historyData });

      const r = await this.prisma.oplataKv.deleteMany({ where: { id: { in: ids } } });
      totalDeleted += r.count;
    }

    await this.prisma.importBatch.delete({ where: { id: batchId } });
    return { ok: true, deleted: totalDeleted };
  }

  /**
   * Excel sheet'dan qatorlarni o'qib valid yozuvlar va kandidat ID'larni qaytaradi.
   * Xato qatorlar accumulator.errors va errorRows ga yoziladi (preview yoki ImportResult).
   * previewImport va importExcel ikkalasi ishlatadi.
   */
  private async parseExcelRows(
    ws: ExcelJS.Worksheet,
    accumulator: { total: number; errors: number; errorRows: Array<{ row: number; reason: string; id?: string; contractNo?: string }> },
  ): Promise<{
    validRows: Array<{ row: number; data: any }>;
    allCandidateIds: string[];
  }> {
    const rowCount = ws.actualRowCount || ws.rowCount;
    const validRows: Array<{ row: number; data: any }> = [];
    const allCandidateIds: string[] = [];

    for (let r = 2; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const hasAny = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].some((c) => this.cellText(row.getCell(c)) !== '');
      if (!hasAny) continue;

      accumulator.total++;
      const contractNo = this.cellText(row.getCell(1));
      const idValue   = this.cellText(row.getCell(13));

      try {
        const dateRaw   = row.getCell(2).value;
        if (!contractNo) throw new Error('Дог № bo\'sh');
        if (!idValue)    throw new Error('ID ustuni bo\'sh — majburiy');

        const date = this.parseDate(dateRaw);
        if (!date) throw new Error('Дата formati noto\'g\'ri (kerakli: dd.mm.yyyy)');

        const paymentAmount    = this.parseAmountOrNull(row.getCell(3).value);
        const firstInstallment = this.parseAmountOrNull(row.getCell(4).value);
        const monthlyAmount    = this.parseAmountOrNull(row.getCell(5).value);

        validRows.push({
          row: r,
          data: {
            id: idValue,
            contractNo: contractNo.slice(0, 50),
            date,
            paymentAmount:    paymentAmount    !== null ? new Prisma.Decimal(paymentAmount)    : null,
            firstInstallment: firstInstallment !== null ? new Prisma.Decimal(firstInstallment) : null,
            monthlyAmount:    monthlyAmount    !== null ? new Prisma.Decimal(monthlyAmount)    : null,
            purpose:        this.cellText(row.getCell(6)) || null,
            txType:         this.cellText(row.getCell(7)).slice(0, 60) || null,
            note:           this.cellText(row.getCell(8)) || null,
            paymentCategory: this.parseCategory(this.cellText(row.getCell(9))),
            object:         this.cellText(row.getCell(10)).slice(0, 255) || null,
            client:         this.cellText(row.getCell(11)).slice(0, 255) || null,
            paymentMethod:  this.cellText(row.getCell(12)).slice(0, 120) || null,
          },
        });
        allCandidateIds.push(idValue);
      } catch (e: any) {
        accumulator.errors++;
        if (accumulator.errorRows.length < 200) {
          accumulator.errorRows.push({
            row: r,
            reason: e?.message || 'Noma\'lum xato',
            id: idValue || undefined,
            contractNo: contractNo || undefined,
          });
        }
      }
    }

    return { validRows, allCandidateIds };
  }

  // ─── Excel parsing helpers ───────────────────────────
  private cellText(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v == null) return '';
    if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text).trim();
    if (typeof v === 'object' && 'result' in (v as any)) return String((v as any).result).trim();
    return String(v).trim();
  }

  /** "100 000,50" | "100000.5" | number → number | null */
  private parseAmountOrNull(raw: any): number | null {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') return raw;
    const s = String(raw).trim().replace(/\s/g, '').replace(/,/g, '.');
    if (!s) return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  /** dd.MM.yyyy | yyyy-MM-dd | Date | Excel date number → Date | null */
  private parseDate(raw: any): Date | null {
    if (!raw) return null;
    if (raw instanceof Date) return raw;
    if (typeof raw === 'number') {
      // Excel date serial
      const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : d;
    }
    const s = String(raw).trim();
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Excel'dagi "ежемесячный" | "1 взнос" | "Общий" → enum yoki null */
  private parseCategory(s: string): OplataKvCategory | null {
    const t = (s || '').trim().toLowerCase();
    if (!t) return null;
    if (t.includes('ежемесяч')) return 'MONTHLY';
    if (t.includes('1 взнос') || t.includes('первый') || t.includes('1-взнос')) return 'FIRST';
    if (t.includes('общий') || t.includes('общая') || t === 'общ') return 'GENERAL';
    return null;
  }

  // ════════════════════════════════════════════════════════════════════
  // ПЕРЕБРОСКА — shartnomadan shartnomaga pul o'tkazma
  // ════════════════════════════════════════════════════════════════════

  /**
   * Shartnoma qoldig'i — barcha tegishli OplataKv qatorlaridagi paymentAmount summasi.
   * Перереброска uchun: foydalanuvchi shu summadan oshib transfer qila olmaydi.
   * CRM dan ham mijoz/obyekt nomini olib qaytaramiz (form auto-fill uchun).
   */
  /**
   * Shartnoma raqami avtoto'ldirish — qisman kiritilgan matnga mos keladigan
   * mavjud shartnoma raqamlari (to'lov tarixi bor, otkaz shartnomalar ham).
   * Перереброска modalida ДОГ № maydoni uchun.
   */
  async contractSuggest(q: string): Promise<{ ok: true; items: string[] }> {
    const query = (q || '').trim();
    if (query.length < 2) return { ok: true, items: [] };
    const rows = await this.prisma.oplataKv.findMany({
      where: { contractNo: { contains: query, mode: 'insensitive' } },
      select: { contractNo: true },
      distinct: ['contractNo'],
      orderBy: { contractNo: 'asc' },
      take: 15,
    });
    const items = rows.map((r) => r.contractNo).filter((v): v is string => !!v);
    return { ok: true, items };
  }

  async contractBalance(contractNo: string) {
    if (!contractNo || !contractNo.trim()) {
      throw new BadRequestException("contractNo bo'sh");
    }
    const cn = contractNo.trim();

    // Joriy jami summa (barcha tegishli to'lovlar)
    const sums = await this.prisma.oplataKv.aggregate({
      where: { contractNo: cn },
      _sum: { paymentAmount: true, firstInstallment: true, monthlyAmount: true },
      _count: true,
    });

    const totalPaid = Number(sums._sum.paymentAmount || 0);
    const totalFirst = Number(sums._sum.firstInstallment || 0);
    const totalMonthly = Number(sums._sum.monthlyAmount || 0);
    const hasPayments = (sums._count || 0) > 0;

    // CRM dan mijoz va obyekt — auto-fill uchun
    const crmLookup = await this.crmLookupForForm(cn).catch(() => null);

    let customerName = crmLookup?.customerName || null;
    let objectName = crmLookup?.objectName || null;

    // Otkaz (bekor qilingan) yoki CRM da topilmaydigan, lekin to'lov tarixi bor
    // shartnomalar uchun — obyekt/mijoz nomini oplata-kv qatorlaridan fallback qilamiz.
    if ((!customerName || !objectName) && hasPayments) {
      const row = await this.prisma.oplataKv.findFirst({
        where: { contractNo: cn, object: { not: null } },
        select: { object: true, client: true },
        orderBy: { date: 'desc' },
      });
      if (!objectName) objectName = row?.object || null;
      if (!customerName) customerName = row?.client || null;
    }

    return {
      ok: true,
      contractNo: cn,
      totalPaid,
      totalFirst,
      totalMonthly,
      rowCount: sums._count,
      customerName,
      objectName,
      // Otkaz bo'lgan shartnomalar CRM da found=false bo'lishi mumkin, lekin to'lov
      // tarixi bor — perereboska uchun ular ham "topilgan" deb qabul qilinadi.
      foundInCrm: !!crmLookup?.found || hasPayments,
    };
  }

  /**
   * Переброска yaratish — bitta source qator (manfiy summa) + N ta dest qatorlar (musbat).
   * Validatsiya:
   *   - source CRM da mavjud
   *   - har bir destination CRM da mavjud
   *   - source amount > 0 (UI da minus avto qo'shiladi)
   *   - destinations summasi === source amount
   *   - source qoldig'i amount dan kam emas
   *   - obyekt nomlari teng (source + barcha destinations)
   *   - file majburiy
   */
  async createPerereboska(input: {
    fromContractNo: string;
    amount: number;                 // jami summa (musbat)
    date: string;                   // YYYY-MM-DD
    destinations: Array<{ contractNo: string; amount: number }>;
    note?: string;
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number };
    actor: Actor;
    // AI Переброска — agent ariza'dan o'qigan bo'lsa (ixtiyoriy)
    agentUsed?: boolean;
    agentState?: string | null;     // verified / needs_review
    agentReason?: string | null;
    agentData?: any;
  }) {
    const fromCn = (input.fromContractNo || '').trim().toUpperCase();
    if (!fromCn) throw new BadRequestException("Manba shartnoma bo'sh");
    if (!(input.amount > 0)) throw new BadRequestException("Summa 0 dan katta bo'lishi shart");
    if (!input.destinations?.length) throw new BadRequestException("Kamida 1 ta maqsadli shartnoma kerak");
    if (!input.date) throw new BadRequestException("Sana kerak");
    if (!input.file?.buffer) throw new BadRequestException("Hujjat (file) majburiy");
    if (input.file.size > 25 * 1024 * 1024) throw new BadRequestException("Fayl 25 MB dan oshmasligi kerak");

    // Source o'zini o'ziga otkaza olmaydi
    for (const d of input.destinations) {
      const dn = (d.contractNo || '').trim().toUpperCase();
      if (!dn) throw new BadRequestException("Maqsadli shartnoma bo'sh");
      if (dn === fromCn) throw new BadRequestException("Maqsadli shartnoma manba bilan bir xil bo'la olmaydi");
      if (!(d.amount > 0)) throw new BadRequestException(`Maqsadli summa noto'g'ri: ${dn}`);
    }

    // Destinations summasi === source amount
    const destSum = input.destinations.reduce((s, d) => s + Number(d.amount), 0);
    if (Math.abs(destSum - input.amount) > 0.01) {
      throw new BadRequestException(
        `Maqsadli summalar jami (${destSum.toFixed(2)}) manba summasiga (${input.amount.toFixed(2)}) teng emas`,
      );
    }

    // Manba (source) — CRM da yoki to'lov tarixida mavjudligini tekshirish.
    // Otkaz (bekor qilingan) / CRM da yo'q, lekin to'lovlari bor shartnomalar ham qabul qilinadi.
    const balance = await this.contractBalance(fromCn);
    if (!balance.foundInCrm) {
      throw new BadRequestException(`Manba shartnoma topilmadi (CRM va to'lov tarixida yo'q): ${fromCn}`);
    }
    const fromObjectName = balance.objectName;
    const fromCustomerName = balance.customerName;
    if (!fromObjectName) {
      throw new BadRequestException(`Manba shartnoma obyekti aniqlanmadi: ${fromCn}`);
    }

    // Source qoldig'i tekshirish
    if (balance.totalPaid < input.amount - 0.01) {
      throw new BadRequestException(
        `Manba qoldig'i yetarli emas: ${balance.totalPaid.toFixed(2)} < ${input.amount.toFixed(2)}`,
      );
    }

    // Tekshirish — har bir destination + obyekt teng.
    // Manba kabi: CRM da yoki to'lov tarixida mavjud bo'lsa (otkaz ham) qabul qilinadi.
    const destCrms: Array<{ contractNo: string; customerName: string | null; objectName: string | null }> = [];
    for (const d of input.destinations) {
      const dn = (d.contractNo || '').trim().toUpperCase();
      const dBal = await this.contractBalance(dn);
      if (!dBal.foundInCrm) {
        throw new BadRequestException(`Maqsadli shartnoma topilmadi (CRM va to'lov tarixida yo'q): ${dn}`);
      }
      if (!dBal.objectName) {
        throw new BadRequestException(`Maqsadli shartnoma obyekti aniqlanmadi: ${dn}`);
      }
      if (dBal.objectName !== fromObjectName) {
        throw new BadRequestException(
          `Obyekt nomi mos kelmaydi: ${dn} (${dBal.objectName}) ≠ ${fromCn} (${fromObjectName})`,
        );
      }
      destCrms.push({ contractNo: dn, customerName: dBal.customerName, objectName: dBal.objectName });
    }

    // Sana validatsiyasi (fayl saqlashdan oldin)
    const dateObj = new Date(input.date);
    if (isNaN(dateObj.getTime())) throw new BadRequestException("Sana noto'g'ri formatda");

    const note = (input.note || '').trim() || null;
    const TX_TYPE = 'Переброска';

    // Fayl yo'llari
    const groupId = randomUUID();
    const safeName = input.file.originalname.replace(/[^\w\d.\-_ ()\[\]а-яёА-ЯЁa-zA-Z0-9]/g, '_').slice(0, 200);
    const dir = path.join(this.uploadsDir, 'perereboska', groupId);
    const filePath = path.join(dir, safeName);

    // Fayl yozuvi + DB tranzaksiyasi — himoyalangan: xato bo'lsa GENERIC 500 emas,
    // aniq sabab (Prisma kodi bilan) qaytadi, stack log qilinadi, yarim fayl tozalanadi.
    let created: { sourceRow: any; destRows: any[] };
    try {
      // Faylni saqlash
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, input.file.buffer);

      // Tranzaksiya bilan barcha qatorlarni yaratamiz
      created = await this.prisma.$transaction(async (tx) => {
      // FIX (B#2): manba shartnomani QULFLAYMIZ — bir vaqtli 2-pereboska double-spend qilmasin.
      // Advisory lock transaction oxirigacha ushlanadi; 2-so'rov birinchisini kutadi.
      // $executeRaw ishlatiladi — pg_advisory_xact_lock 'void' qaytaradi, $queryRaw uni
      // deserialize qila olmay P2010 xato beradi (переброска saqlashni butunlay buzardi).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fromCn}))`;
      // Qoldiqni QULF ostida qayta tekshiramiz (TOCTOU'ni yopadi — 2-so'rov yangilangan qoldiqni ko'radi).
      const agg = await tx.oplataKv.aggregate({ where: { contractNo: fromCn }, _sum: { paymentAmount: true } });
      const paidNow = Number(agg._sum.paymentAmount || 0);
      if (paidNow < input.amount - 0.01) {
        throw new BadRequestException(
          `Manba qoldig'i yetarli emas (qayta tekshiruv): ${paidNow.toFixed(2)} < ${input.amount.toFixed(2)}`,
        );
      }
      // 1) Source qator (manfiy summa)
      const sourceRow = await tx.oplataKv.create({
        data: {
          contractNo: fromCn,
          date: dateObj,
          paymentAmount: -input.amount, // MANFIY — pul olinmoqda
          firstInstallment: null,
          monthlyAmount: null,
          purpose: `Переброска: ${fromCn} → ${input.destinations.map((d) => d.contractNo.toUpperCase()).join(', ')}`,
          txType: TX_TYPE,
          note,
          paymentCategory: null,
          object: fromObjectName,
          client: fromCustomerName,
          paymentMethod: TX_TYPE,
          createdById: input.actor.id,
          createdByName: input.actor.name,
          perereboskaGroupId: groupId,
          perereboskaFilePath: filePath,
          perereboskaFileName: safeName,
          perereboskaFileMime: input.file.mimetype.slice(0, 128),
          perereboskaFileSize: input.file.size,
        },
      });

      // 2) Destinations (musbat summalar)
      const destRows: any[] = [];
      for (let i = 0; i < input.destinations.length; i++) {
        const d = input.destinations[i];
        const dc = destCrms[i];
        const r = await tx.oplataKv.create({
          data: {
            contractNo: dc.contractNo,
            date: dateObj,
            paymentAmount: d.amount,
            firstInstallment: null,
            monthlyAmount: null,
            purpose: `Переброска: ${fromCn} → ${dc.contractNo}`,
            txType: TX_TYPE,
            note,
            paymentCategory: null,
            object: dc.objectName,
            client: dc.customerName,
            paymentMethod: TX_TYPE,
            createdById: input.actor.id,
            createdByName: input.actor.name,
            perereboskaGroupId: groupId,
            // File faqat source qatorda saqlanadi (qaytarilish ham source orqali)
          },
        });
        destRows.push(r);
      }

      // 3) Переброска guruh yozuvi (tarix + orqaga qaytarish uchun audit)
      await tx.perereboskaGroup.create({
        data: {
          id: groupId,
          fromContractNo: fromCn,
          objectName: fromObjectName,
          fromClient: fromCustomerName,
          amount: input.amount,
          date: dateObj,
          destinations: destCrms.map((dc, i) => ({
            contractNo: dc.contractNo,
            amount: input.destinations[i].amount,
            client: dc.customerName,
          })) as any,
          note,
          fileName: safeName,
          fileMime: input.file.mimetype.slice(0, 128),
          fileSize: input.file.size,
          filePath,
          agentUsed: !!input.agentUsed,
          agentState: input.agentState || null,
          agentReason: input.agentReason || null,
          agentData: (input.agentData ?? null) as any,
          status: 'active',
          createdById: input.actor.id,
          createdByName: input.actor.name,
        },
      });

      // History (audit)
      try {
        await tx.oplataKvHistory.create({
          data: {
            oplataKvId: sourceRow.id,
            action: 'created',
            actorType: input.actor.id ? 'user' : 'system',
            actorId: input.actor.id,
            actorName: input.actor.name,
            note: `Переброска yaratildi: ${fromCn} → ${destRows.length} ta shartnoma · ${input.amount}`,
            changes: { groupId, amount: input.amount, destinations: input.destinations } as any,
          },
        });
      } catch (e: any) {
        this.log.warn(`Perereboska history xato: ${e?.message}`);
      }

      return { sourceRow, destRows };
      });
    } catch (e: any) {
      if (e instanceof HttpException) throw e; // BadRequest (qayta tekshiruv) — o'z xabari bilan qaytadi
      this.log.error(`Perereboska saqlashda xato (manba ${fromCn}, summa ${input.amount}): ${e?.stack || e?.message || e}`);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); // orphan faylni tozalash (tranzaksiya rollback bo'ldi)
      throw new InternalServerErrorException(`Переброска saqlashda xato: ${e?.code ? `[${e.code}] ` : ''}${e?.message || e}`);
    }

    // Split (1 взнос / ежемесячный hisoblash) — barcha yangi qatorlar uchun.
    // Source qator avval (manfiy summa — refund logikasi), keyin destinations.
    // Tartib muhim: aggregate'lar ketma-ket o'qiladi, shu sababli await bilan ketma-ket.
    try {
      await this.splitSingleRow(created.sourceRow.id, input.actor);
      for (const r of created.destRows) {
        try {
          await this.splitSingleRow(r.id, input.actor);
        } catch (e: any) {
          this.log.warn(`Perereboska dest split xato (${r.id}): ${e?.message}`);
        }
      }
    } catch (e: any) {
      this.log.warn(`Perereboska source split xato: ${e?.message}`);
    }

    // Telegram xabar
    void this.notifyPerereboskaTelegram('created', {
      groupId,
      fromCn,
      objectName: fromObjectName,
      amount: input.amount,
      destinations: destCrms.map((d, i) => ({ contractNo: d.contractNo, amount: input.destinations[i].amount })),
      actor: input.actor,
      filePath,
      fileName: safeName,
      fileMime: input.file.mimetype,
    });

    return {
      ok: true,
      groupId,
      sourceId: created.sourceRow.id,
      destIds: created.destRows.map((r) => r.id),
      amount: input.amount,
    };
  }

  /**
   * Перереброска guruh'ini orqaga qaytarish — pul qatorlari o'chiriladi (balans tiklanadi),
   * guruh yozuvi 'cancelled' bo'ladi (tarixda qoladi), fayl o'chiriladi. Telegram xabar.
   */
  async deletePerereboskaGroup(groupId: string, actor: Actor, reason?: string) {
    if (!groupId) throw new BadRequestException("groupId bo'sh");

    const rows = await this.prisma.oplataKv.findMany({
      where: { perereboskaGroupId: groupId },
      orderBy: { paymentAmount: 'asc' }, // source (manfiy) avval
    });
    // Guruh yozuvi bor lekin qatorlar yo'q bo'lsa (allaqachon bekor qilingan) — xato bermaymiz
    const grp = await this.prisma.perereboskaGroup.findUnique({ where: { id: groupId } });
    if (rows.length === 0 && !grp) throw new NotFoundException('Перереброска guruh topilmadi');
    if (rows.length === 0 && grp?.status === 'cancelled') {
      throw new BadRequestException('Bu переброска allaqachon bekor qilingan');
    }

    if (rows.length > 0) {
      const sourceRow = rows.find((r) => Number(r.paymentAmount || 0) < 0) || rows[0];
      const filePath = sourceRow.perereboskaFilePath;
      let fileBuffer: Buffer | null = null;
      if (filePath) {
        try { fileBuffer = await fs.readFile(filePath); } catch {}
      }

      // Pul qatorlarini o'chirish (balans tiklanadi)
      await this.prisma.oplataKv.deleteMany({ where: { perereboskaGroupId: groupId } });

      // Diskdan faylni o'chirish
      if (filePath) {
        try {
          await fs.unlink(filePath);
          await fs.rmdir(path.dirname(filePath)).catch(() => {});
        } catch (e: any) {
          this.log.warn(`Perereboska file o'chirilmadi: ${e?.message}`);
        }
      }

      // Telegram
      void this.notifyPerereboskaTelegram('deleted', {
        groupId,
        fromCn: sourceRow.contractNo,
        objectName: sourceRow.object,
        amount: Math.abs(Number(sourceRow.paymentAmount || 0)),
        destinations: rows
          .filter((r) => r.id !== sourceRow.id)
          .map((r) => ({ contractNo: r.contractNo, amount: Number(r.paymentAmount || 0) })),
        actor,
        filePath: null,
        fileName: sourceRow.perereboskaFileName || 'document',
        fileMime: sourceRow.perereboskaFileMime || 'application/octet-stream',
        fileBuffer,
      });
    }

    // Guruh yozuvini 'cancelled' qilamiz (tarixda qoladi, filtrlash uchun)
    await this.prisma.perereboskaGroup.updateMany({
      where: { id: groupId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledById: actor.id ?? null,
        cancelledByName: actor.name ?? null,
        cancelReason: (reason || '').trim() || null,
        filePath: null, // fayl o'chirildi
      },
    });

    return { ok: true, deleted: rows.length, groupId };
  }

  /** Перереброска guruh fayli — download uchun */
  async getPerereboskaFile(groupId: string) {
    const source = await this.prisma.oplataKv.findFirst({
      where: { perereboskaGroupId: groupId, perereboskaFilePath: { not: null } },
    });
    if (!source || !source.perereboskaFilePath) {
      throw new NotFoundException("Перереброска fayli topilmadi");
    }
    try {
      await fs.access(source.perereboskaFilePath);
    } catch {
      throw new NotFoundException("Fayl diskda yo'q");
    }
    return {
      filePath: source.perereboskaFilePath,
      fileName: source.perereboskaFileName || 'document',
      fileMime: source.perereboskaFileMime || 'application/octet-stream',
      fileSize: source.perereboskaFileSize || 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // AI ПЕРЕБРОСКА — sozlamalar, ariza'ni Claude vision bilan o'qish, tarix
  // ═══════════════════════════════════════════════════════════════════
  private readonly K_PB_AI_ENABLED = 'perereboska.aiEnabled';
  private readonly K_PB_AI_MODEL = 'perereboska.aiModel';
  private readonly K_PB_STRICT = 'perereboska.strict';
  private readonly K_PB_TG = 'perereboska.tgNotify';
  private readonly K_PB_NAMECHECK = 'perereboska.nameCheck';
  private readonly K_PB_SHOWREVERSE = 'perereboska.showReverse';

  async isPerereboskaAiEnabled(): Promise<boolean> {
    return (await this.settings.get(this.K_PB_AI_ENABLED)) !== '0'; // default yoqiq
  }
  async getPerereboskaAiModel(): Promise<string> {
    return (await this.settings.get(this.K_PB_AI_MODEL))
      || (await this.settings.get('agent.aiModel'))
      || 'claude-sonnet-4-6';
  }
  async isPerereboskaStrict(): Promise<boolean> {
    return (await this.settings.get(this.K_PB_STRICT)) === '1'; // default yumshoq (ogohlantirib o'tkazadi)
  }
  async isPerereboskaTgNotify(): Promise<boolean> {
    return (await this.settings.get(this.K_PB_TG)) !== '0'; // default yoqiq
  }
  async isPerereboskaNameCheck(): Promise<boolean> {
    return (await this.settings.get(this.K_PB_NAMECHECK)) === '1'; // default o'chiq
  }
  async isPerereboskaShowReverse(): Promise<boolean> {
    return (await this.settings.get(this.K_PB_SHOWREVERSE)) !== '0'; // default yoqiq
  }

  async getPerereboskaSettings() {
    const [aiEnabled, aiModel, strict, tgNotify, nameCheck, showReverse, key] = await Promise.all([
      this.isPerereboskaAiEnabled(),
      this.getPerereboskaAiModel(),
      this.isPerereboskaStrict(),
      this.isPerereboskaTgNotify(),
      this.isPerereboskaNameCheck(),
      this.isPerereboskaShowReverse(),
      this.getAiKey(),
    ]);
    return { aiEnabled, aiModel, strict, tgNotify, nameCheck, showReverse, hasKey: !!key, tgChat: this.tgChat };
  }

  async savePerereboskaSettings(
    body: { aiEnabled?: boolean; aiModel?: string; strict?: boolean; tgNotify?: boolean; nameCheck?: boolean; showReverse?: boolean },
    actor?: Actor,
  ) {
    const by = actor?.name || undefined;
    if (body.aiEnabled !== undefined) await this.settings.set(this.K_PB_AI_ENABLED, body.aiEnabled ? '1' : '0', by);
    if (body.aiModel !== undefined) await this.settings.set(this.K_PB_AI_MODEL, (body.aiModel || '').trim(), by);
    if (body.strict !== undefined) await this.settings.set(this.K_PB_STRICT, body.strict ? '1' : '0', by);
    if (body.tgNotify !== undefined) await this.settings.set(this.K_PB_TG, body.tgNotify ? '1' : '0', by);
    if (body.nameCheck !== undefined) await this.settings.set(this.K_PB_NAMECHECK, body.nameCheck ? '1' : '0', by);
    if (body.showReverse !== undefined) await this.settings.set(this.K_PB_SHOWREVERSE, body.showReverse ? '1' : '0', by);
    return this.getPerereboskaSettings();
  }

  /** ANTHROPIC kalit — agent.aiKey (shifrlangan) yoki env */
  private async getAiKey(): Promise<string | null> {
    const enc = await this.settings.get('agent.aiKey');
    if (enc) { try { return this.crypto.decrypt(enc); } catch { /* skip */ } }
    return process.env.ANTHROPIC_API_KEY || null;
  }

  /**
   * AI Переброска — yuklangan arizani Claude vision bilan o'qib, переброска
   * ma'lumotlarini (manba/maqsad/summa) ajratadi va qoidalarni tekshiradi.
   * DB'ga YOZMAYDI — faqat tahlil. Xodim tasdiqlagach createPerereboska chaqiriladi.
   */
  async analyzePerereboskaAriza(file: { buffer: Buffer; originalname: string; mimetype: string; size: number }) {
    if (!file?.buffer) throw new BadRequestException('Hujjat (file) majburiy');
    if (file.size > 25 * 1024 * 1024) throw new BadRequestException('Fayl 25 MB dan oshmasligi kerak');
    const apiKey = await this.getAiKey();
    if (!apiKey) throw new BadRequestException('AI kalit sozlanmagan (Admin → Agent → AI kalit)');

    // Fayl blokini tayyorlash
    const b64 = file.buffer.toString('base64');
    const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    const isImage = (file.mimetype || '').startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(file.originalname);
    let fileBlock: any;
    if (isPdf) {
      fileBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
    } else if (isImage) {
      const media = (file.mimetype || '').startsWith('image/') ? file.mimetype : 'image/jpeg';
      fileBlock = { type: 'image', source: { type: 'base64', media_type: media, data: b64 } };
    } else {
      throw new BadRequestException("Hujjat PDF yoki rasm bo'lishi kerak");
    }

    const model = await this.getPerereboskaAiModel();
    const nameCheck = await this.isPerereboskaNameCheck();
    const ex = await this.claudeExtractPerereboska(apiKey, model, fileBlock, nameCheck);

    // Ajratilganni tozalash
    const fromCn = String(ex?.fromContractNo || '').trim().toUpperCase();
    const dests = (Array.isArray(ex?.destinations) ? ex.destinations : [])
      .map((d: any) => ({ contractNo: String(d?.contractNo || '').trim().toUpperCase(), amount: Number(d?.amount) || 0 }))
      .filter((d: any) => d.contractNo);
    const destSum = dests.reduce((s: number, d: any) => s + d.amount, 0);
    let totalAmount = Number(ex?.totalAmount) || destSum;

    const warnings: string[] = [];
    if (ex?.isTransferApplication === false) warnings.push("Hujjat переброска arizasiga o'xshamaydi");
    if (!fromCn) warnings.push('Manba shartnoma aniqlanmadi');
    if (dests.length === 0) warnings.push('Maqsadli shartnoma aniqlanmadi');

    // Manba tekshiruvi
    let fromInfo: any = null;
    let objectName: string | null = null;
    if (fromCn) {
      fromInfo = await this.contractBalance(fromCn).catch(() => null);
      if (!fromInfo?.foundInCrm) warnings.push(`Manba shartnoma topilmadi (CRM/tarix): ${fromCn}`);
      objectName = fromInfo?.objectName || null;
    }

    // ── SUMMA TEKSHIRUVI (AI'ga ko'r-ko'rona ishonmaymiz) ──
    // Ariza'dagi har bir summa roli bilan keladi; agent "qaytarilgan" pulni
    // o'tkazma qilib qo'yishi mumkin (real hodisa) — shuni dastur tutadi.
    const srcBalance = fromInfo ? Number(fromInfo.totalPaid) : null;
    const amountDecision = decideTransferAmount(totalAmount, ex?.amountsFound, srcBalance, ex?.transferQuote);
    warnings.push(...amountDecision.warnings);
    if (amountDecision.corrected && amountDecision.amount > 0) {
      totalAmount = amountDecision.amount;
      // Bitta maqsad bo'lsa — uning summasini ham tuzatamiz (forma to'g'ri to'lsin)
      if (dests.length === 1) dests[0].amount = totalAmount;
    }

    // Qoldiq yetarliligi — TUZATILGAN summa bo'yicha tekshiriladi
    if (fromInfo && totalAmount > 0 && Number(fromInfo.totalPaid) < totalAmount - 0.01) {
      warnings.push(`Manba qoldig'i yetarli emas: ${Number(fromInfo.totalPaid).toLocaleString('ru-RU')} < ${totalAmount.toLocaleString('ru-RU')}`);
    }

    // Maqsadlar tekshiruvi
    const destResolved: any[] = [];
    for (const d of dests) {
      const bal = await this.contractBalance(d.contractNo).catch(() => null);
      const found = !!bal?.foundInCrm;
      const dObj = bal?.objectName || null;
      if (!found) warnings.push(`Maqsadli shartnoma topilmadi: ${d.contractNo}`);
      if (found && objectName && dObj && dObj !== objectName) warnings.push(`Obyekt mos emas: ${d.contractNo} (${dObj}) ≠ manba (${objectName})`);
      if (d.contractNo === fromCn) warnings.push(`Maqsadli manba bilan bir xil: ${d.contractNo}`);
      destResolved.push({
        contractNo: d.contractNo, amount: d.amount, client: bal?.customerName || null,
        object: dObj, found, balance: bal ? Number(bal.totalPaid) : null,
      });
    }

    // Summa balansi — tuzatishdan KEYINGI qiymatlar bo'yicha qayta hisoblanadi
    const destSumFinal = dests.reduce((s: number, d: any) => s + d.amount, 0);
    const sumMatch = totalAmount > 0 && Math.abs(destSumFinal - totalAmount) <= 0.01;
    if (!sumMatch && dests.length > 0) {
      warnings.push(`Summalar teng emas: maqsad jami ${destSumFinal.toLocaleString('ru-RU')} ≠ manba ${totalAmount.toLocaleString('ru-RU')}`);
    }

    // ── ARIZACHI ISMI ──
    // Qo'lyozma o'qilmasa ariza MATNIDAGI bosma ism ishlatiladi (u yerda ham yozilgan
    // bo'ladi: "yangi Shartnomamga №4105SRH26RL Ahmedova Anbar Farhodovna ..."),
    // va u CRM'dagi maqsad shartnoma egasi bilan DASTURIY solishtiriladi
    // (kirill↔lotin transliteratsiya). Model o'qiy olmasa — hech narsa to'qimaydi.
    const handwritten = ex?.applicantNameReadable !== false ? String(ex?.applicantName || '').trim() : '';
    const printedName = String(ex?.applicantNamePrinted || '').trim();
    const applicantName = handwritten || printedName || null;
    const applicantNameSource: 'handwritten' | 'printed' | null =
      handwritten ? 'handwritten' : (printedName ? 'printed' : null);

    // Maqsad shartnoma egasi (CRM) bilan solishtirish — model hukmiga tayanmaymiz
    let applicantMatches: boolean | null = null;
    if (applicantName) {
      const holders = destResolved.filter((d) => d.client).map((d) => d.client as string);
      if (holders.length > 0) {
        applicantMatches = holders.some((h) => namesMatch(applicantName, h));
        if (nameCheck && applicantMatches === false) {
          warnings.push(`Ism mos emas: arizachi "${applicantName}" ≠ maqsadli shartnoma egasi "${holders.join(', ')}"`);
        }
      } else if (nameCheck && ex?.applicantMatchesHolder === false) {
        // CRM'da egasi noma'lum — model xulosasiga qaytamiz
        applicantMatches = false;
        warnings.push(`Ism mos emas: arizachi "${applicantName}" maqsadli shartnoma egasiga to'g'ri kelmaydi${ex?.nameNote ? ` — ${ex.nameNote}` : ''}`);
      }
    } else if (nameCheck) {
      warnings.push("Arizachi ismi arizadan o'qilmadi — ismni o'zingiz tekshiring");
    }
    // Manba va maqsad shartnoma egasi bir xil odammi (CRM nomlari — bir xil yozuvда, token o'xshashligi)
    // Kamida 2 ta umumiy so'z (familya+ism) kerak — faqat ism mos kelsa (Gulnora↔Gulnora) yetarli emas.
    if (nameCheck && fromInfo?.customerName) {
      const nameTokens = (s: string) => String(s || '').toUpperCase().replace(/[^A-ZА-ЯЁ]+/gi, ' ').trim().split(/\s+/).filter((w) => w.length >= 3);
      const srcTok = nameTokens(fromInfo.customerName);
      for (const dr of destResolved) {
        if (dr.found && dr.client) {
          const dTok = nameTokens(dr.client);
          const common = dTok.filter((t) => srcTok.includes(t)).length;
          const need = Math.min(srcTok.length, dTok.length, 2);
          if (need > 0 && common < need) {
            warnings.push(`Mijoz ismi HAR XIL: manba egasi "${fromInfo.customerName}" ≠ maqsad egasi "${dr.client}" (${dr.contractNo})`);
          }
        }
      }
    }

    // TAKROR tekshiruvi — shu manbadan shu summada allaqachon переброска bo'lganmi
    // (bloklamaydi, faqat ogohlantiradi — haqiqatan takror bo'lishi ham mumkin)
    let duplicates: Array<{ date: string | null; amount: number }> = [];
    if (fromCn && totalAmount > 0) {
      const existing = await this.prisma.oplataKv.findMany({
        where: { contractNo: fromCn, txType: 'Переброска', paymentAmount: { lt: 0 } },
        select: { date: true, paymentAmount: true },
        orderBy: { date: 'desc' }, take: 30,
      });
      duplicates = existing
        .filter((r) => Math.abs(Math.abs(Number(r.paymentAmount)) - totalAmount) <= 1)
        .map((r) => ({ date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null, amount: Math.abs(Number(r.paymentAmount)) }));
      if (duplicates.length > 0) {
        const dts = duplicates.map((d) => d.date || '?').join(', ');
        warnings.push(`Takror bo'lishi mumkin: ${fromCn} dan shu summada (${totalAmount.toLocaleString('ru-RU')}) allaqachon ${duplicates.length} ta переброска bor (${dts}). Haqiqatan takror bo'lsa davom eting.`);
      }
    }

    const agentState = warnings.length === 0 ? 'verified' : 'needs_review';
    const agentReason = warnings.length === 0
      ? 'Hujjat forma bilan mos, qoidalar bajarildi'
      : warnings.join('; ');

    const fromBalance = fromInfo ? Number(fromInfo.totalPaid) : null;
    const balanceEnough = fromBalance == null || totalAmount <= 0 ? true : fromBalance >= totalAmount - 0.01;

    return {
      ok: true,
      extracted: {
        fromContractNo: fromCn || null,
        fromClient: fromInfo?.customerName || null,
        fromFound: !!fromInfo?.foundInCrm,
        objectName,
        fromBalance,
        totalAmount,
        destinations: destResolved,
        /** Arizada topilgan barcha summalar (rol + iqtibos) — UI'da almashtirish uchun */
        amountsFound: amountDecision.alternatives,
        /** AI bergan summa dastur tomonidan tuzatildimi */
        amountCorrected: amountDecision.corrected,
        applicantName,
        applicantNameSource,
        // Dasturiy taqqoslash natijasi (model hukmi emas); noma'lum bo'lsa null — blok bo'lmaydi
        applicantMatchesHolder: nameCheck ? applicantMatches : null,
        confidence: ex?.confidence || null,
        notes: ex?.notes || null,
        date: new Date().toISOString().slice(0, 10),
      },
      balanceEnough,
      duplicates,
      agentState,
      agentReason,
      warnings,
    };
  }

  /** Claude Messages API — arizadan переброска ma'lumotini structured (tool) ajratadi */
  private async claudeExtractPerereboska(apiKey: string, model: string, fileBlock: any, nameCheck = false): Promise<any> {
    const system = [
      "Sen Xon Saroy quruvchi kompaniyasining ichki moliyaviy yordamchisisan.",
      "Foydalanuvchi ПЕРЕБРОСКА (bir shartnomadan boshqasiga pul o'tkazish) arizasini yuklaydi.",
      "Arizada: manba (eski/bekor qilingan) shartnoma raqami, o'tkaziladigan summa, va yangi (maqsadli) shartnoma raqami(lari) bo'ladi.",
      "Shartnoma raqami formati: raqamlar + obyekt kodi (SRH, VHA, ZUR, VTN...) + raqam/harflar. Masalan: 2986SRH2593, 4026SRH264E.",
      "O'TKAZILADIGAN SUMMANI TO'G'RI ANIQLA (JUDA MUHIM): ariza odatda '<eski shartnoma> bo'yicha QOLGAN [X] so'mni yangi (maqsadli) shartnomaga TO'LOV HISOBIDA QABUL QILISHINGIZNI so'rayman' deydi — aynan shu [X] o'tkaziladigan summa (totalAmount = maqsadli shartnoma summasi).",
      "Arizada 'shartnomani bekor qilish asosida menga QAYTARILGAN [Y] so'm' degan ALOHIDA band bo'lishi mumkin — [Y] QAYTARILGAN pul, u o'tkazma EMAS, uni totalAmount qilib OLMA. Ikkovini adashtirma: totalAmount = yangi shartnomaga qabul qilinadigan [X], qaytarilgan [Y] emas (odatda X > Y).",
      // Real xato (2026-08): model 'qaytarilgan' summani o'tkazma qilib qo'ygan, o'zi
      // esa izohda "buni o'tkazma qilib olmaslik kerak" deb yozgan. Shu sabab endi
      // HAR BIR summa roli bilan alohida qaytariladi va backend dasturiy tekshiradi.
      "MAJBURIY: hujjatdagi HAR BIR pul summasini amountsFound ro'yxatiga yoz — raqami, qavs ichidagi SO'Z bilan yozilgan shakli (amountWords, hujjatdagidek ko'chir), roli va o'sha summa turgan JUMLANI TO'LIQ, hujjatdagidek ko'chirib quote'ga yoz (qisqartirma, o'zgartirma — rol shu matn bo'yicha tekshiriladi).",
      "MAJBURIY: transferQuote — o'tkazmani so'ragan jumlani ('...qolgan [X] ni yangi shartnomamga ... to'lov hisobida qabul qilishingizni so'rayman') hujjatdagidek TO'LIQ ko'chir.",
      "Rollar: 'transfer' = yangi shartnomaga o'tkaziladigan (qabul qilinadigan) summa; 'refunded' = arizachiga qaytarib berilgan pul; 'repay' = arizachi qayta to'lash majburiyatini olgan summa; 'contract_total' = shartnoma umumiy qiymati; 'other' = qolgani.",
      "totalAmount AYNAN role='transfer' bo'lgan summaga TENG bo'lishi shart. Agar 'transfer' rolli summa yo'q bo'lsa — taxmin qilma, confidence='low' qo'y.",
      "Summani raqamda va so'zda TEKSHIR: agar raqam (masalan 34 942 710) qavsdagi so'z shakliga ('Етмиш миллион...' = 70 944 290) MOS KELMASA — ikkalasini ham amountsFound'ga yoz va notes'da bu ziddiyatni aniq ayt.",
      "Aniq bo'lmasa taxmin qilma — confidence='low' qo'y va notes'da yoz.",
      "notes'ni QISQA MARKDOWN formatда yoz: bullet (- ), summalarni **qalin**. FAQAT переброска uchun muhim narsalarni yoz (manba, maqsad, summa, obyekt, arizachi). Plastik karta, karta raqami, to'lov usuli, qaytarish/qayta to'lov summasi kabi переброскага aloqasiz tafsilotlarni YOZMA.",
      nameCheck
        ? "ISM TEKSHIRUVI: arizachi (imzo egasi) ismini MAQSADLI shartnoma egasi ismi (arizada yozilgan) bilan solishtir. Transliteratsiya (Dumcheva↔Dushayeva), ism tartibi, kirill/lotin farqini HISOBGA OL — mohiyatan bir odammi. Mos bo'lsa applicantMatchesHolder=true, aks holda false + nameNote'da qisqa tushuntir."
        : '',
      // Real xato (2026-08): qo'lyozma "Ахмедова Анбар" ni "Arizapova Subor" deb
      // o'qib, yolg'on "ism mos emas" ogohlantirishi bergan va yaratishni bloklagan.
      "ARIZACHI ISMI QO'LDA yozilgan bo'lishi mumkin. Qo'lyozmani ISHONCH bilan o'qiy olmasang — TO'QIMA: applicantName=null qo'y, applicantNameReadable=false va applicantMatchesHolder ni UMUMAN qaytarma. Faqat ishonch bilan o'qilgan ismni solishtir.",
      "MUHIM: ism odatda ariza MATNIDA bosma harflar bilan ham bor (masalan 'yangi Shartnomamga №4105SRH26RL Ahmedova Anbar Farhodovna ...'). Shuni applicantNamePrinted'ga yoz — qo'lyozma o'qilmasa ham shu ishlatiladi.",
      "Blank/forma yorliqlarini (Кимдан, Аризачи, Имзо, Паспорт серия) ism deb qabul QILMA — ular hujjat yorliqlari.",
    ].filter(Boolean).join(' ');
    const userContent = [
      { type: 'text', text: "Ushbu arizani diqqat bilan o'qib, extract_perereboska tool orqali ma'lumotlarni qaytar." },
      fileBlock,
    ];
    const tools = [{
      name: 'extract_perereboska',
      description: "Ariza'dan переброска ma'lumotlarini ajratish",
      input_schema: {
        type: 'object',
        properties: {
          isTransferApplication: { type: 'boolean', description: "Bu haqiqatan переброска / o'zaro hisob-kitob arizasimi" },
          fromContractNo: { type: 'string', description: 'Manba (eski) shartnoma raqami' },
          destinations: {
            type: 'array',
            description: "Maqsadli shartnomalar va ularga o'tkaziladigan summa",
            items: {
              type: 'object',
              properties: { contractNo: { type: 'string' }, amount: { type: 'number' } },
              required: ['contractNo', 'amount'],
            },
          },
          totalAmount: { type: 'number', description: "Manbadan o'tkazilayotgan jami summa (role='transfer' summasiga TENG bo'lishi shart)" },
          amountsFound: {
            type: 'array',
            description: "Hujjatdagi BARCHA pul summalari — roli va iqtibosi bilan (backend shu bo'yicha tekshiradi)",
            items: {
              type: 'object',
              properties: {
                amount: { type: 'number', description: 'Raqam bilan yozilgan summa' },
                amountWords: { type: 'string', description: "Qavs ichida so'z bilan yozilgani (hujjatdagidek)" },
                role: {
                  type: 'string',
                  enum: ['transfer', 'refunded', 'repay', 'contract_total', 'other'],
                  description: "transfer=yangi shartnomaga o'tkaziladigan, refunded=qaytarilgan, repay=qayta to'lanadigan",
                },
                quote: { type: 'string', description: "Shu summa turgan JUMLA — hujjatdagidek to'liq (rol shu matndan tekshiriladi)" },
              },
              required: ['amount', 'role', 'quote'],
            },
          },
          transferQuote: {
            type: 'string',
            description: "O'tkazmani so'ragan jumla — hujjatdagidek to'liq ko'chirilgan",
          },
          applicantName: { type: 'string', description: "Arizachi (imzo egasi) ismi — ishonch bilan o'qilmasa qaytarma" },
          applicantNameReadable: { type: 'boolean', description: "Arizachi ismi (qo'lyozma) ishonch bilan o'qildimi" },
          applicantNamePrinted: { type: 'string', description: 'Ariza MATNIDA bosma yozilgan arizachi / yangi shartnoma egasi ismi' },
          applicantMatchesHolder: { type: 'boolean', description: 'Arizachi ismi maqsadli shartnoma egasiga mos keladimi (ism tekshiruvi so\'ralganda)' },
          nameNote: { type: 'string', description: 'Ism mos kelmasa qisqa tushuntirish' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          notes: { type: 'string', description: 'Qisqa izoh yoki shubha' },
        },
        required: ['isTransferApplication', 'destinations'],
      },
    }];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 1200, system,
        messages: [{ role: 'user', content: userContent }],
        tools, tool_choice: { type: 'tool', name: 'extract_perereboska' },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new BadRequestException(`Claude API xatosi (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const toolUse = (data?.content || []).find((c: any) => c.type === 'tool_use');
    if (!toolUse?.input) throw new BadRequestException("Claude javobi tushunarsiz (hujjat o'qilmadi)");
    return toolUse.input;
  }

  /** Переброска tarixi — guruh yozuvlari, filtrlar bilan */
  async perereboskaHistory(filters: {
    status?: string; dateFrom?: string; dateTo?: string; q?: string; page?: number; perPage?: number;
  }) {
    const where: any = {};
    if (filters.status && filters.status !== 'all') where.status = filters.status;
    if (filters.dateFrom || filters.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = new Date(`${filters.dateFrom}T00:00:00+05:00`);
      if (filters.dateTo) where.date.lte = new Date(`${filters.dateTo}T23:59:59.999+05:00`);
    }
    const q = filters.q?.trim();
    if (q) {
      where.OR = [
        { fromContractNo: { contains: q, mode: 'insensitive' } },
        { fromClient: { contains: q, mode: 'insensitive' } },
        { objectName: { contains: q, mode: 'insensitive' } },
      ];
    }
    const page = Math.max(1, filters.page || 1);
    const perPage = Math.min(100, Math.max(1, filters.perPage || 20));
    const [items, total] = await Promise.all([
      this.prisma.perereboskaGroup.findMany({
        where, orderBy: [{ createdAt: 'desc' }], skip: (page - 1) * perPage, take: perPage,
      }),
      this.prisma.perereboskaGroup.count({ where }),
    ]);
    return { ok: true, items, total, page, perPage };
  }

  /** Telegram notification — Перереброска create/delete */
  private async notifyPerereboskaTelegram(
    action: 'created' | 'deleted',
    payload: {
      groupId: string;
      fromCn: string;
      objectName: string | null;
      amount: number;
      destinations: Array<{ contractNo: string; amount: number }>;
      actor: Actor;
      filePath: string | null;
      fileName: string;
      fileMime: string;
      fileBuffer?: Buffer | null;
    },
  ) {
    if (!this.tgToken || !this.tgChat) return;
    if (!(await this.isPerereboskaTgNotify())) return; // sozlamada o'chirilgan bo'lsa
    try {
      const icon = action === 'created' ? '🔄' : '🗑️';
      const verb = action === 'created' ? 'yaratildi' : "o'chirildi";
      const actor = payload.actor.name || '?';
      const date = new Date().toLocaleString('uz-UZ', {
        timeZone: 'Asia/Tashkent',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      const fmt = (n: number) =>
        new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
      const destText = payload.destinations
        .map((d) => `   • <code>${this.escape(d.contractNo)}</code> · ${fmt(d.amount)}`)
        .join('\n');

      const caption = [
        `${icon} <b>Переброска ${verb}</b>`,
        ``,
        `📤 Manba: <code>${this.escape(payload.fromCn)}</code>`,
        payload.objectName ? `🏢 Obyekt: <b>${this.escape(payload.objectName)}</b>` : null,
        `💰 Summa: <b>${fmt(payload.amount)}</b>`,
        ``,
        `📥 Maqsadli (${payload.destinations.length}):`,
        destText,
        ``,
        `👤 ${this.escape(actor)}`,
        `🕒 ${date}`,
        `🆔 <code>${this.escape(payload.groupId)}</code>`,
      ].filter(Boolean).join('\n');

      const hasFile = !!(payload.filePath || payload.fileBuffer);
      if (hasFile) {
        const isImage = (payload.fileMime || '').startsWith('image/');
        const endpoint = isImage ? 'sendPhoto' : 'sendDocument';
        const fileField = isImage ? 'photo' : 'document';

        const fsMod = await import('fs');
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('chat_id', this.tgChat);
        form.append('caption', caption);
        form.append('parse_mode', 'HTML');

        const fileSource = payload.fileBuffer
          ? payload.fileBuffer
          : fsMod.createReadStream(payload.filePath!);

        form.append(fileField, fileSource, {
          filename: payload.fileName,
          contentType: payload.fileMime || 'application/octet-stream',
        });

        await firstValueFrom(
          this.http.post(
            `https://api.telegram.org/bot${this.tgToken}/${endpoint}`,
            form,
            { headers: form.getHeaders(), timeout: 30000, maxBodyLength: 50 * 1024 * 1024 },
          ),
        );
        return;
      }

      await firstValueFrom(
        this.http.post(
          `https://api.telegram.org/bot${this.tgToken}/sendMessage`,
          {
            chat_id: this.tgChat,
            text: caption,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          },
          { timeout: 8000 },
        ),
      );
    } catch (e: any) {
      this.log.warn(`Perereboska Telegram xato: ${e?.message}`);
    }
  }

  private escape(s: string | null | undefined): string {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ════════════════════════════════════════════════════════════════════
  // ZIP EXPORT — Arizalar va Перереброска fayllari
  // ════════════════════════════════════════════════════════════════════

  /** archiver modulini xavfsiz yuklash (paket yo'q bo'lsa aniq xato beradi) */
  private loadArchiver(): any {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('archiver');
      return mod.default || mod;
    } catch (e: any) {
      this.log.error(`archiver moduli yuklanmadi: ${e?.message}`);
      throw new Error("archiver paketi o'rnatilmagan");
    }
  }

  /** Barcha ariza fayllarini ZIP qilib qaytarish (Stream) */
  async exportArizasZip(res: any) {
    const archiver = this.loadArchiver();
    const zip = archiver('zip', { zlib: { level: 5 } });

    zip.on('error', (err: any) => {
      this.log.error(`Arizas ZIP archive xato: ${err?.message}`);
      try { res.status(500).end(); } catch {}
    });

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="arizalar_${new Date().toISOString().slice(0, 10)}.zip"`,
    });
    zip.pipe(res);

    const arizas = await this.prisma.transactionAttachment.findMany({
      orderBy: { uploadedAt: 'desc' },
      take: 10_000,
    });

    let added = 0;
    for (const a of arizas) {
      if (!a.storagePath) continue;
      try {
        await fs.access(a.storagePath);
        const subDir = a.contractNumber ? `${a.contractNumber}/` : 'no-contract/';
        zip.file(a.storagePath, { name: `${subDir}${a.id}__${a.filename}` });
        added++;
      } catch {
        // Disk faylida yo'q — skip
      }
    }
    this.log.log(`Arizas ZIP: ${added}/${arizas.length} fayl qo'shildi`);
    // Bo'sh arxiv ham yaratiladi (foydalanuvchiga bo'sh ZIP yuboriladi)
    await zip.finalize();
  }

  /** Barcha Переброска fayllarini ZIP qilib qaytarish (Stream) */
  async exportPerereboskiZip(res: any) {
    const archiver = this.loadArchiver();
    const zip = archiver('zip', { zlib: { level: 5 } });

    zip.on('error', (err: any) => {
      this.log.error(`Perereboski ZIP archive xato: ${err?.message}`);
      try { res.status(500).end(); } catch {}
    });

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="perereboski_${new Date().toISOString().slice(0, 10)}.zip"`,
    });
    zip.pipe(res);

    // Ikkala manbadan yig'amiz — eski (OplataKv qatorlari) + yangi (PerereboskaGroup, AI перебросkалар
    // shu jadvalда). groupId bo'yicha dedup — bir fayl 2 marta qo'shilmasin.
    const byGroup = new Map<string, { filePath: string; fileName: string; contractNo: string }>();

    const groups = await this.prisma.perereboskaGroup.findMany({
      where: { status: 'active', filePath: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    for (const g of groups) {
      if (g.filePath) byGroup.set(g.id, { filePath: g.filePath, fileName: g.fileName || 'file', contractNo: g.fromContractNo || '' });
    }

    const sources = await this.prisma.oplataKv.findMany({
      where: { perereboskaFilePath: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    for (const s of sources) {
      const key = s.perereboskaGroupId || s.id;
      if (byGroup.has(key)) continue; // allaqachon group'dan olingan
      if (s.perereboskaFilePath) byGroup.set(key, { filePath: s.perereboskaFilePath, fileName: s.perereboskaFileName || 'file', contractNo: s.contractNo || '' });
    }

    let added = 0, missing = 0;
    const missingSamples: string[] = [];
    for (const [gid, info] of byGroup) {
      if (!info.filePath) continue;
      let exists = false;
      try { await fs.access(info.filePath); exists = true; } catch {}
      if (exists) {
        const subDir = info.contractNo ? `${info.contractNo}/` : 'no-contract/';
        zip.file(info.filePath, { name: `${subDir}${gid}__${info.fileName}` });
        added++;
      } else {
        missing++;
        if (missingSamples.length < 25) missingSamples.push(`${gid} -> ${info.filePath}`);
      }
    }

    // Diagnostika manifesti — ZIP ichiga _manifest.txt qo'shamiz (nima topilgani/qo'shilgani/yo'qligi)
    const manifest = [
      `Perereboska ZIP — ${new Date().toISOString()}`,
      ``,
      `PerereboskaGroup (status=active, filePath bor): ${groups.length}`,
      `OplataKv qatorlari (perereboskaFilePath bor): ${sources.length}`,
      `Jami noyob (dedup groupId): ${byGroup.size}`,
      `Qo'shildi (fayl diskda BOR): ${added}`,
      `Diskda YO'Q (skip qilindi): ${missing}`,
      `uploadsDir: ${this.uploadsDir}`,
    ];
    if (missingSamples.length) manifest.push(``, `Diskda topilmagan fayllar (namuna):`, ...missingSamples);
    zip.append(manifest.join('\n'), { name: '_manifest.txt' });

    this.log.log(`Perereboska ZIP: ${added}/${byGroup.size} qo'shildi, ${missing} yo'q`);
    await zip.finalize();
  }
}
