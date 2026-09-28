'use client';

/**
 * Agent Support — jamoa topologiyasi (TeamDiagram), jonli texnik sxema.
 *
 *   Egasi ──Telegram──> Leader ──┬──> Support ─┐
 *     ^                          ├──> Checker   │ (nuqtali) [Ha]/[Yo'q] — faqat Telegram
 *     └──────────────────────────┴──> Teacher   ┘
 *
 * Qatlamlar: pastda SVG (viewBox 0 0 1000 H, preserveAspectRatio="none", vector-effect non-scaling-stroke),
 * ustida HTML tugunlar (foiz koordinatalar). H = graf maydonining o'lchangan balandligi (300..520 px; xl'da
 * karta agent kartalari balandligiga cho'ziladi), shuning uchun vertikal birliklar px ga teng. Gorizontal
 * koordinatalar o'lchangan kenglikdan hisoblanadi (tugunlar kesishmaydi).
 * Tor konteynerda (< 520px, masalan mobil yoki xl ikki ustun 1280-1366px) — vertikal daraxt.
 *
 * Chiziq rangi = maqsad agentning oxirgi statusi (TONE_HEX). Oqim animatsiyasi: bot LIVE (Egasi<->Leader)
 * yoki agentda jarayondagi vazifa bor (inProgress>0). O'chirilgan agent — kulrang uzuq chiziq.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Activity, ArrowRight, Ban, CheckCircle2, Clock, Database, FileJson, Hourglass, Network, Send, TerminalSquare, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentTeamApi, agentTeamKeys } from '@/lib/agent-team-api';
import type {
  AgentBrief, AgentName, AgentTeamOverview, AgentTeamViewProps, BotLiveStatus,
} from '@/lib/agent-team-types';
import {
  AGENT_META, AGENT_ORDER, AgentAvatar, LiveBadge, Pill, RelTime, SectionCard, StatusDot, TONE_DOT, TONE_HEX, TONE_PILL,
  dayLabel, factsTone, fmtDateTime, runStatusTone, tashkentToday, useAgentLabel, useAgentTeamFmt, type IconType, type Tone,
} from './ui';

type Nav = AgentTeamViewProps['onNavigate'];
type SubAgent = 'support' | 'checker' | 'teacher';
const SUBS: readonly SubAgent[] = ['support', 'checker', 'teacher'];

// ---------------------------------------------------------------------------
// Geometriya (viewBox birliklari; y = px)
// ---------------------------------------------------------------------------
const VB_W = 1000;
const MIN_GRAPH_H = 300;
const MAX_GRAPH_H = 520;
/** Agent tugunlari vertikal joylashuvi (graf balandligiga nisbatan) */
const SUB_FRAC: Record<SubAgent, number> = { support: 0.17, checker: 0.5, teacher: 0.83 };
const NODE_W = { owner: 88, leader: 140, agent: 164 } as const;              // px
const NODE_H = { owner: 96, leader: 84, agent: 60 } as const;               // px (aniq — portlar mos tushadi)
/** Support tugunidagi [Ha]/[Yo'q] porti chap chekkadan (px) — o'ngdagi holat badge'i bilan to'qnashmaydi */
const APPROVAL_PORT_X = 22;
const MAX_GRAPH_W = 940;
const MIN_GRAPH_W = 520;
/** Shu kenglikdan (px) tor bo'shliqda yorliq matni yashiriladi — faqat ikonka + title */
const LABEL_TELEGRAM_MIN = 72;
const LABEL_SCHEDULE_MIN = 110;

interface Geo {
  ownerX: number; leaderX: number; agentX: number;                          // tugun markazi, %
  ownerR: number; ownerC: number; leaderL: number; leaderR: number; agentL: number; // viewBox x
  apprX: number;                                                            // Support [Ha]/[Yo'q] porti, viewBox x
  gapA: number; gapB: number;                                               // Egasi-Leader va Leader-agent bo'shlig'i, px
}

function computeGeo(width: number): Geo {
  const W = Math.max(width, MIN_GRAPH_W);
  const G = Math.min(W, MAX_GRAPH_W);
  const off = (W - G) / 2;
  const m = 2;
  const ownerL = off + m;
  const ownerR = ownerL + NODE_W.owner;
  const agentR = off + G - m;
  const agentL = agentR - NODE_W.agent;
  const free = Math.max(0, agentL - ownerR - NODE_W.leader);
  const gapA = free * 0.42;                                                  // Leader->agent bo'shlig'i kengroq (yorliqlar)
  const leaderL = ownerR + gapA;
  const leaderR = leaderL + NODE_W.leader;
  const vb = (px: number) => (px / W) * VB_W;
  const pct = (px: number) => (px / W) * 100;
  return {
    ownerX: pct((ownerL + ownerR) / 2),
    leaderX: pct((leaderL + leaderR) / 2),
    agentX: pct((agentL + agentR) / 2),
    ownerR: vb(ownerR), ownerC: vb((ownerL + ownerR) / 2),
    leaderL: vb(leaderL), leaderR: vb(leaderR),
    agentL: vb(agentL),
    apprX: vb(agentL + APPROVAL_PORT_X),
    gapA, gapB: free - gapA,
  };
}

