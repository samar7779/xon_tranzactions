'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, RotateCcw, Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  addDays, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek,
  format, isSameDay, isSameMonth, isToday, isWithinInterval,
  parseISO, startOfDay, subDays, isValid,
} from 'date-fns';
import { uz, ru, enUS } from 'date-fns/locale';
import { cn } from '@/lib/utils';

/**
 * Premium date-range kalendar — brauzerning native date input'i o'rniga.
 * Range tanlash (from→to band), quick presetlar, oy almashish animatsiyasi,
 * today marker, dark mode. Sana formati: yyyy-MM-dd.
 */

const LOC: Record<string, typeof enUS> = { uz, ru, en: enUS };

const toStr = (d: Date) => format(d, 'yyyy-MM-dd');
const parse = (s?: string): Date | null => {
  if (!s) return null;
  const d = parseISO(s);
  return isValid(d) ? startOfDay(d) : null;
};
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function DateRangeCalendar({
  from, to, onChange, onApply, max,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  onApply?: () => void;
  max?: string;
}) {
  const locale = useLocale();
  const t = useTranslations('transactions');
  const tc = useTranslations('common');
  const dfLocale = LOC[locale] || enUS;

  const fromD = parse(from);
  const toD = parse(to);
  const maxD = parse(max);
  const today = startOfDay(new Date());

  const [view, setView] = useState<Date>(() => startOfMonth(toD || fromD || today));
  const [hover, setHover] = useState<Date | null>(null);
  const [dir, setDir] = useState(0);

  const gridStart = useMemo(() => startOfWeek(startOfMonth(view), { weekStartsOn: 1 }), [view]);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const weekdays = useMemo(() => {
    const ws = startOfWeek(today, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => format(addDays(ws, i), 'EEEEEE', { locale: dfLocale }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dfLocale]);

  // Preview: from tanlangan-u, to hali yo'q bo'lsa — hover bilan oralig'ini ko'rsatamiz
  const previewEnd = fromD && !toD && hover ? hover : toD;
  const [lo, hi]: [Date | null, Date | null] = fromD && previewEnd
    ? (fromD <= previewEnd ? [fromD, previewEnd] : [previewEnd, fromD])
    : [fromD, fromD];

  const inRange = (d: Date) => !!(lo && hi && isWithinInterval(d, { start: lo, end: hi }));
  const isLo = (d: Date) => !!(lo && isSameDay(d, lo));
  const isHi = (d: Date) => !!(hi && isSameDay(d, hi));
  const single = !!(lo && hi && isSameDay(lo, hi));

  const pick = (d: Date) => {
    if (maxD && d > maxD) return;
    if (!fromD || (fromD && toD)) {
      onChange(toStr(d), '');
      setHover(null);
    } else {
      if (d < fromD) onChange(toStr(d), toStr(fromD));
      else onChange(toStr(fromD), toStr(d));
    }
  };

  const nav = (delta: number) => { setDir(delta); setView((v) => (delta > 0 ? addMonths(v, 1) : subMonths(v, 1))); };

  const presets: { label: string; run: () => void }[] = [
    { label: t('calToday'), run: () => onChange(toStr(today), toStr(today)) },
    { label: t('calYesterday'), run: () => { const y = subDays(today, 1); onChange(toStr(y), toStr(y)); } },
    { label: t('cal7d'), run: () => onChange(toStr(subDays(today, 6)), toStr(today)) },
    { label: t('cal30d'), run: () => onChange(toStr(subDays(today, 29)), toStr(today)) },
    { label: t('calThisMonth'), run: () => onChange(toStr(startOfMonth(today)), toStr(endOfMonth(today) > today ? today : endOfMonth(today))) },
    { label: t('calLastMonth'), run: () => { const s = startOfMonth(subMonths(today, 1)); onChange(toStr(s), toStr(endOfMonth(s))); } },
  ];

  return (
    <div className="w-[560px] max-w-[92vw] flex overflow-hidden rounded-2xl bg-white dark:bg-slate-950 ring-1 ring-slate-200 dark:ring-slate-800 shadow-2xl">
      {/* ── Presetlar ── */}
      <div className="w-36 shrink-0 border-r border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-2.5 flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500 px-1.5 pt-1 pb-1.5">
          {t('calQuick')}
        </div>
        {presets.map((p, i) => (
          <button
            key={i}
            onClick={p.run}
            className="text-left text-[12.5px] font-medium px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-300 hover:shadow-sm ring-1 ring-transparent hover:ring-slate-200 dark:hover:ring-slate-700 transition-all"
          >
            {p.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => { onChange('', ''); setHover(null); }}
          className="inline-flex items-center gap-1.5 text-left text-[12px] font-semibold px-2.5 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" /> {tc('reset')}
        </button>
      </div>

      {/* ── Kalendar ── */}
      <div className="flex-1 p-3.5">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => nav(-1)}
            className="w-8 h-8 rounded-lg grid place-items-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
            aria-label="prev"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="relative h-7 flex-1 overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.div
                key={format(view, 'yyyy-MM')}
                custom={dir}
                initial={{ opacity: 0, x: dir > 0 ? 24 : -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir > 0 ? -24 : 24 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0 grid place-items-center text-[15px] font-bold text-slate-800 dark:text-slate-100 tracking-tight"
              >
                {cap(format(view, 'LLLL', { locale: dfLocale }))} {format(view, 'yyyy')}
              </motion.div>
            </AnimatePresence>
          </div>
          <button
            onClick={() => nav(1)}
            className="w-8 h-8 rounded-lg grid place-items-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
            aria-label="next"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 mb-1">
          {weekdays.map((w, i) => (
            <div key={i} className={cn(
              'text-center text-[11px] font-bold uppercase tracking-wide py-1',
              i >= 5 ? 'text-rose-400 dark:text-rose-500/70' : 'text-slate-400 dark:text-slate-500',
            )}>
              {w}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7" onMouseLeave={() => setHover(null)}>
          {days.map((d) => {
            const out = !isSameMonth(d, view);
            const loEnd = isLo(d);
            const hiEnd = isHi(d);
            const endpoint = loEnd || hiEnd;
            const mid = inRange(d) && !endpoint;
            const disabled = !!(maxD && d > maxD);
            const td = isToday(d);

            // Range band (endpoint yarim, mid to'liq)
            let band: string | null = null;
            if (!single && (endpoint || mid)) {
              if (mid) band = 'inset-x-0';
              else if (loEnd && !hiEnd) band = 'left-1/2 right-0';
              else if (hiEnd && !loEnd) band = 'left-0 right-1/2';
            }

            return (
              <div key={d.toISOString()} className="relative h-10 grid place-items-center">
                {band && (
                  <span className={cn('absolute inset-y-1 bg-indigo-100 dark:bg-indigo-500/15', band)} />
                )}
                <button
                  disabled={disabled}
                  onMouseEnter={() => setHover(d)}
                  onClick={() => pick(d)}
                  className={cn(
                    'relative z-10 w-9 h-9 rounded-full grid place-items-center text-[13px] font-semibold transition-all',
                    disabled && 'opacity-30 cursor-not-allowed',
                    out ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200',
                    !endpoint && !disabled && 'hover:bg-slate-100 dark:hover:bg-slate-800',
                    mid && 'text-indigo-700 dark:text-indigo-200 rounded-none',
                    endpoint && 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30 scale-105',
                    td && !endpoint && 'ring-1 ring-indigo-400/70 dark:ring-indigo-500/60',
                  )}
                >
                  {format(d, 'd')}
                  {td && !endpoint && (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-500" />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer — tanlangan oraliq + qo'llash */}
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 tabular-nums min-w-0 truncate">
            {fromD ? (
              <span className="text-slate-700 dark:text-slate-200">
                {format(fromD, 'dd.MM.yyyy')}
                {toD && !isSameDay(fromD, toD) && <span className="text-slate-400"> — {format(toD, 'dd.MM.yyyy')}</span>}
              </span>
            ) : (
              <span className="text-slate-400 dark:text-slate-500">{t('calPickRange')}</span>
            )}
          </div>
          {onApply && (
            <button
              onClick={onApply}
              disabled={!fromD}
              className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white text-[12.5px] font-semibold shadow-md shadow-indigo-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Check className="h-3.5 w-3.5" /> {t('apply')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
