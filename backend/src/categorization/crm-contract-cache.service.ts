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
const NOT_FOUND_RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 kunda 1 marta qayta urinish

@Injectable()
export class CrmContractCacheService {
  private readonly log = new Logger(CrmContractCacheService.name);

  // Bir vaqtda bir xil shartnomaga ikkita parallel so'rov ketmasligi uchun in-flight map
  private inflight = new Map<string, Promise<CachedContract | null>>();

  constructor(private prisma: PrismaService, private crm: CrmService) {}

  /**
   * Shartnoma raqami bo'yicha kesh + CRM lookup.
   * O/0 variantlarini ham tekshiradi.
   */
  async lookup(contractNumber: string): Promise<CachedContract | null> {
    if (!contractNumber) return null;
    const key = contractNumber.trim().toUpperCase();
    if (!key) return null;

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
      // Eskirgan — fonda yangilash (kutmaymiz)
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
          const buildName = (c: any): string | null => {
            if (!c) return null;
            if (typeof c === 'string') return c.trim() || null;
            const f = (v: any): string => {
              if (!v) return '';
              if (typeof v === 'string') return v;
              return v.kirill || v.lotin || '';
            };
            const name = [f(c.last_name), f(c.first_name), f(c.middle_name)].filter(Boolean).join(' ').trim();
            if (name) return name;
            return c.full_name_kirill || c.full_name_lotin || c.full_name || c.name || c.fio || null;
          };
          // Xavfsiz qisqartirish — DB VarChar cheklovlariga sig'sin
          const trunc = (s: any, max: number): string | null => {
            if (s == null) return null;
            const str = String(s);
            return str.length > max ? str.slice(0, max) : str;
          };
          const customerName = buildName(detail.client) || detail.fio || null; // Text — limit yo'q
          const status = trunc(String(detail.status || detail.contract_status || '').toLowerCase() || null, 128);
          const objectName = trunc(detail.object_name || detail.client?.object_name || null, 255);
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
