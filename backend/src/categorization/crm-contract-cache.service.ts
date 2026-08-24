import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { contractVariants } from './contract-parser';

/**
 * CRM shartnomalari uchun lokal kesh.
 *
 * Maqsad: har tranzaksiyada XonSaroy CRM'ga so'rov yubormaslik.
 *
 * Ish jarayoni:
 *   1) lookup(number) chaqiriladi
 *   2) Avval `crm_contracts` jadvalida bormi (variantlar bilan)
 *      - Bor va so'nggi 24 soat ichida tekshirilgan → keshdan qaytaramiz
 *      - Bor lekin eskirgan → fonda yangilash (lekin keshni qaytaramiz, kutib o'tirmaymiz)
 *      - Yo'q → CRM'ga so'rov
 *   3) CRM javobi keladi → keshga yoziladi
 *   4) CRM'da topilmasa ham keshda `found=false` qatori qoladi (qayta-qayta urinmaslik uchun)
 */

export interface CachedContract {
  contractNumber: string;
  customerName: string | null;
  status: string | null;
  objectName: string | null;
  apartmentNumber: string | null;
  phone: string | null;
  found: boolean;
  lastVerifiedAt: Date;
}

export interface ReverifyStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  done: number;
  fixed: number;      // CRM'да topildi → found=true bo'ldi
  notFound: number;   // CRM'да yo'q (haqiqatan topilmadi)
  errors: number;     // CRM API xatosi (timeout va h.k.)
  fixedSamples: { contract: string; from?: string | null; client: string | null; object: string | null; status: string | null }[];
  notFoundSamples: { contract: string; reason: string }[];
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 soat
// Avval 7 kun edi — juda uzoq. Endi 4 soatda bir marta XATO shartnomalar
// qayta CRM ga tekshiriladi (CRM ma'lumotlari tezroq sinxronlanadi).
const NOT_FOUND_RETRY_AFTER_MS = 4 * 60 * 60 * 1000; // 4 soat

@Injectable()
export class CrmContractCacheService {
  private readonly log = new Logger(CrmContractCacheService.name);

  // Bir vaqtda bir xil shartnomaga ikkita parallel so'rov ketmasligi uchun in-flight map
  private inflight = new Map<string, Promise<CachedContract | null>>();

  constructor(private prisma: PrismaService, private crm: CrmService) {}

  // ─── Backfill: turi (property_type) + sotuv bo'limi (branch_name) — konvergent, tugagach bo'sh yuradi ───
  private crmMetaBackfillRunning = false;

  @Cron(CronExpression.EVERY_MINUTE)
  async crmMetaBackfillTick() {
    if (this.crmMetaBackfillRunning) return;
    this.crmMetaBackfillRunning = true;
    try {
      await this.runMetaBackfill(200); // cron: 2 sahifa/tsikl (200 shartnoma, bulk)
    } catch (e: any) {
      this.log.warn(`crmMetaBackfillTick xato: ${e?.message}`);
    } finally {
      this.crmMetaBackfillRunning = false;
    }
  }

  // /index sahifa kursori (bulk branch backfill) — restartda 1'dan boshlanadi (idempotent).
  private branchPage = 1;
  private branchTotalPage = 0;
  // Recency (ko'rinadigan qatorlar avval) kursori — oplata_kv eng so'nggi shartnomalari.
  private branchRecencyOffset = 0;
  // Poisoned ('' — bo'sh) branch'larni bir marta NULL'ga qaytarish (process boshida).
  private branchResetDone = false;

  /**
   * SOTUV BO'LIMI (branch_name)ni to'ldiradi. Ikki manba:
   *   (1) RECENCY — oplata_kv eng SO'NGGI to'lovlar shartnomalari AVVAL (foydalanuvchi
   *       KO'RADIGAN qatorlar tez to'lsin), har birini /index contract-filter (getContractMeta —
   *       created_by.branch.name ISHONCHLI qaytaradi) bilan aniqlab updateMany. Turi bilan bir xil
   *       recency yondashuvi (avval turi /show sweep bilan tuzatilgandi, sotuv bo'limi qolib ketgandi).
   *   (2) BULK page-walk — CRM /index sahifasidan 100 tadan, umumiy qamrov uchun.
   *
   * ⚠️ MUHIM: bulk /index ba'zan created_by.branch BERMAYDI (list ko'rinishi relation'ni
   * eager-load qilmaydi) → branchName='' keladi. Bunda '' YOZMAYMIZ (avval yozilardi →
   * NULL bo'lmagani uchun boshqa qayta to'lmasdi = qulflanib qolardi). Faqat REAL (bo'sh
   * bo'lmagan) qiymat yoziladi; '' bo'lsa NULL qoldiriladi (keyingi tsikl yoki recency to'ldiradi).
   * Turi endi /show type.key orqali (bu yerda emas).
   * @param branchLimit ~ nechta shartnoma (100 ga bo'linadi → bulk sahifa soni).
   */
  async runMetaBackfill(branchLimit: number): Promise<{ typeFilled: number; branchFilled: number; branchRemaining: number; typeRemaining: number }> {
    let branchFilled = 0;
    // (0) Bir marta: eski poisoned ('' bo'sh) sotuv bo'limlarini NULL'ga qaytarish — qayta to'lsin.
    branchFilled += await this.resetPoisonedBranches();
    // (1) RECENCY — ko'rinadigan (so'nggi) shartnomalar avval, ISHONCHLI /index contract-filter.
    const recFilled = await this.backfillBranchRecency(Math.min(120, Math.max(40, Math.round(branchLimit / 8))));
    branchFilled += recFilled;
    // (2) BULK page-walk — umumiy qamrov. FAQAT bo'sh bo'lmagan branch yoziladi ('' YOZILMAYDI).
    const pages = Math.max(1, Math.round(branchLimit / 100));
    for (let p = 0; p < pages; p++) {
      const res = await this.crm.listContractBranchesPage(this.branchPage, 100);
      if (!res.ok) break;
      if (res.totalPage) this.branchTotalPage = res.totalPage;
      const byBranch = new Map<string, string[]>();
      for (const it of res.items) {
        if (!it.branchName) continue; // '' — CRM bermadi → NULL qoldiramiz (qulflab qo'ymaymiz)
        const key = it.contract.toUpperCase().slice(0, 128);
        const b = byBranch.get(it.branchName) || []; b.push(key); byBranch.set(it.branchName, b);
      }
      for (const [branch, keys] of byBranch) {
        const r = await this.prisma.crmContract.updateMany({
          where: { contractNumber: { in: keys }, branchName: null },
          data: { branchName: branch },
        });
        branchFilled += r.count;
      }
      this.branchPage++;
      if (this.branchTotalPage && this.branchPage > this.branchTotalPage) { this.branchPage = 1; break; } // aylanib chiqdi
    }
    const branchRemaining = await this.prisma.crmContract.count({
      where: { found: true, OR: [{ branchName: null }, { branchName: '' }] },
    });
    if (branchFilled) {
      this.log.log(`crmMetaBackfill: sotuv bo'limi ${branchFilled} to'ldirildi (recency ${recFilled}; ${branchRemaining} qoldi, page=${this.branchPage})`);
    }
    // TURI — /show type.key orqali (ishonchli manba). branchLimit ga mutanosib porsiya.
    const typeRes = await this.backfillPropertyTypeViaShow(Math.min(250, Math.max(100, Math.round(branchLimit / 4))));
    return { typeFilled: typeRes.filled, branchFilled, branchRemaining, typeRemaining: typeRes.remaining };
  }

