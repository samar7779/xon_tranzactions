'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronDown, Loader2, Scale, ArrowUpRight, ArrowDownLeft, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/**
 * "To'lov tahlili" — dashboard paneli (Kunlik xulosadan oldin, YOPIQ).
 * `dashboard:recon` ruxsatли xodimlargagina ko'rinadi.
 * Chiqim (yoki kirim) to'lovlarini tanlangan o'lcham bo'yicha guruhlab ko'rsatadi:
 *   - Kategoriya (ish haqi, soliq, ...)  - Tashkilot (kimga/kimdan)
 *   - Firma (bizning hisob)              - Shartnoma
 * Manba: GET /transactions/breakdown.
 */

const money = (n: number | string | null | undefined) =>
  Math.round(Number(n || 0)).toLocaleString('ru-RU');

type Row = { key: string; label: string; amount: number; count: number };
type Breakdown = {
  ok: boolean; dim: string; direction: string;
  total: number; totalCount: number; groupCount: number; items: Row[];
};
type Dim = 'category' | 'counterparty' | 'account' | 'contract';
type RangeKey = 'today' | '7' | '30';

function rangeDates(r: RangeKey): { from: string; to: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const to = fmt(today);
  if (r === 'today') return { from: to, to };
  const from = new Date(today);
  from.setDate(from.getDate() - (r === '7' ? 6 : 29));
  return { from: fmt(from), to };
}

export function ReconcileWidget() {
  const t = useTranslations('dashboard');
  const user = useAuth((s) => s.user);
  const has = (p: string) => !!user?.permissions?.includes(p);

  const [open, setOpen] = useState(false); // default YOPIQ
  const [dir, setDir] = useState<'OUT' | 'IN'>('OUT');
  const [dim, setDim] = useState<Dim>('category');
  const [range, setRange] = useState<RangeKey>('30');

  const { from, to } = useMemo(() => rangeDates(range), [range]);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ from, to, direction: dir, dim, limit: '15' });
    return p.toString();
  }, [from, to, dir, dim]);

  const bQ = useQuery({
    queryKey: ['tx-breakdown', qs],
    queryFn: () => api.get<Breakdown>(`/transactions/breakdown?${qs}`),
    enabled: open && has(PERMS.DASHBOARD_RECON),
  });

  if (!has(PERMS.DASHBOARD_RECON)) return null;

  const data = bQ.data;
  const items = data?.items || [];
  const total = data?.total || 0;
  const totalCount = data?.totalCount || 0;
  const groupCount = data?.groupCount || 0;
  const maxAmt = Math.max(1, ...items.map((i) => i.amount));

  const goTransactions = () => {
    try {
      const loc = window.location.pathname.split('/')[1] || 'uz';
      window.location.href = `/${loc}/transactions`;
    } catch { /* ignore */ }
  };

  const dims: { key: Dim; label: string }[] = [
    { key: 'category', label: t('reconDimCategory') },
    { key: 'counterparty', label: t('reconDimCounterparty') },
    { key: 'account', label: t('reconDimAccount') },
    { key: 'contract', label: t('reconDimContract') },
  ];

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 hover:opacity-75 transition-opacity">
          <ChevronDown className={cn('h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform', !open && '-rotate-90')} />
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 grid place-items-center text-white shadow-sm shadow-indigo-500/30">
            <Scale className="h-4 w-4" />
          </div>
          <div className="text-[12px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">{t('reconTitle')}</div>
          {open && <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">· {t('reconSubtitle')}</div>}
        </button>
        {open && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setDir('OUT')}
              className={cn('inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-semibold transition-colors',
                dir === 'OUT' ? 'bg-rose-600 text-white shadow-sm shadow-rose-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700')}>
              <ArrowUpRight className="h-3.5 w-3.5" /> {t('reconDirOut')}
            </button>
            <button type="button" onClick={() => setDir('IN')}
              className={cn('inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-semibold transition-colors',
                dir === 'IN' ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700')}>
              <ArrowDownLeft className="h-3.5 w-3.5" /> {t('reconDirIn')}
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="p-3 space-y-3">
          {/* O'lcham tablari + sana */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              {dims.map((d) => (
                <button key={d.key} type="button" onClick={() => setDim(d.key)}
                  className={cn('px-2.5 h-7 rounded-md text-[11px] font-semibold transition-colors',
                    dim === d.key ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700')}>
                  {d.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Rng active={range === 'today'} onClick={() => setRange('today')}>{t('rangeToday')}</Rng>
              <Rng active={range === '7'} onClick={() => setRange('7')}>{t('reconR7')}</Rng>
              <Rng active={range === '30'} onClick={() => setRange('30')}>{t('reconR30')}</Rng>
            </div>
          </div>

          {/* Jami */}
          <div className={cn('rounded-lg px-3 py-2.5 flex items-center justify-between',
            dir === 'OUT' ? 'bg-rose-50/60 dark:bg-rose-950/20 ring-1 ring-rose-100 dark:ring-rose-900/50' : 'bg-emerald-50/60 dark:bg-emerald-950/20 ring-1 ring-emerald-100 dark:ring-emerald-900/50')}>
            <div>
              <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400">{dir === 'OUT' ? t('reconDirOut') : t('reconDirIn')} · {t('reconTotal')}</div>
              <div className={cn('text-[20px] font-black tabular-nums leading-tight', dir === 'OUT' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
                {money(total)} <span className="text-[11px] font-semibold text-slate-400">UZS</span>
              </div>
            </div>
            <div className="text-right text-[10px] text-slate-500 dark:text-slate-400">
              <div>{money(totalCount)} {t('reconTxCount').toLowerCase()}</div>
              <div>{groupCount} {t('reconGroups')}</div>
            </div>
          </div>

          {/* Breakdown ro'yxati */}
          <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-2.5">
            {bQ.isLoading ? (
              <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>
            ) : items.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-slate-400">{t('reconEmpty')}</div>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-auto">
                {items.map((it) => {
                  const pct = total > 0 ? Math.round((it.amount / total) * 100) : 0;
                  return (
                    <div key={it.key} className="flex items-center gap-2 text-[11.5px]">
                      <div className="w-28 sm:w-36 truncate text-slate-700 dark:text-slate-200 font-medium shrink-0" title={it.label}>{it.label}</div>
                      <div className="flex-1 min-w-0 relative">
                        <div className={cn('h-4 rounded', dir === 'OUT' ? 'bg-gradient-to-r from-rose-500 to-pink-500' : 'bg-gradient-to-r from-emerald-500 to-teal-500')}
                          style={{ width: `${Math.max(4, (it.amount / maxAmt) * 100)}%` }} />
                      </div>
                      <div className="w-10 shrink-0 text-right text-[10px] text-slate-400 tabular-nums">{pct}%</div>
                      <div className="w-24 shrink-0 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">{money(it.amount)}</div>
                      <div className="w-10 shrink-0 text-right text-[10px] text-slate-400 tabular-nums">{it.count}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Batafsil */}
          <div className="flex justify-end">
            <button type="button" onClick={goTransactions}
              className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-500/30">
              {t('reconViewAll')} <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
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
