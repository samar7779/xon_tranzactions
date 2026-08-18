'use client';
// build: sverka-crm drilldown v1 — shartnoma bo'yicha to'lovma-to'lov juftlash

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, CheckCircle2, AlertTriangle, Cloud, Database,
  CalendarClock, Coins, Copy, Check, ArrowRightLeft,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';
import type { CrmSverkaRow } from './page';

interface CrmPayDto {
  amount: number;
  date: string | null;
  method: string | null;
  type: string | null;
  category: string | null;
  status: string | null;
  externalId: string | null;
  problematic: boolean;
}

interface OurPayDto {
  id: string;
  amount: number;
  date: string | null;
  method: string | null;
  type: string | null;
  purpose: string | null;
}

interface Pair {
  kind: 'exact' | 'date-shift' | 'amount-diff';
  crm: CrmPayDto;
  our: OurPayDto;
  diff: number;
  dayGap: number;
}

interface DetailResponse {
  ok: boolean;
  ready: boolean;
  error?: string;
  contractNo: string;
  client: string | null;
  object: string | null;
  totals: { crmTotal: number; ourTotal: number; diff: number; crmCount: number; ourCount: number };
  pairs: {
    matched: Pair[];
    dateShift: Pair[];
    amountDiff: Pair[];
    onlyCrm: CrmPayDto[];
    onlyOur: OurPayDto[];
  };
  counts: {
    matched: number; dateShift: number; amountDiff: number;
    onlyCrm: number; onlyOur: number; onlyCrmSum: number; onlyOurSum: number;
  };
}

const money = (n: number) => formatMoney(Number(n || 0)).replace(' UZS', '');

