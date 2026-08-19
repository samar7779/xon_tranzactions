import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';
import { SettingsService } from '../sync/settings.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { serialize, FORMATS, Dataset, ExportColumn } from './data-formats';
import { planUpsertRows } from './google-export.plan';

// ─── Config tuzilishi ───────────────────────────────────────────────
export interface SheetColumn {
  col: string;    // Ustun harfi: "A", "B", ... "AA"
  field: string;  // ОплатыКв maydoni (FIELD_KEYS ichidan)
}
export interface SheetTarget {
  id: string;             // barqaror identifikator (frontend generatsiya qiladi)
  name: string;           // ko'rinish uchun nom (label)
  source?: 'oplatakv' | 'transaction'; // MANBA: ОплатыКв (default) yoki Tranzaksiya
  spreadsheetId: string;  // Google jadval ID
  tabName: string;        // list (tab) nomi
  startRow: number;       // shu qatordan pastga clear + yozish
  dateFrom: string | null;// YYYY-MM-DD (→ today gacha)
  filter: {
    objects?: string[];
    categories?: string[]; // MONTHLY | FIRST | GENERAL
    txTypes?: string[];
    accounts?: string[];   // TRANZAKSIYA manbasi uchun — hisob raqamlari
    amountSign?: 'pos' | 'neg' | null; // Сумма: >0 yoki <0 (0 skip)
  };
  // Yozish rejimi: 'replace' (default) — ustunlarni tozalab qayta yozadi;
  // 'upsert' — jadvalni tozalamaydi, keyField bo'yicha mavjudni update qiladi,
  // yangisini qo'shadi, DB'da yo'q qatorlarni tozalaydi.
  writeMode?: 'replace' | 'upsert';
  keyField?: string; // upsert uchun kalit maydon (default: 1-ustun field'i)
  // Upsert'da YANGI qatorni qayerdan boshlab qo'shishni aniqlash uchun "ANKER" ustun.
  // Mapping ustunlari qisqa bo'lsa (bo'sh kataklar) ham, bu ustun to'la bo'lgani uchun
  // HAQIQIY oxirgi qatorni ko'rsatadi. Default: 'F'. Yangi qatorlar shu ustundagi
  // oxirgi ma'lumotdan KEYIN yoziladi (o'rtaga/ustiga emas).
  lastRowColumn?: string;
  // Avtomatik jadval (cron): har N daqiqada, soat oralig'ida, tanlangan hafta kunlari.
  cron?: {
    enabled?: boolean;
    everyMinutes?: number;  // har N daqiqa (min 1)
    hourFrom?: number;      // 0-23 — shu soatdan (ixtiyoriy)
    hourTo?: number;        // 0-23 — shu soatgacha (ixtiyoriy)
    days?: number[];        // 0=Yakshanba .. 6=Shanba; bo'sh = har kun
  };
  columns: SheetColumn[];
}

const SETTINGS_KEY = 'export.sheets';

// ОплатыКв → hujayra qiymati uchun mavjud maydonlar
const FIELD_KEYS = new Set([
  'id', 'contractNo', 'date', 'paymentAmount', 'firstInstallment', 'monthlyAmount',
  'paymentCategory', 'object', 'client', 'txType', 'paymentMethod', 'purpose', 'note',
]);

// TRANZAKSIYA → hujayra qiymati uchun mavjud maydonlar
const TX_FIELD_KEYS = new Set([
  'externalId', 'id', 'accountNo', 'bankName', 'txnDate', 'amount', 'direction',
  'fromName', 'fromAccount', 'fromInn', 'toName', 'toAccount', 'toInn',
  'description', 'contractNumber', 'category', 'subcategory', 'docNumber', 'reference',
]);
// Frontend uchun tranzaksiya ustunlari (key → header)
const TX_COLS: ExportColumn[] = [
  { key: 'externalId',      header: 'ID (external)' },
  { key: 'accountNo',       header: 'Hisob raqami' },
  { key: 'bankName',        header: 'Bank' },
  { key: 'txnDate',         header: 'Sana' },
  { key: 'amount',          header: 'Summa' },
  { key: 'direction',       header: "Yo'nalish (IN/OUT)" },
  { key: 'fromName',        header: 'Kimdan (nomi)' },
  { key: 'fromAccount',     header: 'Kimdan (hisob)' },
  { key: 'fromInn',         header: 'Kimdan (INN)' },
  { key: 'toName',          header: 'Kimga (nomi)' },
  { key: 'toAccount',       header: 'Kimga (hisob)' },
  { key: 'toInn',           header: 'Kimga (INN)' },
  { key: 'description',     header: 'Izoh' },
  { key: 'contractNumber',  header: 'Shartnoma' },
  { key: 'category',        header: 'Kategoriya' },
  { key: 'subcategory',     header: 'Subkategoriya' },
  { key: 'docNumber',       header: 'Hujjat №' },
  { key: 'reference',       header: 'Reference' },
  { key: 'id',              header: 'Ichki ID' },
];

const CATEGORY_LABEL: Record<string, string> = {
  MONTHLY: 'ежемесячный',
  FIRST:   '1 взнос',
  GENERAL: 'Общий',
};

// ОплатыКв ustunlari (key → header) — data-export va Autsoursing ishlatadi
const OPLATA_COLS: ExportColumn[] = [
  { key: 'id',               header: 'ID' },
  { key: 'contractNo',       header: 'Дог №' },
  { key: 'date',             header: 'Дата' },
  { key: 'paymentAmount',    header: 'Сумма оплаты' },
  { key: 'firstInstallment', header: '1 взнос' },
  { key: 'monthlyAmount',    header: 'ежемесячный' },
  { key: 'paymentCategory',  header: 'Оплата' },
  { key: 'object',           header: 'Объект' },
  { key: 'client',           header: 'Клиент' },
  { key: 'txType',           header: 'Тип' },
  { key: 'paymentMethod',    header: 'Способ оплаты' },
  { key: 'purpose',          header: 'Назначение' },
  { key: 'note',             header: 'Примечание' },
];

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

