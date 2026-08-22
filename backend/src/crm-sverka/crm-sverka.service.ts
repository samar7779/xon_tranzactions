import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  SVERKA CRM — XonSaroy CRM to'lovlari ↔ bizning ОплатыКв
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Bank Sverkasi (transactions/reconcile) bank hisobi bo'yicha ishlaydi.
 *  Bu modul esa SHARTNOMA bo'yicha ishlaydi:
 *
 *    CRM (payment-history)  ──┐
 *                             ├──▶ shartnoma bo'yicha jami ▶ farq ▶ drill-down
 *    ОплатыКв (oplata_kv)  ──┘
 *
 *  Ma'lumot JONLI CRM API'dan olinadi (lokal jadval yo'q — foydalanuvchi
 *  tanlovi). To'liq tortish bir necha daqiqa davom etadi, shuning uchun:
 *    · run  → fonda ishga tushadi, status polling qilinadi
 *    · snapshot serverda xotirada saqlanadi — sahifa qayta ochilganda
 *      bir zumda ko'rinadi ("Yangilash" tugmasi qayta jonli tortadi)
 *
 *  Filtrlar (to'lov usuli, sana, obyekt, status) snapshot ustida
 *  hisoblanadi — CRM'ga qayta murojaat qilmaydi.
 */

// ─────────────────────────── Helper'lar ───────────────────────────

/** CRM ko'p tilli maydonlari: { value: { ru, uz, en } } yoki oddiy string */
function getRu(obj: any, fallback = ''): string {
  if (!obj) return fallback;
  if (typeof obj === 'string') return obj;
  const val = obj.value;
  if (typeof val === 'object' && val) return val.ru || val.uz || val.en || fallback;
  if (typeof val === 'string') return val;
  if (typeof obj.name === 'object' && obj.name) return obj.name.ru || obj.name.uz || obj.name.en || fallback;
  return fallback;
}

/** Shartnoma raqami — ikkala tomonda bir xil kanonik ko'rinish */
function normContract(s: any): string {
  return String(s ?? '').trim().toUpperCase();
}

function toNum(v: any): number {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[\s,]/g, ''));
  return isFinite(n) ? n : 0;
}

/** 'YYYY-MM-DD' (CRM string / Date obyektidan) */
function dayOf(v: any): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** Tiyin aniqligida butun son — float taqqoslash xatolarini yo'q qiladi */
const cents = (n: number) => Math.round(n * 100);

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 9999;
  const ms = Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z');
  if (!isFinite(ms)) return 9999;
  return Math.abs(Math.round(ms / 86400000));
}

// ─────────────────────────── Turlar ───────────────────────────

/** CRM to'lovi (normallashtirilgan, ixcham) */
interface CrmPay {
  contract: string;
  amount: number;
  date: string;
  method: string;
  type: string;
  category: string;
  status: string;
  object: string;
  client: string;
  externalId: string;
  problematic: boolean;
}

/** Bizning ОплатыКв qatori (ixcham) */
interface OurPay {
  id: string;
  contract: string;
  amount: number;
  date: string;
  method: string;
  type: string;
  object: string;
  client: string;
  purpose: string;
}

interface Snapshot {
  builtAt: Date;
  durationMs: number;
  pages: number;
  crm: CrmPay[];
  our: OurPay[];
  crmByContract: Map<string, CrmPay[]>;
  ourByContract: Map<string, OurPay[]>;
  /** true = CRM sahifalari hali tortilmoqda (natija to'liq emas, lekin ko'rsatiladi) */
  partial: boolean;
}

export interface SverkaFilters {
  q?: string;
  /** CRM to'lov usullari (bo'sh = hammasi) */
  methods?: string[];
  /** Bizning tomondagi to'lov usullari (bo'sh = hammasi) */
  ourMethods?: string[];
  /** CRM to'lov statuslari (bo'sh = hammasi) */
  crmStatuses?: string[];
  /** Obyekt nomlari */
  objects?: string[];
  /** Qator holati: ok | mismatch | crm-only | our-only */
  rowStatuses?: string[];
  dateFrom?: string;
  dateTo?: string;
  /** Shu summadan katta farqlar (mutlaq qiymat) */
  minDiff?: number;
  sort?: 'diff' | 'crm' | 'our' | 'contract';
  page?: number;
  perPage?: number;
}

export interface SverkaRow {
  contractNo: string;
  client: string | null;
  object: string | null;
  crmTotal: number;
  crmCount: number;
  ourTotal: number;
  ourCount: number;
  diff: number; // ourTotal - crmTotal  (+ bizda ko'p, − CRM'da ko'p)
  status: 'ok' | 'mismatch' | 'crm-only' | 'our-only';
  lastDate: string | null;
  methods: string[];
}

type RunPhase = 'idle' | 'crm' | 'db' | 'compute' | 'done' | 'error';

/**
 * Sahifa hajmi. XonPay sync 5000 ishlatadi, lekin u fonda (cron) ishlaydi —
 * bu yerda foydalanuvchi kutib turadi, shuning uchun kichikroq sahifa:
 * birinchi javob tezroq keladi va progress "0 sahifa"da qotib qolmaydi.
 */
