'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  ChevronDown, CalendarCheck2, TrendingUp, TrendingDown, Loader2, Wallet, Coins, Repeat, Hash,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/**
 * "Kunlik xulosa" — bir qarashda: bugun (yoki tanlangan kun) qancha tushdi,
 * kecha bilan solishtirish, oy boshidan (o'tgan oy shu davri bilan), 14 kunlik
 * trend va top obyektlar. FAQAT ОплатыКв ma'lumotidan. Hisobot tayyorlashni
 * avtomatlashtiradi — qo'lda yig'ish shart emas.
 */

type Sum = { total: number; first: number; monthly: number; count: number };
type DailySummary = {
  ok: boolean; date: string;
  day: Sum; prevDay: Sum; mtd: Sum; prevMtd: Sum;
  series: { date: string; total: number }[];
  topObjects: { object: string; amount: number }[];
};

const mask = (n: number) => Math.round(n).toLocaleString('ru-RU');

function pctDelta(cur: number, prev: number): { text: string; up: boolean | null } {
  if (prev <= 0) return cur > 0 ? { text: 'new', up: true } : { text: '—', up: null };
  const p = ((cur - prev) / prev) * 100;
  return { text: `${p >= 0 ? '+' : ''}${p.toFixed(0)}%`, up: p >= 0 };
}

export function DailySummaryWidget() {
  const t = useTranslations('dashboard');
  const user = useAuth((s) => s.user);
  const has = (p: string) => !!user?.permissions?.includes(p);

  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<'today' | 'yesterday' | 'custom'>('today');
  const [customDate, setCustomDate] = useState('');

  const date = useMemo(() => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    if (mode === 'custom') return customDate;
    if (mode === 'yesterday') { const y = new Date(today); y.setDate(y.getDate() - 1); return fmt(y); }
    return fmt(today);
  }, [mode, customDate]);

  const { data, isLoading } = useQuery({
    queryKey: ['oplata-daily-summary', date],
    queryFn: () => api.get<DailySummary>(`/oplata-kv/daily-summary?date=${encodeURIComponent(date)}`),
    enabled: has(PERMS.DASHBOARD_OBJECTS) && !!date,
  });

  if (!has(PERMS.DASHBOARD_OBJECTS)) return null;

  const day = data?.day || { total: 0, first: 0, monthly: 0, count: 0 };
  const prevDay = data?.prevDay || { total: 0, first: 0, monthly: 0, count: 0 };
  const mtd = data?.mtd || { total: 0, first: 0, monthly: 0, count: 0 };
  const prevMtd = data?.prevMtd || { total: 0, first: 0, monthly: 0, count: 0 };
  const series = data?.series || [];
  const topObjects = data?.topObjects || [];
  const seriesMax = Math.max(1, ...series.map((s) => s.total));
  const topMax = Math.max(1, ...topObjects.map((o) => o.amount));

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 hover:opacity-75 transition-opacity">
          <ChevronDown className={cn('h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform', !open && '-rotate-90')} />
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow-sm shadow-emerald-500/30">
            <CalendarCheck2 className="h-4 w-4" />
          </div>
          <div className="text-[12px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">{t('dsumTitle')}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">· {date || '—'}</div>
        </button>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Rng active={mode === 'today'} onClick={() => setMode('today')}>{t('rangeToday')}</Rng>
          <Rng active={mode === 'yesterday'} onClick={() => setMode('yesterday')}>{t('dsumYesterday')}</Rng>
          <Rng active={mode === 'custom'} onClick={() => setMode('custom')}>{t('rangeCustom')}</Rng>
          {mode === 'custom' && (
            <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)}
              className="px-2 h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]" />
          )}
        </div>
      </div>

      {open && (
        <div className="p-3 space-y-3">
          {isLoading ? (
            <div className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>
          ) : (
            <>
              {/* KPI kartalar — kun + kecha bilan solishtirish */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <Kpi icon={Wallet} label={t('dsumTotal')} value={mask(day.total)} delta={pctDelta(day.total, prevDay.total)} tone="emerald" sub={t('dsumVsYesterday')} />
                <Kpi icon={Coins} label={t('dsumFirst')} value={mask(day.first)} delta={pctDelta(day.first, prevDay.first)} tone="amber" sub={t('dsumVsYesterday')} />
                <Kpi icon={Repeat} label={t('dsumMonthly')} value={mask(day.monthly)} delta={pctDelta(day.monthly, prevDay.monthly)} tone="sky" sub={t('dsumVsYesterday')} />
                <Kpi icon={Hash} label={t('dsumCount')} value={String(day.count)} delta={pctDelta(day.count, prevDay.count)} tone="violet" sub={t('dsumVsYesterday')} />
              </div>

              {/* Oy boshidan + trend + top obyekt */}
              <div className="grid lg:grid-cols-[1fr_1.2fr] gap-3">
                {/* MTD + trend */}
                <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">{t('dsumMtd')}</div>
                    <DeltaBadge d={pctDelta(mtd.total, prevMtd.total)} suffix={t('dsumVsMonth')} />
                  </div>
                  <div className="text-[20px] font-black tabular-nums text-slate-800 dark:text-slate-100">{mask(mtd.total)}</div>
                  {/* 14 kunlik trend */}
                  <div className="mt-3">
                    <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">{t('dsumTrend')}</div>
                    <div className="flex items-end gap-[3px] h-16">
                      {series.map((s, i) => {
                        const h = Math.max(3, (s.total / seriesMax) * 100);
                        const isLast = i === series.length - 1;
                        return (
                          <div key={s.date} className="flex-1 group relative flex items-end" title={`${s.date}: ${mask(s.total)}`}>
                            <div className={cn('w-full rounded-t transition-colors', isLast ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700 group-hover:bg-emerald-400')}
                              style={{ height: `${h}%` }} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[8.5px] text-slate-400 mt-1">
                      <span>{series[0]?.date?.slice(5)}</span>
                      <span>{series[series.length - 1]?.date?.slice(5)}</span>
                    </div>
                  </div>
                </div>

                {/* Top obyektlar */}
                <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-3">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-2">{t('dsumTopObjects')}</div>
                  {topObjects.length === 0 ? (
                    <div className="py-6 text-center text-[12px] text-slate-400">{t('dsumEmpty')}</div>
                  ) : (
                    <div className="space-y-1.5">
                      {topObjects.map((o) => (
                        <div key={o.object} className="flex items-center gap-2 text-[11.5px]">
                          <div className="w-24 sm:w-28 truncate text-slate-600 dark:text-slate-300 font-medium shrink-0" title={o.object}>{o.object}</div>
                          <div className="flex-1 min-w-0">
                            <div className="h-3.5 rounded bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${Math.max(6, (o.amount / topMax) * 100)}%` }} />
                          </div>
                          <div className="w-24 shrink-0 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{mask(o.amount)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Rng({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('px-2.5 h-7 rounded-md text-[11px] font-semibold transition-colors',
        active ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700')}>
      {children}
    </button>
  );
}

const KPI_TONE: Record<string, string> = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  sky: 'text-sky-600 dark:text-sky-400',
  violet: 'text-violet-600 dark:text-violet-400',
};
function Kpi({ icon: Icon, label, value, delta, tone, sub }: {
  icon: any; label: string; value: string; delta: { text: string; up: boolean | null }; tone: string; sub: string;
}) {
  return (
    <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-50/40 dark:bg-slate-800/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn('h-3.5 w-3.5', KPI_TONE[tone])} />
        <span className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400">{label}</span>
      </div>
      <div className={cn('text-[17px] font-black tabular-nums leading-tight', KPI_TONE[tone])}>{value}</div>
      <div className="mt-0.5"><DeltaBadge d={delta} suffix={sub} /></div>
    </div>
  );
}

function DeltaBadge({ d, suffix }: { d: { text: string; up: boolean | null }; suffix: string }) {
  if (d.up === null) return <span className="text-[9.5px] text-slate-400">— {suffix}</span>;
  const isNew = d.text === 'new';
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[9.5px] font-semibold',
      d.up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400')}>
      {d.up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {isNew ? '' : d.text}
      <span className="text-slate-400 font-normal ml-0.5">{suffix}</span>
    </span>
  );
}
