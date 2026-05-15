'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Scale, RefreshCw, CheckCircle2, AlertTriangle, Loader2,
  ChevronDown, Search, X,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

type RowState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  data?: any;
  error?: string;
};

function monthStartIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function CheckPage() {
  const t = useTranslations('check');
  const [dateFrom, setDateFrom] = useState(monthStartIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Record<string, RowState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [allRunning, setAllRunning] = useState(false);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<{ items: any[] }>('/bank-accounts'),
  });

  const filtered = useMemo(() => {
    const all = accounts?.items || [];
    const ql = q.trim().toLowerCase();
    if (!ql) return all;
    return all.filter((a: any) =>
      a.accountNo?.toLowerCase().includes(ql) ||
      a.ownerName?.toLowerCase().includes(ql) ||
      a.bank?.name?.toLowerCase().includes(ql),
    );
  }, [accounts, q]);

  async function checkOne(accountId: string): Promise<void> {
    setResults((r) => ({ ...r, [accountId]: { status: 'loading' } }));
    try {
      const data = await api.post<any>('/transactions/reconcile', { accountId, dateFrom, dateTo });
      setResults((r) => ({ ...r, [accountId]: { status: 'done', data } }));
    } catch (e: any) {
      setResults((r) => ({ ...r, [accountId]: { status: 'error', error: e?.message || 'Xato' } }));
    }
  }

  async function checkAll() {
    if (!dateFrom || !dateTo) return toast.error("Sana oralig'ini tanlang");
    setAllRunning(true);
    try {
      for (const a of filtered) {
        await checkOne(a.id);
      }
      toast.success('Sverka yakunlandi');
    } finally {
      setAllRunning(false);
    }
  }

  // Umumiy hisob
  const summary = useMemo(() => {
    const vals = Object.values(results);
    return {
      ok: vals.filter((v) => v.status === 'done' && v.data?.status === 'ok').length,
      mismatch: vals.filter((v) => v.status === 'done' && v.data?.status === 'mismatch').length,
      error: vals.filter((v) => v.status === 'error').length,
      checked: vals.filter((v) => v.status === 'done' || v.status === 'error').length,
    };
  }, [results]);

  return (
    <>
      <Topbar
        title={t('title')}
        subtitle={t('subtitle')}
      />

      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full">
        {/* ═══ Boshqaruv paneli ═══ */}
        <Card className="border-0 shadow-soft">
          <CardContent className="p-4">
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
              <div className="relative flex-1 min-w-[200px] space-y-1">
                <label className="text-[11px] font-medium text-slate-600">Qidirish</label>
                <Search className="absolute left-3 top-[34px] h-4 w-4 text-slate-400" />
                <Input
                  className="pl-9 h-10 rounded-xl bg-slate-50/60"
                  placeholder="Hisob, egasi yoki bank..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button
                    className="absolute right-2.5 top-[34px] text-slate-400 hover:text-slate-700"
                    onClick={() => setQ('')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button
                onClick={checkAll}
                disabled={allRunning || filtered.length === 0}
                className="h-10 rounded-xl font-semibold"
              >
                {allRunning ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Tekshirilmoqda...</>
                ) : (
                  <><RefreshCw className="h-4 w-4 mr-1.5" /> Hammasini tekshir</>
                )}
              </Button>
            </div>

            {/* Umumiy natija */}
            {summary.checked > 0 && (
              <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-100 text-[12px]">
                <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {summary.ok} mos
                </span>
                <span className="flex items-center gap-1.5 text-amber-700 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" /> {summary.mismatch} farqli
                </span>
                {summary.error > 0 && (
                  <span className="flex items-center gap-1.5 text-rose-700 font-semibold">
                    <X className="h-3.5 w-3.5" /> {summary.error} xato
                  </span>
                )}
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">{summary.checked} / {filtered.length} tekshirildi</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ═══ Hisoblar ro'yxati ═══ */}
        <Card className="border-0 shadow-soft">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState icon={Scale} title="Hisoblar topilmadi" />
            ) : (
              <div className="divide-y divide-slate-100">
                {filtered.map((a: any) => {
                  const st = results[a.id];
                  const isOpen = expanded === a.id;
                  return (
                    <div key={a.id}>
                      {/* Qator */}
                      <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/60 transition-colors">
                        <button
                          className="flex items-center gap-3 min-w-0 flex-1 text-left"
                          onClick={() => setExpanded(isOpen ? null : a.id)}
                        >
                          <ChevronDown className={cn(
                            "h-4 w-4 text-slate-400 shrink-0 transition-transform",
                            isOpen && "rotate-180",
                            !st?.data && "opacity-0",
                          )} />
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-slate-900 truncate">
                              {a.bank?.name || '—'} · <span className="font-mono">{a.accountNo}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {a.ownerName || '— egasi ko\'rsatilmagan'}
                            </div>
                          </div>
                        </button>

                        <StatusBadge state={st} />

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg shrink-0"
                          disabled={st?.status === 'loading' || allRunning}
                          onClick={() => checkOne(a.id)}
                        >
                          {st?.status === 'loading'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : 'Tekshir'}
                        </Button>
                      </div>

                      {/* Tafsilot */}
                      {isOpen && st?.data && (
                        <div className="px-4 pb-4 pt-1 bg-slate-50/40">
                          <ReconcileDetail data={st.data} />
                        </div>
                      )}
                      {isOpen && st?.status === 'error' && (
                        <div className="px-4 pb-3 text-[12px] text-rose-700 bg-rose-50/40">
                          {st.error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatusBadge({ state }: { state?: RowState }) {
  if (!state || state.status === 'idle') {
    return <span className="text-[11px] text-slate-400 px-2">tekshirilmagan</span>;
  }
  if (state.status === 'loading') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-slate-500 px-2">
        <Loader2 className="h-3 w-3 animate-spin" /> tekshirilmoqda
      </span>
    );
  }
  if (state.status === 'error') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 ring-1 ring-rose-200 px-2 py-1 rounded-full">
        <X className="h-3 w-3" /> Xato
      </span>
    );
  }
  const ok = state.data?.status === 'ok';
  return (
    <span className={cn(
      "flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ring-1",
      ok
        ? "text-emerald-700 bg-emerald-50 ring-emerald-200"
        : "text-amber-700 bg-amber-50 ring-amber-200",
    )}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {ok ? 'Mos' : 'Farq bor'}
      {state.data?.partial && <span className="text-[9px] opacity-70">(qisman)</span>}
    </span>
  );
}

function ReconcileDetail({ data }: { data: any }) {
  const m = (n: number) => formatMoney(Number(n || 0)).replace(' UZS', '');
  const diffCls = (n: number) =>
    Math.abs(n) < 1 ? 'text-emerald-700' : 'text-amber-700';

  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            <th className="text-left px-3 py-2">Ko'rsatkich</th>
            <th className="text-right px-3 py-2">Bank</th>
            <th className="text-right px-3 py-2">Bizning baza</th>
            <th className="text-right px-3 py-2">Farq</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          <tr>
            <td className="px-3 py-2 text-slate-600">Kirim oboroti</td>
            <td className="px-3 py-2 text-right font-semibold text-emerald-700">{m(data.bank.credit)}</td>
            <td className="px-3 py-2 text-right font-semibold text-emerald-700">
              {m(data.db.inflow)} <span className="text-[10px] text-slate-400">· {data.db.inCount} ta</span>
            </td>
            <td className={cn("px-3 py-2 text-right font-bold", diffCls(data.diff.credit))}>{m(data.diff.credit)}</td>
          </tr>
          <tr>
            <td className="px-3 py-2 text-slate-600">Chiqim oboroti</td>
            <td className="px-3 py-2 text-right font-semibold text-rose-700">{m(data.bank.debit)}</td>
            <td className="px-3 py-2 text-right font-semibold text-rose-700">
              {m(data.db.outflow)} <span className="text-[10px] text-slate-400">· {data.db.outCount} ta</span>
            </td>
            <td className={cn("px-3 py-2 text-right font-bold", diffCls(data.diff.debit))}>{m(data.diff.debit)}</td>
          </tr>
          <tr className="bg-slate-50/60">
            <td className="px-3 py-2 text-slate-600">Ochilish saldosi</td>
            <td className="px-3 py-2 text-right font-semibold">{m(data.bank.opening)}</td>
            <td className="px-3 py-2 text-right text-slate-400">—</td>
            <td className="px-3 py-2 text-right text-slate-400">—</td>
          </tr>
          <tr>
            <td className="px-3 py-2 text-slate-600">
              Yopilish saldosi
              <div className="text-[10px] text-slate-400">ochilish + kirim − chiqim</div>
            </td>
            <td className="px-3 py-2 text-right font-semibold">{m(data.bank.closing)}</td>
            <td className="px-3 py-2 text-right font-semibold">{m(data.diff.computedClosing)}</td>
            <td className={cn("px-3 py-2 text-right font-bold", diffCls(data.diff.formula))}>{m(data.diff.formula)}</td>
          </tr>
        </tbody>
      </table>
      {data.partial && (
        <div className="px-3 py-2 text-[11px] text-amber-700 bg-amber-50/60 border-t border-amber-100">
          ⚠ Ba'zi kunlar uchun bankdan ma'lumot olinmadi ({data.failedDays} kun) — natija to'liq bo'lmasligi mumkin
        </div>
      )}
    </div>
  );
}
