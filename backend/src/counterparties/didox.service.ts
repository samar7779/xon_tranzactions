import { Injectable, Logger } from '@nestjs/common';

const DIDOX_LOCALE = 'ru';

// Env har chaqiruvda qaytadan o'qiladi — bir marta module yuklanganda
// emas (deploy paytida .env keyin to'ldirilsa, restart kerak bo'lmasligi uchun).
function env() {
  return {
    base: process.env.DIDOX_BASE_URL || 'https://api.didox.uz',
    inn: process.env.DIDOX_LOGIN_INN || '',
    password: process.env.DIDOX_LOGIN_PASSWORD || '',
    partner: process.env.DIDOX_PARTNER_AUTH || '',
  };
}

// User-key (UUID) 6 soat amal qiladi; xotirada keshlaymiz, 401'da qayta login.
interface CachedToken { token: string; expiresAt: number }

@Injectable()
export class DidoxService {
  private readonly log = new Logger(DidoxService.name);
  private cached: CachedToken | null = null;

  isConfigured(): boolean {
    const e = env();
    return !!(e.inn && e.password && e.partner);
  }

  /** Mavjud token amal qilsa qaytaradi, aks holda qayta login qilib oladi */
  private async getToken(force = false): Promise<string> {
    if (!force && this.cached && this.cached.expiresAt > Date.now() + 60_000) {
      return this.cached.token;
    }
    const e = env();
    if (!e.inn || !e.password || !e.partner) {
      throw new Error('DIDOX env vars not configured (DIDOX_LOGIN_INN, DIDOX_LOGIN_PASSWORD, DIDOX_PARTNER_AUTH)');
    }
    const url = `${e.base}/v1/auth/${encodeURIComponent(e.inn)}/password/${DIDOX_LOCALE}`;
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ password: e.password }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(tm));
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DIDOX login failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    if (!data?.token) throw new Error('DIDOX login response missing token');
    // 6 soat amal qiladi, biz 5 soatda yangilaymiz (xavfsiz)
    this.cached = { token: data.token, expiresAt: Date.now() + 5 * 60 * 60 * 1000 };
    this.log.log(`DIDOX user-key olindi: ${data.token.slice(0, 8)}…`);
    return data.token;
  }

  /** Auth header'lar bilan GET; 401'da qayta login qilib bir marta urinib ko'radi */
  private async authedGet(path: string, retried = false): Promise<any> {
    const token = await this.getToken();
    const e = env();
    const url = `${e.base}${path}`;
    // 12 soniya — DIDOX'ning /v2/documents katta payload qaytaradi
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, {
      headers: {
        'user-key': token,
        'Partner-Authorization': e.partner,
        'Accept': 'application/json',
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(tm));
    if (res.status === 401 && !retried) {
      this.cached = null;
      return this.authedGet(path, true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DIDOX ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  /**
   * Kontragent ma'lumotlari — DIDOX'ning asosiy endpoint'i.
   * /v1/ihamkor/companies/{inn} → briefData
   */
  async getCompany(inn: string): Promise<DidoxCompany | null> {
    const json = await this.authedGet(`/v1/ihamkor/companies/${encodeURIComponent(inn)}`);
    const brief = json?.data?.briefData;
    if (!brief) return null;
    return brief as DidoxCompany;
  }

  /**
   * Oxirgi 30 kunlik incoming fakturalardan shu INN'ga oid eng yangi bittasini topib,
   * undagi bank hisobi va g.b. ma'lumotlarini ajratib oladi.
   * Topilmasa null qaytaradi (faktura aylanmasi bo'lmasa normal).
   * 30 kun — 90 emas, chunki katta payload va sekin.
   */
  async findLatestBankInfo(inn: string): Promise<DidoxBankInfo | null> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    // Incoming (002) — bizga keladigan fakturalarda partnerTin = sotuvchi (seller)
    const list = await this.authedGet(
      `/v2/documents?owner=0&doctype=002&dateFromCreated=${since}`,
    ).catch((e: any) => { this.log.warn(`DIDOX docs list: ${e?.message}`); return null; });
    const docs = (list?.data || []) as any[];
    const matched = docs.find((d) => String(d?.partnerTin || '').trim() === String(inn).trim());
    if (!matched?.doc_id) return null;
    try {
      const detail = await this.authedGet(`/v1/documents/${matched.doc_id}`);
      const j = detail?.data?.json;
      const party = j?.sellertin === inn ? j?.seller : (j?.buyertin === inn ? j?.buyer : null);
      if (!party) return null;
      return {
        account: party.account || null,
        bankid: party.bankid || null,
        accountant: party.accountant || null,
      };
    } catch (e: any) {
      this.log.warn(`DIDOX doc detail ${matched.doc_id}: ${e?.message}`);
      return null;
    }
  }
}

export interface DidoxCompany {
  shortName?: string;
  name?: string;
  tin?: string;
  registrationDate?: string;
  registrationNumber?: string;
  directorFullName?: string;
  directorPinfl?: string;
  phone?: string;
  email?: string;
  billingAddress?: string;
  status?: string;
  status_ru?: string;
  status_uz_latn?: string;
  status_uz_cyrl?: string;
  opf?: string;
  oked?: string;
  companyType?: string;
  businessType?: string;
  vatNumber?: number | string;
  vatStatus?: string;
  taxMode?: string;
  sustainabilityRating?: { type?: string; points?: number; title?: string };
  founders?: any[];
}

export interface DidoxBankInfo {
  account: string | null;
  bankid: string | null;   // MFO
  accountant: string | null;
}