/** Element o'lchami (ResizeObserver). Callback ref — shartli mount bo'ladigan elementlar uchun ham ishlaydi. */
function useElementSize(): [(el: HTMLDivElement | null) => void, { w: number; h: number } | null] {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      roRef.current = ro;
    }
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);
  return [ref, size];
}

// ---------------------------------------------------------------------------
// Chiziq uslubi (holatdan)
// ---------------------------------------------------------------------------
interface EdgeStyle { color: string; dash?: string; flow: boolean; dim: boolean; pulse?: boolean; width?: number }

const OFF_EDGE: EdgeStyle = { color: TONE_HEX.slate, dash: '4 6', flow: false, dim: true };

function ownerEdgeStyle(installed: boolean, live: BotLiveStatus | undefined, leader: AgentBrief | undefined): EdgeStyle {
  if (!installed || !live || leader?.enabled === false) return OFF_EDGE;
  if (live === 'live') return { color: TONE_HEX.emerald, dash: '6 6', flow: true, dim: false };
  if (live === 'stale') return { color: TONE_HEX.amber, dash: '4 6', flow: false, dim: false };
  return OFF_EDGE;
}

function agentEdgeStyle(installed: boolean, a: AgentBrief | undefined): EdgeStyle {
  if (!installed || !a) return OFF_EDGE;
  if (!a.enabled) return { color: TONE_HEX.slate, dash: '3 6', flow: false, dim: true };
  const tone = a.lastStatus ? runStatusTone(a.lastStatus) : 'slate';
  if (a.inProgress > 0) return { color: TONE_HEX[tone === 'slate' ? 'sky' : tone], dash: '6 6', flow: true, dim: false };
  return { color: TONE_HEX[tone], flow: false, dim: !a.lastStatus };
}

function approvalEdgeStyle(installed: boolean, pendingPlans: number): EdgeStyle {
  if (installed && pendingPlans > 0) return { color: TONE_HEX.amber, dash: '2 6', flow: true, dim: false, pulse: true, width: 2 };
  return { color: TONE_HEX.slate, dash: '2 6', flow: false, dim: true, width: 1.5 };
}

/** Lokal keyframes (nomlar at* prefiksli — boshqa sahifalar bilan to'qnashmaydi) */
const DIAGRAM_CSS = `
@keyframes atFlow { to { stroke-dashoffset: -24; } }
@keyframes atPulse { 0%, 100% { stroke-opacity: 1; } 50% { stroke-opacity: .35; } }
@keyframes atFlowV { to { background-position: 0 10px; } }
@keyframes atFlowH { to { background-position: 10px 0; } }
.at-flow { animation: atFlow 1.2s linear infinite; }
.at-flow-pulse { animation: atFlow 1.2s linear infinite, atPulse 1.6s ease-in-out infinite; }
.at-dash-v { background-image: repeating-linear-gradient(to bottom, var(--at-c) 0 5px, transparent 5px 10px); background-size: 100% 10px; }
.at-dash-h { background-image: repeating-linear-gradient(to right, var(--at-c) 0 5px, transparent 5px 10px); background-size: 10px 100%; }
.at-flow-v { animation: atFlowV .5s linear infinite; }
.at-flow-h { animation: atFlowH .5s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .at-flow, .at-flow-pulse, .at-flow-v, .at-flow-h { animation: none; }
}
`;

