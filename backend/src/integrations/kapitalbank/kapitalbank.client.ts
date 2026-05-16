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
  /**
   * useProxy=true bo'lsa, so'rov forwarder (ahost) orqali yuboriladi.
   * false yoki undefined bo'lsa, to'g'ridan-to'g'ri bizning serverdan ketadi.
   * Bank IP whitelist'iga sozlash uchun foydali.
   */
  useProxy?: boolean;
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

interface GetDocDetailsParams extends BaseAuthParams {
  sid: string;             // /is_paynet/api/getDocDetails — sid majburiy
  branch: string;
  account: string;
  bank_day: string;        // dd.MM.yyyy
  doc_id: string;          // general_id (BankId/PaymentId/...)
  doc_type: number;        // 0/1/2 — kelgan / yuborilgan / ichki
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
      this.logger.log(`🔀 Bank PHP forwarder ulanish: ${this.forwarderUrl}`);
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

  private async post<T>(
    url: string,
    body: any,
    authHeader?: string,
    extraHeaders?: Record<string, string>,
    useProxy?: boolean,
  ): Promise<KapitalbankResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    };
    if (authHeader) headers['Authorization'] = authHeader;
    const bankName = this.bankNameFromUrl(url);

    // Agar useProxy=true VA forwarder sozlangan bo'lsa — ahost orqali
    if (useProxy && this.forwarderUrl && this.forwarderSecret) {
      this.logger.debug(`→ ${bankName} via PHP forwarder (ahost)`);
      return this.postViaForwarder<T>(url, body, headers, bankName);
    }

    // Aks holda — to'g'ridan-to'g'ri (yoki HTTPS proxy agent orqali)
    try {
      const resp = await firstValueFrom(
        this.http.post(url, body, {
          headers,
          timeout: this.timeoutMs,
          httpsAgent: useProxy ? this.proxyAgent : undefined,
          proxy: useProxy && this.proxyAgent ? false : undefined,
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
   * Xon PHP forwarder (xt-forwarder.php) orqali so'rov yuborish.
   * PHP fayl xonapp.uz cPanel'da turadi, bank IP whitelist'da bo'lgan IP.
   *
   * PHP API formati (clean):
   *   POST {BANK_FORWARDER_URL}
   *   Headers: X-Proxy-Secret, Content-Type: application/json
   *   Body: {url, method, headers, body, timeout}
   *   Returns: bank javobi (xuddi shunday status + body)
   */
  private async postViaForwarder<T>(
    targetUrl: string,
    body: any,
    headers: Record<string, string>,
    bankName: string,
  ): Promise<KapitalbankResponse<T>> {
    try {
      const resp = await firstValueFrom(
        this.http.post(
          this.forwarderUrl!,
          {
            url: targetUrl,
            method: 'POST',
            headers, // Authorization, Content-Type ham ichida
            body: JSON.stringify(body),
            timeout: Math.floor(this.timeoutMs / 1000),
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Proxy-Secret': this.forwarderSecret!,
            },
            timeout: this.timeoutMs + 5000,
          },
        ),
      );
      // PHP forwarder bank javobini xuddi shunday qaytaradi
      return resp.data as KapitalbankResponse<T>;
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data || e?.message;
      this.logger.warn(`${bankName} (forwarder) ${targetUrl} → ${status}: ${JSON.stringify(detail).slice(0, 300)}`);

      // Forwarder o'zidan xato qaytargan bo'lsa (auth, IP, host whitelist)
      if (e?.response?.data && typeof e.response.data === 'object' && 'error' in e.response.data) {
        const err = e.response.data;
        throw new Error(
          `Forwarder xatosi: ${err.error}${err.message ? ' — ' + err.message : ''}${err.ip ? ' (IP: ' + err.ip + ')' : ''}${err.host ? ' (host: ' + err.host + ')' : ''}`,
        );
      }
      // Bank o'zining standard javobini qaytargan bo'lsa
      if (e?.response?.data && typeof e.response.data === 'object' && 'result' in e.response.data) {
        return e.response.data as KapitalbankResponse<T>;
      }
      throw new ServiceUnavailableException(
        `${bankName} (forwarder orqali) javob bermadi: ${detail?.message || detail || status}`,
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
    const cred = params.smsCode
      ? `${params.login}:${params.password}:${params.smsCode}`
      : `${params.login}:${params.password}`;
    const authHeader = `Basic ${Buffer.from(cred).toString('base64')}`;
    const resp = await this.post<KbLoginResult>(url, {}, authHeader, undefined, params.useProxy);
    return this.ensureNoError(resp, this.bankNameFromUrl(url));
  }

  async getDoc1C(params: GetDoc1CParams): Promise<KbDoc1CResult> {
    const url = `${params.baseUrl}/GetDoc1C`;
    const body: any = {
      branch: params.branch,
      account: params.account,
    };
    if (params.date) body.date = params.date;
    if (params.sid) body.sid = params.sid;
    const authHeader = params.sid ? undefined : this.basicHeader(params.login, params.password);
    const resp = await this.post<KbDoc1CResult>(url, body, authHeader, undefined, params.useProxy);
    return this.ensureNoError(resp, this.bankNameFromUrl(url));
  }

  async getAcc1C(params: GetAcc1CParams): Promise<KbAccount[]> {
    const url = `${params.baseUrl}/GetAcc1C`;
    const body: any = {
      branch: params.branch,
      account: params.account,
    };
    if (params.sid) body.sid = params.sid;
    const authHeader = params.sid ? undefined : this.basicHeader(params.login, params.password);
    const resp = await this.post<KbAccount[]>(url, body, authHeader, undefined, params.useProxy);
    return this.ensureNoError(resp, this.bankNameFromUrl(url));
  }

  /**
   * GET /is_paynet/api/getDocDetails — bitta hujjat tafsiloti
   * (payment_state_name, parent_payment_id, proved_date, plat_purpose va h.k.)
   *
   * Bu /Mobile.svc EMAS — alohida path. baseUrl odatda
   *   https://m.bank24.uz:2713/Mobile.svc — undan /Mobile.svc'ni kesib tashlaymiz.
   *
   * doc_type: 0 = kelgan, 1 = yuborilgan, 2 = ichki (chap–o'ng)
   */
  async getDocDetails(params: GetDocDetailsParams): Promise<any> {
    // Mobile.svc'ni kesib, /is_paynet/api/getDocDetails ga ulaymiz
    const base = params.baseUrl.replace(/\/Mobile\.svc\/?$/i, '');
    const url = `${base}/is_paynet/api/getDocDetails`;
    const q = new URLSearchParams({
      sid: params.sid,
      branch: params.branch,
      account: params.account,
      bank_day: params.bank_day,
      doc_id: params.doc_id,
      doc_type: String(params.doc_type),
    });
    const fullUrl = `${url}?${q.toString()}`;

    if (params.useProxy && this.forwarderUrl && this.forwarderSecret) {
      return this.getViaForwarder(fullUrl);
    }
    try {
      const resp = await firstValueFrom(
        this.http.get(fullUrl, {
          timeout: this.timeoutMs,
          httpsAgent: params.useProxy ? this.proxyAgent : undefined,
          proxy: params.useProxy && this.proxyAgent ? false : undefined,
        }),
      );
      return resp.data;
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data || e?.message;
      this.logger.warn(`getDocDetails ${fullUrl} → ${status}: ${JSON.stringify(detail).slice(0, 300)}`);
      throw new Error(`getDocDetails xato (${status || 'network'}): ${typeof detail === 'string' ? detail : detail?.message || JSON.stringify(detail).slice(0, 200)}`);
    }
  }

  private async getViaForwarder(targetUrl: string): Promise<any> {
    try {
      const resp = await firstValueFrom(
        this.http.post(
          this.forwarderUrl!,
          {
            url: targetUrl,
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            body: '',
            timeout: Math.floor(this.timeoutMs / 1000),
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Proxy-Secret': this.forwarderSecret!,
            },
            timeout: this.timeoutMs + 5000,
          },
        ),
      );
      return resp.data;
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data || e?.message;
      throw new Error(`Forwarder GET xato (${status || 'network'}): ${detail?.message || JSON.stringify(detail).slice(0, 200)}`);
    }
  }
}
