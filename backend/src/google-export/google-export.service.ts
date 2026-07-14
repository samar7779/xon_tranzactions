import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';
import { SettingsService } from '../sync/settings.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { serialize, FORMATS, Dataset, ExportColumn } from './data-formats';

// ─── Config tuzilishi ───────────────────────────────────────────────
export interface SheetColumn {
  col: string;    // Ustun harfi: "A", "B", ... "AA"
  field: string;  // ОплатыКв maydoni (FIELD_KEYS ichidan)
}
export interface SheetTarget {
  id: string;             // barqaror identifikator (frontend generatsiya qiladi)
  name: string;           // ko'rinish uchun nom (label)
  spreadsheetId: string;  // Google jadval ID
  tabName: string;        // list (tab) nomi
  startRow: number;       // shu qatordan pastga clear + yozish
  dateFrom: string | null;// YYYY-MM-DD (→ today gacha)
  filter: {
    objects?: string[];
    categories?: string[]; // MONTHLY | FIRST | GENERAL
    txTypes?: string[];
  };
  columns: SheetColumn[];
}

const SETTINGS_KEY = 'export.sheets';

// ОплатыКв → hujayra qiymati uchun mavjud maydonlar
const FIELD_KEYS = new Set([
  'id', 'contractNo', 'date', 'paymentAmount', 'firstInstallment', 'monthlyAmount',
  'paymentCategory', 'object', 'client', 'txType', 'paymentMethod', 'purpose', 'note',
]);

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
    const clean = sheets.map((s, i) => this.validateTarget(s, i));
    await this.settings.set(SETTINGS_KEY, JSON.stringify(clean), updatedBy);
    return { ok: true, sheets: clean };
  }

  private validateTarget(s: SheetTarget, idx: number): SheetTarget {
    const label = s?.name || `Sheet ${idx + 1}`;
    const startRow = Math.max(1, Math.floor(Number(s?.startRow) || 1));
    const columns = Array.isArray(s?.columns) ? s.columns : [];
    for (const c of columns) {
      if (c.col && !/^[A-Z]{1,3}$/.test(String(c.col).toUpperCase())) {
        throw new BadRequestException(`"${label}" — ustun harfi noto'g'ri: "${c.col}" (A..ZZZ)`);
      }
      if (c.field && !FIELD_KEYS.has(c.field)) {
        throw new BadRequestException(`"${label}" — nomaʼlum maydon: "${c.field}"`);
      }
    }
    return {
      id: s.id || `sheet-${idx + 1}`,
      name: label,
      spreadsheetId: (s.spreadsheetId || '').trim(),
      tabName: (s.tabName || '').trim(),
      startRow,
      dateFrom: s.dateFrom || null,
      filter: {
        objects: Array.isArray(s.filter?.objects) ? s.filter!.objects!.filter(Boolean) : [],
        categories: Array.isArray(s.filter?.categories) ? s.filter!.categories!.filter(Boolean) : [],
        txTypes: Array.isArray(s.filter?.txTypes) ? s.filter!.txTypes!.filter(Boolean) : [],
      },
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
      case 'paymentAmount':    return row.paymentAmount    != null ? Number(row.paymentAmount)    : '';
      case 'firstInstallment': return row.firstInstallment != null ? Number(row.firstInstallment) : '';
      case 'monthlyAmount':    return row.monthlyAmount    != null ? Number(row.monthlyAmount)    : '';
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
  async run(target: SheetTarget) {
    const startedAt = Date.now();
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

      // 1) CLEAR — faqat mapping qilingan ustunlar, startRow'dan pastgacha
      step = 'clear';
      const clearRanges = columns.map((c) => `${quotedTab}!${c.col}${startRow}:${c.col}`);
      await sheetsApi.spreadsheets.values.batchClear({
        spreadsheetId,
        requestBody: { ranges: clearRanges },
      });

      // 2) FETCH — ОплатыКв'dan sana + filtr bo'yicha
      step = 'fetch';
      const dateTo = this.todayTashkent();
      const rows = await this.oplataKv.getRowsForExport({
        dateFrom: target.dateFrom || null,
        dateTo,
        objects: target.filter?.objects || [],
        categories: target.filter?.categories || [],
        txTypes: target.filter?.txTypes || [],
      });

      // 3) WRITE — har ustunni alohida (COLUMNS major) yozamiz
      step = 'write';
      let writtenRange: string | null = null;
      if (rows.length > 0) {
        const data = columns.map((c) => ({
          range: `${quotedTab}!${c.col}${startRow}`,
          majorDimension: 'COLUMNS' as const,
          values: [rows.map((r) => this.cellValue(r, c.field))],
        }));
        await sheetsApi.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: 'USER_ENTERED', data },
        });
        const cols = columns.map((c) => c.col);
        const firstCol = cols[0];
        const lastCol = cols[cols.length - 1];
        writtenRange = `${target.tabName}!${firstCol}${startRow}:${lastCol}${startRow + rows.length - 1}`;
      }

      const durationMs = Date.now() - startedAt;
      this.log.log(
        `Export OK: "${target.name}" → ${spreadsheetId}/${target.tabName} · ${rows.length} qator · ${durationMs}ms`,
      );
      return {
        ok: true,
        sheet: { id: target.id, name: target.name, spreadsheetId, tabName: target.tabName },
        clearedRanges: columns.map((c) => `${target.tabName}!${c.col}${startRow}:${c.col}`),
        rowsFetched: rows.length,
        rowsWritten: rows.length,
        writtenRange,
        columns: columns.map((c) => ({ col: c.col, field: c.field })),
        dateFrom: target.dateFrom || null,
        dateTo,
        startRow,
        durationMs,
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
    const caption =
      `📋 Autsoursing · ${dateTo}\n` +
      (dateFrom ? `Davr: ${dateFrom} → ${dateTo}\n` : '') +
      `Shartnomalar: ${clean.length} · Qatorlar: ${rows.length}` +
      (notFound.length ? `\n⚠️ Topilmadi (${notFound.length}): ${notFound.slice(0, 20).join(', ')}` : '');

    try {
      const form = new FormData();
      form.append('chat_id', String(groupId));
      form.append('caption', caption);
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
