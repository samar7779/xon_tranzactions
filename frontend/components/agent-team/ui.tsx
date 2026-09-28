'use client';

/**
 * Agent Support — UMUMIY UI primitivlari va formatlash yordamchilari.
 * Barcha agent-team ko'rinishlari (shell, activity, ops) shu fayldan foydalanadi — dizayn bir xil bo'lsin.
 * Bu faylni ko'rinish yozuvchilari O'ZGARTIRMAYDI (kerak bo'lsa o'z faylida lokal komponent yozadi).
 *
 * Uslub: mavjud /admin/agent sahifasi (violet aksent, ring-1, rounded-xl, 11-13px matn, uppercase badge'lar).
 * Emoji yo'q — faqat lucide-react ikonlar. Vaqtlar Toshkent (UTC+5, yozgi vaqt yo'q).
 */

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Crown, Database, GraduationCap, Inbox, Loader2,
  Lock, RefreshCw, Search, Send, Stethoscope, TerminalSquare, Wrench, X,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  AGENT_NAMES,
  type AgentName,
  type BotLiveStatus,
  type DayPoint,
  type FactsFreshness,
  type InstallState,
  type SystemEventKind,
} from '@/lib/agent-team-types';

export type IconType = ComponentType<{ className?: string }>;

// ===========================================================================
// Rang tonlari
// ===========================================================================
export type Tone = 'slate' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky' | 'indigo' | 'teal' | 'fuchsia';

/** Kichik badge / pill (fon + matn + halqa) */
export const TONE_PILL: Record<Tone, string> = {
  slate: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
  violet: 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-800',
  emerald: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800',
  amber: 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-800',
  rose: 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-800',
  sky: 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 ring-sky-200 dark:ring-sky-800',
  indigo: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-800',
  teal: 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 ring-teal-200 dark:ring-teal-800',
  fuchsia: 'bg-fuchsia-50 dark:bg-fuchsia-950/50 text-fuchsia-700 dark:text-fuchsia-300 ring-fuchsia-200 dark:ring-fuchsia-800',
};

/** Holat nuqtasi */
export const TONE_DOT: Record<Tone, string> = {
  slate: 'bg-slate-400', violet: 'bg-violet-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500',
  rose: 'bg-rose-500', sky: 'bg-sky-500', indigo: 'bg-indigo-500', teal: 'bg-teal-500', fuchsia: 'bg-fuchsia-500',
};

/** Matn rangi (raqamlar, ikonlar) */
export const TONE_TEXT: Record<Tone, string> = {
  slate: 'text-slate-600 dark:text-slate-300', violet: 'text-violet-600 dark:text-violet-400',
  emerald: 'text-emerald-600 dark:text-emerald-400', amber: 'text-amber-600 dark:text-amber-400',
  rose: 'text-rose-600 dark:text-rose-400', sky: 'text-sky-600 dark:text-sky-400',
  indigo: 'text-indigo-600 dark:text-indigo-400', teal: 'text-teal-600 dark:text-teal-400',
  fuchsia: 'text-fuchsia-600 dark:text-fuchsia-400',
};

/** KPI plitkasi foni (mavjud StatTile bilan bir xil) */
export const TONE_TILE: Record<Tone, string> = {
  slate: 'bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200',
  violet: 'bg-violet-50 dark:bg-violet-950/40 ring-violet-200 dark:ring-violet-900 text-violet-700 dark:text-violet-300',
  emerald: 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900 text-amber-700 dark:text-amber-300',
  rose: 'bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300',
  sky: 'bg-sky-50 dark:bg-sky-950/40 ring-sky-200 dark:ring-sky-900 text-sky-700 dark:text-sky-300',
  indigo: 'bg-indigo-50 dark:bg-indigo-950/40 ring-indigo-200 dark:ring-indigo-900 text-indigo-700 dark:text-indigo-300',
  teal: 'bg-teal-50 dark:bg-teal-950/40 ring-teal-200 dark:ring-teal-900 text-teal-700 dark:text-teal-300',
  fuchsia: 'bg-fuchsia-50 dark:bg-fuchsia-950/40 ring-fuchsia-200 dark:ring-fuchsia-900 text-fuchsia-700 dark:text-fuchsia-300',
};

/** Gradient ikon plitkasi (sarlavhalar) */
export const TONE_ICON_TILE: Record<Tone, string> = {
  slate: 'bg-gradient-to-br from-slate-400 to-slate-600 shadow-slate-500/20',
  violet: 'bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-violet-500/30',
  emerald: 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/30',
  amber: 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/30',
  rose: 'bg-gradient-to-br from-rose-500 to-pink-600 shadow-rose-500/30',
  sky: 'bg-gradient-to-br from-sky-500 to-cyan-600 shadow-sky-500/30',
  indigo: 'bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-500/30',
  teal: 'bg-gradient-to-br from-teal-500 to-emerald-600 shadow-teal-500/30',
  fuchsia: 'bg-gradient-to-br from-fuchsia-500 to-pink-600 shadow-fuchsia-500/30',
};

