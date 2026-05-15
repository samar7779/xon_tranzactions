'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Loader2, BookUser, Home, Building2, User, Calendar,
  Wallet, FileText, CheckCircle2, AlertCircle, Clock, X, History,
  CreditCard, Phone, MapPin, Hash, BookOpen, ChevronRight, ChevronDown,
  Receipt, Sparkles, Banknote, Tag, ArrowRight, CornerDownLeft,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/skeleton';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

interface ContractDetail {
  contract_date?: string;
  price?: number;
  status?: { key?: string; value?: { name?: Record<string, string> } };
  client?: any;
  info?: any;
  initial?: { total?: { paid?: number; left?: number }; schedules?: any[] };
  monthly?: { total?: { paid?: number; left?: number; amount?: number }; schedules?: any[] };
  payment_histories?: any[];
}

const STATUS_TONE: Record<string, { cls: string; dot: string }> = {
  paid:       { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  partially:  { cls: 'bg-amber-50 text-amber-700 ring-amber-200',       dot: 'bg-amber-500' },
  waiting:    { cls: 'bg-slate-50 text-slate-700 ring-slate-200',       dot: 'bg-slate-400' },
  overdue:    { cls: 'bg-rose-50 text-rose-700 ring-rose-200',          dot: 'bg-rose-500' },
  sold:       { cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200',    dot: 'bg-indigo-500' },
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
  const statusTone = STATUS_TONE[statusKey] || { cls: 'bg-slate-50 text-slate-700 ring-slate-200', dot: 'bg-slate-400' };

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
      <Topbar title={t('title')} subtitle={t('subtitle')} />

      <div className="flex-1 p-6 lg:p-8 w-full">
        <div className="w-full space-y-6">

          {/* ═══ Search bar — clean elevated card with autocomplete ═══ */}
          <Card className="border-0 shadow-soft overflow-visible">
            <div className="relative px-5 py-5 bg-white">
              <div className="flex items-center gap-4">
                {/* Compact icon */}
                <div className="relative shrink-0">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center text-white shadow-lg shadow-indigo-500/30">
                    <BookUser className="h-6 w-6" />
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white">
                    <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-70" />
                  </span>
                </div>

                {/* Search input with dropdown */}
                <div className="flex-1 min-w-0" ref={searchRef}>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-bold text-slate-500 mb-1.5">
                    <span>XonSaroy CRM</span>
                    <span className="w-1 h-1 rounded-full bg-slate-300" />
                    <span className="text-slate-400 normal-case tracking-normal font-medium">{t('exampleHint')}</span>
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
                      q || focused ? 'text-indigo-500' : 'text-slate-400',
                    )} />
                    <Input
                      value={q}
                      onChange={(e) => { setQ(e.target.value); setHighlight(-1); }}
                      onFocus={() => setFocused(true)}
                      onKeyDown={onKeyDown}
                      placeholder={t('searchPlaceholder')}
                      className={cn(
                        'relative pl-12 pr-32 h-12 text-base rounded-2xl',
                        'bg-slate-50/70 border-slate-200',
                        'focus-visible:bg-white focus-visible:ring-0 focus-visible:ring-offset-0',
                        'focus-visible:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]',
                        'focus-visible:border-indigo-300',
                      )}
                    />
                    {q && !showMut.isPending && (
                      <button
                        onClick={() => { setQ(''); setDebouncedQ(''); setDetail(null); setActiveContract(''); setHighlight(-1); }}
                        className="absolute right-[110px] top-1/2 -translate-y-1/2 w-7 h-7 rounded-full grid place-items-center text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors z-10"
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
                      <div className="absolute top-full left-0 right-0 mt-2 z-30 rounded-2xl bg-white ring-1 ring-slate-200 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.35)] overflow-hidden">
                        {suggesting && suggestions.length === 0 ? (
                          <div className="px-4 py-3 text-[12px] text-slate-500 flex items-center gap-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('searching')}
                          </div>
                        ) : suggestions.length === 0 ? (
                          <div className="px-4 py-6 text-[12px] text-slate-500 text-center">
                            <Search className="h-6 w-6 text-slate-300 mx-auto mb-1.5" />
                            {t('notFound')}
                          </div>
                        ) : (
                          <>
                            <div className="px-4 py-2 text-[10px] uppercase tracking-[0.15em] font-bold text-slate-400 bg-slate-50/70 flex items-center justify-between">
                              <span>{suggestions.length} {suggestions.length === 1 ? '' : ''}</span>
                              <span className="flex items-center gap-1 text-slate-400 normal-case tracking-normal font-medium">
                                <CornerDownLeft className="h-2.5 w-2.5" /> Enter
                              </span>
                            </div>
                            <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-50">
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
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 shrink-0">
                  <History className="h-3.5 w-3.5" />
                  {t('recentSearches')}
                </div>
                <div className="flex items-center gap-2 flex-wrap flex-1">
                  {recent.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setQ(c); runSearch(c); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-indigo-50 hover:ring-1 hover:ring-indigo-200 text-[12px] font-mono font-semibold text-slate-700 hover:text-indigo-700 transition-all"
                    >
                      <FileText className="h-3 w-3" />
                      {c}
                    </button>
                  ))}
                </div>
                <button
                  onClick={clearRecent}
                  className="text-[11px] text-slate-500 hover:text-rose-600 font-medium inline-flex items-center gap-1"
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
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-50 to-violet-50 ring-1 ring-indigo-100 grid place-items-center mx-auto mb-4">
                  <BookOpen className="h-9 w-9 text-indigo-500" />
                </div>
                <div className="text-lg font-bold tracking-tight text-slate-800">{t('searchHint')}</div>
                <div className="text-xs text-slate-500 mt-1">{t('subtitle')}</div>
              </CardContent>
            </Card>
          )}

          {/* ═══ Contract details ═══ */}
          {!showMut.isPending && detail && (
            <>
              {/* Hero card — light, modern fintech */}
              <Card className="border-0 shadow-soft overflow-hidden">
                <div className="relative bg-white">
                  {/* Top accent bar */}
                  <div className={cn(
                    'h-1 bg-gradient-to-r',
                    statusKey === 'paid' ? 'from-emerald-500 via-teal-500 to-cyan-500'
                    : statusKey === 'overdue' ? 'from-rose-500 via-red-500 to-amber-500'
                    : statusKey === 'sold' ? 'from-indigo-500 via-violet-500 to-fuchsia-500'
                    : 'from-indigo-500 via-blue-500 to-cyan-500',
                  )} />

                  <div className="px-6 lg:px-8 py-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      {/* Left: object + client */}
                      <div className="min-w-0 flex-1 flex items-start gap-4">
                        {/* Object icon tile */}
                        <div className="hidden sm:grid w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 place-items-center text-white shadow-lg shadow-indigo-500/25 shrink-0">
                          <Building2 className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 text-slate-500 text-[10px] uppercase tracking-[0.18em] font-bold">
                            <Sparkles className="h-3 w-3 text-indigo-500" />
                            {t('object')}
                          </div>
                          <div className="text-3xl lg:text-4xl font-black tracking-tight text-slate-900 truncate">
                            {info.object || '—'}
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-slate-600 text-sm">
                            <User className="h-4 w-4 text-slate-400" />
                            <span className="font-semibold truncate">{fullName || '—'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: contract number + status */}
                      <div className="text-right shrink-0">
                        <div className="text-slate-500 text-[10px] uppercase tracking-[0.18em] font-bold mb-1">
                          {t('contractNumber')}
                        </div>
                        <div className="text-2xl font-black font-mono tracking-tight bg-gradient-to-br from-indigo-700 via-violet-700 to-fuchsia-700 bg-clip-text text-transparent">
                          {activeContract}
                        </div>
                        <span className={cn(
                          'inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-xs font-bold ring-1 ring-inset',
                          statusTone.cls,
                        )}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', statusTone.dot)} />
                          {statusName}
                        </span>
                      </div>
                    </div>

                    {/* Apartment chips */}
                    <div className="mt-5 flex items-center gap-2 flex-wrap">
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
                  gradient="from-indigo-500 to-violet-600"
                />
                <KpiCard
                  label={t('initialFee')}
                  value={formatMoney(initialPrice, 'UZS')}
                  meta={`${t('balance')}: ${formatMoney(initialLeft, 'UZS')}`}
                  metaTone={initialLeft === 0 ? 'emerald' : 'amber'}
                  pct={initialPct}
                  gradient="from-violet-500 to-purple-600"
                />
                <KpiCard
                  label={`${t('installment')} (${t('installmentMonths', { n: monthsCount })})`}
                  value={formatMoney(monthlyPrice, 'UZS')}
                  meta={`${t('balance')}: ${formatMoney(monthlyLeft, 'UZS')}`}
                  metaTone={monthlyLeft === 0 ? 'emerald' : 'amber'}
                  pct={monthlyPct}
                  gradient="from-blue-500 to-indigo-600"
                />
              </div>

              {/* ═══ Payment list (history) — accordion ═══ */}
              <Card className="border-0 shadow-soft overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white shadow-md shadow-amber-500/20">
                      <CreditCard className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-base font-bold tracking-tight text-slate-800">{t('paymentList')}</div>
                      <div className="text-[11px] text-slate-500">
                        <span className="text-slate-400">{t('totalPaidLabel')}: </span>
                        <span className="font-bold tabular-nums text-emerald-700">{formatMoney(totalPaid, 'UZS')}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <CardContent className="p-4 space-y-2">
                  {(detail.payment_histories || []).length === 0 ? (
                    <div className="px-5 py-10 text-center text-xs text-slate-500">{t('noHistory')}</div>
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
                          <div className="divide-y divide-slate-100">
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
                          <div className="divide-y divide-slate-100">
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
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-md shadow-indigo-500/20">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-base font-bold tracking-tight text-slate-800">
                        {t('scheduleTitle')}
                        {monthsCount > 0 && (
                          <span className="ml-2 text-[12px] font-medium text-slate-400">
                            ({t('installmentMonths', { n: monthsCount })})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <CardContent className="p-4 space-y-2">
                  {(detail.initial?.schedules || []).length === 0 && (detail.monthly?.schedules || []).length === 0 ? (
                    <div className="text-center py-10 text-xs text-slate-500">{t('noSchedule')}</div>
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

              {/* ═══ Client info — bottom strip ═══ */}
              {(fullName || client.phone || client.birth_date || client.passport_series || client.address) && (
                <Card className="border-0 shadow-soft overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow-md shadow-emerald-500/20">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="text-base font-bold tracking-tight text-slate-800">{t('openClient')}</div>
                  </div>
                  <CardContent className="p-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
                      <InfoRow icon={<User className="h-3.5 w-3.5" />} label={t('client')} value={fullName || '—'} />
                      {client.phone && (
                        <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label={t('phone')} value={String(client.phone)} mono />
                      )}
                      {client.birth_date && (
                        <InfoRow icon={<Calendar className="h-3.5 w-3.5" />} label={t('birthDate')} value={fmtDate(client.birth_date)} />
                      )}
                      {client.passport_series && (
                        <InfoRow icon={<FileText className="h-3.5 w-3.5" />} label={t('passport')} value={String(client.passport_series)} mono />
                      )}
                      {client.address && (
                        <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label={t('address')} value={String(client.address)} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ────────────────────────── helpers ──────────────────────────

function KpiCard({
  label, value, meta, metaTone, pct, gradient,
}: {
  label: string;
  value: string;
  meta?: string;
  metaTone?: 'emerald' | 'amber' | 'rose';
  pct: number;
  gradient: string;
}) {
  const metaMap = {
    emerald: 'text-emerald-700',
    amber:   'text-amber-700',
    rose:    'text-rose-700',
  } as const;
  return (
    <Card className="border-0 shadow-soft overflow-hidden group hover:shadow-lg transition-shadow">
      <div className={cn('h-1 bg-gradient-to-r', gradient)} />
      <CardContent className="p-5">
        <div className="text-[11px] uppercase tracking-[0.15em] font-bold text-slate-500 truncate">{label}</div>
        <div className="mt-1 text-2xl lg:text-[26px] font-black tabular-nums tracking-tight text-slate-900 truncate" title={value}>
          {value}
        </div>
        {meta && (
          <div className={cn('text-[11px] font-semibold tabular-nums mt-1 truncate', metaTone ? metaMap[metaTone] : 'text-slate-500')}>
            {meta}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700', gradient)} style={{ width: `${pct}%` }} />
          </div>
          <div className="text-[11px] font-bold tabular-nums text-slate-600 w-12 text-right">{pct.toFixed(1)}%</div>
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
    <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden bg-white">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full px-4 py-3 flex items-center gap-3 transition-colors text-left',
          open ? style.bg : 'hover:bg-slate-50',
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
          <div className="text-sm font-bold text-slate-800">
            {formatMoney(amount, 'UZS')}
            {amountTotal != null && amountTotal !== amount && (
              <span className="text-slate-400 font-normal"> / {formatMoney(amountTotal, 'UZS')}</span>
            )}
          </div>
        </div>
      </button>
      <div className={cn(
        'grid transition-[grid-template-rows] duration-300 ease-out',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}>
        <div className="overflow-hidden">
          <div className="border-t border-slate-100 bg-slate-50/30">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 ring-1 ring-slate-200 text-[11px] font-semibold text-slate-700 transition-colors">
      <span className="text-slate-400">{icon}</span>
      {label}
    </span>
  );
}

function MoneyTileLight({
  label, value, gradient, mute,
}: {
  label: string;
  value: string;
  gradient: string;
  mute?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={cn('w-1.5 h-4 rounded-full bg-gradient-to-b', gradient)} />
        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 truncate">{label}</div>
      </div>
      <div className={cn(
        'text-lg font-black tabular-nums tracking-tight truncate',
        mute ? 'text-slate-400' : 'bg-gradient-to-br bg-clip-text text-transparent',
        !mute && gradient,
      )}>{value}</div>
    </div>
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

  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}
      onMouseEnter={onHover}
      className={cn(
        'w-full px-4 py-2.5 text-left transition-colors flex items-center gap-3',
        active ? 'bg-indigo-50' : 'hover:bg-slate-50',
      )}
    >
      <div className={cn(
        'w-9 h-9 rounded-xl grid place-items-center shrink-0',
        active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500',
      )}>
        <FileText className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('font-mono text-[13px] font-bold truncate', active ? 'text-indigo-700' : 'text-slate-800')}>
            {contract}
          </span>
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
        <div className="text-[11px] text-slate-500 truncate mt-0.5">
          {obj}
          {obj && clientName && <span className="text-slate-300 mx-1">·</span>}
          {clientName}
        </div>
      </div>
      {price > 0 && (
        <div className="text-right shrink-0">
          <div className="text-[11px] font-bold tabular-nums text-slate-700">{formatMoney(price, 'UZS')}</div>
        </div>
      )}
      <ChevronRight className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-500' : 'text-slate-300')} />
    </button>
  );
}

// Toifa (kind) uchun ranglar — Boshlang'ich vs Oylik
const KIND_STYLE: Record<string, { bg: string; text: string; ring: string; bar: string; chipBg: string; chipText: string }> = {
  initial: {
    bg: 'bg-violet-50/60',
    text: 'text-violet-700',
    ring: 'ring-violet-200',
    bar: 'from-violet-500 to-purple-600',
    chipBg: 'bg-gradient-to-r from-violet-500 to-purple-600',
    chipText: 'text-white',
  },
  monthly: {
    bg: 'bg-blue-50/60',
    text: 'text-blue-700',
    ring: 'ring-blue-200',
    bar: 'from-blue-500 to-indigo-600',
    chipBg: 'bg-gradient-to-r from-blue-500 to-indigo-600',
    chipText: 'text-white',
  },
  other: {
    bg: 'bg-slate-50/60',
    text: 'text-slate-600',
    ring: 'ring-slate-200',
    bar: 'from-slate-400 to-slate-600',
    chipBg: 'bg-slate-200',
    chipText: 'text-slate-700',
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
      'group relative rounded-xl ring-1 ring-slate-200 bg-white hover:ring-indigo-300 hover:shadow-md transition-all overflow-hidden',
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
              <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-md bg-slate-100 text-[10px] font-bold text-slate-600 tabular-nums">
                #{idx}
              </span>
            )}
            <span className="text-[13px] font-bold tabular-nums text-slate-800">
              {fmtDate(item?.date_payment)}
            </span>
          </div>
          {paid > 0 && left > 0 && (
            <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-emerald-700 font-bold tabular-nums">{formatMoney(paid, 'UZS')}</span>
              </span>
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-amber-700 font-bold tabular-nums">{formatMoney(left, 'UZS')}</span>
              </span>
            </div>
          )}
        </div>

        <div className="text-right shrink-0 flex items-center gap-2">
          <div>
            <div className="text-sm font-black tabular-nums text-slate-900">{formatMoney(amount, 'UZS')}</div>
          </div>
          <ChevronDown className={cn(
            'h-4 w-4 text-slate-400 transition-transform duration-200 shrink-0',
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
          <div className="pl-4 pr-4 pb-3 pt-1 space-y-2 border-t border-slate-100 mt-1">
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
            <div className="rounded-lg bg-slate-50 ring-1 ring-slate-100 px-3 py-2 flex items-start gap-2">
              <Tag className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-slate-700 leading-relaxed">
                {purpose || <span className="text-slate-400 italic">{t('noPurpose')}</span>}
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
        className="w-full pl-4 pr-5 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-md bg-slate-100 text-[10px] font-bold text-slate-600 tabular-nums">
              #{idx}
            </span>
            <div className="text-sm font-black tabular-nums text-slate-900 truncate">
              {formatMoney(Number(h?.amount || 0), 'UZS')}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-[11px] text-slate-500 tabular-nums">{fmtDate(h?.date_paid)}</div>
            <ChevronDown className={cn(
              'h-3.5 w-3.5 text-slate-400 transition-transform duration-200',
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-semibold text-slate-700">
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
          <div className="pl-4 pr-5 pb-3 pt-1 space-y-2 border-t border-slate-100">
            {/* Purpose */}
            <div className="rounded-lg bg-gradient-to-br from-indigo-50/60 to-violet-50/30 ring-1 ring-indigo-100 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.15em] font-bold text-indigo-600 mb-1">
                <Tag className="h-3 w-3" />
                {t('purpose')}
              </div>
              <div className="text-[12px] text-slate-700 leading-relaxed">
                {purpose || <span className="text-slate-400 italic">{t('noPurpose')}</span>}
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
    slate:   'bg-slate-50 text-slate-800 ring-slate-200',
    emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    amber:   'bg-amber-50 text-amber-800 ring-amber-200',
    rose:    'bg-rose-50 text-rose-800 ring-rose-200',
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
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
      <div className="flex items-center gap-1.5 text-[12px] text-slate-500 shrink-0">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className={cn('text-[13px] text-slate-800 text-right truncate', mono && 'font-mono text-[12px]')}>
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
