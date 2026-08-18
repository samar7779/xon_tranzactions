'use client';
// build: sverka-crm v1 (CRM payment-history ↔ ОплатыКв, shartnoma kesimi + drill-down)

import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  GitCompareArrows, RefreshCw, CheckCircle2, AlertTriangle, Loader2,
  Search, X, ChevronRight, ChevronLeft, Building2, FileSpreadsheet,
  SlidersHorizontal, Database, Cloud, ArrowRightLeft, Clock,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { TransactionsTabs } from '@/components/transactions-tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/empty-state';
import { api, apiDownload } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { CrmContractDrilldown } from './_crm-drilldown';

// ─────────────────────────── Turlar ───────────────────────────

export interface CrmSverkaRow {
  contractNo: string;
  client: string | null;
  object: string | null;
  crmTotal: number;
  crmCount: number;
  ourTotal: number;
  ourCount: number;
  diff: number;
  status: 'ok' | 'mismatch' | 'crm-only' | 'our-only';
  lastDate: string | null;
  methods: string[];
}

interface Facet { value: string; count: number }

interface ResultResponse {
  ok: true;
  ready: boolean;
  running: boolean;
  phase?: string;
  message?: string;
  meta?: {
    builtAt: string;
    ageSeconds: number;
    durationMs: number;
    crmCount: number;
    ourCount: number;
    pages: number;
    partialError: string | null;
  };
  summary?: {
    total: number; ok: number; mismatch: number; crmOnly: number; ourOnly: number;
    crmSum: number; ourSum: number; diffSum: number;
  };
  filtered?: { total: number; page: number; perPage: number; pageCount: number };
  items?: CrmSverkaRow[];
  facets?: { methods: Facet[]; ourMethods: Facet[]; crmStatuses: Facet[]; objects: Facet[] };
}

interface StatusResponse {
  ok: true;
  running: boolean;
  phase: 'idle' | 'crm' | 'db' | 'compute' | 'done' | 'error';
  progress: { phase: string; pages: number; crmFetched: number; ourRows: number; contracts: number };
  startedAt: string | null;
  finishedAt: string | null;
  startedBy: string | null;
  lastError: string | null;
  snapshot: {
    builtAt: string; ageSeconds: number; durationMs: number;
    pages: number; crmCount: number; ourCount: number; contracts: number;
  } | null;
}

const PER_PAGE = 50;

