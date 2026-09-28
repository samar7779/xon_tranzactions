'use client';

/**
 * Agent Support -> REJA ko'rinishi (ops).
 * Support kod tuzatish rejalari: ijro oqimi, tasdiq kutayotganlar, 30 kunlik ko'rsatkichlar va tarix.
 *
 * QAT'IY: tasdiqlash/rad etish ([Ha]/[Yo'q]) FAQAT Telegram'da. Bu ko'rinishda hech qanday
 * tasdiq tugmasi yo'q va bo'lmaydi — web faqat holatni ko'rsatadi (TelegramOnlyNotice).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Ban, BarChart3, CheckCircle2, FileCode2, FileDiff, FilePlus2, FlaskConical, GitCommit, GitPullRequest,
  History, KeyRound, Layers, Lock, MessagesSquare, Minus, Plus, Rocket, Send, ShieldAlert, ShieldCheck, ShieldX, Timer,
  Upload, Workflow, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentTeamApi, agentTeamKeys, AGENT_TEAM_REFRESH } from '@/lib/agent-team-api';
import {
  PLAN_EVENT_KINDS,
  type AgentTeamOverview,
  type AgentTeamPlans,
  type AgentTeamViewProps,
  type PendingPlan,
  type PlanEditPreview,
  type PlanEvent,
  type PlanEventKind,
} from '@/lib/agent-team-types';
import {
  ChipFilter, CodeBlock, CopyButton, EmptyBlock, ErrorBlock, KpiTile, NotInstalled, Pill, ProgressBar,
  IconButton, RefreshButton, RelTime, SectionCard, SkeletonRows, TelegramOnlyNotice, TONE_DOT, TONE_TEXT,
  fmtDateTime, fmtDay, fmtShortDateTime, fmtTime, planKindTone, riskTone, tashkentDay, useAgentTeamFmt, useNow,
  type ChipOption, type IconType, type Tone,
} from './ui';

// ===========================================================================
// Konstantalar
// ===========================================================================
type FlowKey = 'plan' | 'validate' | 'approve' | 'checks' | 'commit' | 'push' | 'deploy';

const FLOW: { key: FlowKey; icon: IconType }[] = [
  { key: 'plan', icon: FileCode2 },
  { key: 'validate', icon: ShieldCheck },
  { key: 'approve', icon: Send },
  { key: 'checks', icon: FlaskConical },
  { key: 'commit', icon: GitCommit },
  { key: 'push', icon: Upload },
  { key: 'deploy', icon: Rocket },
];
/** exec.active (sup_exec_active lease) paytida jonli bo'ladigan qadamlar */
const EXEC_STEPS: ReadonlySet<FlowKey> = new Set<FlowKey>(['checks', 'commit', 'push']);

const KIND_ICON: Record<PlanEventKind, IconType> = {
  offered: GitPullRequest,
  applied: CheckCircle2,
  failed: XCircle,
  rejected: Ban,
  rad: ShieldX,
  env: KeyRound,
};

/** Tarixda birinchi ko'rsatiladigan yozuvlar soni (qolgani "Batafsil" bilan) */
const HISTORY_PAGE = 40;

type HistoryFilter = 'all' | PlanEventKind;

/**
 * Server soatiga moslangan "hozir" (har `ms` da yangilanadi).
 * Skew = overview.serverTime - overview dataUpdatedAt (OverviewHero bilan bir xil usul); overview
 * so'rovi panel tepasida doim faol, shu yerda faqat keshdan o'qiladi (qo'shimcha so'rov yo'q).
 * synced=false — overview keshi yo'q: soat farqi noma'lum, klient hisobiga to'liq ishonib bo'lmaydi.
 */
function useServerClock(ms: number): { now: number; synced: boolean } {
  const now = useNow(ms);
  const qc = useQueryClient();
  const st = qc.getQueryState<AgentTeamOverview>(agentTeamKeys.overview());
  const serverTime = st?.data?.serverTime;
  const skew = serverTime && st?.dataUpdatedAt ? Date.parse(serverTime) - st.dataUpdatedAt : NaN;
  return Number.isFinite(skew) ? { now: now + skew, synced: true } : { now, synced: false };
}

