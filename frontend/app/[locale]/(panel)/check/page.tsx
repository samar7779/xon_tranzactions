'use client';
// build: sverka v2 (live today + per-account drill-down)

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Scale, RefreshCw, CheckCircle2, AlertTriangle, Loader2,
  Search, X, ChevronRight, Wifi,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { TransactionsTabs } from '@/components/transactions-tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';
import { AccountDrilldown } from './_drilldown';

interface TodayItem {
  ok?: boolean;
  status: 'ok' | 'mismatch' | 'error';
  accountId: string;
  accountNo: string;
  ownerName: string | null;
  bankName: string | null;
  error?: string;
  partial?: boolean;
  failedDays?: number;
  bank?: { opening: number; closing: number; debit: number; credit: number };
  db?: { inflow: number; outflow: number; inCount: number; outCount: number };
  diff?: { credit: number; debit: number; formula: number; computedClosing: number };
}

interface TodayResponse {
  ok: true;
  date: string;
  summary: { total: number; ok: number; mismatch: number; error: number };
  items: TodayItem[];
}

// Live refetch: 20 minutda avtomatik + window focus'da darrov yangilanadi
const AUTO_REFETCH_MS = 20 * 60 * 1000;

export default function CheckPage() {
  const t = useTranslations('check');
  const [q, setQ] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [singleLoading, setSingleLoading] = useState<Set<string>>(new Set());
  const [singleResults, setSingleResults] = useState<Record<string, TodayItem>>({});

  // Bugungi sverka — live: 5 minutda avto + window focus'da yangilanadi
  const todayQuery = useQuery<TodayResponse>({
    queryKey: ['reconcile-today'],
    queryFn: () => api.get('/transactions/reconcile/today'),
    refetchInterval: AUTO_REFETCH_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 60_000, // 1 minut ichida fresh hisoblanadi (tab orasida yelvirashlarda qayta o'qimaydi)
  });

  // Manual refresh — barcha
  async function refreshAll() {
    toast.message('Bugungi sverka yangilanmoqda...');
    await todayQuery.refetch();
    toast.success('Yangilandi');
  }

  // Manual refresh — bitta hisob
  async function refreshOne(accountId: string) {
    const next = new Set(singleLoading);
    next.add(accountId);
    setSingleLoading(next);
    try {
      const today = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const data = await api.post<TodayItem>('/transactions/reconcile', {
        accountId, dateFrom: today, dateTo: today,
      });
      setSingleResults((r) => ({ ...r, [accountId]: data }));
    } catch (e: any) {
      setSingleResults((r) => ({
        ...r,
        [accountId]: {
          status: 'error', accountId, accountNo: '', ownerName: null, bankName: null,
          error: e?.message || 'Xato',
        },
      }));
    } finally {
      setSingleLoading((s) => {
        const n = new Set(s); n.delete(accountId); return n;
      });
    }
  }

  // Manual natijani umumiy list bilan birlashtirish
  const items = useMemo(() => {
    const base = todayQuery.data?.items || [];
    return base.map((it) => singleResults[it.accountId] || it);
  }, [todayQuery.data, singleResults]);

  // Search filter
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return items;
    return items.filter((it) =>
      it.accountNo?.toLowerCase().includes(ql) ||
      it.ownerName?.toLowerCase().includes(ql) ||
      it.bankName?.toLowerCase().includes(ql),
    );
  }, [items, q]);

  const summary = useMemo(() => ({
    total: items.length,
    ok: items.filter((i) => i.status === 'ok').length,
    mismatch: items.filter((i) => i.status === 'mismatch').length,
    error: items.filter((i) => i.status === 'error').length,
  }), [items]);

  const selectedAccount = useMemo(
    () => items.find((it) => it.accountId === selectedAccountId) || null,
    [items, selectedAccountId],
  );

  const isLoading = todayQuery.isLoading;
  const isRefreshing = todayQuery.isFetching && !todayQuery.isLoading;

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <TransactionsTabs />

      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full">
        {/* ═══ Top bar: search + refresh ═══ */}
        <Card className="border-0 shadow-soft">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  className="pl-9 h-11 rounded-xl bg-slate-50/60"
                  placeholder="Hisob raqami, egasi yoki bank..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    onClick={() => setQ('')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                <span>Avto-yangilanish · har 20 daqiqada {isRefreshing && '· hozir...'}</span>
              </div>

              <Button
                onClick={refreshAll}
                disabled={isRefreshing}
                className="h-11 rounded-xl font-semibold"
              >
                {isRefreshing ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Yangilanmoqda...</>
                ) : (
                  <><RefreshCw className="h-4 w-4 mr-1.5" /> Hammasini yangilash · bugun</>
                )}
              </Button>
            </div>

            {/* Umumiy holat */}
            {summary.total > 0 && (
              <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-100 text-[12px]">
                <span className="text-slate-500">Bugun · {todayQuery.data?.date || '—'}</span>
                <span className="text-slate-300">·</span>
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
                <span className="text-slate-300">·</span>
                <span className="text-slate-500">{summary.total} hisob</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ═══ Hisoblar — farq summasi bo'yicha sortlangan ═══ */}
        <Card className="border-0 shadow-soft">
          <CardContent className="p-0">
            {isLoading ? (
              <SverkaLoading title={t('loadingTitle')} subtitle={t('loadingSubtitle')} />
            ) : todayQuery.error ? (
              <div className="p-8 text-center space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 ring-1 ring-rose-200 text-rose-700 text-[12px] font-semibold">
                  <X className="h-3.5 w-3.5" />
                  So'rovda xato yuz berdi
                </div>
                <div className="text-[12px] text-slate-600 max-w-md mx-auto">
                  {(todayQuery.error as any)?.message || "noma'lum xato"}
                </div>
                <Button variant="outline" size="sm" onClick={refreshAll} className="mt-2 rounded-lg">
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Qayta urinish
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Scale}
                title={q ? "Qidiruv bo'yicha hisob topilmadi" : "Aktiv hisoblar topilmadi"}
                description={q ? undefined : "Bank yoki hisoblar aktiv emas — Setup → Banklarda tekshiring"}
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {filtered.map((it) => (
                  <AccountRow
                    key={it.accountId}
                    item={it}
                    loading={singleLoading.has(it.accountId)}
                    onClick={() => setSelectedAccountId(it.accountId)}
                    onRefresh={() => refreshOne(it.accountId)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Drill-down modal */}
      {selectedAccount && (
        <AccountDrilldown
          item={selectedAccount}
          onClose={() => setSelectedAccountId(null)}
          onUpdated={(updated) => setSingleResults((r) => ({ ...r, [selectedAccount.accountId]: updated }))}
        />
      )}
    </>
  );
}

function SverkaLoading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="py-16 px-6 grid place-items-center">
      <div className="flex flex-col items-center text-center max-w-md">
        <div className="relative w-20 h-20 grid place-items-center mb-5">
          <span className="absolute inset-0 rounded-full border-2 border-indigo-400/40 animate-ping" style={{ animationDuration: '2s' }} />
          <span className="absolute inset-2 rounded-full border-2 border-indigo-400/30 animate-ping" style={{ animationDuration: '2.5s', animationDelay: '0.4s' }} />
          <span className="absolute w-14 h-14 rounded-full bg-indigo-500/20 blur-xl animate-pulse" />
          <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center shadow-lg shadow-indigo-500/40">
            <Scale className="h-7 w-7 text-white" />
          </div>
        </div>
        <div className="text-[15px] font-semibold text-slate-800 mb-1">{title}</div>
        <div className="text-[12px] text-slate-500 max-w-sm">{subtitle}</div>
        <div className="mt-4 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

function AccountRow({
  item, loading, onClick, onRefresh,
}: {
  item: TodayItem;
  loading: boolean;
  onClick: () => void;
  onRefresh: () => void;
}) {
  const m = (n: number) => formatMoney(Number(n || 0)).replace(' UZS', '');
  const totalDiff = Math.abs((item.diff?.credit || 0)) + Math.abs((item.diff?.debit || 0));

  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-4 py-3.5 transition-colors cursor-pointer',
        item.status === 'mismatch' && 'bg-amber-50/40 hover:bg-amber-50/70',
        item.status === 'error' && 'bg-rose-50/40 hover:bg-rose-50/70',
        item.status === 'ok' && 'hover:bg-slate-50/60',
      )}
      onClick={onClick}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-slate-900 truncate">
          {item.bankName || '—'} · <span className="font-mono text-slate-700">{item.accountNo}</span>
        </div>
        <div className="text-[11px] text-slate-500 truncate mt-0.5">
          {item.ownerName || '— egasi ko\'rsatilmagan'}
        </div>
        {item.status === 'mismatch' && item.diff && (
          <div className="mt-1.5 flex items-center gap-3 text-[11px]">
            <span className="text-emerald-700">
              Kirim farq: <span className="font-bold tabular-nums">{m(item.diff.credit)}</span>
            </span>
            <span className="text-rose-700">
              Chiqim farq: <span className="font-bold tabular-nums">{m(item.diff.debit)}</span>
            </span>
            {item.partial && (
              <span className="text-amber-600">⚠ {item.failedDays} kun ma'lumotsiz</span>
            )}
          </div>
        )}
        {item.status === 'error' && (
          <div className="mt-1 text-[11px] text-rose-700 truncate">
            {item.error}
          </div>
        )}
      </div>

      <StatusBadge item={item} totalDiff={totalDiff} />

      <Button
        size="sm"
        variant="outline"
        className="h-9 rounded-lg shrink-0"
        disabled={loading}
        onClick={(e) => { e.stopPropagation(); onRefresh(); }}
        title="Manual yangilash"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
      </Button>

      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 shrink-0" />
    </div>
  );
}

function StatusBadge({ item, totalDiff }: { item: TodayItem; totalDiff: number }) {
  if (item.status === 'error') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 ring-1 ring-rose-200 px-2.5 py-1.5 rounded-full shrink-0">
        <X className="h-3 w-3" /> Xato
      </span>
    );
  }
  if (item.status === 'mismatch') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 ring-1 ring-amber-200 px-2.5 py-1.5 rounded-full shrink-0 tabular-nums">
        <AlertTriangle className="h-3 w-3" />
        Farq {formatMoney(totalDiff).replace(' UZS', '')}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 px-2.5 py-1.5 rounded-full shrink-0">
      <CheckCircle2 className="h-3 w-3" /> Mos
    </span>
  );
}
