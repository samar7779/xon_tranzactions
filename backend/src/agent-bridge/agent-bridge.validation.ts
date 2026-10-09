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
const CRM_LOOKUP_MSG = "crm-lookup: id (bank kompozit ID, 8-200 belgi: A-Z/0-9/_/./+/-), date YYYY-MM-DD, amount musbat son";

// Bank kompozit ID: [IP_|HB_]general_id_num_dd.mm.yyyy_accCt_accDt_amountTiyin_sign (sign: '-' kirim, '+' chiqim)
export const COMPOSITE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.+\-]{7,199}$/;

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

// ── tx-edit ──
const TX_EDIT_MSG = "tx-edit: tx (to'lov ID, 6-200 belgi: A-Z/0-9/_/./+/-), qiymatlar 80 belgigacha, approvedBy 2-120, 1-20 ta";
export const TX_REF_RE = /^[A-Za-z0-9][A-Za-z0-9_.+\-]{5,199}$/;
const CTRL_RE = /[\u0000-\u001f\u007f]/;

export function parseTxRef(raw: unknown): string {
  if (typeof raw !== 'string' || !TX_REF_RE.test(raw)) throw new BadRequestException(TX_EDIT_MSG);
  return raw;
}

/** kontragent/kategoriya/shartnoma: undefined/'' = qolsin; aks holda 80 belgigacha oddiy matn. */
function parseChoiceVal(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 80 || CTRL_RE.test(v)) throw new BadRequestException(TX_EDIT_MSG);
  return v.trim();
}

export function parseTxChoice(q: Record<string, unknown>): { kontragent: string | null; kategoriya: string | null; shartnoma: string | null } {
  return { kontragent: parseChoiceVal(q.kontragent), kategoriya: parseChoiceVal(q.kategoriya), shartnoma: parseChoiceVal(q.shartnoma) };
}

export function parseTxApply(body: unknown): {
  items: Array<{ tx: string; kontragent: string | null; kategoriya: string | null; shartnoma: string | null }>;
  approvedBy: string; comment: string | null;
} {
  const b = (body && typeof body === 'object' ? body : null) as Record<string, unknown> | null;
  if (!b || !Array.isArray(b.items) || b.items.length < 1 || b.items.length > 20) throw new BadRequestException(TX_EDIT_MSG);
  const items = b.items.map((it) => {
    const o = (it && typeof it === 'object' ? it : null) as Record<string, unknown> | null;
    if (!o) throw new BadRequestException(TX_EDIT_MSG);
    return { tx: parseTxRef(o.tx), ...parseTxChoice(o) };
  });
  const approvedBy = typeof b.approvedBy === 'string' ? b.approvedBy.trim() : '';
  if (approvedBy.length < 2 || approvedBy.length > 120 || CTRL_RE.test(approvedBy)) throw new BadRequestException(TX_EDIT_MSG);
  let comment: string | null = null;
  if (b.comment !== undefined && b.comment !== null && b.comment !== '') {
    if (typeof b.comment !== 'string' || b.comment.length > 1000) throw new BadRequestException(TX_EDIT_MSG);
    comment = b.comment.trim();
  }
  return { items, approvedBy, comment };
}

// ── xato-ariza ──
const ARIZA_MSG = "xato-ariza: tx yoki summa+sana; shartnoma A-Z/0-9, hisob raqam, fayl leader_bot_<hex>.<ext>, yubordi 2-120";
const CUID_RE = /^[a-z0-9]{20,40}$/;
const ARIZA_FAYL_RE_V = /^leader_bot_[0-9a-f]{16}\.(jpg|jpeg|png|webp|gif|pdf|doc|docx)$/;

function optStr(v: unknown, max: number): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > max || CTRL_RE.test(v)) throw new BadRequestException(ARIZA_MSG);
  return v.trim() || null;
}

