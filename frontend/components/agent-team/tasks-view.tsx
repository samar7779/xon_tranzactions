'use client';

/**
 * Agent Support — "Vazifalar" ko'rinishi:
 *  - chap: agents.agent_tasks (Leader topshiriqlari) — status facet, agent, qidiruv, jonli "jarayonda" hisoblagich;
 *  - o'ng: agents.agent_promises (Leader va'dalari) — muddat hisoblagichi, eslatmalar n/3.
 * Faqat o'qish.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, BellRing, ExternalLink, Forward, Handshake, ListChecks, RotateCcw, SearchX, Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AGENT_TEAM_REFRESH, agentTeamApi, agentTeamKeys, type PromisesParams, type TasksParams,
} from '@/lib/agent-team-api';
import {
  AGENT_NAMES, TASK_STATUSES,
  type AgentName, type AgentTeamViewProps, type PromiseRow, type TaskRow, type TaskStatus,
} from '@/lib/agent-team-types';
import {
  AgentAvatar, ChipFilter, EmptyBlock, ErrorBlock, IconButton, NotInstalled, Pager, Pill, RefreshButton,
  SearchBox, SectionCard, SelectBox, SkeletonRows, TONE_DOT, fmtDateTime, fmtShortDateTime, isAgentName,
  taskStatusTone, useAgentLabel, useAgentTeamFmt, useDebounced, useNow, type ChipOption, type Tone,
} from './ui';

const PER_PAGE = 25;
const PROMISES_LIMIT = 100;
/** in_progress shundan uzoq davom etsa — "uzoq davom etmoqda" belgisi */
const STUCK_MS = 30 * 60 * 1000;
const HOUR_MS = 3600 * 1000;

type StatusFilter = 'all' | TaskStatus;
type PromiseFilter = NonNullable<PromisesParams['status']>;

const INTENT_TONE: Record<string, Tone> = {
  diagnose: 'sky',
  fix: 'amber',
  check: 'teal',
  remember: 'fuchsia',
  just_answer: 'slate',
};

export function TasksView({ focus, onNavigate }: AgentTeamViewProps) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
      <TasksCard focus={focus} onNavigate={onNavigate} />
      <PromisesCard />
    </div>
  );
}