  /**
   * Eski poisoned sotuv bo'limlari — branchName='' (bo'sh) bo'lganlarni NULL'ga qaytaradi,
   * shunda backfill ularni qayta to'ldiradi. Process boshida BIR marta (biz endi '' yozmaymiz,
   * shu bois bir marta tozalash yetarli).
   */
  private async resetPoisonedBranches(): Promise<number> {
    if (this.branchResetDone) return 0;
    this.branchResetDone = true;
    try {
      const r = await this.prisma.crmContract.updateMany({
        where: { found: true, branchName: '' },
        data: { branchName: null },
      });
      if (r.count) this.log.log(`crmMetaBackfill: ${r.count} bo'sh ('') sotuv bo'limi NULL'ga qaytarildi (qayta to'ldiriladi)`);
      return 0; // reset'ni "to'ldirildi" deb hisoblamaymiz (haqiqiy to'ldirish keyin bo'ladi)
    } catch (e: any) {
      this.log.warn(`resetPoisonedBranches xato: ${e?.message}`);
      return 0;
    }
  }

  /**
   * RECENCY sotuv bo'limi — oplata_kv eng so'nggi to'lovlar shartnomalaridan boshlab,
   * branch'i hali yo'q (NULL yoki '') bo'lganlarni /index contract-filter (getContractMeta —
   * created_by.branch.name ISHONCHLI) bilan aniqlab to'ldiradi. Ko'rinadigan qatorlar avval.
   */
  private async backfillBranchRecency(limit: number): Promise<number> {
    const grp = await this.prisma.oplataKv.groupBy({
      by: ['contractNo'],
      _max: { date: true },
      orderBy: { _max: { date: 'desc' } },
      take: limit,
      skip: this.branchRecencyOffset,
    });
    const nos = Array.from(new Set(
      grp.map((g) => (g.contractNo || '').replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').toUpperCase()).filter(Boolean),
    ));
    if (!nos.length) { this.branchRecencyOffset = 0; return 0; } // aylanib chiqdi — boshiga
    // Faqat branch KERAKLI (found=true + NULL yoki '') shartnomalar — CRM yukini kamaytiradi.
    const need = await this.prisma.crmContract.findMany({
      where: { contractNumber: { in: nos }, found: true, OR: [{ branchName: null }, { branchName: '' }] },
      select: { contractNumber: true },
    });
    const filled = await this.applyIndexBranches(need.map((n) => n.contractNumber));
    this.branchRecencyOffset += limit;
    return filled;
  }

  /**
   * Berilgan shartnomalarni /index (getContractMeta) orqali (parallel 8) tekshirib,
   * created_by.branch.name bo'yicha guruhlab updateMany. FAQAT REAL (bo'sh bo'lmagan) branch yoziladi.
   */
  private async applyIndexBranches(keys: string[]): Promise<number> {
    if (!keys.length) return 0;
    const CONC = 8;
    const byBranch = new Map<string, string[]>();
    let idx = 0;
    const worker = async () => {
      while (idx < keys.length) {
        const k = keys[idx++];
        try {
          const meta: any = await this.crm.getContractMeta(k);
          const b = meta?.ok && meta?.found && meta?.branchName ? String(meta.branchName).slice(0, 255) : '';
          if (b) { const a = byBranch.get(b) || []; a.push(k); byBranch.set(b, a); }
        } catch { /* skip — keyingi tsiklda qayta uriladi */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, keys.length) }, () => worker()));
    let filled = 0;
    for (const [b, ks] of byBranch) {
      const r = await this.prisma.crmContract.updateMany({
        where: { contractNumber: { in: ks } },
        data: { branchName: b },
      });
      filled += r.count;
    }
    return filled;
  }

  // ─── TURI (property_type) backfill — CRM /show `type.key` orqali (yagona ishonchli manba) ───
  // /index turi bermaydi/ishonchsiz. Shu bois har shartnomani /show bilan tekshiramiz.
  // 2 fazali: (1) BARCHA found=true bo'ylab kursor-sweep — real type.key bilan OVERWRITE
  // (eski obyekt-nomli TAXMINlar tuzatiladi); sweep tugagach marker qo'yiladi (restartda takror emas).
  // (2) marker bor bo'lsa — faqat propertyType=NULL qatorlar (yangi fallback qatorlari) to'ldiriladi.
  private ptOffset = 0;
  private ptTotalDistinct = 0;
  private ptSweepDone = false;
  private static readonly PT_MARKER = '__PT_SWEEP_DONE_V1__';