export default function CheckCrmPage() {
  const t = useTranslations('checkCrm');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const canRun = useHasPermission(PERMS.TRANSACTIONS_SVERKA_CRM_RUN);

  // ── Filtr holati ──
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [ourMethods, setOurMethods] = useState<string[]>([]);
  const [crmStatuses, setCrmStatuses] = useState<string[]>([]);
  const [objects, setObjects] = useState<string[]>([]);
  const [rowStatuses, setRowStatuses] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minDiff, setMinDiff] = useState('');
  const [sort, setSort] = useState<'diff' | 'crm' | 'our' | 'contract'>('diff');
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<CrmSverkaRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const autoStarted = useRef(false);

  // Qidiruv debounce — har harfda server hisoblamasin
  useEffect(() => {
    const id = setTimeout(() => { setQDebounced(q); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (qDebounced) p.set('q', qDebounced);
    if (methods.length) p.set('methods', methods.join(','));
    if (ourMethods.length) p.set('ourMethods', ourMethods.join(','));
    if (crmStatuses.length) p.set('crmStatuses', crmStatuses.join(','));
    if (objects.length) p.set('objects', objects.join(','));
    if (rowStatuses.length) p.set('rowStatuses', rowStatuses.join(','));
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    if (minDiff) p.set('minDiff', minDiff);
    p.set('sort', sort);
    p.set('page', String(page));
    p.set('perPage', String(PER_PAGE));
    return p.toString();
  }, [qDebounced, methods, ourMethods, crmStatuses, objects, rowStatuses, dateFrom, dateTo, minDiff, sort, page]);

  // ── Status (jonli tortish jarayoni) ──
  const statusQuery = useQuery<StatusResponse>({
    queryKey: ['crm-sverka-status'],
    queryFn: () => api.get('/crm-sverka/status'),
    refetchInterval: (q2) => ((q2.state.data as StatusResponse | undefined)?.running ? 2000 : false),
    retry: false,
  });
  const running = !!statusQuery.data?.running;
  const hasSnapshot = !!statusQuery.data?.snapshot;

  // ── Natija ──
  const resultQuery = useQuery<ResultResponse>({
    queryKey: ['crm-sverka-result', query, statusQuery.data?.snapshot?.builtAt],
    queryFn: () => api.get(`/crm-sverka/result?${query}`, { timeout: 120_000 }),
    enabled: hasSnapshot,
    staleTime: 60_000,
    retry: false,
  });

  // Tortish tugagach — natijani yangilaymiz
  const prevRunning = useRef(running);
  useEffect(() => {
    if (prevRunning.current && !running) {
      qc.invalidateQueries({ queryKey: ['crm-sverka-result'] });
      const s = statusQuery.data;
      if (s?.phase === 'error') toast.error(s.lastError || tc('error'));
      else if (s?.snapshot) toast.success(t('toastDone', { contracts: s.snapshot.contracts }));
    }
    prevRunning.current = running;
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startRun() {
    if (!canRun) { toast.error(t('noRunPerm')); return; }
    try {
      const r = await api.post<{ ok: true; started: boolean; message: string }>('/crm-sverka/run', {});
      toast.message(r.started ? t('toastStarted') : r.message);
      qc.invalidateQueries({ queryKey: ['crm-sverka-status'] });
      setTimeout(() => statusQuery.refetch(), 400);
    } catch (e: any) {
      toast.error(e?.message || tc('error'));
    }
  }

  // Snapshot yo'q va hech kim tortmayapti — avtomatik boshlaymiz (bir marta)
  useEffect(() => {
    if (autoStarted.current) return;
    if (statusQuery.isLoading || !statusQuery.data) return;
    if (statusQuery.data.snapshot || statusQuery.data.running) return;
    if (!canRun) return;
    autoStarted.current = true;
    startRun();
  }, [statusQuery.data, statusQuery.isLoading, canRun]); // eslint-disable-line react-hooks/exhaustive-deps

  async function downloadExcel() {
    setExporting(true);
    try {
      await apiDownload(`/crm-sverka/export?${query}`, `sverka-crm-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(t('exported'));
    } catch (e: any) {
      toast.error(e?.message || tc('error'));
    } finally {
      setExporting(false);
    }
  }

  function resetFilters() {
    setQ(''); setMethods([]); setOurMethods([]); setCrmStatuses([]);
    setObjects([]); setRowStatuses([]); setDateFrom(''); setDateTo('');
    setMinDiff(''); setPage(1);
  }

  const activeFilterCount =
    methods.length + ourMethods.length + crmStatuses.length + objects.length +
    rowStatuses.length + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (minDiff ? 1 : 0);

  const data = resultQuery.data;
  const summary = data?.summary;
  const items = data?.items || [];
  const facets = data?.facets;
  const meta = data?.meta;

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <TransactionsTabs />

      <div className="flex-1 px-4 py-5 lg:px-6 lg:py-6 space-y-4 w-full">
        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-500 to-teal-500 grid place-items-center text-white shadow-lg shadow-cyan-500/30">
              <GitCompareArrows className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <div>
              <h1 className="text-[20px] font-bold tracking-tight">{t('title')}</h1>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Cloud className="h-3 w-3 text-sky-500" />
                {t('liveSource')}
                {meta && (
                  <>
                    {' · '}
                    <Clock className="h-3 w-3" />
                    <span>{t('lastUpdate')}: {ageLabel(meta.ageSeconds, t)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasSnapshot && (
              <Button
                variant="outline"
                onClick={downloadExcel}
                disabled={exporting || !items.length}
                className="h-10 rounded-xl font-semibold gap-1.5"
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                {t('export')}
              </Button>
            )}
            <Button
              onClick={startRun}
              disabled={running || !canRun}
              className="h-10 rounded-xl font-semibold bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-700 hover:to-cyan-700 gap-1.5 shadow-md shadow-cyan-500/20"
            >
              {running ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {t('running')}</>
              ) : (
                <><RefreshCw className="h-4 w-4" /> {t('run')}</>
              )}
            </Button>
          </div>
        </div>

        {/* ═══ JONLI TORTISH PROGRESSI ═══ */}
        {running && <RunProgress status={statusQuery.data!} t={t} />}

        {/* ═══ SNAPSHOT YO'Q ═══ */}
        {!hasSnapshot && !running && (
          <Card className="border-0 shadow-soft">
            <CardContent className="p-0">
              <div className="p-10 text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-sky-500/15 to-cyan-500/10 ring-1 ring-sky-200 dark:ring-sky-900 grid place-items-center text-sky-600 dark:text-sky-400">
                  <GitCompareArrows className="h-7 w-7" />
                </div>
                <div>
                  <div className="text-[15px] font-bold text-slate-900 dark:text-slate-100">{t('startTitle')}</div>
                  <div className="text-[12px] text-slate-500 dark:text-slate-400 max-w-lg mx-auto mt-1.5">
                    {t('startDesc')}
                  </div>
                </div>
                <Button
                  onClick={startRun}
                  disabled={!canRun}
                  className="h-10 rounded-xl font-semibold bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-700 hover:to-cyan-700 gap-1.5"
                >
                  <RefreshCw className="h-4 w-4" /> {t('startBtn')}
                </Button>
                {!canRun && (
                  <div className="text-[11px] text-amber-600 dark:text-amber-400">{t('noRunPerm')}</div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ═══ KPI ═══ */}
        {hasSnapshot && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Kpi label={t('kpiContracts')} value={summary?.total ?? 0} color="sky" icon={<Building2 className="h-4 w-4" />} loading={resultQuery.isLoading} />
              <Kpi
                label={t('kpiOk')} value={summary?.ok ?? 0} color="emerald" icon={<CheckCircle2 className="h-4 w-4" />}
                loading={resultQuery.isLoading}
                extra={summary && summary.total > 0 ? `${Math.round((summary.ok / summary.total) * 100)}%` : undefined}
                active={rowStatuses.includes('ok')}
                onClick={() => toggleOnly(rowStatuses, setRowStatuses, 'ok', setPage)}
              />
              <Kpi
                label={t('kpiMismatch')} value={summary?.mismatch ?? 0} color={(summary?.mismatch ?? 0) > 0 ? 'amber' : 'slate'}
                icon={<AlertTriangle className="h-4 w-4" />} loading={resultQuery.isLoading}
                active={rowStatuses.includes('mismatch')}
                onClick={() => toggleOnly(rowStatuses, setRowStatuses, 'mismatch', setPage)}
              />
              <Kpi
                label={t('kpiCrmOnly')} value={summary?.crmOnly ?? 0} color={(summary?.crmOnly ?? 0) > 0 ? 'rose' : 'slate'}
                icon={<Cloud className="h-4 w-4" />} loading={resultQuery.isLoading}
                active={rowStatuses.includes('crm-only')}
                onClick={() => toggleOnly(rowStatuses, setRowStatuses, 'crm-only', setPage)}
              />
              <Kpi
                label={t('kpiOurOnly')} value={summary?.ourOnly ?? 0} color={(summary?.ourOnly ?? 0) > 0 ? 'violet' : 'slate'}
                icon={<Database className="h-4 w-4" />} loading={resultQuery.isLoading}
                active={rowStatuses.includes('our-only')}
                onClick={() => toggleOnly(rowStatuses, setRowStatuses, 'our-only', setPage)}
              />
            </div>

            {/* ═══ SUMMALAR ═══ */}
            {summary && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SumCard label={t('sumCrm')} value={summary.crmSum} icon={<Cloud className="h-3.5 w-3.5" />} tone="sky" sub={meta ? t('crmRecords', { n: meta.crmCount }) : undefined} />
                <SumCard label={t('sumOur')} value={summary.ourSum} icon={<Database className="h-3.5 w-3.5" />} tone="violet" sub={meta ? t('ourRecords', { n: meta.ourCount }) : undefined} />
                <SumCard label={t('sumDiff')} value={summary.diffSum} icon={<ArrowRightLeft className="h-3.5 w-3.5" />} tone={summary.diffSum > 0 ? 'amber' : 'emerald'} sub={t('diffHint')} />
              </div>
            )}

            {meta?.partialError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-900 text-[11px] text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {t('partialWarn')}: {meta.partialError}
              </div>
            )}

            {/* ═══ QIDIRUV + FILTR ═══ */}
            <Card className="border-0 shadow-soft">
              <CardContent className="p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
                    <Input
                      className="pl-9 h-11 rounded-xl bg-slate-50/60 dark:bg-slate-900"
                      placeholder={t('searchPlaceholder')}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                    {q && (
                      <button
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                        onClick={() => setQ('')}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setFiltersOpen((s) => !s)}
                    className={cn(
                      'inline-flex items-center gap-1.5 h-11 px-3.5 rounded-xl text-[12px] font-semibold ring-1 transition-colors shrink-0',
                      filtersOpen || activeFilterCount > 0
                        ? 'bg-sky-50 dark:bg-sky-950/40 ring-sky-300 dark:ring-sky-800 text-sky-700 dark:text-sky-300'
                        : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
                    )}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    {t('filters')}
                    {activeFilterCount > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-sky-600 text-white text-[10px] font-bold">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                </div>

                {filtersOpen && (
                  <div className="space-y-3 pt-1 border-t border-slate-100 dark:border-slate-800">
                    {/* Sana + min farq + sort */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-3">
                      <LabeledInput label={t('filterDateFrom')}>
                        <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-9 rounded-lg text-[12px]" />
                      </LabeledInput>
                      <LabeledInput label={t('filterDateTo')}>
                        <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-9 rounded-lg text-[12px]" />
                      </LabeledInput>
                      <LabeledInput label={t('filterMinDiff')}>
                        <Input
                          type="number" inputMode="numeric" placeholder="0"
                          value={minDiff} onChange={(e) => { setMinDiff(e.target.value); setPage(1); }}
                          className="h-9 rounded-lg text-[12px]"
                        />
                      </LabeledInput>
                      <LabeledInput label={t('sortLabel')}>
                        <select
                          value={sort}
                          onChange={(e) => { setSort(e.target.value as any); setPage(1); }}
                          className="h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-[12px] text-slate-700 dark:text-slate-200"
                        >
                          <option value="diff">{t('sortDiff')}</option>
                          <option value="crm">{t('sortCrm')}</option>
                          <option value="our">{t('sortOur')}</option>
                          <option value="contract">{t('sortContract')}</option>
                        </select>
                      </LabeledInput>
                    </div>

                    <ChipGroup
                      label={t('filterMethods')} facets={facets?.methods || []}
                      selected={methods} onChange={(v) => { setMethods(v); setPage(1); }}
                    />
                    <ChipGroup
                      label={t('filterOurMethods')} facets={facets?.ourMethods || []}
                      selected={ourMethods} onChange={(v) => { setOurMethods(v); setPage(1); }}
                    />
                    <ChipGroup
                      label={t('filterCrmStatuses')} facets={facets?.crmStatuses || []}
                      selected={crmStatuses} onChange={(v) => { setCrmStatuses(v); setPage(1); }}
                    />
                    <ChipGroup
                      label={t('filterObjects')} facets={facets?.objects || []} max={14}
                      selected={objects} onChange={(v) => { setObjects(v); setPage(1); }}
                    />

                    {activeFilterCount > 0 && (
                      <button
                        onClick={resetFilters}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                      >
                        <X className="h-3.5 w-3.5" /> {t('filterReset')}
                      </button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ═══ RO'YXAT ═══ */}
            <Card className="border-0 shadow-soft">
              <CardContent className="p-0">
                {resultQuery.isLoading ? (
                  <div className="p-10 text-center space-y-2">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-sky-500" />
                    <div className="text-[12px] text-slate-500 dark:text-slate-400">{tc('loading')}</div>
                  </div>
                ) : resultQuery.error ? (
                  <div className="p-8 text-center space-y-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300 text-[12px] font-semibold">
                      <X className="h-3.5 w-3.5" /> {(resultQuery.error as any)?.message || tc('error')}
                    </div>
                  </div>
                ) : items.length === 0 ? (
                  <EmptyState icon={GitCompareArrows} title={t('emptyTitle')} description={t('emptyDesc')} />
                ) : (
                  <>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {items.map((row) => (
                        <ContractRow key={row.contractNo} row={row} onClick={() => setSelected(row)} />
                      ))}
                    </div>

                    {/* Paginatsiya */}
                    {data?.filtered && data.filtered.pageCount > 1 && (
                      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 dark:border-slate-800">
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t('foundContracts', { n: data.filtered.total })}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline" size="sm" className="h-8 rounded-lg"
                            disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <span className="text-[12px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                            {data.filtered.page} / {data.filtered.pageCount}
                          </span>
                          <Button
                            variant="outline" size="sm" className="h-8 rounded-lg"
                            disabled={page >= data.filtered.pageCount} onClick={() => setPage((p) => p + 1)}
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Drill-down */}
      {selected && (
        <CrmContractDrilldown
          row={selected}
          filterQuery={query}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// ═══════════════════ Yordamchi komponentlar ═══════════════════

function toggleOnly(
  current: string[],
  set: (v: string[]) => void,
  value: string,
  setPage: (n: number) => void,
) {
  set(current.length === 1 && current[0] === value ? [] : [value]);
  setPage(1);
}

function ageLabel(sec: number, t: any): string {
  if (sec < 60) return t('justNow');
  if (sec < 3600) return t('minutesAgo', { n: Math.round(sec / 60) });
  return t('hoursAgo', { n: Math.round(sec / 3600) });
}

function RunProgress({ status, t }: { status: StatusResponse; t: any }) {
  const p = status.progress;
  const phaseLabel =
    p.phase === 'crm' ? t('phaseCrm') :
    p.phase === 'db' ? t('phaseDb') :
    p.phase === 'compute' ? t('phaseCompute') : t('running');

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <CardContent className="p-0">
        <div className="px-5 py-4 bg-gradient-to-r from-sky-50/70 via-cyan-50/50 to-teal-50/70 dark:from-sky-950/30 dark:via-cyan-950/20 dark:to-teal-950/30">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 grid place-items-center text-white shadow-md shadow-cyan-500/30 shrink-0">
              <Loader2 className="h-5 w-5 animate-spin" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-slate-900 dark:text-slate-100">{phaseLabel}</div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-2.5 flex-wrap mt-0.5">
                <span>{t('progressPages', { n: p.pages })}</span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="tabular-nums">{t('progressCrm', { n: p.crmFetched.toLocaleString('ru-RU') })}</span>
                {p.ourRows > 0 && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="tabular-nums">{t('progressOur', { n: p.ourRows.toLocaleString('ru-RU') })}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-white/70 dark:bg-slate-800 overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-teal-500 crm-progress" />
          </div>
        </div>
      </CardContent>
      <style jsx>{`
        :global(.crm-progress) { animation: crm-progress 1.8s cubic-bezier(0.65, 0, 0.35, 1) infinite; }
        @keyframes crm-progress { 0% { transform: translateX(-110%); } 100% { transform: translateX(320%); } }
      `}</style>
    </Card>
  );
}

function ContractRow({ row, onClick }: { row: CrmSverkaRow; onClick: () => void }) {
  const t = useTranslations('checkCrm');
  const m = (n: number) => formatMoney(Number(n || 0)).replace(' UZS', '');

  const accent = {
    'ok': 'border-l-4 border-l-emerald-400/0 group-hover:border-l-emerald-400',
    'mismatch': 'border-l-4 border-l-amber-400',
    'crm-only': 'border-l-4 border-l-rose-400',
    'our-only': 'border-l-4 border-l-violet-400',
  }[row.status];

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-all duration-200 hover:bg-gradient-to-r hover:shadow-sm',
        row.status === 'mismatch' && 'bg-amber-50/30 dark:bg-amber-950/20 hover:from-amber-50 hover:to-orange-50/40 dark:hover:from-amber-950/40 dark:hover:to-orange-950/30',
        row.status === 'crm-only' && 'bg-rose-50/30 dark:bg-rose-950/20 hover:from-rose-50 hover:to-pink-50/40 dark:hover:from-rose-950/40 dark:hover:to-pink-950/30',
        row.status === 'our-only' && 'bg-violet-50/30 dark:bg-violet-950/20 hover:from-violet-50 hover:to-fuchsia-50/40 dark:hover:from-violet-950/40 dark:hover:to-fuchsia-950/30',
        row.status === 'ok' && 'hover:from-slate-50 hover:to-emerald-50/30 dark:hover:from-slate-800 dark:hover:to-emerald-950/30',
        accent,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <code className="text-[12px] font-mono font-bold text-slate-900 dark:text-slate-100 bg-slate-100/70 dark:bg-slate-800/70 px-1.5 py-0.5 rounded">
            {row.contractNo}
          </code>
          {row.client && (
            <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[280px]">
              {row.client}
            </span>
          )}
          {row.object && (
            <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 truncate max-w-[160px]">
              {row.object}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] flex-wrap mt-1">
          <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 px-1.5 py-0.5 rounded ring-1 ring-sky-200 dark:ring-sky-900">
            <Cloud className="h-2.5 w-2.5" />
            CRM <span className="font-bold tabular-nums">{m(row.crmTotal)}</span>
            <span className="opacity-60">· {row.crmCount}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 px-1.5 py-0.5 rounded ring-1 ring-violet-200 dark:ring-violet-900">
            <Database className="h-2.5 w-2.5" />
            {t('colOur')} <span className="font-bold tabular-nums">{m(row.ourTotal)}</span>
            <span className="opacity-60">· {row.ourCount}</span>
          </span>
          {row.lastDate && (
            <span className="text-slate-400 dark:text-slate-500 tabular-nums">{row.lastDate}</span>
          )}
        </div>
      </div>

      <RowStatusBadge row={row} />

      <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-500 group-hover:text-sky-500 group-hover:translate-x-1 shrink-0 transition-all" />
    </div>
  );
}

function RowStatusBadge({ row }: { row: CrmSverkaRow }) {
  const t = useTranslations('checkCrm');
  const money = formatMoney(Math.abs(row.diff)).replace(' UZS', '');

  if (row.status === 'ok') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 ring-1 ring-emerald-300 dark:ring-emerald-900 px-3 py-1.5 rounded-full shrink-0">
        <CheckCircle2 className="h-3 w-3" /> {t('statusOk')}
      </span>
    );
  }
  if (row.status === 'crm-only') {
    return (
      <span className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="flex items-center gap-1 text-[11px] font-bold text-rose-700 dark:text-rose-300 bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-950/40 dark:to-pink-950/40 ring-1 ring-rose-300 dark:ring-rose-900 px-3 py-1.5 rounded-full tabular-nums">
          <Cloud className="h-3 w-3" /> {t('statusCrmOnly')} {money}
        </span>
      </span>
    );
  }
  if (row.status === 'our-only') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-bold text-violet-700 dark:text-violet-300 bg-gradient-to-r from-violet-50 to-fuchsia-50 dark:from-violet-950/40 dark:to-fuchsia-950/40 ring-1 ring-violet-300 dark:ring-violet-900 px-3 py-1.5 rounded-full shrink-0 tabular-nums">
        <Database className="h-3 w-3" /> {t('statusOurOnly')} {money}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] font-bold text-amber-800 dark:text-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 ring-1 ring-amber-300 dark:ring-amber-900 px-3 py-1.5 rounded-full shrink-0 tabular-nums">
      <AlertTriangle className="h-3 w-3" />
      {row.diff > 0 ? '+' : '−'}{money}
    </span>
  );
}

function LabeledInput({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">{label}</div>
      {children}
    </div>
  );
}

function ChipGroup({
  label, facets, selected, onChange, max = 10,
}: {
  label: string;
  facets: Facet[];
  selected: string[];
  onChange: (v: string[]) => void;
  max?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations('checkCrm');
  if (!facets.length) return null;
  const shown = expanded ? facets : facets.slice(0, max);

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((f) => {
          const on = selected.includes(f.value);
          return (
            <button
              key={f.value}
              onClick={() => onChange(on ? selected.filter((v) => v !== f.value) : [...selected, f.value])}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium ring-1 transition-colors',
                on
                  ? 'bg-sky-600 text-white ring-sky-600 shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800',
              )}
            >
              <span className="truncate max-w-[180px]">{f.value}</span>
              <span className={cn('text-[10px] tabular-nums', on ? 'text-white/70' : 'text-slate-400 dark:text-slate-500')}>
                {f.count.toLocaleString('ru-RU')}
              </span>
            </button>
          );
        })}
        {facets.length > max && (
          <button
            onClick={() => setExpanded((s) => !s)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline"
          >
            {expanded ? t('showLess') : t('showMore', { n: facets.length - max })}
          </button>
        )}
      </div>
    </div>
  );
}

function SumCard({
  label, value, icon, tone, sub,
}: {
  label: string; value: number; icon: React.ReactNode;
  tone: 'sky' | 'violet' | 'amber' | 'emerald'; sub?: string;
}) {
  const m = {
    sky: 'text-sky-700 dark:text-sky-300 bg-sky-50/70 dark:bg-sky-950/30 ring-sky-200 dark:ring-sky-900',
    violet: 'text-violet-700 dark:text-violet-300 bg-violet-50/70 dark:bg-violet-950/30 ring-violet-200 dark:ring-violet-900',
    amber: 'text-amber-700 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/30 ring-amber-200 dark:ring-amber-900',
    emerald: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/30 ring-emerald-200 dark:ring-emerald-900',
  }[tone];

  return (
    <div className={cn('rounded-2xl ring-1 px-4 py-3', m)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-bold opacity-80">
        {icon} {label}
      </div>
      <div className="text-[17px] font-bold tabular-nums mt-1 leading-tight">
        {formatMoney(value).replace(' UZS', '')}
      </div>
      {sub && <div className="text-[10.5px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function Kpi({
  label, value, color, icon, loading, extra, active, onClick,
}: {
  label: string;
  value: number;
  color: 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate';
  icon: React.ReactNode;
  loading?: boolean;
  extra?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const m = {
    sky:     { bg: 'from-sky-500/15 to-cyan-500/10',      ring: 'ring-sky-300/60 dark:ring-sky-900',      text: 'text-sky-700 dark:text-sky-300',      accent: 'from-sky-500 to-cyan-600',      glow: 'shadow-sky-500/20' },
    emerald: { bg: 'from-emerald-500/15 to-teal-500/10',  ring: 'ring-emerald-300/60 dark:ring-emerald-900', text: 'text-emerald-700 dark:text-emerald-300', accent: 'from-emerald-500 to-teal-600', glow: 'shadow-emerald-500/20' },
    amber:   { bg: 'from-amber-500/15 to-orange-500/10',  ring: 'ring-amber-300/60 dark:ring-amber-900',  text: 'text-amber-700 dark:text-amber-300',  accent: 'from-amber-500 to-orange-600',  glow: 'shadow-amber-500/20' },
    rose:    { bg: 'from-rose-500/15 to-pink-500/10',     ring: 'ring-rose-300/60 dark:ring-rose-900',    text: 'text-rose-700 dark:text-rose-300',    accent: 'from-rose-500 to-pink-600',     glow: 'shadow-rose-500/20' },
    violet:  { bg: 'from-violet-500/15 to-fuchsia-500/10',ring: 'ring-violet-300/60 dark:ring-violet-900',text: 'text-violet-700 dark:text-violet-300',accent: 'from-violet-500 to-fuchsia-600',glow: 'shadow-violet-500/20' },
    slate:   { bg: 'from-slate-200/40 to-slate-300/20 dark:from-slate-800/40 dark:to-slate-700/20', ring: 'ring-slate-200 dark:ring-slate-700', text: 'text-slate-500 dark:text-slate-400', accent: 'from-slate-400 to-slate-500', glow: 'shadow-slate-300/20' },
  }[color];
  const isZero = value === 0;

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-2xl ring-1 bg-gradient-to-br p-3.5 shadow-md transition-all',
        m.bg, m.ring, m.glow,
        onClick && 'cursor-pointer hover:scale-[1.02] hover:shadow-lg',
        isZero && color !== 'emerald' && !active && 'opacity-70',
        active && 'ring-2 ring-offset-1 dark:ring-offset-slate-900',
      )}
    >
      <div className={cn('absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-20 blur-2xl bg-gradient-to-br transition-opacity group-hover:opacity-40', m.accent)} />
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
