'use client';

/**
 * Agent Support -> Xotira ko'rinishi (ops).
 * agents/memory fayllari (brauzer + markdown ko'ruvchi), Teacher'ning tasdiq kutayotgan yozuvlari
 * (tasdiq FAQAT Telegram'da) va agent_memory yozuvlar logi.
 *
 * Fayllar backend oq ro'yxati orqali o'qiladi (MEMORY_CORE_FILES, MEMORY_AGENT_FILES, daily/YYYY-MM-DD.md).
 * Markdown faqat react-markdown + remark-gfm bilan (HTML render qilinmaydi, rasmlar yuklanmaydi).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen, CalendarDays, FileText, FolderOpen, FolderX, History, Hourglass, RotateCcw, Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentTeamApi, agentTeamKeys, AGENT_TEAM_REFRESH, type MemoryLogParams } from '@/lib/agent-team-api';
import {
  AGENT_NAMES,
  DAILY_FILE_RE,
  MEMORY_AGENT_FILES,
  MEMORY_CORE_FILES,
  MEMORY_SOURCES,
  type AgentName,
  type AgentTeamMemoryFile,
  type AgentTeamViewProps,
  type MemoryFileGroup,
  type MemoryFileMeta,
  type MemoryLogRow,
  type PendingMemoryWrite,
} from '@/lib/agent-team-types';
import {
  AgentAvatar, ChipFilter, CodeBlock, CopyButton, Drawer, EmptyBlock, ErrorBlock, IconButton, InfoRow,
  NotInstalled, Pager, Pill, ProgressBar, RefreshButton, RelTime, SearchBox, SectionCard, SelectBox,
  SkeletonRows, TelegramOnlyNotice,
  fmtDateTime, fmtShortDateTime, useAgentLabel, useAgentTeamFmt, useDebounced, useNow,
  type ChipOption,
} from './ui';

// ===========================================================================
// Konstantalar va yordamchilar
// ===========================================================================
const DEFAULT_FILE = 'INDEX.md';
const PER_PAGE = 25;
/** Sticky Topbar (h-24) + admin tab bar balandligi + zaxira; ko'ruvchi o'rovchisidagi scroll-mt-[152px] bilan bir xil */
const STICKY_OFFSET = 152;
const GROUPS: MemoryFileGroup[] = ['core', 'agent', 'daily'];
const WHITELIST: ReadonlySet<string> = new Set<string>([...MEMORY_CORE_FILES, ...MEMORY_AGENT_FILES]);

/**
 * Ixtiyoriy yo'l -> oq ro'yxatdagi xotira fayli nomi (yoki null).
 * agent_memory.path odatda 'agents/memory/learned.md' ko'rinishida — prefiks olib tashlanadi.
 */