// ===========================================================================
// Vazifalar jadvali
// ===========================================================================
function TasksCard({ focus, onNavigate }: Pick<AgentTeamViewProps, 'focus' | 'onNavigate'>) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const agentLabel = useAgentLabel();
  const now = useNow(15_000);

  const initialFocus = useRef(focus);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [agent, setAgent] = useState<AgentName | ''>(() => (focus?.agent && isAgentName(focus.agent) ? focus.agent : ''));
  const [qInput, setQInput] = useState('');
  const q = useDebounced(qInput.trim(), 200);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (!focus || focus === initialFocus.current) return;
    if (focus.agent !== undefined) setAgent(isAgentName(focus.agent) ? focus.agent : '');
  }, [focus]);

  const filterParams = useMemo<TasksParams>(() => ({
    status: status === 'all' ? undefined : status,
    agent: agent || undefined,
    q: q || undefined,
  }), [status, agent, q]);
  const filterKey = JSON.stringify(filterParams);
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ key: filterKey, page: p });
  const params = useMemo<TasksParams>(() => ({ ...filterParams, page, perPage: PER_PAGE }), [filterParams, page]);

  const tasksQ = useQuery({
    queryKey: agentTeamKeys.tasks(params),
    queryFn: () => agentTeamApi.tasks(params),
    refetchInterval: AGENT_TEAM_REFRESH.tasks,
    placeholderData: keepPreviousData,
  });
  const data = tasksQ.data;
  const rows = data?.rows ?? [];
  const busy = tasksQ.isFetching && tasksQ.isPlaceholderData;
  const hasFilters = status !== 'all' || !!agent || !!qInput.trim();

  const counts = data?.counts;
  const statusOptions: ChipOption<StatusFilter>[] = [
    {
      value: 'all',
      label: t('common.all'),
      count: counts ? TASK_STATUSES.reduce((a, s) => a + (counts[s] ?? 0), 0) : undefined,
    },
    ...TASK_STATUSES.map((s) => ({
      value: s as StatusFilter,
      label: t(`tasks.status.${s}`),
      count: counts ? counts[s] ?? 0 : undefined,
      tone: taskStatusTone(s),
    })),
  ];
  const agentOptions = [
    { value: '' as AgentName | '', label: `${t('activity.filters.agent')}: ${t('common.all')}` },
    ...AGENT_NAMES.map((n) => ({ value: n as AgentName | '', label: agentLabel(n) })),
  ];

  const toggle = (id: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const resetFilters = () => {
    setStatus('all');
    setAgent('');
    setQInput('');
  };

  let body: ReactNode;
  if (tasksQ.isPending) {
    body = <SkeletonRows rows={7} className="p-5" />;
  } else if (tasksQ.isError && !data) {
    body = <ErrorBlock error={tasksQ.error} onRetry={() => tasksQ.refetch()} />;
  } else if (data && !data.installed) {
    body = <NotInstalled state={data} compact />;
  } else if (!rows.length) {
    body = hasFilters
      ? <EmptyBlock icon={SearchX} title={t('common.noResults')} />
      : <EmptyBlock icon={ListChecks} title={t('tasks.empty')} />;
  } else {
    body = (
      <>
        <div className={cn('overflow-x-auto transition-opacity', busy && 'opacity-60')}>
          <table className="w-full text-[12px] min-w-[920px]">
            <thead className="text-[10px] uppercase tracking-wider font-bold text-slate-400 bg-slate-50/70 dark:bg-slate-900/50">
              <tr>
                <th className="text-left font-bold px-4 py-2.5 w-[112px]">{t('tasks.columns.created')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('tasks.columns.agent')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('tasks.columns.intent')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('tasks.columns.task')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('tasks.columns.status')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('tasks.columns.result')}</th>
                <th className="text-left font-bold px-3 py-2.5">{t('tasks.columns.duration')}</th>
                <th className="px-3 py-2.5 w-[52px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <TaskTableRow
                  key={r.id}
                  row={r}
                  now={now}
                  open={expanded.has(r.id)}
                  onToggle={() => toggle(r.id)}
                  onOpenRun={r.runId ? () => onNavigate('activity', { runId: r.runId as number }) : undefined}
                  agentLabel={agentLabel}
                  rel={f.rel}
                  dur={f.dur}
                />
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={data?.page ?? page} perPage={data?.perPage ?? PER_PAGE} total={data?.total ?? 0} onPage={setPage} busy={busy} />
      </>
    );
  }

  return (
    <SectionCard
      icon={ListChecks}
      title={t('tasks.title')}
      subtitle={t('tasks.subtitle')}
      className="min-w-0"
      noBody
      actions={(
        <>
          {hasFilters && <IconButton icon={RotateCcw} title={t('common.resetFilters')} onClick={resetFilters} />}
          <RefreshButton onClick={() => tasksQ.refetch()} fetching={tasksQ.isFetching} />
        </>
      )}
    >
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 space-y-2.5">
        <ChipFilter<StatusFilter> value={status} options={statusOptions} onChange={setStatus} />
        <div className="flex flex-wrap items-center gap-2">
          <SelectBox<AgentName | ''>
            value={agent}
            onChange={setAgent}
            options={agentOptions}
            title={t('tasks.columns.agent')}
            className="flex-1 sm:flex-none min-w-[150px]"
          />
          <SearchBox
            value={qInput}
            onChange={setQInput}
            placeholder={t('tasks.search')}
            busy={qInput.trim() !== q || busy}
            className="flex-1 min-w-[200px]"
          />
        </div>
      </div>

      {tasksQ.isError && data && <InlineError message={tasksQ.error?.message} onRetry={() => tasksQ.refetch()} />}

      {body}
    </SectionCard>
  );
}

