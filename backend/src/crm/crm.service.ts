import { Injectable, Logger } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { PrismaService } from '../common/prisma/prisma.service';

const XONSAROY_BASE_URL = process.env.XONSAROY_API_URL || 'https://app-api.xonsaroy.uz/api/v4/client/order';
// payment-history endpoint /client/order DAN tashqarida — /client/payment-history
const XONSAROY_CLIENT_BASE = process.env.XONSAROY_CLIENT_BASE || 'https://app-api.xonsaroy.uz/api/v4/client';
const XONSAROY_KEY = process.env.XONSAROY_API_KEY || '';
const XONSAROY_SECRET = process.env.XONSAROY_API_SECRET || '';

// Planirovka rasmlari shu S3 bucket'da (uploads/plans/...). CRM relative yo'l
// bersa shu host qo'shiladi; presigned (X-Amz) bo'lsa o'zi to'liq keladi.
const PLAN_S3_BASE = process.env.XONSAROY_S3_BASE || 'https://xny-buildit.s3.eu-central-1.amazonaws.com/';

// XonSaroy MySQL (xonappuz_crm) — bot bilan bir xil baza.
// To'liq client ma'lumotlari (telefon, pasport, manzil) shu yerdan keladi.
// Agar ulanish iloji bo'lmasa, faqat API'dan keladigan F.I.O. ko'rsatiladi.
const MYSQL_HOST = process.env.XONAPP_MYSQL_HOST || 'localhost';
const MYSQL_PORT = Number(process.env.XONAPP_MYSQL_PORT || 3306);
const MYSQL_USER = process.env.XONAPP_MYSQL_USER || '';
const MYSQL_PASSWORD = process.env.XONAPP_MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.XONAPP_MYSQL_DB || 'xonappuz_crm';
const MYSQL_ENABLED = !!(MYSQL_USER && MYSQL_PASSWORD);

@Injectable()
export class CrmService {
  private readonly log = new Logger(CrmService.name);
  private pool: mysql.Pool | null = null;

  constructor(private prisma: PrismaService) {}

  private getPool(): mysql.Pool | null {
    if (!MYSQL_ENABLED) return null;
    if (this.pool) return this.pool;
    try {
      this.pool = mysql.createPool({
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: MYSQL_DATABASE,
        charset: 'utf8mb4',
        waitForConnections: true,
        connectionLimit: 5,
        connectTimeout: 5000,
      });
      return this.pool;
    } catch (e: any) {
      this.log.warn(`MySQL pool yaratishda xato: ${e?.message}`);
      return null;
    }
  }

  private auth() {
    return 'Basic ' + Buffer.from(`${XONSAROY_KEY}:${XONSAROY_SECRET}`).toString('base64');
  }

  private async call(path: string, body: Record<string, any>) {
    return this.callUrl(`${XONSAROY_BASE_URL}${path}`, body, 20_000);
  }

  /** /client base bilan chaqirish (order'siz) — payment-history kabi endpointlar uchun */
  private async callClient(path: string, body: Record<string, any>, timeoutMs = 60_000) {
    return this.callUrl(`${XONSAROY_CLIENT_BASE}${path}`, body, timeoutMs);
  }