  async backfillPropertyTypeViaShow(limit: number): Promise<{ filled: number; remaining: number }> {
    // Faza 2: to'liq sweep tugagan — faqat NULL qatorlar (yangi fallback qatorlari)
    if (this.ptSweepDone || (await this.isPtSweepDone())) {
      this.ptSweepDone = true;
      return this.fillNullPropertyTypes(limit);
    }
    // Faza 1: oplata_kv'da eng SO'NGGI to'lovlar shartnomalaridan boshlab (foydalanuvchi
    // KO'RADIGAN qatorlar AVVAL to'g'rilanadi) — /show type.key bilan OVERWRITE.
    const grp = await this.prisma.oplataKv.groupBy({
      by: ['contractNo'],
      _max: { date: true },
      orderBy: { _max: { date: 'desc' } },
      take: limit,
      skip: this.ptOffset,
    });
    const contractNos = Array.from(new Set(
      grp.map((g) => (g.contractNo || '').replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').toUpperCase()).filter(Boolean),
    ));
    if (!contractNos.length) {
      await this.markPtSweepDone();
      this.ptSweepDone = true;
      this.log.log('crmMetaBackfill: turi to\'liq sweep tugadi (barcha shartnoma /show type.key bilan tekshirildi)');
      return { filled: 0, remaining: 0 };
    }
    // Faqat SHUBHALI larni /show qilamiz: found=true + (null yoki 'apartment').
    // 'parking' allaqachon tasdiqlangan — qayta so'ramaymiz (CRM yukini kamaytiradi).
    const need = await this.prisma.crmContract.findMany({
      where: {
        contractNumber: { in: contractNos },
        found: true,
        OR: [{ propertyType: null }, { propertyType: 'apartment' }],
      },
      select: { contractNumber: true },
    });
    const filled = await this.applyShowTypes(need.map((n) => n.contractNumber));
    this.ptOffset += limit;
    if (!this.ptTotalDistinct) {
      try {
        const c: any = await this.prisma.$queryRaw`SELECT COUNT(DISTINCT contract_no)::int AS n FROM oplata_kv`;
        this.ptTotalDistinct = Number(c?.[0]?.n || 0);
      } catch { /* ignore — remaining taxminiy */ }
    }
    const remaining = Math.max(0, this.ptTotalDistinct - this.ptOffset);
    if (filled) this.log.log(`crmMetaBackfill: turi ${filled} tuzatildi (~${remaining} shartnoma qoldi, recency sweep)`);
    return { filled, remaining };
  }

  /** propertyType=NULL qatorlarni /show type.key bilan to'ldiradi (Faza 2). */
  private async fillNullPropertyTypes(limit: number): Promise<{ filled: number; remaining: number }> {
    const batch = await this.prisma.crmContract.findMany({
      where: { found: true, propertyType: null },
      orderBy: { lastVerifiedAt: 'asc' },
      take: limit,
      select: { contractNumber: true },
    });
    if (!batch.length) return { filled: 0, remaining: 0 };
    const filled = await this.applyShowTypes(batch.map((b) => b.contractNumber));
    const remaining = await this.prisma.crmContract.count({ where: { found: true, propertyType: null } });
    return { filled, remaining };
  }

  /** Berilgan shartnomalarni /show orqali (parallel 6) tekshirib, type.key bo'yicha guruhlab updateMany. */
  private async applyShowTypes(keys: string[]): Promise<number> {
    const CONC = 8;
    const byType = new Map<'parking' | 'apartment', string[]>();
    let idx = 0;
    const worker = async () => {
      while (idx < keys.length) {
        const k = keys[idx++];
        try {
          const r: any = await this.crm.show({ contract: k });
          const pt = r?.ok ? crmTypeKey(r.detail) : null;
          if (pt) { const a = byType.get(pt) || []; a.push(k); byType.set(pt, a); }
        } catch { /* skip — keyingi tsiklda qayta uriladi */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, keys.length) }, () => worker()));
    let filled = 0;
    for (const [pt, ks] of byType) {
      const r = await this.prisma.crmContract.updateMany({
        where: { contractNumber: { in: ks } },
        data: { propertyType: pt },
      });
      filled += r.count;
    }
    return filled;
  }

  private async isPtSweepDone(): Promise<boolean> {
    const m = await this.prisma.crmContract
      .findUnique({ where: { contractNumber: CrmContractCacheService.PT_MARKER } })
      .catch(() => null);
    return !!m;
  }

  private async markPtSweepDone(): Promise<void> {
    await this.prisma.crmContract
      .upsert({
        where: { contractNumber: CrmContractCacheService.PT_MARKER },
        create: { contractNumber: CrmContractCacheService.PT_MARKER, found: false, propertyType: null },
        update: {},
      })
      .catch(() => { /* ignore */ });
  }

  /**
   * Shartnoma raqami bo'yicha kesh + CRM lookup.
   * O/0 variantlarini ham tekshiradi.
   *
   * @param opts.forceRefresh — true bo'lsa cache o'chiriladi va fresh CRM lookup qilinadi
   */
  async lookup(
    contractNumber: string,
    opts?: { forceRefresh?: boolean; payerHint?: string },
  ): Promise<CachedContract | null> {
    if (!contractNumber) return null;
    // № va N° simbollarini olib tashlaymiz + bo'shliqlarni tozalaymiz
    const key = contractNumber
      .replace(/№/g, '')
      .replace(/N°/g, '')
      .replace(/\s+/g, '')
      .trim()
      .toUpperCase();
    if (!key) return null;

    if (opts?.forceRefresh) {
      // Cache o'chiramiz — fresh lookup
      const variants = contractVariants(key).slice(0, 16);
      await this.prisma.crmContract.deleteMany({
        where: { contractNumber: { in: variants } },
      });
    }

    // Parallel chaqiruvlarni birlashtirish (number bo'yicha kesh)
    let cached: CachedContract | null;
    const existing = this.inflight.get(key);
    if (existing) {
      cached = await existing;
    } else {
      const promise = this.doLookup(key, opts?.payerHint).finally(() => this.inflight.delete(key));
      this.inflight.set(key, promise);
      cached = await promise;
    }

    // ── DUBLIKAT: kesh mijozi izoh (payerHint) ichidagi ismга mos kelmasa —
    // bir raqamда bir necha shartnoma bo'lishi mumkin. payer bo'yicha to'g'risini
    // qayta hal qilamiz (faqat payerHint berilганда — categorization). Fresh fetch
    // pickContractByName orqali izohdagi ismга mos shartnomani tanlaydi.
    if (opts?.payerHint && cached?.found && !this.crm.matchesPayer(cached.customerName, opts.payerHint)) {
      try {
        const specific = await this.fetchFromCrmAndCache(key, opts.payerHint);
        if (specific?.found) return specific;
      } catch { /* ignore — kesh qaytadi */ }
    }
    return cached;
  }

