'use client';

/**
 * Agent Support -> Salomatlik ko'rinishi (ops).
 * Checker komponentlar holati (oxirgi 12 tekshiruv chizig'i bilan), Facts fayli holati va bo'limlari,
 * ogohlantirishlar tarixi (30 kun) va agents.kv_store holat kalitlari (faqat xavfsiz qiymatlar).
 *
 * Lease qiymatlaridan faqat `until` ko'rsatiladi — egasi (owner) backend'dan kelmaydi va ko'rsatilmaydi.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import {
  Activity, ArrowLeftRight, Bell, Bot, Braces, Database, FileJson, FileSpreadsheet, HardDrive, HeartPulse,
  KeyRound, Landmark, Network, Rocket, Scale, Server, Stethoscope, Timer, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentTeamApi, agentTeamKeys, AGENT_TEAM_REFRESH } from '@/lib/agent-team-api';
import {
  HEALTH_STATUSES,
  type AgentTeamHealth,
  type AgentTeamViewProps,
  type AlertRow,
  type FactsSection,
  type FactsState,
  type HealthComponentState,
  type HealthStatus,
  type KvKeyState,
} from '@/lib/agent-team-types';
import {
  ChipFilter, CodeBlock, CopyButton, Drawer, EmptyBlock, ErrorBlock, HealthBadge, NotInstalled, Pill,
  ProgressBar, RefreshButton, RelTime, SectionCard, SkeletonRows, StatusDot, TONE_DOT, TONE_ICON_TILE, TONE_TILE,
  factsTone, fmtDateTime, fmtShortDateTime, healthTone, isAgentName, kvMeaningId, useAgentLabel, useAgentTeamFmt,
  useNow, type ChipOption, type IconType, type Tone,
} from './ui';

// ===========================================================================
// Konstantalar
// ===========================================================================
/** checker_worker CHECK_SEVERITY: ok < unknown < warn < error */
const SEVERITY: Record<string, number> = { ok: 0, unknown: 1, warn: 2, error: 3 };
const RECENT_N = 12;
/** Facts "old" chegarasi (ProgressBar = ageSec / 1800) */
const FACTS_OLD_S = 1800;

const COMPONENT_ICON: Record<string, IconType> = {
  services: Server,
  db: Database,
  disk: HardDrive,
  facts: FileJson,
  leader_bot: Bot,
  deploy: Rocket,
  bank_sync: Landmark,
  sverka: Scale,
  xonpay: Wallet,
  google_export: FileSpreadsheet,
  oplatykv_sync: ArrowLeftRight,
  agents: Network,
};

/** Sarlavha gradienti (JIT uchun statik satrlar) */
const HEADER_GRADIENT: Record<Tone, string> = {
  emerald: 'border-emerald-100 dark:border-emerald-950 from-emerald-500/[0.10] via-emerald-500/[0.03] to-transparent',
  amber: 'border-amber-100 dark:border-amber-950 from-amber-500/[0.12] via-amber-500/[0.04] to-transparent',
  rose: 'border-rose-100 dark:border-rose-950 from-rose-500/[0.12] via-rose-500/[0.04] to-transparent',
  slate: 'border-slate-100 dark:border-slate-800 from-slate-500/[0.06] to-transparent',
  violet: 'border-violet-100 dark:border-violet-950 from-violet-500/[0.10] via-fuchsia-500/[0.04] to-transparent',
  sky: 'border-sky-100 dark:border-sky-950 from-sky-500/[0.10] to-transparent',
  indigo: 'border-indigo-100 dark:border-indigo-950 from-indigo-500/[0.10] to-transparent',
  teal: 'border-teal-100 dark:border-teal-950 from-teal-500/[0.10] to-transparent',
  fuchsia: 'border-fuchsia-100 dark:border-fuchsia-950 from-fuchsia-500/[0.10] to-transparent',
};

