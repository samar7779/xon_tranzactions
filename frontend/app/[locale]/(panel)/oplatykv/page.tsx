'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Plus, Edit3, Trash2, History, X, ChevronLeft, ChevronRight,
  Calendar, Loader2, Hash, ArrowUpRight, Filter as FilterIcon,
  Receipt, User2, Home, CreditCard, FileText, Tag as TagIcon, Activity,
  Copy, Check, Download, FileSpreadsheet, FileJson, Printer,
  FileCheck2, ChevronDown, GitCompareArrows, ArrowLeft,
  CheckCircle2, AlertTriangle, Lock, Upload, ArrowRightLeft,
  PlusCircle, Paperclip, Wallet, Building2, Box, BarChart3, RefreshCw,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { PurposeInfoButton } from '@/components/purpose-modal';
import { SyncProgressDialog } from '@/components/sync-progress-dialog';

const Apartment3DDialog = dynamic(
  () => import('@/components/apartment-3d-view').then((m) => m.Apartment3DDialog),
  { ssr: false },
);
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/skeleton';
import { api, apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatMoney } from '@/lib/utils';

type Category = 'MONTHLY' | 'FIRST' | 'GENERAL';

interface OplataKvItem {
  id: string;
  contractNo: string;
  date: string;
  paymentAmount: string | null;
  firstInstallment: string | null;
  monthlyAmount: string | null;
  purpose: string | null;
  txType: string | null;
  note: string | null;
  paymentCategory: Category | null;
  object: string | null;
  client: string | null;
  paymentMethod: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  importBatchId?: string | null;
  sourceTxId?: string | null;
  crmXato?: boolean;
  contractSource?: 'manual' | 'ariza' | null;  // Tranzaksiyada qanday qo'yilgan
  perereboskaGroupId?: string | null;
  perereboskaFileName?: string | null;
  wasManuallyEdited?: boolean;
}

// Manba (qaysi yo'l bilan qo'shilgan) — manual / excel / transaction
// wasManuallyEdited=true bo'lsa "qo'lda" badge ko'rsatamiz (manba nima bo'lishidan qat'iy nazar).
function getSource(it: OplataKvItem): 'manual' | 'excel' | 'transaction' {
  if (it.wasManuallyEdited) return 'manual';
  if (it.sourceTxId) return 'transaction';
  if (it.importBatchId) return 'excel';
  return 'manual';
}

// Manba badge matni — 'excel' texnik nom, qolganlari t() orqali tarjima qilinadi
const SOURCE_LABEL_KEY: Record<string, string | null> = {
  manual:      'sourceManual',
  excel:       null, // 'Excel' — texnik nom, tarjima qilinmaydi
  transaction: 'sourceTransaction',
};
const SOURCE_CLS: Record<string, string> = {
  manual:      'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
  excel:       'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-900',
  transaction: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900',
};

const CATEGORY_LABEL: Record<Category, string> = {
  MONTHLY: 'ежемесячный',
  FIRST:   '1 взнос',
  GENERAL: 'Общий',
};

const CATEGORY_CLS: Record<Category, string> = {
  MONTHLY: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-sky-200 dark:ring-sky-900',
  FIRST:   'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900',
  GENERAL: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-900',
};

