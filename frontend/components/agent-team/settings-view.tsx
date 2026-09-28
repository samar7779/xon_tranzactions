'use client';

/**
 * Agent Support — Sozlamalar (faqat o'qish).
 * Env kalitlari faqat bor/yo'q ko'rinishida (token qiymati HECH QACHON ko'rsatilmaydi), modellar, chegaralar,
 * jadval va saqlash muddatlari. Yagona boshqaruv — agentlarni yoqish/o'chirish (useAgentToggle, AGENT_MANAGE).
 * Qolgan o'zgartirishlar serverdagi env fayli + servis restart orqali.
 */

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle, Archive, CalendarClock, CheckCircle2, Cpu, Info, KeyRound, Lock, Power, TerminalSquare, XCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { agentTeamApi, agentTeamKeys, AGENT_TEAM_REFRESH } from '@/lib/agent-team-api';
import type { AgentTeamSettings, AgentTeamViewProps } from '@/lib/agent-team-types';
import {
  AgentAvatar, CodeBlock, ErrorBlock, InfoRow, Pill, ProgressBar, RefreshButton, RelTime, SectionCard,
  SkeletonRows, fmtDateTime, useAgentLabel,
} from './ui';
import { AgentSwitch, useAgentToggle, useSwitchTitle } from './agent-cards';

/** Bot tomonidagi standart LEADER_TG_ID (backend ownerTgIdMatches shu bilan solishtiradi) */
const DEFAULT_OWNER_TG_ID = '1954122311';

export function SettingsView({ canManage }: AgentTeamViewProps) {
  const t = useTranslations('adminAgentTeam');
  const q = useQuery({
    queryKey: agentTeamKeys.settings(),
    queryFn: () => agentTeamApi.settings(),
    refetchInterval: AGENT_TEAM_REFRESH.settings,
  });

  if (q.isLoading) {
    return (
      <div className="grid lg:grid-cols-2 gap-5">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="border-0 shadow-soft p-5">
            <SkeletonRows rows={5} />
          </Card>
        ))}
      </div>
    );
  }
  if (!q.data) {
    return (
      <SectionCard icon={KeyRound} title={t('settings.title')} subtitle={t('settings.subtitle')} actions={<RefreshButton onClick={() => q.refetch()} fetching={q.isFetching} />}>
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      </SectionCard>
    );
  }
  return <SettingsBody d={q.data} canManage={canManage} fetching={q.isFetching} onRefresh={() => q.refetch()} />;
}