/** SVG uchun hex (diagramma chiziqlari, grafik) */
export const TONE_HEX: Record<Tone, string> = {
  slate: '#94a3b8', violet: '#8b5cf6', emerald: '#10b981', amber: '#f59e0b', rose: '#f43f5e',
  sky: '#0ea5e9', indigo: '#6366f1', teal: '#14b8a6', fuchsia: '#d946ef',
};

// ===========================================================================
// Agentlar identifikatsiyasi
// ===========================================================================
export const AGENT_ORDER: readonly AgentName[] = AGENT_NAMES;

/** Agent rangi — status ranglari (emerald/amber/rose) bilan to'qnashmaydi */
export const AGENT_META: Record<AgentName, { icon: IconType; tone: Tone }> = {
  leader: { icon: Crown, tone: 'violet' },
  support: { icon: Wrench, tone: 'sky' },
  checker: { icon: Stethoscope, tone: 'teal' },
  teacher: { icon: GraduationCap, tone: 'fuchsia' },
};

export function isAgentName(s: unknown): s is AgentName {
  return typeof s === 'string' && (AGENT_NAMES as readonly string[]).includes(s);
}

/** Agent ikon plitkasi (kartalar, diagramma, jadval qatorlari) */
export function AgentAvatar({ name, size = 'md', dimmed }: { name: string; size?: 'sm' | 'md' | 'lg'; dimmed?: boolean }) {
  const meta = isAgentName(name) ? AGENT_META[name] : { icon: TerminalSquare, tone: 'slate' as Tone };
  const Icon = meta.icon;
  const box = size === 'sm' ? 'w-6 h-6 rounded-md' : size === 'lg' ? 'w-11 h-11 rounded-2xl' : 'w-8 h-8 rounded-xl';
  const ico = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <span className={cn('grid place-items-center shrink-0 text-white shadow-md', box, dimmed ? TONE_ICON_TILE.slate : TONE_ICON_TILE[meta.tone])}>
      <Icon className={ico} />
    </span>
  );
}

/** Agent nomi (i18n) — noma'lum nom o'zicha qaytadi */
export function useAgentLabel() {
  const t = useTranslations('adminAgentTeam');
  return (name: string | null | undefined): string => {
    if (!name) return '—';
    return isAgentName(name) ? t(`agents.${name}.name`) : name;
  };
}

// ===========================================================================
// Status -> ton
// ===========================================================================
export function runStatusTone(s: string | null | undefined): Tone {
  switch (s) {
    case 'ok': return 'emerald';
    case 'error': return 'rose';
    case 'timeout': return 'amber';
    case 'capped': return 'amber';
    case 'rate_limited': return 'indigo';
    case 'no_prompt':
    case 'bad_name': return 'rose';
    case 'empty':
    case 'disabled':
    default: return 'slate';
  }
}
export function healthTone(s: string | null | undefined): Tone {
  return s === 'ok' ? 'emerald' : s === 'warn' ? 'amber' : s === 'error' ? 'rose' : 'slate';
}
export function liveTone(s: BotLiveStatus | null | undefined): Tone {
  return s === 'live' ? 'emerald' : s === 'stale' ? 'amber' : s === 'offline' ? 'rose' : 'slate';
}
export function taskStatusTone(s: string | null | undefined): Tone {
  return s === 'in_progress' ? 'sky' : s === 'done' ? 'emerald' : s === 'failed' ? 'rose' : 'slate';
}
export function riskTone(s: string | null | undefined): Tone {
  return s === 'yuqori' ? 'rose' : s === 'orta' ? 'amber' : 'emerald';
}
export function factsTone(s: FactsFreshness | null | undefined): Tone {
  return s === 'fresh' ? 'emerald' : s === 'stale' ? 'amber' : s === 'old' ? 'rose' : 'slate';
}
export function planKindTone(s: string | null | undefined): Tone {
  switch (s) {
    case 'offered': return 'sky';
    case 'applied': return 'emerald';
    case 'failed': return 'rose';
    case 'env': return 'rose';
    case 'rad': return 'amber';
    case 'rejected':
    default: return 'slate';
  }
}
export function systemKindTone(k: SystemEventKind | string | null | undefined): Tone {
  switch (k) {
    case 'plan_applied': return 'emerald';
    case 'plan_offered': return 'sky';
    case 'plan_failed':
    case 'plan_env':
    case 'agent_error':
    case 'memory_rad': return 'rose';
    case 'plan_rad':
    case 'agent_empty':
    case 'agent_not_called':
    case 'memory_pending': return 'amber';
    case 'memory_code': return 'violet';
    case 'memory_teacher': return 'fuchsia';
    case 'agent_ok': return 'teal';
    case 'plan_rejected':
    default: return 'slate';
  }
}

