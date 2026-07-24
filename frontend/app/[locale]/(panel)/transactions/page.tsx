'use client';
// rebuild trigger — frontend force redeploy uchun

import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Wand2, Link2Off, EyeOff, MoreHorizontal, Download,
  ArrowDownLeft, ArrowUpRight, TrendingUp, ChevronLeft, ChevronRight,
  X, Calendar, Wallet, FileText, Eye, FileSpreadsheet, Copy, Check,
  Hash, Receipt, Link2, History, Loader2, AlertCircle, AlertTriangle,
  Wrench, Printer, ChevronDown, Tag, FileSignature, CheckCircle2,
  Filter as FilterIcon, Briefcase, Sparkles, Activity, Paperclip,
  Upload as UploadIcon, Trash2, FileIcon, Settings, ScanLine, Lock,
  RefreshCw, Landmark, Ban, Gauge, Scissors,
  Clock, Send, XCircle, FileWarning,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { TransactionsTabs } from '@/components/transactions-tabs';
import { IdInspectorDialog } from '@/components/id-inspector-dialog';
import { VipiskaDebugDialog } from '@/components/vipiska-debug-dialog';
import { PurposeInfoButton, PurposeModal } from '@/components/purpose-modal';
import { BankLogo } from '@/components/bank-logo';
import { DateRangeCalendar } from '@/components/date-range-calendar';
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Sparkline } from '@/components/sparkline';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { api, apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatDateTime, formatMoney, formatDate } from '@/lib/utils';