// ===========================================================================
// TeamDiagram
// ===========================================================================
export function TeamDiagram({ overview, onNavigate }: { overview: AgentTeamOverview | undefined; onNavigate: Nav }) {
  const t = useTranslations('adminAgentTeam');

  // Kenglik — rejim (graf / ro'yxat) va gorizontal joylashuv; balandlik — graf maydoni (300..520)
  const [boxRef, box] = useElementSize();
  const [graphRef, graph] = useElementSize();
  const width = box?.w ?? null;
  const mode: 'graph' | 'list' | null = width === null ? null : width >= MIN_GRAPH_W ? 'graph' : 'list';
  const geo = useMemo(() => computeGeo(width ?? 800), [width]);
  const graphH = Math.min(MAX_GRAPH_H, Math.max(MIN_GRAPH_H, Math.round(graph?.h ?? MIN_GRAPH_H)));

  const installed = !!overview?.installed;
  const byName = useMemo(() => {
    const m = new Map<AgentName, AgentBrief>();
    for (const a of overview?.agents ?? []) m.set(a.name, a);
    return m;
  }, [overview]);

  const leader = byName.get('leader');
  const pendingPlans = installed ? overview?.pending.plans ?? 0 : 0;
  const styles = {
    owner: ownerEdgeStyle(installed, overview?.bot.liveStatus, leader),
    approval: approvalEdgeStyle(installed, pendingPlans),
    support: agentEdgeStyle(installed, byName.get('support')),
    checker: agentEdgeStyle(installed, byName.get('checker')),
    teacher: agentEdgeStyle(installed, byName.get('teacher')),
  };

  const common: DiagramBodyProps = { overview, installed, byName, styles, pendingPlans, onNavigate };

  return (
    <SectionCard
      icon={Network}
      title={t('diagram.title')}
      subtitle={t('diagram.subtitle')}
      actions={overview ? <LiveBadge status={overview.bot.liveStatus} installed={installed} /> : undefined}
      className="flex flex-col"
      bodyClassName="p-4 flex-1 flex flex-col"
    >
      <style>{DIAGRAM_CSS}</style>
      {/* xl'da karta qator balandligiga cho'ziladi — graf maydoni o'sadi (520px gacha), ortig'i markazda */}
      <div ref={boxRef} className="w-full flex-1 flex flex-col justify-center">
        {mode !== 'list' && (
          <div
            ref={graphRef}
            className={cn('relative w-full flex-1', mode === null && 'hidden md:block')}
            style={{ minHeight: MIN_GRAPH_H, maxHeight: MAX_GRAPH_H }}
          >
            <GraphLayout {...common} geo={geo} height={graphH} />
          </div>
        )}
        {mode !== 'graph' && (
          <div className={cn(mode === null && 'md:hidden')}>
            <ListLayout {...common} />
          </div>
        )}
      </div>
      <TodayMatrix overview={overview} installed={installed} onNavigate={onNavigate} />
      <TeamTrend installed={installed} />
      <InfraRail overview={overview} installed={installed} onNavigate={onNavigate} />
    </SectionCard>
  );
}

interface DiagramBodyProps {
  overview: AgentTeamOverview | undefined;
  installed: boolean;
  byName: Map<AgentName, AgentBrief>;
  styles: Record<'owner' | 'approval' | SubAgent, EdgeStyle>;
  pendingPlans: number;
  onNavigate: Nav;
}

