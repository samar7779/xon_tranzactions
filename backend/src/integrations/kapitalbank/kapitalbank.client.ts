import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  KapitalbankResponse,
  KbDoc1CResult,
  KbLoginResult,
  KbAccount,
} from './types';

interface BaseAuthParams {
  baseUrl: string;
  login: string;
  password: string;
}

interface ApiLoginParams extends BaseAuthParams {
  smsCode?: string;
}

interface GetDoc1CParams extends BaseAuthParams {
  branch: string;
  account: string;
  date?: string;          // dd.MM.yyyy
  sid?: string;
}

interface GetAcc1CParams extends BaseAuthParams {
  branch: string;
  account: string;
  sid?: string;
}

/**
 * KapitalBank OpenAPI v3 klient.
 * Boevoy URL: https://m.bank24.uz:2713/Mobile.svc
 * Auth: IP whitelist rejimida har so'rovda Basic Auth header.
 *       SMS rejimida APILogin'dan sid olib, keyingi so'rovlar body'da sid uzatiladi.
 */
@Injectable()
export class KapitalbankClient {
  private readonly logger = new Logger(KapitalbankClient.name);
  private readonly timeoutMs: number;
  private readonly proxyAgent?: HttpsProxyAgent<string>;
  private readonly forwarderUrl?: string;
  private readonly forwarderSecret?: string;

  constructor(private http: HttpService, config: ConfigService) {
    this.timeoutMs = Number(config.get<string>('KAPITALBANK_TIMEOUT_MS', '15000'));

    // PHP forwarder (cPanel shared hosting uchun) — bank.php fayl ahost'da turadi,
    // u bank API'ga so'rov uzatadi, bank ahost IP'sini ko'radi.
    this.forwarderUrl = config.get<string>('BANK_FORWARDER_URL');
    this.forwarderSecret = config.get<string>('BANK_FORWARDER_SECRET');
    if (this.forwarderUrl) {
      this.logger.log(`🔀 Bank PHP forwarder: ${this.forwarderUrl}`);
    }

    // HTTPS proxy (Tinyproxy VPS uchun) — fallback
    const proxyUrl = config.get<string>('BANK_PROXY_URL');
    if (proxyUrl) {
      this.proxyAgent = new HttpsProxyAgent(proxyUrl);
      this.logger.log(`🔀 Bank API proxy: ${proxyUrl.replace(/:[^:@]+@/, ':***@')}`);
    }
  }

  private basicHeader(login: string, password: string) {
    const token = Buffer.from(`${login}:${password}`).toString('base64');
    return `Basic ${token}`;
  }

  /** URL'dan bank nomini chiqarib olamiz — xabarlar uchun foydali */
  private bankNameFromUrl(url: string): string {
    if (url.includes('ipakyulibank')) return 'Ipak Yo\'li';
    if (url.includes('bank24.uz')) return 'KapitalBank';
    if (url.includes('hayot')) return 'Hayot Bank';
    try {
      return new URL(url).hostname;
    } catch {
      return 'Bank';
    }
  }

