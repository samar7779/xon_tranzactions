'use client';

/**
 * Agent Support — agent kartalari (2x2): yoqish/o'chirish, model, kunlik chegara, 7 kunlik statistika.
 *
 * useAgentToggle() — web'dagi YAGONA yozuv amali: agents.kv_store `agent_enabled_<nom>` ('1' | '0'),
 * faqat AGENT_MANAGE ruxsati bilan (backend ham tekshiradi). Bot har chaqiruvdan oldin o'qiydi — restart kerak emas.
 * Optimistik emas: natija kutiladi, keyin barcha agent-team so'rovlari yangilanadi. settings-view ham ishlatadi.
 */

import { useCallback, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Cpu, History, Loader2, Lock, Timer } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { agentTeamApi, agentTeamKeys, AGENT_TEAM_REFRESH } from '@/lib/agent-team-api';
import type { AgentName, AgentStats, AgentTeamViewProps, DayPoint } from '@/lib/agent-team-types';
import {
  AGENT_META, AgentAvatar, ErrorBlock, IconButton, MiniBars, Pill, ProgressBar, RelTime, RunStatusBadge,
  StatusDot, TONE_DOT, TONE_TEXT, addDays, runStatusTone, tashkentToday, useAgentLabel, useAgentTeamFmt,
  type Tone,
} from './ui';

type Nav = AgentTeamViewProps['onNavigate'];

// ===========================================================================
// useAgentToggle — tasdiq oynasi -> PUT -> toast -> invalidatsiya
// ===========================================================================
export function useAgentToggle() {
  const t = useTranslations('adminAgentTeam.agents');
  const label = useAgentLabel();
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: (v: { name: AgentName; enabled: boolean }) => agentTeamApi.setAgentEnabled(v.name, v.enabled),
    onSuccess: (r) => {
      toast.success(t(r.enabled ? 'toggledOn' : 'toggledOff', { name: label(r.name) }));
    },
    onError: (e: any) => {
      toast.error(t('toggleError'), { description: e?.message });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: agentTeamKeys.all }),
  });

  const { mutate, isPending, variables } = mut;

  const toggle = useCallback(
    (name: AgentName, enabled: boolean) => {
      if (isPending) return;
      const n = label(name);
      // Leader o'chirilsa bot egasiga umuman javob bera olmaydi — kuchliroq ogohlantirish
      const msg = enabled
        ? t('confirmEnable', { name: n })
        : name === 'leader'
          ? t('confirmDisableLeader')
          : t('confirmDisable', { name: n });
      if (typeof window !== 'undefined' && !window.confirm(msg)) return;
      mutate({ name, enabled });
    },
    [isPending, label, mutate, t],
  );

  return {
    toggle,
    isPending,
    /** Hozir o'zgartirilayotgan agent (tugmada Loader2) */
    pendingName: isPending ? variables?.name ?? null : null,
  };
}

// ===========================================================================
// AgentSwitch — mavjud /admin/agent sahifasidagi switch uslubi (w-12 h-7)
// ===========================================================================
export function AgentSwitch({
  checked, onChange, locked, disabled, loading, title,
}: {
  checked: boolean;
  onChange: () => void;
  /** canManage=false — Lock ikonka, bosilmaydi */
  locked?: boolean;
  /** masalan bot o'rnatilmagan yoki boshqa agent o'zgartirilmoqda */
  disabled?: boolean;
  loading?: boolean;
  title: string;
}) {
  const off = !!(locked || disabled || loading);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      title={title}
      disabled={off}
      onClick={onChange}
      className={cn(
        'relative w-12 h-7 rounded-full transition-colors shrink-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
        checked ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-600',
        (locked || disabled) && !loading && 'opacity-60 cursor-not-allowed',
        loading && 'cursor-wait',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow grid place-items-center transition-transform',
          checked && 'translate-x-5',
        )}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
        ) : locked ? (
          <Lock className="h-3 w-3 text-slate-400" />
        ) : null}
      </span>
    </button>
  );
}

/** Switch title: ruxsat yo'q -> manageOnly; o'rnatilmagan -> install.compact; aks holda amal nomi */
export function useSwitchTitle() {
  const t = useTranslations('adminAgentTeam');
  return (opts: { canManage: boolean; installed: boolean; enabled: boolean }) =>
    !opts.canManage
      ? t('common.manageOnly')
      : !opts.installed
        ? t('install.compact')
        : opts.enabled
          ? t('agents.disable')
          : t('agents.enable');
}