  private async doLookup(key: string, payerHint?: string): Promise<CachedContract | null> {
    // 1) Keshda bormi — variantlar bilan
    const variants = contractVariants(key).slice(0, 16); // xavfsizlik chegarasi
    const cached = await this.prisma.crmContract.findFirst({
      where: { contractNumber: { in: variants } },
      // FIX (B#9): found=true'ni prioritetlashtir — bir kalitga found=false + found=true
      // qatorlar bo'lsa, tasdiqlangani tanlanadi (CRM'da bor shartnoma XATO'да qotmasin).
      orderBy: [{ found: 'desc' }, { lastVerifiedAt: 'desc' }],
    });

    if (cached) {
      const age = Date.now() - cached.lastVerifiedAt.getTime();
      const stale = cached.found ? age > STALE_AFTER_MS : age > NOT_FOUND_RETRY_AFTER_MS;

      if (!stale) {
        // crm_status hali tekshirilmagan (eski, feature'dan oldingi qator) — fonda
        // bir marta yangilaymiz. Tekshirilgach virtualStatus '' yoki qiymat bo'ladi
        // (null EMAS), shu bois takror so'ralmaydi.
        if (cached.found && cached.virtualStatus == null) {
          this.refreshVirtualStatus(cached.contractNumber).catch(() => { /* ignore */ });
        }
        return toCached(cached);
      }
      // Eskirgan + found=false → SINXRON yangilab ko'ramiz (CRM ma'lumoti yangilangan bo'lishi mumkin)
      // Eskirgan + found=true → fonda yangilab keshdan qaytaramiz (tez)
      if (!cached.found) {
        // Cache o'chiramiz va yangidan CRM ga so'raymiz
        await this.prisma.crmContract.deleteMany({ where: { contractNumber: { in: variants } } });
        return this.fetchFromCrmAndCache(key, payerHint);
      }
      this.refreshInBackground(cached.contractNumber).catch(() => { /* ignore */ });
      return toCached(cached);
    }

    // 2) Yangi — CRM'ga so'rov yuboramiz (har bir variantni ketma-ket)
    return this.fetchFromCrmAndCache(key, payerHint);
  }

