'use client';

// Chek payment — bitta shartnoma to'lovlarini ОплатыКв / CRM / Google Sheet
// manbalaridan O'QIB solishtiradi (read-only, hech narsa o'zgartirmaydi).
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Search, Loader2, Cloud, Database, Sheet as SheetIcon, FileSignature,
  AlertTriangle, CheckCircle2, ChevronDown, ShieldCheck,
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

type SheetSrc = { id: string; name: string; source: string; hasPayColumns: boolean };
type OplataPart = { ok: boolean; initial: number; monthly: number; total: number; count: number; payments: { date: string | null; first: number; monthly: number; total: number }[] };
type CrmPart = { ok: boolean; found: boolean; price?: number | null; initialPlan?: number | null; monthlyPlan?: number | null; initial?: number; monthly?: number; total?: number; remaining?: number | null; count?: number; payments?: { date: string | null; amount: number; kind: string; type: string | null }[]; error?: string };
type SheetPart = { ok: boolean; available: boolean; reason?: string; sheetName?: string; initial: number; monthly: number; total: number; matchedRows: number; payments: { row: number; first: number; monthly: number; total: number }[] } | null;
type CheckResp = { ok: boolean; contract: string; oplata: OplataPart; crm: CrmPart; sheet: SheetPart };

export function ChekPayment() {
  const tr = useTranslations('chekOrder');
  const [q, setQ] = useState('');
  const [qDeb, setQDeb] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [sheetId, setSheetId] = useState('');
  const [checkContract, setCheckContract] = useState<string | null>(null);
  const [showPayments, setShowPayments] = useState(false);

  useEffect(() => { const id = setTimeout(() => setQDeb(q), 300); return () => clearTimeout(id); }, [q]);

  const { data: sugg, isFetching: suggesting } = useQuery({
    queryKey: ['chekpay-suggest', qDeb],
    queryFn: () => api.get<{ items: any[] }>(`/chek-order/crm-suggest?q=${encodeURIComponent(qDeb)}`),
    enabled: qDeb.trim().length >= 2 && !selected,
  });
  const { data: sheetsResp } = useQuery({
    queryKey: ['chekpay-sheets'],
    queryFn: () => api.get<{ sheets: SheetSrc[] }>(`/chek-order/payment-sheets`),
  });
  const sheets = sheetsResp?.sheets || [];

  const { data, isLoading, error } = useQuery<CheckResp>({
    queryKey: ['chekpay-check', checkContract, sheetId],
    queryFn: () => api.get(`/chek-order/payment-check?contract=${encodeURIComponent(checkContract || '')}${sheetId ? `&sheetId=${encodeURIComponent(sheetId)}` : ''}`, { timeout: 60_000 }),
    enabled: !!checkContract,
  });

  const run = () => { const c = (selected || q).trim(); if (c) { setCheckContract(c.toUpperCase()); setShowPayments(false); } };
  const pick = (contract: string) => { setSelected(contract); setQ(contract); setFocused(false); };

  const oplata = data?.oplata;
  const crm = data?.crm;
  const sheet = data?.sheet;
  const sheetOn = !!sheetId;

  // Bir qator (boshlang'ich/oylik/jami) uchun manbalarni solishtirish
  const cmp = (o?: number | null, c?: number | null, s?: number | null) => {
    const vals = [o, c, sheetOn ? s : undefined].filter((v) => v != null) as number[];
    const same = vals.length < 2 || vals.every((v) => Math.abs(v - vals[0]) < 1);
    return same;
  };

  return (
    <div className="space-y-4">
      {/* ── Kirish paneli ── */}
      <Card className="border-0 shadow-soft overflow-visible">
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" /> {tr('payment.readonly')}
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,260px)_auto] items-end">
            {/* Shartnoma input + autocomplete */}
            <div className="relative">
              <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1 block">{tr('payment.contractLabel')}</label>
              <div className="relative">
                <FileSignature className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setSelected(null); }}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setTimeout(() => setFocused(false), 150)}
                  onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
                  placeholder={tr('payment.contractPlaceholder')}
                  className="w-full h-11 pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-indigo-400 text-[14px] font-mono font-semibold text-slate-800 dark:text-slate-100"
                />
                {suggesting && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-indigo-400" />}
              </div>
              {focused && !selected && (sugg?.items?.length ?? 0) > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-xl">
                  {sugg!.items.map((it: any, i: number) => (
                    <button
                      key={i}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(it.contract)}
                      className="w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors border-b border-slate-100 dark:border-slate-800 last:border-0"
                    >
                      <div className="text-[13px] font-mono font-bold text-slate-800 dark:text-slate-100">{it.contract}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {it.clientFullName || '—'}{it.object ? ` · ${it.object}` : ''}{it.apartmentNumber ? ` · №${it.apartmentNumber}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Sheet manba dropdown */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1 block">{tr('payment.sheetLabel')}</label>
              <div className="relative">
                <SheetIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500 pointer-events-none" />
                <select
                  value={sheetId}
                  onChange={(e) => setSheetId(e.target.value)}
                  className="w-full h-11 pl-9 pr-8 rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-indigo-400 text-[13px] text-slate-800 dark:text-slate-100 appearance-none"
                >
                  <option value="">{tr('payment.sheetNone')}</option>
                  {sheets.map((s) => (
                    <option key={s.id} value={s.id} disabled={!s.hasPayColumns}>
                      {s.name}{!s.hasPayColumns ? ` (${tr('payment.sheetNoCols')})` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            <button
              onClick={run}
              disabled={!(selected || q).trim() || isLoading}
              className="h-11 px-5 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-[13px] font-semibold shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all inline-flex items-center gap-2"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {tr('payment.check')}
            </button>
          </div>
        </div>
      </Card>

      {/* ── Natija ── */}
      {isLoading && (
        <Card className="border-0 shadow-soft"><div className="p-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" /></div></Card>
      )}

      {error && !isLoading && (
        <Card className="border-0 shadow-soft"><div className="p-6 text-center text-[13px] text-rose-600 dark:text-rose-400">{(error as any)?.message || 'Xato'}</div></Card>
      )}

      {data && !isLoading && (
        <>
          {/* Solishtirish jadvali */}
          <Card className="border-0 shadow-soft overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 via-violet-50/60 to-fuchsia-50 dark:from-indigo-950/40 dark:via-violet-950/30 dark:to-fuchsia-950/40 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <code className="text-[14px] font-mono font-bold text-slate-900 dark:text-slate-100">{data.contract}</code>
                {crm?.found && crm.price != null && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/70 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 font-semibold">
                    {tr('payment.price')}: <b className="tabular-nums">{money(crm.price)}</b>
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
                    <th className="text-left font-bold px-4 py-2.5"> </th>
                    <th className="text-right font-bold px-4 py-2.5"><span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400"><Database className="h-3.5 w-3.5" /> {tr('payment.srcOplata')}</span></th>
                    <th className="text-right font-bold px-4 py-2.5"><span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400"><Cloud className="h-3.5 w-3.5" /> {tr('payment.srcCrm')}</span></th>
                    {sheetOn && <th className="text-right font-bold px-4 py-2.5"><span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><SheetIcon className="h-3.5 w-3.5" /> {sheet?.sheetName || tr('payment.srcSheet')}</span></th>}
                    <th className="text-center font-bold px-3 py-2.5"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                  <CmpRow
                    label={tr('payment.initial')}
                    o={oplata?.initial} c={crm?.found ? crm.initial : null} s={sheet?.available ? sheet.initial : null}
                    sheetOn={sheetOn} same={cmp(oplata?.initial, crm?.found ? crm.initial : null, sheet?.available ? sheet.initial : null)}
                  />
                  <CmpRow
                    label={tr('payment.monthly')}
                    o={oplata?.monthly} c={crm?.found ? crm.monthly : null} s={sheet?.available ? sheet.monthly : null}
                    sheetOn={sheetOn} same={cmp(oplata?.monthly, crm?.found ? crm.monthly : null, sheet?.available ? sheet.monthly : null)}
                  />
                  <CmpRow
                    label={tr('payment.total')} strong
                    o={oplata?.total} c={crm?.found ? crm.total : null} s={sheet?.available ? sheet.total : null}
                    sheetOn={sheetOn} same={cmp(oplata?.total, crm?.found ? crm.total : null, sheet?.available ? sheet.total : null)}
                  />
                  {/* Qoldiq — faqat CRM'da (narx bor) */}
                  <tr>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{tr('payment.remaining')}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300 dark:text-slate-600">—</td>
                    <td className={cn('px-4 py-2.5 text-right font-bold tabular-nums', (crm?.remaining ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                      {crm?.found ? money(crm.remaining) : '—'}
                    </td>
                    {sheetOn && <td className="px-4 py-2.5 text-right text-slate-300 dark:text-slate-600">—</td>}
                    <td className="px-3 py-2.5"> </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Manba holati eslatmalari */}
            <div className="px-4 py-2.5 flex flex-wrap items-center gap-3 text-[11px] border-t border-slate-100 dark:border-slate-800">
              <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400"><Database className="h-3 w-3" /> {tr('payment.rows', { n: oplata?.count ?? 0 })}</span>
              {!crm?.found && <span className="inline-flex items-center gap-1 text-rose-500"><AlertTriangle className="h-3 w-3" /> {tr('payment.crmNotFound')}</span>}
              {crm?.found && <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400"><Cloud className="h-3 w-3" /> {tr('payment.rows', { n: crm.count ?? 0 })}</span>}
              {sheetOn && sheet && !sheet.available && <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> {sheet.reason || tr('payment.sheetNa')}</span>}
              {sheetOn && sheet?.available && <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><SheetIcon className="h-3 w-3" /> {tr('payment.rows', { n: sheet.matchedRows })}</span>}
            </div>
          </Card>

          {/* To'lovlar ro'yxati (yig'iladigan) */}
          <Card className="border-0 shadow-soft overflow-hidden">
            <button onClick={() => setShowPayments((s) => !s)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{tr('payment.paymentsList')}</span>
              <ChevronDown className={cn('ml-auto h-4 w-4 text-slate-400 transition-transform', showPayments && 'rotate-180')} />
            </button>
            {showPayments && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 p-4 pt-0">
                <PayList title={tr('payment.srcOplata')} tone="violet" items={(oplata?.payments || []).map((p) => ({ date: p.date, amount: p.total, tag: p.first ? tr('payment.initialShort') : p.monthly ? tr('payment.monthlyShort') : null }))} />
                <PayList title={tr('payment.srcCrm')} tone="sky" items={crm?.found ? (crm.payments || []).map((p) => ({ date: p.date, amount: p.amount, tag: p.kind === 'initial' ? tr('payment.initialShort') : tr('payment.monthlyShort') })) : []} empty={!crm?.found ? tr('payment.crmNotFound') : undefined} />
                {sheetOn && <PayList title={sheet?.sheetName || tr('payment.srcSheet')} tone="emerald" items={sheet?.available ? (sheet.payments || []).map((p) => ({ date: null, amount: p.total, tag: `#${p.row}` })) : []} empty={!sheet?.available ? (sheet?.reason || tr('payment.sheetNa')) : undefined} />}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function CmpRow({ label, o, c, s, sheetOn, same, strong }: {
  label: string; o?: number | null; c?: number | null; s?: number | null; sheetOn: boolean; same: boolean; strong?: boolean;
}) {
  const cell = 'px-4 py-2.5 text-right tabular-nums';
  return (
    <tr className={cn(!same && 'bg-amber-50/50 dark:bg-amber-950/20')}>
      <td className={cn('px-4 py-2.5', strong ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400')}>{label}</td>
      <td className={cn(cell, strong ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200')}>{money(o)}</td>
      <td className={cn(cell, strong ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200')}>{c == null ? '—' : money(c)}</td>
      {sheetOn && <td className={cn(cell, strong ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200')}>{s == null ? '—' : money(s)}</td>}
      <td className="px-3 py-2.5 text-center">
        {same
          ? <CheckCircle2 className="h-4 w-4 text-emerald-500 inline" />
          : <AlertTriangle className="h-4 w-4 text-amber-500 inline" />}
      </td>
    </tr>
  );
}

function PayList({ title, tone, items, empty }: {
  title: string; tone: 'violet' | 'sky' | 'emerald'; items: { date: string | null; amount: number; tag?: string | null }[]; empty?: string;
}) {
  const head = { violet: 'text-violet-700 dark:text-violet-300', sky: 'text-sky-700 dark:text-sky-300', emerald: 'text-emerald-700 dark:text-emerald-300' }[tone];
  return (
    <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
      <div className={cn('px-3 py-2 text-[12px] font-bold bg-slate-50/70 dark:bg-slate-800/50', head)}>{title} · {items.length}</div>
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
