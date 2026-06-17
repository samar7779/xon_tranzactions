'use client';
// rebuild trigger — biling v2 (obyekt + collapsible + skip 100%)

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CreditCard, RefreshCw, Search, CheckCircle2, AlertCircle, XCircle, Loader2,
  TrendingUp, Hash, Calendar, ExternalLink, Play, X, History, Zap,
  Receipt, Activity, ChevronLeft, ChevronRight, Eye, Copy, FileSearch,
  ChevronDown, ChevronUp, Home, ScanLine, Trash2, ArrowUpRight, ArrowDownLeft,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// ru-RU stilida formatlash: bo'shliq + vergul (8 138 427 075,01)
const NF = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const NF2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: string | number | bigint | null | undefined) => {
  if (n == null) return '0';
  return NF.format(Number(n));
};
const fmt2 = (n: string | number | bigint | null | undefined) => {
  if (n == null) return '0,00';
  return NF2.format(Number(n));
};

interface SyncStatus {
  running: boolean;
  cancelRequested: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  progress: { page: number; lastPage: number; fetched: number; xonpay: number; inserted: number; updated: number; matched: number; errors: number } | null;
  lastError: string | null;
}
interface DailyStats {
  ok: true;
  summary: { totalCount: number; totalAmount: string; matchedCount: number; matchedAmount: string; missingCount: number; missingAmount: string };
  days: Array<{ date: string; totalCount: number; totalAmount: string; matchedCount: number; matchedAmount: string; missingCount: number; missingAmount: string }>;
}
interface XonpayRow {
  externalId: string;
  xonpayUuid: string | null;
  contract: string | null;
  amount: string;
  datePaid: string | null;
  type: string | null;
  category: string | null;
  status: string | null;
  fullName: string | null;
  objectName: string | null;
  isMatched: boolean;
  matchedTxId: string | null;
  matchedExternalId: string | null;
  matchedAmount: string | null;
  matchedDate: string | null;
  matchedAt: string | null;
  lastCheckedAt: string | null;
  purpose: string | null;
  syncedAt: string;
  matchedTx: { id: string; externalId: string | null; txnDate: string; amount: string; description: string | null; } | null;
}