// ===========================================================================
// Asosiy ko'rinish
// ===========================================================================
export function PlansView({ canManage: _canManage, focus: _focus, onNavigate }: AgentTeamViewProps) {
  const t = useTranslations('adminAgentTeam.plans');

  const q = useQuery({
    queryKey: agentTeamKeys.plans(),
    queryFn: () => agentTeamApi.plans(),
    refetchInterval: AGENT_TEAM_REFRESH.plans,
  });
  const data = q.data;
  const refresh = () => { void q.refetch(); };

  const [kindFilter, setKindFilter] = useState<HistoryFilter>('all');

  // Birinchi yuklanish
  if (q.isLoading && !data) {
    return (
      <div className="space-y-5">
        <TelegramOnlyNotice />
        <SectionCard icon={Workflow} title={t('flowTitle')} subtitle={t('subtitle')}>
          <SkeletonRows rows={2} />
        </SectionCard>
        <SectionCard icon={GitPullRequest} tone="amber" title={t('pendingTitle')}>
          <SkeletonRows rows={4} />
        </SectionCard>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <TelegramOnlyNotice />
        <SectionCard icon={GitPullRequest} title={t('title')} subtitle={t('subtitle')} actions={<RefreshButton onClick={refresh} fetching={q.isFetching} />}>
          <ErrorBlock error={q.error} onRetry={refresh} />
        </SectionCard>
      </div>
    );
  }

  if (!data.installed) {
    return (
      <div className="space-y-5">
        <TelegramOnlyNotice />
        <FlowCard data={null} fetching={q.isFetching} onRefresh={refresh} />
        <SectionCard icon={GitPullRequest} tone="amber" title={t('pendingTitle')}>
          <NotInstalled state={data} compact />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <TelegramOnlyNotice />
      <FlowCard data={data} fetching={q.isFetching} onRefresh={refresh} />
      <PendingCard data={data} />
      <StatsCard
        stats={data.stats30d}
        active={kindFilter}
        onPick={(k) => setKindFilter((cur) => (cur === k ? 'all' : k))}
      />
      <HistoryCard history={data.history} filter={kindFilter} onFilter={setKindFilter} onOpenChat={() => onNavigate('chat')} />
    </div>
  );
}

// ===========================================================================
// Ijro oqimi (7 qadam)
// ===========================================================================
function FlowCard({ data, fetching, onRefresh }: { data: AgentTeamPlans | null; fetching: boolean; onRefresh: () => void }) {
  const t = useTranslations('adminAgentTeam.plans');
  const exec = data?.exec;
  const waiting = data ? data.pending.filter((p) => !p.claimed && !p.expired).length : 0;
  const ttlMin = Math.round((data?.approvalTtlS ?? 600) / 60);

  const stepState = (k: FlowKey): 'exec' | 'approve' | 'idle' => {
    if (exec?.active && EXEC_STEPS.has(k)) return 'exec';
    if (k === 'approve' && waiting > 0) return 'approve';
    return 'idle';
  };

  return (
    <SectionCard
      icon={Workflow}
      title={t('flowTitle')}
      subtitle={t('subtitle')}
      actions={<RefreshButton onClick={onRefresh} fetching={fetching} />}
    >
      <style>{`
        @keyframes plFlow { to { background-position: 12px 0; } }
        .pl-flow { background-image: linear-gradient(90deg, currentColor 55%, transparent 55%); background-size: 12px 2px; background-repeat: repeat-x; animation: plFlow .7s linear infinite; }
      `}</style>

      {/* Pipeline: kichik ekranda karta ichida gorizontal scroll (sahifa emas) */}
      <div className="overflow-x-auto -mx-5 px-5 pb-1">
        <ol className="flex items-start min-w-[700px]">
          {FLOW.map((s, i) => {
            const st = stepState(s.key);
            const prev = i > 0 ? stepState(FLOW[i - 1].key) : 'idle';
            const Icon = s.icon;
            // Oldingi qadamdan shu qadamgacha bo'lgan ulovchi chiziq
            const link: 'exec' | 'approve' | 'idle' =
              st === 'exec' && prev === 'exec' ? 'exec' : st === 'approve' ? 'approve' : 'idle';
            return (
              <li key={s.key} className="relative flex-1 min-w-0 flex flex-col items-center text-center px-1">
                {i > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-[19px] right-1/2 w-full h-[2px]',
                      link === 'exec' && 'pl-flow text-sky-500',
                      link === 'approve' && 'pl-flow text-amber-500',
                      link === 'idle' && 'bg-slate-200 dark:bg-slate-700',
                    )}
                  />
                )}
                <span className="relative z-[1] rounded-xl bg-white dark:bg-slate-900">
                  {st !== 'idle' && (
                    <span className={cn('absolute inset-0 rounded-xl ring-2 animate-ping opacity-40', st === 'exec' ? 'ring-sky-400' : 'ring-amber-400')} />
                  )}
                  <span
                    className={cn(
                      'relative w-10 h-10 rounded-xl grid place-items-center ring-1 transition-colors',
                      st === 'exec' && 'bg-sky-50 dark:bg-sky-950/60 ring-sky-300 dark:ring-sky-700 text-sky-600 dark:text-sky-300',
                      st === 'approve' && 'bg-amber-50 dark:bg-amber-950/60 ring-amber-300 dark:ring-amber-700 text-amber-600 dark:text-amber-300',
                      st === 'idle' && 'bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {s.key === 'approve' && (
                      <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full grid place-items-center bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 ring-2 ring-white dark:ring-slate-900">
                        <Lock className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </span>
                </span>
                <span className="mt-2 font-mono text-[9.5px] font-bold text-slate-400 dark:text-slate-500 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <span
                  className={cn(
                    'mt-0.5 text-[11px] leading-snug font-semibold',
                    st === 'exec' ? 'text-sky-700 dark:text-sky-300' : st === 'approve' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300',
                  )}
                >
                  {t(`flow.${s.key}`)}
                </span>
                {s.key === 'approve' && (
                  <span className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">{t('ttlNote', { n: ttlMin })}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Ijro holati */}
      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
        {exec?.active ? (
          <>
            <Pill tone="sky" dot pulse>{t('exec.active')}</Pill>
            {exec.ref && <Pill tone="sky" mono>{t('ref', { ref: exec.ref })}</Pill>}
            {exec.until && <ExecUntil until={exec.until} />}
          </>
        ) : (
          <Pill tone="slate" dot>{t('exec.idle')}</Pill>
        )}
        {exec?.lockHeld && <Pill tone="amber" icon={Lock}>{t('exec.lock')}</Pill>}
        {waiting > 0 && (
          <Pill tone="amber" dot pulse className="ml-auto">{t('waiting')} · {waiting}</Pill>
        )}
      </div>
    </SectionCard>
  );
}

/** Lease tugash vaqti + jonli qolgan vaqt (har 1 s) */
function ExecUntil({ until }: { until: string }) {
  const t = useTranslations('adminAgentTeam.plans');
  const { now } = useServerClock(1000);
  const f = useAgentTeamFmt();
  const left = Date.parse(until) - now;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-sky-700 dark:text-sky-300 tabular-nums" title={fmtDateTime(until)}>
      <Timer className="h-3.5 w-3.5" />
      {t('exec.activeUntil', { time: fmtTime(until) })}
      {left > 0 && <span className="font-mono text-[10.5px] opacity-80">({f.dur(Math.ceil(left / 1000) * 1000)})</span>}
    </span>
  );
}

// ===========================================================================
// Tasdiq kutayotgan rejalar
// ===========================================================================
function PendingCard({ data }: { data: AgentTeamPlans }) {
  const t = useTranslations('adminAgentTeam.plans');
  const n = data.pending.length;
  return (
    <SectionCard
      icon={GitPullRequest}
      tone="amber"
      title={t('pendingTitle')}
      subtitle={t('ttlNote', { n: Math.round(data.approvalTtlS / 60) })}
      // Kichik ekranda yashiriladi: uppercase Pill sarlavhani to'liq siqib qo'yardi, ko'rinish
      // tepasidagi to'liq TelegramOnlyNotice esa mobilda ham bor
      actions={<TelegramOnlyNotice compact className="hidden sm:inline-flex" />}
    >
      {n === 0 ? (
        <EmptyBlock icon={GitPullRequest} title={t('noPending')} desc={t('telegramOnlyDesc')} />
      ) : (
        <div className="space-y-4">
          {data.pending.map((p) => (
            <PlanCard key={p.ref + (p.createdAt || '')} plan={p} ttlS={data.approvalTtlS} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function planStateTone(p: PendingPlan): Tone {
  return p.claimed ? 'sky' : p.expired ? 'slate' : 'amber';
}

function PlanCard({ plan, ttlS }: { plan: PendingPlan; ttlS: number }) {
  const t = useTranslations('adminAgentTeam.plans');
  const riskKey = `risk.${plan.risk}`;
  const newFiles = useMemo(() => new Set(plan.edits.filter((e) => e.isNewFile).map((e) => e.file)), [plan.edits]);

  return (
    <article className="relative rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900/40 overflow-hidden">
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_DOT[planStateTone(plan)])} />

      {/* Sarlavha: ref, xavf, holat */}
      <header className="pl-4 pr-3 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60">
        <Pill tone="violet" mono icon={GitPullRequest}>{t('ref', { ref: plan.ref })}</Pill>
        <Pill tone={riskTone(plan.risk)} dot>{t.has(riskKey) ? t(riskKey) : plan.risk || '—'}</Pill>
        <PlanState plan={plan} ttlS={ttlS} />
        {plan.createdAt && (
          <span className="ml-auto text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums" title={fmtDateTime(plan.createdAt)}>
            {fmtShortDateTime(plan.createdAt)} · <RelTime iso={plan.createdAt} />
          </span>
        )}
      </header>

      <div className="pl-4 pr-4 py-3.5 space-y-3.5">
        {plan.summary && (
          <p className="text-[12.5px] leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">{plan.summary}</p>
        )}

        {plan.dangerFlags.length > 0 && (
          <div className="rounded-lg ring-1 ring-rose-200 dark:ring-rose-900 bg-rose-50/70 dark:bg-rose-950/30 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-rose-600 dark:text-rose-400">
              <ShieldAlert className="h-3.5 w-3.5" /> {t('dangerFlags')}
            </div>
            <ul className="mt-1.5 space-y-1">
              {plan.dangerFlags.map((fl, i) => (
                <li key={i} className="flex items-start gap-2 text-[11.5px] text-rose-800 dark:text-rose-200 break-words">
                  <span className="mt-[7px] w-1 h-1 rounded-full bg-rose-500 shrink-0" />
                  <span className="min-w-0">{fl}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.files.length > 0 && (
          <div>
            <SubLabel icon={FileCode2}>{t('files', { n: plan.files.length })}</SubLabel>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {plan.files.map((f) => (
                <span
                  key={f}
                  title={f}
                  className={cn(
                    'inline-flex items-center gap-1 max-w-full px-2 py-0.5 rounded-md ring-1 font-mono text-[10.5px]',
                    newFiles.has(f)
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300',
                  )}
                >
                  {newFiles.has(f) ? <FilePlus2 className="h-3 w-3 shrink-0" /> : <FileCode2 className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{f}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {plan.editsTotal > 0 && (
          <div>
            <SubLabel icon={FileDiff}>{t('edits', { n: plan.editsTotal })}</SubLabel>
            <div className="mt-1.5 space-y-2.5">
              {plan.edits.map((e, i) => <EditDiff key={i} edit={e} />)}
            </div>
            {plan.editsTotal > plan.edits.length && (
              <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <Layers className="h-3.5 w-3.5" /> {t('editsMore', { n: plan.editsTotal - plan.edits.length })}
              </div>
            )}
          </div>
        )}

        {plan.test && (
          <div>
            <SubLabel icon={FlaskConical}>{t('test')}</SubLabel>
            <CodeBlock className="mt-1.5" maxHeight={220} copyText={plan.test}>{plan.test}</CodeBlock>
          </div>
        )}
      </div>
    </article>
  );
}

/** Reja holati: claimed -> sky, expired -> slate, aks holda amber pulse + jonli hisoblagich */
function PlanState({ plan, ttlS }: { plan: PendingPlan; ttlS: number }) {
  const t = useTranslations('adminAgentTeam.plans');
  if (plan.claimed) return <Pill tone="sky" dot pulse>{t('claimed')}</Pill>;
  if (plan.expired || !plan.expiresAt) return <Pill tone="slate" dot>{t('expired')}</Pill>;
  return <PlanCountdown expiresAt={plan.expiresAt} ttlS={ttlS} />;
}

/**
 * Jonli hisoblagich. Faqat server expired=false bo'lganda chaqiriladi.
 * Qolgan vaqt server soatiga moslab hisoblanadi (useServerClock): klient soati oldinda/orqada
 * bo'lsa ham Telegram'dagi [Ha] haqiqiy amal qilish muddati ko'rsatiladi.
 * Soat farqi noma'lum (overview keshi yo'q) va klient hisobi 0 dan o'tgan bo'lsa — server
 * holatiga ishoniladi: 'kutilmoqda' qoladi, raqamsiz; keyingi refetch (5 s) haqiqiy holatni beradi.
 */
function PlanCountdown({ expiresAt, ttlS }: { expiresAt: string; ttlS: number }) {
  const t = useTranslations('adminAgentTeam.plans');
  const { now, synced } = useServerClock(1000);
  const f = useAgentTeamFmt();
  const raw = Date.parse(expiresAt) - now;
  const known = Number.isFinite(raw) && (raw > 0 || synced);
  if (known && raw <= 0) return <Pill tone="slate" dot>{t('expired')}</Pill>;
  const left = known ? raw : 0;
  const ratio = Math.min(1, left / Math.max(1, ttlS * 1000));
  const low = ratio < 0.2;
  return (
    <span className="inline-flex items-center gap-2 flex-wrap" title={fmtDateTime(expiresAt)}>
      <Pill tone="amber" dot pulse>{t('waiting')}</Pill>
      {known && (
        <>
          <span
            className={cn('inline-flex items-center gap-1 font-mono text-[11px] tabular-nums', low ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-300')}
          >
            <Timer className="h-3.5 w-3.5" />
            {t('expiresIn', { time: f.dur(Math.ceil(left / 1000) * 1000) })}
          </span>
          <ProgressBar value={ratio} tone={low ? 'rose' : 'amber'} className="w-24" />
        </>
      )}
    </span>
  );
}

/** Bitta o'zgarish: fayl yo'li + ikki ustunli oldin/keyin diff */
function EditDiff({ edit }: { edit: PlanEditPreview }) {
  const t = useTranslations('adminAgentTeam.plans');
  const tc = useTranslations('adminAgentTeam.common');
  return (
    <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
        <FileDiff className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-slate-700 dark:text-slate-200" title={edit.file}>{edit.file}</span>
        {edit.isNewFile && <Pill tone="emerald" icon={FilePlus2}>{t('newFile')}</Pill>}
        {edit.truncated && <Pill tone="amber">{tc('truncated')}</Pill>}
      </div>
      <div className={cn('grid', edit.isNewFile ? 'grid-cols-1' : 'md:grid-cols-2')}>
        {!edit.isNewFile && (
          <DiffPane side="find" label={t('find')} meta={tc('chars', { n: edit.findLen })} text={edit.find} />
        )}
        <DiffPane
          side="replace"
          label={t('replace')}
          meta={tc('chars', { n: edit.replaceLen })}
          text={edit.replace}
          className={cn(!edit.isNewFile && 'border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800')}
        />
      </div>
    </div>
  );
}

function DiffPane({ side, label, meta, text, className }: { side: 'find' | 'replace'; label: string; meta: string; text: string; className?: string }) {
  const lines = useMemo(() => (text || '').split('\n'), [text]);
  const find = side === 'find';
  const Sign = find ? Minus : Plus;
  return (
    <div className={cn('min-w-0', find ? 'bg-rose-50/60 dark:bg-rose-950/20' : 'bg-emerald-50/60 dark:bg-emerald-950/20', className)}>
      <div
        className={cn(
          'flex items-center gap-1.5 px-3 py-1 text-[9.5px] uppercase tracking-wider font-bold',
          find ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400',
        )}
      >
        <Sign className="h-3 w-3" /> {label}
        <span className="ml-auto font-mono normal-case tracking-normal font-medium opacity-70">{meta}</span>
      </div>
      <div
        className={cn(
          'px-2 pb-2 max-h-56 overflow-auto font-mono text-[11px] leading-relaxed',
          find ? 'text-rose-900 dark:text-rose-100' : 'text-emerald-900 dark:text-emerald-100',
        )}
      >
        {lines.map((ln, i) => (
          <div key={i} className="flex">
            <span aria-hidden className="select-none w-4 shrink-0 text-center opacity-50">{find ? '-' : '+'}</span>
            <span className="flex-1 min-w-0 whitespace-pre-wrap break-words">{ln || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubLabel({ icon: Icon, children }: { icon: IconType; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">
      <Icon className="h-3.5 w-3.5" /> {children}
    </div>
  );
}

// ===========================================================================
// 30 kunlik ko'rsatkichlar
// ===========================================================================
function StatsCard({ stats, active, onPick }: { stats: Record<PlanEventKind, number>; active: HistoryFilter; onPick: (k: PlanEventKind) => void }) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const applied = stats.applied ?? 0;
  const failed = stats.failed ?? 0;
  const rate = applied + failed > 0 ? applied / (applied + failed) : null;
  return (
    <SectionCard icon={BarChart3} title={t('plans.statsTitle')}>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {PLAN_EVENT_KINDS.map((k) => {
          const n = stats[k] ?? 0;
          return (
            <KpiTile
              key={k}
              label={t(`plans.kinds.${k}`)}
              value={f.num(n)}
              tone={n > 0 ? planKindTone(k) : 'slate'}
              icon={KIND_ICON[k]}
              sub={k === 'applied' && rate !== null ? `${t('agents.successRate')} ${f.pct(rate)}` : undefined}
              onClick={() => onPick(k)}
              className={cn(active === k && 'ring-2 ring-violet-400 dark:ring-violet-500')}
            />
          );
        })}
      </div>
    </SectionCard>
  );
}

// ===========================================================================
// Tarix (30 kun) — vertikal timeline, kun bo'yicha ajratilgan
// ===========================================================================
function HistoryCard({ history, filter, onFilter, onOpenChat }: {
  history: PlanEvent[]; filter: HistoryFilter; onFilter: (v: HistoryFilter) => void; onOpenChat: () => void;
}) {
  const t = useTranslations('adminAgentTeam');
  const [showAll, setShowAll] = useState(false);

  const counts = useMemo(() => {
    const c: Partial<Record<PlanEventKind, number>> = {};
    for (const e of history) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [history]);

  const options: ChipOption<HistoryFilter>[] = useMemo(() => [
    { value: 'all', label: t('common.all'), count: history.length },
    ...PLAN_EVENT_KINDS.filter((k) => (counts[k] ?? 0) > 0 || filter === k).map((k) => ({
      value: k as HistoryFilter, label: t(`plans.kinds.${k}`), count: counts[k] ?? 0, tone: planKindTone(k),
    })),
  ], [t, history.length, counts, filter]);

  const filtered = useMemo(() => (filter === 'all' ? history : history.filter((e) => e.kind === filter)), [history, filter]);
  const shown = showAll ? filtered : filtered.slice(0, HISTORY_PAGE);

  return (
    <SectionCard
      icon={History}
      title={t('plans.historyTitle')}
      subtitle={t('common.tashkentTime')}
      actions={<IconButton icon={MessagesSquare} title={t('views.chat')} onClick={onOpenChat} />}
    >
      {history.length === 0 ? (
        <EmptyBlock icon={History} title={t('plans.noHistory')} />
      ) : (
        <>
          <ChipFilter value={filter} options={options} onChange={(v) => { onFilter(v); setShowAll(false); }} />
          {filtered.length === 0 ? (
            <EmptyBlock title={t('common.noResults')} />
          ) : (
            <ol className="mt-4">
              {shown.map((e, i) => {
                const day = tashkentDay(e.ts);
                const newDay = i === 0 || tashkentDay(shown[i - 1].ts) !== day;
                const last = i === shown.length - 1;
                return (
                  <li key={e.id}>
                    {newDay && (
                      <div className={cn('flex items-center gap-2 pb-2', i > 0 && 'pt-1')}>
                        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 tabular-nums">{fmtDay(e.ts)}</span>
                        <span className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
                      </div>
                    )}
                    <HistoryItem event={e} last={last || tashkentDay(shown[i + 1]?.ts) !== day} />
                  </li>
                );
              })}
            </ol>
          )}
          {filtered.length > HISTORY_PAGE && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold ring-1 bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:ring-violet-300 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
              >
                {showAll ? t('common.showLess') : `${t('common.showMore')} (${filtered.length - HISTORY_PAGE})`}
              </button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

function HistoryItem({ event: e, last }: { event: PlanEvent; last: boolean }) {
  const t = useTranslations('adminAgentTeam.plans');
  const tone = planKindTone(e.kind);
  const Icon = KIND_ICON[e.kind] ?? GitPullRequest;
  const riskKey = e.risk ? `risk.${e.risk}` : '';
  return (
    <div className={cn('relative pl-8', last ? 'pb-3' : 'pb-4')} title={e.text}>
      {!last && <span aria-hidden className="absolute left-[11px] top-6 bottom-0 w-px bg-slate-200 dark:bg-slate-800" />}
      <span className={cn('absolute left-0 top-0 w-6 h-6 rounded-lg grid place-items-center ring-1 bg-white dark:bg-slate-900', 'ring-slate-200 dark:ring-slate-700')}>
        <Icon className={cn('h-3.5 w-3.5', tone === 'slate' ? 'text-slate-400 dark:text-slate-500' : TONE_TEXT[tone])} />
        <span className={cn('absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-white dark:ring-slate-900', TONE_DOT[tone])} />
      </span>
      <div className="flex flex-wrap items-center gap-2 min-h-[24px]">
        <Pill tone={tone}>{t(`kinds.${e.kind}`)}</Pill>
        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 tabular-nums" title={fmtDateTime(e.ts)}>{fmtShortDateTime(e.ts)}</span>
        <RelTime iso={e.ts} className="text-[10.5px] text-slate-400 dark:text-slate-500" />
        {e.risk && <Pill tone={riskTone(e.risk)}>{t.has(riskKey) ? t(riskKey) : e.risk}</Pill>}
        {e.files !== null && (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <FileCode2 className="h-3.5 w-3.5" /> {t('filesN', { n: e.files })}
          </span>
        )}
      </div>
      {e.commit && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded-md pl-2 pr-0.5 ring-1 ring-emerald-200 dark:ring-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300">
          <GitCommit className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono text-[11px]">{t('commit', { hash: e.commit })}</span>
          <CopyButton text={e.commit} className="w-6 h-6" />
        </div>
      )}
      {e.reason && (
        <div className="mt-1.5 text-[11.5px] text-slate-600 dark:text-slate-300 break-words">{t('reason', { reason: e.reason })}</div>
      )}
    </div>
  );
}