// ===========================================================================
// Vaqt va format (Toshkent = UTC+5, Intl'siz — deterministik)
// ===========================================================================
const TZ_MS = 5 * 3600 * 1000;
const p2 = (n: number) => String(n).padStart(2, '0');

function tz(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + TZ_MS); // UTC getter'lar endi Toshkent qiymatini beradi
}

/** 'DD.MM.YYYY HH:mm' */
export function fmtDateTime(iso: string | Date | null | undefined): string {
  const t = tz(iso);
  if (!t) return '—';
  return `${p2(t.getUTCDate())}.${p2(t.getUTCMonth() + 1)}.${t.getUTCFullYear()} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
}
/** 'DD.MM HH:mm' */
export function fmtShortDateTime(iso: string | Date | null | undefined): string {
  const t = tz(iso);
  if (!t) return '—';
  return `${p2(t.getUTCDate())}.${p2(t.getUTCMonth() + 1)} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
}
/** 'HH:mm:ss' */
export function fmtTime(iso: string | Date | null | undefined): string {
  const t = tz(iso);
  if (!t) return '—';
  return `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
}
/** 'DD.MM.YYYY' */
export function fmtDay(iso: string | Date | null | undefined): string {
  const t = tz(iso);
  if (!t) return '—';
  return `${p2(t.getUTCDate())}.${p2(t.getUTCMonth() + 1)}.${t.getUTCFullYear()}`;
}
/** ISO -> Toshkent kuni 'YYYY-MM-DD' */
export function tashkentDay(iso: string | Date | null | undefined): string {
  const t = tz(iso);
  return t ? t.toISOString().slice(0, 10) : '';
}
/** Bugungi Toshkent kuni 'YYYY-MM-DD' */
export function tashkentToday(): string {
  return tashkentDay(new Date());
}
/** 'YYYY-MM-DD' -> 'DD.MM' */
export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  return m ? `${m[3]}.${m[2]}` : day;
}
/** 'YYYY-MM-DD' ga n kun qo'shadi (manfiy ham bo'ladi) */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (isNaN(d.getTime())) return day;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Har `ms` da yangilanadigan hozirgi vaqt (nisbiy vaqtlar va hisoblagichlar uchun) */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Qiymat o'zgarishini `ms` kechiktiradi (qidiruv inputlari: 200 ms — egasi tezlikni talab qiladi) */
export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Tarjima qilingan formatlash yordamchilari */
export function useAgentTeamFmt() {
  const t = useTranslations('adminAgentTeam.common');
  return useMemo(() => {
    const dur = (ms: number | null | undefined): string => {
      if (ms === null || ms === undefined || !Number.isFinite(ms)) return t('none');
      const a = Math.abs(ms);
      if (a < 1000) return t('ms', { n: Math.round(a) });
      if (a < 60_000) return t('sec', { n: Math.round(a / 100) / 10 });
      const m = Math.floor(a / 60_000);
      const s = Math.round((a % 60_000) / 1000);
      return t('minSec', { m, s });
    };
    /** Nisbiy vaqt: '3 daq oldin' / '5 daq dan keyin' */
    const rel = (iso: string | null | undefined, now: number = Date.now()): string => {
      if (!iso) return t('never');
      const ts = Date.parse(iso);
      if (isNaN(ts)) return t('none');
      const diff = Math.round((now - ts) / 1000);
      const a = Math.abs(diff);
      if (a < 10) return t('justNow');
      const future = diff < 0;
      if (a < 60) return t(future ? 'inSec' : 'secAgo', { n: a });
      if (a < 3600) return t(future ? 'inMin' : 'minAgo', { n: Math.floor(a / 60) });
      if (a < 86_400) return t(future ? 'inHour' : 'hourAgo', { n: Math.floor(a / 3600) });
      return t(future ? 'inDay' : 'dayAgo', { n: Math.floor(a / 86_400) });
    };
    /** Qolgan vaqt (hisoblagich): 'm daq s s' yoki 's s'. O'tgan bo'lsa null. */
    const countdown = (iso: string | null | undefined, now: number = Date.now()): string | null => {
      if (!iso) return null;
      const left = Date.parse(iso) - now;
      if (isNaN(left) || left <= 0) return null;
      return dur(left);
    };
    const bytes = (n: number | null | undefined): string => {
      if (n === null || n === undefined || !Number.isFinite(n)) return t('none');
      if (n < 1024) return t('bytes', { n });
      if (n < 1024 * 1024) return t('kb', { n: Math.round(n / 102.4) / 10 });
      return t('mb', { n: Math.round(n / 104857.6) / 10 });
    };
    const num = (n: number | null | undefined): string =>
      n === null || n === undefined || !Number.isFinite(n) ? t('none') : n.toLocaleString('ru-RU');
    const pct = (x: number | null | undefined): string =>
      x === null || x === undefined || !Number.isFinite(x) ? t('none') : `${Math.round(x * 1000) / 10}%`;
    return { dur, rel, countdown, bytes, num, pct };
  }, [t]);
}

/** Nisbiy vaqt, title'da aniq vaqt; 15 s da yangilanadi */
export function RelTime({ iso, className, tick = 15_000 }: { iso: string | null | undefined; className?: string; tick?: number }) {
  const now = useNow(tick);
  const f = useAgentTeamFmt();
  return (
    <time dateTime={iso || undefined} title={iso ? fmtDateTime(iso) : undefined} className={cn('tabular-nums', className)}>
      {f.rel(iso, now)}
    </time>
  );
}

// ===========================================================================
// Badge'lar
// ===========================================================================
export function StatusDot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex w-2 h-2 shrink-0', className)}>
      {pulse && <span className={cn('absolute inset-0 rounded-full opacity-60 animate-ping', TONE_DOT[tone])} />}
      <span className={cn('relative inline-flex w-2 h-2 rounded-full', TONE_DOT[tone])} />
    </span>
  );
}

export function Pill({
  tone = 'slate', icon: Icon, dot, pulse, mono, title, className, children,
}: {
  tone?: Tone; icon?: IconType; dot?: boolean; pulse?: boolean; mono?: boolean; title?: string; className?: string; children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ring-1 whitespace-nowrap',
        mono && 'font-mono normal-case tracking-normal text-[10.5px]',
        TONE_PILL[tone], className,
      )}
    >
      {dot && <StatusDot tone={tone} pulse={pulse} className="w-1.5 h-1.5" />}
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

/** Reaktiv LIVE/KECHIKMOQDA/OFFLINE/NOMA'LUM (installed=false -> O'RNATILMAGAN) */
export function LiveBadge({ status, installed = true, className }: { status: BotLiveStatus | null | undefined; installed?: boolean; className?: string }) {
  const t = useTranslations('adminAgentTeam');
  if (!installed) return <Pill tone="slate" dot className={className}>{t('install.badge')}</Pill>;
  const s: BotLiveStatus = status || 'unknown';
  return (
    <Pill tone={liveTone(s)} dot pulse={s === 'live' || s === 'stale'} className={className} title={t('live.liveHint')}>
      {t(`live.${s}`)}
    </Pill>
  );
}

export function RunStatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const t = useTranslations('adminAgentTeam');
  const s = status || '';
  const known = t.has(`status.${s}`);
  return (
    <Pill tone={runStatusTone(s)} dot className={className} title={known ? t(`statusHint.${s}`) : undefined}>
      {known ? t(`status.${s}`) : s || '—'}
    </Pill>
  );
}

export function HealthBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const t = useTranslations('adminAgentTeam');
  const s = status || 'unknown';
  return (
    <Pill tone={healthTone(s)} dot pulse={s === 'error'} className={className}>
      {t.has(`health.status.${s}`) ? t(`health.status.${s}`) : s}
    </Pill>
  );
}

// ===========================================================================
// Konteynerlar
// ===========================================================================
/** Bo'lim kartasi: ikon plitka + sarlavha + (icon-only) amallar */
export function SectionCard({
  id, icon: Icon, tone = 'violet', title, subtitle, actions, children, className, bodyClassName, noBody,
}: {
  id?: string; icon?: IconType; tone?: Tone; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode;
  children?: ReactNode; className?: string; bodyClassName?: string; noBody?: boolean;
}) {
  return (
    <Card id={id} className={cn('border-0 shadow-soft overflow-hidden', className)}>
      <div className="px-5 py-3.5 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800">
        {Icon && (
          <span className={cn('w-9 h-9 rounded-xl grid place-items-center shrink-0 text-white shadow-md', TONE_ICON_TILE[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-bold text-slate-800 dark:text-slate-100 truncate">{title}</div>
          {subtitle && <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
      </div>
      {noBody ? children : <div className={cn('p-5', bodyClassName)}>{children}</div>}
    </Card>
  );
}

/** Icon-only kvadrat tugma (h-9 w-9), matn faqat title/aria-label'da */
export function IconButton({
  icon: Icon, title, onClick, disabled, loading, active, tone = 'violet', className, type = 'button',
}: {
  icon: IconType; title: string; onClick?: () => void; disabled?: boolean; loading?: boolean; active?: boolean;
  tone?: Tone; className?: string; type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-label={title}
      className={cn(
        'h-9 w-9 p-0 grid place-items-center rounded-lg ring-1 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed',
        active
          ? TONE_PILL[tone]
          : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400 hover:text-violet-700 dark:hover:text-violet-300 hover:ring-violet-300 dark:hover:ring-violet-700',
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
    </button>
  );
}

/** Yangilash tugmasi (isFetching paytida aylanadi) */
export function RefreshButton({ onClick, fetching }: { onClick: () => void; fetching?: boolean }) {
  const t = useTranslations('adminAgentTeam.common');
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('refresh')}
      aria-label={t('refresh')}
      className="h-9 w-9 p-0 grid place-items-center rounded-lg ring-1 bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400 hover:text-violet-700 dark:hover:text-violet-300 hover:ring-violet-300 transition-colors shrink-0"
    >
      <RefreshCw className={cn('h-4 w-4', fetching && 'animate-spin')} />
    </button>
  );
}

/** KPI plitkasi (bosiladigan bo'lishi mumkin) */
export function KpiTile({
  label, value, sub, tone = 'slate', icon: Icon, onClick, pulse, mono, className,
}: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: IconType; onClick?: () => void;
  pulse?: boolean; mono?: boolean; className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-wider font-bold opacity-70">
        {Icon && <Icon className="h-3 w-3" />}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn('text-[18px] leading-tight font-extrabold mt-1 truncate tabular-nums', mono && 'font-mono text-[13px]')}>{value}</div>
      {sub && <div className="text-[10.5px] opacity-70 mt-0.5 truncate">{sub}</div>}
    </>
  );
  const cls = cn('rounded-xl ring-1 px-3 py-2.5 text-left min-w-0', TONE_TILE[tone], pulse && 'ring-2', className);
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(cls, 'hover:-translate-y-0.5 hover:shadow-md transition-all')}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

/** Kalit — qiymat qatori (sozlamalar, batafsil panellar) */
export function InfoRow({ label, hint, children, mono }: { label: ReactNode; hint?: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-b-0 border-slate-100 dark:border-slate-800">
      <div className="w-[42%] min-w-0">
        <div className="text-[11.5px] font-semibold text-slate-600 dark:text-slate-300 break-words">{label}</div>
        {hint && <div className="text-[10.5px] text-slate-400 dark:text-slate-500 mt-0.5">{hint}</div>}
      </div>
      <div className={cn('flex-1 min-w-0 text-[12px] text-slate-700 dark:text-slate-200 break-words', mono && 'font-mono text-[11.5px]')}>{children}</div>
    </div>
  );
}

/** Ingichka progress chizig'i (0..1) */
export function ProgressBar({ value, tone = 'violet', className }: { value: number; tone?: Tone; className?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className={cn('h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', TONE_DOT[tone])} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

// ===========================================================================
// Holatlar: yuklanish, xato, bo'sh, o'rnatilmagan
// ===========================================================================
export function LoadingBlock({ className }: { className?: string }) {
  const t = useTranslations('adminAgentTeam.common');
  return (
    <div className={cn('py-12 grid place-items-center text-slate-400', className)}>
      <div className="flex items-center gap-2 text-[12.5px]"><Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}</div>
    </div>
  );
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 rounded-lg bg-slate-100 dark:bg-slate-800/70 animate-pulse" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const t = useTranslations('adminAgentTeam.common');
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return (
    <div className={cn('py-10 px-6 flex flex-col items-center text-center', className)}>
      <span className="w-11 h-11 rounded-2xl grid place-items-center bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 ring-1 ring-rose-200 dark:ring-rose-900">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <div className="mt-3 text-[13px] font-semibold text-slate-700 dark:text-slate-200">{t('loadError')}</div>
      {msg && <div className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400 max-w-md break-words">{msg}</div>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold ring-1 bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:ring-violet-300 hover:text-violet-700 dark:hover:text-violet-300 transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> {t('retry')}
        </button>
      )}
    </div>
  );
}

export function EmptyBlock({ icon: Icon = Inbox, title, desc, className }: { icon?: IconType; title: string; desc?: ReactNode; className?: string }) {
  return (
    <div className={cn('py-10 px-6 flex flex-col items-center text-center', className)}>
      <span className="w-11 h-11 rounded-2xl grid place-items-center bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
        <Icon className="h-5 w-5" />
      </span>
      <div className="mt-3 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">{title}</div>
      {desc && <div className="mt-1 text-[11.5px] text-slate-400 dark:text-slate-500 max-w-md">{desc}</div>}
    </div>
  );
}

/**
 * Bot o'rnatilmagan holati. compact=true — ko'rinishlar ichida bir qatorli;
 * to'liq variant — Agent Support konteyneri tepasida (o'rnatish qadamlari bilan).
 */
export function NotInstalled({ state, compact, className }: { state: InstallState; compact?: boolean; className?: string }) {
  const t = useTranslations('adminAgentTeam');
  const reason = t(`install.reason.${state.reason}`);
  if (compact) {
    return (
      <div className={cn('py-10 px-6 flex flex-col items-center text-center', className)}>
        <span className="relative w-11 h-11 rounded-2xl grid place-items-center bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
          <Database className="h-5 w-5" />
          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full grid place-items-center bg-slate-400 dark:bg-slate-600 text-white ring-2 ring-white dark:ring-slate-900">
            <X className="h-2.5 w-2.5" />
          </span>
        </span>
        <div className="mt-3 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">{t('install.compact')}</div>
        <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{reason}</div>
      </div>
    );
  }
  const steps = [t('install.step1'), t('install.step2'), t('install.step3')];
  return (
    <Card className={cn('border-0 shadow-soft overflow-hidden', className)}>
      <div className="p-5 flex flex-col md:flex-row gap-5">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <span className="relative w-12 h-12 rounded-2xl grid place-items-center shrink-0 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-slate-700">
            <Database className="h-6 w-6" />
            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full grid place-items-center bg-amber-500 text-white ring-2 ring-white dark:ring-slate-900">
              <X className="h-3 w-3" />
            </span>
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-bold text-slate-800 dark:text-slate-100">{t('install.title')}</span>
              <Pill tone="amber" dot>{t('install.badge')}</Pill>
            </div>
            <div className="text-[12px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{t('install.desc')}</div>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <Pill tone="slate" mono>{reason}</Pill>
              {state.missingTables.length > 0 && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t('install.missing', { list: state.missingTables.join(', ') })}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="md:w-[380px] shrink-0 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-50 dark:bg-slate-900/60 p-3.5">
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-2">{t('install.stepsTitle')}</div>
          <ol className="space-y-1.5">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2 text-[11.5px] text-slate-600 dark:text-slate-300">
                <span className="w-5 h-5 rounded-md grid place-items-center text-[10px] font-bold bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 shrink-0">{i + 1}</span>
                <span className="font-mono text-[11px] truncate" title={s}>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Card>
  );
}

/** Support REJA / xotira tasdig'i faqat Telegram'da — web'da tasdiq tugmasi YO'Q */
export function TelegramOnlyNotice({ compact, className }: { compact?: boolean; className?: string }) {
  const t = useTranslations('adminAgentTeam.plans');
  if (compact) {
    return (
      <Pill tone="sky" icon={Lock} className={className} title={t('telegramOnlyDesc')}>{t('telegramOnly')}</Pill>
    );
  }
  return (
    <div className={cn('flex items-start gap-3 rounded-xl px-4 py-3 ring-1 bg-sky-50/70 dark:bg-sky-950/30 ring-sky-200 dark:ring-sky-900', className)}>
      <span className="relative w-9 h-9 rounded-xl grid place-items-center shrink-0 text-white shadow-md bg-gradient-to-br from-sky-500 to-cyan-600 shadow-sky-500/30">
        <Send className="h-4 w-4" />
        <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full grid place-items-center bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 ring-2 ring-white dark:ring-slate-900">
          <Lock className="h-2.5 w-2.5" />
        </span>
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-bold text-sky-800 dark:text-sky-200">{t('telegramOnly')}</div>
        <div className="text-[11.5px] text-sky-700/80 dark:text-sky-300/80 mt-0.5 leading-relaxed">{t('telegramOnlyDesc')}</div>
      </div>
    </div>
  );
}

// ===========================================================================
// Filtrlar va sahifalash
// ===========================================================================
export interface ChipOption<T extends string> { value: T; label: string; count?: number; tone?: Tone }

/** Segment chiplar (status/rol filtri). count bo'lsa badge ko'rsatiladi. */
export function ChipFilter<T extends string>({
  value, options, onChange, className,
}: { value: T; options: ChipOption<T>[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 ring-1 ring-slate-200 dark:ring-slate-700 overflow-x-auto max-w-full', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11.5px] font-semibold whitespace-nowrap transition-all',
              active
                ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200',
            )}
          >
            {o.tone && <StatusDot tone={o.tone} className="w-1.5 h-1.5" />}
            {o.label}
            {o.count !== undefined && (
              <span className={cn('min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold grid place-items-center tabular-nums',
                active ? 'bg-violet-100 dark:bg-violet-900/60 text-violet-700 dark:text-violet-300' : 'bg-slate-200/80 dark:bg-slate-700 text-slate-500 dark:text-slate-300')}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function SearchBox({
  value, onChange, placeholder, busy, className,
}: { value: string; onChange: (v: string) => void; placeholder?: string; busy?: boolean; className?: string }) {
  const t = useTranslations('adminAgentTeam.common');
  return (
    <div className={cn('relative min-w-[200px]', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || t('search')}
        className="w-full h-9 pl-9 pr-8 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[12.5px] text-slate-700 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-violet-400 transition"
      />
      {busy ? (
        <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />
      ) : value ? (
        <button type="button" onClick={() => onChange('')} title={t('resetFilters')} className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded text-slate-400 hover:text-slate-600">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** Oddiy select (agent/manba filtri) — mavjud sahifadagi select uslubi */
export function SelectBox<T extends string>({
  value, onChange, options, title, className,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; title?: string; className?: string }) {
  return (
    <select
      value={value}
      title={title}
      aria-label={title}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn('h-9 pl-3 pr-8 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 text-[12px] outline-none focus:ring-2 focus:ring-violet-400 cursor-pointer hover:ring-violet-300 transition', className)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Sana input (YYYY-MM-DD) */
export function DateBox({ value, onChange, title, className }: { value: string; onChange: (v: string) => void; title?: string; className?: string }) {
  return (
    <input
      type="date"
      value={value}
      title={title}
      aria-label={title}
      onChange={(e) => onChange(e.target.value)}
      className={cn('h-9 px-2.5 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 text-[12px] outline-none focus:ring-2 focus:ring-violet-400 transition', className)}
    />
  );
}

export function Pager({
  page, perPage, total, onPage, busy, className,
}: { page: number; perPage: number; total: number; onPage: (p: number) => void; busy?: boolean; className?: string }) {
  const t = useTranslations('adminAgentTeam.common');
  const pages = Math.max(1, Math.ceil(total / Math.max(1, perPage)));
  return (
    <div className={cn('flex items-center gap-3 px-5 py-3 border-t border-slate-100 dark:border-slate-800', className)}>
      <span className="text-[11.5px] text-slate-500 dark:text-slate-400 tabular-nums">{t('records', { n: total })}</span>
      <span className="text-[11.5px] text-slate-400 dark:text-slate-500 tabular-nums ml-auto">{t('pageOf', { page, pages })}</span>
      <div className="flex items-center gap-1.5">
        <IconButton icon={ChevronLeft} title={t('prev')} onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1 || busy} />
        <IconButton icon={ChevronRight} title={t('next')} onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages || busy} />
      </div>
    </div>
  );
}

// ===========================================================================
// Matn va kod
// ===========================================================================
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const t = useTranslations('adminAgentTeam.common');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(id);
  }, [done]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
    } catch {
      /* clipboard ruxsati yo'q — jim */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={done ? t('copied') : t('copy')}
      aria-label={t('copy')}
      className={cn('w-7 h-7 grid place-items-center rounded-md text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/40 transition-colors shrink-0', className)}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Monospace blok (preview, xato, JSON). Bo'sh bo'lsa placeholder. */
export function CodeBlock({
  children, tone = 'slate', className, maxHeight = 320, copyText,
}: { children: ReactNode; tone?: 'slate' | 'rose' | 'emerald'; className?: string; maxHeight?: number; copyText?: string }) {
  const cls = {
    slate: 'bg-slate-50 dark:bg-slate-900/70 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200',
    rose: 'bg-rose-50/70 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-900 text-rose-800 dark:text-rose-200',
    emerald: 'bg-emerald-50/70 dark:bg-emerald-950/30 ring-emerald-200 dark:ring-emerald-900 text-emerald-800 dark:text-emerald-200',
  }[tone];
  return (
    <div className={cn('relative rounded-lg ring-1', cls, className)}>
      {copyText !== undefined && copyText !== '' && <CopyButton text={copyText} className="absolute top-1 right-1" />}
      <pre className="px-3 py-2.5 pr-9 text-[11.5px] leading-relaxed font-mono whitespace-pre-wrap break-words overflow-auto" style={{ maxHeight }}>
        {children}
      </pre>
    </div>
  );
}

// ===========================================================================
// Vizualizatsiya
// ===========================================================================
/**
 * 7 kunlik ustunlar: pastda OK (emerald), ustida xato/timeout (rose), qolgani (bo'sh/bloklangan) slate.
 * Texnik mini grafik — dekoratsiya emas: har ustun title'da aniq sonlar.
 */
export function MiniBars({ points, height = 44, className, showLabels = true }: { points: DayPoint[]; height?: number; className?: string; showLabels?: boolean }) {
  const max = Math.max(1, ...points.map((p) => p.total));
  const today = tashkentToday();
  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-end gap-1" style={{ height }}>
        {points.map((p) => {
          const other = Math.max(0, p.total - p.ok - p.failed);
          const h = (n: number) => `${(n / max) * 100}%`;
          return (
            <div
              key={p.date}
              title={`${dayLabel(p.date)} · ${p.total} (OK ${p.ok}, ${p.failed} err)`}
              className={cn('flex-1 min-w-0 h-full flex flex-col-reverse rounded-[3px] overflow-hidden bg-slate-100/70 dark:bg-slate-800/50', p.date === today && 'ring-1 ring-violet-300 dark:ring-violet-700')}
            >
              {p.ok > 0 && <div className="w-full bg-emerald-500/85" style={{ height: h(p.ok) }} />}
              {other > 0 && <div className="w-full bg-slate-400/70" style={{ height: h(other) }} />}
              {p.failed > 0 && <div className="w-full bg-rose-500/85" style={{ height: h(p.failed) }} />}
            </div>
          );
        })}
      </div>
      {showLabels && (
        <div className="flex gap-1 mt-1">
          {points.map((p) => (
            <div key={p.date} className={cn('flex-1 text-center text-[9px] tabular-nums', p.date === today ? 'text-violet-600 dark:text-violet-400 font-bold' : 'text-slate-400 dark:text-slate-500')}>
              {dayLabel(p.date).slice(0, 2)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Davomiylik chizig'i: ms / chegara (timeout). 60% dan — amber, 90% dan — rose. */
export function DurationBar({ ms, maxMs, className }: { ms: number | null | undefined; maxMs: number; className?: string }) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || maxMs <= 0) return null;
  const r = ms / maxMs;
  const tone: Tone = r >= 0.9 ? 'rose' : r >= 0.6 ? 'amber' : 'emerald';
  return <ProgressBar value={r} tone={tone} className={cn('h-1 w-16', className)} />;
}

// ===========================================================================
// O'ng tomondan chiquvchi panel (batafsil ko'rish)
// ===========================================================================
export function Drawer({
  open, onClose, title, subtitle, icon: Icon, tone = 'violet', actions, footer, children, widthClass = 'sm:w-[600px]',
}: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; icon?: IconType; tone?: Tone;
  actions?: ReactNode; footer?: ReactNode; children: ReactNode; widthClass?: string;
}) {
  const t = useTranslations('adminAgentTeam.common');
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn('absolute inset-y-0 right-0 w-full flex flex-col bg-white dark:bg-slate-950 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-800 animate-in slide-in-from-right duration-200', widthClass)}>
        <div className="px-5 py-3.5 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          {Icon && (
            <span className={cn('w-9 h-9 rounded-xl grid place-items-center shrink-0 text-white shadow-md', TONE_ICON_TILE[tone])}>
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-slate-800 dark:text-slate-100 truncate">{title}</div>
            {subtitle && <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{subtitle}</div>}
          </div>
          {actions}
          <IconButton icon={X} title={t('close')} onClick={onClose} />
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-100 dark:border-slate-800 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ===========================================================================
// kv_store kaliti -> ma'no (i18n: health.kv.meanings.<id>)
// ===========================================================================
const KV_MEANING: Record<string, string> = {
  leader_heartbeat: 'heartbeat',
  agents_rate_limit_until: 'rateLimit',
  'checker:last_full_run': 'checkerLast',
  teacher_daily_last_run: 'teacherLast',
  cleanup_last: 'cleanupLast',
  sup_exec_active: 'execActive',
  sup_exec_lock: 'execLock',
  checker_lease: 'checkerLease',
  teacher_daily_lease: 'teacherLease',
  facts_lease: 'factsLease',
  leader_chat_history: 'history',
  'agent_enabled_*': 'agentEnabled',
  'sup_appr_*': 'supAppr',
  'sup_run_*': 'supRun',
  'sup_done_*': 'supDone',
  'tw_appr_*': 'twAppr',
  'tw_run_*': 'twRun',
  'facts_cache_*': 'factsCache',
};
export function kvMeaningId(key: string): string {
  return KV_MEANING[key] ?? 'other';
}