export default function BilingPage() {
  const qc = useQueryClient();
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const { locale } = useParams<{ locale: string }>();
  const today = new Date().toISOString().slice(0, 10);
  // Default: boshidan bugungacha — barchasini ko'rsatish
  const defaultFrom = '2024-01-01';

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today);

  // Collapsible holatlar (default yopiq — bosgnda ochiladi)
  const [historyOpen, setHistoryOpen] = useState(false);
  // Sync tarixi filterlari
  const [histQ, setHistQ] = useState('');
  const [histQDeb, setHistQDeb] = useState('');
  const [histStatus, setHistStatus] = useState<'all' | 'running' | 'success' | 'failed' | 'cancelled'>('all');
  const [histDateFrom, setHistDateFrom] = useState('');
  const [histDateTo, setHistDateTo] = useState('');

  useEffect(() => { const t = setTimeout(() => setHistQDeb(histQ.trim()), 300); return () => clearTimeout(t); }, [histQ]);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  // Foydalanuvchi qo'lda yopgan paytda — qaytadan ochmaslik uchun
  const [progressModalDismissed, setProgressModalDismissed] = useState(false);
  // Orphan tozalash modali
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [matched, setMatched] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [rechecking, setRechecking] = useState<Set<string>>(new Set());
  const [detailRow, setDetailRow] = useState<XonpayRow | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  // ── Queries ──
  const syncStatusQuery = useQuery<SyncStatus>({
    queryKey: ['xonpay-sync-status'],
    queryFn: () => api.get('/xonpay/sync/status'),
    refetchInterval: (data: any) => (data?.state?.data?.running ? 3000 : 30000),
  });
  const syncRunning = !!syncStatusQuery.data?.running;

  const matchStatusQuery = useQuery<{ running: boolean; progress: { done: number; total: number; matched: number } | null }>({
    queryKey: ['xonpay-match-status'],
    queryFn: () => api.get('/xonpay/match/status'),
    refetchInterval: (data: any) => (data?.state?.data?.running ? 3000 : 30000),
  });
  const matchRunning = !!matchStatusQuery.data?.running;

  const cronInfoQuery = useQuery<{ enabled: boolean; intervalMinutes?: number; cronExpr?: string; schedule: string; lastRunAt: string | null; lastFinishedAt: string | null; lastSkipReason: string | null; lastResult: any }>({
    queryKey: ['xonpay-cron-info'],
    queryFn: () => api.get('/xonpay/cron/info'),
    refetchInterval: 60000,
  });

  const setCronIntervalMut = useMutation({
    mutationFn: (minutes: number) => api.post<any>(`/xonpay/cron/interval?minutes=${minutes}`, {}),
    onSuccess: (r: any) => {
      toast.success(t('intervalSet', { n: r.intervalMinutes }));
      qc.invalidateQueries({ queryKey: ['xonpay-cron-info'] });
    },
    onError: (e: any) => toast.error(e?.message || t('intervalSetError')),
  });

  const historyQuery = useQuery<{ ok: true; items: any[] }>({
    queryKey: ['xonpay-history', histQDeb, histStatus, histDateFrom, histDateTo],
    queryFn: () => {
      const p = new URLSearchParams({ limit: '50' });
      if (histQDeb) p.set('q', histQDeb);
      if (histStatus !== 'all') p.set('status', histStatus);
      if (histDateFrom) p.set('dateFrom', histDateFrom);
      if (histDateTo) p.set('dateTo', histDateTo);
      return api.get(`/xonpay/sync/history?${p.toString()}`);
    },
    refetchInterval: 30000,
  });

  const statsQuery = useQuery<DailyStats>({
    queryKey: ['xonpay-stats', dateFrom, dateTo],
    queryFn: () => api.get(`/xonpay/stats/daily?dateFrom=${dateFrom}&dateTo=${dateTo}`),
  });

  const params = new URLSearchParams({ page: String(page), perPage: String(perPage), dateFrom, dateTo, matched });
  if (debouncedQ) params.set('q', debouncedQ);
  const listQuery = useQuery<{ ok: true; total: number; items: XonpayRow[] }>({
    queryKey: ['xonpay-list', page, perPage, dateFrom, dateTo, matched, debouncedQ],
    queryFn: () => api.get(`/xonpay?${params.toString()}`),
  });

  // ── Mutations ──
  const startSyncMut = useMutation({
    mutationFn: () => api.post<{ ok: true; started: boolean; message: string }>('/xonpay/sync', {}),
    onSuccess: (r) => { toast.message(r.message); qc.invalidateQueries({ queryKey: ['xonpay-sync-status'] }); },
    onError: (e: any) => toast.error(e?.message || t('syncNotStarted')),
  });
  const cancelSyncMut = useMutation({
    mutationFn: () => api.post('/xonpay/sync/cancel', {}),
    onSuccess: () => { toast.message(t('syncCancelRequested')); qc.invalidateQueries({ queryKey: ['xonpay-sync-status'] }); },
  });
  const cronToggleMut = useMutation({
    mutationFn: (enabled: boolean) => api.post<any>(`/xonpay/cron/toggle?enabled=${enabled}`, {}),
    onSuccess: (r) => {
      toast.success(r.enabled ? t('autoSyncOn') : t('autoSyncOff'));
      qc.invalidateQueries({ queryKey: ['xonpay-cron-info'] });
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  const cancelByIdMut = useMutation({
    mutationFn: (logId: string) => api.post<{ ok: true; cancelled: boolean; message: string }>(`/xonpay/sync/history/${logId}/cancel`, {}),
    onSuccess: (r) => {
      toast[r.cancelled ? 'success' : 'message'](r.message);
      qc.invalidateQueries({ queryKey: ['xonpay-history'] });
      qc.invalidateQueries({ queryKey: ['xonpay-sync-status'] });
    },
    onError: (e: any) => toast.error(e?.message || t('cancelError')),
  });
  const matchAllMut = useMutation({
    mutationFn: () => api.post<{ ok: true; message: string }>('/xonpay/match-all?onlyUnmatched=true', {}),
    onSuccess: (r) => {
      toast.message(r.message);
      qc.invalidateQueries({ queryKey: ['xonpay-match-status'] });
      // Modul'ni darrov ochamiz
      setProgressModalOpen(true);
      setProgressModalDismissed(false);
    },
    onError: (e: any) => toast.error(e?.message || t('matchNotStarted')),
  });

  async function recheckOne(externalId: string) {
    setRechecking((s) => new Set(s).add(externalId));
    try {
      const r = await api.post<{ ok: true; matched: boolean }>(`/xonpay/${encodeURIComponent(externalId)}/recheck`, {});
      toast.success(r.matched ? t('found') : t('stillNotFound'));
      qc.invalidateQueries({ queryKey: ['xonpay-list'] });
      qc.invalidateQueries({ queryKey: ['xonpay-stats'] });
    } catch (e: any) {
      toast.error(e?.message || tc('error'));
    } finally {
      setRechecking((s) => { const n = new Set(s); n.delete(externalId); return n; });
    }
  }

  // Sync/match ishlay boshlasa — modul'ni avtomatik ochamiz (foydalanuvchi yopmagan bo'lsa)
  useEffect(() => {
    if ((syncRunning || matchRunning) && !progressModalDismissed) {
      setProgressModalOpen(true);
    }
    // Tugagach modul yopilmaydi (foydalanuvchi xohlaganda yopadi)
  }, [syncRunning, matchRunning, progressModalDismissed]);

  // Sync/match tugagach dismissed flag ni reset qilamiz (keyingi sync uchun)
  useEffect(() => {
    if (!syncRunning && !matchRunning && syncStatusQuery.data?.finishedAt) {
      qc.invalidateQueries({ queryKey: ['xonpay-list'] });
      qc.invalidateQueries({ queryKey: ['xonpay-stats'] });
      qc.invalidateQueries({ queryKey: ['xonpay-history'] });
      setProgressModalDismissed(false);
    }
  }, [syncRunning, matchRunning, syncStatusQuery.data?.finishedAt, qc]);

  const summary = statsQuery.data?.summary;
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / perPage)) : 1;

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-5 max-w-[1700px] mx-auto w-full">
        {/* ═══ HEADER (chiroyli KPI kartalar) ═══ */}
        <div className="flex items-center gap-3 mb-1">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 grid place-items-center text-white shadow-lg shadow-violet-500/20">
            <Receipt className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCardModern
            label={t('totalXonpay')}
            count={summary?.totalCount || 0}
            amount={summary?.totalAmount || '0'}
            color="violet"
            icon={<Receipt className="h-4 w-4" />}
            loading={statsQuery.isLoading}
            countLabel={t('paymentsCount', { n: fmt(summary?.totalCount || 0) })}
          />
          <KpiCardModern
            label={t('matchedToCapital')}
            count={summary?.matchedCount || 0}
            amount={summary?.matchedAmount || '0'}
            color="emerald"
            icon={<CheckCircle2 className="h-4 w-4" />}
            loading={statsQuery.isLoading}
            countLabel={t('paymentsCount', { n: fmt(summary?.matchedCount || 0) })}
            extra={summary && Number(summary.totalCount) > 0
              ? t('pctMatched', { n: Math.round((Number(summary.matchedCount) / Number(summary.totalCount)) * 100) })
              : undefined}
          />
          <KpiCardModern
            label={t('missingRemaining')}
            count={summary?.missingCount || 0}
            amount={summary?.missingAmount || '0'}
            color="rose"
            icon={<AlertCircle className="h-4 w-4" />}
            loading={statsQuery.isLoading}
            countLabel={t('paymentsCount', { n: fmt(summary?.missingCount || 0) })}
          />
        </div>

        {/* Compact inline indicator — modul yopilgan paytda ham progress ko'rinsin */}
        {(syncRunning || matchRunning) && !progressModalOpen && (
          <button onClick={() => { setProgressModalOpen(true); setProgressModalDismissed(false); }}
            title={t('showSyncProgress')}
            className="w-full rounded-lg ring-1 ring-violet-200 dark:ring-violet-900 bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors px-4 py-2.5 text-[12px] flex items-center gap-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600 dark:text-violet-400 shrink-0" />
            <span className="font-semibold text-violet-900 dark:text-violet-300">
              {syncRunning ? t('syncRunning') : t('matchRunning')} —
            </span>
            <span className="text-violet-700 dark:text-violet-300">
              {syncRunning && syncStatusQuery.data?.progress
                ? t('syncProgressLine', { page: syncStatusQuery.data.progress.page, inserted: syncStatusQuery.data.progress.inserted, matched: syncStatusQuery.data.progress.matched })
                : matchRunning && matchStatusQuery.data?.progress
                  ? `${matchStatusQuery.data.progress.done}/${matchStatusQuery.data.progress.total}`
                  : ''}
            </span>
            <span className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-md bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 ring-1 ring-violet-200 dark:ring-violet-900">
              <Eye className="h-3.5 w-3.5" />
            </span>
          </button>
        )}

        {/* ═══ SYNC TARIXI (header'da: cron info + sync + match + tozalash icon tugmalari) ═══ */}
        <Card>
          <CardContent className="p-0">
            <div className="w-full px-4 py-3 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-800">
              <button onClick={() => setHistoryOpen(o => !o)} className="flex items-center gap-2 flex-1 text-left">
                <History className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                <h3 className="text-[13px] font-bold">{t('syncHistory')} <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">{t('manualAndCron')}</span></h3>
                {historyQuery.data?.items?.length != null && (
                  <span className="text-[10.5px] text-slate-500 dark:text-slate-400">{t('countItems', { n: historyQuery.data.items.length })}</span>
                )}
              </button>

              {/* CRM dan sync — icon tugma */}
              {syncRunning ? (
                <button
                  onClick={() => cancelSyncMut.mutate()}
                  disabled={cancelSyncMut.isPending}
                  title={t('stopSync')}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900 hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-all"
                >
                  {cancelSyncMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                </button>
              ) : (
                <button
                  onClick={() => startSyncMut.mutate()}
                  disabled={startSyncMut.isPending}
                  title={t('syncFromCrm')}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-violet-600 text-white hover:bg-violet-700 shadow-sm hover:shadow-md hover:shadow-violet-500/30 transition-all"
                >
                  {startSyncMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </button>
              )}

              {/* Qolganlarni tekshirish — icon */}
              <button
                onClick={() => matchAllMut.mutate()}
                disabled={matchAllMut.isPending || matchRunning}
                title={t('checkRemaining')}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-200 dark:ring-blue-900 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-all disabled:opacity-50"
              >
                {(matchAllMut.isPending || matchRunning) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </button>

              {/* Tozalash (orphan'lar) — icon */}
              <button
                onClick={() => setCleanupModalOpen(true)}
                title={t('cleanupOrphans')}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 ring-1 ring-orange-200 dark:ring-orange-900 hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-all"
              >
                <Trash2 className="h-4 w-4" />
              </button>

              {/* Cron info — icon + popover */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title={t('cronAbout')}
                    className={cn(
                      'inline-flex items-center justify-center w-8 h-8 rounded-md transition-all ring-1',
                      cronInfoQuery.data?.enabled
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                        : 'bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800',
                    )}
                  >
                    <Zap className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="p-3 w-72">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    <h4 className="text-[12px] font-bold">{t('autoSyncCron')}</h4>
                    <span className={cn(
                      "ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ring-1",
                      cronInfoQuery.data?.enabled
                        ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700",
                    )}>
                      {cronInfoQuery.data?.enabled
                        ? <><CheckCircle2 className="h-2.5 w-2.5" /> {t('enabled')}</>
                        : <><XCircle className="h-2.5 w-2.5" /> {t('disabled')}</>}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5">
                    <div><span className="text-slate-400 dark:text-slate-500">{t('schedule')}</span> <div className="font-mono text-[10.5px] mt-0.5">{cronInfoQuery.data?.schedule || '—'}</div></div>
                    <div>
                      <span className="text-slate-400 dark:text-slate-500">{t('last')}</span>{' '}
                      {cronInfoQuery.data?.lastRunAt
                        ? <span className="font-mono">{new Date(cronInfoQuery.data.lastRunAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour12: false }).slice(0, 19)}</span>
                        : <span className="text-slate-400 dark:text-slate-500">{t('notYet')}</span>}
                    </div>
                    {cronInfoQuery.data?.lastSkipReason && (
                      <div className="text-amber-700 dark:text-amber-300 text-[10.5px] flex items-start gap-1 pt-1 border-t border-slate-100 dark:border-slate-800"><AlertCircle className="h-3 w-3 shrink-0 mt-0.5" /> {cronInfoQuery.data.lastSkipReason}</div>
                    )}
                  </div>

                  {/* Interval o'zgartirish */}
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                    <div className="text-[10.5px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                      {t('intervalMinutes')}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[15, 30, 60, 120, 180, 360].map((m) => {
                        const active = cronInfoQuery.data?.intervalMinutes === m;
                        return (
                          <button
                            key={m}
                            onClick={(e) => { e.stopPropagation(); setCronIntervalMut.mutate(m); }}
                            disabled={setCronIntervalMut.isPending}
                            className={cn(
                              'h-7 text-[11px] font-semibold rounded-md transition',
                              active
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800',
                              setCronIntervalMut.isPending && 'opacity-60 cursor-not-allowed',
                            )}
                          >
                            {m < 60 ? t('minShort', { n: m }) : m === 60 ? t('oneHour') : t('hours', { n: Math.floor(m / 60) })}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Toggle tugma */}
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    {cronInfoQuery.data?.enabled ? (
                      <Button
                        onClick={() => cronToggleMut.mutate(false)}
                        disabled={cronToggleMut.isPending}
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-300"
                      >
                        {cronToggleMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                        {t('disableAutoSync')}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => cronToggleMut.mutate(true)}
                        disabled={cronToggleMut.isPending}
                        size="sm"
                        className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                      >
                        {cronToggleMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {t('enableAutoSync')}
                      </Button>
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <button onClick={() => setHistoryOpen(o => !o)} className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 ml-1">
                {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>
              {historyOpen && (
                <>
              {/* Filter qator */}
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 flex-wrap bg-slate-50/50 dark:bg-slate-900">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 dark:text-slate-500" />
                  <Input
                    value={histQ}
                    onChange={(e) => setHistQ(e.target.value)}
                    placeholder={t('searchNameEmail')}
                    className="pl-7 h-8 w-52 text-[11px]"
                  />
                </div>
                <Select value={histStatus} onValueChange={(v: any) => setHistStatus(v)}>
                  <SelectTrigger className="h-8 w-32 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tc('allStatuses')}</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={histDateFrom} max={histDateTo || today}
                  onChange={(e) => setHistDateFrom(e.target.value)}
                  className="h-8 w-36 text-[11px]" />
                <span className="text-slate-400 dark:text-slate-500 text-[10px]">—</span>
                <Input type="date" value={histDateTo} min={histDateFrom} max={today}
                  onChange={(e) => setHistDateTo(e.target.value)}
                  className="h-8 w-36 text-[11px]" />
                {(histQ || histStatus !== 'all' || histDateFrom || histDateTo) && (
                  <Button variant="ghost" size="sm" onClick={() => { setHistQ(''); setHistStatus('all'); setHistDateFrom(''); setHistDateTo(''); }} className="h-8 text-[11px] text-slate-500 dark:text-slate-400">
                    {tc('clear')}
                  </Button>
                )}
              </div>
              {historyQuery.isLoading ? (
                <div className="p-3 space-y-1"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div>
              ) : !historyQuery.data?.items?.length ? (
                <div className="p-5 text-center text-[11px] text-slate-400 dark:text-slate-500">{t('notSyncedYet')}</div>
              ) : (
                <div className="max-h-[180px] overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-semibold">{tc('time')}</th>
                        <th className="text-left px-3 py-1.5 font-semibold">{t('colTrigger')}</th>
                        <th className="text-left px-3 py-1.5 font-semibold">{tc('who')}</th>
                        <th className="text-center px-2 py-1.5 font-semibold">{tc('status')}</th>
                        <th className="text-right px-2 py-1.5 font-semibold">XonPay</th>
                        <th className="text-right px-2 py-1.5 font-semibold">{t('newCol')}</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Matched</th>
                        <th className="text-right px-2 py-1.5 font-semibold">{tc('time')}</th>
                        <th className="text-center px-2 py-1.5 font-semibold">{tc('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyQuery.data.items.map((h) => {
                        const dur = h.durationMs ? `${(h.durationMs / 1000).toFixed(0)}s` : (h.status === 'running' ? '...' : '—');
                        return (
                          <tr key={h.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800">
                            <td className="px-3 py-1.5 font-mono tabular-nums whitespace-nowrap">
                              {new Date(h.startedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour12: false }).slice(0, 19)}
                            </td>
                            <td className="px-3 py-1.5">
                              <span className={cn(
                                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
                                h.trigger === 'cron' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-900' : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-200 dark:ring-blue-900',
                              )}>
                                {h.trigger === 'cron' ? <><Zap className="h-2.5 w-2.5" /> cron</> : <><Activity className="h-2.5 w-2.5" /> {t('manual')}</>}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 max-w-[180px] truncate" title={`${h.actorName || ''} (${h.actorEmail || ''})`}>
                              {h.actorName || h.actorEmail || (h.trigger === 'cron' ? 'system' : '—')}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <span className={cn(
                                'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
                                h.status === 'success' && 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
                                h.status === 'running' && 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 animate-pulse',
                                h.status === 'failed' && 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
                                h.status === 'cancelled' && 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
                              )}>{h.status}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmt(h.xonpay)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-300">+{fmt(h.inserted)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-blue-700 dark:text-blue-300">{fmt(h.matched)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500 dark:text-slate-400">{dur}</td>
                            <td className="px-2 py-1.5 text-center">
                              {h.status === 'running' && (
                                <button
                                  onClick={() => cancelByIdMut.mutate(h.id)}
                                  disabled={cancelByIdMut.isPending}
                                  title={t('stopThisSync')}
                                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900 transition-all"
                                >
                                  {cancelByIdMut.isPending && cancelByIdMut.variables === h.id
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <X className="h-3 w-3" />}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              </>
              )}
            </CardContent>
          </Card>

        {/* ═══ KUNLIK STATISTIKA (collapsible) ═══ */}
        <Card>
          <CardContent className="p-0">
            <button onClick={() => setDailyOpen(o => !o)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-[13px] font-bold flex items-center gap-2"><TrendingUp className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" /> {t('dailyStats')}</h2>
              <div className="flex items-center gap-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{t('daysCount', { n: statsQuery.data?.days?.length || 0 })}</div>
                {dailyOpen ? <ChevronUp className="h-4 w-4 text-slate-400 dark:text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-400 dark:text-slate-500" />}
              </div>
            </button>
            {dailyOpen && <>
            {statsQuery.isLoading ? (
              <div className="p-3 space-y-1.5">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
            ) : !statsQuery.data?.days?.length ? (
              <div className="p-8 text-center text-sm text-slate-400 dark:text-slate-500">{t('noData')}</div>
            ) : (
              <div className="overflow-x-auto max-h-[400px]">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">{tc('date')}</th>
                      <th className="text-right px-3 py-2 font-semibold">{tc('total')}</th>
                      <th className="text-right px-3 py-2 font-semibold">{t('totalUzs')}</th>
                      <th className="text-right px-3 py-2 font-semibold text-emerald-700 dark:text-emerald-300">{t('received')}</th>
                      <th className="text-right px-3 py-2 font-semibold text-emerald-700 dark:text-emerald-300">{t('receivedUzs')}</th>
                      <th className="text-right px-3 py-2 font-semibold text-rose-700 dark:text-rose-300">{t('remaining')}</th>
                      <th className="text-right px-3 py-2 font-semibold text-rose-700 dark:text-rose-300">{t('remainingUzs')}</th>
                      <th className="text-right px-3 py-2 font-semibold">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsQuery.data.days.map((d) => {
                      const pct = d.totalCount > 0 ? Math.round((d.matchedCount / d.totalCount) * 100) : 0;
                      return (
                        <tr key={d.date} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                          onClick={() => { setDateFrom(d.date); setDateTo(d.date); setPage(1); }}
                          title={t('clickDayHint')}>
                          <td className="px-3 py-1.5 font-mono whitespace-nowrap">{d.date}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{fmt(d.totalCount)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmt(d.totalAmount)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(d.matchedCount)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(d.matchedAmount)}</td>
                          <td className={cn('px-3 py-1.5 text-right tabular-nums', d.missingCount > 0 && 'text-rose-700 dark:text-rose-300 font-semibold')}>{fmt(d.missingCount)}</td>
                          <td className={cn('px-3 py-1.5 text-right tabular-nums', d.missingCount > 0 && 'text-rose-700 dark:text-rose-300 font-semibold')}>{fmt(d.missingAmount)}</td>
                          <td className="px-3 py-1.5 text-right">
                            <span className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ring-1 ring-inset',
                              pct === 100 ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900' :
                              pct >= 80 ? 'bg-lime-50 dark:bg-lime-950/40 text-lime-700 dark:text-lime-300 ring-lime-200 dark:ring-lime-900' :
                              pct >= 50 ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900' :
                              'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
                            )}>{pct}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </>}
          </CardContent>
        </Card>

        {/* ═══ FILTRLAR + RO'YXAT (collapsible) ═══ */}
        <Card>
          <CardContent className="p-0">
            <button onClick={() => setListOpen(o => !o)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-[13px] font-bold flex items-center gap-2">
                <Hash className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                {t('xonpayPaymentsList')}
                {listQuery.data?.total != null && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">({t('countItems', { n: fmt(listQuery.data.total) })})</span>
                )}
              </h2>
              {listOpen ? <ChevronUp className="h-4 w-4 text-slate-400 dark:text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-400 dark:text-slate-500" />}
            </button>
            {listOpen && (<>
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                  <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
                    placeholder={t('searchContractFioUuid')}
                    className="pl-8 h-9 w-72 text-[12px]" />
                </div>
                <Select value={matched} onValueChange={(v: any) => { setMatched(v); setPage(1); }}>
                  <SelectTrigger className="h-9 w-44 text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tc('all')}</SelectItem>
                    <SelectItem value="matched">{t('received')}</SelectItem>
                    <SelectItem value="unmatched">{t('notFound')}</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={dateFrom} max={dateTo} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-9 w-36 text-[12px]" />
                <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>
                <Input type="date" value={dateTo} min={dateFrom} max={today} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-9 w-36 text-[12px]" />
              </div>
            </div>

            {listQuery.isLoading ? (
              <div className="p-3 space-y-1">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : !listQuery.data?.items?.length ? (
              <div className="p-12 text-center text-sm text-slate-400 dark:text-slate-500">
                {t.rich('noDataSyncHint', { b: (c) => <b>{c}</b> })}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="text-left px-3 py-2 font-bold">{tc('date')}</th>
                        <th className="text-left px-3 py-2 font-bold">{t('colObject')}</th>
                        <th className="text-left px-3 py-2 font-bold">{t('colContract')}</th>
                        <th className="text-left px-3 py-2 font-bold">{tc('client')}</th>
                        <th className="text-right px-3 py-2 font-bold">{t('amountUzs')}</th>
                        <th className="text-center px-3 py-2 font-bold">{tc('status')}</th>
                        <th className="text-center px-3 py-2 font-bold">Tx</th>
                        <th className="text-right px-3 py-2 font-bold">{tc('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listQuery.data.items.map((it) => (
                        <tr key={it.externalId}
                          className="border-t border-slate-100 dark:border-slate-800 hover:bg-violet-50/40 dark:hover:bg-violet-950/40 cursor-pointer transition-colors"
                          onClick={() => setDetailRow(it)}
                          title={t('rowDetailHint')}
                        >
                          <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                            {it.datePaid?.slice(0, 10) || '—'}
                          </td>
                          <td className="px-3 py-2 max-w-[180px] truncate" title={it.objectName || ''}>
                            {it.objectName
                              ? <span className="text-[11.5px] text-slate-700 dark:text-slate-300">{it.objectName}</span>
                              : <span className="text-slate-300 dark:text-slate-600 text-[10px]">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            <code className="font-mono text-[11px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded ring-1 ring-indigo-200 dark:ring-indigo-900">
                              {it.contract || '—'}
                            </code>
                          </td>
                          <td className="px-3 py-2 max-w-[220px] truncate" title={it.fullName || ''}>
                            {it.fullName || <span className="text-slate-400 dark:text-slate-500">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">
                            {fmt(it.amount)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {it.isMatched ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900">
                                <CheckCircle2 className="h-3 w-3" /> {t('received')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900">
                                <XCircle className="h-3 w-3" /> {t('notFound')}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {it.matchedTx?.externalId ? (
                              <Link
                                href={`/${locale}/transactions?searchId=${encodeURIComponent(it.matchedTx.externalId)}`}
                                onClick={(e) => e.stopPropagation()}
                                title={t('openInTransactions', { id: it.matchedTx.externalId })}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-sm hover:shadow-md hover:shadow-fuchsia-500/40 hover:scale-110 transition-all"
                              >
                                <ScanLine className="h-3.5 w-3.5" />
                              </Link>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600 text-[10px]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button variant="outline" size="sm"
                              onClick={(e) => { e.stopPropagation(); recheckOne(it.externalId); }}
                              disabled={rechecking.has(it.externalId)}
                              className="h-7 text-[10px] gap-1">
                              {rechecking.has(it.externalId)
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <RefreshCw className="h-3 w-3" />}
                              {tc('recheck')}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[12px]">
                  <div className="text-slate-500 dark:text-slate-400">
                    {fmt((page - 1) * perPage + 1)}–{fmt(Math.min(page * perPage, listQuery.data.total))} / {fmt(listQuery.data.total)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={String(perPage)} onValueChange={(v) => { setPerPage(Number(v)); setPage(1); }}>
                      <SelectTrigger className="h-8 w-20 text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="h-8 w-8 p-0">
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="px-2 tabular-nums">{page} / {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-8 w-8 p-0">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </>
            )}
            </>)}
          </CardContent>
        </Card>

        {/* ═══ SYNC PROGRESS MODAL ═══ */}
        <SyncProgressDialog
          open={progressModalOpen}
          syncRunning={syncRunning}
          matchRunning={matchRunning}
          syncProgress={syncStatusQuery.data?.progress}
          matchProgress={matchStatusQuery.data?.progress}
          syncStartedAt={syncStatusQuery.data?.startedAt || null}
          syncFinishedAt={syncStatusQuery.data?.finishedAt || null}
          syncLastError={syncStatusQuery.data?.lastError || null}
          onClose={() => { setProgressModalOpen(false); setProgressModalDismissed(true); }}
          onCancelSync={() => cancelSyncMut.mutate()}
          cancelPending={cancelSyncMut.isPending}
        />

        {/* ═══ DETAIL MODAL (row click) ═══ */}
        {detailRow && (
          <XonpayDetailDialog
            row={detailRow}
            locale={locale as string}
            onClose={() => setDetailRow(null)}
          />
        )}

        {/* ═══ CLEANUP ORPHANS MODAL ═══ */}
        {cleanupModalOpen && (
          <CleanupOrphansDialog onClose={() => setCleanupModalOpen(false)} />
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════
//  XONPAY DETAIL DIALOG — row bosilganda to'liq malumot
// ════════════════════════════════════════════════════
function XonpayDetailDialog({
  row, locale, onClose,
}: {
  row: XonpayRow;
  locale: string;
  onClose: () => void;
}) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 grid place-items-center text-white">
              <Receipt className="h-3.5 w-3.5" />
            </div>
            {t('xonpayDetailTitle')}
            {row.isMatched ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900">
                <CheckCircle2 className="h-3 w-3" /> {t('received')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900">
                <XCircle className="h-3 w-3" /> {t('notFound')}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {row.isMatched ? t('detailDescMatched') : t('detailDescUnmatched')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* ── Asosiy summa karta ── */}
          <div className="rounded-xl bg-gradient-to-br from-violet-50 to-purple-50 ring-1 ring-violet-200 dark:ring-violet-900 p-4">
            <div className="text-[10px] uppercase tracking-wider text-violet-600 dark:text-violet-400 font-bold">{tc('amount')}</div>
            <div className="text-3xl font-bold tracking-tight tabular-nums text-violet-900 dark:text-violet-300 mt-1">
              {fmt(row.amount)} <span className="text-sm text-violet-600 dark:text-violet-400 font-normal">UZS</span>
            </div>
            <div className="text-[11px] text-violet-700 dark:text-violet-300 mt-1">
              {row.datePaid?.slice(0, 10) || '—'} · {row.fullName || '—'}
            </div>
          </div>

          {/* ── CRM ma'lumotlari ── */}
          <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              {t('crmData')}
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              <DetailRow label={t('colObject')} value={
                row.objectName
                  ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11.5px] font-medium text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700">
                      <Home className="h-3 w-3 text-slate-500 dark:text-slate-400" /> {row.objectName}
                    </span>
                  : '—'
              } />
              <DetailRow label={t('colContract')} value={
                <code className="font-mono text-[12px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded ring-1 ring-indigo-200 dark:ring-indigo-900">
                  {row.contract || '—'}
                </code>
              } />
              <DetailRow label={t('clientFio')} value={row.fullName || '—'} />
              <DetailRow label="Type" value={row.type || '—'} />
              <DetailRow label="Category" value={row.category || '—'} />
              <DetailRow label="Status" value={row.status || '—'} />
              <DetailRow label="XonPay UUID" value={
                row.xonpayUuid ? (
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-[11px] text-violet-700 dark:text-violet-300">{row.xonpayUuid}</code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(row.xonpayUuid!); toast.success(t('uuidCopied')); }}
                      className="text-slate-400 dark:text-slate-500 hover:text-violet-600 dark:hover:text-violet-400"
                      title={tc('copy')}
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                ) : <span className="text-rose-600 dark:text-rose-400">{t('uuidNotExtracted')}</span>
              } />
              <DetailRow label="CRM external_id" value={
                <code className="font-mono text-[10px] text-slate-600 dark:text-slate-300 break-all">{row.externalId}</code>
              } />
              <DetailRow label="Purpose" value={
                <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{row.purpose || '—'}</div>
              } />
            </div>
          </div>

          {/* ── Bank tx ma'lumotlari (agar matched) ── */}
          {row.matchedTx ? (
            <div className="rounded-xl ring-1 ring-emerald-200 dark:ring-emerald-900 overflow-hidden">
              <div className="px-3 py-2 bg-emerald-50 dark:bg-emerald-950/40 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t('capitalTxFound')}
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                <DetailRow label={t('txIdExternal')} value={
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300 break-all">{row.matchedTx.externalId || row.matchedTx.id}</code>
                    {row.matchedTx.externalId && (
                      <button
                        onClick={() => { navigator.clipboard.writeText(row.matchedTx!.externalId!); toast.success(t('idCopied')); }}
                        className="text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 shrink-0"
                        title={tc('copy')}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                } />
                <DetailRow label={tc('date')} value={row.matchedTx.txnDate?.slice(0, 10) || '—'} />
                <DetailRow label={tc('amount')} value={
                  <span className="font-bold tabular-nums">{fmt(row.matchedTx.amount)} UZS</span>
                } />
                <DetailRow label="Description" value={
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">{row.matchedTx.description || '—'}</div>
                } />
              </div>
              <div className="px-3 py-2 bg-emerald-50/50 dark:bg-emerald-950/40 flex items-center justify-end gap-2 border-t border-emerald-100 dark:border-emerald-900">
                {row.matchedTx.externalId && (
                  <Link href={`/${locale}/transactions?searchId=${encodeURIComponent(row.matchedTx.externalId)}`}>
                    <Button size="sm" className="gap-1.5 h-8 text-[11px] bg-emerald-600 hover:bg-emerald-700">
                      <ScanLine className="h-3.5 w-3.5" /> {t('openTransaction')}
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-rose-200 dark:ring-rose-900 bg-rose-50 dark:bg-rose-950/40 p-4 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="text-[12px] text-rose-800 dark:text-rose-300">
                <div className="font-bold">{t('notFoundInCapital')}</div>
                <div className="text-[11px] text-rose-700 dark:text-rose-300 mt-0.5">
                  {t.rich('notFoundInCapitalDesc', { b: (c) => <b>{c}</b> })}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 px-3 py-2 text-[12px]">
      <div className="text-slate-500 dark:text-slate-400 font-medium">{label}</div>
      <div className="text-slate-800 dark:text-slate-200 min-w-0">{value}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════
//  SYNC PROGRESS DIALOG — modul ko'rinishida, to'xtatish ham mavjud
// ════════════════════════════════════════════════════
function SyncProgressDialog({
  open, syncRunning, matchRunning, syncProgress, matchProgress,
  syncStartedAt, syncFinishedAt, syncLastError,
  onClose, onCancelSync, cancelPending,
}: {
  open: boolean;
  syncRunning: boolean;
  matchRunning: boolean;
  syncProgress: SyncStatus['progress'] | undefined;
  matchProgress: { done: number; total: number; matched: number } | null | undefined;
  syncStartedAt: string | null;
  syncFinishedAt: string | null;
  syncLastError: string | null;
  onClose: () => void;
  onCancelSync: () => void;
  cancelPending: boolean;
}) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const isActive = syncRunning || matchRunning;
  const elapsedSec = syncStartedAt
    ? Math.floor((Date.now() - new Date(syncStartedAt).getTime()) / 1000)
    : 0;
  const elapsedStr = elapsedSec >= 60
    ? `${t('minShort', { n: Math.floor(elapsedSec / 60) })} ${elapsedSec % 60}s`
    : `${elapsedSec}s`;

  // Sync progress %
  const sp = syncProgress;
  const pct = sp && sp.lastPage > 0 ? Math.min(100, Math.round((sp.page / sp.lastPage) * 100)) : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className={cn(
              'w-7 h-7 rounded-lg grid place-items-center text-white',
              syncRunning ? 'bg-gradient-to-br from-violet-500 to-purple-600' :
              matchRunning ? 'bg-gradient-to-br from-blue-500 to-cyan-600' :
              'bg-gradient-to-br from-emerald-500 to-teal-600',
            )}>
              {isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </div>
            {syncRunning && t('syncRunningTitle')}
            {matchRunning && !syncRunning && t('matchTitle')}
            {!isActive && (syncFinishedAt ? t('syncDone') : t('state'))}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {syncRunning && t('syncRunningDesc', { elapsed: elapsedStr })}
            {matchRunning && !syncRunning && t('matchRunningDesc')}
            {!isActive && syncFinishedAt && t('finishedAt', { at: new Date(syncFinishedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour12: false }).slice(0, 19) })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* ── SYNC PROGRESS ── */}
          {sp && (
            <div className="space-y-3">
              {/* Progress bar */}
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {t('pageOf', { page: sp.page, last: sp.lastPage || '?' })}
                  </span>
                  <span className="text-violet-700 dark:text-violet-300 font-bold">{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-violet-100 dark:bg-violet-900/30 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      syncRunning ? 'bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 animate-pulse' : 'bg-emerald-500',
                    )}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </div>

              {/* Statistika grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <ProgressStat label={t('fromCrm')} value={fmt(sp.fetched)} color="slate" />
                <ProgressStat label="XonPay" value={fmt(sp.xonpay)} color="violet" />
                <ProgressStat label={tc('new')} value={`+${fmt(sp.inserted)}`} color="emerald" />
                <ProgressStat label={t('updated')} value={`~${fmt(sp.updated)}`} color="amber" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <ProgressStat label="Matched" value={fmt(sp.matched)} color="blue" icon={<CheckCircle2 className="h-3 w-3" />} />
                <ProgressStat label={t('errors')} value={fmt(sp.errors)} color={sp.errors > 0 ? 'rose' : 'slate'} icon={sp.errors > 0 ? <XCircle className="h-3 w-3" /> : undefined} />
                <ProgressStat label={tc('time')} value={elapsedStr} color="slate" icon={<Activity className="h-3 w-3" />} />
                <ProgressStat label={t('state')} value={syncRunning ? t('running') : t('finished')} color={syncRunning ? 'violet' : 'emerald'} />
              </div>
            </div>
          )}

          {/* ── MATCH PROGRESS ── */}
          {(matchRunning || (!syncRunning && matchProgress)) && matchProgress && (
            <div className={cn('space-y-3', syncRunning && 'border-t pt-3')}>
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                    {matchRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    {t('matchSectionTitle')}
                  </span>
                  <span className="text-blue-700 dark:text-blue-300 font-bold tabular-nums">
                    {matchProgress.total > 0 ? Math.round((matchProgress.done / matchProgress.total) * 100) : 0}%
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-blue-100 dark:bg-blue-900/30 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      matchRunning
                        ? 'bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-500 animate-pulse'
                        : 'bg-emerald-500',
                    )}
                    style={{ width: `${matchProgress.total > 0 ? Math.max(2, Math.min(100, Math.round((matchProgress.done / matchProgress.total) * 100))) : 0}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <ProgressStat
                  label={t('checked')}
                  value={`${fmt(matchProgress.done)} / ${fmt(matchProgress.total)}`}
                  color="blue"
                  icon={<Activity className="h-3 w-3" />}
                />
                <ProgressStat
                  label={t('foundMatched')}
                  value={fmt(matchProgress.matched)}
                  color="emerald"
                  icon={<CheckCircle2 className="h-3 w-3" />}
                />
                <ProgressStat
                  label={t('state')}
                  value={matchRunning ? t('running') : t('finished')}
                  color={matchRunning ? 'blue' : 'emerald'}
                />
              </div>
            </div>
          )}

          {/* ── XATO ── */}
          {syncLastError && !syncRunning && (
            <div className="rounded-lg ring-1 ring-rose-200 dark:ring-rose-900 bg-rose-50 dark:bg-rose-950/40 p-3 text-[11.5px] text-rose-800 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div><b>{tc('error')}:</b> {syncLastError}</div>
            </div>
          )}

          {/* ── INFO ── */}
          {syncRunning && (
            <div className="rounded-lg ring-1 ring-amber-200 dark:ring-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                {t('syncInfoBackground')}
                <br />
                <b>{t('syncInfoSkip')}</b> {t('syncInfoSkipTail')}
              </div>
            </div>
          )}

          {/* ── TUGMALAR ── */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            {syncRunning && (
              <Button
                variant="outline"
                onClick={onCancelSync}
                disabled={cancelPending}
                className="gap-1.5 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-300"
              >
                {cancelPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                {t('stopSync')}
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              {isActive ? t('closeModuleSyncContinues') : tc('close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProgressStat({
  label, value, color, icon,
}: {
  label: string;
  value: string;
  color: 'violet' | 'emerald' | 'rose' | 'amber' | 'blue' | 'slate';
  icon?: React.ReactNode;
}) {
  const m = {
    violet:  { bg: 'bg-violet-50 dark:bg-violet-950/40',  text: 'text-violet-700 dark:text-violet-300',  ring: 'ring-violet-200 dark:ring-violet-900' },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-200 dark:ring-emerald-900' },
    rose:    { bg: 'bg-rose-50 dark:bg-rose-950/40',    text: 'text-rose-700 dark:text-rose-300',    ring: 'ring-rose-200 dark:ring-rose-900' },
    amber:   { bg: 'bg-amber-50 dark:bg-amber-950/40',   text: 'text-amber-700 dark:text-amber-300',   ring: 'ring-amber-200 dark:ring-amber-900' },
    blue:    { bg: 'bg-blue-50 dark:bg-blue-950/40',    text: 'text-blue-700 dark:text-blue-300',    ring: 'ring-blue-200 dark:ring-blue-900' },
    slate:   { bg: 'bg-slate-50 dark:bg-slate-900',   text: 'text-slate-700 dark:text-slate-300',   ring: 'ring-slate-200 dark:ring-slate-700' },
  }[color];
  return (
    <div className={cn('rounded-lg ring-1 ring-inset px-3 py-2', m.bg, m.ring)}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{label}</div>
      <div className={cn('text-base font-bold tabular-nums flex items-center gap-1', m.text)}>
        {icon}
        {value}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════
//  CLEANUP ORPHANS MODAL — CRM da yo'q (orphan) yozuvlarni tozalash
// ════════════════════════════════════════════════════
function CleanupOrphansDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'truncating' | 'done' | 'error'>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [deletedCount, setDeletedCount] = useState<number | null>(null);

  async function doTruncate() {
    setPhase('truncating');
    setLastError(null);
    try {
      const tr = await api.post<{ ok: true; deleted: number }>('/xonpay/admin/truncate', {});
      setDeletedCount(tr.deleted);
      qc.invalidateQueries({ queryKey: ['xonpay-list'] });
      qc.invalidateQueries({ queryKey: ['xonpay-stats'] });
      qc.invalidateQueries({ queryKey: ['xonpay-history'] });
      setPhase('done');
    } catch (e: any) {
      setLastError(e?.message || tc('error'));
      setPhase('error');
    }
  }

  const busy = phase === 'truncating';

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 grid place-items-center text-white shadow-lg shadow-rose-500/30">
              <Trash2 className="h-4 w-4" />
            </div>
            {t('cleanupTitle')}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {t('cleanupDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* ── IDLE: warning + confirm trigger ── */}
          {phase === 'idle' && (
            <>
              <div className="rounded-2xl ring-1 ring-rose-200 dark:ring-rose-900 bg-gradient-to-br from-rose-50 to-pink-50 p-5 text-center">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 grid place-items-center text-white shadow-lg shadow-rose-500/30 mb-3">
                  <AlertCircle className="h-7 w-7" />
                </div>
                <div className="text-[14px] font-bold text-rose-900 dark:text-rose-300 mb-1">{t('dangerAction')}</div>
                <div className="text-[12px] text-rose-700 dark:text-rose-300">
                  {t.rich('cleanupWarning', { b: (c) => <b>{c}</b>, code: (c) => <code className="font-mono text-[11px] bg-white/60 dark:bg-slate-900 px-1 rounded">{c}</code> })}
                </div>
              </div>
              <div className="rounded-lg ring-1 ring-amber-200 dark:ring-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-[11.5px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div>{t.rich('cleanupRefillHint', { b: (c) => <b>{c}</b> })}</div>
              </div>
            </>
          )}

          {/* ── CONFIRM step ── */}
          {phase === 'confirm' && (
            <div className="rounded-2xl ring-2 ring-rose-300 dark:ring-rose-900 bg-rose-50 dark:bg-rose-950/40 p-5 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-600 grid place-items-center text-white shadow-lg shadow-rose-500/40 mb-3 animate-pulse">
                <AlertCircle className="h-7 w-7" />
              </div>
              <div className="text-[14px] font-bold text-rose-900 dark:text-rose-300 mb-2">{t('confirmSure')}</div>
              <div className="text-[12px] text-rose-700 dark:text-rose-300">
                {t('confirmDeleteDesc')}
              </div>
            </div>
          )}

          {/* ── TRUNCATING ── */}
          {phase === 'truncating' && (
            <div className="rounded-2xl ring-1 ring-violet-200 dark:ring-violet-900 bg-violet-50 dark:bg-violet-950/40 p-5 text-center">
              <Loader2 className="h-10 w-10 mx-auto animate-spin text-violet-600 dark:text-violet-400 mb-3" />
              <div className="text-[13px] font-bold text-violet-900 dark:text-violet-300">{t('cleaning')}</div>
              <div className="text-[11px] text-violet-600 dark:text-violet-400 mt-1">{t('fewSeconds')}</div>
            </div>
          )}

          {/* ── DONE ── */}
          {phase === 'done' && (
            <div className="rounded-2xl ring-1 ring-emerald-200 dark:ring-emerald-900 bg-gradient-to-br from-emerald-50 to-teal-50 p-5 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow-lg shadow-emerald-500/30 mb-3">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div className="text-[14px] font-bold text-emerald-900 dark:text-emerald-300 mb-1">{tc('done')}</div>
              <div className="text-[24px] font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{fmt(deletedCount || 0)}</div>
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">{t('recordsDeleted')}</div>
              <div className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-3">
                {t('cleanupDoneHint')}
              </div>
            </div>
          )}

          {/* ── ERROR ── */}
          {lastError && (
            <div className="rounded-lg ring-1 ring-rose-200 dark:ring-rose-900 bg-rose-50 dark:bg-rose-950/40 p-3 text-[12px] text-rose-800 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div><b>{tc('error')}:</b> {lastError}</div>
            </div>
          )}

          {/* ── Tugmalar ── */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            {phase === 'idle' && (
              <>
                <Button variant="outline" onClick={onClose}>{tc('cancel')}</Button>
                <Button onClick={() => setPhase('confirm')} className="gap-1.5 bg-rose-600 hover:bg-rose-700">
                  <Trash2 className="h-3.5 w-3.5" /> {tc('delete')}
                </Button>
              </>
            )}
            {phase === 'confirm' && (
              <>
                <Button variant="outline" onClick={() => setPhase('idle')}>{tc('back')}</Button>
                <Button onClick={doTruncate} className="gap-1.5 bg-rose-600 hover:bg-rose-700">
                  <Trash2 className="h-3.5 w-3.5" /> {tc('yesDelete')}
                </Button>
              </>
            )}
            {busy && (
              <Button variant="outline" disabled className="gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {tc('wait')}
              </Button>
            )}
            {(phase === 'done' || phase === 'error') && (
              <Button onClick={onClose}>{tc('close')}</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoBox({ label, value, color }: { label: string; value: string; color?: 'violet' | 'emerald' | 'rose' | 'slate' }) {
  const m = {
    violet:  'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 ring-violet-200 dark:ring-violet-900',
    emerald: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900',
    rose:    'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900',
    slate:   'text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700',
  }[color || 'slate'];
  return (
    <div className={cn('rounded-md ring-1 px-2.5 py-1.5', m)}>
      <div className="text-[9px] uppercase tracking-wider opacity-70 font-semibold">{label}</div>
      <div className="text-[13px] font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════
//  KPI KARTA — zamonaviy (gradient bg, big number, sparkle)
// ════════════════════════════════════════════════════
function KpiCardModern({
  label, count, amount, color, icon, loading, extra, countLabel,
}: {
  label: string;
  count: number;
  amount: string;
  color: 'violet' | 'emerald' | 'rose';
  icon: React.ReactNode;
  loading: boolean;
  extra?: string;
  countLabel: string;
}) {
  const m = {
    violet:  { bg: 'from-violet-500/10 to-purple-500/5', ring: 'ring-violet-200 dark:ring-violet-900', text: 'text-violet-700 dark:text-violet-300', accent: 'from-violet-500 to-purple-600' },
    emerald: { bg: 'from-emerald-500/10 to-teal-500/5',  ring: 'ring-emerald-200 dark:ring-emerald-900', text: 'text-emerald-700 dark:text-emerald-300', accent: 'from-emerald-500 to-teal-600' },
    rose:    { bg: 'from-rose-500/10 to-pink-500/5',     ring: 'ring-rose-200 dark:ring-rose-900', text: 'text-rose-700 dark:text-rose-300', accent: 'from-rose-500 to-pink-600' },
  }[color];
  return (
    <div className={cn('relative overflow-hidden rounded-2xl ring-1 bg-gradient-to-br p-4 shadow-sm', m.bg, m.ring)}>
      <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-10 bg-gradient-to-br" />
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 dark:text-slate-400">{label}</div>
          {extra && <div className={cn('text-[10px] font-semibold mt-0.5', m.text)}>{extra}</div>}
        </div>
        <div className={cn('w-9 h-9 rounded-xl grid place-items-center text-white shadow-lg bg-gradient-to-br', m.accent)}>
          {icon}
        </div>
      </div>
      {loading ? (
        <>
          <Skeleton className="h-7 w-32 mb-1" />
          <Skeleton className="h-3 w-20" />
        </>
      ) : (
        <>
          <div className={cn('text-2xl font-bold tracking-tight tabular-nums leading-tight', m.text)}>
            {fmt(amount)} <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">UZS</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums font-semibold">
            {countLabel}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════
function Stat({ label, value, suffix, valueClass }: { label: string; value: string | number; suffix?: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-slate-500 dark:text-slate-400">{label}:</span>
      <span className={cn('font-bold tabular-nums', valueClass || 'text-slate-700 dark:text-slate-300')}>
        {typeof value === 'number' ? fmt(value) : value}
      </span>
      {suffix && <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">{suffix}</span>}
    </div>
  );
}
