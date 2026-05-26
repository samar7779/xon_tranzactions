import { Injectable, Logger } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { PrismaService } from '../common/prisma/prisma.service';

const XONSAROY_BASE_URL = process.env.XONSAROY_API_URL || 'https://app-api.xonsaroy.uz/api/v4/client/order';
// payment-history endpoint /client/order DAN tashqarida — /client/payment-history
const XONSAROY_CLIENT_BASE = process.env.XONSAROY_CLIENT_BASE || 'https://app-api.xonsaroy.uz/api/v4/client';
const XONSAROY_KEY = process.env.XONSAROY_API_KEY || 'G0C2kwSk3e3AnEZUMJhq067ZM5s9Wkuc';
const XONSAROY_SECRET = process.env.XONSAROY_API_SECRET || 'w1qBTE76Y4PKsbLeLjd2gt8UDDSHYJl0';

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
    });
    if (!r.ok) return r;
    const items: any[] = r.data?.data || [];

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
    // Laravel SoftDelete + Microcrud uchun deleted/cancelled qatorlarni ham qaytarish
    // (XonSaroy noma'lum parametrlarni e'tiborsiz qoldiradi)
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
          cancelled: 1,
          is_cancelled: 1,
          include_cancelled: 1,
          with_cancelled: 1,
          status: 'all',
          // Laravel SoftDelete: deleted_at to'ldirilgan rowlar
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
      if (!r.ok) return r;
      return { ok: true, detail: null };
    }
    return { ok: true, detail };
  }

}
