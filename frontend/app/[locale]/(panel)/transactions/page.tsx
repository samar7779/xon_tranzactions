'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Wand2, Link2Off, EyeOff, MoreHorizontal, Download,
  ArrowDownLeft, ArrowUpRight, TrendingUp, ChevronLeft, ChevronRight,
  X, Calendar, Wallet, FileText, Eye, FileSpreadsheet, Copy, Check,
  Hash, Receipt, Link2, History, Loader2, AlertCircle,
  Wrench, Printer, ChevronDown, Tag, FileSignature, CheckCircle2,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { TransactionsTabs } from '@/components/transactions-tabs';
import { BankLogo } from '@/components/bank-logo';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Sparkline } from '@/components/sparkline';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { api, apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatDateTime, formatMoney, formatDate } from '@/lib/utils';

const MATCH_CLS: Record<string, string> = {
  AUTO:      'bg-emerald-50 text-emerald-700 ring-emerald-200',
  MANUAL:    'bg-blue-50 text-blue-700 ring-blue-200',
  PARTIAL:   'bg-amber-50 text-amber-700 ring-amber-200',
  IGNORED:   'bg-slate-50 text-slate-500 ring-slate-200',
  UNMATCHED: 'bg-rose-50 text-rose-700 ring-rose-200',
};
const MATCH_KEYS: Record<string, string> = {
  AUTO:      'matchStatusAUTO',
  MANUAL:    'matchStatusMANUAL',
  PARTIAL:   'matchStatusPARTIAL',
  IGNORED:   'matchStatusIGNORED',
  UNMATCHED: 'matchStatusUNMATCHED',
};

