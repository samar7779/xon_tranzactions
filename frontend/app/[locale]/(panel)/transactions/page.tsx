'use client';
// rebuild trigger — frontend force redeploy uchun

import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Wand2, Link2Off, EyeOff, MoreHorizontal, Download,
  ArrowDownLeft, ArrowUpRight, TrendingUp, ChevronLeft, ChevronRight,
  X, Calendar, Wallet, FileText, Eye, FileSpreadsheet, Copy, Check,
  Hash, Receipt, Link2, History, Loader2, AlertCircle,
  Wrench, Printer, ChevronDown, Tag, FileSignature, CheckCircle2,
  Filter as FilterIcon, Briefcase,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { TransactionsTabs } from '@/components/transactions-tabs';
import { IdInspectorDialog } from '@/components/id-inspector-dialog';
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

// Ustun nomidan tranzaksiya field'iga string qiymat — filter uchun
function columnValueFor(it: any, col: string): string | null {
  switch (col) {
    case 'direction':   return it.direction === 'IN' ? 'Kirim' : 'Chiqim';
    case 'bank':        return it.account?.bank?.name || it.bank?.name || null;
    case 'hisobNomi':   return (it.direction === 'IN' ? it.fromName : it.toName) || null;
    case 'kontragent':  return it.counterpartyDisplay || it.category?.name || null;
    case 'kategoriya':  return it.subcategory?.name || it.category?.name || null;
    default:            return null;
  }
}