function SettingsBody({ d, canManage, fetching, onRefresh }: { d: AgentTeamSettings; canManage: boolean; fetching: boolean; onRefresh: () => void }) {
  const t = useTranslations('adminAgentTeam');
  const label = useAgentLabel();
  const toggle = useAgentToggle();
  const switchTitle = useSwitchTitle();
  const env = d.env;
  const C = d.constants;

  /** Soniyani eng qulay birlikda: 14400 -> "4 soat", 300 -> "5 daq", 45 -> "45 s" */
  const secs = (s: number): string =>
    s >= 3600 && s % 3600 === 0
      ? t('settings.hours', { n: s / 3600 })
      : s >= 60 && s % 60 === 0
        ? t('settings.minutes', { n: s / 60 })
        : t('settings.seconds', { n: s });

  const presence = (ok: boolean, optional?: boolean) => (
    <Pill tone={ok ? 'emerald' : optional ? 'slate' : 'rose'} icon={ok ? CheckCircle2 : XCircle} title={t('secrets.note')}>
      {ok ? t('secrets.present') : t('secrets.missing')}
    </Pill>
  );
  const plain = (v: string | null, fallback?: string) =>
    v ? (
      <span className="font-mono text-[11.5px] break-all">{v}</span>
    ) : (
      <span className="text-slate-400 dark:text-slate-500">
        {t('settings.notSet')}
        {fallback && <span className="font-mono"> · {fallback}</span>}
      </span>
    );

  const scheduleRows: [string, string][] = [
    ['heartbeat', secs(C.heartbeatS)],
    ['heartbeatWarn', secs(C.heartbeatWarnS)],
    ['heartbeatError', secs(C.heartbeatErrorS)],
    ['checker', secs(C.checkerIntervalS)],
    ['checkerStart', secs(C.checkerStartDelayS)],
    ['facts', secs(C.factsIntervalS)],
    ['factsStale', secs(C.factsStaleS)],
    ['teacherDaily', C.teacherDailyTime],
    ['approvalTtl', secs(C.approvalTtlS)],
    ['promiseReminder', secs(C.promiseReminderS)],
    ['promiseMax', String(C.promiseMaxReminders)],
    ['historyContext', String(C.historyContextN)],
  ];
  const retention = Object.entries(C.retentionDays || {});
  const maxRetention = Math.max(1, ...retention.map(([, n]) => n));
  const restartCmd = t('settings.restartCmd');

  return (
    <div className="space-y-5">
      {env.v1LeaderActive && (
        <div className="flex items-start gap-3 rounded-xl px-4 py-3 ring-1 bg-amber-50/70 dark:bg-amber-950/30 ring-amber-200 dark:ring-amber-900">
          <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0 text-white shadow-md bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/30">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 text-[12px] leading-relaxed text-amber-800 dark:text-amber-200 pt-0.5">{t('settings.v1Conflict')}</div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* ── Kalitlar (faqat bor/yo'q) ── */}
        <SectionCard
          icon={KeyRound}
          title={t('settings.tokensTitle')}
          subtitle={t('settings.subtitle')}
          actions={
            <>
              <Pill tone="slate" icon={Lock}>{t('common.readOnly')}</Pill>
              <RefreshButton onClick={onRefresh} fetching={fetching} />
            </>
          }
        >
          <EnvRow name={t('settings.env.setupToken')} desc={t('settings.envDesc.setupToken')}>{presence(env.setupToken)}</EnvRow>
          <EnvRow name={t('settings.env.botToken')} desc={t('settings.envDesc.botToken')}>{presence(env.botToken)}</EnvRow>
          <EnvRow name={t('settings.env.baseUrl')} desc={t('settings.envDesc.baseUrl')}>{presence(env.anthropicBaseUrl, true)}</EnvRow>
          <EnvRow name={t('settings.env.ownerTgId')} desc={t('settings.envDesc.ownerTgId')}>
            {env.ownerTgId ? (
              <div className="space-y-1">
                <span className={cn('font-mono text-[11.5px]', !env.ownerTgIdMatches && 'text-rose-600 dark:text-rose-400 font-semibold')}>{env.ownerTgId}</span>
                {!env.ownerTgIdMatches && (
                  <div className="flex items-start gap-1.5 text-[10.5px] text-rose-600 dark:text-rose-400 leading-snug">
                    <AlertTriangle className="h-3 w-3 mt-px shrink-0" /> {t('settings.ownerMismatch')}
                  </div>
                )}
              </div>
            ) : (
              plain(null, `${DEFAULT_OWNER_TG_ID} (${t('settings.defaultValue')})`)
            )}
          </EnvRow>
          <EnvRow name={t('settings.env.useCli')} desc={t('settings.envDesc.useCli')}>
            <Pill tone={env.useCli ? 'emerald' : 'rose'} dot>{env.useCli ? t('common.yes') : t('common.no')}</Pill>
          </EnvRow>
          <EnvRow name={t('settings.env.agentOsUser')} desc={t('settings.envDesc.agentOsUser')}>{plain(env.agentOsUser)}</EnvRow>
          <EnvRow name={t('settings.env.claudeCmd')} desc={t('settings.envDesc.claudeCmd')}>{plain(env.claudeCmd)}</EnvRow>
          <div className="mt-3 flex items-center gap-2 flex-wrap text-[10.5px] text-slate-500 dark:text-slate-400">
            <Lock className="h-3 w-3 shrink-0" />
            <span className="flex-1 min-w-[160px]">{t('secrets.note')}</span>
            <span className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-md ring-1 font-semibold',
              env.source === 'none'
                ? 'bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300'
                : 'bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300',
            )}>
              {t(`settings.source.${env.source}`)}
            </span>
          </div>
        </SectionCard>

        {/* ── Modellar va chegaralar ── */}
        <SectionCard icon={Cpu} title={`${t('settings.modelsTitle')} · ${t('settings.limitsTitle')}`} subtitle={t('settings.envTitle')}>
          <InfoRow label={t('settings.modelStrong')}><ModelChip>{env.modelStrong}</ModelChip></InfoRow>
          <InfoRow label={t('settings.modelFast')}><ModelChip>{env.modelFast}</ModelChip></InfoRow>
          <InfoRow label={t('settings.dailyCap')}>
            <span className="font-semibold tabular-nums">{t('settings.perDay', { n: env.dailyCap })}</span>
          </InfoRow>
          <InfoRow label={t('settings.timeout')}>
            <span className="font-semibold tabular-nums">{t('settings.seconds', { n: env.timeoutS })}</span>
          </InfoRow>
          {d.agents.map((a) => {
            const custom = a.timeoutS !== env.timeoutS;
            return (
              <InfoRow key={a.name} label={t('settings.timeoutAgent', { name: label(a.name) })}>
                <span className={cn('tabular-nums', custom ? 'font-semibold text-violet-700 dark:text-violet-300' : 'text-slate-500 dark:text-slate-400')}>
                  {t('settings.seconds', { n: a.timeoutS })}
                </span>
                {!custom && <span className="text-[10.5px] text-slate-400 dark:text-slate-500"> · {t('settings.defaultValue')}</span>}
              </InfoRow>
            );
          })}
        </SectionCard>

        {/* ── Agentlarni yoqish / o'chirish ── */}
        <SectionCard
          icon={Power}
          title={t('settings.agentsTitle')}
          subtitle={t('agents.toggleHint')}
          actions={!d.installed ? <Pill tone="amber" dot>{t('install.badge')}</Pill> : !canManage ? <Pill tone="slate" icon={Lock}>{t('common.readOnly')}</Pill> : undefined}
        >
          <div className="divide-y divide-slate-100 dark:divide-slate-800 -my-2">
            {d.agents.map((a) => (
              <div key={a.name} className="flex items-center gap-3 py-2.5">
                <AgentAvatar name={a.name} dimmed={!a.enabled} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[12.5px] font-bold text-slate-800 dark:text-slate-100">{label(a.name)}</span>
                    <Pill tone={a.enabled ? 'emerald' : 'slate'} dot>{a.enabled ? t('agents.enabled') : t('agents.disabled')}</Pill>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-[10.5px] text-slate-500 dark:text-slate-400 min-w-0">
                    <span className="font-mono truncate" title={a.enabledUpdatedAt ? fmtDateTime(a.enabledUpdatedAt) : undefined}>
                      agent_enabled_{a.name} = {a.enabledRaw ?? '—'}
                    </span>
                    {a.enabledRaw === null && <span className="text-slate-400 dark:text-slate-500">({t('settings.defaultValue')})</span>}
                    {a.enabledUpdatedAt && (
                      <>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <RelTime iso={a.enabledUpdatedAt} />
                      </>
                    )}
                  </div>
                </div>
                <AgentSwitch
                  checked={a.enabled}
                  onChange={() => toggle.toggle(a.name, !a.enabled)}
                  locked={!canManage}
                  disabled={!d.installed || (toggle.isPending && toggle.pendingName !== a.name)}
                  loading={toggle.pendingName === a.name}
                  title={switchTitle({ canManage, installed: d.installed, enabled: a.enabled })}
                />
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ── Jadval, muddatlar, saqlash ── */}
        <SectionCard icon={CalendarClock} title={t('settings.scheduleTitle')} subtitle={t('common.tashkentTime')}>
          <div className="grid sm:grid-cols-2 gap-x-6">
            {scheduleRows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-[11.5px] font-semibold text-slate-600 dark:text-slate-300 truncate" title={t(`settings.constants.${k}`)}>
                  {t(`settings.constants.${k}`)}
                </span>
                <span className="text-[12px] font-mono font-semibold text-slate-800 dark:text-slate-100 tabular-nums whitespace-nowrap">{v}</span>
              </div>
            ))}
          </div>

          {retention.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 mb-2">
                <Archive className="h-3 w-3" /> {t('settings.retentionTitle')}
              </div>
              <div className="space-y-2">
                {retention.map(([table, days]) => (
                  <div key={table} className="grid grid-cols-[minmax(0,1fr)_88px_56px] items-center gap-3">
                    <div className="min-w-0">
                      <div className="text-[11.5px] font-semibold text-slate-600 dark:text-slate-300 truncate">
                        {t.has(`settings.retention.${table}`) ? t(`settings.retention.${table}`) : table}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">agents.{table}</div>
                    </div>
                    <ProgressBar value={days / maxRetention} tone="violet" />
                    <span className="text-[11.5px] font-mono font-semibold text-right text-slate-700 dark:text-slate-200 tabular-nums">
                      {t('settings.days', { n: days })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Faqat o'qish eslatmasi + restart buyrug'i ── */}
      <Card className="border-0 shadow-soft p-5 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0 text-white shadow-md bg-gradient-to-br from-slate-500 to-slate-700 shadow-slate-500/20">
            <Info className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-bold text-slate-800 dark:text-slate-100">{t('common.readOnly')}</div>
            <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{t('settings.readOnlyNote')}</div>
          </div>
        </div>
        <div className="md:w-[440px] shrink-0 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 mb-1.5">
            <TerminalSquare className="h-3 w-3" /> {t('settings.copyCmd')}
          </div>
          <CodeBlock copyText={restartCmd} maxHeight={80}>{restartCmd}</CodeBlock>
        </div>
      </Card>
    </div>
  );
}

function EnvRow({ name, desc, children }: { name: string; desc: string; children: ReactNode }) {
  return (
    <InfoRow label={<span className="font-mono text-[11px]">{name}</span>} hint={desc}>
      {children}
    </InfoRow>
  );
}

function ModelChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 max-w-full px-2 py-1 rounded-lg font-mono text-[11px] font-semibold ring-1 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700">
      <Cpu className="h-3 w-3 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}
