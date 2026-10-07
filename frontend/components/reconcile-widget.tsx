'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  ChevronDown, Loader2, Scale, ArrowUpRight, ArrowDownLeft, ExternalLink,
  BarChart3, Building2, FileText, ChevronLeft, Search,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/**
 * "Tranzaksiya sverka" — dashboard paneli (Kunlik xulosadan oldin, YOPIQ).
 * `dashboard:recon` ruxsatли xodimlargagina. 3 rejim:
 *   TAHLIL      — chiqim/kirim o'lcham bo'yicha (kategoriya/tashkilot/firma/shartnoma)
 *   KONTRAGENT  — Акт сверки (1C): boshlang'ich saldo + operatsiyalar + yakuniy saldo
 *   SHARTNOMA   — shartnoma to'lovlar statementi (ОплатыКв)
 */

const money = (n: number | string | null | undefined) =>
  Math.round(Number(n || 0)).toLocaleString('ru-RU');

type Row = { key: string; label: string; amount: number; count: number };
type Breakdown = { ok: boolean; total: number; totalCount: number; groupCount: number; items: Row[] };
type CpOp = { date: string; docNumber: string | null; inflow: number; outflow: number; running: number; description: string };
type CpSverka = { ok: boolean; name: string; opening: number; totalIn: number; totalOut: number; closing: number; count: number; operations: CpOp[] };
type ContractOp = { date: string; amount: number; kind: string; running: number };
type ContractSverka = { ok: boolean; contract: string; client: string | null; object: string | null; opening: number; totalPaid: number; closing: number; count: number; operations: ContractOp[] };

type Dim = 'category' | 'counterparty' | 'account' | 'contract';
type Mode = 'breakdown' | 'cp' | 'contract';
type RangeKey = 'today' | '7' | '30' | 'all';

function rangeDates(r: RangeKey): { from: string; to: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const to = fmt(today);
  if (r === 'all') return { from: '', to: '' };
  if (r === 'today') return { from: to, to };
  const from = new Date(today);
  from.setDate(from.getDate() - (r === '7' ? 6 : 29));
  return { from: fmt(from), to };
}