@Injectable()
export class GoogleExportService {
  private readonly log = new Logger(GoogleExportService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly oplataKv: OplataKvService,
    private readonly transactions: TransactionsService,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly CRED_KEY = 'export.credentials';

  // ─── Credential (service-account) yuklash ─────────────────────────
  /**
   * Credentialни topadi va manbasini qaytaradi.
   * Ustuvorlik:
   *   1. env GOOGLE_SA_JSON     — to'liq JSON string
   *   2. env GOOGLE_SA_KEYFILE  — serverdagi JSON fayl yo'li
   *   3. DB Setting (export.credentials) — UI orqali paste qilingan, AES-256-GCM shifrlangan
   * private_key ichidagi \n literal'lar real yangi qatorga aylantiriladi.
   */
  private async resolveCreds(): Promise<{ creds: ServiceAccount | null; source: 'env' | 'db' | null }> {
    let raw = this.config.get<string>('GOOGLE_SA_JSON') || '';
    let source: 'env' | 'db' | null = raw ? 'env' : null;

    if (!raw) {
      const keyfile = this.config.get<string>('GOOGLE_SA_KEYFILE');
      if (keyfile) {
        try { raw = fs.readFileSync(keyfile, 'utf8'); source = 'env'; }
        catch (e: any) { this.log.warn(`GOOGLE_SA_KEYFILE o'qilmadi (${keyfile}): ${e?.message}`); }
      }
    }

    if (!raw) {
      const enc = await this.settings.get(this.CRED_KEY);
      if (enc) {
        try { raw = this.crypto.decrypt(enc); source = 'db'; }
        catch (e: any) { this.log.warn(`export.credentials decrypt xato: ${e?.message}`); }
      }
    }

    if (!raw) return { creds: null, source: null };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.client_email || !parsed?.private_key) return { creds: null, source: null };
      parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
      return { creds: parsed as ServiceAccount, source };
    } catch (e: any) {
      this.log.warn(`credential parse xato: ${e?.message}`);
      return { creds: null, source: null };
    }
  }

  private async loadCredentials(): Promise<ServiceAccount | null> {
    return (await this.resolveCreds()).creds;
  }

  /** UI orqali paste qilingan service-account JSON'ni tekshirib, shifrlab DB'ga saqlaydi. */
  async saveCredentials(jsonRaw: string, updatedBy?: string) {
    if (!jsonRaw || !jsonRaw.trim()) throw new BadRequestException('JSON bo\'sh');
    let parsed: any;
    try { parsed = JSON.parse(jsonRaw); }
    catch { throw new BadRequestException('JSON noto\'g\'ri — faylni to\'liq nusxalaganingizni tekshiring'); }
    if (!parsed?.client_email || !parsed?.private_key) {
      throw new BadRequestException('Bu service-account fayli emas (client_email / private_key yo\'q)');
    }
    const enc = this.crypto.encrypt(JSON.stringify(parsed));
    await this.settings.set(this.CRED_KEY, enc, updatedBy);
    return { ok: true, clientEmail: parsed.client_email, projectId: parsed.project_id || null };
  }

  /** DB'dagi saqlangan credentialни o'chiradi. */
  async clearCredentials(updatedBy?: string) {
    await this.settings.set(this.CRED_KEY, null, updatedBy);
    return { ok: true };
  }

  private makeSheetsClient(creds: ServiceAccount) {
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [SHEETS_SCOPE],
    });
    return google.sheets({ version: 'v4', auth });
  }

  /** Google API xatosidan tushunarli xabar chiqarish */
  private extractApiError(e: any): string {
    return (
      e?.response?.data?.error?.message ||
      e?.errors?.[0]?.message ||
      e?.message ||
      'Nomaʼlum Google API xatosi'
    );
  }

  // ─── Config get/set ───────────────────────────────────────────────
  async getRawConfig(): Promise<SheetTarget[]> {
    const raw = await this.settings.get(SETTINGS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Credential holati + saqlangan config (private key hech qachon qaytmaydi) */
  async getConfig() {
    const { creds, source } = await this.resolveCreds();
    const sheets = await this.getRawConfig();
    return {
      ok: true,
      credentials: {
        available: !!creds,
        clientEmail: creds?.client_email || null,
        projectId: creds?.project_id || null,
        source, // 'env' (server) | 'db' (UI paste) | null
      },
      sheets,
    };
  }

  async saveConfig(sheets: SheetTarget[], updatedBy?: string) {
    if (!Array.isArray(sheets)) throw new BadRequestException("sheets massiv bo'lishi kerak");
    // XOM (validateTarget'dan OLDIN) kelgan filtr — pipe qirqib tashlaganini fosh qiladi.
    const objReceived = sheets.reduce((a, s: any) => a + (Array.isArray(s?.filter?.objects) ? s.filter.objects.length : 0), 0);
    const clean = sheets.map((s, i) => this.validateTarget(s, i));
    await this.settings.set(SETTINGS_KEY, JSON.stringify(clean), updatedBy);
    const objSaved = clean.reduce((a, s) => a + (s.filter?.objects?.length || 0), 0);
    // Diagnostika — filtr "ketvoti" shikoyati uchun: XOM kelgan ↔ saqlangan.
    const fsum = clean
      .map((s) => `${s.name}[obj:${s.filter?.objects?.length || 0},typ:${s.filter?.txTypes?.length || 0},cat:${s.filter?.categories?.length || 0},sum:${s.filter?.amountSign || '-'}]`)
      .join(' ');
    this.log.log(`Export config saqlandi (${clean.length} sheet) — obj keldi=${objReceived}, saqlandi=${objSaved} · ${fsum}`);
    return { ok: true, sheets: clean, debug: { objReceived, objSaved } };
  }

  private validateTarget(s: SheetTarget, idx: number): SheetTarget {
    const label = s?.name || `Sheet ${idx + 1}`;
    const startRow = Math.max(1, Math.floor(Number(s?.startRow) || 1));
    const source: 'oplatakv' | 'transaction' = s?.source === 'transaction' ? 'transaction' : 'oplatakv';
    const fieldSet = source === 'transaction' ? TX_FIELD_KEYS : FIELD_KEYS;
    const columns = Array.isArray(s?.columns) ? s.columns : [];
    for (const c of columns) {
      if (c.col && !/^[A-Z]{1,3}$/.test(String(c.col).toUpperCase())) {
        throw new BadRequestException(`"${label}" — ustun harfi noto'g'ri: "${c.col}" (A..ZZZ)`);
      }
      if (c.field && !fieldSet.has(c.field)) {
        throw new BadRequestException(`"${label}" — nomaʼlum maydon: "${c.field}"`);
      }
    }
    return {
      id: s.id || `sheet-${idx + 1}`,
      name: label,
      source,
      spreadsheetId: (s.spreadsheetId || '').trim(),
      tabName: (s.tabName || '').trim(),
      startRow,
      dateFrom: s.dateFrom || null,
      filter: {
        objects: Array.isArray(s.filter?.objects) ? s.filter!.objects!.filter(Boolean) : [],
        categories: Array.isArray(s.filter?.categories) ? s.filter!.categories!.filter(Boolean) : [],
        txTypes: Array.isArray(s.filter?.txTypes) ? s.filter!.txTypes!.filter(Boolean) : [],
        accounts: Array.isArray(s.filter?.accounts) ? s.filter!.accounts!.map((a) => String(a).trim()).filter(Boolean) : [],
        amountSign: s.filter?.amountSign === 'pos' || s.filter?.amountSign === 'neg' ? s.filter.amountSign : null,
      },
      writeMode: s.writeMode === 'upsert' ? 'upsert' : 'replace',
      keyField: s.keyField && fieldSet.has(s.keyField) ? s.keyField : undefined,
      lastRowColumn: s.lastRowColumn && /^[A-Z]{1,3}$/.test(String(s.lastRowColumn).toUpperCase())
        ? String(s.lastRowColumn).toUpperCase() : undefined,
      cron: s.cron ? {
        enabled: !!s.cron.enabled,
        everyMinutes: Math.max(1, Math.floor(Number(s.cron.everyMinutes) || 60)),
        hourFrom: s.cron.hourFrom != null ? Math.min(23, Math.max(0, Math.floor(Number(s.cron.hourFrom)))) : undefined,
        hourTo: s.cron.hourTo != null ? Math.min(23, Math.max(0, Math.floor(Number(s.cron.hourTo)))) : undefined,
        days: Array.isArray(s.cron.days) ? s.cron.days.map((d) => Math.floor(Number(d))).filter((d) => d >= 0 && d <= 6) : [],
      } : undefined,
      columns: columns
        .filter((c) => c.col && c.field)
        .map((c) => ({ col: String(c.col).toUpperCase(), field: c.field })),
    };
  }

  // ─── Spreadsheet ID'ni to'liq linkdan ham qabul qilish ────────────
  private normalizeSpreadsheetId(raw: string): string {
    if (!raw) return '';
    const m = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return (m ? m[1] : raw).trim();
  }

  /** A1 notation uchun tab nomini qo'shtirnoq ichiga oladi (kirill/probel uchun) */
  private quoteTab(tab: string): string {
    return `'${String(tab).replace(/'/g, "''")}'`;
  }

  // ─── Bugungi sana (Tashkent, UTC+5) YYYY-MM-DD ────────────────────
  private todayTashkent(): string {
    const tash = new Date(Date.now() + 5 * 60 * 60 * 1000);
    return tash.toISOString().slice(0, 10);
  }

  private fmtDate(d: Date | null | undefined): string {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${dt.getUTCFullYear()}`;
  }

  private cellValue(row: any, field: string): string | number {
    switch (field) {
      case 'date':             return this.fmtDate(row.date);
      // Summa maydonlari — HAR DOIM musbat yoziladi (manfiy/возврат ham musbat ko'rinsin).
      case 'paymentAmount':    return row.paymentAmount    != null ? Math.abs(Number(row.paymentAmount))    : '';
      case 'firstInstallment': return row.firstInstallment != null ? Math.abs(Number(row.firstInstallment)) : '';
      case 'monthlyAmount':    return row.monthlyAmount    != null ? Math.abs(Number(row.monthlyAmount))    : '';
      case 'paymentCategory':  return row.paymentCategory ? (CATEGORY_LABEL[row.paymentCategory] || row.paymentCategory) : '';
      // XATO — CRM'da tasdiqlanmagan shartnoma: raqam o'rniga "XATO" yoziladi
      case 'contractNo':       return row.crmXato ? 'XATO' : (row.contractNo || '');
      case 'id':               return row.id || '';
      case 'object':           return row.object || '';
      case 'client':           return row.client || '';
      case 'txType':           return row.txType || '';
      case 'paymentMethod':    return row.paymentMethod || '';
      case 'purpose':          return row.purpose || '';
      case 'note':             return row.note || '';
      // ─── Tranzaksiya maydonlari ───
      case 'txnDate':          return this.fmtDate(row.txnDate);
      case 'amount':           return row.amount != null ? Math.abs(Number(row.amount)) : '';
      case 'direction':        return row.direction || '';
      case 'fromName':         return row.fromName || '';
      case 'fromAccount':      return row.fromAccount || '';
      case 'fromInn':          return row.fromInn || '';
      case 'toName':           return row.toName || '';
      case 'toAccount':        return row.toAccount || '';
      case 'toInn':            return row.toInn || '';
      case 'description':      return row.description || '';
      case 'contractNumber':   return row.contractNumber || '';
      case 'category':         return row.category || '';
      case 'subcategory':      return row.subcategory || '';
      case 'docNumber':        return row.docNumber || '';
      case 'reference':        return row.reference || '';
      case 'externalId':       return row.externalId || '';
      case 'accountNo':        return row.accountNo || '';
      case 'bankName':         return row.bankName || '';
      default:                 return '';
    }
  }

  // ─── Ulanishni tekshirish ─────────────────────────────────────────
  /**
   * Credential mavjudligini + har bir sozlangan jadvalga ruxsatni tekshiradi.
   * Har sheet uchun spreadsheet sarlavhasini o'qishga urinadi.
   */
  async testConnection() {
    const creds = await this.loadCredentials();
    if (!creds) {
      return {
        ok: false,
        step: 'auth',
        error: "Service-account topilmadi — serverga GOOGLE_SA_JSON (yoki GOOGLE_SA_KEYFILE) env qo'ying.",
      };
    }
    const sheetsApi = this.makeSheetsClient(creds);
    const targets = await this.getRawConfig();
    const checks: Array<{ id: string; name: string; ok: boolean; title?: string; error?: string }> = [];
    for (const t of targets) {
      const spreadsheetId = this.normalizeSpreadsheetId(t.spreadsheetId);
      if (!spreadsheetId) {
        checks.push({ id: t.id, name: t.name, ok: false, error: 'Spreadsheet ID kiritilmagan' });
        continue;
      }
      try {
        const meta = await sheetsApi.spreadsheets.get({
          spreadsheetId,
          fields: 'properties.title,sheets.properties.title',
        });
        const title = meta.data.properties?.title || '';
        const tabs = (meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean) as string[];
        const tabOk = !t.tabName || tabs.includes(t.tabName);
        checks.push({
          id: t.id, name: t.name, ok: tabOk, title,
          error: tabOk ? undefined : `"${t.tabName}" nomli list topilmadi. Mavjud: ${tabs.join(', ') || '—'}`,
        });
      } catch (e: any) {
        checks.push({ id: t.id, name: t.name, ok: false, error: this.extractApiError(e) });
      }
    }
    return {
      ok: true,
      clientEmail: creds.client_email,
      projectId: creds.project_id || null,
      checks,
    };
  }

  // ─── Bitta sheet uchun eksport (clear + yozish) ───────────────────
  /** Export filtrlari uchun distinct Объект/Тип — dropdown uchun. */
  async distinctFilters() {
    return this.oplataKv.distinctExportFilters();
  }

  /**
   * Oldindan ko'rish — joriy filtr bilan nechta qator mos kelishini (yozmasdan) qaytaradi.
   * Foydalanuvchi «Bajarish»dan oldin filtr TA'SIR qilayotganini ko'radi (filtered < total).
   */
  async previewCount(target: SheetTarget) {
    const dateTo = this.todayTashkent();
    const res = target.source === 'transaction'
      ? await this.transactions.countForExport({
          accounts: target.filter?.accounts || [],
          dateFrom: target.dateFrom || null, dateTo,
        })
      : await this.oplataKv.countForExport({
          dateFrom: target.dateFrom || null, dateTo,
          objects: target.filter?.objects || [],
          categories: target.filter?.categories || [],
          txTypes: target.filter?.txTypes || [],
          amountSign: target.filter?.amountSign || null,
        });
    return { ok: true, ...res, dateFrom: target.dateFrom || null, dateTo };
  }

  /** Sheet oxirgi export'da yozgan noyob row ID'lari (ix_id) — yuklab olish uchun. */
  async getUpsertKeys(sheetId: string) {
    // Yuklab olish uchun — HAR DOIM noyob row ID (ix_id). Sana/kalit-ustun EMAS.
    const ids = await this.loadWrittenIds(sheetId);
    if (ids.length) return { ok: true, sheetId, count: ids.length, keys: ids };
    // Backward-compat: writtenIds hali yozilmagan bo'lsa, eski upsertKeys'ni qaytaramiz.
    const keys = Array.from(await this.loadUpsertKeys(sheetId));
    return { ok: true, sheetId, count: keys.length, keys };
  }

  /** Upsert uchun — sheet oxirgi marta yozgan kalitlar (qo'lda qo'shilganni ajratish uchun). */
  private async loadUpsertKeys(sheetId: string): Promise<Set<string>> {
    try {
      const raw = await this.settings.get(`export.upsertKeys.${sheetId}`);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return new Set(arr.map(String)); }
    } catch { /* skip */ }
    return new Set();
  }
  private async saveUpsertKeys(sheetId: string, keys: string[]): Promise<void> {
    try {
      await this.settings.set(`export.upsertKeys.${sheetId}`, JSON.stringify(keys.slice(0, 200000)), 'export');
    } catch { /* skip */ }
  }

  /**
   * Sheet oxirgi export'da yozgan NOYOB row ID'lari (ix_id) — API jamosiga berish uchun.
   * upsertKeys'dan farqli: bu HAR DOIM row.id (sana/kalit-ustun emas), mapping'ga bog'liq emas.
   */
  private async loadWrittenIds(sheetId: string): Promise<string[]> {
    try {
      const raw = await this.settings.get(`export.writtenIds.${sheetId}`);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.map(String); }
    } catch { /* skip */ }
    return [];
  }
  private async saveWrittenIds(sheetId: string, ids: string[]): Promise<void> {
    try {
      await this.settings.set(`export.writtenIds.${sheetId}`, JSON.stringify(ids.slice(0, 200000)), 'export');
    } catch { /* skip */ }
  }

  /** Ustun harfi (A, B, …, AA) → 0-based indeks. */
  private colToIdx(letter: string): number {
    let n = 0; for (const ch of String(letter).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1;
  }

  /**
   * Google Sheets grid (qator/ustun soni) yozish uchun yetarli bo'lishini ta'minlaydi.
   * Grid chegarasidan tashqariga yozib bo'lmaydi ("exceeds grid limits" xatosi) —
   * shuning uchun kerak bo'lsa jadvalni oldindan kengaytiramiz (rowCount/columnCount oshiramiz).
   * Faqat o'stiradi, hech qачон kichraytirmaydi (mavjud ma'lumot yo'qolmaydi).
   */
  private async ensureGrid(
    sheetsApi: any, spreadsheetId: string, tabName: string,
    neededRows: number, neededCols: number,
  ): Promise<void> {
    const meta = await sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
    });
    const sheet = (meta.data.sheets || []).find((s: any) => s.properties?.title === tabName);
    if (!sheet?.properties) return; // tab topilmasa — keyingi bosqich aniq xato beradi
    const gp = sheet.properties.gridProperties || {};
    const curRows = Number(gp.rowCount || 0);
    const curCols = Number(gp.columnCount || 0);
    const wantRows = Math.max(curRows, Math.ceil(neededRows));
    const wantCols = Math.max(curCols, Math.ceil(neededCols));
    if (wantRows <= curRows && wantCols <= curCols) return; // joy yetarli
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId: sheet.properties.sheetId,
              gridProperties: { rowCount: wantRows, columnCount: wantCols },
            },
            fields: 'gridProperties.rowCount,gridProperties.columnCount',
          },
        }],
      },
    });
    this.log.log(`Grid kengaytirildi: "${tabName}" → ${wantRows} qator × ${wantCols} ustun`);
  }

  /**
   * UPSERT — Google Sheets'ni tozalamasdan sinxronlaydi:
   *   keyField bo'yicha mavjud qatorni UPDATE qiladi, yangisini QO'SHADI,
   *   DB'da endi yo'q qatorlarning ustunlarini TOZALAYDI (boshqa ustunlarga tegmaydi).
   */
  private async upsertRows(
    sheetsApi: any, spreadsheetId: string, quotedTab: string, tabName: string,
    columns: Array<{ col: string; field: string }>, startRow: number, rows: any[], keyFieldOpt: string | undefined,
    prevKeys: Set<string>, anchorColOpt?: string,
  ): Promise<{ writtenRange: string | null; rowsWritten: number; clearedRanges: string[]; dbKeys: string[]; debug: Record<string, number> }> {
    const keyField = keyFieldOpt || columns[0]?.field;
    const keyColLetter = columns.find((c) => c.field === keyField)?.col;
    if (!keyColLetter) throw new Error(`Upsert uchun kalit maydon "${keyField}" ustun mapping'da yo'q — uni ustunga qo'shing.`);

    // Ustun harfi ↔ indeks (A=0 … Z=25, AA=26 …)
    const colIdx = (letter: string): number => {
      let n = 0; for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1;
    };
    const idxToLetter = (i: number): string => {
      let s = ''; let x = i + 1; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s;
    };
    const keyIdx = colIdx(keyColLetter);
    const maxIdx = Math.max(...columns.map((c) => colIdx(c.col)));

    // OXIRGI QATORNI "BIRINCHI UZLUKSIZ TO'LOV BLOKI" bo'yicha aniqlaymiz — bu ENG ISHONCHLI usul.
    // Jadval murakkab: tepada REAL to'lovlar zich (kichik ichki bo'shliqlar bilan), keyin KATTA
    // bo'sh zona (bron/formula qatorlar — № va status bor, lekin to'lov A..E YO'Q), undan ham past —
    // eski buzuq append'dan qolgan "stray". YAKKA ustun (F/H/G) ishlamaydi: F,H bron qatorlarga
    // oldindan to'ldirilgan/formula, G'da stray bor. Yechim: TO'LOV ustunlarida (A..E) ma'lumot bor
    // qatorlarni ketma-ket sanaymiz; KATTA bo'shliq (GAP_LIMIT) kelganda TO'XTAYMIZ — shunda faqat
    // birinchi (REAL) to'lov bloki qoladi; bron ham, stray ham hisobga OLINMAYDI.
    const anchorCol = (anchorColOpt && /^[A-Z]{1,3}$/.test(String(anchorColOpt).toUpperCase()))
      ? String(anchorColOpt).toUpperCase() : 'H';
    const readMaxIdx = maxIdx; // to'lov ustunlari (A..G) yetarli

    // 1) Oralig'ni BIR marta o'qiymiz (A..maxCol) — kalitlar (keyToIdx) + to'lov bloki uchun.
    const getResp = await sheetsApi.spreadsheets.values.get({
      spreadsheetId, range: `${quotedTab}!A${startRow}:${idxToLetter(readMaxIdx)}`,
    });
    const existing: any[][] = getResp.data.values || [];
    // TO'LOV ustunlari indeksi (mapping, kalit G'dan tashqari) — masalan A..E.
    const payIdxs = columns.map((c) => colIdx(c.col)).filter((x) => x !== keyIdx);
    // Append REJASI — SOF funksiya (google-export.plan.spec.ts da haqiqiy «Заявки» tuzilishi bilan
    // test qilingan): anchorLen = birinchi to'lov blokining oxiri (bron/stray tashlanadi);
    // keyToIdx = FAQAT shu blok kalitlari (bron/stray match QILINMAYDI → hech qaysi yozuv yo'qolmaydi).
    const { anchorLen, keyToIdx } = planUpsertRows(existing, payIdxs, keyIdx, 200);

    // Tegiladigan hujayralar: ustun → (sheet qator raqami → qiymat). Boshqa (qo'lda) qatorlarga TEGMAYMIZ.
    const touched: Record<string, Map<number, any>> = {};
    for (const c of columns) touched[c.col] = new Map();

    const dbKeys = new Set<string>();
    const news: any[] = [];
    let updated = 0;
    for (const r of rows) {
      const k = String(this.cellValue(r, keyField) ?? '').trim();
      if (k) dbKeys.add(k);
      const idx = k ? keyToIdx.get(k) : undefined;
      if (idx != null) {
        const sheetRow = startRow + idx;
        for (const c of columns) touched[c.col].set(sheetRow, this.cellValue(r, c.field));
        updated++;
      } else {
        news.push(r);
      }
    }

    // Stale — export o'zi yozgan (prevKeys) va endi DB'da yo'q → o'sha qatorning mapping ustunlarini tozalaymiz.
    let cleared = 0;
    for (const [k, idx] of keyToIdx.entries()) {
      if (prevKeys.has(k) && !dbKeys.has(k)) {
        const sheetRow = startRow + idx;
        for (const c of columns) touched[c.col].set(sheetRow, '');
        cleared++;
      }
    }

    // Yangi qatorlar — ANKER (F) ustunidagi oxirgi TO'LA qatordan KEYIN qo'shiladi.
    // (existing.length EMAS — F'dan tashqari ustunlarda yoki pastda qoldiq bo'lishi mumkin,
    //  o'sha oxirgi qatorni noto'g'ri pastga surib, yangi ma'lumotni bo'sh zonaga tashlardi.)
    const appendStartRow = startRow + anchorLen;
    this.log.log(`Upsert append: "${tabName}" birinchi to'lov bloki oxiri=${startRow + anchorLen - 1} (bron/stray tashlandi; anker cfg=${anchorCol}), yangi qatorlar ${appendStartRow}-qatordan`);
    news.forEach((r, j) => {
      const sheetRow = appendStartRow + j;
      for (const c of columns) touched[c.col].set(sheetRow, this.cellValue(r, c.field));
    });

    // 2) Ketma-ket qatorlarni BITTA diapazonga guruhlab yozamiz (tez! har hujayra alohida emas).
    const data: any[] = [];
    for (const c of columns) {
      const entries = Array.from(touched[c.col].entries()).sort((a, b) => a[0] - b[0]); // [sheetRow, value]
      let i = 0;
      while (i < entries.length) {
        let j = i;
        while (j + 1 < entries.length && entries[j + 1][0] === entries[j][0] + 1) j++;
        const startR = entries[i][0];
        const endR = entries[j][0];
        const vals = entries.slice(i, j + 1).map((e) => (e[1] == null ? '' : e[1]));
        data.push({ range: `${quotedTab}!${c.col}${startR}:${c.col}${endR}`, majorDimension: 'COLUMNS' as const, values: [vals] });
        i = j + 1;
      }
    }
    // Grid yetarli bo'lsin — yangi qatorlar/ustunlar grid chegarasidan ("exceeds grid limits") oshmasin.
    let maxSheetRow = startRow;
    for (const c of columns) for (const rr of touched[c.col].keys()) if (rr > maxSheetRow) maxSheetRow = rr;
    await this.ensureGrid(sheetsApi, spreadsheetId, tabName, maxSheetRow, maxIdx + 1);

    if (data.length > 0) {
      await sheetsApi.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data } });
    }

    const cols = columns.map((c) => c.col);
    const writtenRange = news.length > 0
      ? `${tabName}!${cols[0]}${appendStartRow}:${cols[cols.length - 1]}${appendStartRow + news.length - 1}`
      : `${tabName} · ${updated} yangilandi${cleared ? `, ${cleared} tozalandi` : ''}`;
    return {
      writtenRange,
      rowsWritten: updated + news.length,
      clearedRanges: cleared ? [`${tabName} · ${cleared} qator tozalandi`] : [],
      dbKeys: Array.from(dbKeys),
      debug: {
        existingRows: existing.length,   // A..G o'qishда qaytган qatorlar soni
        anchorLen,                        // birinchi to'lov bloki uzunligi
        blockLastRow: startRow + anchorLen - 1, // real blok oxirgi qatori (sheet raqami)
        appendStartRow,                   // yangi qatorlar shu qatordan
        blockKeys: keyToIdx.size,         // blokдаги kalitlar soni
        dbRows: rows.length,              // DB'dan kelган yozuvlar (153 bo'lishi kerak)
        updated,                          // mos kelib YANGILANган (blokда bor)
        added: news.length,               // yangi QO'SHILган
        cleared,                          // stale tozalanган
      },
    };
  }

  async run(target: SheetTarget) {
    const startedAt = Date.now();
    // Build marker: upsert append = oxirgi qator BARCHA ustun bo'yicha (full-width) — v2.
    this.log.log(`Export run boshlandi: "${target?.name}" (${target?.writeMode || 'replace'})`);
    let step: 'auth' | 'validate' | 'clear' | 'fetch' | 'write' = 'auth';
    try {
      const creds = await this.loadCredentials();
      if (!creds) {
        return {
          ok: false, step: 'auth',
          error: "Service-account topilmadi — serverga GOOGLE_SA_JSON (yoki GOOGLE_SA_KEYFILE) env qo'ying.",
        };
      }

      step = 'validate';
      const spreadsheetId = this.normalizeSpreadsheetId(target.spreadsheetId);
      if (!spreadsheetId) return { ok: false, step, error: 'Spreadsheet ID kiritilmagan' };
      if (!target.tabName)  return { ok: false, step, error: 'Jadval (list) nomi kiritilmagan' };
      const columns = (target.columns || [])
        .filter((c) => c.col && c.field)
        .map((c) => ({ col: String(c.col).toUpperCase(), field: c.field }));
      if (columns.length === 0) return { ok: false, step, error: "Hech qanday ustun mapping qilinmagan" };
      const startRow = Math.max(1, Math.floor(Number(target.startRow) || 1));
      const quotedTab = this.quoteTab(target.tabName);

      const sheetsApi = this.makeSheetsClient(creds);

      // 1) FETCH — manba (ОплатыКв yoki Tranzaksiya) bo'yicha
      step = 'fetch';
      const dateTo = this.todayTashkent();
      const rows = target.source === 'transaction'
        ? await this.transactions.getRowsForExport({
            accounts: target.filter?.accounts || [],
            dateFrom: target.dateFrom || null,
            dateTo,
          })
        : await this.oplataKv.getRowsForExport({
            dateFrom: target.dateFrom || null,
            dateTo,
            objects: target.filter?.objects || [],
            categories: target.filter?.categories || [],
            txTypes: target.filter?.txTypes || [],
            amountSign: target.filter?.amountSign || null,
          });

      // 2) WRITE — rejimga qarab
      let writtenRange: string | null = null;
      let rowsWritten = rows.length;
      let clearedRanges: string[];
      let upsertDebug: any = null; // diagnostika (upsert rejimida)

      if (target.writeMode === 'upsert') {
        // UPSERT — jadvalni tozalamaydi. Export o'zi yozgan (prevKeys) qatorlar ichidan
        // DB'dan o'chganlari tozalanadi; foydalanuvchi QO'LDA qo'shgan qatorlar saqlanadi.
        step = 'write';
        const prevKeys = await this.loadUpsertKeys(target.id);
        const up = await this.upsertRows(sheetsApi, spreadsheetId, quotedTab, target.tabName, columns, startRow, rows, target.keyField, prevKeys, target.lastRowColumn);
        await this.saveUpsertKeys(target.id, up.dbKeys);
        // ix_id (noyob row ID) — API jamosiga «Yuklab olish» uchun (mapping'ga bog'liq emas).
        await this.saveWrittenIds(target.id, rows.map((r) => String(r.id ?? '')).filter(Boolean));
        writtenRange = up.writtenRange;
        rowsWritten = up.rowsWritten;
        clearedRanges = up.clearedRanges;
        upsertDebug = up.debug;
      } else {
        // REPLACE (default) — ustunlarni tozalab qayta yozamiz
        step = 'clear';
        await sheetsApi.spreadsheets.values.batchClear({
          spreadsheetId,
          requestBody: { ranges: columns.map((c) => `${quotedTab}!${c.col}${startRow}:${c.col}`) },
        });
        clearedRanges = columns.map((c) => `${target.tabName}!${c.col}${startRow}:${c.col}`);

        step = 'write';
        if (rows.length > 0) {
          const data = columns.map((c) => ({
            range: `${quotedTab}!${c.col}${startRow}`,
            majorDimension: 'COLUMNS' as const,
            values: [rows.map((r) => this.cellValue(r, c.field))],
          }));
          // Grid yetarli bo'lsin — "exceeds grid limits" xatosining oldini olamiz.
          const maxColIdx = Math.max(...columns.map((c) => this.colToIdx(c.col)));
          await this.ensureGrid(sheetsApi, spreadsheetId, target.tabName, startRow + rows.length - 1, maxColIdx + 1);
          await sheetsApi.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: { valueInputOption: 'USER_ENTERED', data },
          });
          const cols = columns.map((c) => c.col);
          writtenRange = `${target.tabName}!${cols[0]}${startRow}:${cols[cols.length - 1]}${startRow + rows.length - 1}`;
        }
        // REPLACE ham yozgan kalitlarini eslaydi — keyin filtrlangan UPSERT'da
        // eski (filtrga tushmagan) qatorlarni tozalay olsin.
        const keyF = target.keyField || columns.find((c) => c.field === 'id' || c.field === 'externalId')?.field || columns[0]?.field;
        if (keyF) {
          await this.saveUpsertKeys(target.id, rows.map((r) => String(this.cellValue(r, keyF) ?? '').trim()).filter(Boolean));
        }
        // ix_id (noyob row ID) — API jamosiga «Yuklab olish» uchun (mapping'ga bog'liq emas).
        await this.saveWrittenIds(target.id, rows.map((r) => String(r.id ?? '')).filter(Boolean));
      }

      const durationMs = Date.now() - startedAt;
      this.log.log(
        `Export OK (${target.writeMode || 'replace'}): "${target.name}" → ${spreadsheetId}/${target.tabName} · ${rowsWritten} qator · ${durationMs}ms`,
      );
      return {
        ok: true,
        sheet: { id: target.id, name: target.name, spreadsheetId, tabName: target.tabName },
        clearedRanges,
        rowsFetched: rows.length,
        rowsWritten,
        writtenRange,
        writeMode: target.writeMode || 'replace',
        // Serverga AYNAN yetib kelgan filtr (klobber/uzatilmaganini fosh qiladi).
        appliedFilter: target.source === 'transaction'
          ? { accounts: (target.filter?.accounts || []).length }
          : {
              objects: (target.filter?.objects || []).length,
              txTypes: (target.filter?.txTypes || []).length,
              categories: (target.filter?.categories || []).length,
              amountSign: target.filter?.amountSign || null,
            },
        columns: columns.map((c) => ({ col: c.col, field: c.field })),
        dateFrom: target.dateFrom || null,
        dateTo,
        startRow,
        durationMs,
        debug: upsertDebug, // upsert diagnostikasi (nechta o'qildi/update/qo'shildi/qayerga)
      };
    } catch (e: any) {
      const error = this.extractApiError(e);
      this.log.warn(`Export XATO (step=${step}): "${target?.name}" — ${error}`);
      return {
        ok: false,
        step,
        error,
        sheet: { id: target?.id, name: target?.name },
        durationMs: Date.now() - startedAt,
      };
    }
  }

  // ═══ CRON — avtomatik jadval (har N daqiqa, soat oralig'i, hafta kunlari) ═══
  private cronLastRun: Record<string, number> = {}; // sheetId → oxirgi ishga tushish (epoch ms)

  /** Run natijasini ExportCronLog'ga yozadi (cron va qo'lda — ikkalasi ham). */
  private async logExportRun(target: SheetTarget, result: any, mode: 'cron' | 'manual', triggeredBy: string): Promise<void> {
    try {
      await this.prisma.exportCronLog.create({
        data: {
          sheetId: target?.id || '',
          sheetName: target?.name || '',
          source: target?.source || 'oplatakv',
          writeMode: target?.writeMode || 'replace',
          mode,
          status: result?.ok ? 'ok' : 'error',
          rowsFetched: Number(result?.rowsFetched || 0),
          rowsWritten: Number(result?.rowsWritten || 0),
          durationMs: Number(result?.durationMs || 0),
          error: result?.ok ? null : (result?.error || null),
          triggeredBy: triggeredBy?.slice(0, 118) || null,
        },
      });
    } catch (e: any) {
      this.log.warn(`Export log yozish xato: ${e?.message}`);
    }
  }

  /** Bitta sheet'ni ishga tushirib, natijani log'ga yozadi. */
  async runAndLog(target: SheetTarget, mode: 'cron' | 'manual', triggeredBy: string) {
    const result = await this.run(target);
    await this.logExportRun(target, result, mode, triggeredBy);
    return result;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async exportSheetsCronTick(): Promise<void> {
    try {
      const sheets = await this.getRawConfig();
      const cronSheets = sheets.filter((s) => s.cron?.enabled);
      if (cronSheets.length === 0) return;

      const tash = new Date(Date.now() + 5 * 60 * 60 * 1000); // UTC+5
      const hour = tash.getUTCHours();
      const dow = tash.getUTCDay(); // 0=Yakshanba .. 6=Shanba
      const now = Date.now();

      for (const s of cronSheets) {
        const c = s.cron!;
        if (Array.isArray(c.days) && c.days.length > 0 && !c.days.includes(dow)) continue; // kun mos emas
        if (c.hourFrom != null && hour < c.hourFrom) continue;                              // soatdan oldin
        if (c.hourTo != null && hour > c.hourTo) continue;                                  // soatdan keyin
        const every = Math.max(1, Number(c.everyMinutes) || 60);
        const last = this.cronLastRun[s.id] || 0;
        if (now - last < every * 60 * 1000) continue; // interval hali to'lmagan
        this.cronLastRun[s.id] = now;

        this.log.log(`Export cron: "${s.name}" ishga tushdi (har ${every} daq)`);
        const r = await this.runAndLog(s, 'cron', 'cron');
        this.log.log(`Export cron natija "${s.name}": ${r.ok ? `OK ${r.rowsWritten} qator` : `XATO ${r.error}`}`);
      }
    } catch (e: any) {
      this.log.warn(`Export cron tick xato: ${e?.message}`);
    }
  }

  /** Cron log — paginatsiya + sana/ish/status filtri (Log sub-tab uchun). */
  async getCronLogs(opts: { page?: number; pageSize?: number; sheetId?: string; dateFrom?: string; dateTo?: string; status?: string }) {
    const page = Math.max(1, Number(opts.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20));
    const where: any = {};
    if (opts.sheetId) where.sheetId = opts.sheetId;
    if (opts.status === 'ok' || opts.status === 'error') where.status = opts.status;
    if (opts.dateFrom || opts.dateTo) {
      where.startedAt = {};
      if (opts.dateFrom) where.startedAt.gte = new Date(opts.dateFrom);
      if (opts.dateTo) where.startedAt.lte = new Date(`${opts.dateTo}T23:59:59.999`);
    }
    const [total, items] = await Promise.all([
      this.prisma.exportCronLog.count({ where }),
      this.prisma.exportCronLog.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    // Filtr dropdowni uchun — log'da uchraydigan sheet'lar
    const sheetsInLog = await this.prisma.exportCronLog.findMany({
      distinct: ['sheetId'], select: { sheetId: true, sheetName: true }, orderBy: { sheetName: 'asc' }, take: 200,
    });
    return {
      ok: true, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)),
      items,
      sheets: sheetsInLog.map((s) => ({ sheetId: s.sheetId, sheetName: s.sheetName })),
    };
  }

  // ─── FAYL YUKLAB OLISH (JSON/SQL/Excel/CSV/...) ────────────────────
  /** Datasetni tanlangan formatga o'girib buffer + fayl nomi qaytaradi. */
  async downloadData(
    dataset: string,
    format: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const meta = FORMATS[format];
    if (!meta) throw new BadRequestException(`Nomaʼlum format: ${format}`);
    const ds = dataset === 'transactions'
      ? await this.transactionsDataset()
      : await this.oplatykvDataset();
    const buffer = await serialize(format, ds);
    const filename = `${ds.table}-${this.todayTashkent()}.${meta.ext}`;
    return { buffer, filename, contentType: meta.mime };
  }

  private async oplatykvDataset(): Promise<Dataset> {
    const rows = await this.oplataKv.getRowsForExport({});
    const columns = [
      { key: 'id',               header: 'ID' },
      { key: 'contractNo',       header: 'Дог №' },
      { key: 'date',             header: 'Дата' },
      { key: 'paymentAmount',    header: 'Сумма оплаты' },
      { key: 'firstInstallment', header: '1 взнос' },
      { key: 'monthlyAmount',    header: 'ежемесячный' },
      { key: 'paymentCategory',  header: 'Оплата' },
      { key: 'object',           header: 'Объект' },
      { key: 'client',           header: 'Клиент' },
      { key: 'txType',           header: 'Тип' },
      { key: 'paymentMethod',    header: 'Способ оплаты' },
      { key: 'purpose',          header: 'Назначение' },
      { key: 'note',             header: 'Примечание' },
    ];
    const mapped = rows.map((r: any) => ({
      id: r.id,
      contractNo: r.contractNo,
      date: r.date,
      paymentAmount:    r.paymentAmount    != null ? Number(r.paymentAmount)    : null,
      firstInstallment: r.firstInstallment != null ? Number(r.firstInstallment) : null,
      monthlyAmount:    r.monthlyAmount    != null ? Number(r.monthlyAmount)    : null,
      paymentCategory: r.paymentCategory,
      object: r.object,
      client: r.client,
      txType: r.txType,
      paymentMethod: r.paymentMethod,
      purpose: r.purpose,
      note: r.note,
    }));
    return { table: 'oplaty_kv', columns, rows: mapped };
  }

  private async transactionsDataset(): Promise<Dataset> {
    const txs = await this.prisma.transaction.findMany({
      orderBy: { txnDate: 'desc' },
      take: 100000,
      select: {
        externalId: true, txnDate: true, direction: true, amount: true, currency: true,
        type: true, status: true, contractNumber: true,
        fromName: true, fromInn: true, toName: true, toInn: true, description: true,
        category: { select: { name: true } },
        subcategory: { select: { name: true } },
      },
    });
    const columns = [
      { key: 'externalId',     header: 'ID' },
      { key: 'txnDate',        header: 'Sana' },
      { key: 'direction',      header: "Yo'nalish" },
      { key: 'amount',         header: 'Summa' },
      { key: 'currency',       header: 'Valyuta' },
      { key: 'type',           header: 'Tur' },
      { key: 'status',         header: 'Holat' },
      { key: 'contractNumber', header: 'Shartnoma' },
      { key: 'category',       header: 'Kategoriya' },
      { key: 'subcategory',    header: 'Subkategoriya' },
      { key: 'fromName',       header: 'Yuboruvchi' },
      { key: 'fromInn',        header: 'Yub. INN' },
      { key: 'toName',         header: 'Qabul qiluvchi' },
      { key: 'toInn',          header: 'Qab. INN' },
      { key: 'description',    header: 'Izoh' },
    ];
    const mapped = txs.map((t: any) => ({
      externalId: t.externalId,
      txnDate: t.txnDate,
      direction: t.direction,
      amount: t.amount != null ? Number(t.amount) : null,
      currency: t.currency,
      type: t.type,
      status: t.status,
      contractNumber: t.contractNumber,
      category: t.category?.name ?? null,
      subcategory: t.subcategory?.name ?? null,
      fromName: t.fromName,
      fromInn: t.fromInn,
      toName: t.toName,
      toInn: t.toInn,
      description: t.description,
    }));
    return { table: 'transactions', columns, rows: mapped };
  }

  // ═══ AUTSOURCING — shartnomalar Excel'ini Telegram guruhga ═══
  private readonly AUTS_TOKEN = 'autsourcing.botToken';
  private readonly AUTS_GROUP = 'autsourcing.groupId';
  private readonly AUTS_COLS = 'autsourcing.columns';
  private readonly AUTS_CONTRACTS = 'autsourcing.contracts';
  private readonly AUTS_DATEFROM = 'autsourcing.dateFrom';
  private readonly AUTS_CRON_ON = 'autsourcing.cronEnabled';
  private readonly AUTS_CRON_TIME = 'autsourcing.cronTime';

  /** Sozlama holati — bot token qaytmaydi (faqat oxirgi 4 belgi hint). */
  async getAutsourcingConfig() {
    const [encToken, groupId, cols, contracts, dateFrom, cronOn, cronTime] = await Promise.all([
      this.settings.get(this.AUTS_TOKEN),
      this.settings.get(this.AUTS_GROUP),
      this.settings.get(this.AUTS_COLS),
      this.settings.get(this.AUTS_CONTRACTS),
      this.settings.get(this.AUTS_DATEFROM),
      this.settings.get(this.AUTS_CRON_ON),
      this.settings.get(this.AUTS_CRON_TIME),
    ]);
    let hasToken = false;
    let tokenHint: string | null = null;
    if (encToken) {
      try {
        const t = this.crypto.decrypt(encToken);
        hasToken = !!t;
        tokenHint = t ? `…${t.slice(-4)}` : null;
      } catch { /* noto'g'ri shifr */ }
    }
    const parseArr = (s: string | null): string[] => {
      if (!s) return [];
      try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; }
    };
    return {
      ok: true,
      hasToken,
      tokenHint,
      groupId: groupId || null,
      columns: parseArr(cols),
      contracts: parseArr(contracts),
      dateFrom: dateFrom || null,
      cronEnabled: cronOn === '1',
      cronTime: cronTime && /^\d{1,2}:\d{2}$/.test(cronTime) ? cronTime : '',
    };
  }

  async saveAutsourcingConfig(
    body: {
      botToken?: string; groupId?: string; columns?: string[];
      contracts?: string[]; dateFrom?: string | null;
      cronEnabled?: boolean; cronTime?: string;
    },
    updatedBy?: string,
  ) {
    if (body.botToken !== undefined && body.botToken.trim()) {
      await this.settings.set(this.AUTS_TOKEN, this.crypto.encrypt(body.botToken.trim()), updatedBy);
    }
    if (body.groupId !== undefined) {
      await this.settings.set(this.AUTS_GROUP, body.groupId.trim() || null, updatedBy);
    }
    if (body.columns !== undefined) {
      await this.settings.set(this.AUTS_COLS, JSON.stringify(body.columns), updatedBy);
    }
    if (body.contracts !== undefined) {
      const clean = (body.contracts || []).map((c) => String(c).trim()).filter(Boolean);
      await this.settings.set(this.AUTS_CONTRACTS, JSON.stringify(clean), updatedBy);
    }
    if (body.dateFrom !== undefined) {
      await this.settings.set(this.AUTS_DATEFROM, body.dateFrom || null, updatedBy);
    }
    if (body.cronEnabled !== undefined) {
      await this.settings.set(this.AUTS_CRON_ON, body.cronEnabled ? '1' : null, updatedBy);
    }
    if (body.cronTime !== undefined) {
      const t = body.cronTime && /^\d{1,2}:\d{2}$/.test(body.cronTime) ? body.cronTime : null;
      await this.settings.set(this.AUTS_CRON_TIME, t, updatedBy);
    }
    return this.getAutsourcingConfig();
  }

  // Cron — kuniga 1 marta belgilangan soatda avto-jo'natish
  private autsLastRunDay: number | null = null;

  @Cron(CronExpression.EVERY_MINUTE)
  async autsourcingCronTick() {
    try {
      const [enabled, time] = await Promise.all([
        this.settings.get(this.AUTS_CRON_ON),
        this.settings.get(this.AUTS_CRON_TIME),
      ]);
      if (enabled !== '1' || !time || !/^\d{1,2}:\d{2}$/.test(time)) return;

      const tash = new Date(Date.now() + 5 * 60 * 60 * 1000); // UTC+5
      const hm = `${String(tash.getUTCHours()).padStart(2, '0')}:${String(tash.getUTCMinutes()).padStart(2, '0')}`;
      const wantHm = time.length === 4 ? `0${time}` : time; // "8:00" → "08:00"
      if (hm !== wantHm) return;

      const day = tash.getUTCDate();
      if (this.autsLastRunDay === day) return; // shu kun bajarildi
      this.autsLastRunDay = day;

      const [contractsRaw, columnsRaw, dateFrom] = await Promise.all([
        this.settings.get(this.AUTS_CONTRACTS),
        this.settings.get(this.AUTS_COLS),
        this.settings.get(this.AUTS_DATEFROM),
      ]);
      const contracts: string[] = contractsRaw ? JSON.parse(contractsRaw) : [];
      const columns: string[] = columnsRaw ? JSON.parse(columnsRaw) : [];
      if (contracts.length === 0 || columns.length === 0) {
        this.log.warn('Autsoursing cron: shartnoma yoki ustun saqlanmagan — o\'tkazildi');
        return;
      }
      this.log.log(`Autsoursing cron ishga tushdi (${hm}) — ${contracts.length} shartnoma`);
      const r = await this.sendAutsourcing(contracts, columns, dateFrom || null);
      this.log.log(`Autsoursing cron natija: ${r.ok ? `OK ${r.rows} qator` : `XATO ${r.error}`}`);
    } catch (e: any) {
      this.log.warn(`Autsoursing cron xato: ${e?.message}`);
    }
  }

  private async getAutsourcingRaw(): Promise<{ token: string | null; groupId: string | null }> {
    const [encToken, groupId] = await Promise.all([
      this.settings.get(this.AUTS_TOKEN),
      this.settings.get(this.AUTS_GROUP),
    ]);
    let token: string | null = null;
    if (encToken) { try { token = this.crypto.decrypt(encToken); } catch { /* skip */ } }
    return { token, groupId };
  }

  /** Tanlangan ustunlardan ОплатыКв qatorlari uchun Excel yasaydi. */
  private async buildAutsourcingXlsx(cols: ExportColumn[], rows: any[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    const ws = wb.addWorksheet('Autsoursing');
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: 18 }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    for (const r of rows) {
      const row: Record<string, any> = {};
      for (const c of cols) {
        let v: any = r[c.key];
        if (c.key === 'date' && v) {
          const d = new Date(v);
          v = `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
        } else if (c.key === 'paymentAmount' || c.key === 'firstInstallment' || c.key === 'monthlyAmount') {
          v = v != null ? Number(v) : null;
        } else if (c.key === 'paymentCategory') {
          v = v ? (CATEGORY_LABEL[v] || v) : '';
        }
        row[c.key] = v ?? '';
      }
      const added = ws.addRow(row);
      for (const k of ['paymentAmount', 'firstInstallment', 'monthlyAmount']) {
        if (cols.some((c) => c.key === k)) added.getCell(k).numFmt = '#,##0.00';
      }
    }
    const ab = await wb.xlsx.writeBuffer();
    return Buffer.from(ab);
  }

  /**
   * Shartnomalar bo'yicha ОплатыКв ma'lumotini (tanlangan ustunlar) Excel qilib
   * sozlangan Telegram guruhga jo'natadi.
   */
  async sendAutsourcing(contracts: string[], columnKeys: string[], dateFrom?: string | null) {
    const startedAt = Date.now();
    const { token, groupId } = await this.getAutsourcingRaw();
    if (!token || !groupId) {
      return { ok: false, error: "Bot token yoki guruh ID sozlanmagan — sozlamalarni to'ldiring" };
    }
    const clean = Array.from(new Set((contracts || []).map((c) => String(c).trim()).filter(Boolean)));
    if (clean.length === 0) return { ok: false, error: 'Shartnoma raqami kiritilmagan' };

    const cols = OPLATA_COLS.filter((c) => (columnKeys || []).includes(c.key));
    if (cols.length === 0) return { ok: false, error: 'Hech qanday ustun tanlanmagan' };

    const dateTo = this.todayTashkent();
    const where: any = { contractNo: { in: clean } };
    if (dateFrom) {
      where.date = { gte: new Date(dateFrom), lte: new Date(`${dateTo}T23:59:59.999`) };
    }

    const rows = await this.prisma.oplataKv.findMany({
      where,
      orderBy: [{ contractNo: 'asc' }, { date: 'asc' }],
      take: 100000,
    });
    if (rows.length === 0) {
      return {
        ok: false,
        error: dateFrom
          ? `Bu shartnomalar bo'yicha ${dateFrom} → ${dateTo} oralig'ida ma'lumot topilmadi`
          : "Bu shartnomalar bo'yicha ОплатыКв'da ma'lumot topilmadi",
      };
    }

    const foundContracts = new Set(rows.map((r) => r.contractNo));
    const notFound = clean.filter((c) => !foundContracts.has(c));

    const buffer = await this.buildAutsourcingXlsx(cols, rows);
    const filename = `autsoursing-${dateTo}.xlsx`;

    try {
      // Caption yo'q — faqat toza Excel fayl jo'natiladi (notFound app'da toast bilan ko'rinadi)
      const form = new FormData();
      form.append('chat_id', String(groupId));
      form.append(
        'document',
        new Blob([new Uint8Array(buffer)], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        filename,
      );
      const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: 'POST',
        body: form,
      });
      const data: any = await res.json().catch(() => ({}));
      if (!data?.ok) {
        return { ok: false, error: `Telegram xato: ${data?.description || `HTTP ${res.status}`}` };
      }
      this.log.log(`Autsoursing jo'natildi: ${clean.length} shartnoma, ${rows.length} qator → ${groupId}`);
      return {
        ok: true,
        contracts: clean.length,
        rows: rows.length,
        notFound,
        filename,
        durationMs: Date.now() - startedAt,
      };
    } catch (e: any) {
      this.log.warn(`Autsoursing jo'natish xato: ${e?.message}`);
      return { ok: false, error: e?.message || 'Telegram jo\'natishda xato' };
    }
  }
}
