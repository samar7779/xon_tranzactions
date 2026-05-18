'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, RefreshCw, Loader2, Calendar, AlertTriangle, CheckCircle2,
  ArrowDownLeft, ArrowUpRight, Search, Inbox, Database,
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

  async function runCheck() {
    setLoading(true);
    setShowDiagnose(false);
    try {
      const result = await api.post<ReconcileData>('/transactions/reconcile', {
        accountId: item.accountId, dateFrom, dateTo,
      });
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
              onClick={runCheck}
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
                    ? 'Mos keldi — bank va DB to\'liq muvofiq'
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

              {/* Diagnostika tugmasi va natija */}
              {data.status === 'mismatch' && isSingleDay && (
                <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Search className="h-5 w-5 text-indigo-600" />
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold text-slate-900">Farq sababini topish</div>
                      <div className="text-[11px] text-slate-500">Bankdagi har bir tranzaksiyani DB bilan solishtiramiz va yetishmayotgan/ortiqcha yozuvlarni topamiz</div>
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
                    <DiagnoseResult data={diagnoseData} />
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
            <th className="text-right px-4 py-2.5">Bizning DB</th>
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
  data,
}: {
  data: { bankCount: number; dbCount: number; matchedCount: number; bankOnly: DiagnoseItem[]; dbOnly: DiagnoseItem[] };
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-[12px] text-slate-600">
        <span>Bankda: <b className="text-slate-900">{data.bankCount}</b></span>
        <span>DB da: <b className="text-slate-900">{data.dbCount}</b></span>
        <span>Mos: <b className="text-emerald-700">{data.matchedCount}</b></span>
      </div>

      {data.bankOnly.length === 0 && data.dbOnly.length === 0 ? (
        <div className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200 p-3 text-[12px] text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          Yozuvlar to'liq mos — farq, ehtimol, yaxlitlash xatosi yoki kalit indekslar muammosi
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Bankda bor, DB da yo'q */}
          <DiagPanel
            title="Bankda bor — DB da yo'q"
            icon={<Inbox className="h-4 w-4" />}
            tone="amber"
            items={data.bankOnly}
            empty="Yo'qolgan yozuvlar yo'q"
          />
          {/* DB da bor, bankda yo'q */}
          <DiagPanel
            title="DB da bor — bankda yo'q"
            icon={<Database className="h-4 w-4" />}
            tone="rose"
            items={data.dbOnly}
            empty="Ortiqcha yozuvlar yo'q"
          />
        </div>
      )}
    </div>
  );
}

function DiagPanel({
  title, icon, tone, items, empty,
}: {
  title: string;
  icon: React.ReactNode;
  tone: 'amber' | 'rose';
  items: DiagnoseItem[];
  empty: string;
}) {
  const toneCls = tone === 'amber'
    ? 'border-amber-200 bg-amber-50/40'
    : 'border-rose-200 bg-rose-50/40';
  const headCls = tone === 'amber' ? 'text-amber-800' : 'text-rose-800';

  return (
    <div className={cn('rounded-lg border', toneCls)}>
      <div className={cn('px-3 py-2 border-b border-current/10 flex items-center gap-2 text-[12px] font-semibold', headCls)}>
        {icon}
        <span>{title}</span>
        <span className="ml-auto tabular-nums">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="p-3 text-[11px] text-slate-500">{empty}</div>
      ) : (
        <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
          {items.map((it, i) => (
            <div key={it.id || it.b2Id || it.externalId || i} className="p-3 text-[11px] space-y-1">
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
              </div>
              {(it.b2Id || it.externalId) && (
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  {it.b2Id ? `b2:${it.b2Id}` : it.externalId}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
