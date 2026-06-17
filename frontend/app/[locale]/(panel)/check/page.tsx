'use client';
// build: sverka v2 (live today + per-account drill-down)

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  const tc = useTranslations('common');
  const [q, setQ] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [singleLoading, setSingleLoading] = useState<Set<string>>(new Set());
  const [singleResults, setSingleResults] = useState<Record<string, TodayItem>>({});
  const [showErrors, setShowErrors] = useState(false);

  // Bugungi sverka — live: 20 minutda avto + window focus'da yangilanadi
  // Default: sync'siz (tez). Manual refresh'da syncMismatched=true ishlatamiz.
  const todayQuery = useQuery<TodayResponse>({
    queryKey: ['reconcile-today'],
    queryFn: () => api.get('/transactions/reconcile/today'),
    refetchInterval: AUTO_REFETCH_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 60_000,
    retry: false,
  });

  // Manual refresh — barcha hisoblarni qaytadan tekshirib, FARQLILARNI sync qiladi
  async function refreshAll() {
    toast.message(t('toastRefreshing'));
    try {
      // 2-pass: avval sverka, keyin faqat farqlilar uchun sync+qayta sverka
      const data = await api.get<TodayResponse>('/transactions/reconcile/today?syncMismatched=true', { timeout: 120_000 });
      // Cache'ni qo'lda yangilash (refetch react-query default URL ishlatadi)
      qc.setQueryData(['reconcile-today'], data);
      const m = data.summary.mismatch;
      const ok = data.summary.ok;
      toast.success(t('toastRefreshed', { ok, mismatch: m }));
    } catch (e: any) {
      toast.error(e?.message || tc('error'));
    }
  }
  const qc = useQueryClient();

  // Manual refresh — bitta hisob
  async function refreshOne(accountId: string) {
    const next = new Set(singleLoading);
    next.add(accountId);
    setSingleLoading(next);
    try {
      const today = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const data = await api.post<TodayItem>('/transactions/reconcile', {
        accountId, dateFrom: today, dateTo: today,
        withSync: true,  // Avval sync qilamiz — DB eski bo'lsa farq xato chiqmaydi
      }, { timeout: 60_000 });  // sync uzun bo'lishi mumkin
      setSingleResults((r) => ({ ...r, [accountId]: data }));
    } catch (e: any) {
      setSingleResults((r) => ({
        ...r,
        [accountId]: {
          status: 'error', accountId, accountNo: '', ownerName: null, bankName: null,
          error: e?.message || tc('error'),
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

      <div className="flex-1 px-4 py-5 lg:px-6 lg:py-6 space-y-4 w-full">
        {/* ═══ HEADER: ICON + TITLE ═══ */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 grid place-items-center text-white shadow-lg shadow-violet-500/30">
              <Scale className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <div>
              <h1 className="text-[20px] font-bold tracking-tight">{t('title')}</h1>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Wifi className="h-3 w-3 text-emerald-500" />
                {t('autoRefresh')} {isRefreshing && `· ${t('refreshingNow')}`}
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
              <><Loader2 className="h-4 w-4 animate-spin" /> {t('refreshing')}</>
            ) : (
              <><RefreshCw className="h-4 w-4" /> {t('refreshAll')}</>
            )}
          </Button>
        </div>

        {/* ═══ KPI KARTALAR ═══ */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SverkaKpi
            label={t('kpiTotal')}
            value={summary.total}
            color="violet"
            icon={<Building2 className="h-4 w-4" />}
            loading={isLoading}
          />
          <SverkaKpi
            label={t('kpiOk')}
            value={summary.ok}
            color="emerald"
            icon={<CheckCircle2 className="h-4 w-4" />}
            loading={isLoading}
            extra={summary.total > 0 ? `${Math.round((summary.ok / summary.total) * 100)}%` : undefined}
          />
          <SverkaKpi
            label={t('kpiMismatch')}
            value={summary.mismatch}
            color={summary.mismatch > 0 ? 'amber' : 'slate'}
            icon={<AlertTriangle className="h-4 w-4" />}
            loading={isLoading}
          />
          <SverkaKpi
            label={t('kpiError')}
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
              <Input
                className="pl-9 h-11 rounded-xl bg-slate-50/60 dark:bg-slate-900"
                placeholder={t('searchPlaceholder')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
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
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300 text-[12px] font-semibold">
                  <X className="h-3.5 w-3.5" />
                  {t('requestError')}
                </div>
                <div className="text-[12px] text-slate-600 dark:text-slate-300 max-w-md mx-auto">
                  {(todayQuery.error as any)?.message || t('unknownError')}
                </div>
                <Button variant="outline" size="sm" onClick={refreshAll} className="mt-2 rounded-lg">
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> {tc('retry')}
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Scale}
                title={q ? t('emptySearchTitle') : t('emptyTitle')}
                description={q ? undefined : t('emptyDesc')}
              />
            ) : (
              <>
                {/* Asosiy ro'yxat — xato bo'lmaganlar (Mos + Farqli) */}
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
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
                  <div className="border-t-2 border-rose-100 dark:border-rose-900">
                    <button
                      onClick={() => setShowErrors((s) => !s)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-50/70 dark:hover:bg-rose-950/30 transition group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 grid place-items-center text-rose-700 dark:text-rose-300 shrink-0">
                        <X className="h-4 w-4" />
                      </div>
                      <div className="text-left min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-rose-900 dark:text-rose-300">
                          {t('errorAccounts', { n: errorRows.length })}
                        </div>
                        <div className="text-[11px] text-rose-700/80 dark:text-rose-400/80 truncate">
                          {showErrors
                            ? t('clickToHide')
                            : t('clickToShowErrors')}
                        </div>
                      </div>
                      <ChevronRight className={cn(
                        "h-5 w-5 text-rose-400 dark:text-rose-500 transition-transform",
                        showErrors && "rotate-90",
                      )} />
                    </button>

                    {showErrors && (
                      <div className="divide-y divide-rose-100/50 dark:divide-rose-900/50">
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
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50/60 via-violet-50/40 to-blue-50/60 dark:from-indigo-950/30 dark:via-violet-950/20 dark:to-blue-950/30">
        <div className="flex items-center gap-3">
          {/* Pulsing dot bilan icon */}
          <div className="relative w-9 h-9 grid place-items-center shrink-0">
            <span className="absolute inset-0 rounded-xl bg-indigo-500/30 animate-ping" style={{ animationDuration: '1.5s' }} />
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center shadow-md shadow-indigo-500/40">
              <Scale className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              {title}
              {/* Inline dots */}
              <span className="flex items-center gap-0.5">
                <span className="w-1 h-1 rounded-full bg-indigo-500 sverka-dot" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-violet-500 sverka-dot" style={{ animationDelay: '180ms' }} />
                <span className="w-1 h-1 rounded-full bg-blue-500 sverka-dot" style={{ animationDelay: '360ms' }} />
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">{subtitle}</div>
          </div>
        </div>
        {/* Animatsion progress bar */}
        <div className="mt-3 h-0.5 bg-white/60 rounded-full overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500 rounded-full sverka-progress" />
        </div>
      </div>

      {/* Skeleton account rows — shimmer effect bilan */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
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
  const t = useTranslations('check');
  const m = (n: number) => formatMoney(Number(n || 0)).replace(' UZS', '');
  const totalDiff = Math.abs((item.diff?.credit || 0)) + Math.abs((item.diff?.debit || 0));

  const borderAccent = {
    ok:       'border-l-4 border-l-emerald-400/0 group-hover:border-l-emerald-400',
    mismatch: 'border-l-4 border-l-amber-400',
    error:    'border-l-4 border-l-rose-400',
  }[item.status] || '';

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-all duration-200',
        'hover:bg-gradient-to-r hover:shadow-sm',
        item.status === 'mismatch' && 'bg-amber-50/30 dark:bg-amber-950/20 hover:from-amber-50 hover:to-orange-50/40 dark:hover:from-amber-950/40 dark:hover:to-orange-950/30',
        item.status === 'error' && 'bg-rose-50/30 dark:bg-rose-950/20 hover:from-rose-50 hover:to-pink-50/40 dark:hover:from-rose-950/40 dark:hover:to-pink-950/30',
        item.status === 'ok' && 'hover:from-slate-50 hover:to-emerald-50/30 dark:hover:from-slate-800 dark:hover:to-emerald-950/30',
        borderAccent,
        // Loading paytida — yumshoq pulse + dim
        loading && 'animate-pulse bg-gradient-to-r from-violet-50/40 via-fuchsia-50/30 to-violet-50/40 dark:from-violet-950/30 dark:via-fuchsia-950/20 dark:to-violet-950/30',
      )}
      onClick={onClick}
    >
      {/* Loading paytida — yuqori chiziq (progress indicator) */}
      {loading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-500 animate-pulse" />
        </div>
      )}
      {/* Bank logo — toza ko'rinish, qo'shimcha doiralar yo'q */}
      <div className="shrink-0 transition-transform group-hover:scale-105">
        <BankLogo
          code={item.bankCode || ''}
          name={item.bankName || ''}
          size={40}
          rounded="rounded-xl"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-bold text-slate-900 dark:text-slate-100 truncate">
            {item.bankName || '—'}
          </span>
          <span className="text-slate-300 dark:text-slate-600 text-[11px]">·</span>
          <code className="text-[11px] font-mono text-slate-600 dark:text-slate-300 bg-slate-100/60 dark:bg-slate-800/60 px-1.5 py-0.5 rounded">
            {item.accountNo}
          </code>
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
          {item.ownerName || t('noOwner')}
        </div>
        {item.status === 'mismatch' && item.diff && (
          <div className="mt-1.5 flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded ring-1 ring-emerald-200 dark:ring-emerald-900">
              <TrendingUp className="h-2.5 w-2.5" />
              {t('inflowLabel')} <span className="font-bold tabular-nums">{m(item.diff.credit)}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded ring-1 ring-rose-200 dark:ring-rose-900">
              <TrendingUp className="h-2.5 w-2.5 rotate-180" />
              {t('outflowLabel')} <span className="font-bold tabular-nums">{m(item.diff.debit)}</span>
            </span>
            {item.partial && (
              <span className="text-amber-600 dark:text-amber-400 text-[10px]">⚠ {t('daysNoData', { n: item.failedDays ?? 0 })}</span>
            )}
          </div>
        )}
        {item.status === 'error' && (
          <div className="mt-1 text-[11px] text-rose-700 dark:text-rose-300 truncate flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {item.error}
          </div>
        )}
      </div>

      <StatusBadge item={item} totalDiff={totalDiff} />

      <button
        disabled={loading}
        onClick={(e) => { e.stopPropagation(); onRefresh(); }}
        title={t('manualRefresh')}
        className={cn(
          'inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0 transition-all',
          loading
            ? 'bg-violet-100 dark:bg-violet-900/30 ring-1 ring-violet-300 dark:ring-violet-900 shadow-md shadow-violet-200 dark:shadow-violet-950'
            : 'bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-violet-300 dark:hover:ring-violet-900 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:scale-105',
          'disabled:scale-100',
        )}
      >
        {loading ? (
          <RefreshCw className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 group-hover:text-violet-600 dark:group-hover:text-violet-400" />
        )}
      </button>

      <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-500 group-hover:text-violet-500 dark:group-hover:text-violet-400 group-hover:translate-x-1 shrink-0 transition-all" />
    </div>
  );
}

function StatusBadge({ item, totalDiff }: { item: TodayItem; totalDiff: number }) {
  const t = useTranslations('check');
  if (item.status === 'error') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-bold text-rose-700 dark:text-rose-300 bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-950/40 dark:to-pink-950/40 ring-1 ring-rose-300 dark:ring-rose-900 px-3 py-1.5 rounded-full shrink-0 shadow-sm shadow-rose-200 dark:shadow-rose-950">
        <X className="h-3 w-3" /> {t('statusError')}
      </span>
    );
  }
  if (item.status === 'mismatch') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-bold text-amber-800 dark:text-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 ring-1 ring-amber-300 dark:ring-amber-900 px-3 py-1.5 rounded-full shrink-0 tabular-nums shadow-sm shadow-amber-200 dark:shadow-amber-950">
        <AlertTriangle className="h-3 w-3" />
        {t('diff')} {formatMoney(totalDiff).replace(' UZS', '')}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 ring-1 ring-emerald-300 dark:ring-emerald-900 px-3 py-1.5 rounded-full shrink-0 shadow-sm shadow-emerald-200 dark:shadow-emerald-950">
      <CheckCircle2 className="h-3 w-3" /> {t('statusOk')}
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
    violet:  { bg: 'from-violet-500/15 to-purple-500/10',   ring: 'ring-violet-300/60 dark:ring-violet-900',  text: 'text-violet-700 dark:text-violet-300',  accent: 'from-violet-500 to-purple-600', glow: 'shadow-violet-500/20' },
    emerald: { bg: 'from-emerald-500/15 to-teal-500/10',    ring: 'ring-emerald-300/60 dark:ring-emerald-900', text: 'text-emerald-700 dark:text-emerald-300', accent: 'from-emerald-500 to-teal-600', glow: 'shadow-emerald-500/20' },
    amber:   { bg: 'from-amber-500/15 to-orange-500/10',    ring: 'ring-amber-300/60 dark:ring-amber-900',   text: 'text-amber-700 dark:text-amber-300',   accent: 'from-amber-500 to-orange-600', glow: 'shadow-amber-500/20' },
    rose:    { bg: 'from-rose-500/15 to-pink-500/10',       ring: 'ring-rose-300/60 dark:ring-rose-900',    text: 'text-rose-700 dark:text-rose-300',    accent: 'from-rose-500 to-pink-600', glow: 'shadow-rose-500/20' },
    slate:   { bg: 'from-slate-200/40 to-slate-300/20 dark:from-slate-800/40 dark:to-slate-700/20',     ring: 'ring-slate-200 dark:ring-slate-700',      text: 'text-slate-500 dark:text-slate-400',   accent: 'from-slate-400 to-slate-500', glow: 'shadow-slate-300/20' },
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
          <div className="text-[9.5px] uppercase tracking-[0.15em] font-bold text-slate-600 dark:text-slate-300">{label}</div>
          {extra && <div className={cn('text-[10.5px] font-bold mt-0.5', m.text)}>{extra}</div>}
        </div>
        <div className={cn('w-9 h-9 rounded-xl grid place-items-center text-white shadow-lg bg-gradient-to-br', m.accent, m.glow)}>
          {icon}
        </div>
      </div>
      {loading ? (
        <div className="relative h-9 w-20 rounded-md bg-slate-200/60 dark:bg-slate-700/60 animate-pulse" />
      ) : (
        <div className={cn('relative text-3xl font-bold tracking-tight tabular-nums leading-none', m.text)}>
          {value.toLocaleString('ru-RU')}
        </div>
      )}
    </div>
  );
}
