import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
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

  constructor(private http: HttpService, config: ConfigService) {
    this.timeoutMs = Number(config.get<string>('KAPITALBANK_TIMEOUT_MS', '15000'));
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
    try {
      const resp = await firstValueFrom(
        this.http.post(url, body, { headers, timeout: this.timeoutMs }),
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