// dd.mm.yyyy formatda chiqarish
function fmtDateRu(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()} ${hh}:${mn}`;
}

function fmtNum(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  if (!isFinite(n) || n === 0) return n === 0 ? '0' : '—';
  return formatMoney(n);
}

function amountCls(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'text-slate-400 dark:text-slate-500';
  const n = typeof v === 'string' ? Number(v) : v;
  if (!isFinite(n) || n === 0) return 'text-slate-400 dark:text-slate-500';
  return n > 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-rose-600 dark:text-rose-400 font-semibold';
}

export default function OplataKvPage() {
  const t = useTranslations('oplatykv');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  // Granular permissions — har bir action faqat aniq permission'ga bog'liq.
  // Legacy OPLATAKV_MANAGE fallback YO'Q (rolda boshqa ruxsatni olib tashlasa,
  // legacy MANAGE yashirin ravishda icon'ni tirik qoldirib qo'ymasligi uchun).
  const canCreate = !!user?.permissions?.includes(PERMS.OPLATAKV_CREATE);
  const canEdit = !!user?.permissions?.includes(PERMS.OPLATAKV_EDIT);
  const canDelete = !!user?.permissions?.includes(PERMS.OPLATAKV_DELETE);
  const canImport = !!user?.permissions?.includes(PERMS.OPLATAKV_IMPORT);
  const canSplit = !!user?.permissions?.includes(PERMS.OPLATAKV_SPLIT);
  const canManage = !!user?.permissions?.includes(PERMS.OPLATAKV_MANAGE);

  // Filters — URL query + localStorage orqali persist qilinadi (refresh'da yo'qolmaydi)
  const [q, setQ] = useState(() => {
    if (typeof window === 'undefined') return '';
    const fromUrl = new URLSearchParams(window.location.search).get('q');
    if (fromUrl) return fromUrl;
    try { return localStorage.getItem('oplatykv-q-v1') || ''; } catch { return ''; }
  });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  // Mount paytida sana filtrlarini localStorage'dan tiklash
  useEffect(() => {
    try {
      const df = localStorage.getItem('oplatykv-dateFrom-v1');
      const dt = localStorage.getItem('oplatykv-dateTo-v1');
      if (df) setDateFrom(df);
      if (dt) setDateTo(dt);
    } catch { /* ignore */ }
  }, []);

  // q o'zgarganda URL'ni va localStorage'ni yangilash
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');
    window.history.replaceState({}, '', url.toString());
    try {
      if (q) localStorage.setItem('oplatykv-q-v1', q);
      else localStorage.removeItem('oplatykv-q-v1');
    } catch { /* ignore */ }
  }, [q]);

  // Sana filtrlarini localStorage'ga yozish
  useEffect(() => {
    try {
      if (dateFrom) localStorage.setItem('oplatykv-dateFrom-v1', dateFrom);
      else localStorage.removeItem('oplatykv-dateFrom-v1');
    } catch { /* ignore */ }
  }, [dateFrom]);
  useEffect(() => {
    try {
      if (dateTo) localStorage.setItem('oplatykv-dateTo-v1', dateTo);
      else localStorage.removeItem('oplatykv-dateTo-v1');
    } catch { /* ignore */ }
  }, [dateTo]);

  // Dialog state
  const [detailRow, setDetailRow] = useState<OplataKvItem | null>(null);
  const [editRow, setEditRow] = useState<OplataKvItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [addChoiceOpen, setAddChoiceOpen] = useState(false);
  const [perereboskaOpen, setPerereboskaOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<OplataKvItem | null>(null);
  const [historyRow, setHistoryRow] = useState<OplataKvItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [aktSverkaOpen, setAktSverkaOpen] = useState(false);

  // Per-column filter (Google Sheets style)
  const [columnFilterMode, setColumnFilterMode] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);
  // Summa filtrlari — paymentAmount / firstInstallment / monthlyAmount, har biri exact/range
  const [amountFilters, setAmountFilters] = useState<Record<string, AmountFilterValue>>({});

  // localStorage'dan tiklash
  useEffect(() => {
    try {
      const raw = localStorage.getItem('oplatykv-column-filters-v1');
      if (raw) {
        const obj = JSON.parse(raw);
        const restored: Record<string, Set<string>> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (Array.isArray(v) && v.length > 0) restored[k] = new Set(v as string[]);
        }
        if (Object.keys(restored).length > 0) {
          setColumnFilters(restored);
          setColumnFilterMode(true);
        }
      }
      const rawMode = localStorage.getItem('oplatykv-filter-mode-v1');
      if (rawMode === '1') setColumnFilterMode(true);
    } catch { /* ignore */ }
  }, []);

  // localStorage'ga saqlash
  useEffect(() => {
    try {
      const obj: Record<string, string[]> = {};
      for (const k of Object.keys(columnFilters)) {
        if (columnFilters[k]?.size > 0) obj[k] = Array.from(columnFilters[k]);
      }
      if (Object.keys(obj).length > 0) {
        localStorage.setItem('oplatykv-column-filters-v1', JSON.stringify(obj));
      } else {
        localStorage.removeItem('oplatykv-column-filters-v1');
      }
    } catch { /* ignore */ }
  }, [columnFilters]);

  useEffect(() => {
    try {
      if (columnFilterMode) localStorage.setItem('oplatykv-filter-mode-v1', '1');
      else localStorage.removeItem('oplatykv-filter-mode-v1');
    } catch { /* ignore */ }
  }, [columnFilterMode]);

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      toast.success(t('idCopied', { id: `${id.slice(0, 12)}…` }));
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    } catch {
      toast.error(tc('copyError'));
    }
  };

  const [exporting, setExporting] = useState<null | 'xlsx' | 'json' | 'pdf'>(null);

  const downloadExcel = async () => {
    setExporting('xlsx');
    try {
      const ts = new Date().toISOString().slice(0, 10);
      await apiDownload(`/oplata-kv/export?${qsForExport}`, `oplaty-kv-${ts}.xlsx`);
      toast.success(t('excelDownloaded'));
    } catch (e: any) {
      toast.error(e?.message || t('excelDownloadError'));
    } finally {
      setExporting(null);
    }
  };

  const downloadJson = async () => {
    setExporting('json');
    try {
      const ts = new Date().toISOString().slice(0, 10);
      await apiDownload(`/oplata-kv/export-json?${qsForExport}`, `oplaty-kv-${ts}.json`);
      toast.success(t('jsonDownloaded'));
    } catch (e: any) {
      toast.error(e?.message || t('jsonDownloadError'));
    } finally {
      setExporting(null);
    }
  };

  const printPdf = () => {
    // Brauzer print dialogi (foydalanuvchi "Saqlash PDF" tanlashi mumkin)
    setExporting('pdf');
    setTimeout(() => {
      window.print();
      setExporting(null);
    }, 100);
  };

  // Column → DTO param nomi
  const COLUMN_TO_PARAM: Record<string, string> = {
    contractNo:      'contractNos',
    paymentCategory: 'paymentCategories',
    client:          'clients',
    object:          'objects',
    paymentMethod:   'paymentMethods',
    txType:          'txTypes',
    source:          'sources',
  };

  // columnFilters Set object — JSON serialization uchun
  const columnFiltersKey = JSON.stringify(
    Object.fromEntries(
      Object.entries(columnFilters).map(([k, v]) => [k, Array.from(v).sort()]),
    ),
  );

  // URL params for list query
  // Helper: contractNo filter ichida "XATO" tanlangan bo'lsa — xatoOnly=true qilib yuborish
  // (boshqa contractNo qiymatlar saqlanadi; faqat XATO qayta tarjima qilinadi)
  const applyXatoToParams = (p: URLSearchParams) => {
    const cnSet = columnFilters['contractNo'];
    if (cnSet && cnSet.has('XATO')) {
      p.set('xatoOnly', 'true');
      const rest = Array.from(cnSet).filter((v) => v !== 'XATO');
      if (rest.length > 0) p.set('contractNos', rest.join(','));
      else p.delete('contractNos');
    }
  };

  // Summa filtrlari → backend params (aniq summa = min=max)
  const AMOUNT_PARAM: Record<string, { min: string; max: string }> = {
    paymentAmount:    { min: 'paymentAmountMin',    max: 'paymentAmountMax' },
    firstInstallment: { min: 'firstInstallmentMin', max: 'firstInstallmentMax' },
    monthlyAmount:    { min: 'monthlyAmountMin',    max: 'monthlyAmountMax' },
  };
  const amtDigits = (s: string) => s.replace(/[^\d.]/g, '');
  const applyAmountParams = (p: URLSearchParams) => {
    for (const [field, val] of Object.entries(amountFilters)) {
      const pm = AMOUNT_PARAM[field];
      if (!pm || !val) continue;
      if (val.mode === 'exact') {
        const v = amtDigits(val.exact);
        if (v) { p.set(pm.min, v); p.set(pm.max, v); }
      } else {
        const mn = amtDigits(val.min);
        const mx = amtDigits(val.max);
        if (mn) p.set(pm.min, mn);
        if (mx) p.set(pm.max, mx);
      }
    }
  };
  const amountFiltersKey = JSON.stringify(amountFilters);
  const amountActiveCount = Object.values(amountFilters).filter((v) =>
    v && (v.mode === 'exact' ? amtDigits(v.exact) !== '' : (amtDigits(v.min) !== '' || amtDigits(v.max) !== '')),
  ).length;

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('perPage', String(perPage));
    // Har doim sana bo'yicha yangidan-eskigacha (bugun tepada)
    p.set('sortBy', 'date');
    p.set('sortDir', 'desc');
    if (q.trim()) p.set('q', q.trim());
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo)   p.set('dateTo', dateTo);
    // Per-column filterlar (vergul bilan)
    for (const [col, paramName] of Object.entries(COLUMN_TO_PARAM)) {
      const set = columnFilters[col];
      if (set && set.size > 0) p.set(paramName, Array.from(set).join(','));
    }
    applyXatoToParams(p);
    applyAmountParams(p);
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, perPage, q, dateFrom, dateTo, columnFiltersKey, amountFiltersKey]);

  // Filter popoverga uzatish uchun — barcha AKTIV column filterlar (page'siz)
  const activeFilterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo)   p.set('dateTo', dateTo);
    for (const [col, paramName] of Object.entries(COLUMN_TO_PARAM)) {
      const set = columnFilters[col];
      if (set && set.size > 0) p.set(paramName, Array.from(set).join(','));
    }
    applyXatoToParams(p);
    applyAmountParams(p);
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, dateFrom, dateTo, columnFiltersKey, amountFiltersKey]);

  // ─── Export — filter-aware (BARCHA filtrlar — column + xatoOnly) ───
  const qsForExport = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo)   p.set('dateTo', dateTo);
    for (const [col, paramName] of Object.entries(COLUMN_TO_PARAM)) {
      const set = columnFilters[col];
      if (set && set.size > 0) p.set(paramName, Array.from(set).join(','));
    }
    applyXatoToParams(p);
    applyAmountParams(p);
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, dateFrom, dateTo, columnFiltersKey, amountFiltersKey]);

  // Aktiv column filterlar soni — badge uchun (summa filtrlari ham qo'shiladi)
  const activeColumnFiltersCount =
    Object.values(columnFilters).filter((s) => s && s.size > 0).length + amountActiveCount;

  const listQuery = useQuery({
    queryKey: ['oplata-kv', qs],
    queryFn: () => api.get<{
      ok: boolean;
      page: number; perPage: number; total: number; pageCount: number;
      items: OplataKvItem[];
      sums: { paymentAmount: number; firstInstallment: number; monthlyAmount: number };
    }>(`/oplata-kv?${qs}`),
    placeholderData: (prev) => prev,
  });

  // Oxirgi sync vaqti (UI'da ko'rsatish)
  const lastSyncQuery = useQuery({
    queryKey: ['oplata-kv-last-sync'],
    queryFn: () => api.get<{ ok: boolean; lastUpdate: string | null; lastCreated: string | null; txSourceCount: number }>('/oplata-kv/last-sync-info'),
    refetchInterval: 60_000, // har daqiqada yangilanadi
  });

  // "Hozir sync" — tranzaksiyalardan ОплатыКв'ga majburiy import (sozlangan min sanani hurmat qiladi)
  // Admin panelidagi kabi progress modal ko'rsatiladi (sync + bg fill/split bosqichlari).
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [bgStatus, setBgStatus] = useState<any>(null);
  const syncNowMut = useMutation({
    mutationFn: () => api.post<{
      ok: boolean; added: number; updated: number; skipped: number; total?: number; objectsBackground?: boolean;
    }>('/oplata-kv/sync-now', {}, { timeout: 120_000 }),
    onMutate: () => { setSyncResult(null); setSyncError(null); setBgStatus(null); setSyncModalOpen(true); },
    onSuccess: (r: any) => {
      setSyncResult(r);
      qc.invalidateQueries({ queryKey: ['oplata-kv'] });
      qc.invalidateQueries({ queryKey: ['oplata-kv-last-sync'] });
    },
    onError: (e: any) => { setSyncError(e?.message || tc('error')); },
  });

  // BG status polling — sync tugagach obyekt/split orqada davom etadi
  useEffect(() => {
    if (!syncResult || !syncResult.objectsBackground) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const s: any = await api.get('/oplata-kv/bg-status');
        if (cancelled) return;
        setBgStatus(s);
        if (s.running) setTimeout(poll, 5000);
        else qc.invalidateQueries({ queryKey: ['oplata-kv'] });
      } catch {
        if (!cancelled) setTimeout(poll, 10000);
      }
    };
    poll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncResult]);

  // Filtr o'zgarganda sahifani 1-ga qaytarish
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [q, dateFrom, dateTo, perPage, columnFiltersKey, amountFiltersKey]);

  const items = listQuery.data?.items || [];
  const total = listQuery.data?.total || 0;
  const pageCount = listQuery.data?.pageCount || 1;
  const sums = listQuery.data?.sums || { paymentAmount: 0, firstInstallment: 0, monthlyAmount: 0 };

  return (
    <div className="flex-1 p-3 sm:p-6 lg:p-8 w-full">
      <div className="w-full space-y-5">
        {/* ═══ KPI / Sums ═══ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <SumCard label="Сумма оплаты" value={sums.paymentAmount}    color="indigo" />
          <SumCard label="1 взнос"       value={sums.firstInstallment} color="amber" />
          <SumCard label="ежемесячный"   value={sums.monthlyAmount}    color="sky" />
          <CountCard label="Всего записей"  count={total} />
        </div>

        {/* ═══ Filter bar ═══ */}
        <Card className="border-0 shadow-soft overflow-visible">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Last sync timestamp chip */}
              {lastSyncQuery.data?.lastUpdate && (
                <div
                  className="h-10 px-3 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 ring-1 ring-emerald-200 dark:ring-emerald-900 inline-flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300 shrink-0"
                  title={`So'nggi yangilanish: ${new Date(lastSyncQuery.data.lastUpdate).toLocaleString('ru-RU')}\n${lastSyncQuery.data.txSourceCount} ta tx-manba qator`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-semibold">Sync:</span>
                  <span className="tabular-nums">
                    {new Date(lastSyncQuery.data.lastUpdate).toLocaleString('ru-RU', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              )}

              {/* Hozir sync — "Sync:" vaqti yonida (bosilganda progress modal) */}
              {canManage && (
                <button
                  onClick={() => syncNowMut.mutate()}
                  disabled={syncNowMut.isPending}
                  className="h-10 w-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 grid place-items-center transition-colors disabled:opacity-60 shrink-0"
                  title={t('syncNow')}
                >
                  <RefreshCw className={cn('h-4 w-4', syncNowMut.isPending && 'animate-spin')} />
                </button>
              )}

              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500 z-10" />
                <Input
                  className="pl-9 h-10 rounded-xl bg-slate-50/60 dark:bg-slate-900"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <TypewriterPlaceholder
                  visible={!q}
                  phrases={[t('searchContract'), t('searchClient'), t('searchObject'), t('searchId'), t('searchAmount')]}
                />
                {q && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full grid place-items-center text-slate-400 dark:text-slate-500 hover:text-white hover:bg-rose-500 z-10"
                    onClick={() => setQ('')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Akt Sverka — shartnoma bo'yicha tarix (kalendardan oldin, neytral stil) */}
              <button
                onClick={() => setAktSverkaOpen(true)}
                className="h-10 w-10 rounded-xl bg-slate-50/60 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 grid place-items-center transition-colors"
                title={t('aktSverkaTitle')}
              >
                <FileCheck2 className="h-4 w-4" />
              </button>

              {/* Sana filtri — icon ichida (collapsed) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      'relative h-10 w-10 rounded-xl ring-1 grid place-items-center transition-colors',
                      (dateFrom || dateTo)
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 ring-indigo-200 dark:ring-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30'
                        : 'bg-slate-50/60 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
                    )}
                    title={(dateFrom || dateTo)
                      ? `${dateFrom ? fmtDateRu(dateFrom) : '…'} — ${dateTo ? fmtDateRu(dateTo) : '…'}`
                      : t('dateRange')}
                  >
                    <Calendar className="h-4 w-4" />
                    {(dateFrom || dateTo) && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-indigo-600 ring-2 ring-white dark:ring-slate-900" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="p-3 w-[280px] space-y-2">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">{t('dateRange')}</div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{t('rangeStart')}</label>
                    <Input
                      type="date"
                      className="h-9 rounded-lg"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{t('rangeEnd')}</label>
                    <Input
                      type="date"
                      className="h-9 rounded-lg"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </div>
                  {(dateFrom || dateTo) && (
                    <button
                      className="w-full h-8 rounded-lg text-[12px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      onClick={() => { setDateFrom(''); setDateTo(''); }}
                    >
                      {tc('clear')}
                    </button>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Ustun filter rejimi toggle — faqat ikon */}
              <button
                onClick={() => {
                  setColumnFilterMode((v) => !v);
                  if (columnFilterMode) {
                    setColumnFilters({});
                    setAmountFilters({});
                    setOpenFilterColumn(null);
                  }
                }}
                className={cn(
                  'relative h-10 w-10 rounded-xl ring-1 grid place-items-center transition-colors',
                  columnFilterMode
                    ? 'bg-indigo-600 text-white ring-indigo-700 hover:bg-indigo-700 shadow-md shadow-indigo-500/30'
                    : 'bg-slate-50/60 dark:bg-slate-900 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
                title={columnFilterMode ? t('columnFilterDisable') : t('columnFilterEnable')}
              >
                <FilterIcon className="h-4 w-4" />
                {activeColumnFiltersCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] rounded-full bg-rose-500 text-white text-[9px] font-bold grid place-items-center px-1 ring-2 ring-white dark:ring-slate-900">
                    {activeColumnFiltersCount}
                  </span>
                )}
              </button>

              {/* Download dropdown — faqat ikon (import permission bilan gating) */}
              {canImport && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="h-10 w-10 rounded-xl bg-slate-50/60 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 grid place-items-center transition-colors"
                      title={tc('download')}
                    >
                      {exporting
                        ? <Loader2 className="h-4 w-4 animate-spin text-indigo-600 dark:text-indigo-400" />
                        : <Download className="h-4 w-4" />}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[220px]">
                    <DropdownMenuItem onClick={downloadExcel} className="gap-2 cursor-pointer">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <div className="flex-1">
                        <div className="text-[13px] font-semibold">Excel (.xlsx)</div>
                        <div className="text-[10.5px] text-slate-500 dark:text-slate-400">{t('filterAllByFilter')}</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={downloadJson} className="gap-2 cursor-pointer">
                      <FileJson className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <div className="flex-1">
                        <div className="text-[13px] font-semibold">JSON (.json)</div>
                        <div className="text-[10.5px] text-slate-500 dark:text-slate-400">{t('filterAllByFilter')}</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={printPdf} className="gap-2 cursor-pointer">
                      <Printer className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      <div className="flex-1">
                        <div className="text-[13px] font-semibold">{t('printPdf')}</div>
                        <div className="text-[10.5px] text-slate-500 dark:text-slate-400">{t('browserPrintDialog')}</div>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {canCreate && (
                <button
                  onClick={() => setAddChoiceOpen(true)}
                  className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md grid place-items-center transition-colors"
                  title={t('newRow')}
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ═══ Table ═══ */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 uppercase text-[10.5px] tracking-wider">
                <tr>
                  <ColumnTh label="Дог №" column="contractNo"
                    filterMode={columnFilterMode} columnFilters={columnFilters}
                    setColumnFilters={setColumnFilters}
                    openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn}
                    activeFilterParams={activeFilterParams} />
                  <Th>Дата</Th>
                  <AmountFilterTh label="Сумма оплаты" field="paymentAmount"
                    filterMode={columnFilterMode} value={amountFilters['paymentAmount']}
                    onApply={(v) => setAmountFilters((prev) => ({ ...prev, paymentAmount: v }))}
                    openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} />
                  <AmountFilterTh label="1 взнос" field="firstInstallment"
                    filterMode={columnFilterMode} value={amountFilters['firstInstallment']}
                    onApply={(v) => setAmountFilters((prev) => ({ ...prev, firstInstallment: v }))}
                    openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} />
                  <AmountFilterTh label="ежемесячный" field="monthlyAmount"
                    filterMode={columnFilterMode} value={amountFilters['monthlyAmount']}
                    onApply={(v) => setAmountFilters((prev) => ({ ...prev, monthlyAmount: v }))}
                    openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn} />
                  <ColumnTh label="Оплата" column="paymentCategory"
                    filterMode={columnFilterMode} columnFilters={columnFilters}
                    setColumnFilters={setColumnFilters}
                    openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn}
                    activeFilterParams={activeFilterParams} />
                  <ColumnTh label="Объект" column="object"
                    filterMode={columnFilterMode} columnFilters={columnFilters}
                    setColumnFilters={setColumnFilters}
                    openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn}
                    activeFilterParams={activeFilterParams} />
                  <ColumnTh label="Тип" column="txType"
                    filterMode={columnFilterMode} columnFilters={columnFilters}
                    setColumnFilters={setColumnFilters}
                    openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn}
                    activeFilterParams={activeFilterParams} />
                  <ColumnTh label={t('columnManba')} column="source"
                    filterMode={columnFilterMode} columnFilters={columnFilters}
                    setColumnFilters={setColumnFilters}
                    openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn}
                    activeFilterParams={activeFilterParams} />
                  <Th align="center">ID</Th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading && Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-700">
                    {Array.from({ length: 10 }).map((__, j) => (
                      <td key={j} className="px-3 py-2.5"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))}
                {!listQuery.isLoading && items.length === 0 && (
                  <tr><td colSpan={10} className="p-12 text-center text-slate-400 dark:text-slate-500">
                    {t('noRowsFound')}
                  </td></tr>
                )}
                {items.map((it) => {
                  const src = getSource(it);
                  return (
                  <tr
                    key={it.id}
                    className="border-t border-slate-100 dark:border-slate-700 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/40 transition-colors cursor-pointer"
                    onClick={() => setDetailRow(it)}
                  >
                    <td className="px-3 py-2.5 font-mono text-[12px] font-semibold text-slate-800 dark:text-slate-200">
                      {it.crmXato ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900"
                          title={t('crmNotFoundFixTx')}
                        >
                          {t('badgeError')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              it.contractSource === 'ariza'   && 'text-violet-800 dark:text-violet-300',
                              it.contractSource === 'manual'  && 'text-amber-800 dark:text-amber-300',
                            )}
                          >
                            {it.contractNo}
                          </span>
                          {it.contractSource === 'ariza' && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-1 ring-violet-200 dark:ring-violet-900"
                              title={t('arizaBadgeTitle')}
                            >
                              {t('badgeAriza')}
                            </span>
                          )}
                          {it.contractSource === 'manual' && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-900"
                              title={t('manualBadgeTitle')}
                            >
                              {t('badgeManual')}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{fmtDateRu(it.date)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', amountCls(it.paymentAmount))}>{fmtNum(it.paymentAmount)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', amountCls(it.firstInstallment))}>
                      {it.firstInstallment ? fmtNum(it.firstInstallment) : ''}
                    </td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', amountCls(it.monthlyAmount))}>
                      {it.monthlyAmount ? fmtNum(it.monthlyAmount) : ''}
                    </td>
                    <td className="px-3 py-2.5">
                      {it.paymentCategory ? (
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-semibold ring-1', CATEGORY_CLS[it.paymentCategory])}>
                          {CATEGORY_LABEL[it.paymentCategory]}
                        </span>
                      ) : <span className="text-slate-400 dark:text-slate-500">—</span>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[200px] truncate" title={it.object || ''}>{it.object || <span className="text-slate-400 dark:text-slate-500">—</span>}</td>
                    <td className="px-3 py-2.5">{it.txType || <span className="text-slate-400 dark:text-slate-500">—</span>}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ring-1 whitespace-nowrap', SOURCE_CLS[src])}>
                        {SOURCE_LABEL_KEY[src] ? t(SOURCE_LABEL_KEY[src]!) : 'Excel'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1">
                        <PurposeInfoButton data={{
                          purpose: it.purpose || null,
                          amount: it.paymentAmount,
                          currency: 'UZS',
                          direction: Number(it.paymentAmount) >= 0 ? 'IN' : 'OUT',
                          txnDate: it.date,
                          contractNumber: it.contractNo,
                          ownerName: it.client || null,
                          externalId: it.sourceTxId || null,
                        }} />
                        <button
                          title={t('copyIdTitle', { id: it.id })}
                          onClick={() => copyId(it.id)}
                          className={cn(
                            'inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors',
                            copiedId === it.id
                              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                              : 'text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400',
                          )}
                        >
                          {copiedId === it.id
                            ? <Check className="h-3.5 w-3.5" />
                            : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-[12px] text-slate-500 dark:text-slate-400">
            <div>{t.rich('totalRows', {
              n: total.toLocaleString('ru-RU'),
              b: (chunks) => <b className="text-slate-700 dark:text-slate-300">{chunks}</b>,
            })}</div>
            <div className="flex items-center gap-2">
              <Select value={String(perPage)} onValueChange={(v) => setPerPage(Number(v))}>
                <SelectTrigger className="h-8 w-[80px] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <button
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              ><ChevronLeft className="h-4 w-4" /></button>
              <span className="tabular-nums">{page} / {pageCount}</span>
              <button
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              ><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </Card>
      </div>

      {/* Detail modal — qator bosilganda chiroyli ko'rinish + edit/delete
          Detail yopilmaydi — Edit/Delete/Tarix ustida ochiladi, yopilganda detail ko'rinadi */}
      <OplataKvDetailDialog
        row={detailRow}
        canEdit={canEdit}
        canDelete={canDelete}
        canSplit={canSplit}
        onClose={() => setDetailRow(null)}
        onEdit={(it) => setEditRow(it)}
        onDelete={(it) => setDeleteRow(it)}
        onHistory={(it) => setHistoryRow(it)}
        onCopyId={copyId}
        copiedId={copiedId}
      />

      {/* Yangi qoshish — Choice modal (Oddiy / Переброска) */}
      <AddChoiceDialog
        open={addChoiceOpen}
        onClose={() => setAddChoiceOpen(false)}
        onPickManual={() => { setAddChoiceOpen(false); setCreateOpen(true); }}
        onPickPerereboska={() => { setAddChoiceOpen(false); setPerereboskaOpen(true); }}
      />

      {/* Hozir sync — progress modal (admin panelidagi kabi) */}
      <SyncProgressDialog
        open={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        isPending={syncNowMut.isPending}
        result={syncResult}
        bgStatus={bgStatus}
        error={syncError}
      />

      {/* Переброска form */}
      <PerereboskaDialog
        open={perereboskaOpen}
        onClose={() => setPerereboskaOpen(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['oplata-kv'] })}
      />

      {/* Create / Edit dialog */}
      <OplataKvFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['oplata-kv'] })}
      />
      <OplataKvFormDialog
        open={!!editRow}
        row={editRow}
        onClose={() => setEditRow(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['oplata-kv'] })}
      />

      {/* Delete confirm */}
      <DeleteConfirmDialog
        row={deleteRow}
        onClose={() => setDeleteRow(null)}
        onDeleted={() => qc.invalidateQueries({ queryKey: ['oplata-kv'] })}
      />

      {/* History viewer */}
      <HistoryDialog row={historyRow} onClose={() => setHistoryRow(null)} />

      {/* Akt Sverka dialog */}
      <AktSverkaDialog
        open={aktSverkaOpen}
        onClose={() => setAktSverkaOpen(false)}
        onCopyId={copyId}
        copiedId={copiedId}
        onRowClick={(it) => setDetailRow(it)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// TypewriterPlaceholder — yozadi → o'chiradi → keyingisi
// ─────────────────────────────────────────────────────────
function TypewriterPlaceholder({ visible, phrases }: { visible: boolean; phrases: string[] }) {
  const [text, setText] = useState('');
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'pause' | 'erasing'>('typing');

  useEffect(() => {
    if (!visible) return;
    const current = phrases[phraseIdx % phrases.length];
    let timeout: any;

    if (phase === 'typing') {
      if (text.length < current.length) {
        timeout = setTimeout(() => setText(current.slice(0, text.length + 1)), 70);
      } else {
        timeout = setTimeout(() => setPhase('pause'), 1400);
      }
    } else if (phase === 'pause') {
      timeout = setTimeout(() => setPhase('erasing'), 100);
    } else if (phase === 'erasing') {
      if (text.length > 0) {
        timeout = setTimeout(() => setText(text.slice(0, -1)), 35);
      } else {
        setPhraseIdx((i) => i + 1);
        setPhase('typing');
      }
    }
    return () => clearTimeout(timeout);
  }, [text, phase, phraseIdx, phrases, visible]);

  if (!visible) return null;
  return (
    <div className="absolute left-9 top-1/2 -translate-y-1/2 pointer-events-none text-[14px] text-slate-400 dark:text-slate-500 select-none">
      {text}
      <span className="inline-block w-[2px] h-[14px] bg-indigo-500 ml-0.5 align-middle animate-tw-cursor" />
      <style jsx>{`
        @keyframes tw-cursor-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .animate-tw-cursor { animation: tw-cursor-blink 0.8s steps(1) infinite; }
      `}</style>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th className={cn(
      'px-3 py-2.5 font-semibold whitespace-nowrap',
      align === 'right' && 'text-right',
      align === 'center' && 'text-center',
      align === 'left' && 'text-left',
    )}>{children}</th>
  );
}

// ─────────────────────────────────────────────────────────
// ColumnTh — filter ikoni va popover bilan jadval header
// ─────────────────────────────────────────────────────────
function ColumnTh({
  label, column, filterMode, columnFilters, setColumnFilters,
  openFilterColumn, setOpenFilterColumn, activeFilterParams,
}: {
  label: string;
  column: string;
  filterMode: boolean;
  columnFilters: Record<string, Set<string>>;
  setColumnFilters: React.Dispatch<React.SetStateAction<Record<string, Set<string>>>>;
  openFilterColumn: string | null;
  setOpenFilterColumn: (c: string | null) => void;
  activeFilterParams: string;
}) {
  const t = useTranslations('oplatykv');
  const activeCount = columnFilters[column]?.size || 0;
  const isOpen = openFilterColumn === column;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const openPopover = () => {
    if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect());
    setOpenFilterColumn(column);
  };

  // Scroll/resize bo'lganda popoverni qayta pozitsiyalaymiz (yopilmaydi)
  useEffect(() => {
    if (!isOpen) return;
    const reposition = () => {
      if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect());
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [isOpen]);

  return (
    <th className="px-3 py-2.5 font-semibold whitespace-nowrap text-left">
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {filterMode && (
          <button
            ref={btnRef}
            onClick={() => isOpen ? setOpenFilterColumn(null) : openPopover()}
            className={cn(
              'relative inline-flex items-center justify-center w-5 h-5 rounded transition-colors',
              activeCount > 0
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'text-slate-400 dark:text-slate-500 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:text-indigo-700 dark:hover:text-indigo-300',
            )}
            title={activeCount > 0 ? t('filterSelectedCount', { n: activeCount }) : t('filterLabel')}
          >
            <FilterIcon className="h-3 w-3" />
            {activeCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-rose-500 text-white text-[9px] font-bold grid place-items-center px-0.5">
                {activeCount > 9 ? '9+' : activeCount}
              </span>
            )}
          </button>
        )}
      </div>
      {isOpen && anchorRect && (
        <ColumnFilterPopover
          column={column}
          label={label}
          anchorRect={anchorRect}
          selected={columnFilters[column] || new Set()}
          activeFilterParams={activeFilterParams}
          onChange={(next) => setColumnFilters((prev) => {
            const cp = { ...prev };
            if (next.size === 0) delete cp[column];
            else cp[column] = next;
            return cp;
          })}
          onClose={() => setOpenFilterColumn(null)}
        />
      )}
    </th>
  );
}

// ─────────────────────────────────────────────────────────
// ColumnFilterPopover — checkbox ro'yxat (debounced search, distinct values)
// ─────────────────────────────────────────────────────────
function ColumnFilterPopover({
  column, label, anchorRect, selected, activeFilterParams, onChange, onClose,
}: {
  column: string;
  label: string;
  anchorRect: DOMRect;
  selected: Set<string>;
  activeFilterParams: string;
  onChange: (next: Set<string>) => void;
  onClose: () => void;
}) {
  const t = useTranslations('oplatykv');
  const tc = useTranslations('common');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Esc / outside click — yopish
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
      clearTimeout(t);
    };
  }, [onClose]);

  const { data, isLoading } = useQuery({
    queryKey: ['oplata-kv-distinct', column, debounced, activeFilterParams],
    queryFn: () => {
      const p = new URLSearchParams(activeFilterParams);
      p.set('column', column);
      if (debounced) p.set('search', debounced);
      return api.get<{ ok: boolean; values: Array<{ id: string; name: string }> }>(`/oplata-kv/distinct?${p.toString()}`);
    },
  });
  const values = data?.values || [];
  const tanlangan = values.filter((v) => selected.has(v.id));
  const qolgan = values.filter((v) => !selected.has(v.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  // Position calculation — viewport ichida sig'sin
  const popoverWidth = 300;
  const popoverMaxHeight = 420; // approximate
  let left = anchorRect.left;
  let top = anchorRect.bottom + 6;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
  // Agar o'ngga sig'masa — chap tomonga surimiz
  if (left + popoverWidth > viewportW - 8) left = Math.max(8, viewportW - popoverWidth - 8);
  // Agar pastga sig'masa — yuqoriga ko'taramiz
  if (top + popoverMaxHeight > viewportH - 8) top = Math.max(8, anchorRect.top - popoverMaxHeight - 6);

  return createPortal(
    <div
      ref={popoverRef}
      className="z-[9999] bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 rounded-xl shadow-2xl p-2.5 text-slate-700 dark:text-slate-300 normal-case tracking-normal"
      style={{ position: 'fixed', top, left, width: popoverWidth }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-1">
        {t('filterLabel')}: <span className="text-slate-800 dark:text-slate-200">{label}</span>
      </div>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
        <Input
          autoFocus
          className="pl-7 h-8 text-[12px] rounded-lg"
          placeholder={tc('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto -mx-1 px-1">
        {isLoading ? (
          <div className="py-6 text-center text-[12px] text-slate-400 dark:text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
            {tc('loading')}
          </div>
        ) : values.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-slate-400 dark:text-slate-500">
            {t('valueNotFound')}
          </div>
        ) : (
          [...tanlangan, ...qolgan].map((v) => (
            <label
              key={v.id}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
                selected.has(v.id) ? 'bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
              )}
            >
              <input
                type="checkbox"
                checked={selected.has(v.id)}
                onChange={() => toggle(v.id)}
                className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
              />
              <span className={cn('text-[12.5px] truncate flex-1', selected.has(v.id) ? 'font-semibold text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300')}>
                {v.name}
              </span>
            </label>
          ))
        )}
      </div>
      <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 gap-2">
        {selected.size > 0 ? (
          <button
            onClick={() => onChange(new Set())}
            className="text-rose-600 dark:text-rose-400 text-[11.5px] font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/40 px-2 py-1 rounded-md transition-colors"
          >
            {t('clearCount', { n: selected.size })}
          </button>
        ) : (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{t('variantCount', { n: values.length })}</span>
        )}
        <button
          onClick={onClose}
          className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded-md text-[11.5px] font-semibold transition-colors"
        >
          {t('ready')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────
// AmountFilterTh — summa ustuni filtri (2 tab: aniq summa / summadan summagacha)
// ─────────────────────────────────────────────────────────
type AmountFilterValue = { mode: 'exact' | 'range'; exact: string; min: string; max: string };
const EMPTY_AMOUNT: AmountFilterValue = { mode: 'exact', exact: '', min: '', max: '' };

function AmountFilterTh({
  label, field, filterMode, value, onApply, openFilterColumn, setOpenFilterColumn,
}: {
  label: string;
  field: string;
  filterMode: boolean;
  value?: AmountFilterValue;
  onApply: (v: AmountFilterValue) => void;
  openFilterColumn: string | null;
  setOpenFilterColumn: (c: string | null) => void;
}) {
  const t = useTranslations('oplatykv');
  const val = value || EMPTY_AMOUNT;
  const d = (s: string) => s.replace(/[^\d.]/g, '');
  const active = val.mode === 'exact' ? d(val.exact) !== '' : (d(val.min) !== '' || d(val.max) !== '');
  const isOpen = openFilterColumn === field;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const openPopover = () => {
    if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect());
    setOpenFilterColumn(field);
  };

  useEffect(() => {
    if (!isOpen) return;
    const reposition = () => { if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect()); };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [isOpen]);

  return (
    <th className="px-3 py-2.5 font-semibold whitespace-nowrap text-right">
      <div className="flex items-center gap-1 justify-end">
        <span>{label}</span>
        {filterMode && (
          <button
            ref={btnRef}
            onClick={() => isOpen ? setOpenFilterColumn(null) : openPopover()}
            className={cn(
              'relative inline-flex items-center justify-center w-5 h-5 rounded transition-colors',
              active
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'text-slate-400 dark:text-slate-500 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:text-indigo-700 dark:hover:text-indigo-300',
            )}
            title={t('filterLabel')}
          >
            <FilterIcon className="h-3 w-3" />
          </button>
        )}
      </div>
      {isOpen && anchorRect && (
        <AmountFilterPopover
          value={val}
          anchorRect={anchorRect}
          onApply={(v) => { onApply(v); setOpenFilterColumn(null); }}
          onClose={() => setOpenFilterColumn(null)}
        />
      )}
    </th>
  );
}

function AmountFilterPopover({
  value, anchorRect, onApply, onClose,
}: {
  value: AmountFilterValue;
  anchorRect: DOMRect;
  onApply: (v: AmountFilterValue) => void;
  onClose: () => void;
}) {
  const t = useTranslations('oplatykv');
  const tc = useTranslations('common');
  const popoverRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'exact' | 'range'>(value.mode);
  const [exact, setExact] = useState(value.exact);
  const [min, setMin] = useState(value.min);
  const [max, setMax] = useState(value.max);

  const fmt = (s: string) => {
    const d = s.replace(/\D/g, '');
    return d ? Number(d).toLocaleString('ru-RU') : '';
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    const tm = setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
      clearTimeout(tm);
    };
  }, [onClose]);

  const popoverWidth = 300;
  let left = anchorRect.right - popoverWidth;
  let top = anchorRect.bottom + 6;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
  if (left < 8) left = 8;
  if (left + popoverWidth > viewportW - 8) left = Math.max(8, viewportW - popoverWidth - 8);

  const apply = () => onApply({ mode, exact, min, max });
  const clear = () => { setExact(''); setMin(''); setMax(''); onApply({ mode, exact: '', min: '', max: '' }); };

  return createPortal(
    <div
      ref={popoverRef}
      className="z-[9999] bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 rounded-xl shadow-2xl p-2.5 text-slate-700 dark:text-slate-300 normal-case tracking-normal"
      style={{ position: 'fixed', top, left, width: popoverWidth }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg mb-2.5">
        <button
          onClick={() => setMode('exact')}
          className={cn('flex-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors',
            mode === 'exact' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}
        >
          {t('amountExactTab')}
        </button>
        <button
          onClick={() => setMode('range')}
          className={cn('flex-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors',
            mode === 'range' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}
        >
          {t('amountRangeTab')}
        </button>
      </div>

      {mode === 'exact' ? (
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{t('amountExactLabel')}</label>
          <Input
            autoFocus inputMode="numeric"
            value={fmt(exact)}
            onChange={(e) => setExact(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
            placeholder="5 178 000"
            className="h-8 text-[12px] text-right tabular-nums font-mono rounded-lg"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{t('amountFromLabel')}</label>
            <Input
              autoFocus inputMode="numeric"
              value={fmt(min)}
              onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
              placeholder="0"
              className="h-8 text-[12px] text-right tabular-nums font-mono rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{t('amountToLabel')}</label>
            <Input
              inputMode="numeric"
              value={fmt(max)}
              onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
              placeholder="∞"
              className="h-8 text-[12px] text-right tabular-nums font-mono rounded-lg"
            />
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-700 gap-2">
        <button
          onClick={clear}
          className="text-slate-500 dark:text-slate-400 text-[11.5px] font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-400 px-2 py-1 rounded-md transition-colors"
        >
          {tc('clear')}
        </button>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="text-[11.5px] text-slate-500 dark:text-slate-400 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">{tc('cancel')}</button>
          <button onClick={apply} className="text-[11.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1 rounded-md transition-colors">OK</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────
// AktSverkaDialog — shartnoma bo'yicha to'lov tarixi (Akt Sverka)
// ─────────────────────────────────────────────────────────
function AktSverkaDialog({
  open, onClose, onCopyId, copiedId, onRowClick,
}: {
  open: boolean;
  onClose: () => void;
  onCopyId: (id: string) => void;
  copiedId: string | null;
  onRowClick: (it: OplataKvItem) => void;
}) {
  const t = useTranslations('oplatykv');
  const tc = useTranslations('common');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedContract, setSelectedContract] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [crmMode, setCrmMode] = useState(false);
  const [view3DOpen, setView3DOpen] = useState(false);
  const [groupByYear, setGroupByYear] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Modal yopilganda holatni reset qilamiz
  useEffect(() => {
    if (!open) {
      setSearch('');
      setDebounced('');
      setSelectedContract(null);
      setSuggestOpen(false);
      setCrmMode(false);
    }
  }, [open]);

  // Autocomplete — distinct contractNo lar
  const suggestQuery = useQuery({
    queryKey: ['oplata-kv-akt-sverka-suggest', debounced],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('column', 'contractNo');
      if (debounced) p.set('search', debounced);
      return api.get<{ ok: boolean; values: Array<{ id: string; name: string }> }>(`/oplata-kv/distinct?${p.toString()}`);
    },
    enabled: open && suggestOpen,
  });

  // Tanlangan shartnoma bo'yicha to'lovlar
  const contractQuery = useQuery({
    queryKey: ['oplata-kv-by-contract', selectedContract],
    queryFn: () => api.get<{
      ok: boolean;
      contractNo: string;
      count: number;
      items: OplataKvItem[];
      sums: { paymentAmount: number; firstInstallment: number; monthlyAmount: number };
      meta: { client: string | null; object: string | null; paymentMethod: string | null; firstDate: string | null; lastDate: string | null } | null;
    }>(`/oplata-kv/by-contract?contractNo=${encodeURIComponent(selectedContract || '')}`),
    enabled: !!selectedContract,
  });

  // CRM sverka — OplatyKv vs XonSaroy CRM
  const crmQuery = useQuery({
    queryKey: ['oplata-kv-crm-sverka', selectedContract],
    queryFn: () => api.get<{
      ok: boolean;
      contractNo: string;
      crmConnected: boolean;
      oplata: { items: OplataKvItem[]; count: number; totalPayment: number; initial: number; monthly: number };
      crm: {
        connected: boolean;
        error: string | null;
        contractInfo: { price: number; contractDate: string | null; status: string | null; initialPlan: number; initialPaid: number; monthlyPlan: number; monthlyPaid: number } | null;
        histories: Array<{ amount: number; datePaid: string | null; typeKey: string; typeLabel: string }>;
        count: number;
        initialSum: number;
        monthlySum: number;
        totalPaid: number;
      };
      comparison: { oplataTotal: number; crmTotal: number; diff: number; diffInitial: number; diffMonthly: number; matched: boolean; status: 'ok' | 'oplata-more' | 'crm-more' };
    }>(`/oplata-kv/crm-sverka?contractNo=${encodeURIComponent(selectedContract || '')}`),
    enabled: !!selectedContract && crmMode,
  });

  const downloadExcel = async () => {
    if (!selectedContract) return;
    try {
      const p = new URLSearchParams();
      p.set('contractNos', selectedContract);
      await apiDownload(`/oplata-kv/export?${p.toString()}`, `akt-sverka-${selectedContract}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(t('excelDownloaded'));
    } catch (e: any) {
      toast.error(e?.message || t('excelError'));
    }
  };

  const data = contractQuery.data;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* Print CSS — modaldan tashqari hammasini yashirish, modal'ni ekspand qilish */}
      {open && (
        <style jsx global>{`
          @media print {
            body * { visibility: hidden !important; }
            [data-print-area="akt-sverka"],
            [data-print-area="akt-sverka"] * { visibility: visible !important; }
            [data-print-area="akt-sverka"] {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              max-width: 100% !important;
              max-height: none !important;
              transform: none !important;
              overflow: visible !important;
              box-shadow: none !important;
              border: none !important;
              border-radius: 0 !important;
            }
            /* Dialog overlay/portal default backgroundlarni yashirish */
            [data-state="open"][role="dialog"] { background: white !important; }
          }
        `}</style>
      )}
      <DialogContent
        data-print-area="akt-sverka"
        className="sm:max-w-4xl p-0 overflow-hidden gap-0 max-h-[90vh] flex flex-col print:max-h-none print:overflow-visible print:max-w-full print:rounded-none print:shadow-none print:ring-0 print:border-0"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        aria-describedby="akt-sverka-description"
      >
        {/* Screen-reader uchun yashirin title + description (Radix a11y talab) */}
        <DialogTitle className="sr-only">{t('aktSverkaHeading')}</DialogTitle>
        <DialogDescription id="akt-sverka-description" className="sr-only">{t('aktSverceHeroSubtitle')}</DialogDescription>

        {/* HERO */}
        <div className="relative bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 px-7 pt-6 pb-5 text-white shrink-0">
          <div
            className="absolute inset-0 opacity-[0.12] pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          />
          <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-white/10 blur-3xl animate-pulse" />
          <div className="relative pr-12 flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-md grid place-items-center ring-1 ring-white/30 shadow-xl shrink-0">
              <FileCheck2 className="h-7 w-7 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/80 mb-1">
                Akt Sverka
              </div>
              <h2 className="text-2xl font-black tracking-tight">{t('aktSverkaHeading')}</h2>
              <p className="text-[12px] text-white/85 mt-0.5">{t('aktSverceHeroSubtitle')}</p>
            </div>
          </div>
        </div>

        {/* SEARCH (autocomplete) — print'da yashirin */}
        <div className="px-7 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900 shrink-0 print:hidden">
          <label className="block text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-2">
            {t('contractNumberLabel')}
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500 z-10" />
              <Input
                autoFocus
                className="pl-10 h-12 rounded-xl text-[14px] font-mono font-semibold"
                placeholder={t('contractNumberPlaceholder')}
                value={selectedContract || search}
                onFocus={() => setSuggestOpen(true)}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelectedContract(null);
                  setSuggestOpen(true);
                }}
              />
              {(selectedContract || search) && (
                <button
                  onClick={() => { setSearch(''); setSelectedContract(null); setSuggestOpen(false); setCrmMode(false); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full grid place-items-center text-slate-400 dark:text-slate-500 hover:bg-rose-500 hover:text-white transition-colors z-10"
                  title={tc('clear')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}

              {/* Suggestions dropdown */}
              {suggestOpen && !selectedContract && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 rounded-xl shadow-xl max-h-72 overflow-y-auto">
                  {suggestQuery.isLoading ? (
                    <div className="py-6 text-center text-[12px] text-slate-400 dark:text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                      {tc('loading')}
                    </div>
                  ) : (suggestQuery.data?.values?.length || 0) === 0 ? (
                    <div className="py-6 text-center text-[12px] text-slate-400 dark:text-slate-500">
                      {t('contractNotFound')}
                    </div>
                  ) : (
                    suggestQuery.data!.values.slice(0, 50).map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          setSelectedContract(v.id);
                          setSearch('');
                          setSuggestOpen(false);
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors border-b border-slate-50 dark:border-slate-800 last:border-0 font-mono text-[13px] font-semibold text-slate-800 dark:text-slate-200"
                      >
                        {v.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {/* CRM Sverka toggle — shartnoma tanlanganda aktiv */}
            <button
              onClick={() => setCrmMode((v) => !v)}
              disabled={!selectedContract}
              className={cn(
                'h-12 w-12 rounded-xl ring-1 grid place-items-center transition-all shrink-0',
                !selectedContract
                  ? 'bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                  : crmMode
                    ? 'bg-gradient-to-br from-fuchsia-600 to-pink-600 ring-fuchsia-700 text-white shadow-md shadow-fuchsia-500/30 hover:scale-105'
                    : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-fuchsia-600 dark:text-fuchsia-400 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-950/40 hover:scale-105',
              )}
              title={t('crmSverkaTitle')}
            >
              <GitCompareArrows className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* BODY — scrollable (print da expand bo'ladi) */}
        <div className="flex-1 overflow-y-auto print:overflow-visible print:max-h-none">
          {/* CRM SVERKA view (crmMode true bo'lsa, contract tanlangan) */}
          {selectedContract && crmMode ? (
            <CrmSverkaView
              data={crmQuery.data}
              isLoading={crmQuery.isLoading}
              onRowClick={onRowClick}
            />
          ) : !selectedContract ? (
            <div className="px-7 py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 grid place-items-center mx-auto mb-3">
                <FileCheck2 className="h-8 w-8 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="text-[15px] font-bold text-slate-700 dark:text-slate-300">{t('selectContract')}</div>
              <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                {t('selectContractHint')}
              </p>
            </div>
          ) : contractQuery.isLoading ? (
            <div className="px-7 py-16 text-center text-slate-400 dark:text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              {tc('loading')}
            </div>
          ) : data && data.items.length === 0 ? (
            <div className="px-7 py-12 text-center text-slate-400 dark:text-slate-500">
              {t('noPaymentsForContract')}
            </div>
          ) : data ? (
            <div className="px-7 py-5 space-y-5">
              {/* 3 ta ASOSIY kartochka — kattaroq, premium ko'rinish */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/40 dark:to-violet-950/40 ring-1 ring-indigo-200 dark:ring-indigo-900 p-4">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-600 dark:text-indigo-400 mb-1.5">Сумма оплаты</div>
                  <div className="text-[18px] font-black text-indigo-900 dark:text-indigo-300 tabular-nums">{formatMoney(data.sums.paymentAmount, '')}</div>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 ring-1 ring-amber-200 dark:ring-amber-900 p-4">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-400 mb-1.5">1 взнос</div>
                  <div className="text-[18px] font-black text-amber-900 dark:text-amber-300 tabular-nums">{formatMoney(data.sums.firstInstallment, '')}</div>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-sky-50 to-cyan-50 dark:from-sky-950/40 dark:to-cyan-950/40 ring-1 ring-sky-200 dark:ring-sky-900 p-4">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-sky-600 dark:text-sky-400 mb-1.5">Ежемесячный</div>
                  <div className="text-[18px] font-black text-sky-900 dark:text-sky-300 tabular-nums">{formatMoney(data.sums.monthlyAmount, '')}</div>
                </div>
              </div>

              {/* Compact meta — JAMI + OBYEKT (kartochka emas, ixcham matn) */}
              <div className="flex items-center gap-4 text-[12px] text-slate-600 dark:text-slate-400 -mt-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-slate-500 dark:text-slate-500">{t('totalShort')}:</span>
                  <span className="font-black text-slate-800 dark:text-slate-200 tabular-nums">{data.count}</span>
                  <span className="text-slate-400">{t('countSuffix')}</span>
                </div>
                {data.meta?.object && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-bold uppercase tracking-wider text-[10px] text-slate-500 dark:text-slate-500">{t('objectLabel')}:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200 truncate" title={data.meta.object}>{data.meta.object}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Items list */}
              <div className="rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                <div className="bg-slate-50 dark:bg-slate-900 px-4 py-2.5 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
                  <div className="text-[11px] uppercase tracking-wider font-bold text-slate-600 dark:text-slate-300">
                    {t('paymentsHistory')} · <span className="text-slate-400 dark:text-slate-500 normal-case">{data.count} {t('countSuffix')}</span>
                  </div>
                  {/* Yil bo'yicha guruh toggle */}
                  <button
                    onClick={() => setGroupByYear((v) => !v)}
                    title={groupByYear ? "Ro'yxat ko'rinishi" : "Yil bo'yicha guruh: har yilda nechta to'lov va jami summa"}
                    className={cn(
                      'h-7 w-7 grid place-items-center rounded-md ring-1 transition-all print:hidden',
                      groupByYear
                        ? 'bg-gradient-to-br from-violet-500 to-indigo-600 ring-violet-400 text-white shadow-sm shadow-violet-500/30'
                        : 'bg-white dark:bg-slate-800 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200',
                    )}
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {groupByYear ? (
                  <YearGroupView items={data.items} />
                ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-slate-50/60 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">{tc('date')}</th>
                        <th className="px-3 py-2 text-right font-semibold">Сумма</th>
                        <th className="px-3 py-2 text-right font-semibold">1 взнос</th>
                        <th className="px-3 py-2 text-right font-semibold">Ежемес.</th>
                        <th className="px-3 py-2 text-left font-semibold">{t('typeShort')}</th>
                        <th className="px-3 py-2 text-center font-semibold print:hidden">ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Sana bo'yicha o'sish tartibida — eski tepada, yangi pastda (xronologik) */}
                      {[...data.items].sort((a, b) => {
                        const ta = a.date ? new Date(a.date).getTime() : 0;
                        const tb = b.date ? new Date(b.date).getTime() : 0;
                        return ta - tb;
                      }).map((it) => (
                        <tr
                          key={it.id}
                          className="border-t border-slate-100 dark:border-slate-700 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/40 transition-colors cursor-pointer"
                          onClick={() => onRowClick(it)}
                          title={t('viewFullInfo')}
                        >
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmtDateRu(it.date)}</td>
                          <td className={cn('px-3 py-2 text-right tabular-nums', amountCls(it.paymentAmount))}>
                            {it.paymentAmount ? formatMoney(Number(it.paymentAmount), '') : '—'}
                          </td>
                          <td className={cn('px-3 py-2 text-right tabular-nums', amountCls(it.firstInstallment))}>
                            {it.firstInstallment ? formatMoney(Number(it.firstInstallment), '') : '—'}
                          </td>
                          <td className={cn('px-3 py-2 text-right tabular-nums', amountCls(it.monthlyAmount))}>
                            {it.monthlyAmount ? formatMoney(Number(it.monthlyAmount), '') : '—'}
                          </td>
                          <td className="px-3 py-2">{it.txType || <span className="text-slate-400 dark:text-slate-500">—</span>}</td>
                          <td className="px-3 py-2 text-center print:hidden" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => onCopyId(it.id)}
                              className={cn(
                                'inline-flex items-center justify-center w-6 h-6 rounded transition-colors',
                                copiedId === it.id ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400',
                              )}
                              title={it.id}
                            >
                              {copiedId === it.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/* Yakuniy yig'indi */}
                    <tfoot>
                      <tr className="bg-amber-50 dark:bg-amber-950/40 border-t-2 border-amber-300 dark:border-amber-900 font-bold">
                        <td className="px-3 py-2.5 text-[11px] uppercase tracking-wider text-amber-700 dark:text-amber-300">ИТОГО</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-amber-900 dark:text-amber-300">{formatMoney(data.sums.paymentAmount, '')}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-amber-900 dark:text-amber-300">{formatMoney(data.sums.firstInstallment, '')}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-amber-900 dark:text-amber-300">{formatMoney(data.sums.monthlyAmount, '')}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* FOOTER (print da yashirin) */}
        <div className="px-7 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900 flex items-center justify-between gap-2 shrink-0 print:hidden">
          <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
            {selectedContract ? (
              <>{t('contractLabel')}: <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{selectedContract}</span></>
            ) : (
              <>{t('contractNotSelected')}</>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView3DOpen(true)}
              disabled={!selectedContract}
              title="3D ko'rinish — to'lov darajasini vizual ko'rsatish"
              className="h-9 px-3 rounded-lg text-white font-semibold text-[12px] inline-flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md
                         bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600
                         hover:from-indigo-600 hover:via-violet-700 hover:to-fuchsia-700
                         hover:shadow-lg hover:shadow-violet-500/30"
            >
              <Box className="h-3.5 w-3.5" /> 3D
            </button>
            <button
              onClick={() => window.print()}
              disabled={!selectedContract || !data || data.items.length === 0}
              className="h-9 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-[12px] inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer className="h-3.5 w-3.5" /> {t('print')}
            </button>
            <button
              onClick={downloadExcel}
              disabled={!selectedContract || !data || data.items.length === 0}
              className="h-9 px-3 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold text-[12px] shadow-md inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </button>
          </div>
        </div>

        {/* 3D Apartment view dialog */}
        <Apartment3DDialog
          open={view3DOpen}
          onClose={() => setView3DOpen(false)}
          contractNo={selectedContract}
        />
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────
// YearGroupView — Akt Sverka to'lovlarni yil bo'yicha guruh
// ─────────────────────────────────────────────────────────
function YearGroupView({ items }: { items: OplataKvItem[] }) {
  // Yil bo'yicha guruh: { 2024: { count, paymentAmount, firstInstallment, monthlyAmount } }
  const groups = useMemo(() => {
    const m = new Map<number, {
      year: number;
      count: number;
      paymentAmount: number;
      firstInstallment: number;
      monthlyAmount: number;
    }>();
    for (const it of items) {
      if (!it.date) continue;
      const y = new Date(it.date).getUTCFullYear();
      if (!Number.isFinite(y)) continue;
      const g = m.get(y) || { year: y, count: 0, paymentAmount: 0, firstInstallment: 0, monthlyAmount: 0 };
      g.count += 1;
      g.paymentAmount    += Number(it.paymentAmount    || 0);
      g.firstInstallment += Number(it.firstInstallment || 0);
      g.monthlyAmount    += Number(it.monthlyAmount    || 0);
      m.set(y, g);
    }
    return [...m.values()].sort((a, b) => a.year - b.year);
  }, [items]);

  const totals = useMemo(() => groups.reduce(
    (acc, g) => ({
      count: acc.count + g.count,
      paymentAmount: acc.paymentAmount + g.paymentAmount,
      firstInstallment: acc.firstInstallment + g.firstInstallment,
      monthlyAmount: acc.monthlyAmount + g.monthlyAmount,
    }),
    { count: 0, paymentAmount: 0, firstInstallment: 0, monthlyAmount: 0 },
  ), [groups]);

  const maxAmount = useMemo(
    () => Math.max(1, ...groups.map((g) => g.paymentAmount)),
    [groups],
  );

  if (groups.length === 0) {
    return (
      <div className="px-7 py-12 text-center text-slate-400 dark:text-slate-500 text-[13px]">
        Sanasi mavjud to'lovlar yo'q
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead className="bg-slate-50/60 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left font-semibold w-20">Yil</th>
            <th className="px-3 py-2 text-center font-semibold w-24">Soni</th>
            <th className="px-3 py-2 text-right font-semibold">Сумма (jami)</th>
            <th className="px-3 py-2 text-right font-semibold">1 взнос</th>
            <th className="px-3 py-2 text-right font-semibold">Ежемес.</th>
            <th className="px-3 py-2 text-left font-semibold">Diagramma</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const barPct = (g.paymentAmount / maxAmount) * 100;
            return (
              <tr key={g.year} className="border-t border-slate-100 dark:border-slate-700 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/40 transition-colors">
                <td className="px-3 py-3 font-black text-[14px] text-indigo-700 dark:text-indigo-300 tabular-nums">
                  {g.year}
                </td>
                <td className="px-3 py-3 text-center">
                  <span className="inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-bold text-[11px] tabular-nums">
                    {g.count}
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums font-bold text-slate-800 dark:text-slate-200">
                  {formatMoney(g.paymentAmount, '')}
                </td>
                <td className={cn('px-3 py-3 text-right tabular-nums', g.firstInstallment ? 'text-amber-700 dark:text-amber-300' : 'text-slate-400 dark:text-slate-500')}>
                  {g.firstInstallment ? formatMoney(g.firstInstallment, '') : '—'}
                </td>
                <td className={cn('px-3 py-3 text-right tabular-nums', g.monthlyAmount ? 'text-sky-700 dark:text-sky-300' : 'text-slate-400 dark:text-slate-500')}>
                  {g.monthlyAmount ? formatMoney(g.monthlyAmount, '') : '—'}
                </td>
                <td className="px-3 py-3 min-w-[120px]">
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-amber-50 dark:bg-amber-950/40 border-t-2 border-amber-300 dark:border-amber-900 font-bold">
            <td className="px-3 py-2.5 text-[11px] uppercase tracking-wider text-amber-700 dark:text-amber-300">ИТОГО</td>
            <td className="px-3 py-2.5 text-center tabular-nums text-amber-900 dark:text-amber-300">{totals.count}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-amber-900 dark:text-amber-300">{formatMoney(totals.paymentAmount, '')}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-amber-900 dark:text-amber-300">{formatMoney(totals.firstInstallment, '')}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-amber-900 dark:text-amber-300">{formatMoney(totals.monthlyAmount, '')}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// CrmSverkaView — OplatyKv vs Transactions taqqoslash
// ─────────────────────────────────────────────────────────
function CrmSverkaView({
  data, isLoading, onRowClick,
}: {
  data: any;
  isLoading: boolean;
  onRowClick: (it: OplataKvItem) => void;
}) {
  const t = useTranslations('oplatykv');
  const tc = useTranslations('common');
  if (isLoading) {
    return (
      <div className="px-7 py-16 text-center text-slate-400 dark:text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
        {t('crmSverkaLoading')}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="px-7 py-12 text-center text-slate-400 dark:text-slate-500">
        {t('noData')}
      </div>
    );
  }
  const { oplata, crm, comparison } = data;
  const matched = comparison.matched;
  const oplataMore = comparison.status === 'oplata-more';

  return (
    <div className="px-7 py-5 space-y-5">
      {/* CRM ulanmaganmi? */}
      {!crm.connected && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 p-3 text-[12px] text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div>{t('crmConnectFailed')}{crm.error ? `: ${crm.error}` : ''}</div>
        </div>
      )}

      {/* Comparison summary — 3 ta katta kartochka */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white p-4 shadow-lg shadow-indigo-500/20">
          <div className="text-[10px] uppercase tracking-widest font-bold text-white/80 mb-1">OplatyKv</div>
          <div className="text-2xl font-black tabular-nums">{formatMoney(comparison.oplataTotal, '')}</div>
          <div className="text-[11px] text-white/85 mt-1">{t('paymentsCount', { n: oplata.count })}</div>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-600 text-white p-4 shadow-lg shadow-sky-500/20">
          <div className="text-[10px] uppercase tracking-widest font-bold text-white/80 mb-1">XonSaroy CRM</div>
          <div className="text-2xl font-black tabular-nums">{formatMoney(comparison.crmTotal, '')}</div>
          <div className="text-[11px] text-white/85 mt-1">{t('paymentHistoryCount', { n: crm.count })}</div>
        </div>
        <div className={cn(
          'rounded-2xl p-4 shadow-lg ring-1',
          matched
            ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-500/30 ring-emerald-700'
            : 'bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-rose-500/30 ring-rose-700',
        )}>
          <div className="flex items-center gap-2 mb-1">
            {matched
              ? <CheckCircle2 className="h-4 w-4" />
              : <AlertTriangle className="h-4 w-4" />}
            <div className="text-[10px] uppercase tracking-widest font-bold text-white/90">
              {matched ? t('resultMatched') : t('resultError')}
            </div>
          </div>
          <div className="text-2xl font-black tabular-nums">
            {matched ? '✓' : (comparison.diff > 0 ? '+' : '') + formatMoney(comparison.diff, '')}
          </div>
          <div className="text-[11px] text-white/85 mt-1">
            {matched
              ? t('sumsMatchSuccess')
              : oplataMore
                ? t('oplataMoreBy', { amount: formatMoney(Math.abs(comparison.diff), '') })
                : t('crmMoreBy', { amount: formatMoney(Math.abs(comparison.diff), '') })}
          </div>
        </div>
      </div>

      {/* Kategoriya bo'yicha taqqoslash */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <CategoryCompareCard
          title={t('categoryInitial')}
          oplata={oplata.initial}
          crm={crm.initialSum}
          diff={comparison.diffInitial}
        />
        <CategoryCompareCard
          title={t('categoryMonthly')}
          oplata={oplata.monthly}
          crm={crm.monthlySum}
          diff={comparison.diffMonthly}
        />
      </div>

      {/* Side-by-side jadval — OplatyKv (chap) vs CRM histories (o'ng) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* OplatyKv */}
        <div className="rounded-2xl ring-1 ring-indigo-200 dark:ring-indigo-900 overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-2.5 border-b border-indigo-200 dark:border-indigo-900 flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider font-bold text-indigo-700 dark:text-indigo-300">
              OplatyKv ({oplata.count})
            </div>
            <div className="text-[11px] tabular-nums font-bold text-indigo-900 dark:text-indigo-300">
              {formatMoney(comparison.oplataTotal, '')}
            </div>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto print:max-h-none">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50/60 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-[10px] uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">{tc('date')}</th>
                  <th className="px-3 py-2 text-right font-semibold">Сумма</th>
                  <th className="px-3 py-2 text-right font-semibold">1 взнос</th>
                  <th className="px-3 py-2 text-right font-semibold">Ежемес.</th>
                </tr>
              </thead>
              <tbody>
                {oplata.items.length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400 dark:text-slate-500 text-[12px]">{t('noPayments')}</td></tr>
                ) : [...oplata.items].sort((a: OplataKvItem, b: OplataKvItem) => {
                  const ta = a.date ? new Date(a.date).getTime() : 0;
                  const tb = b.date ? new Date(b.date).getTime() : 0;
                  return ta - tb;
                }).map((it: OplataKvItem) => (
                  <tr
                    key={it.id}
                    className="border-t border-slate-100 dark:border-slate-700 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/40 transition-colors cursor-pointer"
                    onClick={() => onRowClick(it)}
                  >
                    <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">{fmtDateRu(it.date)}</td>
                    <td className={cn('px-3 py-1.5 text-right tabular-nums', amountCls(it.paymentAmount))}>
                      {it.paymentAmount ? formatMoney(Number(it.paymentAmount), '') : '—'}
                    </td>
                    <td className={cn('px-3 py-1.5 text-right tabular-nums', amountCls(it.firstInstallment))}>
                      {it.firstInstallment ? formatMoney(Number(it.firstInstallment), '') : '—'}
                    </td>
                    <td className={cn('px-3 py-1.5 text-right tabular-nums', amountCls(it.monthlyAmount))}>
                      {it.monthlyAmount ? formatMoney(Number(it.monthlyAmount), '') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* CRM payment_histories */}
        <div className="rounded-2xl ring-1 ring-sky-200 dark:ring-sky-900 overflow-hidden">
          <div className="bg-gradient-to-r from-sky-50 to-cyan-50 px-4 py-2.5 border-b border-sky-200 dark:border-sky-900 flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider font-bold text-sky-700 dark:text-sky-300">
              XonSaroy CRM ({crm.count})
            </div>
            <div className="text-[11px] tabular-nums font-bold text-sky-900 dark:text-sky-300">
              {formatMoney(comparison.crmTotal, '')}
            </div>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto print:max-h-none">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50/60 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-[10px] uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">{tc('date')}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t('typeShort')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{tc('amount')}</th>
                </tr>
              </thead>
              <tbody>
                {crm.histories.length === 0 ? (
                  <tr><td colSpan={3} className="py-6 text-center text-slate-400 dark:text-slate-500 text-[12px]">
                    {crm.connected ? t('crmNoPaymentHistory') : t('crmNotConnected')}
                  </td></tr>
                ) : [...crm.histories].sort((a: any, b: any) => {
                  // Chap (OplatyKv) jadval bilan bir xil — sana o'sish tartibida (eski → yangi)
                  const ta = a.datePaid ? new Date(a.datePaid).getTime() : 0;
                  const tb = b.datePaid ? new Date(b.datePaid).getTime() : 0;
                  return ta - tb;
                }).map((h: any, i: number) => {
                  const isInitial = h.typeKey.toLowerCase().includes('init') || h.typeKey.toLowerCase().includes('boshlang');
                  return (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-700 hover:bg-sky-50/40 dark:hover:bg-sky-950/40 transition-colors">
                      <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">
                        {h.datePaid ? fmtDateRu(h.datePaid) : '—'}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={cn(
                          'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold ring-1',
                          isInitial
                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900'
                            : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-sky-200 dark:ring-sky-900',
                        )}>
                          {isInitial ? 'BSH' : 'OYL'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                        {formatMoney(h.amount, '')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryCompareCard({ title, oplata, crm, diff }: { title: string; oplata: number; crm: number; diff: number }) {
  const t = useTranslations('oplatykv');
  const matched = Math.abs(diff) < 0.01;
  return (
    <div className={cn(
      'rounded-xl ring-1 p-3',
      matched ? 'bg-emerald-50/50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900' : 'bg-rose-50/50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900',
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider font-bold text-slate-600 dark:text-slate-300">{title}</div>
        {matched
          ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          : <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-[9px] text-indigo-600 dark:text-indigo-400 uppercase font-semibold">OplatyKv</div>
          <div className="font-bold text-slate-800 dark:text-slate-200 tabular-nums">{formatMoney(oplata, '')}</div>
        </div>
        <div>
          <div className="text-[9px] text-sky-600 dark:text-sky-400 uppercase font-semibold">CRM</div>
          <div className="font-bold text-slate-800 dark:text-slate-200 tabular-nums">{formatMoney(crm, '')}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase font-semibold text-slate-500 dark:text-slate-400">{t('difference')}</div>
          <div className={cn('font-bold tabular-nums', matched ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>
            {matched ? '✓' : (diff > 0 ? '+' : '') + formatMoney(diff, '')}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Detail dialog — qator bosilganda barcha ma'lumotni chiroyli ko'rinishda
// ─────────────────────────────────────────────────────────
function OplataKvDetailDialog({
  row, canEdit, canDelete, canSplit, onClose, onEdit, onDelete, onHistory, onCopyId, copiedId,
}: {
  row: OplataKvItem | null;
  canEdit: boolean;
  canDelete: boolean;
  canSplit: boolean;
  onClose: () => void;
  onEdit: (r: OplataKvItem) => void;
  onDelete: (r: OplataKvItem) => void;
  onHistory: (r: OplataKvItem) => void;
  onCopyId: (id: string) => void;
  copiedId: string | null;
}) {
  const t = useTranslations('oplatykv');
  const tc = useTranslations('common');
  // Live query — qator ma'lumotini real-time olib turadi (split/edit'dan keyin avto refresh)
  const initialRow = row;
  const detailQuery = useQuery({
    queryKey: ['oplata-kv-detail', initialRow?.id],
    queryFn: () => api.get<{ ok: boolean; item: OplataKvItem }>(`/oplata-kv/${initialRow!.id}`),
    enabled: !!initialRow?.id,
    initialData: initialRow ? { ok: true as const, item: initialRow } : undefined,
  });
  const isRefetching = detailQuery.isFetching && !detailQuery.isLoading;
  // Original 'row' o'zgaruvchini live ma'lumot bilan almashtiramiz —
  // shu sababli quyidagi barcha row.X references avtomatik live data ko'rsatadi
  row = detailQuery.data?.item || initialRow;
  if (!row) return null;
  const catCls = row.paymentCategory ? CATEGORY_CLS[row.paymentCategory] : '';
  const catLabel = row.paymentCategory ? CATEGORY_LABEL[row.paymentCategory] : '—';

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          'sm:max-w-3xl p-0 overflow-hidden gap-0 transition-shadow',
          isRefetching && 'ring-2 ring-fuchsia-400 ring-offset-2',
        )}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        aria-describedby="oplatakv-detail-description"
      >
        {/* Screen-reader uchun yashirin title + description (Radix a11y talab) */}
        <DialogTitle className="sr-only">{row?.contractNo || 'OplataKv detail'}</DialogTitle>
        <DialogDescription id="oplatakv-detail-description" className="sr-only">
          Kvartira to'lov tafsiloti
        </DialogDescription>

        {/* Hero header */}
        <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 pt-6 pb-5 text-white">
          <div
            className="absolute inset-0 opacity-[0.12] pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          />
          <div className="relative pr-12">
            <div className="text-[10px] uppercase tracking-widest font-bold text-white/70 mb-1">
              Договор
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {row.crmXato ? (
                <div
                  className="font-mono text-2xl font-black tracking-tight text-rose-100"
                  title={t('crmNotFoundFixTitle')}
                >
                  {t('badgeError')}
                </div>
              ) : (
                <>
                  <div className="font-mono text-2xl font-black tracking-tight">
                    {row.contractNo || '—'}
                  </div>
                  {row.contractNo && (
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(row.contractNo);
                          toast.success(t('contractCopied', { contract: row.contractNo }));
                        } catch { toast.error(tc('copyError')); }
                      }}
                      className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 grid place-items-center text-white/80 hover:text-white transition-all hover:scale-110"
                      title={t('copyContractTitle')}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {row.contractSource === 'ariza' && (
                    <span
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold ring-1 bg-violet-500/30 ring-violet-300/50 text-violet-50 whitespace-nowrap"
                      title={t('arizaBadgeTitle')}
                    >
                      📎 {t('badgeAriza')}
                    </span>
                  )}
                  {row.contractSource === 'manual' && (
                    <span
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold ring-1 bg-amber-500/30 ring-amber-300/50 text-amber-50 whitespace-nowrap"
                      title={t('manualBadgeTitle')}
                    >
                      ✍ {t('badgeManual')}
                    </span>
                  )}
                </>
              )}
              {row.paymentCategory && (
                <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold ring-1 bg-white/15 ring-white/30 text-white whitespace-nowrap">
                  {catLabel}
                </span>
              )}
            </div>
            <div className="text-[12px] text-white/80 mt-1.5">
              {fmtDateRu(row.date)} · <span className="font-mono">{row.id.slice(0, 8)}…</span>
              {row.crmXato && (
                <span className="ml-2 text-rose-200 text-[11px]">
                  · {t('crmNotFoundShort')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Sums grid */}
          <div className="grid grid-cols-3 gap-2.5">
            <DetailSum label="Сумма оплаты" value={row.paymentAmount}    color="indigo" />
            <DetailSum label="1 взнос"       value={row.firstInstallment} color="amber" />
            <DetailSum label="ежемесячный"   value={row.monthlyAmount}    color="sky" />
          </div>

          {/* Info rows */}
          <div className="space-y-2">
            <DetailRow icon={<User2 className="h-4 w-4" />}      label="Клиент"        value={row.client} />
            <DetailRow icon={<Home className="h-4 w-4" />}       label="Объект"        value={row.object} />
            <DetailRow icon={<CreditCard className="h-4 w-4" />} label="Способ оплаты" value={row.paymentMethod} />
            <DetailRow icon={<FileText className="h-4 w-4" />}   label="Назначение"    value={row.purpose} multiline />
            <DetailRow icon={<TagIcon className="h-4 w-4" />}    label="Тип"           value={row.txType} />
            <DetailRow icon={<FileText className="h-4 w-4" />}   label="Примечание"    value={row.note} multiline />
          </div>

          {/* Meta */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <div>
              <div className="uppercase tracking-wider font-semibold mb-0.5">{t('createdAt')}</div>
              <div className="text-slate-700 dark:text-slate-300">{fmtDateTime(row.createdAt)}</div>
              {row.createdByName && <div className="text-slate-500 dark:text-slate-400">{row.createdByName}</div>}
            </div>
            <div>
              <div className="uppercase tracking-wider font-semibold mb-0.5">{t('updatedAt')}</div>
              <div className="text-slate-700 dark:text-slate-300">{fmtDateTime(row.updatedAt)}</div>
            </div>
          </div>

          {/* Full ID with copy */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2.5 flex items-center gap-2">
            <Hash className="h-4 w-4 text-slate-400 dark:text-slate-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">ID</div>
              <code className="text-[11.5px] text-slate-700 dark:text-slate-300 font-mono break-all">{row.id}</code>
            </div>
            <button
              onClick={() => onCopyId(row.id)}
              className={cn(
                'shrink-0 w-8 h-8 rounded-lg grid place-items-center transition-colors',
                copiedId === row.id
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 ring-1 ring-slate-200 dark:ring-slate-700',
              )}
              title={tc('copy')}
            >
              {copiedId === row.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onHistory(row)}
              className="h-10 px-3 rounded-xl text-[13px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200/80 dark:hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5"
            >
              <History className="h-4 w-4" /> {t('history')}
            </button>
            {row.sourceTxId && canSplit && (
              <ReSplitButton row={row} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {canDelete && (
              <button
                onClick={() => onDelete(row)}
                className="h-10 px-4 rounded-xl text-[13px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/30 ring-1 ring-rose-200 dark:ring-rose-900 transition-colors inline-flex items-center gap-1.5"
              >
                <Trash2 className="h-4 w-4" /> {tc('delete')}
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => onEdit(row)}
                className="h-10 px-4 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 shadow-md inline-flex items-center gap-1.5"
              >
                <Edit3 className="h-4 w-4" /> {tc('edit')}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Re-split tugmasi — modal yopilmaydi, jonli React Query invalidate orqali refresh
function ReSplitButton({ row }: { row: OplataKvItem }) {
  const t = useTranslations('oplatykv');
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const splitMut = useMutation({
    mutationFn: () => api.post<{ filled?: number; contracts?: number }>(`/oplata-kv/${row.id}/split`, {}),
    onSuccess: (r) => {
      toast.success(t('splitDone', { filled: r.filled ?? 1, contracts: r.contracts ?? 1 }));
      // React Query orqali jonli yangilash (sahifa reload qilinmaydi, modal yopilmaydi)
      qc.invalidateQueries({ queryKey: ['oplata-kv'] });
      qc.invalidateQueries({ queryKey: ['oplata-kv-detail', row.id] });
      qc.invalidateQueries({ queryKey: ['oplata-kv-history', row.id] });
    },
    onError: (e: any) => toast.error(e?.message || t('splitError')),
  });
  return (
    <button
      onClick={() => {
        if (confirming) {
          splitMut.mutate();
          setConfirming(false);
        } else {
          setConfirming(true);
          setTimeout(() => setConfirming(false), 3000);
        }
      }}
      disabled={splitMut.isPending}
      className={cn(
        'h-10 px-3 rounded-xl text-[13px] font-semibold transition-all inline-flex items-center gap-1.5 ring-1',
        confirming
          ? 'bg-fuchsia-600 text-white ring-fuchsia-600 shadow-lg shadow-fuchsia-500/30 scale-105'
          : 'bg-fuchsia-50 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-300 ring-fuchsia-200 dark:ring-fuchsia-900 hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/30',
      )}
      title={t('reSplitTitle')}
    >
      {splitMut.isPending
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : <Receipt className="h-4 w-4" />}
      {confirming ? t('pressToConfirm') : t('reSplit')}
    </button>
  );
}

function DetailRow({ icon, label, value, multiline }: { icon: React.ReactNode; label: string; value: string | null; multiline?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 grid place-items-center text-slate-500 dark:text-slate-400 shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{label}</div>
        <div className={cn('text-[13px] text-slate-800 dark:text-slate-200 font-medium', multiline ? 'whitespace-pre-wrap break-words' : 'truncate')}>
          {value || <span className="text-slate-400 dark:text-slate-500 font-normal italic">—</span>}
        </div>
      </div>
    </div>
  );
}

function DetailSum({ label, value, color }: { label: string; value: string | number | null; color: 'indigo' | 'amber' | 'sky' }) {
  const cls = {
    indigo: 'bg-gradient-to-br from-indigo-50 to-violet-50 ring-indigo-200 dark:ring-indigo-900 text-indigo-900 dark:text-indigo-300',
    amber:  'bg-gradient-to-br from-amber-50 to-orange-50 ring-amber-200 dark:ring-amber-900 text-amber-900 dark:text-amber-300',
    sky:    'bg-gradient-to-br from-sky-50 to-cyan-50 ring-sky-200 dark:ring-sky-900 text-sky-900 dark:text-sky-300',
  }[color];
  const labelCls = {
    indigo: 'text-indigo-600 dark:text-indigo-400',
    amber:  'text-amber-600 dark:text-amber-400',
    sky:    'text-sky-600 dark:text-sky-400',
  }[color];
  return (
    <div className={cn('rounded-xl ring-1 p-3', cls)}>
      <div className={cn('text-[10px] uppercase tracking-wider font-bold', labelCls)}>{label}</div>
      <div className="text-base font-black tabular-nums mt-0.5">
        {fmtNum(value)}
      </div>
    </div>
  );
}

function SumCard({ label, value, color }: { label: string; value: number; color: 'indigo' | 'amber' | 'sky' }) {
  const cls = {
    indigo: 'from-indigo-500 to-violet-600 shadow-indigo-500/20',
    amber:  'from-amber-500 to-orange-600 shadow-amber-500/20',
    sky:    'from-sky-500 to-cyan-600 shadow-sky-500/20',
  }[color];
  const icon = {
    indigo: <Receipt className="h-5 w-5" />,
    amber:  <ArrowUpRight className="h-5 w-5" />,
    sky:    <Activity className="h-5 w-5" />,
  }[color];
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <CardContent className="p-4 flex items-center gap-3">
        <span className={cn('w-10 h-10 rounded-xl grid place-items-center text-white bg-gradient-to-br shadow-md shrink-0', cls)}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{label}</div>
          <div className={cn('text-xl font-bold tabular-nums mt-0.5', value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100')}>
            {formatMoney(value, '')}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CountCard({ label, count }: { label: string; count: number }) {
  const t = useTranslations('oplatykv');
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <CardContent className="p-4 flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center text-white bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/20 shrink-0">
          <Hash className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{label}</div>
          <div className="text-xl font-bold tabular-nums mt-0.5 text-slate-900 dark:text-slate-100">
            {count.toLocaleString('ru-RU')} <span className="text-sm font-semibold text-slate-400 dark:text-slate-500">{t('rowCountUnit')}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────
// Create / Edit dialog
// ─────────────────────────────────────────────────────────
// ──────────────────────────────────────────
// Pul (money) input helper'lari
// ──────────────────────────────────────────
/** Stringni faqat raqamlar va '-' belgisiga qisqartiradi (raw saqlash uchun) */
function parseMoneyRaw(s: string): string {
  // Faqat raqamlar, '-' (boshida), va '.' (decimal) — ming separator (probel/vergul) tashlanadi
  const cleaned = s.replace(/[^\d.-]/g, '');
  // '-' faqat birinchi belgida
  const sign = cleaned.startsWith('-') ? '-' : '';
  const rest = cleaned.replace(/-/g, '');
  // Faqat 1 ta '.'
  const parts = rest.split('.');
  const result = parts.length > 1
    ? parts[0] + '.' + parts.slice(1).join('').slice(0, 2)
    : parts[0];
  return sign + result;
}

/** Raw stringni '198 424' ko'rinishida formatlaydi */
function formatMoneyDisplay(raw: string): string {
  if (!raw || raw === '-') return raw;
  const sign = raw.startsWith('-') ? '-' : '';
  const abs = raw.replace(/^-/, '');
  const [intPart, decPart] = abs.split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return sign + intFormatted + (decPart !== undefined ? '.' + decPart : '');
}

/** Saqlanish uchun raw'dan number — bo'sh bo'lsa undefined */
function moneyToNumber(raw: string): number | undefined {
  if (!raw || raw === '-' || raw.trim() === '') return undefined;
  const n = Number(raw);
  return isNaN(n) ? undefined : n;
}

/**
 * Pul (money) input — display'da '198 424', state'da raw '198424'.
 * onChange raw qiymatni qaytaradi.
 */
function MoneyInput({
  value, onChange, placeholder, disabled, className,
}: {
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Input
      value={formatMoneyDisplay(value)}
      onChange={(e) => onChange(parseMoneyRaw(e.target.value))}
      placeholder={placeholder}
      disabled={disabled}
      inputMode="decimal"
      className={className}
    />
  );
}

// ──────────────────────────────────────────
// Object mapping query — Объект dropdown uchun
// ──────────────────────────────────────────
interface ObjectMapping {
  id: string;
  crmName: string;
  oplataName: string;
}

function OplataKvFormDialog({
  open, row, onClose, onSaved,
}: {
  open: boolean; row?: OplataKvItem | null;
  onClose: () => void; onSaved: () => void;
}) {
  const t = useTranslations('oplatykv');
  const tc = useTranslations('common');
  const isEdit = !!row;
  // Tashqi manbadan kelgan qator (bank tx YOKI Excel import) — asosiy
  // maydonlarni lock qilamiz. Faqat qo'lda yaratilgan qatorlarda
  // foydalanuvchi 5 ta asosiy maydonni tahrirlashi mumkin.
  const isFromTx = !!row?.sourceTxId || !!row?.importBatchId;

  const [contractNo, setContractNo] = useState('');
  const [date, setDate] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [firstInstallment, setFirstInstallment] = useState('');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [txType, setTxType] = useState('');
  const [note, setNote] = useState('');
  const [paymentCategory, setPaymentCategory] = useState<string>('');
  const [object, setObject] = useState('');
  const [client, setClient] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');

  // Объект dropdown — mapping'lardagi oplataName ro'yxati
  const mappingsQuery = useQuery({
    queryKey: ['oplatykv-object-mappings'],
    queryFn: () => api.get<{ ok: boolean; items: ObjectMapping[] }>('/oplata-kv/object-mappings'),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const objectOptions = useMemo(() => {
    const list = mappingsQuery.data?.items?.map((m) => m.oplataName) || [];
    const unique = Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    // Joriy qiymat ro'yxatda bo'lmasa, oldiga qo'shamiz
    if (object && !unique.includes(object)) unique.unshift(object);
    return unique;
  }, [mappingsQuery.data, object]);

  // ────────── CRM auto-lookup (faqat YANGI qatorda — contractNo o'zgarganda) ──────────
  const [crmLookupState, setCrmLookupState] = useState<{
    status: 'idle' | 'loading' | 'found' | 'not-found' | 'error';
    msg?: string;
  }>({ status: 'idle' });
  const lookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLookupCnRef = useRef<string>('');

  useEffect(() => {
    if (!open || isEdit) return;
    const cn = contractNo.trim();
    if (lookupTimerRef.current) {
      clearTimeout(lookupTimerRef.current);
      lookupTimerRef.current = null;
    }
    if (!cn) {
      setCrmLookupState({ status: 'idle' });
      lastLookupCnRef.current = '';
      return;
    }
    if (cn.toUpperCase() === lastLookupCnRef.current.toUpperCase()) return;

    lookupTimerRef.current = setTimeout(async () => {
      lastLookupCnRef.current = cn;
      setCrmLookupState({ status: 'loading' });
      try {
        const res = await api.get<{
          ok: boolean; found: boolean;
          customerName: string | null;
          objectName: string | null;
          objectNameOriginal: string | null;
          error?: string;
        }>(`/oplata-kv/crm-lookup?contractNo=${encodeURIComponent(cn)}`);
        if (!res.ok) {
          setCrmLookupState({ status: 'error', msg: res.error || t('crmRequestError') });
          return;
        }
        if (!res.found) {
          setCrmLookupState({ status: 'not-found', msg: t('crmNotFoundFillManual') });
          return;
        }
        // Auto-fill — faqat bo'sh maydonlarga
        if (res.customerName && !client.trim()) setClient(res.customerName);
        if (res.objectName && !object.trim()) setObject(res.objectName);
        setCrmLookupState({
          status: 'found',
          msg: res.objectNameOriginal && res.objectName !== res.objectNameOriginal
            ? t('crmFoundObjectMapped', { from: res.objectNameOriginal, to: res.objectName })
            : t('crmFoundFilled'),
        });
      } catch (e: any) {
        setCrmLookupState({ status: 'error', msg: e?.message || t('requestError') });
      }
    }, 600);

    return () => {
      if (lookupTimerRef.current) clearTimeout(lookupTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractNo, open, isEdit]);

  useEffect(() => {
    if (!open) return;
    if (row) {
      setContractNo(row.contractNo || '');
      setDate(row.date ? new Date(row.date).toISOString().slice(0, 10) : '');
      setPaymentAmount(row.paymentAmount ?? '');
      setFirstInstallment(row.firstInstallment ?? '');
      setMonthlyAmount(row.monthlyAmount ?? '');
      setPurpose(row.purpose ?? '');
      setTxType(row.txType ?? '');
      setNote(row.note ?? '');
      setPaymentCategory(row.paymentCategory ?? '');
      setObject(row.object ?? '');
      setClient(row.client ?? '');
      setPaymentMethod(row.paymentMethod ?? '');
    } else {
      setContractNo(''); setDate(new Date().toISOString().slice(0, 10));
      setPaymentAmount(''); setFirstInstallment(''); setMonthlyAmount('');
      setPurpose(''); setTxType(''); setNote('');
      setPaymentCategory(''); setObject(''); setClient(''); setPaymentMethod('');
    }
  }, [open, row]);

  // ────────── Validatsiya: 1 взнос + ежемесячный === Сумма оплаты ──────────
  const sumValidation = useMemo(() => {
    const p = moneyToNumber(paymentAmount);
    const f = moneyToNumber(firstInstallment);
    const m = moneyToNumber(monthlyAmount);
    // Agar paymentAmount yoki ikkalasi (first + monthly) ham bo'sh bo'lsa — tekshirmaymiz
    if (p === undefined) return { ok: true, msg: '' };
    if (f === undefined && m === undefined) return { ok: true, msg: '' };
    const sumFM = (f ?? 0) + (m ?? 0);
    // Floating tolerance (kichik xatolik uchun)
    const eq = Math.abs(sumFM - p) < 0.01;
    if (eq) return { ok: true, msg: t('checkedEquals', { sum: formatMoney(sumFM), payment: formatMoney(p) }) };
    return {
      ok: false,
      msg: t('sumMismatch', { sum: formatMoney(sumFM), payment: formatMoney(p), diff: formatMoney(sumFM - p) }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentAmount, firstInstallment, monthlyAmount]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const body: any = {
        contractNo: contractNo.trim(),
        date,
        paymentAmount:    moneyToNumber(paymentAmount),
        firstInstallment: moneyToNumber(firstInstallment),
        monthlyAmount:    moneyToNumber(monthlyAmount),
        purpose: purpose.trim() || undefined,
        txType: txType.trim() || undefined,
        note: note.trim() || undefined,
        paymentCategory: paymentCategory || undefined,
        object: object.trim() || undefined,
        client: client.trim() || undefined,
        paymentMethod: paymentMethod.trim() || undefined,
      };
      if (isEdit && row) {
        return api.patch(`/oplata-kv/${row.id}`, body);
      }
      return api.post('/oplata-kv', body);
    },
    onSuccess: () => {
      toast.success(isEdit ? t('editSaved') : t('rowAdded'));
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || t('genericError')),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? <Edit3 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" /> : <Plus className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
            {isEdit ? t('editRowTitle') : t('newRow')}
          </DialogTitle>
          <DialogDescription>
            {t('formDesc')}
          </DialogDescription>
        </DialogHeader>

        {/* Tashqi manbadan kelgan qator info banner */}
        {isFromTx && (
          <div className="mt-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 px-3 py-2 flex items-start gap-2">
            <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="text-[12px] text-amber-900 dark:text-amber-300 leading-relaxed">
              <b>{row?.sourceTxId ? t('rowFromBank') : t('rowFromExcel')}</b> {t('lockedFieldsBanner')}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 py-2">
          <Field label="Дог № *" locked={isFromTx}>
            <Input
              value={contractNo}
              onChange={(e) => setContractNo(e.target.value)}
              placeholder="7331MSO26KK"
              disabled={isFromTx}
            />
          </Field>
          <Field label="Дата *" locked={isFromTx}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={isFromTx} />
          </Field>

          {/* CRM auto-lookup status (faqat yangi qatorda) */}
          {!isEdit && crmLookupState.status !== 'idle' && (
            <div className="col-span-2">
              <div
                className={cn(
                  'rounded-lg px-3 py-2 text-[12px] font-medium ring-1 inline-flex items-center gap-1.5',
                  crmLookupState.status === 'loading' && 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
                  crmLookupState.status === 'found' && 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900',
                  crmLookupState.status === 'not-found' && 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900',
                  crmLookupState.status === 'error' && 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
                )}
              >
                {crmLookupState.status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {crmLookupState.status === 'found' && <CheckCircle2 className="h-3.5 w-3.5" />}
                {crmLookupState.status === 'not-found' && <AlertTriangle className="h-3.5 w-3.5" />}
                {crmLookupState.status === 'error' && <X className="h-3.5 w-3.5" />}
                {crmLookupState.status === 'loading' ? t('crmChecking') : crmLookupState.msg}
              </div>
            </div>
          )}

          <Field label="Сумма оплаты *" locked={isFromTx}>
            <MoneyInput value={paymentAmount} onChange={setPaymentAmount} placeholder="0" disabled={isFromTx} />
          </Field>
          <Field label="1 взнос">
            <MoneyInput value={firstInstallment} onChange={setFirstInstallment} placeholder="0" />
          </Field>

          <Field label="ежемесячный">
            <MoneyInput value={monthlyAmount} onChange={setMonthlyAmount} placeholder="0" />
          </Field>
          <Field label={t('paymentTypeLabel')}>
            <Select value={paymentCategory || 'none'} onValueChange={(v) => setPaymentCategory(v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder={t('selectPlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="MONTHLY">ежемесячный</SelectItem>
                <SelectItem value="FIRST">1 взнос</SelectItem>
                <SelectItem value="GENERAL">Общий</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {/* Sum validation status — 2 ustunni egallaydi */}
          {(paymentAmount || firstInstallment || monthlyAmount) && (
            <div className="col-span-2">
              <div
                className={cn(
                  'rounded-lg px-3 py-2 text-[12px] font-medium ring-1 inline-flex items-center gap-1.5',
                  sumValidation.ok
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
                )}
              >
                {sumValidation.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {sumValidation.msg || t('sumMustEqual')}
              </div>
            </div>
          )}

          <Field label="Клиент" locked={isFromTx}>
            <Input value={client} onChange={(e) => setClient(e.target.value)} disabled={isFromTx} />
          </Field>
          <Field label="Объект">
            <Select value={object || '__empty'} onValueChange={(v) => setObject(v === '__empty' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder={mappingsQuery.isLoading ? tc('loading') : t('selectObjectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty">—</SelectItem>
                {objectOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Способ оплаты">
            <Select value={paymentMethod || '__empty'} onValueChange={(v) => setPaymentMethod(v === '__empty' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder={t('selectPlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty">—</SelectItem>
                <SelectItem value="Перечисление">Перечисление</SelectItem>
                <SelectItem value="Наличные">Наличные</SelectItem>
                {/* Joriy qiymat yuqorida bo'lmasa, uni ham qo'shamiz (eski qatorlar uchun) */}
                {paymentMethod && !['Перечисление', 'Наличные'].includes(paymentMethod) && (
                  <SelectItem value={paymentMethod}>{paymentMethod}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Тип" locked={isFromTx}>
            <Input value={txType} onChange={(e) => setTxType(e.target.value)} disabled={isFromTx} />
          </Field>

          <Field label="Назначение платежа" full locked={isFromTx}>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={isFromTx} />
          </Field>

          <Field label="Примечание" full>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={
              !contractNo.trim() ||
              !date ||
              !paymentAmount.trim() ||
              moneyToNumber(paymentAmount) === undefined ||
              !sumValidation.ok ||
              saveMut.isPending
            }
            className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white"
          >
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
            {isEdit ? t('save') : t('add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, full, locked, children,
}: { label: string; full?: boolean; locked?: boolean; children: React.ReactNode }) {
  const t = useTranslations('oplatykv');
  return (
    <div className={cn('space-y-1', full && 'col-span-2')}>
      <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
        {label}
        {locked && (
          <Lock
            className="h-3 w-3 text-amber-500 dark:text-amber-400"
            aria-label={t('lockedFieldTitle')}
          />
        )}
      </label>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Delete confirm
// ─────────────────────────────────────────────────────────
function DeleteConfirmDialog({ row, onClose, onDeleted }: {
  row: OplataKvItem | null; onClose: () => void; onDeleted: () => void;
}) {
  const t = useTranslations('oplatykv');
  const tc = useTranslations('common');
  const isPerereboska = !!row?.perereboskaGroupId;
  const delMut = useMutation({
    mutationFn: () => {
      // Перереброска guruh — barchasini o'chiramiz
      if (isPerereboska && row?.perereboskaGroupId) {
        return api.delete(`/oplata-kv/perereboska/${row.perereboskaGroupId}`);
      }
      return api.delete(`/oplata-kv/${row!.id}`);
    },
    onSuccess: () => {
      toast.success(isPerereboska ? t('perereboskaGroupDeleted') : t('rowDeleted'));
      onDeleted(); onClose();
    },
    onError: (e: any) => toast.error(e?.message || t('deleteFailed')),
  });

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
            <Trash2 className="h-5 w-5" /> {t('deleteConfirmTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('deleteConfirmDesc')}
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 p-3 text-[13px] space-y-1">
            <div><b>Дог №:</b> <span className="font-mono">{row.contractNo}</span></div>
            <div><b>Дата:</b> {fmtDateRu(row.date)}</div>
            <div><b>Клиент:</b> {row.client || '—'}</div>
            <div><b>Объект:</b> {row.object || '—'}</div>
            {isPerereboska && (
              <div className="mt-2 pt-2 border-t border-rose-200 dark:border-rose-900 text-[12px] text-rose-800 dark:text-rose-300 inline-flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{t('perereboskaDeleteWarning')}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
          <Button
            onClick={() => delMut.mutate()}
            disabled={delMut.isPending}
            className="bg-rose-600 hover:bg-rose-700 text-white"
          >
            {delMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
            {tc('delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────
// History viewer
// ─────────────────────────────────────────────────────────
function HistoryDialog({ row, onClose }: { row: OplataKvItem | null; onClose: () => void }) {
  const t = useTranslations('oplatykv');
  const tc = useTranslations('common');
  const historyQuery = useQuery({
    queryKey: ['oplata-kv-history', row?.id],
    queryFn: () => api.get<{ ok: boolean; items: any[] }>(`/oplata-kv/${row!.id}/history?limit=200`),
    enabled: !!row,
  });

  const items = historyQuery.data?.items || [];

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-indigo-600 dark:text-indigo-400" /> {t('rowHistoryTitle')}
          </DialogTitle>
          {row && (
            <DialogDescription className="font-mono text-[12px]">
              Дог № {row.contractNo} · {fmtDateRu(row.date)}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-2 py-2">
          {historyQuery.isLoading && Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
          {!historyQuery.isLoading && items.length === 0 && (
            <div className="text-center text-slate-400 dark:text-slate-500 py-8">{t('historyEmpty')}</div>
          )}
          {items.map((h) => (
            <div key={h.id} className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-3 bg-white dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <ActionBadge action={h.action} />
                  <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">{h.actorName || t('system')}</span>
                </div>
                <span className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">{fmtDateTime(h.createdAt)}</span>
              </div>
              {Array.isArray(h.fieldsChanged) && h.fieldsChanged.length > 0 && h.fieldsChanged[0] !== '*' && (
                <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1">
                  {t('changedFields')}: <span className="font-mono text-slate-700 dark:text-slate-300">{h.fieldsChanged.join(', ')}</span>
                </div>
              )}
              {h.changes && typeof h.changes === 'object' && (
                <details className="mt-1.5">
                  <summary className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 cursor-pointer">{t('detail')}</summary>
                  <pre className="mt-1.5 text-[10.5px] bg-slate-50 dark:bg-slate-900 rounded p-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(h.changes, null, 2)}</pre>
                </details>
              )}
              {h.note && <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1 italic">{h.note}</div>}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tc('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionBadge({ action }: { action: string }) {
  const cls = {
    created:  'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900',
    edited:   'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900',
    deleted:  'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
    imported: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-900',
  }[action] || 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700';
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ring-1', cls)}>
      {action}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════
// ADD CHOICE DIALOG — "Qoshish" bosilganda 2 ta variantni tanlash
// ═════════════════════════════════════════════════════════════════════
function AddChoiceDialog({
  open, onClose, onPickManual, onPickPerereboska,
}: {
  open: boolean; onClose: () => void;
  onPickManual: () => void;
  onPickPerereboska: () => void;
}) {
  const t = useTranslations('oplatykv');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[640px] p-0 overflow-hidden gap-0">
        <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 pt-6 pb-5 text-white">
          <div className="text-[10px] uppercase tracking-widest font-bold text-white/70 mb-1">
            {t('newRecord')}
          </div>
          <div className="text-xl font-black tracking-tight">{t('whichRecordType')}</div>
          <div className="text-[12px] text-white/80 mt-1">
            {t('addChoiceDesc')}
          </div>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4 bg-slate-50/40 dark:bg-slate-900">
          {/* Variant 1: Oddiy */}
          <button
            onClick={onPickManual}
            className="group relative rounded-2xl bg-white dark:bg-slate-900 ring-2 ring-slate-200 dark:ring-slate-700 hover:ring-indigo-500 hover:shadow-xl transition-all p-5 text-left overflow-hidden"
          >
            <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br from-indigo-100 to-violet-100 opacity-50 group-hover:opacity-80 transition-opacity" />
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-md mb-3">
                <PlusCircle className="h-6 w-6" />
              </div>
              <div className="font-bold text-slate-900 dark:text-slate-100 text-[15px]">{t('regularPayment')}</div>
              <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {t('regularPaymentDesc')}
              </div>
              <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1">
                {t('start')} <ChevronRight className="h-3 w-3" />
              </div>
            </div>
          </button>

          {/* Variant 2: Переброска */}
          <button
            onClick={onPickPerereboska}
            className="group relative rounded-2xl bg-white dark:bg-slate-900 ring-2 ring-slate-200 dark:ring-slate-700 hover:ring-fuchsia-500 hover:shadow-xl transition-all p-5 text-left overflow-hidden"
          >
            <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br from-fuchsia-100 to-amber-100 opacity-50 group-hover:opacity-80 transition-opacity" />
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-600 grid place-items-center text-white shadow-md mb-3">
                <ArrowRightLeft className="h-6 w-6" />
              </div>
              <div className="font-bold text-slate-900 dark:text-slate-100 text-[15px] inline-flex items-center gap-1.5">
                Переброска
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300 ring-1 ring-fuchsia-200 dark:ring-fuchsia-900">
                  {t('badgeNew')}
                </span>
              </div>
              <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {t('perereboskaCardDesc')}
              </div>
              <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-fuchsia-600 dark:text-fuchsia-400 inline-flex items-center gap-1">
                {t('start')} <ChevronRight className="h-3 w-3" />
              </div>
            </div>
          </button>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-end">
          <Button variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════
// PERERBOSKA DIALOG — shartnomadan shartnomaga pul o'tkazma
// ═════════════════════════════════════════════════════════════════════
interface PerereboskaDest {
  contractNo: string;
  amount: string;          // raw money string
  customerName: string | null;
  objectName: string | null;
  foundInCrm: boolean;
  totalPaid: number;       // hozirgi jami to'lov (yangi qator qo'shilgandan keyingi hisob uchun)
  lookupStatus: 'idle' | 'loading' | 'found' | 'not-found' | 'error';
  lookupMsg?: string;
}

// Shartnoma raqami avtoto'ldirish — qisman yozganda mos keladiganlarni dropdown'da ko'rsatadi.
// Foydalanuvchi to'liq raqamni yodda saqlashi shart emas.
function ContractAutocomplete({
  value, onChange, placeholder, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const skipNextRef = useRef(false); // tanlanganidan keyingi qidiruvni o'tkazib yuborish

  useEffect(() => {
    if (skipNextRef.current) { skipNextRef.current = false; return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = value.trim();
    if (q.length < 2) { setItems([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get<{ ok: boolean; items: string[] }>(
          `/oplata-kv/contract-suggest?q=${encodeURIComponent(q)}`,
        );
        const list = res.items || [];
        setItems(list);
        // Aynan bitta va to'liq mos bo'lsa — dropdown ko'rsatmaymiz
        setOpen(list.length > 0 && !(list.length === 1 && list[0].toUpperCase() === q.toUpperCase()));
        setHighlight(-1);
      } catch {
        setItems([]); setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const select = (v: string) => {
    skipNextRef.current = true;
    onChange(v);
    setOpen(false);
    setItems([]);
  };

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (items.length > 0) setOpen(true); }}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); select(items[highlight]); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {loading && (
        <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400 pointer-events-none" />
      )}
      {open && items.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-lg bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 shadow-lg py-1">
          {items.map((it, i) => (
            <button
              key={it}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select(it); }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                'w-full text-left px-3 py-1.5 text-[13px] font-mono transition-colors',
                i === highlight
                  ? 'bg-fuchsia-50 dark:bg-fuchsia-950/40 text-fuchsia-800 dark:text-fuchsia-200'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50',
              )}
            >
              {it}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PerereboskaDialog({
  open, onClose, onSaved,
}: { open: boolean; onClose: () => void; onSaved: () => void; }) {
  const t = useTranslations('oplatykv');
  const tc = useTranslations('common');
  const [fromCn, setFromCn] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');             // raw money
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);

  // Source CRM holati
  const [fromInfo, setFromInfo] = useState<{
    customerName: string | null; objectName: string | null;
    totalPaid: number; foundInCrm: boolean;
  } | null>(null);
  const [fromLookup, setFromLookup] = useState<{
    status: 'idle' | 'loading' | 'found' | 'not-found' | 'error'; msg?: string;
  }>({ status: 'idle' });

  const [destinations, setDestinations] = useState<PerereboskaDest[]>([
    { contractNo: '', amount: '', customerName: null, objectName: null, foundInCrm: false, totalPaid: 0, lookupStatus: 'idle' },
  ]);

  const [submitting, setSubmitting] = useState(false);

  // Reset on close/open
  useEffect(() => {
    if (!open) return;
    setFromCn('');
    setDate(new Date().toISOString().slice(0, 10));
    setAmount('');
    setNote('');
    setFile(null);
    setFromInfo(null);
    setFromLookup({ status: 'idle' });
    setDestinations([{ contractNo: '', amount: '', customerName: null, objectName: null, foundInCrm: false, totalPaid: 0, lookupStatus: 'idle' }]);
  }, [open]);

  // ────── Source lookup (debounced) ──────
  const sourceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open) return;
    if (sourceTimerRef.current) clearTimeout(sourceTimerRef.current);
    const cn = fromCn.trim();
    if (!cn) {
      setFromLookup({ status: 'idle' });
      setFromInfo(null);
      return;
    }
    sourceTimerRef.current = setTimeout(async () => {
      setFromLookup({ status: 'loading' });
      try {
        const res = await api.get<{
          ok: boolean; totalPaid: number;
          customerName: string | null; objectName: string | null;
          foundInCrm: boolean;
        }>(`/oplata-kv/contract-balance?contractNo=${encodeURIComponent(cn)}`);
        if (!res.foundInCrm) {
          setFromLookup({ status: 'not-found', msg: t('crmNotFound') });
          setFromInfo(null);
        } else {
          setFromInfo({
            customerName: res.customerName,
            objectName: res.objectName,
            totalPaid: res.totalPaid,
            foundInCrm: true,
          });
          setFromLookup({
            status: 'found',
            msg: t('clientFound', { client: res.customerName || '?', object: res.objectName || '?', balance: formatMoney(res.totalPaid) }),
          });
        }
      } catch (e: any) {
        setFromLookup({ status: 'error', msg: e?.message || t('requestError') });
        setFromInfo(null);
      }
    }, 600);
    return () => { if (sourceTimerRef.current) clearTimeout(sourceTimerRef.current); };
  }, [fromCn, open]);

  // ────── Destination lookup (per index, debounced) ──────
  const destTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const lookupDestination = (idx: number, cn: string) => {
    if (destTimersRef.current[idx]) clearTimeout(destTimersRef.current[idx]);
    if (!cn.trim()) {
      setDestinations((prev) => prev.map((d, i) => i === idx ? {
        ...d, customerName: null, objectName: null, foundInCrm: false, totalPaid: 0, lookupStatus: 'idle', lookupMsg: undefined,
      } : d));
      return;
    }
    destTimersRef.current[idx] = setTimeout(async () => {
      setDestinations((prev) => prev.map((d, i) => i === idx ? { ...d, lookupStatus: 'loading' } : d));
      try {
        const res = await api.get<{
          ok: boolean; totalPaid: number;
          customerName: string | null; objectName: string | null; foundInCrm: boolean;
        }>(`/oplata-kv/contract-balance?contractNo=${encodeURIComponent(cn.trim())}`);
        if (!res.foundInCrm) {
          setDestinations((prev) => prev.map((d, i) => i === idx ? {
            ...d, customerName: null, objectName: null, foundInCrm: false, totalPaid: 0,
            lookupStatus: 'not-found', lookupMsg: t('crmNotFound'),
          } : d));
        } else {
          setDestinations((prev) => prev.map((d, i) => i === idx ? {
            ...d,
            customerName: res.customerName,
            objectName: res.objectName,
            foundInCrm: true,
            totalPaid: res.totalPaid,
            lookupStatus: 'found',
            lookupMsg: t('currentLabel', { amount: formatMoney(res.totalPaid) }),
          } : d));
        }
      } catch (e: any) {
        setDestinations((prev) => prev.map((d, i) => i === idx ? {
          ...d, lookupStatus: 'error', lookupMsg: e?.message || t('requestError'),
        } : d));
      }
    }, 600);
  };

  // ────── Validatsiya ──────
  const amountNum = moneyToNumber(amount);
  const destSumNum = destinations.reduce((s, d) => s + (moneyToNumber(d.amount) || 0), 0);
  const destSumOk = amountNum !== undefined && Math.abs(destSumNum - amountNum) < 0.01;
  const allObjectsMatch = !!fromInfo?.objectName
    && destinations.every((d) => !d.foundInCrm || d.objectName === fromInfo.objectName);
  const overBalance = !!fromInfo && amountNum !== undefined && amountNum > fromInfo.totalPaid + 0.01;
  const everyDestFoundAndPositive = destinations.every((d) =>
    d.foundInCrm && d.contractNo.trim() && (moneyToNumber(d.amount) || 0) > 0,
  );

  // Manba shartnoma maqsadli ro'yxatda bo'lmasligi kerak (o'z-o'ziga otkazma — qadag'an)
  const fromCnNorm = fromCn.trim().toUpperCase();
  const sameAsSource = (cn: string) =>
    !!fromCnNorm && cn.trim().toUpperCase() === fromCnNorm;
  const noSelfTransfer = destinations.every((d) => !sameAsSource(d.contractNo));
  // Maqsadli shartnomalar bir-biri bilan ham takrorlanmasligi kerak (ixtiyoriy lekin foydali)
  const destDuplicates = destinations
    .map((d) => d.contractNo.trim().toUpperCase())
    .filter(Boolean);
  const hasDuplicateDest = new Set(destDuplicates).size !== destDuplicates.length;

  const canSave =
    !!fromInfo?.foundInCrm &&
    !!fromInfo?.objectName &&
    amountNum !== undefined && amountNum > 0 &&
    !overBalance &&
    destinations.length > 0 &&
    everyDestFoundAndPositive &&
    allObjectsMatch &&
    destSumOk &&
    noSelfTransfer &&
    !hasDuplicateDest &&
    !!date &&
    !!file &&
    !submitting;

  const handleSave = async () => {
    if (!canSave || !file) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('fromContractNo', fromCn.trim());
      fd.append('amount', String(amountNum));
      fd.append('date', date);
      fd.append('note', note);
      fd.append('destinations', JSON.stringify(
        destinations.map((d) => ({
          contractNo: d.contractNo.trim(),
          amount: moneyToNumber(d.amount),
        })),
      ));
      fd.append('file', file);

      await api.postForm('/oplata-kv/perereboska', fd, { timeout: 60_000 });
      toast.success(t('perereboskaSaved'));
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || t('genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  const addDestination = () => {
    setDestinations((prev) => [...prev, {
      contractNo: '', amount: '', customerName: null, objectName: null, foundInCrm: false, totalPaid: 0, lookupStatus: 'idle',
    }]);
  };
  const removeDestination = (idx: number) => {
    setDestinations((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent
        className="sm:max-w-[1100px] w-[96vw] p-0 overflow-hidden gap-0 max-h-[95vh] flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {/* Hero header */}
        <div className="bg-gradient-to-br from-fuchsia-600 via-pink-600 to-rose-600 px-6 pt-5 pb-4 text-white shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-white/15 grid place-items-center">
              <ArrowRightLeft className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/70">{t('newTransaction')}</div>
              <div className="text-xl font-black tracking-tight">Переброска</div>
            </div>
          </div>
          <div className="text-[11.5px] text-white/80 mt-2">
            {t('perereboskaHeroDesc')}
          </div>
        </div>

        {/* Body — scrollable (flex-1 minh-0 to allow shrink so footer stays visible) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 bg-slate-50/30 dark:bg-slate-900">
          {/* SOURCE block */}
          <div className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-fuchsia-700 dark:text-fuchsia-300">
              <Upload className="h-4 w-4" /> {t('stepSource')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ДОГ № *">
                <ContractAutocomplete
                  value={fromCn}
                  onChange={setFromCn}
                  placeholder="606ZUR236J"
                  disabled={submitting}
                />
              </Field>
              <Field label="Дата *">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={submitting} />
              </Field>
            </div>
            {/* Loading/not-found/error status faqat (found bo'lsa kartalar ko'rsatiladi) */}
            {fromLookup.status !== 'idle' && fromLookup.status !== 'found' && (
              <div className={cn(
                'rounded-lg px-3 py-2.5 text-[12.5px] font-medium ring-1 inline-flex items-center gap-2',
                fromLookup.status === 'loading' && 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
                fromLookup.status === 'not-found' && 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
                fromLookup.status === 'error' && 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
              )}>
                {fromLookup.status === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
                {fromLookup.status !== 'loading' && <X className="h-4 w-4" />}
                {fromLookup.status === 'loading' ? t('crmChecking') : fromLookup.msg}
              </div>
            )}
            {fromInfo?.foundInCrm && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/50 ring-1 ring-slate-200 dark:ring-slate-700 p-3.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                    <User2 className="h-3 w-3" /> {t('client')}
                  </div>
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-200 leading-tight" title={fromInfo.customerName || ''}>
                    {fromInfo.customerName || '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-violet-50 to-violet-100/50 ring-1 ring-violet-200 dark:ring-violet-900 p-3.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-violet-700 dark:text-violet-300 mb-1.5">
                    <Building2 className="h-3 w-3" /> {t('objectLabel')}
                  </div>
                  <div className="text-[15px] font-black text-violet-900 dark:text-violet-300 leading-tight">
                    {fromInfo.objectName || '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 ring-1 ring-emerald-200 dark:ring-emerald-900 p-3.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-300 mb-1.5">
                    <Wallet className="h-3 w-3" /> {t('currentBalance')}
                  </div>
                  <div className="text-[16px] font-black text-emerald-800 dark:text-emerald-300 leading-tight tabular-nums">
                    {formatMoney(fromInfo.totalPaid)}
                  </div>
                  <div className="text-[10px] text-emerald-600/70 dark:text-emerald-400 mt-0.5">UZS</div>
                </div>
              </div>
            )}
          </div>

          {/* AMOUNT block */}
          <div className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-fuchsia-700 dark:text-fuchsia-300">
              <Wallet className="h-4 w-4" /> {t('stepAmount')}
            </div>
            <Field label={t('amountNegative')}>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-600 dark:text-rose-400 font-bold pointer-events-none">−</span>
                <MoneyInput
                  value={amount}
                  onChange={setAmount}
                  placeholder="100 000"
                  disabled={submitting}
                  className="pl-7"
                />
              </div>
            </Field>
            {amountNum !== undefined && fromInfo && (
              overBalance ? (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-4 py-3 flex items-start gap-2.5">
                  <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
                  <div className="text-[13px] text-rose-800 dark:text-rose-300 leading-relaxed">
                    <div className="font-bold mb-0.5">{t('amountOverBalance')}</div>
                    <div className="text-rose-700 dark:text-rose-300">
                      {t('written')}: <b className="tabular-nums">{formatMoney(amountNum)}</b>
                      <span className="mx-1.5 text-rose-400 dark:text-rose-500">›</span>
                      {t('balance')}: <b className="tabular-nums">{formatMoney(fromInfo.totalPaid)}</b>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-gradient-to-br from-rose-50 to-pink-50 ring-1 ring-rose-200 dark:ring-rose-900 p-3.5">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-rose-600 dark:text-rose-400 mb-1">{t('willDeduct')}</div>
                    <div className="text-[16px] font-black text-rose-700 dark:text-rose-300 tabular-nums leading-tight">
                      −{formatMoney(amountNum)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 p-3.5">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1">{t('currentBalanceShort')}</div>
                    <div className="text-[14.5px] font-bold text-slate-700 dark:text-slate-300 tabular-nums leading-tight">
                      {formatMoney(fromInfo.totalPaid)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 ring-1 ring-emerald-200 dark:ring-emerald-900 p-3.5">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-300 mb-1">{t('newBalance')}</div>
                    <div className="text-[16px] font-black text-emerald-800 dark:text-emerald-300 tabular-nums leading-tight">
                      {formatMoney(fromInfo.totalPaid - amountNum)}
                    </div>
                  </div>
                </div>
              )
            )}
          </div>

          {/* DESTINATIONS block */}
          <div className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-fuchsia-700 dark:text-fuchsia-300">
                <Building2 className="h-4 w-4" /> {t('stepDestinations', { n: destinations.length })}
              </div>
              <button
                onClick={addDestination}
                disabled={submitting}
                className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-fuchsia-700 dark:text-fuchsia-300 bg-fuchsia-50 dark:bg-fuchsia-950/40 hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/30 ring-1 ring-fuchsia-200 dark:ring-fuchsia-900 transition-colors inline-flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> {t('addContract')}
              </button>
            </div>
            {!fromInfo?.objectName && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-300 inline-flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('selectSourceFirst')}
              </div>
            )}
            {destinations.map((d, idx) => {
              const objMatch = !d.foundInCrm || d.objectName === fromInfo?.objectName;
              const dAmt = moneyToNumber(d.amount);
              const isSelfTransfer = sameAsSource(d.contractNo);
              // Bir xil destination ikkinchi marta yozilganmi
              const dCnNorm = d.contractNo.trim().toUpperCase();
              const isDuplicateOfPrev = !!dCnNorm && destinations
                .slice(0, idx)
                .some((p) => p.contractNo.trim().toUpperCase() === dCnNorm);
              return (
                <div key={idx} className={cn(
                  'rounded-lg ring-1 p-3 space-y-2.5',
                  isSelfTransfer || isDuplicateOfPrev
                    ? 'bg-rose-50/60 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900'
                    : 'bg-slate-50/60 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700',
                )}>
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      #{idx + 1}
                    </div>
                    {destinations.length > 1 && (
                      <button
                        onClick={() => removeDestination(idx)}
                        disabled={submitting}
                        className="w-6 h-6 rounded grid place-items-center text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="ДОГ № *">
                      <ContractAutocomplete
                        value={d.contractNo}
                        onChange={(v) => {
                          setDestinations((prev) => prev.map((x, i) => i === idx ? { ...x, contractNo: v } : x));
                          lookupDestination(idx, v);
                        }}
                        placeholder="1020AFS25QZ"
                        disabled={submitting}
                      />
                    </Field>
                    <Field label={`${tc('amount')} *`}>
                      <MoneyInput
                        value={d.amount}
                        onChange={(v) => setDestinations((prev) => prev.map((x, i) => i === idx ? { ...x, amount: v } : x))}
                        placeholder="50 000"
                        disabled={submitting}
                      />
                    </Field>
                  </div>
                  {/* Self-transfer warning — manba va maqsadli bir xil shartnoma bo'lmasligi */}
                  {isSelfTransfer && (
                    <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-4 py-3 flex items-start gap-2.5">
                      <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
                      <div className="text-[12.5px] text-rose-800 dark:text-rose-300 leading-relaxed">
                        <div className="font-bold mb-0.5">{t('selfTransferTitle')}</div>
                        <div className="text-rose-700 dark:text-rose-300">
                          <code className="font-mono font-bold">{fromCn.trim()}</code> {t('selfTransferDesc')}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Duplicate destination warning */}
                  {isDuplicateOfPrev && (
                    <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-4 py-3 flex items-start gap-2.5">
                      <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
                      <div className="text-[12.5px] text-rose-800 dark:text-rose-300 leading-relaxed">
                        <div className="font-bold mb-0.5">{t('duplicateDestTitle')}</div>
                        <div className="text-rose-700 dark:text-rose-300">
                          <code className="font-mono font-bold">{d.contractNo.trim()}</code> {t('duplicateDestDesc')}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Loading/error pill */}
                  {!isSelfTransfer && !isDuplicateOfPrev && (d.lookupStatus === 'loading' || d.lookupStatus === 'not-found' || d.lookupStatus === 'error') && (
                    <div className={cn(
                      'rounded-lg px-3 py-2 text-[12px] font-medium ring-1 inline-flex items-center gap-1.5',
                      d.lookupStatus === 'loading' && 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
                      d.lookupStatus !== 'loading' && 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
                    )}>
                      {d.lookupStatus === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {d.lookupStatus !== 'loading' && <X className="h-3.5 w-3.5" />}
                      {d.lookupStatus === 'loading' ? t('crmChecking') : (d.lookupMsg || t('lookupError'))}
                    </div>
                  )}
                  {/* Object mismatch warning */}
                  {!isSelfTransfer && !isDuplicateOfPrev && d.lookupStatus === 'found' && !objMatch && (
                    <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-4 py-3 flex items-start gap-2.5">
                      <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
                      <div className="text-[12.5px] text-rose-800 dark:text-rose-300 leading-relaxed">
                        <div className="font-bold mb-0.5">{t('objectMismatchTitle')}</div>
                        <div className="text-rose-700 dark:text-rose-300">
                          <b>{d.objectName}</b>
                          <span className="mx-1.5 text-rose-400 dark:text-rose-500">≠</span>
                          <b>{fromInfo?.objectName}</b>
                          <span className="ml-1.5 text-rose-500/80 dark:text-rose-400">{t('objectMismatchHint')}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Found OK — cards */}
                  {!isSelfTransfer && !isDuplicateOfPrev && d.lookupStatus === 'found' && objMatch && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2 sm:col-span-1">
                        <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                          <User2 className="h-2.5 w-2.5" /> {t('client')}
                        </div>
                        <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 truncate" title={d.customerName || ''}>
                          {d.customerName || '—'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2">
                        <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-0.5">{t('currentColLabel')}</div>
                        <div className="text-[12.5px] font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                          {formatMoney(d.totalPaid)}
                        </div>
                      </div>
                      <div className={cn(
                        'rounded-lg px-3 py-2 ring-1',
                        dAmt !== undefined && dAmt > 0
                          ? 'bg-gradient-to-br from-emerald-50 to-teal-50 ring-emerald-200 dark:ring-emerald-900'
                          : 'bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700',
                      )}>
                        <div className={cn(
                          'text-[9.5px] uppercase tracking-wider font-bold mb-0.5',
                          dAmt !== undefined && dAmt > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400',
                        )}>{t('future')}</div>
                        <div className={cn(
                          'text-[12.5px] font-black tabular-nums',
                          dAmt !== undefined && dAmt > 0 ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-500',
                        )}>
                          {dAmt !== undefined && dAmt > 0 ? formatMoney(d.totalPaid + dAmt) : '—'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Dest summa indikator */}
            {amountNum !== undefined && (
              <div className={cn(
                'rounded-xl p-3.5 ring-1 flex items-center gap-3',
                destSumOk
                  ? 'bg-gradient-to-br from-emerald-50 to-teal-50 ring-emerald-200 dark:ring-emerald-900'
                  : 'bg-gradient-to-br from-rose-50 to-pink-50 ring-rose-200 dark:ring-rose-900',
              )}>
                <div className={cn(
                  'w-10 h-10 rounded-xl grid place-items-center shrink-0',
                  destSumOk ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white',
                )}>
                  {destSumOk
                    ? <CheckCircle2 className="h-5 w-5" />
                    : <AlertTriangle className="h-5 w-5" />}
                </div>
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px]">
                  <div>
                    <div className={cn('text-[9.5px] uppercase tracking-wider font-bold', destSumOk ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>{t('totalDestinations')}</div>
                    <div className={cn('text-[14px] font-black tabular-nums', destSumOk ? 'text-emerald-900 dark:text-emerald-300' : 'text-rose-900 dark:text-rose-300')}>
                      {formatMoney(destSumNum)}
                    </div>
                  </div>
                  <div>
                    <div className={cn('text-[9.5px] uppercase tracking-wider font-bold', destSumOk ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>{t('source')}</div>
                    <div className={cn('text-[14px] font-black tabular-nums', destSumOk ? 'text-emerald-900 dark:text-emerald-300' : 'text-rose-900 dark:text-rose-300')}>
                      {formatMoney(amountNum)}
                    </div>
                  </div>
                  {!destSumOk && (
                    <div>
                      <div className="text-[9.5px] uppercase tracking-wider font-bold text-rose-700 dark:text-rose-300">{t('difference')}</div>
                      <div className="text-[14px] font-black text-rose-900 dark:text-rose-300 tabular-nums">
                        {formatMoney(destSumNum - amountNum)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* FILE + NOTE block */}
          <div className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-fuchsia-700 dark:text-fuchsia-300">
              <Paperclip className="h-4 w-4" /> {t('stepDocument')}
            </div>
            <Field label={t('documentLabel')} full>
              <label className={cn(
                "flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 cursor-pointer transition-colors",
                file ? 'border-emerald-300 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/40' : 'border-slate-300 dark:border-slate-700 hover:border-fuchsia-400 hover:bg-fuchsia-50/30 dark:hover:bg-fuchsia-950/40',
              )}>
                <Upload className={cn("h-5 w-5", file ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')} />
                <div className="flex-1 min-w-0">
                  {file ? (
                    <>
                      <div className="text-[12.5px] font-bold text-emerald-700 dark:text-emerald-300 truncate">{file.name}</div>
                      <div className="text-[10.5px] text-slate-500 dark:text-slate-400">{(file.size / 1024).toFixed(1)} KB · {file.type}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">{t('selectDocument')}</div>
                      <div className="text-[10.5px] text-slate-500 dark:text-slate-400">{t('documentHint')}</div>
                    </>
                  )}
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  disabled={submitting}
                />
              </label>
            </Field>
            <Field label={t('noteLabel')} full>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('optionalPlaceholder')} disabled={submitting} />
            </Field>
          </div>
        </div>

        {/* Footer — sticky, shrink-0, doim ko'rinadigan */}
        <div className="shrink-0 px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.06)]">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex-1 min-w-0 truncate">
            {!canSave && fromInfo?.foundInCrm && !noSelfTransfer && t('footerSelfTransfer')}
            {!canSave && fromInfo?.foundInCrm && noSelfTransfer && hasDuplicateDest && t('footerDuplicate')}
            {!canSave && fromInfo?.foundInCrm && noSelfTransfer && !hasDuplicateDest && !file && t('footerNoFile')}
            {!canSave && fromInfo?.foundInCrm && noSelfTransfer && !hasDuplicateDest && file && !destSumOk && t('footerSumMismatch')}
            {!canSave && fromInfo?.foundInCrm && noSelfTransfer && !hasDuplicateDest && file && destSumOk && !allObjectsMatch && t('footerObjectMismatch')}
            {!canSave && fromInfo?.foundInCrm && noSelfTransfer && !hasDuplicateDest && file && destSumOk && allObjectsMatch && overBalance && t('footerOverBalance')}
            {canSave && t('footerReady')}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>{tc('cancel')}</Button>
            <Button
              onClick={handleSave}
              disabled={!canSave}
              className="bg-gradient-to-br from-fuchsia-600 to-pink-600 text-white shadow-lg shadow-fuchsia-500/30 hover:shadow-fuchsia-500/50 h-10 px-5"
            >
              {submitting
                ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
              {submitting ? t('saving') : t('confirmAndSave')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
