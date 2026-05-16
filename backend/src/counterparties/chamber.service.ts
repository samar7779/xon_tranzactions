import { Injectable, Logger } from '@nestjs/common';

const CHAMBER_BASE = process.env.CHAMBER_BASE_URL || 'https://erp-api.chamber.uz';

/**
 * Chamber API — public (auth talab qilmaydi).
 * DIDOX bo'lmaganda fallback sifatida ishlatamiz.
 * Faqat: nom, reyting, region, OKED beradi (direktor/telefon/manzil yo'q).
 */
@Injectable()
export class ChamberService {
  private readonly log = new Logger(ChamberService.name);

  async getCompany(inn: string): Promise<ChamberCompany | null> {
    const url = `${CHAMBER_BASE}/Soliq/GetCompanyCriteries/${encodeURIComponent(inn)}`;
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 8_000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: ctrl.signal,
      });
      if (res.status === 400) {
        // "Soliq tizimidan ma'lumot topilmadi" — INN haqiqatan yo'q
        return null;
      }
      if (!res.ok) {
        this.log.warn(`Chamber ${inn} -> ${res.status}`);
        return null;
      }
      const data: any = await res.json();
      if (!data || data.errors) return null;
      return {
        name: data.name || data.nameLat || data.nameUz || null,
        nameRu: data.nameRu || null,
        nameLat: data.nameLat || null,
        tin: data.tin || inn,
        rating: typeof data.criteriaAll === 'number' ? data.criteriaAll : null,
        regionName: data.regionNameLat || data.regionNameRu || null,
        districtName: data.districtNameLat || data.districtNameRu || null,
        oked: data.okedDetail
          ? `${data.okedDetail.code || ''}${data.okedDetail.name_uz_latn ? ' - ' + data.okedDetail.name_uz_latn : (data.okedDetail.name_ru ? ' - ' + data.okedDetail.name_ru : '')}`.trim()
          : null,
        type: data.type || null,
        raw: data,
      };
    } catch (e: any) {
      this.log.warn(`Chamber ${inn} error: ${e?.message}`);
      return null;
    } finally {
      clearTimeout(tm);
    }
  }
}

export interface ChamberCompany {
  name: string | null;
  nameRu: string | null;
  nameLat: string | null;
  tin: string;
  rating: number | null;
  regionName: string | null;
  districtName: string | null;
  oked: string | null;
  type: string | null;
  raw: any;
}
