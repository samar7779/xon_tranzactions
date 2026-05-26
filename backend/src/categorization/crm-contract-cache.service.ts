import { Injectable, Logger } from '@nestjs/common';
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

  /**
   * Shartnoma raqami bo'yicha kesh + CRM lookup.
   * O/0 variantlarini ham tekshiradi.
   *
   * @param opts.forceRefresh — true bo'lsa cache o'chiriladi va fresh CRM lookup qilinadi
   */
  async lookup(contractNumber: string, opts?: { forceRefresh?: boolean }): Promise<CachedContract | null> {
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

    // Parallel chaqiruvlarni birlashtirish
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.doLookup(key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async doLookup(key: string): Promise<CachedContract | null> {
    // 1) Keshda bormi — variantlar bilan
    const variants = contractVariants(key).slice(0, 16); // xavfsizlik chegarasi
    const cached = await this.prisma.crmContract.findFirst({
      where: { contractNumber: { in: variants } },
    });

    if (cached) {
      const age = Date.now() - cached.lastVerifiedAt.getTime();
      const stale = cached.found ? age > STALE_AFTER_MS : age > NOT_FOUND_RETRY_AFTER_MS;

      if (!stale) {
        return toCached(cached);
      }
      // Eskirgan + found=false → SINXRON yangilab ko'ramiz (CRM ma'lumoti yangilangan bo'lishi mumkin)
      // Eskirgan + found=true → fonda yangilab keshdan qaytaramiz (tez)
      if (!cached.found) {
        // Cache o'chiramiz va yangidan CRM ga so'raymiz
        await this.prisma.crmContract.deleteMany({ where: { contractNumber: { in: variants } } });
        return this.fetchFromCrmAndCache(key);
      }
      this.refreshInBackground(cached.contractNumber).catch(() => { /* ignore */ });
      return toCached(cached);
    }

    // 2) Yangi — CRM'ga so'rov yuboramiz (har bir variantni ketma-ket)
    return this.fetchFromCrmAndCache(key);
  }

  private async fetchFromCrmAndCache(key: string): Promise<CachedContract | null> {
    const variants = contractVariants(key).slice(0, 8);
    for (const v of variants) {
      try {
        const res = await this.crm.show({ contract: v });
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
          const customerName = buildName(detail.client) || detail.fio || null; // Text — limit yo'q
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
          const contractKey = trunc(v.toUpperCase(), 128) as string;

          const saved = await this.prisma.crmContract.upsert({
            where: { contractNumber: contractKey },
            create: {
              contractNumber: contractKey,
              customerName, status, objectName, apartmentNumber, phone,
              rawSnapshot: pickSnapshot(detail),
              found: true,
            },
            update: {
              customerName, status, objectName, apartmentNumber, phone,
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
function pickSnapshot(detail: any): any {
  if (!detail) return null;
  return {
    contract: detail.contract,
    status: detail.status,
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