// ===========================================================================
// Graf rejimi (md+ va konteyner >= 520px)
// ===========================================================================
function GraphLayout({
  overview, installed, byName, styles, pendingPlans, onNavigate, geo, height,
}: DiagramBodyProps & { geo: Geo; height: number }) {
  const t = useTranslations('adminAgentTeam');
  const g = geo;
  const H = height;
  const cy = H / 2;
  const subY = (n: SubAgent) => SUB_FRAC[n] * H;
  const pctY = (y: number) => (y / H) * 100;
  const mx = (g.leaderR + g.agentL) / 2;
  const apprStartY = subY('support') - NODE_H.agent / 2;
  const apprEndY = cy - NODE_H.owner / 2;
  const apprPeakY = 2;

  const edges: { id: string; d: string; s: EdgeStyle }[] = [
    { id: 'owner', d: `M ${g.ownerR} ${cy} L ${g.leaderL} ${cy}`, s: styles.owner },
    ...SUBS.map((n) => ({
      id: n,
      d: `M ${g.leaderR} ${cy} C ${mx} ${cy}, ${mx} ${subY(n)}, ${g.agentL} ${subY(n)}`,
      s: styles[n],
    })),
    {
      id: 'approval',
      d: `M ${g.apprX} ${apprStartY} C ${g.apprX} ${apprPeakY}, ${g.ownerC} ${apprPeakY}, ${g.ownerC} ${apprEndY}`,
      s: styles.approval,
    },
  ];

  // Kubik Bezier t=0.5 nuqtasi: yorliqlar chiziq ustida markazlanadi
  const apprLabelY = (apprStartY + 6 * apprPeakY + apprEndY) / 8;
  const leaderBrief = byName.get('leader');

  return (
    <div className="absolute inset-0">
      <svg
        className="absolute inset-0 w-full h-full overflow-visible"
        viewBox={`0 0 ${VB_W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {edges.map(({ id, d, s }) => (
          <g key={id}>
            {!s.dim && (
              <path d={d} fill="none" stroke={s.color} strokeOpacity={0.14} strokeWidth={7} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            )}
            <path
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 1.75}
              strokeDasharray={s.dash}
              strokeLinecap="round"
              strokeOpacity={s.dim ? 0.75 : 1}
              vectorEffect="non-scaling-stroke"
              className={cn(s.flow && (s.pulse ? 'at-flow-pulse' : 'at-flow'))}
            />
          </g>
        ))}
      </svg>

      {/* Chiziq yorliqlari */}
      <EdgeLabel x={(g.ownerR + g.leaderL) / 2 / 10} y={pctY(cy - 14)}>
        <span
          title={t('diagram.telegram')}
          className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500"
        >
          <Send className="h-2.5 w-2.5" /> {g.gapA >= LABEL_TELEGRAM_MIN && t('diagram.telegram')}
        </span>
      </EdgeLabel>

      {SUBS.map((n) => {
        const a = byName.get(n);
        const deleg = a?.delegToday ?? 0;
        return (
          <EdgeLabel key={n} x={mx / 10} y={pctY((cy + subY(n)) / 2)}>
            <span className="flex flex-col items-center gap-0.5">
              {n !== 'support' && (
                <span
                  title={t(`diagram.schedule.${n}`)}
                  className="inline-flex items-center gap-1 px-1.5 py-px rounded-md text-[9.5px] font-semibold whitespace-nowrap bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400"
                >
                  <Clock className="h-2.5 w-2.5 my-[1.5px]" /> {g.gapB >= LABEL_SCHEDULE_MIN && t(`diagram.schedule.${n}`)}
                </span>
              )}
              {(n === 'support' || deleg > 0) && (
                <span
                  className={cn(
                    'px-1.5 py-px rounded-md text-[9.5px] font-bold whitespace-nowrap tabular-nums ring-1',
                    deleg > 0 ? TONE_PILL.violet : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-400 dark:text-slate-500',
                  )}
                >
                  {t('diagram.deleg', { n: deleg })}
                </span>
              )}
            </span>
          </EdgeLabel>
        );
      })}

      <EdgeLabel x={(g.apprX + g.ownerC) / 2 / 10} y={pctY(apprLabelY)}>
        <button
          type="button"
          onClick={() => onNavigate('plans')}
          title={t('plans.telegramOnlyDesc')}
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold whitespace-nowrap ring-1 transition hover:-translate-y-px',
            pendingPlans > 0 ? TONE_PILL.amber : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-400 dark:text-slate-500',
          )}
        >
          {pendingPlans > 0 && <StatusDot tone="amber" pulse className="w-1.5 h-1.5" />}
          <Send className="h-2.5 w-2.5" />
          <span className="font-mono">{t('diagram.approvals')}</span>
          {pendingPlans > 0 && (
            <span className="min-w-[16px] h-4 px-1 rounded-full grid place-items-center bg-amber-500 text-white text-[9.5px] tabular-nums">{pendingPlans}</span>
          )}
        </button>
      </EdgeLabel>

      {/* Tugunlar */}
      <OwnerNode
        style={{ left: `${g.ownerX}%`, top: '50%', width: NODE_W.owner, height: NODE_H.owner }}
        edgeColor={styles.owner.color}
        approvalColor={styles.approval.color}
        onClick={() => onNavigate('chat')}
      />
      <AgentNode
        name="leader"
        brief={leaderBrief}
        installed={installed}
        loaded={!!overview}
        style={{ left: `${g.leaderX}%`, top: '50%', width: NODE_W.leader, height: NODE_H.leader }}
        ports={[
          { side: 'left', color: styles.owner.color },
          { side: 'right', color: leaderBrief && installed && leaderBrief.enabled ? TONE_HEX.violet : TONE_HEX.slate },
        ]}
        sub={t('diagram.leaderSub')}
        onClick={() => onNavigate('activity', { agent: 'leader' })}
      />
      {SUBS.map((n) => (
        <AgentNode
          key={n}
          name={n}
          brief={byName.get(n)}
          installed={installed}
          loaded={!!overview}
          style={{ left: `${g.agentX}%`, top: `${SUB_FRAC[n] * 100}%`, width: NODE_W.agent, height: NODE_H.agent }}
          ports={[
            { side: 'left', color: styles[n].color },
            ...(n === 'support' ? [{ side: 'topStart' as const, color: styles.approval.color }] : []),
          ]}
          onClick={() => onNavigate('activity', { agent: n })}
        />
      ))}
    </div>
  );
}

function EdgeLabel({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="absolute z-[5] -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
      {children}
    </div>
  );
}

type PortSide = 'left' | 'right' | 'top' | 'topStart';
function Port({ side, color }: { side: PortSide; color: string }) {
  const pos =
    side === 'left' ? 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2'
      : side === 'right' ? 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2'
        : side === 'top' ? 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2'
          : 'top-0 -translate-x-1/2 -translate-y-1/2';
  return (
    <span
      aria-hidden
      className={cn('absolute w-2 h-2 rounded-full ring-2 ring-white dark:ring-slate-900', pos)}
      style={{ backgroundColor: color, ...(side === 'topStart' ? { left: APPROVAL_PORT_X } : null) }}
    />
  );
}

function OwnerNode({ style, edgeColor, approvalColor, onClick }: { style: CSSProperties; edgeColor: string; approvalColor: string; onClick: () => void }) {
  const t = useTranslations('adminAgentTeam');
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('views.chat')}
      style={style}
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center gap-1 text-center rounded-xl px-2 bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm hover:shadow-md hover:ring-violet-300 dark:hover:ring-violet-700 transition"
    >
      <span className="w-9 h-9 rounded-full grid place-items-center text-white shadow-md bg-gradient-to-br from-sky-500 to-indigo-600 shadow-sky-500/30">
        <Send className="h-4 w-4" />
      </span>
      <span className="text-[12px] font-bold text-slate-800 dark:text-slate-100 leading-tight">{t('diagram.owner')}</span>
      <span className="text-[9.5px] text-slate-400 dark:text-slate-500 leading-tight">{t('diagram.ownerSub')}</span>
      <Port side="right" color={edgeColor} />
      <Port side="top" color={approvalColor} />
    </button>
  );
}

function AgentNode({
  name, brief, installed, loaded, style, ports, sub, onClick,
}: {
  name: AgentName; brief: AgentBrief | undefined; installed: boolean; loaded: boolean; style: CSSProperties;
  ports: { side: PortSide; color: string }[]; sub?: string; onClick: () => void;
}) {
  const t = useTranslations('adminAgentTeam');
  const label = useAgentLabel();
  const disabled = installed && brief ? !brief.enabled : false;
  const running = installed && (brief?.inProgress ?? 0) > 0;
  const tone: Tone = installed && brief?.lastStatus ? runStatusTone(brief.lastStatus) : 'slate';
  const calls = installed ? brief?.today.total ?? 0 : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      title={`${label(name)} · ${t('agents.openRuns')}`}
      className={cn(
        'absolute z-10 -translate-x-1/2 -translate-y-1/2 text-left rounded-xl px-2.5 bg-white dark:bg-slate-900 ring-1 shadow-sm hover:shadow-md transition flex flex-col justify-center',
        running
          ? 'ring-sky-300 dark:ring-sky-700 shadow-sky-500/10'
          : 'ring-slate-200 dark:ring-slate-700 hover:ring-violet-300 dark:hover:ring-violet-700',
      )}
    >
      <div className={cn('flex items-center gap-2 min-w-0', disabled && 'opacity-50')}>
        <AgentAvatar name={name} dimmed={disabled || !installed} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[12px] font-bold text-slate-800 dark:text-slate-100 truncate">{label(name)}</span>
            <StatusDot tone={tone} pulse={running} className="w-1.5 h-1.5" />
          </div>
          {sub && <div className="text-[9.5px] text-slate-400 dark:text-slate-500 truncate leading-tight" title={sub}>{sub}</div>}
          <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums truncate leading-tight mt-0.5">
            {loaded ? t('diagram.calls', { n: calls }) : '—'}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate leading-tight">
            {installed && brief ? <RelTime iso={brief.lastRunAt} /> : '—'}
          </div>
        </div>
      </div>
      {(running || disabled) && (
        <span className="absolute -top-2 right-2">
          <Pill tone={running ? 'sky' : 'slate'} dot pulse={running}>{running ? t('diagram.running') : t('diagram.off')}</Pill>
        </span>
      )}
      {ports.map((p) => <Port key={p.side} side={p.side} color={p.color} />)}
    </button>
  );
}

// ===========================================================================
// Ro'yxat rejimi (tor konteyner): Egasi -> Leader -> 3 agent (vertikal daraxt)
// ===========================================================================
function linkProps(s: EdgeStyle, dir: 'v' | 'h'): { className: string; style: CSSProperties } {
  const base = { ['--at-c' as string]: s.color, opacity: s.dim ? 0.75 : 1 } as CSSProperties;
  if (!s.dash) return { className: '', style: { ...base, backgroundColor: s.color } };
  return {
    className: cn(dir === 'v' ? 'at-dash-v' : 'at-dash-h', s.flow && (dir === 'v' ? 'at-flow-v' : 'at-flow-h')),
    style: base,
  };
}

function ListLayout({ overview, installed, byName, styles, pendingPlans, onNavigate }: DiagramBodyProps) {
  const t = useTranslations('adminAgentTeam');
  const label = useAgentLabel();
  const ownerLink = linkProps(styles.owner, 'v');
  const apprLink = linkProps(styles.approval, 'h');
  return (
    <div>
      <ListRow
        icon={<span className="w-8 h-8 rounded-full grid place-items-center text-white shadow-md bg-gradient-to-br from-sky-500 to-indigo-600"><Send className="h-4 w-4" /></span>}
        title={t('diagram.owner')}
        sub={t('diagram.ownerSub')}
        onClick={() => onNavigate('chat')}
      />
      <div className="relative h-7 ml-[27px]">
        <span aria-hidden className={cn('absolute left-0 inset-y-0 w-0.5', ownerLink.className)} style={ownerLink.style} />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          <Send className="h-2.5 w-2.5" /> {t('diagram.telegram')}
        </span>
      </div>
      <ListAgentRow name="leader" brief={byName.get('leader')} installed={installed} loaded={!!overview} sub={t('diagram.leaderSub')} onNavigate={onNavigate} />
      <div className="relative pl-12">
        {SUBS.map((n, i) => {
          const link = linkProps(styles[n], 'h');
          const last = i === SUBS.length - 1;
          return (
            <div key={n} className="relative pt-2">
              <span aria-hidden className={cn('absolute -left-[21px] w-0.5 bg-slate-200 dark:bg-slate-700', last ? 'top-0 h-[calc(50%+4px)]' : 'inset-y-0')} />
              <span aria-hidden className={cn('absolute -left-[21px] top-[calc(50%+4px)] w-[21px] h-0.5', link.className)} style={link.style} />
              <ListAgentRow name={n} brief={byName.get(n)} installed={installed} loaded={!!overview} onNavigate={onNavigate} />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onNavigate('plans')}
        title={t('plans.telegramOnlyDesc')}
        className="mt-3 ml-12 inline-flex items-center gap-2 text-[10.5px] font-semibold text-slate-500 dark:text-slate-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
      >
        <span aria-hidden className={cn('w-8 h-0.5', apprLink.className)} style={apprLink.style} />
        {label('support')} <ArrowRight className="h-3 w-3" /> {t('diagram.owner')}
        <span
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-px rounded-full text-[9.5px] font-bold font-mono ring-1',
            pendingPlans > 0 ? TONE_PILL.amber : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-400',
          )}
        >
          {pendingPlans > 0 && <StatusDot tone="amber" pulse className="w-1.5 h-1.5" />}
          {t('diagram.approvals')}
          {pendingPlans > 0 && <span className="tabular-nums">{pendingPlans}</span>}
        </span>
      </button>
    </div>
  );
}

function ListRow({ icon, title, sub, right, onClick, dim }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick: () => void; dim?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm hover:ring-violet-300 dark:hover:ring-violet-700 transition"
    >
      <span className={cn('shrink-0', dim && 'opacity-50')}>{icon}</span>
      <span className={cn('flex-1 min-w-0', dim && 'opacity-60')}>
        <span className="block text-[12.5px] font-bold text-slate-800 dark:text-slate-100 truncate">{title}</span>
        {sub && <span className="block text-[10.5px] text-slate-500 dark:text-slate-400 truncate">{sub}</span>}
      </span>
      {right && <span className="shrink-0 flex flex-col items-end gap-1">{right}</span>}
    </button>
  );
}

function ListAgentRow({
  name, brief, installed, loaded, sub, onNavigate,
}: { name: AgentName; brief: AgentBrief | undefined; installed: boolean; loaded: boolean; sub?: string; onNavigate: Nav }) {
  const t = useTranslations('adminAgentTeam');
  const label = useAgentLabel();
  const disabled = installed && brief ? !brief.enabled : false;
  const running = installed && (brief?.inProgress ?? 0) > 0;
  const tone: Tone = installed && brief?.lastStatus ? runStatusTone(brief.lastStatus) : 'slate';
  return (
    <ListRow
      dim={disabled}
      icon={<AgentAvatar name={name} dimmed={disabled || !installed} />}
      title={
        <span className="inline-flex items-center gap-1.5">
          {label(name)} <StatusDot tone={tone} pulse={running} className="w-1.5 h-1.5" />
        </span>
      }
      sub={sub ?? (installed && brief ? <RelTime iso={brief.lastRunAt} /> : '—')}
      right={
        <>
          {running ? (
            <Pill tone="sky" dot pulse>{t('diagram.running')}</Pill>
          ) : disabled ? (
            <Pill tone="slate" dot>{t('diagram.off')}</Pill>
          ) : null}
          <span className="text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
            {loaded ? t('diagram.calls', { n: installed ? brief?.today.total ?? 0 : 0 }) : '—'}
          </span>
        </>
      }
      onClick={() => onNavigate('activity', { agent: name })}
    />
  );
}

// ===========================================================================
// Bugun — agentlar kesimida (texnik matritsa: status taqsimoti chizig'i + sonlar)
// ===========================================================================
const MATRIX_SEGMENTS: { key: 'ok' | 'empty' | 'error' | 'timeout' | 'blocked'; cls: string }[] = [
  { key: 'ok', cls: 'bg-emerald-500/85' },
  { key: 'empty', cls: 'bg-slate-400/70' },
  { key: 'error', cls: 'bg-rose-500/85' },
  { key: 'timeout', cls: 'bg-amber-500/85' },
  { key: 'blocked', cls: 'bg-indigo-500/70' },
];

function TodayMatrix({ overview, installed, onNavigate }: { overview: AgentTeamOverview | undefined; installed: boolean; onNavigate: Nav }) {
  const t = useTranslations('adminAgentTeam');
  const label = useAgentLabel();
  const rows = AGENT_ORDER.map((name) => ({ name, brief: overview?.agents.find((a) => a.name === name) }));
  const max = Math.max(1, ...rows.map((r) => (installed ? r.brief?.today.total ?? 0 : 0)));
  const statusLabel = (k: string) => (k === 'blocked' ? t('hero.kpi.blocked') : t(`status.${k}`));
  const cols: { key: 'total' | 'ok' | 'error' | 'timeout' | 'blocked'; icon: IconType; title: string; tone: string }[] = [
    { key: 'total', icon: Activity, title: t('hero.kpi.calls'), tone: 'text-slate-700 dark:text-slate-200 font-bold' },
    { key: 'ok', icon: CheckCircle2, title: t('status.ok'), tone: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'error', icon: XCircle, title: t('status.error'), tone: 'text-rose-600 dark:text-rose-400' },
    { key: 'timeout', icon: Hourglass, title: t('status.timeout'), tone: 'text-amber-600 dark:text-amber-400' },
    { key: 'blocked', icon: Ban, title: t('hero.kpi.blocked'), tone: 'text-indigo-600 dark:text-indigo-400' },
  ];

  return (
    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 w-[88px] shrink-0">
          {t('agents.today')}
        </span>
        <span className="flex-1" />
        {cols.map((c, i) => (
          <span key={c.key} title={c.title} className={cn('w-8 shrink-0 grid place-items-center text-slate-400 dark:text-slate-500', i > 0 && 'hidden sm:grid')}>
            <c.icon className="h-3 w-3" />
          </span>
        ))}
      </div>
      <div className="space-y-1">
        {rows.map(({ name, brief }) => {
          const td = installed && brief ? brief.today : null;
          const disabled = installed && brief ? !brief.enabled : false;
          const title = td
            ? MATRIX_SEGMENTS.map((s) => `${statusLabel(s.key)} ${td[s.key]}`).join(' · ')
            : undefined;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onNavigate('activity', { agent: name })}
              title={title}
              className="w-full flex items-center gap-2 h-7 px-1 -mx-1 rounded-md text-left hover:bg-violet-50/60 dark:hover:bg-violet-950/20 transition-colors"
            >
              <span className={cn('w-[88px] shrink-0 flex items-center gap-1.5 min-w-0', disabled && 'opacity-50')}>
                <AgentAvatar name={name} size="sm" dimmed={disabled || !installed} />
                <span className="text-[11.5px] font-semibold text-slate-700 dark:text-slate-200 truncate">{label(name)}</span>
              </span>
              <span className="flex-1 min-w-0 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                {td && td.total > 0 && MATRIX_SEGMENTS.map((s) => {
                  const n = td[s.key];
                  return n > 0 ? (
                    <span key={s.key} className={cn('h-full transition-all duration-500', s.cls)} style={{ width: `${(n / max) * 100}%` }} />
                  ) : null;
                })}
              </span>
              {cols.map((c, i) => {
                const n = td ? td[c.key] : null;
                return (
                  <span
                    key={c.key}
                    className={cn(
                      'w-8 shrink-0 text-right text-[11px] tabular-nums',
                      i > 0 && 'hidden sm:block',
                      n ? c.tone : 'text-slate-300 dark:text-slate-600',
                    )}
                  >
                    {n === null ? '—' : n}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// Infra qatori + legenda
// ===========================================================================
function InfraRail({ overview, installed, onNavigate }: { overview: AgentTeamOverview | undefined; installed: boolean; onNavigate: Nav }) {
  const t = useTranslations('adminAgentTeam');
  const f = useAgentTeamFmt();
  const facts = overview?.facts;
  const setup = overview?.secrets.setupToken;
  return (
    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
      <InfraChip
        icon={Database}
        label={t('diagram.db')}
        tone={installed ? 'emerald' : 'slate'}
        title={overview ? t(`install.reason.${overview.reason}`) : undefined}
        onClick={() => onNavigate('health')}
      />
      <InfraChip
        icon={FileJson}
        label={t('diagram.facts')}
        tone={facts ? factsTone(facts.freshness) : 'slate'}
        title={
          facts
            ? `${t(`health.facts.${facts.freshness}`)}${facts.updatedAt ? ` · ${fmtDateTime(facts.updatedAt)}` : ''}${facts.ageSec !== null ? ` · ${f.dur(facts.ageSec * 1000)}` : ''}`
            : undefined
        }
        onClick={() => onNavigate('health', { component: 'facts' })}
      />
      <InfraChip
        icon={TerminalSquare}
        label={t('diagram.cli')}
        tone={setup === undefined ? 'slate' : setup ? 'emerald' : 'rose'}
        title={setup === undefined ? undefined : `${t('secrets.setupToken')}: ${setup ? t('secrets.present') : t('secrets.missing')}`}
        onClick={() => onNavigate('settings')}
      />
      <div className="ml-auto flex items-center gap-3 flex-wrap text-[10px] text-slate-500 dark:text-slate-400">
        <LegendItem color={TONE_HEX.emerald} label={t('diagram.legend.ok')} />
        <LegendItem color={TONE_HEX.rose} label={t('diagram.legend.error')} />
        <LegendItem color={TONE_HEX.slate} dash label={t('diagram.legend.off')} />
        <LegendItem color={TONE_HEX.violet} dash flow label={t('diagram.legend.flow')} />
      </div>
    </div>
  );
}

function InfraChip({ icon: Icon, label, tone, title, onClick }: { icon: IconType; label: string; tone: Tone; title?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg ring-1 text-[11px] font-semibold whitespace-nowrap bg-slate-50 dark:bg-slate-900/60 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:ring-violet-300 dark:hover:ring-violet-700 transition"
    >
      <StatusDot tone={tone} pulse={tone === 'rose'} className="w-1.5 h-1.5" />
      <Icon className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
      {label}
    </button>
  );
}

function LegendItem({ color, label, dash, flow }: { color: string; label: string; dash?: boolean; flow?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <svg width="22" height="6" aria-hidden className="shrink-0">
        <line
          x1="1" y1="3" x2="21" y2="3"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={dash ? '6 6' : undefined}
          className={cn(flow && 'at-flow')}
        />
      </svg>
      {label}
    </span>
  );
}

// ===========================================================================
// 7 kunlik jamoa yuklamasi — kunlik chaqiruvlar agentlar kesimida (rang = agent)
// Ma'lumot: agents so'rovi (AgentCards bilan umumiy kalit — qo'shimcha polling yo'q)
// ===========================================================================
const TREND_BAR_MAX_PX = 46;

function TeamTrend({ installed }: { installed: boolean }) {
  const t = useTranslations('adminAgentTeam');
  const label = useAgentLabel();
  const f = useAgentTeamFmt();
  const q = useQuery({ queryKey: agentTeamKeys.agents(), queryFn: () => agentTeamApi.agents() });
  const list = q.data?.agents;

  const days = useMemo(() => {
    const agents = list ?? [];
    const dates = agents.find((a) => a.series.length > 0)?.series.map((p) => p.date) ?? [];
    return dates.map((date) => {
      const per = AGENT_ORDER.map((name) => {
        const a = agents.find((x) => x.name === name);
        return { name, n: a?.series.find((p) => p.date === date)?.total ?? 0 };
      });
      const failed = agents.reduce((s, a) => s + (a.series.find((p) => p.date === date)?.failed ?? 0), 0);
      return { date, per, total: per.reduce((s, p) => s + p.n, 0), failed };
    });
  }, [list]);

  if (!installed || days.length === 0) return null;
  const max = Math.max(1, ...days.map((d) => d.total));
  const weekTotal = days.reduce((s, d) => s + d.total, 0);
  const today = tashkentToday();

  return (
    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">{t('agents.series')}</span>
        <span className="text-[11px] font-bold tabular-nums text-slate-600 dark:text-slate-300">{f.num(weekTotal)}</span>
        <span className="ml-auto flex items-center gap-2.5 flex-wrap justify-end text-[9.5px] text-slate-500 dark:text-slate-400">
          {AGENT_ORDER.map((name) => (
            <span key={name} className="inline-flex items-center gap-1">
              <span className={cn('w-2 h-2 rounded-sm', TONE_DOT[AGENT_META[name].tone])} />
              {label(name)}
            </span>
          ))}
        </span>
      </div>
      <div className="flex items-end gap-1.5">
        {days.map((d) => {
          const title = [
            `${dayLabel(d.date)} · ${d.total}`,
            d.per.map((p) => `${label(p.name)} ${p.n}`).join(', '),
            d.failed > 0 ? `${t('agents.seriesFailed')}: ${d.failed}` : '',
          ].filter(Boolean).join(' · ');
          return (
            <div key={d.date} title={title} className="flex-1 min-w-0 flex flex-col items-center justify-end">
              <span className={cn('text-[9px] leading-none mb-1 tabular-nums', d.failed > 0 ? 'text-rose-500 font-bold' : 'text-slate-400 dark:text-slate-500')}>
                {d.total > 0 ? d.total : ''}
              </span>
              <div
                className={cn(
                  'w-full rounded-[3px] overflow-hidden flex flex-col-reverse bg-slate-100 dark:bg-slate-800',
                  d.date === today && 'ring-1 ring-violet-300 dark:ring-violet-700',
                )}
                style={{ height: Math.max(3, Math.round((d.total / max) * TREND_BAR_MAX_PX)) }}
              >
                {d.total > 0 && d.per.map((p) => (p.n > 0 ? (
                  <div key={p.name} className={cn('w-full', TONE_DOT[AGENT_META[p.name].tone])} style={{ height: `${(p.n / d.total) * 100}%` }} />
                ) : null))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1">
        {days.map((d) => (
          <div
            key={d.date}
            className={cn('flex-1 text-center text-[9px] tabular-nums', d.date === today ? 'text-violet-600 dark:text-violet-400 font-bold' : 'text-slate-400 dark:text-slate-500')}
          >
            {dayLabel(d.date)}
          </div>
        ))}
      </div>
    </div>
  );
}
