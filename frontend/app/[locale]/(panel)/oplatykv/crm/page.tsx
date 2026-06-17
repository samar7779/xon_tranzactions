'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Loader2, BookUser, Home, Building2, User, Calendar,
  FileText, CheckCircle2, AlertCircle, Clock, X, History,
  CreditCard, Phone, MapPin, Hash, BookOpen, ChevronRight, ChevronDown,
  Sparkles, Banknote, Tag, CornerDownLeft,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/skeleton';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

interface ContractTotal {
  amount?: number;
  paid?: number;
  left?: number;
}

interface ContractDetail {
  contract_date?: string;
  price?: number;
  status?: { key?: string; value?: { name?: Record<string, string> } };
  client?: any;
  info?: any;
  initial?: { total?: ContractTotal; schedules?: any[] };
  monthly?: { total?: ContractTotal; schedules?: any[] };
  payment_histories?: any[];
}

const STATUS_TONE: Record<string, { cls: string; dot: string }> = {
  paid:       { cls: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900', dot: 'bg-emerald-500' },
  partially:  { cls: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900',       dot: 'bg-amber-500' },
  waiting:    { cls: 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',       dot: 'bg-slate-400' },
  overdue:    { cls: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',          dot: 'bg-rose-500' },
  sold:       { cls: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-900',    dot: 'bg-indigo-500' },
};

const LS_RECENT = 'crm.recentContracts';

export default function CrmPage() {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const locale = useLocale();
  const apiLang: 'uz' | 'ru' = locale === 'ru' ? 'ru' : 'uz';

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [activeContract, setActiveContract] = useState<string>('');
  const [recent, setRecent] = useState<string[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_RECENT);
      if (raw) setRecent(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Debounce input — 250ms
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Live autocomplete — searches as user types
  const { data: suggData, isFetching: suggesting } = useQuery({
    queryKey: ['crm-search', debouncedQ],
    queryFn: () =>
      api.get<{ ok: boolean; items?: any[]; error?: string }>(
        `/crm/search?contract=${encodeURIComponent(debouncedQ)}&perPage=10`,
      ),
    enabled: debouncedQ.length >= 3 && focused,
    staleTime: 30_000,
  });
  const suggestions = (suggData?.items || []) as Array<any>;
  const showDropdown = focused && debouncedQ.length >= 3;

  function pushRecent(contract: string) {
    const next = [contract, ...recent.filter((x) => x !== contract)].slice(0, 8);
    setRecent(next);
    try { localStorage.setItem(LS_RECENT, JSON.stringify(next)); } catch {}
  }

  const showMut = useMutation({
    mutationFn: (contract: string) =>
      api.get<{ ok: boolean; detail?: ContractDetail; error?: string }>(
        `/crm/show?contract=${encodeURIComponent(contract)}`,
      ),
    onSuccess: (r, contract) => {
      if (r?.ok && r.detail) {
        setDetail(r.detail);
        setActiveContract(contract);
        pushRecent(contract);
      } else {
        setDetail(null);
        toast.error(r?.error || t('notFound'));
      }
    },
    onError: (e: any) => {
      setDetail(null);
      toast.error(e?.message || tc('error'));
    },
  });

  function runSearch(value?: string) {
    const c = (value ?? q).trim();
    if (!c) return;
    setQ(c);
    setFocused(false);
    setHighlight(-1);
    showMut.mutate(c);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || suggestions.length === 0) {
      if (e.key === 'Enter') runSearch();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(suggestions.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(-1, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight >= 0 && suggestions[highlight]) {
        const s = suggestions[highlight];
        runSearch(s.contract || s.contract_number);
      } else {
        runSearch();
      }
    } else if (e.key === 'Escape') {
      setFocused(false);
      setHighlight(-1);
    }
  }

  function clearRecent() {
    setRecent([]);
    try { localStorage.removeItem(LS_RECENT); } catch {}
  }

  // ─── Derived data ───
  const client = detail?.client || {};
  const info = detail?.info || {};
  const statusKey = detail?.status?.key || '';
  const statusName = detail?.status?.value?.name?.[apiLang] || statusKey || '—';
  const statusTone = STATUS_TONE[statusKey] || { cls: 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700', dot: 'bg-slate-400' };

  const initialTotal = detail?.initial?.total || {};
  const monthlyTotal = detail?.monthly?.total || {};
  const initialPrice = Number(initialTotal.amount || 0);
  const initialPaid = Number(initialTotal.paid || 0);
  const initialLeft = Number(initialTotal.left || 0);
  const monthlyPrice = Number(monthlyTotal.amount || 0);
  const monthlyPaid = Number(monthlyTotal.paid || 0);
  const monthlyLeft = Number(monthlyTotal.left || 0);
  const totalPaid = initialPaid + monthlyPaid;
  const totalLeft = initialLeft + monthlyLeft;
  const totalPrice = Number(detail?.price || 0);
  const paidPct = totalPrice > 0 ? Math.min(100, (totalPaid / totalPrice) * 100) : 0;
  const initialPct = initialPrice > 0 ? Math.min(100, (initialPaid / initialPrice) * 100) : 0;
  const monthlyPct = monthlyPrice > 0 ? Math.min(100, (monthlyPaid / monthlyPrice) * 100) : 0;
  const monthsCount = (detail?.monthly?.schedules || []).length;

  // Group payment histories by kind (initial / monthly)
  const histGroups = useMemo(() => {
    const initial: any[] = [];
    const monthly: any[] = [];
    for (const h of (detail?.payment_histories || [])) {
      const k = String(h?.type?.key || '').toLowerCase();
      if (k.includes('init') || k.includes('boshlang') || k.includes('перво')) initial.push(h);
      else monthly.push(h);
    }
    const sum = (arr: any[]) => arr.reduce((s, x) => s + Number(x?.amount || 0), 0);
    return {
      initial, monthly,
      initialSum: sum(initial),
      monthlySum: sum(monthly),
    };
  }, [detail]);

  // Collapsible group state (default: all closed, like the reference screenshot)
  const [openHistInit, setOpenHistInit] = useState(false);
  const [openHistMonth, setOpenHistMonth] = useState(false);
  const [openSchedInit, setOpenSchedInit] = useState(false);
  const [openSchedMonth, setOpenSchedMonth] = useState(false);
  const [openClient, setOpenClient] = useState(false);

  const overdueSum = useMemo(() => {
    if (!detail) return 0;
    const today = new Date().toISOString().slice(0, 10);
    let sum = 0;
    const all = [
      ...(detail.monthly?.schedules || []),
      ...(detail.initial?.schedules || []),
    ];
    for (const s of all) {
      const d = String(s?.date_payment || '').slice(0, 10);
      if (d && d <= today && Number(s?.left || 0) > 0) sum += Number(s.left || 0);
    }
    return sum;
  }, [detail]);

  const fullName = useMemo(() => {
    function pick(f: any): string {
      if (!f) return '';
      if (typeof f === 'string') return f;
      return f.lotin || f.kirill || '';
    }
    return [pick(client.last_name), pick(client.first_name), pick(client.middle_name)]
      .filter(Boolean).join(' ').trim();
  }, [client]);

  return (
    <>
      <div className="flex-1 p-3 sm:p-6 lg:p-8 w-full">
        <div className="w-full space-y-6">

          {/* ═══ Search bar — clean elevated card with autocomplete ═══ */}
          <Card className="border-0 shadow-soft overflow-visible">
            <div className="relative px-5 py-5 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-4">
                {/* Compact icon */}
                <div className="relative shrink-0">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center text-white shadow-lg shadow-indigo-500/30">
                    <BookUser className="h-6 w-6" />
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900">
                    <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-70" />
                  </span>
                </div>

                {/* Search input with dropdown */}
                <div className="flex-1 min-w-0" ref={searchRef}>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                    <span>XonSaroy CRM</span>
                    <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                    <span className="text-slate-400 dark:text-slate-500 normal-case tracking-normal font-medium">{t('exampleHint')}</span>
                  </div>

                  <div className="relative">
                    {/* Glow ring when focused (animated conic gradient) */}
                    <span
                      aria-hidden
                      className={cn(
                        'pointer-events-none absolute -inset-px rounded-2xl transition-opacity duration-300',
                        focused ? 'opacity-100' : 'opacity-0',
                      )}
                      style={{
                        background: 'conic-gradient(from var(--crm-angle, 0deg), #6366f1, #a855f7, #ec4899, #6366f1)',
                        filter: 'blur(0.5px)',
                        animation: 'crmRing 6s linear infinite',
                      }}
                    />
                    <style jsx>{`
                      @keyframes crmRing { to { --crm-angle: 360deg; } }
                      @property --crm-angle {
                        syntax: '<angle>';
                        initial-value: 0deg;
                        inherits: false;
                      }
                    `}</style>

                    <Search className={cn(
                      'absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 transition-colors z-10',
                      q || focused ? 'text-indigo-500 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500',
                    )} />
                    <Input
                      value={q}
                      onChange={(e) => { setQ(e.target.value); setHighlight(-1); }}
                      onFocus={() => setFocused(true)}
                      onKeyDown={onKeyDown}
                      placeholder={t('searchPlaceholder')}
                      className={cn(
                        'relative pl-12 pr-32 h-12 text-base rounded-2xl',
                        'bg-slate-50/70 dark:bg-slate-900 border-slate-200 dark:border-slate-700',
                        'focus-visible:bg-white dark:focus-visible:bg-slate-800 focus-visible:ring-0 focus-visible:ring-offset-0',
                        'focus-visible:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]',
                        'focus-visible:border-indigo-300 dark:focus-visible:border-indigo-700',
                      )}
                    />
                    {q && !showMut.isPending && (
                      <button
                        onClick={() => { setQ(''); setDebouncedQ(''); setDetail(null); setActiveContract(''); setHighlight(-1); }}
                        className="absolute right-[110px] top-1/2 -translate-y-1/2 w-7 h-7 rounded-full grid place-items-center text-slate-400 dark:text-slate-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-400 transition-colors z-10"
                        aria-label={tc('reset')}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    <Button
                      onClick={() => runSearch()}
                      disabled={!q.trim() || showMut.isPending}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 px-3.5 rounded-xl gap-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold text-[12px] shadow-md z-10"
                    >
                      {showMut.isPending ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('searching')}</>
                      ) : (
                        <><Search className="h-3.5 w-3.5" /> {t('searchBtn')}</>
                      )}
                    </Button>

                    {/* Autocomplete dropdown */}
                    {showDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-2 z-30 rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.35)] overflow-hidden">
                        {suggesting && suggestions.length === 0 ? (
                          <div className="px-4 py-3 text-[12px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('searching')}
                          </div>
                        ) : suggestions.length === 0 ? (
                          <div className="px-4 py-6 text-[12px] text-slate-500 dark:text-slate-400 text-center">
                            <Search className="h-6 w-6 text-slate-300 dark:text-slate-600 mx-auto mb-1.5" />
                            {t('notFound')}
                          </div>
                        ) : (
                          <>
                            <div className="px-4 py-2 text-[10px] uppercase tracking-[0.15em] font-bold text-slate-400 dark:text-slate-500 bg-slate-50/70 dark:bg-slate-900 flex items-center justify-between">
                              <span>{suggestions.length} {suggestions.length === 1 ? '' : ''}</span>
                              <span className="flex items-center gap-1 text-slate-400 dark:text-slate-500 normal-case tracking-normal font-medium">
                                <CornerDownLeft className="h-2.5 w-2.5" /> Enter
                              </span>
                            </div>
                            <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800">
                              {suggestions.map((s, i) => (
                                <SuggestionRow
                                  key={s.id || s.contract || i}
                                  item={s}
                                  active={highlight === i}
                                  onPick={() => runSearch(s.contract || s.contract_number)}
                                  onHover={() => setHighlight(i)}
                                  apiLang={apiLang}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* ═══ Recent searches ═══ */}
          {!detail && !showMut.isPending && recent.length > 0 && (
            <Card className="border-0 shadow-soft overflow-hidden">
              <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 dark:text-slate-400 shrink-0">
                  <History className="h-3.5 w-3.5" />
                  {t('recentSearches')}
                </div>
                <div className="flex items-center gap-2 flex-wrap flex-1">
                  {recent.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setQ(c); runSearch(c); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:ring-1 hover:ring-indigo-200 dark:hover:ring-indigo-900 text-[12px] font-mono font-semibold text-slate-700 dark:text-slate-300 hover:text-indigo-700 dark:hover:text-indigo-300 transition-all"
                    >
                      <FileText className="h-3 w-3" />
                      {c}
                    </button>
                  ))}
                </div>
                <button
                  onClick={clearRecent}
                  className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 font-medium inline-flex items-center gap-1"
                >
                  <X className="h-3 w-3" /> {t('clearRecent')}
                </button>
              </CardContent>
            </Card>
          )}

          {/* ═══ Loading skeleton ═══ */}
          {showMut.isPending && (
            <Card className="border-0 shadow-soft overflow-hidden">
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-32 w-full rounded-xl" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-24 rounded-xl" />
                </div>
                <Skeleton className="h-48 w-full rounded-xl" />
              </CardContent>
            </Card>
          )}

          {/* ═══ Empty (initial) state ═══ */}
          {!showMut.isPending && !detail && (
            <Card className="border-0 shadow-soft overflow-hidden">
              <CardContent className="p-12 text-center">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-50 to-violet-50 ring-1 ring-indigo-100 dark:ring-indigo-900 grid place-items-center mx-auto mb-4">
                  <BookOpen className="h-9 w-9 text-indigo-500 dark:text-indigo-400" />
                </div>
                <div className="text-lg font-bold tracking-tight text-slate-800 dark:text-slate-200">{t('searchHint')}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('subtitle')}</div>
              </CardContent>
            </Card>
          )}

          {/* ═══ Contract details ═══ */}
          {!showMut.isPending && detail && (
            <>
              {/* Compact contract header — single slim strip */}
              <Card className="border-0 shadow-soft overflow-hidden">
                <div className="px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 via-violet-600 to-purple-600 grid place-items-center text-white shadow-md shadow-violet-500/25 shrink-0">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-lg lg:text-xl font-black tracking-tight text-slate-900 dark:text-slate-100 truncate leading-tight">
                        {info.object || '—'}
                      </div>
                      <div className="text-[12px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-1.5">
                        <User className="h-3 w-3" />
                        {fullName || '—'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-[9px] uppercase tracking-[0.18em] font-bold text-slate-400 dark:text-slate-500">{t('contractNumber')}</div>
                      <div className="font-mono text-base font-bold tabular-nums text-violet-700 dark:text-violet-300">{activeContract}</div>
                    </div>
                    <span className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ring-1 ring-inset',
                      statusTone.cls,
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', statusTone.dot)} />
                      {statusName}
                    </span>
                  </div>
                </div>
              </Card>

              {/* ═══ 3 KPI cards ═══ */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <KpiCard
                  label={t('contractSum')}
                  value={formatMoney(totalPrice, 'UZS')}
                  meta={overdueSum > 0 ? `${t('overdue')}: ${formatMoney(overdueSum, 'UZS')}` : `${t('paid')}: ${formatMoney(totalPaid, 'UZS')}`}
                  metaTone={overdueSum > 0 ? 'rose' : 'emerald'}
                  pct={paidPct}
                  icon={<Building2 className="h-[18px] w-[18px]" strokeWidth={2.4} />}
                />
                <KpiCard
                  label={t('initialFee')}
                  value={formatMoney(initialPrice, 'UZS')}
                  meta={`${t('balance')}: ${formatMoney(initialLeft, 'UZS')}`}
                  metaTone={initialLeft === 0 ? 'emerald' : 'amber'}
                  pct={initialPct}
                  icon={<Sparkles className="h-[18px] w-[18px]" strokeWidth={2.4} />}
                />
                <KpiCard
                  label={`${t('installment')} (${t('installmentMonths', { n: monthsCount })})`}
                  value={formatMoney(monthlyPrice, 'UZS')}
                  meta={`${t('balance')}: ${formatMoney(monthlyLeft, 'UZS')}`}
                  metaTone={monthlyLeft === 0 ? 'emerald' : 'amber'}
                  pct={monthlyPct}
                  icon={<Banknote className="h-[18px] w-[18px]" strokeWidth={2.4} />}
                />
              </div>

              {/* ═══ Details — collapsible: apartment + client info ═══ */}
              <Card className="border-0 shadow-soft overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenClient((o) => !o)}
                  className={cn(
                    'w-full px-5 py-4 flex items-center justify-between gap-3 transition-colors text-left',
                    openClient ? 'bg-emerald-50/40 dark:bg-emerald-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow-md shadow-emerald-500/20 shrink-0">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-base font-bold tracking-tight text-slate-800 dark:text-slate-200">{t('openClient')}</div>
                      <div className="text-[12px] text-slate-500 dark:text-slate-400 truncate">{fullName || '—'}</div>
                    </div>
                  </div>
                  <ChevronDown className={cn(
                    'h-5 w-5 text-slate-400 dark:text-slate-500 transition-transform duration-200 shrink-0',
                    openClient ? 'rotate-0' : '-rotate-90',
                  )} />
                </button>
                <div className={cn(
                  'grid transition-[grid-template-rows] duration-300 ease-out',
                  openClient ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                )}>
                  <div className="overflow-hidden">
                    <div className="border-t border-slate-100 dark:border-slate-800 p-5 space-y-5">

                      {/* ─── Apartment / object details (moved here from hero) ─── */}
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                          <Building2 className="h-3 w-3 text-violet-500 dark:text-violet-400" />
                          {t('object')}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {info.number && (
                            <Chip icon={<Home className="h-3 w-3" />} label={`№ ${info.number}`} />
                          )}
                          {info.rooms != null && (
                            <Chip icon={<Hash className="h-3 w-3" />} label={`${info.rooms} ${t('rooms').toLowerCase()}`} />
                          )}
                          {info.area && (
                            <Chip icon={<Hash className="h-3 w-3" />} label={`${info.area} m²`} />
                          )}
                          {info.building && (
                            <Chip icon={<Building2 className="h-3 w-3" />} label={String(info.building)} />
                          )}
                          {info.block && (
                            <Chip icon={<Hash className="h-3 w-3" />} label={`${t('block')} ${info.block}`} />
                          )}
                          {info.floor != null && (
                            <Chip icon={<Hash className="h-3 w-3" />} label={`${t('floor')} ${info.floor}`} />
                          )}
                          {detail.contract_date && (
                            <Chip icon={<Calendar className="h-3 w-3" />} label={fmtDate(detail.contract_date)} />
                          )}
                        </div>
                      </div>

                      {/* ─── Client info ─── */}
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                          <User className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
                          {t('openClient')}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
                          <InfoRow icon={<User className="h-3.5 w-3.5" />} label={t('client')} value={fullName || '—'} />
                          {(client.phone_primary || client.phone) && (
                            <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label={t('phone')} value={String(client.phone_primary || client.phone)} mono />
                          )}
                          {client.phone_secondary && (
                            <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label={`${t('phone')} 2`} value={String(client.phone_secondary)} mono />
                          )}
                          {(client.date_of_birth || client.birth_date) && (
                            <InfoRow icon={<Calendar className="h-3.5 w-3.5" />} label={t('birthDate')} value={fmtDate(client.date_of_birth || client.birth_date)} />
                          )}
                          {client.passport_series && (
                            <InfoRow icon={<FileText className="h-3.5 w-3.5" />} label={t('passport')} value={String(client.passport_series)} mono />
                          )}
                          {client.passport_issued_by && (
                            <InfoRow icon={<FileText className="h-3.5 w-3.5" />} label={t('passportIssuedBy')} value={String(client.passport_issued_by)} />
                          )}
                          {client.passport_issued_date && (
                            <InfoRow icon={<Calendar className="h-3.5 w-3.5" />} label={t('passportIssuedDate')} value={fmtDate(client.passport_issued_date)} />
                          )}
                          {client.passport_expiry_date && (
                            <InfoRow icon={<Calendar className="h-3.5 w-3.5" />} label={t('passportExpiry')} value={fmtDate(client.passport_expiry_date)} />
                          )}
                          {(client.address_line || client.address) && (
                            <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label={t('address')} value={String(client.address_line || client.address)} />
                          )}
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              </Card>

              {/* ═══ Payment list (history) — accordion ═══ */}
              <Card className="border-0 shadow-soft overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white shadow-md shadow-amber-500/20">
                      <CreditCard className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-base font-bold tracking-tight text-slate-800 dark:text-slate-200">{t('paymentList')}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="text-slate-400 dark:text-slate-500">{t('totalPaidLabel')}: </span>
                        <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{formatMoney(totalPaid, 'UZS')}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <CardContent className="p-4 space-y-2">
                  {(detail.payment_histories || []).length === 0 ? (
                    <div className="px-5 py-10 text-center text-xs text-slate-500 dark:text-slate-400">{t('noHistory')}</div>
                  ) : (
                    <>
                      {histGroups.initial.length > 0 && (
                        <GroupRow
                          kind="initial"
                          label={t('boshlangich')}
                          count={histGroups.initial.length}
                          amount={histGroups.initialSum}
                          open={openHistInit}
                          onToggle={() => setOpenHistInit((o) => !o)}
                        >
                          <div className="divide-y divide-slate-100 dark:divide-slate-700">
                            {histGroups.initial.map((h: any, i: number) => (
                              <HistoryRow key={`hi-${i}`} h={h} idx={i + 1} apiLang={apiLang} t={t} />
                            ))}
                          </div>
                        </GroupRow>
                      )}
                      {histGroups.monthly.length > 0 && (
                        <GroupRow
                          kind="monthly"
                          label={t('oylik')}
                          count={histGroups.monthly.length}
                          amount={histGroups.monthlySum}
                          open={openHistMonth}
                          onToggle={() => setOpenHistMonth((o) => !o)}
                        >
                          <div className="divide-y divide-slate-100 dark:divide-slate-700">
                            {histGroups.monthly.map((h: any, i: number) => (
                              <HistoryRow key={`hm-${i}`} h={h} idx={i + 1} apiLang={apiLang} t={t} />
                            ))}
                          </div>
                        </GroupRow>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              {/* ═══ Schedule — accordion ═══ */}
              <Card className="border-0 shadow-soft overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-md shadow-indigo-500/20">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-base font-bold tracking-tight text-slate-800 dark:text-slate-200">
                        {t('scheduleTitle')}
                        {monthsCount > 0 && (
                          <span className="ml-2 text-[12px] font-medium text-slate-400 dark:text-slate-500">
                            ({t('installmentMonths', { n: monthsCount })})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <CardContent className="p-4 space-y-2">
                  {(detail.initial?.schedules || []).length === 0 && (detail.monthly?.schedules || []).length === 0 ? (
                    <div className="text-center py-10 text-xs text-slate-500 dark:text-slate-400">{t('noSchedule')}</div>
                  ) : (
                    <>
                      {(detail.initial?.schedules || []).length > 0 && (
                        <GroupRow
                          kind="initial"
                          label={t('boshlangich')}
                          count={detail.initial!.schedules!.length}
                          amount={initialPaid}
                          amountTotal={initialPrice}
                          open={openSchedInit}
                          onToggle={() => setOpenSchedInit((o) => !o)}
                        >
                          <div className="p-3 space-y-1.5">
                            {detail.initial!.schedules!.map((s: any, i: number) => (
                              <ScheduleRow key={`si-${i}`} item={s} idx={i + 1} kind="initial" t={t} />
                            ))}
                          </div>
                        </GroupRow>
                      )}
                      {(detail.monthly?.schedules || []).length > 0 && (
                        <GroupRow
                          kind="monthly"
                          label={t('oylik')}
                          count={detail.monthly!.schedules!.length}
                          amount={monthlyPaid}
                          amountTotal={monthlyPrice}
                          open={openSchedMonth}
                          onToggle={() => setOpenSchedMonth((o) => !o)}
                        >
                          <div className="p-3 space-y-1.5 max-h-[600px] overflow-y-auto">
                            {detail.monthly!.schedules!.map((s: any, i: number) => (
                              <ScheduleRow key={`sm-${i}`} item={s} idx={i + 1} kind="monthly" t={t} />
                            ))}
                          </div>
                        </GroupRow>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

            </>
          )}
        </div>
      </div>
    </>
  );
}

// ────────────────────────── helpers ──────────────────────────

function KpiCard({
  label, value, meta, metaTone, pct, icon,
}: {
  label: string;
  value: string;
  meta?: string;
  metaTone?: 'emerald' | 'amber' | 'rose';
  pct: number;
  icon?: React.ReactNode;
}) {
  const metaMap = {
    emerald: 'text-emerald-700 dark:text-emerald-300',
    amber:   'text-amber-700 dark:text-amber-300',
    rose:    'text-rose-700 dark:text-rose-300',
  } as const;
  return (
    <Card className="border-0 shadow-soft overflow-hidden group hover:shadow-md transition-all">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="text-[13px] font-bold text-violet-600 dark:text-violet-400 truncate flex-1">{label}</div>
          {icon && (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-violet-600 to-purple-600 grid place-items-center text-white shadow-md shadow-violet-500/25 shrink-0 group-hover:scale-110 transition-transform">
              {icon}
            </div>
          )}
        </div>
        <div className="text-[28px] lg:text-[30px] font-black tabular-nums tracking-tight text-slate-900 dark:text-slate-100 truncate leading-tight" title={value}>
          {value}
        </div>
        {meta && (
          <div className={cn(
            'text-[12px] font-medium tabular-nums mt-1 truncate',
            metaTone ? metaMap[metaTone] : 'text-slate-500 dark:text-slate-400',
          )}>
            {meta}
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-600 transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[12px] font-bold tabular-nums text-slate-500 dark:text-slate-400 shrink-0">{pct.toFixed(1)} %</div>
        </div>
      </CardContent>
    </Card>
  );
}

function GroupRow({
  kind, label, count, amount, amountTotal, open, onToggle, children,
}: {
  kind: 'initial' | 'monthly';
  label: string;
  count: number;
  amount: number;
  amountTotal?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const style = KIND_STYLE[kind];
  return (
    <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden bg-white dark:bg-slate-900">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full px-4 py-3 flex items-center gap-3 transition-colors text-left',
          open ? style.bg : 'hover:bg-slate-50 dark:hover:bg-slate-800',
        )}
      >
        {/* Arrow */}
        <ChevronDown className={cn(
          'h-4 w-4 transition-transform duration-200 shrink-0',
          style.text,
          open ? 'rotate-0' : '-rotate-90',
        )} />

        {/* Kind icon */}
        <div className={cn(
          'w-8 h-8 rounded-lg grid place-items-center text-white shrink-0 shadow-sm bg-gradient-to-br',
          style.bar,
        )}>
          {kind === 'initial' ? <Sparkles className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
        </div>

        {/* Label + count */}
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span className={cn('text-[13px] font-bold', style.text)}>{label}</span>
          <span className={cn(
            'inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-md text-[10px] font-bold tabular-nums ring-1',
            style.bg, style.text, style.ring,
          )}>
            {count}
          </span>
        </div>

        {/* Amount */}
        <div className="text-right shrink-0 tabular-nums">
          <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
            {formatMoney(amount, 'UZS')}
            {amountTotal != null && amountTotal !== amount && (
              <span className="text-slate-400 dark:text-slate-500 font-normal"> / {formatMoney(amountTotal, 'UZS')}</span>
            )}
          </div>
        </div>
      </button>
      <div className={cn(
        'grid transition-[grid-template-rows] duration-300 ease-out',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}>
        <div className="overflow-hidden">
          <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 transition-colors">
      <span className="text-slate-400 dark:text-slate-500">{icon}</span>
      {label}
    </span>
  );
}

function SuggestionRow({
  item, active, onPick, onHover, apiLang,
}: {
  item: any;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
  apiLang: 'uz' | 'ru';
}) {
  const tCrm = useTranslations('crm');
  const contract = item.contract || item.contract_number || '—';
  const obj = item.object || item.info?.object || item.object_name || '';
  const ownerRaw = item.client || item.client_name || '';
  const clientName = useMemo(() => {
    if (!ownerRaw) return '';
    if (typeof ownerRaw === 'string') return ownerRaw;
    // {first_name: {lotin, kirill}, ...}
    const f = (v: any) => {
      if (!v) return '';
      if (typeof v === 'string') return v;
      return v.lotin || v.kirill || '';
    };
    return [f(ownerRaw.last_name), f(ownerRaw.first_name), f(ownerRaw.middle_name)].filter(Boolean).join(' ').trim();
  }, [ownerRaw]);
  const status = item.status?.value?.name?.[apiLang] || item.status?.key || '';
  const statusKey = item.status?.key || '';
  const tone = STATUS_TONE[statusKey] || STATUS_TONE.waiting;
  const price = Number(item.price || item.total_price || 0);
  // Trashed (soft-deleted) — Laravel SoftDelete: deleted_at to'ldirilgan
  const isTrashed = !!(item.deleted_at || item.is_trashed || item.trashed);
  // I18n etiketkalar — locale'ga qarab
  const trashedLabel = tCrm('deleted');
  const activeLabel = tCrm('active');

  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}
      onMouseEnter={onHover}
      className={cn(
        'w-full px-4 py-2.5 text-left transition-colors flex items-center gap-3',
        active ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
      )}
    >
      <div className={cn(
        'w-9 h-9 rounded-xl grid place-items-center shrink-0',
        active ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
      )}>
        <FileText className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn(
            'font-mono text-[13px] font-bold truncate',
            isTrashed ? 'text-rose-600 dark:text-rose-400 line-through decoration-rose-300 decoration-2' : (active ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-800 dark:text-slate-200'),
          )}>
            {contract}
          </span>
          {/* Trashed (bekor qilingan) — eng yorqin badge */}
          {isTrashed ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold ring-1 ring-inset bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900">
              <span className="w-1 h-1 rounded-full bg-rose-500" />
              {trashedLabel}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold ring-1 ring-inset bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900">
              <span className="w-1 h-1 rounded-full bg-emerald-500" />
              {activeLabel}
            </span>
          )}
          {status && (
            <span className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold ring-1 ring-inset',
              tone.cls,
            )}>
              <span className={cn('w-1 h-1 rounded-full', tone.dot)} />
              {status}
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
          {obj}
          {obj && clientName && <span className="text-slate-300 dark:text-slate-600 mx-1">·</span>}
          {clientName}
        </div>
      </div>
      {price > 0 && (
        <div className="text-right shrink-0">
          <div className="text-[11px] font-bold tabular-nums text-slate-700 dark:text-slate-300">{formatMoney(price, 'UZS')}</div>
        </div>
      )}
      <ChevronRight className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-500 dark:text-indigo-400' : 'text-slate-300 dark:text-slate-600')} />
    </button>
  );
}

// Toifa (kind) uchun ranglar — Boshlang'ich vs Oylik
const KIND_STYLE: Record<string, { bg: string; text: string; ring: string; bar: string; chipBg: string; chipText: string }> = {
  initial: {
    bg: 'bg-violet-50/60 dark:bg-violet-950/40',
    text: 'text-violet-700 dark:text-violet-300',
    ring: 'ring-violet-200 dark:ring-violet-900',
    bar: 'from-violet-500 to-purple-600',
    chipBg: 'bg-gradient-to-r from-violet-500 to-purple-600',
    chipText: 'text-white',
  },
  monthly: {
    bg: 'bg-blue-50/60 dark:bg-blue-950/40',
    text: 'text-blue-700 dark:text-blue-300',
    ring: 'ring-blue-200 dark:ring-blue-900',
    bar: 'from-blue-500 to-indigo-600',
    chipBg: 'bg-gradient-to-r from-blue-500 to-indigo-600',
    chipText: 'text-white',
  },
  other: {
    bg: 'bg-slate-50/60 dark:bg-slate-900',
    text: 'text-slate-600 dark:text-slate-300',
    ring: 'ring-slate-200 dark:ring-slate-700',
    bar: 'from-slate-400 to-slate-600',
    chipBg: 'bg-slate-200 dark:bg-slate-700',
    chipText: 'text-slate-700 dark:text-slate-300',
  },
};

function ScheduleRow({ item, idx, kind, t }: { item: any; idx?: number; kind?: 'initial' | 'monthly'; t: any }) {
  const [open, setOpen] = useState(false);
  const key = item?.status?.key || 'waiting';
  const tone = STATUS_TONE[key] || STATUS_TONE.waiting;
  const Icon = key === 'paid' ? CheckCircle2 : key === 'overdue' ? AlertCircle : Clock;
  const amount = Number(item?.amount || 0);
  const paid = Number(item?.amount_paid || 0);
  const left = Number(item?.left || 0);
  const purpose = item?.purpose || item?.description || item?.comment || '';
  const kindStyle = KIND_STYLE[kind || 'other'] || KIND_STYLE.other;

  return (
    <div className={cn(
      'group relative rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 hover:ring-indigo-300 dark:hover:ring-indigo-700 hover:shadow-md transition-all overflow-hidden',
    )}>
      {/* Left status bar */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b', kindStyle.bar)} />

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full pl-4 pr-3 py-2.5 flex items-center gap-3 text-left"
      >
        <div className={cn('w-9 h-9 rounded-xl grid place-items-center shrink-0 ring-1 shadow-sm', tone.cls)}>
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {idx != null && (
              <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                #{idx}
              </span>
            )}
            <span className="text-[13px] font-bold tabular-nums text-slate-800 dark:text-slate-200">
              {fmtDate(item?.date_payment)}
            </span>
          </div>
          {paid > 0 && left > 0 && (
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-emerald-700 dark:text-emerald-300 font-bold tabular-nums">{formatMoney(paid, 'UZS')}</span>
              </span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-amber-700 dark:text-amber-300 font-bold tabular-nums">{formatMoney(left, 'UZS')}</span>
              </span>
            </div>
          )}
        </div>

        <div className="text-right shrink-0 flex items-center gap-2">
          <div>
            <div className="text-sm font-black tabular-nums text-slate-900 dark:text-slate-100">{formatMoney(amount, 'UZS')}</div>
          </div>
          <ChevronDown className={cn(
            'h-4 w-4 text-slate-400 dark:text-slate-500 transition-transform duration-200 shrink-0',
            open && 'rotate-180',
          )} />
        </div>
      </button>

      {/* Expanded details */}
      <div className={cn(
        'grid transition-[grid-template-rows] duration-300 ease-out',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}>
        <div className="overflow-hidden">
          <div className="pl-4 pr-4 pb-3 pt-1 space-y-2 border-t border-slate-100 dark:border-slate-800 mt-1">
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <DetailMini label={t('amount')} value={formatMoney(amount, 'UZS')} tone="slate" />
              <DetailMini
                label={tone.cls.includes('emerald') ? t('paid') : t('status')}
                value={item?.status?.value?.name?.uz || item?.status?.key || '—'}
                tone={key === 'paid' ? 'emerald' : key === 'overdue' ? 'rose' : 'slate'}
              />
              {paid > 0 && <DetailMini label={t('schedulePaid')} value={formatMoney(paid, 'UZS')} tone="emerald" />}
              {left > 0 && <DetailMini label={t('scheduleLeft')} value={formatMoney(left, 'UZS')} tone="amber" />}
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-100 dark:ring-slate-700 px-3 py-2 flex items-start gap-2">
              <Tag className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0 mt-0.5" />
              <div className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                {purpose || <span className="text-slate-400 dark:text-slate-500 italic">{t('noPurpose')}</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ h, idx, apiLang, t }: { h: any; idx: number; apiLang: 'uz' | 'ru'; t: any }) {
  const [open, setOpen] = useState(false);
  const methodKey = String(h?.method?.key || '').toLowerCase();
  const methodName = h?.method?.value?.[apiLang] || methodKey || '—';
  const typeKey = String(h?.type?.key || '').toLowerCase();
  const typeName = h?.type?.value?.[apiLang] || typeKey || '';
  const statusKey = h?.status?.key || '';
  const statusTone = STATUS_TONE[statusKey] || STATUS_TONE.paid;

  // Toifa — boshlang'ich yoki oylik
  const kind: 'initial' | 'monthly' | 'other' =
    typeKey.includes('init') || typeKey.includes('boshlang') || typeKey.includes('перво')
      ? 'initial'
      : typeKey.includes('month') || typeKey.includes('oyl') || typeKey.includes('ежемес')
        ? 'monthly'
        : 'other';
  const kindStyle = KIND_STYLE[kind];
  const kindLabel = kind === 'initial' ? t('boshlangich') : kind === 'monthly' ? t('oylik') : (typeName || '—');

  const purpose = h?.purpose || h?.description || h?.comment || h?.note || '';
  const paymentId = h?.id || h?.payment_id || '';

  return (
    <div className="relative group">
      {/* Left kind bar */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b', kindStyle.bar)} />

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full pl-4 pr-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300 tabular-nums">
              #{idx}
            </span>
            <div className="text-sm font-black tabular-nums text-slate-900 dark:text-slate-100 truncate">
              {formatMoney(Number(h?.amount || 0), 'UZS')}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{fmtDate(h?.date_paid)}</div>
            <ChevronDown className={cn(
              'h-3.5 w-3.5 text-slate-400 dark:text-slate-500 transition-transform duration-200',
              open && 'rotate-180',
            )} />
          </div>
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {/* Toifa chip */}
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase',
            kindStyle.chipBg, kindStyle.chipText,
          )}>
            {kind === 'initial' ? <Sparkles className="h-2.5 w-2.5" /> : <Banknote className="h-2.5 w-2.5" />}
            {kindLabel}
          </span>
          {/* Method */}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
            <CreditCard className="h-2.5 w-2.5" />
            <span className="capitalize">{methodName}</span>
          </span>
          {/* Status */}
          {statusKey && (
            <span className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ring-1 ring-inset',
              statusTone.cls,
            )}>
              <span className={cn('w-1 h-1 rounded-full', statusTone.dot)} />
              {h?.status?.value?.[apiLang] || statusKey}
            </span>
          )}
        </div>
      </button>

      <div className={cn(
        'grid transition-[grid-template-rows] duration-300 ease-out',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}>
        <div className="overflow-hidden">
          <div className="pl-4 pr-5 pb-3 pt-1 space-y-2 border-t border-slate-100 dark:border-slate-800">
            {/* Purpose */}
            <div className="rounded-lg bg-gradient-to-br from-indigo-50/60 to-violet-50/30 ring-1 ring-indigo-100 dark:ring-indigo-900 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.15em] font-bold text-indigo-600 dark:text-indigo-400 mb-1">
                <Tag className="h-3 w-3" />
                {t('purpose')}
              </div>
              <div className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed">
                {purpose || <span className="text-slate-400 dark:text-slate-500 italic">{t('noPurpose')}</span>}
              </div>
            </div>

            {/* Mini grid */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {typeName && <DetailMini label={t('type')} value={typeName} tone="slate" />}
              {methodName !== '—' && <DetailMini label={t('method')} value={methodName} tone="slate" />}
              {h?.date_paid && <DetailMini label={t('datePaid')} value={fmtDate(h.date_paid)} tone="slate" />}
              {paymentId && <DetailMini label={t('paymentId')} value={String(paymentId)} tone="slate" mono />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailMini({
  label, value, tone, mono,
}: {
  label: string;
  value: string;
  tone: 'slate' | 'emerald' | 'amber' | 'rose';
  mono?: boolean;
}) {
  const map = {
    slate:   'bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 ring-slate-200 dark:ring-slate-700',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900',
    amber:   'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 ring-amber-200 dark:ring-amber-900',
    rose:    'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
  } as const;
  return (
    <div className={cn('rounded-lg ring-1 px-2.5 py-1.5', map[tone])}>
      <div className="text-[9px] uppercase tracking-wider font-bold opacity-60">{label}</div>
      <div className={cn('text-[12px] font-bold tabular-nums truncate mt-0.5', mono && 'font-mono')} title={value}>
        {value}
      </div>
    </div>
  );
}

function InfoRow({
  icon, label, value, mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 dark:border-slate-800 last:border-0">
      <div className="flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 shrink-0">
        <span className="text-slate-400 dark:text-slate-500">{icon}</span>
        {label}
      </div>
      <div className={cn('text-[13px] text-slate-800 dark:text-slate-200 text-right truncate', mono && 'font-mono text-[12px]')}>
        {value || '—'}
      </div>
    </div>
  );
}

function fmtDate(d: any) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split('-');
  if (!y || !m || !dd) return s;
  return `${dd}.${m}.${y}`;
}