export function CrmContractDrilldown({
  row, filterQuery, onClose,
}: {
  row: CrmSverkaRow;
  filterQuery: string;
  onClose: () => void;
}) {
  const t = useTranslations('checkCrm');
  const tc = useTranslations('common');
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showMatched, setShowMatched] = useState(false);

  useEffect(() => setMounted(true), []);

  // ESC bilan yopish + fon scroll'ini to'xtatish
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Filtr (usul/sana) drill-down'da ham saqlanadi — ro'yxatdagi summa bilan mos bo'lsin
  const params = new URLSearchParams(filterQuery);
  params.delete('page');
  params.delete('perPage');
  params.delete('sort');
  params.delete('q');
  params.set('contractNo', row.contractNo);

  const { data, isLoading, error } = useQuery<DetailResponse>({
    queryKey: ['crm-sverka-contract', row.contractNo, params.toString()],
    queryFn: () => api.get(`/crm-sverka/contract?${params.toString()}`, { timeout: 60_000 }),
    retry: false,
  });

  function copyContract() {
    navigator.clipboard.writeText(row.contractNo).then(() => {
      setCopied(true);
      toast.success(t('ddCopied'));
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (!mounted) return null;

  const c = data?.counts;
  const hasDiff = !!c && (c.onlyCrm > 0 || c.onlyOur > 0 || c.amountDiff > 0);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/50 backdrop-blur-sm">
      <div
        className="w-full max-w-4xl my-4 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ═══ HEADER ═══ */}
        <div className="px-5 py-4 bg-gradient-to-r from-sky-50 via-cyan-50/60 to-teal-50 dark:from-sky-950/40 dark:via-cyan-950/30 dark:to-teal-950/40 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-[14px] font-mono font-bold text-slate-900 dark:text-slate-100">
                  {row.contractNo}
                </code>
                <button
                  onClick={copyContract}
                  title={t('ddCopy')}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-sky-600 hover:bg-white/70 dark:hover:bg-slate-800 transition-colors"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="text-[12px] text-slate-600 dark:text-slate-300 mt-0.5 truncate">
                {data?.client || row.client || '—'}
                {(data?.object || row.object) && (
                  <span className="text-slate-400 dark:text-slate-500"> · {data?.object || row.object}</span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-white/70 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Jami summalar */}
          <div className="grid grid-cols-3 gap-2 mt-3">
            <TotalBox
              icon={<Cloud className="h-3 w-3" />}
              label="CRM"
              value={data?.totals.crmTotal ?? row.crmTotal}
              sub={t('payments', { n: data?.totals.crmCount ?? row.crmCount })}
              tone="sky"
            />
            <TotalBox
              icon={<Database className="h-3 w-3" />}
              label={t('colOur')}
              value={data?.totals.ourTotal ?? row.ourTotal}
              sub={t('payments', { n: data?.totals.ourCount ?? row.ourCount })}
              tone="violet"
            />
            <TotalBox
              icon={<ArrowRightLeft className="h-3 w-3" />}
              label={t('colDiff')}
              value={data?.totals.diff ?? row.diff}
              sub={t('diffHint')}
              tone={Math.abs(data?.totals.diff ?? row.diff) < 0.01 ? 'emerald' : 'amber'}
              signed
            />
          </div>
        </div>

        {/* ═══ BODY ═══ */}
        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {isLoading ? (
            <div className="py-12 text-center space-y-2">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-sky-500" />
              <div className="text-[12px] text-slate-500 dark:text-slate-400">{t('ddLoading')}</div>
            </div>
          ) : error || (data && !data.ok) ? (
            <div className="py-10 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300 text-[12px] font-semibold">
                <X className="h-3.5 w-3.5" />
                {(data as any)?.error || (error as any)?.message || tc('error')}
              </div>
            </div>
          ) : data ? (
            <>
              {!hasDiff && (
                <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-200 dark:ring-emerald-900 text-[12px] font-semibold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" /> {t('ddNoDiff')}
                </div>
              )}

              {/* ── FAQAT CRM'DA ── */}
              {data.pairs.onlyCrm.length > 0 && (
                <Section
                  title={t('ddOnlyCrm')}
                  hint={t('ddOnlyCrmHint')}
                  count={data.counts.onlyCrm}
                  sum={data.counts.onlyCrmSum}
                  tone="rose"
                  icon={<Cloud className="h-3.5 w-3.5" />}
                >
                  <div className="divide-y divide-rose-100/70 dark:divide-rose-950">
                    {data.pairs.onlyCrm.map((p, i) => (
                      <SinglePayRow key={`oc-${i}`} date={p.date} amount={p.amount} tags={[p.method, p.type, p.status]} tone="rose" />
                    ))}
                  </div>
                </Section>
              )}

              {/* ── FAQAT BIZDA ── */}
              {data.pairs.onlyOur.length > 0 && (
                <Section
                  title={t('ddOnlyOur')}
                  hint={t('ddOnlyOurHint')}
                  count={data.counts.onlyOur}
                  sum={data.counts.onlyOurSum}
                  tone="violet"
                  icon={<Database className="h-3.5 w-3.5" />}
                >
                  <div className="divide-y divide-violet-100/70 dark:divide-violet-950">
                    {data.pairs.onlyOur.map((p, i) => (
                      <SinglePayRow key={`oo-${i}`} date={p.date} amount={p.amount} tags={[p.method, p.type]} note={p.purpose} tone="violet" />
                    ))}
                  </div>
                </Section>
              )}

              {/* ── SUMMA FARQI ── */}
              {data.pairs.amountDiff.length > 0 && (
                <Section
                  title={t('ddAmountDiff')}
                  hint={t('ddAmountDiffHint')}
                  count={data.counts.amountDiff}
                  tone="amber"
                  icon={<Coins className="h-3.5 w-3.5" />}
                >
                  <div className="divide-y divide-amber-100/70 dark:divide-amber-950">
                    {data.pairs.amountDiff.map((p, i) => (
                      <PairRow key={`ad-${i}`} pair={p} t={t} />
                    ))}
                  </div>
                </Section>
              )}

              {/* ── SANA SILJIGAN ── */}
              {data.pairs.dateShift.length > 0 && (
                <Section
                  title={t('ddDateShift')}
                  hint={t('ddDateShiftHint')}
                  count={data.counts.dateShift}
                  tone="sky"
                  icon={<CalendarClock className="h-3.5 w-3.5" />}
                >
                  <div className="divide-y divide-sky-100/70 dark:divide-sky-950">
                    {data.pairs.dateShift.map((p, i) => (
                      <PairRow key={`ds-${i}`} pair={p} t={t} />
                    ))}
                  </div>
                </Section>
              )}

              {/* ── MOS TO'LOVLAR (yig'ilgan) ── */}
              {data.pairs.matched.length > 0 && (
                <div className="rounded-xl ring-1 ring-emerald-200 dark:ring-emerald-900 overflow-hidden">
                  <button
                    onClick={() => setShowMatched((s) => !s)}
                    className="w-full flex items-center gap-2 px-3.5 py-2.5 bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-[12px] font-bold text-emerald-800 dark:text-emerald-300">
                      {t('ddMatched')} · {data.counts.matched}
                    </span>
                    <span className="ml-auto text-[11px] text-emerald-700/70 dark:text-emerald-400/70">
                      {showMatched ? t('ddHide') : t('ddShow')}
                    </span>
                  </button>
                  {showMatched && (
                    <div className="divide-y divide-emerald-100/70 dark:divide-emerald-950 bg-white dark:bg-slate-900">
                      {data.pairs.matched.map((p, i) => (
                        <SinglePayRow
                          key={`m-${i}`}
                          date={p.crm.date}
                          amount={p.crm.amount}
                          tags={[p.crm.method, p.crm.type]}
                          tone="emerald"
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ═══════════════════ Bo'limlar ═══════════════════

function Section({
  title, hint, count, sum, tone, icon, children,
}: {
  title: string;
  hint?: string;
  count: number;
  sum?: number;
  tone: 'rose' | 'violet' | 'amber' | 'sky';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const m = {
    rose:   { ring: 'ring-rose-200 dark:ring-rose-900',     head: 'bg-rose-50/70 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300' },
    violet: { ring: 'ring-violet-200 dark:ring-violet-900', head: 'bg-violet-50/70 dark:bg-violet-950/30 text-violet-800 dark:text-violet-300' },
    amber:  { ring: 'ring-amber-200 dark:ring-amber-900',   head: 'bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300' },
    sky:    { ring: 'ring-sky-200 dark:ring-sky-900',       head: 'bg-sky-50/70 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300' },
  }[tone];

  return (
    <div className={cn('rounded-xl ring-1 overflow-hidden', m.ring)}>
      <div className={cn('px-3.5 py-2.5', m.head)}>
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[12px] font-bold">{title}</span>
          <span className="px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-slate-900/60 text-[10.5px] font-bold tabular-nums">
            {count}
          </span>
          {sum != null && (
            <span className="ml-auto text-[12px] font-bold tabular-nums">{money(sum)}</span>
          )}
        </div>
        {hint && <div className="text-[10.5px] opacity-75 mt-0.5">{hint}</div>}
      </div>
      <div className="bg-white dark:bg-slate-900">{children}</div>
    </div>
  );
}

function SinglePayRow({
  date, amount, tags, note, tone,
}: {
  date: string | null;
  amount: number;
  tags: (string | null)[];
  note?: string | null;
  tone: 'rose' | 'violet' | 'emerald';
}) {
  const amountColor = {
    rose: 'text-rose-700 dark:text-rose-300',
    violet: 'text-violet-700 dark:text-violet-300',
    emerald: 'text-emerald-700 dark:text-emerald-300',
  }[tone];

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="text-[11.5px] font-mono text-slate-500 dark:text-slate-400 tabular-nums shrink-0 w-[86px]">
        {date || '—'}
      </span>
      <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
        {tags.filter(Boolean).map((tag, i) => (
          <span key={i} className="text-[10.5px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 truncate max-w-[170px]">
            {tag}
          </span>
        ))}
        {note && (
          <span className="text-[10.5px] text-slate-400 dark:text-slate-500 truncate max-w-[260px]">{note}</span>
        )}
      </div>
      <span className={cn('text-[12.5px] font-bold tabular-nums shrink-0', amountColor)}>
        {money(amount)}
      </span>
    </div>
  );
}

function PairRow({ pair, t }: { pair: Pair; t: any }) {
  return (
    <div className="px-3.5 py-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 w-[58px] shrink-0">
          <Cloud className="h-3 w-3" /> CRM
        </span>
        <span className="text-[11.5px] font-mono text-slate-500 dark:text-slate-400 tabular-nums w-[86px] shrink-0">
          {pair.crm.date || '—'}
        </span>
        <span className="text-[12.5px] font-bold tabular-nums text-slate-800 dark:text-slate-100">
          {money(pair.crm.amount)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {[pair.crm.method, pair.crm.status].filter(Boolean).map((tag, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 truncate max-w-[130px]">
              {tag}
            </span>
          ))}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400 w-[58px] shrink-0">
          <Database className="h-3 w-3" /> {t('colOur')}
        </span>
        <span className="text-[11.5px] font-mono text-slate-500 dark:text-slate-400 tabular-nums w-[86px] shrink-0">
          {pair.our.date || '—'}
        </span>
        <span className="text-[12.5px] font-bold tabular-nums text-slate-800 dark:text-slate-100">
          {money(pair.our.amount)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {pair.kind === 'amount-diff' && (
            <span className="inline-flex items-center gap-1 text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 tabular-nums">
              <AlertTriangle className="h-2.5 w-2.5" />
              {pair.diff > 0 ? '+' : '−'}{money(Math.abs(pair.diff))}
            </span>
          )}
          {pair.kind === 'date-shift' && (
            <span className="inline-flex items-center gap-1 text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300">
              <CalendarClock className="h-2.5 w-2.5" />
              {t('ddDayGap', { n: pair.dayGap })}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function TotalBox({
  icon, label, value, sub, tone, signed,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  tone: 'sky' | 'violet' | 'amber' | 'emerald';
  signed?: boolean;
}) {
  const m = {
    sky: 'text-sky-700 dark:text-sky-300 bg-white/70 dark:bg-slate-900/50 ring-sky-200 dark:ring-sky-900',
    violet: 'text-violet-700 dark:text-violet-300 bg-white/70 dark:bg-slate-900/50 ring-violet-200 dark:ring-violet-900',
    amber: 'text-amber-700 dark:text-amber-300 bg-white/70 dark:bg-slate-900/50 ring-amber-200 dark:ring-amber-900',
    emerald: 'text-emerald-700 dark:text-emerald-300 bg-white/70 dark:bg-slate-900/50 ring-emerald-200 dark:ring-emerald-900',
  }[tone];

  return (
    <div className={cn('rounded-xl ring-1 px-3 py-2', m)}>
      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] font-bold opacity-80">
        {icon} {label}
      </div>
      <div className="text-[14px] font-bold tabular-nums mt-0.5 leading-tight">
        {signed && value > 0 ? '+' : ''}{money(value)}
      </div>
      {sub && <div className="text-[10px] opacity-70">{sub}</div>}
    </div>
  );
}