const DEFAULT_PAGE_LIMIT = 2000;
/** Bitta sahifa uchun timeout — payment-history og'ir endpoint (60s ba'zan yetmaydi) */
const DEFAULT_PAGE_TIMEOUT_MS = 180_000;
/** Bir vaqtda nechta sahifa so'ralsin — ketma-ket tortish juda sekin edi */
const DEFAULT_CONCURRENCY = 6;

/** Run holati DB'da shu kalit ostida — server restartidan keyin ham bilinadi */
const RUN_STATE_KEY = 'crmSverka.lastRun';

@Injectable()
export class CrmSverkaService implements OnModuleInit {
  private readonly log = new Logger(CrmSverkaService.name);

  // ── Jonli tortish holati (bitta global run) ──
  private running = false;
  private startedAt: Date | null = null;
  private finishedAt: Date | null = null;
  private lastError: string | null = null;
  private progress = {
    phase: 'idle' as RunPhase,
    pages: 0,
    crmFetched: 0,
    ourRows: 0,
    contracts: 0,
    /** Hozir so'ralayotgan sahifa (javob kutilmoqda) */
    fetchingPage: 0,
    /** Oxirgi sahifa necha ms'da keldi — sekinlikni ko'rish uchun */
    lastPageMs: 0,
  };
  private snapshot: Snapshot | null = null;
  private startedBy: string | null = null;
  /** Sahifa hajmi va timeout — run boshlanganda beriladi (diagnostika uchun sozlanadi) */
  private runLimit = DEFAULT_PAGE_LIMIT;
  private runTimeoutMs = DEFAULT_PAGE_TIMEOUT_MS;
  private runConcurrency = DEFAULT_CONCURRENCY;

  // String intern — 100k+ qatorda bir xil "usul/status/obyekt" matnlari
  // xotirada bitta nusxada saqlansin.
  private pool = new Map<string, string>();
  private intern(s: any): string {
    const v = String(s ?? '').trim();
    if (!v) return '';
    const hit = this.pool.get(v);
    if (hit !== undefined) return hit;
    this.pool.set(v, v);
    return v;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
  ) {}

  /**
   * Boot: oxirgi run 'running' holatida qolgan bo'lsa — demak jarayon o'rtada
   * uzilgan (server restart / xotira yetmagan). Buni ochiq aytamiz, aks holda
   * foydalanuvchi sababsiz "tortilmoqda" ekranini ko'rib qoladi.
   */
  async onModuleInit() {
    try {
      const row = await this.prisma.setting.findUnique({ where: { key: RUN_STATE_KEY } });
      if (!row?.value) return;
      const st = JSON.parse(row.value);
      if (st?.status !== 'running') return;

      this.lastError =
        "Oldingi tortish o'rtada uzilib qoldi (server qayta ishga tushgan bo'lishi mumkin). " +
        'Qaytadan urinib ko\'ring — kerak bo\'lsa sahifa hajmini kichraytiring.';
      this.progress.phase = 'error';
      this.log.warn(`CRM sverka: uzilib qolgan run topildi (${st.startedAt}) — 'crashed' deb belgilandi`);
      await this.saveRunState({ ...st, status: 'crashed', finishedAt: new Date().toISOString() });
    } catch (e: any) {
      this.log.warn(`CRM sverka run holatini o'qishda xato (jiddiy emas): ${e?.message}`);
    }
  }

  /** Run holatini DB'ga yozamiz (restartdan keyin ham ko'rinsin) */
  private async saveRunState(state: Record<string, any>): Promise<void> {
    try {
      const value = JSON.stringify(state);
      await this.prisma.setting.upsert({
        where: { key: RUN_STATE_KEY },
        create: { key: RUN_STATE_KEY, value },
        update: { value },
      });
    } catch (e: any) {
      this.log.warn(`CRM sverka run holatini saqlashda xato (jiddiy emas): ${e?.message}`);
    }
  }

  // ═══════════════════ RUN (jonli tortish) ═══════════════════

