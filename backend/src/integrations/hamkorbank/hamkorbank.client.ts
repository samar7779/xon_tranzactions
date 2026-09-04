import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KbDoc1CItem, KbDoc1CResult } from '../kapitalbank/types';

/**
 * Hamkorbank PaySystems API klient (tz/hamkor api.pdf).
 * Prod: https://capi.hamkorbank.uz  ·  Lab: https://capi-lab.hamkorbank.uz
 * Yo'l prefiksi: /api/v1/ps/...
 * Auth: Basic base64(login:password) + har so'rovda `requestId` (uuid) va `lang` header.
 * Javob konverti: { code, msg, responseBody[] } — code:0=ok, aks holda xato.
 *
 * MUHIM: bu KAPITALBANK_V3 (Mobile.svc/SOAP) dan BUTUNLAY boshqa API. Shu bois alohida klient.
 * Downstream (sync/inspector/ОплатыКв) o'zgarmasligi uchun javob KbDoc1CItem shakliga
 * normalizatsiya qilinadi — Kapital/Ipak bilan bir xil "content[]" chiqadi.
 */
@Injectable()
export class HamkorbankClient {
  private readonly logger = new Logger(HamkorbankClient.name);
  private readonly timeoutMs: number;
  private readonly proxyAgent?: HttpsProxyAgent<string>;
  private readonly envForwarderUrl?: string;
  private readonly envForwarderSecret?: string;
  private forwarderCache: { url?: string; secret?: string; at: number } | null = null;
  private static readonly FORWARDER_TTL_MS = 30_000;

  // Kunlik tranzaksiyalarni olishda sahifa hajmi
  private static readonly PAGE_SIZE = 200;
  private static readonly MAX_PAGES = 200; // xavfsizlik chegarasi

  constructor(
    private http: HttpService,
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.timeoutMs = Number(config.get<string>('HAMKORBANK_TIMEOUT_MS', config.get<string>('KAPITALBANK_TIMEOUT_MS', '20000')));
    // Kapital bilan bir xil forwarder/proxy sozlamalarini ishlatadi (bank IP whitelist).
    this.envForwarderUrl = config.get<string>('BANK_FORWARDER_URL');
    this.envForwarderSecret = config.get<string>('BANK_FORWARDER_SECRET');
    const proxyUrl = config.get<string>('BANK_PROXY_URL');
    if (proxyUrl) this.proxyAgent = new HttpsProxyAgent(proxyUrl);
  }

  private basicHeader(login: string, password: string): string {
    return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
  }

  /** Effektiv forwarder (DB Setting > env) — Kapital bilan bir xil kalitlar. 30s kesh. */
  private async getForwarder(): Promise<{ url?: string; secret?: string }> {
    const now = Date.now();
    if (this.forwarderCache && now - this.forwarderCache.at < HamkorbankClient.FORWARDER_TTL_MS) {
      return { url: this.forwarderCache.url, secret: this.forwarderCache.secret };
    }
    let url = this.envForwarderUrl;
    let secret = this.envForwarderSecret;
    try {
      const rows = await this.prisma.setting.findMany({
        where: { key: { in: ['bank.forwarderUrl', 'bank.forwarderSecret'] } },
        select: { key: true, value: true },
      });
      for (const r of rows) {
        if (r.key === 'bank.forwarderUrl' && r.value) url = r.value;
        if (r.key === 'bank.forwarderSecret' && r.value) secret = r.value;
      }
    } catch { /* env fallback */ }
    this.forwarderCache = { url, secret, at: now };
    return { url, secret };
  }