  /**
   * GET so'rov (query string bilan) — index endpointlar uchun (Laravel index odatda GET).
   * /payment-history INDEX to'liq maydonlar (type/category/payment_method) qaytaradi.
   */
  private async callClientGet(path: string, params: Record<string, any>, timeoutMs = 60_000) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v));
    const url = `${XONSAROY_CLIENT_BASE}${path}?${qs.toString()}`;
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: this.auth(), Accept: 'application/json' },
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        this.log.warn(`XonSaroy GET ${url} -> ${res.status}: ${text.slice(0, 150)}`);
        return { ok: false as const, status: res.status, error: text };
      }
      try { return { ok: true as const, data: JSON.parse(text) }; }
      catch { return { ok: false as const, status: 200, error: 'Invalid JSON', raw: text }; }
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Network error' };
    } finally {
      clearTimeout(tm);
    }
  }

  private async callUrl(url: string, body: Record<string, any>, timeoutMs: number) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v != null) form.set(k, String(v));
    }
    // FIX (A5): tranzitiv xato (tarmoq/timeout/5xx) uchun cheklangan retry + backoff.
    // CRM chaqiruvlar (show/search/payment-history) idempotent (read) — retry xavfsiz.
    const MAX_ATTEMPTS = 3;
    let lastErr = 'Network error';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': this.auth(),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form,
          signal: ctrl.signal,
        });
        const text = await res.text();
        if (!res.ok) {
          // 5xx — tranzitiv (retry); 4xx — client xato (retry yo'q)
          if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
            lastErr = `HTTP ${res.status}`;
          } else {
            this.log.warn(`XonSaroy ${url} -> ${res.status}: ${text.slice(0, 200)}`);
            return { ok: false, status: res.status, error: text };
          }
        } else {
          try {
            return { ok: true, data: JSON.parse(text) };
          } catch {
            this.log.warn(`XonSaroy ${url} Invalid JSON: ${text.slice(0, 150)}`);
            return { ok: false, status: 200, error: 'Invalid JSON', raw: text };
          }
        }
      } catch (e: any) {
        lastErr = e?.message || 'Network error';
      } finally {
        clearTimeout(tm);
      }
      // Faqat retry kerak bo'lganda (5xx / tarmoq xato) shu yerga yetamiz — backoff
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 300 * attempt));
    }
    this.log.error(`XonSaroy ${url} error (${MAX_ATTEMPTS} urinishdan keyin): ${lastErr}`);
    return { ok: false, error: lastErr };
  }

  /**
   * Bulk payment history — XonSaroy CRM dan to'lovlar ro'yxati (paginatsiya bilan).
   * Python skriptdagi /payment-history/excel endpointi.
   * Bir sahifada 5000 tagacha qaytaradi (limit parametri).
   */
  async getPaymentHistory(page = 1, limit = 5000, timeoutMs = 60_000) {
    return this.callClient('/payment-history/excel', { page, limit }, timeoutMs);
  }

  /**
   * Kompozit bank ID'ni ajratadi: [IP_]general_id_num_ddate_acc_ct_acc_dt_amount_sign
   * (ddate dd.MM.yyyy). null — format noto'g'ri.
   */
  private parseComposite(compositeId: string): {
    generalId: string; num: string; ddate: string; isoDate: string;
    accCt: string; accDt: string; amount: number; sign: string;
  } | null {
    const s = (compositeId || '').trim();
    if (!s) return null;
    const body = s.startsWith('IP_') ? s.slice(3) : s;
    const parts = body.split('_');
    if (parts.length < 7) return null;
    const [generalId, num, ddate, accCt, accDt, amountRaw, sign] = parts;
    let isoDate = '';
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(ddate || '');
    if (m) isoDate = `${m[3]}-${m[2]}-${m[1]}`;
    return { generalId, num, ddate, isoDate, accCt, accDt, amount: Number(amountRaw) || 0, sign };
  }

  /**
   * XATO to'lovni CRM'dan topish — kompozit bank ID orqali.
   * CRM `/payment-history` index endpointi SERVER-SIDE filtrlarni oladi
   * (transaction_id, contract, object_id, date_from/to, amount_min/max, ...).
   * Shu bois skanerlash SHART EMAS — `transaction_id = general_id` bilan bitta
   * so'rovda aniq to'lov(lar) olinadi. Topilmasa — sana bo'yicha zaxira qidiruv.
   * CRM external_id = bizning kompozit ID (general_id_num_ddate_..._sign) bilan bir xil.
   */
  async findByComposite(compositeId: string): Promise<{
    ok: boolean;
    error?: string;
    parsed?: any;
    via?: string;
    candidates: Array<any>;
    sameDate: Array<any>;
    sample?: any;
    sampleKeys?: string[];
    matchSample?: any;
    scanned: number;
  }> {
    const parsed = this.parseComposite(compositeId);
    if (!parsed) return { ok: false, error: "ID formati noto'g'ri", candidates: [], sameDate: [], scanned: 0 };
    const { generalId, num, isoDate, amount } = parsed;

    const ru = (v: any): string | null => {
      if (v == null) return null;
      if (typeof v === 'string') return v || null;
      if (typeof v === 'object') {
        if (v.ru || v.uz || v.en) return v.ru || v.uz || v.en;
        // CRM maydonlari ko'pincha { id, name: "..." } yoki { name: { ru, uz } }
        if (v.name) {
          if (typeof v.name === 'string') return v.name || null;
          if (typeof v.name === 'object') return v.name.ru || v.name.uz || v.name.en || null;
        }
        if (typeof v.value === 'string') return v.value || null;
        return null;
      }
      return String(v);
    };
    // Summa: composite tiyinda bo'lishi mumkin (615000000 = 6 150 000 so'm) — 3 variant
    const amtMatch = (pamt: number) =>
      Math.abs(pamt - amount) < 1 || Math.abs(pamt * 100 - amount) < 1 || Math.abs(pamt - amount / 100) < 1;
    // ANIQ match = CRM external_id boshi general_id_num_ddate ga to'g'ri kelishi (yagona)
    const core = [generalId, num, parsed.ddate]
      .filter((x) => x && !String(x).startsWith('no_'))
      .join('_');
    const rowOut = (p: any, matchedBy: string[]) => ({
      contract: String(p.contract || '').trim(),
      purpose: p.purpose || '',
      externalId: String(p.external_id ?? '').trim(),
      amount: Number(p.amount || 0),
      date: p.date_paid ? String(p.date_paid).slice(0, 10) : '',
      object: ru(p.object_name),
      method: ru(p.payment_method),
      status: ru(p.status),
      type: ru(p.type),         // boshlang'ich / oylik (initial / monthly)
      category: ru(p.category),
      // SPLIT — CRM to'lov qatorida bevosita bor (so'mda)
      initialAmount: Number(p.initial_amount || 0),   // boshlang'ich
      monthlyAmount: Number(p.monthly_amount || 0),   // oylik
      otherAmount: Number(p.other_amount || 0),        // boshqa
      balance: p.balance != null ? Number(p.balance) : null,
      orderId: p.order_id != null ? String(p.order_id) : null,
      matchedBy,
      strong: matchedBy.includes('external_id') || matchedBy.includes('general_id') || matchedBy.includes('transaction_id'),
    });
    const rowsOf = (r: any): any[] => {
      if (!r?.ok) return [];
      const raw: any = r.data?.data ?? r.data;
      return raw?.data ?? (Array.isArray(raw) ? raw : []);
    };
    const evaluate = (p: any): string[] => {
      const ext = String(p.external_id ?? '').trim();
      const pur = String(p.purpose ?? '');
      const pdate = p.date_paid ? String(p.date_paid).slice(0, 10) : '';
      const pamt = Number(p.amount || 0);
      const mb: string[] = [];
      if (core && ext.startsWith(core)) mb.push('external_id');
      if (!mb.includes('external_id') && generalId && generalId !== 'no_general_id' && (ext === generalId || ext.includes(generalId) || pur.includes(generalId))) mb.push('general_id');
      if (num && num !== 'no_num' && (ext.includes(num) || pur.includes(num))) mb.push('num');
      if (isoDate && pdate === isoDate && amtMatch(pamt)) mb.push('sana+summa');
      return mb;
    };

    const candidates: Array<any> = [];
    const sameDate: Array<any> = [];
    let sample: any; let sampleKeys: string[] | undefined;
    let matchSample: any; // topilgan to'lovning XOM qatori (diagnostika — barcha maydon)
    let scanned = 0;
    let via = '';
    const pushMatch = (p: any, mb: string[], viaLabel: string) => {
      via = via || viaLabel;
      candidates.push(rowOut(p, mb));
      if (!matchSample) matchSample = p;
    };

    // TEZKOR: /payment-history/excel'ni FILTR bilan chaqiramiz. Endpoint filtrni
    // respekt qilsa — kichik natija, darrov topiladi; qilmasa — mos qator chiqmaydi,
    // keyingi bosqichga o'tamiz (to'liq skaner). FAQAT mos qatorlarni olamiz (agar
    // filtr e'tiborsiz qoldirilib 5000 ta kelsa, notog'ri nomzod qo'shilmasin).
    const fastTry = async (filters: Record<string, any>, viaLabel: string) => {
      if (candidates.length) return;
      const r: any = await this.callClient('/payment-history/excel', { page: 1, ...filters }, 60_000);
      const rows = rowsOf(r);
      if (rows.length && !sample) { sample = rows[0]; sampleKeys = Object.keys(rows[0] || {}); }
      if (rows.length && rows.length < 4000) scanned += rows.length; // filtr respekt qilingan
      for (const p of rows) {
        const mb = evaluate(p);
        if (mb.length) pushMatch(p, mb, viaLabel);
      }
    };
    // INDEX endpoint (GET) — TO'LIQ maydonlar (type/category/payment_method) shu yerdan keladi.
    const indexTry = async (filters: Record<string, any>, viaLabel: string) => {
      if (candidates.length) return;
      const r: any = await this.callClientGet('/payment-history', { ...filters }, 60_000);
      const rows = rowsOf(r);
      if (rows.length && !sample) { sample = rows[0]; sampleKeys = Object.keys(rows[0] || {}); }
      if (rows.length && rows.length < 4000) scanned += rows.length;
      for (const p of rows) {
        const mb = evaluate(p);
        if (mb.length) pushMatch(p, mb, viaLabel);
      }
    };
    const gidOk = generalId && generalId !== 'no_general_id' && /^\d+$/.test(generalId);
    // 1) INDEX (GET) — to'liq maydonli: avval transaction_id, keyin sana
    if (gidOk) await indexTry({ transaction_id: generalId, limit: 50 }, 'transaction_id');
    if (candidates.length === 0 && isoDate) await indexTry({ date_from: isoDate, date_to: isoDate, limit: 1000 }, 'sana');
    // 2) EXCEL (zaxira) — filtr bilan (contract topadi; type bo'lmasligi mumkin)
    if (candidates.length === 0 && gidOk) await fastTry({ transaction_id: generalId, limit: 500 }, 'transaction_id');
    if (candidates.length === 0 && isoDate) await fastTry({ date_from: isoDate, date_to: isoDate, limit: 3000 }, 'sana');

    // 3) OXIRGI ZAXIRA: /payment-history/excel to'liq skaner (server filtr ishlamasa ham topadi).
    //    external_id core (general_id_num_ddate) bo'yicha ANIQ mos topilsa to'xtaydi.
    if (candidates.length === 0) {
      let page = 1;
      let prevSig = '';
      const MAX_PAGES = 120;
      while (page <= MAX_PAGES) {
        const r: any = await this.getPaymentHistory(page, 5000, 120_000);
        const rows = rowsOf(r);
        if (!rows.length) break;
        const sig = `${rows.length}:${rows[0]?.external_id ?? ''}:${rows[rows.length - 1]?.external_id ?? ''}`;
        if (sig === prevSig) break;
        prevSig = sig;
        if (!sample) { sample = rows[0]; sampleKeys = Object.keys(rows[0] || {}); }
        scanned += rows.length;
        for (const p of rows) {
          const mb = evaluate(p);
          if (mb.length) pushMatch(p, mb, 'scan');
          else if (isoDate && (p.date_paid ? String(p.date_paid).slice(0, 10) : '') === isoDate && sameDate.length < 15) {
            sameDate.push(rowOut(p, ['shu sana']));
          }
        }
        if (candidates.some((c) => c.strong)) break; // aniq (external_id/general_id) topildi — to'xtaymiz
        page++;
      }
    }

    candidates.sort((a, b) => (b.strong ? 1 : 0) - (a.strong ? 1 : 0)); // aniq (strong) tepaga
    return { ok: true, parsed, via, candidates, sameDate, sample, sampleKeys, matchSample, scanned };
  }

  /** Kompozit ID/external_id yadrosi = general_id_num_ddate (yagona, barqaror match kaliti). */
  private compositeCore(s: string): string {
    const t = (s || '').trim();
    const body = t.startsWith('IP_') ? t.slice(3) : t;
    const parts = body.split('_');
    if (parts.length < 3) return '';
    return `${parts[0]}_${parts[1]}_${parts[2]}`;
  }

  /** CRM maydonining o'zbekcha/ruscha nomi ({name:{ru,uz}} yoki string). */
  private ruName(v: any): string | null {
    if (v == null) return null;
    if (typeof v === 'string') return v || null;
    if (typeof v === 'object') {
      if (v.ru || v.uz || v.en) return v.ru || v.uz || v.en;
      if (v.name) {
        if (typeof v.name === 'string') return v.name || null;
        if (typeof v.name === 'object') return v.name.ru || v.name.uz || v.name.en || null;
      }
      if (typeof v.value === 'string') return v.value || null;
      return null;
    }
    return String(v);
  }

  /** CRM to'lov qatoridan qisqa xulosa (batch-match uchun). */
  private crmRowSummary(p: any) {
    return {
      contract: String(p.contract || '').trim(),
      initialAmount: Number(p.initial_amount || 0),
      monthlyAmount: Number(p.monthly_amount || 0),
      otherAmount: Number(p.other_amount || 0),
      amount: Number(p.amount || 0),
      date: p.date_paid ? String(p.date_paid).slice(0, 10) : '',
      object: this.ruName(p.object_name),
      externalId: String(p.external_id ?? '').trim(),
      purpose: p.purpose || '',
      orderId: p.order_id != null ? String(p.order_id) : null,
    };
  }

  /**
   * BATCH: bir nechta kompozit ID (XATO to'lovlar id'lari) bo'yicha CRM'dan mos to'lovni topadi.
   * ID'lar SANA bo'yicha guruhlanadi → har sana uchun BITTA payment-history/excel so'rov
   * (date_from=date_to) → external_id yadrosi (general_id_num_ddate) bo'yicha map → tez match.
   * Faqat ANIQ (yadro mos) natija qaytadi. Har id uchun { id, crm|null }.
   */
  async matchComposites(input: Array<{ id: string; purpose?: string }>): Promise<Array<{ id: string; crm: any | null }>> {
    const list = Array.from(
      new Map(
        (input || [])
          .map((x) => ({ id: String(x?.id || '').trim(), purpose: String(x?.purpose || '') }))
          .filter((x) => x.id)
          .map((x) => [x.id, x] as const),
      ).values(),
    ).slice(0, 300);

    const resultMap = new Map<string, any | null>();

    // ── 1) Kompozit yadro (general_id_num_ddate) bo'yicha — sana guruhli CRM excel ──
    const byDate = new Map<string, string[]>();
    for (const it of list) {
      const p = this.parseComposite(it.id);
      if (!p?.isoDate) continue;
      const arr = byDate.get(p.isoDate) || [];
      arr.push(it.id);
      byDate.set(p.isoDate, arr);
    }
    for (const [isoDate, dateIds] of byDate) {
      const coreMap = new Map<string, any>();
      let page = 1;
      let prevSig = '';
      const MAX = 6;
      while (page <= MAX) {
        const r: any = await this.callClient('/payment-history/excel', { page, limit: 5000, date_from: isoDate, date_to: isoDate }, 90_000);
        if (!r?.ok) break;
        const raw: any = r.data?.data ?? r.data;
        const rows: any[] = raw?.data ?? (Array.isArray(raw) ? raw : []);
        if (!rows.length) break;
        const sig = `${rows.length}:${rows[0]?.external_id ?? ''}:${rows[rows.length - 1]?.external_id ?? ''}`;
        if (sig === prevSig) break;
        prevSig = sig;
        for (const p of rows) {
          const c = this.compositeCore(String(p.external_id ?? ''));
          if (c && !coreMap.has(c)) coreMap.set(c, p);
        }
        const pg = raw?.pagination;
        const totalPage = Number(pg?.totalPage || pg?.total_page || 0);
        if (totalPage && page >= totalPage) break;
        if (rows.length < 5000) break;
        page++;
      }
      for (const id of dateIds) {
        const c = this.compositeCore(id);
        const row = c ? coreMap.get(c) : null;
        if (row) resultMap.set(id, this.crmRowSummary(row));
      }
    }

    // ── 2) XonPay UUID (purpose'dagi XONPAY:(UUID)) bo'yicha — lokal XonpayTransaction ──
    const XONPAY_RE = /XONPAY[:\s]*\(?([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\)?/i;
    const uuidOf = (purpose: string): string | null => {
      const m = (purpose || '').match(XONPAY_RE);
      return m ? m[1].toUpperCase() : null;
    };
    const pending = list.filter((it) => !resultMap.get(it.id) && uuidOf(it.purpose));
    if (pending.length) {
      const uuids = Array.from(new Set(pending.map((it) => uuidOf(it.purpose)!)));
      const variants = uuids.flatMap((u) => [u, u.toLowerCase(), u.toUpperCase()]);
      const xps = await this.prisma.xonpayTransaction.findMany({
        where: { xonpayUuid: { in: variants }, contract: { not: null } },
        select: { xonpayUuid: true, contract: true, amount: true, type: true, datePaid: true, objectName: true, externalId: true, purpose: true },
      });
      const xpMap = new Map<string, any>();
      for (const xp of xps) if (xp.xonpayUuid) xpMap.set(String(xp.xonpayUuid).toUpperCase(), xp);
      for (const it of pending) {
        const xp = xpMap.get(uuidOf(it.purpose)!);
        if (xp?.contract) {
          // CRM 'type' (Ежемесячный платеж / 1 взнос) — qaysi ustunga ekanini aniqlaydi.
          const amt = Number(xp.amount || 0);
          const t = String(xp.type || '').toLowerCase();
          const isInitial = /взнос|перв|initial|boshlang/.test(t);
          const isMonthly = /ежемес|monthly|oylik/.test(t);
          resultMap.set(it.id, {
            contract: String(xp.contract).trim(),
            initialAmount: isInitial ? amt : 0,
            monthlyAmount: isMonthly ? amt : (!isInitial ? amt : 0), // noaniq bo'lsa oylik (ko'pincha)
            otherAmount: 0,
            amount: amt,
            date: xp.datePaid ? new Date(xp.datePaid).toISOString().slice(0, 10) : '',
            object: xp.objectName || null,
            type: xp.type || null,
            externalId: String(xp.externalId || ''),
            purpose: xp.purpose || '',
            orderId: null,
            viaXonpay: true,
          });
        }
      }
    }

    return list.map((it) => ({ id: it.id, crm: resultMap.get(it.id) ?? null }));
  }

  /**
   * Chek sahifasi uchun — shartnoma bo'yicha menejer / sotuv ofisi / obyekt.
   * Bu maydonlar FAQAT /order/index javobida keladi (created_by, branch),
   * /order/show da yo'q. Shu sabab bu yerda /index ishlatiladi.
   */
  async getContractMeta(contract: string) {
    if (!contract?.trim()) return { ok: false, error: 'contract kerak' };
    const target = contract.trim();
    const r = await this.call('/index', {
      contract: target,
      'per-page': 10,
      is_trashed: 1,
      trashed_status: 1,
      with_trashed: 1,
    });
    if (!r.ok) return r;
    const items: any[] = r.data?.data || [];
    if (items.length === 0) return { ok: true, found: false };

    // Aniq moslik (bo'shliq/tire farqlarini e'tiborsiz)
    const norm = (s: any) => String(s || '').replace(/[\s\-_]/g, '').toUpperCase();
    const it = items.find((x) => norm(x.contract) === norm(target)) || items[0];

    const cb = it.created_by || {};
    const managerName = [cb.last_name, cb.first_name, cb.second_name]
      .filter(Boolean)
      .join(' ')
      .trim() || null;
    const object = typeof it.object === 'string'
      ? it.object
      : (it.object?.name || it.object?.uz || it.object?.ru || null);
    const status = it.status?.name?.uz || it.status?.name?.ru || it.status?.type
      || it.virtual_status?.value?.name?.uz || it.virtual_status?.value?.name?.ru || null;

    return {
      ok: true,
      found: true,
      contract: it.contract || target,
      manager: managerName,
      managerPhone: cb.phone != null ? String(cb.phone) : null,
      branchName: cb.branch?.name || null,
      object,
      status,
      clientFullName: it.client_full_name || null,
      apartmentNumber: it.number || null,
    };
  }

  /**
   * Chek Baza tab — jonli autocomplete. Shartnoma bo'yicha /index'dan slim
   * ro'yxat: contract + mijoz + obyekt + menejer + sotuv ofisi (branch).
   * Tanlanganda darrov to'ldirish uchun barcha kerakli maydonlar keladi.
   */
  async searchContracts(contract: string, perPage = 8) {
    const q = contract?.trim();
    if (!q) return { ok: true, items: [] };
    const r = await this.call('/index', {
      contract: q,
      'per-page': perPage,
      is_trashed: 1,
      trashed_status: 1,
      with_trashed: 1,
    });
    if (!r.ok) return r;
    const items = (r.data?.data || []).map((it: any) => {
      const cb = it.created_by || {};
      const manager = [cb.last_name, cb.first_name, cb.second_name].filter(Boolean).join(' ').trim() || null;
      const object = typeof it.object === 'string' ? it.object : (it.object?.name || null);
      const status = it.status?.name?.uz || it.status?.name?.ru || it.status?.type || null;
      return {
        id: it.id != null ? it.id : (it.order_id != null ? it.order_id : null),
        contract: it.contract,
        clientFullName: it.client_full_name || null,
        object,
        apartmentNumber: it.number || null,
        status,
        isTrashed: !!(it.deleted_at || it.is_trashed || it.trashed),
        manager,
        managerPhone: cb.phone != null ? String(cb.phone) : null,
        branchName: cb.branch?.name || null,
      };
    });
    return { ok: true, items };
  }

  /**
   * MySQL'dan to'liq client ma'lumotlarini olish — telefon, pasport, manzil va h.k.
   * Agar baza ulanmasa yoki yozuv topilmasa — null qaytaradi.
   */
  private async fetchClientExtras(contractNumber: string): Promise<Record<string, any> | null> {
    const pool = this.getPool();
    if (!pool) return null;
    try {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT
           date_of_birth, passport_series, passport_issued_by,
           passport_issued_date, passport_expiry_date,
           address_line, phone_primary, phone_secondary,
           floor, entrance, apartment_number, object_name,
           full_name_lotin, full_name_kirill
         FROM contracts
         WHERE contract_number = ? LIMIT 1`,
        [contractNumber],
      );
      const row = (rows as any[])[0];
      if (!row) return null;
      // null/0000-00-00 sanalarni tozalaymiz
      const clean = (v: any) => {
        if (v == null) return undefined;
        if (typeof v === 'string' && (v.startsWith('0000-00-00') || v.trim() === '')) return undefined;
        return v;
      };
      return {
        date_of_birth: clean(row.date_of_birth),
        passport_series: clean(row.passport_series),
        passport_issued_by: clean(row.passport_issued_by),
        passport_issued_date: clean(row.passport_issued_date),
        passport_expiry_date: clean(row.passport_expiry_date),
        address_line: clean(row.address_line),
        phone_primary: clean(row.phone_primary),
        phone_secondary: clean(row.phone_secondary),
        floor: clean(row.floor),
        entrance: clean(row.entrance),
        apartment_number: clean(row.apartment_number),
        object_name: clean(row.object_name),
        full_name_lotin: clean(row.full_name_lotin),
        full_name_kirill: clean(row.full_name_kirill),
      };
    } catch (e: any) {
      this.log.warn(`MySQL fetchClientExtras xato (${contractNumber}): ${e?.message}`);
      return null;
    }
  }

  /**
   * Shartnoma raqami bo'yicha qidiruv — XonSaroy CRM'dan ro'yxat keladi.
   * Har bir natijaga mijoz nomi qo'shiladi:
   *   1) CrmContract keshidan
   *   2) MySQL contracts jadvalidan (full_name_kirill / full_name_lotin)
   *   3) XonSaroy item'idagi har xil nom maydonlari
   */
  async search(contractNumber: string, perPage = 20) {
    if (!contractNumber?.trim()) return { ok: false, error: 'contract kerak' };
    const r = await this.call('/index', {
      contract: contractNumber.trim(),
      'per-page': perPage,
      cancelled: 1,  // bekor qilinganlar ham
      is_trashed: 1, // XonSaroy CRM Laravel SoftDelete: withTrashed = active + trashed
      trashed_status: 1,
      with_trashed: 1,
    });
    this.log.log(`CRM /search → /index (contract=${contractNumber}, is_trashed=1, status=${(r as any).ok ? 'OK' : (r as any).status || 'err'})`);
    if (!r.ok) return r;
    const items: any[] = r.data?.data || [];
    this.log.log(`  → ${items.length} ta item topildi`);

    if (items.length === 0) return { ok: true, total: 0, items: [] };

    const contracts = items
      .map((it) => String(it.contract || it.id || '').trim().toUpperCase())
      .filter(Boolean);

    // 1) CrmContract keshidan
    const cached = contracts.length > 0
      ? await this.prisma.crmContract.findMany({
          where: { contractNumber: { in: contracts } },
          select: { contractNumber: true, customerName: true },
        })
      : [];
    const cacheMap = new Map(cached.map((c) => [c.contractNumber, c.customerName]));

    // 2) MySQL contracts jadvalidan (yo'q bo'lganlar uchun)
    const missingContracts = contracts.filter((c) => !cacheMap.get(c));
    const pool = this.getPool();
    if (pool && missingContracts.length > 0) {
      try {
        const placeholders = missingContracts.map(() => '?').join(',');
        const [rows] = await pool.query<mysql.RowDataPacket[]>(
          `SELECT contract_number, full_name_kirill, full_name_lotin
           FROM contracts WHERE UPPER(contract_number) IN (${placeholders}) LIMIT ${missingContracts.length}`,
          missingContracts,
        );
        for (const row of rows as any[]) {
          const num = String(row.contract_number || '').toUpperCase();
          const name = row.full_name_kirill || row.full_name_lotin || null;
          if (num && name) cacheMap.set(num, name);
        }
      } catch (e: any) {
        this.log.warn(`MySQL search enrichment xato: ${e?.message}`);
      }
    }

    // XonSaroy CRM clientName builder — {first_name: {lotin, kirill}, last_name: {...}, ...}
    const extractClientName = (it: any): string | null => {
      const c = it.client || it.client_name;
      if (!c) return null;
      // String holatda — to'g'ridan-to'g'ri
      if (typeof c === 'string') return c.trim() || null;
      // Object holatda — {first_name: {lotin, kirill}, ...}
      const f = (v: any): string => {
        if (!v) return '';
        if (typeof v === 'string') return v;
        return v.kirill || v.lotin || '';
      };
      const name = [f(c.last_name), f(c.first_name), f(c.middle_name)]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (name) return name;
      // Fallback alohida maydonlar
      return c.full_name_kirill || c.full_name_lotin || c.full_name || c.name || c.fio || null;
    };

    // 3) Har bir natijaga customerName qo'shamiz — FAQAT F.I.O. (object/residence emas)
    const enriched = items.map((it) => {
      const num = String(it.contract || it.id || '').trim().toUpperCase();
      const customerName = cacheMap.get(num)
        || extractClientName(it)
        || it.fio
        || it.full_name
        || it.full_name_kirill
        || it.full_name_lotin
        || null;
      // it.object / it.object_name ATAYLAB tashlab ketildi — bu OBYEKT nomi, mijoz emas
      return { ...it, customerName };
    });

    // 4) Nomi yo'q natijalar uchun /show chaqirish (parallel, max 10)
    const missingName = enriched.filter((it) => !it.customerName).slice(0, 10);
    if (missingName.length > 0) {
      // /show'ni har item uchun chaqirish — contract va id ikkalasini ham urin
      const showResults = await Promise.allSettled(
        missingName.map(async (it) => {
          const contract = String(it.contract || '').trim();
          const id = it.id;
          // Birinchi contract bilan
          let res = await this.show({ contract });
          // Agar ok bo'lmasa va id bo'lsa — id bilan urinish
          if (!(res as any)?.ok && id) {
            res = await this.show({ id });
          }
          return res;
        }),
      );
      const showMap = new Map<string, string>();
      for (let i = 0; i < missingName.length; i++) {
        const res = showResults[i];
        if (res.status === 'fulfilled' && (res.value as any)?.detail) {
          const detail: any = (res.value as any).detail;
          // Avval extractClientName helper bilan (object → last+first+middle)
          // Keyin oddiy maydonlar (object nomi YO'Q — F.I.O. emas)
          const name = extractClientName(detail)
            || detail.fio
            || detail.full_name_kirill
            || detail.full_name_lotin
            || detail.full_name
            || detail.client_name
            || null;
          if (name) {
            const num = String(missingName[i].contract || missingName[i].id || '').trim().toUpperCase();
            showMap.set(num, name);
            // CrmContract keshiga ham yozamiz (keyingi safar tez)
            try {
              const crmOrderId = detail.id != null ? String(detail.id).slice(0, 64)
                : (detail.order_id != null ? String(detail.order_id).slice(0, 64) : null);
              await this.prisma.crmContract.upsert({
                where: { contractNumber: num },
                create: {
                  contractNumber: num,
                  customerName: name,
                  status: String(detail.status || '').toLowerCase() || null,
                  objectName: detail.object_name || null,
                  crmOrderId,
                  found: true,
                },
                update: {
                  customerName: name,
                  crmOrderId,
                  found: true,
                  lastVerifiedAt: new Date(),
                },
              });
            } catch { /* ignore */ }
          }
        } else if (res.status === 'rejected') {
          this.log.warn(`/show xato (${missingName[i].contract}): ${res.reason}`);
        }
      }
      // Enriched'ga nomlarni qo'shamiz
      for (const it of enriched) {
        if (!it.customerName) {
          const num = String(it.contract || it.id || '').trim().toUpperCase();
          const name = showMap.get(num);
          if (name) it.customerName = name;
        }
      }
    }

    return { ok: true, total: enriched.length, items: enriched };
  }

  /**
   * Bitta shartnoma tafsilotini olish — to'liq schedule + payment history bilan.
   * Agar MySQL ulanishi bo'lsa, client'ga qo'shimcha ma'lumotlar ham qo'shiladi
   * (telefon, pasport, manzil va h.k.).
   */
  async show(opts: { contract?: string; id?: string | number; payerHint?: string }) {
    if (!opts.contract && !opts.id) return { ok: false, error: 'contract yoki id kerak' };
    const contractInput = opts.contract?.trim() || '';

    // ── DUBLIKAT DIZAMBIGUATSIYA ──
    // Bitta shartnoma raqami CRM'да BIR NECHTA bo'lishi mumkin (masalan "821ZUR23V1"
    // ikki xil mijozда). payerHint (to'lov izohi matni) berilса, /index barcha
    // nomzodlarni beradi va izohдаги ism-familyaga MOS kelganini tanlaymiz.
    if (contractInput && opts.payerHint) {
      const picked = await this.pickContractByName(contractInput, opts.payerHint);
      if (picked) {
        let detail: any = picked;
        // To'liq, kanonik detail — id bo'yicha /show (id aniq, dublikatsiz)
        if (picked.id != null) {
          const full: any = await this.call('/show', { id: picked.id, is_trashed: 1, trashed_status: 1, with_trashed: 1 });
          const fd = full.ok ? (full.data?.data || null) : null;
          if (fd) detail = fd;
        }
        const cn = String(detail.contract || contractInput).trim();
        const extras = await this.fetchClientExtras(cn);
        if (extras) detail.client = { ...(detail.client || {}), ...extras };
        return { ok: true, detail };
      }
      // picked null → nomzod yo'q yoki ishonchli tanlov yo'q → oddiy oqimga tushamiz
    }

    const body: Record<string, any> = {};
    if (opts.contract) body.contract = opts.contract.trim();
    else body.id = opts.id;
    // ── XonSaroy CRM Laravel SoftDelete logikasi ──
    // PHP backend:
    //   if (!empty($data['trashed_status']) && $service->is_soft_delete()) {
    //     case -1: onlyTrashed; case 1: withTrashed; default: activeOnly;
    //   }
    // To'g'ri param nomi: trashed_status=1 (with trashed)
    // XonSaroy CRM aniqlangan param: is_trashed=1 (active + trashed birga)
    // Aniq URL misol: app.xonsaroy.uz/contracts?limit=20&is_trashed=1
    // MINIMAL param to'plami — searchContracts (qo'lда qidiruv, ishlaydi) bilan bir xil.
    // Ilgari status:'all' / cancelled:1 kabi ortiqcha paramlar CRM query'sini buzib
    // (WHERE status='all' → 0 natija) ba'zi contractlarni topilmas qilardi.
    // is_trashed=1 active + trashed ikkalasini birga qaytaradi.
    body.is_trashed = 1;
    body.trashed_status = 1;
    body.with_trashed = 1;
    const r = await this.call('/show', body);
    let detail: any = r.ok ? (r.data?.data || null) : null;
    const contractNo = (opts.contract || detail?.contract || '').toString().trim();

    // ── FALLBACK: /show 404 qaytsa, /index orqali urunish (deleted/cancelled uchun) ──
    if (!detail && contractNo) {
      try {
        // MUHIM: aynan searchContracts (qo'lда qidiruv — ISHLAYDI) bilan bir xil
        // MINIMAL param to'plami. Ilgari qo'shilgan status:'all' / cancelled:1 kabi
        // ortiqcha paramlar CRM query'sini buzib (masalan WHERE status='all' → 0 natija,
        // yoki faqat bekor qilinganlarni qaytarib) avto lookup'ни topilmas qilardi.
        // is_trashed=1 allaqachon active + trashed contractlarni birga qaytaradi.
        const idxRes = await this.call('/index', {
          contract: contractNo,
          'per-page': 50,
          is_trashed: 1,
          trashed_status: 1,
          with_trashed: 1,
        });
        if (idxRes.ok) {
          const items: any[] = idxRes.data?.data || [];
          this.log.log(`CRM /index fallback: ${contractNo} uchun ${items.length} ta item topildi`);
          // 1) Exact match (UPPER)
          const exact = items.find((it) => String(it.contract || '').toUpperCase() === contractNo.toUpperCase());
          if (exact) {
            detail = exact;
            this.log.log(`  → exact match: status=${exact.status || '-'}`);
          } else if (items.length > 0) {
            // 2) Trimmed/normalized match (whitespace, dash, slash, nuqta bilan farqlar)
            // Masalan "393FZO26RNK/SH" (izohda) ~ "393FZO26RNK-SH" (CRM) — ajratuvchi farqi.
            const norm = (s: string) => s.replace(/[\s\-_./]/g, '').toUpperCase();
            const target = norm(contractNo);
            const fuzzy = items.find((it) => norm(String(it.contract || '')) === target);
            if (fuzzy) {
              detail = fuzzy;
              this.log.log(`  → normalized match: ${fuzzy.contract} (status=${fuzzy.status || '-'})`);
            } else {
              // Topilmadi — sample log qilamiz
              const sample = items.slice(0, 3).map((i) => i.contract).join(', ');
              this.log.log(`  → exact/normalized match yo'q. Sample: ${sample}`);
            }
          }
        } else {
          this.log.warn(`CRM /index fallback xato: ${(idxRes as any).status} ${(idxRes as any).error?.slice(0, 150)}`);
        }
      } catch (e: any) {
        this.log.warn(`CRM /show -> /index fallback xato (${contractNo}): ${e?.message}`);
      }
    }

    if (detail && contractNo) {
      const extras = await this.fetchClientExtras(contractNo);
      if (extras) {
        detail.client = { ...(detail.client || {}), ...extras };
      }
    }

    if (!detail) {
      // 422 'The selected contract is invalid' — bu trashed contractlar uchun
      // normal javob (CRM globalValidation rejects). Foydalanuvchiga xato
      // qaytarmasdan, sokin null qaytaramiz — fallback /index muvaffaqiyatsiz
      // bo'lsa ham, ariza/manual saqlash davom etishi mumkin.
      const isValidationError = !r.ok
        && (r as any).status === 422
        && /selected contract is invalid/i.test(JSON.stringify((r as any).error || ''));
      if (isValidationError) {
        this.log.log(`CRM /show 422 (validation) + /index miss → silent null (contract=${contractNo})`);
        return { ok: true, detail: null };
      }
      if (!r.ok) return r;
      return { ok: true, detail: null };
    }
    return { ok: true, detail };
  }

  // ─────────── Dublikat shartnoma: izohдаги ism bo'yicha tanlash ───────────

  /** Kirill → lotin fonetik translit (ism solishtiruvi uchun). Faqat harflar qoladi. */
  private nameTranslit(s: string): string {
    const map: Record<string, string> = {
      'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'E', 'Ж': 'J',
      'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O',
      'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'X', 'Ц': 'S',
      'Ч': 'C', 'Ш': 'S', 'Щ': 'S', 'Ъ': '', 'Ы': 'I', 'Ь': '', 'Э': 'E', 'Ю': 'U',
      'Я': 'A', 'Ў': 'O', 'Қ': 'Q', 'Ғ': 'G', 'Ҳ': 'H',
    };
    let out = '';
    for (const ch of String(s || '').toUpperCase()) out += (map[ch] !== undefined ? map[ch] : ch);
    return out.replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** CRM nomining necha bo'lagi (≥4 harf) izoh matnida uchraydi. */
  private nameScore(crmName: string, hintText: string): number {
    const H = this.nameTranslit(hintText);
    if (!H) return 0;
    const tokens = this.nameTranslit(crmName).split(' ').filter((t) => t.length >= 4);
    let hits = 0;
    for (const t of tokens) if (H.includes(t)) hits++;
    return hits;
  }

  /** CRM nomi izoh matniga ishonchli mos keladimi (kamida 2 bo'lak, yoki bitta bo'lakli nom). */
  matchesPayer(crmName: string | null | undefined, hintText: string | null | undefined): boolean {
    if (!crmName || !hintText) return false;
    const tokens = this.nameTranslit(crmName).split(' ').filter((t) => t.length >= 4);
    const score = this.nameScore(crmName, hintText);
    return score >= 2 || (tokens.length <= 1 && score >= 1);
  }

  private clientNameOf(it: any): string {
    if (!it) return '';
    if (it.client_full_name) return String(it.client_full_name).trim();
    const c = it.client;
    if (c) {
      if (typeof c === 'string') return c.trim();
      const src = c.attributes || c;
      const name = [src.last_name, src.first_name, src.middle_name].filter(Boolean).join(' ').trim();
      if (name) return name;
      return String(src.full_name_lotin || src.full_name_kirill || src.full_name || '').trim();
    }
    return String(it.fio || '').trim();
  }

  /**
   * Shartnoma raqami bo'yicha CRM'да BIR NECHTA nomzod bo'lsa — izohдаги ismга
   * qarab TO'G'RISINI tanlaydi. Bitta nomzod bo'lsa — o'shani. Ishonchli tanlov
   * bo'lmasa (ism mos kelmasa) — null (chaqiruvchi oddiy oqimga tushadi).
   */
  private async pickContractByName(contractNo: string, hint: string): Promise<any | null> {
    try {
      const idxRes: any = await this.call('/index', {
        contract: contractNo, 'per-page': 50, is_trashed: 1, trashed_status: 1, with_trashed: 1,
      });
      if (!idxRes.ok) return null;
      const items: any[] = idxRes.data?.data || [];
      if (!items.length) return null;
      const norm = (s: string) => String(s || '').replace(/[\s\-_./]/g, '').toUpperCase();
      const target = norm(contractNo);
      const matches = items.filter((it) => norm(it.contract) === target);
      if (matches.length === 0) return null;
      if (matches.length === 1) return matches[0];
      // Bir nechta — ism bo'yicha ballab tanlaymiz
      const scored = matches
        .map((it) => ({ it, score: this.nameScore(this.clientNameOf(it), hint) }))
        .sort((a, b) => b.score - a.score);
      if (scored[0].score >= 2 && scored[0].score > (scored[1]?.score ?? 0)) {
        this.log.log(`CRM dublikat (${contractNo}): ${matches.length} ta — ism bo'yicha "${this.clientNameOf(scored[0].it)}" tanlandi (ball ${scored[0].score})`);
        return scored[0].it;
      }
      this.log.warn(`CRM dublikat (${contractNo}): ${matches.length} ta, izohдаги ismга aniq mos yo'q — tanlanmadi`);
      return null;
    } catch (e: any) {
      this.log.warn(`pickContractByName xato (${contractNo}): ${e?.message}`);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //        PLANIROVKA — shartnoma rasm/hujjat (CRM media)
  // ═══════════════════════════════════════════════════════════════

  /** CRM'dan keladigan qiymat string yoki {uz,ru,...} obyekt bo'lishi mumkin — matnga keltiradi. */
  private asText(v: any): string | null {
    if (v == null) return null;
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'object') {
      return (
        (typeof v.uz === 'string' && v.uz) ||
        (typeof v.ru === 'string' && v.ru) ||
        (typeof v.en === 'string' && v.en) ||
        (v.name ? this.asText(v.name) : null) ||
        (v.value ? this.asText(v.value) : null) ||
        null
      );
    }
    return String(v);
  }

  /**
   * Shartnoma bo'yicha planirovka rasm(lar)i va hujjat URL'ini qaytaradi.
   *
   * Manba: CRM /order/INDEX javobidagi plan_images[] va plan_drawings[]
   * (har biri { id, name, image=presigned S3 URL, path }). /show'da bu
   * maydonlar yo'q. Presigned .image bevosita <img> da yuklanadi (~5 daqiqa amal qiladi).
   */
  async contractMedia(contractNo: string) {
    const contract = (contractNo || '').trim();
    if (!contract) return { ok: false, error: 'contract kerak' };

    // Planirovka rasmlari CRM /order/INDEX javobida keladi:
    //   plan_images[]  = [{ id, name, image (presigned S3 URL), path }]
    //   plan_drawings[] = [{ ... }]
    // /show'da bu maydonlar YO'Q — shuning uchun /index ishlatamiz.
    // is_trashed=1 — bekor/o'chirilgan shartnoma bo'lsa ham topamiz.
    const r: any = await this.call('/index', {
      contract,
      'per-page': 20,
      is_trashed: 1,
      trashed_status: 1,
      with_trashed: 1,
    }).catch(() => null);
    const items: any[] = r?.ok ? (r.data?.data || []) : [];

    const norm = (s: any) => String(s || '').replace(/[\s\-_]/g, '').toUpperCase();
    const target = norm(contract);
    const it = items.find((x) => norm(x.contract) === target) || items[0] || null;

    if (!it) {
      return {
        ok: true, contract, plans: [] as string[], contractDoc: null,
        apartmentNumber: null, objectName: null, typeName: null,
        crmConnected: !!(r && r.ok),
      };
    }

    // plan_images + plan_drawings dan rasm URL'larini yig'amiz (presigned .image afzal)
    const byPath = new Map<string, string>();
    const pushImgs = (arr: any) => {
      if (!Array.isArray(arr)) return;
      for (const im of arr) {
        let url: string | null =
          typeof im?.image === 'string' && im.image.trim() ? im.image.trim() : null;
        if (!url && im?.path) url = PLAN_S3_BASE + String(im.path).replace(/^\/+/, '');
        if (!url || /noimage/i.test(url)) continue;
        const key = url.split('?')[0];
        const signed = /[?&]X-Amz/i.test(url);
        const prev = byPath.get(key);
        if (!prev || (signed && !/[?&]X-Amz/i.test(prev))) byPath.set(key, url);
      }
    };
    pushImgs(it.plan_images);
    pushImgs(it.plan_drawings);
    const plans = [...byPath.values()];

    const objectName = this.asText(it.object) || this.asText(it.object_name) || null;
    const apartmentNumber = this.asText(it.number) || null;
    const typeName: string | null = null;
    const contractDoc = this.asText(it.contract_path_temp) || null;

    this.log.log(`contractMedia(${contract}): ${plans.length} ta planirovka topildi (/index)`);

    const out: any = {
      ok: true, contract, plans, contractDoc, apartmentNumber, objectName, typeName, crmConnected: true,
    };
    // Plan bo'sh bo'lsa — debug (frontend "topilmadi" ekranida ko'rsatiladi)
    if (plans.length === 0) {
      let planDump: string | null = null;
      try {
        planDump = JSON.stringify({ plan_images: it.plan_images, plan_drawings: it.plan_drawings }).slice(0, 2500);
      } catch { planDump = null; }
      out.debug = {
        orderApartments: 0,
        detailKeys: (() => { try { return Object.keys(it).join(', ').slice(0, 500); } catch { return ''; } })(),
        hasApartment: false,
        hasPlan: !!(Array.isArray(it.plan_images) && it.plan_images.length),
        plan: planDump,
        orderApartment0: null,
        info: null,
      };
    }
    return out;
  }

  /**
   * Planirovka rasmini backend orqali stream qilib beradi (yuklab olish uchun).
   * S3 presigned URL'da CORS/expiry muammosini chetlab o'tadi.
   * Xavfsizlik: faqat ishonchli S3 host (xny-buildit ... amazonaws.com).
   */
  async streamPlanImage(url: string, filename: string, res: any) {
    let u: URL;
    try { u = new URL(url); } catch { res.status(400).json({ ok: false, error: "URL noto'g'ri" }); return; }
    const host = u.hostname.toLowerCase();
    if (!host.endsWith('.amazonaws.com') || !/xny-buildit/i.test(url)) {
      res.status(400).json({ ok: false, error: 'Ruxsat etilmagan manba' });
      return;
    }
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) { res.status(502).json({ ok: false, error: `Rasm olinmadi (${r.status})` }); return; }
      const ct = r.headers.get('content-type') || 'application/octet-stream';
      const buf = Buffer.from(await r.arrayBuffer());
      let safe = (filename || 'planirovka').replace(/[^\w.\- ]+/g, '_').trim() || 'planirovka';
      if (!/\.[a-z0-9]{2,5}$/i.test(safe)) {
        const ext = ct.includes('png') ? 'png'
          : ct.includes('webp') ? 'webp'
          : (ct.includes('jpeg') || ct.includes('jpg')) ? 'jpg'
          : ct.includes('pdf') ? 'pdf' : 'img';
        safe = `${safe}.${ext}`;
      }
      res.setHeader('Content-Type', ct);
      res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
      res.setHeader('Content-Length', String(buf.length));
      res.end(buf);
    } catch (e: any) {
      res.status(502).json({ ok: false, error: e?.message || 'Yuklab olishda xato' });
    } finally {
      clearTimeout(tm);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //        TO'LOV JADVALI (schedule) — "Plan bo'yicha to'lov" uchun
  // ═══════════════════════════════════════════════════════════════

  /**
   * Aktiv shartnomalar ro'yxati (CRM /order/index, paginatsiya).
   * Trashed paramlar yo'q — bekor/o'chirilganlar chiqmaydi.
   */
  async listContractsPage(page = 1, perPage = 50): Promise<{
    ok: boolean;
    items: Array<{ contract: string; object: string | null; clientName: string | null; status: string | null; percentagePaid: number; archived: boolean; deleted: boolean }>;
    totalPage: number;
    totalItem: number;
    current: number;
    perPage: number;
  }> {
    const r = await this.call('/index', { page, 'per-page': perPage });
    if (!r.ok) return { ok: false, items: [], totalPage: 0, totalItem: 0, current: page, perPage };
    const items = ((r.data?.data as any[]) || []).map((it) => ({
      contract: String(it.contract || '').trim(),
      object: typeof it.object === 'string' ? it.object : (it.object?.name || this.asText(it.object) || null),
      clientName: it.client_full_name || null,
      status: it.status?.name?.uz || it.status?.name?.ru || it.status?.type || null,
      percentagePaid: Number(it.percentage_paid || 0),
      archived: !!it.archived,
      deleted: !!it.deleted_at,
    })).filter((x) => x.contract);
    const pg = (r.data?.pagination as any) || {};
    return {
      ok: true,
      items,
      totalPage: Number(pg.totalPage || pg.total_page || 0),
      totalItem: Number(pg.totalItem || pg.total_item || 0),
      current: Number(pg.current || page),
      perPage: Number(pg.perPage || pg.per_page || perPage),
    };
  }

  /**
   * BULK: /index sahifasidan har shartnoma + sotuv bo'limi (created_by.branch.name).
   * branch backfill'ni tezlashtirish uchun — 100 tadan (1 tadan emas). trashed'lar ham.
   */
  async listContractBranchesPage(page = 1, perPage = 100): Promise<{
    ok: boolean;
    items: Array<{ contract: string; branchName: string }>;
    totalPage: number;
  }> {
    const r = await this.call('/index', { page, 'per-page': perPage, is_trashed: 1, trashed_status: 1, with_trashed: 1 });
    if (!r.ok) return { ok: false, items: [], totalPage: 0 };
    const items = ((r.data?.data as any[]) || []).map((it) => ({
      contract: String(it.contract || '').trim(),
      branchName: it.created_by?.branch?.name ? String(it.created_by.branch.name).slice(0, 255) : '',
    })).filter((x) => x.contract);
    const pg = (r.data?.pagination as any) || {};
    return { ok: true, items, totalPage: Number(pg.totalPage || pg.total_page || 0) };
  }

  /**
   * Bitta shartnoma to'lov jadvali (grafik) — CRM /order/show'dan.
   * initial.schedules[] + monthly.schedules[] → har installment.
   */
  async getContractSchedules(contract: string): Promise<{
    ok: boolean;
    status: string | null;
    schedules: Array<{ scheduleId: string; dueDate: string; amount: number; amountPaid: number; remaining: number; kind: 'initial' | 'monthly' }>;
  }> {
    const c = (contract || '').trim();
    if (!c) return { ok: false, status: null, schedules: [] };
    const r = await this.call('/show', { contract: c });
    const d: any = r.ok ? (r.data?.data || null) : null;
    if (!d) return { ok: false, status: null, schedules: [] };

    const out: Array<{ scheduleId: string; dueDate: string; amount: number; amountPaid: number; remaining: number; kind: 'initial' | 'monthly' }> = [];
    const push = (arr: any, kind: 'initial' | 'monthly') => {
      if (!Array.isArray(arr)) return;
      for (const s of arr) {
        const dp = s?.date_payment ? String(s.date_payment).slice(0, 10) : null;
        if (s?.id == null || !dp) continue;
        const amount = Number(s.amount || 0);
        const paid = Number(s.amount_paid || 0);
        const left = s.left != null ? Number(s.left) : amount - paid;
        out.push({ scheduleId: String(s.id), dueDate: dp, amount, amountPaid: paid, remaining: left, kind });
      }
    };
    push(d.initial?.schedules, 'initial');
    push(d.monthly?.schedules, 'monthly');
    const status = this.asText(d.status?.name) || this.asText(d.status?.type) || this.asText(d.virtual_status?.value?.name) || null;
    return { ok: true, status, schedules: out };
  }

}
