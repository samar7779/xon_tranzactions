'use client';

// Chek payment — bir yoki bir nechta shartnoma to'lovlarini TANLANGAN manbalardan
// (ОплатыКв / CRM / bir yoki bir necha Google Sheet) O'QIB solishtiradi.
// Read-only — hech narsa o'zgartirmaydi.
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Search, Loader2, Cloud, Database, Sheet as SheetIcon, FileSignature,
  AlertTriangle, CheckCircle2, ChevronDown, ShieldCheck, X, Plus,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

const money = (n: number | null | undefined) => (n == null ? '—' : formatMoney(Number(n || 0)).replace(' UZS', ''));
const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};
const normC = (s: string) => s.replace(/[\s\-_./№]/g, '').toUpperCase();

type SheetSrc = { id: string; name: string; source: string; hasPayColumns: boolean };
type OplataPart = { ok: boolean; initial: number; monthly: number; total: number; count: number; payments: { date: string | null; first: number; monthly: number; total: number }[] } | null;
type CrmPart = { ok: boolean; found: boolean; viaPaymentHistory?: boolean; price?: number | null; initial?: number; monthly?: number; total?: number; remaining?: number | null; count?: number; payments?: { date: string | null; amount: number; kind: string; type: string | null }[] } | null;
type SheetPart = { id: string; name: string; ok: boolean; available: boolean; reason?: string; initial: number; monthly: number; total: number; matchedRows: number; payments: { row: number; first: number; monthly: number; total: number }[] };
type ContractResult = { contract: string; oplata: OplataPart; crm: CrmPart; sheets: SheetPart[] };
type CheckResp = { ok: boolean; results: ContractResult[] };

type Col = { key: string; label: string; tone: 'violet' | 'sky' | 'emerald' };
type Submitted = { contracts: string[]; oplata: boolean; crm: boolean; sheetIds: string[] };

const toneText: Record<string, string> = {
  violet: 'text-violet-600 dark:text-violet-400',
  sky: 'text-sky-600 dark:text-sky-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
};

