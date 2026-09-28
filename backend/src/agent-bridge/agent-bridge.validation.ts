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
