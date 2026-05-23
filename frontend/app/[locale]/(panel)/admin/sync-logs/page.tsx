'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2, XCircle, Loader2, AlertTriangle, Activity, Clock,
  TrendingUp, Zap, Database, RefreshCcw, Search, X, History, Settings, ShieldAlert, Save,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown,
  Plus, Trash2, ArrowRight, Building2,
} from 'lucide-react';
// Clock allaqachon import qilingan
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { Sparkline } from '@/components/sparkline';
import { api } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';

const STATUS_CONFIG: Record<string, { icon: any; label: string; cls: string; dot: string }> = {
  SUCCESS: { icon: CheckCircle2, label: 'Muvaffaqiyatli', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  FAILED:  { icon: XCircle, label: 'Xato', cls: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  RUNNING: { icon: Loader2, label: 'Bajarilmoqda', cls: 'bg-blue-50 text-blue-700 ring-blue-200', dot: 'bg-blue-500' },
  PARTIAL: { icon: AlertTriangle, label: 'Qisman', cls: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
};

const STATUS_FILTERS = [
  { value: 'all', label: 'Barchasi' },
  { value: 'SUCCESS', label: 'Muvaffaqiyatli' },
  { value: 'FAILED', label: 'Xato' },
  { value: 'PARTIAL', label: 'Qisman' },
  { value: 'RUNNING', label: 'Bajarilmoqda' },
  { value: 'BACKFILL', label: 'Tarix yuklash' },
];

const isBackfillLog = (l: any) => (l.source || '').includes('backfill');

type SubTab = 'history' | 'settings';

const PAGE_SIZE = 20;

export default function SyncLogsPage() {
  const [subTab, setSubTab] = useState<SubTab>('history');
  const [statusFilter, setStatusFilter] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  // Filter o'zgarganda 1-sahifaga qaytamiz
  useEffect(() => { setPage(1); }, [statusFilter, q]);

  const { data, isLoading } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: () => api.get<{ items: any[] }>('/sync/logs?limit=200'),
    refetchInterval: 10_000,
  });

  // Filtr — status / backfill + qidiruv (hisob raqami / egasi / xato matni)
  const filtered = useMemo(() => {
    let items = data?.items || [];
    if (statusFilter === 'BACKFILL') items = items.filter(isBackfillLog);
    else if (statusFilter !== 'all') items = items.filter((l) => l.status === statusFilter);
    const ql = q.trim().toLowerCase();
    if (ql) {
      items = items.filter((l) =>
        (l.source || '').toLowerCase().includes(ql) ||
        (l.errorMessage || '').toLowerCase().includes(ql),
      );
    }
    return items;
  }, [data, statusFilter, q]);

  const stats = useMemo(() => {
    const items = data?.items || [];
    const success = items.filter((l) => l.status === 'SUCCESS').length;
    const failed = items.filter((l) => l.status === 'FAILED').length;
    const totalFetched = items.reduce((s, l) => s + (l.fetched || 0), 0);
    const totalSaved = items.reduce((s, l) => s + (l.saved || 0), 0);
    const avgDuration = items.length
      ? Math.round(items.filter((l) => l.durationMs).reduce((s, l) => s + l.durationMs, 0) / items.filter((l) => l.durationMs).length)
      : 0;
    const successRate = items.length > 0 ? Math.round((success / items.length) * 100) : 0;
    return { success, failed, totalFetched, totalSaved, avgDuration, successRate, count: items.length };
  }, [data]);

  // Mini sparkline from last N logs durations
  const durationSpark = (data?.items || []).slice(0, 20).reverse().map((l) => l.durationMs || 0);

  return (
    <>
      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full">
        {/* Sub-tab bar — Tarix / Sozlamalar */}
        <div className="inline-flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl">
          <button
            onClick={() => setSubTab('history')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] font-semibold transition-colors',
              subTab === 'history' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <History className="h-3.5 w-3.5" /> Tarix
          </button>
          <button
            onClick={() => setSubTab('settings')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] font-semibold transition-colors',
              subTab === 'settings' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <Settings className="h-3.5 w-3.5" /> Sozlamalar
          </button>
        </div>

        {subTab === 'settings' && <SyncSettingsPanel />}

        {subTab === 'history' && <>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold tracking-tight">Sync tarixi</div>
            <div className="text-xs text-slate-500">Banklardan ma'lumot olish jurnali</div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 ring-1 ring-emerald-200 text-[11px] font-medium text-emerald-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Live · 10s yangilanish
          </span>
        </div>

        {/* ═══ KPI ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Muvaffaqiyat darajasi" value={`${stats.successRate}%`} sub={`${stats.success} muvaffaqiyatli`} icon={CheckCircle2} color="emerald" spark={durationSpark} />
          <KpiCard label="Xatolar" value={String(stats.failed)} sub={`${stats.count} ta operatsiya`} icon={XCircle} color="rose" />
          <KpiCard label="Olingan / Saqlangan" value={`${stats.totalFetched} / ${stats.totalSaved}`} sub="Jami tranzaksiya" icon={Database} color="indigo" />
          <KpiCard label="O'rtacha vaqt" value={`${stats.avgDuration} ms`} sub="Bir sync ishi" icon={Zap} color="amber" />
        </div>

        {/* ═══ TIMELINE ═══ */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <CardContent className="p-0">
            <div className="px-6 py-4 border-b border-slate-100 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-base font-semibold tracking-tight flex items-center gap-2">
                    <Activity className="h-4 w-4 text-indigo-600" />
                    Sync tarixi
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">Oxirgi 100 ta operatsiya · har 10 soniyada yangilanadi</div>
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {stats.success}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 ring-1 ring-rose-200 text-rose-700 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> {stats.failed}
                  </span>
                </div>
              </div>

              {/* Filtr — status + qidiruv */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-[11px] font-medium">
                  {STATUS_FILTERS.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => setStatusFilter(f.value)}
                      className={cn(
                        'px-2.5 h-8 rounded-lg transition-colors',
                        statusFilter === f.value ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    className="pl-8 h-9 rounded-xl bg-slate-50/60 text-sm"
                    placeholder="Hisob raqami, egasi yoki xato matni..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  {q && (
                    <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" onClick={() => setQ('')}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {filtered.length} / {data?.items?.length ?? 0}
                </span>
              </div>
            </div>

            {isLoading ? (
              <div className="p-6 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={RefreshCcw}
                title={(data?.items?.length ?? 0) === 0 ? "Sync logi yo'q" : "Filtr bo'yicha topilmadi"}
                description={(data?.items?.length ?? 0) === 0
                  ? "Cron har 5 daqiqada ishlaydi yoki bank hisobini qo'lda sync qilganingizda log yoziladi"
                  : "Filtr yoki qidiruvni o'zgartirib ko'ring"}
              />
            ) : (
              <>
                <div className="divide-y divide-slate-100">
                  {(() => {
                    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
                    const safePage = Math.min(page, totalPages);
                    const start = (safePage - 1) * PAGE_SIZE;
                    const pagedItems = filtered.slice(start, start + PAGE_SIZE);
                    return pagedItems.map((l: any) => {
                      const cfg = STATUS_CONFIG[l.status] || STATUS_CONFIG.SUCCESS;
                      const Icon = cfg.icon;
                      return (
                        <div key={l.id} className="px-6 py-3.5 hover:bg-slate-50/60 transition-colors">
                          <div className="flex items-start gap-4">
                            <div className="shrink-0 mt-0.5">
                              <div className={cn(
                                "w-9 h-9 rounded-xl grid place-items-center ring-1 ring-inset",
                                cfg.cls,
                              )}>
                                <Icon className={cn("h-4 w-4", l.status === 'RUNNING' && 'animate-spin')} />
                              </div>
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={cn(
                                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset",
                                      cfg.cls,
                                    )}>
                                      {cfg.label}
                                    </span>
                                    {isBackfillLog(l) && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200">
                                        Tarix yuklash
                                      </span>
                                    )}
                                    <span className="font-mono text-[11px] text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded">{l.source}</span>
                                    <span className="text-[11px] text-slate-500 tabular-nums">{formatDateTime(l.startedAt)}</span>
                                  </div>
                                  {l.errorMessage && (
                                    <div className="mt-1.5 text-[11px] text-rose-600 line-clamp-2 leading-relaxed">
                                      <AlertTriangle className="h-3 w-3 inline mr-1" /> {l.errorMessage}
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-4 text-[11px] shrink-0">
                                  <Stat icon={Database} value={l.fetched ?? 0} label="olindi" />
                                  <Stat icon={CheckCircle2} value={l.saved ?? 0} label="saqlandi" tone={l.saved > 0 ? 'emerald' : 'slate'} />
                                  {(l.errors ?? 0) > 0 && <Stat icon={XCircle} value={l.errors} label="xato" tone="rose" />}
                                  {l.durationMs && (
                                    <span className="inline-flex items-center gap-1 text-slate-500">
                                      <Clock className="h-3 w-3" />
                                      <span className="font-medium tabular-nums">{l.durationMs} ms</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* Pagination — 20 ta/sahifa */}
                <PaginationBar
                  page={page}
                  totalPages={Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}
                  onChange={setPage}
                />
              </>
            )}
          </CardContent>
        </Card>
        </>}
      </div>
    </>
  );
}

// ═══ SYNC SOZLAMALARI — syncMinDate + oplatykv TX minDate ═══
function SyncSettingsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['sync-settings'],
    queryFn: () => api.get<{
      ok: boolean;
      syncMinDate: string | null;
      oplatykvTxMinDate: string | null;
      oplatykvAutoSyncMinutes: number;
      oplatykvDayStart: string;
      oplatykvDayEnd: string;
      oplatykvNightStart: string;
      oplatykvNightEnd: string;
      oplatykvAutoXatoCleanup: boolean;
    }>('/sync/settings'),
  });
  const [syncMinDate, setSyncMinDate] = useState<string>('');
  const [oplatykvTxMinDate, setOplatykvTxMinDate] = useState<string>('');
  const [oplatykvAutoSyncMinutes, setOplatykvAutoSyncMinutes] = useState<string>('0');
  const [dayStart, setDayStart] = useState<string>('08:00');
  const [dayEnd, setDayEnd] = useState<string>('22:00');
  const [nightStart, setNightStart] = useState<string>('01:00');
  const [nightEnd, setNightEnd] = useState<string>('07:50');
  const [autoXato, setAutoXato] = useState<boolean>(false);
  const [dirty1, setDirty1] = useState(false);
  const [dirty2, setDirty2] = useState(false);
  const [dirty3, setDirty3] = useState(false);
  const [dirty4, setDirty4] = useState(false);  // time windows
  const [dirty5, setDirty5] = useState(false);  // auto xato

  useEffect(() => {
    if (data?.syncMinDate !== undefined) { setSyncMinDate(data.syncMinDate || ''); setDirty1(false); }
    if (data?.oplatykvTxMinDate !== undefined) { setOplatykvTxMinDate(data.oplatykvTxMinDate || ''); setDirty2(false); }
    if (data?.oplatykvAutoSyncMinutes !== undefined) { setOplatykvAutoSyncMinutes(String(data.oplatykvAutoSyncMinutes || 0)); setDirty3(false); }
    if (data?.oplatykvDayStart) { setDayStart(data.oplatykvDayStart); setDirty4(false); }
    if (data?.oplatykvDayEnd) { setDayEnd(data.oplatykvDayEnd); }
    if (data?.oplatykvNightStart) { setNightStart(data.oplatykvNightStart); }
    if (data?.oplatykvNightEnd) { setNightEnd(data.oplatykvNightEnd); }
    if (data?.oplatykvAutoXatoCleanup !== undefined) { setAutoXato(data.oplatykvAutoXatoCleanup); setDirty5(false); }
  }, [data?.syncMinDate, data?.oplatykvTxMinDate, data?.oplatykvAutoSyncMinutes, data?.oplatykvDayStart, data?.oplatykvDayEnd, data?.oplatykvNightStart, data?.oplatykvNightEnd, data?.oplatykvAutoXatoCleanup]);

  const mut = useMutation({
    mutationFn: (vals: any) => api.patch<any>('/sync/settings', vals),
    onSuccess: (r: any) => {
      toast.success("Sozlama saqlandi");
      if (r.syncMinDate !== undefined) { setSyncMinDate(r.syncMinDate || ''); setDirty1(false); }
      if (r.oplatykvTxMinDate !== undefined) { setOplatykvTxMinDate(r.oplatykvTxMinDate || ''); setDirty2(false); }
      if (r.oplatykvAutoSyncMinutes !== undefined) { setOplatykvAutoSyncMinutes(String(r.oplatykvAutoSyncMinutes || 0)); setDirty3(false); }
      if (r.oplatykvDayStart) { setDayStart(r.oplatykvDayStart); setDirty4(false); }
      if (r.oplatykvDayEnd) setDayEnd(r.oplatykvDayEnd);
      if (r.oplatykvNightStart) setNightStart(r.oplatykvNightStart);
      if (r.oplatykvNightEnd) setNightEnd(r.oplatykvNightEnd);
      if (r.oplatykvAutoXatoCleanup !== undefined) { setAutoXato(r.oplatykvAutoXatoCleanup); setDirty5(false); }
      qc.invalidateQueries({ queryKey: ['sync-settings'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Saqlash xato'),
  });

  // Tranzaksiyalardan auto-sync trigger (object lookup ham avtomatik)
  const syncTxMut = useMutation({
    mutationFn: (minDate: string | null) =>
      api.post<{
        ok: boolean; total: number; added: number; updated: number; skipped: number;
        skippedBreakdown?: { noData: number; exists: number; error: number };
        errorSamples?: Array<{ txId: string; reason: string }>;
        objects?: { scanned: number; contracts: number; filled: number; notFound: number; errors: number };
        duration: number;
      }>('/oplata-kv/sync-from-transactions', { minDate }, { timeout: 600_000 }),
    onSuccess: (r: any) => {
      const bd = r.skippedBreakdown || {};
      const skipDetail = [
        bd.noData ? `${bd.noData} data yo'q` : null,
        bd.exists ? `${bd.exists} mavjud` : null,
        bd.error ? `${bd.error} xato` : null,
      ].filter(Boolean).join(', ');
      const msg = `Sync · qo'shildi: ${r.added}, yangilandi: ${r.updated}, o'tkazildi: ${r.skipped}${skipDetail ? ` (${skipDetail})` : ''}${r.duration ? ` · ${r.duration}s` : ''}`;
      toast.success(msg, { duration: 6000 });
      if (r.objectsBackground) {
        toast.info("Obyekt va Mijoz nomlari CRM dan ORQADA to'ldirilyapti — sahifani 1-2 daqiqadan keyin yangilang", { duration: 8000 });
      }
      if (r.errorSamples && r.errorSamples.length > 0) {
        toast.error(`Xato namunalari: ${r.errorSamples.slice(0, 2).map((s: any) => s.reason).join('; ')}`, { duration: 10000 });
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Sync xato'),
  });

  // XATO contractlarni tozalash (CRM da topilmaganlar)
  const cleanupXatoMut = useMutation({
    mutationFn: () => api.delete<{ scanned: number; deleted: number; duration: number }>('/oplata-kv/cleanup-xato-contracts'),
    onSuccess: (r: any) => {
      toast.success(`XATO cleanup: ${r.deleted}/${r.scanned} qator o'chirildi · ${r.duration}s`, { duration: 8000 });
    },
    onError: (e: any) => toast.error(e?.message || 'XATO cleanup xato'),
  });

  // Split installments — qo'lda triggerlash
  const splitMut = useMutation({
    mutationFn: () => api.post<{ total: number; contracts: number; filled: number; notFound: number; errors: number; duration: number }>('/oplata-kv/split-installments', { limit: 5000 }, { timeout: 600_000 }),
    onSuccess: (r: any) => {
      toast.success(
        `Installment split · jami ${r.total} qator (${r.contracts} shartnoma) · to'ldirildi: ${r.filled}, topilmadi: ${r.notFound}, xato: ${r.errors}${r.duration ? ` · ${r.duration}s` : ''}`,
        { duration: 10000 },
      );
    },
    onError: (e: any) => toast.error(e?.message || 'Split xato'),
  });

  // Tranzaksiya-manba qatorlarni tozalash (date range)
  const cleanupTxMut = useMutation({
    mutationFn: (range: { dateFrom: string | null; dateTo: string | null }) => {
      const params = new URLSearchParams();
      if (range.dateFrom) params.set('dateFrom', range.dateFrom);
      if (range.dateTo) params.set('dateTo', range.dateTo);
      const qs = params.toString();
      const url = qs ? `/oplata-kv/cleanup-tx-source?${qs}` : '/oplata-kv/cleanup-tx-source';
      return api.delete<{ ok: boolean; deleted: number; matched: number; dateFrom: string | null; dateTo: string | null }>(url);
    },
    onSuccess: (r: any) => {
      const rangeText = r.dateFrom || r.dateTo
        ? ` (${r.dateFrom || '∞'} → ${r.dateTo || '∞'})`
        : '';
      toast.success(`O'chirildi: ${r.deleted} ta qator${rangeText}`);
    },
    onError: (e: any) => toast.error(e?.message || 'Tozalashda xato'),
  });

  // Cleanup uchun sana oralig'i
  const [cleanupDateFrom, setCleanupDateFrom] = useState<string>('');
  const [cleanupDateTo, setCleanupDateTo] = useState<string>('');

  // Accordion holati — kartochkalar default yashirin
  const [openSync, setOpenSync] = useState(false);
  const [openOplata, setOpenOplata] = useState(false);

  // Object mapping — CRUD
  const mappingsQuery = useQuery({
    queryKey: ['oplatykv-object-mappings'],
    queryFn: () => api.get<{ ok: boolean; items: Array<{ id: string; crmName: string; oplataName: string; createdAt: string; createdByName: string | null }> }>('/oplata-kv/object-mappings'),
  });
  const [newCrmName, setNewCrmName] = useState('');
  const [newOplataName, setNewOplataName] = useState('');

  const addMappingMut = useMutation({
    mutationFn: () => api.post<any>('/oplata-kv/object-mappings', { crmName: newCrmName.trim(), oplataName: newOplataName.trim() }),
    onSuccess: () => {
      toast.success("Mapping qo'shildi");
      setNewCrmName('');
      setNewOplataName('');
      qc.invalidateQueries({ queryKey: ['oplatykv-object-mappings'] });
    },
    onError: (e: any) => toast.error(e?.message || "Qo'shishda xato"),
  });

  const deleteMappingMut = useMutation({
    mutationFn: (id: string) => api.delete<any>(`/oplata-kv/object-mappings/${id}`),
    onSuccess: () => {
      toast.success("O'chirildi");
      qc.invalidateQueries({ queryKey: ['oplatykv-object-mappings'] });
    },
    onError: (e: any) => toast.error(e?.message || "O'chirishda xato"),
  });

  function handleCleanup() {
    const range = { dateFrom: cleanupDateFrom || null, dateTo: cleanupDateTo || null };
    let msg: string;
    if (range.dateFrom && range.dateTo) {
      msg = `${range.dateFrom} dan ${range.dateTo} gacha bo'lgan tranzaksiya-manba qatorlarni o'chirishni xohlaysizmi?\n\nBu amal qaytarib bo'lmaydi!`;
    } else if (range.dateFrom) {
      msg = `${range.dateFrom} dan keyingi (shu kun bilan birga) tranzaksiya-manba qatorlarni o'chirishni xohlaysizmi?`;
    } else if (range.dateTo) {
      msg = `${range.dateTo} gacha (shu kun bilan birga) tranzaksiya-manba qatorlarni o'chirishni xohlaysizmi?`;
    } else {
      msg = "BARCHA tranzaksiya-manba qatorlarni o'chirishni xohlaysizmi?\n\nBu amal qaytarib bo'lmaydi!";
    }
    if (!confirm(msg)) return;
    cleanupTxMut.mutate(range);
  }

  return (
    <div className="space-y-4">
      {/* SYNC MINIMAL SANA — collapsible */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <button
          type="button"
          onClick={() => setOpenSync((v) => !v)}
          className="w-full px-6 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="w-9 h-9 rounded-xl bg-indigo-50 grid place-items-center shrink-0">
            <ShieldAlert className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-800">Sync chegarasi (minimal sana)</div>
            <div className="text-[11.5px] text-slate-500 mt-0.5 truncate">
              {data?.syncMinDate ? `Aktiv: ${data.syncMinDate}` : "Chegara yo'q — barcha tarix sync bo'ladi"}
            </div>
          </div>
          <ChevronDown className={cn('h-5 w-5 text-slate-400 transition-transform shrink-0', openSync && 'rotate-180')} />
        </button>
        {openSync && (
        <CardContent className="px-6 pb-6 pt-2 space-y-5 border-t border-slate-100">
          <div className="text-[12px] text-slate-500 max-w-2xl">
            Sync bu sanadan oldingi tranzaksiyalarni <b>HECH QACHON olmaydi</b>.
            Qo'lda import qilingan tarixiy ma'lumotlarni himoya qilish uchun ishlatiladi.
          </div>
          {isLoading ? (
            <Skeleton className="h-10 w-64" />
          ) : (
            <div className="space-y-2">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                Sync minimal sana
              </Label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Input
                    type="date"
                    value={syncMinDate}
                    onChange={(e) => { setSyncMinDate(e.target.value); setDirty1(true); }}
                    className="h-10 w-56 pr-9"
                  />
                  {syncMinDate && (
                    <button
                      type="button"
                      onClick={() => { setSyncMinDate(''); setDirty1(true); }}
                      title="Tozalash"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Button
                  onClick={() => mut.mutate({ syncMinDate: syncMinDate || null })}
                  disabled={!dirty1 || mut.isPending}
                  className="h-10 px-4 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Saqlash
                </Button>
              </div>
              <div className="text-[10.5px] text-slate-400">
                Misol: 31.12.2025 qo'ysangiz, sync 01.01.2026 dan boshlab boshlanadi.
              </div>
            </div>
          )}
        </CardContent>
        )}
      </Card>

      {/* OPLATYKV — TRANZAKSIYADAN AUTO-IMPORT — collapsible */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <button
          type="button"
          onClick={() => setOpenOplata((v) => !v)}
          className="w-full px-6 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="w-9 h-9 rounded-xl bg-amber-50 grid place-items-center shrink-0">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-800">ОплатыКв — Tranzaksiyalardan auto-import</div>
            <div className="text-[11.5px] text-slate-500 mt-0.5 truncate">
              {data?.oplatykvTxMinDate ? `Aktiv: ${data.oplatykvTxMinDate}` : "Sozlanmagan — auto-import o'chirilgan"}
            </div>
          </div>
          <ChevronDown className={cn('h-5 w-5 text-slate-400 transition-transform shrink-0', openOplata && 'rotate-180')} />
        </button>
        {openOplata && (
        <CardContent className="px-6 pb-6 pt-2 space-y-5 border-t border-slate-100">
          <div className="text-[12px] text-slate-500 max-w-2xl">
            Tranzaksiyalardan ОплатыКв jadvaliga avto-import minimal sanasi.
            Faqat <b>CLIENT</b> (Клиент / Физ.Л / Юр.Л) kategoriyasidagi <b>KIRIM</b>
            tranzaksiyalar, shartnoma raqami bor va sanasi <b>shu sanadan keyin</b>
            bo'lganlar qo'shiladi. Dedup — Transaction ID orqali.
          </div>

          {isLoading ? (
            <Skeleton className="h-10 w-64" />
          ) : (
            <div className="space-y-2">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                ОплатыКв TX minimal sana
              </Label>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Input
                    type="date"
                    value={oplatykvTxMinDate}
                    onChange={(e) => { setOplatykvTxMinDate(e.target.value); setDirty2(true); }}
                    className="h-10 w-56 pr-9"
                  />
                  {oplatykvTxMinDate && (
                    <button
                      type="button"
                      onClick={() => { setOplatykvTxMinDate(''); setDirty2(true); }}
                      title="Tozalash"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Button
                  onClick={() => mut.mutate({ oplatykvTxMinDate: oplatykvTxMinDate || null })}
                  disabled={!dirty2 || mut.isPending}
                  className="h-10 px-4 gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Saqlash
                </Button>
                <Button
                  onClick={() => syncTxMut.mutate(oplatykvTxMinDate || null)}
                  disabled={syncTxMut.isPending}
                  className="h-10 px-4 gap-2 bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white"
                  title="Hozir tranzaksiyalardan import qilish + Obyektlarni CRM dan to'ldirish"
                >
                  {syncTxMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Hozir sync
                </Button>
                <Button
                  onClick={() => splitMut.mutate()}
                  disabled={splitMut.isPending}
                  className="h-10 px-4 gap-2 bg-gradient-to-br from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700 text-white"
                  title="paymentAmount'ni 1-vznos va oylik'ga ajratish (CRM payment_histories asosida)"
                >
                  {splitMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Split now
                </Button>
              </div>
              <div className="text-[10.5px] text-slate-400">
                Misol: 01.05.2026 qo'ysangiz — 02.05.2026 va undan keyingi CLIENT-IN tranzaksiyalar avtomatik OplatyKv'ga qo'shiladi.
                <br />
                <b>Sync ichida AVTOMATIK:</b> obyekt + client + 1 взнос/oylik ajratish CRM'dan orqada to'ldiriladi.
              </div>

              {/* AUTO-SYNC INTERVAL */}
              <div className="mt-5 pt-5 border-t border-slate-100">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-emerald-600 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Avtomatik sync (cron)
                </Label>
                <div className="text-[11px] text-slate-500 mt-1 mb-3 max-w-2xl">
                  Backend har belgilangan daqiqada avtomatik sync'ni ishga tushiradi. <b>0</b> qo'ysangiz — o'chirilgan.
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">
                      Har necha daqiqada
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={1440}
                      value={oplatykvAutoSyncMinutes}
                      onChange={(e) => { setOplatykvAutoSyncMinutes(e.target.value); setDirty3(true); }}
                      placeholder="0 = o'chirilgan"
                      className="h-10 w-32"
                    />
                  </div>
                  <Button
                    onClick={() => mut.mutate({ oplatykvAutoSyncMinutes: Number(oplatykvAutoSyncMinutes) || 0 })}
                    disabled={!dirty3 || mut.isPending}
                    className="h-10 px-4 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Saqlash
                  </Button>
                  <div className="text-[11px] text-slate-500 self-center">
                    {Number(oplatykvAutoSyncMinutes) > 0
                      ? <>✓ Faol: har <b>{oplatykvAutoSyncMinutes} daqiqada</b> bir marta</>
                      : <>○ O'chirilgan</>}
                  </div>
                </div>
                <div className="text-[10.5px] text-slate-400 mt-2">
                  Misol: <b>15</b> qo'ysangiz — backend har 15 daqiqada avtomatik tx-dan sync qiladi.
                </div>

                {/* DAY/NIGHT TIME WINDOWS */}
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                  <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Vaqt oraliqlari (Tashkent)
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* DAY mode */}
                    <div className="rounded-xl bg-amber-50/50 ring-1 ring-amber-200 p-3 space-y-2">
                      <div className="text-[10px] uppercase tracking-wider font-bold text-amber-700">☀ KUNDUZ ({oplatykvAutoSyncMinutes}min, limit 1000)</div>
                      <div className="flex items-center gap-2">
                        <Input type="time" value={dayStart} onChange={(e) => { setDayStart(e.target.value); setDirty4(true); }} className="h-9 w-28" />
                        <span className="text-slate-400">—</span>
                        <Input type="time" value={dayEnd} onChange={(e) => { setDayEnd(e.target.value); setDirty4(true); }} className="h-9 w-28" />
                      </div>
                    </div>
                    {/* NIGHT batch */}
                    <div className="rounded-xl bg-indigo-50/50 ring-1 ring-indigo-200 p-3 space-y-2">
                      <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-700">🌙 TUN (kuniga 1, FULL batch)</div>
                      <div className="flex items-center gap-2">
                        <Input type="time" value={nightStart} onChange={(e) => { setNightStart(e.target.value); setDirty4(true); }} className="h-9 w-28" />
                        <span className="text-slate-400">—</span>
                        <Input type="time" value={nightEnd} onChange={(e) => { setNightEnd(e.target.value); setDirty4(true); }} className="h-9 w-28" />
                      </div>
                    </div>
                  </div>
                  <Button
                    onClick={() => mut.mutate({ oplatykvDayStart: dayStart, oplatykvDayEnd: dayEnd, oplatykvNightStart: nightStart, oplatykvNightEnd: nightEnd })}
                    disabled={!dirty4 || mut.isPending}
                    className="h-9 px-4 gap-2 bg-slate-600 hover:bg-slate-700 text-white text-[12px]"
                  >
                    {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Vaqtlarni saqlash
                  </Button>
                </div>

              </div>

              {/* CLEANUP SECTION — sana oralig'i (boshlanish + tugash) */}
              <div className="mt-5 pt-5 border-t border-slate-100">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-rose-600 flex items-center gap-1.5">
                  <X className="h-3.5 w-3.5" />
                  Tranzaksiya manbasini tozalash
                </Label>
                <div className="flex items-end gap-2 flex-wrap mt-2">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">
                      Boshlanish
                    </Label>
                    <div className="relative">
                      <Input
                        type="date"
                        value={cleanupDateFrom}
                        onChange={(e) => setCleanupDateFrom(e.target.value)}
                        className="h-10 w-44 pr-9"
                      />
                      {cleanupDateFrom && (
                        <button
                          type="button"
                          onClick={() => setCleanupDateFrom('')}
                          title="Tozalash"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-slate-400 text-lg pb-2">—</div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">
                      Tugash
                    </Label>
                    <div className="relative">
                      <Input
                        type="date"
                        value={cleanupDateTo}
                        onChange={(e) => setCleanupDateTo(e.target.value)}
                        className="h-10 w-44 pr-9"
                      />
                      {cleanupDateTo && (
                        <button
                          type="button"
                          onClick={() => setCleanupDateTo('')}
                          title="Tozalash"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={handleCleanup}
                    disabled={cleanupTxMut.isPending}
                    className="h-10 px-4 gap-2 bg-gradient-to-br from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white"
                    title={cleanupDateFrom || cleanupDateTo
                      ? `${cleanupDateFrom || '∞'} dan ${cleanupDateTo || '∞'} gacha tozalash`
                      : "BARCHA tranzaksiya-manba qatorlarini o'chirish"}
                  >
                    {cleanupTxMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                    Tozalash
                  </Button>
                </div>
                <div className="text-[10.5px] text-slate-400 mt-2">
                  <b>Sana oralig'i</b> — qatorlarning <code>date</code> maydoni bo'yicha filtr:
                  <br />
                  • Faqat <b>boshlanish</b> → shu sanadan keyingi (shu kun bilan)
                  <br />
                  • Faqat <b>tugash</b> → shu sanagacha (shu kun bilan)
                  <br />
                  • <b>Ikkalasi</b> → oraliq ichida
                  <br />
                  • <b>Bo'sh</b> → BARCHA tranzaksiya-manba qatorlar (ehtiyot)
                  <br />
                  Tarix saqlanadi (deleted log).
                </div>
              </div>

              {/* ── OBJECT MAPPING — sub-bo'lim ichida (OplatyKv kartochkasi ichida) ── */}
              <div className="mt-5 pt-5 border-t border-slate-100">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-fuchsia-600 flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  Obyekt nomi mapping (CRM → OplatyKv)
                </Label>
                <div className="text-[11px] text-slate-500 mt-1 mb-3 max-w-2xl">
                  CRM <b>"XON SAROY AFSONASI"</b> bersa, OplatyKv'ga <b>"АФСОНА"</b> deb yozish uchun.
                  Mapping bo'lmasa — CRM nomi qanday bo'lsa shunday yoziladi.
                </div>

                {/* Yangi mapping qo'shish */}
                <div className="rounded-xl bg-fuchsia-50/40 ring-1 ring-fuchsia-200 p-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-fuchsia-700 flex items-center gap-1.5">
                    <Plus className="h-3 w-3" /> Yangi mapping
                  </div>
                  <div className="flex items-end gap-2 flex-wrap">
                    <div className="flex-1 min-w-[160px]">
                      <Label className="text-[9.5px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">
                        CRM nomi
                      </Label>
                      <Input
                        type="text"
                        value={newCrmName}
                        onChange={(e) => setNewCrmName(e.target.value)}
                        placeholder="XON SAROY AFSONASI"
                        className="h-9 text-[12.5px]"
                      />
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400 pb-2.5 shrink-0" />
                    <div className="flex-1 min-w-[160px]">
                      <Label className="text-[9.5px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">
                        OplatyKv nomi
                      </Label>
                      <Input
                        type="text"
                        value={newOplataName}
                        onChange={(e) => setNewOplataName(e.target.value)}
                        placeholder="АФСОНА"
                        className="h-9 text-[12.5px]"
                      />
                    </div>
                    <Button
                      onClick={() => addMappingMut.mutate()}
                      disabled={!newCrmName.trim() || !newOplataName.trim() || addMappingMut.isPending}
                      className="h-9 px-3 gap-1.5 bg-gradient-to-br from-fuchsia-600 to-pink-600 hover:from-fuchsia-700 hover:to-pink-700 text-white text-[12px]"
                    >
                      {addMappingMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      Qo'shish
                    </Button>
                  </div>
                </div>

                {/* Mavjud mappinglar */}
                <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden mt-3">
                  <div className="bg-slate-50 px-3 py-1.5 border-b border-slate-200 text-[10px] uppercase tracking-wider font-bold text-slate-600">
                    Mavjud mappinglar
                    {(mappingsQuery.data?.items?.length || 0) > 0 && (
                      <span className="text-slate-400 font-medium ml-1 normal-case">
                        · {mappingsQuery.data!.items.length}
                      </span>
                    )}
                  </div>
                  {mappingsQuery.isLoading ? (
                    <div className="px-3 py-4 text-center text-[11.5px] text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto mb-1" />
                      Yuklanmoqda...
                    </div>
                  ) : (mappingsQuery.data?.items?.length || 0) === 0 ? (
                    <div className="px-3 py-4 text-center text-[11.5px] text-slate-400 italic">
                      Mapping mavjud emas
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                      {mappingsQuery.data!.items.map((m) => (
                        <div key={m.id} className="px-3 py-2 flex items-center gap-2 hover:bg-slate-50/60">
                          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[12px] font-semibold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded truncate">
                              {m.crmName}
                            </span>
                            <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="font-mono text-[12px] font-bold text-fuchsia-700 bg-fuchsia-50 px-1.5 py-0.5 rounded truncate">
                              {m.oplataName}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              if (confirm(`'${m.crmName}' mapping'ini o'chirishni xohlaysizmi?`)) {
                                deleteMappingMut.mutate(m.id);
                              }
                            }}
                            disabled={deleteMappingMut.isPending}
                            className="w-7 h-7 rounded grid place-items-center text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                            title="O'chirish"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="text-[10px] text-slate-400 mt-2">
                  Eslatma: mapping faqat <b>keyingi sync'larga</b> ta'sir qiladi.
                </div>
              </div>
            </div>
          )}
        </CardContent>
        )}
      </Card>
    </div>
  );
}

function KpiCard({
  label, value, sub, icon: Icon, color, spark,
}: {
  label: string;
  value: string;
  sub: string;
  icon: any;
  color: 'emerald' | 'rose' | 'indigo' | 'amber';
  spark?: number[];
}) {
  const m = {
    emerald: { grad: 'from-emerald-500 to-teal-600', accent: '#10b981' },
    rose:    { grad: 'from-rose-500 to-red-600',     accent: '#f43f5e' },
    indigo:  { grad: 'from-indigo-500 to-blue-600',  accent: '#6366f1' },
    amber:   { grad: 'from-amber-500 to-orange-600', accent: '#f59e0b' },
  }[color];
  return (
    <Card className="border-0 shadow-soft card-hover relative overflow-hidden">
      <div className={cn("absolute -top-12 -right-12 w-32 h-32 rounded-full blur-2xl opacity-25 bg-gradient-to-br", m.grad)} />
      <CardContent className="p-5 relative">
        <div className="flex items-start justify-between mb-2">
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500">{label}</div>
          <div className={cn("w-9 h-9 rounded-xl grid place-items-center bg-gradient-to-br text-white shadow-sm", m.grad)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-2xl lg:text-3xl font-bold tracking-tight tabular-nums">{value}</div>
        <div className="text-[11px] text-slate-500 mt-1 truncate">{sub}</div>
        {spark && spark.length > 0 && (
          <div className="mt-1 -mx-1">
            <Sparkline data={spark} width={200} height={28} stroke={m.accent} fill={m.accent} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, value, label, tone = 'slate' }: { icon: any; value: number; label: string; tone?: 'slate' | 'emerald' | 'rose' }) {
  const cls = tone === 'emerald' ? 'text-emerald-600'
    : tone === 'rose' ? 'text-rose-600'
    : 'text-slate-500';
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", cls)}>
      <Icon className="h-3 w-3" />
      <span className="font-semibold">{value}</span>
      <span className="text-slate-400">{label}</span>
    </span>
  );
}

// ═══ Pagination
function PaginationBar({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const safePage = Math.min(page, totalPages);
  const btn = (p: number, label: React.ReactNode, disabled = false) => (
    <button
      key={`${p}-${typeof label === 'string' ? label : 'icon'}-${disabled ? 'd' : ''}`}
      onClick={() => !disabled && onChange(p)}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center h-8 min-w-[32px] px-2 rounded-md text-[12px] font-semibold transition-colors',
        disabled && 'text-slate-300 cursor-not-allowed',
        !disabled && p === safePage && 'bg-indigo-600 text-white',
        !disabled && p !== safePage && 'bg-slate-100 text-slate-700 hover:bg-slate-200',
      )}
    >
      {label}
    </button>
  );
  const pages: number[] = [];
  for (let i = Math.max(1, safePage - 2); i <= Math.min(totalPages, safePage + 2); i++) pages.push(i);
  return (
    <div className="flex items-center justify-center gap-1 px-6 py-3 border-t border-slate-100">
      {btn(1, <ChevronsLeft className="h-4 w-4" />, safePage === 1)}
      {btn(safePage - 1, <ChevronLeft className="h-4 w-4" />, safePage === 1)}
      {pages[0] > 1 && <span className="text-slate-400 text-[11px] px-1">…</span>}
      {pages.map((p) => btn(p, String(p)))}
      {pages[pages.length - 1] < totalPages && <span className="text-slate-400 text-[11px] px-1">…</span>}
      {btn(safePage + 1, <ChevronRight className="h-4 w-4" />, safePage === totalPages)}
      {btn(totalPages, <ChevronsRight className="h-4 w-4" />, safePage === totalPages)}
      <span className="ml-3 text-[10.5px] text-slate-400 tabular-nums">
        {safePage} / {totalPages}
      </span>
    </div>
  );
}
