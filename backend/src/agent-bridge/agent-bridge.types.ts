// agent-bridge javob tiplari. Javob obyektlari WHITELIST — har maydon qo'lda ko'chiriladi,
// `...spread` ishlatilmaydi (yangi ichki maydon avtomatik sizib chiqmasin).
// HECH QACHON qaytmaydi: spreadsheetId, credential (client_email/private_key/source),
// AGENT_BRIDGE_KEY, columns/filter/upsertKeys/writtenIds, run().debug, clearedRanges, crm.debug.

// ── payment-check ─────────────────────────────────────────────
export interface BridgeOplataPart {          // chek-order.service oplatakvBatch() shakli
  ok: true;
  initial: number; monthly: number; total: number;
  count: number;                             // ОплатыКв qatorlari soni (0 = bazada yo'q)
  payments: Array<{ date: string | null; first: number; monthly: number; total: number }>; // <=200
}

export interface BridgeCrmPayment {
  date: string | null; amount: number; kind: 'initial' | 'monthly'; type: string | null;
  externalId: string | null;                 // CRM Внешний ID (XonPay UUID yoki bizning bank kompoziti)
  method: string | null;                     // CRM Способ (masalan "Xon Pay")
}
export type BridgeCrmPart =                  // crmPaymentPart() shakli, `debug` OLIB TASHLANGAN
  | {
      ok: true; found: true;
      viaPaymentHistory?: true;              // order/show topmadi, /payment-history fallback
      price: number | null; initialPlan: number | null; monthlyPlan: number | null;
      initial: number; monthly: number; total: number; remaining: number | null;
      count: number; payments: BridgeCrmPayment[];
    }
  | { ok: false; found: false; error?: string };

export interface BridgeSheetPart {           // paymentCheck() sheets[] elementi
  id: string; name: string;
  ok: boolean; available: boolean; reason?: string;   // available=false → solishtiruvga kirmaydi
  initial: number; monthly: number; total: number;
  matchedRows: number; rowsScanned: number;
  payments: Array<{ row: number; first: number; monthly: number; total: number }>;  // <=200
}

export interface BridgeContractResult {
  contract: string;                          // UPPERCASE
  allMatch: boolean;                         // = chekOrder.resAllMatch(result, srcKeys) — panel "Мос/Фарқли" bilan bir xil
  oplata: BridgeOplataPart;
  crm: BridgeCrmPart;
  sheets: BridgeSheetPart[];
}

export interface BridgePaymentCheckResponse {
  ok: true;
  checkedAt: string;                         // ISO
  sources: { oplata: true; crm: true; sheets: Array<{ id: string; name: string }> };
  results: BridgeContractResult[];           // so'ralgan tartibda, dublikatsiz
}

// ── exports ───────────────────────────────────────────────────
export interface BridgeExportLastRun {
  startedAt: string;                         // ISO
  mode: 'cron' | 'manual';
  status: 'ok' | 'error';
  rowsWritten: number;
  durationMs: number;
  triggeredBy: string | null;                // 'cron' | 'manual:<ism · email>' | 'manual:agent-bridge'
  error: string | null;                      // 300 belgigacha qirqilgan
}
export interface BridgeExportItem {
  id: string;
  name: string;
  source: 'oplatakv' | 'transaction';
  tabName: string;
  writeMode: 'replace' | 'upsert';
  hasPayColumns: boolean;                    // payment-check shu sheetni o'qiy oladimi
  cron: {
    enabled: boolean;
    everyMinutes: number | null;
    hourFrom: number | null;                 // 0-23, shu soatdan (Toshkent)
    hourTo: number | null;                   // 0-23, shu soatgacha
    days: number[];                          // 0=Yakshanba..6=Shanba; bo'sh = har kun
  };
  // "Nega sheetda ko'rinmayapti" tahlili uchun: qaysi qatorlar sheetga tushadi (faqat sozlama, sir yo'q)
  dateFrom: string | null;                   // YYYY-MM-DD dan boshlab
  filter: {
    objects: string[];
    categories: string[];                    // MONTHLY | FIRST | GENERAL (bo'sh = hammasi)
    txTypes: string[];
    accounts: string[];                      // tranzaksiya manbasi uchun hisob raqamlari
    amountSign: 'pos' | 'neg' | null;
  };
  keyField: string | null;                   // upsert kaliti
  fields: string[];                          // sheetga yoziladigan maydonlar (ustun tartibida)
  lastRun: BridgeExportLastRun | null;
}
export interface BridgeExportsResponse {
  ok: true;
  credentialsAvailable: boolean;             // getConfig().credentials.available — FAQAT boolean
  items: BridgeExportItem[];
}