  /**
   * CRM'dan barcha to'lovlarni jonli tortadi + ОплатыКв'ni o'qiydi.
   * Fonda ishlaydi — status() orqali kuzatiladi.
   */
  start(
    actorName?: string | null,
    opts: { limit?: number; timeoutMs?: number; concurrency?: number } = {},
  ): { ok: true; started: boolean; message: string } {
    if (this.running) {
      return { ok: true, started: false, message: 'Sverka allaqachon ishlamoqda' };
    }
    this.running = true;
    this.startedAt = new Date();
    this.finishedAt = null;
    this.lastError = null;
    this.startedBy = actorName || null;
    this.runLimit = Math.min(Math.max(Number(opts.limit) || DEFAULT_PAGE_LIMIT, 100), 5000);
    this.runTimeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || DEFAULT_PAGE_TIMEOUT_MS, 10_000), 300_000);
    this.runConcurrency = Math.min(Math.max(Number(opts.concurrency) || DEFAULT_CONCURRENCY, 1), 12);
    this.progress = {
      phase: 'crm', pages: 0, crmFetched: 0, ourRows: 0, contracts: 0,
      fetchingPage: 1, lastPageMs: 0,
    };

    const runMeta = {
      status: 'running',
      startedAt: this.startedAt.toISOString(),
      actor: this.startedBy,
      limit: this.runLimit,
      timeoutMs: this.runTimeoutMs,
    };
    void this.saveRunState(runMeta);

    this.runInBackground()
      .then(() => {
        void this.saveRunState({
          ...runMeta,
          status: 'done',
          finishedAt: new Date().toISOString(),
          crmCount: this.snapshot?.crm.length ?? 0,
          ourCount: this.snapshot?.our.length ?? 0,
          warning: this.lastError,
        });
      })
      .catch((e: any) => {
        this.lastError = e?.message || String(e);
        this.progress.phase = 'error';
        this.running = false;
        this.finishedAt = new Date();
        this.log.error(`CRM sverka xato: ${this.lastError}`);
        void this.saveRunState({
          ...runMeta,
          status: 'error',
          finishedAt: new Date().toISOString(),
          error: this.lastError,
        });
      });

    return { ok: true, started: true, message: 'CRM sverka boshlandi' };
  }

  /**
   * Tartib ATAYIN shunday: avval BIZNING baza (bir necha soniya), keyin CRM
   * sahifalari PARALLEL tortiladi va har paket kelishi bilan snapshot'ga
   * qo'shiladi. Shu sababli natija tortish TUGASHINI kutmaydi — birinchi
   * sahifalardanoq ro'yxatda ko'rina boshlaydi (partial=true).
   */
  private async runInBackground(): Promise<void> {
    const t0 = Date.now();

    // ── 1) Bizning ОплатыКв (tez — bitta DB so'rov) ──
    this.progress.phase = 'db';
    const our = await this.fetchOurPayments();
    this.progress.ourRows = our.length;

    const ourByContract = new Map<string, OurPay[]>();
    for (const p of our) {
      if (!p.contract) continue;
      const arr = ourByContract.get(p.contract);
      if (arr) arr.push(p);
      else ourByContract.set(p.contract, [p]);
    }

    // ── 2) Snapshot DARROV tayyorlanadi (CRM hali bo'sh) — natija oqib keladi ──
    const snap: Snapshot = {
      builtAt: new Date(),
      durationMs: 0,
      pages: 0,
      crm: [],
      our,
      crmByContract: new Map<string, CrmPay[]>(),
      ourByContract,
      partial: true,
    };
    this.snapshot = snap;
    this.progress.contracts = ourByContract.size;

    // ── 3) CRM sahifalari — parallel, kelgani sayin snapshot'ga qo'shiladi ──
    this.progress.phase = 'crm';
    await this.fetchAllCrmPayments(snap);

    // ── 4) Yakun ──
    snap.partial = false;
    snap.builtAt = new Date();
    snap.durationMs = Date.now() - t0;
    snap.pages = this.progress.pages;
    this.progress.contracts = new Set([...snap.crmByContract.keys(), ...snap.ourByContract.keys()]).size;

    this.progress.phase = 'done';
    this.running = false;
    this.finishedAt = new Date();
    this.log.log(
      `CRM sverka tayyor: CRM=${snap.crm.length} (${snap.pages} sahifa) · ОплатыКв=${our.length} · ` +
      `shartnoma=${this.progress.contracts} · ${Math.round(snap.durationMs / 1000)}s`,
    );
  }

  /**
   * CRM /payment-history/excel — sahifalar PARALLEL tortiladi.
   *
   * Ilgari ketma-ket edi: sahifasiga ~2.3s × 100+ sahifa = daqiqalab kutish.
   * Endi bir vaqtda CONCURRENCY ta sahifa so'raladi va har paket kelishi bilan
   * snapshot'ga qo'shiladi — natija tortish tugashini kutmaydi.
   */
  private async fetchAllCrmPayments(snap: Snapshot): Promise<void> {
    const LIMIT = this.runLimit;
    const CONCURRENCY = this.runConcurrency;
    const MAX_PAGES = 1000; // himoya chegarasi
    const MAX_RECORDS = 600_000; // xotira himoyasi
    const seenSigs = new Set<string>();
    let nextPage = 1;
    let stop = false;
    let lastGoodPage = 0;

    while (!stop && nextPage <= MAX_PAGES) {
      const pages: number[] = [];
      for (let i = 0; i < CONCURRENCY && nextPage + i <= MAX_PAGES; i++) pages.push(nextPage + i);
      this.progress.fetchingPage = pages[0];

      const tBatch = Date.now();
      // Promise.all tartibni saqlaydi — natijalar sahifa tartibida qayta ishlanadi
      const results = await Promise.all(
        pages.map(async (page) => ({ page, r: await this.crm.getPaymentHistory(page, LIMIT, this.runTimeoutMs) })),
      );
      this.progress.lastPageMs = Math.round((Date.now() - tBatch) / pages.length);

      for (const { page, r } of results) {
        if (!r.ok) {
          const why = (r as any).error || `HTTP ${(r as any).status || '?'}`;
          if (page === 1) {
            this.log.error(`CRM sverka: 1-sahifa xato (limit=${LIMIT}): ${String(why).slice(0, 300)}`);
            throw new Error(`CRM javob bermadi (limit=${LIMIT}): ${String(why).slice(0, 200)}`);
          }
          this.lastError = `Sahifa ${page}: ${String(why).slice(0, 150)} — qisman ma'lumot`;
          this.log.warn(`CRM sverka: ${this.lastError}`);
          stop = true;
          break;
        }

        const raw: any = (r as any).data?.data ?? (r as any).data;
        const pageItems: any[] = raw?.data ?? (Array.isArray(raw) ? raw : []);
        if (pageItems.length === 0) { stop = true; break; }

        // HIMOYA: CRM `page` ni e'tiborsiz qoldirsa — bir xil sahifa qayta-qayta
        // keladi va xotira to'lib ketadi. Sahifa "imzosi" takrorlansa — to'xtaymiz.
        const sig = `${pageItems[0]?.external_id ?? ''}|${pageItems[pageItems.length - 1]?.external_id ?? ''}`;
        if (sig !== '|' && seenSigs.has(sig)) {
          this.lastError = `CRM paginatsiyani qo'llamadi (${page}-sahifa takrorlandi) — ma'lumot to'liq emas`;
          this.log.warn(`CRM sverka: ${this.lastError}`);
          stop = true;
          break;
        }
        seenSigs.add(sig);

        // Snapshot'ga DARROV qo'shamiz — foydalanuvchi kutmasdan ko'ra boshlaydi
        for (const p of pageItems) {
          const contract = normContract(p.contract);
          if (!contract) continue;
          const item: CrmPay = {
            contract,
            amount: toNum(p.amount),
            date: dayOf(p.date_paid),
            method: this.intern(getRu(p.payment_method)),
            type: this.intern(getRu(p.type)),
            category: this.intern(getRu(p.category)),
            status: this.intern(getRu(p.status)),
            object: this.intern(p.object_name),
            client: this.intern(p.full_name),
            externalId: String(p.external_id ?? '').trim(),
            problematic: !!p.is_problematic,
          };
          snap.crm.push(item);
          const arr = snap.crmByContract.get(contract);
          if (arr) arr.push(item);
          else snap.crmByContract.set(contract, [item]);
        }

        lastGoodPage = Math.max(lastGoodPage, page);
        this.progress.pages = lastGoodPage;
        this.progress.crmFetched = snap.crm.length;
        snap.pages = lastGoodPage;

        if (snap.crm.length >= MAX_RECORDS) {
          this.lastError = `Yozuvlar soni ${MAX_RECORDS} dan oshdi — tortish to'xtatildi (ma'lumot to'liq emas)`;
          this.log.warn(`CRM sverka: ${this.lastError}`);
          stop = true;
          break;
        }
        // So'ralgandan kam keldi — bu oxirgi sahifa
        if (pageItems.length < LIMIT) { stop = true; break; }
      }

      // Har paketdan keyin shartnomalar sonini yangilaymiz (progress jonli ko'rinsin)
      this.progress.contracts = new Set([...snap.crmByContract.keys(), ...snap.ourByContract.keys()]).size;
      this.log.log(
        `CRM sverka: ${pages[0]}-${pages[pages.length - 1]} sahifalar · jami ${snap.crm.length} yozuv · ` +
        `${Math.round((Date.now() - tBatch) / 1000)}s`,
      );

      nextPage += CONCURRENCY;
    }

    if (nextPage > MAX_PAGES && !stop) {
      this.lastError = `CRM ${MAX_PAGES} sahifadan oshdi — ma'lumot to'liq emas`;
      this.log.warn(`CRM sverka: ${this.lastError}`);
    }
  }

  /** ОплатыКв — barcha qatorlar (ixcham select) */
  private async fetchOurPayments(): Promise<OurPay[]> {
    const rows = await this.prisma.oplataKv.findMany({
      select: {
        id: true,
        contractNo: true,
        date: true,
        paymentAmount: true,
        paymentMethod: true,
        txType: true,
        object: true,
        client: true,
        purpose: true,
      },
      orderBy: { date: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      contract: normContract(r.contractNo),
      amount: Number(r.paymentAmount || 0),
      date: dayOf(r.date),
      method: this.intern(r.paymentMethod),
      type: this.intern(r.txType),
      object: this.intern(r.object),
      client: this.intern(r.client),
      purpose: (r.purpose || '').slice(0, 200),
    }));
  }

  // ═══════════════════ DIAGNOSTIKA ═══════════════════

  /**
   * CRM payment-history endpointini bitta kichik so'rov bilan tekshiradi.
   * "Tortilmoqda" holatida qotib qolganda — sabab shu yerdan ko'rinadi:
   * javob keladimi, qancha vaqtda, javob shakli qanday, jami nechta yozuv bor.
   */
  async ping(limit = 1, timeoutMs = 30_000) {
    const t0 = Date.now();
    const r = await this.crm.getPaymentHistory(1, Math.min(Math.max(limit, 1), 5000), timeoutMs);
    const ms = Date.now() - t0;

    if (!r.ok) {
      return {
        ok: false as const,
        ms,
        limit,
        status: (r as any).status ?? null,
        error: String((r as any).error || 'nomalum xato').slice(0, 500),
      };
    }

    const raw: any = (r as any).data?.data ?? (r as any).data;
    const items: any[] = raw?.data ?? (Array.isArray(raw) ? raw : []);
    const sample = items[0] || null;

    return {
      ok: true as const,
      ms,
      limit,
      count: items.length,
      // Paginatsiya meta — CRM'da jami nechta to'lov borligini shu yerdan bilamiz
      total: raw?.total ?? null,
      perPage: raw?.per_page ?? null,
      lastPage: raw?.last_page ?? null,
      responseKeys: raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 20) : [],
      sampleKeys: sample ? Object.keys(sample).slice(0, 40) : [],
      sample: sample
        ? {
            contract: sample.contract ?? null,
            amount: sample.amount ?? null,
            datePaid: sample.date_paid ?? null,
            method: getRu(sample.payment_method) || null,
            status: getRu(sample.status) || null,
          }
        : null,
    };
  }

  // ═══════════════════ STATUS ═══════════════════

  status() {
    const s = this.snapshot;
    return {
      ok: true as const,
      running: this.running,
      phase: this.progress.phase,
      progress: { ...this.progress },
      startedAt: this.startedAt?.toISOString() || null,
      finishedAt: this.finishedAt?.toISOString() || null,
      startedBy: this.startedBy,
      lastError: this.lastError,
      /** Ishlab turgan run necha soniya bo'ldi — "qotib qolganmi?" degan savolga javob */
      elapsedMs: this.startedAt
        ? (this.finishedAt ? this.finishedAt.getTime() : Date.now()) - this.startedAt.getTime()
        : 0,
      pageLimit: this.runLimit,
      pageTimeoutMs: this.runTimeoutMs,
      concurrency: this.runConcurrency,
      snapshot: s
        ? {
            builtAt: s.builtAt.toISOString(),
            ageSeconds: Math.round((Date.now() - s.builtAt.getTime()) / 1000),
            durationMs: s.durationMs,
            pages: s.pages,
            crmCount: s.crm.length,
            ourCount: s.our.length,
            contracts: new Set([...s.crmByContract.keys(), ...s.ourByContract.keys()]).size,
            partial: s.partial,
          }
        : null,
    };
  }

  // ═══════════════════ FILTR + HISOB ═══════════════════

  private inRange(day: string, from?: string, to?: string): boolean {
    if (!from && !to) return true;
    if (!day) return false; // sanasiz qator sana filtri ostida chiqmaydi
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  }

  private buildRows(f: SverkaFilters): { rows: SverkaRow[]; snapshot: Snapshot } | null {
    const s = this.snapshot;
    if (!s) return null;

    const methodSet = f.methods?.length ? new Set(f.methods) : null;
    const ourMethodSet = f.ourMethods?.length ? new Set(f.ourMethods) : null;
    const statusSet = f.crmStatuses?.length ? new Set(f.crmStatuses) : null;
    const objectSet = f.objects?.length ? new Set(f.objects) : null;

    const keepCrm = (p: CrmPay) =>
      (!methodSet || methodSet.has(p.method || '—')) &&
      (!statusSet || statusSet.has(p.status || '—')) &&
      (!objectSet || objectSet.has(p.object || '—')) &&
      this.inRange(p.date, f.dateFrom, f.dateTo);

    const keepOur = (p: OurPay) =>
      (!ourMethodSet || ourMethodSet.has(p.method || '—')) &&
      (!objectSet || objectSet.has(p.object || '—')) &&
      this.inRange(p.date, f.dateFrom, f.dateTo);

    const contracts = new Set([...s.crmByContract.keys(), ...s.ourByContract.keys()]);
    const rows: SverkaRow[] = [];

    for (const cn of contracts) {
      const crmAll = s.crmByContract.get(cn) || [];
      const ourAll = s.ourByContract.get(cn) || [];
      const crmList = methodSet || statusSet || objectSet || f.dateFrom || f.dateTo ? crmAll.filter(keepCrm) : crmAll;
      const ourList = ourMethodSet || objectSet || f.dateFrom || f.dateTo ? ourAll.filter(keepOur) : ourAll;

      if (crmList.length === 0 && ourList.length === 0) continue;

      let crmTotal = 0;
      let lastDate = '';
      const methods = new Set<string>();
      for (const p of crmList) {
        crmTotal += p.amount;
        if (p.date > lastDate) lastDate = p.date;
        if (p.method) methods.add(p.method);
      }
      let ourTotal = 0;
      for (const p of ourList) {
        ourTotal += p.amount;
        if (p.date > lastDate) lastDate = p.date;
      }

      const diff = (cents(ourTotal) - cents(crmTotal)) / 100;
      const status: SverkaRow['status'] =
        crmList.length === 0 ? 'our-only'
        : ourList.length === 0 ? 'crm-only'
        : Math.abs(diff) < 0.01 ? 'ok'
        : 'mismatch';

      rows.push({
        contractNo: cn,
        client: crmList[0]?.client || ourList[0]?.client || null,
        object: crmList[0]?.object || ourList[0]?.object || null,
        crmTotal,
        crmCount: crmList.length,
        ourTotal,
        ourCount: ourList.length,
        diff,
        status,
        lastDate: lastDate || null,
        methods: Array.from(methods),
      });
    }

    return { rows, snapshot: s };
  }

  /**
   * Filtrlangan + saralangan qatorlar va KPI (paginatsiyasiz).
   * result() ham, exportXlsx() ham shu yerdan foydalanadi.
   */
  private filteredRows(f: SverkaFilters) {
    const built = this.buildRows(f);
    if (!built) return null;
    const { rows, snapshot } = built;

    // ── KPI: filtr bo'yicha (rowStatuses'gacha — aks holda kartalar o'zini "yeydi") ──
    const summary = {
      total: rows.length,
      ok: 0,
      mismatch: 0,
      crmOnly: 0,
      ourOnly: 0,
      crmSum: 0,
      ourSum: 0,
      diffSum: 0, // farqlarning mutlaq yig'indisi
    };
    for (const r of rows) {
      if (r.status === 'ok') summary.ok++;
      else if (r.status === 'mismatch') summary.mismatch++;
      else if (r.status === 'crm-only') summary.crmOnly++;
      else summary.ourOnly++;
      summary.crmSum += r.crmTotal;
      summary.ourSum += r.ourTotal;
      if (r.status !== 'ok') summary.diffSum += Math.abs(r.diff);
    }

    // ── Qator filtri (status + qidiruv + min farq) ──
    const rowStatusSet = f.rowStatuses?.length ? new Set(f.rowStatuses) : null;
    const ql = (f.q || '').trim().toLowerCase();
    const minDiff = Number(f.minDiff) || 0;

    let filtered = rows;
    if (rowStatusSet) filtered = filtered.filter((r) => rowStatusSet.has(r.status));
    if (minDiff > 0) filtered = filtered.filter((r) => Math.abs(r.diff) >= minDiff);
    if (ql) {
      filtered = filtered.filter(
        (r) =>
          r.contractNo.toLowerCase().includes(ql) ||
          (r.client || '').toLowerCase().includes(ql) ||
          (r.object || '').toLowerCase().includes(ql),
      );
    }

    // ── Sort ──
    const sort = f.sort || 'diff';
    filtered = [...filtered].sort((a, b) => {
      if (sort === 'contract') return a.contractNo.localeCompare(b.contractNo);
      if (sort === 'crm') return b.crmTotal - a.crmTotal;
      if (sort === 'our') return b.ourTotal - a.ourTotal;
      // diff — farqi kattalar tepada, mos qatorlar oxirida
      const av = Math.abs(a.diff);
      const bv = Math.abs(b.diff);
      if (bv !== av) return bv - av;
      return a.contractNo.localeCompare(b.contractNo);
    });

    return { rows: filtered, summary, snapshot };
  }

  /**
   * Ro'yxat + KPI + facet'lar (filtr paneli uchun).
   * Snapshot yo'q bo'lsa — ready:false qaytadi (frontend run'ni ishga tushiradi).
   */
  result(f: SverkaFilters) {
    const built = this.filteredRows(f);
    if (!built) {
      return {
        ok: true as const,
        ready: false as const,
        running: this.running,
        phase: this.progress.phase,
        message: "Sverka hali qilinmagan — 'Yangilash' bilan CRM'dan tortiladi",
      };
    }
    const { rows, summary, snapshot } = built;

    // ── Paginatsiya ──
    const perPage = Math.min(Math.max(Number(f.perPage) || 50, 1), 500);
    const page = Math.max(Number(f.page) || 1, 1);
    const total = rows.length;
    const items = rows.slice((page - 1) * perPage, page * perPage);

    return {
      ok: true as const,
      ready: true as const,
      running: this.running,
      meta: {
        builtAt: snapshot.builtAt.toISOString(),
        ageSeconds: Math.round((Date.now() - snapshot.builtAt.getTime()) / 1000),
        durationMs: snapshot.durationMs,
        crmCount: snapshot.crm.length,
        ourCount: snapshot.our.length,
        pages: snapshot.pages,
        partialError: this.lastError,
        partial: snapshot.partial,
      },
      summary,
      filtered: { total, page, perPage, pageCount: Math.max(1, Math.ceil(total / perPage)) },
      items,
      facets: this.facets(),
    };
  }

  /**
   * Filtr paneli uchun qiymatlar (usul / status / obyekt) — sanoq bilan.
   * Snapshot bo'yicha keshlanadi (har so'rovda 100k+ qatorni qayta sanamaslik uchun).
   */
  private facetCache: { key: string; data: any } | null = null;

  facets() {
    const s = this.snapshot;
    if (!s) return { methods: [], ourMethods: [], crmStatuses: [], objects: [] };
    const cacheKey = `${s.builtAt.getTime()}:${s.crm.length}:${s.our.length}`;
    if (this.facetCache?.key === cacheKey) return this.facetCache.data;

    const count = (arr: string[]) => {
      const m = new Map<string, number>();
      for (const v of arr) m.set(v || '—', (m.get(v || '—') || 0) + 1);
      return Array.from(m, ([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count);
    };

    const objects = new Map<string, number>();
    for (const p of s.crm) objects.set(p.object || '—', (objects.get(p.object || '—') || 0) + 1);
    for (const p of s.our) objects.set(p.object || '—', (objects.get(p.object || '—') || 0) + 1);

    const data = {
      methods: count(s.crm.map((p) => p.method)),
      ourMethods: count(s.our.map((p) => p.method)),
      crmStatuses: count(s.crm.map((p) => p.status)),
      objects: Array.from(objects, ([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count),
    };
    this.facetCache = { key: cacheKey, data };
    return data;
  }

  // ═══════════════════ DRILL-DOWN (to'lovma-to'lov) ═══════════════════

  /**
   * Bitta shartnoma: CRM to'lovlari ↔ bizning to'lovlar juftlanadi.
   *   1) aniq moslik   — sana + summa bir xil
   *   2) sana siljigan — summa bir xil, sana ±N kun
   *   3) summa farqi   — sana bir xil, summa boshqa
   *   4) qolganlari    — faqat CRM'da / faqat bizda
   */
  contractDetail(contractNo: string, f: SverkaFilters = {}, tolDays = 3) {
    const s = this.snapshot;
    if (!s) return { ok: false as const, ready: false as const, error: 'Snapshot yo\'q — avval sverka qiling' };

    const cn = normContract(contractNo);
    if (!cn) return { ok: false as const, ready: true as const, error: "contractNo bo'sh" };

    // Filtrlar ro'yxatdagi bilan AYNAN bir xil bo'lishi shart — aks holda
    // drill-down summasi qatordagi summaga to'g'ri kelmaydi.
    const methodSet = f.methods?.length ? new Set(f.methods) : null;
    const ourMethodSet = f.ourMethods?.length ? new Set(f.ourMethods) : null;
    const statusSet = f.crmStatuses?.length ? new Set(f.crmStatuses) : null;
    const objectSet = f.objects?.length ? new Set(f.objects) : null;

    const crmList = (s.crmByContract.get(cn) || []).filter(
      (p) =>
        (!methodSet || methodSet.has(p.method || '—')) &&
        (!statusSet || statusSet.has(p.status || '—')) &&
        (!objectSet || objectSet.has(p.object || '—')) &&
        this.inRange(p.date, f.dateFrom, f.dateTo),
    );
    const ourList = (s.ourByContract.get(cn) || []).filter(
      (p) =>
        (!ourMethodSet || ourMethodSet.has(p.method || '—')) &&
        (!objectSet || objectSet.has(p.object || '—')) &&
        this.inRange(p.date, f.dateFrom, f.dateTo),
    );

    const crmLeft = crmList.map((p, i) => ({ p, i, used: false }));
    const ourLeft = ourList.map((p, i) => ({ p, i, used: false }));

    const matched: any[] = [];
    const dateShift: any[] = [];
    const amountDiff: any[] = [];

    // ── 1) Aniq moslik: sana + summa ──
    const ourByKey = new Map<string, number[]>();
    ourLeft.forEach((o, idx) => {
      const k = `${o.p.date}|${cents(o.p.amount)}`;
      const arr = ourByKey.get(k);
      if (arr) arr.push(idx);
      else ourByKey.set(k, [idx]);
    });
    for (const c of crmLeft) {
      const k = `${c.p.date}|${cents(c.p.amount)}`;
      const bucket = ourByKey.get(k);
      if (!bucket?.length) continue;
      const idx = bucket.shift()!;
      const o = ourLeft[idx];
      c.used = true;
      o.used = true;
      matched.push({ kind: 'exact', crm: this.crmDto(c.p), our: this.ourDto(o.p), diff: 0, dayGap: 0 });
    }

    // ── 2) Summa bir xil, sana ±tolDays ──
    for (const c of crmLeft) {
      if (c.used) continue;
      let best: { o: (typeof ourLeft)[number]; gap: number } | null = null;
      for (const o of ourLeft) {
        if (o.used) continue;
        if (cents(o.p.amount) !== cents(c.p.amount)) continue;
        const gap = daysBetween(c.p.date, o.p.date);
        if (gap > tolDays) continue;
        if (!best || gap < best.gap) best = { o, gap };
      }
      if (best) {
        c.used = true;
        best.o.used = true;
        dateShift.push({
          kind: 'date-shift',
          crm: this.crmDto(c.p),
          our: this.ourDto(best.o.p),
          diff: 0,
          dayGap: best.gap,
        });
      }
    }

    // ── 3) Sana bir xil, summa boshqa (eng yaqin summa bilan juftlaymiz) ──
    for (const c of crmLeft) {
      if (c.used) continue;
      let best: { o: (typeof ourLeft)[number]; d: number } | null = null;
      for (const o of ourLeft) {
        if (o.used) continue;
        if (o.p.date !== c.p.date) continue;
        const d = Math.abs(cents(o.p.amount) - cents(c.p.amount));
        if (!best || d < best.d) best = { o, d };
      }
      if (best) {
        c.used = true;
        best.o.used = true;
        amountDiff.push({
          kind: 'amount-diff',
          crm: this.crmDto(c.p),
          our: this.ourDto(best.o.p),
          diff: (cents(best.o.p.amount) - cents(c.p.amount)) / 100,
          dayGap: 0,
        });
      }
    }

    // ── 4) Qolganlar ──
    const onlyCrm = crmLeft.filter((c) => !c.used).map((c) => this.crmDto(c.p));
    const onlyOur = ourLeft.filter((o) => !o.used).map((o) => this.ourDto(o.p));

    const crmTotal = crmList.reduce((a, p) => a + p.amount, 0);
    const ourTotal = ourList.reduce((a, p) => a + p.amount, 0);

    return {
      ok: true as const,
      ready: true as const,
      contractNo: cn,
      client: crmList[0]?.client || ourList[0]?.client || null,
      object: crmList[0]?.object || ourList[0]?.object || null,
      totals: {
        crmTotal,
        ourTotal,
        diff: (cents(ourTotal) - cents(crmTotal)) / 100,
        crmCount: crmList.length,
        ourCount: ourList.length,
      },
      pairs: {
        matched,
        dateShift,
        amountDiff,
        onlyCrm,
        onlyOur,
      },
      counts: {
        matched: matched.length,
        dateShift: dateShift.length,
        amountDiff: amountDiff.length,
        onlyCrm: onlyCrm.length,
        onlyOur: onlyOur.length,
        onlyCrmSum: onlyCrm.reduce((a: number, p: any) => a + p.amount, 0),
        onlyOurSum: onlyOur.reduce((a: number, p: any) => a + p.amount, 0),
      },
    };
  }

  private crmDto(p: CrmPay) {
    return {
      amount: p.amount,
      date: p.date || null,
      method: p.method || null,
      type: p.type || null,
      category: p.category || null,
      status: p.status || null,
      externalId: p.externalId || null,
      problematic: p.problematic,
    };
  }

  private ourDto(p: OurPay) {
    return {
      id: p.id,
      amount: p.amount,
      date: p.date || null,
      method: p.method || null,
      type: p.type || null,
      purpose: p.purpose || null,
    };
  }

  // ═══════════════════ EXPORT ═══════════════════

  async exportXlsx(f: SverkaFilters): Promise<{ buffer: Buffer; filename: string }> {
    // Paginatsiyasiz — filtrga tushgan BARCHA qatorlar
    const res = this.filteredRows(f);
    if (!res) throw new Error('Sverka hali qilinmagan');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet('Sverka CRM');

    ws.columns = [
      { header: 'Дог №', key: 'contractNo', width: 18 },
      { header: 'Клиент', key: 'client', width: 30 },
      { header: 'Объект', key: 'object', width: 22 },
      { header: 'CRM жами', key: 'crmTotal', width: 18 },
      { header: 'CRM та', key: 'crmCount', width: 9 },
      { header: 'ОплатыКв жами', key: 'ourTotal', width: 18 },
      { header: 'ОплатыКв та', key: 'ourCount', width: 12 },
      { header: 'Фарқ', key: 'diff', width: 18 },
      { header: 'Ҳолат', key: 'status', width: 16 },
      { header: 'Охирги сана', key: 'lastDate', width: 13 },
      { header: 'Тўлов усули', key: 'methods', width: 28 },
    ];

    const head = ws.getRow(1);
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

    const label: Record<SverkaRow['status'], string> = {
      'ok': 'Мос',
      'mismatch': 'Фарқли',
      'crm-only': 'Фақат CRM да',
      'our-only': 'Фақат бизда',
    };
    const color: Record<SverkaRow['status'], string> = {
      'ok': 'FF047857',
      'mismatch': 'FFB45309',
      'crm-only': 'FFBE123C',
      'our-only': 'FF1D4ED8',
    };

    for (const r of res.rows) {
      const row = ws.addRow({
        contractNo: r.contractNo,
        client: r.client || '',
        object: r.object || '',
        crmTotal: r.crmTotal,
        crmCount: r.crmCount,
        ourTotal: r.ourTotal,
        ourCount: r.ourCount,
        diff: r.diff,
        status: label[r.status],
        lastDate: r.lastDate || '',
        methods: r.methods.join(', '),
      });
      row.font = { size: 9 };
      row.getCell('crmTotal').numFmt = '#,##0.00';
      row.getCell('ourTotal').numFmt = '#,##0.00';
      row.getCell('diff').numFmt = '#,##0.00';
      row.getCell('status').font = { size: 9, bold: true, color: { argb: color[r.status] } };
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = `sverka-crm-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return { buffer, filename };
  }
}