  private async fetchFromCrmAndCache(key: string, payerHint?: string): Promise<CachedContract | null> {
    const variants = contractVariants(key).slice(0, 8);
    for (const v of variants) {
      try {
        const res = await this.crm.show({ contract: v, payerHint });
        const detail: any = (res as any)?.detail;
        if ((res as any)?.ok && detail) {
          // XonSaroy client object'dan F.I.O. yig'ish (last + first + middle)
          // Strukturalar: c.first_name, c.attributes.first_name, c.client.attributes.first_name
          const buildName = (c: any): string | null => {
            if (!c) return null;
            if (typeof c === 'string') return c.trim() || null;
            const f = (v: any): string => {
              if (!v) return '';
              if (typeof v === 'string') return v;
              return v.lotin || v.kirill || v.uz || v.ru || '';
            };
            // Avval c.attributes da qarash (XonSaroy v4 strukturasi)
            const src = c.attributes && (c.attributes.first_name || c.attributes.last_name)
              ? c.attributes
              : c;
            const name = [f(src.last_name), f(src.first_name), f(src.middle_name)].filter(Boolean).join(' ').trim();
            if (name) return name;
            return src.full_name_lotin || src.full_name_kirill || src.full_name || src.name || src.fio || null;
          };
          // Xavfsiz qisqartirish — DB VarChar cheklovlariga sig'sin
          const trunc = (s: any, max: number): string | null => {
            if (s == null) return null;
            const str = String(s);
            return str.length > max ? str.slice(0, max) : str;
          };
          // client_full_name — /index item shakli (payerHint/dublikat yo'lidan kelganда)
          const customerName = buildName(detail.client) || detail.client_full_name || detail.fio || null; // Text — limit yo'q
          // Status XonSaroy da OBJECT bo'lishi mumkin: { type: 'cancelled', name: {uz, ru}, color }
          // type ni asosiy hisoblaymiz (cancelled, active, etc) — string bo'lsa o'zini ishlatamiz
          const extractStatus = (s: any): string | null => {
            if (!s) return null;
            if (typeof s === 'string') return s.toLowerCase() || null;
            if (typeof s === 'object') {
              const t = s.type || s.key || s.value?.type || s.name?.uz || s.name?.ru || s.name;
              if (typeof t === 'string') return t.toLowerCase();
              if (typeof t === 'object') return (t.uz || t.ru || '').toLowerCase() || null;
            }
            return null;
          };
          // deleted_at to'ldirilgan bo'lsa — bekor qilingan deb hisoblaymiz
          const statusRaw = extractStatus(detail.status || detail.contract_status);
          const status = trunc(detail.deleted_at && !statusRaw ? 'cancelled' : statusRaw, 128);
          // Obyekt nomi — CRM bir necha joyda saqlashi mumkin
          const extractObject = (d: any): string | null => {
            // XonSaroy v4 deep struktura: order_apartments[0].apartment.block.building.object.name
            const deep = d?.order_apartments?.[0]?.apartment?.block?.building?.object?.name;
            const candidates = [
              d?.object_name,
              d?.object,
              d?.info?.object,
              d?.info?.object_name,
              d?.client?.object_name,
              d?.client?.object,
              deep,
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
          const objectName = trunc(extractObject(detail), 255);
          const apartmentNumber = trunc(detail.apartment_number || detail.client?.apartment_number || null, 64);
          const phone = trunc(detail.client?.phone_primary || detail.client?.phone || null, 64);
          // CRM order/shartnoma ID — API'da order_id sifatida chiqadi
          const crmOrderId = trunc(
            detail.id != null ? String(detail.id) : (detail.order_id != null ? String(detail.order_id) : null),
            64,
          );
          // virtual_status (Бартер, Ипотека, Наличные...) — CRM'dan.
          // Topilmasa '' (null EMAS) — "tekshirildi" belgisi, qayta-qayta so'ramaymiz.
          //   null  = hali CRM'dan tekshirilmagan (eski qator) → backfill/lookup uni yangilaydi.
          const virtualStatus = extractVirtualStatus(detail);
          const contractKey = trunc(v.toUpperCase(), 128) as string;

          const saved = await this.prisma.crmContract.upsert({
            where: { contractNumber: contractKey },
            create: {
              contractNumber: contractKey,
              customerName, status, virtualStatus, objectName, apartmentNumber, phone, crmOrderId,
              propertyType: crmTypeKey(detail), // FAQAT CRM /show type.key (ishonchli). Yo'q bo'lsa null — obyekt nomidan TAXMIN QILMAYMIZ (parking → жилой chiqarardi)
              rawSnapshot: pickSnapshot(detail),
              found: true,
            },
            update: {
              customerName, status, virtualStatus, objectName, apartmentNumber, phone, crmOrderId,
              propertyType: crmTypeKey(detail), // FAQAT CRM /show type.key (ishonchli); null bo'lsa /show-backfill qayta uriadi
              rawSnapshot: pickSnapshot(detail),
              found: true,
              lastVerifiedAt: new Date(),
              lastError: null,
            },
          });
          return toCached(saved);
        }
      } catch (e: any) {
        this.log.warn(`CRM lookup xato (${v}): ${e?.message}`);
      }
    }

    // ── FALLBACK: /show topa olmadi — searchContracts (/index, qo'lда qidiruv
    // ISHLAYDIGAN yo'l) bilan urinamiz. CRM'да bor lekin /show bermagan contractlar
    // uchun (avto vs qo'lда parity kafolati). Foydalanuvchi qo'lда topa olsa — avto ham topsin.
    const scNorm = (s: any) => String(s || '').replace(/[\s\-_./]/g, '').toUpperCase();
    for (const v of contractVariants(key).slice(0, 4)) {
      try {
        const sc: any = await this.crm.searchContracts(v, 20);
        const items: any[] = sc?.items || [];
        if (!items.length) continue;
        const targ = scNorm(v);
        const hit = items.find((it) => scNorm(it.contract) === targ);
        if (hit) {
          const contractKey = String(hit.contract || v).toUpperCase().slice(0, 128);
          const saved = await this.prisma.crmContract.upsert({
            where: { contractNumber: contractKey },
            create: {
              contractNumber: contractKey,
              customerName: hit.clientFullName || null,
              status: hit.status ? String(hit.status).toLowerCase().slice(0, 128) : null,
              // /index virtual_status bermaydi → '' (tekshirildi belgisi; qayta so'ramaymiz)
              virtualStatus: '',
              objectName: hit.object ? String(hit.object).slice(0, 255) : null,
              apartmentNumber: hit.apartmentNumber ? String(hit.apartmentNumber).slice(0, 64) : null,
              crmOrderId: hit.id != null ? String(hit.id).slice(0, 64) : null,
              // /index sotuv bo'limini beradi (created_by.branch.name); yo'q bo'lsa NULL
              // ('' YOZMAYMIZ — NULL bo'lmasa backfill qayta to'ldirmaydi = qulflanib qolardi)
              branchName: hit.branchName ? String(hit.branchName).slice(0, 255) : null,
              propertyType: null, // /index ishonchli type bermaydi → null; /show-backfill to'ldiradi
              found: true,
            },
            update: {
              customerName: hit.clientFullName || null,
              status: hit.status ? String(hit.status).toLowerCase().slice(0, 128) : null,
              objectName: hit.object ? String(hit.object).slice(0, 255) : null,
              apartmentNumber: hit.apartmentNumber ? String(hit.apartmentNumber).slice(0, 64) : null,
              crmOrderId: hit.id != null ? String(hit.id).slice(0, 64) : null,
              // FAQAT REAL branch bo'lsa yozamiz; yo'q bo'lsa undefined (Prisma: TEGMAYDI) —
              // oldingi /index'dan kelgan haqiqiy sotuv bo'limini '' bilan buzib qo'ymaymiz
              branchName: hit.branchName ? String(hit.branchName).slice(0, 255) : undefined,
              // propertyType TEGILMAYDI — oldingi /show'dan kelgan ishonchli qiymatni buzmaslik uchun
              found: true,
              lastVerifiedAt: new Date(),
              lastError: null,
            },
          });
          this.log.log(`CRM searchContracts fallback topdi: ${contractKey} (klient: ${hit.clientFullName || '-'})`);
          return toCached(saved);
        }
      } catch (e: any) {
        this.log.warn(`searchContracts fallback xato (${v}): ${e?.message}`);
      }
    }

    // CRM'da topilmadi — keshga "found=false" yozib qo'yamiz, qayta urinmaymiz (NOT_FOUND_RETRY_AFTER_MS davomida)
    const safeKey = key.length > 128 ? key.slice(0, 128) : key;
    const saved = await this.prisma.crmContract.upsert({
      where: { contractNumber: safeKey },
      create: {
        contractNumber: safeKey,
        found: false,
        lastError: 'Topilmadi',
      },
      update: {
        found: false,
        lastVerifiedAt: new Date(),
        lastError: 'Topilmadi',
      },
    });
    return toCached(saved);
  }

  private async refreshInBackground(contractNumber: string): Promise<void> {
    try {
      await this.fetchFromCrmAndCache(contractNumber);
    } catch {
      // ignore — log allaqachon yozilgan
    }
  }

  /**
   * crm_status backfill uchun — FAQAT virtual_status'ni CRM'dan yangilaydi (awaitable).
   * fetchFromCrmAndCache'dan farqi: CRM javob bermasa found=true qatorni BUZMAYDI
   * (found=false qilmaydi) va NULL'ni O'ZGARTIRMAYDI — keyingi tsiklда qayta urinadi.
   *   - /show muvaffaqiyatli → haqiqiy qiymat, yoki '' (CRM'да virtual_status yo'q)
   *   - /show umuman javob bermadi → NULL qoladi (retry) — noto'g'ri '' YOZMAYMIZ
   * @returns true — /show javob berdi (yozildi); false — CRM javob bermadi (NULL qoldi)
   */
  async refreshVirtualStatus(contractNumber: string): Promise<boolean> {
    const key = String(contractNumber || '')
      .replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').trim().toUpperCase();
    if (!key) return false;
    const variants = contractVariants(key).slice(0, 4);
    let ok = false;
    let vs = '';
    for (const v of variants) {
      try {
        const res: any = await this.crm.show({ contract: v });
        const detail: any = res?.detail;
        if (res?.ok && detail) { vs = extractVirtualStatus(detail); ok = true; break; }
      } catch { /* keyingi variant */ }
    }
    if (!ok) return false; // CRM javob bermadi — NULL qoldiramiz, backfill qayta urinadi
    try {
      await this.prisma.crmContract.updateMany({
        where: { contractNumber: { in: contractVariants(key).slice(0, 8) }, found: true },
        data: { virtualStatus: vs },
      });
    } catch { /* ignore */ }
    return true;
  }

  /**
   * DIAGNOSTIKA — bir nechta shartnoma uchun keshdagi virtual_status + JONLI /show
   * javobidagi xom virtual_status'ni qaytaradi. Nega bo'sh ko'rinayotganini aniqlash uchun.
   */
  async diagVirtualStatus(contractNumbers: string[]): Promise<any[]> {
    const out: any[] = [];
    for (const cn of contractNumbers.slice(0, 15)) {
      const key = String(cn || '').replace(/№/g, '').replace(/\s+/g, '').trim().toUpperCase();
      const cached = await this.prisma.crmContract.findFirst({
        where: { contractNumber: { in: contractVariants(key).slice(0, 8) } },
        select: { contractNumber: true, found: true, virtualStatus: true, lastVerifiedAt: true },
      });
      let live: any = { ok: false };
      for (const v of contractVariants(key).slice(0, 4)) {
        try {
          const res: any = await this.crm.show({ contract: v });
          if (res?.ok && res?.detail) {
            live = {
              ok: true, triedVariant: v,
              rawVirtualStatus: res.detail.virtual_status ?? null,
              extracted: extractVirtualStatus(res.detail),
            };
            break;
          }
        } catch (e: any) { live = { ok: false, error: e?.message }; }
      }
      out.push({
        input: cn,
        cached: cached
          ? { contractNumber: cached.contractNumber, found: cached.found,
              virtualStatus: cached.virtualStatus,
              vsState: cached.virtualStatus == null ? 'NULL' : (cached.virtualStatus === '' ? 'EMPTY' : 'VALUE'),
              lastVerifiedAt: cached.lastVerifiedAt }
          : null,
        live,
      });
    }
    return out;
  }

  /**
   * '' (EMPTY) belgili virtual_status'ni NULL'ga qaytaradi — backfill qayta tekshirsin.
   * FAQAT rawSnapshot bor (/show'dan kelgan) qatorlar — fallback (rawSnapshot yo'q)
   * shartnomalar tegilmaydi (ular /show bermaydi, abadiy retry bo'lib qolmasin).
   */
  async resetEmptyVirtualStatus(): Promise<{ reset: number }> {
    const r = await this.prisma.crmContract.updateMany({
      where: { found: true, virtualStatus: '', rawSnapshot: { not: Prisma.DbNull } },
      data: { virtualStatus: null },
    });
    return { reset: r.count };
  }

  /**
   * Allaqachon saqlangan virtual_status qiymatlaridagi mojibake'ni joyida tuzatadi
   * (CRM'ga urilmasdan). Faqat repair natijasi o'zgargan qatorlar yangilanadi.
   */
  async repairExistingVirtualStatuses(): Promise<{ scanned: number; repaired: number }> {
    const rows = await this.prisma.crmContract.findMany({
      where: { found: true, virtualStatus: { not: null } },
      select: { contractNumber: true, virtualStatus: true },
    });
    let repaired = 0;
    for (const r of rows) {
      const cur = r.virtualStatus || '';
      if (!cur) continue;
      const fixed = repairMojibake(cur);
      if (fixed !== cur) {
        const val = fixed.length > 64 ? fixed.slice(0, 64) : fixed;
        try {
          await this.prisma.crmContract.update({
            where: { contractNumber: r.contractNumber },
            data: { virtualStatus: val },
          });
          repaired++;
        } catch { /* ignore */ }
      }
    }
    return { scanned: rows.length, repaired };
  }

  /** crm_status backfill holati — NULL/EMPTY/VALUE sonlari. */
  async virtualStatusStats(): Promise<{ found: number; nullVs: number; emptyVs: number; valueVs: number }> {
    const [found, nullVs, emptyVs] = await Promise.all([
      this.prisma.crmContract.count({ where: { found: true } }),
      this.prisma.crmContract.count({ where: { found: true, virtualStatus: null } }),
      this.prisma.crmContract.count({ where: { found: true, virtualStatus: '' } }),
    ]);
    return { found, nullVs, emptyVs, valueVs: found - nullVs - emptyVs };
  }

  // ───────────── crm_order_id backfill (mavjud shartnomalar uchun) ─────────────

  private backfillRunning = false;

  /**
   * crmOrderId bo'sh (null) bo'lgan MAVJUD topilgan shartnomalarni CRM'dan qayta
   * olib order_id bilan to'ldiradi. Fonda ishlaydi (konkurentlik cheklangan).
   * FAQAT crmOrderId yangilanadi — found/nom/obyekt tegilmaydi. XATO/topilmagan
   * (found=false) shartnomalar tegilmaydi.
   */
  async backfillOrderIds(opts: { limit?: number } = {}): Promise<{ pending: number; alreadyRunning: boolean }> {
    if (this.backfillRunning) {
      const remaining = await this.prisma.crmContract.count({ where: { found: true, crmOrderId: null } });
      return { pending: remaining, alreadyRunning: true };
    }
    const limit = Math.min(100000, Math.max(1, opts.limit ?? 50000));
    const rows = await this.prisma.crmContract.findMany({
      where: { found: true, crmOrderId: null },
      select: { contractNumber: true },
      take: limit,
    });
    const keys = rows.map((r) => r.contractNumber);
    this.backfillRunning = true;
    this.runBackfill(keys)
      .catch((e) => this.log.warn(`crmOrderId backfill xato: ${e?.message}`))
      .finally(() => { this.backfillRunning = false; });
    return { pending: keys.length, alreadyRunning: false };
  }

  private async runBackfill(keys: string[]): Promise<void> {
    const CONCURRENCY = 4;
    let idx = 0;
    let done = 0;
    let filled = 0;
    const worker = async () => {
      while (idx < keys.length) {
        const k = keys[idx++];
        try { if (await this.backfillOne(k)) filled++; } catch { /* ignore */ }
        if (++done % 200 === 0) this.log.log(`crmOrderId backfill: ${done}/${keys.length} (to'ldi: ${filled})`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    this.log.log(`crmOrderId backfill tugadi: ${keys.length} ta ko'rildi, ${filled} ta to'ldi`);
  }

  /** Bitta shartnoma — CRM'dan order id olib, faqat crmOrderId ustunini yangilaydi */
  private async backfillOne(contractNumber: string): Promise<boolean> {
    const key = (contractNumber || '').replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').trim().toUpperCase();
    if (!key) return false;
    const variants = contractVariants(key).slice(0, 8);
    for (const v of variants) {
      try {
        const res = await this.crm.show({ contract: v });
        const detail: any = (res as any)?.detail;
        const oid = detail?.id ?? detail?.order_id;
        if (detail && oid != null) {
          // FIX (B#8): crmOrderId'ni FAQAT so'ralgan qatorga yozamiz — variantlarga EMAS.
          // Variantlar (I/1, O/0) boshqa REAL shartnoma bo'lishi mumkin (118MSOP26LA vs 118MS0P26LA)
          // — ularning order_id'sini noto'g'ri ustidan yozib yubormaymiz.
          await this.prisma.crmContract.updateMany({
            where: { contractNumber },
            data: { crmOrderId: String(oid).slice(0, 64) },
          });
          return true;
        }
      } catch { /* keyingi variantni sinaymiz */ }
    }
    return false;
  }

  // ───────────── XATO (found=false) shartnomalarni qayta tekshirish ─────────────

  private readonly SAMPLE_CAP = 200;
  private reverifyStatus: ReverifyStatus = {
    running: false, startedAt: null, finishedAt: null,
    total: 0, done: 0, fixed: 0, notFound: 0, errors: 0,
    fixedSamples: [], notFoundSamples: [],
  };

  /** Oxirgi (yoki joriy) qayta tekshirish hisoboti — frontend poll qiladi. */
  getReverifyStatus(): ReverifyStatus {
    return this.reverifyStatus;
  }

  /**
   * found=false (XATO — CRM'да topilmagan deb keshlangan) shartnomalarni CRM'ga
   * QAYTA tekshiradi (forceRefresh — keshni chetlab o'tib). CRM'да endi bor bo'lganlar
   * found=true ga o'tadi va XATO ro'yxatidan AVTOMATIK chiqadi (XATO filtri found=true
   * setni jonli o'qiydi — to'lovlarni qayta kategoriyalash shart emas). Fonда ishlaydi.
   *
   * Sabab: contract keyinroq CRM'ga qo'shilган YOKI o'sha payt CRM lookup buzuq param
   * bilan topa olmaган — natijada found=false keshlangan va 4 soatgacha qotib qolган.
   *
   * Batafsil hisobot getReverifyStatus() orqali: nechta tuzatildi (kim/obyekt bilan),
   * nechta CRM'да topilmadi, nechta CRM xatosi.
   */
  /**
   * Berilgan shartnoma raqamlari ro'yxatini CRM'ga qayta tekshiradi (forceRefresh).
   * Chaqiruvchi ro'yxatni beradi — masalan FAQAT hozir XATO bo'lgan oplata_kv
   * to'lovlarining shartnomalari (butun DB'даги minglab eski found=false emas).
   * Raqamlar normalizatsiya + dedup qilinadi. Fonда ishlaydi, darhol qaytadi.
   */
  reverifyContracts(rawKeys: string[]): { pending: number; alreadyRunning: boolean } {
    if (this.reverifyStatus.running) {
      return { pending: Math.max(0, this.reverifyStatus.total - this.reverifyStatus.done), alreadyRunning: true };
    }
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const rk of rawKeys || []) {
      const k = String(rk || '').replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').trim().toUpperCase();
      if (k && !seen.has(k)) { seen.add(k); keys.push(k); }
    }
    this.reverifyStatus = {
      running: true, startedAt: new Date().toISOString(), finishedAt: null,
      total: keys.length, done: 0, fixed: 0, notFound: 0, errors: 0,
      fixedSamples: [], notFoundSamples: [],
    };
    this.runReverify(keys)
      .catch((e) => this.log.warn(`XATO reverify xato: ${e?.message}`))
      .finally(() => {
        this.reverifyStatus.running = false;
        this.reverifyStatus.finishedAt = new Date().toISOString();
      });
    return { pending: keys.length, alreadyRunning: false };
  }

  private async runReverify(keys: string[]): Promise<void> {
    const CONCURRENCY = 4;
    const st = this.reverifyStatus;
    let idx = 0;
    const worker = async () => {
      while (idx < keys.length) {
        const k = keys[idx++];
        try {
          const res = await this.lookup(k, { forceRefresh: true });
          if (res?.found) {
            st.fixed++;
            if (st.fixedSamples.length < this.SAMPLE_CAP) {
              st.fixedSamples.push({
                contract: res.contractNumber,
                client: res.customerName,
                object: res.objectName,
                status: res.status,
              });
            }
          } else {
            st.notFound++;
            if (st.notFoundSamples.length < this.SAMPLE_CAP) {
              st.notFoundSamples.push({ contract: k, reason: "CRM'да topilmadi" });
            }
          }
        } catch (e: any) {
          st.errors++;
          if (st.notFoundSamples.length < this.SAMPLE_CAP) {
            st.notFoundSamples.push({ contract: k, reason: 'CRM xatosi: ' + String(e?.message || '').slice(0, 80) });
          }
        }
        st.done++;
        if (st.done % 100 === 0) this.log.log(`XATO reverify: ${st.done}/${keys.length} (tuzatildi: ${st.fixed})`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    this.log.log(`XATO reverify tugadi: ${keys.length} ko'rildi, ${st.fixed} tuzatildi, ${st.notFound} topilmadi, ${st.errors} xato`);
  }
}

function toCached(row: any): CachedContract {
  return {
    contractNumber: row.contractNumber,
    customerName: row.customerName,
    status: row.status,
    objectName: row.objectName,
    apartmentNumber: row.apartmentNumber,
    phone: row.phone,
    found: !!row.found,
    lastVerifiedAt: row.lastVerifiedAt,
  };
}

/**
 * CRM javobining keshlanadigan qismi (juda katta JSON'ni saqlamaslik uchun).
 */
// iconv-lite (mysql2 orqali mavjud) — lazy, yo'q bo'lsa crash bo'lmasin
let _iconv: any = null;
function getIconv(): any {
  if (_iconv === null) {
    try { _iconv = require('iconv-lite'); } catch { _iconv = false; }
  }
  return _iconv || null;
}

/**
 * Mojibake tuzatish — XonSaroy CRM virtual_status yorliqlarini buzuq saqlagan:
 * "Сотилди" UTF-8 baytlari CP1251 sifatida o'qilgan → "РЎРѕС‚РёР»РґРё".
 * Teskarilash: char'larni CP1251 bayt sifatida encode → UTF-8 dekod.
 * Toza (kirill/lotin to'g'ri) matnni tegmaymiz — repair natijasi U+FFFD bersa rad etamiz.
 */
function repairMojibake(s: string): string {
  if (!s) return s;
  // Faqat yuqori (U+0080..U+04FF) belgilar bo'lsa mojibake ehtimoli bor
  let hi = false;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0x80 && c <= 0x4FF) { hi = true; break; } }
  if (!hi) return s;
  const iconv = getIconv();
  if (!iconv) return s;
  try {
    const repaired: string = iconv.decode(iconv.encode(s, 'win1251'), 'utf8');
    // U+FFFD (replacement char) bo'lsa repair noto'g'ri — asl matnni qoldiramiz
    if (repaired && repaired !== s && repaired.indexOf(String.fromCharCode(0xFFFD)) === -1) return repaired;
  } catch { /* ignore */ }
  return s;
}

/**
 * CRM detail'idan virtual_status (Бартер, Ипотека, Наличные, Сотилди...) ni ajratadi.
 * Topilmasa '' qaytaradi (null EMAS) — "tekshirildi, status yo'q" belgisi.
 * CRM yorliqlari mojibake — repairMojibake bilan tuzatiladi. VarChar(64)ga qisqartiradi.
 */
function extractVirtualStatus(detail: any): string {
  const vs = detail?.virtual_status?.value?.name || detail?.virtual_status?.name || detail?.virtual_status;
  if (!vs) return '';
  let s = typeof vs === 'object' ? (vs.ru || vs.uz || vs.uzc || null) : String(vs);
  if (!s) return '';
  s = repairMojibake(String(s));
  return s.length > 64 ? s.slice(0, 64) : s;
}

/**
 * Shartnoma turi — CRM /show javobidagi ISHONCHLI `type.key` maydonidan.
 * "parking" → parking (avtoturargoh), boshqasi → apartment (жилой/уй).
 * (Obyekt nomi kompleks nomi bo'lgani uchun ishonchsiz edi — endi CRM type.key.)
 */
export function crmTypeKey(detail: any): 'parking' | 'apartment' | null {
  const k = detail?.type?.key;
  if (!k) return null;
  return String(k).toLowerCase() === 'parking' ? 'parking' : 'apartment';
}

/** Obyekt nomidan zaxira aniqlash (type.key bo'lmaganda) — parking kalit so'zlari. */
export function derivePropertyType(objectName: string | null | undefined): string | null {
  if (!objectName) return null;
  const o = String(objectName).toUpperCase();
  if (o.includes('ПАРКОВКА') || o.includes('ПАРКИНГ') || o.includes('АВТОСТОЯН') || o.includes('АВТОТУРАРГ') || o.includes('PARKING')) return 'parking';
  return 'apartment';
}

function pickSnapshot(detail: any): any {
  if (!detail) return null;
  return {
    id: detail.id ?? detail.order_id ?? null,
    contract: detail.contract,
    status: detail.status,
    virtual_status: detail.virtual_status ?? null,
    total_amount: detail.total_amount,
    object_name: detail.object_name,
    apartment_number: detail.apartment_number,
    client: detail.client ? {
      full_name_lotin: detail.client.full_name_lotin,
      full_name_kirill: detail.client.full_name_kirill,
      phone_primary: detail.client.phone_primary,
      passport_series: detail.client.passport_series,
    } : null,
  };
}
