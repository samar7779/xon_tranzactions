'use client';

/**
 * Agent Support — holat sarlavhasi (OverviewHero).
 * Jonli holat plitkasi + reaktiv badge'lar (LIVE / RATE-LIMIT / REJA IJROSI), icon-only toolbar,
 * bugungi KPI qatori va "kutilmoqda" chiplari (bosilsa tegishli ko'rinishga fokus bilan o'tadi).
 * Web faqat ko'rsatadi — REJA tasdig'i faqat Telegram'da.
 *
 * Jonli holat reaktiv: server `liveStatus` javob paytidagi holat, shuning uchun klientda heartbeat yoshi
 * (serverNow bo'yicha) bilan qayta hisoblanadi, oxirgi yangilash xato bersa esa NOMA'LUM + xato pill.
 */

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Activity, Ban, BrainCircuit, CheckCircle2, Clock, CloudOff, Database, GitPullRequest, Handshake, HeartPulse,
  Hourglass, KeyRound, ListChecks, Network, Settings2, Timer, XCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { agentTeamKeys } from '@/lib/agent-team-api';
import {
  HEALTH_STATUSES,
  RUN_BLOCKED_STATUSES,
  type AgentTeamOverview,
  type AgentTeamViewProps,
  type BotLiveStatus,
  type BotState,
} from '@/lib/agent-team-types';
import {
  HealthBadge, IconButton, KpiTile, LiveBadge, Pill, RefreshButton, RelTime, StatusDot,
  TONE_DOT, TONE_ICON_TILE, TONE_PILL, dayLabel, factsTone, fmtDateTime, healthTone, liveTone, tashkentDay,
  useAgentTeamFmt, useNow, type IconType, type Tone,
} from './ui';

type Nav = AgentTeamViewProps['onNavigate'];

/** Heartbeat yoshi chegaralari (BotLiveStatus izohi / settings.constants.heartbeatWarnS, heartbeatErrorS) */
const HEARTBEAT_WARN_S = 180;
const HEARTBEAT_ERROR_S = 600;
const LIVE_RANK: Record<BotLiveStatus, number> = { live: 0, stale: 1, offline: 2, unknown: 3 };

/**
 * Hozirgi (klientda qayta hisoblangan) jonli holat.
 * Server `liveStatus` faqat javob paytiga to'g'ri; keyingi so'rovlar kelmasa ham heartbeat yoshi serverNow
 * bilan o'sadi va holat live -> stale -> offline ga tushadi (server holatidan hech qachon "yaxshiroq" emas).
 * `refetchFailed` (oxirgi yangilash xato, ekrandagi ma'lumot eskirgan) -> 'unknown'.
 */
export function effectiveLiveStatus(bot: BotState, serverNow: number, refetchFailed: boolean): BotLiveStatus {
  if (refetchFailed) return 'unknown';
  const server = bot.liveStatus;
  const hb = bot.heartbeatAt ? Date.parse(bot.heartbeatAt) : NaN;
  if (server === 'unknown' || !Number.isFinite(hb)) return server;
  const ageS = (serverNow - hb) / 1000;
  const derived: BotLiveStatus = ageS <= HEARTBEAT_WARN_S ? 'live' : ageS <= HEARTBEAT_ERROR_S ? 'stale' : 'offline';
  return (LIVE_RANK[derived] ?? 0) > (LIVE_RANK[server] ?? 0) ? derived : server;
}

/**
 * Overview so'rovining oxirgi urinishi xato bilan tugaganmi. React Query refetch xato bersa eski data'ni
 * saqlab turadi — `overview` bor bo'lsa ham u eskirgan bo'lishi mumkin. Panel/sahifa bilan umumiy kesh
 * kaliti (agentTeamKeys.overview()) kuzatiladi: qo'shimcha so'rov yuborilmaydi.
 */