function toMemoryName(path: string | null | undefined): string | null {
  let s = (path || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  for (const pre of ['agents/memory/', 'memory/']) {
    if (s.startsWith(pre)) { s = s.slice(pre.length); break; }
  }
  if (WHITELIST.has(s) || DAILY_FILE_RE.test(s)) return s;
  return null;
}

type ResultFilter = 'all' | 'ok' | 'rad';
type ViewMode = 'rendered' | 'raw';

// ===========================================================================
// Asosiy ko'rinish
// ===========================================================================
export function MemoryView({ canManage: _canManage, focus, onNavigate: _onNavigate }: AgentTeamViewProps) {
  const [selected, setSelected] = useState<string>(DEFAULT_FILE);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Konteyner fokusi: faqat oq ro'yxatdagi nom qabul qilinadi
  useEffect(() => {
    const name = toMemoryName(focus?.file);
    if (name) setSelected(name);
  }, [focus]);

  // Fayl tanlanganda ko'ruvchi ko'rinmasa (telefonda brauzer ostida yoki log'dan ochilganda — yuqorida) unga scroll.
  // Desktopda yonma-yon turganda sarlavha allaqachon ko'rinib tursa sahifa sakramaydi.
  const openFile = (name: string) => {
    setSelected(name);
    requestAnimationFrame(() => {
      const el = viewerRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top >= STICKY_OFFSET - 1 && top <= window.innerHeight * 0.5) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const filesQ = useQuery({
    queryKey: agentTeamKeys.memoryFiles(),
    queryFn: () => agentTeamApi.memoryFiles(),
    refetchInterval: AGENT_TEAM_REFRESH.memoryFiles,
  });

  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">
        <FileBrowser
          files={filesQ.data?.files}
          dir={filesQ.data?.dir}
          dirExists={filesQ.data?.dirExists ?? true}
          loading={filesQ.isLoading}
          error={filesQ.isError && !filesQ.data ? filesQ.error : null}
          fetching={filesQ.isFetching}
          onRefresh={() => { void filesQ.refetch(); }}
          selected={selected}
          onSelect={openFile}
        />
        {/* scroll-mt = STICKY_OFFSET (Topbar + admin tab bar + zaxira, ViewNav bilan bir xil) */}
        <div ref={viewerRef} className="min-w-0 scroll-mt-[152px]">
          <FileViewer name={selected} meta={filesQ.data?.files.find((f) => f.name === selected)} />
        </div>
      </div>
      <MemoryLog onOpenFile={openFile} />
    </div>
  );
}

// ===========================================================================
// Fayl brauzeri
// ===========================================================================
function FileBrowser({
  files, dir, dirExists, loading, error, fetching, onRefresh, selected, onSelect,
}: {
  files: MemoryFileMeta[] | undefined; dir: string | undefined; dirExists: boolean; loading: boolean; error: unknown;
  fetching: boolean; onRefresh: () => void; selected: string; onSelect: (name: string) => void;
}) {
  const t = useTranslations('adminAgentTeam.memory');
  const grouped = useMemo(() => {
    const g: Record<MemoryFileGroup, MemoryFileMeta[]> = { core: [], agent: [], daily: [] };
    for (const f of files ?? []) (g[f.group] ?? g.core).push(f);
    return g;
  }, [files]);

  return (
    <SectionCard
      icon={FolderOpen}
      title={t('filesTitle')}
      subtitle={<span className="font-mono">{dir || 'agents/memory'}</span>}
      actions={<RefreshButton onClick={onRefresh} fetching={fetching} />}
      noBody
    >
      {loading && !files ? (
        <div className="p-4"><SkeletonRows rows={7} /></div>
      ) : error ? (
        <ErrorBlock error={error} onRetry={onRefresh} />
      ) : (
        <div className="py-2 lg:max-h-[720px] lg:overflow-y-auto">
          {!dirExists && (
            <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg px-3 py-2 ring-1 ring-amber-200 dark:ring-amber-900 bg-amber-50/70 dark:bg-amber-950/30 text-[11.5px] text-amber-800 dark:text-amber-200">
              <FolderX className="h-4 w-4 shrink-0" /> {t('dirMissing')}
            </div>
          )}
          {GROUPS.map((g) => {
            const list = grouped[g];
            return (
              <div key={g} className="pb-1">
                <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">{t(`groups.${g}`)}</span>
                  <span className="text-[10px] font-bold text-slate-300 dark:text-slate-600 tabular-nums">{list.length}</span>
                  <span className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
                </div>
                {g === 'daily' && list.length === 0 ? (
                  <div className="px-4 py-2 text-[11.5px] text-slate-400 dark:text-slate-500">{t('noDaily')}</div>
                ) : (
                  <ul className={cn('px-2', g === 'daily' && 'max-h-[280px] overflow-y-auto')}>
                    {list.map((f) => (
                      <li key={f.name}>
                        <FileRow file={f} active={f.name === selected} onSelect={() => onSelect(f.name)} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function FileRow({ file, active, onSelect }: { file: MemoryFileMeta; active: boolean; onSelect: () => void }) {
  const t = useTranslations('adminAgentTeam.memory');
  const f = useAgentTeamFmt();
  const m = DAILY_FILE_RE.exec(file.name);
  const Icon = m ? CalendarDays : FileText;
  const label = m ? `${m[1]}.md` : file.name;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={file.exists ? file.name : `${file.name} — ${t('fileMissing')}`}
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors',
        active
          ? 'bg-violet-50 dark:bg-violet-950/40 ring-1 ring-violet-200 dark:ring-violet-800'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
        !file.exists && 'opacity-50',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400 dark:text-slate-500')} />
      <span className="flex-1 min-w-0">
        <span className={cn('block truncate font-mono text-[11.5px]', active ? 'text-violet-800 dark:text-violet-200 font-semibold' : 'text-slate-700 dark:text-slate-200')}>
          {label}
        </span>
        <span className="block text-[10px] text-slate-400 dark:text-slate-500 tabular-nums truncate">
          {file.exists ? (
            <>
              {f.bytes(file.size)}
              {file.mtime && <> · <RelTime iso={file.mtime} /></>}
            </>
          ) : (
            t('fileMissing')
          )}
        </span>
      </span>
      {file.injectMode && file.exists && (
        <span
          className="shrink-0 font-mono text-[9px] font-bold uppercase px-1 py-px rounded bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
          title={t('injected', { mode: t(file.injectMode), n: f.num(file.limitChars) })}
        >
          {file.injectMode}
        </span>
      )}
    </button>
  );
}

// ===========================================================================
// Fayl ko'ruvchi
// ===========================================================================
function FileViewer({ name, meta }: { name: string; meta: MemoryFileMeta | undefined }) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const [mode, setMode] = useState<ViewMode>('rendered');

  const q = useQuery({
    queryKey: agentTeamKeys.memoryFile(name),
    queryFn: () => agentTeamApi.memoryFile(name),
    enabled: !!name,
  });
  const file: AgentTeamMemoryFile | undefined = q.data;

  // Brauzer ro'yxatida fayl o'zgargani ko'rinsa (mtime/hajm) — ko'ruvchini yangilaymiz
  const metaSig = meta ? `${meta.exists}|${meta.mtime}|${meta.size}` : '';
  const dataSig = file ? `${file.exists}|${file.mtime}|${file.size}` : '';
  const { refetch, isFetching } = q;
  useEffect(() => {
    if (metaSig && dataSig && metaSig !== dataSig && !isFetching) void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaSig]);

  const content = file?.content ?? '';
  const rendered = useMemo(
    () => (mode === 'rendered' && content ? <Markdown remarkPlugins={[remarkGfm]} components={MD}>{content}</Markdown> : null),
    [mode, content],
  );

  const modeOptions: ChipOption<ViewMode>[] = [
    { value: 'rendered', label: t('memory.rendered') },
    { value: 'raw', label: t('memory.raw') },
  ];

  return (
    <SectionCard
      icon={BookOpen}
      title={<span className="font-mono">{name}</span>}
      subtitle={t('memory.subtitle')}
      actions={
        <>
          {file?.exists && content && <CopyButton text={content} className="w-9 h-9 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900" />}
          <RefreshButton onClick={() => { void refetch(); }} fetching={isFetching} />
        </>
      }
      noBody
    >
      {q.isLoading && !file ? (
        <div className="p-5"><SkeletonRows rows={8} /></div>
      ) : !file ? (
        q.isError ? <ErrorBlock error={q.error} onRetry={() => { void refetch(); }} /> : <EmptyBlock icon={BookOpen} title={t('memory.selectFile')} />
      ) : !file.exists ? (
        <EmptyBlock icon={FileText} title={t('memory.fileMissing')} desc={<span className="font-mono">agents/memory/{file.name}</span>} />
      ) : (
        <>
          {/* Meta + rejim */}
          <div className="px-5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
            <MetaItem label={t('memory.size')}>{f.bytes(file.size)}</MetaItem>
            <MetaItem label={t('memory.modified')}>
              <span title={fmtDateTime(file.mtime)}>{fmtShortDateTime(file.mtime)}</span>
              {file.mtime && <span className="text-slate-400 dark:text-slate-500"> · <RelTime iso={file.mtime} /></span>}
            </MetaItem>
            {file.injectMode && file.limitChars !== null && (
              <Pill tone="violet" mono>
                {t('memory.injected', { mode: t(`memory.${file.injectMode}`), n: f.num(file.limitChars) })}
              </Pill>
            )}
            <ChipFilter value={mode} options={modeOptions} onChange={setMode} className="ml-auto" />
          </div>

          {file.truncated && (
            <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg px-3 py-2 ring-1 ring-amber-200 dark:ring-amber-900 bg-amber-50/70 dark:bg-amber-950/30 text-[11.5px] text-amber-800 dark:text-amber-200">
              <Hourglass className="h-3.5 w-3.5 shrink-0" /> {t('memory.truncatedNote')}
            </div>
          )}

          {!content.trim() ? (
            <EmptyBlock icon={FileText} title={t('common.empty')} />
          ) : mode === 'raw' ? (
            <div className="p-5"><CodeBlock maxHeight={560}>{content}</CodeBlock></div>
          ) : (
            <div className="px-5 py-4 max-h-[620px] overflow-y-auto">
              <div className="min-w-0 break-words">{rendered}</div>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 text-[11.5px] tabular-nums">
      <span className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">{label}</span>
      <span className="text-slate-700 dark:text-slate-200">{children}</span>
    </span>
  );
}

// Xotira fayllari uchun markdown -> Tailwind (mavjud AI Agent MD_COMPONENTS uslubida, hujjat o'qish uchun biroz kengroq)
const MD: Components = {
  h1: ({ children }) => <h1 className="text-[16px] font-bold text-slate-900 dark:text-slate-100 mt-5 first:mt-0 mb-2 pb-1.5 border-b border-slate-100 dark:border-slate-800">{children}</h1>,
  h2: ({ children }) => <h2 className="text-[14px] font-bold text-slate-900 dark:text-slate-100 mt-4 first:mt-0 mb-1.5">{children}</h2>,
  h3: ({ children }) => <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 mt-3 first:mt-0 mb-1">{children}</h3>,
  h4: ({ children }) => <h4 className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 mt-3 mb-1">{children}</h4>,
  h5: ({ children }) => <h5 className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 mt-2 mb-1">{children}</h5>,
  h6: ({ children }) => <h6 className="text-[12px] font-semibold text-slate-600 dark:text-slate-300 mt-2 mb-1">{children}</h6>,
  p: ({ children }) => <p className="text-[12.5px] leading-relaxed text-slate-700 dark:text-slate-300 my-1.5">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-slate-100">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-slate-400 dark:text-slate-500">{children}</del>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener" className="text-violet-600 dark:text-violet-400 underline break-words">{children}</a>,
  // Tashqi rasm yuklanmaydi — faqat alt matni
  img: ({ alt }) => <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">[{alt || 'image'}]</span>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5 my-1.5 marker:text-slate-400">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5 my-1.5 marker:text-slate-400">{children}</ol>,
  li: ({ children }) => <li className="text-[12.5px] leading-relaxed text-slate-700 dark:text-slate-300">{children}</li>,
  input: ({ checked }) => <input type="checkbox" checked={!!checked} readOnly disabled className="mr-1.5 align-middle accent-violet-600" />,
  hr: () => <hr className="my-3 border-slate-200 dark:border-slate-700" />,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-violet-300 dark:border-violet-700 pl-3 my-2 text-slate-500 dark:text-slate-400">{children}</blockquote>,
  code: ({ className, children }) => {
    const block = /language-/.test(className || '') || String(children ?? '').includes('\n');
    if (block) {
      return <code className={cn('block p-3 rounded-lg bg-slate-900 dark:bg-slate-950 text-slate-100 text-[11.5px] leading-relaxed font-mono overflow-x-auto whitespace-pre', className)}>{children}</code>;
    }
    return <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11.5px] font-mono text-violet-700 dark:text-violet-300 break-words">{children}</code>;
  },
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  table: ({ children }) => (
    <div className="block overflow-x-auto my-2.5 ring-1 ring-slate-200 dark:ring-slate-700 rounded-lg">
      <table className="w-full text-[12px] border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  th: ({ children }) => <th className="bg-violet-50 dark:bg-violet-950/40 text-left font-semibold px-2.5 py-1.5 text-slate-700 dark:text-slate-200 whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="px-2.5 py-1.5 border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300 align-top">{children}</td>,
  tr: ({ children }) => <tr className="even:bg-slate-50/60 dark:even:bg-slate-800/30">{children}</tr>,
};

// ===========================================================================
// Tasdiq kutayotgan yozuvlar + yozuvlar logi
// ===========================================================================
function MemoryLog({ onOpenFile }: { onOpenFile: (name: string) => void }) {
  const t = useTranslations('adminAgentTeam');
  const agentLabel = useAgentLabel();

  const [result, setResult] = useState<ResultFilter>('all');
  const [source, setSource] = useState<string>('all');
  const [agent, setAgent] = useState<string>('all');
  const [search, setSearch] = useState('');
  const dq = useDebounced(search.trim(), 200);
  const [openRow, setOpenRow] = useState<MemoryLogRow | null>(null);

  // Sahifa filtrga bog'langan (ActivityView/TasksView naqshi): filtr yoki qidiruv o'zgarsa
  // o'sha render'dayoq 1-sahifa — effekt ham, eski sahifa bilan ortiqcha so'rov ham yo'q
  const filterKey = JSON.stringify({ result, source, agent, dq });
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ key: filterKey, page: p });

  const params: MemoryLogParams = {
    result: result === 'all' ? '' : result,
    source: source === 'all' ? '' : source,
    agent: agent === 'all' ? '' : (agent as AgentName),
    q: dq,
    page,
    perPage: PER_PAGE,
  };

  const q = useQuery({
    queryKey: agentTeamKeys.memoryLog(params),
    queryFn: () => agentTeamApi.memoryLog(params),
    refetchInterval: AGENT_TEAM_REFRESH.memoryLog,
    placeholderData: keepPreviousData,
  });
  const data = q.data;
  const refresh = () => { void q.refetch(); };
  const hasFilters = result !== 'all' || source !== 'all' || agent !== 'all' || search !== '';
  const reset = () => { setResult('all'); setSource('all'); setAgent('all'); setSearch(''); };

  const resultOptions: ChipOption<ResultFilter>[] = [
    { value: 'all', label: t('common.all'), count: data ? data.counts.ok + data.counts.rad : undefined },
    { value: 'ok', label: t('memory.result.ok'), count: data?.counts.ok, tone: 'emerald' },
    { value: 'rad', label: t('memory.result.rad'), count: data?.counts.rad, tone: 'rose' },
  ];
  const sourceOptions = [
    { value: 'all', label: `${t('memory.columns.source')}: ${t('common.all')}` },
    ...MEMORY_SOURCES.map((s) => ({ value: s as string, label: t(`memory.sources.${s}`) })),
  ];
  const agentOptions = [
    { value: 'all', label: `${t('memory.columns.agent')}: ${t('common.all')}` },
    ...AGENT_NAMES.map((a) => ({ value: a as string, label: agentLabel(a) })),
  ];

  const pending = data?.installed ? data.pending : [];

  return (
    <>
      {pending.length > 0 && <PendingWrites items={pending} />}

      <SectionCard
        icon={History}
        title={t('memory.logTitle')}
        subtitle={t('memory.logSubtitle')}
        actions={
          <>
            {hasFilters && <IconButton icon={RotateCcw} title={t('common.resetFilters')} onClick={reset} />}
            <RefreshButton onClick={refresh} fetching={q.isFetching} />
          </>
        }
        noBody
      >
        {data && !data.installed ? (
          <NotInstalled state={data} compact />
        ) : (
          <>
            <div className="px-5 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-slate-800">
              <ChipFilter value={result} options={resultOptions} onChange={setResult} />
              <SelectBox value={source} options={sourceOptions} onChange={setSource} title={t('memory.columns.source')} />
              <SelectBox value={agent} options={agentOptions} onChange={setAgent} title={t('memory.columns.agent')} />
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder={t('memory.search')}
                busy={q.isFetching && q.isPlaceholderData}
                className="flex-1 min-w-[200px] sm:max-w-[360px] ml-auto"
              />
            </div>

            {q.isLoading && !data ? (
              <div className="p-5"><SkeletonRows rows={6} /></div>
            ) : !data ? (
              <ErrorBlock error={q.error} onRetry={refresh} />
            ) : data.rows.length === 0 ? (
              <EmptyBlock icon={History} title={hasFilters ? t('common.noResults') : t('memory.empty')} />
            ) : (
              <div className={cn('overflow-x-auto transition-opacity', q.isPlaceholderData && 'opacity-60')}>
                <table className="w-full min-w-[900px] text-[12px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider font-bold text-slate-400 bg-slate-50/70 dark:bg-slate-900/50 text-left">
                      <th className="px-4 py-2 font-bold">{t('memory.columns.time')}</th>
                      <th className="px-3 py-2 font-bold">{t('memory.columns.source')}</th>
                      <th className="px-3 py-2 font-bold">{t('memory.columns.agent')}</th>
                      <th className="px-3 py-2 font-bold">{t('memory.columns.path')}</th>
                      <th className="px-3 py-2 font-bold">{t('memory.columns.mode')}</th>
                      <th className="px-3 py-2 font-bold">{t('memory.columns.result')}</th>
                      <th className="px-3 py-2 font-bold">{t('memory.columns.content')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.rows.map((r) => (
                      <LogRow key={r.id} row={r} onOpen={() => setOpenRow(r)} onOpenFile={onOpenFile} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data && data.installed && data.total > 0 && (
              <Pager page={data.page} perPage={data.perPage} total={data.total} onPage={setPage} busy={q.isFetching} />
            )}
          </>
        )}
      </SectionCard>

      <LogDrawer row={openRow} onClose={() => setOpenRow(null)} onOpenFile={(n) => { setOpenRow(null); onOpenFile(n); }} />
    </>
  );
}

function sourceLabel(t: ReturnType<typeof useTranslations>, s: string): string {
  const k = `memory.sources.${s}`;
  return t.has(k) ? t(k) : s || '—';
}
function modeLabel(t: ReturnType<typeof useTranslations>, m: string): string {
  const k = `memory.modes.${m}`;
  return t.has(k) ? t(k) : m || '—';
}

function LogRow({ row: r, onOpen, onOpenFile }: { row: MemoryLogRow; onOpen: () => void; onOpenFile: (name: string) => void }) {
  const t = useTranslations('adminAgentTeam');
  const agentLabel = useAgentLabel();
  const fileName = toMemoryName(r.path);
  return (
    <tr
      onClick={onOpen}
      className={cn(
        'hover:bg-violet-50/40 dark:hover:bg-violet-950/20 cursor-pointer align-top',
        r.rejected && 'bg-rose-50/40 dark:bg-rose-950/10',
      )}
    >
      <td className={cn('pl-3.5 pr-3 py-2.5 whitespace-nowrap border-l-[3px]', r.rejected ? 'border-rose-400 dark:border-rose-600' : 'border-emerald-400 dark:border-emerald-600')}>
        <div className="text-slate-700 dark:text-slate-200 tabular-nums" title={fmtDateTime(r.ts)}>{fmtShortDateTime(r.ts)}</div>
        <RelTime iso={r.ts} className="text-[10.5px] text-slate-400 dark:text-slate-500" />
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300">{sourceLabel(t, r.source)}</td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {r.agent ? (
          <span className="inline-flex items-center gap-1.5">
            <AgentAvatar name={r.agent} size="sm" />
            <span className="text-slate-700 dark:text-slate-200">{agentLabel(r.agent)}</span>
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="w-[200px] min-w-0">
          {fileName ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenFile(fileName); }}
              title={`${t('common.open')}: ${r.path}`}
              className="inline-flex items-center gap-1 max-w-full font-mono text-[11px] text-violet-700 dark:text-violet-300 hover:underline text-left"
            >
              <BookOpen className="h-3 w-3 shrink-0" />
              <span className="truncate">{r.path}</span>
            </button>
          ) : (
            <span className="block font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate" title={r.path}>{r.path || '—'}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <Pill tone={r.mode === 'write' ? 'amber' : 'slate'}>{modeLabel(t, r.mode)}</Pill>
      </td>
      <td className="px-3 py-2.5">
        <div className="w-[220px] min-w-0">
        {r.rejected ? (
          <div className="min-w-0">
            <Pill tone="rose" dot>{t('memory.result.rad')}</Pill>
            {r.rejectReason && (
              <div className="mt-1 text-[11px] text-rose-700 dark:text-rose-300 line-clamp-2 break-words" title={r.rejectReason}>{r.rejectReason}</div>
            )}
          </div>
        ) : (
          <div className="min-w-0">
            <Pill tone="emerald" dot>{t('memory.result.ok')}</Pill>
            {r.result && (
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 break-words" title={r.result}>{r.result}</div>
            )}
          </div>
        )}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="min-w-[240px] max-w-[420px] text-[11.5px] text-slate-600 dark:text-slate-300 line-clamp-2 break-words whitespace-pre-line">{r.content || '—'}</div>
      </td>
    </tr>
  );
}

function LogDrawer({ row, onClose, onOpenFile }: { row: MemoryLogRow | null; onClose: () => void; onOpenFile: (name: string) => void }) {
  const t = useTranslations('adminAgentTeam');
  const agentLabel = useAgentLabel();
  const fileName = row ? toMemoryName(row.path) : null;
  return (
    <Drawer
      open={!!row}
      onClose={onClose}
      title={row ? `#${row.id} · ${row.path}` : ''}
      subtitle={row ? fmtDateTime(row.ts) : undefined}
      icon={History}
      tone={row?.rejected ? 'rose' : 'emerald'}
      actions={fileName ? <IconButton icon={BookOpen} title={t('common.open')} onClick={() => onOpenFile(fileName)} /> : undefined}
    >
      {row && (
        <>
          <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 px-4 py-1">
            <InfoRow label={t('memory.columns.time')}>
              {fmtDateTime(row.ts)} <span className="text-slate-400">· <RelTime iso={row.ts} /></span>
            </InfoRow>
            <InfoRow label={t('memory.columns.source')}>{sourceLabel(t, row.source)}</InfoRow>
            <InfoRow label={t('memory.columns.agent')}>
              {row.agent ? (
                <span className="inline-flex items-center gap-1.5"><AgentAvatar name={row.agent} size="sm" /> {agentLabel(row.agent)}</span>
              ) : '—'}
            </InfoRow>
            <InfoRow label={t('memory.columns.path')} mono>{row.path || '—'}</InfoRow>
            <InfoRow label={t('memory.columns.mode')}>{modeLabel(t, row.mode)}</InfoRow>
            <InfoRow label={t('memory.columns.result')}>
              {row.rejected ? (
                <span className="inline-flex flex-col gap-1">
                  <Pill tone="rose" dot className="self-start">{t('memory.result.rad')}</Pill>
                  {row.rejectReason && <span className="text-rose-700 dark:text-rose-300">{row.rejectReason}</span>}
                </span>
              ) : (
                <span className="inline-flex flex-col gap-1">
                  <Pill tone="emerald" dot className="self-start">{t('memory.result.ok')}</Pill>
                  {row.result && <span className="text-slate-600 dark:text-slate-300">{row.result}</span>}
                </span>
              )}
            </InfoRow>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">{t('memory.columns.content')}</div>
            <CodeBlock tone={row.rejected ? 'rose' : 'slate'} maxHeight={520} copyText={row.content}>{row.content || '—'}</CodeBlock>
          </div>
          <div className="text-[10.5px] text-slate-400 dark:text-slate-500">{t('common.masked')}</div>
        </>
      )}
    </Drawer>
  );
}

// Teacher yozuvlari — Telegram'da [Ha]/[Yo'q] kutmoqda (web'da tasdiq tugmasi YO'Q)
function PendingWrites({ items }: { items: PendingMemoryWrite[] }) {
  const t = useTranslations('adminAgentTeam');
  return (
    <SectionCard
      icon={Hourglass}
      tone="amber"
      title={t('memory.pendingTitle')}
      subtitle={t('memory.pendingDesc')}
      actions={<TelegramOnlyNotice compact />}
    >
      <div className="space-y-3">
        {items.map((p) => (
          <div key={p.ref + (p.createdAt || '')} className="relative rounded-xl ring-1 ring-amber-200 dark:ring-amber-900/70 bg-white dark:bg-slate-900/40 overflow-hidden">
            <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', p.expired ? 'bg-slate-400' : 'bg-amber-500')} />
            <div className="pl-4 pr-3 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-slate-800 bg-amber-50/40 dark:bg-amber-950/10">
              <Pill tone="violet" mono>#{p.ref}</Pill>
              <Pill tone="slate">{t('memory.manba', { manba: p.manba || '—' })}</Pill>
              {p.sababTuri && <Pill tone="slate" mono>{p.sababTuri}</Pill>}
              <Pill tone="slate">{t('memory.blocks', { n: p.blocks.length })}</Pill>
              <span className="ml-auto">
                {p.expired || !p.expiresAt ? (
                  <Pill tone="slate" dot>{t('plans.expired')}</Pill>
                ) : (
                  <WriteCountdown expiresAt={p.expiresAt} createdAt={p.createdAt} />
                )}
              </span>
            </div>
            <div className="pl-4 pr-3 py-3 space-y-3">
              {p.blocks.map((b, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-1.5 min-w-0">
                    <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono text-[11px] text-slate-700 dark:text-slate-200 truncate" title={b.path}>{b.path}</span>
                    <Pill tone={b.mode === 'write' ? 'amber' : 'slate'}>{modeLabel(t, b.mode)}</Pill>
                  </div>
                  <CodeBlock maxHeight={260} copyText={b.content}>{b.content || '—'}</CodeBlock>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function WriteCountdown({ expiresAt, createdAt }: { expiresAt: string; createdAt: string | null }) {
  const t = useTranslations('adminAgentTeam.plans');
  const now = useNow(1000);
  const f = useAgentTeamFmt();
  const left = Date.parse(expiresAt) - now;
  if (!(left > 0)) return <Pill tone="slate" dot>{t('expired')}</Pill>;
  const created = createdAt ? Date.parse(createdAt) : NaN;
  const total = Number.isFinite(created) && Date.parse(expiresAt) > created ? Date.parse(expiresAt) - created : 600_000;
  const ratio = left / total;
  const low = ratio < 0.2;
  return (
    <span className="inline-flex items-center gap-2" title={fmtDateTime(expiresAt)}>
      <Pill tone="amber" dot pulse>{t('waiting')}</Pill>
      <span className={cn('inline-flex items-center gap-1 font-mono text-[11px] tabular-nums', low ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-300')}>
        <Timer className="h-3.5 w-3.5" /> {t('expiresIn', { time: f.dur(Math.ceil(left / 1000) * 1000) })}
      </span>
      <ProgressBar value={ratio} tone={low ? 'rose' : 'amber'} className="w-20" />
    </span>
  );
}