export function ChekPayment() {
  const tr = useTranslations('chekOrder');
  const [input, setInput] = useState('');
  const [qDeb, setQDeb] = useState('');
  const [contracts, setContracts] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [useOplata, setUseOplata] = useState(true);
  const [useCrm, setUseCrm] = useState(false);
  const [sheetSel, setSheetSel] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [showPayments, setShowPayments] = useState(false);

  useEffect(() => { const id = setTimeout(() => setQDeb(input), 300); return () => clearTimeout(id); }, [input]);

  const { data: sugg, isFetching: suggesting } = useQuery({
    queryKey: ['chekpay-suggest', qDeb],
    queryFn: () => api.get<{ items: any[] }>(`/chek-order/crm-suggest?q=${encodeURIComponent(qDeb)}`),
    enabled: qDeb.trim().length >= 2,
  });
  const { data: sheetsResp } = useQuery({
    queryKey: ['chekpay-sheets'],
    queryFn: () => api.get<{ sheets: SheetSrc[] }>(`/chek-order/payment-sheets`),
  });
  const sheets = sheetsResp?.sheets || [];

  const { data, isLoading, error } = useQuery<CheckResp>({
    queryKey: ['chekpay-check', submitted],
    queryFn: () => api.get(
      `/chek-order/payment-check?contracts=${encodeURIComponent(submitted!.contracts.join(','))}`
      + `&oplata=${submitted!.oplata ? 1 : 0}&crm=${submitted!.crm ? 1 : 0}`
      + (submitted!.sheetIds.length ? `&sheetIds=${encodeURIComponent(submitted!.sheetIds.join(','))}` : ''),
      { timeout: 90_000 },
    ),
    enabled: !!submitted && submitted.contracts.length > 0,
  });

  const addContract = (raw: string) => {
    const parts = raw.split(/[\s,;\n]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!parts.length) return;
    setContracts((prev) => {
      const seen = new Set(prev.map(normC));
      const next = [...prev];
      for (const p of parts) if (!seen.has(normC(p))) { next.push(p); seen.add(normC(p)); }
      return next.slice(0, 15);
    });
    setInput('');
  };
  const removeContract = (c: string) => setContracts((prev) => prev.filter((x) => x !== c));
  const toggleSheet = (id: string) => setSheetSel((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const anySource = useOplata || useCrm || sheetSel.length > 0;
  const canRun = contracts.length > 0 && anySource;

  const run = () => {
    if (!canRun) return;
    setSubmitted({ contracts: [...contracts], oplata: useOplata, crm: useCrm, sheetIds: [...sheetSel] });
    setShowPayments(false);
  };

  // Ustunlar (submitted asosida — natija shu tanlovga mos bo'lsin)
  const cols: Col[] = submitted ? [
    ...(submitted.oplata ? [{ key: 'oplata', label: tr('payment.srcOplata'), tone: 'violet' as const }] : []),
    ...(submitted.crm ? [{ key: 'crm', label: tr('payment.srcCrm'), tone: 'sky' as const }] : []),
    ...submitted.sheetIds.map((id) => ({ key: `sheet:${id}`, label: sheets.find((s) => s.id === id)?.name || tr('payment.srcSheet'), tone: 'emerald' as const })),
  ] : [];

  return (
    <div className="space-y-4">
      {/* ── Kirish paneli ── */}
      <Card className="border-0 shadow-soft overflow-visible">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" /> {tr('payment.readonly')}
          </div>

          {/* Manba tanlash */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5 block">{tr('payment.sources')}</label>
            <div className="flex flex-wrap items-center gap-2">
              <SrcToggle active={useOplata} onClick={() => setUseOplata((v) => !v)} tone="violet" icon={<Database className="h-3.5 w-3.5" />} label={tr('payment.srcOplata')} />
              <SrcToggle active={useCrm} onClick={() => setUseCrm((v) => !v)} tone="sky" icon={<Cloud className="h-3.5 w-3.5" />} label={tr('payment.srcCrm')} />
              {sheets.map((s) => (
                <SrcToggle
                  key={s.id}
                  active={sheetSel.includes(s.id)}
                  onClick={() => s.hasPayColumns && toggleSheet(s.id)}
                  disabled={!s.hasPayColumns}
                  tone="emerald"
                  icon={<SheetIcon className="h-3.5 w-3.5" />}
                  label={s.name + (s.hasPayColumns ? '' : ` (${tr('payment.sheetNoCols')})`)}
                />
              ))}
            </div>
          </div>

          {/* Shartnoma chip-input */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5 block">{tr('payment.contractsLabel')}</label>
            <div className="relative">
              <div className="flex flex-wrap items-center gap-1.5 min-h-[44px] px-2 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 focus-within:ring-2 focus-within:ring-indigo-400">
                {contracts.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200 text-[12px] font-mono font-bold">
                    {c}
                    <button onClick={() => removeContract(c)} className="hover:bg-indigo-200 dark:hover:bg-indigo-900 rounded p-0.5" title={tr('payment.remove')}><X className="h-3 w-3" /></button>
                  </span>
                ))}
                <div className="relative flex-1 min-w-[160px]">
                  <FileSignature className="absolute left-1.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setTimeout(() => setFocused(false), 150)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addContract(input); }
                      else if (e.key === 'Backspace' && !input && contracts.length) removeContract(contracts[contracts.length - 1]);
                    }}
                    placeholder={contracts.length ? '' : tr('payment.addContractHint')}
                    className="w-full h-8 pl-7 pr-2 bg-transparent outline-none text-[13px] font-mono font-semibold text-slate-800 dark:text-slate-100"
                  />
                  {suggesting && <Loader2 className="absolute right-1 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-indigo-400" />}
                </div>
              </div>
              {focused && (sugg?.items?.length ?? 0) > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-xl">
                  {sugg!.items.map((it: any, i: number) => (
                    <button
                      key={i}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addContract(it.contract)}
                      className="w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors border-b border-slate-100 dark:border-slate-800 last:border-0 flex items-center gap-2"
                    >
                      <Plus className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                      <span className="min-w-0">
                        <span className="text-[13px] font-mono font-bold text-slate-800 dark:text-slate-100">{it.contract}</span>
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {it.clientFullName || '—'}{it.object ? ` · ${it.object}` : ''}{it.apartmentNumber ? ` · №${it.apartmentNumber}` : ''}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-slate-400 dark:text-slate-500">
              {!canRun && tr('payment.selectHint')}
            </div>
            <button
              onClick={run}
              disabled={!canRun || isLoading}
              className="h-10 px-5 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-[13px] font-semibold shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all inline-flex items-center gap-2"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {tr('payment.check')}
            </button>
          </div>
        </div>
      </Card>

      {/* ── Natija ── */}
      {isLoading && <Card className="border-0 shadow-soft"><div className="p-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" /></div></Card>}
      {error && !isLoading && <Card className="border-0 shadow-soft"><div className="p-6 text-center text-[13px] text-rose-600 dark:text-rose-400">{(error as any)?.message || 'Xato'}</div></Card>}

      {data && !isLoading && (
        <>
          <div className="flex items-center justify-end">
            <button onClick={() => setShowPayments((s) => !s)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400">
              {tr('payment.paymentsList')} <ChevronDown className={cn('h-4 w-4 transition-transform', showPayments && 'rotate-180')} />
            </button>
          </div>
          {data.results.map((res) => (
            <ContractCard key={res.contract} res={res} cols={cols} tr={tr} showPayments={showPayments} />
          ))}
        </>
      )}
    </div>
  );
}

function SrcToggle({ active, onClick, tone, icon, label, disabled }: {
  active: boolean; onClick: () => void; tone: 'violet' | 'sky' | 'emerald'; icon: React.ReactNode; label: string; disabled?: boolean;
}) {
  const activeCls: Record<string, string> = {
    violet: 'bg-violet-600 text-white ring-transparent shadow-sm shadow-violet-500/25',
    sky: 'bg-sky-600 text-white ring-transparent shadow-sm shadow-sky-500/25',
    emerald: 'bg-emerald-600 text-white ring-transparent shadow-sm shadow-emerald-500/25',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-[12.5px] font-semibold ring-1 transition-all',
        disabled ? 'opacity-40 cursor-not-allowed bg-slate-50 dark:bg-slate-800 ring-slate-200 dark:ring-slate-700 text-slate-400'
          : active ? activeCls[tone]
            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600',
      )}
    >
      {active && !disabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : icon} {label}
    </button>
  );
}

function ContractCard({ res, cols, tr, showPayments }: { res: ContractResult; cols: Col[]; tr: any; showPayments: boolean }) {
  const val = (colKey: string, metric: 'initial' | 'monthly' | 'total'): number | null => {
    if (colKey === 'oplata') return res.oplata ? (res.oplata as any)[metric] : null;
    if (colKey === 'crm') return res.crm?.found ? (res.crm as any)[metric] : null;
    if (colKey.startsWith('sheet:')) {
      const s = res.sheets?.find((x) => x.id === colKey.slice(6));
      return s?.available ? (s as any)[metric] : null;
    }
    return null;
  };
  const same = (metric: 'initial' | 'monthly' | 'total') => {
    const vals = cols.map((c) => val(c.key, metric)).filter((v) => v != null) as number[];
    return vals.length < 2 || vals.every((v) => Math.abs(v - vals[0]) < 1);
  };
  const hasCrmCol = cols.some((c) => c.key === 'crm');

  const metricRow = (label: string, metric: 'initial' | 'monthly' | 'total', strong?: boolean) => {
    const ok = same(metric);
    return (
      <tr className={cn(!ok && 'bg-amber-50/50 dark:bg-amber-950/20')}>
        <td className={cn('px-4 py-2.5', strong ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400')}>{label}</td>
        {cols.map((c) => {
          const v = val(c.key, metric);
          return <td key={c.key} className={cn('px-4 py-2.5 text-right tabular-nums', strong ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200')}>{v == null ? '—' : money(v)}</td>;
        })}
        <td className="px-3 py-2.5 text-center">{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500 inline" /> : <AlertTriangle className="h-4 w-4 text-amber-500 inline" />}</td>
      </tr>
    );
  };

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 via-violet-50/60 to-fuchsia-50 dark:from-indigo-950/40 dark:via-violet-950/30 dark:to-fuchsia-950/40 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 flex-wrap">
        <code className="text-[14px] font-mono font-bold text-slate-900 dark:text-slate-100">{res.contract}</code>
        {hasCrmCol && res.crm?.found && res.crm.price != null && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/70 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 font-semibold">
            {tr('payment.price')}: <b className="tabular-nums">{money(res.crm.price)}</b>
          </span>
        )}
        {hasCrmCol && res.crm?.viaPaymentHistory && (
          <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-semibold">payment-history</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
              <th className="text-left font-bold px-4 py-2.5"> </th>
              {cols.map((c) => (
                <th key={c.key} className="text-right font-bold px-4 py-2.5"><span className={cn('inline-flex items-center gap-1', toneText[c.tone])}>{c.label}</span></th>
              ))}
              <th className="px-3 py-2.5"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
            {metricRow(tr('payment.initial'), 'initial')}
            {metricRow(tr('payment.monthly'), 'monthly')}
            {metricRow(tr('payment.total'), 'total', true)}
            {hasCrmCol && (
              <tr>
                <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{tr('payment.remaining')}</td>
                {cols.map((c) => (
                  <td key={c.key} className={cn('px-4 py-2.5 text-right tabular-nums', c.key === 'crm' ? ((res.crm?.remaining ?? 0) > 0 ? 'font-bold text-amber-600 dark:text-amber-400' : 'font-bold text-emerald-600 dark:text-emerald-400') : 'text-slate-300 dark:text-slate-600')}>
                    {c.key === 'crm' && res.crm?.found ? money(res.crm.remaining) : '—'}
                  </td>
                ))}
                <td className="px-3 py-2.5"> </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Manba holati eslatmalari */}
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-3 text-[11px] border-t border-slate-100 dark:border-slate-800">
        {res.oplata && <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400"><Database className="h-3 w-3" /> {tr('payment.rows', { n: res.oplata.count ?? 0 })}</span>}
        {cols.some((c) => c.key === 'crm') && (res.crm?.found
          ? <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400"><Cloud className="h-3 w-3" /> {tr('payment.rows', { n: res.crm.count ?? 0 })}</span>
          : <span className="inline-flex items-center gap-1 text-rose-500"><AlertTriangle className="h-3 w-3" /> {tr('payment.crmNotFound')}</span>)}
        {res.sheets?.map((s) => (
          s.available
            ? <span key={s.id} className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><SheetIcon className="h-3 w-3" /> {s.name}: {tr('payment.rows', { n: s.matchedRows })}</span>
            : <span key={s.id} className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> {s.name}: {s.reason || tr('payment.sheetNa')}</span>
        ))}
      </div>

      {/* To'lovlar ro'yxati */}
      {showPayments && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 p-4 pt-0 border-t border-slate-100 dark:border-slate-800">
          {res.oplata && <PayList title={tr('payment.srcOplata')} tone="violet" items={res.oplata.payments.map((p) => ({ date: p.date, amount: p.total, tag: p.first ? tr('payment.initialShort') : p.monthly ? tr('payment.monthlyShort') : null }))} />}
          {cols.some((c) => c.key === 'crm') && <PayList title={tr('payment.srcCrm')} tone="sky" items={res.crm?.found ? (res.crm.payments || []).map((p) => ({ date: p.date, amount: p.amount, tag: p.kind === 'initial' ? tr('payment.initialShort') : tr('payment.monthlyShort') })) : []} empty={!res.crm?.found ? tr('payment.crmNotFound') : undefined} />}
          {res.sheets?.map((s) => <PayList key={s.id} title={s.name} tone="emerald" items={s.available ? s.payments.map((p) => ({ date: null, amount: p.total, tag: `#${p.row}` })) : []} empty={!s.available ? (s.reason || tr('payment.sheetNa')) : undefined} />)}
        </div>
      )}
    </Card>
  );
}

function PayList({ title, tone, items, empty }: {
  title: string; tone: 'violet' | 'sky' | 'emerald'; items: { date: string | null; amount: number; tag?: string | null }[]; empty?: string;
}) {
  return (
    <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
      <div className={cn('px-3 py-2 text-[12px] font-bold bg-slate-50/70 dark:bg-slate-800/50', toneText[tone])}>{title} · {items.length}</div>
      <div className="max-h-64 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800/60">
        {items.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11.5px] text-slate-400 dark:text-slate-500">{empty || '—'}</div>
        ) : items.map((p, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2">
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums w-[74px] shrink-0">{fmtDate(p.date)}</span>
            {p.tag && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0">{p.tag}</span>}
            <span className="ml-auto text-[12.5px] font-bold tabular-nums text-slate-700 dark:text-slate-200">{money(p.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