// ===========================================================================
// AgentCards
// ===========================================================================
export function AgentCards({ canManage, onNavigate }: { canManage: boolean; onNavigate: Nav }) {
  const q = useQuery({
    queryKey: agentTeamKeys.agents(),
    queryFn: () => agentTeamApi.agents(),
    refetchInterval: AGENT_TEAM_REFRESH.agents,
  });
  const toggle = useAgentToggle();

  if (q.isLoading) {
    return (
      <div className="grid sm:grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => <AgentCardSkeleton key={i} />)}
      </div>
    );
  }
  if (!q.data) {
    return (
      <Card className="border-0 shadow-soft">
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  }

  const d = q.data;
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {d.agents.map((a) => (
        <AgentCard
          key={a.name}
          a={a}
          installed={d.installed}
          canManage={canManage}
          busy={toggle.pendingName === a.name}
          blocked={toggle.isPending && toggle.pendingName !== a.name}
          onToggle={() => toggle.toggle(a.name, !a.enabled)}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

function AgentCard({
  a, installed, canManage, busy, blocked, onToggle, onNavigate,
}: {
  a: AgentStats; installed: boolean; canManage: boolean; busy: boolean; blocked: boolean;
  onToggle: () => void; onNavigate: Nav;
}) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const switchTitle = useSwitchTitle();
  const meta = AGENT_META[a.name];

  const role = t(`agents.${a.name}.role`);
  const capRatio = a.dailyCap > 0 ? a.todayCounted / a.dailyCap : 0;
  const capTone: Tone = capRatio >= 0.9 ? 'rose' : capRatio >= 0.7 ? 'amber' : 'violet';
  const sr = a.successRate7d;
  const srTone: Tone = sr === null ? 'slate' : sr >= 0.9 ? 'emerald' : sr >= 0.7 ? 'amber' : 'rose';
  const model = a.model ?? a.defaultModel;
  const modelDiffers = !!a.model && a.model !== a.defaultModel;
  const running = installed && a.inProgress > 0;
  const failed7d = a.week.error + a.week.timeout;
  const series = a.series.length > 0 ? a.series : emptySeries();

  return (
    <Card className={cn('relative border-0 shadow-soft overflow-hidden', !a.enabled && 'bg-slate-50/70 dark:bg-slate-900/50')}>
      <span aria-hidden className={cn('absolute left-0 inset-y-0 w-[3px]', a.enabled ? TONE_DOT[meta.tone] : 'bg-slate-300 dark:bg-slate-700')} />
      <div className="p-4 pl-5 space-y-3">
        {/* Sarlavha */}
        <div className="flex items-start gap-3">
          <AgentAvatar name={a.name} size="lg" dimmed={!a.enabled} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[14px] font-bold text-slate-800 dark:text-slate-100 truncate">{t(`agents.${a.name}.name`)}</span>
              <span title={a.lastStatus ? t.has(`status.${a.lastStatus}`) ? t(`status.${a.lastStatus}`) : a.lastStatus : t('agents.noRuns')}>
                <StatusDot tone={runStatusTone(a.lastStatus)} pulse={running} className="w-1.5 h-1.5" />
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={role}>{role}</div>
          </div>
          <AgentSwitch
            checked={a.enabled}
            onChange={onToggle}
            locked={!canManage}
            disabled={!installed || blocked}
            loading={busy}
            title={switchTitle({ canManage, installed, enabled: a.enabled })}
          />
        </div>

        {/* Holat + model */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Pill tone={a.enabled ? 'emerald' : 'slate'} dot title={a.enabledUpdatedAt ? `agent_enabled_${a.name} · ${a.enabledRaw ?? '—'}` : undefined}>
            {a.enabled ? t('agents.enabled') : t('agents.disabled')}
          </Pill>
          {running && <Pill tone="sky" dot pulse>{t('agents.inProgress', { n: a.inProgress })}</Pill>}
          {capRatio >= 1 && <Pill tone="rose" dot pulse>{t('agents.capReached')}</Pill>}
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            title={modelDiffers ? `${t('agents.lastModel')}: ${a.model} · ${t('agents.defaultModel')}: ${a.defaultModel}` : a.model ? t('agents.lastModel') : t('agents.defaultModel')}
            className="inline-flex items-center gap-1.5 min-w-0 px-2 py-1 rounded-lg font-mono text-[10.5px] font-semibold ring-1 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700"
          >
            <Cpu className="h-3 w-3 shrink-0" />
            <span className="truncate">{model}</span>
            {modelDiffers && <StatusDot tone="amber" className="w-1.5 h-1.5" />}
          </span>
          <span
            title={t('agents.timeout', { n: a.timeoutS })}
            className="inline-flex items-center gap-1 shrink-0 px-2 py-1 rounded-lg font-mono text-[10.5px] font-semibold ring-1 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700"
          >
            <Timer className="h-3 w-3" /> {t('common.sec', { n: a.timeoutS })}
          </span>
        </div>

        {/* Metrikalar */}
        <div className="grid grid-cols-2 gap-2">
          <Metric label={t('agents.today')} title={t('agents.cap')} value={t('agents.capUsage', { n: a.todayCounted, cap: a.dailyCap })}>
            <ProgressBar value={capRatio} tone={capTone} className="mt-1.5" />
          </Metric>
          <Metric
            label={t('agents.week')}
            value={f.num(a.week.total)}
            title={`${t('agents.seriesOk')}: ${a.week.ok} · ${t('agents.seriesFailed')}: ${failed7d}`}
          >
            <div className="mt-0.5 text-[10px] tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{a.week.ok}</span>
              <span className="text-slate-400"> / </span>
              <span className={cn('font-semibold', failed7d > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400')}>{failed7d}</span>
            </div>
          </Metric>
          <Metric label={t('agents.avg')} value={f.dur(a.avgDurationMs7d)} title={`${t('agents.p95')}: ${f.dur(a.p95DurationMs7d)}`}>
            <div className="mt-0.5 text-[10px] text-slate-400 tabular-nums truncate">
              {t('agents.p95')} {f.dur(a.p95DurationMs7d)}
            </div>
          </Metric>
          <Metric label={t('agents.successRate')} value={<span className={TONE_TEXT[srTone]}>{f.pct(sr)}</span>} />
        </div>

        {/* 7 kunlik grafik */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 truncate">{t('agents.series')}</span>
            <span className="flex items-center gap-2 text-[9.5px] text-slate-400 dark:text-slate-500 shrink-0">
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/85" />{t('agents.seriesOk')}</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500/85" />{t('agents.seriesFailed')}</span>
            </span>
          </div>
          <MiniBars points={series} height={40} />
        </div>

        {/* Oxirgi xato */}
        {a.lastError ? (
          <button
            type="button"
            onClick={() => onNavigate('activity', { runId: a.lastError!.id })}
            title={t('activity.detail.title', { id: a.lastError.id })}
            className="w-full text-left rounded-lg ring-1 px-3 py-2 bg-rose-50/70 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-900 hover:ring-rose-300 dark:hover:ring-rose-700 transition"
          >
            <div className="flex items-center gap-1.5 mb-1 min-w-0">
              <span className="text-[9.5px] uppercase tracking-wider font-bold text-rose-700/80 dark:text-rose-300/80 truncate">{t('agents.lastError')}</span>
              <RunStatusBadge status={a.lastError.status} />
              <RelTime iso={a.lastError.ts} className="ml-auto text-[10.5px] text-rose-700/70 dark:text-rose-300/70 shrink-0" />
            </div>
            <div className="text-[11px] font-mono leading-snug text-rose-800 dark:text-rose-200 line-clamp-2 break-words">
              {a.lastError.error || t(`status.${a.lastError.status}`)}
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11.5px] font-medium ring-1 text-emerald-700 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 ring-emerald-100 dark:ring-emerald-900/50">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {t('agents.noErrors')}
          </div>
        )}

        {/* Pastki qator: oxirgi chaqiruv + icon-only havolalar */}
        <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex-1 min-w-0 flex items-center gap-1.5 text-[10.5px] text-slate-500 dark:text-slate-400">
            {a.lastRunAt ? (
              <>
                <span className="truncate">{t('agents.lastRun')}:</span>
                <RelTime iso={a.lastRunAt} className="font-semibold text-slate-600 dark:text-slate-300 shrink-0" />
              </>
            ) : (
              <span className="truncate">{t('agents.noRuns')}</span>
            )}
          </div>
          <IconButton icon={History} title={t('agents.openRuns')} onClick={() => onNavigate('activity', { agent: a.name })} className="h-8 w-8" />
          <IconButton
            icon={AlertTriangle}
            title={t('agents.openErrors')}
            tone="rose"
            active={failed7d > 0}
            onClick={() => onNavigate('activity', { agent: a.name, status: 'error,timeout' })}
            className="h-8 w-8"
          />
        </div>
      </div>
    </Card>
  );
}

function Metric({ label, value, title, children }: { label: string; value: ReactNode; title?: string; children?: ReactNode }) {
  return (
    <div title={title} className="min-w-0 rounded-lg px-2.5 py-2 bg-slate-50 dark:bg-slate-900/60 ring-1 ring-slate-100 dark:ring-slate-800">
      <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 truncate">{label}</div>
      <div className="text-[14px] font-extrabold leading-tight mt-0.5 tabular-nums text-slate-800 dark:text-slate-100 truncate">{value}</div>
      {children}
    </div>
  );
}

function AgentCardSkeleton() {
  return (
    <Card className="border-0 shadow-soft p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-24 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
          <div className="h-2.5 w-36 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
        </div>
        <div className="w-12 h-7 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[52px] rounded-lg bg-slate-100 dark:bg-slate-800/70 animate-pulse" />)}
      </div>
      <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800/70 animate-pulse" />
    </Card>
  );
}

/** installed=false yoki bo'sh seriya — 7 ta nol kun (grafik joyi saqlanadi) */
function emptySeries(): DayPoint[] {
  const today = tashkentToday();
  return Array.from({ length: 7 }, (_, i) => ({ date: addDays(today, i - 6), total: 0, ok: 0, failed: 0 }));
}