export default function TransactionsPage() {
  const t = useTranslations('transactions');
  const tc = useTranslations('common');
  const tp = useTranslations('payments');
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManagePayments = !!user?.permissions?.includes(PERMS.PAYMENTS_MANAGE);
  const canManageCategories = !!user?.permissions?.includes(PERMS.CATEGORIES_MANAGE);

  // URL filter persistence — refresh'da yo'qolmasligi uchun
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [page, setPage] = useState(() => Number(searchParams.get('page') || 1));
  const [perPage, setPerPage] = useState(() => Number(searchParams.get('perPage') || 25));
  const [q, setQ] = useState(() => searchParams.get('q') || '');
  const [direction, setDirection] = useState<string>(() => searchParams.get('direction') || 'all');
  const [matchStatus, setMatchStatus] = useState<string>(() => searchParams.get('matchStatus') || 'all');
  const [bankId, setBankId] = useState<string>(() => searchParams.get('bankId') || 'all');
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('dateTo') || '');

  // Filter o'zgarishlarini URL'ga yozish (browser refresh va back tugmasi uchun)
  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (direction !== 'all') params.set('direction', direction);
    if (matchStatus !== 'all') params.set('matchStatus', matchStatus);
    if (bankId !== 'all') params.set('bankId', bankId);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (page !== 1) params.set('page', String(page));
    if (perPage !== 25) params.set('perPage', String(perPage));
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  }, [q, direction, matchStatus, bankId, dateFrom, dateTo, page, perPage, pathname, router]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<any>(null);
  const [idSearchOpen, setIdSearchOpen] = useState(false);
  const [idQuery, setIdQuery] = useState('');
  const [idSearching, setIdSearching] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [categoryEditRow, setCategoryEditRow] = useState<any>(null);

  // Kategoriyalar daraxti (1 marta yuklanadi)
  const categoriesQuery = useQuery({
    queryKey: ['categories-tree'],
    queryFn: () => api.get<{ ok: boolean; items: any[] }>('/categorization/categories'),
    staleTime: 5 * 60 * 1000,
  });
  const categoriesTree = categoriesQuery.data?.items || [];

  const setCategoryMut = useMutation({
    mutationFn: (body: { txId: string; categoryId: string | null; subcategoryId: string | null }) =>
      api.post(`/categorization/transactions/${body.txId}/set`, {
        categoryId: body.categoryId,
        subcategoryId: body.subcategoryId,
      }),
    onSuccess: () => {
      toast.success('Kategoriya saqlandi');
      setCategoryEditRow(null);
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const recategorizeAllMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; started?: boolean; message?: string }>('/categorization/run-all'),
    onSuccess: (r: any) => {
      toast.success(r?.message || 'Kategoriyalash fonda boshlandi');
      setTimeout(() => qc.invalidateQueries({ queryKey: ['transactions'] }), 30_000);
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  async function searchById() {
    const id = idQuery.trim();
    if (!id) return;
    setIdSearching(true);
    try {
      const found = await api.get<any>(`/transactions/${encodeURIComponent(id)}`);
      if (found && found.id) {
        setDetailRow(found);
        setIdSearchOpen(false);
        setIdQuery('');
      } else {
        toast.error(t('idNotFound'));
      }
    } catch (e: any) {
      toast.error(e?.message || t('searchError'));
    } finally {
      setIdSearching(false);
    }
  }

  // Active filter count
  const activeFilters = useMemo(() => {
    let c = 0;
    if (direction !== 'all') c++;
    if (matchStatus !== 'all') c++;
    if (bankId !== 'all') c++;
    if (dateFrom) c++;
    if (dateTo) c++;
    return c;
  }, [direction, matchStatus, bankId, dateFrom, dateTo]);

  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (q) params.set('q', q);
  if (direction !== 'all') params.set('direction', direction);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (bankId !== 'all') params.set('bankId', bankId);

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', page, perPage, q, direction, matchStatus, dateFrom, dateTo, bankId],
    queryFn: () => api.get<{ items: any[]; total: number; page: number; perPage: number }>(`/transactions?${params}`),
  });
  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });
  const { data: stats } = useQuery({
    queryKey: ['tx-stats-30d'],
    queryFn: () => {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      return api.get<any>(`/transactions/stats?from=${from.toISOString().slice(0, 10)}`);
    },
  });

  // Client-side match filter (server doesn't support it yet)
  const filtered = matchStatus === 'all'
    ? data?.items
    : data?.items.filter((it) => (it.matchStatus || 'UNMATCHED') === matchStatus);

  const autoMatchMut = useMutation({
    mutationFn: (id: string) => api.post(`/payments/auto-match/${id}`),
    onSuccess: (r: any) => {
      if (r.ok) toast.success(t('matchedToast', { name: r.customer.name }));
      else toast.message(r.error || t('matchFailed'));
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (e: any) => toast.error(e?.message),
  });
  const unlinkMut = useMutation({
    mutationFn: (id: string) => api.delete(`/payments/link/${id}`),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['transactions'] }); },
    onError: (e: any) => toast.error(e?.message),
  });
  const ignoreMut = useMutation({
    mutationFn: (id: string) => api.post(`/payments/ignore/${id}`),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['transactions'] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  // 30-day KPI
  const inSum = (stats?.groups || []).filter((g: any) => g.direction === 'IN').reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const outSum = (stats?.groups || []).filter((g: any) => g.direction === 'OUT').reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  // stats.total — backend'dan to'g'ridan-to'g'ri count; groups[]._count raqam (obyekt emas)
  const txnCount = stats?.total ?? (stats?.groups || []).reduce((s: number, g: any) => s + Number(typeof g._count === 'number' ? g._count : g._count?._all || 0), 0);
  const net = inSum - outSum;

  // Mock sparkline data (for visual continuity until backend serves daily breakdown)
  const spark = (factor: number) => Array.from({ length: 24 }).map((_, i) =>
    Math.round(40 + Math.sin(i / 2.5) * 25 + Math.cos(i / 1.7) * 18 + Math.random() * 10) * factor);

  // Filtr bo'yicha BARCHA tranzaksiyalar — backend Excel qiladi (joriy sahifa emas)
  async function exportExcel() {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (direction !== 'all') p.set('direction', direction);
    if (matchStatus !== 'all') p.set('matchStatus', matchStatus);
    if (bankId !== 'all') p.set('bankId', bankId);
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    try {
      toast.loading(t('excelPreparing'), { id: 'tx-export' });
      await apiDownload(`/transactions/export?${p}`, `tranzaksiyalar-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(t('excelDownloaded'), { id: 'tx-export' });
    } catch (e: any) {
      toast.error(e?.message || t('exportError'), { id: 'tx-export' });
    }
  }

  function exportCsv() {
    if (!data?.items?.length) return toast.error(t('noDataExport'));
    const rows = [
      ['Sana', 'Yo\'nalish', 'Bank', 'Yuboruvchi', 'STIR', 'Qabul qiluvchi', 'Hisob', 'Summa', 'Valyuta', 'Match', 'Tavsif'],
      ...data.items.map((it) => [
        formatDateTime(it.txnDate),
        it.direction === 'IN' ? 'Kirim' : 'Chiqim',
        it.account?.bank?.name || '',
        it.fromName || '',
        it.fromInn || '',
        it.toName || '',
        it.toAccount || '',
        it.amount,
        it.currency,
        tp(MATCH_KEYS[it.matchStatus || 'UNMATCHED']),
        it.description || '',
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t('csvReady'));
  }

  function exportJson() {
    if (!data?.items?.length) return toast.error(t('noDataExport'));
    const blob = new Blob([JSON.stringify(data.items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('jsonReady'));
  }

  function exportPrint() {
    window.print();
  }

  function clearFilters() {
    setDirection('all'); setMatchStatus('all'); setBankId('all');
    setDateFrom(''); setDateTo(''); setQ(''); setPage(1);
  }

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <TransactionsTabs />

      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full">

        {/* ═══ KPI ROW ═══ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label={t('kpiIn30')}
            value={formatMoney(inSum)}
            icon={ArrowDownLeft}
            color="emerald"
            spark={spark(1.2)}
          />
          <StatCard
            label={t('kpiOut30')}
            value={formatMoney(outSum)}
            icon={ArrowUpRight}
            color="rose"
            spark={spark(0.9)}
          />
          <StatCard
            label={t('kpiNet')}
            value={(net >= 0 ? '+' : '') + formatMoney(net)}
            icon={TrendingUp}
            color={net >= 0 ? 'indigo' : 'rose'}
            spark={spark(1)}
          />
          <StatCard
            label={t('kpiCount')}
            value={String(txnCount)}
            icon={Wallet}
            color="amber"
            spark={spark(0.6)}
          />
        </div>

        {/* ═══ FILTER BAR ═══ */}
        <Card className="border-0 shadow-soft overflow-visible">
          <CardContent className="p-4 lg:p-5">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Qidiruv — fokuslanganda animatsion gradient halqa + glow */}
              <div className="relative flex-1 min-w-[240px] group/search">
                {/* Tashqi gradient halqa — fokuslanganda paydo bo'ladi */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition-opacity duration-300 group-focus-within/search:opacity-100"
                  style={{
                    background: 'conic-gradient(from var(--angle, 0deg), #6366f1, #06b6d4, #10b981, #6366f1)',
                    filter: 'blur(0.5px)',
                    animation: 'searchRing 6s linear infinite',
                  }}
                />
                <Search className={cn(
                  'absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors duration-300 z-10',
                  q ? 'text-indigo-500' : 'text-slate-400 group-focus-within/search:text-indigo-500',
                )} />
                <Input
                  className={cn(
                    'relative pl-9 h-10 rounded-xl bg-slate-50/60 border-slate-200',
                    'transition-all duration-300',
                    'focus-visible:bg-white focus-visible:ring-0 focus-visible:ring-offset-0',
                    'focus-visible:shadow-[0_0_0_3px_rgba(99,102,241,0.12),0_8px_24px_-8px_rgba(99,102,241,0.35)]',
                    'focus-visible:border-indigo-300',
                    'hover:border-slate-300',
                  )}
                  placeholder={t('searchPlaceholder')}
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setPage(1); }}
                />
                {q && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full grid place-items-center text-slate-400 hover:text-white hover:bg-rose-500 transition-colors z-10"
                    onClick={() => setQ('')}
                    aria-label={tc('reset')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                <style jsx>{`
                  @keyframes searchRing {
                    to { --angle: 360deg; }
                  }
                  @property --angle {
                    syntax: '<angle>';
                    initial-value: 0deg;
                    inherits: false;
                  }
                `}</style>
              </div>

              {/* Asboblar — bitta dropdown ichida: Tarix, ID, Eksport */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title={t('toolsTitle')}
                    className={cn(
                      'inline-flex items-center justify-center w-10 h-10 rounded-xl shrink-0',
                      'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
                      'shadow-sm hover:shadow-lg hover:shadow-indigo-500/30',
                      'transition-all duration-200 hover:scale-105 active:scale-95',
                      'ring-1 ring-indigo-400/30',
                    )}
                  >
                    <Wrench className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">{t('tools')}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setBackfillOpen(true)} className="cursor-pointer">
                    <History className="h-4 w-4 mr-2 text-indigo-600" />
                    <span className="flex-1">{t('toolBackfill')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIdSearchOpen(true)} className="cursor-pointer">
                    <Hash className="h-4 w-4 mr-2 text-violet-600" />
                    <span className="flex-1">{t('toolIdSearch')}</span>
                  </DropdownMenuItem>
                  {canManageCategories && (
                    <DropdownMenuItem
                      onClick={() => recategorizeAllMut.mutate()}
                      disabled={recategorizeAllMut.isPending}
                      className="cursor-pointer"
                    >
                      {recategorizeAllMut.isPending
                        ? <Loader2 className="h-4 w-4 mr-2 animate-spin text-amber-600" />
                        : <Wand2 className="h-4 w-4 mr-2 text-amber-600" />}
                      <span className="flex-1">Kategoriyalarni qayta hisoblash</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">{t('exportByFilter')}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={exportExcel} className="cursor-pointer">
                    <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-600" />
                    <span className="flex-1">{t('exportExcelAll')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">{t('currentPage')}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={exportCsv} className="cursor-pointer">
                    <FileSpreadsheet className="h-4 w-4 mr-2 text-slate-500" />
                    <span className="flex-1">CSV</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={exportJson} className="cursor-pointer">
                    <FileText className="h-4 w-4 mr-2 text-blue-600" />
                    <span className="flex-1">JSON</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={exportPrint} className="cursor-pointer">
                    <Printer className="h-4 w-4 mr-2 text-slate-600" />
                    <span className="flex-1">{t('exportPrint')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <FilterChip
                active={direction !== 'all'}
                label={direction === 'IN' ? t('dirIn') : direction === 'OUT' ? t('dirOut') : t('directionAll')}
                value={direction}
                onChange={(v) => { setDirection(v); setPage(1); }}
                options={[
                  { value: 'all', label: tc('all') },
                  { value: 'IN', label: t('dirIn') },
                  { value: 'OUT', label: t('dirOut') },
                ]}
              />

              <FilterChip
                active={bankId !== 'all'}
                label={bankId === 'all' ? t('bankAll') : (banks?.items.find((b: any) => b.id === bankId)?.name || t('bankAll'))}
                value={bankId}
                onChange={(v) => { setBankId(v); setPage(1); }}
                options={[
                  { value: 'all', label: tc('all') },
                  // Aktiv banklar boshida
                  ...[...(banks?.items || [])]
                    .sort((a: any, b: any) => {
                      if (a.isActive && !b.isActive) return -1;
                      if (!a.isActive && b.isActive) return 1;
                      return a.name.localeCompare(b.name);
                    })
                    .map((b: any) => ({ value: b.id, label: b.isActive ? `● ${b.name}` : b.name })),
                ]}
              />

              <FilterChip
                active={matchStatus !== 'all'}
                label={matchStatus === 'all' ? t('matchAll') : tp(MATCH_KEYS[matchStatus])}
                value={matchStatus}
                onChange={(v) => { setMatchStatus(v); setPage(1); }}
                options={[
                  { value: 'all', label: tc('all') },
                  { value: 'AUTO', label: tp('matchStatusAUTO') },
                  { value: 'MANUAL', label: tp('matchStatusMANUAL') },
                  { value: 'PARTIAL', label: tp('matchStatusPARTIAL') },
                  { value: 'UNMATCHED', label: tp('matchStatusUNMATCHED') },
                  { value: 'IGNORED', label: tp('matchStatusIGNORED') },
                ]}
              />

              <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
                <DropdownMenuTrigger asChild>
                  <button className={cn(
                    "inline-flex items-center gap-2 h-10 px-3.5 rounded-xl text-sm font-medium transition-colors",
                    (dateFrom || dateTo)
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                      : "bg-slate-50 hover:bg-slate-100 text-slate-700 ring-1 ring-slate-200",
                  )}>
                    <Calendar className="h-4 w-4" />
                    {dateFrom || dateTo ? `${dateFrom || '...'} → ${dateTo || '...'}` : t('dateRange')}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="p-3 w-72">
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{tc('from')}</div>
                      <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{tc('to')}</div>
                      <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-9" />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => { setDateFrom(''); setDateTo(''); }}>{tc('reset')}</Button>
                      <Button size="sm" className="flex-1" onClick={() => setFilterOpen(false)}>{t('apply')}</Button>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {(activeFilters > 0 || q) && (
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-900 hover:bg-rose-100 hover:text-rose-700 ring-1 ring-amber-300 hover:ring-rose-300 text-[12px] font-semibold transition-colors animate-pulse-once"
                  title="Faol filtrlarni tozalash"
                >
                  <X className="h-3.5 w-3.5" />
                  {t('clearN')} ({activeFilters + (q ? 1 : 0)})
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ═══ TABLE ═══ */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : (filtered?.length ?? 0) === 0 ? (
              <EmptyState
                icon={Wallet}
                title={t('notFoundTitle')}
                description={q || activeFilters > 0 ? t('noDataChangeFilters') : t('noDataYet')}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                      <th className="text-left px-4 py-3">{t('bankAccountHeader')}</th>
                      <th className="text-left px-4 py-3 w-40">{t('dateTimeHeader')}</th>
                      <th className="text-left px-4 py-3">Hisob nomi</th>
                      <th className="text-left px-4 py-3 w-24">{t('directionHeader')}</th>
                      <th className="text-left px-4 py-3 w-40">Kontragent</th>
                      <th className="text-left px-4 py-3 w-40">Kategoriya</th>
                      <th className="text-left px-4 py-3 w-32">Shartnoma</th>
                      <th className="text-right px-4 py-3">{t('amountHeader')}</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered!.map((it: any) => {
                      const counterparty = it.direction === 'IN'
                        ? { name: it.fromName || '—', meta: it.fromInn || '' }
                        : { name: it.toName || '—', meta: it.toAccount || '' };
                      const initial = (counterparty.name || '?').charAt(0).toUpperCase();

                      return (
                        <tr key={it.id}
                          className="group hover:bg-slate-50/60 transition-colors cursor-pointer"
                          onClick={() => setDetailRow(it)}
                        >
                          {/* 1) Bank · Hisob */}
                          <td className="px-4 py-3 max-w-[220px]">
                            <div className="flex items-center gap-2">
                              <BankLogo code={it.account?.bank?.code || it.bank?.code || ''} name={it.account?.bank?.name || it.bank?.name} size={28} rounded="rounded-lg" />
                              <div className="min-w-0">
                                <div className="text-[12px] font-medium truncate">{it.account?.bank?.name || it.bank?.name || '—'}</div>
                                {it.account?.ownerName && (
                                  <div className="text-[10px] text-slate-600 truncate">{it.account.ownerName}</div>
                                )}
                                <div className="font-mono text-[10px] text-slate-400 truncate">{it.account?.accountNo || ''}</div>
                              </div>
                            </div>
                          </td>
                          {/* 2) Sana / Vaqt */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-[13px] font-medium tabular-nums">{formatDate(it.txnDate)}</div>
                            <div className="text-[10px] text-slate-500 tabular-nums">
                              {it.operationTime
                                ? it.operationTime.slice(0, 5)
                                : (it.inputAt
                                    ? new Date(it.inputAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
                                    : '—')}
                            </div>
                          </td>
                          {/* 3) Hisob nomi (raw fromName/toName) */}
                          <td className="px-4 py-3 max-w-[280px]">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className={cn(
                                "w-8 h-8 rounded-full grid place-items-center text-white text-xs font-bold shrink-0",
                                it.direction === 'IN'
                                  ? 'bg-gradient-to-br from-emerald-400 to-teal-500'
                                  : 'bg-gradient-to-br from-rose-400 to-red-500',
                              )}>
                                {initial}
                              </div>
                              <div className="min-w-0">
                                <div className="text-[13px] font-medium truncate">{counterparty.name}</div>
                                {counterparty.meta && (
                                  <div className="font-mono text-[10px] text-slate-500 truncate">{counterparty.meta}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          {/* 4) Yo'nalish */}
                          <td className="px-4 py-3">
                            <span className={cn(
                              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ring-inset",
                              it.direction === 'IN'
                                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                : "bg-rose-50 text-rose-700 ring-rose-200",
                            )}>
                              {it.direction === 'IN'
                                ? <><ArrowDownLeft className="h-3 w-3" /> {t('dirIn')}</>
                                : <><ArrowUpRight className="h-3 w-3" /> {t('dirOut')}</>}
                            </span>
                          </td>
                          {/* Kontragent — faqat ko'rinish, edit Tafsilot ichidan */}
                          <td className="px-4 py-3 max-w-[160px]">
                            <KontragentChip
                              display={it.counterpartyDisplay}
                              category={it.category}
                              onClick={() => {}}
                              canEdit={false}
                            />
                          </td>
                          {/* Kategoriya — faqat ko'rinish */}
                          <td className="px-4 py-3 max-w-[160px]">
                            <CategoryChip
                              category={it.subcategory || it.category}
                              parentColor={it.category?.color}
                              onClick={() => {}}
                              canEdit={false}
                              placeholder={it.category ? '—' : ''}
                            />
                          </td>
                          {/* Shartnoma */}
                          <td className="px-4 py-3">
                            {it.contractNumber ? (
                              <div className="flex flex-col gap-0.5">
                                <code
                                  className={cn(
                                    "inline-block w-fit font-mono text-[11px] font-bold px-1.5 py-0.5 rounded ring-1",
                                    it.contractStatus === 'unverified'
                                      ? 'text-rose-700 bg-rose-50 ring-rose-200'
                                      : 'text-indigo-700 bg-indigo-50 ring-indigo-200',
                                  )}
                                  title={it.contractStatus === 'unverified' ? 'CRM\'da topilmadi (xato)' : it.contractCustomer || ''}
                                >
                                  {it.contractNumber}
                                </code>
                                {it.contractStatus === 'unverified' && (
                                  <span className="text-[9px] text-rose-600 font-semibold uppercase tracking-wider">xato</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-300">—</span>
                            )}
                          </td>
                          <td className={cn(
                            "px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap",
                            it.direction === 'IN' ? 'text-emerald-600' : 'text-rose-600',
                          )}>
                            {it.direction === 'IN' ? '+' : '−'}{formatMoney(it.amount, it.currency)}
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <CopyIdButton value={it.externalId || it.id} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ═══ PAGINATION ═══ */}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-xs text-slate-500">
              <span className="font-semibold text-slate-700 tabular-nums">{((page - 1) * perPage) + 1}–{Math.min(page * perPage, data.total)}</span> / {t('ofTotal', { n: data.total })}
            </div>
            <div className="flex items-center gap-3">
              <Select value={String(perPage)} onValueChange={(v) => { setPerPage(Number(v)); setPage(1); }}>
                <SelectTrigger className="w-24 h-9 rounded-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">{t('perPage', { n: 10 })}</SelectItem>
                  <SelectItem value="25">{t('perPage', { n: 25 })}</SelectItem>
                  <SelectItem value="50">{t('perPage', { n: 50 })}</SelectItem>
                  <SelectItem value="100">{t('perPage', { n: 100 })}</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)} className="h-9 w-9 p-0 rounded-full">
                  «
                </Button>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-9 w-9 p-0 rounded-full">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-xs font-semibold tabular-nums px-3">{page} / {totalPages}</div>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-9 w-9 p-0 rounded-full">
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="h-9 w-9 p-0 rounded-full">
                  »
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ DETAIL MODAL ═══ */}
      <TransactionDetailDialog
        row={detailRow}
        onClose={() => setDetailRow(null)}
        canManage={canManageCategories}
      />

      {/* ═══ ESKI TARIXNI YUKLASH (BACKFILL) ═══ */}
      <BackfillDialog open={backfillOpen} onOpenChange={setBackfillOpen} banks={banks?.items || []} />

      {/* ═══ KATEGORIYANI O'ZGARTIRISH ═══ */}
      <CategoryEditDialog
        row={categoryEditRow}
        tree={categoriesTree}
        onClose={() => setCategoryEditRow(null)}
        onSave={(categoryId, subcategoryId) =>
          setCategoryMut.mutate({ txId: categoryEditRow.id, categoryId, subcategoryId })
        }
        saving={setCategoryMut.isPending}
      />

      {/* ═══ TRANZAKSIYA ID QIDIRUV ═══ */}
      <Dialog open={idSearchOpen} onOpenChange={setIdSearchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-indigo-600" /> {t('idDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('idDialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={idQuery}
              onChange={(e) => setIdQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') searchById(); }}
              placeholder={t('idDialogPlaceholder')}
              className="font-mono text-xs"
            />
            <Button onClick={searchById} disabled={idSearching || !idQuery.trim()} className="shrink-0">
              {idSearching ? '...' : t('findBtn')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ────────────── Components ──────────────

// Eski tarixni yuklash — sana oralig'i bo'yicha bankdan olib bazaga yozadi
function BackfillDialog({ open, onOpenChange, banks }: { open: boolean; onOpenChange: (o: boolean) => void; banks: any[] }) {
  const [scope, setScope] = useState<'all' | 'bank' | 'account'>('all');
  const [bankId, setBankId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accSearch, setAccSearch] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);

  const { data: accounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<{ items: any[] }>('/bank-accounts'),
    enabled: open,
  });
  const bankAccounts = useMemo(() => {
    let list = (accounts?.items || []).filter((a: any) => !bankId || a.bankId === bankId);
    const q = accSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((a: any) =>
        a.accountNo?.toLowerCase().includes(q) ||
        a.ownerName?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [accounts, bankId, accSearch]);

  const [progress, setProgress] = useState<{ total: number; days: number; startedAt: string } | null>(null);

  // To'xtab qolishni aniqlash uchun (deploy/crash server jarayonini o'ldiradi)
  const prevDoneRef = useRef(0);
  const [lastAdvanceAt, setLastAdvanceAt] = useState(Date.now());
  const [, forceTick] = useState(0);

  const mut = useMutation({
    mutationFn: () => api.post<any>('/sync/backfill', {
      scope,
      bankId: scope === 'bank' ? bankId : undefined,
      accountId: scope === 'account' ? accountId : undefined,
      dateFrom,
      dateTo,
    }),
    onSuccess: (r: any) => {
      if (r?.ok && r?.started) {
        setProgress({ total: r.accounts, days: r.days, startedAt: r.startedAt });
        prevDoneRef.current = 0;
        setLastAdvanceAt(Date.now());
      } else {
        toast.error(r?.error || 'Xato');
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  // Jarayon holatini kuzatish — har 2 soniyada
  const { data: statusData } = useQuery({
    queryKey: ['backfill-status', progress?.startedAt],
    queryFn: () => api.get<{ items: any[] }>(`/sync/backfill/status?since=${encodeURIComponent(progress!.startedAt)}`),
    enabled: !!progress,
    refetchInterval: 2000,
  });
  const logs = statusData?.items || [];
  const doneCount = logs.filter((l: any) => l.status !== 'RUNNING').length;
  const totalFetched = logs.reduce((s: number, l: any) => s + (l.fetched || 0), 0);
  const totalSaved = logs.reduce((s: number, l: any) => s + (l.saved || 0), 0);
  const totalErrors = logs.reduce((s: number, l: any) => s + (l.errors || 0), 0);
  const allDone = !!progress && doneCount >= progress.total;
  const pct = progress ? Math.round((doneCount / Math.max(1, progress.total)) * 100) : 0;

  // ─── To'xtab qolishni aniqlash ───
  // Backfill server jarayonida ishlaydi; server qayta ishga tushsa (deploy/crash)
  // jarayon o'rtada o'ladi. Agar 30s davomida progress o'zgarmasa — "to'xtagan" deb belgilaymiz.
  useEffect(() => {
    if (doneCount !== prevDoneRef.current) {
      prevDoneRef.current = doneCount;
      setLastAdvanceAt(Date.now());
    }
  }, [doneCount]);

  useEffect(() => {
    if (!progress || allDone) return;
    const id = setInterval(() => forceTick((t) => t + 1), 4000);
    return () => clearInterval(id);
  }, [progress, allDone]);

  const stalled =
    !!progress && !allDone && doneCount > 0 && Date.now() - lastAdvanceAt > 30_000;

  const valid = !!dateFrom && !!dateTo && dateFrom <= dateTo
    && (scope !== 'bank' || !!bankId)
    && (scope !== 'account' || !!accountId);

  // Sync log source'idan hisob nomini ajratib olamiz (· backfill ... qismini tashlaymiz)
  const accLabel = (src: string) => (src || '').split(' · backfill')[0];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent className={progress ? 'max-w-lg' : 'max-w-md'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-indigo-600" /> Eski tarixni yuklash
          </DialogTitle>
          <DialogDescription>
            {stalled
              ? 'Jarayon to\'xtab qolgan ko\'rinadi'
              : progress
                ? 'Jarayon davom etmoqda — oynani yopsangiz ham fonda ishlayveradi'
                : "Tanlangan sana oralig'idagi tranzaksiyalar bankdan olinib bazaga yoziladi"}
          </DialogDescription>
        </DialogHeader>

        {progress ? (
          /* ─── JARAYON KO'RINISHI ─── */
          <div className="space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] font-semibold text-slate-700">
                  {doneCount} / {progress.total} hisob bajarildi
                </span>
                <span className="text-[12px] font-bold tabular-nums text-indigo-600">{pct}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', allDone ? 'bg-emerald-500' : 'bg-indigo-500')}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-[10px] text-slate-400 mt-1">{progress.days} kun · {scope === 'all' ? 'barcha hisob' : scope === 'bank' ? 'bank bo\'yicha' : 'bitta hisob'}</div>
            </div>

            {/* 3 ta jami */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-100 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Olindi</div>
                <div className="text-lg font-bold tabular-nums text-slate-800">{totalFetched}</div>
              </div>
              <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-100 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-emerald-600 font-bold">Yangi qo'shildi</div>
                <div className="text-lg font-bold tabular-nums text-emerald-700">{totalSaved}</div>
              </div>
              <div className="rounded-xl bg-rose-50 ring-1 ring-rose-100 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-rose-600 font-bold">Xato</div>
                <div className="text-lg font-bold tabular-nums text-rose-700">{totalErrors}</div>
              </div>
            </div>

            {/* Hisoblar ro'yxati */}
            <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-50 text-[10px] uppercase tracking-wider font-semibold text-slate-500 flex items-center justify-between">
                <span>Hisoblar bo'yicha</span>
                <span>{logs.length} ta yozuv</span>
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
                {logs.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[11px] text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Boshlanmoqda...
                  </div>
                ) : (
                  logs.map((l: any) => {
                    const running = l.status === 'RUNNING';
                    const failed = l.status === 'FAILED';
                    return (
                      <div key={l.id} className="px-3 py-2 flex items-center gap-2">
                        {running ? (
                          <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin shrink-0" />
                        ) : failed ? (
                          <span className="w-3.5 h-3.5 rounded-full bg-rose-500 shrink-0 grid place-items-center text-white text-[8px]">✕</span>
                        ) : (
                          <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        )}
                        <span className="font-mono text-[11px] text-slate-700 truncate flex-1" title={accLabel(l.source)}>
                          {accLabel(l.source)}
                        </span>
                        {l.errorMessage ? (
                          <span className="text-[10px] text-rose-600 truncate max-w-[120px]" title={l.errorMessage}>
                            {l.errorMessage}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                            {l.fetched ?? 0} olindi · <span className="text-emerald-600 font-semibold">{l.saved ?? 0} yangi</span>
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {allDone && (
              <div className="text-[11px] text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" /> Tugadi — {totalSaved} ta yangi tranzaksiya qo'shildi
              </div>
            )}

            {stalled && (
              <div className="text-[11px] text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertCircle className="h-3.5 w-3.5" /> Jarayon to'xtab qolgan
                </div>
                <div className="mt-0.5 text-amber-700">
                  Server qayta ishga tushgan bo'lishi mumkin. {doneCount} / {progress.total} hisob
                  bajarilgan. Qaytadan boshlasangiz — qolganlari yuklanadi (allaqachon yuklangan
                  hisoblar takrorlanmaydi, faqat tekshiriladi).
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              {allDone ? (
                <Button onClick={() => { setProgress(null); onOpenChange(false); }}>Yopish</Button>
              ) : stalled ? (
                <>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>Yopish</Button>
                  <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
                    {mut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <History className="h-4 w-4 mr-1.5" />}
                    Qaytadan boshlash
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => onOpenChange(false)}>Fonda davom etsin · yopish</Button>
              )}
            </div>
          </div>
        ) : (
          /* ─── FORMA ─── */
          <>
            <div className="space-y-4">
              {/* Qamrov */}
              <div className="space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Qamrov</div>
                <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-[11px] font-medium w-full">
                  {[
                    { v: 'all', l: 'Barcha hisob' },
                    { v: 'bank', l: "Bank bo'yicha" },
                    { v: 'account', l: 'Bitta hisob' },
                  ].map((o) => (
                    <button
                      key={o.v}
                      onClick={() => setScope(o.v as any)}
                      className={cn(
                        'flex-1 px-2 h-8 rounded-lg transition-colors',
                        scope === o.v ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>

              {(scope === 'bank' || scope === 'account') && (
                <div className="space-y-1.5">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Bank</div>
                  <Select value={bankId} onValueChange={(v) => { setBankId(v); setAccountId(''); }}>
                    <SelectTrigger><SelectValue placeholder="Bankni tanlang" /></SelectTrigger>
                    <SelectContent>
                      {banks.filter((b: any) => b.isActive).map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {scope === 'account' && (
                <div className="space-y-1.5">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Hisob</div>
                  <Select value={accountId} onValueChange={setAccountId} disabled={!bankId}>
                    <SelectTrigger>
                      <SelectValue placeholder={bankId ? 'Hisobni tanlang' : 'Avval bankni tanlang'} />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="px-1.5 pt-1.5 pb-1 sticky top-0 bg-white z-10">
                        <Input
                          value={accSearch}
                          onChange={(e) => setAccSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          placeholder="Hisob raqami yoki egasi..."
                          className="h-8 text-[11px]"
                        />
                      </div>
                      {bankAccounts.length === 0 ? (
                        <div className="px-3 py-2 text-[11px] text-slate-400">Topilmadi</div>
                      ) : (
                        bankAccounts.slice(0, 100).map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>
                            <span className="flex flex-col text-left">
                              <span className="font-mono text-xs">{a.accountNo}</span>
                              <span className="text-[10px] text-slate-500">{a.ownerName || '—'}</span>
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Sana oralig'i */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Dan</div>
                  <Input type="date" value={dateFrom} max={dateTo || today} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Gacha</div>
                  <Input type="date" value={dateTo} min={dateFrom} max={today} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>

              <div className="text-[10px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-lg px-3 py-2 leading-relaxed">
                ⚠ Katta oraliq + ko'p hisob uzoq davom etadi. Boshlangach jarayon shu yerda jonli ko'rsatiladi.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Bekor qilish</Button>
              <Button onClick={() => mut.mutate()} disabled={!valid || mut.isPending}>
                {mut.isPending
                  ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Boshlanmoqda...</>
                  : 'Yuklashni boshlash'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  label, value, icon: Icon, color, spark,
}: {
  label: string;
  value: string;
  icon: any;
  color: 'emerald' | 'rose' | 'indigo' | 'amber';
  spark: number[];
}) {
  const m = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100', accent: '#10b981' },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-600',    ring: 'ring-rose-100',    accent: '#f43f5e' },
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600',  ring: 'ring-indigo-100',  accent: '#6366f1' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   ring: 'ring-amber-100',   accent: '#f59e0b' },
  }[color];
  return (
    <Card className="border-0 shadow-soft card-hover overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-2">
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500">{label}</div>
          <div className={cn("w-9 h-9 rounded-xl grid place-items-center ring-1", m.bg, m.text, m.ring)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
        <div className="mt-2 -mx-1">
          <Sparkline data={spark} width={200} height={36} stroke={m.accent} fill={m.accent} />
        </div>
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active, label, value, onChange, options,
}: {
  active: boolean;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn(
        "h-10 rounded-xl text-sm font-medium w-auto min-w-[140px] transition-colors",
        active
          ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 border-0"
          : "bg-slate-50 hover:bg-slate-100 text-slate-700 ring-1 ring-slate-200 border-0",
      )}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TransactionDetailDialog({ row, onClose, canManage }: { row: any; onClose: () => void; canManage: boolean }) {
  const t = useTranslations('transactions');
  const qc = useQueryClient();
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [categorizeLog, setCategorizeLog] = useState<any>(null);
  const [manualEditOpen, setManualEditOpen] = useState(false);

  // Tafsilot uchun jonli ma'lumot — categorize/setManual'dan keyin yangilanadi
  const liveQuery = useQuery({
    queryKey: ['tx-detail', row?.id],
    queryFn: () => api.get<any>(`/transactions/${row.id}`),
    enabled: !!row?.id,
    initialData: row,
    staleTime: 30_000,
  });
  const liveRow = liveQuery.data || row;

  // Kategoriyalar daraxti (manual edit uchun)
  const categoriesQuery = useQuery({
    queryKey: ['categories-tree'],
    queryFn: () => api.get<{ ok: boolean; items: any[] }>('/categorization/categories'),
    staleTime: 5 * 60 * 1000,
  });
  const categoriesTree = categoriesQuery.data?.items || [];

  const setCategoryMut = useMutation({
    mutationFn: (body: { categoryId: string | null; subcategoryId: string | null }) =>
      api.post(`/categorization/transactions/${row.id}/set`, body),
    onSuccess: () => {
      toast.success('Kategoriya saqlandi');
      setManualEditOpen(false);
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['tx-category-history', row.id] });
      liveQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const SECTION_KEYS = ['sender', 'receiver', 'purpose', 'time', 'system', 'raw'];
  const allOpen = SECTION_KEYS.every((k) => openSections.has(k));

  function toggleAll() {
    if (allOpen) setOpenSections(new Set());
    else setOpenSections(new Set(SECTION_KEYS));
  }
  function toggleOne(k: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  // Yangi tranzaksiya — log/ochilgan bo'limlarni reset qilamiz
  useEffect(() => {
    setCategorizeLog(null);
    setOpenSections(new Set());
  }, [row?.id]);

  const categorizeMut = useMutation({
    mutationFn: (force: boolean) =>
      api.post<any>(`/categorization/transactions/${row.id}/categorize${force ? '?force=true' : ''}`),
    onSuccess: (r: any) => {
      setCategorizeLog(r);
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['tx-category-history', row.id] });
      // Tafsilotni qayta yuklash — Kategoriya/Shartnoma darrov ko'rinadi
      liveQuery.refetch();
    },
    onError: (e: any) => setCategorizeLog({ ok: false, error: e?.message || 'Xato' }),
  });

  if (!row) return null;
  const isIn = row.direction === 'IN';
  const counterpartyName = isIn ? row.fromName : row.toName;
  const counterpartyInn = isIn ? row.fromInn : row.toInn;
  const catColor = row.category?.color || '#6366f1';

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden max-h-[90vh] flex flex-col gap-0 [&>button]:hidden">
        {/* ─── Header ─── */}
        <div className={cn(
          "relative px-6 py-5 shrink-0",
          isIn ? 'bg-gradient-to-br from-emerald-600 to-teal-700' : 'bg-gradient-to-br from-rose-600 to-red-700',
        )}>
          <div className="absolute inset-0 bg-dots opacity-15" />
          <div className="relative text-white">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-[11px] font-bold">
                  {isIn ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                  {isIn ? t('detailIncoming') : t('detailOutgoing')}
                </span>
                <span className="text-[11px] text-white/80 tabular-nums">
                  {formatDate(row.txnDate)}{row.operationTime ? ` · ${row.operationTime}` : ''}
                </span>
                {row.isAnor && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-300/25 text-amber-100 ring-1 ring-amber-200/40">
                    ⚡ ANOR 24/7
                  </span>
                )}
              </div>
              <button onClick={onClose} className="text-white/70 hover:text-white shrink-0 -mr-1 -mt-1 p-1">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="text-3xl lg:text-4xl font-bold tabular-nums tracking-tight mt-2">
              {isIn ? '+' : '−'}{formatMoney(row.amount, row.currency)}
            </div>
            <div className="text-sm text-white/90 mt-1 font-medium truncate">
              {counterpartyName || '—'}
            </div>
          </div>
        </div>

        {/* ─── Body — scrollable ─── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4 bg-white">

          {/* ═══ KONTRAGENT + KATEGORIYA + SHARTNOMA — asosiy info ═══ */}
          <div className="rounded-xl ring-1 ring-indigo-200 bg-gradient-to-br from-indigo-50/70 to-violet-50/40 p-4 space-y-3">
            {/* Kontragent */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Kontragent</div>
                <div className="text-[14px] font-semibold text-slate-900 truncate">{counterpartyName || '—'}</div>
                {counterpartyInn && (
                  <div className="font-mono text-[11px] text-slate-500 mt-0.5">STIR: {counterpartyInn}</div>
                )}
              </div>
              {row.docNumber && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-white text-slate-600 ring-1 ring-slate-200 shrink-0">
                  <Receipt className="h-3 w-3" /> #{row.docNumber}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-indigo-200/60">
              {/* Kategoriya */}
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 flex items-center gap-1">
                  <Tag className="h-3 w-3" /> Kategoriya
                </div>
                {liveRow.category ? (
                  <div className="space-y-1">
                    <div
                      className="inline-flex items-center px-2 py-1 rounded-md text-[12px] font-semibold ring-1 ring-inset"
                      style={{ backgroundColor: `${(liveRow.category.color || '#6366f1')}18`, color: (liveRow.category.color || '#6366f1'), borderColor: `${(liveRow.category.color || '#6366f1')}40` }}
                    >
                      {liveRow.category.name}
                    </div>
                    {liveRow.subcategory && (
                      <div className="text-[11px] text-slate-600">
                        ↳ {liveRow.subcategory.name}
                      </div>
                    )}
                    {liveRow.categorizedBy && (
                      <div className="text-[10px] text-slate-400">
                        {liveRow.categorizedBy === 'auto' && 'avto'}
                        {liveRow.categorizedBy === 'sync' && 'sync paytida'}
                        {liveRow.categorizedBy === 'manual' && "qo'lda"}
                        {liveRow.categorizedBy === 'cron' && 'cron'}
                        {liveRow.categorizedAt && ` · ${formatDateTime(liveRow.categorizedAt)}`}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[12px] text-slate-400 italic">Tayinlanmagan</div>
                )}
              </div>

              {/* Shartnoma raqami */}
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 flex items-center gap-1">
                  <FileSignature className="h-3 w-3" /> Shartnoma
                </div>
                {liveRow.contractNumber ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <code className="inline-block font-mono text-[12px] font-bold text-indigo-700 bg-white px-2 py-1 rounded ring-1 ring-indigo-200">
                      {liveRow.contractNumber}
                    </code>
                    {liveRow.contractStatus === 'verified' && liveRow.contractCustomer && (
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded ring-1 ring-emerald-200 truncate max-w-[160px]" title={liveRow.contractCustomer}>
                        ✓ {liveRow.contractCustomer}
                      </span>
                    )}
                    {liveRow.contractStatus === 'unverified' && (
                      <span className="text-[10px] text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded ring-1 ring-rose-200 font-semibold">
                        xato — CRM'da topilmadi
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-[12px] text-slate-400 italic">Topilmadi</div>
                )}
              </div>
            </div>

            {/* Avto-kategoriyalash + qo'lda tahrirlash tugmalari */}
            {canManage && (
              <div className="pt-3 border-t border-indigo-200/60">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] text-slate-600">
                    {liveRow.category
                      ? "Kategoriyani qo'lda o'zgartirish mumkin"
                      : "Qoidalar bo'yicha avto-aniqlash"}
                  </div>
                  <div className="flex items-center gap-2">
                    {!liveRow.category && (
                      <button
                        onClick={() => categorizeMut.mutate(false)}
                        disabled={categorizeMut.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {categorizeMut.isPending
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Wand2 className="h-3 w-3" />}
                        Avto-kategoriyalash
                      </button>
                    )}
                    <button
                      onClick={() => setManualEditOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-slate-700 text-[11px] font-semibold ring-1 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400 transition-colors"
                    >
                      <FileText className="h-3 w-3" />
                      Qo'lda tahrirlash
                    </button>
                  </div>
                </div>

                {/* Natija logi */}
                {categorizeLog && (
                  <div className={cn(
                    "mt-3 rounded-lg p-3 text-[11px] ring-1",
                    categorizeLog.categoryCode === 'EXISTING'
                      ? 'bg-amber-50 ring-amber-200 text-amber-900'
                      : categorizeLog.categoryCode
                        ? 'bg-emerald-50 ring-emerald-200 text-emerald-900'
                        : 'bg-slate-50 ring-slate-200 text-slate-700',
                  )}>
                    <div className="flex items-start gap-2">
                      {categorizeLog.categoryCode === 'EXISTING' ? (
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      ) : categorizeLog.categoryCode ? (
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1 space-y-0.5">
                        {categorizeLog.categoryCode === 'EXISTING' && (
                          <div className="font-semibold">Skip: allaqachon kategoriyalangan</div>
                        )}
                        {categorizeLog.categoryCode && categorizeLog.categoryCode !== 'EXISTING' && (
                          <div className="font-semibold">
                            ✓ {categorizeLog.categoryCode}
                            {categorizeLog.subcategoryCode && ` → ${categorizeLog.subcategoryCode}`}
                          </div>
                        )}
                        {!categorizeLog.categoryCode && (
                          <div className="font-semibold">Qoida topilmadi — qo'lda tayinlang</div>
                        )}
                        {categorizeLog.reason && (
                          <div className="text-[10px] opacity-80">Sabab: {categorizeLog.reason}</div>
                        )}
                        {categorizeLog.contractNumber && (
                          <div className="text-[10px] opacity-80 font-mono">Shartnoma: {categorizeLog.contractNumber}</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ═══ Hammasini ochish/yopish ═══ */}
          <div className="flex items-center justify-end">
            <button
              onClick={toggleAll}
              title={allOpen ? "Hammasini yopish" : "Hammasini ochish"}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
            >
              {allOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {allOpen ? "Yopish" : "Ochish"}
            </button>
          </div>

          {/* Yuboruvchi */}
          <DetailSection
            id="sender" open={openSections.has('sender')} onToggle={() => toggleOne('sender')}
            title={t('detailSender')} icon={ArrowUpRight} highlighted={!isIn} tone="rose"
          >
            <CopyRow label={t('detailFieldName')} value={row.fromName || '—'} />
            <CopyRow label={t('detailFieldInn')} value={row.fromInn} mono copyable />
            <CopyRow label={t('detailFieldAccount')} value={row.fromAccount} mono copyable />
            <CopyRow label={t('detailFieldMfo')} value={row.fromMfo} mono />
          </DetailSection>

          {/* Qabul qiluvchi */}
          <DetailSection
            id="receiver" open={openSections.has('receiver')} onToggle={() => toggleOne('receiver')}
            title={t('detailReceiver')} icon={ArrowDownLeft} highlighted={isIn} tone="emerald"
          >
            <CopyRow label={t('detailFieldName')} value={row.toName || '—'} />
            <CopyRow label={t('detailFieldInn')} value={row.toInn} mono copyable />
            <CopyRow label={t('detailFieldAccount')} value={row.toAccount} mono copyable />
            <CopyRow label={t('detailFieldMfo')} value={row.toMfo} mono />
          </DetailSection>

          {/* To'lov maqsadi — collapsible */}
          {row.description && (
            <DetailSection
              id="purpose" open={openSections.has('purpose')} onToggle={() => toggleOne('purpose')}
              title={t('detailPaymentPurpose')} icon={FileText}
            >
              <div className="text-[13px] text-slate-900 leading-relaxed whitespace-pre-wrap py-2">{row.description.trim()}</div>
              {row.purposeCode && (
                <div className="mt-1 pt-2 border-t border-slate-200 text-[11px] text-slate-500">
                  {t('detailPurposeCode')}: <span className="font-mono font-semibold text-slate-700">{row.purposeCode}</span>
                </div>
              )}
            </DetailSection>
          )}

          {/* Vaqt ma'lumotlari */}
          <DetailSection
            id="time" open={openSections.has('time')} onToggle={() => toggleOne('time')}
            title={t('detailTime')} icon={Calendar}
          >
            <CopyRow label={t('detailDocDate')} value={formatDate(row.txnDate)} />
            <CopyRow label={t('detailOpTime')} value={row.operationTime} mono />
            <CopyRow label={t('detailValueDate')} value={row.valueDate ? formatDate(row.valueDate) : undefined} />
            <CopyRow label={t('detailSettlement')} value={row.settlementTime} mono />
            <CopyRow label={t('detailInput')} value={row.inputAt ? formatDateTime(row.inputAt) : undefined} />
          </DetailSection>

          {/* Tizim ma'lumotlari */}
          <DetailSection
            id="system" open={openSections.has('system')} onToggle={() => toggleOne('system')}
            title={t('detailSystem')} icon={Hash}
          >
            <CopyRow label={t('bank')} value={row.account?.bank?.name || '—'} />
            <CopyRow label={t('detailLocalAccount')} value={row.account?.accountNo} mono copyable />
            <CopyRow label={t('detailB2')} value={row.bankB2Id} mono copyable />
            <CopyRow label={t('detailGlobalId')} value={row.bankGeneralId} mono copyable />
            {row.bankClientId && <CopyRow label={t('detailClientId')} value={row.bankClientId} mono />}
            {row.docType && <CopyRow label={t('detailDocType')} value={row.docType} mono />}
          </DetailSection>

          {/* Tarix (Audit log) */}
          <CategoryHistorySection txId={row.id} />

          {/* Tranzaksiya ID — kollapsi (default yopiq) */}
          <CompositeIdSection value={row.externalId || row.id} label={t('detailComposite')} />

          {/* Bankdan kelgan to'liq JSON */}
          {(row.metadata || row.rawExtra) && (
            <DetailSection
              id="raw" open={openSections.has('raw')} onToggle={() => toggleOne('raw')}
              title={t('detailFullJson')} icon={FileText}
            >
              <div className="space-y-3 py-2">
                {row.metadata && <RawJsonBlock label={t('detailRawMeta')} data={row.metadata} />}
                {row.rawExtra && <RawJsonBlock label={t('detailRawExtra')} data={row.rawExtra} />}
              </div>
            </DetailSection>
          )}
        </div>
      </DialogContent>

      {/* Qo'lda kategoriya tahrirlash */}
      {manualEditOpen && (
        <CategoryEditDialog
          row={liveRow}
          tree={categoriesTree}
          onClose={() => setManualEditOpen(false)}
          onSave={(categoryId, subcategoryId) => setCategoryMut.mutate({ categoryId, subcategoryId })}
          saving={setCategoryMut.isPending}
        />
      )}
    </Dialog>
  );
}

function RawJsonBlock({ label, data }: { label: string; data: any }) {
  const t = useTranslations('transactions');
  const [copied, setCopied] = useState(false);
  const str = JSON.stringify(data, null, 2);
  function copy() {
    navigator.clipboard.writeText(str);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-900"
        >
          {copied ? <><Check className="h-3 w-3 text-emerald-600" /> {t('copied')}</> : <><Copy className="h-3 w-3" /> {t('copy')}</>}
        </button>
      </div>
      <pre className="p-2.5 bg-slate-900 text-slate-100 rounded-lg text-[10px] font-mono leading-relaxed overflow-x-auto max-h-64 overflow-y-auto">
        {str}
      </pre>
    </div>
  );
}

function DetailSection({
  id, open, onToggle, title, icon: Icon, highlighted, tone, children,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  title: string;
  icon: any;
  highlighted?: boolean;
  tone?: 'rose' | 'emerald';
  children: React.ReactNode;
}) {
  const t = useTranslations('transactions');
  const ring = highlighted
    ? tone === 'emerald' ? 'ring-emerald-200 bg-emerald-50/50' : 'ring-rose-200 bg-rose-50/50'
    : 'ring-slate-200 bg-white';
  return (
    <div className={cn("rounded-xl ring-1 overflow-hidden", ring)}>
      <button
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/80 transition-colors"
      >
        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-600 flex items-center gap-1.5">
          <Icon className="h-3 w-3" /> {title}
          {highlighted && <span className="text-[9px] text-indigo-600 font-bold">· {t('detailYou')}</span>}
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-slate-400 transition-transform shrink-0",
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="px-4 pb-2.5 pt-1 divide-y divide-slate-100/80 border-t border-slate-100">
          {children}
        </div>
      )}
    </div>
  );
}

function CopyRow({ label, value, mono, copyable }: { label: string; value?: string; mono?: boolean; copyable?: boolean }) {
  const t = useTranslations('transactions');
  const [copied, setCopied] = useState(false);
  const isEmpty = !value || value === '—';

  function copy() {
    if (isEmpty) return;
    navigator.clipboard.writeText(value!);
    setCopied(true);
    toast.success(t('labelCopied', { label }));
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center justify-between gap-3 py-1.5 group">
      <div className="text-[12px] text-slate-500 shrink-0">{label}</div>
      <div className="flex items-center gap-1.5 min-w-0">
        <div className={cn(
          "text-[13px] text-slate-900 text-right truncate",
          mono && 'font-mono text-[12px]',
          isEmpty && 'text-slate-400 italic',
        )}>
          {isEmpty ? t('empty') : value}
        </div>
        {copyable && !isEmpty && (
          <button
            onClick={copy}
            className="shrink-0 p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 opacity-0 group-hover:opacity-100 transition-all"
            title={t('copy')}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

// To'liq qiymat — wrap qilingan, copy tugmasi bilan (uzun ID lar uchun)
function CopyBlock({ value }: { value: string }) {
  const t = useTranslations('transactions');
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(t('txIdCopied'));
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="rounded-xl bg-slate-900 ring-1 ring-slate-700 px-3 py-2.5 flex items-start gap-2">
      <code className="flex-1 font-mono text-[11px] text-emerald-300 break-all leading-relaxed select-all">
        {value}
      </code>
      <button
        onClick={copy}
        className="shrink-0 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
        title={t('copy')}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ═══ TARIX — kategoriya o'zgarish tarixi (kim qachon nima qildi)
function CategoryHistorySection({ txId }: { txId: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['tx-category-history', txId],
    queryFn: () => api.get<{ ok: boolean; items: any[] }>(`/categorization/transactions/${txId}/history`),
    enabled: open && !!txId,
    staleTime: 30_000,
  });
  const items = q.data?.items || [];

  return (
    <div className="rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/80 transition-colors"
      >
        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-600 flex items-center gap-1.5">
          <History className="h-3 w-3" /> Tarix
          {open && items.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[9px] font-bold normal-case tracking-normal">
              {items.length}
            </span>
          )}
        </div>
        <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform shrink-0', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-slate-100">
          {q.isLoading ? (
            <div className="py-3 text-[11px] text-slate-500 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Yuklanmoqda...
            </div>
          ) : items.length === 0 ? (
            <div className="py-3 text-[11px] text-slate-400 italic">Tarix yo'q — hali hech kim kategoriyalamagan</div>
          ) : (
            <div className="space-y-2 py-2">
              {items.map((h: any) => (
                <CategoryHistoryItem key={h.id} h={h} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryHistoryItem({ h }: { h: any }) {
  const actorLabel = h.actorName || h.action;
  const actionColor: Record<string, string> = {
    manual: 'bg-indigo-100 text-indigo-700',
    sync:   'bg-emerald-100 text-emerald-700',
    auto:   'bg-violet-100 text-violet-700',
    cron:   'bg-amber-100 text-amber-700',
  };
  const cls = actionColor[h.action] || 'bg-slate-100 text-slate-700';
  const renderCat = (name: string | null, sub: string | null) => {
    if (!name && !sub) return <span className="text-slate-400 italic">bo'sh</span>;
    return (
      <span className="font-semibold">
        {name || '—'}{sub && <span className="text-slate-500 font-normal"> / {sub}</span>}
      </span>
    );
  };
  return (
    <div className="rounded-lg ring-1 ring-slate-100 bg-slate-50/50 px-3 py-2 text-[11px] space-y-1">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider', cls)}>
            {h.action}
          </span>
          <span className="font-medium text-slate-700">{actorLabel}</span>
        </div>
        <span className="text-[10px] text-slate-500 tabular-nums">{formatDateTime(h.createdAt)}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="line-through text-rose-600/80">
          {renderCat(h.oldCategoryName, h.oldSubcategoryName)}
        </span>
        <span className="text-slate-400">→</span>
        <span className="text-emerald-700">
          {renderCat(h.newCategoryName, h.newSubcategoryName)}
        </span>
      </div>
      {h.reason && (
        <div className="text-[10px] text-slate-500 italic">{h.reason}</div>
      )}
      {h.contractNumber && (
        <div className="text-[10px] font-mono text-indigo-600">{h.contractNumber}</div>
      )}
    </div>
  );
}

// ═══ COMPOSITE ID — kollapsi (default yopiq) + copy icon
function CompositeIdSection({ value, label }: { value: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/80 transition-colors"
      >
        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-600 flex items-center gap-1.5">
          <Hash className="h-3 w-3" /> {label}
        </div>
        <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform shrink-0', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-slate-100 flex items-center gap-2">
          <code className="flex-1 min-w-0 font-mono text-[11px] text-slate-700 bg-slate-50 px-2 py-1 rounded ring-1 ring-slate-200 break-all select-all">
            {value}
          </code>
          <CopyIdButton value={value} />
        </div>
      )}
    </div>
  );
}

// ═══ COPY ID — kichik icon tugma, bosilganda ID'ni clipboard'ga nusxalaydi
function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success('ID nusxalandi');
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={copy}
      title={`Tranzaksiya ID nusxalash: ${value}`}
      className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-700 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ═══ KONTRAGENT CHIP — firma nomi (yoki kategoriya placeholder)
function KontragentChip({
  display, category, onClick, canEdit,
}: {
  display: string | null | undefined;
  category: any | null;
  onClick: (e: React.MouseEvent) => void;
  canEdit: boolean;
}) {
  if (!display) {
    return canEdit ? (
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 ring-1 ring-dashed ring-slate-200 hover:ring-indigo-300 transition-colors"
      >
        + tanlash
      </button>
    ) : (
      <span className="text-[10px] text-slate-300">—</span>
    );
  }
  const color = category?.color || '#64748b';
  const style = {
    backgroundColor: `${color}18`,
    color: color,
    borderColor: `${color}40`,
  };
  return (
    <button
      onClick={onClick}
      disabled={!canEdit}
      className={cn(
        'inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold ring-1 ring-inset text-left max-w-full transition-all',
        canEdit && 'hover:ring-2 cursor-pointer',
      )}
      style={style}
      title={canEdit ? "O'zgartirish uchun bosing" : display}
    >
      <span className="truncate max-w-[150px] leading-tight">{display}</span>
    </button>
  );
}

// ═══ KATEGORIYA CHIP — bitta kategoriya (top yoki sub) chipi ═══
function CategoryChip({
  category, parentColor, onClick, canEdit, placeholder = '+ tanlash',
}: {
  category: any | null;
  parentColor?: string;          // sub uchun — parent kategoriya rangini meros oladi
  onClick: (e: React.MouseEvent) => void;
  canEdit: boolean;
  placeholder?: string;
}) {
  if (!category) {
    if (!placeholder) return <span className="text-[10px] text-slate-300">—</span>;
    return canEdit ? (
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 ring-1 ring-dashed ring-slate-200 hover:ring-indigo-300 transition-colors"
      >
        {placeholder}
      </button>
    ) : (
      <span className="text-[10px] text-slate-400">{placeholder}</span>
    );
  }
  const color = category.color || parentColor || '#64748b';
  const style = {
    backgroundColor: `${color}18`,
    color: color,
    borderColor: `${color}40`,
  };
  return (
    <button
      onClick={onClick}
      disabled={!canEdit}
      className={cn(
        'inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold ring-1 ring-inset text-left max-w-full transition-all',
        canEdit && 'hover:ring-2 cursor-pointer',
      )}
      style={style}
      title={canEdit ? "O'zgartirish uchun bosing" : category.name}
    >
      <span className="truncate max-w-[150px] leading-tight">{category.name}</span>
    </button>
  );
}

// ═══ KATEGORIYA TAHRIR DIALOG ═══
function CategoryEditDialog({
  row, tree, onClose, onSave, saving,
}: {
  row: any | null;
  tree: any[];
  onClose: () => void;
  onSave: (categoryId: string | null, subcategoryId: string | null) => void;
  saving: boolean;
}) {
  const [selectedTopId, setSelectedTopId] = useState<string | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);

  useEffect(() => {
    if (row) {
      setSelectedTopId(row.categoryId || null);
      setSelectedSubId(row.subcategoryId || null);
    }
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return null;
  const selectedTop = tree.find((t) => t.id === selectedTopId);
  const subs = selectedTop?.children || [];

  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-indigo-600" /> Kategoriya tanlash
          </DialogTitle>
          <DialogDescription>
            Tranzaksiya: <span className="font-mono text-[11px]">{row.id?.slice(0, 8)}…</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-2 block">
              Top kategoriya
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {tree.map((c) => {
                const selected = selectedTopId === c.id;
                const color = c.color || '#64748b';
                return (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedTopId(c.id); setSelectedSubId(null); }}
                    className={cn(
                      'text-left px-3 py-2 rounded-lg ring-1 ring-inset text-[12px] font-medium transition-all',
                      selected ? 'ring-2' : 'ring-slate-200 hover:ring-slate-300',
                    )}
                    style={selected ? { backgroundColor: `${color}15`, color, borderColor: color } : {}}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedTop && subs.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-2 block">
                Subkategoriya (ixtiyoriy)
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setSelectedSubId(null)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-[11px] font-medium ring-1 ring-inset transition-all',
                    !selectedSubId ? 'bg-slate-900 text-white ring-slate-900' : 'ring-slate-200 hover:ring-slate-300 text-slate-600',
                  )}
                >
                  — yo'q —
                </button>
                {subs.map((s: any) => {
                  const selected = selectedSubId === s.id;
                  const color = selectedTop.color || '#64748b';
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSubId(s.id)}
                      className={cn(
                        'px-3 py-1.5 rounded-md text-[11px] font-medium ring-1 ring-inset transition-all',
                        selected ? 'ring-2' : 'ring-slate-200 hover:ring-slate-300',
                      )}
                      style={selected ? { backgroundColor: `${color}15`, color, borderColor: color } : {}}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <button
              onClick={() => onSave(null, null)}
              disabled={saving}
              className="text-[12px] text-rose-600 hover:text-rose-700 font-medium"
            >
              Tozalash
            </button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
                Bekor qilish
              </Button>
              <Button
                size="sm"
                onClick={() => onSave(selectedTopId, selectedSubId)}
                disabled={saving || !selectedTopId}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Saqlash'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