/** Tekshiruv chizig'ida ustun balandligi — og'irlik bo'yicha (texnik o'qish uchun) */
const TICK_HEIGHT: Record<string, string> = { ok: '45%', unknown: '60%', warn: '80%', error: '100%' };

function worstOf(components: HealthComponentState[]): HealthStatus | null {
  let w: HealthStatus | null = null;
  for (const c of components) {
    if (w === null || (SEVERITY[c.status] ?? 1) > (SEVERITY[w] ?? 1)) w = c.status;
  }
  return w;
}

function detailsText(details: unknown): string {
  if (details === null || details === undefined) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

// ===========================================================================
// Asosiy ko'rinish
// ===========================================================================
export function HealthView({ canManage: _canManage, focus, onNavigate: _onNavigate }: AgentTeamViewProps) {
  const t = useTranslations('adminAgentTeam');

  const q = useQuery({
    queryKey: agentTeamKeys.health(),
    queryFn: () => agentTeamApi.health(),
    refetchInterval: AGENT_TEAM_REFRESH.health,
  });
  const data = q.data;
  const refresh = () => { void q.refetch(); };

  const [detailsOf, setDetailsOf] = useState<HealthComponentState | null>(null);

  // --- Fokus: komponent kartasiga scroll + qisqa violet halqa -------------------
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const hlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (focus?.component) setPendingFocus(focus.component);
  }, [focus]);

  useEffect(() => {
    if (!pendingFocus || !data) return;
    const comp = pendingFocus;
    setPendingFocus(null);
    setHighlight(comp);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    // Konteyner o'z scroll'ini boshlab olsin — keyin kartaga o'tamiz
    scrollTimer.current = setTimeout(() => {
      const el =
        (comp === 'facts' ? document.getElementById('health-facts') : null) ??
        document.getElementById(`health-comp-${comp}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 160);
    if (hlTimer.current) clearTimeout(hlTimer.current);
    hlTimer.current = setTimeout(() => setHighlight(null), 2600);
  }, [pendingFocus, data]);

  useEffect(() => () => {
    if (hlTimer.current) clearTimeout(hlTimer.current);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
  }, []);

  // --- Holatlar --------------------------------------------------------------
  if (q.isLoading && !data) {
    return (
      <div className="space-y-5">
        <SectionCard icon={HeartPulse} title={t('health.title')} subtitle={t('health.checkerEvery')}>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[132px] rounded-xl bg-slate-100 dark:bg-slate-800/70 animate-pulse" style={{ opacity: 1 - i * 0.1 }} />
            ))}
          </div>
        </SectionCard>
        <SectionCard icon={Database} title={t('health.facts.title')}><SkeletonRows rows={3} /></SectionCard>
      </div>
    );
  }

  if (!data) {
    return (
      <SectionCard icon={HeartPulse} title={t('health.title')} subtitle={t('health.subtitle')} actions={<RefreshButton onClick={refresh} fetching={q.isFetching} />}>
        <ErrorBlock error={q.error} onRetry={refresh} />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-5">
      <ComponentsCard
        data={data}
        fetching={q.isFetching}
        onRefresh={refresh}
        highlight={highlight}
        onDetails={setDetailsOf}
      />

      {data.installed ? (
        <div className="grid xl:grid-cols-2 gap-5 items-start">
          <FactsPanel facts={data.facts} highlight={highlight === 'facts'} />
          <AlertsCard alerts={data.alerts} />
        </div>
      ) : (
        <FactsPanel facts={data.facts} highlight={highlight === 'facts'} />
      )}

      {data.installed && <KvCard kv={data.kv} />}

      <DetailsDrawer comp={detailsOf} onClose={() => setDetailsOf(null)} />
    </div>
  );
}

// ===========================================================================
// Sarlavha + komponentlar to'ri
// ===========================================================================
function ComponentsCard({
  data, fetching, onRefresh, highlight, onDetails,
}: {
  data: AgentTeamHealth; fetching: boolean; onRefresh: () => void; highlight: string | null;
  onDetails: (c: HealthComponentState) => void;
}) {
  const t = useTranslations('adminAgentTeam');
  const worst = useMemo(() => worstOf(data.components), [data.components]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const x of data.components) c[x.status] = (c[x.status] ?? 0) + 1;
    return c;
  }, [data.components]);
  const tone: Tone = data.installed ? healthTone(worst) : 'slate';

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className={cn('px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-3 border-b bg-gradient-to-r', HEADER_GRADIENT[tone])}>
        <div className="flex items-center gap-3.5 flex-1 basis-[240px] min-w-0">
          <span className={cn('relative w-11 h-11 rounded-2xl grid place-items-center shrink-0 text-white shadow-md', TONE_ICON_TILE[tone])}>
            {worst === 'error' && <span className="absolute inset-0 rounded-2xl ring-2 ring-rose-400 animate-ping opacity-40" />}
            <HeartPulse className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{t('health.title')}</span>
              {data.installed && worst && <HealthBadge status={worst} />}
              {data.installed && HEALTH_STATUSES.filter((s) => (counts[s] ?? 0) > 0).map((s) => (
                <Pill key={s} tone={healthTone(s)} className="tabular-nums">
                  {t(`health.status.${s}`)} {counts[s]}
                </Pill>
              ))}
            </div>
            <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">{t('health.checkerEvery')}</div>
          </div>
        </div>
        {/* Mobil: o'ng guruh alohida to'liq qatorda (CheckTimes qisqaradi, Yangilash tugmasi kesilmaydi);
            sm+: sarlavha yonida o'ngda, CheckTimes 250px */}
        <div className={cn('flex items-center justify-end gap-3 sm:gap-4 ml-auto min-w-0 max-w-full', data.installed && 'w-full sm:w-auto')}>
          {data.installed && (
            <CheckTimes last={data.checkerLastRunAt} next={data.nextCheckAt} intervalS={data.checkerIntervalS} />
          )}
          <RefreshButton onClick={onRefresh} fetching={fetching} />
        </div>
      </div>

      <div className="p-5">
        {!data.installed ? (
          <NotInstalled state={data} compact />
        ) : data.components.length === 0 ? (
          <EmptyBlock icon={Stethoscope} title={t('health.noChecks')} desc={t('health.checkerEvery')} />
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.components.map((c) => (
              <ComponentCard key={c.component} comp={c} highlight={highlight === c.component} onDetails={() => onDetails(c)} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Oxirgi / keyingi tekshiruv (jonli hisoblagich, har 1 s) */
function CheckTimes({ last, next, intervalS }: { last: string | null; next: string | null; intervalS: number }) {
  const t = useTranslations('adminAgentTeam');
  const now = useNow(1000);
  const f = useAgentTeamFmt();
  const nextMs = next ? Date.parse(next) : NaN;
  const lastMs = last ? Date.parse(last) : NaN;
  const left = Number.isFinite(nextMs) ? nextMs - now : NaN;
  const overdue = Number.isFinite(left) && left <= 0;
  const elapsed = Number.isFinite(lastMs) ? (now - lastMs) / Math.max(1, intervalS * 1000) : 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 min-w-0 flex-1 sm:flex-none sm:w-[250px]">
      <div className="min-w-0">
        <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 truncate">{t('health.lastCheck')}</div>
        <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 tabular-nums truncate">
          {last ? f.rel(last, now) : t('common.never')}
        </div>
        <div className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums truncate" title={fmtDateTime(last)}>{fmtDateTime(last)}</div>
      </div>
      <div className="min-w-0">
        <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 truncate">{t('health.nextCheck')}</div>
        <div
          className={cn('text-[13px] font-bold font-mono tabular-nums flex items-center gap-1 min-w-0', overdue ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100')}
          title={fmtDateTime(next)}
        >
          <Timer className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="truncate min-w-0">
            {!next ? t('common.none') : overdue ? f.rel(next, now) : f.dur(Math.ceil(left / 1000) * 1000)}
          </span>
        </div>
        <ProgressBar value={elapsed} tone={overdue ? 'amber' : 'violet'} className="mt-1.5" />
      </div>
    </div>
  );
}

function ComponentCard({ comp: c, highlight, onDetails }: { comp: HealthComponentState; highlight: boolean; onDetails: () => void }) {
  const t = useTranslations('adminAgentTeam');
  const tone = healthTone(c.status);
  const Icon = COMPONENT_ICON[c.component] ?? Activity;
  const key = `health.components.${c.component}`;
  const label = t.has(key) ? t(key) : c.component;
  const hasDetails = c.details !== null && c.details !== undefined && c.details !== '';
  return (
    <div
      id={`health-comp-${c.component}`}
      className={cn(
        'relative rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900/40 overflow-hidden pl-4 pr-3 py-3 scroll-mt-24 transition-shadow duration-300',
        highlight && 'ring-2 ring-violet-400 dark:ring-violet-500 shadow-lg shadow-violet-500/15',
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_DOT[tone])} />
      <div className="flex items-start gap-2.5">
        <span className={cn('w-8 h-8 rounded-lg grid place-items-center ring-1 shrink-0', TONE_TILE[tone])}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[12.5px] font-bold text-slate-800 dark:text-slate-100 truncate">{label}</span>
            {label !== c.component && <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 truncate">{c.component}</span>}
          </div>
          <RelTime iso={c.ts} className="text-[10.5px] text-slate-400 dark:text-slate-500" />
        </div>
        <HealthBadge status={c.status} />
        {hasDetails && (
          <button
            type="button"
            onClick={onDetails}
            title={t('common.details')}
            aria-label={t('common.details')}
            className="w-7 h-7 -mr-1 grid place-items-center rounded-md text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/40 transition-colors shrink-0"
          >
            <Braces className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-slate-600 dark:text-slate-300 line-clamp-2 break-words min-h-[2.5em]" title={c.message ?? undefined}>
        {c.message || '—'}
      </p>
      <RecentStrip recent={c.recent} />
    </div>
  );
}

/** Oxirgi 12 tekshiruv: rang = status, balandlik = og'irlik, eng o'ngdagisi — oxirgisi */
function RecentStrip({ recent }: { recent: HealthComponentState['recent'] }) {
  const t = useTranslations('adminAgentTeam');
  const list = recent.slice(-RECENT_N);
  const pad = Math.max(0, RECENT_N - list.length);
  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">{t('health.recent')}</span>
        <span className="font-mono text-[9.5px] text-slate-400 dark:text-slate-500 tabular-nums">{list.length}/{RECENT_N}</span>
      </div>
      <div className="flex items-end gap-[3px] h-6">
        {Array.from({ length: pad }).map((_, i) => (
          <span key={`p${i}`} className="flex-1 h-[30%] rounded-[2px] bg-slate-100 dark:bg-slate-800/70" />
        ))}
        {list.map((r, i) => {
          const s = r.status;
          const lbl = t.has(`health.status.${s}`) ? t(`health.status.${s}`) : s;
          const isLast = i === list.length - 1;
          return (
            <span
              key={`${r.ts}-${i}`}
              title={`${fmtDateTime(r.ts)} · ${lbl}`}
              className={cn('flex-1 rounded-[2px] transition-all', TONE_DOT[healthTone(s)], isLast ? 'opacity-100 ring-1 ring-offset-1 ring-slate-300 dark:ring-slate-600 ring-offset-white dark:ring-offset-slate-900' : 'opacity-75 hover:opacity-100')}
              style={{ height: TICK_HEIGHT[s] ?? '60%' }}
            />
          );
        })}
      </div>
    </div>
  );
}

function DetailsDrawer({ comp, onClose }: { comp: HealthComponentState | null; onClose: () => void }) {
  const t = useTranslations('adminAgentTeam');
  const text = comp ? detailsText(comp.details) : '';
  const key = comp ? `health.components.${comp.component}` : '';
  const label = comp ? (t.has(key) ? t(key) : comp.component) : '';
  return (
    <Drawer
      open={!!comp}
      onClose={onClose}
      title={label}
      subtitle={comp ? `${comp.component} · ${fmtDateTime(comp.ts)}` : undefined}
      icon={Braces}
      tone={comp ? healthTone(comp.status) : 'violet'}
    >
      {comp && (
        <>
          <div className="flex items-start gap-2.5">
            <HealthBadge status={comp.status} />
            <RelTime iso={comp.ts} className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5" />
          </div>
          {comp.message && (
            <div className="text-[12.5px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">{comp.message}</div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">{t('common.details')}</div>
            <CodeBlock maxHeight={600} copyText={text}>{text || '—'}</CodeBlock>
          </div>
        </>
      )}
    </Drawer>
  );
}

// ===========================================================================
// Facts paneli
// ===========================================================================
function FactsPanel({ facts, highlight }: { facts: FactsState; highlight: boolean }) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const tone = factsTone(facts.freshness);
  const ratio = facts.ageSec !== null ? facts.ageSec / FACTS_OLD_S : 0;
  const staleMark = Math.min(1, facts.staleAfterS / FACTS_OLD_S);
  const openSection = facts.sections.find((s) => s.key === openKey) ?? null;

  return (
    <SectionCard
      id="health-facts"
      icon={Database}
      tone="teal"
      title={t('health.facts.title')}
      subtitle={<span className="font-mono">{facts.path}</span>}
      className={cn('scroll-mt-24 transition-shadow duration-300', highlight && 'ring-2 ring-violet-400 dark:ring-violet-500')}
      actions={
        <Pill tone={tone} dot pulse={facts.freshness === 'fresh'}>
          {t(`health.facts.${facts.freshness}`)}
        </Pill>
      }
    >
      {facts.parseError && (
        <div className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2 ring-1 ring-rose-200 dark:ring-rose-900 bg-rose-50/70 dark:bg-rose-950/30 text-[11.5px] font-semibold text-rose-700 dark:text-rose-300">
          <FileJson className="h-4 w-4 shrink-0" /> {t('health.facts.parseError')}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FactsMetric label={t('health.facts.updated')}>
          <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 tabular-nums" title={fmtDateTime(facts.updatedAt)}>
            {fmtShortDateTime(facts.updatedAt)}
          </div>
          {facts.updatedAt && <RelTime iso={facts.updatedAt} className="text-[10.5px] text-slate-400 dark:text-slate-500" />}
        </FactsMetric>
        <FactsMetric label={t('health.facts.age')}>
          <div className={cn('text-[13px] font-bold font-mono tabular-nums', facts.freshness === 'fresh' ? 'text-emerald-700 dark:text-emerald-300' : facts.freshness === 'stale' ? 'text-amber-700 dark:text-amber-300' : facts.freshness === 'old' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-500')}>
            {facts.ageSec !== null ? f.dur(facts.ageSec * 1000) : t('common.none')}
          </div>
          <div className="relative mt-1.5">
            <ProgressBar value={ratio} tone={tone} />
            {/* 15 daq (eskirgan) chegarasi belgisi */}
            <span aria-hidden className="absolute -top-0.5 h-2.5 w-px bg-slate-400 dark:bg-slate-500" style={{ left: `${staleMark * 100}%` }} />
          </div>
        </FactsMetric>
        <FactsMetric label={t('health.facts.size')}>
          <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 tabular-nums">{f.bytes(facts.sizeBytes)}</div>
        </FactsMetric>
      </div>
      <div className="mt-2.5 text-[11px] text-slate-500 dark:text-slate-400">{t('health.facts.every')}</div>

      <div className="mt-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">{t('health.facts.sections')}</span>
          <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">{facts.sections.length}</span>
          {facts.errorSections > 0 && (
            <Pill tone="rose" dot className="ml-auto">{t('health.facts.errorsN', { n: facts.errorSections })}</Pill>
          )}
        </div>
        {facts.sections.length === 0 ? (
          <div className="text-[11.5px] text-slate-400 dark:text-slate-500">{t('common.empty')}</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {facts.sections.map((s) => (
              <SectionChip key={s.key} section={s} onOpen={() => setOpenKey(s.key)} />
            ))}
          </div>
        )}
      </div>

      <FactsSectionDrawer sectionKey={openKey} section={openSection} onClose={() => setOpenKey(null)} />
    </SectionCard>
  );
}

function FactsMetric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 bg-slate-50/60 dark:bg-slate-900/50 px-3 py-2.5 min-w-0">
      <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function SectionChip({ section: s, onOpen }: { section: FactsSection; onOpen: () => void }) {
  const t = useTranslations('adminAgentTeam.health.facts');
  const hint = s.error || s.izoh || (s.ok ? t('sectionOk') : t('sectionError'));
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${t('view')}: ${hint}`}
      className={cn(
        'flex items-center gap-1.5 h-8 px-2.5 rounded-lg ring-1 text-left min-w-0 transition-colors',
        s.ok
          ? 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 hover:ring-emerald-300 dark:hover:ring-emerald-700'
          : 'bg-rose-50/70 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-900 hover:ring-rose-300',
      )}
    >
      <StatusDot tone={s.ok ? 'emerald' : 'rose'} className="w-1.5 h-1.5" />
      <span className={cn('font-mono text-[11px] truncate', s.ok ? 'text-slate-700 dark:text-slate-200' : 'text-rose-700 dark:text-rose-300')}>{s.key}</span>
    </button>
  );
}

function FactsSectionDrawer({ sectionKey, section, onClose }: { sectionKey: string | null; section: FactsSection | null; onClose: () => void }) {
  const t = useTranslations('adminAgentTeam');
  const q = useQuery({
    queryKey: agentTeamKeys.factsSection(sectionKey || ''),
    queryFn: () => agentTeamApi.factsSection(sectionKey || ''),
    enabled: !!sectionKey,
  });
  const d = sectionKey && q.data?.key === sectionKey ? q.data : undefined;
  const json = d ? detailsText(d.data) : '';
  return (
    <Drawer
      open={!!sectionKey}
      onClose={onClose}
      title={<span className="font-mono">{sectionKey}</span>}
      subtitle={d?.updatedAt ? `${t('health.facts.updated')}: ${fmtDateTime(d.updatedAt)}` : undefined}
      icon={FileJson}
      tone={section && !section.ok ? 'rose' : 'teal'}
      actions={json ? <CopyButton text={json} className="w-9 h-9 rounded-lg" /> : undefined}
    >
      {section && !section.ok && (
        <div className="rounded-lg ring-1 ring-rose-200 dark:ring-rose-900 bg-rose-50/70 dark:bg-rose-950/30 px-3 py-2 space-y-1">
          <Pill tone="rose" dot>{t('health.facts.sectionError')}</Pill>
          {section.error && <div className="font-mono text-[11.5px] text-rose-800 dark:text-rose-200 break-words">{section.error}</div>}
          {section.izoh && <div className="text-[11.5px] text-rose-700/90 dark:text-rose-300/90 break-words">{section.izoh}</div>}
        </div>
      )}
      {q.isLoading || (q.isFetching && !d) ? (
        <SkeletonRows rows={8} />
      ) : q.isError && !d ? (
        <ErrorBlock error={q.error} onRetry={() => { void q.refetch(); }} />
      ) : !d || !d.exists || d.data === null || d.data === undefined ? (
        <EmptyBlock icon={FileJson} title={t('common.empty')} />
      ) : (
        <CodeBlock maxHeight={600}>{json}</CodeBlock>
      )}
    </Drawer>
  );
}

// ===========================================================================
// Ogohlantirishlar tarixi (30 kun)
// ===========================================================================
type AlertFilter = 'all' | HealthStatus;

function AlertsCard({ alerts }: { alerts: AlertRow[] }) {
  const t = useTranslations('adminAgentTeam');
  const [filter, setFilter] = useState<AlertFilter>('all');

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of alerts) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [alerts]);
  const options: ChipOption<AlertFilter>[] = [
    { value: 'all', label: t('common.all'), count: alerts.length },
    ...HEALTH_STATUSES.filter((s) => (counts[s] ?? 0) > 0 || filter === s).map((s) => ({
      value: s as AlertFilter, label: t(`health.status.${s}`), count: counts[s] ?? 0, tone: healthTone(s),
    })),
  ];
  const rows = filter === 'all' ? alerts : alerts.filter((a) => a.status === filter);

  return (
    <SectionCard icon={Bell} tone="rose" title={t('health.alertsTitle')} subtitle={t('health.alertsSubtitle')} noBody>
      {alerts.length === 0 ? (
        <EmptyBlock icon={Bell} title={t('health.noAlerts')} />
      ) : (
        <>
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
            <ChipFilter value={filter} options={options} onChange={setFilter} />
          </div>
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead className="sticky top-0 z-[1]">
                <tr className="text-[10px] uppercase tracking-wider font-bold text-slate-400 bg-slate-50 dark:bg-slate-900 text-left">
                  <th className="px-4 py-2 font-bold">{t('common.time')}</th>
                  <th className="px-3 py-2 font-bold">{t('common.status')}</th>
                  <th className="px-3 py-2 font-bold">{t('common.details')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((a) => {
                  const key = `health.components.${a.component}`;
                  return (
                    <tr key={a.id} className="align-top hover:bg-violet-50/40 dark:hover:bg-violet-950/20">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="text-slate-700 dark:text-slate-200 tabular-nums" title={fmtDateTime(a.ts)}>{fmtShortDateTime(a.ts)}</div>
                        <RelTime iso={a.ts} className="text-[10.5px] text-slate-400 dark:text-slate-500" />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap"><HealthBadge status={a.status} /></td>
                      <td className="px-3 py-2.5 min-w-0">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-semibold text-slate-800 dark:text-slate-100">{t.has(key) ? t(key) : a.component}</span>
                          <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">{a.component}</span>
                        </div>
                        {a.message && (
                          <div className="mt-0.5 text-[11.5px] text-slate-600 dark:text-slate-300 line-clamp-2 break-words" title={a.message}>{a.message}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ===========================================================================
// kv holat kalitlari
// ===========================================================================
function KvCard({ kv }: { kv: KvKeyState[] }) {
  const t = useTranslations('adminAgentTeam');
  return (
    <SectionCard icon={KeyRound} tone="indigo" title={t('health.kv.title')} subtitle={t('health.kv.subtitle')} noBody>
      {kv.length === 0 ? (
        <EmptyBlock icon={KeyRound} title={t('common.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider font-bold text-slate-400 bg-slate-50/70 dark:bg-slate-900/50 text-left">
                <th className="px-4 py-2 font-bold">{t('health.kv.key')}</th>
                <th className="px-3 py-2 font-bold">{t('health.kv.meaning')}</th>
                <th className="px-3 py-2 font-bold">{t('health.kv.value')}</th>
                <th className="px-3 py-2 font-bold">{t('health.kv.updated')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {kv.map((r) => (
                <tr key={r.key} className={cn('align-middle hover:bg-violet-50/40 dark:hover:bg-violet-950/20', !r.present && 'opacity-50')}>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="font-mono text-[11.5px] text-slate-700 dark:text-slate-200">{r.key}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{t(`health.kv.meanings.${kvMeaningId(r.key)}`)}</td>
                  <td className="px-3 py-2.5"><KvValue row={r} /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.updatedAt ? (
                      <RelTime iso={r.updatedAt} className="text-[11px] text-slate-500 dark:text-slate-400" />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function KvValue({ row }: { row: KvKeyState }) {
  const t = useTranslations('adminAgentTeam');
  if (!row.present) return <span className="italic text-slate-400 dark:text-slate-500">{t('health.kv.absent')}</span>;
  switch (row.kind) {
    case 'heartbeat':
      return row.value ? <HeartbeatValue iso={row.value} /> : <Dash />;
    case 'timestamp':
      return row.value ? (
        <span className="inline-flex items-baseline gap-2 flex-wrap">
          <RelTime iso={row.value} className="font-semibold text-slate-700 dark:text-slate-200" />
          <span className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums">{fmtDateTime(row.value)}</span>
        </span>
      ) : <Dash />;
    case 'lease':
      return row.value ? <LeaseValue until={row.value} /> : <Dash />;
    case 'date':
      return row.value ? <span className="font-mono text-[11.5px] text-slate-700 dark:text-slate-200">{row.value}</span> : <Dash />;
    case 'counter':
    case 'history': {
      const n = row.count ?? 0;
      return <Pill tone={n > 0 ? 'violet' : 'slate'} mono>{t('health.kv.count', { n })}</Pill>;
    }
    case 'flag':
      return <FlagValue value={row.value} />;
    default:
      return row.value ? <span className="font-mono text-[11.5px]">{row.value}</span> : <Dash />;
  }
}

function Dash() {
  return <span className="text-slate-400">—</span>;
}

/** Heartbeat: yoshi bo'yicha jonli nuqta (<=180 s live, <=600 s stale, aks holda offline) */
function HeartbeatValue({ iso }: { iso: string }) {
  const now = useNow(5000);
  const ts = Date.parse(iso);
  const age = Number.isFinite(ts) ? (now - ts) / 1000 : Infinity;
  const tone: Tone = age <= 180 ? 'emerald' : age <= 600 ? 'amber' : 'rose';
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <StatusDot tone={tone} pulse={tone !== 'rose'} />
      <RelTime iso={iso} tick={5000} className="font-semibold text-slate-700 dark:text-slate-200" />
      <span className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums">{fmtDateTime(iso)}</span>
    </span>
  );
}

/** Lease: faqat tugash vaqti — amal qilsa jonli hisoblagich, o'tgan bo'lsa "muddat o'tdi" */
function LeaseValue({ until }: { until: string }) {
  const t = useTranslations('adminAgentTeam.plans');
  const now = useNow(1000);
  const f = useAgentTeamFmt();
  const left = Date.parse(until) - now;
  if (!(left > 0)) {
    return (
      <span className="inline-flex items-baseline gap-2">
        <span className="text-slate-500 dark:text-slate-400">{t('expired')}</span>
        <span className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums">{fmtDateTime(until)}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2" title={fmtDateTime(until)}>
      <Pill tone="sky" dot pulse mono icon={Timer}>
        {f.dur(Math.ceil(left / 1000) * 1000)}
      </Pill>
      <span className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums">{fmtDateTime(until)}</span>
    </span>
  );
}

/** agent_enabled_*: 'leader=1 support=0' -> har agent uchun kichik belgi */
function FlagValue({ value }: { value: string | null }) {
  const t = useTranslations('adminAgentTeam');
  const agentLabel = useAgentLabel();
  if (!value) return <Dash />;
  const parts = value.split(/\s+/).filter(Boolean).map((tok) => {
    const i = tok.indexOf('=');
    return i > 0 ? { k: tok.slice(0, i), v: tok.slice(i + 1) } : { k: tok, v: '' };
  });
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {parts.map((p) => {
        const off = p.v.trim() === '0';
        const name = isAgentName(p.k) ? agentLabel(p.k) : p.k;
        return (
          <Pill key={p.k} tone={off ? 'rose' : 'emerald'} mono dot title={`${name}: ${off ? t('agents.disabled') : t('agents.enabled')}`}>
            {p.k}={p.v}
          </Pill>
        );
      })}
    </span>
  );
}