function TaskTableRow({
  row: r, now, open, onToggle, onOpenRun, agentLabel, rel, dur,
}: {
  row: TaskRow; now: number; open: boolean; onToggle: () => void; onOpenRun?: () => void;
  agentLabel: (n: string | null | undefined) => string;
  rel: (iso: string | null | undefined, now?: number) => string;
  dur: (ms: number | null | undefined) => string;
}) {
  const t = useTranslations('adminAgentTeam');
  const inProgress = r.status === 'in_progress';
  const created = Date.parse(r.createdAt);
  const updated = Date.parse(r.updatedAt);
  const durationMs = !inProgress && Number.isFinite(created) && Number.isFinite(updated) ? Math.max(0, updated - created) : null;
  const intent = r.intent || null;
  const intentLabel = intent ? (t.has(`tasks.intent.${intent}`) ? t(`tasks.intent.${intent}`) : intent) : null;
  const srcLabel = t.has(`tasks.taskSource.${r.source}`) ? t(`tasks.taskSource.${r.source}`) : r.source;
  const statusLabel = t.has(`tasks.status.${r.status}`) ? t(`tasks.status.${r.status}`) : r.status;
  const tone = taskStatusTone(r.status);

  return (
    <tr
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onToggle(); }}
      className={cn(
        'hover:bg-violet-50/40 dark:hover:bg-violet-950/20 cursor-pointer outline-none focus-visible:bg-violet-50/60 dark:focus-visible:bg-violet-950/30 transition-colors',
        open && 'bg-slate-50/60 dark:bg-slate-900/40',
      )}
    >
      <td className="relative px-4 py-2.5 align-top whitespace-nowrap">
        {(tone === 'rose' || tone === 'sky') && <span className={cn('absolute left-0 top-2 bottom-2 w-[3px] rounded-r', TONE_DOT[tone])} />}
        <div className="font-medium text-slate-700 dark:text-slate-200 tabular-nums">{fmtShortDateTime(r.createdAt)}</div>
        <div className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums" title={fmtDateTime(r.createdAt)}>{rel(r.createdAt, now)}</div>
      </td>
      <td className="px-3 py-2.5 align-top">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <AgentAvatar name={r.agent} size="sm" />
          <span className="font-semibold text-slate-700 dark:text-slate-200">{agentLabel(r.agent)}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 align-top">
        <div className="flex flex-col items-start gap-1">
          {intentLabel ? <Pill tone={INTENT_TONE[intent as string] ?? 'slate'}>{intentLabel}</Pill> : <span className="text-slate-400">—</span>}
          <div className="flex items-center gap-1 flex-wrap">
            <Pill tone={r.source === 'fon' ? 'indigo' : 'slate'}>{srcLabel}</Pill>
            {r.isForward && <Pill tone="amber" icon={Forward} title={t('chat.forwardHint')}>{t('chat.forward')}</Pill>}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 align-top min-w-[240px] max-w-[420px]">
        <div
          className={cn('text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed', !open && 'line-clamp-2')}
          title={open ? undefined : r.task}
        >
          {r.task || '—'}
        </div>
      </td>
      <td className="px-3 py-2.5 align-top">
        {inProgress ? (
          <InProgressStatus createdAt={r.createdAt} label={statusLabel} />
        ) : (
          <Pill tone={tone} dot>{statusLabel}</Pill>
        )}
      </td>
      <td className="px-3 py-2.5 align-top min-w-[180px] max-w-[300px]">
        {r.resultPreview ? (
          <div
            className={cn('whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed',
              r.status === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300',
              !open && 'line-clamp-2')}
            title={open ? undefined : r.resultPreview}
          >
            {r.resultPreview}
          </div>
        ) : (
          <span className="text-[11px] italic text-slate-400 dark:text-slate-500">{t('tasks.noResult')}</span>
        )}
      </td>
      <td className="px-3 py-2.5 align-top whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-300">
        {durationMs !== null ? dur(durationMs) : '—'}
      </td>
      <td className="px-3 py-2 align-top text-right" onClick={(e) => e.stopPropagation()}>
        {onOpenRun && <IconButton icon={ExternalLink} title={t('tasks.openRun')} onClick={onOpenRun} />}
      </td>
    </tr>
  );
}