export function ReconcileWidget() {
  const t = useTranslations('dashboard');
  const user = useAuth((s) => s.user);
  const has = (p: string) => !!user?.permissions?.includes(p);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('breakdown');
  const [range, setRange] = useState<RangeKey>('30');
  const { from, to } = useMemo(() => rangeDates(range), [range]);

  // ── Tahlil ──
  const [dir, setDir] = useState<'OUT' | 'IN'>('OUT');
  const [dim, setDim] = useState<Dim>('category');
  const brQs = useMemo(() => {
    const p = new URLSearchParams({ direction: dir, dim, limit: '15' });
    if (from) p.set('from', from); if (to) p.set('to', to);
    return p.toString();
  }, [from, to, dir, dim]);
  const brQ = useQuery({
    queryKey: ['tx-breakdown', brQs],
    queryFn: () => api.get<Breakdown>(`/transactions/breakdown?${brQs}`),
    enabled: open && mode === 'breakdown' && has(PERMS.DASHBOARD_RECON),
  });

  // ── Kontragent sverka ──
  const [cpName, setCpName] = useState<string | null>(null);
  const cpListQs = useMemo(() => {
    const p = new URLSearchParams({ direction: 'OUT', dim: 'counterparty', limit: '20' });
    if (from) p.set('from', from); if (to) p.set('to', to);
    return p.toString();
  }, [from, to]);
  const cpListQ = useQuery({
    queryKey: ['cp-list', cpListQs],
    queryFn: () => api.get<Breakdown>(`/transactions/breakdown?${cpListQs}`),
    enabled: open && mode === 'cp' && !cpName && has(PERMS.DASHBOARD_RECON),
  });
  const cpSvQs = useMemo(() => {
    const p = new URLSearchParams({ name: cpName || '' });
    if (from) p.set('from', from); if (to) p.set('to', to);
    return p.toString();
  }, [cpName, from, to]);
  const cpSvQ = useQuery({
    queryKey: ['cp-sverka', cpSvQs],
    queryFn: () => api.get<CpSverka>(`/transactions/sverka/counterparty?${cpSvQs}`),
    enabled: open && mode === 'cp' && !!cpName && has(PERMS.DASHBOARD_RECON),
  });

  // ── Shartnoma sverka ──
  const [contractInput, setContractInput] = useState('');
  const [contract, setContract] = useState<string | null>(null);
  const ctSvQs = useMemo(() => {
    const p = new URLSearchParams({ contract: contract || '' });
    if (from) p.set('from', from); if (to) p.set('to', to);
    return p.toString();
  }, [contract, from, to]);
  const ctSvQ = useQuery({
    queryKey: ['contract-sverka', ctSvQs],
    queryFn: () => api.get<ContractSverka>(`/transactions/sverka/contract?${ctSvQs}`),
    enabled: open && mode === 'contract' && !!contract && has(PERMS.DASHBOARD_RECON),
  });

  if (!has(PERMS.DASHBOARD_RECON)) return null;

  const goTransactions = () => {
    try { const loc = window.location.pathname.split('/')[1] || 'uz'; window.location.href = `/${loc}/transactions`; } catch { /* ignore */ }
  };

  const modes: { key: Mode; label: string; icon: any }[] = [
    { key: 'breakdown', label: t('reconModeBreakdown'), icon: BarChart3 },
    { key: 'cp', label: t('reconModeCp'), icon: Building2 },
    { key: 'contract', label: t('reconModeContract'), icon: FileText },
  ];
  const dims: { key: Dim; label: string }[] = [
    { key: 'category', label: t('reconDimCategory') },
    { key: 'counterparty', label: t('reconDimCounterparty') },
    { key: 'account', label: t('reconDimAccount') },
    { key: 'contract', label: t('reconDimContract') },
  ];

  const br = brQ.data;
  const brItems = br?.items || [];
  const brMax = Math.max(1, ...brItems.map((i) => i.amount));

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
          <div className="flex items-center gap-1 flex-wrap">
            {modes.map((m) => (
              <button key={m.key} type="button" onClick={() => setMode(m.key)}
                className={cn('inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-semibold transition-colors',
                  mode === m.key ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700')}>
                <m.icon className="h-3.5 w-3.5" /> {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="p-3 space-y-3">
          {/* Davr — barcha rejimlar uchun umumiy */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[10px] text-slate-400 dark:text-slate-500">
              {mode === 'cp' ? t('reconCpHint') : mode === 'contract' ? t('reconContractHint') : t('reconSubtitle')}
            </div>
            <div className="flex items-center gap-1">
              <Rng active={range === 'today'} onClick={() => setRange('today')}>{t('rangeToday')}</Rng>
              <Rng active={range === '7'} onClick={() => setRange('7')}>{t('reconR7')}</Rng>
              <Rng active={range === '30'} onClick={() => setRange('30')}>{t('reconR30')}</Rng>
              <Rng active={range === 'all'} onClick={() => setRange('all')}>{t('reconRAll')}</Rng>
            </div>
          </div>

          {/* ═══════════ TAHLIL ═══════════ */}
          {mode === 'breakdown' && (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button type="button" onClick={() => setDir('OUT')} className={cn('inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-semibold', dir === 'OUT' ? 'bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300')}><ArrowUpRight className="h-3.5 w-3.5" /> {t('reconDirOut')}</button>
                <button type="button" onClick={() => setDir('IN')} className={cn('inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-semibold', dir === 'IN' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300')}><ArrowDownLeft className="h-3.5 w-3.5" /> {t('reconDirIn')}</button>
                <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                {dims.map((d) => (
                  <button key={d.key} type="button" onClick={() => setDim(d.key)} className={cn('px-2.5 h-7 rounded-md text-[11px] font-semibold', dim === d.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300')}>{d.label}</button>
                ))}
              </div>
              <div className={cn('rounded-lg px-3 py-2 flex items-center justify-between', dir === 'OUT' ? 'bg-rose-50/60 dark:bg-rose-950/20' : 'bg-emerald-50/60 dark:bg-emerald-950/20')}>
                <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400">{dir === 'OUT' ? t('reconDirOut') : t('reconDirIn')} · {t('reconTotal')}</div>
                <div className={cn('text-[18px] font-black tabular-nums', dir === 'OUT' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>{money(br?.total)} <span className="text-[10px] text-slate-400">UZS</span></div>
              </div>
              <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-2.5">
                {brQ.isLoading ? <Spin /> : brItems.length === 0 ? <Empty t={t} /> : (
                  <div className="space-y-1.5 max-h-72 overflow-auto">
                    {brItems.map((it) => (
                      <div key={it.key} className="flex items-center gap-2 text-[11.5px]">
                        <div className="w-28 sm:w-36 truncate text-slate-700 dark:text-slate-200 font-medium shrink-0" title={it.label}>{it.label}</div>
                        <div className="flex-1 min-w-0"><div className={cn('h-4 rounded', dir === 'OUT' ? 'bg-gradient-to-r from-rose-500 to-pink-500' : 'bg-gradient-to-r from-emerald-500 to-teal-500')} style={{ width: `${Math.max(4, (it.amount / brMax) * 100)}%` }} /></div>
                        <div className="w-24 shrink-0 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">{money(it.amount)}</div>
                        <div className="w-8 shrink-0 text-right text-[10px] text-slate-400 tabular-nums">{it.count}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ═══════════ KONTRAGENT SVERKA (Акт сверки) ═══════════ */}
          {mode === 'cp' && !cpName && (
            <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-2.5">
              <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-2">{t('reconCpSelect')}</div>
              {cpListQ.isLoading ? <Spin /> : (cpListQ.data?.items || []).length === 0 ? <Empty t={t} /> : (
                <div className="space-y-1 max-h-72 overflow-auto">
                  {(cpListQ.data?.items || []).map((it) => (
                    <button key={it.key} type="button" onClick={() => setCpName(it.label)}
                      className="w-full flex items-center gap-2 text-[11.5px] px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 text-left">
                      <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200 font-medium" title={it.label}>{it.label}</div>
                      <div className="shrink-0 tabular-nums font-semibold text-rose-600 dark:text-rose-400">{money(it.amount)}</div>
                      <ChevronLeft className="h-3.5 w-3.5 text-slate-300 rotate-180 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {mode === 'cp' && cpName && (
            <CpSverkaView t={t} name={cpName} data={cpSvQ.data} loading={cpSvQ.isLoading} onBack={() => setCpName(null)} />
          )}

          {/* ═══════════ SHARTNOMA SVERKA ═══════════ */}
          {mode === 'contract' && (
            <>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input value={contractInput} onChange={(e) => setContractInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && contractInput.trim()) setContract(contractInput.trim()); }}
                    placeholder={t('reconContractPh')}
                    className="w-full h-8 pl-7 pr-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11.5px]" />
                </div>
                <button type="button" onClick={() => contractInput.trim() && setContract(contractInput.trim())}
                  className="px-3 h-8 rounded-md text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700">{t('reconView')}</button>
              </div>
              {contract && <ContractSverkaView t={t} data={ctSvQ.data} loading={ctSvQ.isLoading} />}
            </>
          )}

          {/* Batafsil */}
          <div className="flex justify-end">
            <button type="button" onClick={goTransactions} className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-500/30">
              {t('reconViewAll')} <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CpSverkaView({ t, name, data, loading, onBack }: { t: any; name: string; data?: CpSverka; loading: boolean; onBack: () => void }) {
  const ops = data?.operations || [];
  return (
    <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:opacity-75"><ChevronLeft className="h-3.5 w-3.5" /> {t('reconBack')}</button>
        <div className="flex-1 min-w-0 truncate text-[12px] font-bold text-slate-800 dark:text-slate-100" title={name}>{name}</div>
      </div>
      {loading ? <Spin /> : (
        <>
          <div className="grid grid-cols-3 gap-px bg-slate-100 dark:bg-slate-800 text-center">
            <Cell label={t('reconSvOpening')} value={money(data?.opening)} />
            <Cell label={t('reconDirIn')} value={money(data?.totalIn)} tone="emerald" sub={`−${money(data?.totalOut)} ${t('reconDirOut').toLowerCase()}`} />
            <Cell label={t('reconSvClosing')} value={money(data?.closing)} tone={(data?.closing || 0) >= 0 ? 'emerald' : 'rose'} />
          </div>
          {ops.length === 0 ? <Empty t={t} /> : (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400">
                  <tr className="text-left">
                    <th className="px-2 py-1 font-semibold">{t('reconColDate')}</th>
                    <th className="px-2 py-1 font-semibold">{t('reconSvDoc')}</th>
                    <th className="px-2 py-1 font-semibold text-right">{t('reconDirOut')}</th>
                    <th className="px-2 py-1 font-semibold text-right">{t('reconDirIn')}</th>
                    <th className="px-2 py-1 font-semibold text-right">{t('reconSvSaldo')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {ops.map((o, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-2 py-1 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-300">{o.date}</td>
                      <td className="px-2 py-1 max-w-[120px] truncate text-slate-500 dark:text-slate-400" title={o.description || o.docNumber || ''}>{o.docNumber || '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-rose-500 dark:text-rose-400">{o.outflow ? money(o.outflow) : ''}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{o.inflow ? money(o.inflow) : ''}</td>
                      <td className={cn('px-2 py-1 text-right tabular-nums font-semibold', o.running >= 0 ? 'text-slate-700 dark:text-slate-200' : 'text-rose-500 dark:text-rose-400')}>{money(o.running)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ContractSverkaView({ t, data, loading }: { t: any; data?: ContractSverka; loading: boolean }) {
  const ops = data?.operations || [];
  if (loading) return <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-2.5"><Spin /></div>;
  if (!data || !data.ok) return <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 py-6 text-center text-[12px] text-slate-400">{t('reconEmpty')}</div>;
  return (
    <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
        <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100">{data.contract}</div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{[data.client, data.object].filter(Boolean).join(' · ') || '—'}</div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-slate-100 dark:bg-slate-800 text-center">
        <Cell label={t('reconSvOpening')} value={money(data.opening)} />
        <Cell label={t('reconSvPaid')} value={money(data.totalPaid)} tone="emerald" />
      </div>
      {ops.length === 0 ? <Empty t={t} /> : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400">
              <tr className="text-left">
                <th className="px-2 py-1 font-semibold">{t('reconColDate')}</th>
                <th className="px-2 py-1 font-semibold">{t('reconSvKind')}</th>
                <th className="px-2 py-1 font-semibold text-right">{t('reconColAmount')}</th>
                <th className="px-2 py-1 font-semibold text-right">{t('reconSvRunning')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ops.map((o, i) => (
                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-2 py-1 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-300">{o.date}</td>
                  <td className="px-2 py-1 text-slate-500 dark:text-slate-400">{o.kind}</td>
                  <td className={cn('px-2 py-1 text-right tabular-nums font-semibold', o.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400')}>{money(o.amount)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-700 dark:text-slate-200">{money(o.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, tone, sub }: { label: string; value: string; tone?: 'emerald' | 'rose'; sub?: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 px-2 py-2">
      <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">{label}</div>
      <div className={cn('text-[14px] font-black tabular-nums leading-tight', tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'rose' ? 'text-rose-500 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100')}>{value}</div>
      {sub && <div className="text-[9px] text-slate-400 tabular-nums">{sub}</div>}
    </div>
  );
}

function Spin() { return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>; }
function Empty({ t }: { t: any }) { return <div className="py-6 text-center text-[12px] text-slate-400">{t('reconEmpty')}</div>; }

function Rng({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('px-2.5 h-7 rounded-md text-[11px] font-semibold transition-colors',
        active ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700')}>
      {children}
    </button>
  );
}