  private async post<T>(url: string, body: any, authHeader?: string, extraHeaders?: Record<string, string>): Promise<KapitalbankResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    };
    if (authHeader) headers['Authorization'] = authHeader;
    const bankName = this.bankNameFromUrl(url);

    // 1) Agar PHP forwarder sozlangan bo'lsa — bank.php orqali uzatamiz
    if (this.forwarderUrl && this.forwarderSecret) {
      return this.postViaForwarder<T>(url, body, headers, bankName);
    }

    // 2) Agar HTTPS proxy sozlangan bo'lsa — agent orqali
    try {
      const resp = await firstValueFrom(
        this.http.post(url, body, {
          headers,
          timeout: this.timeoutMs,
          httpsAgent: this.proxyAgent,
          proxy: this.proxyAgent ? false : undefined,
        }),
      );
      return resp.data as KapitalbankResponse<T>;
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data || e?.message;
      this.logger.warn(`${bankName} POST ${url} → ${status}: ${JSON.stringify(detail).slice(0, 300)}`);
      throw new ServiceUnavailableException(
        `${bankName} xizmati javob bermadi (${status || 'network'})`,
      );
    }
  }

  /**
   * Bank URL'idan forwarder uchun bank kodi va endpoint pathini ajratish.
   * Foydalanuvchining mavjud bank-proxy.php fayli quyidagi API'ni kutadi:
   *   POST {forwarder}?bank=BANK&endpoint=/path/to/api
   */
  private parseForwarderTarget(url: string): { bank: string; endpoint: string } | null {
    try {
      const u = new URL(url);
      const host = u.host.toLowerCase();
      let bank: string | null = null;
      if (host.includes('bank24.uz')) bank = 'kapitalbank';
      else if (host.includes('ipakyulibank')) bank = 'ipak_yoli';
      else if (host.includes('hayatbank') || host.includes('hayot')) bank = 'hayot';
      if (!bank) return null;
      return { bank, endpoint: u.pathname };
    } catch {
      return null;
    }
  }

  /**
   * PHP forwarder orqali so'rov yuborish (cPanel shared hosting uchun).
   * ahost'dagi bank-proxy.php fayli so'rovni qabul qilib, bank API'ga uzatadi.
   * Bank ahost IP'sini ko'radi (whitelist'da).
   *
   * PHP API formati:
   *   POST {BANK_FORWARDER_URL}?bank=kapitalbank|ipak_yoli|hayot&endpoint=/Mobile.svc/APILogin
   *   Headers: X-Proxy-Secret, Authorization (passthrough), Content-Type: application/json
   *   Body: raw bank API request body (JSON)
   */
  private async postViaForwarder<T>(
    targetUrl: string,
    body: any,
    headers: Record<string, string>,
    bankName: string,
  ): Promise<KapitalbankResponse<T>> {
    const target = this.parseForwarderTarget(targetUrl);
    if (!target) {
      throw new ServiceUnavailableException(
        `${bankName} URL forwarder uchun mos emas: ${targetUrl}`,
      );
    }

    const forwarderFullUrl = `${this.forwarderUrl}?bank=${target.bank}&endpoint=${encodeURIComponent(target.endpoint)}`;

    // Forwarder'ga uzatiladigan headerlar — Authorization passthrough qilamiz
    const fwdHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Proxy-Secret': this.forwarderSecret!,
    };
    if (headers['Authorization']) fwdHeaders['Authorization'] = headers['Authorization'];

    try {
      const resp = await firstValueFrom(
        this.http.post(forwarderFullUrl, body, {
          headers: fwdHeaders,
          timeout: this.timeoutMs + 5000,
        }),
      );
      // PHP forwarder bank javobini xuddi shunday qaytaradi
      return resp.data as KapitalbankResponse<T>;
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data || e?.message;
      this.logger.warn(`${bankName} (forwarder ${target.bank}) ${target.endpoint} → ${status}: ${JSON.stringify(detail).slice(0, 300)}`);
      // Agar forwarder'dan kelgan to'liq response bo'lsa — uzatamiz (bank xatosi bo'lishi mumkin)
      if (e?.response?.data && typeof e.response.data === 'object' && 'error' in e.response.data) {
        return e.response.data as KapitalbankResponse<T>;
      }
      throw new ServiceUnavailableException(
        `${bankName} (forwarder orqali) javob bermadi: ${detail?.error || detail?.message || detail || status}`,
      );
    }
  }

  private ensureNoError<T>(resp: KapitalbankResponse<T>, bankName = 'Bank'): T {
    if (resp.error && resp.error.code !== 0) {
      throw new Error(`${bankName} #${resp.error.code}: ${resp.error.message}`);
    }
    return resp.result;
  }

  /**
   * APILogin — sessiyani boshlash.
   * IP whitelist rejimida SMS code shart emas, lekin javobda sid keladi.
   * PDF §1.1
   */
  async apiLogin(params: ApiLoginParams): Promise<KbLoginResult> {
    const url = `${params.baseUrl}/APILogin`;
    // Basic auth header: login[:password][:sms]
    const cred = params.smsCode
      ? `${params.login}:${params.password}:${params.smsCode}`
      : `${params.login}:${params.password}`;
    const authHeader = `Basic ${Buffer.from(cred).toString('base64')}`;
    const resp = await this.post<KbLoginResult>(url, {}, authHeader);
    return this.ensureNoError(resp, this.bankNameFromUrl(url));
  }

  /**
   * GetDoc1C — hisob bo'yicha ko'rsatilgan sana uchun tranzaksiyalar.
   * PDF §4.1
   */
  async getDoc1C(params: GetDoc1CParams): Promise<KbDoc1CResult> {
    const url = `${params.baseUrl}/GetDoc1C`;
    const body: any = {
      branch: params.branch,
      account: params.account,
    };
    if (params.date) body.date = params.date;
    if (params.sid) body.sid = params.sid;
    const authHeader = params.sid ? undefined : this.basicHeader(params.login, params.password);
    const resp = await this.post<KbDoc1CResult>(url, body, authHeader);
    return this.ensureNoError(resp, this.bankNameFromUrl(url));
  }

  /**
   * GetAcc1C — bitta hisob ma'lumoti (saldo, oborot).
   * PDF §5.1
   */
  async getAcc1C(params: GetAcc1CParams): Promise<KbAccount[]> {
    const url = `${params.baseUrl}/GetAcc1C`;
    const body: any = {
      branch: params.branch,
      account: params.account,
    };
    if (params.sid) body.sid = params.sid;
    const authHeader = params.sid ? undefined : this.basicHeader(params.login, params.password);
    const resp = await this.post<KbAccount[]>(url, body, authHeader);
    return this.ensureNoError(resp, this.bankNameFromUrl(url));
  }
}