/** Jonli: "Jarayonda" + o'tgan vaqt (har soniya), 30 daqiqadan oshsa amber belgi */
function InProgressStatus({ createdAt, label }: { createdAt: string; label: string }) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const now = useNow(1000);
  const start = Date.parse(createdAt);
  const ms = Number.isFinite(start) ? Math.max(0, now - start) : 0;
  const stuck = ms > STUCK_MS;
  return (
    <div className="flex flex-col items-start gap-1">
      <Pill tone="sky" dot pulse>{label}</Pill>
      <span className={cn('text-[10.5px] tabular-nums whitespace-nowrap', stuck ? 'text-amber-600 dark:text-amber-400' : 'text-sky-600 dark:text-sky-400')}>
        {ms < HOUR_MS ? t('tasks.elapsed', { time: f.dur(ms) }) : f.rel(createdAt, now)}
      </span>
      {stuck && <Pill tone="amber" icon={AlertTriangle}>{t('tasks.stuck')}</Pill>}
    </div>
  );
}

// ===========================================================================
// Va'dalar
// ===========================================================================
function PromisesCard() {
  const t = useTranslations('adminAgentTeam');
  const [status, setStatus] = useState<PromiseFilter>('open');
  const params = useMemo<PromisesParams>(() => ({ status, limit: PROMISES_LIMIT }), [status]);

  const promQ = useQuery({
    queryKey: agentTeamKeys.promises(params),
    queryFn: () => agentTeamApi.promises(params),
    refetchInterval: AGENT_TEAM_REFRESH.promises,
    placeholderData: keepPreviousData,
  });
  const data = promQ.data;
  const rows = data?.rows ?? [];
  const counts = data?.counts;
  const busy = promQ.isFetching && promQ.isPlaceholderData;

  const options: ChipOption<PromiseFilter>[] = [
    { value: 'open', label: t('promises.status.open'), count: counts?.open, tone: 'violet' },
    { value: 'closed', label: t('promises.status.closed'), count: counts?.closed, tone: 'slate' },
    { value: 'all', label: t('promises.status.all'), count: counts ? counts.open + counts.closed : undefined },
  ];

  let body: ReactNode;
  if (promQ.isPending) {
    body = <SkeletonRows rows={4} className="p-4" />;
  } else if (promQ.isError && !data) {
    body = <ErrorBlock error={promQ.error} onRetry={() => promQ.refetch()} />;
  } else if (data && !data.installed) {
    body = <NotInstalled state={data} compact />;
  } else if (!rows.length) {
    body = <EmptyBlock icon={Handshake} title={status === 'open' ? t('promises.empty') : t('common.empty')} />;
  } else {
    body = (
      <div className={cn('max-h-[720px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 transition-opacity', busy && 'opacity-60')}>
        {rows.map((r) => (
          <PromiseItem key={r.id} row={r} maxReminders={data?.maxReminders || 3} />
        ))}
      </div>
    );
  }

  return (
    <SectionCard
      icon={Handshake}
      title={t('promises.title')}
      subtitle={t('promises.subtitle')}
      className="min-w-0"
      noBody
      actions={(
        <>
          {!!counts?.overdue && (
            <Pill tone="rose" dot pulse title={t('promises.overdue')}>{counts.overdue}</Pill>
          )}
          <RefreshButton onClick={() => promQ.refetch()} fetching={promQ.isFetching} />
        </>
      )}
    >
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <ChipFilter<PromiseFilter> value={status} options={options} onChange={setStatus} />
      </div>

      {promQ.isError && data && <InlineError message={promQ.error?.message} onRetry={() => promQ.refetch()} />}

      {body}

      <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 flex items-start gap-2 text-[10.5px] leading-relaxed text-slate-400 dark:text-slate-500">
        <BellRing className="h-3.5 w-3.5 shrink-0 mt-px" />
        <span>{t('promises.note')}</span>
      </div>
    </SectionCard>
  );
}

