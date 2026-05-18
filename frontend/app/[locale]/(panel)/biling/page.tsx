'use client';
// rebuild trigger — biling v2 (obyekt + collapsible + skip 100%)

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CreditCard, RefreshCw, Search, CheckCircle2, AlertCircle, XCircle, Loader2,
  TrendingUp, Hash, Calendar, ExternalLink, Play, X, History, Zap,
  Receipt, Activity, ChevronLeft, ChevronRight, Eye, Copy, FileSearch,
  ChevronDown, ChevronUp, Home, ScanLine, Trash2, ArrowUpRight, ArrowDownLeft,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
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

  const cronInfoQuery = useQuery<{ enabled: boolean; schedule: string; lastRunAt: string | null; lastFinishedAt: string | null; lastSkipReason: string | null; lastResult: any }>({
    queryKey: ['xonpay-cron-info'],
    queryFn: () => api.get('/xonpay/cron/info'),
    refetchInterval: 60000,
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
    onError: (e: any) => toast.error(e?.message || 'Sync boshlanmadi'),
  });
  const cancelSyncMut = useMutation({
    mutationFn: () => api.post('/xonpay/sync/cancel', {}),
    onSuccess: () => { toast.message("Sync bekor qilish so'raldi"); qc.invalidateQueries({ queryKey: ['xonpay-sync-status'] }); },
  });
  const cancelByIdMut = useMutation({
    mutationFn: (logId: string) => api.post<{ ok: true; cancelled: boolean; message: string }>(`/xonpay/sync/history/${logId}/cancel`, {}),
    onSuccess: (r) => {
      toast[r.cancelled ? 'success' : 'message'](r.message);
      qc.invalidateQueries({ queryKey: ['xonpay-history'] });
      qc.invalidateQueries({ queryKey: ['xonpay-sync-status'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Bekor qilish xato'),
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
      <Topbar title="Biling" subtitle="XonPay to'lovlar va Kapitalbank tushumlari moslashtirilishi" />
      <div className="px-6 py-6 space-y-5 max-w-[1700px] mx-auto w-full">
        {/* ═══ HEADER (chiroyli KPI kartalar) ═══ */}
        <div className="flex items-center gap-3 mb-1">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 grid place-items-center text-white shadow-lg shadow-violet-500/20">
            <Receipt className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Biling</h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCardModern
            label="Jami XonPay"
            count={summary?.totalCount || 0}
            amount={summary?.totalAmount || '0'}
            color="violet"
            icon={<Receipt className="h-4 w-4" />}
            loading={statsQuery.isLoading}
          />
          <KpiCardModern
            label="Kapitalga tushgan"
            count={summary?.matchedCount || 0}
            amount={summary?.matchedAmount || '0'}
            color="emerald"
            icon={<CheckCircle2 className="h-4 w-4" />}
            loading={statsQuery.isLoading}
            extra={summary && Number(summary.totalCount) > 0
              ? `${Math.round((Number(summary.matchedCount) / Number(summary.totalCount)) * 100)}% mos`
              : undefined}
          />
          <KpiCardModern
            label="Topilmagan (qolgan)"
            count={summary?.missingCount || 0}
            amount={summary?.missingAmount || '0'}
            color="rose"
            icon={<AlertCircle className="h-4 w-4" />}
            loading={statsQuery.isLoading}
          />
        </div>

        {/* Compact inline indicator — modul yopilgan paytda ham progress ko'rinsin */}
        {(syncRunning || matchRunning) && !progressModalOpen && (
          <button onClick={() => { setProgressModalOpen(true); setProgressModalDismissed(false); }}
            title="Sync progressini ko'rsatish"
            className="w-full rounded-lg ring-1 ring-violet-200 bg-violet-50 hover:bg-violet-100 transition-colors px-4 py-2.5 text-[12px] flex items-center gap-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600 shrink-0" />
            <span className="font-semibold text-violet-900">
              {syncRunning ? 'Sync ishlamoqda' : 'Match ishlamoqda'} —
            </span>
            <span className="text-violet-700">
              {syncRunning && syncStatusQuery.data?.progress
                ? `page ${syncStatusQuery.data.progress.page}, +${syncStatusQuery.data.progress.inserted} yangi, ${syncStatusQuery.data.progress.matched} matched`
                : matchRunning && matchStatusQuery.data?.progress
                  ? `${matchStatusQuery.data.progress.done}/${matchStatusQuery.data.progress.total}`
                  : ''}
            </span>
            <span className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-md bg-violet-100 text-violet-600 ring-1 ring-violet-200">
              <Eye className="h-3.5 w-3.5" />
            </span>
          </button>
        )}

        {/* ═══ SYNC TARIXI (header'da: cron info + sync + match + tozalash icon tugmalari) ═══ */}
        <Card>
          <CardContent className="p-0">
            <div className="w-full px-4 py-3 flex items-center gap-2 hover:bg-slate-50 transition-colors border-b border-slate-100">
              <button onClick={() => setHistoryOpen(o => !o)} className="flex items-center gap-2 flex-1 text-left">
                <History className="h-3.5 w-3.5 text-violet-600" />
                <h3 className="text-[13px] font-bold">Sync tarixi <span className="text-[10px] text-slate-400 font-normal">(qo'lda + cron)</span></h3>
                {historyQuery.data?.items?.length != null && (
                  <span className="text-[10.5px] text-slate-500">{historyQuery.data.items.length} ta</span>
                )}
              </button>

              {/* CRM dan sync — icon tugma */}
              {syncRunning ? (
                <button
                  onClick={() => cancelSyncMut.mutate()}
                  disabled={cancelSyncMut.isPending}
                  title="Sync ni to'xtatish"
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-rose-50 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100 transition-all"
                >
                  {cancelSyncMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                </button>
              ) : (
                <button
                  onClick={() => startSyncMut.mutate()}
                  disabled={startSyncMut.isPending}
                  title="CRM dan sync"
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-violet-600 text-white hover:bg-violet-700 shadow-sm hover:shadow-md hover:shadow-violet-500/30 transition-all"
                >
                  {startSyncMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </button>
              )}

              {/* Qolganlarni tekshirish — icon */}
              <button
                onClick={() => matchAllMut.mutate()}
                disabled={matchAllMut.isPending || matchRunning}
                title="Qolganlarni tekshirish (match-all)"
                className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-blue-50 text-blue-700 ring-1 ring-blue-200 hover:bg-blue-100 transition-all disabled:opacity-50"
              >
                {(matchAllMut.isPending || matchRunning) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </button>

              {/* Tozalash (orphan'lar) — icon */}
              <button
                onClick={() => setCleanupModalOpen(true)}
                title="CRM da yo'q (orphan) yozuvlarni tozalash"
                className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-orange-50 text-orange-700 ring-1 ring-orange-200 hover:bg-orange-100 transition-all"
              >
                <Trash2 className="h-4 w-4" />
              </button>

              {/* Cron info — icon + popover */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Avtomatik sync (cron) haqida"
                    className={cn(
                      'inline-flex items-center justify-center w-8 h-8 rounded-md transition-all ring-1',
                      cronInfoQuery.data?.enabled
                        ? 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100'
                        : 'bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100',
                    )}
                  >
                    <Zap className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="p-3 w-72">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="h-3.5 w-3.5 text-amber-600" />
                    <h4 className="text-[12px] font-bold">Avtomatik sync (cron)</h4>
                    {cronInfoQuery.data?.enabled && (
                      <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Yoqilgan
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-600 space-y-1.5">
                    <div><span className="text-slate-400">Jadval:</span> <div className="font-mono text-[10.5px] mt-0.5">{cronInfoQuery.data?.schedule || '—'}</div></div>
                    <div>
                      <span className="text-slate-400">Oxirgi:</span>{' '}
                      {cronInfoQuery.data?.lastRunAt
                        ? <span className="font-mono">{new Date(cronInfoQuery.data.lastRunAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour12: false }).slice(0, 19)}</span>
                        : <span className="text-slate-400">hali yo'q</span>}
                    </div>
                    {cronInfoQuery.data?.lastSkipReason && (
                      <div className="text-amber-700 text-[10.5px] flex items-start gap-1 pt-1 border-t border-slate-100"><AlertCircle className="h-3 w-3 shrink-0 mt-0.5" /> {cronInfoQuery.data.lastSkipReason}</div>
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <button onClick={() => setHistoryOpen(o => !o)} className="text-slate-400 hover:text-slate-700 ml-1">
                {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>
              {historyOpen && (
                <>
              {/* Filter qator */}
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 flex-wrap bg-slate-50/50">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                  <Input
                    value={histQ}
                    onChange={(e) => setHistQ(e.target.value)}
                    placeholder="Ism yoki email..."
                    className="pl-7 h-8 w-52 text-[11px]"
                  />
                </div>
                <Select value={histStatus} onValueChange={(v: any) => setHistStatus(v)}>
                  <SelectTrigger className="h-8 w-32 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Barcha status</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={histDateFrom} max={histDateTo || today}
                  onChange={(e) => setHistDateFrom(e.target.value)}
                  className="h-8 w-36 text-[11px]" />
                <span className="text-slate-400 text-[10px]">—</span>
                <Input type="date" value={histDateTo} min={histDateFrom} max={today}
                  onChange={(e) => setHistDateTo(e.target.value)}
                  className="h-8 w-36 text-[11px]" />
                {(histQ || histStatus !== 'all' || histDateFrom || histDateTo) && (
                  <Button variant="ghost" size="sm" onClick={() => { setHistQ(''); setHistStatus('all'); setHistDateFrom(''); setHistDateTo(''); }} className="h-8 text-[11px] text-slate-500">
                    Tozalash
                  </Button>
                )}
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
                        <th className="text-center px-2 py-1.5 font-semibold">Amal</th>
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
                            <td className="px-3 py-1.5 max-w-[180px] truncate" title={`${h.actorName || ''} (${h.actorEmail || ''})`}>
                              {h.actorName || h.actorEmail || (h.trigger === 'cron' ? 'system' : '—')}
                            </td>
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
                            <td className="px-2 py-1.5 text-center">
                              {h.status === 'running' && (
                                <button
                                  onClick={() => cancelByIdMut.mutate(h.id)}
                                  disabled={cancelByIdMut.isPending}
                                  title="Bu sync ni to'xtatish"
                                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-rose-600 hover:bg-rose-50 hover:text-rose-700 ring-1 ring-rose-200 transition-all"
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
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors border-b border-slate-100">
              <h2 className="text-[13px] font-bold flex items-center gap-2"><TrendingUp className="h-3.5 w-3.5 text-violet-600" /> Kunlik statistika</h2>
              <div className="flex items-center gap-3">
                <div className="text-[11px] text-slate-500">{statsQuery.data?.days?.length || 0} kun</div>
                {dailyOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
              </div>
            </button>
            {dailyOpen && <>
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
            </>}
          </CardContent>
        </Card>

        {/* ═══ FILTRLAR + RO'YXAT (collapsible) ═══ */}
        <Card>
          <CardContent className="p-0">
            <button onClick={() => setListOpen(o => !o)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors border-b border-slate-100">
              <h2 className="text-[13px] font-bold flex items-center gap-2">
                <Hash className="h-3.5 w-3.5 text-violet-600" />
                XonPay to'lovlar ro'yxati
                {listQuery.data?.total != null && (
                  <span className="text-[11px] text-slate-500 font-normal">({fmt(listQuery.data.total)} ta)</span>
                )}
              </h2>
              {listOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>
            {listOpen && (<>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-end gap-2 flex-wrap">
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
                        <th className="text-left px-3 py-2 font-bold">Obyekt</th>
                        <th className="text-left px-3 py-2 font-bold">Shartnoma</th>
                        <th className="text-left px-3 py-2 font-bold">Mijoz</th>
                        <th className="text-right px-3 py-2 font-bold">Summa (UZS)</th>
                        <th className="text-center px-3 py-2 font-bold">Status</th>
                        <th className="text-center px-3 py-2 font-bold">Tx</th>
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
                          <td className="px-3 py-2 max-w-[180px] truncate" title={it.objectName || ''}>
                            {it.objectName
                              ? <span className="text-[11.5px] text-slate-700">{it.objectName}</span>
                              : <span className="text-slate-300 text-[10px]">—</span>}
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
                              <Link
                                href={`/${locale}/transactions?searchId=${encodeURIComponent(it.matchedTx.externalId)}`}
                                onClick={(e) => e.stopPropagation()}
                                title={`Tranzaksiyalar sahifasida ochish: ${it.matchedTx.externalId}`}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-sm hover:shadow-md hover:shadow-fuchsia-500/40 hover:scale-110 transition-all"
                              >
                                <ScanLine className="h-3.5 w-3.5" />
                              </Link>
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
              <DetailRow label="Obyekt" value={
                row.objectName
                  ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11.5px] font-medium text-slate-700 bg-slate-50 ring-1 ring-slate-200">
                      <Home className="h-3 w-3 text-slate-500" /> {row.objectName}
                    </span>
                  : '—'
              } />
              <DetailRow label="Shartnoma" value={
                <code className="font-mono text-[12px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded ring-1 ring-indigo-200">
                  {row.contract || '—'}
                </code>
              } />
              <DetailRow label="Mijoz F.I.O." value={row.fullName || '—'} />
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
                  <Link href={`/${locale}/transactions?searchId=${encodeURIComponent(row.matchedTx.externalId)}`}>
                    <Button size="sm" className="gap-1.5 h-8 text-[11px] bg-emerald-600 hover:bg-emerald-700">
                      <ScanLine className="h-3.5 w-3.5" /> Tranzaksiyani ochish
                    </Button>
                  </Link>
                )}
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
  const isActive = syncRunning || matchRunning;
  const elapsedSec = syncStartedAt
    ? Math.floor((Date.now() - new Date(syncStartedAt).getTime()) / 1000)
    : 0;
  const elapsedStr = elapsedSec >= 60
    ? `${Math.floor(elapsedSec / 60)} daq ${elapsedSec % 60}s`
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
              isActive ? 'bg-gradient-to-br from-violet-500 to-purple-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600',
            )}>
              {isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </div>
            {syncRunning && 'Sync ishlamoqda'}
            {matchRunning && !syncRunning && 'Match ishlamoqda'}
            {!isActive && (syncFinishedAt ? 'Sync tugadi' : 'Sync holati')}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {syncRunning && `CRM dan XonPay to'lovlari yuklanmoqda · ${elapsedStr}`}
            {matchRunning && !syncRunning && 'Topilmagan to\'lovlar Kapitalbank bilan moslashtirilmoqda'}
            {!isActive && syncFinishedAt && `Yakunlandi: ${new Date(syncFinishedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', hour12: false }).slice(0, 19)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* ── SYNC PROGRESS ── */}
          {sp && (
            <div className="space-y-3">
              {/* Progress bar */}
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="font-semibold text-slate-700">
                    Sahifa {sp.page} / {sp.lastPage || '?'}
                  </span>
                  <span className="text-violet-700 font-bold">{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-violet-100 overflow-hidden">
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
                <ProgressStat label="CRM dan keldi" value={fmt(sp.fetched)} color="slate" />
                <ProgressStat label="XonPay" value={fmt(sp.xonpay)} color="violet" />
                <ProgressStat label="Yangi" value={`+${fmt(sp.inserted)}`} color="emerald" />
                <ProgressStat label="Yangilangan" value={`~${fmt(sp.updated)}`} color="amber" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <ProgressStat label="Matched" value={fmt(sp.matched)} color="blue" icon={<CheckCircle2 className="h-3 w-3" />} />
                <ProgressStat label="Xatolar" value={fmt(sp.errors)} color={sp.errors > 0 ? 'rose' : 'slate'} icon={sp.errors > 0 ? <XCircle className="h-3 w-3" /> : undefined} />
                <ProgressStat label="Vaqt" value={elapsedStr} color="slate" icon={<Activity className="h-3 w-3" />} />
                <ProgressStat label="Holat" value={syncRunning ? 'ishlamoqda' : 'tugadi'} color={syncRunning ? 'violet' : 'emerald'} />
              </div>
            </div>
          )}

          {/* ── MATCH PROGRESS ── */}
          {matchRunning && matchProgress && (
            <div className="border-t pt-3">
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="font-semibold text-blue-700 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Match: {matchProgress.done}/{matchProgress.total}
                </span>
                <span className="text-emerald-700 font-bold">{matchProgress.matched} topildi</span>
              </div>
              <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 animate-pulse transition-all"
                  style={{ width: `${matchProgress.total > 0 ? Math.min(100, Math.round((matchProgress.done / matchProgress.total) * 100)) : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* ── XATO ── */}
          {syncLastError && !syncRunning && (
            <div className="rounded-lg ring-1 ring-rose-200 bg-rose-50 p-3 text-[11.5px] text-rose-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div><b>Xato:</b> {syncLastError}</div>
            </div>
          )}

          {/* ── INFO ── */}
          {syncRunning && (
            <div className="rounded-lg ring-1 ring-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                Sync fonda davom etadi. Bu modul yopilsa ham sync to'xtamaydi.
                <br />
                <b>100% matched kunlar avtomatik skip qilinadi</b> — qaytadan tekshirilmaydi.
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
                className="gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700"
              >
                {cancelPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                Sync ni to'xtatish
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              {isActive ? 'Modulni yopish (sync davom etadi)' : 'Yopish'}
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
    violet:  { bg: 'bg-violet-50',  text: 'text-violet-700',  ring: 'ring-violet-200' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-200' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-200' },
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-700',    ring: 'ring-blue-200' },
    slate:   { bg: 'bg-slate-50',   text: 'text-slate-700',   ring: 'ring-slate-200' },
  }[color];
  return (
    <div className={cn('rounded-lg ring-1 ring-inset px-3 py-2', m.bg, m.ring)}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
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
      setLastError(e?.message || 'Xato');
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
            XonPay ma'lumotlarini tozalash
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Jadvalni to'liq tozalaydi (TRUNCATE). Bog'langan bank tx'lar tegmaydi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* ── IDLE: warning + confirm trigger ── */}
          {phase === 'idle' && (
            <>
              <div className="rounded-2xl ring-1 ring-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 p-5 text-center">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 grid place-items-center text-white shadow-lg shadow-rose-500/30 mb-3">
                  <AlertCircle className="h-7 w-7" />
                </div>
                <div className="text-[14px] font-bold text-rose-900 mb-1">Diqqat — xavfli amal</div>
                <div className="text-[12px] text-rose-700">
                  Barcha <b>XonpayTransaction</b> yozuvlari (taxminan ~19k ta) butunlay o'chiriladi.
                  Bog'langan Transaction'lar (bank tx) saqlanadi, faqat <code className="font-mono text-[11px] bg-white/60 px-1 rounded">matched_tx_id</code> link uzipladi.
                </div>
              </div>
              <div className="rounded-lg ring-1 ring-amber-200 bg-amber-50 p-3 text-[11.5px] text-amber-800 flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div>Tozalangandan keyin <b>"CRM dan sync"</b> tugmasini bosib qaytadan to'ldirishingiz mumkin (avtomatik boshlanmaydi).</div>
              </div>
            </>
          )}

          {/* ── CONFIRM step ── */}
          {phase === 'confirm' && (
            <div className="rounded-2xl ring-2 ring-rose-300 bg-rose-50 p-5 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-600 grid place-items-center text-white shadow-lg shadow-rose-500/40 mb-3 animate-pulse">
                <AlertCircle className="h-7 w-7" />
              </div>
              <div className="text-[14px] font-bold text-rose-900 mb-2">Aniqmi?</div>
              <div className="text-[12px] text-rose-700">
                Bu amal qaytarib bo'lmaydi. "Ha, o'chirish" tugmasini bosing tasdiqlash uchun.
              </div>
            </div>
          )}

          {/* ── TRUNCATING ── */}
          {phase === 'truncating' && (
            <div className="rounded-2xl ring-1 ring-violet-200 bg-violet-50 p-5 text-center">
              <Loader2 className="h-10 w-10 mx-auto animate-spin text-violet-600 mb-3" />
              <div className="text-[13px] font-bold text-violet-900">Tozalanmoqda...</div>
              <div className="text-[11px] text-violet-600 mt-1">Bir necha soniya...</div>
            </div>
          )}

          {/* ── DONE ── */}
          {phase === 'done' && (
            <div className="rounded-2xl ring-1 ring-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-5 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow-lg shadow-emerald-500/30 mb-3">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div className="text-[14px] font-bold text-emerald-900 mb-1">Tugadi!</div>
              <div className="text-[24px] font-bold text-emerald-700 tabular-nums">{fmt(deletedCount || 0)}</div>
              <div className="text-[11px] text-emerald-600 mt-0.5">ta yozuv o'chirildi</div>
              <div className="text-[11px] text-emerald-700 mt-3">
                Endi "CRM dan sync" tugmasini bosib qaytadan to'ldiring.
              </div>
            </div>
          )}

          {/* ── ERROR ── */}
          {lastError && (
            <div className="rounded-lg ring-1 ring-rose-200 bg-rose-50 p-3 text-[12px] text-rose-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div><b>Xato:</b> {lastError}</div>
            </div>
          )}

          {/* ── Tugmalar ── */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            {phase === 'idle' && (
              <>
                <Button variant="outline" onClick={onClose}>Bekor qilish</Button>
                <Button onClick={() => setPhase('confirm')} className="gap-1.5 bg-rose-600 hover:bg-rose-700">
                  <Trash2 className="h-3.5 w-3.5" /> O'chirish
                </Button>
              </>
            )}
            {phase === 'confirm' && (
              <>
                <Button variant="outline" onClick={() => setPhase('idle')}>Orqaga</Button>
                <Button onClick={doTruncate} className="gap-1.5 bg-rose-600 hover:bg-rose-700">
                  <Trash2 className="h-3.5 w-3.5" /> Ha, o'chirish
                </Button>
              </>
            )}
            {busy && (
              <Button variant="outline" disabled className="gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Kuting...
              </Button>
            )}
            {(phase === 'done' || phase === 'error') && (
              <Button onClick={onClose}>Yopish</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoBox({ label, value, color }: { label: string; value: string; color?: 'violet' | 'emerald' | 'rose' | 'slate' }) {
  const m = {
    violet:  'text-violet-700 bg-violet-50 ring-violet-200',
    emerald: 'text-emerald-700 bg-emerald-50 ring-emerald-200',
    rose:    'text-rose-700 bg-rose-50 ring-rose-200',
    slate:   'text-slate-700 bg-slate-50 ring-slate-200',
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
  label, count, amount, color, icon, loading, extra,
}: {
  label: string;
  count: number;
  amount: string;
  color: 'violet' | 'emerald' | 'rose';
  icon: React.ReactNode;
  loading: boolean;
  extra?: string;
}) {
  const m = {
    violet:  { bg: 'from-violet-500/10 to-purple-500/5', ring: 'ring-violet-200', text: 'text-violet-700', accent: 'from-violet-500 to-purple-600' },
    emerald: { bg: 'from-emerald-500/10 to-teal-500/5',  ring: 'ring-emerald-200', text: 'text-emerald-700', accent: 'from-emerald-500 to-teal-600' },
    rose:    { bg: 'from-rose-500/10 to-pink-500/5',     ring: 'ring-rose-200', text: 'text-rose-700', accent: 'from-rose-500 to-pink-600' },
  }[color];
  return (
    <div className={cn('relative overflow-hidden rounded-2xl ring-1 bg-gradient-to-br p-4 shadow-sm', m.bg, m.ring)}>
      <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-10 bg-gradient-to-br" />
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500">{label}</div>
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
            {fmt(amount)} <span className="text-xs text-slate-500 font-normal">UZS</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums font-semibold">
            {fmt(count)} ta to'lov
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
      <span className="text-slate-500">{label}:</span>
      <span className={cn('font-bold tabular-nums', valueClass || 'text-slate-700')}>
        {typeof value === 'number' ? fmt(value) : value}
      </span>
      {suffix && <span className="text-[10px] text-slate-400 font-normal">{suffix}</span>}
    </div>
  );
}