  /**
   * GET so'rov — to'g'ridan-to'g'ri yoki forwarder (proxy) orqali.
   * Javobning { code, msg, responseBody } konvertini ochib, responseBody massivini qaytaradi.
   */
  private async get(
    auth: { baseUrl: string; login: string; password: string; useProxy?: boolean },
    path: string,
    query: Record<string, any>,
    extraHeaders?: Record<string, string>,
  ): Promise<any> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v != null) qs.set(k, String(v));
    const url = `${auth.baseUrl}/api/v1/ps/${path}${qs.toString() ? `?${qs.toString()}` : ''}`;
    const headers: Record<string, string> = {
      requestId: randomUUID(),
      lang: 'RU',
      Authorization: this.basicHeader(auth.login, auth.password),
      ...(extraHeaders || {}),
    };
    const raw = await this.request('GET', url, headers, undefined, auth.useProxy);
    // Konvert: { code, msg, responseBody } | { code, error }
    const code = raw?.code;
    if (code !== 0 && code !== '0') {
      const msg = raw?.msg || raw?.error || `code=${code}`;
      throw new Error(`Hamkorbank #${code}: ${String(msg).slice(0, 200)}`);
    }
    return raw?.responseBody ?? [];
  }

  private async request(method: string, url: string, headers: Record<string, string>, body: any, useProxy?: boolean): Promise<any> {
    const fw = await this.getForwarder();
    // Forwarder (xt-forwarder.php) — Kapital bilan bir xil format: {url, method, headers, body, timeout}
    if (useProxy && fw.url && fw.secret) {
      try {
        const resp = await firstValueFrom(
          this.http.post(
            fw.url,
            { url, method, headers, body: body != null ? JSON.stringify(body) : undefined, timeout: Math.floor(this.timeoutMs / 1000) },
            { headers: { 'Content-Type': 'application/json', 'X-Proxy-Secret': fw.secret }, timeout: this.timeoutMs + 5000 },
          ),
        );
        return resp.data;
      } catch (e: any) {
        const status = e?.response?.status;
        const detail = e?.response?.data || e?.message;
        // Forwarder bank javobini shu tarzda qaytargan bo'lsa (code/error konverti) — o'shani beramiz
        if (e?.response?.data && typeof e.response.data === 'object' && ('responseBody' in e.response.data || 'code' in e.response.data)) {
          return e.response.data;
        }
        this.logger.warn(`Hamkorbank (forwarder) ${url} → ${status}: ${JSON.stringify(detail).slice(0, 250)}`);
        throw new ServiceUnavailableException(`Hamkorbank (forwarder) javob bermadi (${status || 'network'})`);
      }
    }
    // To'g'ridan-to'g'ri (yoki HTTPS proxy agent)
    try {
      const resp = await firstValueFrom(
        this.http.request({
          method: method as any,
          url,
          headers,
          data: body,
          timeout: this.timeoutMs,
          httpsAgent: useProxy ? this.proxyAgent : undefined,
          proxy: useProxy && this.proxyAgent ? false : undefined,
        }),
      );
      return resp.data;
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data || e?.message;
      // Bank standart konvertini qaytargan bo'lsa (code!=0) — get() uni tekshiradi
      if (e?.response?.data && typeof e.response.data === 'object' && 'code' in e.response.data) {
        return e.response.data;
      }
      this.logger.warn(`Hamkorbank ${method} ${url} → ${status}: ${JSON.stringify(detail).slice(0, 250)}`);
      throw new ServiceUnavailableException(`Hamkorbank javob bermadi (${status || 'network'})`);
    }
  }

  /** get-bank-day — operatsion + hisob-kitob kuni (ulanishni test qilish uchun ham qulay). */
  async getBankDay(auth: { baseUrl: string; login: string; password: string; useProxy?: boolean }): Promise<{ bankDate: string | null; bankCalDate: string | null }> {
    const body = await this.get(auth, 'get-bank-day', {});
    const row = Array.isArray(body) ? body[0] : body;
    return { bankDate: row?.bankDate ?? null, bankCalDate: row?.bankCalDate ?? null };
  }

  /**
   * Kunlik tranzaksiyalar (bitta hisob bo'yicha) — get-doc-details-byacc'ni sahifalab yig'adi
   * va KbDoc1CResult (content: KbDoc1CItem[]) shaklida qaytaradi. Bu KapitalbankClient.getDoc1C
   * ekvivalenti — sync/inspector uni xuddi Kapital kabi ishlatadi.
   *
   * @param params.date  dd.mm.yyyy (bankDay)
   * @param params.account  bizning hisob (acc)
   */
  async getStatementDay(params: { baseUrl: string; login: string; password: string; account: string; date?: string; useProxy?: boolean }): Promise<KbDoc1CResult> {
    const auth = { baseUrl: params.baseUrl, login: params.login, password: params.password, useProxy: params.useProxy };
    const bankDay = params.date;
    const acc = params.account;
    const content: KbDoc1CItem[] = [];
    for (let page = 1; page <= HamkorbankClient.MAX_PAGES; page++) {
      const rows = await this.get(auth, 'get-doc-details-byacc', {
        bankDay,
        docType: 0, // 0 = debit + credit (kirim + chiqim)
        acc,
        pageNumber: page,
        pageSize: HamkorbankClient.PAGE_SIZE,
      });
      const arr: any[] = Array.isArray(rows) ? rows : [];
      for (const it of arr) content.push(this.normalizeItem(it, acc));
      if (arr.length < HamkorbankClient.PAGE_SIZE) break; // oxirgi sahifa
    }
    // Saldo — get-account-list'dan (best-effort; topilmasa null)
    let saldo_out: number | null = null;
    try {
      const accs = await this.get(auth, 'get-account-list', { param: '' });
      const arr: any[] = Array.isArray(accs) ? accs : [];
      const hit = arr.find((a) => String(a?.account || a?.id || '') === acc);
      if (hit && hit.balance != null) saldo_out = Number(hit.balance);
    } catch { /* saldo ixtiyoriy */ }
    return { content, saldo_out: saldo_out ?? undefined };
  }

  /**
   * Hamkor yozuvini KbDoc1CItem'ga tarjima qiladi. ourAcc — sync qilinayotgan hisobimiz
   * (kirim/chiqimni aniqlash uchun).
   * get-doc-details-byacc maydonlari: accountCr, accountDt, docDate, docNum, docType, id,
   *   innCr, innDt, mfoCr, mfoDt, nameCr, nameDt, nazpla, status, summa, vDate.
   */
  private normalizeItem(it: any, ourAcc: string): KbDoc1CItem {
    const acc_ct = it?.accountCr != null ? String(it.accountCr) : undefined;
    const acc_dt = it?.accountDt != null ? String(it.accountDt) : undefined;
    const isIn = acc_ct === ourAcc; // pul BIZGA kirdi (biz kreditormiz)
    return {
      general_id: it?.id != null ? String(it.id) : undefined,
      b2_id: it?.id != null ? String(it.id) : undefined, // Hamkor'da alohida b2_id yo'q — id noyob
      num: it?.docNum != null ? String(it.docNum) : undefined,
      ddate: it?.docDate ? String(it.docDate) : undefined, // dd.mm.yyyy (Kapital dd.MM.yyyy bilan mos)
      vdate: it?.vDate ? String(it.vDate) : undefined,
      acc_ct,
      acc_dt,
      mfo_ct: it?.mfoCr != null ? String(it.mfoCr) : undefined,
      mfo_dt: it?.mfoDt != null ? String(it.mfoDt) : undefined,
      name_ct: it?.nameCr != null ? String(it.nameCr) : undefined,
      name_dt: it?.nameDt != null ? String(it.nameDt) : undefined,
      inn_ct: it?.innCr != null ? String(it.innCr) : undefined,
      inn_dt: it?.innDt != null ? String(it.innDt) : undefined,
      purpose: it?.nazpla != null ? String(it.nazpla) : undefined,
      amount: it?.summa != null ? Number(it.summa) : undefined, // tiyin
      // dtype QO'YILMAYDI: Hamkor `docType` = yo'nalish kodi (0=ikkisi/1=kredit/4=debit),
      // Kapital doc-type EMAS. Uni dtype'ga qo'ysak guessType (purp_code, dtype) noto'g'ri
      // talqin qiladi va docType ustuni yo'nalish kodini saqlaydi. Yo'nalish allaqachon `dir`da.
      // (Hamkor doc-type/maqsad kodini bermaydi → TxnType OTHER bo'ladi — bu to'g'ri/halol.)
      // TODO(hamkor login/parol kelgach): `status` (int) → state mapping'ini haqiqiy qiymatlar
      // asosida sozlash. Hozircha COMPLETED(3) default — get-doc-details-byacc provodka
      // qilingan hujjatlarni beradi. state=6 bo'lsa detectChanges CANCELLED deb belgilaydi.
      state: 3,
      dir: isIn ? 2 : 1, // 2=kirim, 1=chiqim (KbDoc1CItem.dir)
    };
  }
}
