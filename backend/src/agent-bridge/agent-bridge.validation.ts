import { BadRequestException } from '@nestjs/common';

// Kirish validatsiyasi — sof funksiyalar (DI'siz). Xato xabarlarida KIRISH QIYMATI takrorlanmaydi.

export const CONTRACT_RE = /^[A-Za-z0-9]{3,20}$/;
export const EXPORT_ID_RE = /^[A-Za-z0-9_-]{1,80}$/; // ExportCronLog.sheetId VarChar(80)
export const MAX_CONTRACTS = 3;
export const MAX_SHEET_IDS = 10;
const MAX_RAW_LEN = 200;

const CONTRACTS_MSG = 'contracts: 1-3 ta, har biri faqat A-Z/0-9, 3-20 belgi';
const SHEET_IDS_MSG = "sheetIds: 1-10 ta, har biri faqat A-Z/0-9/_/-, 1-80 belgi";
const EXPORT_ID_MSG = "id: faqat A-Z/0-9/_/-, 1-80 belgi";
const CRM_LOOKUP_MSG = "crm-lookup: id (bank kompozit ID, 8-200 belgi: A-Z/0-9/_/./-), date YYYY-MM-DD, amount musbat son";

// Bank kompozit ID: [IP_|HB_]general_id_num_dd.mm.yyyy_accCt_accDt_amountTiyin_sign (sign '-' ham bo'ladi)
export const COMPOSITE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.\-]{7,199}$/;

function splitList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** `?contracts=A,B,C` → UPPERCASE, dublikatsiz (tartib saqlanadi), 1..3 ta. Xato → 400. */
export function parseContracts(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_LEN) throw new BadRequestException(CONTRACTS_MSG);
  const tokens = splitList(raw);
  // Soni dedupe'dan OLDIN sanaladi — 4 ta token (hatto takroriy) ham rad.
  if (tokens.length === 0 || tokens.length > MAX_CONTRACTS) throw new BadRequestException(CONTRACTS_MSG);
  for (const t of tokens) if (!CONTRACT_RE.test(t)) throw new BadRequestException(CONTRACTS_MSG);
  return [...new Set(tokens.map((t) => t.toUpperCase()))];
}

/** `?sheetIds=` — undefined/'' → null ("barcha to'lov ustunli sheetlar"); aks holda id massivi. */
export function parseSheetIds(raw: unknown): string[] | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > MAX_RAW_LEN * 5) throw new BadRequestException(SHEET_IDS_MSG);
  const ids = splitList(raw);
  if (ids.length === 0 || ids.length > MAX_SHEET_IDS) throw new BadRequestException(SHEET_IDS_MSG);
  for (const id of ids) if (!EXPORT_ID_RE.test(id)) throw new BadRequestException(SHEET_IDS_MSG);
  return [...new Set(ids)];
}

/** `:id` format tekshiruvi (mavjudligi servisda — saqlangan eksportlar ro'yxatiga qarshi). */
export function assertExportId(raw: unknown): string {
  if (typeof raw !== 'string' || !EXPORT_ID_RE.test(raw)) throw new BadRequestException(EXPORT_ID_MSG);
  return raw;
}

/** `?id=&date=&amount=` — id majburiy (kompozit, ichida '_'), date/amount ixtiyoriy. Xato → 400. */
export function parseCrmLookup(id: unknown, date: unknown, amount: unknown): { id: string; date: string | null; amount: number | null } {
  if (typeof id !== 'string' || !COMPOSITE_ID_RE.test(id) || !id.includes('_')) throw new BadRequestException(CRM_LOOKUP_MSG);
  let d: string | null = null;
  if (date !== undefined && date !== '') {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException(CRM_LOOKUP_MSG);
    d = date;
  }
  let a: number | null = null;
  if (amount !== undefined && amount !== '') {
    if (typeof amount !== 'string' || !/^\d{1,13}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      throw new BadRequestException(CRM_LOOKUP_MSG);
    }
    a = Number(amount);
  }
  return { id, date: d, amount: a };
}

const CHEK_FIND_MSG = "chek-find: order (raqam, 1-30), amount musbat son, date YYYY-MM-DD, account (raqam, 6-30), contract (A-Z/0-9, 3-20)";

/** `?order=&amount=&date=&account=&contract=` — order majburiy (matchOrder order'siz qidirmaydi). Xato → 400. */
export function parseChekFind(q: Record<string, unknown>): {
  orderNo: string; amount: number | null; date: string | null; recipientAccount: string | null; contractNo: string | null;
} {
  const s = (v: unknown): string | null => {
    if (v === undefined || v === '') return null;
    if (typeof v !== 'string' || v.length > 40) throw new BadRequestException(CHEK_FIND_MSG);
    return v.trim();
  };
  const order = s(q.order);
  if (!order || !/^\d{1,30}$/.test(order)) throw new BadRequestException(CHEK_FIND_MSG);
  const amount = s(q.amount);
  if (amount != null && (!/^\d{1,13}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)) throw new BadRequestException(CHEK_FIND_MSG);
  const date = s(q.date);
  if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException(CHEK_FIND_MSG);
  const account = s(q.account);
  if (account != null && !/^\d{6,30}$/.test(account)) throw new BadRequestException(CHEK_FIND_MSG);
  const contract = s(q.contract);
  if (contract != null && !CONTRACT_RE.test(contract)) throw new BadRequestException(CHEK_FIND_MSG);
  return {
    orderNo: order, amount: amount != null ? Number(amount) : null, date,
    recipientAccount: account, contractNo: contract ? contract.toUpperCase() : null,
  };
}