export function parseArizaFind(q: Record<string, unknown>): {
  tx: string | null; summa: number | null; sana: string | null; hisob: string | null; shartnoma: string | null;
} {
  const tx = q.tx === undefined || q.tx === '' ? null : parseTxRef(q.tx);
  const summaS = optStr(q.summa, 20);
  if (summaS != null && (!/^\d{1,13}(?:\.\d{1,2})?$/.test(summaS) || Number(summaS) <= 0)) throw new BadRequestException(ARIZA_MSG);
  const sana = optStr(q.sana, 10);
  if (sana != null && !/^\d{4}-\d{2}-\d{2}$/.test(sana)) throw new BadRequestException(ARIZA_MSG);
  const hisob = optStr(q.hisob, 30);
  if (hisob != null && !/^\d{6,30}$/.test(hisob)) throw new BadRequestException(ARIZA_MSG);
  const shartnoma = optStr(q.shartnoma, 40);
  if (shartnoma != null && !/^[A-Za-z0-9№/ \-]{3,40}$/.test(shartnoma)) throw new BadRequestException(ARIZA_MSG);
  if (!tx && !(summaS && sana)) throw new BadRequestException(ARIZA_MSG);
  return { tx, summa: summaS != null ? Number(summaS) : null, sana, hisob, shartnoma };
}

export function parseArizaSubmit(body: unknown): { oplataKvId: string; contractNo: string; fayl: string; yubordi: string } {
  const b = (body && typeof body === 'object' ? body : null) as Record<string, unknown> | null;
  if (!b) throw new BadRequestException('xato-ariza: body yo\'q');
  // OplatyKv id: cuid (qo'lda/import) yoki bank kompozit ID (sync qatorlari id = tx.externalId)
  const oplataKvId = typeof b.oplataKvId === 'string' ? b.oplataKvId : '';
  if (!TX_REF_RE.test(oplataKvId)) throw new BadRequestException("xato-ariza: oplataKvId noto'g'ri");
  const contractNo = typeof b.contractNo === 'string' ? b.contractNo.trim() : '';
  if (!/^[A-Za-z0-9№/ \-]{3,40}$/.test(contractNo)) throw new BadRequestException("xato-ariza: shartnoma raqami noto'g'ri");
  const fayl = typeof b.fayl === 'string' ? b.fayl : '';
  if (!ARIZA_FAYL_RE_V.test(fayl)) throw new BadRequestException("xato-ariza: ariza fayli nomi noto'g'ri");
  const yubordi = typeof b.yubordi === 'string' ? b.yubordi.trim() : '';
  if (yubordi.length < 2 || yubordi.length > 120 || CTRL_RE.test(yubordi)) {
    throw new BadRequestException("xato-ariza: yuboruvchi (2-120 belgi) noto'g'ri");
  }
  return { oplataKvId, contractNo, fayl, yubordi };
}

