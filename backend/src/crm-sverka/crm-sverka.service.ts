import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class CrmSverkaService {
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
  };
  private snapshot: Snapshot | null = null;
  private startedBy: string | null = null;

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

  // ═══════════════════ RUN (jonli tortish) ═══════════════════

  /**
   * CRM'dan barcha to'lovlarni jonli tortadi + ОплатыКв'ni o'qiydi.
   * Fonda ishlaydi — status() orqali kuzatiladi.
   */
  start(actorName?: string | null): { ok: true; started: boolean; message: string } {
    if (this.running) {
      return { ok: true, started: false, message: 'Sverka allaqachon ishlamoqda' };
    }
    this.running = true;
    this.startedAt = new Date();
    this.finishedAt = null;
    this.lastError = null;
    this.startedBy = actorName || null;
    this.progress = { phase: 'crm', pages: 0, crmFetched: 0, ourRows: 0, contracts: 0 };

    this.runInBackground().catch((e: any) => {
      this.lastError = e?.message || String(e);
      this.progress.phase = 'error';
      this.running = false;
      this.finishedAt = new Date();
      this.log.error(`CRM sverka xato: ${this.lastError}`);
    });

    return { ok: true, started: true, message: 'CRM sverka boshlandi' };
  }

  private async runInBackground(): Promise<void> {
    const t0 = Date.now();

    // ── 1) CRM: barcha to'lov tarixi (paginatsiya) ──
    this.progress.phase = 'crm';
    const { items: crm, pages } = await this.fetchAllCrmPayments();

    // ── 2) Bizning ОплатыКв ──
    this.progress.phase = 'db';
    const our = await this.fetchOurPayments();
    this.progress.ourRows = our.length;

    // ── 3) Shartnoma bo'yicha indeks ──
    this.progress.phase = 'compute';
    const crmByContract = new Map<string, CrmPay[]>();
    for (const p of crm) {
      if (!p.contract) continue;
      const arr = crmByContract.get(p.contract);
      if (arr) arr.push(p);
      else crmByContract.set(p.contract, [p]);
    }
    const ourByContract = new Map<string, OurPay[]>();
    for (const p of our) {
      if (!p.contract) continue;
      const arr = ourByContract.get(p.contract);
      if (arr) arr.push(p);
      else ourByContract.set(p.contract, [p]);
    }

    const contracts = new Set([...crmByContract.keys(), ...ourByContract.keys()]).size;
    this.progress.contracts = contracts;

    this.snapshot = {
      builtAt: new Date(),
      durationMs: Date.now() - t0,
      pages,
      crm,
      our,
      crmByContract,
      ourByContract,
    };

    this.progress.phase = 'done';
    this.running = false;
    this.finishedAt = new Date();
    this.log.log(
      `CRM sverka tayyor: CRM=${crm.length} (${pages} sahifa) · ОплатыКв=${our.length} · ` +
      `shartnoma=${contracts} · ${Math.round(this.snapshot.durationMs / 1000)}s`,
    );
  }

  /** CRM /payment-history/excel — barcha sahifalar */
  private async fetchAllCrmPayments(): Promise<{ items: CrmPay[]; pages: number }> {
    const LIMIT = 5000;
    const MAX_PAGES = 400; // 2M yozuv — himoya chegarasi
    const items: CrmPay[] = [];
    let page = 1;

    while (page <= MAX_PAGES) {
      const r = await this.crm.getPaymentHistory(page, LIMIT);
      if (!r.ok) {
        // Birinchi sahifa yiqilsa — umuman ma'lumot yo'q, xato beramiz.
        // Keyingi sahifada yiqilsa — qisman ma'lumot bilan davom etamiz.
        if (page === 1) throw new Error((r as any).error || 'CRM payment-history javob bermadi');
        this.lastError = `Sahifa ${page}: ${(r as any).error || 'xato'} — qisman ma'lumot`;
        this.log.warn(`CRM sverka: ${this.lastError}`);
        break;
      }

      const raw: any = (r as any).data?.data ?? (r as any).data;
      const pageItems: any[] = raw?.data ?? (Array.isArray(raw) ? raw : []);
      if (pageItems.length === 0) break;

      for (const p of pageItems) {
        const contract = normContract(p.contract);
        if (!contract) continue;
        items.push({
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
        });
      }

      this.progress.pages = page;
      this.progress.crmFetched = items.length;

      if (pageItems.length < LIMIT) break;
      page++;
    }

    // Chegaraga yetdik — ma'lumot to'liq emas, jim qolmaymiz (sverka noto'g'ri chiqadi)
    if (page > MAX_PAGES) {
      this.lastError = `CRM ${MAX_PAGES} sahifadan oshdi — ma'lumot to'liq emas`;
      this.log.warn(`CRM sverka: ${this.lastError}`);
    }

    return { items, pages: this.progress.pages };
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
      snapshot: s
        ? {
            builtAt: s.builtAt.toISOString(),
            ageSeconds: Math.round((Date.now() - s.builtAt.getTime()) / 1000),
            durationMs: s.durationMs,
            pages: s.pages,
            crmCount: s.crm.length,
            ourCount: s.our.length,
            contracts: new Set([...s.crmByContract.keys(), ...s.ourByContract.keys()]).size,
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
  private facetCache: { key: number; data: any } | null = null;

  facets() {
    const s = this.snapshot;
    if (!s) return { methods: [], ourMethods: [], crmStatuses: [], objects: [] };
    if (this.facetCache?.key === s.builtAt.getTime()) return this.facetCache.data;

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
    this.facetCache = { key: s.builtAt.getTime(), data };
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
