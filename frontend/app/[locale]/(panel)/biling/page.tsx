'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CreditCard, RefreshCw, Search, CheckCircle2, AlertCircle, Loader2,
  TrendingUp, TrendingDown, Hash, Calendar, Filter as FilterIcon,
  ExternalLink, Play, X, ArrowDownLeft, Clock, History, Zap,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const fmt = (n: string | number | bigint) => Number(n).toLocaleString('uz-UZ');

interface SyncStatus {
  running: boolean;
  cancelRequested: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  progress: {
    page: number;
    lastPage: number;
    fetched: number;
    xonpay: number;
    inserted: number;
    updated: number;
    matched: number;
    errors: number;
  } | null;
  lastError: string | null;
}

interface DailyStats {
  ok: true;
  summary: {
    totalCount: number;
    totalAmount: string;
    matchedCount: number;
    matchedAmount: string;
    missingCount: number;
    missingAmount: string;
  };
  days: Array<{
    date: string;
    totalCount: number;
    totalAmount: string;
    matchedCount: number;
    matchedAmount: string;
    missingCount: number;
    missingAmount: string;
  }>;
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
  matchedTx: {
    id: string;
    externalId: string | null;
    txnDate: string;
    amount: string;
    description: string | null;
  } | null;
}

export default function BilingPage() {
  const qc = useQueryClient();
  const { locale } = useParams<{ locale: string }>();
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today);
  const [matched, setMatched] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [rechecking, setRechecking] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  // ── Sync status (polling) ──
  const syncStatusQuery = useQuery<SyncStatus>({
    queryKey: ['xonpay-sync-status'],
    queryFn: () => api.get('/xonpay/sync/status'),
    refetchInterval: (data: any) => (data?.state?.data?.running ? 3000 : false),
    refetchIntervalInBackground: false,
  });
  const syncStatus = syncStatusQuery.data;
  const syncRunning = !!syncStatus?.running;

  // ── Match status (polling) ──
  const matchStatusQuery = useQuery<{ running: boolean; progress: { done: number; total: number; matched: number } | null }>({
    queryKey: ['xonpay-match-status'],
    queryFn: () => api.get('/xonpay/match/status'),
    refetchInterval: (data: any) => (data?.state?.data?.running ? 3000 : false),
    refetchIntervalInBackground: false,
  });
  const matchRunning = !!matchStatusQuery.data?.running;

  // ── Cron info + history ──
  const cronInfoQuery = useQuery<{ enabled: boolean; schedule: string; lastRunAt: string | null; lastFinishedAt: string | null; lastSkipReason: string | null; lastResult: any }>({
    queryKey: ['xonpay-cron-info'],
    queryFn: () => api.get('/xonpay/cron/info'),
    refetchInterval: 30000,
  });
  const historyQuery = useQuery<{ ok: true; items: Array<any> }>({
    queryKey: ['xonpay-history'],
    queryFn: () => api.get('/xonpay/sync/history?limit=20'),
    refetchInterval: 30000,
  });

  // ── Daily stats ──
  const statsQuery = useQuery<DailyStats>({
    queryKey: ['xonpay-stats', dateFrom, dateTo],
    queryFn: () => api.get(`/xonpay/stats/daily?dateFrom=${dateFrom}&dateTo=${dateTo}`),
  });

  // ── List ──
  const params = new URLSearchParams({
    page: String(page), perPage: String(perPage),
    dateFrom, dateTo, matched,
  });
  if (debouncedQ) params.set('q', debouncedQ);
  const listQuery = useQuery<{ ok: true; total: number; items: XonpayRow[] }>({
    queryKey: ['xonpay-list', page, perPage, dateFrom, dateTo, matched, debouncedQ],
    queryFn: () => api.get(`/xonpay?${params.toString()}`),
  });

  // ── Mutations ──
  const startSyncMut = useMutation({
    mutationFn: () => api.post<{ ok: true; started: boolean; message: string }>('/xonpay/sync', {}),
    onSuccess: (r) => {
      toast.message(r.message);
      qc.invalidateQueries({ queryKey: ['xonpay-sync-status'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Sync boshlanmadi'),
  });

  const cancelSyncMut = useMutation({
    mutationFn: () => api.post('/xonpay/sync/cancel', {}),
    onSuccess: () => {
      toast.message("Sync bekor qilish so'raldi");
      qc.invalidateQueries({ queryKey: ['xonpay-sync-status'] });
    },
  });

  const matchAllMut = useMutation({
    mutationFn: () => api.post<{ ok: true; message: string }>('/xonpay/match-all?onlyUnmatched=true', {}),
    onSuccess: (r) => {
      toast.message(r.message);
      qc.invalidateQueries({ queryKey: ['xonpay-match-status'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Match boshlanmadi'),
  });

  async function recheckOne(externalId: string) {
    setRechecking((s) => new Set(s).add(externalId));
    try {
      const r = await api.post<{ ok: true; matched: boolean }>(
        `/xonpay/${encodeURIComponent(externalId)}/recheck`, {},
      );
      toast.success(r.matched ? '✅ Topildi!' : '❌ Hali ham topilmadi');
      qc.invalidateQueries({ queryKey: ['xonpay-list'] });
      qc.invalidateQueries({ queryKey: ['xonpay-stats'] });
    } catch (e: any) {
      toast.error(e?.message || 'Xato');
    } finally {
      setRechecking((s) => {
        const next = new Set(s);
        next.delete(externalId);
        return next;
      });
    }
  }

  // Refetch after sync/match finishes
  useEffect(() => {
    if (!syncRunning && syncStatus?.finishedAt) {
      qc.invalidateQueries({ queryKey: ['xonpay-list'] });
      qc.invalidateQueries({ queryKey: ['xonpay-stats'] });
    }
  }, [syncRunning, syncStatus?.finishedAt, qc]);

  useEffect(() => {
    if (!matchRunning && matchStatusQuery.data?.progress?.done) {
      qc.invalidateQueries({ queryKey: ['xonpay-list'] });
      qc.invalidateQueries({ queryKey: ['xonpay-stats'] });
    }
  }, [matchRunning, matchStatusQuery.data?.progress?.done, qc]);

  const summary = statsQuery.data?.summary;
  const matchedPct = summary && Number(summary.totalCount) > 0
    ? Math.round((Number(summary.matchedCount) / Number(summary.totalCount)) * 100)
    : 0;

  return (
    <div className="flex-1 flex flex-col">
      <Topbar />
      <div className="px-6 py-6 space-y-6 max-w-[1600px] mx-auto w-full">
        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 grid place-items-center text-white">
                <CreditCard className="h-4 w-4" />
              </span>
              Biling — XonPay tranzaksiyalar
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              CRM XonPay to'lovlari va Kapitalbank tushumlarini moslashtirish (UUID orqali)
            </p>
          </div>

          <div className="flex items-center gap-2">
            {syncRunning ? (
              <Button
                variant="outline"
                onClick={() => cancelSyncMut.mutate()}
                disabled={cancelSyncMut.isPending}
                className="gap-2"
              >
                <X className="h-4 w-4" /> Sync to'xtatish
              </Button>
            ) : (
              <Button
                onClick={() => startSyncMut.mutate()}
                disabled={startSyncMut.isPending}
                className="gap-2 bg-violet-600 hover:bg-violet-700"
              >
                {startSyncMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                CRM dan sync
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => matchAllMut.mutate()}
              disabled={matchAllMut.isPending || matchRunning}
              className="gap-2"
            >
              {(matchAllMut.isPending || matchRunning) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Match: qolganlarni tekshirish
            </Button>
          </div>
        </div>

        {/* ═══ SYNC / MATCH PROGRESS PANEL ═══ */}
        {(syncRunning || matchRunning) && (
          <div className="rounded-xl ring-1 ring-violet-200 bg-violet-50 p-3 text-[12px]">
            {syncRunning && syncStatus?.progress && (
              <div className="flex items-center gap-3 flex-wrap">
                <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                <span className="font-semibold text-violet-900">
                  Sync: page {syncStatus.progress.page}/{syncStatus.progress.lastPage || '?'}
                </span>
                <span className="text-violet-700">
                  · keldi {syncStatus.progress.fetched} · xonpay {syncStatus.progress.xonpay}
                </span>
                <span className="text-emerald-700">+{syncStatus.progress.inserted} yangi</span>
                <span className="text-amber-700">~{syncStatus.progress.updated} update</span>
                <span className="text-blue-700">✅ {syncStatus.progress.matched} matched</span>
                {syncStatus.progress.errors > 0 && (
                  <span className="text-rose-700">❌ {syncStatus.progress.errors}</span>
                )}
              </div>
            )}
            {matchRunning && matchStatusQuery.data?.progress && (
              <div className="flex items-center gap-3 flex-wrap mt-1">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span className="font-semibold text-blue-900">
                  Match: {matchStatusQuery.data.progress.done}/{matchStatusQuery.data.progress.total}
                </span>
                <span className="text-emerald-700">
                  ✅ topildi: {matchStatusQuery.data.progress.matched}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ═══ KPI KARTALAR ═══ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            label="Jami XonPay"
            count={summary?.totalCount || 0}
            amount={summary?.totalAmount || '0'}
            icon={<CreditCard className="h-4 w-4" />}
            color="violet"
            loading={statsQuery.isLoading}
          />
          <KpiCard
            label="✅ Kapitalga tushgan"
            count={summary?.matchedCount || 0}
            amount={summary?.matchedAmount || '0'}
            icon={<CheckCircle2 className="h-4 w-4" />}
            color="emerald"
            loading={statsQuery.isLoading}
            extra={`${matchedPct}% mos`}
          />
          <KpiCard
            label="❌ Topilmagan (qolgan)"
            count={summary?.missingCount || 0}
            amount={summary?.missingAmount || '0'}
            icon={<AlertCircle className="h-4 w-4" />}
            color="rose"
            loading={statsQuery.isLoading}
          />
        </div>

        {/* ═══ CRON INFO + OXIRGI SYNC LAR ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Cron info */}
          <Card className="lg:col-span-1">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-amber-600" />
                <h3 className="text-sm font-bold">Avtomatik sync</h3>
                {cronInfoQuery.data?.enabled && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                    ✓ Yoqilgan
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-600 space-y-1.5">
                <div><span className="text-slate-400">Jadval:</span> <span className="font-mono">{cronInfoQuery.data?.schedule || '—'}</span></div>
                <div>
                  <span className="text-slate-400">Oxirgi run:</span>{' '}
                  {cronInfoQuery.data?.lastRunAt ? (
                    <span className="font-mono">{new Date(cronInfoQuery.data.lastRunAt).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', hour12: false }).slice(0, 19)}</span>
                  ) : (
                    <span className="text-slate-400">hali yo'q</span>
                  )}
                </div>
                {cronInfoQuery.data?.lastSkipReason && (
                  <div className="text-amber-700 text-[10.5px]">⏭ {cronInfoQuery.data.lastSkipReason}</div>
                )}
                {cronInfoQuery.data?.lastResult && (
                  <div className="pt-2 mt-2 border-t border-slate-100 text-[10.5px]">
                    Oxirgi natija: <b className="text-emerald-700">+{cronInfoQuery.data.lastResult.inserted}</b> · <b className="text-blue-700">✓{cronInfoQuery.data.lastResult.matched}</b>
                    {cronInfoQuery.data.lastResult.errors > 0 && <span className="text-rose-700"> · ❌{cronInfoQuery.data.lastResult.errors}</span>}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Sync tarixi */}
          <Card className="lg:col-span-2">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
                <History className="h-4 w-4 text-violet-600" />
                <h3 className="text-sm font-bold">Sync tarixi</h3>
                <span className="text-[10px] text-slate-400">(qo'lda + cron)</span>
              </div>
              {historyQuery.isLoading ? (
                <div className="p-3 space-y-1.5">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
                </div>
              ) : !historyQuery.data?.items?.length ? (
                <div className="p-6 text-center text-[11px] text-slate-400">Hali sync qilinmagan</div>
              ) : (
                <div className="max-h-[200px] overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-semibold">Vaqt</th>
                        <th className="text-left px-3 py-1.5 font-semibold">Tur</th>
                        <th className="text-left px-3 py-1.5 font-semibold">Kim</th>
                        <th className="text-center px-2 py-1.5 font-semibold">Status</th>
                        <th className="text-right px-2 py-1.5 font-semibold">XonPay</th>
                        <th className="text-right px-2 py-1.5 font-semibold">+yangi</th>
                        <th className="text-right px-2 py-1.5 font-semibold">✓matched</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Vaqt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyQuery.data.items.map((h) => {
                        const dur = h.durationMs ? `${(h.durationMs / 1000).toFixed(0)}s` : (h.status === 'running' ? '...' : '—');
                        return (
                          <tr key={h.id} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-mono tabular-nums whitespace-nowrap">
                              {new Date(h.startedAt).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', hour12: false }).slice(0, 19)}
                            </td>
                            <td className="px-3 py-1.5">
                              <span className={cn(
                                'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
                                h.trigger === 'cron'
                                  ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                                  : 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
                              )}>
                                {h.trigger === 'cron' ? '⚡ cron' : '👤 qo\'lda'}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 max-w-[140px] truncate" title={h.actorEmail || ''}>
                              {h.actorEmail || (h.trigger === 'cron' ? 'system' : '—')}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <span className={cn(
                                'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
                                h.status === 'success' && 'bg-emerald-50 text-emerald-700',
                                h.status === 'running' && 'bg-blue-50 text-blue-700 animate-pulse',
                                h.status === 'failed' && 'bg-rose-50 text-rose-700',
                                h.status === 'cancelled' && 'bg-slate-100 text-slate-700',
                              )}>
                                {h.status}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{h.xonpay}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">+{h.inserted}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-blue-700">✓{h.matched}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{dur}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ═══ SANA FILTRI ═══ */}
        <Card>
          <CardContent className="p-4 flex items-center gap-3 flex-wrap">
            <Calendar className="h-4 w-4 text-slate-500" />
            <div className="text-[11px] uppercase font-semibold text-slate-500">Sana oraliq:</div>
            <Input
              type="date" value={dateFrom} max={dateTo}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="h-9 w-44"
            />
            <span className="text-slate-400">→</span>
            <Input
              type="date" value={dateTo} min={dateFrom} max={today}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="h-9 w-44"
            />
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost" size="sm"
                onClick={() => {
                  const d = new Date(); d.setDate(d.getDate() - 7);
                  setDateFrom(d.toISOString().slice(0, 10)); setDateTo(today); setPage(1);
                }}
              >7 kun</Button>
              <Button
                variant="ghost" size="sm"
                onClick={() => {
                  const d = new Date(); d.setDate(d.getDate() - 30);
                  setDateFrom(d.toISOString().slice(0, 10)); setDateTo(today); setPage(1);
                }}
              >30 kun</Button>
              <Button
                variant="ghost" size="sm"
                onClick={() => {
                  const d = new Date(); d.setDate(d.getDate() - 90);
                  setDateFrom(d.toISOString().slice(0, 10)); setDateTo(today); setPage(1);
                }}
              >90 kun</Button>
            </div>
          </CardContent>
        </Card>

        {/* ═══ KUNLIK STATISTIKA ═══ */}
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-violet-600" />
                Kunlik statistika
              </h2>
              <div className="text-[11px] text-slate-500">{statsQuery.data?.days?.length || 0} kun</div>
            </div>
            {statsQuery.isLoading ? (
              <div className="p-4 space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : !statsQuery.data?.days?.length ? (
              <div className="p-8 text-center text-sm text-slate-400">Ma'lumot yo'q</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold">Sana</th>
                      <th className="text-right px-4 py-2 font-semibold">Jami</th>
                      <th className="text-right px-4 py-2 font-semibold">Jami (UZS)</th>
                      <th className="text-right px-4 py-2 font-semibold text-emerald-700">✅ Tushgan</th>
                      <th className="text-right px-4 py-2 font-semibold text-emerald-700">✅ Tushgan (UZS)</th>
                      <th className="text-right px-4 py-2 font-semibold text-rose-700">❌ Qolgan</th>
                      <th className="text-right px-4 py-2 font-semibold text-rose-700">❌ Qolgan (UZS)</th>
                      <th className="text-right px-4 py-2 font-semibold">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsQuery.data.days.map((d) => {
                      const pct = d.totalCount > 0 ? Math.round((d.matchedCount / d.totalCount) * 100) : 0;
                      return (
                        <tr
                          key={d.date}
                          className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                          onClick={() => { setDateFrom(d.date); setDateTo(d.date); setPage(1); }}
                          title="Bu kunni alohida ko'rish uchun bosing"
                        >
                          <td className="px-4 py-2 font-mono">{d.date}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{d.totalCount}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmt(d.totalAmount)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{d.matchedCount}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{fmt(d.matchedAmount)}</td>
                          <td className={cn('px-4 py-2 text-right tabular-nums', d.missingCount > 0 && 'text-rose-700 font-semibold')}>
                            {d.missingCount}
                          </td>
                          <td className={cn('px-4 py-2 text-right tabular-nums', d.missingCount > 0 && 'text-rose-700 font-semibold')}>
                            {fmt(d.missingAmount)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ring-1 ring-inset',
                              pct === 100 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' :
                              pct >= 80 ? 'bg-lime-50 text-lime-700 ring-lime-200' :
                              pct >= 50 ? 'bg-amber-50 text-amber-700 ring-amber-200' :
                              'bg-rose-50 text-rose-700 ring-rose-200',
                            )}>{pct}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ═══ XONPAY TO'LOVLAR RO'YXATI ═══ */}
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Hash className="h-4 w-4 text-violet-600" />
                XonPay to'lovlar ro'yxati
                {listQuery.data?.total != null && (
                  <span className="text-[11px] text-slate-500 font-normal">({listQuery.data.total} ta)</span>
                )}
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={matched} onValueChange={(v: any) => { setMatched(v); setPage(1); }}>
                  <SelectTrigger className="h-9 w-44 text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Hammasi</SelectItem>
                    <SelectItem value="matched">✅ Topilgan</SelectItem>
                    <SelectItem value="unmatched">❌ Topilmagan</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setPage(1); }}
                    placeholder="Shartnoma, F.I.O., UUID..."
                    className="pl-8 h-9 w-64 text-[12px]"
                  />
                </div>
              </div>
            </div>

            {listQuery.isLoading ? (
              <div className="p-4 space-y-2">
                {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !listQuery.data?.items?.length ? (
              <div className="p-12 text-center text-sm text-slate-400">
                Ma'lumot yo'q. Avval <b>CRM dan sync</b> tugmasini bosing.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 text-slate-600 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Sana</th>
                        <th className="text-left px-3 py-2 font-semibold">Shartnoma</th>
                        <th className="text-left px-3 py-2 font-semibold">Mijoz</th>
                        <th className="text-right px-3 py-2 font-semibold">Summa</th>
                        <th className="text-center px-3 py-2 font-semibold">Status</th>
                        <th className="text-left px-3 py-2 font-semibold">Bank tx</th>
                        <th className="text-right px-3 py-2 font-semibold">Amal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listQuery.data.items.map((it) => (
                        <tr key={it.externalId} className="border-t border-slate-100 hover:bg-slate-50/50">
                          <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap">
                            {it.datePaid?.slice(0, 10) || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <code className="font-mono text-[11px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded ring-1 ring-indigo-200">
                              {it.contract || '—'}
                            </code>
                          </td>
                          <td className="px-3 py-2 max-w-[200px] truncate" title={it.fullName || ''}>
                            {it.fullName || <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {fmt(it.amount)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {it.isMatched ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                                <CheckCircle2 className="h-3 w-3" /> Tushgan
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                                <AlertCircle className="h-3 w-3" /> Yo'q
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 max-w-[260px]">
                            {it.matchedTx ? (
                              <Link
                                href={`/${locale}/transactions?id=${encodeURIComponent(it.matchedTx.id)}`}
                                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline"
                                title={it.matchedTx.externalId || ''}
                              >
                                <ExternalLink className="h-3 w-3" />
                                <span className="font-mono text-[10px] truncate max-w-[200px]">
                                  {it.matchedTx.externalId?.slice(0, 30)}...
                                </span>
                              </Link>
                            ) : (
                              <span className="text-slate-400 text-[10px]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              variant="outline" size="sm"
                              onClick={() => recheckOne(it.externalId)}
                              disabled={rechecking.has(it.externalId)}
                              className="h-7 text-[10px] gap-1"
                            >
                              {rechecking.has(it.externalId)
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <RefreshCw className="h-3 w-3" />}
                              Tekshirish
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-[12px]">
                  <div className="text-slate-500">
                    {(page - 1) * perPage + 1}–{Math.min(page * perPage, listQuery.data.total)} / {listQuery.data.total}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={String(perPage)} onValueChange={(v) => { setPerPage(Number(v)); setPage(1); }}>
                      <SelectTrigger className="h-8 w-24 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline" size="sm"
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                    >‹</Button>
                    <span className="px-2 tabular-nums">
                      {page} / {Math.max(1, Math.ceil(listQuery.data.total / perPage))}
                    </span>
                    <Button
                      variant="outline" size="sm"
                      disabled={page * perPage >= listQuery.data.total}
                      onClick={() => setPage((p) => p + 1)}
                    >›</Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
function KpiCard({
  label, count, amount, icon, color, loading, extra,
}: {
  label: string;
  count: number;
  amount: string;
  icon: React.ReactNode;
  color: 'violet' | 'emerald' | 'rose';
  loading: boolean;
  extra?: string;
}) {
  const m = {
    violet:  { bg: 'bg-violet-50',  text: 'text-violet-700',  ring: 'ring-violet-100',  accent: 'from-violet-500 to-purple-600' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-100', accent: 'from-emerald-500 to-teal-600' },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-100',    accent: 'from-rose-500 to-pink-600' },
  }[color];
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500">{label}</div>
            {extra && <div className="text-[10px] text-slate-400 mt-0.5">{extra}</div>}
          </div>
          <div className={cn('w-9 h-9 rounded-xl grid place-items-center ring-1 text-white bg-gradient-to-br', m.accent, m.ring)}>
            {icon}
          </div>
        </div>
        {loading ? (
          <>
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-4 w-20" />
          </>
        ) : (
          <>
            <div className="text-2xl font-bold tracking-tight tabular-nums">{fmt(amount)} <span className="text-sm text-slate-500 font-normal">UZS</span></div>
            <div className="text-[12px] text-slate-500 mt-1">{count.toLocaleString('uz-UZ')} ta to'lov</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
