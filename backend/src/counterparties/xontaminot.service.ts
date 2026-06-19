import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Pool } from 'pg';

/**
 * Xontaminot loyihasidan READ-ONLY ulanish.
 *
 * Bu loyiha xontaminot DB'sidagi `taminotchilar` jadvalidan kontragent
 * ma'lumotlarini o'qiydi. **Hech qanday yozish/o'chirish/tahrir qilmaydi.**
 *
 * Env: XONTAMINOT_DATABASE_URL — agar bo'sh bo'lsa service ishlamaydi
 *      (sync funksiyasi xato qaytaradi).
 */

export interface XontaminotSupplier {
  inn: string;
  name: string;
  director: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  bank: string | null;
  account: string | null;
  vatStatus: string | null;
  vatStatusCode: number | null;
  rating: number | null;
  ratingType: string | null;
  ratingTitle: string | null;
  opf: string | null;
  pinfl: string | null;
  blacklisted: boolean;
}

@Injectable()
export class XontaminotService implements OnModuleDestroy {
  private readonly log = new Logger(XontaminotService.name);
  private pool: Pool | null = null;

  constructor(private cfg: ConfigService) {}

  private getPool(): Pool {
    if (this.pool) return this.pool;
    const url = this.cfg.get<string>('XONTAMINOT_DATABASE_URL');
    if (!url) {
      throw new Error('XONTAMINOT_DATABASE_URL env sozlanmagan');
    }
    this.pool = new Pool({
      connectionString: url,
      max: 3,                       // kichik connection limit — read-only
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000,    // 30s — katta query'lar uchun
    });
    this.pool.on('error', (err) => {
      this.log.error(`Xontaminot pool xatosi: ${err.message}`);
    });
    return this.pool;
  }

  isConfigured(): boolean {
    return !!this.cfg.get<string>('XONTAMINOT_DATABASE_URL');
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }

  /**
   * Xontaminot DB'dagi BARCHA taminotchilar (kontragentlar)ni qaytaradi.
   * Faqat INN'i bor va bo'sh emas bo'lganlarni.
   *
   * @returns kontragentlar ro'yxati
   */
  async fetchAllSuppliers(): Promise<XontaminotSupplier[]> {
    if (!this.isConfigured()) {
      throw new Error('XONTAMINOT_DATABASE_URL sozlanmagan');
    }

    const pool = this.getPool();
    const startTime = Date.now();
    try {
      const result = await pool.query<any>(`
        SELECT
          inn,
          name,
          director,
          phone,
          email,
          address,
          bank,
          account,
          vat_status,
          vat_status_code,
          rating,
          rating_type,
          rating_title,
          opf,
          pinfl,
          COALESCE(blacklisted, false) AS blacklisted
        FROM public.taminotchilar
        WHERE inn IS NOT NULL
          AND TRIM(inn) <> ''
          AND status = 'active'
        ORDER BY id ASC
      `);

      const duration = Date.now() - startTime;
      this.log.log(`Xontaminot fetch: ${result.rows.length} ta yozuv (${duration}ms)`);

      // INN bo'yicha dedup (agar takror bo'lsa, oxirgisi qoladi)
      const map = new Map<string, XontaminotSupplier>();
      for (const r of result.rows) {
        const inn = String(r.inn).trim();
        if (!inn) continue;
        map.set(inn, {
          inn,
          name: r.name || '',
          director: r.director || null,
          phone: r.phone || null,
          email: r.email || null,
          address: r.address || null,
          bank: r.bank || null,
          account: r.account || null,
          vatStatus: r.vat_status || null,
          vatStatusCode: r.vat_status_code != null ? Number(r.vat_status_code) : null,
          rating: r.rating != null ? Number(r.rating) : null,
          ratingType: r.rating_type || null,
          ratingTitle: r.rating_title || null,
          opf: r.opf || null,
          pinfl: r.pinfl || null,
          blacklisted: !!r.blacklisted,
        });
      }
      return [...map.values()];
    } catch (e: any) {
      this.log.error(`Xontaminot query xato: ${e?.message}`);
      throw e;
    }
  }

  /** Test connection — UI'da yoki health-check'da ishlatish uchun. */
  async testConnection(): Promise<{ ok: boolean; suppliersCount?: number; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: 'XONTAMINOT_DATABASE_URL sozlanmagan' };
    }
    try {
      const pool = this.getPool();
      const r = await pool.query('SELECT COUNT(*)::int AS c FROM public.taminotchilar WHERE inn IS NOT NULL AND TRIM(inn) <> \'\' AND status = \'active\'');
      return { ok: true, suppliersCount: r.rows[0]?.c || 0 };
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }
}
