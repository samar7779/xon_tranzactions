'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CreditCard, RefreshCw, Search, CheckCircle2, AlertCircle, XCircle, Loader2,
  TrendingUp, Hash, Calendar, ExternalLink, Play, X, History, Zap,
  Receipt, Activity, ChevronLeft, ChevronRight, Eye, Copy, FileSearch,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { IdInspectorDialog } from '@/components/id-inspector-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
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
  const { locale } = useParams<{ locale: string }>();
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })();

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today);
  const [matched, setMatched] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [rechecking, setRechecking] = useState<Set<string>>(new Set());
  const [detailRow, setDetailRow] = useState<XonpayRow | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);

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

  const cronInfoQuery = useQuery<{ enabled: boolean; schedule: string; lastRunAt: string | null; lastFinishedAt: string | null; lastSkipReason: string | null; lastResult: any }>({
    queryKey: ['xonpay-cron-info'],
    queryFn: () => api.get('/xonpay/cron/info'),
    refetchInterval: 60000,
  });

  const historyQuery = useQuery<{ ok: true; items: any[] }>({
    queryKey: ['xonpay-history'],
    queryFn: () => api.get('/xonpay/sync/history?limit=20'),
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
    onError: (e: any) => toast.error(e?.message || 'Sync boshlanmadi'),
  });
  const cancelSyncMut = useMutation({
    mutationFn: () => api.post('/xonpay/sync/cancel', {}),
    onSuccess: () => { toast.message("Sync bekor qilish so'raldi"); qc.invalidateQueries({ queryKey: ['xonpay-sync-status'] }); },
  });
  const matchAllMut = useMutation({
    mutationFn: () => api.post<{ ok: true; message: string }>('/xonpay/match-all?onlyUnmatched=true', {}),
    onSuccess: (r) => { toast.message(r.message); qc.invalidateQueries({ queryKey: ['xonpay-match-status'] }); },
    onError: (e: any) => toast.error(e?.message || 'Match boshlanmadi'),
  });

  async function recheckOne(externalId: string) {
    setRechecking((s) => new Set(s).add(externalId));
    try {
      const r = await api.post<{ ok: true; matched: boolean }>(`/xonpay/${encodeURIComponent(externalId)}/recheck`, {});
      toast.success(r.matched ? 'Topildi' : 'Hali ham topilmadi');
      qc.invalidateQueries({ queryKey: ['xonpay-list'] });
      qc.invalidateQueries({ queryKey: ['xonpay-stats'] });
    } catch (e: any) {
      toast.error(e?.message || 'Xato');
    } finally {
      setRechecking((s) => { const n = new Set(s); n.delete(externalId); return n; });
    }
  }

  // Refetch after sync/match finishes
  useEffect(() => {
    if (!syncRunning && syncStatusQuery.data?.finishedAt) {
      qc.invalidateQueries({ queryKey: ['xonpay-list'] });
      qc.invalidateQueries({ queryKey: ['xonpay-stats'] });
      qc.invalidateQueries({ queryKey: ['xonpay-history'] });
    }
  }, [syncRunning, syncStatusQuery.data?.finishedAt, qc]);

  const summary = statsQuery.data?.summary;
  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / perPage)) : 1;

  return (
    <div className="flex-1 flex flex-col">
      <Topbar title="Biling" subtitle="XonPay to'lovlar va Kapitalbank tushumlari moslashtirilishi" />
      <div className="px-6 py-6 space-y-5 max-w-[1700px] mx-auto w-full">
        {/* ═══ HEADER (compact stats inline) ═══ */}
        <div className="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-slate-200">
          <div className="flex items-center gap-6 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 grid place-items-center text-white">
                <Receipt className="h-4 w-4" />
              </span>
              Biling
            </h1>
            <div className="flex items-center gap-5 text-[13px]">
              <Stat label="Jami" value={summary?.totalCount || 0} valueClass="text-slate-700" />
              <Stat label="Summa" value={fmt(summary?.totalAmount)} suffix="UZS" valueClass="text-violet-700" />
              <Stat label="Tushgan" value={summary?.matchedCount || 0} valueClass="text-emerald-700" />
              <Stat label="Tushgan summa" value={fmt(summary?.matchedAmount)} suffix="UZS" valueClass="text-emerald-700" />
              <Stat label="Qolgan" value={summary?.missingCount || 0} valueClass="text-rose-700" />
              <Stat label="Qolgan summa" value={fmt(summary?.missingAmount)} suffix="UZS" valueClass="text-rose-700" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {syncRunning ? (
              <Button variant="outline" size="sm" onClick={() => cancelSyncMut.mutate()} disabled={cancelSyncMut.isPending} className="gap-1.5">
                <X className="h-3.5 w-3.5" /> To'xtatish
              </Button>
            ) : (
              <Button size="sm" onClick={() => startSyncMut.mutate()} disabled={startSyncMut.isPending} className="gap-1.5 bg-violet-600 hover:bg-violet-700">
                {startSyncMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                CRM dan sync
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => matchAllMut.mutate()} disabled={matchAllMut.isPending || matchRunning} className="gap-1.5">
              {(matchAllMut.isPending || matchRunning) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Qolganlarni tekshirish
            </Button>
          </div>
        </div>

        {/* ═══ PROGRESS PANEL ═══ */}
        {(syncRunning || matchRunning) && (
          <div className="rounded-lg ring-1 ring-violet-200 bg-violet-50 px-4 py-2.5 text-[12px] space-y-1">
            {syncRunning && syncStatusQuery.data?.progress && (
              <div className="flex items-center gap-3 flex-wrap">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600" />
                <span className="font-semibold text-violet-900">
                  Sync: page {syncStatusQuery.data.progress.page}/{syncStatusQuery.data.progress.lastPage || '?'}
                </span>
                <span className="text-violet-700">keldi {fmt(syncStatusQuery.data.progress.fetched)}</span>
                <span className="text-violet-700">xonpay {fmt(syncStatusQuery.data.progress.xonpay)}</span>
                <span className="text-emerald-700">+{syncStatusQuery.data.progress.inserted} yangi</span>
                <span className="text-amber-700">~{syncStatusQuery.data.progress.updated} update</span>
                <span className="text-blue-700">{syncStatusQuery.data.progress.matched} matched</span>
                {syncStatusQuery.data.progress.errors > 0 && <span className="text-rose-700">{syncStatusQuery.data.progress.errors} xato</span>}
              </div>
            )}
            {matchRunning && matchStatusQuery.data?.progress && (
              <div className="flex items-center gap-3 flex-wrap">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                <span className="font-semibold text-blue-900">Match: {matchStatusQuery.data.progress.done}/{matchStatusQuery.data.progress.total}</span>
                <span className="text-emerald-700">topildi: {matchStatusQuery.data.progress.matched}</span>
              </div>
            )}
          </div>
        )}

        {/* ═══ CRON + SYNC TARIXI ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-3.5 w-3.5 text-amber-600" />
                <h3 className="text-[13px] font-bold">Avtomatik sync</h3>
                {cronInfoQuery.data?.enabled && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Yoqilgan
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-600 space-y-1">
                <div><span className="text-slate-400">Jadval:</span> <span className="font-mono">{cronInfoQuery.data?.schedule || '—'}</span></div>
                <div>
                  <span className="text-slate-400">Oxirgi:</span>{' '}
                  {cronInfoQuery.data?.lastRunAt
                    ? <span className="font-mono">{new Date(cronInfoQuery.data.lastRunAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour12: false }).slice(0, 19)}</span>
                    : <span className="text-slate-400">hali yo'q</span>}
                </div>
                {cronInfoQuery.data?.lastSkipReason && (
                  <div className="text-amber-700 text-[10.5px] flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {cronInfoQuery.data.lastSkipReason}</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardContent className="p-0">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
                <History className="h-3.5 w-3.5 text-violet-600" />
                <h3 className="text-[13px] font-bold">Sync tarixi</h3>
                <span className="text-[10px] text-slate-400">(qo'lda + cron)</span>
              </div>
              {historyQuery.isLoading ? (
                <div className="p-3 space-y-1"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div>
              ) : !historyQuery.data?.items?.length ? (
                <div className="p-5 text-center text-[11px] text-slate-400">Hali sync qilinmagan</div>
              ) : (
                <div className="max-h-[180px] overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-semibold">Vaqt</th>
                        <th className="text-left px-3 py-1.5 font-semibold">Tur</th>
                        <th className="text-left px-3 py-1.5 font-semibold">Kim</th>
                        <th className="text-center px-2 py-1.5 font-semibold">Status</th>
                        <th className="text-right px-2 py-1.5 font-semibold">XonPay</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Yangi</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Matched</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Vaqt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyQuery.data.items.map((h) => {
                        const dur = h.durationMs ? `${(h.durationMs / 1000).toFixed(0)}s` : (h.status === 'running' ? '...' : '—');
                        return (
                          <tr key={h.id} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-mono tabular-nums whitespace-nowrap">
                              {new Date(h.startedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour12: false }).slice(0, 19)}
                            </td>
                            <td className="px-3 py-1.5">
                              <span className={cn(
                                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
                                h.trigger === 'cron' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
                              )}>
                                {h.trigger === 'cron' ? <><Zap className="h-2.5 w-2.5" /> cron</> : <><Activity className="h-2.5 w-2.5" /> qo'lda</>}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 max-w-[140px] truncate" title={h.actorEmail || ''}>{h.actorEmail || (h.trigger === 'cron' ? 'system' : '—')}</td>
                            <td className="px-2 py-1.5 text-center">
                              <span className={cn(
                                'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
                                h.status === 'success' && 'bg-emerald-50 text-emerald-700',
                                h.status === 'running' && 'bg-blue-50 text-blue-700 animate-pulse',
                                h.status === 'failed' && 'bg-rose-50 text-rose-700',
                                h.status === 'cancelled' && 'bg-slate-100 text-slate-700',
                              )}>{h.status}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmt(h.xonpay)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">+{fmt(h.inserted)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-blue-700">{fmt(h.matched)}</td>
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

        {/* ═══ KUNLIK STATISTIKA ═══ */}
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-[13px] font-bold flex items-center gap-2"><TrendingUp className="h-3.5 w-3.5 text-violet-600" /> Kunlik statistika</h2>
              <div className="text-[11px] text-slate-500">{statsQuery.data?.days?.length || 0} kun</div>
            </div>
            {statsQuery.isLoading ? (
              <div className="p-3 space-y-1.5">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
            ) : !statsQuery.data?.days?.length ? (
              <div className="p-8 text-center text-sm text-slate-400">Ma'lumot yo'q</div>
            ) : (
              <div className="overflow-x-auto max-h-[400px]">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Sana</th>
                      <th className="text-right px-3 py-2 font-semibold">Jami</th>
                      <th className="text-right px-3 py-2 font-semibold">Jami (UZS)</th>
                      <th className="text-right px-3 py-2 font-semibold text-emerald-700">Tushgan</th>
                      <th className="text-right px-3 py-2 font-semibold text-emerald-700">Tushgan (UZS)</th>
                      <th className="text-right px-3 py-2 font-semibold text-rose-700">Qolgan</th>
                      <th className="text-right px-3 py-2 font-semibold text-rose-700">Qolgan (UZS)</th>
                      <th className="text-right px-3 py-2 font-semibold">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsQuery.data.days.map((d) => {
                      const pct = d.totalCount > 0 ? Math.round((d.matchedCount / d.totalCount) * 100) : 0;
                      return (
                        <tr key={d.date} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                          onClick={() => { setDateFrom(d.date); setDateTo(d.date); setPage(1); }}
                          title="Bu kunni alohida ko'rish uchun bosing">
                          <td className="px-3 py-1.5 font-mono whitespace-nowrap">{d.date}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{fmt(d.totalCount)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmt(d.totalAmount)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{fmt(d.matchedCount)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{fmt(d.matchedAmount)}</td>
                          <td className={cn('px-3 py-1.5 text-right tabular-nums', d.missingCount > 0 && 'text-rose-700 font-semibold')}>{fmt(d.missingCount)}</td>
                          <td className={cn('px-3 py-1.5 text-right tabular-nums', d.missingCount > 0 && 'text-rose-700 font-semibold')}>{fmt(d.missingAmount)}</td>
                          <td className="px-3 py-1.5 text-right">
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

        {/* ═══ FILTRLAR + RO'YXAT ═══ */}
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-[13px] font-bold flex items-center gap-2">
                <Hash className="h-3.5 w-3.5 text-violet-600" />
                XonPay to'lovlar ro'yxati
                {listQuery.data?.total != null && (
                  <span className="text-[11px] text-slate-500 font-normal">({fmt(listQuery.data.total)} ta)</span>
                )}
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
                    placeholder="Shartnoma, F.I.O., UUID..."
                    className="pl-8 h-9 w-72 text-[12px]" />
                </div>
                <Select value={matched} onValueChange={(v: any) => { setMatched(v); setPage(1); }}>
                  <SelectTrigger className="h-9 w-44 text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Hammasi</SelectItem>
                    <SelectItem value="matched">Tushgan</SelectItem>
                    <SelectItem value="unmatched">Topilmagan</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={dateFrom} max={dateTo} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-9 w-36 text-[12px]" />
                <span className="text-slate-400 text-xs">—</span>
                <Input type="date" value={dateTo} min={dateFrom} max={today} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-9 w-36 text-[12px]" />
              </div>
            </div>

            {listQuery.isLoading ? (
              <div className="p-3 space-y-1">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : !listQuery.data?.items?.length ? (
              <div className="p-12 text-center text-sm text-slate-400">
                Ma'lumot yo'q. Yuqoridagi <b>CRM dan sync</b> tugmasini bosing.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="text-left px-3 py-2 font-bold">Sana</th>
                        <th className="text-left px-3 py-2 font-bold">Shartnoma</th>
                        <th className="text-left px-3 py-2 font-bold">Mijoz</th>
                        <th className="text-right px-3 py-2 font-bold">Summa (UZS)</th>
                        <th className="text-center px-3 py-2 font-bold">Status</th>
                        <th className="text-center px-3 py-2 font-bold">Tx ID</th>
                        <th className="text-right px-3 py-2 font-bold">Amal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listQuery.data.items.map((it) => (
                        <tr key={it.externalId}
                          className="border-t border-slate-100 hover:bg-violet-50/40 cursor-pointer transition-colors"
                          onClick={() => setDetailRow(it)}
                          title="Tafsilotlarni ko'rish uchun bosing"
                        >
                          <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap text-slate-700">
                            {it.datePaid?.slice(0, 10) || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <code className="font-mono text-[11px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded ring-1 ring-indigo-200">
                              {it.contract || '—'}
                            </code>
                          </td>
                          <td className="px-3 py-2 max-w-[220px] truncate" title={it.fullName || ''}>
                            {it.fullName || <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">
                            {fmt(it.amount)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {it.isMatched ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                                <CheckCircle2 className="h-3 w-3" /> Tushgan
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                                <XCircle className="h-3 w-3" /> Topilmagan
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {it.matchedTx?.externalId ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); setInspectId(it.matchedTx!.externalId!); }}
                                title={`Tranzaksiya ID inspector: ${it.matchedTx.externalId}`}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-sm hover:shadow-md hover:shadow-fuchsia-500/40 hover:scale-110 transition-all"
                              >
                                <FileSearch className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <span className="text-slate-300 text-[10px]">—</span>
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
          </CardContent>
        </Card>

        {/* ═══ DETAIL MODAL (row click) ═══ */}
        {detailRow && (
          <XonpayDetailDialog
            row={detailRow}
            locale={locale as string}
            onClose={() => setDetailRow(null)}
            onInspect={(extId) => setInspectId(extId)}
          />
        )}

        {/* ═══ ID INSPECTOR (bank tx ID tekshirish) ═══ */}
        <IdInspectorDialog
          hideTrigger
          controlledOpen={!!inspectId}
          onControlledOpenChange={(o) => { if (!o) setInspectId(null); }}
          initialId={inspectId || ''}
        />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════
//  XONPAY DETAIL DIALOG — row bosilganda to'liq malumot
// ════════════════════════════════════════════════════
function XonpayDetailDialog({
  row, locale, onClose, onInspect,
}: {
  row: XonpayRow;
  locale: string;
  onClose: () => void;
  onInspect: (externalId: string) => void;
}) {
  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 grid place-items-center text-white">
              <Receipt className="h-3.5 w-3.5" />
            </div>
            XonPay to'lov tafsilotlari
            {row.isMatched ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                <CheckCircle2 className="h-3 w-3" /> Tushgan
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                <XCircle className="h-3 w-3" /> Topilmagan
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            CRM XonPay to'lovi {row.isMatched ? "Kapitalbank ga muvaffaqiyatli tushgan" : "Kapitalbank da hali topilmagan"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* ── Asosiy summa karta ── */}
          <div className="rounded-xl bg-gradient-to-br from-violet-50 to-purple-50 ring-1 ring-violet-200 p-4">
            <div className="text-[10px] uppercase tracking-wider text-violet-600 font-bold">Summa</div>
            <div className="text-3xl font-bold tracking-tight tabular-nums text-violet-900 mt-1">
              {fmt(row.amount)} <span className="text-sm text-violet-600 font-normal">UZS</span>
            </div>
            <div className="text-[11px] text-violet-700 mt-1">
              {row.datePaid?.slice(0, 10) || '—'} · {row.fullName || '—'}
            </div>
          </div>

          {/* ── CRM ma'lumotlari ── */}
          <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              CRM ma'lumotlari
            </div>
            <div className="divide-y divide-slate-100">
              <DetailRow label="Shartnoma" value={
                <code className="font-mono text-[12px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded ring-1 ring-indigo-200">
                  {row.contract || '—'}
                </code>
              } />
              <DetailRow label="Mijoz F.I.O." value={row.fullName || '—'} />
              <DetailRow label="Obyekt" value={row.objectName || '—'} />
              <DetailRow label="Type" value={row.type || '—'} />
              <DetailRow label="Category" value={row.category || '—'} />
              <DetailRow label="Status" value={row.status || '—'} />
              <DetailRow label="XonPay UUID" value={
                row.xonpayUuid ? (
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-[11px] text-violet-700">{row.xonpayUuid}</code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(row.xonpayUuid!); toast.success('UUID nusxalandi'); }}
                      className="text-slate-400 hover:text-violet-600"
                      title="Nusxalash"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                ) : <span className="text-rose-600">UUID extract qilinmadi</span>
              } />
              <DetailRow label="CRM external_id" value={
                <code className="font-mono text-[10px] text-slate-600 break-all">{row.externalId}</code>
              } />
              <DetailRow label="Purpose" value={
                <div className="text-[11px] text-slate-600 leading-relaxed">{row.purpose || '—'}</div>
              } />
            </div>
          </div>

          {/* ── Bank tx ma'lumotlari (agar matched) ── */}
          {row.matchedTx ? (
            <div className="rounded-xl ring-1 ring-emerald-200 overflow-hidden">
              <div className="px-3 py-2 bg-emerald-50 text-[11px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Kapitalbank tranzaksiyasi (topilgan)
              </div>
              <div className="divide-y divide-slate-100">
                <DetailRow label="Tx ID (external)" value={
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-[10px] text-emerald-700 break-all">{row.matchedTx.externalId || row.matchedTx.id}</code>
                    {row.matchedTx.externalId && (
                      <button
                        onClick={() => { navigator.clipboard.writeText(row.matchedTx!.externalId!); toast.success('ID nusxalandi'); }}
                        className="text-slate-400 hover:text-emerald-600 shrink-0"
                        title="Nusxalash"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                } />
                <DetailRow label="Sana" value={row.matchedTx.txnDate?.slice(0, 10) || '—'} />
                <DetailRow label="Summa" value={
                  <span className="font-bold tabular-nums">{fmt(row.matchedTx.amount)} UZS</span>
                } />
                <DetailRow label="Description" value={
                  <div className="text-[11px] text-slate-600 leading-relaxed line-clamp-3">{row.matchedTx.description || '—'}</div>
                } />
              </div>
              <div className="px-3 py-2 bg-emerald-50/50 flex items-center justify-end gap-2 border-t border-emerald-100">
                {row.matchedTx.externalId && (
                  <Button variant="outline" size="sm" onClick={() => onInspect(row.matchedTx!.externalId!)} className="gap-1.5 h-8 text-[11px]">
                    <FileSearch className="h-3.5 w-3.5" /> ID inspector
                  </Button>
                )}
                <Link href={`/${locale}/transactions?id=${encodeURIComponent(row.matchedTx.id)}`}>
                  <Button size="sm" className="gap-1.5 h-8 text-[11px] bg-emerald-600 hover:bg-emerald-700">
                    <ExternalLink className="h-3.5 w-3.5" /> Tranzaksiyalar sahifasida ochish
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-rose-200 bg-rose-50 p-4 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-[12px] text-rose-800">
                <div className="font-bold">Kapitalbank da topilmadi</div>
                <div className="text-[11px] text-rose-700 mt-0.5">
                  Bu to'lov XonPay'dan jo'natilgan lekin bizning bank hisoblariga hali tushmagan (yoki UUID mos kelmagan).
                  Yuqoridagi <b>Tekshirish</b> tugmasi orqali qayta tekshiring.
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
      <div className="text-slate-500 font-medium">{label}</div>
      <div className="text-slate-800 min-w-0">{value}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════
function Stat({ label, value, suffix, valueClass }: { label: string; value: string | number; suffix?: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-slate-500">{label}:</span>
      <span className={cn('font-bold tabular-nums', valueClass || 'text-slate-700')}>
        {typeof value === 'number' ? fmt(value) : value}
      </span>
      {suffix && <span className="text-[10px] text-slate-400 font-normal">{suffix}</span>}
    </div>
  );
}