const MATCH_CLS: Record<string, string> = {
  AUTO:      'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900',
  MANUAL:    'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-900',
  PARTIAL:   'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900',
  IGNORED:   'bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700',
  UNMATCHED: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
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

// Backend syncContractChangeToOplataKv natijasi
type OplataKvSyncResult = {
  updated: boolean;
  skipped?: 'not-client' | 'no-row' | 'no-new-contract' | 'multiple-matches' | 'error';
  oplataKvId?: string;
  contractNo?: string;
  date?: string;
  paymentAmount?: string;
  object?: string | null;
  client?: string | null;
  txType?: string | null;
};

// Propagation muvaffaqiyatli bo'lgan OplataKv qatorida split (1 взнос / oylik)
// hisoblash uchun /oplata-kv/:id/split endpoint'ni chaqiradi (fire-and-forget).
function triggerOplataKvSplit(oplataKvId: string | undefined) {
  if (!oplataKvId) return;
  api.post(`/oplata-kv/${oplataKvId}/split`, {}).catch(() => {
    // sokin xato — background cron baribir keyin hisoblaydi
  });
}

// OplataKv propagation natijasini foydalanuvchiga toast bilan ko'rsatish
function showOplataKvSyncToast(sync: OplataKvSyncResult | undefined) {
  if (!sync) return;
  if (sync.updated) {
    // Split (1 взнос / oylik) chaqirish — fonda ishlaydi, javobni kutmaymiz
    triggerOplataKvSplit(sync.oplataKvId);
    // Real-time yangilangan ma'lumotlar ko'rsatiladi
    const amountNum = sync.paymentAmount ? Number(sync.paymentAmount) : 0;
    const formattedAmount = new Intl.NumberFormat('ru-RU').format(amountNum);
    toast.success(
      `✓ ОплатыКв jadvalida ham to'g'rilandi`,
      {
        description: [
          `Shartnoma: ${sync.contractNo}`,
          `Mijoz: ${sync.client || '—'}`,
          `Obyekt: ${sync.object || '—'}`,
          `Summa: ${amountNum < 0 ? '−' : '+'}${formattedAmount.replace('-', '')} UZS · ${sync.date}`,
        ].join('\n'),
        duration: 6000,
      },
    );
  } else if (sync.skipped === 'not-client') {
    // CLIENT kategoriya emas — OplataKv'ga tegmaymiz (silently)
    return;
  } else if (sync.skipped === 'no-row') {
    // OplataKv'da bunday qator yo'q — yangi qator sync vaqtida yaratiladi
    return;
  } else if (sync.skipped === 'multiple-matches') {
    toast.warning("ОплатыКв'da bir nechta mos qator — qo'lda tekshiring");
  } else if (sync.skipped === 'error') {
    toast.error("ОплатыКв sinxronizatsiyasida xato (logga yozildi)");
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
  // Granular action permissions (yangi rollar tizimi)
  const canManualEdit = !!user?.permissions?.includes(PERMS.TRANSACTIONS_MANUAL_EDIT);
  const canManualContract = !!user?.permissions?.includes(PERMS.TRANSACTIONS_MANUAL_CONTRACT);
  const canApplication = !!user?.permissions?.includes(PERMS.TRANSACTIONS_APPLICATION);
  const canAutoCategorize = !!user?.permissions?.includes(PERMS.TRANSACTIONS_AUTO_CATEGORIZE);
  const canExport = !!user?.permissions?.includes(PERMS.TRANSACTIONS_EXPORT);

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
  const [idInspectorTrigger, setIdInspectorTrigger] = useState(0);
  const [vipiskaDebugOpen, setVipiskaDebugOpen] = useState(false);
  const [xatoModalOpen, setXatoModalOpen] = useState(false);
  const [clientXatoOpen, setClientXatoOpen] = useState(false);
  const [todayStatsOpen, setTodayStatsOpen] = useState(false);
  const [extraToolsOpen, setExtraToolsOpen] = useState(false);
  const [idQuery, setIdQuery] = useState('');
  const [idSearching, setIdSearching] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [categoryEditRow, setCategoryEditRow] = useState<any>(null);
  const [lookupContract, setLookupContract] = useState<{ contract: string; description: string | null } | null>(null);

  // Google Sheets'ga o'xshash per-ustun filterlash
  const [columnFilterMode, setColumnFilterMode] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  // Shartnoma manbasi filtri — manual/ariza (multi-select)
  const [contractSources, setContractSources] = useState<Set<'manual' | 'ariza'>>(new Set());
  // Manba filtri — bank sync / import / aloqa bank
  const [sources, setSources] = useState<Set<'SYNC' | 'IMPORT' | 'ALOQA_BANK'>>(new Set());
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);
  // Summa filtri — 'exact' (aniq summa) yoki 'range' (summadan summagacha)
  const [amountFilter, setAmountFilter] = useState<{ mode: 'exact' | 'range'; exact: string; min: string; max: string }>(
    { mode: 'exact', exact: '', min: '', max: '' },
  );

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
      // Shartnoma manbasi (manual/ariza)
      const rawCs = localStorage.getItem('tx-contract-sources-v1');
      if (rawCs) {
        const arr = JSON.parse(rawCs);
        if (Array.isArray(arr) && arr.length > 0) setContractSources(new Set(arr));
      }
      // Manba (sync/import/aloqa)
      const rawSrc = localStorage.getItem('tx-sources-v1');
      if (rawSrc) {
        const arr = JSON.parse(rawSrc);
        if (Array.isArray(arr) && arr.length > 0) setSources(new Set(arr));
      }
    } catch { /* ignore */ }
  }, []);

  // ContractSources va Sources'ni localStorage'ga yozish
  useEffect(() => {
    try {
      if (contractSources.size > 0) {
        localStorage.setItem('tx-contract-sources-v1', JSON.stringify(Array.from(contractSources)));
      } else {
        localStorage.removeItem('tx-contract-sources-v1');
      }
    } catch { /* ignore */ }
  }, [contractSources]);
  useEffect(() => {
    try {
      if (sources.size > 0) {
        localStorage.setItem('tx-sources-v1', JSON.stringify(Array.from(sources)));
      } else {
        localStorage.removeItem('tx-sources-v1');
      }
    } catch { /* ignore */ }
  }, [sources]);

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
      toast.success(t('categorySaved'));
      setCategoryEditRow(null);
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  // Recategorize progress modal — live polling bilan ko'rsatadi
  const [recategorizeOpen, setRecategorizeOpen] = useState(false);
  const [schotchikBackfillOpen, setSchotchikBackfillOpen] = useState(false);
  const recategorizeAllMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; started?: boolean; message?: string }>('/categorization/run-all'),
    onSuccess: (r: any) => {
      setRecategorizeOpen(true); // modal ochish (toast o'rniga)
      setTimeout(() => qc.invalidateQueries({ queryKey: ['transactions'] }), 30_000);
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  async function searchById(forceId?: string) {
    const id = (forceId || idQuery).trim();
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

  // URL'da ?searchId=X bo'lsa avtomatik qidiramiz (Biling sahifadan link uchun)
  const _searchParams = useSearchParams();
  const _router = useRouter();
  const _pathname = usePathname();
  useEffect(() => {
    const sid = _searchParams.get('searchId');
    if (sid && sid.trim()) {
      searchById(sid.trim());
      // URL'dan param olib tashlash (qayta yangilashda double-trigger bo'lmasin)
      const params = new URLSearchParams(_searchParams.toString());
      params.delete('searchId');
      _router.replace(_pathname + (params.toString() ? '?' + params.toString() : ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_searchParams]);

  // URL'da ?batchId=X bo'lsa — faqat shu import yuklamasidagi tranzaksiyalarni ko'rsatamiz
  // (Import sahifasidagi "ko'rish" tugmasi shu yerga olib keladi)
  const [batchFilter, setBatchFilter] = useState<string | null>(null);
  useEffect(() => {
    const bid = _searchParams.get('batchId');
    setBatchFilter(bid && bid.trim() ? bid.trim() : null);
  }, [_searchParams]);

  function clearBatchFilter() {
    setBatchFilter(null);
    const p = new URLSearchParams(_searchParams.toString());
    p.delete('batchId');
    _router.replace(_pathname + (p.toString() ? '?' + p.toString() : ''));
  }

  // Active filter count
  const activeFilters = useMemo(() => {
    let c = 0;
    if (direction !== 'all') c++;
    if (bankId !== 'all') c++;
    if (dateFrom) c++;
    if (dateTo) c++;
    if (contractSources.size > 0) c++;
    if (sources.size > 0) c++;
    for (const k of Object.keys(columnFilters)) {
      if (columnFilters[k]?.size > 0) c++;
    }
    // Summa filtri
    const d = (s: string) => s.replace(/[^\d.]/g, '');
    const amtActive = amountFilter.mode === 'exact'
      ? d(amountFilter.exact) !== ''
      : (d(amountFilter.min) !== '' || d(amountFilter.max) !== '');
    if (amtActive) c++;
    return c;
  }, [direction, bankId, dateFrom, dateTo, columnFilters, contractSources, sources, amountFilter]);

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

  // Summa filtri — faqat raqamlar (bo'shliq/formatni tozalaymiz), amountMin/amountMax param
  const amountDigits = (s: string) => s.replace(/[^\d.]/g, '');
  const amountActive = amountFilter.mode === 'exact'
    ? amountDigits(amountFilter.exact) !== ''
    : (amountDigits(amountFilter.min) !== '' || amountDigits(amountFilter.max) !== '');
  const applyAmountParams = (p: URLSearchParams) => {
    if (amountFilter.mode === 'exact') {
      const v = amountDigits(amountFilter.exact);
      if (v) { p.set('amountMin', v); p.set('amountMax', v); }
    } else {
      const mn = amountDigits(amountFilter.min);
      const mx = amountDigits(amountFilter.max);
      if (mn) p.set('amountMin', mn);
      if (mx) p.set('amountMax', mx);
    }
  };
  const amountKey = amountActive
    ? `${amountFilter.mode}:${amountDigits(amountFilter.exact)}:${amountDigits(amountFilter.min)}:${amountDigits(amountFilter.max)}`
    : '';

  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (q) params.set('q', q);
  if (direction !== 'all') params.set('direction', direction);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (bankId !== 'all') params.set('bankId', bankId);
  if (batchFilter) params.set('batchId', batchFilter);
  // Column filterlarni URL'ga qo'shamiz
  for (const [col, paramName] of Object.entries(COLUMN_TO_PARAM)) {
    const set = columnFilters[col];
    if (set && set.size > 0) params.set(paramName, Array.from(set).join(','));
  }
  // Shartnoma manbasi (qo'lda/ariza)
  if (contractSources.size > 0) params.set('contractSources', Array.from(contractSources).join(','));
  // Manba (sync/import/aloqa)
  if (sources.size > 0) params.set('sources', Array.from(sources).join(','));
  // Summa filtri
  applyAmountParams(params);

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
    if (contractSources.size > 0) p.set('contractSources', Array.from(contractSources).join(','));
    if (sources.size > 0) p.set('sources', Array.from(sources).join(','));
    applyAmountParams(p);
    return p.toString();
  })();

  const contractSourcesKey = Array.from(contractSources).sort().join(',');
  const sourcesKey = Array.from(sources).sort().join(',');
  const { data, isLoading } = useQuery({
    queryKey: ['transactions', page, perPage, q, direction, dateFrom, dateTo, bankId, columnFiltersKey, contractSourcesKey, batchFilter, sourcesKey, amountKey],
    queryFn: () => api.get<{ items: any[]; total: number; page: number; perPage: number }>(`/transactions?${params}`),
  });
  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });
  // Klient-XATO to'g'rilash — kutilayotgan arizalar soni (toolbar badge uchun)
  const { data: correctionStats } = useQuery({
    queryKey: ['correction-stats'],
    queryFn: () => api.get<{ ok: boolean; pending: number; approved: number }>('/correction/stats'),
    refetchInterval: 30000,
  });
  // KPI toggle: 'all' (oxirgi 30 kun) yoki 'CLIENT' (shu oy — debitorka)
  const [kpiMode, setKpiMode] = useState<'all' | 'CLIENT'>('all');

  const { data: stats } = useQuery({
    queryKey: ['tx-stats', kpiMode, dateFrom, dateTo, bankId, direction, q, columnFiltersKey, contractSourcesKey, batchFilter, sourcesKey, amountKey],
    queryFn: () => {
      // Foydalanuvchi sana filtri qo'ygan bo'lsa — shu davr; aks holda 30 kun (yoki CLIENT uchun joriy oy)
      let fromStr: string;
      let toStr: string | undefined;
      if (dateFrom || dateTo) {
        fromStr = dateFrom || '';
        toStr = dateTo || undefined;
      } else if (kpiMode === 'CLIENT') {
        const today = new Date();
        const from = new Date(today.getFullYear(), today.getMonth(), 1);
        fromStr = from.toISOString().slice(0, 10);
        toStr = today.toISOString().slice(0, 10);
      } else {
        const from = new Date();
        from.setDate(from.getDate() - 30);
        fromStr = from.toISOString().slice(0, 10);
        toStr = undefined;
      }
      const p = new URLSearchParams();
      if (fromStr) p.set('from', fromStr);
      if (toStr) p.set('to', toStr);
      if (kpiMode === 'CLIENT') p.set('categoryCode', 'CLIENT');
      if (bankId && bankId !== 'all') p.set('bankId', bankId);
      if (direction && direction !== 'all') p.set('direction', direction);
      if (q) p.set('q', q);
      if (batchFilter) p.set('batchId', batchFilter);
      // Kolonna (Google Sheets stilidagi) filterlar — KPI ham jadval bilan bir xil bo'lishi uchun
      for (const [col, paramName] of Object.entries(COLUMN_TO_PARAM)) {
        const set = columnFilters[col];
        if (set && set.size > 0) p.set(paramName, Array.from(set).join(','));
      }
      if (contractSources.size > 0) p.set('contractSources', Array.from(contractSources).join(','));
      if (sources.size > 0) p.set('sources', Array.from(sources).join(','));
      applyAmountParams(p);
      return api.get<any>(`/transactions/stats?${p.toString()}`);
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
  // TRANZAKSIYA SONI:
  //   - CLIENT/DEBITORKA rejimida → stats.total (faqat CLIENT kategoriya, shu oy)
  //   - Aks holda → data.total (DB'dagi jami, joriy filterlar bilan)
  const txnCount = kpiMode === 'CLIENT'
    ? (stats?.total ?? 0)
    : (data?.total ?? stats?.total ?? 0);
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
    applyAmountParams(p);
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
    setContractSources(new Set());
    setSources(new Set());
    setAmountFilter({ mode: 'exact', exact: '', min: '', max: '' });
    try {
      localStorage.removeItem('tx-column-filters-v1');
      localStorage.removeItem('tx-contract-sources-v1');
      localStorage.removeItem('tx-sources-v1');
    } catch { /* ignore */ }
  }

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <TransactionsTabs />

      <div className="flex-1 p-3 sm:p-6 lg:p-8 space-y-5 w-full">

        {/* ═══ IMPORT FILTRI banneri — faqat shu yuklamadagi tranzaksiyalar ═══ */}
        {batchFilter && (
          <div className="flex items-center gap-3 rounded-xl ring-1 ring-indigo-200 dark:ring-indigo-900 bg-indigo-50/70 dark:bg-indigo-950/40 px-4 py-3">
            <span className="inline-grid place-items-center h-8 w-8 rounded-lg bg-indigo-600 text-white shrink-0">
              <FileSpreadsheet className="h-4 w-4" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-indigo-900 dark:text-indigo-200">
                Import filtri yoqilgan
              </div>
              <div className="text-[11px] text-indigo-700/80 dark:text-indigo-300/80">
                Faqat shu yuklamada qo'shilgan tranzaksiyalar ko'rsatilmoqda · {data?.total ?? 0} ta
              </div>
            </div>
            <button
              type="button"
              onClick={clearBatchFilter}
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-800 hover:bg-indigo-50 dark:hover:bg-slate-700 transition-colors shrink-0"
            >
              <X className="h-3.5 w-3.5" /> Filtrni olib tashlash
            </button>
          </div>
        )}

        {/* ═══ KPI ROW (toggle: all / CLIENT only) ═══ */}
        <div className="relative">
          {kpiMode === 'CLIENT' && (
            <div className="absolute -top-2 left-3 px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider z-10 shadow">
              {t('kpiClientBadge')}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label={
                kpiMode === 'CLIENT' ? t('kpiClientIn')
                : (dateFrom || dateTo) ? t('kpiIn') : t('kpiIn30')
              }
              value={formatMoney(inSum)}
              icon={ArrowDownLeft}
              color="emerald"
              spark={spark(1.2)}
            />
            <StatCard
              label={
                kpiMode === 'CLIENT' ? t('kpiClientOut')
                : (dateFrom || dateTo) ? t('kpiOut') : t('kpiOut30')
              }
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
              value={txnCount.toLocaleString('ru-RU')}
              icon={Wallet}
              color="amber"
              spark={spark(0.6)}
            />
          </div>
          {/* Toggle strelka — KPI'larni Klient/all rejimda almashtirish */}
          <button
            onClick={() => setKpiMode((m) => (m === 'all' ? 'CLIENT' : 'all'))}
            title={kpiMode === 'all' ? t('kpiToggleToClient') : t('kpiToggleToAll')}
            className="absolute -right-2 top-1/2 -translate-y-1/2 z-10 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white dark:bg-slate-900 shadow-lg ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:ring-indigo-300 dark:hover:ring-indigo-900 hover:text-indigo-700 dark:hover:text-indigo-300 transition-all hover:scale-110"
          >
            {kpiMode === 'all'
              ? <ChevronRight className="h-4 w-4" />
              : <ChevronLeft className="h-4 w-4" />}
          </button>

          {/* AI Sparkles — bugungi statistika + qoshimcha amallar (KPI'dan tashqari, o'ng pastki burchak) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title={t('aiAssistantTitle')}
                className="absolute -bottom-4 -right-3 z-10 inline-flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 text-white shadow-lg ring-2 ring-white hover:scale-110 hover:shadow-xl hover:shadow-fuchsia-500/40 transition-all"
              >
                {recategorizeAllMut.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Sparkles className="h-4 w-4" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-0">
              {/* Today stats panel — gradient header */}
              <div className="rounded-t-md bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 p-3 text-white">
                <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold uppercase tracking-wider opacity-90">
                  <Sparkles className="h-3.5 w-3.5" /> {t('todayStats')}
                </div>
                <TodayStatsInline />
              </div>
              <div className="p-1">
                {/* Qoshimcha amallar — collapsible, default'da yopiq */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setExtraToolsOpen((v) => !v); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 transition-colors"
                >
                  <span className="flex-1 text-left">{t('extraTools')}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', extraToolsOpen && 'rotate-180')} />
                </button>
                {extraToolsOpen && (
                  <div className="mt-0.5">
                    <DropdownMenuItem
                      onSelect={(e) => { e.preventDefault(); setBackfillOpen(true); }}
                      className="cursor-pointer"
                    >
                      <History className="h-4 w-4 mr-2 text-indigo-600 dark:text-indigo-400" />
                      <span className="flex-1">{t('toolBackfill')}</span>
                    </DropdownMenuItem>
                    {canManageCategories && (
                      <DropdownMenuItem
                        onSelect={(e) => { e.preventDefault(); recategorizeAllMut.mutate(); }}
                        disabled={recategorizeAllMut.isPending}
                        className="cursor-pointer"
                      >
                        {recategorizeAllMut.isPending
                          ? <Loader2 className="h-4 w-4 mr-2 animate-spin text-amber-600 dark:text-amber-400" />
                          : <Wand2 className="h-4 w-4 mr-2 text-amber-600 dark:text-amber-400" />}
                        <span className="flex-1">{t('categorize')}</span>
                      </DropdownMenuItem>
                    )}
                    {canManageCategories && (
                      <DropdownMenuItem
                        onSelect={(e) => { e.preventDefault(); setSchotchikBackfillOpen(true); }}
                        className="cursor-pointer"
                      >
                        <Gauge className="h-4 w-4 mr-2 text-cyan-600 dark:text-cyan-400" />
                        <span className="flex-1">Schotchik backfill</span>
                      </DropdownMenuItem>
                    )}
                  </div>
                )}
              </div>
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
                  q ? 'text-indigo-500 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500 group-focus-within/search:text-indigo-500',
                )} />
                <Input
                  className={cn(
                    'relative pl-9 h-10 rounded-xl bg-slate-50/60 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700',
                    'transition-all duration-300',
                    'focus-visible:bg-white dark:focus-visible:bg-slate-900 focus-visible:ring-0 focus-visible:ring-offset-0',
                    'focus-visible:shadow-[0_0_0_3px_rgba(99,102,241,0.12),0_8px_24px_-8px_rgba(99,102,241,0.35)]',
                    'focus-visible:border-indigo-300',
                    'hover:border-slate-300 dark:hover:border-slate-700',
                  )}
                  placeholder={t('searchPlaceholder')}
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setPage(1); }}
                />
                {q && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full grid place-items-center text-slate-400 dark:text-slate-500 hover:text-white hover:bg-rose-500 transition-colors z-10"
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

              {/* CLIENT + XATO shartnomali tranzaksiyalar — alohida ikon */}
              <button
                onClick={() => setClientXatoOpen(true)}
                title={t('clientXatoTitle')}
                className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl transition-all bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-600 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900 shrink-0"
              >
                <FileWarning className="h-4 w-4" />
                {(correctionStats?.pending ?? 0) > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold grid place-items-center tabular-nums shadow-sm ring-2 ring-white dark:ring-slate-900">
                    {correctionStats!.pending}
                  </span>
                )}
              </button>

              {/* CLIENT + XATO modal */}
              <ClientXatoDialog open={clientXatoOpen} onClose={() => setClientXatoOpen(false)} />

              {/* SETTINGS — barcha qo'shimcha tools birlashtirilgan (ID, ID inspector, filter mode, ...) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title={t('settingsAndTools')}
                    className={cn(
                      'inline-flex items-center justify-center w-10 h-10 rounded-xl shrink-0',
                      'bg-gradient-to-br from-slate-700 to-slate-900 text-white',
                      'shadow-sm hover:shadow-lg hover:shadow-slate-500/30',
                      'transition-all duration-200 hover:scale-105 active:scale-95',
                      'ring-1 ring-slate-600/30',
                    )}
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">{t('toolsLabel')}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setIdSearchOpen(true)} className="cursor-pointer">
                    <Hash className="h-4 w-4 mr-2 text-fuchsia-600 dark:text-fuchsia-400" />
                    <span className="flex-1">{t('toolIdSearch')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIdInspectorTrigger(Date.now())} className="cursor-pointer">
                    <ScanLine className="h-4 w-4 mr-2 text-indigo-600 dark:text-indigo-400" />
                    <span className="flex-1">{t('toolBankIdInspector')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setVipiskaDebugOpen(true)} className="cursor-pointer">
                    <Search className="h-4 w-4 mr-2 text-cyan-600 dark:text-cyan-400" />
                    <span className="flex-1">{t('toolVipiskaCheck')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setXatoModalOpen(true)} className="cursor-pointer">
                    <Scissors className="h-4 w-4 mr-2 text-emerald-600 dark:text-emerald-400" />
                    <span className="flex-1">{t('toolXatoContracts')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">{t('filtersLabel')}</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => setColumnFilterMode((v) => !v)}
                    className="cursor-pointer"
                  >
                    <FilterIcon className={cn('h-4 w-4 mr-2', columnFilterMode ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400')} />
                    <span className="flex-1">{columnFilterMode ? t('columnFilterOn') : t('columnFilterMode')}</span>
                    {columnFilterMode && <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* IdInspectorDialog — controlled, dropdowndan ochiladi */}
              <IdInspectorDialog
                hideTrigger
                controlledOpen={idInspectorTrigger > 0}
                onControlledOpenChange={(o) => { if (!o) setIdInspectorTrigger(0); }}
              />

              {/* Vipiska tekshiruvi dialog */}
              <VipiskaDebugDialog
                open={vipiskaDebugOpen}
                onClose={() => setVipiskaDebugOpen(false)}
              />

              {/* Split kerak shartnomalar moduli */}
              <XatoContractsModal
                open={xatoModalOpen}
                onClose={() => setXatoModalOpen(false)}
              />

              {/* EXPORT — paperclip stilida (faqat canExport bo‘lsa) */}
              {canExport && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      title={t('exportMenuTitle')}
                      className="inline-flex items-center justify-center w-10 h-10 rounded-xl transition-all bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-700 shrink-0"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">{t('exportLabel')}</DropdownMenuLabel>
                    <DropdownMenuItem onClick={exportExcel} className="cursor-pointer">
                      <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-600 dark:text-emerald-400" />
                      <span className="flex-1">{t('exportExcelAll')}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={exportCsv} className="cursor-pointer">
                      <FileSpreadsheet className="h-4 w-4 mr-2 text-slate-500 dark:text-slate-400" />
                      <span className="flex-1">{t('exportCsvPage')}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={exportPrint} className="cursor-pointer">
                      <Printer className="h-4 w-4 mr-2 text-slate-600 dark:text-slate-300" />
                      <span className="flex-1">{t('exportPrint')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Shartnoma manbasi filtri — qo'lda / ariza (multi-select) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title={t('contractSourceFilterTitle')}
                    className={cn(
                      'inline-flex items-center justify-center w-10 h-10 rounded-xl transition-all relative',
                      (contractSources.size + sources.size) > 0
                        ? 'bg-violet-600 text-white shadow-md shadow-violet-500/30'
                        : 'bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-700',
                    )}
                  >
                    <Paperclip className="h-4 w-4" />
                    {(contractSources.size + sources.size) > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold grid place-items-center">
                        {contractSources.size + sources.size}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="p-2 w-64">
                  <div className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 px-2 py-1.5">
                    {t('contractSource')}
                  </div>
                  <button
                    onClick={() => {
                      setContractSources((prev) => {
                        const next = new Set(prev);
                        if (next.has('manual')) next.delete('manual'); else next.add('manual');
                        return next;
                      });
                      setPage(1);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[12px] font-medium transition-all',
                      contractSources.has('manual')
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-900'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300',
                    )}
                  >
                    <span className={cn(
                      'inline-flex items-center justify-center w-4 h-4 rounded border-2 transition-all',
                      contractSources.has('manual') ? 'bg-amber-500 border-amber-500' : 'border-slate-300 dark:border-slate-700',
                    )}>
                      {contractSources.has('manual') && <CheckCircle2 className="h-3 w-3 text-white" />}
                    </span>
                    <span className="flex-1 text-left">{t('manualEntered')}</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30">
                      {t('badgeManual')}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setContractSources((prev) => {
                        const next = new Set(prev);
                        if (next.has('ariza')) next.delete('ariza'); else next.add('ariza');
                        return next;
                      });
                      setPage(1);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[12px] font-medium transition-all mt-0.5',
                      contractSources.has('ariza')
                        ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-800 dark:text-violet-300 ring-1 ring-violet-200 dark:ring-violet-900'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300',
                    )}
                  >
                    <span className={cn(
                      'inline-flex items-center justify-center w-4 h-4 rounded border-2 transition-all',
                      contractSources.has('ariza') ? 'bg-violet-600 border-violet-600' : 'border-slate-300 dark:border-slate-700',
                    )}>
                      {contractSources.has('ariza') && <CheckCircle2 className="h-3 w-3 text-white" />}
                    </span>
                    <span className="flex-1 text-left">{t('viaApplication')}</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/30">
                      <Paperclip className="h-2.5 w-2.5 mr-0.5" /> {t('badgeApplication')}
                    </span>
                  </button>
                  {/* ─── MANBA bo'limi — bank sync / import / aloqa bank ─── */}
                  <div className="border-t border-slate-100 dark:border-slate-800 mt-1.5 pt-1.5">
                    <div className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 px-2 py-1.5">
                      Manba
                    </div>
                    {([
                      { key: 'SYNC', label: 'Bank sync', icon: RefreshCw },
                      { key: 'IMPORT', label: 'Import (Excel)', icon: UploadIcon },
                      { key: 'ALOQA_BANK', label: 'Aloqa Bank import', icon: Landmark },
                    ] as const).map((opt) => {
                      const Icon = opt.icon;
                      const checked = sources.has(opt.key);
                      return (
                        <button
                          key={opt.key}
                          onClick={() => {
                            setSources((prev) => {
                              const next = new Set(prev);
                              if (next.has(opt.key)) next.delete(opt.key); else next.add(opt.key);
                              return next;
                            });
                            setPage(1);
                          }}
                          className={cn(
                            'w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[12px] font-medium transition-all mt-0.5',
                            checked
                              ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-900'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300',
                          )}
                        >
                          <span className={cn(
                            'inline-flex items-center justify-center w-4 h-4 rounded border-2 transition-all',
                            checked ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 dark:border-slate-700',
                          )}>
                            {checked && <CheckCircle2 className="h-3 w-3 text-white" />}
                          </span>
                          <Icon className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                          <span className="flex-1 text-left">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {(contractSources.size + sources.size) > 0 && (
                    <div className="border-t border-slate-100 dark:border-slate-800 mt-1 pt-1">
                      <button
                        onClick={() => { setContractSources(new Set()); setSources(new Set()); setPage(1); }}
                        className="w-full px-2.5 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md"
                      >
                        {tc('clear')}
                      </button>
                    </div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
                <DropdownMenuTrigger asChild>
                  <button className={cn(
                    "inline-flex items-center gap-2 h-10 px-3.5 rounded-xl text-sm font-medium transition-colors",
                    (dateFrom || dateTo)
                      ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-900"
                      : "bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-700",
                  )}>
                    <Calendar className="h-4 w-4" />
                    {dateFrom || dateTo ? `${dateFrom || '...'} → ${dateTo || '...'}` : t('dateRange')}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="p-0 w-auto border-0 bg-transparent shadow-none"
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <DateRangeCalendar
                    from={dateFrom}
                    to={dateTo}
                    onChange={(f, tt) => { setDateFrom(f); setDateTo(tt); setPage(1); }}
                    onApply={() => setFilterOpen(false)}
                  />
                </DropdownMenuContent>
              </DropdownMenu>

              {(activeFilters > 0 || q) && (
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-300 hover:bg-rose-100 dark:hover:bg-rose-900/30 hover:text-rose-700 dark:hover:text-rose-300 ring-1 ring-amber-300 dark:ring-amber-900 hover:ring-rose-300 dark:hover:ring-rose-900 text-[12px] font-semibold transition-colors animate-pulse-once"
                  title={t('clearActiveFilters')}
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
                    <tr className="bg-slate-50/80 dark:bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                      <ColumnTh label={t('bankAccountHeader')} column="bank" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} tabs={[{ column: 'bank', label: t('bank') }, { column: 'accountIds', label: t('accountNoHeader') }]} />
                      <th className="text-left px-4 py-3 w-40">{t('dateTimeHeader')}</th>
                      <ColumnTh label={t('accountNameHeader')} column="hisobNomi" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} />
                      <ColumnTh label={t('directionHeader')} column="direction" widthClass="w-24" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} />
                      <ColumnTh label={t('counterpartyHeader')} column="kontragent" widthClass="w-40" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} alignRight />
                      <ColumnTh label={t('categoryHeader')} column="kategoriya" widthClass="w-40" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} alignRight />
                      <ColumnTh label={t('contractHeader')} column="contractStatus" widthClass="w-32" filterMode={columnFilterMode} columnFilters={columnFilters} setColumnFilters={setColumnFilters} openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} activeFilterParams={activeFilterParams} alignRight />
                      <AmountFilterTh
                        label={t('amountHeader')}
                        filterMode={columnFilterMode}
                        value={amountFilter}
                        onApply={(v) => { setAmountFilter(v); setPage(1); }}
                        openFilterColumn={openFilterColumn}
                        setOpenFilterColumn={setOpenFilterColumn}
                      />
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(filtered?.length ?? 0) === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-6 py-12 text-center">
                          <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500">
                            <Wallet className="h-8 w-8" />
                            <div className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">{t('notFoundTitle')}</div>
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
                          className="group hover:bg-slate-50/60 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                          onClick={() => setDetailRow(it)}
                        >
                          {/* 1) Bank · Hisob — import bo'lsa importBankNameText va from/toAccount fallback */}
                          <td className="px-4 py-3 max-w-[220px]">
                            {(() => {
                              const isImport = it.source === 'IMPORT';
                              const isAloqa = it.source === 'ALOQA_BANK';
                              const bankName = it.account?.bank?.name || it.bank?.name || ((isImport || isAloqa) ? it.importBankNameText : null);
                              const bankCode = it.account?.bank?.code || it.bank?.code || '';
                              const accountNo = it.account?.accountNo
                                || ((isImport || isAloqa) ? (it.direction === 'OUT' ? it.fromAccount : it.toAccount) : '');
                              return (
                                <div className="flex items-center gap-2">
                                  <BankLogo code={bankCode} name={bankName} size={28} rounded="rounded-lg" />
                                  <div className="min-w-0">
                                    <div className="text-[12px] font-medium truncate flex items-center gap-1">
                                      <span className="truncate">{bankName || '—'}</span>
                                      {(isImport || isAloqa) && (
                                        <span
                                          className="shrink-0 text-[8px] font-bold px-1 py-0.5 rounded bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300 inline-flex items-center gap-0.5"
                                          title={isAloqa ? 'Aloqa Bank import — read-only' : 'Import'}
                                        >
                                          {isAloqa && <Lock className="h-2 w-2" />}
                                          IMP
                                        </span>
                                      )}
                                    </div>
                                    {it.account?.ownerName && (
                                      <div className="text-[10px] text-slate-600 dark:text-slate-300 truncate">{it.account.ownerName}</div>
                                    )}
                                    <div className="font-mono text-[10px] text-slate-400 dark:text-slate-500 truncate">{accountNo || ''}</div>
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
                          {/* 2) Sana / Vaqt */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-[13px] font-medium tabular-nums">{formatDate(it.txnDate)}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
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
                                  <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate">{counterparty.meta}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          {/* 4) Yo'nalish */}
                          <td className="px-4 py-3">
                            <span className={cn(
                              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ring-inset",
                              it.direction === 'IN'
                                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900"
                                : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900",
                            )}>
                              {it.direction === 'IN'
                                ? <><ArrowDownLeft className="h-3 w-3" /> {t('dirIn')}</>
                                : <><ArrowUpRight className="h-3 w-3" /> {t('dirOut')}</>}
                            </span>
                          </td>
                          {/* Kontragent — import bo'lsa importCounterpartyText fallback,
                              lekin agar u KATEGORIYA bilan dublikat bo'lsa (sub/cat/importCategoryText), bo'shatamiz */}
                          <td className="px-4 py-3 max-w-[160px]">
                            <KontragentChip
                              display={(() => {
                                if (it.counterpartyDisplay) return it.counterpartyDisplay;
                                if (it.source === 'IMPORT' && it.importCounterpartyText) {
                                  const t = it.importCounterpartyText.trim();
                                  const subName  = it.subcategory?.name?.trim();
                                  const catName  = it.category?.name?.trim();
                                  const impCat   = it.importCategoryText?.trim();
                                  // Import matni KATEGORIYA bilan bir xil — Kontragent ustuni bo'sh qolsin
                                  if (t === subName || t === catName || t === impCat) return null;
                                  return t;
                                }
                                return it.category?.name || null;
                              })()}
                              category={it.category}
                              onClick={() => {}}
                              canEdit={false}
                            />
                          </td>
                          {/* Kategoriya — import bo'lsa importCategoryText fallback */}
                          <td className="px-4 py-3 max-w-[160px]">
                            {(it.subcategory || it.category) ? (
                              <CategoryChip
                                category={it.subcategory || it.category}
                                parentColor={it.category?.color}
                                onClick={() => {}}
                                canEdit={false}
                                placeholder={it.category ? '—' : ''}
                              />
                            ) : it.source === 'IMPORT' && it.importCategoryText ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold ring-1 ring-inset bg-fuchsia-50 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-300 ring-fuchsia-200 dark:ring-fuchsia-900 max-w-full">
                                <span className="truncate max-w-[140px]" title={it.importCategoryText}>{it.importCategoryText}</span>
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>
                            )}
                          </td>
                          {/* Shartnoma */}
                          <td className="px-4 py-3">
                            {it.contractNumber ? (
                              it.contractStatus === 'manual' ? (
                                // QO'LDA yoki ARIZA — ariza bo'lsa violet, aks holda amber
                                it.hasAttachment ? (
                                  <div className="flex items-center gap-1.5">
                                    <code className="inline-block w-fit font-mono text-[11px] font-bold px-1.5 py-0.5 rounded ring-1 text-violet-800 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 ring-violet-200 dark:ring-violet-900">
                                      {it.contractNumber}
                                    </code>
                                    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/30 ring-1 ring-violet-200 dark:ring-violet-900">
                                      <Paperclip className="h-2.5 w-2.5" /> {t('badgeApplication')}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <code className="inline-block w-fit font-mono text-[11px] font-bold px-1.5 py-0.5 rounded ring-1 text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900">
                                      {it.contractNumber}
                                    </code>
                                    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 ring-1 ring-amber-200 dark:ring-amber-900">
                                      {t('badgeManual')}
                                    </span>
                                  </div>
                                )
                              ) : it.contractStatus === 'unverified' ? (
                                // XATO holati — faqat badge + lookup icon, raqamni yashiramiz
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900">
                                    <AlertCircle className="h-3 w-3" /> {t('badgeError')}
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setLookupContract({ contract: it.contractNumber, description: it.description }); }}
                                    title={t('aiLookupTitle')}
                                    className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 via-fuchsia-500 to-rose-500 text-white shadow-sm hover:shadow-md hover:shadow-fuchsia-500/40 hover:scale-110 transition-all"
                                  >
                                    <Wand2 className="h-3 w-3" />
                                  </button>
                                </div>
                              ) : (
                                // Verified — shartnoma raqami ko'rinadi (+ BEKOR badge agar cancelled)
                                <div className="flex flex-col items-start gap-1">
                                  <code
                                    className="inline-block w-fit font-mono text-[11px] font-bold px-1.5 py-0.5 rounded ring-1 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 ring-indigo-200 dark:ring-indigo-900"
                                    title={it.contractCustomer || ''}
                                  >
                                    {it.contractNumber}
                                  </code>
                                  {it.contractCrmStatus && /cancel|отмен|бекор/i.test(it.contractCrmStatus) && (
                                    <span className="inline-flex items-center gap-0.5 w-fit px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 ring-1 ring-orange-200 dark:ring-orange-900 whitespace-nowrap" title={`CRM: ${it.contractCrmStatus}`}>
                                      <Ban className="h-2.5 w-2.5 shrink-0" /> {t('badgeCancelled')}
                                    </span>
                                  )}
                                </div>
                              )
                            ) : (
                              <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>
                            )}
                          </td>
                          <td className={cn(
                            "px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap",
                            it.direction === 'IN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                          )}>
                            {it.direction === 'IN' ? '+' : '−'}{formatMoney(it.amount, it.currency)}
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 justify-end">
                              <PurposeInfoButton data={{
                                purpose: it.description || null,
                                amount: it.amount,
                                currency: it.currency,
                                direction: it.direction as 'IN' | 'OUT',
                                txnDate: it.txnDate,
                                contractNumber: it.contractNumber,
                                bankName: it.bank?.name || null,
                                accountNo: it.account?.accountNo || null,
                                ownerName: it.account?.ownerName || null,
                                externalId: it.externalId,
                                docNumber: (it as any).docNumber,
                                purposeCode: (it as any).purposeCode,
                              }} />
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
            <div className="text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-300 tabular-nums">{((page - 1) * perPage) + 1}–{Math.min(page * perPage, data.total)}</span> / {t('ofTotal', { n: data.total })}
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
        canManualEdit={canManualEdit}
        canManualContract={canManualContract}
        canApplication={canApplication}
        canAutoCategorize={canAutoCategorize}
      />

      {/* ═══ ESKI TARIXNI YUKLASH (BACKFILL) ═══ */}
      <BackfillDialog open={backfillOpen} onOpenChange={setBackfillOpen} banks={banks?.items || []} />

      {/* ═══ KATEGORIYALASH JARAYONI (LIVE) ═══ */}
      <RecategorizeProgressDialog open={recategorizeOpen} onOpenChange={setRecategorizeOpen} />
      <SchotchikBackfillDialog open={schotchikBackfillOpen} onOpenChange={setSchotchikBackfillOpen} />

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
              <Hash className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> {t('idDialogTitle')}
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
            <Button onClick={() => searchById()} disabled={idSearching || !idQuery.trim()} className="shrink-0">
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
  const t = useTranslations('transactions');
  const tc = useTranslations('common');
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

  const [progress, setProgress] = useState<{
    total: number;
    days: number;
    startedAt: string;
    requestedFrom: string;
    requestedTo: string;
    actualFrom?: string;
    actualTo?: string;
    syncMinDate?: string | null;
    clampedDays?: number;
    warning?: string | null;
  } | null>(null);

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
        // Sync chegarasi tufayli ba'zi kunlar o'tkazib yuborilgan bo'lsa — ogohlantirish
        if (r?.warning) {
          toast(r.warning, {
            icon: '⚠️',
            duration: 10000,
            style: { background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' },
          });
        }
        setProgress({
          total: r.accounts,
          days: r.days,
          startedAt: r.startedAt,
          requestedFrom: r.requestedFrom || dateFrom,
          requestedTo: r.requestedTo || dateTo,
          actualFrom: r.actualFrom || null,
          actualTo: r.actualTo || null,
          syncMinDate: r.syncMinDate || null,
          clampedDays: r.clampedDays || 0,
          warning: r.warning || null,
        });
        prevDoneRef.current = 0;
        setLastAdvanceAt(Date.now());
      } else if (r?.clampedAll && r?.syncMinDate) {
        toast.error(
          t('backfillClampedAll', { date: r.syncMinDate }),
          { duration: 10000 },
        );
      } else {
        toast.error(r?.error || tc('error'));
      }
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
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
      <DialogContent className={progress ? 'max-w-2xl' : 'max-w-md'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> {t('backfillTitle')}
          </DialogTitle>
          <DialogDescription>
            {stalled
              ? t('backfillStalledDesc')
              : progress
                ? t('backfillRunningDesc')
                : t('backfillFormDesc')}
          </DialogDescription>
        </DialogHeader>

        {progress ? (
          /* ─── JARAYON KO'RINISHI ─── */
          <div className="space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                  {t('backfillAccountsDone', { done: doneCount, total: progress.total })}
                </span>
                <span className="text-[12px] font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{pct}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', allDone ? 'bg-emerald-500' : 'bg-indigo-500')}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">{t('backfillDaysLabel', { days: progress.days })} · {scope === 'all' ? t('scopeAll') : scope === 'bank' ? t('scopeBank') : t('scopeAccount')}</div>
            </div>

            {/* ─── Sana oralig'i ko'rsatuvi (so'ralgan vs haqiqiy) ─── */}
            <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-50/60 dark:bg-slate-900/60 px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">{t('backfillRequested')}</span>
                <span className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                  {progress.requestedFrom} → {progress.requestedTo}
                </span>
              </div>
              {progress.actualFrom && progress.actualTo && (
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">{t('backfillFetching')}</span>
                  <span className={cn(
                    'font-mono tabular-nums font-semibold',
                    (progress.clampedDays || 0) > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300',
                  )}>
                    {progress.actualFrom} → {progress.actualTo}
                  </span>
                </div>
              )}
              {(progress.clampedDays || 0) > 0 && progress.syncMinDate && (
                <div className="flex items-start gap-2 px-2 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 text-[10.5px] text-amber-900 dark:text-amber-300 mt-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <div>
                    <b>{t('backfillClampedWarning', { date: progress.syncMinDate, days: progress.clampedDays })}</b>
                    <div className="text-amber-700 dark:text-amber-300 mt-0.5">
                      {t('backfillClampedHint')}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 3 ta jami */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-100 dark:ring-slate-800 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-bold">{t('backfillFetched')}</div>
                <div className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-200">{totalFetched}</div>
              </div>
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-100 dark:ring-emerald-900 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-bold">{t('backfillNewAdded')}</div>
                <div className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{totalSaved}</div>
              </div>
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-100 dark:ring-rose-900 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-rose-600 dark:text-rose-400 font-bold">{t('errorLabel')}</div>
                <div className="text-lg font-bold tabular-nums text-rose-700 dark:text-rose-300">{totalErrors}</div>
              </div>
            </div>

            {/* Hisoblar ro'yxati */}
            <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>{t('backfillByAccounts')}</span>
                <span>{t('backfillRecordsCount', { n: logs.length })}</span>
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800">
                {logs.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[11px] text-slate-400 dark:text-slate-500 flex items-center justify-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('starting')}
                  </div>
                ) : (
                  logs.map((l: any) => {
                    const running = l.status === 'RUNNING';
                    const failed = l.status === 'FAILED';
                    // source: "{accountNo} · {ownerName} · backfill {date1}–{date2}"
                    const label = accLabel(l.source);
                    const [accountNo, ...rest] = label.split(' · ');
                    const ownerName = rest.join(' · ');
                    return (
                      <div key={l.id} className="px-3 py-2 flex items-start gap-2">
                        {running ? (
                          <Loader2 className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400 animate-spin shrink-0 mt-0.5" />
                        ) : failed ? (
                          <span className="w-3.5 h-3.5 rounded-full bg-rose-500 shrink-0 grid place-items-center text-white text-[8px] mt-0.5">✕</span>
                        ) : (
                          <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          {/* 1-qator: hisob raqami + statistika (o'ngda) */}
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate" title={accountNo}>
                              {accountNo}
                            </span>
                            {l.errorMessage ? (
                              <span className="text-[10px] text-rose-600 dark:text-rose-400 truncate max-w-[180px] shrink-0" title={l.errorMessage}>
                                {l.errorMessage}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                                {t('backfillFetchedShort', { n: l.fetched ?? 0 })} · <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{t('backfillNewShort', { n: l.saved ?? 0 })}</span>
                              </span>
                            )}
                          </div>
                          {/* 2-qator: hisob egasi (mavjud bo'lsa) */}
                          {ownerName && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5" title={ownerName}>
                              {ownerName}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {allDone && (
              <div className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" /> {t('backfillDoneAdded', { n: totalSaved })}
              </div>
            )}

            {stalled && (
              <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertCircle className="h-3.5 w-3.5" /> {t('backfillStalledTitle')}
                </div>
                <div className="mt-0.5 text-amber-700 dark:text-amber-300">
                  {t('backfillStalledBody', { done: doneCount, total: progress.total })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              {allDone ? (
                <Button onClick={() => { setProgress(null); onOpenChange(false); }}>{tc('close')}</Button>
              ) : stalled ? (
                <>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>{tc('close')}</Button>
                  <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
                    {mut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <History className="h-4 w-4 mr-1.5" />}
                    {t('backfillRestart')}
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => onOpenChange(false)}>{t('continueInBackground')}</Button>
              )}
            </div>
          </div>
        ) : (
          /* ─── FORMA ─── */
          <>
            <div className="space-y-4">
              {/* Qamrov */}
              <div className="space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{t('scopeLabel')}</div>
                <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px] font-medium w-full">
                  {[
                    { v: 'all', l: t('scopeAll') },
                    { v: 'bank', l: t('scopeBank') },
                    { v: 'account', l: t('scopeAccount') },
                  ].map((o) => (
                    <button
                      key={o.v}
                      onClick={() => setScope(o.v as any)}
                      className={cn(
                        'flex-1 px-2 h-8 rounded-lg transition-colors',
                        scope === o.v ? 'bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
                      )}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>

              {(scope === 'bank' || scope === 'account') && (
                <div className="space-y-1.5">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{t('bank')}</div>
                  <Select value={bankId} onValueChange={(v) => { setBankId(v); setAccountId(''); }}>
                    <SelectTrigger><SelectValue placeholder={t('selectBank')} /></SelectTrigger>
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
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{t('account')}</div>
                  <Select value={accountId} onValueChange={setAccountId} disabled={!bankId}>
                    <SelectTrigger>
                      <SelectValue placeholder={bankId ? t('selectAccount') : t('selectBankFirst')} />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="px-1.5 pt-1.5 pb-1 sticky top-0 bg-white dark:bg-slate-900 z-10">
                        <Input
                          value={accSearch}
                          onChange={(e) => setAccSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          placeholder={t('accountSearchPlaceholder')}
                          className="h-8 text-[11px]"
                        />
                      </div>
                      {bankAccounts.length === 0 ? (
                        <div className="px-3 py-2 text-[11px] text-slate-400 dark:text-slate-500">{t('notFound')}</div>
                      ) : (
                        bankAccounts.slice(0, 100).map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>
                            <span className="flex flex-col text-left">
                              <span className="font-mono text-xs">{a.accountNo}</span>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">{a.ownerName || '—'}</span>
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
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{tc('from')}</div>
                  <Input type="date" value={dateFrom} max={dateTo || today} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{tc('to')}</div>
                  <Input type="date" value={dateTo} min={dateFrom} max={today} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>

              <div className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 rounded-lg px-3 py-2 leading-relaxed">
                ⚠ {t('backfillBigRangeHint')}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
              <Button onClick={() => mut.mutate()} disabled={!valid || mut.isPending}>
                {mut.isPending
                  ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> {t('starting')}</>
                  : t('backfillStartBtn')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══ CLIENT + XATO — 2 bosqichli TO'G'RILASH workflow (3 tab) ═══════════════
// Row shape'lari
type CorrectionRow = {
  id: string; txId: string; oplataKvId: string | null; status: string; source: string | null;
  proposedContractNo: string | null; note: string | null;
  submittedByName: string | null; submittedAt: string | null;
  reviewedByName: string | null; reviewedAt: string | null; rejectReason: string | null;
  appliedContractNo: string | null; categoryName: string | null; subCategoryName: string | null;
  attachmentId: string | null; attachmentName: string | null;
  amount: number | null; date: string | null; client: string | null; object: string | null;
  contractNo: string | null; txType: string | null; purpose: string | null;
};

type ApprovalPrefill = {
  contractNo: string; client: string; amount: number | null;
  date: string | null; purpose: string | null; object: string | null;
};

// Yuboruvchi manba ikonasi
function SourceIcon({ source }: { source: string | null }) {
  if (source === 'telegram') return <Send className="h-3 w-3 text-sky-500" />;
  if (source === 'app') return <Gauge className="h-3 w-3 text-violet-500" />;
  return <Landmark className="h-3 w-3 text-slate-400" />;
}

function ClientXatoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('transactions');
  const tc = useTranslations('common');
  const qc = useQueryClient();

  const [tab, setTab] = useState<'pending' | 'approved' | 'raw'>('pending');

  // ── Raw (Barcha XATO) — mavjud tab holati ──
  const [rawPage, setRawPage] = useState(1);
  const [rawQ, setRawQ] = useState('');
  const [rawQDebounced, setRawQDebounced] = useState('');
  const [infoRow, setInfoRow] = useState<any | null>(null);
  const [exporting, setExporting] = useState(false);
  const perPage = 50;

  // ── Pending tab ──
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingQ, setPendingQ] = useState('');

  // ── Approved tab ──
  const [approvedPage, setApprovedPage] = useState(1);
  const [approvedQ, setApprovedQ] = useState('');
  const [apFrom, setApFrom] = useState('');
  const [apTo, setApTo] = useState('');
  const [apActor, setApActor] = useState('');
  const [apFlow, setApFlow] = useState<'all' | 'in' | 'out'>('all');

  // ── ApprovalModal holati ──
  const [approval, setApproval] = useState<{
    mode: 'approve' | 'direct'; requestId?: string; txId?: string; prefill: ApprovalPrefill;
  } | null>(null);

  useEffect(() => {
    if (open) { setTab('pending'); setRawPage(1); setPendingPage(1); setApprovedPage(1); setRawQ(''); setRawQDebounced(''); }
  }, [open]);
  useEffect(() => { setPendingPage(1); }, [pendingQ]);
  useEffect(() => { setApprovedPage(1); }, [approvedQ, apFrom, apTo, apActor, apFlow]);
  // Barcha XATO qidiruvi — debounce (~300ms) + sahifani reset
  useEffect(() => {
    const id = setTimeout(() => { setRawQDebounced(rawQ); setRawPage(1); }, 300);
    return () => clearTimeout(id);
  }, [rawQ]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['correction-stats'] });
    qc.invalidateQueries({ queryKey: ['correction-pending'] });
    qc.invalidateQueries({ queryKey: ['correction-approved'] });
    qc.invalidateQueries({ queryKey: ['client-xato'] });
    // Tasdiqlangach to'lov XATO'dan chiqadi — asosiy jadval/oplatakv ham yangilansin
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['tx-stats'] });
    qc.invalidateQueries({ queryKey: ['oplata-kv'] });
  };

  // ── Stats (badge'lar uchun) ──
  const statsQuery = useQuery({
    queryKey: ['correction-stats'],
    queryFn: () => api.get<{ ok: boolean; pending: number; approved: number }>('/correction/stats'),
    enabled: open,
  });
  const stats = statsQuery.data;

  // ── Excel export (faqat raw tab uchun) ──
  const exportExcel = async () => {
    setExporting(true);
    try {
      await apiDownload('/transactions/client-xato/export', `klient-xato-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      toast.error(e?.message || tc('error'));
    } finally {
      setExporting(false);
    }
  };

  // ── Pending query ──
  const pendingQuery = useQuery({
    queryKey: ['correction-pending', pendingPage, pendingQ],
    queryFn: () => api.get<{ ok: boolean; total: number; page: number; perPage: number; rows: CorrectionRow[] }>(
      `/correction/pending?q=${encodeURIComponent(pendingQ)}&page=${pendingPage}&perPage=${perPage}`,
    ),
    enabled: open && tab === 'pending',
  });

  // ── Approved query ──
  const approvedQuery = useQuery({
    queryKey: ['correction-approved', approvedPage, approvedQ, apFrom, apTo, apActor, apFlow],
    queryFn: () => api.get<{ ok: boolean; total: number; page: number; perPage: number; rows: CorrectionRow[] }>(
      `/correction/approved?q=${encodeURIComponent(approvedQ)}&from=${apFrom}&to=${apTo}&actor=${encodeURIComponent(apActor)}&flow=${apFlow}&page=${approvedPage}&perPage=${perPage}`,
    ),
    enabled: open && tab === 'approved',
  });

  // ── Raw (Barcha XATO) query ──
  const rawQuery = useQuery({
    queryKey: ['client-xato', rawPage, rawQDebounced],
    queryFn: () => api.get<{
      ok: boolean; total: number; page: number; perPage: number;
      items: Array<{
        id: string; externalId: string | null; txnDate: string; operationTime: string | null;
        amount: number; currency: string; direction: string; contractNumber: string | null;
        description: string | null; counterparty: string | null; xatoHidden: boolean;
      }>;
    }>(`/transactions/client-xato?page=${rawPage}&perPage=${perPage}&q=${encodeURIComponent(rawQDebounced)}`),
    enabled: open && tab === 'raw',
  });

  // ── Ro'yxatdan yashirish / qaytarish ──
  const hidingId = useRef<string | null>(null);
  const hideMut = useMutation({
    mutationFn: ({ txId, hidden }: { txId: string; hidden: boolean }) =>
      api.post<{ ok: boolean; hidden: boolean }>('/correction/hide', { txId, hidden }),
    onMutate: (v) => { hidingId.current = v.txId; },
    onSuccess: (_res, v) => {
      toast.success(v.hidden ? "Ro'yxatdan yashirildi" : 'Qaytarildi');
      qc.invalidateQueries({ queryKey: ['client-xato'] });
      qc.invalidateQueries({ queryKey: ['correction-stats'] });
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
    onSettled: () => { hidingId.current = null; },
  });

  const fmtDate = (d: string | null | undefined) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('ru-RU'); } catch { return d; }
  };

  // Signed money — formatMoney o'zi absolyut oladi, sign+rang biz qo'yamiz
  const SignedMoney = ({ amount }: { amount: number | null }) => {
    if (amount == null) return <span className="text-slate-400">—</span>;
    const positive = amount >= 0;
    return (
      <span className={cn('tabular-nums font-bold whitespace-nowrap', positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
        {positive ? '+' : '−'}{formatMoney(Math.abs(amount))}
      </span>
    );
  };

  // Pagination komponenti (umumiy)
  const Pager = ({ page, total, onPrev, onNext }: { page: number; total: number; onPrev: () => void; onNext: () => void }) => {
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (totalPages <= 1) return null;
    return (
      <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between shrink-0">
        <div className="text-[11px] text-slate-500 dark:text-slate-400">{page} / {totalPages} · {total}</div>
        <div className="flex items-center gap-1.5">
          <button onClick={onPrev} disabled={page <= 1} className="h-8 w-8 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 grid place-items-center disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={onNext} disabled={page >= totalPages} className="h-8 w-8 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 grid place-items-center disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    );
  };

  const pendingRows = pendingQuery.data?.rows || [];
  const approvedRows = approvedQuery.data?.rows || [];
  const rawItems = rawQuery.data?.items || [];
  const rawTotal = rawQuery.data?.total || 0;

  const TabBtn = ({ id, icon, label, count }: { id: typeof tab; icon: React.ReactNode; label: string; count?: number }) => (
    <button
      onClick={() => setTab(id)}
      className={cn(
        'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold transition-all',
        tab === id
          ? 'bg-white text-rose-700 shadow-sm'
          : 'text-white/80 hover:bg-white/10',
      )}
    >
      {icon}
      <span>{label}</span>
      {count != null && count > 0 && (
        <span className={cn(
          'ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums',
          tab === id ? 'bg-rose-600 text-white' : 'bg-white/25 text-white',
        )}>
          {count}
        </span>
      )}
    </button>
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[200] bg-slate-950/50 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={() => { if (!infoRow && !approval) onClose(); }}
      />
      {/* Yon panel (side drawer) — o'ngdan chiqadi. z-[210] < ApprovalModal (z-[300]/[310]) */}
      <div className="fixed inset-y-0 right-0 z-[210] w-full sm:max-w-[1100px] bg-slate-50 dark:bg-slate-950 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="bg-gradient-to-br from-rose-600 to-red-600 px-5 pt-4 pb-3 text-white shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-white/15 grid place-items-center shrink-0">
                <FileWarning className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest font-bold text-white/70">{t('clientXatoTitle')}</div>
                <div className="text-lg font-black tracking-tight truncate">{t('clientXatoSubtitle')}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {tab === 'raw' && (
                <button
                  onClick={exportExcel}
                  disabled={exporting || rawQuery.isLoading || rawTotal === 0}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Excel
                </button>
              )}
              <button
                onClick={onClose}
                title="Yopish"
                className="w-8 h-8 grid place-items-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Tab bar — segmented pill */}
          <div className="mt-3 flex items-center gap-1.5 p-1 rounded-xl bg-white/10 w-fit">
            <TabBtn id="pending" icon={<Clock className="h-3.5 w-3.5" />} label="Kutilmoqda" count={stats?.pending} />
            <TabBtn id="approved" icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Tasdiqlangan" count={stats?.approved} />
            <TabBtn id="raw" icon={<AlertCircle className="h-3.5 w-3.5" />} label="Barcha XATO" />
          </div>
        </div>

        {/* ═══ TAB: KUTILMOQDA ═══ */}
        {tab === 'pending' && (
          <>
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
                <Input value={pendingQ} onChange={(e) => setPendingQ(e.target.value)} placeholder="Qidirish (klient, shartnoma, izoh)…" className="pl-9 h-9 text-[12px]" />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-slate-50/40 dark:bg-slate-900">
              {pendingQuery.isLoading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
                  <Loader2 className="h-7 w-7 animate-spin text-rose-500" />
                  <span className="text-[12px]">{tc('loading')}</span>
                </div>
              ) : pendingRows.length === 0 ? (
                <div className="py-16 text-center text-[12px] text-slate-400 dark:text-slate-500">Kutilayotgan arizalar yo'q</div>
              ) : (
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-[10.5px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> Sana</span></th>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Briefcase className="h-3 w-3" /> Klient</span></th>
                      <th className="text-left px-3 py-2">Obyekt</th>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><FileSignature className="h-3 w-3" /> Shartnoma</span></th>
                      <th className="text-right px-3 py-2"><span className="inline-flex items-center gap-1 justify-end"><Wallet className="h-3 w-3" /> Summa</span></th>
                      <th className="text-left px-3 py-2">Kim yubordi</th>
                      <th className="text-left px-3 py-2">Izoh</th>
                      <th className="text-right px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {pendingRows.map((r) => (
                      <tr key={r.id} className="hover:bg-rose-50/40 dark:hover:bg-rose-950/20 transition-colors">
                        <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{fmtDate(r.date)}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[160px] truncate" title={r.client || ''}>{r.client || '—'}</td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400 max-w-[140px] truncate" title={r.object || ''}>{r.object || '—'}</td>
                        <td className="px-3 py-2">
                          {r.proposedContractNo ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900" title={r.proposedContractNo}>
                              <Wand2 className="h-3 w-3" /> {r.proposedContractNo}
                            </span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right"><SignedMoney amount={r.amount} /></td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 max-w-[150px] truncate" title={r.submittedByName || ''}>
                            <SourceIcon source={r.source} />
                            <span className="truncate">{r.submittedByName || '—'}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400 max-w-[180px] truncate" title={r.note || ''}>{r.note || '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => setApproval({
                              mode: 'approve', requestId: r.id,
                              prefill: { contractNo: r.proposedContractNo || r.contractNo || '', client: r.client || '', amount: r.amount, date: r.date, purpose: r.purpose, object: r.object },
                            })}
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-gradient-to-br from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-[11px] font-semibold transition-all shadow-sm"
                          >
                            <Wrench className="h-3 w-3" /> To'g'rilash
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <Pager page={pendingPage} total={pendingQuery.data?.total || 0} onPrev={() => setPendingPage((p) => Math.max(1, p - 1))} onNext={() => setPendingPage((p) => p + 1)} />
          </>
        )}

        {/* ═══ TAB: TASDIQLANGAN ═══ */}
        {tab === 'approved' && (
          <>
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[180px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
                  <Input value={approvedQ} onChange={(e) => setApprovedQ(e.target.value)} placeholder="Qidirish…" className="pl-9 h-9 text-[12px]" />
                </div>
                {/* Flow segmented control */}
                <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800">
                  {([['all', 'Hammasi'], ['in', 'Kirim'], ['out', 'Chiqim']] as const).map(([v, lbl]) => (
                    <button
                      key={v}
                      onClick={() => setApFlow(v)}
                      className={cn(
                        'h-7 px-2.5 rounded-md text-[11px] font-semibold transition-all',
                        apFlow === v
                          ? (v === 'in' ? 'bg-emerald-600 text-white shadow-sm' : v === 'out' ? 'bg-rose-600 text-white shadow-sm' : 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm')
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
                      )}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-500 dark:text-slate-400">
                <FilterIcon className="h-3.5 w-3.5" />
                <input type="date" value={apFrom} onChange={(e) => setApFrom(e.target.value)} className="h-8 px-2 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 text-[12px] text-slate-700 dark:text-slate-200" />
                <span>—</span>
                <input type="date" value={apTo} onChange={(e) => setApTo(e.target.value)} className="h-8 px-2 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 text-[12px] text-slate-700 dark:text-slate-200" />
                <Input value={apActor} onChange={(e) => setApActor(e.target.value)} placeholder="Kim tasdiqladi…" className="h-8 w-40 text-[12px]" />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-slate-50/40 dark:bg-slate-900">
              {approvedQuery.isLoading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
                  <Loader2 className="h-7 w-7 animate-spin text-emerald-500" />
                  <span className="text-[12px]">{tc('loading')}</span>
                </div>
              ) : approvedRows.length === 0 ? (
                <div className="py-16 text-center text-[12px] text-slate-400 dark:text-slate-500">Tasdiqlangan arizalar yo'q</div>
              ) : (
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-[10.5px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> Sana</span></th>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Briefcase className="h-3 w-3" /> Klient</span></th>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><FileSignature className="h-3 w-3" /> Shartnoma</span></th>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" /> Kategoriya</span></th>
                      <th className="text-right px-3 py-2"><span className="inline-flex items-center gap-1 justify-end"><Wallet className="h-3 w-3" /> Summa</span></th>
                      <th className="text-left px-3 py-2">Kim tasdiqladi</th>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" /> Ariza</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {approvedRows.map((r) => (
                      <tr key={r.id} className="hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 transition-colors">
                        <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{fmtDate(r.reviewedAt)}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[160px] truncate" title={r.client || ''}>{r.client || '—'}</td>
                        <td className="px-3 py-2">
                          {r.appliedContractNo ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900" title={r.appliedContractNo}>
                              <Check className="h-3 w-3" /> {r.appliedContractNo}
                            </span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[160px] truncate" title={[r.categoryName, r.subCategoryName].filter(Boolean).join(' / ')}>
                          {r.categoryName ? (
                            <span>{r.categoryName}{r.subCategoryName ? <span className="text-slate-400 dark:text-slate-500"> / {r.subCategoryName}</span> : null}</span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right"><SignedMoney amount={r.amount} /></td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[150px] truncate" title={r.reviewedByName || ''}>{r.reviewedByName || '—'}</td>
                        <td className="px-3 py-2">
                          {r.attachmentId ? (
                            <button
                              onClick={() => apiDownload(`/transactions/${r.txId}/attachments/${r.attachmentId}/download`, r.attachmentName || 'ariza').catch((e: any) => toast.error(e?.message || tc('error')))}
                              title={r.attachmentName || ''}
                              className="inline-flex items-center gap-1.5 h-7 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300 text-[11px] font-medium transition-all max-w-[150px]"
                            >
                              <Download className="h-3 w-3 shrink-0" />
                              <span className="truncate">{r.attachmentName || 'Yuklab olish'}</span>
                            </button>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <Pager page={approvedPage} total={approvedQuery.data?.total || 0} onPrev={() => setApprovedPage((p) => Math.max(1, p - 1))} onNext={() => setApprovedPage((p) => p + 1)} />
          </>
        )}

        {/* ═══ TAB: BARCHA XATO (mavjud raw jadval) ═══ */}
        {tab === 'raw' && (
          <>
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
                <Input value={rawQ} onChange={(e) => setRawQ(e.target.value)} placeholder="ID, shartnoma yoki izoh bo'yicha qidirish…" className="pl-9 h-9 text-[12px]" />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-slate-50/40 dark:bg-slate-900">
              {rawQuery.isLoading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
                  <Loader2 className="h-7 w-7 animate-spin text-rose-500" />
                  <span className="text-[12px]">{tc('loading')}</span>
                </div>
              ) : rawItems.length === 0 ? (
                <div className="py-16 text-center text-[12px] text-slate-400 dark:text-slate-500">{t('clientXatoEmpty')}</div>
              ) : (
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-[10.5px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> {t('dateTimeHeader')}</span></th>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Briefcase className="h-3 w-3" /> {t('counterpartyHeader')}</span></th>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><FileSignature className="h-3 w-3" /> {t('contractHeader')}</span></th>
                      <th className="text-right px-3 py-2"><span className="inline-flex items-center gap-1 justify-end"><Wallet className="h-3 w-3" /> {t('amountHeader')}</span></th>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> {t('purposeHeader')}</span></th>
                      <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" /> ID</span></th>
                      <th className="text-right px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {rawItems.map((it) => (
                      <tr key={it.id} className={cn('hover:bg-rose-50/40 dark:hover:bg-rose-950/20 transition-colors', it.xatoHidden && 'opacity-60')}>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">
                          {fmtDate(it.txnDate)}{it.operationTime ? <span className="text-slate-400 dark:text-slate-500"> {it.operationTime.slice(0, 5)}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[180px] truncate" title={it.counterparty || ''}>{it.counterparty || '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900">
                              <AlertCircle className="h-3 w-3" /> {t('badgeError')}
                            </span>
                            {it.xatoHidden && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700">
                                <EyeOff className="h-3 w-3" /> yashirilgan
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={cn('px-3 py-2 text-right tabular-nums font-bold whitespace-nowrap', it.direction === 'IN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                          {it.direction === 'IN' ? '+' : '−'}{formatMoney(it.amount, it.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => setInfoRow(it)}
                            title={it.description || ''}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-gradient-to-br hover:from-indigo-500 hover:to-violet-600 text-slate-600 dark:text-slate-300 hover:text-white transition-all shadow-sm"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(it.externalId || it.id);
                              toast.success(t('idCopied'));
                            }}
                            title={it.externalId || it.id}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-gradient-to-br hover:from-slate-500 hover:to-slate-700 text-slate-600 dark:text-slate-300 hover:text-white transition-all shadow-sm"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => hideMut.mutate({ txId: it.id, hidden: !it.xatoHidden })}
                            disabled={hideMut.isPending && hidingId.current === it.id}
                            title={it.xatoHidden ? "Ro'yxatga qaytarish" : "Ro'yxatdan yashirish"}
                            className={cn(
                              'inline-flex items-center justify-center w-7 h-7 rounded-lg transition-all shadow-sm disabled:opacity-50',
                              it.xatoHidden
                                ? 'bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-300'
                                : 'bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-300',
                            )}
                          >
                            {hideMut.isPending && hidingId.current === it.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : it.xatoHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            onClick={() => setApproval({
                              mode: 'direct', txId: it.id,
                              prefill: {
                                contractNo: it.contractNumber || '',
                                client: it.counterparty || '',
                                amount: it.direction === 'IN' ? Math.abs(it.amount) : -Math.abs(it.amount),
                                date: it.txnDate,
                                purpose: it.description,
                                object: null,
                              },
                            })}
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-gradient-to-br from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-[11px] font-semibold transition-all shadow-sm"
                          >
                            <Wrench className="h-3 w-3" /> To'g'rilash
                          </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <Pager page={rawPage} total={rawTotal} onPrev={() => setRawPage((p) => Math.max(1, p - 1))} onNext={() => setRawPage((p) => p + 1)} />
          </>
        )}

        {/* Footer — Yopish */}
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="h-3.5 w-3.5 mr-1" /> Yopish
          </Button>
        </div>
      </div>

    {/* IZOH / ID icon bosilganda — to'liq ma'lumot modali (purpose + externalId + shartnoma) */}
    <PurposeModal
      open={!!infoRow}
      onClose={() => setInfoRow(null)}
      data={infoRow ? {
        purpose: infoRow.description ?? null,
        externalId: infoRow.externalId || infoRow.id,
        contractNumber: infoRow.contractNumber ?? null,
        amount: infoRow.amount,
        currency: infoRow.currency,
        direction: infoRow.direction,
        txnDate: infoRow.txnDate,
      } : null}
    />

    {/* TO'G'RILASH modali — approve yoki direct */}
    <ApprovalModal
      open={!!approval}
      onClose={() => setApproval(null)}
      mode={approval?.mode || 'approve'}
      requestId={approval?.requestId}
      txId={approval?.txId}
      prefill={approval?.prefill || { contractNo: '', client: '', amount: null, date: null, purpose: null, object: null }}
      onDone={invalidateAll}
    />
    </>
  );
}

// ═══ TO'G'RILASHNI TASDIQLASH modali (nested Dialog) ════════════════════════
function ApprovalModal({
  open, onClose, mode, requestId, txId, prefill, onDone,
}: {
  open: boolean;
  onClose: () => void;
  mode: 'approve' | 'direct';
  requestId?: string;
  txId?: string;
  prefill: ApprovalPrefill;
  onDone: () => void;
}) {
  const tc = useTranslations('common');
  const [contractNo, setContractNo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subCategoryId, setSubCategoryId] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Kategoriyalar daraxti — mavjud manba ('/categorization/categories')
  const categoriesQuery = useQuery({
    queryKey: ['categories-tree'],
    queryFn: () => api.get<{ ok: boolean; items: any[] }>('/categorization/categories'),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });
  const tree = categoriesQuery.data?.items || [];

  useEffect(() => {
    if (open) {
      setContractNo(prefill.contractNo || '');
      setFile(null);
      setCategoryId(null);
      setSubCategoryId(null);
      setRejectMode(false);
      setRejectReason('');
      setBusy(false);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (f && f.size > 25 * 1024 * 1024) {
      toast.error('Fayl hajmi 25MB dan oshmasligi kerak');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setFile(f);
  };

  const canSubmit = !!file && contractNo.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit || !file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('contractNo', contractNo.trim());
      if (categoryId) fd.append('categoryId', categoryId);
      if (subCategoryId) fd.append('subCategoryId', subCategoryId);
      if (mode === 'approve') {
        if (!requestId) throw new Error('requestId yo\'q');
        await api.postForm(`/correction/${requestId}/approve`, fd, { timeout: 60000 });
      } else {
        if (!txId) throw new Error('txId yo\'q');
        fd.append('txId', txId);
        await api.postForm('/correction/direct', fd, { timeout: 60000 });
      }
      toast.success('Tasdiqlandi va biriktirildi');
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || tc('error'));
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (!requestId || !rejectReason.trim()) { toast.error('Sabab kiriting'); return; }
    setBusy(true);
    try {
      await api.post(`/correction/${requestId}/reject`, { reason: rejectReason.trim() });
      toast.success('Rad etildi');
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || tc('error'));
    } finally {
      setBusy(false);
    }
  };

  const amountPositive = (prefill.amount ?? 0) >= 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[300] bg-slate-950/50 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={() => { if (!busy) onClose(); }}
      />
      {/* Yon panel (side drawer) — o'ngdan chiqadi */}
      <div className="fixed inset-y-0 right-0 z-[310] w-full sm:max-w-[520px] bg-slate-50 dark:bg-slate-950 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="bg-gradient-to-br from-rose-600 to-red-600 px-5 py-4 text-white shrink-0 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-white/15 grid place-items-center shrink-0">
            <Wrench className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-widest font-bold text-white/70">XATO shartnomani to'g'rilash</div>
            <div className="text-lg font-black tracking-tight truncate">
              {mode === 'approve' ? 'Arizani tasdiqlash' : "To'g'ridan-to'g'ri to'g'rilash"}
            </div>
          </div>
          <button
            onClick={() => { if (!busy) onClose(); }}
            className="w-8 h-8 grid place-items-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {/* To'lov xulosasi kartochkasi */}
          <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
            <div className="px-4 py-2 bg-slate-100/70 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
              To'lov ma'lumoti
            </div>
            <div className="p-4 grid grid-cols-2 gap-y-2.5 gap-x-4 text-[12px]">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Klient</div>
                <div className="font-semibold text-slate-800 dark:text-slate-200 truncate" title={prefill.client}>{prefill.client || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Summa</div>
                <div className={cn('font-bold tabular-nums', amountPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                  {prefill.amount == null ? '—' : <>{amountPositive ? '+' : '−'}{formatMoney(Math.abs(prefill.amount))}</>}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Sana</div>
                <div className="font-medium text-slate-700 dark:text-slate-300">{prefill.date ? (() => { try { return new Date(prefill.date).toLocaleDateString('ru-RU'); } catch { return prefill.date; } })() : '—'}</div>
              </div>
              {prefill.object && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Obyekt</div>
                  <div className="font-medium text-slate-700 dark:text-slate-300 truncate" title={prefill.object}>{prefill.object}</div>
                </div>
              )}
              {prefill.purpose && (
                <div className="col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Maqsad</div>
                  <div className="text-slate-600 dark:text-slate-400 text-[11.5px] leading-snug line-clamp-3">{prefill.purpose}</div>
                </div>
              )}
            </div>
          </div>

          {rejectMode ? (
            /* Rad etish rejimi */
            <div className="rounded-xl ring-1 ring-rose-200 dark:ring-rose-900 bg-rose-50/50 dark:bg-rose-950/20 p-4 space-y-3">
              <div className="text-[12px] font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                <XCircle className="h-4 w-4" /> Arizani rad etish
              </div>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Rad etish sababi…"
                rows={3}
                className="w-full rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-[12px] text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setRejectMode(false)} disabled={busy}>Bekor qilish</Button>
                <Button size="sm" onClick={doReject} disabled={busy || !rejectReason.trim()} className="bg-rose-600 hover:bg-rose-500">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><XCircle className="h-3.5 w-3.5 mr-1" /> Rad etish</>}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Kategoriya picker */}
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" /> Kategoriya (ixtiyoriy)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {categoriesQuery.isLoading && <span className="text-[11px] text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin inline" /></span>}
                  {tree.map((cat: any) => {
                    const active = categoryId === cat.id;
                    const color = cat.color || '#64748b';
                    return (
                      <button
                        key={cat.id}
                        onClick={() => { setCategoryId(active ? null : cat.id); setSubCategoryId(null); }}
                        className={cn(
                          'inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold ring-1 transition-all',
                          active
                            ? 'text-white shadow-sm'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300',
                        )}
                        style={active ? { backgroundColor: color, borderColor: color } : {}}
                      >
                        {cat.name}
                      </button>
                    );
                  })}
                </div>
                {/* Subkategoriyalar */}
                {(() => {
                  const cat = tree.find((c: any) => c.id === categoryId);
                  const children = cat?.children || [];
                  if (!cat || children.length === 0) return null;
                  const color = cat.color || '#64748b';
                  return (
                    <div className="flex flex-wrap gap-1.5 mt-2 pl-3 border-l-2" style={{ borderColor: `${color}55` }}>
                      {children.map((s: any) => {
                        const active = subCategoryId === s.id;
                        return (
                          <button
                            key={s.id}
                            onClick={() => setSubCategoryId(active ? null : s.id)}
                            className={cn(
                              'inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10.5px] font-medium ring-1 transition-all',
                              active
                                ? 'text-white shadow-sm'
                                : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300',
                            )}
                            style={active ? { backgroundColor: color, borderColor: color } : {}}
                          >
                            ↳ {s.name}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Shartnoma raqami */}
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
                  <FileSignature className="h-3.5 w-3.5" /> Shartnoma raqami <span className="text-rose-500">*</span>
                </label>
                <Input
                  value={contractNo}
                  onChange={(e) => setContractNo(e.target.value)}
                  placeholder="Masalan: 12345"
                  className="h-9 text-[12px]"
                />
              </div>

              {/* Ariza fayli */}
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" /> Ariza fayli <span className="text-rose-500">*majburiy</span>
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  onChange={onPickFile}
                  className="hidden"
                  id="approval-file-input"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className={cn(
                    'w-full flex flex-col items-center justify-center gap-1.5 py-5 px-3 rounded-xl border-2 border-dashed transition-all text-[12px]',
                    file
                      ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:border-rose-400 hover:bg-rose-50/40 dark:hover:bg-rose-950/10',
                  )}
                >
                  {file ? <FileIcon className="h-6 w-6" /> : <UploadIcon className="h-6 w-6" />}
                  <span className="truncate max-w-full font-semibold">{file ? file.name : 'Ariza faylini tanlang'}</span>
                  <span className="text-[10px] text-slate-400">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'PDF, DOC, JPG, PNG — max 25MB'}</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!rejectMode && (
          <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 shrink-0">
            {mode === 'approve' ? (
              <button
                onClick={() => setRejectMode(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-40"
              >
                <Ban className="h-3.5 w-3.5" /> Rad etish
              </button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-br from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-[12px] font-bold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Tasdiqlash va biriktirish
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ═══ Split kerak shartnomalar — CRM topilgan, lekin to'lovi bo'linmagan ═══
function XatoContractsModal({ open, onClose }: {
  open: boolean; onClose: () => void;
}) {
  const t = useTranslations('transactions');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [busyContract, setBusyContract] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ scope: string; filled: number } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['unsplit-contracts'],
    queryFn: () => api.get<{ ok: boolean; count: number; items: Array<{ contractNo: string; count: number; totalAmount: number }> }>('/oplata-kv/unsplit-contracts'),
    enabled: open,
  });

  // Ochilgan (batafsil ko'rsatilayotgan) shartnoma
  const [expanded, setExpanded] = useState<string | null>(null);
  const detailQuery = useQuery({
    queryKey: ['split-detail', expanded],
    queryFn: () => api.get<{ ok: boolean; items: Array<{ id: string; date: string | null; paymentAmount: any; firstInstallment: any; monthlyAmount: any; paymentCategory: string | null }> }>(`/oplata-kv/by-contract?contractNo=${encodeURIComponent(expanded || '')}`),
    enabled: !!expanded,
  });

  const splitMut = useMutation({
    mutationFn: (contractNo?: string) =>
      api.post<{ filled: number; total: number; contracts: number }>(
        '/oplata-kv/split-installments',
        contractNo ? { contractNo } : {},
        { timeout: 1_800_000 },
      ),
    onMutate: (contractNo) => setBusyContract(contractNo || '__all__'),
    onSuccess: (r, contractNo) => {
      setLastResult({ scope: contractNo || t('splitAll'), filled: r.filled });
      toast.success(t('splitDone', { n: r.filled }));
      qc.invalidateQueries({ queryKey: ['unsplit-contracts'] });
      qc.invalidateQueries({ queryKey: ['oplata-kv'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      // Bitta shartnoma split qilinsa — uni ochib, qanday bo'linganini ko'rsatamiz
      if (contractNo) {
        setExpanded(contractNo);
        qc.invalidateQueries({ queryKey: ['split-detail', contractNo] });
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Split xato'),
    onSettled: () => setBusyContract(null),
  });

  const items = useMemo(() => {
    const all = data?.items || [];
    const s = search.trim().toLowerCase();
    return s ? all.filter((i) => i.contractNo.toLowerCase().includes(s)) : all;
  }, [data, search]);

  // Pagination — ko'p qatorni birdaniga render qilmaslik uchun (qotib qolmasin)
  const PER_PAGE = 60;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, open]);
  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const pageClamped = Math.min(page, totalPages);
  const paged = items.slice((pageClamped - 1) * PER_PAGE, pageClamped * PER_PAGE);
  const allBusy = busyContract === '__all__';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !splitMut.isPending && onClose()}>
      <DialogContent className="max-w-5xl w-[96vw] p-0 overflow-hidden gap-0">
        <div className="bg-gradient-to-br from-teal-500 to-emerald-600 px-5 py-4 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Scissors className="h-5 w-5" /> {t('toolXatoContracts')}
            </DialogTitle>
            <DialogDescription className="text-white/85 text-[12px]">
              {t('xatoModalDesc')}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('xatoModalSearch')} className="pl-9 h-9" />
            </div>
            <span className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums whitespace-nowrap">
              {data?.count ?? 0} {t('xatoModalCount')}
            </span>
            <button
              type="button"
              disabled={splitMut.isPending || (data?.count ?? 0) === 0}
              onClick={() => splitMut.mutate(undefined)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold disabled:opacity-50 transition-colors"
            >
              {allBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
              {t('splitAll')}
            </button>
          </div>

          {lastResult && (
            <div className="rounded-lg ring-1 ring-emerald-200 dark:ring-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 px-3 py-2 text-[12px] text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span><b className="font-mono">{lastResult.scope}</b> — {t('splitDone', { n: lastResult.filled })}</span>
            </div>
          )}

          <div className="max-h-[64vh] min-h-[280px] overflow-y-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 p-2">
            {isLoading ? (
              <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-[12px] flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> …
              </div>
            ) : items.length === 0 ? (
              <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-[12px]">{t('xatoModalEmpty')}</div>
            ) : (
              <div className="space-y-1.5">
                {paged.map((i) => {
                  const rowBusy = busyContract === i.contractNo;
                  const isOpen = expanded === i.contractNo;
                  return (
                    <div key={i.contractNo} className="rounded-lg ring-1 ring-slate-100 dark:ring-slate-800 overflow-hidden">
                      <div className="flex items-center gap-2 px-2.5 py-2 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 transition-all">
                        <button type="button" onClick={() => setExpanded(isOpen ? null : i.contractNo)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                          <ChevronDown className={cn('h-4 w-4 text-slate-400 shrink-0 transition-transform', !isOpen && '-rotate-90')} />
                          <span className="min-w-0">
                            <code className="font-mono text-[12px] font-bold text-emerald-700 dark:text-emerald-300">{i.contractNo}</code>
                            <span className="block text-[10px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
                              {i.count} · {formatMoney(i.totalAmount)}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={splitMut.isPending}
                          onClick={() => splitMut.mutate(i.contractNo)}
                          title={t('splitOne')}
                          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-50 transition-colors shrink-0"
                        >
                          {rowBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
                          Split
                        </button>
                        <CopyIdButton value={i.contractNo} />
                      </div>

                      {/* Batafsil — to'lovlar id bilan, qanday bo'lingani */}
                      {isOpen && (
                        <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 px-2 py-2">
                          {detailQuery.isLoading ? (
                            <div className="py-4 text-center text-[11px] text-slate-400 flex items-center justify-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> …</div>
                          ) : (
                            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
                              <table className="w-full text-[11px]">
                                <thead className="bg-white dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[10px] uppercase">
                                  <tr>
                                    <th className="px-2 py-1.5 text-left font-semibold">ID</th>
                                    <th className="px-2 py-1.5 text-left font-semibold">Sana</th>
                                    <th className="px-2 py-1.5 text-right font-semibold">Сумма</th>
                                    <th className="px-2 py-1.5 text-right font-semibold">1 взнос</th>
                                    <th className="px-2 py-1.5 text-right font-semibold">ежемес.</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {(detailQuery.data?.items || []).map((d) => {
                                    const split = d.firstInstallment != null || d.monthlyAmount != null;
                                    return (
                                      <tr key={d.id} className={cn('transition-colors', split ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : '')}>
                                        <td className="px-2 py-1.5 font-mono text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{d.id.slice(0, 8)}…</td>
                                        <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{d.date ? new Date(d.date).toLocaleDateString('ru-RU') : '—'}</td>
                                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{d.paymentAmount ? Number(d.paymentAmount).toLocaleString('ru-RU') : '—'}</td>
                                        <td className="px-2 py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-300">{d.firstInstallment ? Number(d.firstInstallment).toLocaleString('ru-RU') : '—'}</td>
                                        <td className="px-2 py-1.5 text-right tabular-nums text-sky-700 dark:text-sky-300">{d.monthlyAmount ? Number(d.monthlyAmount).toLocaleString('ru-RU') : '—'}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!isLoading && items.length > PER_PAGE && (
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                {(pageClamped - 1) * PER_PAGE + 1}–{Math.min(pageClamped * PER_PAGE, items.length)} / {items.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={pageClamped <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 w-8 grid place-items-center rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2 font-semibold tabular-nums">{pageClamped} / {totalPages}</span>
                <button type="button" disabled={pageClamped >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-8 w-8 grid place-items-center rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
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
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-100 dark:ring-emerald-900', accent: '#10b981' },
    rose:    { bg: 'bg-rose-50 dark:bg-rose-950/40',    text: 'text-rose-600 dark:text-rose-400',    ring: 'ring-rose-100 dark:ring-rose-900',    accent: '#f43f5e' },
    indigo:  { bg: 'bg-indigo-50 dark:bg-indigo-950/40',  text: 'text-indigo-600 dark:text-indigo-400',  ring: 'ring-indigo-100 dark:ring-indigo-900',  accent: '#6366f1' },
    amber:   { bg: 'bg-amber-50 dark:bg-amber-950/40',   text: 'text-amber-600 dark:text-amber-400',   ring: 'ring-amber-100 dark:ring-amber-900',   accent: '#f59e0b' },
  }[color];
  return (
    <Card className="border-0 shadow-soft card-hover overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-2">
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500 dark:text-slate-400">{label}</div>
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
          ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-900 border-0"
          : "bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-700 border-0",
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

// ═══════════════════════════════════════════════════════════════════════
// RECATEGORIZE PROGRESS — kategoriyalash jarayoni live modal
// ═══════════════════════════════════════════════════════════════════════
function RecategorizeProgressDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('transactions');
  const qc = useQueryClient();
  const [errorsOpen, setErrorsOpen] = useState(false);

  // Live polling — har 2 soniyada
  const { data } = useQuery({
    queryKey: ['categorize-status'],
    queryFn: () => api.get<any>('/categorization/run-all/status'),
    enabled: open,
    refetchInterval: open ? 2000 : false,
  });

  const running = data?.running;
  const progress = data?.progress;
  const lastError = data?.lastError;
  const recentErrors = data?.recentErrors || [];
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const matched = progress?.matched ?? 0;
  const errors = progress?.errors ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const finished = !running && progress != null && done > 0;

  // Tugaganda transactions list'ni yangilash
  useEffect(() => {
    if (finished) {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['tx-stats'] });
    }
  }, [finished, qc]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && running) return; onOpenChange(o); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className={cn(
              'w-7 h-7 rounded-lg grid place-items-center text-white',
              running
                ? 'bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse'
                : finished
                  ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
                  : 'bg-gradient-to-br from-slate-400 to-slate-500',
            )}>
              <Sparkles className="h-4 w-4" />
            </div>
            {running ? t('recatRunningTitle') : finished ? '✅ ' + t('recatDoneTitle') : t('categorize')}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {running
              ? t('recatRunningDesc')
              : finished
                ? t('recatDoneDesc', { n: matched })
                : t('recatLoadingDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Progress bar — chiroyli gradient */}
          {progress && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                  {done.toLocaleString('uz-UZ')} / {total.toLocaleString('uz-UZ')}
                </span>
                <span className={cn(
                  'text-[14px] font-bold tabular-nums',
                  finished ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400',
                )}>{pct}%</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden relative">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500 relative overflow-hidden',
                    finished
                      ? 'bg-gradient-to-r from-emerald-400 to-teal-500'
                      : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500',
                  )}
                  style={{ width: `${pct}%` }}
                >
                  {running && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_2s_infinite]" />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 3 ta stat — animated */}
          <div className="grid grid-cols-3 gap-2">
            <StatBox
              label={t('recatReviewed')}
              value={done}
              color="indigo"
              icon={<Activity className="h-3.5 w-3.5" />}
              animate={running}
            />
            <StatBox
              label={t('recatCategorized')}
              value={matched}
              color="emerald"
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              animate={running}
            />
            <StatBox
              label={t('errorLabel')}
              value={errors}
              color="rose"
              icon={<AlertCircle className="h-3.5 w-3.5" />}
              animate={running && errors > 0}
            />
          </div>

          {/* Tugagan banner */}
          {finished && (
            <div className="px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 text-emerald-900 dark:text-emerald-300 text-[12px] flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">{t('recatFinishedTitle')}</div>
                <div className="text-emerald-700 dark:text-emerald-300 text-[11px] mt-0.5">
                  {t('recatFinishedBody', { matched, skipped: done - matched })}
                </div>
              </div>
            </div>
          )}

          {/* Boshlanmagan/kutmoqda */}
          {!progress && (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-[12px] py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('processStarting')}
            </div>
          )}

          {/* Xato logi (collapsible) */}
          {recentErrors.length > 0 && (
            <div className="rounded-xl ring-1 ring-rose-200 dark:ring-rose-900 bg-rose-50/40 dark:bg-rose-950/40 overflow-hidden">
              <button
                onClick={() => setErrorsOpen((o) => !o)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-left text-[12px] font-semibold text-rose-900 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30"
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {t('recatRecentErrors', { n: recentErrors.length })}
                </span>
                {errorsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {errorsOpen && (
                <div className="max-h-64 overflow-y-auto divide-y divide-rose-100 dark:divide-rose-900">
                  {recentErrors.map((e: any, i: number) => (
                    <div key={i} className="px-4 py-2 text-[10.5px] space-y-0.5">
                      <div className="flex items-baseline gap-2">
                        <code className="font-mono text-rose-700 dark:text-rose-300 text-[10px]">{e.txId.slice(0, 12)}...</code>
                        <span className="text-slate-400 dark:text-slate-500 text-[9.5px] ml-auto">{formatDateTime(e.at)}</span>
                      </div>
                      <div className="text-slate-700 dark:text-slate-300 break-words">{e.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Fatal error */}
          {lastError && !running && errors === 0 && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 text-rose-800 dark:text-rose-300 text-[12px]">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="break-all">{lastError}</div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant={finished ? 'default' : 'outline'}
            onClick={() => onOpenChange(false)}
            className={finished ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
          >
            {running ? t('continueInBackground') : t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatBox({
  label, value, color, icon, animate,
}: {
  label: string;
  value: number;
  color: 'indigo' | 'emerald' | 'rose';
  icon: React.ReactNode;
  animate?: boolean;
}) {
  const colorMap = {
    indigo:  'bg-indigo-50 dark:bg-indigo-950/40 ring-indigo-200 dark:ring-indigo-900 text-indigo-700 dark:text-indigo-300',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-700 dark:text-emerald-300',
    rose:    'bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300',
  };
  return (
    <div className={cn('rounded-xl ring-1 px-3 py-2.5 transition-all', colorMap[color], animate && 'animate-pulse')}>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold opacity-75">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value.toLocaleString('uz-UZ')}</div>
    </div>
  );
}

function TransactionDetailDialog({
  row, onClose, canManage,
  canManualEdit = false, canManualContract = false, canApplication = false, canAutoCategorize = false,
}: {
  row: any;
  onClose: () => void;
  canManage: boolean;
  canManualEdit?: boolean;
  canManualContract?: boolean;
  canApplication?: boolean;
  canAutoCategorize?: boolean;
}) {
  // ALOQA_BANK source — read-only. Hech qanday tahrir tugmasi ishlamaydi.
  // row prop ba'zan null (dialog yopilgan paytda) — xavfsiz tekshirish
  const isAloqaBank = row?.source === 'ALOQA_BANK';
  // Hech bo'lmaganda bitta action mavjud bo'lsa "panel" ko'rinadi (read-only bo'lmasa)
  const showActionPanel = !isAloqaBank && (canManualEdit || canManualContract || canApplication || canAutoCategorize);
  const t = useTranslations('transactions');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [categorizeLog, setCategorizeLog] = useState<any>(null);
  const [manualEditOpen, setManualEditOpen] = useState(false);
  const [manualContractOpen, setManualContractOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
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
      toast.success(t('categorySaved'));
      setManualEditOpen(false);
      // Jadval va detail darrov yangilanishi uchun — invalidate + force refetch
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.refetchQueries({ queryKey: ['transactions'], type: 'active' });
      qc.invalidateQueries({ queryKey: ['tx-category-history', row.id] });
      qc.invalidateQueries({ queryKey: ['tx-distinct'] });
      liveQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  const setContractMut = useMutation({
    mutationFn: (contractNumber: string | null) => {
      const loadingId = toast.loading(t('contractSaving'));
      return api.post<{
        ok: boolean;
        verified: boolean;
        customerName: string | null;
        oplataKvSync?: OplataKvSyncResult;
      }>(`/categorization/transactions/${row.id}/set-contract`, { contractNumber })
        .finally(() => toast.dismiss(loadingId));
    },
    onSuccess: (r) => {
      toast.success(t('contractSavedCrm', { name: r.customerName || t('crmConfirmed') }));
      // OplataKv'da ham yangilangan bo'lsa alohida xabar
      showOplataKvSyncToast(r.oplataKvSync);
      // Jadval va detail darrov yangilanishi uchun — invalidate + force refetch
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.refetchQueries({ queryKey: ['transactions'], type: 'active' });
      qc.invalidateQueries({ queryKey: ['tx-category-history', row.id] });
      qc.invalidateQueries({ queryKey: ['tx-distinct'] });
      qc.invalidateQueries({ queryKey: ['oplata-kv'] });
      liveQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });


  const setCounterpartyMut = useMutation({
    mutationFn: (counterpartyId: string | null) =>
      api.post<{ ok: boolean; counterparty: { id: string; inn: string; name: string } | null }>(
        `/categorization/transactions/${row.id}/set-counterparty`,
        { counterpartyId },
      ),
    onSuccess: (r) => {
      toast.success(r.counterparty ? t('counterpartySet', { name: r.counterparty.name }) : t('counterpartyRemoved'));
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.refetchQueries({ queryKey: ['transactions'], type: 'active' });
      qc.invalidateQueries({ queryKey: ['tx-category-history', row.id] });
      liveQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  // Qo'lda shartnoma kiritish (CRM tekshirmaydi)
  const setContractManualMut = useMutation({
    mutationFn: (contractNumber: string | null) => {
      const loadingId = toast.loading(t('contractSaving'));
      return api.post<{
        ok: boolean;
        contractNumber: string | null;
        oplataKvSync?: OplataKvSyncResult;
      }>(
        `/categorization/transactions/${row.id}/set-contract-manual`,
        { contractNumber },
      ).finally(() => toast.dismiss(loadingId));
    },
    onSuccess: (r) => {
      toast.success(r.contractNumber ? t('contractSavedManual', { contract: r.contractNumber }) : t('contractRemoved'));
      // OplataKv'da ham yangilangan bo'lsa alohida xabar
      showOplataKvSyncToast(r.oplataKvSync);
      setManualContractOpen(false);
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['tx-category-history', row.id] });
      qc.invalidateQueries({ queryKey: ['oplata-kv'] });
      liveQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
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
    onError: (e: any) => setCategorizeLog({ ok: false, error: e?.message || tc('error') }),
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
                {row.source === 'IMPORT' && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-fuchsia-300/25 text-fuchsia-100 ring-1 ring-fuchsia-200/40"
                    title={`${t('importedTitle')}${row.importedBy ? ' · ' + row.importedBy : ''}${row.importedAt ? ' · ' + formatDateTime(row.importedAt) : ''}`}
                  >
                    📥 IMPORT
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
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4 bg-white dark:bg-slate-900">

          {/* ═══ KONTRAGENT + KATEGORIYA + SHARTNOMA — asosiy info ═══ */}
          <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
            {/* ─── Asosiy info — har bir maydon alohida qator + tozalash tugmasi ─── */}
            {/* Kontragent qatori */}
            <InfoRow
              icon={<Briefcase className="h-3.5 w-3.5" />}
              label={t('kontragent')}
              // Priority:
              //   1) manualCounterparty.name (qo'lda tanlagan)
              //   2) importCounterpartyText (IMPORT'da Excel "Контрагент" ustuni)
              //   3) YOKI kategoriya nomi (CLIENT/BANK/MINFIN/...)
              // CRM mijoz nomi (contractCustomer) bu yerga TUSHMAYDI — SHARTNOMA qatorida bor
              value={
                liveRow.manualCounterparty?.name
                  || (liveRow.source === 'IMPORT' ? liveRow.importCounterpartyText : null)
                  || liveRow.category?.name
                  || null
              }
              subValue={
                liveRow.manualCounterparty?.inn
                  ? `${t('detailFieldInn')} ${liveRow.manualCounterparty.inn}`
                  : null
              }
              docNumber={row.docNumber}
              emptyText={t('notAssigned')}
              showClear={canManage && (!!liveRow.category || !!liveRow.manualCounterparty)}
              onClear={() => {
                if (liveRow.manualCounterparty) {
                  setCounterpartyMut.mutate(null);
                } else {
                  setCategoryMut.mutate({ categoryId: null, subcategoryId: null });
                }
              }}
            />

            {/* Kategoriya qatori */}
            <InfoRow
              icon={<Tag className="h-3.5 w-3.5" />}
              label={t('detailCategoryLabel')}
              chip={
                liveRow.category ? {
                  text: liveRow.subcategory?.name || liveRow.category.name,
                  color: liveRow.category.color || '#6366f1',
                } : null
              }
              subValue={
                liveRow.category && liveRow.subcategory
                  ? `${liveRow.category.name}${liveRow.categorizedBy ? ` · ${liveRow.categorizedBy === 'manual' ? t('badgeManual') : liveRow.categorizedBy} ${liveRow.categorizedAt ? '· ' + formatDateTime(liveRow.categorizedAt) : ''}` : ''}`
                  : liveRow.categorizedBy ? `${liveRow.categorizedBy === 'manual' ? t('badgeManual') : liveRow.categorizedBy}${liveRow.categorizedAt ? ' · ' + formatDateTime(liveRow.categorizedAt) : ''}` : null
              }
              emptyText={t('notAssigned')}
              showClear={canManage && !!liveRow.subcategory}
              onClear={() => setCategoryMut.mutate({ categoryId: liveRow.categoryId, subcategoryId: null })}
            />

            {/* Shartnoma qatori */}
            <InfoRow
              icon={<FileSignature className="h-3.5 w-3.5" />}
              label={t('detailContractLabel')}
              customValue={
                liveRow.contractNumber ? (
                  liveRow.contractStatus === 'manual' ? (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {liveRow.hasAttachment ? (
                        <>
                          <code className="inline-block font-mono text-[12px] font-bold text-violet-800 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 px-2 py-0.5 rounded ring-1 ring-violet-200 dark:ring-violet-900">
                            {liveRow.contractNumber}
                          </code>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/30 ring-1 ring-violet-200 dark:ring-violet-900">
                            <Paperclip className="h-3 w-3" /> {t('badgeApplication')}
                          </span>
                        </>
                      ) : (
                        <>
                          <code className="inline-block font-mono text-[12px] font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded ring-1 ring-amber-200 dark:ring-amber-900">
                            {liveRow.contractNumber}
                          </code>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 ring-1 ring-amber-200 dark:ring-amber-900">
                            {t('badgeManualCrmUnverified')}
                          </span>
                        </>
                      )}
                    </div>
                  ) : liveRow.contractStatus === 'unverified' ? (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900">
                        <AlertCircle className="h-3 w-3" /> {t('badgeErrorCrmNotFound')}
                      </span>
                      <button
                        onClick={() => setLookupContractDetail({ contract: liveRow.contractNumber, description: liveRow.description })}
                        title={t('aiLookupTitle')}
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 via-fuchsia-500 to-rose-500 text-white shadow-sm hover:shadow-md hover:shadow-fuchsia-500/40 hover:scale-110 transition-all"
                      >
                        <Wand2 className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <code className="inline-block font-mono text-[12px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded ring-1 ring-indigo-200 dark:ring-indigo-900">
                        {liveRow.contractNumber}
                      </code>
                      {liveRow.contractCustomer && (
                        <span className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded ring-1 ring-emerald-200 dark:ring-emerald-900 truncate max-w-[220px]" title={liveRow.contractCustomer}>
                          ✓ {liveRow.contractCustomer}
                        </span>
                      )}
                      {liveRow.contractCrmStatus && /cancel|отмен|бекор/i.test(liveRow.contractCrmStatus) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 ring-1 ring-orange-200 dark:ring-orange-900" title={`CRM status: ${liveRow.contractCrmStatus}`}>
                          <Ban className="h-3 w-3 shrink-0" /> {t('badgeCancelled')}
                        </span>
                      )}
                    </div>
                  )
                ) : null
              }
              emptyText={t('notFound')}
              showClear={canManage && !!liveRow.contractNumber}
              onClear={() => setContractMut.mutate(null)}
            />

            {/* Aloqa Bank read-only banner */}
            {isAloqaBank && (
              <div className="mx-4 mb-3 rounded-lg ring-1 ring-amber-200 dark:ring-amber-900 bg-amber-50/60 dark:bg-amber-950/40 px-3 py-2 flex items-start gap-2">
                <Lock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300 mt-0.5 shrink-0" />
                <div className="text-[11.5px] text-amber-900 dark:text-amber-300 leading-relaxed">
                  {t.rich('aloqaBankReadOnly', {
                    b: (chunks) => <b>{chunks}</b>,
                  })}
                </div>
              </div>
            )}

            {/* Avto-kategoriyalash + Qo'lda tahrirlash tugmalari */}
            {(canManage && showActionPanel) && (
              <div className="px-4 py-3 bg-slate-50/50 dark:bg-slate-900/50">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">
                    {liveRow.category
                      ? t('editPanelHintHasCategory')
                      : t('editPanelHintNoCategory')}
                  </div>
                  <div className="flex items-center gap-2">
                    {canAutoCategorize && !liveRow.category && (
                      <button
                        onClick={() => categorizeMut.mutate(false)}
                        disabled={categorizeMut.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {categorizeMut.isPending
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Wand2 className="h-3 w-3" />}
                        {t('autoCategorize')}
                      </button>
                    )}
                    {canManualEdit && (
                      <button
                        onClick={() => setManualEditOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-[11px] font-semibold ring-1 ring-slate-300 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:ring-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                      >
                        <FileText className="h-3 w-3" />
                        {t('manualEdit')}
                      </button>
                    )}
                    {/* Shartnomani qo'lda (CRM tekshirmasdan) */}
                    {canManualContract && (
                      <button
                        onClick={() => setManualContractOpen(true)}
                        title={t('manualContractBtnTitle')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white text-[11px] font-semibold hover:shadow-md hover:shadow-amber-500/40 transition-all"
                      >
                        <FileSignature className="h-3 w-3" />
                        {t('manualContractBtn')}
                      </button>
                    )}
                    {/* Ariza biriktirish */}
                    {canApplication && (
                      <button
                        onClick={() => setAttachmentsOpen(true)}
                        title={t('attachApplicationTitle')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white text-[11px] font-semibold hover:shadow-md hover:shadow-violet-500/40 transition-all relative"
                      >
                        <Paperclip className="h-3 w-3" />
                        {t('application')}
                        {(liveRow._attachmentCount || 0) > 0 && (
                          <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[8px] font-bold rounded-full min-w-[14px] h-3.5 px-1 grid place-items-center">
                            {liveRow._attachmentCount}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Natija logi */}
                {categorizeLog && (
                  <div className={cn(
                    "mt-3 rounded-lg p-3 text-[11px] ring-1",
                    categorizeLog.categoryCode === 'EXISTING'
                      ? 'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900 text-amber-900 dark:text-amber-300'
                      : categorizeLog.categoryCode
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-900 dark:text-emerald-300'
                        : 'bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-300',
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
                          <div className="font-semibold">{t('catLogAlreadyCategorized')}</div>
                        )}
                        {categorizeLog.categoryCode && categorizeLog.categoryCode !== 'EXISTING' && (
                          <div className="font-semibold">
                            ✓ {categorizeLog.categoryCode}
                            {categorizeLog.subcategoryCode && ` → ${categorizeLog.subcategoryCode}`}
                          </div>
                        )}
                        {!categorizeLog.categoryCode && (
                          <div className="font-semibold">{t('catLogNoRule')}</div>
                        )}
                        {categorizeLog.reason && (
                          <div className="text-[10px] opacity-80">{t('catLogReason')}: {categorizeLog.reason}</div>
                        )}
                        {categorizeLog.contractNumber && (
                          <div className="text-[10px] opacity-80 font-mono">{t('detailContractLabel')}: {categorizeLog.contractNumber}</div>
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
              title={allOpen ? t('collapseAll') : t('expandAll')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
            >
              {allOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {allOpen ? t('collapse') : t('expand')}
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
                <div className="text-[13px] text-slate-900 dark:text-slate-100 leading-relaxed whitespace-pre-wrap py-2">{row.description.trim()}</div>
                {row.purposeCode && (
                  <div className="mt-1 pt-2 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400">
                    {t('detailPurposeCode')}: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{row.purposeCode}</span>
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
          onSaveCounterparty={(counterpartyId) => setCounterpartyMut.mutate(counterpartyId)}
          savingCategory={setCategoryMut.isPending}
          savingContract={setContractMut.isPending}
          savingCounterparty={setCounterpartyMut.isPending}
        />
      )}

      {/* Shartnomani qo'lda kiritish (CRM tekshirmasdan) */}
      {manualContractOpen && (
        <ManualContractDialog
          row={liveRow}
          tree={categoriesTree}
          onClose={() => setManualContractOpen(false)}
          onSaveContract={(contract) => setContractManualMut.mutate(contract)}
          onSaveCategory={(categoryId, subcategoryId) => setCategoryMut.mutate({ categoryId, subcategoryId })}
          savingContract={setContractManualMut.isPending}
          savingCategory={setCategoryMut.isPending}
        />
      )}

      {/* Arizalar (fayllar) — wizard: kontragent + kategoriya + shartnoma + fayl */}
      {attachmentsOpen && (
        <AttachmentsDialog
          txId={row.id}
          row={liveRow}
          tree={categoriesTree}
          onClose={() => setAttachmentsOpen(false)}
          onSaveCategory={(categoryId, subcategoryId) => setCategoryMut.mutate({ categoryId, subcategoryId })}
          onSaveContractManual={(contract) => setContractManualMut.mutate(contract)}
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
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{label}</div>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
        >
          {copied ? <><Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> {t('copied')}</> : <><Copy className="h-3 w-3" /> {t('copy')}</>}
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
    ? tone === 'emerald' ? 'ring-emerald-200 dark:ring-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/40' : 'ring-rose-200 dark:ring-rose-900 bg-rose-50/50 dark:bg-rose-950/40'
    : 'ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900';
  return (
    <div className={cn("rounded-xl ring-1 overflow-hidden", ring)}>
      <button
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/80 dark:hover:bg-slate-800/80 transition-colors"
      >
        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <Icon className="h-3 w-3" /> {title}
          {highlighted && <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-bold">· {t('detailYou')}</span>}
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-slate-400 dark:text-slate-500 transition-transform shrink-0",
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="px-4 pb-2.5 pt-1 divide-y divide-slate-100/80 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
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
      <div className="text-[12px] text-slate-500 dark:text-slate-400 shrink-0">{label}</div>
      <div className="flex items-center gap-1.5 min-w-0">
        <div className={cn(
          "text-[13px] text-slate-900 dark:text-slate-100 text-right truncate",
          mono && 'font-mono text-[12px]',
          isEmpty && 'text-slate-400 dark:text-slate-500 italic',
        )}>
          {isEmpty ? t('empty') : value}
        </div>
        {copyable && !isEmpty && (
          <button
            onClick={copy}
            className="shrink-0 p-1 rounded text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 opacity-0 group-hover:opacity-100 transition-all"
            title={t('copy')}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
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
  const tt = useTranslations('transactions');
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
                : 'text-slate-400 dark:text-slate-500 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30',
            )}
            title={active ? tt('valuesSelected', { n: activeCount }) : tt('filterLabel')}
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
  const tt = useTranslations('transactions');
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
      className="fixed z-[100] w-96 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-2xl normal-case tracking-normal font-normal"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-3 space-y-2">
        {tabList.length > 1 && (
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
            {tabList.map((t) => {
              const count = localByColumn[t.column]?.size || 0;
              const isActive = activeTab === t.column;
              return (
                <button
                  key={t.column}
                  onClick={() => setActiveTab(t.column)}
                  className={cn(
                    'flex-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5',
                    isActive ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
                  )}
                >
                  <span>{t.label}</span>
                  {count > 0 && (
                    <span className={cn(
                      'inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold',
                      isActive ? 'bg-indigo-600 text-white' : 'bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
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
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium"
          >
            {tt('selectAllN', { n: distinctList.length })}
          </button>
          <button
            onClick={() => setLocalSelected(new Set())}
            className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 font-medium"
          >
            {tt('clearLabel')}
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tt('searchEllipsis')}
            className="pl-8 h-8 text-[12px]"
          />
        </div>
        <div className="max-h-[340px] overflow-y-auto rounded-lg ring-1 ring-slate-100 dark:ring-slate-800 divide-y divide-slate-50 dark:divide-slate-800">
          {distinctQuery.isLoading ? (
            <div className="px-3 py-4 text-center text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> {tt('loading')}
            </div>
          ) : allValues.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-slate-400 dark:text-slate-500 italic">{tt('notFound')}</div>
          ) : (
            <>
              <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 rounded"
                />
                <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  {allSelected ? tt('deselectAll') : tt('selectAll')}
                </span>
              </label>
              {allValues.map((v) => {
                // "(xato)" suffix bo'lsa — alohida badge bilan ko'rsatish
                const xatoMatch = v.name.match(/^(.+?)\s*\(xato\)\s*$/i);
                const display = xatoMatch ? xatoMatch[1] : v.name;
                const isXato = !!xatoMatch;
                return (
                  <label key={v.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSelected.has(v.id)}
                      onChange={() => toggleOne(v.id)}
                      className="w-3.5 h-3.5 rounded"
                    />
                    <span className="text-[11px] text-slate-700 dark:text-slate-300 truncate flex-1" title={v.name}>{display}</span>
                    {isXato && (
                      <span className="text-[9px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-1 py-0.5 rounded ring-1 ring-rose-200 dark:ring-rose-900 uppercase shrink-0">
                        {tt('badgeError')}
                      </span>
                    )}
                  </label>
                );
              })}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-slate-100 dark:border-slate-800">
        <Button variant="outline" size="sm" onClick={onClose} className="h-7 text-[11px]">
          {tt('cancelShort')}
        </Button>
        <Button size="sm" onClick={() => onApply(localByColumn)} className="h-7 text-[11px]">
          OK
        </Button>
      </div>
    </div>,
    document.body,
  );
}

// ═══ AMOUNT FILTER TH — summa ustuni filtri (2 tab: aniq summa / summadan summagacha)
type AmountFilterValue = { mode: 'exact' | 'range'; exact: string; min: string; max: string };
function AmountFilterTh({
  label, filterMode, value, onApply, openFilterColumn, setOpenFilterColumn,
}: {
  label: string;
  filterMode: boolean;
  value: AmountFilterValue;
  onApply: (v: AmountFilterValue) => void;
  openFilterColumn: string | null;
  setOpenFilterColumn: (col: string | null) => void;
}) {
  const tt = useTranslations('transactions');
  const COL = '__amount__';
  const isOpen = openFilterColumn === COL;
  const btnRef = useRef<HTMLButtonElement>(null);
  const digits = (s: string) => s.replace(/[^\d.]/g, '');
  const active = value.mode === 'exact'
    ? digits(value.exact) !== ''
    : (digits(value.min) !== '' || digits(value.max) !== '');
  return (
    <th className="text-right px-4 py-3">
      <div className="flex items-center gap-1.5 justify-end">
        <span>{label}</span>
        {filterMode && (
          <button
            ref={btnRef}
            onClick={() => setOpenFilterColumn(isOpen ? null : COL)}
            className={cn(
              'inline-flex items-center justify-center w-5 h-5 rounded transition-colors',
              active
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 dark:text-slate-500 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30',
            )}
            title={tt('filterLabel')}
          >
            <FilterIcon className="h-3 w-3" />
          </button>
        )}
      </div>
      {isOpen && (
        <AmountFilterPopover
          value={value}
          triggerRef={btnRef}
          onClose={() => setOpenFilterColumn(null)}
          onApply={(v) => { onApply(v); setOpenFilterColumn(null); }}
        />
      )}
    </th>
  );
}

function AmountFilterPopover({
  value, onClose, onApply, triggerRef,
}: {
  value: AmountFilterValue;
  onClose: () => void;
  onApply: (v: AmountFilterValue) => void;
  triggerRef: React.RefObject<HTMLElement>;
}) {
  const tt = useTranslations('transactions');
  const [mode, setMode] = useState<'exact' | 'range'>(value.mode);
  const [exact, setExact] = useState(value.exact);
  const [min, setMin] = useState(value.min);
  const [max, setMax] = useState(value.max);

  // 17247000 → "17 247 000" (ko'rsatish uchun)
  const fmt = (s: string) => {
    const d = s.replace(/\D/g, '');
    return d ? Number(d).toLocaleString('ru-RU') : '';
  };

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-amount-filter]')) onClose();
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!triggerRef.current) return;
    function update() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const w = 300;
      setPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - w) });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [triggerRef]);

  if (!pos) return null;

  const apply = () => onApply({ mode, exact, min, max });
  const clear = () => { setExact(''); setMin(''); setMax(''); onApply({ mode, exact: '', min: '', max: '' }); };

  return createPortal(
    <div
      data-amount-filter
      className="fixed z-[100] w-[300px] rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-2xl normal-case tracking-normal font-normal"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-3 space-y-3">
        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
          <button
            onClick={() => setMode('exact')}
            className={cn('flex-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors',
              mode === 'exact' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}
          >
            {tt('amountExactTab')}
          </button>
          <button
            onClick={() => setMode('range')}
            className={cn('flex-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors',
              mode === 'range' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}
          >
            {tt('amountRangeTab')}
          </button>
        </div>

        {mode === 'exact' ? (
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{tt('amountExactLabel')}</label>
            <Input
              inputMode="numeric"
              value={fmt(exact)}
              onChange={(e) => setExact(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
              placeholder="17 247 000"
              className="h-8 text-[12px] text-right tabular-nums font-mono"
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{tt('amountFromLabel')}</label>
              <Input
                inputMode="numeric"
                value={fmt(min)}
                onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
                placeholder="0"
                className="h-8 text-[12px] text-right tabular-nums font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{tt('amountToLabel')}</label>
              <Input
                inputMode="numeric"
                value={fmt(max)}
                onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
                placeholder="∞"
                className="h-8 text-[12px] text-right tabular-nums font-mono"
              />
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-100 dark:border-slate-800">
        <button onClick={clear} className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 font-medium">
          {tt('clearLabel')}
        </button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose} className="h-7 text-[11px]">{tt('cancelShort')}</Button>
          <Button size="sm" onClick={apply} className="h-7 text-[11px]">OK</Button>
        </div>
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
  const t = useTranslations('transactions');
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
            <Wand2 className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-400" /> {t('aiContractFind')}
          </DialogTitle>
          <DialogDescription>
            {t('aiContractFindDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Mijoz bergan shartnoma + topilgan F.I.O. (2 blok, har doim ko'rinadi) */}
          <div className="rounded-lg p-3 bg-gradient-to-br from-rose-50 to-orange-50 dark:from-rose-950/40 dark:to-orange-950/40 ring-1 ring-rose-200 dark:ring-rose-900 space-y-2">
            <div className="text-[10px] uppercase tracking-wider font-bold text-rose-700 dark:text-rose-300">
              {t('aiPaymentPurposeCame')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Shartnoma raqami */}
              <div>
                <div className="text-[9px] uppercase tracking-wider font-bold text-rose-600 dark:text-rose-400 mb-0.5 flex items-center gap-1">
                  <FileSignature className="h-2.5 w-2.5" /> {t('contractNumberLabel')}
                </div>
                <code className="font-mono text-[13px] font-bold text-rose-900 dark:text-rose-300 select-all block break-all">
                  {contractNumber}
                </code>
              </div>
              {/* F.I.O. — har doim block (topilmasa "AI topa olmadi" yoziladi) */}
              <div>
                <div className="text-[9px] uppercase tracking-wider font-bold text-rose-600 dark:text-rose-400 mb-0.5 flex items-center gap-1">
                  <Wand2 className="h-2.5 w-2.5" /> {t('aiFioExtracted')}
                </div>
                {extractedName ? (
                  <div className="text-[12px] font-semibold text-rose-900 dark:text-rose-300 select-all break-words">
                    {extractedName}
                  </div>
                ) : (
                  <div className="text-[11px] text-rose-500 dark:text-rose-400 italic">
                    {t('aiFioNotFound')}
                  </div>
                )}
              </div>
            </div>
            <div className="text-[10px] text-rose-600 dark:text-rose-400 pt-1 border-t border-rose-200/60 dark:border-rose-900">
              ⚠ {t('aiCrmNotFoundConfirm')}
            </div>
          </div>

          {/* CRM natijalari */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-600 dark:text-slate-300 mb-1.5 flex items-center justify-between">
              <span>{t('aiSimilarContracts')} (prefix: <code className="font-mono text-indigo-700 dark:text-indigo-300">{currentPrefix}</code>)</span>
              {searchQuery.isFetching && <Loader2 className="h-3 w-3 text-indigo-500 dark:text-indigo-400 animate-spin" />}
            </div>
            <div className="max-h-[320px] overflow-y-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
              {!searchQuery.isFetching && items.length === 0 && currentPrefixIndex >= tryPrefixes.length - 1 && (
                <div className="px-4 py-6 text-center text-[11px] text-rose-600 dark:text-rose-400">
                  {t('aiNoSimilarFound')}
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
                      perfectMatch ? 'bg-emerald-100 dark:bg-emerald-900/40 ring-2 ring-emerald-400 dark:ring-emerald-900'
                        : nameMatch ? 'bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900'
                        : contractMatch ? 'bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className={cn(
                        'font-mono text-[12px] font-bold',
                        perfectMatch ? 'text-emerald-800 dark:text-emerald-300' : nameMatch ? 'text-emerald-700 dark:text-emerald-300' : contractMatch ? 'text-amber-700 dark:text-amber-300' : 'text-indigo-700 dark:text-indigo-300',
                      )}>
                        {it.contract}
                      </code>
                      <div className="flex items-center gap-1">
                        {perfectMatch && (
                          <span className="text-[9px] font-black text-emerald-900 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1 bg-emerald-200 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded">
                            <CheckCircle2 className="h-2.5 w-2.5" /> {t('aiMatchExact')}
                          </span>
                        )}
                        {!perfectMatch && nameMatch && (
                          <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1">
                            <Wand2 className="h-2.5 w-2.5" /> {t('aiMatchName')}
                          </span>
                        )}
                        {!perfectMatch && !nameMatch && contractMatch && (
                          <span className="text-[9px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                            {t('aiMatchContract')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-700 dark:text-slate-300 mt-0.5 font-medium">
                      {fullName || <span className="text-slate-400 dark:text-slate-500 italic">{t('noName')}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {sortedItems.length > 0 && (
              <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 text-center italic">
                {t('aiConfirmWithClient')}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══ BIRLASHTIRILGAN TAHRIR — Sequential 3 step: Kontragent → Kategoriya → Shartnoma
function CombinedEditDialog({
  row, tree, onClose,
  onSaveCategory, onSaveContract, onSaveCounterparty,
  savingCategory, savingContract, savingCounterparty,
}: {
  row: any;
  tree: any[];
  onClose: () => void;
  onSaveCategory: (categoryId: string | null, subcategoryId: string | null) => void;
  onSaveContract: (contract: string | null) => void;
  onSaveCounterparty: (counterpartyId: string | null) => void;
  savingCategory: boolean;
  savingContract: boolean;
  savingCounterparty: boolean;
}) {
  const t = useTranslations('transactions');
  // Counterparty picker state
  const [cpSearch, setCpSearch] = useState('');
  const [cpDebounced, setCpDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setCpDebounced(cpSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [cpSearch]);

  const cpQuery = useQuery({
    queryKey: ['cp-search', cpDebounced],
    queryFn: () => api.get<{ items: any[]; total: number }>(`/counterparties?q=${encodeURIComponent(cpDebounced)}&perPage=15`),
    enabled: cpDebounced.length >= 2,
    staleTime: 60_000,
  });
  const cpItems = cpQuery.data?.items || [];
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
            <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> {t('manualEdit')}
          </DialogTitle>
          <DialogDescription>
            {t('combinedEditDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ═══ STEP 1: KATEGORIYA (asosiy) ═══ */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2 block flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px]">1</span>
              {t('detailCategoryLabel')}
              {!selectedTop && (
                <span className="text-slate-400 dark:text-slate-500 font-normal normal-case tracking-normal ml-1 text-[10px]">
                  (tanlang → subkategoriyalar ochiladi)
                </span>
              )}
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {visibleTree.map((cat: any) => {
                const selected = selectedTopId === cat.id;
                const color = cat.color || '#64748b';
                return (
                  <button
                    key={cat.id}
                    onClick={() => pickKontragent(cat)}
                    className={cn(
                      'text-left px-3 py-2 rounded-lg ring-1 ring-inset text-[12px] font-medium transition-all',
                      selected ? 'ring-2' : 'ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800',
                    )}
                    style={selected ? { backgroundColor: `${color}15`, color, borderColor: color } : {}}
                  >
                    {cat.name}
                    {selected && <CheckCircle2 className="inline-block h-3 w-3 ml-1.5" style={{ color }} />}
                  </button>
                );
              })}
            </div>

            {/* ─── Maxsus kontragent qidirish (GREATCITY, BARAKAT...) ─── */}
            <div className="mt-3 pt-3 border-t border-dashed border-slate-200 dark:border-slate-700">
              <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                <Search className="h-3 w-3" />
                <span>{t('orFindSpecialCounterparty')}</span>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                <Input
                  value={cpSearch}
                  onChange={(e) => setCpSearch(e.target.value)}
                  placeholder={t('counterpartySearchExample')}
                  className="pl-8 h-9 text-[12px]"
                />
                {cpSearch && (
                  <button
                    onClick={() => setCpSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {cpDebounced.length >= 2 && (
                <div className="mt-1.5 max-h-56 overflow-y-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900">
                  {cpQuery.isLoading ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-slate-400 dark:text-slate-500 text-[11px]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('searching')}
                    </div>
                  ) : cpItems.length === 0 ? (
                    <div className="px-3 py-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
                      {t('searchNotFound', { q: cpDebounced })}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {cpItems.map((cp: any) => {
                        const selected = row?.manualCounterpartyId === cp.id;
                        return (
                          <button
                            key={cp.id}
                            onClick={() => {
                              onSaveCounterparty(cp.id);
                              setCpSearch('');
                            }}
                            disabled={savingCounterparty}
                            className={cn(
                              'w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-start gap-2',
                              selected && 'bg-emerald-50 dark:bg-emerald-950/40',
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 truncate">{cp.name}</div>
                              {cp.inn && (
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{t('detailFieldInn')}: {cp.inn}</div>
                              )}
                            </div>
                            {selected && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {row?.manualCounterparty && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 rounded-md px-2 py-1.5">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  <span className="flex-1 truncate">
                    {t('currentLabel')}: <b>{row.manualCounterparty.name}</b>
                  </span>
                  <button
                    onClick={() => onSaveCounterparty(null)}
                    disabled={savingCounterparty}
                    className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium shrink-0"
                  >
                    {t('remove')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ═══ STEP 2: SUBKATEGORIYA (faqat top tanlangan bo'lsa) ═══ */}
          {selectedTop && (
            <div className="pt-3 border-t-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20 -mx-2 px-2 py-3 rounded-lg">
              <label className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider mb-2 block flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px]">2</span>
                {t('subcategory')}
                <span className="text-slate-500 dark:text-slate-400 font-normal normal-case tracking-normal ml-1">
                  {t('forCategory', { name: selectedTop.name })}
                </span>
              </label>
              {subs.length === 0 ? (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700">
                  {t('noSubcategory', { name: selectedTop.name })}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setSelectedSubId(null)}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-[11px] font-medium ring-1 ring-inset transition-all',
                      !selectedSubId ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 ring-slate-900 dark:ring-slate-100' : 'ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-700 text-slate-600 dark:text-slate-300',
                    )}
                  >
                    {t('noneDash')}
                  </button>
                  {subs.map((s: any) => {
                    const selected = selectedSubId === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSubId(s.id)}
                        className={cn(
                          'px-3 py-1.5 rounded-md text-[11px] font-medium ring-1 ring-inset transition-all',
                          selected ? 'ring-2' : 'ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-700 text-slate-700 dark:text-slate-300',
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
                className="text-[11px] text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium"
              >
                {t('clearLabel')}
              </button>
              <Button
                size="sm"
                onClick={() => onSaveCategory(selectedTopId, selectedSubId)}
                disabled={savingCategory || !categoryChanged}
                className="h-8 text-[11px]"
              >
                {savingCategory ? <Loader2 className="h-3 w-3 animate-spin" /> : t('saveCategory')}
              </Button>
            </div>
          )}

          {/* ═══ STEP 3: SHARTNOMA — faqat CLIENT yoki TRANSFER uchun, va kontragent qo'lda tanlanmagan bo'lsa ═══ */}
          {!row.manualCounterparty && selectedTop && (selectedTop.code === 'CLIENT' || selectedTop.code === 'TRANSFER') && (
            <div className="pt-4 border-t border-indigo-200 dark:border-indigo-900">
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2 block flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px]">3</span>
                {t('contractNumberLabel')}
                <span className="text-slate-400 dark:text-slate-500 font-normal normal-case tracking-normal ml-1">
                  {t('crmSearchHint')}
                </span>
              </label>
              <div className="relative mb-2">
                <FileSignature className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
                <Input
                  value={contractQuery}
                  onChange={(e) => setContractQuery(e.target.value)}
                  placeholder={t('crmSearchPlaceholder')}
                  className="pl-9 font-mono"
                />
                {searchQuery.isFetching && debouncedQ.length >= 3 && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-500 dark:text-indigo-400 animate-spin" />
                )}
              </div>
              {debouncedQ.length >= 3 && (
                <div className="max-h-[200px] overflow-y-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {crmItems.length === 0 && !searchQuery.isFetching && (
                    <div className="px-4 py-3 text-[11px] text-rose-600 dark:text-rose-400">
                      {t('crmNotFoundInvalid')}
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
                        className="w-full text-left px-3 py-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors disabled:opacity-50 group"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <code className="font-mono text-[12px] font-bold text-indigo-700 dark:text-indigo-300 group-hover:text-indigo-900 dark:group-hover:text-indigo-200">
                            {it.contract}
                          </code>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 opacity-0 group-hover:opacity-100" />
                        </div>
                        <div className="text-[11px] text-slate-700 dark:text-slate-300 truncate mt-0.5 font-medium">
                          {fullName || <span className="text-slate-400 dark:text-slate-500 italic">{t('noName')}</span>}
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
                  className="text-[10px] text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium disabled:opacity-30"
                >
                  {t('clearContract')}
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('close')}
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
            <FileSignature className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Shartnoma raqami
          </DialogTitle>
          <DialogDescription>
            CRM'dan qidirish uchun shartnoma raqamini yozing (3+ belgi)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Masalan: 1494VTN24DQ"
              className="pl-9 font-mono"
            />
            {searchQuery.isFetching && debouncedQ.length >= 3 && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-500 dark:text-indigo-400 animate-spin" />
            )}
          </div>

          {debouncedQ.length < 3 ? (
            <div className="text-[11px] text-slate-400 dark:text-slate-500 italic px-2">
              Kamida 3 belgi kiriting…
            </div>
          ) : items.length === 0 && !searchQuery.isFetching ? (
            <div className="text-[11px] text-rose-600 dark:text-rose-400 px-2">
              CRM'da topilmadi — baribir saqlash mumkin (xato badge bilan)
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((it: any) => (
                <button
                  key={it.contract || it.id}
                  onClick={() => onSave(String(it.contract || '').trim())}
                  disabled={saving}
                  className="w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors disabled:opacity-50 group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-mono text-[12px] font-bold text-indigo-700 dark:text-indigo-300 group-hover:text-indigo-900 dark:group-hover:text-indigo-200">
                      {it.contract}
                    </code>
                    {it.status && (
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">{it.status}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate mt-0.5">
                    {it.client?.full_name_kirill || it.client?.full_name_lotin || it.client?.name || it.object_name || '—'}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => onSave(null)}
              disabled={saving || !currentContract}
              className="text-[12px] text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium disabled:opacity-30"
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
  const t = useTranslations('transactions');
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['tx-category-history', txId],
    queryFn: () => api.get<{ ok: boolean; items: any[] }>(`/categorization/transactions/${txId}/history`),
    enabled: open && !!txId,
    staleTime: 30_000,
  });
  const items = q.data?.items || [];

  return (
    <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/80 dark:hover:bg-slate-800/80 transition-colors"
      >
        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <History className="h-3 w-3" /> {t('historyLabel')}
          {open && items.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[9px] font-bold normal-case tracking-normal">
              {items.length}
            </span>
          )}
        </div>
        <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 dark:text-slate-500 transition-transform shrink-0', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-slate-100 dark:border-slate-800">
          {q.isLoading ? (
            <div className="py-3 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('loading')}
            </div>
          ) : items.length === 0 ? (
            <div className="py-3 text-[11px] text-slate-400 dark:text-slate-500 italic">{t('historyEmpty')}</div>
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

// ═══════════════════════════════════════════════════════════════════════
// MANUAL CONTRACT DIALOG — CRM tekshirmasdan shartnoma raqami kiritish
// ═══════════════════════════════════════════════════════════════════════
function ManualContractDialog({
  row, tree, onClose, onSaveContract, onSaveCategory, savingContract, savingCategory,
}: {
  row: any;
  tree: any[];
  onClose: () => void;
  onSaveContract: (contractNumber: string | null) => void;
  onSaveCategory: (categoryId: string | null, subcategoryId: string | null) => void;
  savingContract: boolean;
  savingCategory: boolean;
}) {
  const tc = useTranslations('common');
  const t = useTranslations('transactions');
  const [contract, setContract] = useState(row?.contractNumber || '');
  const [selectedTopId, setSelectedTopId] = useState<string | null>(row?.categoryId || null);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(row?.subcategoryId || null);

  const HIDDEN_KONTRAGENTS = ['COUNTERPARTY_RETURN', 'COUNTERPARTY'];
  const visibleTree = (tree || []).filter((t: any) => !HIDDEN_KONTRAGENTS.includes(t.code));
  const selectedTop = (tree || []).find((t: any) => t.id === selectedTopId);
  const subs = selectedTop?.children || [];
  const topColor = selectedTop?.color || '#f59e0b';

  const saving = savingContract || savingCategory;
  const contractTrimmed = contract.trim();
  const contractChanged = contractTrimmed !== (row?.contractNumber || '');
  const categoryChanged =
    selectedTopId !== (row?.categoryId || null) ||
    selectedSubId !== (row?.subcategoryId || null);
  const canSave = !!selectedTopId && !!contractTrimmed && (contractChanged || categoryChanged);

  function handleSave() {
    if (categoryChanged) onSaveCategory(selectedTopId, selectedSubId);
    if (contractChanged) onSaveContract(contractTrimmed || null);
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white">
              <FileSignature className="h-3.5 w-3.5" />
            </div>
            {t('manualContractTitle')}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {t('manualContractDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* ═══ STEP 1: KATEGORIYA (asosiy) ═══ */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2 block flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-600 text-white text-[9px]">1</span>
              {t('detailCategoryLabel')}
              {!selectedTop && (
                <span className="text-slate-400 dark:text-slate-500 font-normal normal-case tracking-normal ml-1 text-[10px]">
                  (tanlang → subkategoriyalar)
                </span>
              )}
              {selectedTop && subs.length > 0 && (
                <span className="text-amber-600 dark:text-amber-400 font-normal normal-case tracking-normal ml-1 text-[10px]">
                  · subkategoriyalar pastda ↓
                </span>
              )}
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {visibleTree.map((tt: any) => {
                const selected = selectedTopId === tt.id;
                const color = tt.color || '#64748b';
                return (
                  <button
                    key={tt.id}
                    onClick={() => { setSelectedTopId(tt.id); setSelectedSubId(null); }}
                    disabled={saving}
                    className={cn(
                      'text-left px-3 py-2 rounded-lg ring-1 ring-inset text-[12px] font-medium transition-all',
                      selected ? 'ring-2' : 'ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800',
                    )}
                    style={selected ? { backgroundColor: `${color}15`, color, borderColor: color } : {}}
                  >
                    {tt.name}
                    {selected && <CheckCircle2 className="inline-block h-3 w-3 ml-1.5" style={{ color }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ═══ STEP 2: SUB-KATEGORIYA (faqat top tanlangan va subs bor bo'lsa) ═══ */}
          {selectedTop && subs.length > 0 && (
            <div className="pt-3 border-t-2 border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 -mx-2 px-2 py-3 rounded-lg">
              <label className="text-[11px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-2 block flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-600 text-white text-[9px]">2</span>
                {t('subcategory')}
                <span className="text-slate-500 dark:text-slate-400 font-normal normal-case tracking-normal ml-1">
                  ({selectedTop.name} uchun · ixtiyoriy)
                </span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setSelectedSubId(null)}
                  disabled={saving}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-[11px] font-medium ring-1 ring-inset transition-all',
                    !selectedSubId ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 ring-slate-900 dark:ring-slate-100' : 'ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900',
                  )}
                >
                  {t('noneDash')}
                </button>
                {subs.map((s: any) => {
                  const selected = selectedSubId === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSubId(s.id)}
                      disabled={saving}
                      className={cn(
                        'px-3 py-1.5 rounded-md text-[11px] font-medium ring-1 ring-inset transition-all bg-white dark:bg-slate-900',
                        selected ? 'ring-2' : 'ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-700 text-slate-700 dark:text-slate-300',
                      )}
                      style={selected ? { backgroundColor: `${topColor}15`, color: topColor, borderColor: topColor } : {}}
                    >
                      {s.name}
                      {selected && <CheckCircle2 className="inline-block h-3 w-3 ml-1" style={{ color: topColor }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══ STEP 3: SHARTNOMA RAQAMI ═══ */}
          <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
            <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1 block flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-600 text-white text-[9px]">3</span>
              {t('contractNumberLabel')}
            </label>
            <Input
              value={contract}
              onChange={(e) => setContract(e.target.value)}
              placeholder={t('contractNumberPlaceholder')}
              className="font-mono"
              autoFocus
            />
            <div className="text-[10.5px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-1.5 rounded-md ring-1 ring-amber-200 dark:ring-amber-900 flex items-start gap-1.5">
              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{t('manualContractWarning')}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {row?.contractNumber && (
            <Button
              variant="outline"
              onClick={() => onSaveContract(null)}
              disabled={saving}
              className="text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {t('contractDelete')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>{tc('cancel')}</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ATTACHMENTS DIALOG — Ariza biriktirish + ro'yxat + yuklab olish + o'chirish
// ═══════════════════════════════════════════════════════════════════════
function AttachmentsDialog({
  txId, row, tree, onClose, onSaveCategory, onSaveContractManual,
}: {
  txId: string;
  row: any;
  tree: any[];
  onClose: () => void;
  onSaveCategory: (categoryId: string | null, subcategoryId: string | null) => void;
  onSaveContractManual: (contract: string | null) => void;
}) {
  const t = useTranslations('transactions');
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Forma state — yangi ariza uchun
  const [selectedTopId, setSelectedTopId] = useState<string | null>(null); // Kontragent boshda tanlanmagan
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [contract, setContract] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tx-attachments', txId],
    queryFn: () => api.get<{ ok: boolean; items: any[] }>(`/transactions/${txId}/attachments`),
  });
  const items = data?.items || [];
  const existing = items[0]; // Bitta ariza per tx — birinchisini olamiz

  const HIDDEN_KONTRAGENTS = ['COUNTERPARTY_RETURN', 'COUNTERPARTY'];
  const visibleTree = tree.filter((t: any) => !HIDDEN_KONTRAGENTS.includes(t.code));
  const selectedTop = tree.find((t) => t.id === selectedTopId);
  const subs = selectedTop?.children || [];
  const topColor = selectedTop?.color || '#6366f1';

  function handlePickFile(f: File) {
    if (f.size > 25 * 1024 * 1024) {
      toast.error(t('fileTooLarge'));
      return;
    }
    setFile(f);
  }

  async function handleSave() {
    if (!file) {
      toast.error(t('fileRequired'));
      return;
    }
    setUploading(true);
    try {
      // 1) Kategoriya saqlash (agar tanlangan bo'lsa)
      if (selectedTopId && (selectedTopId !== row.categoryId || selectedSubId !== row.subcategoryId)) {
        await api.post(`/categorization/transactions/${txId}/set`, {
          categoryId: selectedTopId,
          subcategoryId: selectedSubId,
        });
      }
      // 2) Shartnoma saqlash (qo'lda — CRM tekshirmasdan)
      const trimmedContract = contract.trim().toUpperCase();
      let contractSaveResult: {
        ok: boolean;
        contractNumber: string | null;
        oplataKvSync?: OplataKvSyncResult;
      } | null = null;
      if (trimmedContract && trimmedContract !== (row.contractNumber || '')) {
        contractSaveResult = await api.post(`/categorization/transactions/${txId}/set-contract-manual`, {
          contractNumber: trimmedContract,
        });
      }
      // 3) Faylni yuklash
      const fd = new FormData();
      fd.append('file', file);
      if (trimmedContract) fd.append('contractNumber', trimmedContract);
      fd.append('type', 'ariza');
      const uploadResp = await api.postForm<{
        ok: boolean;
        item: any;
        telegram?: { ok: boolean; chat?: string; error?: string };
      }>(`/transactions/${txId}/attachments`, fd, { timeout: 120_000 });

      // Telegram natijasi aniq ko'rsatiladi (yolg'on xabar bermaymiz)
      if (uploadResp.telegram?.ok) {
        toast.success(t('applicationSavedTelegram'), {
          description: `Chat: ${uploadResp.telegram.chat || '?'}`,
        });
      } else {
        toast.success(t('applicationSaved'), {
          description: uploadResp.telegram?.error
            ? `⚠ ${t('telegramError')}: ${uploadResp.telegram.error.slice(0, 200)}`
            : t('telegramNotSentNoConfig'),
          duration: 8000,
        });
      }
      // OplataKv propagation natijasi — alohida toast
      if (contractSaveResult?.oplataKvSync) {
        showOplataKvSyncToast(contractSaveResult.oplataKvSync);
        qc.invalidateQueries({ queryKey: ['oplata-kv'] });
      }
      refetch();
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['tx-detail', txId] });
      qc.invalidateQueries({ queryKey: ['tx-category-history', txId] });
      // Forma reset
      setSelectedTopId(null);
      setSelectedSubId(null);
      setContract('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e: any) {
      toast.error(e?.message || t('saveError'));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(attId: string) {
    if (!confirm(t('confirmDeleteApplication'))) return;
    setDeletingId(attId);
    try {
      const delResp = await api.delete<{
        ok: boolean;
        deleted: string;
        telegram?: { ok: boolean; chat?: string; error?: string };
      }>(`/transactions/${txId}/attachments/${attId}`);
      if (delResp.telegram?.ok) {
        toast.success(t('applicationDeletedTelegram'));
      } else {
        toast.success(t('applicationDeleted'), {
          description: delResp.telegram?.error
            ? `⚠ ${t('telegramError')}: ${delResp.telegram.error.slice(0, 200)}`
            : t('telegramNotSent'),
          duration: 8000,
        });
      }
      refetch();
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['tx-category-history', txId] });
    } catch (e: any) {
      toast.error(e?.message || t('deleteError'));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDownload(att: any) {
    try {
      await apiDownload(`/transactions/${txId}/attachments/${att.id}/download`, att.filename);
    } catch (e: any) {
      toast.error(e?.message || t('downloadError'));
    }
  }

  function formatSize(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o && !uploading) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 grid place-items-center text-white">
              <Paperclip className="h-3.5 w-3.5" />
            </div>
            {t('applicationFixTitle')}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {t('applicationFixDesc')}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400 dark:text-slate-500 text-[12px]">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : existing ? (
          // ─── MAVJUD ARIZA — ko'rsatish + delete ───
          <div className="space-y-3 pt-2">
            <div className="rounded-xl ring-1 ring-violet-200 dark:ring-violet-900 bg-violet-50/40 dark:bg-violet-950/40 p-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 grid place-items-center shrink-0">
                  <FileIcon className="h-5 w-5 text-violet-700 dark:text-violet-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-violet-900 dark:text-violet-300 truncate" title={existing.filename}>
                    {existing.filename}
                  </div>
                  <div className="text-[11px] text-violet-700 dark:text-violet-300 flex items-center gap-2 flex-wrap mt-0.5">
                    <span>{formatSize(existing.fileSize)}</span>
                    <span className="text-violet-400 dark:text-violet-500">·</span>
                    <span>{formatDateTime(existing.uploadedAt)}</span>
                    {existing.uploadedBy && (<>
                      <span className="text-violet-400 dark:text-violet-500">·</span>
                      <span>{existing.uploadedBy}</span>
                    </>)}
                  </div>
                  {existing.contractNumber && (
                    <div className="text-[10.5px] text-slate-600 dark:text-slate-300 mt-1">
                      {t('detailContractLabel')}: <code className="font-mono text-indigo-700 dark:text-indigo-300">{existing.contractNumber}</code>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleDownload(existing)}
                    title={t('download')}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(existing.id)}
                    disabled={deletingId === existing.id}
                    title={t('delete')}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/30"
                  >
                    {deletingId === existing.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 text-amber-800 dark:text-amber-300 text-[11px]">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                {t('applicationReplaceHint')}
              </div>
            </div>
          </div>
        ) : (
          // ─── YANGI ARIZA — wizard forma ───
          <div className="space-y-4 pt-2">
            {/* 1. Kategoriya (top + sub bitta qadamda) — to'liq ixtiyoriy */}
            <div>
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2 block flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-600 text-white text-[9px]">1</span>
                {t('detailCategoryLabel')}
                <span className="text-slate-400 dark:text-slate-500 font-normal normal-case tracking-normal ml-1">{t('optionalUnchanged')}</span>
                {selectedTopId && (
                  <span className="text-violet-500 dark:text-violet-400 font-normal normal-case tracking-normal ml-1 text-[10px]">
                    · subkategoriyalar pastda ↓
                  </span>
                )}
                {!selectedTopId && (
                  <span className="text-slate-400 dark:text-slate-500 font-normal normal-case tracking-normal ml-1 text-[10px]">
                    (tanlang → subkategoriyalar)
                  </span>
                )}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => { setSelectedTopId(null); setSelectedSubId(null); }}
                  className={cn(
                    'text-left px-3 py-2 rounded-lg ring-1 ring-inset text-[12px] font-medium transition-all col-span-2',
                    selectedTopId === null ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 ring-slate-900 dark:ring-slate-100' : 'ring-dashed ring-slate-300 dark:ring-slate-700 hover:ring-slate-400 dark:hover:ring-slate-600 text-slate-500 dark:text-slate-400',
                  )}
                >
                  {t('leaveEmptyCategory')}
                </button>
                {visibleTree.map((cat: any) => {
                  const selected = selectedTopId === cat.id;
                  const color = cat.color || '#64748b';
                  return (
                    <button
                      key={cat.id}
                      onClick={() => { setSelectedTopId(cat.id); setSelectedSubId(null); }}
                      className={cn(
                        'text-left px-3 py-2 rounded-lg ring-1 ring-inset text-[12px] font-medium transition-all',
                        selected ? 'ring-2' : 'ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800',
                      )}
                      style={selected ? { backgroundColor: `${color}15`, color, borderColor: color } : {}}
                    >
                      {cat.name}
                      {selected && <CheckCircle2 className="inline-block h-3 w-3 ml-1.5" style={{ color }} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Sub-kategoriya — agar top tanlangan va subs bor bo'lsa */}
            {selectedTop && subs.length > 0 && (
              <div className="pt-3 border-t-2 border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/20 -mx-2 px-2 py-3 rounded-lg">
                <label className="text-[11px] font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider mb-2 block flex items-center gap-1">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-600 text-white text-[9px]">2</span>
                  {t('subcategory')}
                  <span className="text-slate-500 dark:text-slate-400 font-normal normal-case tracking-normal ml-1">
                    ({selectedTop.name} uchun)
                  </span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setSelectedSubId(null)}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-[11px] font-medium ring-1 ring-inset transition-all',
                      !selectedSubId ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 ring-slate-900 dark:ring-slate-100' : 'ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-700 text-slate-600 dark:text-slate-300',
                    )}
                  >
                    {t('noneDash')}
                  </button>
                  {subs.map((s: any) => {
                    const selected = selectedSubId === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSubId(s.id)}
                        className={cn(
                          'px-3 py-1.5 rounded-md text-[11px] font-medium ring-1 ring-inset transition-all',
                          selected ? 'ring-2' : 'ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-700 text-slate-700 dark:text-slate-300',
                        )}
                        style={selected ? { backgroundColor: `${topColor}15`, color: topColor, borderColor: topColor } : {}}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. Shartnoma raqami */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2 block flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-600 text-white text-[9px]">3</span>
                {t('contractNumberLabel')}
                <span className="text-slate-400 dark:text-slate-500 font-normal normal-case tracking-normal ml-1">{t('optional')}</span>
              </label>
              <div className="relative">
                <FileSignature className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
                <Input
                  value={contract}
                  onChange={(e) => setContract(e.target.value)}
                  placeholder={t('contractPlaceholderNoCrm')}
                  className="pl-9 font-mono text-[11px]"
                />
              </div>
              <div className="text-[10.5px] text-amber-700 dark:text-amber-300 mt-1">
                {t('crmNotCheckedManual')}
              </div>
            </div>

            {/* 4. Fayl */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2 block flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-rose-600 text-white text-[9px]">4</span>
                {t('applicationFile')}
                <span className="text-rose-600 dark:text-rose-400 font-normal normal-case tracking-normal ml-1 font-bold">{t('requiredMark')}</span>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePickFile(f);
                }}
                className="hidden"
              />
              {file ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 dark:bg-violet-950/40 ring-1 ring-violet-200 dark:ring-violet-900">
                  <FileIcon className="h-4 w-4 text-violet-700 dark:text-violet-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-violet-900 dark:text-violet-300 truncate">{file.name}</div>
                    <div className="text-[10.5px] text-violet-700 dark:text-violet-300">{formatSize(file.size)}</div>
                  </div>
                  <button
                    onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                    className="text-[10px] text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium px-2"
                  >
                    {t('cancelShort')}
                  </button>
                </div>
              ) : (
                <Button
                  onClick={() => fileRef.current?.click()}
                  variant="outline"
                  className="w-full h-10 border-dashed gap-2 text-slate-600 dark:text-slate-300 hover:text-violet-700 dark:hover:text-violet-300 hover:border-violet-300 dark:hover:border-violet-900"
                >
                  <UploadIcon className="h-4 w-4" /> {t('selectFile')}
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={uploading}>{t('close')}</Button>
          {!existing && (
            <Button
              onClick={handleSave}
              disabled={uploading || !file}
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white gap-2"
            >
              {uploading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('saving')}</>
                : <><Check className="h-4 w-4" /> {t('saveAndAttach')}</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryHistoryItem({ h }: { h: any }) {
  const t = useTranslations('transactions');
  const actorLabel = h.actorName || h.action;
  const actionColor: Record<string, string> = {
    manual:       'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
    sync:         'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    auto:         'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
    cron:         'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    import:       'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300',
    counterparty: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
    contract:     'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    attachment:   'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
  };
  const actionLabelMap: Record<string, string> = {
    counterparty: t('histKontragent'),
    contract:     t('histContract'),
    attachment:   t('histApplication'),
  };
  const cls = actionColor[h.action] || 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';
  const isCp = h.action === 'counterparty';
  const isContract = h.action === 'contract';
  const isAttach = h.action === 'attachment';
  const isSpecial = isCp || isContract || isAttach;

  // Action turi: qo'shildi / o'zgartirildi / o'chirildi
  const hadOld = !!(h.oldCategoryName || h.oldSubcategoryName);
  const hasNew = !!(h.newCategoryName || h.newSubcategoryName);
  let actionLabel = '';
  let actionLabelCls = '';
  if (!hadOld && hasNew) { actionLabel = t('histAdded');       actionLabelCls = 'text-emerald-700 dark:text-emerald-300'; }
  else if (hadOld && hasNew) { actionLabel = t('histChanged'); actionLabelCls = 'text-indigo-700 dark:text-indigo-300'; }
  else if (hadOld && !hasNew) { actionLabel = t('histDeleted');   actionLabelCls = 'text-rose-700 dark:text-rose-300'; }

  // Maxsus chip render: kontragent / shartnoma / ariza uchun (kategoriya emas)
  const renderSpecial = (name: string | null) => {
    const cfg = isCp
      ? { bg: 'bg-teal-50 dark:bg-teal-950/40', ring: 'ring-teal-200 dark:ring-teal-900', text: 'text-teal-800 dark:text-teal-300', icon: <Briefcase className="h-3 w-3" /> }
      : isContract
        ? { bg: 'bg-amber-50 dark:bg-amber-950/40', ring: 'ring-amber-200 dark:ring-amber-900', text: 'text-amber-800 dark:text-amber-300', icon: <FileSignature className="h-3 w-3" /> }
        : { bg: 'bg-violet-50 dark:bg-violet-950/40', ring: 'ring-violet-200 dark:ring-violet-900', text: 'text-violet-800 dark:text-violet-300', icon: <Paperclip className="h-3 w-3" /> };
    return (
      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded ring-1 font-semibold', cfg.bg, cfg.ring, cfg.text, isContract && 'font-mono')}>
        {cfg.icon}
        {name || t('empty')}
      </span>
    );
  };
  const renderCat = (name: string | null, sub: string | null) => {
    if (!name && !sub) return <span className="text-slate-400 dark:text-slate-500 italic">{t('empty')}</span>;
    return (
      <span className="font-semibold">
        {name || '—'}{sub && <span className="text-slate-500 dark:text-slate-400 font-normal"> / {sub}</span>}
      </span>
    );
  };

  const specialBgRing = isCp ? 'ring-teal-200 dark:ring-teal-900 bg-teal-50/40 dark:bg-teal-950/40'
    : isContract ? 'ring-amber-200 dark:ring-amber-900 bg-amber-50/40 dark:bg-amber-950/40'
    : isAttach ? 'ring-violet-200 dark:ring-violet-900 bg-violet-50/40 dark:bg-violet-950/40'
    : 'ring-slate-100 dark:ring-slate-800 bg-slate-50/50 dark:bg-slate-900/50';

  return (
    <div className={cn('rounded-lg ring-1 px-3 py-2 text-[11px] space-y-1', specialBgRing)}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider', cls)}>
            {actionLabelMap[h.action] || h.action}
          </span>
          <span className="font-medium text-slate-700 dark:text-slate-300">{actorLabel}</span>
          {actionLabel && (
            <span className={cn('text-[10px] font-bold lowercase', actionLabelCls)}>
              {actionLabel}
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">{formatDateTime(h.createdAt)}</span>
      </div>
      {/* Diff — kontragent/shartnoma/ariza yoki kategoriya */}
      {isSpecial ? (
        hadOld && hasNew ? (
          <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
            <span className="line-through opacity-70">{renderSpecial(h.oldCategoryName)}</span>
            <span className="text-slate-400 dark:text-slate-500">→</span>
            {renderSpecial(h.newCategoryName)}
          </div>
        ) : hasNew ? (
          <div className="text-[11px]">{renderSpecial(h.newCategoryName)}</div>
        ) : (
          <div className="text-[11px] line-through opacity-70">{renderSpecial(h.oldCategoryName)}</div>
        )
      ) : (
        hadOld && hasNew ? (
          <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
            <span className="line-through text-rose-600/80 dark:text-rose-400/80">
              {renderCat(h.oldCategoryName, h.oldSubcategoryName)}
            </span>
            <span className="text-slate-400 dark:text-slate-500">→</span>
            <span className="text-emerald-700 dark:text-emerald-300">
              {renderCat(h.newCategoryName, h.newSubcategoryName)}
            </span>
          </div>
        ) : hasNew ? (
          <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
            {renderCat(h.newCategoryName, h.newSubcategoryName)}
          </div>
        ) : (
          <div className="text-[11px] text-rose-700 dark:text-rose-300 line-through">
            {renderCat(h.oldCategoryName, h.oldSubcategoryName)}
          </div>
        )
      )}
      {h.reason && (
        <div className="text-[10px] text-slate-500 dark:text-slate-400 italic">{h.reason}</div>
      )}
      {h.contractNumber && (
        <div className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400">{h.contractNumber}</div>
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
  const t = useTranslations('transactions');
  const hasValue = !!(value || chip || customValue);
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
      {/* Label (chap tomonda, sobit eni) */}
      <div className="w-28 shrink-0 pt-0.5">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1">
          {icon} {label}
        </div>
      </div>
      {/* Qiymat */}
      <div className="flex-1 min-w-0">
        {!hasValue && (
          <div className="text-[12px] text-slate-400 dark:text-slate-500 italic">{emptyText || '—'}</div>
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
          <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 break-words">{value}</div>
        )}
        {subValue && (
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 break-words">{subValue}</div>
        )}
      </div>
      {/* O'ng tomon: docNumber + clear */}
      <div className="flex items-center gap-1 shrink-0">
        {docNumber && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-700">
            <Receipt className="h-3 w-3" /> #{docNumber}
          </span>
        )}
        {showClear && (
          <button
            onClick={onClear}
            title={t('clearLabel')}
            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 dark:text-slate-500 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
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
    <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/80 dark:hover:bg-slate-800/80 transition-colors"
      >
        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <Hash className="h-3 w-3" /> {label}
        </div>
        <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 dark:text-slate-500 transition-transform shrink-0', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <code className="flex-1 min-w-0 font-mono text-[11px] text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 px-2 py-1 rounded ring-1 ring-slate-200 dark:ring-slate-700 break-all select-all">
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
  const t = useTranslations('transactions');
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(t('idCopied'));
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={copy}
      title={t('copyTxId', { value })}
      className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 text-slate-600 dark:text-slate-300 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
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
  const t = useTranslations('transactions');
  if (!display) {
    return canEdit ? (
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 ring-1 ring-dashed ring-slate-200 dark:ring-slate-700 hover:ring-indigo-300 dark:hover:ring-indigo-900 transition-colors"
      >
        {t('selectChip')}
      </button>
    ) : (
      <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>
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
      title={canEdit ? t('clickToChange') : display}
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
  const t = useTranslations('transactions');
  if (!category) {
    if (!placeholder) return <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>;
    return canEdit ? (
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 ring-1 ring-dashed ring-slate-200 dark:ring-slate-700 hover:ring-indigo-300 dark:hover:ring-indigo-900 transition-colors"
      >
        {placeholder}
      </button>
    ) : (
      <span className="text-[10px] text-slate-400 dark:text-slate-500">{placeholder}</span>
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
      title={canEdit ? t('clickToChange') : category.name}
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
  const t = useTranslations('transactions');
  const tc = useTranslations('common');
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
            <Wand2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> {t('selectCategory')}
          </DialogTitle>
          <DialogDescription>
            {t('selectCategoryDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('categorySearchPlaceholder')}
              className="pl-9 h-9"
            />
          </div>

          {/* Tree */}
          <div className="max-h-[400px] overflow-y-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
            {visible.length === 0 && (
              <div className="px-4 py-6 text-center text-[11px] text-slate-400 dark:text-slate-500 italic">
                {t('nothingFound')}
              </div>
            )}
            {visible.map((cat: any) => {
              const topSelected = selectedTopId === cat.id && !selectedSubId;
              const color = cat.color || '#64748b';
              const hasChildren = (cat.children || []).length > 0;
              return (
                <div key={cat.id}>
                  {/* Top kategoriya */}
                  <button
                    onClick={() => pickTop(cat)}
                    className={cn(
                      'w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors',
                      topSelected && 'bg-indigo-50 dark:bg-indigo-950/40',
                    )}
                    style={topSelected ? { backgroundColor: `${color}12` } : {}}
                  >
                    <span className="font-semibold text-[12px]" style={{ color: topSelected ? color : undefined }}>
                      {cat.name}
                    </span>
                    {topSelected && <CheckCircle2 className="h-3.5 w-3.5" style={{ color }} />}
                    {!hasChildren && !topSelected && (
                      <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">{t('selectChipShort')}</span>
                    )}
                  </button>
                  {/* Subkategoriyalar */}
                  {hasChildren && (cat.children || []).map((s: any) => {
                    const subSelected = selectedSubId === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => pickSub(cat, s)}
                        className={cn(
                          'w-full text-left pl-8 pr-3 py-1.5 flex items-center justify-between gap-2 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors',
                          subSelected && 'bg-indigo-50 dark:bg-indigo-950/40',
                        )}
                        style={subSelected ? { backgroundColor: `${color}12` } : {}}
                      >
                        <span className="text-slate-700 dark:text-slate-300" style={subSelected ? { color, fontWeight: 600 } : {}}>
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
              <div className="rounded-lg p-2 ring-1 ring-indigo-200 dark:ring-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/40 text-[11px]">
                <span className="text-slate-500 dark:text-slate-400">{t('selectedLabel')}: </span>
                <span className="font-semibold" style={{ color }}>{top?.name}</span>
                {sub && (
                  <>
                    <span className="text-slate-400 dark:text-slate-500 mx-1">/</span>
                    <span className="font-semibold" style={{ color }}>{sub.name}</span>
                  </>
                )}
              </div>
            );
          })()}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => onSave(null, null)}
              disabled={saving}
              className="text-[12px] text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium"
            >
              {tc('clear')}
            </button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
                {tc('cancel')}
              </Button>
              <Button
                size="sm"
                onClick={() => onSave(selectedTopId, selectedSubId)}
                disabled={saving || !selectedTopId}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : tc('save')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════
//  TODAY STATS INLINE — bugungi tranzaksiyalar mini-paneli
//  AI Sparkles dropdown ichida ko'rsatiladi (gradient karta)
// ════════════════════════════════════════════════════
function TodayStatsInline() {
  const t = useTranslations('transactions');
  const today = new Date();
  // Tashkent vaqti
  const tashkentToday = new Date(today.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Tab tanlash — 'umumiy' yoki 'debetorka'
  const [activeTab, setActiveTab] = useState<'umumiy' | 'debetorka'>('umumiy');

  // Umumiy statistika
  const { data, isLoading } = useQuery<any>({
    queryKey: ['today-stats-inline', tashkentToday],
    queryFn: () => api.get(`/transactions/stats?from=${tashkentToday}&to=${tashkentToday}`),
    staleTime: 30_000,
  });
  // Debetorka — uy uchun to'lov (CLIENT kategoriya)
  const { data: clientData, isLoading: clientLoading } = useQuery<any>({
    queryKey: ['today-stats-client-inline', tashkentToday],
    queryFn: () => api.get(`/transactions/stats?from=${tashkentToday}&to=${tashkentToday}&categoryCode=CLIENT`),
    staleTime: 30_000,
    enabled: activeTab === 'debetorka',
  });

  const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n));

  const inflow = data?.groups?.find?.((g: any) => g.direction === 'IN');
  const outflow = data?.groups?.find?.((g: any) => g.direction === 'OUT');
  const inCount = Number(inflow?._count?._all || inflow?._count || 0);
  const outCount = Number(outflow?._count?._all || outflow?._count || 0);
  const inSum = Number(inflow?._sum?.amount || 0);
  const outSum = Number(outflow?._sum?.amount || 0);
  const total = inCount + outCount;

  // Debetorka — CLIENT kategoriya (kirim + chiqim alohida)
  const debInflow = clientData?.groups?.find?.((g: any) => g.direction === 'IN');
  const debOutflow = clientData?.groups?.find?.((g: any) => g.direction === 'OUT');
  const debInCount = Number(debInflow?._count?._all || debInflow?._count || 0);
  const debOutCount = Number(debOutflow?._count?._all || debOutflow?._count || 0);
  const debInSum = Number(debInflow?._sum?.amount || 0);
  const debOutSum = Number(debOutflow?._sum?.amount || 0);
  const debTotal = debInCount + debOutCount;

  // Bugungi sana — chiroyli format
  const dateLabel = new Date(tashkentToday + 'T12:00:00').toLocaleDateString('uz-UZ', {
    day: '2-digit', month: 'long', weekday: 'short',
  });

  return (
    <div className="space-y-2.5">
      {/* Header: sana + tx soni */}
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] text-white/90 font-medium">{dateLabel}</div>
        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/25 backdrop-blur-sm ring-1 ring-white/30">
          <Activity className="h-2.5 w-2.5" />
          <span className="text-[10px] font-bold tabular-nums">
            {fmt(activeTab === 'debetorka' ? debTotal : total)} {t('txShort')}
          </span>
        </div>
      </div>

      {/* TAB SWITCHER */}
      <div className="flex items-center gap-1 p-0.5 bg-white/15 backdrop-blur-sm rounded-lg ring-1 ring-white/20">
        <button
          onClick={() => setActiveTab('umumiy')}
          className={cn(
            'flex-1 px-2 py-1.5 rounded-md text-[10.5px] font-bold uppercase tracking-wider transition-all',
            activeTab === 'umumiy'
              ? 'bg-white text-violet-700 shadow-md'
              : 'text-white/80 hover:text-white hover:bg-white/10',
          )}
        >
          {t('tabGeneral')}
        </button>
        <button
          onClick={() => setActiveTab('debetorka')}
          className={cn(
            'flex-1 px-2 py-1.5 rounded-md text-[10.5px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1',
            activeTab === 'debetorka'
              ? 'bg-white text-amber-700 shadow-md'
              : 'text-white/80 hover:text-white hover:bg-white/10',
          )}
        >
          <Briefcase className="h-2.5 w-2.5" />
          {t('tabDebtors')}
        </button>
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'umumiy' ? (
        isLoading ? (
          <div className="grid grid-cols-2 gap-1.5">
            {[0,1].map(i => <div key={i} className="h-20 rounded-xl bg-white/10 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-xl bg-gradient-to-br from-emerald-500/35 to-teal-600/25 backdrop-blur-sm ring-1 ring-emerald-300/40 p-2.5 shadow-sm">
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-white/95">
                <ArrowDownLeft className="h-3 w-3" /> {t('dirIn')}
              </div>
              <div className="text-[15px] font-bold tabular-nums leading-tight mt-1">{fmt(inSum)}</div>
              <div className="text-[9.5px] text-white/80 mt-0.5 font-mono">{t('countSuffix', { n: fmt(inCount) })}</div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-rose-500/35 to-pink-600/25 backdrop-blur-sm ring-1 ring-rose-300/40 p-2.5 shadow-sm">
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-white/95">
                <ArrowUpRight className="h-3 w-3" /> {t('dirOut')}
              </div>
              <div className="text-[15px] font-bold tabular-nums leading-tight mt-1">{fmt(outSum)}</div>
              <div className="text-[9.5px] text-white/80 mt-0.5 font-mono">{t('countSuffix', { n: fmt(outCount) })}</div>
            </div>
          </div>
        )
      ) : (
        // DEBETORKA TAB
        clientLoading ? (
          <div className="space-y-1.5">
            <div className="h-20 rounded-xl bg-white/10 animate-pulse" />
            <div className="grid grid-cols-2 gap-1.5">
              {[0,1].map(i => <div key={i} className="h-14 rounded-xl bg-white/10 animate-pulse" />)}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* Asosiy katta karta — Kirim (uy to'lovi) */}
            <div className="rounded-xl bg-gradient-to-br from-amber-400/40 to-orange-500/30 backdrop-blur-sm ring-1 ring-amber-300/50 p-3 shadow-sm">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-7 h-7 rounded-lg bg-amber-300/50 grid place-items-center ring-1 ring-white/20">
                  <Briefcase className="h-3.5 w-3.5" />
                </div>
                <div className="text-[9.5px] uppercase tracking-wider font-bold text-white/95">
                  {t('homePaymentClient')}
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-[18px] font-bold tabular-nums leading-tight">{fmt(debInSum)}</span>
                <span className="text-[10px] text-white/80 font-mono">UZS</span>
              </div>
              <div className="text-[10px] text-white/75 mt-0.5">{t('txCountSuffix', { n: fmt(debInCount) })}</div>
            </div>

            {/* Pastda: chiqim (qaytarish) ham bo'lsa ko'rsatish */}
            {debOutCount > 0 && (
              <div className="rounded-xl bg-gradient-to-br from-rose-500/30 to-pink-600/20 backdrop-blur-sm ring-1 ring-rose-300/40 p-2.5 flex items-center gap-2">
                <ArrowUpRight className="h-3.5 w-3.5 text-white/90 shrink-0" />
                <div className="flex-1 text-[10px]">
                  <div className="text-white/85 uppercase tracking-wider font-bold text-[9px]">{t('refund')}</div>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-[13px] font-bold tabular-nums">{fmt(debOutSum)}</span>
                    <span className="text-white/70 font-mono">· {t('countSuffix', { n: fmt(debOutCount) })}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Foiz — debetorka umumiy kirimning qancha qismi */}
            {inSum > 0 && (
              <div className="text-[9.5px] text-white/75 text-center pt-0.5">
                {t.rich('todayIncomePercent', {
                  pct: Math.round((debInSum / inSum) * 100),
                  b: (chunks) => <b className="text-white/95">{chunks}</b>,
                })}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//   SchotchikBackfillDialog — счётчик to'lovlarini qayta tasniflash
// ═══════════════════════════════════════════════════════════════

type SchotchikResult = {
  ok: boolean;
  dryRun: boolean;
  dateFrom: string;
  dateTo: string;
  stats: {
    scanned: number;
    matched: number;
    alreadyCorrect: number;
    needsUpdate: number;
    affectedContracts: number;
    otherRowsToReset: number;
    transactionsUpdated?: number;
    oplataKvUpdated?: number;
    otherRowsResetted?: number;
  };
  groupByCurrent: Array<{ name: string; count: number }>;
  samples: Array<{
    id: string;
    date: string;
    amount: number;
    direction: string;
    description: string;
    currentSubcategory: string | null;
  }>;
};

function SchotchikBackfillDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<'preview' | 'applying' | 'done'>('preview');
  const [result, setResult] = useState<SchotchikResult | null>(null);
  const [authed, setAuthed] = useState(false);           // parol (7779) kiritilganmi
  const [tab, setTab] = useState<'backfill' | 'monthly'>('backfill');

  // Dry-run query — modal ochilgach avtomatik chaqiriladi
  const dryRunQuery = useQuery({
    queryKey: ['schotchik-backfill-dryrun'],
    queryFn: () => api.post<SchotchikResult>('/categorization/backfill-schotchik', { dryRun: true }),
    enabled: open && authed && tab === 'backfill' && stage === 'preview',
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  // Apply mutation
  const applyMut = useMutation({
    mutationFn: () => api.post<SchotchikResult>('/categorization/backfill-schotchik', { dryRun: false }),
    onSuccess: (r) => {
      setResult(r);
      setStage('done');
      toast.success(`${r.stats.transactionsUpdated || 0} ta tranzaksiya yangilandi`);
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (e: any) => {
      toast.error(e?.message || 'Xato');
      setStage('preview');
    },
  });

  // Modal yopilganda holatni reset qilamiz
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStage('preview');
        setResult(null);
        setAuthed(false);
        setTab('backfill');
      }, 300);
    }
  }, [open]);

  const data = result || dryRunQuery.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-950/40 dark:to-blue-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 grid place-items-center shadow-md shrink-0">
              <Gauge className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Schotchik tranzaksiyalarini qayta tasniflash
              </DialogTitle>
              <DialogDescription className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                Счётчик / hisoblagich to'lovlari avval noto'g'ri "Взносы за квартиры" ga tushgan — endi to'g'rilaymiz.
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Parol gate (7779) — kirish uchun */}
        {!authed ? (
          <SchotchikPasswordGate onOk={() => setAuthed(true)} />
        ) : (
        <>
          {/* Sub-tablar */}
          <div className="px-6 pt-3 flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-800">
            <SchotchikTabBtn active={tab === 'backfill'} onClick={() => setTab('backfill')}>Qayta tasniflash</SchotchikTabBtn>
            <SchotchikTabBtn active={tab === 'monthly'} onClick={() => setTab('monthly')}>Счётчик → Ежемесячный</SchotchikTabBtn>
          </div>

          {tab === 'monthly' ? (
            <SchotchikMonthlyPanel onClose={() => onOpenChange(false)} />
          ) : (
          <>
        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {dryRunQuery.isLoading && (
            <div className="py-12 text-center text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-cyan-500" />
              <div className="text-[13px]">Tahlil qilinmoqda...</div>
            </div>
          )}

          {dryRunQuery.error && (
            <div className="py-8 text-center">
              <AlertCircle className="h-8 w-8 text-rose-500 mx-auto mb-2" />
              <div className="text-[13px] text-rose-700 dark:text-rose-300">
                Xato: {(dryRunQuery.error as any)?.message || 'Tahlil bajarib bo\'lmadi'}
              </div>
            </div>
          )}

          {data && (
            <>
              {/* Date range info */}
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2 flex items-center gap-2 text-[12px]">
                <Calendar className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-slate-600 dark:text-slate-400">Tekshirilgan sana oralig'i:</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                  {data.dateFrom} → {data.dateTo}
                </span>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <BackfillStatCard label="Topildi" value={data.stats.matched} color="indigo" />
                <BackfillStatCard label="Allaqachon to'g'ri" value={data.stats.alreadyCorrect} color="emerald" />
                <BackfillStatCard
                  label={data.dryRun ? "Yangilash kerak" : "Yangilandi"}
                  value={data.dryRun ? data.stats.needsUpdate : (data.stats.transactionsUpdated ?? data.stats.needsUpdate)}
                  color="amber"
                  highlight
                />
                <BackfillStatCard label="Affected kontrakt" value={data.stats.affectedContracts} color="violet" />
              </div>

              {/* Apply result (after apply) */}
              {stage === 'done' && data.stats.transactionsUpdated !== undefined && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 p-3 space-y-1.5 text-[12.5px]">
                  <div className="flex items-center gap-2 font-bold text-emerald-900 dark:text-emerald-300 mb-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    Yangilash muvaffaqiyatli bajarildi
                  </div>
                  <div className="flex justify-between text-emerald-800 dark:text-emerald-300">
                    <span>Transactions yangilandi:</span>
                    <span className="font-bold tabular-nums">{data.stats.transactionsUpdated} ta</span>
                  </div>
                  <div className="flex justify-between text-emerald-800 dark:text-emerald-300">
                    <span>OplataKv qatorlar yangilandi:</span>
                    <span className="font-bold tabular-nums">{data.stats.oplataKvUpdated ?? 0} ta</span>
                  </div>
                  <div className="flex justify-between text-emerald-800 dark:text-emerald-300">
                    <span>Boshqa qatorlar (split reset):</span>
                    <span className="font-bold tabular-nums">{data.stats.otherRowsResetted ?? 0} ta</span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-900 text-[11.5px] text-emerald-700 dark:text-emerald-400">
                    💡 Endi admin paneldan <strong>"Barcha hisoblar — orqa sanaga sync"</strong> tugmasini bosing yoki kuting — splitInstallments cron qayta hisoblaydi.
                  </div>
                </div>
              )}

              {/* Group by current category */}
              {data.groupByCurrent.length > 0 && stage === 'preview' && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400 mb-2">
                    Hozirgi kategoriyalar bo'yicha
                  </div>
                  <div className="space-y-1.5">
                    {data.groupByCurrent.map((g, i) => (
                      <div key={i} className="flex items-center justify-between text-[12.5px] px-3 py-1.5 rounded-md bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800">
                        <span className="text-slate-700 dark:text-slate-300 truncate flex-1">
                          {g.name}
                        </span>
                        <ArrowUpRight className="h-3 w-3 mx-2 text-slate-400 shrink-0" />
                        <span className="text-cyan-700 dark:text-cyan-300 font-semibold shrink-0">
                          За счетчик
                        </span>
                        <span className="ml-3 font-bold tabular-nums text-slate-800 dark:text-slate-200 shrink-0">
                          {g.count.toLocaleString('ru-RU')} ta
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Samples */}
              {data.samples.length > 0 && stage === 'preview' && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400 mb-2">
                    Namuna (eng yangi {Math.min(10, data.samples.length)} ta)
                  </div>
                  <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                    {data.samples.map((s, i) => (
                      <div key={i} className="rounded-md bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 px-3 py-2">
                        <div className="flex items-center justify-between text-[11.5px] mb-1">
                          <span className="font-mono text-slate-500 dark:text-slate-400">{s.date}</span>
                          <span className={cn(
                            'font-bold tabular-nums',
                            s.direction === 'IN' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
                          )}>
                            {s.direction === 'IN' ? '+' : '−'}{formatMoney(Math.abs(s.amount), '')} UZS
                          </span>
                        </div>
                        <div className="text-[12px] text-slate-700 dark:text-slate-300 truncate" title={s.description}>
                          {s.description}
                        </div>
                        <div className="text-[10.5px] text-slate-500 mt-1">
                          {s.currentSubcategory || '(kategoriyasiz)'} → <span className="text-cyan-600 dark:text-cyan-400 font-semibold">За счетчик</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Info box (preview only) */}
              {stage === 'preview' && data.stats.needsUpdate > 0 && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 p-3 text-[12px] text-amber-900 dark:text-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold mb-1">Tasdiqlasangiz quyidagilar bajariladi:</div>
                      <ul className="space-y-0.5 list-disc pl-4 text-[11.5px]">
                        <li><strong>{data.stats.needsUpdate}</strong> ta tranzaksiya — kategoriya "За счетчик" ga ko'chiriladi</li>
                        <li><strong>{data.stats.affectedContracts}</strong> ta kontrakt ta'sirlanadi</li>
                        <li><strong>{data.stats.otherRowsToReset}</strong> ta boshqa OplataKv qator split reset bo'ladi (re-hisob uchun)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* No changes needed */}
              {stage === 'preview' && data.stats.needsUpdate === 0 && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 p-3 text-[12.5px] text-emerald-900 dark:text-emerald-300 text-center">
                  <CheckCircle2 className="h-5 w-5 mx-auto mb-1.5" />
                  <div className="font-bold">Hech narsa yangilash shart emas</div>
                  <div className="text-[11.5px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                    Barcha schotchik tranzaksiyalari allaqachon to'g'ri kategoriyada
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {stage === 'done' ? 'Yopish' : 'Bekor qilish'}
          </Button>
          {stage === 'preview' && data && data.stats.needsUpdate > 0 && (
            <Button
              onClick={() => {
                setStage('applying');
                applyMut.mutate();
              }}
              disabled={applyMut.isPending || dryRunQuery.isLoading}
              className="bg-gradient-to-br from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-md gap-1.5"
            >
              {applyMut.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Yangilanmoqda...</>
                : <><CheckCircle2 className="h-4 w-4" /> Tasdiqlayman, yangila ({data.stats.needsUpdate} ta)</>}
            </Button>
          )}
        </DialogFooter>
          </>
          )}
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Parol gate (7779) ───
function SchotchikPasswordGate({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(false);
  const submit = () => {
    if (pw.trim() === '7779') { onOk(); }
    else { setErr(true); setTimeout(() => setErr(false), 600); }
  };
  return (
    <div className="px-6 py-10">
      <div className="max-w-xs mx-auto text-center">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 grid place-items-center mx-auto mb-3 shadow-md">
          <Lock className="h-5 w-5 text-white" />
        </div>
        <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 mb-1">Parol kiriting</div>
        <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mb-4">Bu bo'limga kirish uchun parol talab qilinadi</div>
        <input
          type="password" value={pw} autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="••••"
          className={cn('w-full h-11 text-center text-lg tracking-[0.3em] rounded-xl border bg-white dark:bg-slate-800 outline-none transition-all',
            err ? 'border-rose-400 ring-2 ring-rose-300 animate-shake' : 'border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-cyan-400')}
        />
        {err && <div className="text-[11px] text-rose-500 mt-1.5">Parol xato</div>}
        <button onClick={submit}
          className="mt-4 w-full h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-semibold text-[13px] shadow-md transition-all">
          Kirish
        </button>
      </div>
    </div>
  );
}

function SchotchikTabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn('px-3 py-2 text-[12.5px] font-semibold border-b-2 -mb-px transition-colors',
        active ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200')}>
      {children}
    </button>
  );
}

// ─── Счётчик → Ежемесячный (ОплатыКв split override) ───
type SchToMonthly = {
  ok: boolean; dryRun: boolean; dateFrom: string; total: number; needsUpdate: number; updated: number;
  samples: Array<{ contractNo: string; date: string; amount: number; object: string | null; client: string | null }>;
};
type SchConfig = { enabled: boolean; dateFrom: string | null; dayStart: string; dayEnd: string; intervalMin: number };

function SchotchikMonthlyPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [dateFrom, setDateFrom] = useState('');
  const [preview, setPreview] = useState<SchToMonthly | null>(null);
  const [cfg, setCfg] = useState<SchConfig>({ enabled: false, dateFrom: null, dayStart: '08:00', dayEnd: '22:00', intervalMin: 30 });

  useQuery({
    queryKey: ['schotchik-config'],
    queryFn: async () => {
      const c = await api.get<SchConfig>('/oplata-kv/schotchik-config');
      setCfg(c);
      if (c.dateFrom) setDateFrom((d) => d || c.dateFrom || '');
      return c;
    },
    refetchOnWindowFocus: false,
  });

  const dryMut = useMutation({
    mutationFn: () => api.post<SchToMonthly>('/oplata-kv/schotchik-to-monthly', { dateFrom: dateFrom || undefined, dryRun: true }),
    onSuccess: (r) => setPreview(r),
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });
  const applyMut = useMutation({
    mutationFn: () => api.post<SchToMonthly>('/oplata-kv/schotchik-to-monthly', { dateFrom: dateFrom || undefined, dryRun: false }),
    onSuccess: (r) => { setPreview(r); toast.success(`${r.updated} qator oylikka o'tkazildi`); qc.invalidateQueries({ queryKey: ['transactions'] }); },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });
  const saveCfgMut = useMutation({
    mutationFn: () => api.post<SchConfig>('/oplata-kv/schotchik-config', { ...cfg, dateFrom: dateFrom || cfg.dateFrom }),
    onSuccess: (c) => { setCfg(c); toast.success('Avto-rejim saqlandi'); },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  return (
    <div className="px-6 py-5 space-y-4">
      <div className="rounded-lg bg-cyan-50 dark:bg-cyan-950/30 ring-1 ring-cyan-200 dark:ring-cyan-900 p-3 text-[12px] text-cyan-900 dark:text-cyan-200">
        <strong>Тип = «За счетчик»</strong> to'lovlarini (tanlangan sanadan ≥) <strong>oylikka</strong> o'tkazadi:
        Сумма оплаты → Ежемесячный, Оплата → Ежемесячный. Faqat ОплатыКв o'zgaradi (tranzaksiya tegilmaydi).
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Sanadan (≥)</label>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPreview(null); }}
            className="h-9 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px]" />
        </div>
        <button onClick={() => dryMut.mutate()} disabled={dryMut.isPending}
          className="h-9 px-4 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-[12.5px] inline-flex items-center gap-1.5">
          {dryMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Tekshirish
        </button>
      </div>

      {preview && (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <BackfillStatCard label="Jami «За счетчик»" value={preview.total} color="indigo" />
            <BackfillStatCard label={preview.dryRun ? 'Yangilash kerak' : 'Yangilandi'} value={preview.dryRun ? preview.needsUpdate : preview.updated} color="amber" highlight />
            <BackfillStatCard label="Namuna" value={preview.samples.length} color="violet" />
          </div>
          {preview.samples.length > 0 && (
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {preview.samples.map((s, i) => (
                <div key={i} className="rounded-md bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 px-3 py-1.5 flex items-center justify-between text-[11.5px] gap-2">
                  <span className="font-mono text-slate-500 shrink-0">{s.date}</span>
                  <span className="truncate flex-1 text-slate-600 dark:text-slate-300">{s.object || '—'} · {s.contractNo}</span>
                  <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">{Math.round(s.amount).toLocaleString('ru-RU')}</span>
                </div>
              ))}
            </div>
          )}
          {preview.dryRun && preview.needsUpdate > 0 && (
            <button onClick={() => applyMut.mutate()} disabled={applyMut.isPending}
              className="w-full h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-semibold text-[13px] inline-flex items-center justify-center gap-1.5 shadow-md">
              {applyMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Bajarilmoqda...</> : <><CheckCircle2 className="h-4 w-4" /> Qo'llash ({preview.needsUpdate} ta)</>}
            </button>
          )}
          {!preview.dryRun && (
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 p-2.5 text-[12px] text-center text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 mx-auto mb-1" /> {preview.updated} qator oylikka o'tkazildi
            </div>
          )}
          {preview.dryRun && preview.needsUpdate === 0 && (
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 p-2.5 text-[12px] text-center text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 mx-auto mb-1" /> Hammasi allaqachon oylikda
            </div>
          )}
        </>
      )}

      {/* Avto-rejim */}
      <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> Avtomatik rejim</div>
          <button onClick={() => setCfg((c) => ({ ...c, enabled: !c.enabled }))}
            className={cn('relative w-11 h-6 rounded-full transition-colors', cfg.enabled ? 'bg-cyan-500' : 'bg-slate-300 dark:bg-slate-600')}>
            <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', cfg.enabled && 'translate-x-5')} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1">Kundan</label>
            <input type="time" value={cfg.dayStart} onChange={(e) => setCfg((c) => ({ ...c, dayStart: e.target.value }))} className="w-full h-8 px-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12px]" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1">Kungacha</label>
            <input type="time" value={cfg.dayEnd} onChange={(e) => setCfg((c) => ({ ...c, dayEnd: e.target.value }))} className="w-full h-8 px-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12px]" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1">Har (daq)</label>
            <input type="number" min={1} value={cfg.intervalMin} onChange={(e) => setCfg((c) => ({ ...c, intervalMin: Number(e.target.value) || 30 }))} className="w-full h-8 px-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12px]" />
          </div>
        </div>
        <div className="text-[10.5px] text-slate-400">Sana ≥ <strong>{dateFrom || cfg.dateFrom || '—'}</strong> (yuqoridagi sana). Belgilangan vaqt oralig'ida har {cfg.intervalMin} daqiqada avtomatik ishlaydi.</div>
        <button onClick={() => saveCfgMut.mutate()} disabled={saveCfgMut.isPending}
          className="w-full h-9 rounded-lg bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 text-white font-semibold text-[12.5px] inline-flex items-center justify-center gap-1.5">
          {saveCfgMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Avto-rejimni saqlash
        </button>
      </div>

      <div className="flex justify-end pt-1">
        <Button variant="outline" onClick={onClose}>Yopish</Button>
      </div>
    </div>
  );
}

function BackfillStatCard({ label, value, color, highlight }: { label: string; value: number; color: string; highlight?: boolean }) {
  const colors: Record<string, string> = {
    indigo:  'bg-indigo-50 dark:bg-indigo-950/40 ring-indigo-200 dark:ring-indigo-900 text-indigo-900 dark:text-indigo-300',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-900 dark:text-emerald-300',
    amber:   'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900 text-amber-900 dark:text-amber-300',
    violet:  'bg-violet-50 dark:bg-violet-950/40 ring-violet-200 dark:ring-violet-900 text-violet-900 dark:text-violet-300',
  };
  return (
    <div className={cn(
      'rounded-lg ring-1 p-3',
      colors[color] || colors.indigo,
      highlight && 'ring-2',
    )}>
      <div className="text-[9px] uppercase tracking-wider font-bold opacity-70 mb-0.5">{label}</div>
      <div className="text-[18px] font-black tabular-nums">{value.toLocaleString('ru-RU')}</div>
    </div>
  );
}