// ── run ───────────────────────────────────────────────────────
export type BridgeRunResponse =
  | {
      ok: true;
      sheet: { id: string; name: string; tabName: string };
      writeMode: 'replace' | 'upsert';
      rowsFetched: number; rowsWritten: number;
      writtenRange: string | null;
      dateFrom: string | null; dateTo: string;
      durationMs: number;
    }
  | {
      ok: false;
      sheet: { id: string; name: string };
      step: 'auth' | 'validate' | 'clear' | 'fetch' | 'write' | string;
      error: string;                         // 300 belgigacha
      durationMs: number;
    };

// ── crm-lookup (FAQAT O'QISH) ─────────────────────────────────
// Bitta bank to'lovi (kompozit ID) CRM'da qaysi shartnomada — shartnomasiz (XATO) to'lov uchun.
export interface BridgeCrmLookupRow {
  contract: string;
  date: string;                              // YYYY-MM-DD (CRM date_paid)
  amount: number;                            // so'm
  initialAmount: number; monthlyAmount: number; otherAmount: number;
  object: string | null;
  client: string | null;                     // CRM full_name (bot faqat egasiga ko'rsatadi)
  externalId: string;                        // CRM Внешний ID
}
export type BridgeCrmLookupResponse =
  | {
      ok: true;
      via: 'sana' | 'transaction_id' | null; // sana = panel «XATO → CRM» tabi ham topadi
      checkedDate: string | null;
      exact: BridgeCrmLookupRow[];           // ID (external_id yoki yadro) bo'yicha ANIQ mos, <=5
      sameAmount: BridgeCrmLookupRow[];      // aniq yo'q bo'lsa: shu kuni shu summa (ID'siz), <=5
    }
  | { ok: false; error: string };

// ── chek-find (FAQAT O'QISH) ──────────────────────────────────
// Chek (memorial order / kvitansiya / ko'chirma qatori) → tranzaksiya: chek-order matchOrder bilan bir xil.
export interface BridgeChekTx {
  id: string;
  externalId: string | null;                 // bank kompozit ID (ix_id) — CRM Внешний ID bilan bir xil format
  direction: string | null;
  amount: number;
  txnDate: string | null;                    // ISO
  docNumber: string | null;
  contractNumber: string | null;             // tranzaksiyadagi shartnoma (null = izohdan topilmagan)
  fromName: string | null;                   // to'lovchi (bot faqat egasiga ko'rsatadi)
  description: string | null;                // 300 belgigacha
}
export interface BridgeChekFindResponse {
  ok: true;
  result: 'found' | 'mismatch' | 'not_found';
  conditions: { order: boolean | null; account: boolean | null; date: boolean | null; amount: boolean | null; contract: boolean | null } | null;
  tx: BridgeChekTx | null;
}

// ── tx-edit (TR Support: egasi [Ha] bosgach to'lov ustunlarini tahrirlash) ──
export interface BridgeTxView {
  id: string; externalId: string | null; date: string | null; amount: number; direction: string | null;
  editable: boolean; description: string | null;               // bank izohi, 300 belgigacha (bot faqat egasiga)
  kontragent: { code: string; name: string } | null;           // top kategoriya
  kategoriya: { code: string; name: string } | null;           // subkategoriya
  shartnoma: string | null; isContractManual: boolean;
}
export interface BridgeTxOptions {
  ok: true;
  tx: BridgeTxView | null;
  kontragentlar: Array<{ code: string; name: string; kategoriyalar: Array<{ code: string; name: string }> }>;
}
export interface BridgeTxChange { field: 'kontragent' | 'kategoriya' | 'shartnoma'; from: string | null; to: string | null }
export interface BridgeTxPreview {
  ok: true; valid: boolean; errors: string[]; tx: BridgeTxView | null; changes: BridgeTxChange[];
  crm: { contract: string; found: boolean; customerName: string | null; objectName: string | null } | null;
}
export interface BridgeTxApply {
  ok: true; batchId: string;
  results: Array<{ tx: string; id: string | null; status: 'applied' | 'failed' | 'skipped'; errors: string[]; changes: BridgeTxChange[] }>;
  sync: { ok: boolean; added?: number; updated?: number; skipped?: number; error?: string } | null;
}
