'use client';
// build marker: sverka v3 (Portal modal + bulk fix + diagnose stay-open)

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, RefreshCw, Loader2, Calendar, AlertTriangle, CheckCircle2,
  ArrowDownLeft, ArrowUpRight, Search, Inbox, Database, Download, Copy, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

interface DiagnoseItem {
  b2Id?: string | null;
  generalId?: string | null;
  externalId?: string | null;
  docNumber?: string | null;
  ddate?: string | null;
  time?: string | null;
  direction?: string | null;
  amount: number;
  fromAccount?: string | null;
  fromName?: string | null;
  toAccount?: string | null;
  toName?: string | null;
  purpose?: string | null;
  description?: string | null;
  id?: string;
  existsOnDate?: string;  // Boshqa sana ostida saqlangan (qo'shish tugmasini hide qilamiz)
  existingTxId?: string;
}

interface AmountMismatchItem {
  txId: string;
  b2Id?: string | null;
  generalId?: string | null;
  docNumber?: string | null;
  ddate?: string | null;
  time?: string | null;
  direction?: 'IN' | 'OUT' | null;
  bankAmount: number;
  dbAmount: number;
  diff: number;          // bankAmount - dbAmount
  fromAccount?: string | null;
  fromName?: string | null;
  toAccount?: string | null;
  toName?: string | null;
  purpose?: string | null;
}

interface BulkResult {
  ok: true;
  summary: { total: number; ok: number; error: number };
  results: Array<{
    b2Id?: string | null;
    generalId?: string | null;
    ok: boolean;
    inserted: boolean;
    transactionId: string | null;
    externalId: string | null;
    existingDate?: string;  // Avvaldan mavjud bo'lsa — qaysi sana ostida saqlangan
    error?: string;
  }>;
}

interface ReconcileData {
  status: 'ok' | 'mismatch' | 'error';
  accountId: string;
  accountNo: string;
  ownerName: string | null;
  bankName: string | null;
  bank?: { opening: number; closing: number; debit: number; credit: number };
  db?: { inflow: number; outflow: number; inCount: number; outCount: number };
  diff?: { credit: number; debit: number; formula: number; computedClosing: number };
  partial?: boolean;
  failedDays?: number;
  error?: string;
  dailyBreakdown?: Array<{
    date: string;
    bankCredit: number;
    bankDebit: number;
    dbInflow: number;
    dbOutflow: number;
    creditDiff: number;
    debitDiff: number;
    failed: boolean;
    status: 'ok' | 'mismatch' | 'failed';
  }>;
}