export function useOverviewRefetchError(): Error | null {
  const qc = useQueryClient();
  const subscribe = useCallback((onChange: () => void) => qc.getQueryCache().subscribe(() => onChange()), [qc]);
  const getSnapshot = useCallback((): Error | null => {
    const s = qc.getQueryState<AgentTeamOverview, Error>(agentTeamKeys.overview());
    return s?.status === 'error' && s.error ? s.error : null;
  }, [qc]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/** Sarlavha foni — jonli holat toniga qarab (Tailwind JIT uchun to'liq klasslar) */
const HERO_GRADIENT: Partial<Record<Tone, string>> = {
  emerald: 'border-emerald-100 dark:border-emerald-950 from-emerald-500/[0.10] via-teal-500/[0.04] to-transparent',
  amber: 'border-amber-100 dark:border-amber-950 from-amber-500/[0.10] via-orange-500/[0.04] to-transparent',
  rose: 'border-rose-100 dark:border-rose-950 from-rose-500/[0.10] via-pink-500/[0.04] to-transparent',
  slate: 'border-slate-100 dark:border-slate-800 from-slate-500/[0.06] to-transparent',
};

const DEFAULT_BOT = '@TRanSupport_bot';
const DEFAULT_SERVICE = 'xon-tranzactions-leader';

export function OverviewHero({
  overview, loading, fetching, onRefresh, onNavigate, dataUpdatedAt,
}: {
  overview: AgentTeamOverview | undefined;
  loading: boolean;
  fetching: boolean;
  onRefresh: () => void;
  onNavigate: Nav;
  /** React Query dataUpdatedAt — server/klient soati farqini (skew) hisoblash uchun */
  dataUpdatedAt?: number;
}) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const now = useNow(5_000);

  const installed = !!overview?.installed;

  // Nisbiy vaqtlar server soatiga moslanadi (klient soati noto'g'ri bo'lsa ham "heartbeat N oldin" to'g'ri)
  const skewRaw = overview && dataUpdatedAt ? Date.parse(overview.serverTime) - dataUpdatedAt : 0;
  const serverNow = now + (Number.isFinite(skewRaw) ? skewRaw : 0);

  // Oxirgi yangilash xato -> ekrandagi ma'lumot eskirgan: LIVE ko'rsatilmaydi (NOMA'LUM + xato pill)
  const refetchError = useOverviewRefetchError();
  const staleData = !!overview && !!refetchError;
  const liveStatus: BotLiveStatus | undefined =
    overview && installed ? effectiveLiveStatus(overview.bot, serverNow, staleData) : undefined;
  const tone: Tone = liveStatus ? liveTone(liveStatus) : 'slate';
  const live = liveStatus === 'live';

  const bot = overview?.bot;
  const secrets = overview?.secrets;
  const td = overview?.today;
  const pending = overview?.pending;
  const facts = overview?.facts;
  const health = overview?.health;

  const num = (n: number | undefined) => (overview ? f.num(n ?? 0) : '—');
  const attempted = td ? td.total - td.blocked : 0;
  const successPct = td && attempted > 0 ? f.pct(td.ok / attempted) : undefined;
  // Muddatli holatlar serverNow bilan reaktiv: muddat o'tgach keyingi javobni kutmasdan yo'qoladi
  const rateCountdown = bot?.rateLimitedUntil ? f.countdown(bot.rateLimitedUntil, serverNow) : null;
  const planExecUntil = bot?.planExecutingUntil ? Date.parse(bot.planExecutingUntil) : NaN;
  const planExecuting = !!bot?.planExecuting && (!Number.isFinite(planExecUntil) || planExecUntil > serverNow);
  const errMsg = refetchError?.message ?? '';
  const todayDay = tashkentDay(new Date(serverNow));

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      {/* ── Sarlavha: holat plitkasi + badge'lar + icon-only toolbar ── */}
      <div className={cn('px-5 py-4 flex flex-wrap items-center gap-x-3.5 gap-y-3 border-b bg-gradient-to-r', HERO_GRADIENT[tone] ?? HERO_GRADIENT.slate)}>
        <div className="relative w-11 h-11 shrink-0">
          {live && <span className={cn('absolute inset-0 rounded-2xl opacity-40 animate-ping', TONE_DOT[tone])} />}
          <span className={cn('relative w-11 h-11 rounded-2xl grid place-items-center text-white shadow-md', TONE_ICON_TILE[tone])}>
            <Network className="h-5 w-5" />
          </span>
        </div>

        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{t('hero.title')}</span>
            {overview ? (
              <LiveBadge status={liveStatus ?? bot?.liveStatus} installed={installed} />
            ) : (
              <span className="h-[18px] w-16 rounded-full bg-slate-200/80 dark:bg-slate-700/70 animate-pulse" />
            )}
            {staleData && (
              <button
                type="button"
                onClick={onRefresh}
                title={`${t('common.loadError')}${errMsg ? ` — ${errMsg}` : ''} · ${t('common.retry')}`}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
              >
                <Pill tone="rose" dot pulse icon={CloudOff}>{t('common.loadError')}</Pill>
              </button>
            )}
            {overview && installed && (
              <span
                className="text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums"
                title={bot?.heartbeatAt ? fmtDateTime(bot.heartbeatAt) : t('live.liveHint')}
              >
                {bot?.heartbeatAt ? t('live.heartbeatAgo', { ago: f.rel(bot.heartbeatAt, serverNow) }) : t('live.noHeartbeat')}
              </span>
            )}
            {secrets && (
              <>
                <Pill tone={secrets.setupToken ? 'emerald' : 'rose'} icon={KeyRound} title={t('secrets.note')}>
                  {t('secrets.setupToken')}: {secrets.setupToken ? t('secrets.present') : t('secrets.missing')}
                </Pill>
                <Pill tone={secrets.botToken ? 'emerald' : 'rose'} icon={KeyRound} title={t('secrets.note')}>
                  {t('secrets.botToken')}: {secrets.botToken ? t('secrets.present') : t('secrets.missing')}
                </Pill>
              </>
            )}
            {bot?.rateLimitedUntil && rateCountdown && (
              <Pill tone="indigo" dot pulse icon={Timer} title={t('live.rateLimitedUntil', { time: fmtDateTime(bot.rateLimitedUntil) })}>
                {t('live.rateLimited')}
                <span className="font-mono normal-case tracking-normal">{rateCountdown}</span>
              </Pill>
            )}
            {planExecuting && (
              <button type="button" onClick={() => onNavigate('plans')} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                <Pill tone="sky" dot pulse title={t('live.planExecutingHint')}>{t('live.planExecuting')}</Pill>
              </button>
            )}
          </div>
          <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1 truncate">
            {t('hero.subtitle', { bot: bot?.username || DEFAULT_BOT, service: bot?.service || DEFAULT_SERVICE })}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <RefreshButton onClick={onRefresh} fetching={fetching} />
          <IconButton icon={HeartPulse} title={t('hero.openHealth')} onClick={() => onNavigate('health')} />
          <IconButton icon={Settings2} title={t('hero.openSettings')} onClick={() => onNavigate('settings')} />
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* ── Bugungi KPI (Toshkent kuni, server soati bo'yicha) ── */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5" title={t('common.tashkentTime')}>
            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">{t('common.today')}</span>
            <span className="text-[10.5px] font-semibold text-slate-400 dark:text-slate-500 tabular-nums">{dayLabel(todayDay)}</span>
          </div>
          {loading && !overview ? (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-[66px] rounded-xl bg-slate-100 dark:bg-slate-800/70 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
              <KpiTile
                label={t('hero.kpi.calls')}
                value={num(td?.total)}
                tone="violet"
                icon={Activity}
                onClick={() => onNavigate('activity')}
              />
              <KpiTile
                label={t('hero.kpi.ok')}
                value={num(td?.ok)}
                sub={successPct}
                tone="emerald"
                icon={CheckCircle2}
              />
              <KpiTile
                label={t('hero.kpi.errors')}
                value={num(td?.error)}
                tone={(td?.error ?? 0) > 0 ? 'rose' : 'slate'}
                pulse={(td?.error ?? 0) > 0}
                icon={XCircle}
                onClick={() => onNavigate('activity', { status: 'error' })}
              />
              <KpiTile
                label={t('hero.kpi.timeouts')}
                value={num(td?.timeout)}
                tone={(td?.timeout ?? 0) > 0 ? 'amber' : 'slate'}
                icon={Hourglass}
                onClick={() => onNavigate('activity', { status: 'timeout' })}
              />
              <KpiTile
                label={t('hero.kpi.blocked')}
                value={num(td?.blocked)}
                tone={(td?.blocked ?? 0) > 0 ? 'indigo' : 'slate'}
                icon={Ban}
                onClick={() => onNavigate('activity', { status: RUN_BLOCKED_STATUSES.join(',') })}
              />
              <KpiTile
                label={t('hero.kpi.avgDuration')}
                value={overview ? f.dur(td?.avgDurationMs) : '—'}
                tone="slate"
                icon={Timer}
              />
              <KpiTile
                label={t('hero.kpi.lastActivity')}
                value={overview?.lastActivityAt ? <RelTime iso={overview.lastActivityAt} tick={5_000} /> : overview ? t('common.never') : '—'}
                tone="slate"
                icon={Clock}
              />
            </div>
          )}
        </div>

        {/* ── Kutilayotganlar (bosiladigan) ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 mr-1">
            {t('hero.pending.title')}
          </span>

          <HeroChip
            icon={GitPullRequest}
            label={t('hero.pending.plans')}
            tone={(pending?.plans ?? 0) > 0 ? 'amber' : 'slate'}
            pulse={(pending?.plans ?? 0) > 0}
            onClick={() => onNavigate('plans')}
          >
            <Count n={pending?.plans} />
          </HeroChip>

          <HeroChip
            icon={BrainCircuit}
            label={t('hero.pending.memory')}
            tone={(pending?.memoryWrites ?? 0) > 0 ? 'amber' : 'slate'}
            pulse={(pending?.memoryWrites ?? 0) > 0}
            onClick={() => onNavigate('memory')}
          >
            <Count n={pending?.memoryWrites} />
          </HeroChip>

          <HeroChip
            icon={Handshake}
            label={t('hero.pending.promises')}
            tone={(pending?.overduePromises ?? 0) > 0 ? 'rose' : (pending?.openPromises ?? 0) > 0 ? 'violet' : 'slate'}
            pulse={(pending?.overduePromises ?? 0) > 0}
            onClick={() => onNavigate('tasks')}
          >
            <Count n={pending?.openPromises} />
            {(pending?.overduePromises ?? 0) > 0 && (
              <span
                title={t('hero.pending.overdue')}
                className="min-w-[20px] h-5 px-1.5 rounded-md grid place-items-center text-[11px] font-extrabold tabular-nums bg-rose-500 text-white"
              >
                {pending?.overduePromises}
              </span>
            )}
          </HeroChip>

          <HeroChip
            icon={ListChecks}
            label={t('hero.pending.tasks')}
            tone={(pending?.tasksInProgress ?? 0) > 0 ? 'sky' : 'slate'}
            pulse={(pending?.tasksInProgress ?? 0) > 0}
            onClick={() => onNavigate('tasks')}
          >
            <Count n={pending?.tasksInProgress} />
          </HeroChip>

          {/* Facts yangiligi */}
          <HeroChip
            icon={Database}
            label={t('hero.facts')}
            tone={facts ? factsTone(facts.freshness) : 'slate'}
            onClick={() => onNavigate('health', { component: 'facts' })}
            title={facts?.updatedAt ? `${t('health.facts.updated')}: ${fmtDateTime(facts.updatedAt)}` : t('health.facts.every')}
          >
            {facts ? (
              <>
                <span className="text-[10px] font-bold uppercase tracking-wide">{t(`health.facts.${facts.freshness}`)}</span>
                {facts.updatedAt && (
                  <span className="text-[10.5px] font-medium opacity-80 tabular-nums">{f.rel(facts.updatedAt, serverNow)}</span>
                )}
                {facts.errorSections > 0 && (
                  <span
                    title={t('health.facts.errorsN', { n: facts.errorSections })}
                    className="min-w-[20px] h-5 px-1.5 rounded-md grid place-items-center text-[11px] font-extrabold tabular-nums bg-rose-500 text-white"
                  >
                    {facts.errorSections}
                  </span>
                )}
              </>
            ) : (
              <Count n={undefined} />
            )}
          </HeroChip>

          {/* Salomatlik — eng yomon holat + taqsimot chizig'i */}
          <HeroChip
            icon={HeartPulse}
            label={t('hero.health')}
            tone={health?.worst ? healthTone(health.worst) : 'slate'}
            onClick={() => onNavigate('health')}
            title={
              health?.checkedAt
                ? `${fmtDateTime(health.checkedAt)} · ${HEALTH_STATUSES.map((s) => `${t(`health.status.${s}`)} ${health.counts[s] ?? 0}`).join(' · ')}`
                : t('hero.healthNone')
            }
          >
            {health?.worst ? (
              <>
                <HealthBadge status={health.worst} />
                <HealthSpread counts={health.counts} />
                {health.checkedAt && (
                  <span className="text-[10.5px] font-medium opacity-80 tabular-nums whitespace-nowrap">
                    {t('hero.checkedAt', { ago: f.rel(health.checkedAt, serverNow) })}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[10.5px] font-medium opacity-80">{overview ? t('hero.healthNone') : '—'}</span>
            )}
          </HeroChip>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lokal yordamchilar
// ---------------------------------------------------------------------------

/** Bosiladigan holat chipi: ikon + yorliq + (son / holat) */
function HeroChip({
  icon: Icon, label, tone, pulse, onClick, title, children,
}: {
  icon: IconType; label: string; tone: Tone; pulse?: boolean; onClick: () => void; title?: string; children?: ReactNode;
}) {
  const idle = tone === 'slate';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={cn(
        'inline-flex items-center gap-2 h-8 pl-2.5 pr-1.5 rounded-lg ring-1 text-[11.5px] font-semibold transition-all',
        'hover:-translate-y-px hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
        idle
          ? 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400 hover:ring-violet-300 dark:hover:ring-violet-700 hover:text-slate-700 dark:hover:text-slate-200'
          : TONE_PILL[tone],
      )}
    >
      {!idle && <StatusDot tone={tone} pulse={pulse} className="w-1.5 h-1.5" />}
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
      <span className="whitespace-nowrap">{label}</span>
      {children}
    </button>
  );
}

function Count({ n }: { n: number | undefined }) {
  return (
    <span className="min-w-[20px] h-5 px-1.5 rounded-md grid place-items-center text-[11px] font-extrabold tabular-nums bg-white/80 dark:bg-slate-900/60 ring-1 ring-black/5 dark:ring-white/10">
      {n === undefined ? '—' : n}
    </span>
  );
}

/** Komponentlar holati taqsimoti (ok/warn/error/unknown) — ingichka segmentli chiziq */
function HealthSpread({ counts }: { counts: Record<string, number> }) {
  const order: { k: string; tone: Tone }[] = [
    { k: 'ok', tone: 'emerald' }, { k: 'warn', tone: 'amber' }, { k: 'error', tone: 'rose' }, { k: 'unknown', tone: 'slate' },
  ];
  const total = order.reduce((s, o) => s + (counts[o.k] ?? 0), 0);
  if (total <= 0) return null;
  return (
    <span aria-hidden className="hidden sm:flex w-12 h-1.5 rounded-full overflow-hidden bg-slate-200/70 dark:bg-slate-700/70">
      {order.map((o) => {
        const n = counts[o.k] ?? 0;
        return n > 0 ? <span key={o.k} className={cn('h-full', TONE_DOT[o.tone])} style={{ width: `${(n / total) * 100}%` }} /> : null;
      })}
    </span>
  );
}
