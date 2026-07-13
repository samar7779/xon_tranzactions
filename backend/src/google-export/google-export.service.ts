import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import * as fs from 'fs';
import { SettingsService } from '../sync/settings.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';
import { CryptoService } from '../common/crypto/crypto.service';

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
}