export default function TransactionsPage() {
  const t = useTranslations('transactions');
  const tc = useTranslations('common');
  const tp = useTranslations('payments');
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManagePayments = !!user?.permissions?.includes(PERMS.PAYMENTS_MANAGE);
  const canManageCategories = !!user?.permissions?.includes(PERMS.CATEGORIES_MANAGE);

  // Filter state'lar (oddiy useState — hech qanday persistance yo'q)
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState<string>('all');
  const [matchStatus, setMatchStatus] = useState<string>('all');
  const [bankId, setBankId] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [filterOpen, setFilterOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<any>(null);
  const [idSearchOpen, setIdSearchOpen] = useState(false);
  const [idQuery, setIdQuery] = useState('');
  const [idSearching, setIdSearching] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [categoryEditRow, setCategoryEditRow] = useState<any>(null);
  const [lookupContract, setLookupContract] = useState<{ contract: string; description: string | null } | null>(null);

  // Google Sheets'ga o'xshash per-ustun filterlash
  const [columnFilterMode, setColumnFilterMode] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);

  // ─── localStorage persistance — mount paytida o'qish ───
  useEffect(() => {
    try {
      const raw = localStorage.getItem('tx-filters-v1');
      if (raw) {
        const f = JSON.parse(raw);
        if (typeof f?.q === 'string') setQ(f.q);
        if (typeof f?.direction === 'string') setDirection(f.direction);
        if (typeof f?.matchStatus === 'string') setMatchStatus(f.matchStatus);
        if (typeof f?.bankId === 'string') setBankId(f.bankId);
        if (typeof f?.dateFrom === 'string') setDateFrom(f.dateFrom);
        if (typeof f?.dateTo === 'string') setDateTo(f.dateTo);
      }
      const rawCol = localStorage.getItem('tx-column-filters-v1');
      if (rawCol) {
        const obj = JSON.parse(rawCol);
        const restored: Record<string, Set<string>> = {};
        for (const k of Object.keys(obj)) {
          if (Array.isArray(obj[k]) && obj[k].length > 0) restored[k] = new Set(obj[k]);
        }
        if (Object.keys(restored).length > 0) {
          setColumnFilters(restored);
          // Agar column filter bor bo'lsa — filter mode'ni avtomatik ON qilamiz
          // (foydalanuvchi ularni ko'rishi va olib tashlay olishi uchun)
          setColumnFilterMode(true);
        }
      }
      // Filter mode toggle holati
      const rawMode = localStorage.getItem('tx-filter-mode-v1');
      if (rawMode === '1') setColumnFilterMode(true);
    } catch { /* ignore */ }
  }, []);

  // Filter mode toggle holatini saqlash
  useEffect(() => {
    try {
      if (columnFilterMode) localStorage.setItem('tx-filter-mode-v1', '1');
      else localStorage.removeItem('tx-filter-mode-v1');
    } catch { /* ignore */ }
  }, [columnFilterMode]);

  // Asosiy filterlarni localStorage'ga yozish
  useEffect(() => {
    try {
      const filters = { q, direction, matchStatus, bankId, dateFrom, dateTo };
      const hasAny = q || direction !== 'all' || matchStatus !== 'all' || bankId !== 'all' || dateFrom || dateTo;
      if (hasAny) localStorage.setItem('tx-filters-v1', JSON.stringify(filters));
      else localStorage.removeItem('tx-filters-v1');
    } catch { /* ignore */ }
  }, [q, direction, matchStatus, bankId, dateFrom, dateTo]);

  // Column filterlarni localStorage'ga yozish
  useEffect(() => {
    try {
      const obj: Record<string, string[]> = {};
      for (const k of Object.keys(columnFilters)) {
        if (columnFilters[k]?.size > 0) obj[k] = Array.from(columnFilters[k]);
      }
      if (Object.keys(obj).length > 0) localStorage.setItem('tx-column-filters-v1', JSON.stringify(obj));
      else localStorage.removeItem('tx-column-filters-v1');
    } catch { /* ignore */ }
  }, [columnFilters]);

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
    if (bankId !== 'all') c++;
    if (dateFrom) c++;
    if (dateTo) c++;
    for (const k of Object.keys(columnFilters)) {
      if (columnFilters[k]?.size > 0) c++;
    }
    return c;
  }, [direction, bankId, dateFrom, dateTo, columnFilters]);

  // Column filter -> URL param map (vergul bilan ajratilgan)
  const COLUMN_TO_PARAM: Record<string, string> = {
    bank: 'bankIds',
    accountIds: 'accountIds',
    kontragent: 'categoryIds',
    kategoriya: 'subcategoryIds',
    direction: 'directions',
    contractStatus: 'contractStatuses',
    hisobNomi: 'hisobNomi',
  };

  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (q) params.set('q', q);
  if (direction !== 'all') params.set('direction', direction);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (bankId !== 'all') params.set('bankId', bankId);
  // Column filterlarni URL'ga qo'shamiz
  for (const [col, paramName] of Object.entries(COLUMN_TO_PARAM)) {
    const set = columnFilters[col];
    if (set && set.size > 0) params.set(paramName, Array.from(set).join(','));
  }

  // columnFilters Set object — JSON serialization uchun array'ga aylantiramiz
  const columnFiltersKey = JSON.stringify(
    Object.fromEntries(Object.entries(columnFilters).map(([k, v]) => [k, Array.from(v).sort()])),
  );

  // Aktiv filterlar URL params (distinct endpoint chaqirig'i uchun)
  // Self-exclusion popover ichida buildWhere helper'da amalga oshiriladi
  const activeFilterParams = (() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (direction !== 'all') p.set('direction', direction);
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    if (bankId !== 'all') p.set('bankId', bankId);
    for (const [col, paramName] of Object.entries(COLUMN_TO_PARAM)) {
      const set = columnFilters[col];
      if (set && set.size > 0) p.set(paramName, Array.from(set).join(','));
    }
    return p.toString();
  })();

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', page, perPage, q, direction, dateFrom, dateTo, bankId, columnFiltersKey],
    queryFn: () => api.get<{ items: any[]; total: number; page: number; perPage: number }>(`/transactions?${params}`),
  });
  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });
  // KPI toggle: 'all' (oxirgi 30 kun) yoki 'CLIENT' (shu oy — debitorka)
  const [kpiMode, setKpiMode] = useState<'all' | 'CLIENT'>('all');

  const { data: stats } = useQuery({
    queryKey: ['tx-stats', kpiMode],
    queryFn: () => {
      const today = new Date();
      let from: Date;
      if (kpiMode === 'CLIENT') {
        // Shu oyning 1-kunidan bugungacha
        from = new Date(today.getFullYear(), today.getMonth(), 1);
      } else {
        // Oxirgi 30 kun
        from = new Date();
        from.setDate(from.getDate() - 30);
      }
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = today.toISOString().slice(0, 10);
      const catParam = kpiMode === 'CLIENT' ? `&categoryCode=CLIENT&to=${toStr}` : '';
      return api.get<any>(`/transactions/stats?from=${fromStr}${catParam}`);
    },
  });

  // Backend allaqachon filtrlangan natijani qaytaradi — qo'shimcha client-side filter shart emas
  const filtered = data?.items || [];

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
    // Column filterlarni ham qo'shamiz
    for (const [col, paramName] of Object.entries(COLUMN_TO_PARAM)) {
      const set = columnFilters[col];
      if (set && set.size > 0) p.set(paramName, Array.from(set).join(','));
    }
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
    setColumnFilters({});
    try { localStorage.removeItem('tx-column-filters-v1'); } catch { /* ignore */ }
  }

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <TransactionsTabs />

      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full">

        {/* ═══ KPI ROW (toggle: all / CLIENT only) ═══ */}
        <div className="relative">
          {kpiMode === 'CLIENT' && (
            <div className="absolute -top-2 left-3 px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider z-10 shadow">
              Klient / Debitorka
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label={kpiMode === 'CLIENT' ? "Klient kirim · shu oy" : t('kpiIn30')}
              value={formatMoney(inSum)}
              icon={ArrowDownLeft}
              color="emerald"
              spark={spark(1.2)}
            />
            <StatCard
              label={kpiMode === 'CLIENT' ? "Klient chiqim · shu oy" : t('kpiOut30')}
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
          {/* Toggle strelka — KPI'larni Klient/all rejimda almashtirish */}
          <button
            onClick={() => setKpiMode((m) => (m === 'all' ? 'CLIENT' : 'all'))}
            title={kpiMode === 'all' ? 'Klient (debitorka) statistikasi' : "Umumiy statistikaga qaytish"}
            className="absolute -right-2 top-1/2 -translate-y-1/2 z-10 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white shadow-lg ring-1 ring-slate-200 hover:bg-indigo-50 hover:ring-indigo-300 hover:text-indigo-700 transition-all hover:scale-110"
          >
            {kpiMode === 'all'
              ? <ChevronRight className="h-4 w-4" />
              : <ChevronLeft className="h-4 w-4" />}
          </button>

          {/* Action menu — bitta tugma, ichida 2 ta amal (KPI'dan tashqari, o'ng pastki burchak) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="Amallar"
                className="absolute -bottom-4 -right-3 z-10 inline-flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-lg ring-2 ring-white hover:scale-110 hover:shadow-xl hover:shadow-indigo-500/40 transition-all"
              >
                {recategorizeAllMut.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Wand2 className="h-4 w-4" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setBackfillOpen(true)} className="cursor-pointer">
                <History className="h-4 w-4 mr-2 text-indigo-600" />
                <span className="flex-1">{t('toolBackfill')}</span>
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
                  <span className="flex-1">Kategoriyalash</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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

              {/* Yuklab olish — Download icon (Tarix/Recategorize endi KPI yonida) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Yuklab olish"
                    className={cn(
                      'inline-flex items-center justify-center w-10 h-10 rounded-xl shrink-0',
                      'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
                      'shadow-sm hover:shadow-lg hover:shadow-indigo-500/30',
                      'transition-all duration-200 hover:scale-105 active:scale-95',
                      'ring-1 ring-indigo-400/30',
                    )}
                  >
                    <Download className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
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

              {/* ID orqali qidirish — gradient tugma (ID matn bilan) */}
              <button
                onClick={() => setIdSearchOpen(true)}
                title={t('toolIdSearch')}
                className={cn(
                  'inline-flex items-center justify-center w-10 h-10 rounded-xl shrink-0',
                  'bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white',
                  'shadow-sm hover:shadow-lg hover:shadow-fuchsia-500/40',
                  'transition-all duration-200 hover:scale-105 active:scale-95',
                  'ring-1 ring-fuchsia-400/30',
                  'font-black text-[11px] tracking-widest',
                )}
              >
                ID
              </button>

              {/* Bank ID inspector (composite ID → bankdan tekshirish) */}
              <IdInspectorDialog iconOnly />

              {/* Filter mode toggle — faqat icon */}
              <button
                onClick={() => setColumnFilterMode((v) => !v)}
                title={columnFilterMode ? "Filter rejimini o'chirish" : "Har ustunga filter qo'yish"}
                className={cn(
                  "inline-flex items-center justify-center w-10 h-10 rounded-xl transition-all",
                  columnFilterMode
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 ring-1 ring-slate-200',
                )}
              >
                <FilterIcon className="h-4 w-4" />
              </button>

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
        <Card className="border-0 shadow-soft overflow-visible">
          <CardContent className="p-0 overflow-visible">
            {isLoading ? (
              <div className="p-6 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : (
              <div className="overflow-x-auto overflow-y-visible" style={{ overflowY: 'visible' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                      <ColumnTh label={t('bankAccountHeader')} column="bank" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} tabs={[{ column: 'bank', label: 'Bank' }, { column: 'accountIds', label: 'Hisob raqami' }]} />
                      <th className="text-left px-4 py-3 w-40">{t('dateTimeHeader')}</th>
                      <ColumnTh label="Hisob nomi" column="hisobNomi" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} />
                      <ColumnTh label={t('directionHeader')} column="direction" widthClass="w-24" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} />
                      <ColumnTh label="Kontragent" column="kontragent" widthClass="w-40" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} alignRight />
                      <ColumnTh label="Kategoriya" column="kategoriya" widthClass="w-40" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} alignRight />
                      <ColumnTh label="Shartnoma" column="contractStatus" widthClass="w-32" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} alignRight />
                      <th className="text-right px-4 py-3">{t('amountHeader')}</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(filtered?.length ?? 0) === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-6 py-12 text-center">
                          <div className="flex flex-col items-center gap-2 text-slate-400">
                            <Wallet className="h-8 w-8" />
                            <div className="text-[13px] font-semibold text-slate-600">{t('notFoundTitle')}</div>
                            <div className="text-[11px]">{q || activeFilters > 0 ? t('noDataChangeFilters') : t('noDataYet')}</div>
                          </div>
                        </td>
                      </tr>
                    ) : filtered!.map((it: any) => {
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
                              it.contractStatus === 'unverified' ? (
                                // XATO holati — faqat badge + lookup icon, raqamni yashiramiz
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 ring-1 ring-rose-200">
                                    <AlertCircle className="h-3 w-3" /> xato
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setLookupContract({ contract: it.contractNumber, description: it.description }); }}
                                    title="AI yordamida o'xshash shartnomalarni topish"
                                    className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 via-fuchsia-500 to-rose-500 text-white shadow-sm hover:shadow-md hover:shadow-fuchsia-500/40 hover:scale-110 transition-all"
                                  >
                                    <Wand2 className="h-3 w-3" />
                                  </button>
                                </div>
                              ) : (
                                // Verified — shartnoma raqami ko'rinadi
                                <code
                                  className="inline-block w-fit font-mono text-[11px] font-bold px-1.5 py-0.5 rounded ring-1 text-indigo-700 bg-indigo-50 ring-indigo-200"
                                  title={it.contractCustomer || ''}
                                >
                                  {it.contractNumber}
                                </code>
                              )
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

      {/* ═══ AI SHARTNOMA LOOKUP — xato shartnomalar uchun ma'lumot + nom ═══ */}
      {lookupContract && (
        <ContractLookupDialog
          contractNumber={lookupContract.contract}
          description={lookupContract.description}
          onClose={() => setLookupContract(null)}
        />
      )}

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
  const [lookupContractDetail, setLookupContractDetail] = useState<{ contract: string; description: string | null } | null>(null);

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
      // Jadval va detail darrov yangilanishi uchun — invalidate + force refetch
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.refetchQueries({ queryKey: ['transactions'], type: 'active' });
      qc.invalidateQueries({ queryKey: ['tx-category-history', row.id] });
      qc.invalidateQueries({ queryKey: ['tx-distinct'] });
      liveQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const setContractMut = useMutation({
    mutationFn: (contractNumber: string | null) =>
      api.post<{ ok: boolean; verified: boolean; customerName: string | null }>(`/categorization/transactions/${row.id}/set-contract`, { contractNumber }),
    onSuccess: (r) => {
      toast.success(`Shartnoma saqlandi — ${r.customerName || 'CRM tasdiqladi'}`);
      // Jadval va detail darrov yangilanishi uchun — invalidate + force refetch
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.refetchQueries({ queryKey: ['transactions'], type: 'active' });
      qc.invalidateQueries({ queryKey: ['tx-category-history', row.id] });
      qc.invalidateQueries({ queryKey: ['tx-distinct'] });
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

  const [purposeHighlight, setPurposeHighlight] = useState(false);
  const categorizeMut = useMutation({
    mutationFn: (force: boolean) =>
      api.post<any>(`/categorization/transactions/${row.id}/categorize${force ? '?force=true' : ''}`),
    onSuccess: (r: any) => {
      setCategorizeLog(r);
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['tx-category-history', row.id] });
      liveQuery.refetch();
      // Qoida topilmadi → to'lov maqsadi avto-ochiladi + highlight efekt
      if (!r?.categoryCode || r.categoryCode === null) {
        setOpenSections((prev) => new Set(prev).add('purpose'));
        setPurposeHighlight(true);
        setTimeout(() => setPurposeHighlight(false), 2500);
      }
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
              {liveRow.counterpartyDisplay || counterpartyName || '—'}
            </div>
          </div>
        </div>

        {/* ─── Body — scrollable ─── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4 bg-white">

          {/* ═══ KONTRAGENT + KATEGORIYA + SHARTNOMA — asosiy info ═══ */}
          <div className="rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden">
            {/* ─── Asosiy info — har bir maydon alohida qator + tozalash tugmasi ─── */}
            {/* Kontragent qatori */}
            <InfoRow
              icon={<Briefcase className="h-3.5 w-3.5" />}
              label="Kontragent"
              value={liveRow.counterpartyDisplay || counterpartyName}
              subValue={
                liveRow.counterpartyDisplay
                  ? `${counterpartyName || '—'}${counterpartyInn ? ` · STIR ${counterpartyInn}` : ''}`
                  : counterpartyInn ? `STIR ${counterpartyInn}` : null
              }
              docNumber={row.docNumber}
              showClear={canManage && !!liveRow.category}
              onClear={() => setCategoryMut.mutate({ categoryId: null, subcategoryId: null })}
            />

            {/* Kategoriya qatori */}
            <InfoRow
              icon={<Tag className="h-3.5 w-3.5" />}
              label="Kategoriya"
              chip={
                liveRow.category ? {
                  text: liveRow.subcategory?.name || liveRow.category.name,
                  color: liveRow.category.color || '#6366f1',
                } : null
              }
              subValue={
                liveRow.category && liveRow.subcategory
                  ? `${liveRow.category.name}${liveRow.categorizedBy ? ` · ${liveRow.categorizedBy === 'manual' ? "qo'lda" : liveRow.categorizedBy} ${liveRow.categorizedAt ? '· ' + formatDateTime(liveRow.categorizedAt) : ''}` : ''}`
                  : liveRow.categorizedBy ? `${liveRow.categorizedBy === 'manual' ? "qo'lda" : liveRow.categorizedBy}${liveRow.categorizedAt ? ' · ' + formatDateTime(liveRow.categorizedAt) : ''}` : null
              }
              emptyText="Tayinlanmagan"
              showClear={canManage && !!liveRow.subcategory}
              onClear={() => setCategoryMut.mutate({ categoryId: liveRow.categoryId, subcategoryId: null })}
            />

            {/* Shartnoma qatori */}
            <InfoRow
              icon={<FileSignature className="h-3.5 w-3.5" />}
              label="Shartnoma"
              customValue={
                liveRow.contractNumber ? (
                  liveRow.contractStatus === 'unverified' ? (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 ring-1 ring-rose-200">
                        <AlertCircle className="h-3 w-3" /> xato — CRM'da topilmadi
                      </span>
                      <button
                        onClick={() => setLookupContractDetail({ contract: liveRow.contractNumber, description: liveRow.description })}
                        title="AI yordamida o'xshash shartnomalarni topish"
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 via-fuchsia-500 to-rose-500 text-white shadow-sm hover:shadow-md hover:shadow-fuchsia-500/40 hover:scale-110 transition-all"
                      >
                        <Wand2 className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <code className="inline-block font-mono text-[12px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded ring-1 ring-indigo-200">
                        {liveRow.contractNumber}
                      </code>
                      {liveRow.contractCustomer && (
                        <span className="text-[11px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded ring-1 ring-emerald-200 truncate max-w-[220px]" title={liveRow.contractCustomer}>
                          ✓ {liveRow.contractCustomer}
                        </span>
                      )}
                    </div>
                  )
                ) : null
              }
              emptyText="Topilmadi"
              showClear={canManage && !!liveRow.contractNumber}
              onClear={() => setContractMut.mutate(null)}
            />

            {/* Avto-kategoriyalash + Qo'lda tahrirlash tugmalari */}
            {canManage && (
              <div className="px-4 py-3 bg-slate-50/50">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] text-slate-600">
                    {liveRow.category
                      ? "Kontragent / Kategoriya / Shartnomani qo'lda o'zgartirish"
                      : "Qoidalar bo'yicha avto-aniqlash yoki qo'lda kiritish"}
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
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-slate-700 text-[11px] font-semibold ring-1 ring-slate-300 hover:bg-slate-50 hover:ring-indigo-400 hover:text-indigo-700 transition-colors"
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

          {/* To'lov maqsadi — collapsible (qoida topilmaganda highlight bilan ochiladi) */}
          {row.description && (
            <div
              ref={(el) => {
                if (el && purposeHighlight) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }}
              className={cn(
                'transition-all duration-500',
                purposeHighlight && 'ring-4 ring-amber-300/60 rounded-xl shadow-lg shadow-amber-200/40 scale-[1.01]',
              )}
            >
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
            </div>
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

      {/* Qo'lda tahrirlash — birlashtirilgan dialog (Kontragent + Kategoriya + Shartnoma) */}
      {manualEditOpen && (
        <CombinedEditDialog
          row={liveRow}
          tree={categoriesTree}
          onClose={() => setManualEditOpen(false)}
          onSaveCategory={(categoryId, subcategoryId) => setCategoryMut.mutate({ categoryId, subcategoryId })}
          onSaveContract={(contract) => setContractMut.mutate(contract)}
          savingCategory={setCategoryMut.isPending}
          savingContract={setContractMut.isPending}
        />
      )}

      {/* AI Lookup — xato shartnoma uchun mos variantlarni topish (description'dan nom ham olib) */}
      {lookupContractDetail && (
        <ContractLookupDialog
          contractNumber={lookupContractDetail.contract}
          description={lookupContractDetail.description}
          onClose={() => setLookupContractDetail(null)}
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

// ═══ COLUMN TH — filter icon bilan ustun headeri (Google Sheets stilida)
// `tabs` berilsa, popover ichida tab bar ko'rsatiladi (masalan: Bank + Hisob raqami)
function ColumnTh({
  label, column, widthClass, filterMode, columnFilters, setColumnFilters,
  openFilterColumn, setOpenFilterColumn, alignRight, activeFilterParams, tabs,
}: {
  label: string;
  column: string;
  widthClass?: string;
  filterMode: boolean;
  columnFilters: Record<string, Set<string>>;
  setColumnFilters: React.Dispatch<React.SetStateAction<Record<string, Set<string>>>>;
  openFilterColumn: string | null;
  setOpenFilterColumn: (col: string | null) => void;
  alignRight?: boolean;
  activeFilterParams: string;
  tabs?: Array<{ column: string; label: string }>;
}) {
  // Tab bo'lsa — barcha tab'lar bo'yicha aktiv tanlovni jamlaymiz
  const tabColumns = tabs ? tabs.map((t) => t.column) : [column];
  const activeCount = tabColumns.reduce((acc, c) => acc + (columnFilters[c]?.size || 0), 0);
  const active = activeCount > 0;
  const isOpen = openFilterColumn === column;
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <th className={cn('text-left px-4 py-3', widthClass)}>
      <div className="flex items-center gap-1.5">
        <span>{label}</span>
        {filterMode && (
          <button
            ref={btnRef}
            onClick={() => setOpenFilterColumn(isOpen ? null : column)}
            className={cn(
              'inline-flex items-center justify-center w-5 h-5 rounded transition-colors',
              active
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-indigo-700 hover:bg-indigo-100',
            )}
            title={active ? `${activeCount} qiymat tanlangan` : 'Filter'}
          >
            <FilterIcon className="h-3 w-3" />
          </button>
        )}
      </div>
      {isOpen && (
        <ColumnFilterPopover
          column={column}
          tabs={tabs}
          selectedByColumn={Object.fromEntries(
            tabColumns.map((c) => [c, columnFilters[c] || new Set()]),
          )}
          alignRight={alignRight}
          triggerRef={btnRef}
          activeFilterParams={activeFilterParams}
          onClose={() => setOpenFilterColumn(null)}
          onApply={(byColumn) => {
            setColumnFilters((prev) => {
              const next = { ...prev };
              for (const [c, set] of Object.entries(byColumn)) next[c] = set;
              return next;
            });
            setOpenFilterColumn(null);
          }}
        />
      )}
    </th>
  );
}

// ═══ COLUMN FILTER POPOVER — Portal orqali document.body'ga render
// tabs berilsa, ichida bir nechta tab bo'ladi (har biri alohida column'ga mos)
function ColumnFilterPopover({
  column, selectedByColumn, onClose, onApply, alignRight, triggerRef, activeFilterParams, tabs,
}: {
  column: string;
  selectedByColumn: Record<string, Set<string>>;
  onClose: () => void;
  onApply: (byColumn: Record<string, Set<string>>) => void;
  alignRight?: boolean;
  triggerRef: React.RefObject<HTMLElement>;
  activeFilterParams: string;
  tabs?: Array<{ column: string; label: string }>;
}) {
  // Tab'lar: agar berilmagan bo'lsa — bitta tab (asosiy column)
  const tabList = tabs && tabs.length > 0 ? tabs : [{ column, label: '' }];
  const [activeTab, setActiveTab] = useState<string>(tabList[0].column);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Har bir column uchun alohida lokal tanlov (Apply bosilgunga qadar)
  const [localByColumn, setLocalByColumn] = useState<Record<string, Set<string>>>(
    () => Object.fromEntries(tabList.map((t) => [t.column, new Set(selectedByColumn[t.column] || [])])),
  );
  const localSelected = localByColumn[activeTab] || new Set<string>();
  const setLocalSelected = (next: Set<string>) =>
    setLocalByColumn((prev) => ({ ...prev, [activeTab]: next }));

  // Tab almashganda search'ni tozalaymiz
  useEffect(() => { setSearch(''); }, [activeTab]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Backend'dan distinct qiymatlar (aktiv filterlar bilan) — aktiv tab column bo'yicha
  const distinctQuery = useQuery({
    queryKey: ['tx-distinct', activeTab, debouncedSearch, activeFilterParams],
    queryFn: () => api.get<{ ok: boolean; values: Array<{ id: string; name: string }> }>(
      `/transactions/distinct?column=${encodeURIComponent(activeTab)}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}${activeFilterParams ? `&${activeFilterParams}` : ''}`,
    ),
    staleTime: 30_000,
  });
  const distinctList = distinctQuery.data?.values || [];

  // Normalize: pastki harflar + O/0 + I/1 + S/5 + B/8 → bir xil ko'rinish
  // (shartnoma raqamlarida foydalanuvchi 'O' yozsa ham '0' bo'lgan raqamni topa olsin)
  function normalizeForSearch(s: string): string {
    return s.toLowerCase()
      .replace(/o/g, '0')
      .replace(/i/g, '1')
      .replace(/s/g, '5')
      .replace(/b/g, '8');
  }

  const allValues = useMemo(() => {
    const arr = distinctList.map((d) => ({ id: d.id, name: d.name }));
    if (!search.trim()) return arr;
    const q = normalizeForSearch(search.trim());
    return arr.filter((v) => normalizeForSearch(v.name).includes(q));
  }, [distinctList, search]);

  const allSelected = allValues.length > 0 && allValues.every((v) => localSelected.has(v.id));

  function toggleAll() {
    const next = new Set(localSelected);
    if (allSelected) {
      for (const v of allValues) next.delete(v.id);
    } else {
      for (const v of allValues) next.add(v.id);
    }
    setLocalSelected(next);
  }
  function toggleOne(id: string) {
    const next = new Set(localSelected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setLocalSelected(next);
  }

  // Faqat tashqi click'da yopish — scroll'da yopilmasin (popover ichida ham scroll qilinadi)
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-col-filter]')) onClose();
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  // Trigger button koordinatalari (fixed positioning uchun)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!triggerRef.current) return;
    function update() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const popoverWidth = 384;
      const top = rect.bottom + 4;
      const left = alignRight
        ? Math.max(8, rect.right - popoverWidth)
        : Math.min(rect.left, window.innerWidth - popoverWidth - 8);
      setPos({ top, left });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [alignRight, triggerRef]);

  if (!pos) return null;

  return createPortal(
    <div
      data-col-filter
      className="fixed z-[100] w-96 rounded-xl bg-white ring-1 ring-slate-200 shadow-2xl normal-case tracking-normal font-normal"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-3 space-y-2">
        {tabList.length > 1 && (
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
            {tabList.map((t) => {
              const count = localByColumn[t.column]?.size || 0;
              const isActive = activeTab === t.column;
              return (
                <button
                  key={t.column}
                  onClick={() => setActiveTab(t.column)}
                  className={cn(
                    'flex-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5',
                    isActive ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  <span>{t.label}</span>
                  {count > 0 && (
                    <span className={cn(
                      'inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold',
                      isActive ? 'bg-indigo-600 text-white' : 'bg-slate-300 text-slate-700',
                    )}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setLocalSelected(new Set(allValues.map((v) => v.id)))}
            className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Hammasini tanlash ({distinctList.length})
          </button>
          <button
            onClick={() => setLocalSelected(new Set())}
            className="text-[11px] text-slate-500 hover:text-rose-600 font-medium"
          >
            Tozalash
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Qidirish..."
            className="pl-8 h-8 text-[12px]"
          />
        </div>
        <div className="max-h-[340px] overflow-y-auto rounded-lg ring-1 ring-slate-100 divide-y divide-slate-50">
          {distinctQuery.isLoading ? (
            <div className="px-3 py-4 text-center text-[11px] text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Yuklanmoqda...
            </div>
          ) : allValues.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-slate-400 italic">Topilmadi</div>
          ) : (
            <>
              <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 rounded"
                />
                <span className="text-[11px] font-semibold text-slate-700">
                  {allSelected ? 'Hammasini olib tashlash' : 'Hammasini belgilash'}
                </span>
              </label>
              {allValues.map((v) => {
                // "(xato)" suffix bo'lsa — alohida badge bilan ko'rsatish
                const xatoMatch = v.name.match(/^(.+?)\s*\(xato\)\s*$/i);
                const display = xatoMatch ? xatoMatch[1] : v.name;
                const isXato = !!xatoMatch;
                return (
                  <label key={v.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSelected.has(v.id)}
                      onChange={() => toggleOne(v.id)}
                      className="w-3.5 h-3.5 rounded"
                    />
                    <span className="text-[11px] text-slate-700 truncate flex-1" title={v.name}>{display}</span>
                    {isXato && (
                      <span className="text-[9px] font-bold text-rose-700 bg-rose-50 px-1 py-0.5 rounded ring-1 ring-rose-200 uppercase shrink-0">
                        xato
                      </span>
                    )}
                  </label>
                );
              })}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-slate-100">
        <Button variant="outline" size="sm" onClick={onClose} className="h-7 text-[11px]">
          Bekor
        </Button>
        <Button size="sm" onClick={() => onApply(localByColumn)} className="h-7 text-[11px]">
          OK
        </Button>
      </div>
    </div>,
    document.body,
  );
}

// ═══ AI SHARTNOMA LOOKUP — xato shartnoma uchun CRM'dan o'xshashlarni ko'rish (info only)
// Description'dan mijoz nomini ham ajratib oladi va shu nom bilan ham mos kelishini tekshiradi
function ContractLookupDialog({ contractNumber, description, onClose }: {
  contractNumber: string;
  description: string | null;
  onClose: () => void;
}) {
  // Description'dan mijoz F.I.O. ajratish — kengaytirilgan pattern'lar
  const extractedName = useMemo(() => {
    if (!description) return null;
    const patterns = [
      // "на имя XYZ" (rus)
      /на\s+имя\s+([A-ZА-ЯЁ][A-ZА-ЯЁ\s'`-]{4,80}?)(?:\s*,|\s+адрес|\s+от\s|\s+с\s|\s+за|\s+\d|$)/i,
      // "F.I.O.: XYZ"
      /F\.?I\.?O\.?\s*[:\s]+([A-ZА-ЯЁ][A-ZА-ЯЁ\s'`-]{4,80}?)(?:\s*,|\s+адрес|\s+\d|$)/i,
      // "F¸I¸O: XYZ"
      /Ф\.?\s*И\.?\s*О\.?\s*[:\s]+([A-ZА-ЯЁ][A-ZА-ЯЁ\s'`-]{4,80}?)(?:\s*,|\s+адрес|\s+\d|$)/i,
      // Uzbek: XYZ O'G'LI/QIZI/УГЛИ/ҚИЗИ
      /([A-ZА-ЯЁ]{3,}\s+[A-ZА-ЯЁ]{3,}(?:\s+[A-ZА-ЯЁ]{2,})?\s+(?:O[GʻG'`]LI|QIZI|ОГЛЫ|КЫЗЫ|УГЛИ|ЎҒЛИ|ҚИЗИ))/i,
      // "от XYZ" — odam ismi keladi
      /от\s+([A-ZА-ЯЁ]{3,}\s+[A-ZА-ЯЁ]{3,}(?:\s+[A-ZА-ЯЁ]{3,})?)/i,
      // FAMILYA ISMI OTASI — 3 ta katta harfli so'z (oxirgi resort)
      /\b([А-ЯЁ]{4,}\s+[А-ЯЁ]{3,}\s+[А-ЯЁ]{3,})/,
      /\b([A-Z]{4,}\s+[A-Z]{3,}\s+[A-Z]{3,})/,
    ];
    for (const p of patterns) {
      const m = description.match(p);
      if (m && m[1]) {
        const cleaned = m[1].trim().replace(/\s+/g, ' ');
        // Bank atamalar/oddiy so'zlardan saqlanish
        if (/^(тариф|оплата|перевод|перечисление|за|по|для|comission|fee)/i.test(cleaned)) continue;
        return cleaned;
      }
    }
    return null;
  }, [description]);

  // Avtomatik prefix qidirish — to'liq → qisqartirilgan (4 belgi minimum, juda loose emas)
  // Misol: "483VDY253K" → ["483VDY253K", "483VDY25", "483VDY", "483V"]
  const tryPrefixes = useMemo(() => {
    const c = contractNumber.trim();
    const result: string[] = [];
    if (c.length > 0) result.push(c);                                    // to'liq
    if (c.length > 8) result.push(c.slice(0, 8));                       // 8 belgi
    if (c.length > 6) result.push(c.slice(0, 6));                       // 6 belgi
    if (c.length > 5) result.push(c.slice(0, 5));                       // 5 belgi
    if (c.length >= 4) result.push(c.slice(0, 4));                      // 4 belgi (oxirgi)
    return [...new Set(result)];
  }, [contractNumber]);

  const [currentPrefixIndex, setCurrentPrefixIndex] = useState(0);
  const currentPrefix = tryPrefixes[currentPrefixIndex] || '';

  const searchQuery = useQuery({
    queryKey: ['crm-lookup', currentPrefix],
    queryFn: () => api.get<{ ok: boolean; total: number; items: any[] }>(`/crm/search?contract=${encodeURIComponent(currentPrefix)}&perPage=20`),
    enabled: currentPrefix.length >= 3,
    staleTime: 60_000,
  });
  const items = searchQuery.data?.items || [];

  // Topilmasa qisqaroq prefix bilan (sortedItems'da prefix bilan boshlangan natija bo'lmasa ham retry)
  useEffect(() => {
    if (searchQuery.isFetching) return;
    if (currentPrefixIndex >= tryPrefixes.length - 1) return;
    // Agar prefiks bilan boshlangan natija yo'q bo'lsa, keyingi (qisqaroq) prefiksga o'tish
    const prefixUpper = currentPrefix.toUpperCase();
    const hasStartsWith = items.some((it: any) =>
      String(it.contract || '').toUpperCase().startsWith(prefixUpper)
    );
    if (!hasStartsWith) {
      setCurrentPrefixIndex((i) => i + 1);
    }
  }, [searchQuery.isFetching, items, currentPrefixIndex, tryPrefixes.length, currentPrefix]);

  // Filter + sort
  // 1) Faqat prefix bilan boshlangan kontraktlar (XonSaroy contains qiladi, bizga startsWith kerak)
  // 2) Agar F.I.O. ajratilgan bo'lsa, nom mos kelganlari tepada
  // 3) Hech narsa mos kelmasa, original ro'yxat (kamida prefix mos)
  const sortedItems = useMemo(() => {
    if (items.length === 0) return [];
    const prefixUpper = currentPrefix.toUpperCase();
    // Birinchi: prefiksga startsWith bo'yicha filter
    const prefixed = items.filter((it: any) =>
      String(it.contract || '').toUpperCase().startsWith(prefixUpper)
    );
    // Agar prefix bilan boshlangan natija bo'sh bo'lsa — original (XonSaroy substring matchlar) qaytar
    const base = prefixed.length > 0 ? prefixed : items;
    // F.I.O. mos kelganlarini tepaga ko'taramiz
    if (!extractedName) return base;
    const nameWords = extractedName.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    return [...base].sort((a, b) => {
      const aName = (a.customerName || '').toLowerCase();
      const bName = (b.customerName || '').toLowerCase();
      const aScore = nameWords.filter((w) => aName.includes(w)).length;
      const bScore = nameWords.filter((w) => bName.includes(w)).length;
      return bScore - aScore;
    });
  }, [items, extractedName, currentPrefix]);

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-fuchsia-600" /> AI shartnoma topish
          </DialogTitle>
          <DialogDescription>
            CRM'da topilmagan shartnoma uchun AI tomonidan tahlil qilingan variantlar
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Mijoz bergan shartnoma + topilgan F.I.O. (2 blok, har doim ko'rinadi) */}
          <div className="rounded-lg p-3 bg-gradient-to-br from-rose-50 to-orange-50 ring-1 ring-rose-200 space-y-2">
            <div className="text-[10px] uppercase tracking-wider font-bold text-rose-700">
              Tolov maqsadida kelgan:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Shartnoma raqami */}
              <div>
                <div className="text-[9px] uppercase tracking-wider font-bold text-rose-600 mb-0.5 flex items-center gap-1">
                  <FileSignature className="h-2.5 w-2.5" /> Shartnoma raqami
                </div>
                <code className="font-mono text-[13px] font-bold text-rose-900 select-all block break-all">
                  {contractNumber}
                </code>
              </div>
              {/* F.I.O. — har doim block (topilmasa "AI topa olmadi" yoziladi) */}
              <div>
                <div className="text-[9px] uppercase tracking-wider font-bold text-rose-600 mb-0.5 flex items-center gap-1">
                  <Wand2 className="h-2.5 w-2.5" /> F.I.O. (AI ajratdi)
                </div>
                {extractedName ? (
                  <div className="text-[12px] font-semibold text-rose-900 select-all break-words">
                    {extractedName}
                  </div>
                ) : (
                  <div className="text-[11px] text-rose-500 italic">
                    Description'dan F.I.O. topilmadi
                  </div>
                )}
              </div>
            </div>
            <div className="text-[10px] text-rose-600 pt-1 border-t border-rose-200/60">
              ⚠ CRM'da topilmadi — quyidagi o'xshashlardan tasdiqlang
            </div>
          </div>

          {/* CRM natijalari */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-600 mb-1.5 flex items-center justify-between">
              <span>O'xshash shartnomalar (prefix: <code className="font-mono text-indigo-700">{currentPrefix}</code>)</span>
              {searchQuery.isFetching && <Loader2 className="h-3 w-3 text-indigo-500 animate-spin" />}
            </div>
            <div className="max-h-[320px] overflow-y-auto rounded-lg ring-1 ring-slate-200 divide-y divide-slate-100">
              {!searchQuery.isFetching && items.length === 0 && currentPrefixIndex >= tryPrefixes.length - 1 && (
                <div className="px-4 py-6 text-center text-[11px] text-rose-600">
                  Hech qanday o'xshash shartnoma topilmadi
                </div>
              )}
              {sortedItems.map((it: any) => {
                const fullName = it.customerName
                  || it.client?.full_name_kirill
                  || it.client?.full_name_lotin
                  || it.client?.name
                  || it.object_name
                  || null;
                // Mosliklarni hisoblash
                const contractMatch = String(it.contract || '').toUpperCase() === contractNumber.toUpperCase();
                let nameMatch = false;
                let nameMatchScore = 0;
                if (extractedName && fullName) {
                  const nameWords = extractedName.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
                  const fullLower = fullName.toLowerCase();
                  nameMatchScore = nameWords.filter((w) => fullLower.includes(w)).length;
                  if (nameMatchScore >= 2) nameMatch = true;
                }
                const perfectMatch = contractMatch && nameMatch;
                return (
                  <div
                    key={it.contract || it.id}
                    className={cn(
                      'px-3 py-2 relative',
                      perfectMatch ? 'bg-emerald-100 ring-2 ring-emerald-400'
                        : nameMatch ? 'bg-emerald-50 ring-1 ring-emerald-200'
                        : contractMatch ? 'bg-amber-50 ring-1 ring-amber-200'
                        : 'hover:bg-slate-50',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className={cn(
                        'font-mono text-[12px] font-bold',
                        perfectMatch ? 'text-emerald-800' : nameMatch ? 'text-emerald-700' : contractMatch ? 'text-amber-700' : 'text-indigo-700',
                      )}>
                        {it.contract}
                      </code>
                      <div className="flex items-center gap-1">
                        {perfectMatch && (
                          <span className="text-[9px] font-black text-emerald-900 uppercase tracking-wider flex items-center gap-1 bg-emerald-200 px-1.5 py-0.5 rounded">
                            <CheckCircle2 className="h-2.5 w-2.5" /> aniq mos
                          </span>
                        )}
                        {!perfectMatch && nameMatch && (
                          <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                            <Wand2 className="h-2.5 w-2.5" /> nom mos
                          </span>
                        )}
                        {!perfectMatch && !nameMatch && contractMatch && (
                          <span className="text-[9px] font-bold text-amber-700 uppercase tracking-wider">
                            shartnoma mos
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-700 mt-0.5 font-medium">
                      {fullName || <span className="text-slate-400 italic">nomi yo'q</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {sortedItems.length > 0 && (
              <div className="text-[10px] text-slate-500 mt-2 text-center italic">
                Mijoz bilan tasdiqlash uchun ushbu ro'yxatdan foydalaning
              </div>
            )}
          </div>

          <div className="flex items-center justify-end pt-2 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={onClose}>
              Yopish
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══ BIRLASHTIRILGAN TAHRIR — Sequential 3 step: Kontragent → Kategoriya → Shartnoma
function CombinedEditDialog({
  row, tree, onClose, onSaveCategory, onSaveContract, savingCategory, savingContract,
}: {
  row: any;
  tree: any[];
  onClose: () => void;
  onSaveCategory: (categoryId: string | null, subcategoryId: string | null) => void;
  onSaveContract: (contract: string | null) => void;
  savingCategory: boolean;
  savingContract: boolean;
}) {
  // Step 1: Kontragent (top kategoriya)
  const [selectedTopId, setSelectedTopId] = useState<string | null>(row?.categoryId || null);
  // Step 2: Kategoriya (subkategoriya — top'dan filterlangan)
  const [selectedSubId, setSelectedSubId] = useState<string | null>(row?.subcategoryId || null);
  // Step 3: Shartnoma (faqat CLIENT uchun)
  const [contractQuery, setContractQuery] = useState(row?.contractNumber || '');
  const [debouncedQ, setDebouncedQ] = useState(contractQuery);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(contractQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [contractQuery]);

  const searchQuery = useQuery({
    queryKey: ['crm-search', debouncedQ],
    queryFn: () => api.get<{ ok: boolean; total: number; items: any[] }>(`/crm/search?contract=${encodeURIComponent(debouncedQ)}&perPage=15`),
    enabled: debouncedQ.length >= 3,
    staleTime: 60_000,
  });
  const crmItems = searchQuery.data?.items || [];

  // Kontragent picker'dan yashiriladigan kategoriyalar (qo'lda tanlash uchun emas)
  const HIDDEN_KONTRAGENTS = ['COUNTERPARTY_RETURN', 'COUNTERPARTY'];
  const visibleTree = tree.filter((t: any) => !HIDDEN_KONTRAGENTS.includes(t.code));

  const selectedTop = tree.find((t) => t.id === selectedTopId);
  const subs = selectedTop?.children || [];
  const isClient = selectedTop?.code === 'CLIENT';
  const selectedSub = subs.find((s: any) => s.id === selectedSubId);
  const topColor = selectedTop?.color || '#6366f1';

  const categoryChanged =
    selectedTopId !== (row?.categoryId || null) ||
    selectedSubId !== (row?.subcategoryId || null);

  function pickKontragent(t: any) {
    setSelectedTopId(t.id);
    // Top o'zgarsa — sub null bo'ladi (parent-child constraint)
    if (t.id !== row?.categoryId) setSelectedSubId(null);
    else setSelectedSubId(row?.subcategoryId || null);
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-600" /> Qo'lda tahrirlash
          </DialogTitle>
          <DialogDescription>
            Avval Kontragent, keyin Kategoriya tanlang. Klient bo'lsa Shartnoma ham ko'rinadi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ═══ STEP 1: KONTRAGENT (top kategoriya) ═══ */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2 block flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px]">1</span>
              Kontragent
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {visibleTree.map((t: any) => {
                const selected = selectedTopId === t.id;
                const color = t.color || '#64748b';
                return (
                  <button
                    key={t.id}
                    onClick={() => pickKontragent(t)}
                    className={cn(
                      'text-left px-3 py-2 rounded-lg ring-1 ring-inset text-[12px] font-medium transition-all',
                      selected ? 'ring-2' : 'ring-slate-200 hover:ring-slate-300 hover:bg-slate-50',
                    )}
                    style={selected ? { backgroundColor: `${color}15`, color, borderColor: color } : {}}
                  >
                    {t.name}
                    {selected && <CheckCircle2 className="inline-block h-3 w-3 ml-1.5" style={{ color }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ═══ STEP 2: KATEGORIYA (subkategoriya — faqat top tanlangan bo'lsa) ═══ */}
          {selectedTop && (
            <div className="pt-3 border-t border-slate-100">
              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2 block flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px]">2</span>
                Kategoriya
                <span className="text-slate-400 font-normal normal-case tracking-normal ml-1">
                  ({selectedTop.name} uchun)
                </span>
              </label>
              {subs.length === 0 ? (
                <div className="text-[11px] text-slate-500 px-3 py-2 rounded-lg bg-slate-50 ring-1 ring-slate-200">
                  {selectedTop.name} uchun subkategoriya yo'q — faqat top kategoriya saqlanadi
                </div>
              ) : (
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
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSubId(s.id)}
                        className={cn(
                          'px-3 py-1.5 rounded-md text-[11px] font-medium ring-1 ring-inset transition-all',
                          selected ? 'ring-2' : 'ring-slate-200 hover:ring-slate-300 text-slate-700',
                        )}
                        style={selected ? { backgroundColor: `${topColor}15`, color: topColor, borderColor: topColor } : {}}
                      >
                        {s.name}
                        {selected && <CheckCircle2 className="inline-block h-3 w-3 ml-1" style={{ color: topColor }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Saqlash tugma — kategoriya */}
          {selectedTop && (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setSelectedTopId(null); setSelectedSubId(null); }}
                disabled={savingCategory}
                className="text-[11px] text-rose-600 hover:text-rose-700 font-medium"
              >
                Tozalash
              </button>
              <Button
                size="sm"
                onClick={() => onSaveCategory(selectedTopId, selectedSubId)}
                disabled={savingCategory || !categoryChanged}
                className="h-8 text-[11px]"
              >
                {savingCategory ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Kategoriyani saqlash'}
              </Button>
            </div>
          )}

          {/* ═══ STEP 3: SHARTNOMA — faqat CLIENT yoki TRANSFER (Переброска) uchun ═══ */}
          {selectedTop && (selectedTop.code === 'CLIENT' || selectedTop.code === 'TRANSFER') && (
            <div className="pt-4 border-t border-indigo-200">
              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2 block flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px]">3</span>
                Shartnoma raqami
                <span className="text-slate-400 font-normal normal-case tracking-normal ml-1">
                  (CRM'dan qidirish)
                </span>
              </label>
              <div className="relative mb-2">
                <FileSignature className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={contractQuery}
                  onChange={(e) => setContractQuery(e.target.value)}
                  placeholder="3+ belgi yozsangiz CRM'dan izlanadi"
                  className="pl-9 font-mono"
                />
                {searchQuery.isFetching && debouncedQ.length >= 3 && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-500 animate-spin" />
                )}
              </div>
              {debouncedQ.length >= 3 && (
                <div className="max-h-[200px] overflow-y-auto rounded-lg ring-1 ring-slate-200 divide-y divide-slate-100">
                  {crmItems.length === 0 && !searchQuery.isFetching && (
                    <div className="px-4 py-3 text-[11px] text-rose-600">
                      CRM'da topilmadi — bu raqam saqlash uchun yaroqsiz
                    </div>
                  )}
                  {crmItems.map((it: any) => {
                    const fullName = it.customerName
                      || it.client?.full_name_kirill
                      || it.client?.full_name_lotin
                      || it.client?.name
                      || it.object_name
                      || null;
                    return (
                      <button
                        key={it.contract || it.id}
                        onClick={() => onSaveContract(String(it.contract || '').trim())}
                        disabled={savingContract}
                        className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition-colors disabled:opacity-50 group"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <code className="font-mono text-[12px] font-bold text-indigo-700 group-hover:text-indigo-900">
                            {it.contract}
                          </code>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 opacity-0 group-hover:opacity-100" />
                        </div>
                        <div className="text-[11px] text-slate-700 truncate mt-0.5 font-medium">
                          {fullName || <span className="text-slate-400 italic">nomi yo'q</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="mt-2 flex items-center justify-end">
                <button
                  onClick={() => onSaveContract(null)}
                  disabled={savingContract || !row?.contractNumber}
                  className="text-[10px] text-rose-600 hover:text-rose-700 font-medium disabled:opacity-30"
                >
                  Shartnomani tozalash
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end pt-3 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={onClose}>
              Yopish
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══ ESKI — endi ishlatilmaydi (saqlangan kelajak uchun)
function ContractEditDialog({
  currentContract, onClose, onSave, saving,
}: {
  currentContract: string | null;
  onClose: () => void;
  onSave: (contract: string | null) => void;
  saving: boolean;
}) {
  const [query, setQuery] = useState(currentContract || '');
  const [debouncedQ, setDebouncedQ] = useState(query);

  // Debounce 300ms — har harf kiritilganda CRM'ga so'rov yubormaslik uchun
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // CRM search
  const searchQuery = useQuery({
    queryKey: ['crm-search', debouncedQ],
    queryFn: () => api.get<{ ok: boolean; total: number; items: any[] }>(`/crm/search?contract=${encodeURIComponent(debouncedQ)}&perPage=20`),
    enabled: debouncedQ.length >= 3,
    staleTime: 60_000,
  });
  const items = searchQuery.data?.items || [];

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-indigo-600" /> Shartnoma raqami
          </DialogTitle>
          <DialogDescription>
            CRM'dan qidirish uchun shartnoma raqamini yozing (3+ belgi)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Masalan: 1494VTN24DQ"
              className="pl-9 font-mono"
            />
            {searchQuery.isFetching && debouncedQ.length >= 3 && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-500 animate-spin" />
            )}
          </div>

          {debouncedQ.length < 3 ? (
            <div className="text-[11px] text-slate-400 italic px-2">
              Kamida 3 belgi kiriting…
            </div>
          ) : items.length === 0 && !searchQuery.isFetching ? (
            <div className="text-[11px] text-rose-600 px-2">
              CRM'da topilmadi — baribir saqlash mumkin (xato badge bilan)
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg ring-1 ring-slate-200 divide-y divide-slate-100">
              {items.map((it: any) => (
                <button
                  key={it.contract || it.id}
                  onClick={() => onSave(String(it.contract || '').trim())}
                  disabled={saving}
                  className="w-full text-left px-3 py-2 hover:bg-indigo-50 transition-colors disabled:opacity-50 group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-mono text-[12px] font-bold text-indigo-700 group-hover:text-indigo-900">
                      {it.contract}
                    </code>
                    {it.status && (
                      <span className="text-[9px] text-slate-500 uppercase tracking-wider">{it.status}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-600 truncate mt-0.5">
                    {it.client?.full_name_kirill || it.client?.full_name_lotin || it.client?.name || it.object_name || '—'}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <button
              onClick={() => onSave(null)}
              disabled={saving || !currentContract}
              className="text-[12px] text-rose-600 hover:text-rose-700 font-medium disabled:opacity-30"
            >
              Tozalash
            </button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
                Bekor qilish
              </Button>
              <Button
                size="sm"
                onClick={() => onSave(query.trim() || null)}
                disabled={saving || !query.trim() || query.trim() === currentContract}
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

  // Action turi: qo'shildi / o'zgartirildi / o'chirildi
  const hadOld = !!(h.oldCategoryName || h.oldSubcategoryName);
  const hasNew = !!(h.newCategoryName || h.newSubcategoryName);
  let actionLabel = '';
  let actionLabelCls = '';
  if (!hadOld && hasNew) { actionLabel = "qo'shildi";       actionLabelCls = 'text-emerald-700'; }
  else if (hadOld && hasNew) { actionLabel = "o'zgartirildi"; actionLabelCls = 'text-indigo-700'; }
  else if (hadOld && !hasNew) { actionLabel = "o'chirildi";   actionLabelCls = 'text-rose-700'; }

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
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider', cls)}>
            {h.action}
          </span>
          <span className="font-medium text-slate-700">{actorLabel}</span>
          {actionLabel && (
            <span className={cn('text-[10px] font-bold lowercase', actionLabelCls)}>
              {actionLabel}
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-500 tabular-nums">{formatDateTime(h.createdAt)}</span>
      </div>
      {/* Diff — faqat o'zgartirildi (eski + yangi) holatda ko'rsatish, qo'shildi/o'chirildi'da bittasi yetadi */}
      {hadOld && hasNew ? (
        <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
          <span className="line-through text-rose-600/80">
            {renderCat(h.oldCategoryName, h.oldSubcategoryName)}
          </span>
          <span className="text-slate-400">→</span>
          <span className="text-emerald-700">
            {renderCat(h.newCategoryName, h.newSubcategoryName)}
          </span>
        </div>
      ) : hasNew ? (
        <div className="text-[11px] text-emerald-700">
          {renderCat(h.newCategoryName, h.newSubcategoryName)}
        </div>
      ) : (
        <div className="text-[11px] text-rose-700 line-through">
          {renderCat(h.oldCategoryName, h.oldSubcategoryName)}
        </div>
      )}
      {h.reason && (
        <div className="text-[10px] text-slate-500 italic">{h.reason}</div>
      )}
      {h.contractNumber && (
        <div className="text-[10px] font-mono text-indigo-600">{h.contractNumber}</div>
      )}
    </div>
  );
}

// ═══ INFO ROW — Kontragent/Kategoriya/Shartnoma uchun yaxshi tuzilmali qator
function InfoRow({
  icon, label, value, subValue, chip, customValue, docNumber, emptyText, showClear, onClear,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  subValue?: string | null;
  chip?: { text: string; color: string } | null;
  customValue?: React.ReactNode;
  docNumber?: string;
  emptyText?: string;
  showClear?: boolean;
  onClear?: () => void;
}) {
  const hasValue = !!(value || chip || customValue);
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0">
      {/* Label (chap tomonda, sobit eni) */}
      <div className="w-28 shrink-0 pt-0.5">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1">
          {icon} {label}
        </div>
      </div>
      {/* Qiymat */}
      <div className="flex-1 min-w-0">
        {!hasValue && (
          <div className="text-[12px] text-slate-400 italic">{emptyText || '—'}</div>
        )}
        {chip && (
          <div
            className="inline-flex items-center px-2 py-0.5 rounded-md text-[12px] font-semibold ring-1 ring-inset"
            style={{
              backgroundColor: `${chip.color}18`,
              color: chip.color,
              borderColor: `${chip.color}40`,
            }}
          >
            {chip.text}
          </div>
        )}
        {customValue}
        {value && !chip && !customValue && (
          <div className="text-[13px] font-semibold text-slate-900 break-words">{value}</div>
        )}
        {subValue && (
          <div className="text-[10px] text-slate-500 mt-0.5 break-words">{subValue}</div>
        )}
      </div>
      {/* O'ng tomon: docNumber + clear */}
      <div className="flex items-center gap-1 shrink-0">
        {docNumber && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-50 text-slate-600 ring-1 ring-slate-200">
            <Receipt className="h-3 w-3" /> #{docNumber}
          </span>
        )}
        {showClear && (
          <button
            onClick={onClear}
            title="Tozalash"
            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
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
  // Daraxt ko'rinishida: bitta marta bosish — TOP yoki SUB tanlanadi
  // Parent <-> child bog'lanishi avtomatik (sub tanlansa, top auto)
  const [selectedTopId, setSelectedTopId] = useState<string | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (row) {
      setSelectedTopId(row.categoryId || null);
      setSelectedSubId(row.subcategoryId || null);
      setFilter('');
    }
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return null;

  const filterLower = filter.trim().toLowerCase();
  // Tree'ni filter bo'yicha kesib chiqamiz — parent yoki child mos kelsa parent qoladi
  const visible = filterLower
    ? tree
        .map((t) => {
          const matchTop = t.name.toLowerCase().includes(filterLower);
          const matchedChildren = (t.children || []).filter((s: any) => s.name.toLowerCase().includes(filterLower));
          if (matchTop) return t; // hammasi ko'rinadi
          if (matchedChildren.length > 0) return { ...t, children: matchedChildren };
          return null;
        })
        .filter(Boolean)
    : tree;

  function pickTop(t: any) {
    // Top'ni tanlash → sub null bo'ladi (top alohida holatda)
    setSelectedTopId(t.id);
    setSelectedSubId(null);
  }
  function pickSub(t: any, s: any) {
    // Sub'ni tanlash → top avtomatik parent'idan
    setSelectedTopId(t.id);
    setSelectedSubId(s.id);
  }

  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-indigo-600" /> Kategoriya tanlash
          </DialogTitle>
          <DialogDescription>
            Bevosita subkategoriyani tanlasangiz, ota-kategoriya avtomatik belgilanadi
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Qidirish... (masalan: vznosy, ndfl, salary)"
              className="pl-9 h-9"
            />
          </div>

          {/* Tree */}
          <div className="max-h-[400px] overflow-y-auto rounded-lg ring-1 ring-slate-200 divide-y divide-slate-100">
            {visible.length === 0 && (
              <div className="px-4 py-6 text-center text-[11px] text-slate-400 italic">
                Hech narsa topilmadi
              </div>
            )}
            {visible.map((t: any) => {
              const topSelected = selectedTopId === t.id && !selectedSubId;
              const color = t.color || '#64748b';
              const hasChildren = (t.children || []).length > 0;
              return (
                <div key={t.id}>
                  {/* Top kategoriya */}
                  <button
                    onClick={() => pickTop(t)}
                    className={cn(
                      'w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors',
                      topSelected && 'bg-indigo-50',
                    )}
                    style={topSelected ? { backgroundColor: `${color}12` } : {}}
                  >
                    <span className="font-semibold text-[12px]" style={{ color: topSelected ? color : undefined }}>
                      {t.name}
                    </span>
                    {topSelected && <CheckCircle2 className="h-3.5 w-3.5" style={{ color }} />}
                    {!hasChildren && !topSelected && (
                      <span className="text-[9px] text-slate-400 uppercase tracking-wider">tanlash</span>
                    )}
                  </button>
                  {/* Subkategoriyalar */}
                  {hasChildren && (t.children || []).map((s: any) => {
                    const subSelected = selectedSubId === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => pickSub(t, s)}
                        className={cn(
                          'w-full text-left pl-8 pr-3 py-1.5 flex items-center justify-between gap-2 text-[11px] hover:bg-slate-50 transition-colors',
                          subSelected && 'bg-indigo-50',
                        )}
                        style={subSelected ? { backgroundColor: `${color}12` } : {}}
                      >
                        <span className="text-slate-700" style={subSelected ? { color, fontWeight: 600 } : {}}>
                          ↳ {s.name}
                        </span>
                        {subSelected && <CheckCircle2 className="h-3 w-3" style={{ color }} />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Selected preview */}
          {(selectedTopId || selectedSubId) && (() => {
            const top = tree.find((t) => t.id === selectedTopId);
            const sub = top?.children?.find((s: any) => s.id === selectedSubId);
            const color = top?.color || '#64748b';
            return (
              <div className="rounded-lg p-2 ring-1 ring-indigo-200 bg-indigo-50/50 text-[11px]">
                <span className="text-slate-500">Tanlangan: </span>
                <span className="font-semibold" style={{ color }}>{top?.name}</span>
                {sub && (
                  <>
                    <span className="text-slate-400 mx-1">/</span>
                    <span className="font-semibold" style={{ color }}>{sub.name}</span>
                  </>
                )}
              </div>
            );
          })()}

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
