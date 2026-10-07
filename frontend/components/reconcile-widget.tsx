'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import {
  ChevronDown, Scale, Loader2, RefreshCcw, CheckCircle2, AlertTriangle, XCircle,
  ArrowDownLeft, ArrowUpRight, Search, ExternalLink, ListChecks, Landmark, Hash,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/**
 * "Tranzaksiya sverka" — dashboard paneli (Kunlik xulosadan oldin, YOPIQ).
 * `dashboard:recon` ruxsati bo'lgan xodimlargagina ko'rinadi.
 * 2 bo'lim:
 *   SVERKA — bank qoldiq solishtirish (GET /transactions/reconcile/today):
 *            jami hisob / mos / nomos / xato + nomos hisoblar ro'yxati (farq bilan) → /check
 *   TRANZAKSIYALAR — barcha tranzaksiya explorer (filtr + KPI + ixcham jadval) → /transactions
 */

const money = (n: number | string | null | undefined) =>
  Math.round(Number(n || 0)).toLocaleString('ru-RU');

type ReconSummary = { total: number; ok: number; mismatch: number; error: number };
type ReconItem = {
  status: string; accountNo: string; ownerName?: string; bankName?: string; bankCode?: string;
  diff?: { credit?: number; debit?: number; formula?: number; formulaReliable?: boolean };
};
type ReconToday = { ok: boolean; date: string; summary: ReconSummary; items: ReconItem[] };
type TxStats = { ok: boolean; total: number; groups: { direction: string; _sum: { amount: string | number }; _count: number }[] };
type TxRow = {
  id: string; txnDate: string; amount: string | number; direction: 'IN' | 'OUT';
  bank?: { name: string; code: string } | null;
  counterpartyDisplay?: string | null; fromName?: string | null; toName?: string | null;
  contractStatus?: 'verified' | 'unverified' | 'manual' | null; docNumber?: string | null;
};
type TxList = { ok: boolean; total: number; items: TxRow[] };
type Bank = { id: string; name: string; code: string };

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
  const locale = useLocale();
  const user = useAuth((s) => s.user);
  const has = (p: string) => !!user?.permissions?.includes(p);

  const [open, setOpen] = useState(false); // default YOPIQ — ruxsatли bosganda ochiladi
  const [tab, setTab] = useState<'sverka' | 'tx'>('sverka');

  // ── SVERKA ──
  const sverkaQ = useQuery({
    queryKey: ['recon-today-widget'],
    queryFn: () => api.get<ReconToday>('/transactions/reconcile/today'),
    enabled: open && tab === 'sverka' && has(PERMS.DASHBOARD_RECON),
    staleTime: 60_000,
  });
  const sum: ReconSummary = sverkaQ.data?.summary || { total: 0, ok: 0, mismatch: 0, error: 0 };
  const badItems = (sverkaQ.data?.items || []).filter((i) => i.status !== 'ok');
  const okPct = sum.total > 0 ? Math.round((sum.ok / sum.total) * 100) : 0;

  // ── TRANZAKSIYALAR ──
  const [range, setRange] = useState<RangeKey>('30');
  const [bankId, setBankId] = useState('');
  const [dir, setDir] = useState<'' | 'IN' | 'OUT'>('');
  const [q, setQ] = useState('');
  const { from, to } = useMemo(() => rangeDates(range), [range]);
  const txEnabled = open && tab === 'tx' && has(PERMS.DASHBOARD_RECON);

  const banksQ = useQuery({
    queryKey: ['recon-banks'],
    queryFn: () => api.get<Bank[]>('/banks'),
    enabled: txEnabled,
    staleTime: 10 * 60_000,
  });
  const qs = useMemo(() => {
    const p = new URLSearchParams({ from, to });
    if (bankId) p.set('bankId', bankId);
    if (dir) p.set('direction', dir);
    return p.toString();
  }, [from, to, bankId, dir]);
  const statsQ = useQuery({
    queryKey: ['recon-tx-stats', qs],
    queryFn: () => api.get<TxStats>(`/transactions/stats?${qs}`),
    enabled: txEnabled,
  });
  const listQs = useMemo(() => {
    const p = new URLSearchParams({ dateFrom: from, dateTo: to, perPage: '25', page: '1' });
    if (bankId) p.set('bankId', bankId);
    if (dir) p.set('direction', dir);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [from, to, bankId, dir, q]);
  const listQ = useQuery({
    queryKey: ['recon-tx-list', listQs],
    queryFn: () => api.get<TxList>(`/transactions?${listQs}`),
    enabled: txEnabled,
  });

  const inflow = Number(statsQ.data?.groups?.find((g) => g.direction === 'IN')?._sum?.amount || 0);
  const outflow = Number(statsQ.data?.groups?.find((g) => g.direction === 'OUT')?._sum?.amount || 0);
  const txTotal = statsQ.data?.total || 0;

  if (!has(PERMS.DASHBOARD_RECON)) return null;

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
          {open && (
            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">· {t('reconSubtitle')}</div>
          )}
        </button>
        {open && (
          <div className="flex items-center gap-1.5">
            <TabBtn active={tab === 'sverka'} onClick={() => setTab('sverka')} icon={Scale}>{t('reconTabSverka')}</TabBtn>
            <TabBtn active={tab === 'tx'} onClick={() => setTab('tx')} icon={ListChecks}>{t('reconTabTx')}</TabBtn>
          </div>
        )}
      </div>

      {open && (
        <div className="p-3 space-y-3">
          {/* ═══════════════ SVERKA ═══════════════ */}
          {tab === 'sverka' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] text-slate-400 dark:text-slate-500">{t('reconSverkaHint')}</div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => sverkaQ.refetch()} disabled={sverkaQ.isFetching}
                    className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50">
                    <RefreshCcw className={cn('h-3 w-3', sverkaQ.isFetching && 'animate-spin')} /> {t('reconRefresh')}
                  </button>
                  <Link href={`/${locale}/check`}
                    className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-500/30">
                    {t('reconDetail')} <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>

              {sverkaQ.isLoading ? (
                <div className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <SvStat icon={Landmark} label={t('reconKpiAccounts')} value={String(sum.total)} tone="slate" />
                    <SvStat icon={CheckCircle2} label={t('reconKpiOk')} value={`${sum.ok}`} extra={`${okPct}%`} tone="emerald" />
                    <SvStat icon={AlertTriangle} label={t('reconKpiMismatch')} value={String(sum.mismatch)} tone="amber" />
                    <SvStat icon={XCircle} label={t('reconKpiError')} value={String(sum.error)} tone="rose" />
                  </div>

                  <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
                    <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[10px] uppercase tracking-wider font-bold text-slate-400">
                      {t('reconMismatchList')}
                    </div>
                    {badItems.length === 0 ? (
                      <div className="py-6 text-center text-[12px] text-emerald-600 dark:text-emerald-400 font-semibold inline-flex items-center justify-center gap-1.5 w-full">
                        <CheckCircle2 className="h-4 w-4" /> {t('reconAllOk')}
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-auto divide-y divide-slate-100 dark:divide-slate-800">
                        {badItems.map((it, idx) => (
                          <div key={`${it.accountNo}-${idx}`} className={cn('flex items-center gap-2 px-3 py-2 text-[11.5px]',
                            it.status === 'error' ? 'bg-rose-50/40 dark:bg-rose-950/20' : 'bg-amber-50/40 dark:bg-amber-950/20')}>
                            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', it.status === 'error' ? 'bg-rose-500' : 'bg-amber-500')} />
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">{it.ownerName || it.accountNo}</div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{it.bankName || it.bankCode} · {it.accountNo}</div>
                            </div>
                            <div className="text-right shrink-0 space-y-0.5">
                              {!!it.diff?.credit && <DiffPill label={t('reconDiffCredit')} v={it.diff.credit} />}
                              {!!it.diff?.debit && <DiffPill label={t('reconDiffDebit')} v={it.diff.debit} />}
                              {!it.diff?.credit && !it.diff?.debit && !!it.diff?.formula && <DiffPill label={t('reconDiffFormula')} v={it.diff.formula} />}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ═══════════════ TRANZAKSIYALAR ═══════════════ */}
          {tab === 'tx' && (
            <>
              {/* Filtrlar */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="flex items-center gap-1">
                  <Rng active={range === 'today'} onClick={() => setRange('today')}>{t('rangeToday')}</Rng>
                  <Rng active={range === '7'} onClick={() => setRange('7')}>{t('reconR7')}</Rng>
                  <Rng active={range === '30'} onClick={() => setRange('30')}>{t('reconR30')}</Rng>
                </div>
                <select value={bankId} onChange={(e) => setBankId(e.target.value)}
                  className="h-7 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] text-slate-700 dark:text-slate-200">
                  <option value="">{t('reconAllBanks')}</option>
                  {(banksQ.data || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <select value={dir} onChange={(e) => setDir(e.target.value as any)}
                  className="h-7 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] text-slate-700 dark:text-slate-200">
                  <option value="">{t('reconDirAll')}</option>
                  <option value="IN">{t('reconDirIn')}</option>
                  <option value="OUT">{t('reconDirOut')}</option>
                </select>
                <div className="relative flex-1 min-w-[140px]">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('reconSearch')}
                    className="w-full h-7 pl-7 pr-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]" />
                </div>
                <Link href={`/${locale}/transactions`}
                  className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-500/30 shrink-0">
                  {t('reconViewAll')} <ExternalLink className="h-3 w-3" />
                </Link>
              </div>

              {/* KPI */}
              <div className="grid grid-cols-3 gap-2">
                <SvStat icon={Hash} label={t('reconTxCount')} value={money(txTotal)} tone="slate" loading={statsQ.isLoading} />
                <SvStat icon={ArrowDownLeft} label={t('reconInflow')} value={money(inflow)} tone="emerald" loading={statsQ.isLoading} />
                <SvStat icon={ArrowUpRight} label={t('reconOutflow')} value={money(outflow)} tone="rose" loading={statsQ.isLoading} />
              </div>

              {/* Jadval */}
              <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                {listQ.isLoading ? (
                  <div className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>
                ) : (listQ.data?.items || []).length === 0 ? (
                  <div className="py-8 text-center text-[12px] text-slate-400">{t('reconEmpty')}</div>
                ) : (
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-[11.5px]">
                      <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/80 backdrop-blur text-slate-500 dark:text-slate-400">
                        <tr className="text-left">
                          <th className="px-2.5 py-1.5 font-semibold">{t('reconColDate')}</th>
                          <th className="px-2.5 py-1.5 font-semibold">{t('reconColBank')}</th>
                          <th className="px-2.5 py-1.5 font-semibold">{t('reconColParty')}</th>
                          <th className="px-2.5 py-1.5 font-semibold text-right">{t('reconColAmount')}</th>
                          <th className="px-2.5 py-1.5 font-semibold">{t('reconColStatus')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {(listQ.data?.items || []).map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="px-2.5 py-1.5 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-300">{String(r.txnDate).slice(0, 10)}</td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap text-slate-600 dark:text-slate-300">{r.bank?.name || r.bank?.code || '—'}</td>
                            <td className="px-2.5 py-1.5 max-w-[180px] truncate text-slate-800 dark:text-slate-100" title={r.counterpartyDisplay || r.fromName || r.toName || ''}>
                              {r.counterpartyDisplay || (r.direction === 'IN' ? r.fromName : r.toName) || '—'}
                            </td>
                            <td className={cn('px-2.5 py-1.5 whitespace-nowrap text-right tabular-nums font-semibold',
                              r.direction === 'IN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400')}>
                              {r.direction === 'IN' ? '+' : '−'}{money(r.amount)}
                            </td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap"><StatusBadge s={r.contractStatus} t={t} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: any; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-semibold transition-colors',
        active ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700')}>
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
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

const SV_TONE: Record<string, string> = {
  slate: 'text-slate-600 dark:text-slate-300',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  rose: 'text-rose-500 dark:text-rose-400',
};
function SvStat({ icon: Icon, label, value, extra, tone, loading }: {
  icon: any; label: string; value: string; extra?: string; tone: string; loading?: boolean;
}) {
  return (
    <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-50/40 dark:bg-slate-800/30 px-3 py-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className={cn('h-3.5 w-3.5', SV_TONE[tone])} />
        <span className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400">{label}</span>
      </div>
      {loading ? (
        <div className="h-5 w-12 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span className={cn('text-[17px] font-black tabular-nums leading-tight', SV_TONE[tone])}>{value}</span>
          {extra && <span className="text-[10px] font-semibold text-slate-400">{extra}</span>}
        </div>
      )}
    </div>
  );
}

function DiffPill({ label, v }: { label: string; v: number }) {
  return (
    <div className="inline-flex items-center gap-1 text-[10px] tabular-nums">
      <span className="text-slate-400">{label}</span>
      <span className="font-bold text-rose-600 dark:text-rose-400">{money(Math.abs(v))}</span>
    </div>
  );
}

function StatusBadge({ s, t }: { s?: string | null; t: (k: string) => string }) {
  if (s === 'verified') return <span className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-900">{t('reconStVerified')}</span>;
  if (s === 'manual') return <span className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 ring-1 ring-sky-200 dark:ring-sky-900">{t('reconStManual')}</span>;
  if (s === 'unverified') return <span className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-900">{t('reconStUnverified')}</span>;
  return <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>;
}