function PromiseItem({ row: r, maxReminders }: { row: PromiseRow; maxReminders: number }) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const isOpen = r.status === 'open';
  const used = Math.max(0, Math.min(maxReminders, r.reminderCount || 0));

  return (
    <div className={cn('relative px-4 py-3', isOpen && r.overdue && 'bg-rose-50/40 dark:bg-rose-950/15')}>
      <span className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-r', isOpen ? (r.overdue ? TONE_DOT.rose : TONE_DOT.violet) : TONE_DOT.slate)} />
      <div className={cn('text-[12.5px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] line-clamp-4', isOpen ? 'text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400')} title={r.text}>
        {r.text || '—'}
      </div>

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {r.trigger && <Pill tone="slate" mono title={t('promises.trigger')}>{r.trigger}</Pill>}
        {!isOpen && <Pill tone="slate" dot>{t.has(`promises.status.${r.status}`) ? t(`promises.status.${r.status}`) : r.status}</Pill>}
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400">{t('promises.due')}</div>
          <div className="text-[11.5px] font-semibold text-slate-700 dark:text-slate-200 tabular-nums" title={fmtDateTime(r.dueAt)}>
            {fmtShortDateTime(r.dueAt)}
          </div>
          {isOpen && <PromiseCountdown dueAt={r.dueAt} />}
        </div>
        <div className="min-w-0">
          <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400">
            {t('promises.reminders', { n: used, max: maxReminders })}
          </div>
          <div className="mt-1 flex items-center gap-1" aria-hidden>
            {Array.from({ length: maxReminders }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'w-2.5 h-2.5 rounded-full ring-1',
                  i < used
                    ? cn(r.overdue && isOpen ? 'bg-rose-500 ring-rose-500' : 'bg-amber-500 ring-amber-500')
                    : 'bg-transparent ring-slate-300 dark:ring-slate-600',
                )}
              />
            ))}
          </div>
          {r.lastRemindedAt && (
            <div className="mt-1 text-[10.5px] text-slate-400 dark:text-slate-500 truncate" title={`${t('promises.lastReminded')}: ${fmtDateTime(r.lastRemindedAt)}`}>
              {t('promises.lastReminded')}: {f.rel(r.lastRemindedAt)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Ochiq va'da: qolgan vaqt (har soniya) yoki muddati o'tgan (rose pulse) */
function PromiseCountdown({ dueAt }: { dueAt: string }) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const now = useNow(1000);
  const left = Date.parse(dueAt) - now;
  if (!Number.isFinite(left)) return null;
  if (left <= 0) {
    return <Pill tone="rose" dot pulse className="mt-1">{t('promises.overdue')}</Pill>;
  }
  return (
    <div className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-violet-600 dark:text-violet-400 tabular-nums">
      <Timer className="h-3 w-3" />
      {left < HOUR_MS ? t('promises.dueIn', { time: f.dur(left) }) : f.rel(dueAt, now)}
    </div>
  );
}

// ===========================================================================
function InlineError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const t = useTranslations('adminAgentTeam.common');
  return (
    <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[11.5px] ring-1 bg-rose-50/70 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 min-w-0 truncate">{t('loadError')}{message ? ` — ${message}` : ''}</span>
      <button type="button" onClick={onRetry} className="font-semibold hover:underline shrink-0">{t('retry')}</button>
    </div>
  );
}
