'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, CalendarClock, RefreshCw, Loader2, CheckCircle2, AlertCircle, X, Database, BarChart3,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * "Plan bo'yicha to'lov" dashboard widgeti.
 * Obyekt kesimida: tushishi kerak (kutilgan) vs tushgan vs qolgan.
 * Tepada: Boshlang'ich / Oylik / Hammasi + sana + CRM sync (progress modal).
 * Chart (bar) + jadval. Manba: /schedule/by-object.
 */

type Row = { object: string; expected: number; received: number; remaining: number; count: number };
type ByObject = {
  ok: boolean; rows: Row[];
  total: { expected: number; received: number; remaining: number; count: number };
  lastSyncAt: string | null;
};
type SyncStatus = {
  running: boolean; startedAt: string | null; finishedAt: string | null;
  totalContracts: number; processed: number; upserted: number; errors: number;
  lastError: string | null; lastSyncAt: string | null;
};

const mask = (n: number) => Math.round(n).toLocaleString('ru-RU');
const fmtDt = (s: string | null) => {
  if (!s) return null;
  try { return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
};

export function SchedulePaymentsWidget() {
  const t = useTranslations('dashboard');
  const user = useAuth((s) => s.user);
  const has = (p: string) => !!user?.permissions?.includes(p);
  const qc = useQueryClient();

  const [open, setOpen] = useState(true);
  const [kind, setKind] = useState<'all' | 'initial' | 'monthly'>('all');
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'custom'>('today');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [syncModal, setSyncModal] = useState(false);

  const { from, to } = useMemo(() => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    if (range === 'custom') return { from: cFrom, to: cTo };
    if (range === 'today') return { from: fmt(today), to: fmt(today) };
    const back = range === '7d' ? 6 : 29;
    const f = new Date(today); f.setDate(f.getDate() - back);
    return { from: fmt(f), to: fmt(today) };
  }, [range, cFrom, cTo]);

  const { data, isLoading } = useQuery({
    queryKey: ['schedule-by-object', from, to, kind],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('from', from); p.set('to', to); p.set('kind', kind);
      return api.get<ByObject>(`/schedule/by-object?${p}`);
    },
    enabled: has(PERMS.SCHEDULE_VIEW) && (range !== 'custom' || (!!cFrom && !!cTo)),
  });

  const { data: sync } = useQuery({
    queryKey: ['schedule-sync-status'],
    queryFn: () => api.get<SyncStatus>('/schedule/sync-status'),
    enabled: has(PERMS.SCHEDULE_VIEW),
    refetchInterval: (q) => ((q.state.data as SyncStatus | undefined)?.running ? 2000 : false),
  });
  const running = !!sync?.running;

  const clickSync = async () => {
    setSyncModal(true);
    if (running) return; // allaqachon ishlayapti — modal ochamiz, qayta boshlamaymiz
    try {
      await api.post('/schedule/sync');
      qc.invalidateQueries({ queryKey: ['schedule-sync-status'] });
    } catch (e: any) {
      toast.error(e?.message || 'Xato');
    }
  };

  const rows = data?.rows || [];
  const total = data?.total || { expected: 0, received: 0, remaining: 0, count: 0 };
  const maxExpected = Math.max(1, ...rows.map((r) => r.expected));
  const pct = (r: Row) => (r.expected > 0 ? Math.min(100, (r.received / r.expected) * 100) : 0);
  const totalPct = total.expected > 0 ? Math.min(100, (total.received / total.expected) * 100) : 0;
  const lastSync = fmtDt(data?.lastSyncAt || sync?.lastSyncAt || null);
  const syncPct = sync && sync.totalContracts > 0 ? Math.min(100, (sync.processed / sync.totalContracts) * 100) : 0;

  if (!has(PERMS.SCHEDULE_VIEW)) return null;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 hover:opacity-75 transition-opacity">
          <ChevronDown className={cn('h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform', !open && '-rotate-90')} />
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 grid place-items-center text-white shadow-sm shadow-indigo-500/30">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div className="text-[12px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">{t('schedTitle')}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">· {from || '—'} → {to || '—'}</div>
          {running && (
            <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> {t('schedSyncing')}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="inline-flex rounded-md bg-slate-100 dark:bg-slate-800 p-0.5">
            {(['all', 'initial', 'monthly'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={cn('px-2.5 h-6 rounded text-[11px] font-semibold transition-colors',
                  kind === k ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200')}>
                {t(k === 'all' ? 'schedAll' : k === 'initial' ? 'schedInitial' : 'schedMonthly')}
              </button>
            ))}
          </div>
          <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Rng active={range === 'today'} onClick={() => setRange('today')}>{t('rangeToday')}</Rng>
          <Rng active={range === '7d'} onClick={() => setRange('7d')}>{t('range7d')}</Rng>
          <Rng active={range === '30d'} onClick={() => setRange('30d')}>{t('range30d')}</Rng>
          <Rng active={range === 'custom'} onClick={() => setRange('custom')}>{t('rangeCustom')}</Rng>
          {(has(PERMS.SCHEDULE_SYNC) || running) && (
            <button type="button" onClick={clickSync}
              title={t('schedSyncHint')}
              className={cn('inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-semibold transition-colors ml-0.5',
                running ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-500/30')}>
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {running ? t('schedSyncing') : t('schedSync')}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="p-3 space-y-3">
          {range === 'custom' && (
            <div className="flex items-center gap-2 text-[12px]">
              <input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" />
              <span className="text-slate-400">→</span>
              <input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" />
            </div>
          )}

          {/* Sync holati */}
          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
            {running ? (
              <button onClick={() => setSyncModal(true)} className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold hover:underline">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('schedProgress', { done: sync?.processed ?? 0, total: sync?.totalContracts ?? 0 })}
              </button>
            ) : lastSync ? (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" /> {t('schedLastSync')}: <span className="font-semibold text-slate-700 dark:text-slate-300">{lastSync}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3 w-3" /> {t('schedNever')}
              </span>
            )}
          </div>

          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label={t('schedExpected')} value={mask(total.expected)} tone="sky" />
            <Tile label={t('schedReceived')} value={mask(total.received)} tone="emerald" />
            <Tile label={t('schedRemaining')} value={mask(total.remaining)} tone="rose" />
            <Tile label="%" value={`${totalPct.toFixed(1)}%`} tone="indigo" />
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-[12px] text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-slate-400 dark:text-slate-500">
              {lastSync ? t('schedEmpty') : t('schedNeverHint')}
            </div>
          ) : (
            <>
              {/* ── CHART (bar) ── */}
              <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1">
                  <BarChart3 className="h-3.5 w-3.5" /> {t('schedChart')}
                </div>
                {rows.slice(0, 12).map((r) => (
                  <div key={r.object} className="flex items-center gap-2 text-[11px]">
                    <div className="w-24 sm:w-32 truncate text-slate-600 dark:text-slate-300 font-medium shrink-0" title={r.object}>{r.object}</div>
                    <div className="flex-1 min-w-0">
                      <div className="h-4 rounded bg-slate-100 dark:bg-slate-800 relative overflow-hidden ring-1 ring-slate-200/50 dark:ring-slate-700/50"
                        style={{ width: `${Math.max(6, (r.expected / maxExpected) * 100)}%` }}>
                        <div className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${pct(r)}%` }} />
                      </div>
                    </div>
                    <div className="w-32 shrink-0 text-right tabular-nums text-[10.5px]">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{mask(r.received)}</span>
                      <span className="text-slate-400"> / {mask(r.expected)}</span>
                    </div>
                  </div>
                ))}
                {rows.length > 12 && <div className="text-[10px] text-slate-400 text-center pt-1">+{rows.length - 12} obyekt (jadvalda)</div>}
              </div>

              {/* ── TABLE (aniq raqamlar) ── */}
              <div className="overflow-x-auto rounded ring-1 ring-slate-200 dark:ring-slate-700">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10.5px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2">{t('schedColObject')}</th>
                      <th className="text-right font-semibold px-3 py-2">{t('schedExpected')}</th>
                      <th className="text-right font-semibold px-3 py-2">{t('schedReceived')}</th>
                      <th className="text-right font-semibold px-3 py-2">{t('schedRemaining')}</th>
                      <th className="text-right font-semibold px-3 py-2">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map((r) => (
                      <tr key={r.object} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px]">{r.object}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-sky-700 dark:text-sky-400">{mask(r.expected)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{mask(r.received)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">{mask(r.remaining)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{pct(r).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold text-slate-900 dark:text-slate-100">
                    <tr>
                      <td className="px-3 py-2.5">{t('schedTotal')}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-sky-700 dark:text-sky-400">{mask(total.expected)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{mask(total.received)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-600 dark:text-rose-400">{mask(total.remaining)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[11px]">{totalPct.toFixed(1)}%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── SYNC PROGRESS MODAL (hamma ko'radi — fonda davom etadi) ── */}
      <AnimatePresence>
        {syncModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/70 backdrop-blur-sm p-4"
            onClick={() => setSyncModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.22 }}
              className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2.5">
                <div className={cn('w-9 h-9 rounded-xl grid place-items-center text-white shadow-sm',
                  running ? 'bg-gradient-to-br from-amber-500 to-orange-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600')}>
                  {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-slate-900 dark:text-slate-100">{t('schedTitle')} · Sync</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{running ? t('schedSyncing') : t('schedSyncDone')}</div>
                </div>
                <button onClick={() => setSyncModal(false)} className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 grid place-items-center text-slate-400"><X className="h-4 w-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                {/* Progress bar */}
                <div>
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    <span>{t('schedProgress', { done: sync?.processed ?? 0, total: sync?.totalContracts ?? 0 })}</span>
                    <span className="tabular-nums">{syncPct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <motion.div className={cn('h-full rounded-full', running ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-emerald-500 to-teal-500')}
                      animate={{ width: `${syncPct}%` }} transition={{ duration: 0.4 }} />
                  </div>
                </div>
                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 py-2">
                    <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">{t('schedColObject')}</div>
                    <div className="text-[15px] font-black tabular-nums text-slate-700 dark:text-slate-200">{sync?.processed ?? 0}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 py-2">
                    <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">{t('schedUpserted')}</div>
                    <div className="text-[15px] font-black tabular-nums text-emerald-600 dark:text-emerald-400">{sync?.upserted ?? 0}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 py-2">
                    <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">{t('schedErrors')}</div>
                    <div className={cn('text-[15px] font-black tabular-nums', (sync?.errors ?? 0) > 0 ? 'text-rose-500' : 'text-slate-400')}>{sync?.errors ?? 0}</div>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5">
                  <Database className="h-3.5 w-3.5 shrink-0 mt-0.5 text-indigo-500" />
                  <span>{t('schedSyncModalNote')}</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Rng({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('px-2.5 h-7 rounded-md text-[11px] font-semibold transition-colors',
        active ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700')}>
      {children}
    </button>
  );
}

const TONE: Record<string, string> = {
  sky: 'from-sky-500/10 to-sky-500/5 ring-sky-500/20 text-sky-700 dark:text-sky-300',
  emerald: 'from-emerald-500/10 to-emerald-500/5 ring-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  rose: 'from-rose-500/10 to-rose-500/5 ring-rose-500/20 text-rose-700 dark:text-rose-300',
  indigo: 'from-indigo-500/10 to-indigo-500/5 ring-indigo-500/20 text-indigo-700 dark:text-indigo-300',
};
function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={cn('rounded-lg bg-gradient-to-br ring-1 px-3 py-2', TONE[tone] || TONE.indigo)}>
      <div className="text-[9.5px] uppercase tracking-wider font-bold opacity-70">{label}</div>
      <div className="text-[15px] font-black tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
