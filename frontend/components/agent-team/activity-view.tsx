'use client';

/**
 * Agent Support — "Faoliyat" ko'rinishi: agents.agent_runs (har agent chaqiruvi).
 * Filtrlar (agent, manba, sana, qidiruv, status facet), sahifalash, CSV eksport, batafsil panel (Drawer).
 * Faqat o'qish. Matnlar oddiy matn sifatida ko'rsatiladi (HTML render qilinmaydi).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity, AlertTriangle, ChevronDown, ChevronUp, Cpu, Download, RotateCcw, SearchX, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AGENT_TEAM_REFRESH, agentTeamApi, agentTeamKeys, type RunsParams,
} from '@/lib/agent-team-api';
import {
  AGENT_NAMES, RUN_SOURCES, RUN_STATUSES,
  type AgentName, type AgentRunRow, type AgentTeamViewProps,
} from '@/lib/agent-team-types';
import {
  AgentAvatar, ChipFilter, CodeBlock, DateBox, Drawer, DurationBar, EmptyBlock, ErrorBlock, IconButton,
  InfoRow, LoadingBlock, NotInstalled, Pager, Pill, RefreshButton, RunStatusBadge, SearchBox, SectionCard,
  SelectBox, SkeletonRows, TONE_DOT, fmtDateTime, fmtShortDateTime, isAgentName, runStatusTone,
  useAgentLabel, useAgentTeamFmt, useDebounced, useNow, type ChipOption,
} from './ui';

const PER_PAGE = 25;
const EXPORT_PER_PAGE = 100;
const EXPORT_MAX_PAGES = 10; // ko'pi bilan 1000 qator
const DEFAULT_TIMEOUT_S = 180;
const ALL = 'all';
/** Excel UTF-8 ni to'g'ri o'qishi uchun CSV boshidagi belgi */
const BOM = String.fromCharCode(0xfeff);

type DrawerState = { id: number; row: AgentRunRow | null } | null;

/** 'claude-opus-5-5' -> 'opus-5-5' (to'liq nom title'da) */
function shortModel(m: string | null | undefined): string {
  if (!m) return '—';
  return m.replace(/^claude-/, '');
}