function todayIso() {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function AccountDrilldown({
  item, onClose, onUpdated,
}: {
  item: ReconcileData;
  onClose: () => void;
  onUpdated: (next: any) => void;
}) {
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [data, setData] = useState<ReconcileData>(item);
  const [loading, setLoading] = useState(false);
  const [showDiagnose, setShowDiagnose] = useState(false);

  // Modal ESC bilan yopiladi
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function runCheck(opts?: { keepDiagnose?: boolean }) {
    setLoading(true);
    if (!opts?.keepDiagnose) setShowDiagnose(false);
    try {
      const result = await api.post<ReconcileData>('/transactions/reconcile', {
        accountId: item.accountId, dateFrom, dateTo,
        withSync: true,  // Avval sync — DB eski bo'lsa farq xato chiqmaydi
      }, { timeout: 60_000 });
      setData(result);
      // Agar bugun bo'lsa, asosiy listni ham yangilaymiz
      if (dateFrom === todayIso() && dateTo === todayIso()) {
        onUpdated(result);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Tekshirish xatosi');
    } finally {
      setLoading(false);
    }
  }

  // Diagnose — faqat bitta kun uchun ishlaydi
  const isSingleDay = dateFrom === dateTo;
  const { data: diagnoseData, isLoading: diagnoseLoading, refetch: refetchDiagnose } = useQuery<{
    ok: true;
    bankCount: number;
    dbCount: number;
    matchedCount: number;
    bankOnly: DiagnoseItem[];
    dbOnly: DiagnoseItem[];
    amountMismatch?: AmountMismatchItem[];
    amountMismatchCount?: number;
    amountMismatchDiffSum?: number;
    fallbackUsed?: boolean;
    fallbackSource?: 'GetDocuments' | null;
    fallbackError?: string | null;
  }>({
    queryKey: ['diagnose', item.accountId, dateFrom],
    queryFn: () => api.post('/transactions/reconcile/diagnose', {
      accountId: item.accountId, date: dateFrom,
    }),
    enabled: showDiagnose && isSingleDay,
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-stretch justify-end"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-[920px] h-full overflow-y-auto shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3 sticky top-0 bg-white z-10">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-slate-900 truncate">
              {item.bankName} · <span className="font-mono">{item.accountNo}</span>
            </h2>
            <div className="text-[11px] text-slate-500 truncate">{item.ownerName || '—'}</div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full grid place-items-center bg-slate-100 hover:bg-rose-100 hover:text-rose-700 transition"
            aria-label="Yopish"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Period selector */}
        <div className="px-6 py-4 bg-slate-50/60 border-b border-slate-100">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-600">Sanadan</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-10 w-[160px] rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-600">Sanagacha</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-10 w-[160px] rounded-xl"
              />
            </div>
            <Button
              onClick={() => runCheck()}
              disabled={loading}
              className="h-10 rounded-xl font-semibold"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Tekshirilmoqda...</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-1.5" /> Davr uchun tekshir</>
              )}
            </Button>
            <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {isSingleDay
                ? "Bitta kun — xato bo'lsa sababini aniqlash mumkin"
                : "Diagnostika faqat bitta kun uchun ishlaydi"}
            </div>
          </div>
        </div>

        {/* Result body */}
        <div className="flex-1 p-6 space-y-5">
          {data.status === 'error' ? (
            <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[13px] font-semibold text-rose-900">Sverka bajarilmadi</div>
                  <div className="text-[12px] text-rose-700 mt-1">{data.error || "noma'lum xato"}</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Status banner */}
              <div className={cn(
                'rounded-xl p-4 flex items-center gap-3',
                data.status === 'ok' ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-amber-50 ring-1 ring-amber-200',
              )}>
                {data.status === 'ok' ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                )}
                <div className="text-[13px] font-semibold">
                  {data.status === 'ok'
                    ? "Mos keldi — bank va AllTranzactions to'liq muvofiq"
                    : 'Farq aniqlandi — quyidagi jadvalda ko\'rib chiqing'}
                </div>
                {data.partial && (
                  <span className="ml-auto text-[11px] text-amber-700">
                    ⚠ {data.failedDays} kun bankdan ma'lumotsiz
                  </span>
                )}
              </div>

              {/* Solishtirish jadvali */}
              <ReconcileTable data={data} />

              {/* Kunlik breakdown — faqat ko'p kunli oraliqda */}
              {data.dailyBreakdown && data.dailyBreakdown.length > 1 && (
                <DailyBreakdown
                  rows={data.dailyBreakdown}
                  onPickDay={(d) => { setDateFrom(d); setDateTo(d); }}
                />
              )}

              {/* Diagnostika tugmasi va natija */}
              {data.status === 'mismatch' && isSingleDay && (
                <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Search className="h-5 w-5 text-indigo-600" />
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold text-slate-900">Farq sababini topish</div>
                      <div className="text-[11px] text-slate-500">Bankdagi har bir tranzaksiyani AllTranzactions bilan solishtiramiz va yetishmayotgan/ortiqcha yozuvlarni topamiz</div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => { setShowDiagnose(true); refetchDiagnose(); }}
                      disabled={diagnoseLoading}
                      variant="outline"
                      className="rounded-lg"
                    >
                      {diagnoseLoading
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : showDiagnose ? 'Qayta tekshir' : 'Diagnostika'}
                    </Button>
                  </div>

                  {showDiagnose && diagnoseData && (
                    <DiagnoseResult
                      data={diagnoseData}
                      accountId={item.accountId}
                      date={dateFrom}
                      onFixed={async () => {
                        // Diagnose panelini ochiq qoldiramiz va parallel fresh ma'lumotlarni olamiz
                        await Promise.all([refetchDiagnose(), runCheck({ keepDiagnose: true })]);
                        toast.success("Sverka yangilandi");
                      }}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReconcileTable({ data }: { data: ReconcileData }) {
  if (!data.bank || !data.db || !data.diff) return null;
  const m = (n: number) => formatMoney(Number(n || 0)).replace(' UZS', '');
  const diffCls = (n: number) =>
    Math.abs(n) < 1 ? 'text-emerald-700' : 'text-amber-700';

  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            <th className="text-left px-4 py-2.5">Ko'rsatkich</th>
            <th className="text-right px-4 py-2.5">Bank</th>
            <th className="text-right px-4 py-2.5">AllTranzactions</th>
            <th className="text-right px-4 py-2.5">Farq</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          <tr>
            <td className="px-4 py-3 text-slate-700">
              <span className="flex items-center gap-2"><ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600" /> Kirim oboroti</span>
            </td>
            <td className="px-4 py-3 text-right font-semibold text-emerald-700">{m(data.bank.credit)}</td>
            <td className="px-4 py-3 text-right font-semibold text-emerald-700">
              {m(data.db.inflow)} <span className="text-[10px] text-slate-400">· {data.db.inCount} ta</span>
            </td>
            <td className={cn('px-4 py-3 text-right font-bold', diffCls(data.diff.credit))}>{m(data.diff.credit)}</td>
          </tr>
          <tr>
            <td className="px-4 py-3 text-slate-700">
              <span className="flex items-center gap-2"><ArrowUpRight className="h-3.5 w-3.5 text-rose-600" /> Chiqim oboroti</span>
            </td>
            <td className="px-4 py-3 text-right font-semibold text-rose-700">{m(data.bank.debit)}</td>
            <td className="px-4 py-3 text-right font-semibold text-rose-700">
              {m(data.db.outflow)} <span className="text-[10px] text-slate-400">· {data.db.outCount} ta</span>
            </td>
            <td className={cn('px-4 py-3 text-right font-bold', diffCls(data.diff.debit))}>{m(data.diff.debit)}</td>
          </tr>
          <tr className="bg-slate-50/60">
            <td className="px-4 py-3 text-slate-700">Ochilish saldosi</td>
            <td className="px-4 py-3 text-right font-semibold">{m(data.bank.opening)}</td>
            <td className="px-4 py-3 text-right text-slate-400">—</td>
            <td className="px-4 py-3 text-right text-slate-400">—</td>
          </tr>
          <tr>
            <td className="px-4 py-3 text-slate-700">
              Yopilish saldosi
              <div className="text-[10px] text-slate-400">ochilish + kirim − chiqim</div>
            </td>
            <td className="px-4 py-3 text-right font-semibold">{m(data.bank.closing)}</td>
            <td className="px-4 py-3 text-right font-semibold">{m(data.diff.computedClosing)}</td>
            <td className={cn('px-4 py-3 text-right font-bold', diffCls(data.diff.formula))}>{m(data.diff.formula)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DiagnoseResult({
  data, accountId, date, onFixed,
}: {
  data: {
    bankCount: number;
    dbCount: number;
    matchedCount: number;
    bankOnly: DiagnoseItem[];
    dbOnly: DiagnoseItem[];
    amountMismatch?: AmountMismatchItem[];
    amountMismatchCount?: number;
    amountMismatchDiffSum?: number;
    fallbackUsed?: boolean;
    fallbackSource?: 'GetDocuments' | null;
    fallbackError?: string | null;
  };
  accountId: string;
  date: string;
  onFixed: () => void;
}) {
  const mismatch = data.amountMismatch || [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-[12px] text-slate-600 flex-wrap">
        <span>Bankda: <b className="text-slate-900">{data.bankCount}</b></span>
        <span>AllTranzactions: <b className="text-slate-900">{data.dbCount}</b></span>
        <span>Mos: <b className="text-emerald-700">{data.matchedCount}</b></span>
        {mismatch.length > 0 && (
          <span>Summa farqli: <b className="text-orange-700">{mismatch.length}</b></span>
        )}
        {data.fallbackUsed && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="h-3 w-3" />
            GetDocuments fallback
          </span>
        )}
      </div>

      {data.fallbackError && (
        <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 p-3 text-[11px] text-rose-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">GetDocuments fallback urinib ko'rildi, lekin xato:</div>
            <div className="mt-0.5 font-mono">{data.fallbackError}</div>
          </div>
        </div>
      )}

      {data.bankOnly.length === 0 && data.dbOnly.length === 0 ? (
        data.bankCount === 0 && data.dbCount === 0 ? (
          <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 p-3 text-[12px] text-amber-900 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Bank tranzaksiyalar ro'yxati bo'sh</div>
              <div className="mt-0.5 text-amber-800">
                Bank shu kun uchun na GetDoc1C, na GetDocuments orqali individual yozuv qaytarmadi.
                Bu odatda dam olish/non-operatsion kunda bo'ladi. AllTranzactions'da ham hech narsa yo'q.
                Farq qaerdandir oldingi kunlardan keladi — boshqa kunlarni tekshirib ko'ring.
              </div>
            </div>
          </div>
        ) : mismatch.length === 0 ? (
          <div className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200 p-3 text-[12px] text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Yozuvlar to'liq mos — farq, ehtimol, yaxlitlash xatosi yoki kalit indekslar muammosi
          </div>
        ) : null
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DiagPanel
            title="Bankda bor — AllTranzactions'da yo'q"
            icon={<Inbox className="h-4 w-4" />}
            tone="amber"
            items={data.bankOnly}
            empty="Yo'qolgan yozuvlar yo'q"
            fixable
            accountId={accountId}
            date={date}
            onFixed={onFixed}
          />
          <DiagPanel
            title="AllTranzactions'da bor — bankda yo'q"
            icon={<Database className="h-4 w-4" />}
            tone="rose"
            items={data.dbOnly}
            empty="Ortiqcha yozuvlar yo'q"
          />
        </div>
      )}

      {mismatch.length > 0 && (
        <AmountMismatchPanel
          items={mismatch}
          diffSum={data.amountMismatchDiffSum || 0}
        />
      )}
    </div>
  );
}

function AmountMismatchPanel({ items, diffSum }: { items: AmountMismatchItem[]; diffSum: number }) {
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/40 overflow-hidden">
      <div className="px-3 py-2 bg-orange-50 border-b border-orange-200 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-orange-900">
          <AlertTriangle className="h-4 w-4" />
          Summa farqli yozuvlar — ID mos, lekin bank vs AllTranzactions summasi farqli
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-orange-700">
            {items.length} ta yozuv
          </span>
          <span className="text-orange-900 font-bold tabular-nums">
            Jami farq: {formatMoney(diffSum)} so'm
          </span>
        </div>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-orange-50/60 text-orange-700 sticky top-0">
            <tr>
              <th className="text-left px-2 py-1.5 font-medium">№ / b2_id</th>
              <th className="text-left px-2 py-1.5 font-medium">Yo'nalish</th>
              <th className="text-right px-2 py-1.5 font-medium">Bank summasi</th>
              <th className="text-right px-2 py-1.5 font-medium">DB summasi</th>
              <th className="text-right px-2 py-1.5 font-medium">Farq</th>
              <th className="text-left px-2 py-1.5 font-medium">Tomonlar</th>
              <th className="text-left px-2 py-1.5 font-medium">Maqsad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-orange-100">
            {items.map((it) => (
              <tr key={it.txId} className="hover:bg-orange-50/60">
                <td className="px-2 py-1.5 align-top">
                  <div className="font-semibold text-slate-800">{it.docNumber || '—'}</div>
                  {it.b2Id && (
                    <div className="text-[9px] text-slate-500 font-mono truncate max-w-[120px]" title={it.b2Id}>
                      {it.b2Id}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5 align-top">
                  {it.direction === 'IN' ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <ArrowDownLeft className="h-3 w-3" /> Kirim
                    </span>
                  ) : it.direction === 'OUT' ? (
                    <span className="inline-flex items-center gap-1 text-rose-700">
                      <ArrowUpRight className="h-3 w-3" /> Chiqim
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 align-top text-right tabular-nums text-slate-900">
                  {formatMoney(it.bankAmount)}
                </td>
                <td className="px-2 py-1.5 align-top text-right tabular-nums text-slate-900">
                  {formatMoney(it.dbAmount)}
                </td>
                <td className={cn(
                  'px-2 py-1.5 align-top text-right tabular-nums font-bold',
                  it.diff > 0 ? 'text-orange-700' : 'text-purple-700',
                )}>
                  {it.diff > 0 ? '+' : ''}{formatMoney(it.diff)}
                </td>
                <td className="px-2 py-1.5 align-top text-slate-600">
                  <div className="truncate max-w-[180px]" title={it.fromName || ''}>
                    {it.fromName || it.fromAccount || '—'}
                  </div>
                  <div className="text-[9px] text-slate-400 truncate max-w-[180px]" title={it.toName || ''}>
                    → {it.toName || it.toAccount || '—'}
                  </div>
                </td>
                <td className="px-2 py-1.5 align-top text-slate-600">
                  <div className="truncate max-w-[220px]" title={it.purpose || ''}>
                    {it.purpose || '—'}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiagPanel({
  title, icon, tone, items, empty, fixable, accountId, date, onFixed,
}: {
  title: string;
  icon: React.ReactNode;
  tone: 'amber' | 'rose';
  items: DiagnoseItem[];
  empty: string;
  fixable?: boolean;
  accountId?: string;
  date?: string;
  onFixed?: () => void;
}) {
  const qc = useQueryClient();
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const toneCls = tone === 'amber'
    ? 'border-amber-200 bg-amber-50/40'
    : 'border-rose-200 bg-rose-50/40';
  const headCls = tone === 'amber' ? 'text-amber-800' : 'text-rose-800';

  // Faqat haqiqatdan qo'shilishi mumkin bo'lgan item'lar (boshqa sana ostida
  // saqlanmaganlar) — bulk button uchun
  const insertableItems = items.filter((it) => !it.existsOnDate && (it.b2Id || it.generalId));
  // Boshqa sana ostida saqlangan item'lar — bulk SANA TUZATISH uchun
  const fixableDateItems = items.filter((it) => it.existsOnDate && it.existingTxId);
  const [fixDateLoading, setFixDateLoading] = useState(false);
  const [fixDateResult, setFixDateResult] = useState<any>(null);
  const [fixDateConfirmOpen, setFixDateConfirmOpen] = useState(false);

  async function handleFixAllDates() {
    if (!date || fixableDateItems.length === 0) return;
    setFixDateConfirmOpen(true);
  }

  async function executeFixAllDates() {
    setFixDateConfirmOpen(false);
    setFixDateLoading(true);
    try {
      const r = await api.post<any>('/transactions/reconcile/fix-all-tx-date', {
        items: fixableDateItems.map(it => ({ txId: it.existingTxId!, newDate: date })),
      });
      setFixDateResult(r);
    } catch (e: any) {
      toast.error(e?.message || "Xato");
    } finally {
      setFixDateLoading(false);
    }
  }

  function handleCloseFixDateModal() {
    const hadUpdates = fixDateResult?.summary?.updated > 0;
    setFixDateResult(null);
    if (hadUpdates) {
      onFixed?.();
      qc.invalidateQueries({ queryKey: ['reconcile-today'] });
    }
  }

  async function handleFixAll() {
    if (!accountId || !date || insertableItems.length === 0) return;
    setBulkLoading(true);
    try {
      const r = await api.post<BulkResult>('/transactions/reconcile/fix-all-missing', {
        accountId,
        date,
        items: insertableItems
          .map((it) => ({ b2Id: it.b2Id || undefined, generalId: it.generalId || undefined })),
      });
      setBulkResult(r);
      // Refetch'ni modal yopilgandan keyin qilamiz — aks holda DiagPanel
      // unmount bo'lib modal yo'qoladi.
    } catch (e: any) {
      toast.error(e?.message || "Qo'shilmadi");
    } finally {
      setBulkLoading(false);
    }
  }

  function handleCloseBulkModal() {
    const hadSuccess = bulkResult && bulkResult.summary.ok > 0;
    setBulkResult(null);
    if (hadSuccess) {
      onFixed?.();
      qc.invalidateQueries({ queryKey: ['reconcile-today'] });
    }
  }

  return (
    <div className={cn('rounded-lg border', toneCls)}>
      <div className={cn('px-3 py-2 border-b border-current/10 flex items-center gap-2 text-[12px] font-semibold flex-wrap', headCls)}>
        {icon}
        <span>{title}</span>
        <span className="tabular-nums">{items.length}</span>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {/* Hammasini sanani tuzatish (existsOnDate item'lar uchun) */}
          {fixable && fixableDateItems.length > 0 && (
            <button
              onClick={handleFixAllDates}
              disabled={fixDateLoading}
              title={`${fixableDateItems.length} ta tx'ni ${date} ga tuzatish`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md
                         bg-emerald-600 text-white text-[11px] font-semibold
                         hover:bg-emerald-700 disabled:opacity-60 transition"
            >
              {fixDateLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
              {fixDateLoading ? `Tuzatilmoqda ${fixableDateItems.length} ta...` : `Sanani tuzatish · ${fixableDateItems.length}`}
            </button>
          )}
          {/* Hammasini qo'shish (yangi tx'lar uchun) */}
          {fixable && insertableItems.length > 1 && (
            <button
              onClick={handleFixAll}
              disabled={bulkLoading}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md
                         bg-indigo-600 text-white text-[11px] font-semibold
                         hover:bg-indigo-700 disabled:opacity-60 transition"
            >
              {bulkLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {bulkLoading ? `Qo'shilmoqda ${insertableItems.length} ta...` : `Hammasini qo'shish · ${insertableItems.length}`}
            </button>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <div className="p-3 text-[11px] text-slate-500">{empty}</div>
      ) : (
        <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
          {items.map((it, i) => (
            <DiagItem
              key={it.id || it.b2Id || it.externalId || i}
              it={it}
              fixable={fixable}
              accountId={accountId}
              date={date}
              onFixed={onFixed}
            />
          ))}
        </div>
      )}

      {/* Bulk natija modali */}
      {bulkResult && (
        <BulkResultModal result={bulkResult} onClose={handleCloseBulkModal} />
      )}

      {/* Sana tuzatish natija modali */}
      {fixDateResult && (
        <FixDateResultModal result={fixDateResult} onClose={handleCloseFixDateModal} />
      )}

      {/* Sana tuzatishni tasdiqlash modali */}
      {fixDateConfirmOpen && (
        <FixDateConfirmModal
          count={fixableDateItems.length}
          newDate={date || ''}
          onConfirm={executeFixAllDates}
          onCancel={() => setFixDateConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function DiagItem({
  it, fixable, accountId, date, onFixed,
}: {
  it: DiagnoseItem;
  fixable?: boolean;
  accountId?: string;
  date?: string;
  onFixed?: () => void;
}) {
  const qc = useQueryClient();
  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  async function handleFix() {
    if (!accountId || !date) return;
    setFixing(true);
    try {
      // Single insert ham bulk endpoint orqali — bitta umumiy modal ishlatish uchun
      const r = await api.post<BulkResult>('/transactions/reconcile/fix-all-missing', {
        accountId,
        date,
        items: [{ b2Id: it.b2Id || undefined, generalId: it.generalId || undefined }],
      });
      setBulkResult(r);
      setFixed(r.summary.ok > 0);
      // Refetch'ni modal yopilgandan keyin (onClose'da) qilamiz — aks holda
      // diagnose qayta yuklanib DiagItem unmount bo'ladi va modal yo'qoladi.
    } catch (e: any) {
      setBulkResult({
        ok: true,
        summary: { total: 1, ok: 0, error: 1 },
        results: [{
          b2Id: it.b2Id, generalId: it.generalId,
          ok: false, inserted: false,
          transactionId: null, externalId: null,
          error: e?.message || "Tarmoq xato",
        }],
      });
    } finally {
      setFixing(false);
    }
  }

  function handleCloseModal() {
    const hadSuccess = bulkResult && bulkResult.summary.ok > 0;
    setBulkResult(null);
    if (hadSuccess) {
      // Endi xavfsiz refetch — modal yopilgan
      onFixed?.();
      qc.invalidateQueries({ queryKey: ['reconcile-today'] });
    }
  }

  return (
    <div className={cn('p-3 text-[11px] space-y-1', fixed && 'opacity-50')}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn(
          'font-bold tabular-nums',
          it.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700',
        )}>
          {it.direction === 'IN' ? '+' : '−'}{formatMoney(Number(it.amount || 0)).replace(' UZS', '')}
        </span>
        {it.docNumber && (
          <span className="text-[10px] text-slate-500 font-mono">#{it.docNumber}</span>
        )}
      </div>
      <div className="text-slate-700">
        <div className="truncate">
          <span className="text-slate-400">Kim:</span> {it.fromName || it.toName || '—'}
        </div>
        {(it.purpose || it.description) && (
          <div className="text-slate-500 line-clamp-2 mt-0.5">
            {it.purpose || it.description}
          </div>
        )}
        {(it.ddate || it.time) && (
          <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1.5">
            <span className="inline-block w-1 h-1 rounded-full bg-slate-300" />
            <span className="font-mono tabular-nums">
              {it.ddate || ''} {it.time || ''}
            </span>
          </div>
        )}
      </div>
      {(it.b2Id || it.externalId) && (
        <div className="text-[10px] text-slate-400 font-mono truncate">
          {it.b2Id ? `b2:${it.b2Id}` : it.externalId}
        </div>
      )}
      {/* Agar tx boshqa sana ostida saqlangan bo'lsa — duplikat bo'lmaslik uchun
          qo'shish tugmasini chiqarmaymiz, faqat ogohlantirish */}
      {it.existsOnDate && (
        <div className="mt-2 rounded-md bg-amber-50 ring-1 ring-amber-200 px-2.5 py-1.5 text-[10px] text-amber-900">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">
                AllTranzactions'da boshqa sana ostida saqlangan
              </div>
              <div className="text-amber-700 mt-0.5">
                Sana: <span className="font-mono">{it.existsOnDate}</span> · joriy: <span className="font-mono">{date}</span>
              </div>
            </div>
          </div>
          {it.existingTxId && (
            <button
              onClick={async () => {
                if (!confirm(`Sanani tuzatishni tasdiqlaysizmi?\n\n${it.existsOnDate} → ${date}\n\nFaqat sana o'zgaradi, boshqa malumotlar (kategoriya, shartnoma) tegmaydi.`)) return;
                try {
                  await api.post('/transactions/reconcile/fix-tx-date', { txId: it.existingTxId, newDate: date });
                  toast.success(`Sana tuzatildi: ${it.existsOnDate} → ${date}`);
                  onFixed?.();
                } catch (e: any) { toast.error(e?.message || 'Xato'); }
              }}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[10.5px] font-semibold hover:bg-emerald-700 transition"
            >
              <CheckCircle2 className="h-3 w-3" />
              Sanani {date} ga tuzatish
            </button>
          )}
        </div>
      )}
      {fixable && !fixed && !it.existsOnDate && (
        <button
          onClick={handleFix}
          disabled={fixing}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md
                     bg-indigo-600 text-white text-[11px] font-semibold
                     hover:bg-indigo-700 disabled:opacity-60 transition"
        >
          {fixing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          {fixing ? "Qo'shilmoqda..." : "AllTranzactions'ga qo'shish"}
        </button>
      )}
      {fixed && (
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-emerald-700 font-semibold">
          <CheckCircle2 className="h-3 w-3" /> Qo'shildi
        </div>
      )}

      {/* Natija modali — bulk modal bilan birxil */}
      {bulkResult && (
        <BulkResultModal result={bulkResult} onClose={handleCloseModal} />
      )}
    </div>
  );
}

function DailyBreakdown({
  rows, onPickDay,
}: {
  rows: NonNullable<ReconcileData['dailyBreakdown']>;
  onPickDay: (date: string) => void;
}) {
  const m = (n: number) => formatMoney(Number(n || 0)).replace(' UZS', '');
  const mismatches = rows.filter((r) => r.status === 'mismatch');

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-[12px] font-semibold text-slate-700">
        <Calendar className="h-4 w-4 text-indigo-600" />
        <span>Kunma-kun</span>
        <span className="ml-auto text-[11px] font-normal text-slate-500">
          {mismatches.length > 0 ? `${mismatches.length} ta kun farqli` : 'Hammasi mos'}
        </span>
      </div>
      <div className="max-h-[320px] overflow-y-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-slate-50/60 text-[10px] uppercase tracking-wider text-slate-500 font-semibold sticky top-0">
            <tr>
              <th className="text-left px-4 py-2">Sana</th>
              <th className="text-right px-4 py-2">Bank kirim</th>
              <th className="text-right px-4 py-2">AllTranzactions kirim</th>
              <th className="text-right px-4 py-2">Bank chiqim</th>
              <th className="text-right px-4 py-2">AllTranzactions chiqim</th>
              <th className="text-right px-4 py-2">Farq</th>
              <th className="text-center px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {rows.map((r) => {
              const totalDiff = Math.abs(r.creditDiff) + Math.abs(r.debitDiff);
              return (
                <tr
                  key={r.date}
                  className={cn(
                    'transition-colors',
                    r.status === 'mismatch' && 'bg-amber-50/60',
                    r.status === 'failed' && 'bg-rose-50/40 text-rose-700',
                  )}
                >
                  <td className="px-4 py-2 font-mono text-slate-600">{r.date}</td>
                  <td className="px-4 py-2 text-right text-emerald-700">{m(r.bankCredit)}</td>
                  <td className="px-4 py-2 text-right text-emerald-700">{m(r.dbInflow)}</td>
                  <td className="px-4 py-2 text-right text-rose-700">{m(r.bankDebit)}</td>
                  <td className="px-4 py-2 text-right text-rose-700">{m(r.dbOutflow)}</td>
                  <td className={cn(
                    'px-4 py-2 text-right font-bold',
                    r.status === 'ok' ? 'text-emerald-700' : r.status === 'mismatch' ? 'text-amber-700' : 'text-rose-700',
                  )}>
                    {r.failed ? '— xato —' : m(totalDiff)}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {r.status === 'mismatch' && (
                      <button
                        onClick={() => onPickDay(r.date)}
                        className="text-[10px] px-2 py-1 rounded-md bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
                      >
                        Ochish
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BulkResultModal({
  result, onClose,
}: {
  result: BulkResult;
  onClose: () => void;
}) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedOne, setCopiedOne] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Hamma muvaffaqiyatli natijani ko'rsatamiz — externalId yo'q bo'lsa ham
  // (transactionId yoki "—" ko'rsatiladi)
  const successes = result.results.filter((r) => r.ok);
  const failures = result.results.filter((r) => !r.ok);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedOne(key);
      toast.success('Nusxa olindi');
      setTimeout(() => setCopiedOne(null), 1500);
    } catch {
      toast.error('Nusxa olishda xato');
    }
  }

  async function copyAll() {
    const ids = successes
      .map((r) => r.externalId || r.transactionId)
      .filter(Boolean)
      .join('\n');
    if (!ids) { toast.error("Copy uchun ID topilmadi"); return; }
    try {
      await navigator.clipboard.writeText(ids);
      setCopiedAll(true);
      toast.success(`${successes.length} ta ID nusxa olindi`);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      toast.error('Nusxa olishda xato');
    }
  }

  if (!mounted) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-md grid place-items-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 bg-gradient-to-r from-emerald-50 via-amber-50 to-rose-50 border-b border-slate-200">
          <div className="w-10 h-10 rounded-xl bg-indigo-500 grid place-items-center shrink-0 shadow-md shadow-indigo-500/30">
            <Download className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-slate-900">
              Bulk natija
            </div>
            <div className="text-[11px] text-slate-600 mt-0.5 flex items-center gap-3 flex-wrap">
              <span>Jami: <b>{result.summary.total}</b></span>
              <span className="text-emerald-700">✓ Qo'shildi: <b>{result.summary.ok}</b></span>
              {result.summary.error > 0 && (
                <span className="text-rose-700">✗ Xato: <b>{result.summary.error}</b></span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg grid place-items-center text-slate-500 hover:bg-white/80 hover:text-rose-700 transition"
            aria-label="Yopish"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Muvaffaqiyatli — Copy All tugmasi bilan */}
          {successes.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 overflow-hidden">
              <div className="px-3 py-2.5 border-b border-emerald-100 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                <span className="text-[12px] font-semibold text-emerald-900">
                  Qo'shilgan tranzaksiyalar · {successes.length}
                </span>
                <button
                  onClick={copyAll}
                  className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md
                             bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 transition"
                >
                  {copiedAll ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedAll ? 'Olindi' : "Hammasini copy"}
                </button>
              </div>
              <div className="divide-y divide-emerald-100/60 max-h-[50vh] overflow-y-auto">
                {successes.map((r, i) => {
                  const idToCopy = r.externalId || r.transactionId || '';
                  const key = idToCopy || `s-${i}`;
                  return (
                    <div key={key} className="p-3 text-[11px] space-y-1.5">
                      {r.externalId && (
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                            External · composite
                          </div>
                          <div className="flex items-stretch gap-2">
                            <code className="flex-1 px-2 py-1.5 rounded bg-white ring-1 ring-emerald-200
                                              font-mono text-[11px] text-slate-800 break-all select-all">
                              {r.externalId}
                            </code>
                            <button
                              onClick={() => copy(r.externalId!, `${key}-ext`)}
                              className="px-2 rounded bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 transition shrink-0"
                            >
                              {copiedOne === `${key}-ext` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </div>
                        </div>
                      )}
                      {r.transactionId && (
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                            AllTranzactions ID
                          </div>
                          <div className="flex items-stretch gap-2">
                            <code className="flex-1 px-2 py-1.5 rounded bg-white ring-1 ring-emerald-200
                                              font-mono text-[11px] text-slate-800 break-all select-all">
                              {r.transactionId}
                            </code>
                            <button
                              onClick={() => copy(r.transactionId!, `${key}-tx`)}
                              className="px-2 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[11px] font-semibold transition shrink-0"
                            >
                              {copiedOne === `${key}-tx` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </div>
                        </div>
                      )}
                      {!r.externalId && !r.transactionId && (
                        <div className="text-[11px] text-amber-700">
                          ⚠ Qo'shildi, lekin ID topilmadi (DB lookup'da yo'q)
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-[10px] flex-wrap">
                        {r.inserted ? (
                          <span className="text-emerald-700 font-semibold">✓ Yangi qo'shildi</span>
                        ) : (
                          <span className="text-amber-700 font-semibold">
                            ⚠ Avvaldan mavjud edi
                            {r.existingDate && <span className="font-normal"> · sana: {r.existingDate}</span>}
                          </span>
                        )}
                        {(r.b2Id || r.generalId) && (
                          <span className="text-slate-400 font-mono truncate">
                            · {r.b2Id ? `b2:${r.b2Id}` : `gen:${r.generalId}`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Xato bo'lganlar — sababi bilan */}
          {failures.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/40 overflow-hidden">
              <div className="px-3 py-2.5 border-b border-rose-100 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-700" />
                <span className="text-[12px] font-semibold text-rose-900">
                  Qo'shilmadi · {failures.length}
                </span>
              </div>
              <div className="divide-y divide-rose-100/60 max-h-[40vh] overflow-y-auto">
                {failures.map((r, i) => (
                  <div key={`${r.b2Id || r.generalId || i}`} className="p-3 text-[11px] space-y-1">
                    <div className="font-mono text-[10px] text-slate-500 truncate">
                      {r.b2Id ? `b2:${r.b2Id}` : r.generalId ? `gen:${r.generalId}` : '—'}
                    </div>
                    <div className="text-rose-800">
                      <span className="font-semibold">Sabab:</span> {r.error || "noma'lum xato"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12px] font-semibold transition"
          >
            Yopish
          </button>
        </div>
      </div>
    </div>
  );

  // Portal — document.body'ga render — drilldown stacking context'idan chiqib,
  // har doim eng ustda turadi (xira ko'rinish bo'lmaydi)
  return createPortal(modalContent, document.body);
}

// ════════════════════════════════════════════════════
//  FIX-DATE NATIJA MODALI — bulk sana tuzatishdan keyin
// ════════════════════════════════════════════════════
function FixDateResultModal({
  result, onClose,
}: {
  result: { summary: { total: number; updated: number; skipped: number; errors: number }; results: Array<{ txId: string; updated: boolean; oldDate?: string; newDate: string; externalId?: string | null; error?: string }> };
  onClose: () => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  function copyAll() {
    const ids = result.results.filter(r => r.updated).map(r => r.externalId || r.txId).join('\n');
    navigator.clipboard.writeText(ids);
    toast.success(`${result.summary.updated} ta ID nusxalandi`);
  }
  function copyOne(id: string) {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  const updated = result.results.filter(r => r.updated);
  const failed = result.results.filter(r => !r.updated && r.error);

  const modalContent = (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow-lg shadow-emerald-500/20">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-[14px] font-bold">Sana tuzatish natijasi</div>
            <div className="text-[11px] text-slate-500">
              Jami: <b>{result.summary.total}</b> · ✅ Tuzatildi: <b className="text-emerald-700">{result.summary.updated}</b>
              {result.summary.skipped > 0 && <> · ⏭ O'zgarmadi: <b>{result.summary.skipped}</b></>}
              {result.summary.errors > 0 && <> · ❌ Xato: <b className="text-rose-700">{result.summary.errors}</b></>}
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full grid place-items-center bg-slate-100 hover:bg-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        {updated.length > 0 && (
          <div className="px-5 py-2 border-b border-slate-100 flex items-center justify-between bg-emerald-50/50">
            <div className="text-[12px] font-semibold text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Tuzatilgan tranzaksiyalar · {updated.length}
            </div>
            <button onClick={copyAll}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[10.5px] font-semibold hover:bg-emerald-700">
              <Copy className="h-3 w-3" /> Hammasini copy
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {updated.map((r) => {
            const id = r.externalId || r.txId;
            const isCopied = copiedId === id;
            return (
              <div key={r.txId} className="rounded-lg ring-1 ring-emerald-200 bg-emerald-50/40 p-2.5">
                <div className="flex items-center gap-2 text-[11px] mb-1.5">
                  <span className="font-mono text-emerald-700 font-semibold">{r.oldDate} → {r.newDate}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 font-mono text-[10px] bg-white px-2 py-1 rounded ring-1 ring-slate-200 break-all">
                    {id}
                  </code>
                  <button onClick={() => copyOne(id)}
                    title="ID nusxalash"
                    className={cn(
                      "shrink-0 w-7 h-7 rounded-md grid place-items-center transition-all",
                      isCopied ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
                    )}>
                    {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            );
          })}
          {failed.length > 0 && (
            <>
              <div className="text-[11px] font-semibold text-rose-700 mt-2 mb-1">❌ Xatoliklar ({failed.length})</div>
              {failed.map((r, i) => (
                <div key={i} className="rounded-lg ring-1 ring-rose-200 bg-rose-50 p-2 text-[10.5px] text-rose-800">
                  <div className="font-mono text-rose-600 truncate">{r.txId}</div>
                  <div>{r.error}</div>
                </div>
              ))}
            </>
          )}
          {updated.length === 0 && failed.length === 0 && (
            <div className="text-center text-[12px] text-slate-400 py-8">Hech narsa o'zgarmadi</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end">
          <Button onClick={onClose}>Yopish</Button>
        </div>
      </div>
    </div>
  );
  return createPortal(modalContent, document.body);
}

// ════════════════════════════════════════════════════
//  SANA TUZATISH — TASDIQLASH MODALI
// ════════════════════════════════════════════════════
function FixDateConfirmModal({
  count, newDate, onConfirm, onCancel,
}: {
  count: number;
  newDate: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const modalContent = (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 grid place-items-center text-white shadow-lg shadow-amber-500/20">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-[14px] font-bold">Sana tuzatishni tasdiqlang</div>
            <div className="text-[11px] text-slate-500">Bu amalni qaytarib bo'lmaydi</div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl ring-1 ring-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold mb-1">Tuzatiladi</div>
              <div className="text-3xl font-bold text-emerald-700 tabular-nums">{count}</div>
              <div className="text-[11px] text-emerald-600 mt-0.5">ta tranzaksiya</div>
            </div>
          </div>

          <div className="rounded-lg ring-1 ring-violet-200 bg-violet-50 p-3 flex items-center gap-3">
            <Calendar className="h-4 w-4 text-violet-600 shrink-0" />
            <div className="flex-1 text-[12px]">
              <div className="text-slate-500">Yangi sana:</div>
              <div className="font-mono font-bold text-violet-900">{newDate}</div>
            </div>
          </div>

          <div className="rounded-lg ring-1 ring-amber-200 bg-amber-50 p-3 flex items-start gap-2 text-[11px] text-amber-800">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div>
              <b>Faqat <code className="font-mono">txnDate</code> o'zgaradi.</b><br/>
              Kategoriya, shartnoma, kontragent va boshqa ma'lumotlar tegmaydi.
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Bekor qilish</Button>
          <Button onClick={onConfirm} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Ha, tuzatish
          </Button>
        </div>
      </div>
    </div>
  );
  return createPortal(modalContent, document.body);
}
