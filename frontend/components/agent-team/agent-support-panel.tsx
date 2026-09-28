'use client';

/**
 * Agent Support — konteyner (shell).
 *
 *   NotInstalled (faqat installed=false)
 *   OverviewHero            — jonli holat, KPI, kutilayotganlar
 *   TeamDiagram | AgentCards (xl: 1.15fr / 1fr)
 *   ViewNav (?view=)        — Faoliyat · Suhbat · Vazifalar · REJA · Xotira · Salomatlik · Sozlamalar
 *   <ActiveView canManage focus onNavigate />
 *
 * Fokus: onNavigate(view, focus) — URL ?view= yangilanadi, focus HAR SAFAR yangi obyekt (ko'rinish
 * useEffect([focus]) bilan qo'llaydi), ViewNav'ga silliq scroll. Ko'rinishlar faqat faol bo'lganda mount
 * bo'ladi — polling faqat ko'rinayotgan ko'rinishda ishlaydi.
 * Web faqat ko'rsatadi: Support REJA tasdig'i ([Ha]/[Yo'q]) FAQAT Telegram'da.
 */

import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, BrainCircuit, GitPullRequest, HeartPulse, ListChecks, MessagesSquare, Settings2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { agentTeamApi, agentTeamKeys, AGENT_TEAM_REFRESH } from '@/lib/agent-team-api';
import {
  AGENT_TEAM_VIEWS,
  DEFAULT_AGENT_TEAM_VIEW,
  type AgentTeamFocus,
  type AgentTeamOverview,
  type AgentTeamView,
  type AgentTeamViewProps,
} from '@/lib/agent-team-types';
import { ErrorBlock, NotInstalled, StatusDot, healthTone, type IconType, type Tone } from './ui';
import { OverviewHero } from './overview-hero';
import { TeamDiagram } from './team-diagram';
import { AgentCards } from './agent-cards';
import { ActivityView } from './activity-view';
import { ChatView } from './chat-view';
import { TasksView } from './tasks-view';
import { PlansView } from './plans-view';
import { MemoryView } from './memory-view';
import { HealthView } from './health-view';
import { SettingsView } from './settings-view';

const VIEW_ICON: Record<AgentTeamView, IconType> = {
  activity: Activity,
  chat: MessagesSquare,
  tasks: ListChecks,
  plans: GitPullRequest,
  memory: BrainCircuit,
  health: HeartPulse,
  settings: Settings2,
};

function parseView(v: string | null): AgentTeamView {
  return v && (AGENT_TEAM_VIEWS as readonly string[]).includes(v) ? (v as AgentTeamView) : DEFAULT_AGENT_TEAM_VIEW;
}

export function AgentSupportPanel({ canManage }: { canManage: boolean }) {
  const t = useTranslations('adminAgentTeam');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qc = useQueryClient();

  // Ko'rinish: URL manba, lokal holat esa bosilganda darhol almashadi (router.replace tranzitsiyasini kutmaydi)
  const urlView = parseView(sp.get('view'));
  const [view, setView] = useState<AgentTeamView>(urlView);
  // Tez ketma-ket bosishda eski router.replace natijasi lokal holatni qaytarib yubormasin
  const pendingViewRef = useRef<AgentTeamView | null>(null);
  useEffect(() => {
    if (pendingViewRef.current && pendingViewRef.current !== urlView) return;
    pendingViewRef.current = null;
    setView(urlView);
  }, [urlView]);

  const [focus, setFocus] = useState<AgentTeamFocus | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const writeUrl = useCallback((v: AgentTeamView) => {
    const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    p.set('tab', 'support');
    p.set('view', v);
    const next = `?${p.toString()}`;
    if (typeof window !== 'undefined' && window.location.search === next) {
      pendingViewRef.current = null;
      return;
    }
    pendingViewRef.current = v;
    router.replace(`${pathname}${next}`, { scroll: false });
  }, [router, pathname]);

  /** Boshqa ko'rinishga fokus bilan o'tish (KPI, karta, diagramma, ko'rinishlar ichidan) */
  const navigate = useCallback((v: AgentTeamView, f?: AgentTeamFocus) => {
    setView(v);
    setFocus(f ? { ...f } : null);
    writeUrl(v);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => navRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, [writeUrl]);

  /** ViewNav segmenti — fokussiz, scroll'siz */
  const selectView = useCallback((v: AgentTeamView) => {
    setView(v);
    setFocus(null);
    writeUrl(v);
  }, [writeUrl]);

  const overviewQ = useQuery({
    queryKey: agentTeamKeys.overview(),
    queryFn: () => agentTeamApi.overview(),
    refetchInterval: AGENT_TEAM_REFRESH.overview,
  });
  const overview = overviewQ.data;

  // Hero'dagi yangilash — barcha ko'rinayotgan agent-team so'rovlari (overview, agents, faol ko'rinish)
  const refreshAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: agentTeamKeys.all });
  }, [qc]);

  const viewProps: AgentTeamViewProps = { canManage, focus, onNavigate: navigate };

  return (
    <div className="flex-1 px-6 lg:px-8 pt-5 pb-8 w-full space-y-5">
      {overview && !overview.installed && <NotInstalled state={overview} />}

      {overviewQ.isError && !overview ? (
        <Card className="border-0 shadow-soft">
          <ErrorBlock error={overviewQ.error} onRetry={() => overviewQ.refetch()} />
        </Card>
      ) : (
        <OverviewHero
          overview={overview}
          loading={overviewQ.isLoading}
          fetching={overviewQ.isFetching}
          onRefresh={refreshAll}
          onNavigate={navigate}
          dataUpdatedAt={overviewQ.dataUpdatedAt}
        />
      )}

      {/* xl: ikki ustun bir xil balandlikda (sxema kartasi cho'ziladi, bo'sh joy qolmaydi) */}
      <div className="grid xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-5">
        <TeamDiagram overview={overview} onNavigate={navigate} />
        <AgentCards canManage={canManage} onNavigate={navigate} />
      </div>

      <div ref={navRef} id="agent-team-views" className="scroll-mt-[152px] space-y-1.5">
        <ViewNav view={view} overview={overview} onSelect={selectView} />
        <div className="px-1 text-[11px] text-slate-500 dark:text-slate-400">{t(`viewDesc.${view}`)}</div>
      </div>

      <ViewBoundary key={view}>
        {view === 'activity' && <ActivityView {...viewProps} />}
        {view === 'chat' && <ChatView {...viewProps} />}
        {view === 'tasks' && <TasksView {...viewProps} />}
        {view === 'plans' && <PlansView {...viewProps} />}
        {view === 'memory' && <MemoryView {...viewProps} />}
        {view === 'health' && <HealthView {...viewProps} />}
        {view === 'settings' && <SettingsView {...viewProps} />}
      </ViewBoundary>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ViewNav — ikonli segment chiplar + reaktiv badge'lar (overview'dan)