/** CSV katak: qo'shtirnoq ekrani + formula-injection himoyasi (matn = + - @ bilan boshlansa) */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '""';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function ActivityView({ focus }: AgentTeamViewProps) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const agentLabel = useAgentLabel();
  const now = useNow(15_000);

  // ---- Filtrlar (fokusdan boshlang'ich qiymat — ortiqcha so'rovsiz) ----
  const initialFocus = useRef(focus);
  const [agent, setAgent] = useState<AgentName | ''>(() => (focus?.agent && isAgentName(focus.agent) ? focus.agent : ''));
  const [status, setStatus] = useState<string>(() => focus?.status ?? '');
  const [source, setSource] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [qInput, setQInput] = useState('');
  const q = useDebounced(qInput.trim(), 200);
  const [drawer, setDrawer] = useState<DrawerState>(() => (focus?.runId ? { id: focus.runId, row: null } : null));

  // Keyingi fokuslar (konteyner har safar YANGI obyekt uzatadi)
  useEffect(() => {
    if (!focus || focus === initialFocus.current) return;
    if (focus.agent !== undefined || focus.status !== undefined) {
      setAgent(focus.agent && isAgentName(focus.agent) ? focus.agent : '');
      setStatus(focus.status ?? '');
      setSource('');
      setFrom('');
      setTo('');
      setQInput('');
    }
    if (focus.runId) setDrawer({ id: focus.runId, row: null });
  }, [focus]);

  const filterParams = useMemo<RunsParams>(() => ({
    agent: agent || undefined,
    status: status || undefined,
    source: source || undefined,
    from: from || undefined,
    to: to || undefined,
    q: q || undefined,
  }), [agent, status, source, from, to, q]);
  const filterKey = JSON.stringify(filterParams);

  // Sahifa filtrga bog'langan: filtr o'zgarsa avtomatik 1 (ortiqcha so'rovsiz)
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ key: filterKey, page: p });

  const params = useMemo<RunsParams>(() => ({ ...filterParams, page, perPage: PER_PAGE }), [filterParams, page]);

  const runsQ = useQuery({
    queryKey: agentTeamKeys.runs(params),
    queryFn: () => agentTeamApi.runs(params),
    refetchInterval: AGENT_TEAM_REFRESH.runs,
    placeholderData: keepPreviousData,
  });
  // Agent timeout'lari (DurationBar chegarasi) — AgentCards bilan umumiy kesh
  const agentsQ = useQuery({
    queryKey: agentTeamKeys.agents(),
    queryFn: () => agentTeamApi.agents(),
    refetchInterval: AGENT_TEAM_REFRESH.agents,
    staleTime: AGENT_TEAM_REFRESH.agents,
  });
  const timeoutMs = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agentsQ.data?.agents ?? []) m.set(a.name, (a.timeoutS || DEFAULT_TIMEOUT_S) * 1000);
    return (name: string) => m.get(name) ?? DEFAULT_TIMEOUT_S * 1000;
  }, [agentsQ.data]);

  const data = runsQ.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const hasFilters = !!(agent || status || source || from || to || qInput.trim());
  const busy = runsQ.isFetching && runsQ.isPlaceholderData;

  const statusLabel = useCallback(
    (s: string) => (t.has(`status.${s}`) ? t(`status.${s}`) : s),
    [t],
  );
  const sourceLabel = (s: string | null | undefined) => (!s ? '—' : t.has(`source.${s}`) ? t(`source.${s}`) : s);

  // ---- Status facet: faqat soni borlari (+ tanlangani), vergulli fokus uchun birlashgan chip ----
  const statusOptions = useMemo<ChipOption<string>[]>(() => {
    const counts = data?.statusCounts ?? {};
    const known = RUN_STATUSES as readonly string[];
    const extra = Object.keys(counts).filter((s) => !known.includes(s)).sort();
    const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
    const opts: ChipOption<string>[] = [{ value: ALL, label: t('common.all'), count: total }];
    if (status.includes(',')) {
      const parts = status.split(',').filter(Boolean);
      opts.push({
        value: status,
        label: parts.map(statusLabel).join(' + '),
        count: parts.reduce((a, s) => a + (counts[s] ?? 0), 0),
        tone: runStatusTone(parts[0]),
      });
    }
    for (const s of [...known, ...extra]) {
      if ((counts[s] ?? 0) > 0 || s === status) {
        opts.push({ value: s, label: statusLabel(s), count: counts[s] ?? 0, tone: runStatusTone(s) });
      }
    }
    return opts;
  }, [data?.statusCounts, status, statusLabel, t]);

  const resetFilters = () => {
    setAgent('');
    setStatus('');
    setSource('');
    setFrom('');
    setTo('');
    setQInput('');
  };

  // ---- CSV eksport: joriy filtr, 100 lik sahifalar, ko'pi 1000 qator ----
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const seen = new Set<number>();
      const all: AgentRunRow[] = [];
      for (let p = 1; p <= EXPORT_MAX_PAGES; p++) {
        const res = await agentTeamApi.runs({ ...filterParams, page: p, perPage: EXPORT_PER_PAGE });
        if (!res.installed) break;
        for (const r of res.rows) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            all.push(r);
          }
        }
        if (res.rows.length < EXPORT_PER_PAGE || p * EXPORT_PER_PAGE >= res.total) break;
      }
      if (!all.length) {
        toast(t('common.noResults'));
        return;
      }
      const header = [
        t('common.id'), t('activity.columns.time'), t('activity.columns.agent'), t('activity.columns.source'),
        t('activity.columns.status'), t('activity.columns.model'), `${t('activity.columns.duration')} (ms)`,
        t('activity.columns.rc'), t('activity.detail.task'), t('activity.detail.response'), t('activity.detail.error'),
      ];
      const lines = [header.map(csvCell).join(',')];
      for (const r of all) {
        lines.push([
          r.id,
          fmtDateTime(r.ts),
          agentLabel(r.agent),
          r.source ? sourceLabel(r.source) : '',
          statusLabel(r.status),
          r.model ?? '',
          r.durationMs ?? '',
          r.returncode ?? '',
          r.taskPreview ?? '',
          r.responsePreview ?? '',
          r.error ?? '',
        ].map(csvCell).join(','));
      }
      const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'agent-support-runs.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message || t('common.loadError'));
    } finally {
      setExporting(false);
    }
  };

  // ---- Batafsil panel ----
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const drawerIdx = drawer ? rows.findIndex((r) => r.id === drawer.id) : -1;
  const runQ = useQuery({
    queryKey: agentTeamKeys.run(drawer?.id ?? 0),
    queryFn: () => agentTeamApi.run(drawer?.id ?? 0),
    enabled: !!drawer && !drawer.row && drawerIdx < 0,
    staleTime: 30_000,
  });
  const drawerRow: AgentRunRow | null = drawer
    ? (drawerIdx >= 0 ? rows[drawerIdx] : drawer.row ?? runQ.data?.row ?? null)
    : null;
  const drawerLoading = !!drawer && !drawerRow && runQ.isPending && runQ.fetchStatus !== 'idle';
  // Fokusdan ochilgan qator joriy sahifada topilsa — saqlab qo'yamiz (keyin sahifadan tushib ketsa ham qayta so'ralmaydi)
  useEffect(() => {
    if (drawer && !drawer.row && drawerIdx >= 0) setDrawer({ id: drawer.id, row: rows[drawerIdx] });
  }, [drawer, drawerIdx, rows]);

  const agentOptions = useMemo(
    () => [
      { value: '' as AgentName | '', label: `${t('activity.filters.agent')}: ${t('common.all')}` },
      ...AGENT_NAMES.map((n) => ({ value: n as AgentName | '', label: agentLabel(n) })),
    ],
    [t, agentLabel],
  );
  const sourceOptions = useMemo(
    () => [
      { value: '', label: `${t('activity.filters.source')}: ${t('common.all')}` },
      ...RUN_SOURCES.map((s) => ({ value: s as string, label: t(`source.${s}`) })),
    ],
    [t],
  );

  // ---- Tana ----
  let body: ReactNode;
  if (runsQ.isPending) {
    body = <SkeletonRows rows={8} className="p-5" />;
  } else if (runsQ.isError && !data) {
    body = <ErrorBlock error={runsQ.error} onRetry={() => runsQ.refetch()} />;
  } else if (data && !data.installed) {
    body = <NotInstalled state={data} compact />;
  } else if (!rows.length) {
    body = hasFilters
      ? <EmptyBlock icon={SearchX} title={t('common.noResults')} />
      : <EmptyBlock icon={Activity} title={t('activity.empty')} desc={t('activity.retention')} />;
  } else {
    body = (
      <>
        <div className={cn('overflow-x-auto transition-opacity', busy && 'opacity-60')}>
          <table className="w-full text-[12px] min-w-[900px]">
            <thead className="text-[10px] uppercase tracking-wider font-bold text-slate-400 bg-slate-50/70 dark:bg-slate-900/50">
              <tr>
                <th className="text-left font-bold px-4 py-2.5 w-[112px]">{t('activity.columns.time')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('activity.columns.agent')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('activity.columns.source')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('activity.columns.status')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('activity.columns.model')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('activity.columns.duration')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('activity.columns.task')}</th>
                <th className="text-right font-bold px-4 py-2.5">{t('activity.columns.rc')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => {
                const tone = runStatusTone(r.status);
                const attention = tone === 'rose' || tone === 'amber' || tone === 'indigo';
                const maxMs = timeoutMs(r.agent);
                const selected = drawer?.id === r.id;
                return (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => setDrawer({ id: r.id, row: r })}
                    onKeyDown={(e) => { if (e.key === 'Enter') setDrawer({ id: r.id, row: r }); }}
                    className={cn(
                      'hover:bg-violet-50/40 dark:hover:bg-violet-950/20 cursor-pointer outline-none focus-visible:bg-violet-50/60 dark:focus-visible:bg-violet-950/30 transition-colors',
                      selected && 'bg-violet-50/60 dark:bg-violet-950/30',
                    )}
                  >
                    <td className="relative px-4 py-2.5 align-top whitespace-nowrap">
                      {attention && <span className={cn('absolute left-0 top-2 bottom-2 w-[3px] rounded-r', TONE_DOT[tone])} />}
                      <div className="font-medium text-slate-700 dark:text-slate-200 tabular-nums">{fmtShortDateTime(r.ts)}</div>
                      <div className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums" title={fmtDateTime(r.ts)}>{f.rel(r.ts, now)}</div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <AgentAvatar name={r.agent} size="sm" />
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{agentLabel(r.agent)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-[11.5px] text-slate-600 dark:text-slate-300 whitespace-nowrap">{sourceLabel(r.source)}</td>
                    <td className="px-3 py-2.5 align-top"><RunStatusBadge status={r.status} /></td>
                    <td className="px-3 py-2.5 align-top">
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap" title={r.model ?? undefined}>{shortModel(r.model)}</span>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div
                        className="flex flex-col gap-1"
                        title={r.durationMs != null ? t('activity.durationOfTimeout', { p: Math.round((r.durationMs / maxMs) * 100) }) : undefined}
                      >
                        <span className="tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">{f.dur(r.durationMs)}</span>
                        <DurationBar ms={r.durationMs} maxMs={maxMs} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top max-w-[360px]">
                      <div className="truncate text-slate-600 dark:text-slate-300" title={r.taskPreview ?? undefined}>{r.taskPreview || '—'}</div>
                      {r.error && (
                        <div className="truncate text-[10.5px] text-rose-600 dark:text-rose-400 mt-0.5" title={r.error}>{r.error}</div>
                      )}
                    </td>
                    <td className={cn('px-4 py-2.5 align-top text-right font-mono text-[11px] tabular-nums',
                      r.returncode != null && r.returncode !== 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-400 dark:text-slate-500')}
                    >
                      {r.returncode ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={data?.page ?? page} perPage={data?.perPage ?? PER_PAGE} total={data?.total ?? 0} onPage={setPage} busy={busy} />
      </>
    );
  }

  return (
    <>
      <SectionCard
        icon={Activity}
        title={t('activity.title')}
        subtitle={t('activity.subtitle')}
        noBody
        actions={(
          <>
            <RefreshButton onClick={() => runsQ.refetch()} fetching={runsQ.isFetching} />
            <IconButton icon={Download} title={t('common.exportCsv')} onClick={exportCsv} loading={exporting} disabled={!data?.installed} />
            {hasFilters && <IconButton icon={RotateCcw} title={t('common.resetFilters')} onClick={resetFilters} />}
          </>
        )}
      >
        {/* Filtrlar */}
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <SelectBox<AgentName | ''>
              value={agent}
              onChange={setAgent}
              options={agentOptions}
              title={t('activity.filters.agent')}
              className="flex-1 sm:flex-none min-w-[150px]"
            />
            <SelectBox<string>
              value={source}
              onChange={setSource}
              options={sourceOptions}
              title={t('activity.filters.source')}
              className="flex-1 sm:flex-none min-w-[150px]"
            />
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <DateBox value={from} onChange={setFrom} title={t('activity.filters.dateFrom')} className="flex-1 sm:flex-none min-w-0" />
              <span className="text-slate-300 dark:text-slate-600 text-[12px]">–</span>
              <DateBox value={to} onChange={setTo} title={t('activity.filters.dateTo')} className="flex-1 sm:flex-none min-w-0" />
            </div>
            <SearchBox
              value={qInput}
              onChange={setQInput}
              placeholder={t('activity.filters.search')}
              busy={qInput.trim() !== q || busy}
              className="flex-1 min-w-[200px]"
            />
          </div>
          <ChipFilter<string>
            value={status || ALL}
            options={statusOptions}
            onChange={(v) => setStatus(v === ALL ? '' : v)}
          />
        </div>

        {runsQ.isError && data && (
          <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[11.5px] ring-1 bg-rose-50/70 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 min-w-0 truncate">{t('common.loadError')}{runsQ.error?.message ? ` — ${runsQ.error.message}` : ''}</span>
            <button type="button" onClick={() => runsQ.refetch()} className="font-semibold hover:underline shrink-0">{t('common.retry')}</button>
          </div>
        )}

        {body}

        <div className="px-5 py-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 flex-wrap text-[10.5px] text-slate-400 dark:text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>{t('activity.retention')}</span>
          <span className="opacity-50">·</span>
          <span>{t('common.masked')}</span>
          <span className="opacity-50">·</span>
          <span>{t('common.tashkentTime')}</span>
        </div>
      </SectionCard>

      <Drawer
        open={!!drawer}
        onClose={closeDrawer}
        title={drawer ? t('activity.detail.title', { id: drawer.id }) : ''}
        subtitle={drawerRow ? `${fmtDateTime(drawerRow.ts)} · ${f.rel(drawerRow.ts, now)}` : undefined}
        icon={Activity}
        tone={drawerRow ? (runStatusTone(drawerRow.status) === 'slate' ? 'violet' : runStatusTone(drawerRow.status)) : 'violet'}
        actions={drawerIdx >= 0 ? (
          <div className="flex items-center gap-1.5">
            <IconButton
              icon={ChevronUp}
              title={t('common.prev')}
              disabled={drawerIdx <= 0}
              onClick={() => { const r = rows[drawerIdx - 1]; if (r) setDrawer({ id: r.id, row: r }); }}
            />
            <IconButton
              icon={ChevronDown}
              title={t('common.next')}
              disabled={drawerIdx >= rows.length - 1}
              onClick={() => { const r = rows[drawerIdx + 1]; if (r) setDrawer({ id: r.id, row: r }); }}
            />
          </div>
        ) : undefined}
        footer={(
          <div className="flex items-center gap-2 text-[10.5px] text-slate-400 dark:text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span>{t('activity.detail.previewNote')}</span>
          </div>
        )}
      >
        {drawer && (
          drawerLoading ? (
            <LoadingBlock />
          ) : runQ.isError && !drawerRow ? (
            <ErrorBlock error={runQ.error} onRetry={() => runQ.refetch()} />
          ) : runQ.data && !runQ.data.installed && !drawerRow ? (
            <NotInstalled state={runQ.data} compact />
          ) : !drawerRow ? (
            <EmptyBlock icon={SearchX} title={t('activity.detail.notFound')} />
          ) : (
            <RunDetail row={drawerRow} maxMs={timeoutMs(drawerRow.agent)} sourceLabel={sourceLabel} />
          )
        )}
      </Drawer>
    </>
  );
}

// ===========================================================================
// Batafsil: meta + task / response / error
// ===========================================================================
function RunDetail({
  row, maxMs, sourceLabel,
}: { row: AgentRunRow; maxMs: number; sourceLabel: (s: string | null | undefined) => string }) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const agentLabel = useAgentLabel();
  const pct = row.durationMs != null && maxMs > 0 ? Math.round((row.durationMs / maxMs) * 100) : null;
  const hint = t.has(`statusHint.${row.status}`) ? t(`statusHint.${row.status}`) : null;

  const textBlock = (label: string, text: string | null, tone: 'slate' | 'rose' = 'slate') => (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">{label}</span>
        {text && <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">{t('common.chars', { n: text.length })}</span>}
      </div>
      {text ? (
        <CodeBlock tone={tone} copyText={text} maxHeight={280}>{text}</CodeBlock>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-3 py-2.5 text-[11.5px] italic text-slate-400 dark:text-slate-500">
          {t('activity.detail.noText')}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 px-3.5">
        <InfoRow label={t('activity.columns.agent')}>
          <span className="inline-flex items-center gap-2"><AgentAvatar name={row.agent} size="sm" />{agentLabel(row.agent)}</span>
        </InfoRow>
        <InfoRow label={t('activity.columns.status')} hint={hint}>
          <RunStatusBadge status={row.status} />
        </InfoRow>
        <InfoRow label={t('activity.columns.source')}>
          {row.source ? <Pill tone="slate">{sourceLabel(row.source)}</Pill> : '—'}
        </InfoRow>
        <InfoRow label={t('activity.columns.model')} mono>
          {row.model ? (
            <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5 text-violet-500 shrink-0" />{row.model}</span>
          ) : '—'}
        </InfoRow>
        <InfoRow label={t('activity.columns.duration')}>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="tabular-nums font-semibold">{f.dur(row.durationMs)}</span>
            <DurationBar ms={row.durationMs} maxMs={maxMs} className="w-28" />
            {pct !== null && (
              <span className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums">{t('activity.durationOfTimeout', { p: pct })}</span>
            )}
          </div>
        </InfoRow>
        <InfoRow label={t('activity.detail.returncode')} mono>
          <span className={cn(row.returncode != null && row.returncode !== 0 && 'text-rose-600 dark:text-rose-400 font-bold')}>
            {row.returncode ?? '—'}
          </span>
        </InfoRow>
        <InfoRow label={t('activity.columns.time')} hint={t('common.tashkentTime')}>
          <span className="tabular-nums">{fmtDateTime(row.ts)}</span>
          <span className="text-slate-400 dark:text-slate-500"> · {f.rel(row.ts)}</span>
        </InfoRow>
        <InfoRow label={t('common.id')} mono>{row.id}</InfoRow>
      </div>

      {textBlock(t('activity.detail.task'), row.taskPreview)}
      {textBlock(t('activity.detail.response'), row.responsePreview)}
      {row.error && textBlock(t('activity.detail.error'), row.error, 'rose')}

      <div className="flex items-center gap-2 text-[10.5px] text-slate-400 dark:text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        <span>{t('common.masked')}</span>
      </div>
    </>
  );
}
