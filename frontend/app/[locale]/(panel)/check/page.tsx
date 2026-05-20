'use client';
// build: sverka v2 (live today + per-account drill-down)

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Scale, RefreshCw, CheckCircle2, AlertTriangle, Loader2,
  Search, X, ChevronRight, Wifi, Building2, TrendingUp, Receipt,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { TransactionsTabs } from '@/components/transactions-tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/empty-state';
import { BankLogo } from '@/components/bank-logo';
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
  bankCode?: string | null;
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
  const [showErrors, setShowErrors] = useState(false);

  // Bugungi sverka — live: 20 minutda avto + window focus'da yangilanadi
  const todayQuery = useQuery<TodayResponse>({
    queryKey: ['reconcile-today'],
    queryFn: () => api.get('/transactions/reconcile/today'),
    refetchInterval: AUTO_REFETCH_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 60_000,
    // Sverka so'rovi qimmat — xato bo'lganda 3 marta qayta urinmaymiz,
    // foydalanuvchi xato tafsilotini ko'rib o'zi "Qayta urinish" bosadi.
    retry: false,
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

  // Xato qatorlar yashirin — alohida bo'limga ajratamiz
  const nonErrors = useMemo(() => filtered.filter((i) => i.status !== 'error'), [filtered]);
  const errorRows = useMemo(() => filtered.filter((i) => i.status === 'error'), [filtered]);

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

      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full max-w-[1700px] mx-auto">
        {/* ═══ HEADER: ICON + TITLE ═══ */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 grid place-items-center text-white shadow-lg shadow-violet-500/30">
              <Scale className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <div>
              <h1 className="text-[20px] font-bold tracking-tight">Sverka</h1>
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <Wifi className="h-3 w-3 text-emerald-500" />
                Avto-yangilanish · 20 daq {isRefreshing && '· hozir...'}
                {todayQuery.data?.date && <> · <span className="font-mono">{todayQuery.data.date}</span></>}
              </div>
            </div>
          </div>
          <Button
            onClick={refreshAll}
            disabled={isRefreshing}
            className="h-10 rounded-xl font-semibold bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 gap-1.5 shadow-md shadow-violet-500/20"
          >
            {isRefreshing ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Yangilanmoqda...</>
            ) : (
              <><RefreshCw className="h-4 w-4" /> Hammasini yangilash</>
            )}
          </Button>
        </div>

        {/* ═══ KPI KARTALAR ═══ */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SverkaKpi
            label="Jami hisoblar"
            value={summary.total}
            color="violet"
            icon={<Building2 className="h-4 w-4" />}
            loading={isLoading}
          />
          <SverkaKpi
            label="Mos"
            value={summary.ok}
            color="emerald"
            icon={<CheckCircle2 className="h-4 w-4" />}
            loading={isLoading}
            extra={summary.total > 0 ? `${Math.round((summary.ok / summary.total) * 100)}%` : undefined}
          />
          <SverkaKpi
            label="Farqli"
            value={summary.mismatch}
            color={summary.mismatch > 0 ? 'amber' : 'slate'}
            icon={<AlertTriangle className="h-4 w-4" />}
            loading={isLoading}
          />
          <SverkaKpi
            label="Xato"
            value={summary.error}
            color={summary.error > 0 ? 'rose' : 'slate'}
            icon={<X className="h-4 w-4" />}
            loading={isLoading}
          />
        </div>

        {/* ═══ Search bar ═══ */}
        <Card className="border-0 shadow-soft">
          <CardContent className="p-3">
            <div className="relative">
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
              <>
                {/* Asosiy ro'yxat — xato bo'lmaganlar (Mos + Farqli) */}
                <div className="divide-y divide-slate-100">
                  {nonErrors.map((it) => (
                    <AccountRow
                      key={it.accountId}
                      item={it}
                      loading={singleLoading.has(it.accountId) || isRefreshing}
                      onClick={() => setSelectedAccountId(it.accountId)}
                      onRefresh={() => refreshOne(it.accountId)}
                    />
                  ))}
                </div>

                {/* Xato qatorlar — yashirin, bossa ochiladi */}
                {errorRows.length > 0 && (
                  <div className="border-t-2 border-rose-100">
                    <button
                      onClick={() => setShowErrors((s) => !s)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-rose-50/40 hover:bg-rose-50/70 transition group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-rose-100 grid place-items-center text-rose-700 shrink-0">
                        <X className="h-4 w-4" />
                      </div>
                      <div className="text-left min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-rose-900">
                          {errorRows.length} ta xato hisob
                        </div>
                        <div className="text-[11px] text-rose-700/80 truncate">
                          {showErrors
                            ? "Yashirish uchun bosing"
                            : "Tafsilotini ko'rish uchun bosing — odatda 'bu klientga ruxsat yo'q' xatolari"}
                        </div>
                      </div>
                      <ChevronRight className={cn(
                        "h-5 w-5 text-rose-400 transition-transform",
                        showErrors && "rotate-90",
                      )} />
                    </button>

                    {showErrors && (
                      <div className="divide-y divide-rose-100/50">
                        {errorRows.map((it) => (
                          <AccountRow
                            key={it.accountId}
                            item={it}
                            loading={singleLoading.has(it.accountId) || isRefreshing}
                            onClick={() => setSelectedAccountId(it.accountId)}
                            onRefresh={() => refreshOne(it.accountId)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
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
    <div>
      {/* Yuqori status — animatsion pill */}
      <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-indigo-50/60 via-violet-50/40 to-blue-50/60">
        <div className="flex items-center gap-3">
          {/* Pulsing dot bilan icon */}
          <div className="relative w-9 h-9 grid place-items-center shrink-0">
            <span className="absolute inset-0 rounded-xl bg-indigo-500/30 animate-ping" style={{ animationDuration: '1.5s' }} />
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center shadow-md shadow-indigo-500/40">
              <Scale className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-slate-800 flex items-center gap-2">
              {title}
              {/* Inline dots */}
              <span className="flex items-center gap-0.5">
                <span className="w-1 h-1 rounded-full bg-indigo-500 sverka-dot" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-violet-500 sverka-dot" style={{ animationDelay: '180ms' }} />
                <span className="w-1 h-1 rounded-full bg-blue-500 sverka-dot" style={{ animationDelay: '360ms' }} />
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{subtitle}</div>
          </div>
        </div>
        {/* Animatsion progress bar */}
        <div className="mt-3 h-0.5 bg-white/60 rounded-full overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500 rounded-full sverka-progress" />
        </div>
      </div>

      {/* Skeleton account rows — shimmer effect bilan */}
      <div className="divide-y divide-slate-100">
        {Array.from({ length: 8 }).map((_, i) => (
          <SverkaSkeletonRow key={i} delay={i * 90} />
        ))}
      </div>

      {/* Keyframes */}
      <style jsx>{`
        :global(.sverka-shimmer) {
          background: linear-gradient(
            90deg,
            rgba(241, 245, 249, 0.6) 0%,
            rgba(226, 232, 240, 0.95) 50%,
            rgba(241, 245, 249, 0.6) 100%
          );
          background-size: 200% 100%;
          animation: sverka-shimmer 1.6s ease-in-out infinite;
        }
        @keyframes sverka-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        :global(.sverka-progress) {
          animation: sverka-progress 1.8s cubic-bezier(0.65, 0, 0.35, 1) infinite;
        }
        @keyframes sverka-progress {
          0%   { transform: translateX(-100%); width: 30%; }
          50%  { transform: translateX(120%); width: 50%; }
          100% { transform: translateX(340%); width: 30%; }
        }
        :global(.sverka-dot) {
          animation: sverka-dot 1s ease-in-out infinite;
        }
        @keyframes sverka-dot {
          0%, 100% { opacity: 0.3; transform: scale(0.9); }
          50%      { opacity: 1;   transform: scale(1.3); }
        }
        :global(.sverka-row-in) {
          animation: sverka-row-in 0.4s ease-out both;
        }
        @keyframes sverka-row-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function SverkaSkeletonRow({ delay }: { delay: number }) {
  return (
    <div className="sverka-row-in flex items-center gap-3 px-4 py-3.5" style={{ animationDelay: `${delay}ms` }}>
      {/* Bank ikoni placeholder */}
      <div className="w-9 h-9 rounded-lg sverka-shimmer shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 rounded sverka-shimmer" style={{ width: `${55 + (delay % 30)}%` }} />
        <div className="h-2.5 rounded sverka-shimmer" style={{ width: `${30 + (delay % 20)}%` }} />
      </div>
      {/* Status badge placeholder */}
      <div className="h-6 w-20 rounded-full sverka-shimmer shrink-0" />
      {/* Refresh btn placeholder */}
      <div className="h-9 w-9 rounded-lg sverka-shimmer shrink-0" />
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

  // Bank rangini va ikonkasini status'ga qarab tanlash
  const bankAccent = {
    ok:       'from-emerald-500 to-teal-600',
    mismatch: 'from-amber-500 to-orange-600',
    error:    'from-rose-500 to-pink-600',
  }[item.status] || 'from-slate-400 to-slate-600';

  const borderAccent = {
    ok:       'border-l-4 border-l-emerald-400/0 group-hover:border-l-emerald-400',
    mismatch: 'border-l-4 border-l-amber-400',
    error:    'border-l-4 border-l-rose-400',
  }[item.status] || '';

  // Owner ismidan birinchi 2 ta harf — avatar uchun
  const ownerInitials = (item.ownerName || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-all duration-200',
        'hover:bg-gradient-to-r hover:shadow-sm',
        item.status === 'mismatch' && 'bg-amber-50/30 hover:from-amber-50 hover:to-orange-50/40',
        item.status === 'error' && 'bg-rose-50/30 hover:from-rose-50 hover:to-pink-50/40',
        item.status === 'ok' && 'hover:from-slate-50 hover:to-emerald-50/30',
        borderAccent,
        // Loading paytida — yumshoq pulse + dim
        loading && 'animate-pulse bg-gradient-to-r from-violet-50/40 via-fuchsia-50/30 to-violet-50/40',
      )}
      onClick={onClick}
    >
      {/* Loading paytida — yuqori chiziq (progress indicator) */}
      {loading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-500 animate-pulse" />
        </div>
      )}
      {/* Bank logo — haqiqiy logo (Kapital/Ipak rasmi yoki abbreviation gradient) */}
      <div className="relative shrink-0 transition-transform group-hover:scale-105">
        <BankLogo
          code={item.bankCode || ''}
          name={item.bankName || ''}
          size={40}
          rounded="rounded-xl"
        />
        {/* Pulse animation for mismatch/error — kichkina dot, logo ustida emas, yuqori chap chetda */}
        {(item.status === 'mismatch' || item.status === 'error') && (
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center">
            <span className={cn(
              'absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping',
              item.status === 'mismatch' ? 'bg-amber-400' : 'bg-rose-400',
            )} />
            <span className={cn(
              'relative inline-flex rounded-full h-3 w-3 ring-2 ring-white',
              item.status === 'mismatch' ? 'bg-amber-500' : 'bg-rose-500',
            )} />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-bold text-slate-900 truncate">
            {item.bankName || '—'}
          </span>
          <span className="text-slate-300 text-[11px]">·</span>
          <code className="text-[11px] font-mono text-slate-600 bg-slate-100/60 px-1.5 py-0.5 rounded">
            {item.accountNo}
          </code>
        </div>
        <div className="text-[11px] text-slate-500 truncate flex items-center gap-1.5">
          {/* Owner avatar */}
          <span className={cn(
            'inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold text-white bg-gradient-to-br shrink-0',
            bankAccent,
          )}>
            {ownerInitials}
          </span>
          <span className="truncate">{item.ownerName || "— egasi ko'rsatilmagan"}</span>
        </div>
        {item.status === 'mismatch' && item.diff && (
          <div className="mt-1.5 flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded ring-1 ring-emerald-200">
              <TrendingUp className="h-2.5 w-2.5" />
              Kirim: <span className="font-bold tabular-nums">{m(item.diff.credit)}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded ring-1 ring-rose-200">
              <TrendingUp className="h-2.5 w-2.5 rotate-180" />
              Chiqim: <span className="font-bold tabular-nums">{m(item.diff.debit)}</span>
            </span>
            {item.partial && (
              <span className="text-amber-600 text-[10px]">⚠ {item.failedDays} kun ma'lumotsiz</span>
            )}
          </div>
        )}
        {item.status === 'error' && (
          <div className="mt-1 text-[11px] text-rose-700 truncate flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {item.error}
          </div>
        )}
      </div>

      <StatusBadge item={item} totalDiff={totalDiff} />

      <button
        disabled={loading}
        onClick={(e) => { e.stopPropagation(); onRefresh(); }}
        title="Manual yangilash"
        className={cn(
          'inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0 transition-all',
          loading
            ? 'bg-violet-100 ring-1 ring-violet-300 shadow-md shadow-violet-200'
            : 'bg-white ring-1 ring-slate-200 hover:ring-violet-300 hover:bg-violet-50 hover:scale-105',
          'disabled:scale-100',
        )}
      >
        {loading ? (
          <RefreshCw className="h-3.5 w-3.5 text-violet-600 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 text-slate-500 group-hover:text-violet-600" />
        )}
      </button>

      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-violet-500 group-hover:translate-x-1 shrink-0 transition-all" />
    </div>
  );
}

function StatusBadge({ item, totalDiff }: { item: TodayItem; totalDiff: number }) {
  if (item.status === 'error') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-gradient-to-r from-rose-50 to-pink-50 ring-1 ring-rose-300 px-3 py-1.5 rounded-full shrink-0 shadow-sm shadow-rose-200">
        <X className="h-3 w-3" /> Xato
      </span>
    );
  }
  if (item.status === 'mismatch') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-gradient-to-r from-amber-50 to-orange-50 ring-1 ring-amber-300 px-3 py-1.5 rounded-full shrink-0 tabular-nums shadow-sm shadow-amber-200">
        <AlertTriangle className="h-3 w-3" />
        Farq {formatMoney(totalDiff).replace(' UZS', '')}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-gradient-to-r from-emerald-50 to-teal-50 ring-1 ring-emerald-300 px-3 py-1.5 rounded-full shrink-0 shadow-sm shadow-emerald-200">
      <CheckCircle2 className="h-3 w-3" /> Mos
    </span>
  );
}

// ════════════════════════════════════════════════════
//  SVERKA KPI KARTASI — zamonaviy gradient karta
// ════════════════════════════════════════════════════
function SverkaKpi({
  label, value, color, icon, loading, extra,
}: {
  label: string;
  value: number;
  color: 'violet' | 'emerald' | 'amber' | 'rose' | 'slate';
  icon: React.ReactNode;
  loading?: boolean;
  extra?: string;
}) {
  const m = {
    violet:  { bg: 'from-violet-500/15 to-purple-500/10',   ring: 'ring-violet-300/60',  text: 'text-violet-700',  accent: 'from-violet-500 to-purple-600', glow: 'shadow-violet-500/20' },
    emerald: { bg: 'from-emerald-500/15 to-teal-500/10',    ring: 'ring-emerald-300/60', text: 'text-emerald-700', accent: 'from-emerald-500 to-teal-600', glow: 'shadow-emerald-500/20' },
    amber:   { bg: 'from-amber-500/15 to-orange-500/10',    ring: 'ring-amber-300/60',   text: 'text-amber-700',   accent: 'from-amber-500 to-orange-600', glow: 'shadow-amber-500/20' },
    rose:    { bg: 'from-rose-500/15 to-pink-500/10',       ring: 'ring-rose-300/60',    text: 'text-rose-700',    accent: 'from-rose-500 to-pink-600', glow: 'shadow-rose-500/20' },
    slate:   { bg: 'from-slate-200/40 to-slate-300/20',     ring: 'ring-slate-200',      text: 'text-slate-500',   accent: 'from-slate-400 to-slate-500', glow: 'shadow-slate-300/20' },
  }[color];
  const isZero = value === 0;
  return (
    <div className={cn(
      'group relative overflow-hidden rounded-2xl ring-1 bg-gradient-to-br p-3.5 shadow-md transition-all hover:scale-[1.02] hover:shadow-lg',
      m.bg, m.ring, m.glow,
      isZero && color !== 'emerald' && 'opacity-70',
    )}>
      {/* Dekorativ glow effekt — fon dairasi */}
      <div className={cn(
        'absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-20 blur-2xl bg-gradient-to-br transition-opacity group-hover:opacity-40',
        m.accent,
      )} />

      <div className="relative flex items-start justify-between mb-2">
        <div>
          <div className="text-[9.5px] uppercase tracking-[0.15em] font-bold text-slate-600">{label}</div>
          {extra && <div className={cn('text-[10.5px] font-bold mt-0.5', m.text)}>{extra}</div>}
        </div>
        <div className={cn('w-9 h-9 rounded-xl grid place-items-center text-white shadow-lg bg-gradient-to-br', m.accent, m.glow)}>
          {icon}
        </div>
      </div>
      {loading ? (
        <div className="relative h-9 w-20 rounded-md bg-slate-200/60 animate-pulse" />
      ) : (
        <div className={cn('relative text-3xl font-bold tracking-tight tabular-nums leading-none', m.text)}>
          {value.toLocaleString('ru-RU')}
        </div>
      )}
    </div>
  );
}
