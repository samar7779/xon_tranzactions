import { Injectable, Logger } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { PrismaService } from '../common/prisma/prisma.service';

const XONSAROY_BASE_URL = process.env.XONSAROY_API_URL || 'https://app-api.xonsaroy.uz/api/v4/client/order';
// payment-history endpoint /client/order DAN tashqarida — /client/payment-history
const XONSAROY_CLIENT_BASE = process.env.XONSAROY_CLIENT_BASE || 'https://app-api.xonsaroy.uz/api/v4/client';
const XONSAROY_KEY = process.env.XONSAROY_API_KEY || 'G0C2kwSk3e3AnEZUMJhq067ZM5s9Wkuc';
const XONSAROY_SECRET = process.env.XONSAROY_API_SECRET || 'w1qBTE76Y4PKsbLeLjd2gt8UDDSHYJl0';

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

  private async callUrl(url: string, body: Record<string, any>, timeoutMs: number) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v != null) form.set(k, String(v));
    }
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
        this.log.warn(`XonSaroy ${url} -> ${res.status}: ${text.slice(0, 200)}`);
        return { ok: false, status: res.status, error: text };
      }
      try {
        return { ok: true, data: JSON.parse(text) };
      } catch {
        return { ok: false, status: 200, error: 'Invalid JSON', raw: text };
      }
    } catch (e: any) {
      this.log.error(`XonSaroy ${url} error: ${e?.message}`);
      return { ok: false, error: e?.message || 'Network error' };
    } finally {
      clearTimeout(tm);
    }
  }

  /**
   * Bulk payment history — XonSaroy CRM dan to'lovlar ro'yxati (paginatsiya bilan).
   * Python skriptdagi /payment-history/excel endpointi.
   * Bir sahifada 5000 tagacha qaytaradi (limit parametri).
   */
  async getPaymentHistory(page = 1, limit = 5000) {
    return this.callClient('/payment-history/excel', { page, limit }, 60_000);
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
              await this.prisma.crmContract.upsert({
                where: { contractNumber: num },
                create: {
                  contractNumber: num,
                  customerName: name,
                  status: String(detail.status || '').toLowerCase() || null,
                  objectName: detail.object_name || null,
                  found: true,
                },
                update: {
                  customerName: name,
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
  async show(opts: { contract?: string; id?: string | number }) {
    if (!opts.contract && !opts.id) return { ok: false, error: 'contract yoki id kerak' };
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
    body.is_trashed = 1;
    // Eski variantlar — xavfsizlik uchun qoldiramiz (boshqa endpoint'lar uchun)
    body.trashed_status = 1;
    body.trashed = 1;
    body.with_trashed = 1;
    body.with_deleted = 1;
    body.include_trashed = 1;
    body.include_deleted = 1;
    body.cancelled = 1;
    body.with_cancelled = 1;
    body.status = 'all';
    const r = await this.call('/show', body);
    let detail: any = r.ok ? (r.data?.data || null) : null;
    const contractNo = (opts.contract || detail?.contract || '').toString().trim();

    // ── FALLBACK: /show 404 qaytsa, /index orqali urunish (deleted/cancelled uchun) ──
    if (!detail && contractNo) {
      try {
        const idxRes = await this.call('/index', {
          contract: contractNo,
          'per-page': 50,
          // PRIMARY — XonSaroy CRM URL'da aniqlangan: is_trashed=1
          is_trashed: 1,
          // Eski variantlar — boshqa endpoint'lar uchun xavfsizlik
          trashed_status: 1,
          cancelled: 1,
          is_cancelled: 1,
          include_cancelled: 1,
          with_cancelled: 1,
          status: 'all',
          trashed: 1,
          with_trashed: 1,
          with_deleted: 1,
          include_trashed: 1,
          include_deleted: 1,
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
            // 2) Trimmed/normalized match (whitespace, dash bilan farqlar)
            const norm = (s: string) => s.replace(/[\s\-_]/g, '').toUpperCase();
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

}