// ── AI Переброска (TR Support): tahlil (AI o'qiydi) va yaratish (egasi tasdig'idan keyin) ──
const PB_MSG = "perebroska: fayl leader_bot_<hex>.<pdf|rasm>, shartnoma A-Z/0-9, summa > 0, sana YYYY-MM-DD, tasdiq 2-120";
const PB_SH_RE = /^[A-Z0-9/]{3,64}$/;
function pbSh(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[\s№]/g, '').toUpperCase() : '';
  if (!PB_SH_RE.test(s)) throw new BadRequestException(PB_MSG);
  return s;
}
function pbSumma(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1e13) throw new BadRequestException(PB_MSG);
  return n;
}
export function parsePerebroskaFayl(body: unknown): string {
  const b = (body && typeof body === 'object' ? body : null) as Record<string, unknown> | null;
  const f = b && typeof b.fayl === 'string' ? b.fayl : '';
  if (!ARIZA_FAYL_RE_V.test(f)) throw new BadRequestException(PB_MSG);
  return f;
}
export function parsePerebroskaYarat(body: unknown): {
  fayl: string; fromContractNo: string; amount: number; date: string;
  destinations: Array<{ contractNo: string; amount: number }>;
  agentState: string | null; agentReason: string | null; agentData: any; tasdiq: string; izoh: string | null;
} {
  const b = (body && typeof body === 'object' ? body : null) as Record<string, unknown> | null;
  if (!b) throw new BadRequestException(PB_MSG);
  const fayl = parsePerebroskaFayl(b);
  const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : '';
  if (!date) throw new BadRequestException(PB_MSG);
  if (!Array.isArray(b.destinations) || b.destinations.length < 1 || b.destinations.length > 20) {
    throw new BadRequestException(PB_MSG);
  }
  const destinations = b.destinations.map((d) => {
    const o = (d && typeof d === 'object' ? d : null) as Record<string, unknown> | null;
    if (!o) throw new BadRequestException(PB_MSG);
    return { contractNo: pbSh(o.contractNo), amount: pbSumma(o.amount) };
  });
  const agentState = b.agentState === 'verified' || b.agentState === 'needs_review' ? b.agentState : null;
  const agentReason = typeof b.agentReason === 'string' ? b.agentReason.slice(0, 4000) : null;
  let agentData: any = null;
  if (b.agentData && typeof b.agentData === 'object') {
    if (JSON.stringify(b.agentData).length > 50_000) throw new BadRequestException(PB_MSG);
    agentData = b.agentData;
  }
  const tasdiq = typeof b.tasdiq === 'string' ? b.tasdiq.trim() : '';
  if (tasdiq.length < 2 || tasdiq.length > 120 || CTRL_RE.test(tasdiq)) throw new BadRequestException(PB_MSG);
  let izoh: string | null = null;
  if (b.izoh !== undefined && b.izoh !== null && b.izoh !== '') {
    if (typeof b.izoh !== 'string' || b.izoh.length > 1000) throw new BadRequestException(PB_MSG);
    izoh = b.izoh.trim() || null;
  }
  return {
    fayl, fromContractNo: pbSh(b.fromContractNo), amount: pbSumma(b.amount), date, destinations,
    agentState, agentReason, agentData, tasdiq, izoh,
  };
}

// ── Eski tarixni yuklash (TR Support, backfill) ──
const TARIX_MSG = "tarix: dan, gacha YYYY-MM-DD; bank 60 belgigacha; hisob 16-25 xona";
export function parseTarixYukla(body: unknown): { dan: string; gacha: string; bank: string | null; hisob: string | null } {
  const b = (body && typeof body === 'object' ? body : null) as Record<string, unknown> | null;
  const kun = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const dan = kun(b?.dan);
  const gacha = kun(b?.gacha);
  if (!dan || !gacha) throw new BadRequestException(TARIX_MSG);
  let bank: string | null = null;
  if (b?.bank !== undefined && b?.bank !== null && b?.bank !== '') {
    if (typeof b.bank !== 'string' || b.bank.trim().length < 2 || b.bank.length > 60 || CTRL_RE.test(b.bank)) {
      throw new BadRequestException(TARIX_MSG);
    }
    bank = b.bank.trim();
  }
  let hisob: string | null = null;
  if (b?.hisob !== undefined && b?.hisob !== null && b?.hisob !== '') {
    const h = typeof b.hisob === 'string' ? b.hisob.replace(/\s+/g, '') : '';
    if (!/^\d{16,25}$/.test(h)) throw new BadRequestException(TARIX_MSG);
    hisob = h;
  }
  return { dan, gacha, bank, hisob };
}

export function parseSince(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 40 || Number.isNaN(Date.parse(raw))) {
    throw new BadRequestException('since: ISO vaqt');
  }
  return raw;
}

// ── hisob / xato-royxat (TR Support: faqat o'qish) ──
const HISOB_MSG = 'hisob: 16-25 xonali hisob raqam (bo\'shliqlar mumkin)';
export function parseHisob(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, '') : '';
  if (!/^\d{16,25}$/.test(s)) throw new BadRequestException(HISOB_MSG);
  return s;
}

export function parseFiltr(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > 60 || CTRL_RE.test(raw)) {
    throw new BadRequestException('filtr: 60 belgigacha matn');
  }
  return raw.trim() || null;
}

export function parseArizaId(raw: unknown): string {
  if (typeof raw !== 'string' || !CUID_RE.test(raw)) throw new BadRequestException(ARIZA_MSG);
  return raw;
}