// ---------------------------------------------------------------------------
type BadgeTone = 'slate' | 'violet' | 'sky' | 'amber';
const BADGE_CLS: Record<BadgeTone, string> = {
  slate: 'bg-slate-200/80 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
  violet: 'bg-violet-100 dark:bg-violet-900/60 text-violet-700 dark:text-violet-300',
  sky: 'bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300',
  amber: 'bg-amber-500 text-white shadow-sm shadow-amber-500/30',
};

interface NavBadge { count?: number; countTone?: BadgeTone; countPulse?: boolean; dot?: Tone; dotPulse?: boolean; hint?: string }

function ViewNav({ view, overview, onSelect }: { view: AgentTeamView; overview: AgentTeamOverview | undefined; onSelect: (v: AgentTeamView) => void }) {
  const t = useTranslations('adminAgentTeam');
  const inst = !!overview?.installed;
  const p = overview?.pending;
  const worst = inst ? overview?.health.worst ?? null : null;
  const secretsMissing = !!overview && (!overview.secrets.setupToken || !overview.secrets.botToken);

  const badges: Partial<Record<AgentTeamView, NavBadge>> = {
    activity: { count: inst ? overview?.today.total : undefined, countTone: 'violet', hint: t('hero.kpi.calls') },
    tasks: {
      count: inst ? p?.tasksInProgress : undefined,
      countTone: 'sky',
      dot: inst && (p?.overduePromises ?? 0) > 0 ? 'rose' : undefined,
      dotPulse: true,
      hint: inst && (p?.overduePromises ?? 0) > 0 ? t('hero.pending.overdue') : t('hero.pending.tasks'),
    },
    plans: { count: inst ? p?.plans : undefined, countTone: 'amber', countPulse: true, hint: t('hero.pending.plans') },
    memory: { count: inst ? p?.memoryWrites : undefined, countTone: 'amber', countPulse: true, hint: t('hero.pending.memory') },
    health: worst ? { dot: healthTone(worst), dotPulse: worst === 'error', hint: t(`health.status.${worst}`) } : undefined,
    settings: secretsMissing ? { dot: 'rose', hint: `${t('secrets.setupToken')} / ${t('secrets.botToken')}: ${t('secrets.missing')}` } : undefined,
  };

  return (
    <div
      role="tablist"
      aria-label={t('title')}
      className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 ring-1 ring-slate-200 dark:ring-slate-700 overflow-x-auto max-w-full"
    >
      {AGENT_TEAM_VIEWS.map((v) => {
        const Icon = VIEW_ICON[v];
        const active = v === view;
        const b = badges[v];
        const showCount = b?.count !== undefined && b.count > 0;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(v)}
            title={b?.hint ? `${t(`views.${v}`)} · ${b.hint}` : t(`viewDesc.${v}`)}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-all',
              active
                ? 'bg-white dark:bg-slate-900 text-violet-700 dark:text-violet-300 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-900/40',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {t(`views.${v}`)}
            {showCount && (
              <span
                className={cn(
                  'min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold grid place-items-center tabular-nums',
                  BADGE_CLS[b?.countTone ?? 'slate'],
                  b?.countPulse && 'animate-pulse',
                )}
              >
                {b?.count}
              </span>
            )}
            {b?.dot && <StatusDot tone={b.dot} pulse={b.dotPulse} className="w-1.5 h-1.5" />}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ViewBoundary — bitta ko'rinishdagi render xatosi butun sahifani yiqitmasin
// ---------------------------------------------------------------------------
class ViewBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[agent-team] view render error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <Card className="border-0 shadow-soft">
          <ErrorBlock error={this.state.error} onRetry={() => this.setState({ error: null })} />
        </Card>
      );
    }
    return this.props.children;
  }
}
