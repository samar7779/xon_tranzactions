'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Plus, Edit3, Trash2, History, X, ChevronLeft, ChevronRight,
  Calendar, Loader2, Hash, ArrowUpRight, Filter as FilterIcon,
  Receipt, User2, Home, CreditCard, FileText, Tag as TagIcon, Activity,
  Copy, Check, Download, FileSpreadsheet, FileJson, Printer,
} from 'lucide-react';
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
}

const CATEGORY_LABEL: Record<Category, string> = {
  MONTHLY: 'ежемесячный',
  FIRST:   '1 взнос',
  GENERAL: 'Общий',
};

const CATEGORY_CLS: Record<Category, string> = {
  MONTHLY: 'bg-sky-50 text-sky-700 ring-sky-200',
  FIRST:   'bg-amber-50 text-amber-700 ring-amber-200',
  GENERAL: 'bg-violet-50 text-violet-700 ring-violet-200',
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
  if (v === null || v === undefined || v === '') return 'text-slate-400';
  const n = typeof v === 'string' ? Number(v) : v;
  if (!isFinite(n) || n === 0) return 'text-slate-400';
  return n > 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold';
}

export default function OplataKvPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = !!user?.permissions?.includes(PERMS.OPLATAKV_MANAGE);

  // Filters
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  // Dialog state
  const [detailRow, setDetailRow] = useState<OplataKvItem | null>(null);
  const [editRow, setEditRow] = useState<OplataKvItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<OplataKvItem | null>(null);
  const [historyRow, setHistoryRow] = useState<OplataKvItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Per-column filter (Google Sheets style)
  const [columnFilterMode, setColumnFilterMode] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);

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
      toast.success(`ID nusxalandi: ${id.slice(0, 12)}…`);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    } catch {
      toast.error('Nusxalashda xato');
    }
  };

  // ─── Export — filter-aware ───
  // qsForExport: page/perPage'siz, qolgan filtrlar
  const qsForExport = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo)   p.set('dateTo', dateTo);
    if (categoryFilter !== 'all') p.set('paymentCategory', categoryFilter);
    return p.toString();
  }, [q, dateFrom, dateTo, categoryFilter]);

  const [exporting, setExporting] = useState<null | 'xlsx' | 'json' | 'pdf'>(null);

  const downloadExcel = async () => {
    setExporting('xlsx');
    try {
      const ts = new Date().toISOString().slice(0, 10);
      await apiDownload(`/oplata-kv/export?${qsForExport}`, `oplaty-kv-${ts}.xlsx`);
      toast.success('Excel yuklab olindi');
    } catch (e: any) {
      toast.error(e?.message || 'Excel yuklab olishda xato');
    } finally {
      setExporting(null);
    }
  };

  const downloadJson = async () => {
    setExporting('json');
    try {
      const ts = new Date().toISOString().slice(0, 10);
      await apiDownload(`/oplata-kv/export-json?${qsForExport}`, `oplaty-kv-${ts}.json`);
      toast.success('JSON yuklab olindi');
    } catch (e: any) {
      toast.error(e?.message || 'JSON yuklab olishda xato');
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
  };

  // columnFilters Set object — JSON serialization uchun
  const columnFiltersKey = JSON.stringify(
    Object.fromEntries(
      Object.entries(columnFilters).map(([k, v]) => [k, Array.from(v).sort()]),
    ),
  );

  // URL params for list query
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('perPage', String(perPage));
    if (q.trim()) p.set('q', q.trim());
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo)   p.set('dateTo', dateTo);
    if (categoryFilter !== 'all') p.set('paymentCategory', categoryFilter);
    // Per-column filterlar (vergul bilan)
    for (const [col, paramName] of Object.entries(COLUMN_TO_PARAM)) {
      const set = columnFilters[col];
      if (set && set.size > 0) p.set(paramName, Array.from(set).join(','));
    }
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, perPage, q, dateFrom, dateTo, categoryFilter, columnFiltersKey]);

  // Filter popoverga uzatish uchun — barcha AKTIV column filterlar (page'siz)
  const activeFilterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo)   p.set('dateTo', dateTo);
    if (categoryFilter !== 'all') p.set('paymentCategory', categoryFilter);
    for (const [col, paramName] of Object.entries(COLUMN_TO_PARAM)) {
      const set = columnFilters[col];
      if (set && set.size > 0) p.set(paramName, Array.from(set).join(','));
    }
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, dateFrom, dateTo, categoryFilter, columnFiltersKey]);

  // Aktiv column filterlar soni — badge uchun
  const activeColumnFiltersCount = Object.values(columnFilters).filter((s) => s && s.size > 0).length;

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

  // Filtr o'zgarganda sahifani 1-ga qaytarish
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [q, dateFrom, dateTo, categoryFilter, perPage, columnFiltersKey]);

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
          <CountCard label="Жами yozuv"  count={total} />
        </div>

        {/* ═══ Filter bar ═══ */}
        <Card className="border-0 shadow-soft overflow-visible">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  className="pl-9 h-10 rounded-xl bg-slate-50/60"
                  placeholder="Qidiruv — Дог №, Клиент, Объект, Назначение..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full grid place-items-center text-slate-400 hover:text-white hover:bg-rose-500"
                    onClick={() => setQ('')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Sana filtri — icon ichida (collapsed) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      'h-10 px-3 rounded-xl ring-1 inline-flex items-center gap-2 text-[13px] transition-colors',
                      (dateFrom || dateTo)
                        ? 'bg-indigo-50 ring-indigo-200 text-indigo-700 hover:bg-indigo-100'
                        : 'bg-slate-50/60 ring-slate-200 text-slate-600 hover:bg-slate-100',
                    )}
                    title="Sana oralig'i"
                  >
                    <Calendar className="h-4 w-4" />
                    <span className="font-medium">
                      {(dateFrom || dateTo)
                        ? `${dateFrom ? fmtDateRu(dateFrom) : '…'} — ${dateTo ? fmtDateRu(dateTo) : '…'}`
                        : "Sana oralig'i"}
                    </span>
                    {(dateFrom || dateTo) && (
                      <span
                        className="ml-1 w-4 h-4 rounded-full grid place-items-center hover:bg-rose-500 hover:text-white"
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setDateFrom(''); setDateTo(''); }}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="p-3 w-[280px] space-y-2">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Sana oralig'i</div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-600">Boshlanish</label>
                    <Input
                      type="date"
                      className="h-9 rounded-lg"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-600">Tugash</label>
                    <Input
                      type="date"
                      className="h-9 rounded-lg"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </div>
                  {(dateFrom || dateTo) && (
                    <button
                      className="w-full h-8 rounded-lg text-[12px] font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
                      onClick={() => { setDateFrom(''); setDateTo(''); }}
                    >
                      Tozalash
                    </button>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-10 rounded-xl w-[170px]">
                  <FilterIcon className="h-4 w-4 mr-1 text-slate-400" />
                  <SelectValue placeholder="Оплата" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barchasi (Оплата)</SelectItem>
                  <SelectItem value="MONTHLY">ежемесячный</SelectItem>
                  <SelectItem value="FIRST">1 взнос</SelectItem>
                  <SelectItem value="GENERAL">Общий</SelectItem>
                </SelectContent>
              </Select>

              {/* Ustun filter rejimi toggle */}
              <button
                onClick={() => {
                  setColumnFilterMode((v) => !v);
                  if (columnFilterMode) {
                    // Yopayotganda — barcha column filterlarni tozalash
                    setColumnFilters({});
                    setOpenFilterColumn(null);
                  }
                }}
                className={cn(
                  'relative h-10 px-3 rounded-xl ring-1 inline-flex items-center gap-1.5 text-[13px] font-semibold transition-colors',
                  columnFilterMode
                    ? 'bg-indigo-600 text-white ring-indigo-700 hover:bg-indigo-700 shadow-md shadow-indigo-500/30'
                    : 'bg-slate-50/60 text-slate-700 ring-slate-200 hover:bg-slate-100',
                )}
                title={columnFilterMode ? "Ustun filter rejimini o'chirish" : "Ustun filter rejimini yoqish"}
              >
                <FilterIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Ustun filter</span>
                {activeColumnFiltersCount > 0 && (
                  <span className="ml-0.5 min-w-[18px] h-[18px] rounded-full bg-white text-indigo-700 text-[10px] font-bold grid place-items-center px-1">
                    {activeColumnFiltersCount}
                  </span>
                )}
              </button>

              {/* Download dropdown — filter-aware */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="h-10 px-3 rounded-xl bg-slate-50/60 ring-1 ring-slate-200 hover:bg-slate-100 text-slate-700 inline-flex items-center gap-1.5 text-[13px] font-semibold transition-colors"
                    title="Yuklab olish"
                  >
                    {exporting
                      ? <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                      : <Download className="h-4 w-4" />}
                    <span className="hidden sm:inline">Yuklab olish</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px]">
                  <DropdownMenuItem onClick={downloadExcel} className="gap-2 cursor-pointer">
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold">Excel (.xlsx)</div>
                      <div className="text-[10.5px] text-slate-500">Filtr bo'yicha barchasi</div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={downloadJson} className="gap-2 cursor-pointer">
                    <FileJson className="h-4 w-4 text-amber-600" />
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold">JSON (.json)</div>
                      <div className="text-[10.5px] text-slate-500">Filtr bo'yicha barchasi</div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={printPdf} className="gap-2 cursor-pointer">
                    <Printer className="h-4 w-4 text-indigo-600" />
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold">Chop etish / PDF</div>
                      <div className="text-[10.5px] text-slate-500">Brauzer print dialogi</div>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {canManage && (
                <Button
                  onClick={() => setCreateOpen(true)}
                  className="h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md"
                >
                  <Plus className="h-4 w-4 mr-1" /> Yangi qator
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ═══ Table ═══ */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10.5px] tracking-wider">
                <tr>
                  <ColumnTh label="Дог №" column="contractNo"
                    filterMode={columnFilterMode} columnFilters={columnFilters}
                    setColumnFilters={setColumnFilters}
                    openFilterColumn={openFilterColumn} setOpenFilterColumn={setOpenFilterColumn}
                    activeFilterParams={activeFilterParams} />
                  <Th>Дата</Th>
                  <Th align="right">Сумма оплаты</Th>
                  <Th align="right">1 взнос</Th>
                  <Th align="right">ежемесячный</Th>
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
                  <Th align="center">ID</Th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading && Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className="px-3 py-2.5"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))}
                {!listQuery.isLoading && items.length === 0 && (
                  <tr><td colSpan={9} className="p-12 text-center text-slate-400">
                    Hech qanday qator topilmadi
                  </td></tr>
                )}
                {items.map((it) => (
                  <tr
                    key={it.id}
                    className="border-t border-slate-100 hover:bg-indigo-50/40 transition-colors cursor-pointer"
                    onClick={() => setDetailRow(it)}
                  >
                    <td className="px-3 py-2.5 font-mono text-[12px] font-semibold text-slate-800">{it.contractNo}</td>
                    <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{fmtDateRu(it.date)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', amountCls(it.paymentAmount))}>{fmtNum(it.paymentAmount)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', amountCls(it.firstInstallment))}>{fmtNum(it.firstInstallment)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', amountCls(it.monthlyAmount))}>{fmtNum(it.monthlyAmount)}</td>
                    <td className="px-3 py-2.5">
                      {it.paymentCategory ? (
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-semibold ring-1', CATEGORY_CLS[it.paymentCategory])}>
                          {CATEGORY_LABEL[it.paymentCategory]}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[200px] truncate" title={it.object || ''}>{it.object || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5">{it.txType || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        title={`ID: ${it.id}`}
                        onClick={() => copyId(it.id)}
                        className={cn(
                          'inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors',
                          copiedId === it.id
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'text-slate-400 hover:bg-slate-100 hover:text-indigo-600',
                        )}
                      >
                        {copiedId === it.id
                          ? <Check className="h-3.5 w-3.5" />
                          : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-[12px] text-slate-500">
            <div>Jami: <b className="text-slate-700">{total.toLocaleString('ru-RU')}</b> qator</div>
            <div className="flex items-center gap-2">
              <Select value={String(perPage)} onValueChange={(v) => setPerPage(Number(v))}>
                <SelectTrigger className="h-8 w-[80px] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <button
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-slate-100 disabled:opacity-30"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              ><ChevronLeft className="h-4 w-4" /></button>
              <span className="tabular-nums">{page} / {pageCount}</span>
              <button
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-slate-100 disabled:opacity-30"
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
        canManage={canManage}
        onClose={() => setDetailRow(null)}
        onEdit={(it) => setEditRow(it)}
        onDelete={(it) => setDeleteRow(it)}
        onHistory={(it) => setHistoryRow(it)}
        onCopyId={copyId}
        copiedId={copiedId}
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

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
  const activeCount = columnFilters[column]?.size || 0;
  const isOpen = openFilterColumn === column;
  return (
    <th className="px-3 py-2.5 font-semibold whitespace-nowrap text-left relative">
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {filterMode && (
          <button
            onClick={() => setOpenFilterColumn(isOpen ? null : column)}
            className={cn(
              'relative inline-flex items-center justify-center w-5 h-5 rounded transition-colors',
              activeCount > 0
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'text-slate-400 hover:bg-indigo-100 hover:text-indigo-700',
            )}
            title={activeCount > 0 ? `${activeCount} tanlangan` : 'Filter'}
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
      {isOpen && (
        <ColumnFilterPopover
          column={column}
          label={label}
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
  column, label, selected, activeFilterParams, onChange, onClose,
}: {
  column: string;
  label: string;
  selected: Set<string>;
  activeFilterParams: string;
  onChange: (next: Set<string>) => void;
  onClose: () => void;
}) {
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
    // setTimeout so we don't catch the same click that opened us
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

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 top-full left-0 mt-1 w-[280px] bg-white ring-1 ring-slate-200 rounded-xl shadow-2xl p-2.5 text-slate-700 normal-case tracking-normal"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">
        Filter: <span className="text-slate-800">{label}</span>
      </div>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <Input
          autoFocus
          className="pl-7 h-8 text-[12px] rounded-lg"
          placeholder="Qidirish..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto -mx-1 px-1">
        {isLoading ? (
          <div className="py-6 text-center text-[12px] text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
            Yuklanmoqda...
          </div>
        ) : values.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-slate-400">
            Qiymat topilmadi
          </div>
        ) : (
          [...tanlangan, ...qolgan].map((v) => (
            <label
              key={v.id}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
                selected.has(v.id) ? 'bg-indigo-50 hover:bg-indigo-100' : 'hover:bg-slate-50',
              )}
            >
              <input
                type="checkbox"
                checked={selected.has(v.id)}
                onChange={() => toggle(v.id)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
              />
              <span className={cn('text-[12.5px] truncate flex-1', selected.has(v.id) ? 'font-semibold text-indigo-700' : 'text-slate-700')}>
                {v.name}
              </span>
            </label>
          ))
        )}
      </div>
      <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-100 gap-2">
        {selected.size > 0 ? (
          <button
            onClick={() => onChange(new Set())}
            className="text-rose-600 text-[11.5px] font-semibold hover:bg-rose-50 px-2 py-1 rounded-md transition-colors"
          >
            Tozalash ({selected.size})
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">{values.length} ta variant</span>
        )}
        <button
          onClick={onClose}
          className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded-md text-[11.5px] font-semibold transition-colors"
        >
          Tayyor
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Detail dialog — qator bosilganda barcha ma'lumotni chiroyli ko'rinishda
// ─────────────────────────────────────────────────────────
function OplataKvDetailDialog({
  row, canManage, onClose, onEdit, onDelete, onHistory, onCopyId, copiedId,
}: {
  row: OplataKvItem | null;
  canManage: boolean;
  onClose: () => void;
  onEdit: (r: OplataKvItem) => void;
  onDelete: (r: OplataKvItem) => void;
  onHistory: (r: OplataKvItem) => void;
  onCopyId: (id: string) => void;
  copiedId: string | null;
}) {
  if (!row) return null;
  const catCls = row.paymentCategory ? CATEGORY_CLS[row.paymentCategory] : '';
  const catLabel = row.paymentCategory ? CATEGORY_LABEL[row.paymentCategory] : '—';

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-3xl p-0 overflow-hidden gap-0"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
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
            <div className="flex items-center gap-3 flex-wrap">
              <div className="font-mono text-2xl font-black tracking-tight">
                {row.contractNo || '—'}
              </div>
              {row.paymentCategory && (
                <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold ring-1 bg-white/15 ring-white/30 text-white whitespace-nowrap">
                  {catLabel}
                </span>
              )}
            </div>
            <div className="text-[12px] text-white/80 mt-1.5">
              {fmtDateRu(row.date)} · <span className="font-mono">{row.id.slice(0, 8)}…</span>
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
          <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-3 text-[11px] text-slate-500">
            <div>
              <div className="uppercase tracking-wider font-semibold mb-0.5">Yaratildi</div>
              <div className="text-slate-700">{fmtDateTime(row.createdAt)}</div>
              {row.createdByName && <div className="text-slate-500">{row.createdByName}</div>}
            </div>
            <div>
              <div className="uppercase tracking-wider font-semibold mb-0.5">O'zgartirildi</div>
              <div className="text-slate-700">{fmtDateTime(row.updatedAt)}</div>
            </div>
          </div>

          {/* Full ID with copy */}
          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2.5 flex items-center gap-2">
            <Hash className="h-4 w-4 text-slate-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">ID</div>
              <code className="text-[11.5px] text-slate-700 font-mono break-all">{row.id}</code>
            </div>
            <button
              onClick={() => onCopyId(row.id)}
              className={cn(
                'shrink-0 w-8 h-8 rounded-lg grid place-items-center transition-colors',
                copiedId === row.id
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-white hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 ring-1 ring-slate-200',
              )}
              title="Nusxalash"
            >
              {copiedId === row.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
          <button
            onClick={() => onHistory(row)}
            className="h-10 px-3 rounded-xl text-[13px] font-semibold text-slate-700 hover:bg-slate-200/80 transition-colors inline-flex items-center gap-1.5"
          >
            <History className="h-4 w-4" /> Tarix
          </button>
          <div className="flex items-center gap-2">
            {canManage && (
              <>
                <button
                  onClick={() => onDelete(row)}
                  className="h-10 px-4 rounded-xl text-[13px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 ring-1 ring-rose-200 transition-colors inline-flex items-center gap-1.5"
                >
                  <Trash2 className="h-4 w-4" /> O'chirish
                </button>
                <button
                  onClick={() => onEdit(row)}
                  className="h-10 px-4 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 shadow-md inline-flex items-center gap-1.5"
                >
                  <Edit3 className="h-4 w-4" /> Tahrirlash
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ icon, label, value, multiline }: { icon: React.ReactNode; label: string; value: string | null; multiline?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-8 h-8 rounded-lg bg-slate-100 grid place-items-center text-slate-500 shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
        <div className={cn('text-[13px] text-slate-800 font-medium', multiline ? 'whitespace-pre-wrap break-words' : 'truncate')}>
          {value || <span className="text-slate-400 font-normal italic">—</span>}
        </div>
      </div>
    </div>
  );
}

function DetailSum({ label, value, color }: { label: string; value: string | number | null; color: 'indigo' | 'amber' | 'sky' }) {
  const cls = {
    indigo: 'bg-gradient-to-br from-indigo-50 to-violet-50 ring-indigo-200 text-indigo-900',
    amber:  'bg-gradient-to-br from-amber-50 to-orange-50 ring-amber-200 text-amber-900',
    sky:    'bg-gradient-to-br from-sky-50 to-cyan-50 ring-sky-200 text-sky-900',
  }[color];
  const labelCls = {
    indigo: 'text-indigo-600',
    amber:  'text-amber-600',
    sky:    'text-sky-600',
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
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
          <div className={cn('text-xl font-bold tabular-nums mt-0.5', value < 0 ? 'text-rose-600' : 'text-slate-900')}>
            {formatMoney(value, '')}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CountCard({ label, count }: { label: string; count: number }) {
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <CardContent className="p-4 flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center text-white bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/20 shrink-0">
          <Hash className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
          <div className="text-xl font-bold tabular-nums mt-0.5 text-slate-900">
            {count.toLocaleString('ru-RU')} <span className="text-sm font-semibold text-slate-400">ta</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────
// Create / Edit dialog
// ─────────────────────────────────────────────────────────
function OplataKvFormDialog({
  open, row, onClose, onSaved,
}: {
  open: boolean; row?: OplataKvItem | null;
  onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!row;

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

  const saveMut = useMutation({
    mutationFn: async () => {
      const numOrUndef = (s: string) => {
        const v = s.trim();
        if (v === '') return undefined;
        const n = Number(v.replace(/\s+/g, '').replace(',', '.'));
        return isNaN(n) ? undefined : n;
      };
      const body: any = {
        contractNo: contractNo.trim(),
        date,
        paymentAmount:    numOrUndef(paymentAmount),
        firstInstallment: numOrUndef(firstInstallment),
        monthlyAmount:    numOrUndef(monthlyAmount),
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
      toast.success(isEdit ? 'Tahrir saqlandi' : 'Qator qoshildi');
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || 'Xatolik yuz berdi'),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? <Edit3 className="h-5 w-5 text-indigo-600" /> : <Plus className="h-5 w-5 text-indigo-600" />}
            {isEdit ? 'Qatorni tahrirlash' : 'Yangi qator'}
          </DialogTitle>
          <DialogDescription>
            ОплатыКв jadvali · har qanday o'zgarish history'ga avto yoziladi
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <Field label="Дог № *">
            <Input value={contractNo} onChange={(e) => setContractNo(e.target.value)} placeholder="7331MSO26KK" />
          </Field>
          <Field label="Дата *">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>

          <Field label="Сумма оплаты">
            <Input value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="0" inputMode="decimal" />
          </Field>
          <Field label="1 взнос">
            <Input value={firstInstallment} onChange={(e) => setFirstInstallment(e.target.value)} placeholder="0" inputMode="decimal" />
          </Field>

          <Field label="ежемесячный">
            <Input value={monthlyAmount} onChange={(e) => setMonthlyAmount(e.target.value)} placeholder="0" inputMode="decimal" />
          </Field>
          <Field label="Оплата (turi)">
            <Select value={paymentCategory || 'none'} onValueChange={(v) => setPaymentCategory(v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="MONTHLY">ежемесячный</SelectItem>
                <SelectItem value="FIRST">1 взнос</SelectItem>
                <SelectItem value="GENERAL">Общий</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Клиент">
            <Input value={client} onChange={(e) => setClient(e.target.value)} />
          </Field>
          <Field label="Объект">
            <Input value={object} onChange={(e) => setObject(e.target.value)} />
          </Field>

          <Field label="Способ оплаты">
            <Input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="naqd / karta / transfer" />
          </Field>
          <Field label="Тип">
            <Input value={txType} onChange={(e) => setTxType(e.target.value)} />
          </Field>

          <Field label="Назначение платежа" full>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </Field>

          <Field label="Примечание" full>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!contractNo.trim() || !date || saveMut.isPending}
            className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white"
          >
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
            {isEdit ? 'Saqlash' : 'Qoshish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('space-y-1', full && 'col-span-2')}>
      <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">{label}</label>
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
  const delMut = useMutation({
    mutationFn: () => api.delete(`/oplata-kv/${row!.id}`),
    onSuccess: () => { toast.success('Qator o\'chirildi'); onDeleted(); onClose(); },
    onError: (e: any) => toast.error(e?.message || 'O\'chirib bo\'lmadi'),
  });

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-700">
            <Trash2 className="h-5 w-5" /> O'chirishni tasdiqlash
          </DialogTitle>
          <DialogDescription>
            Quyidagi qator butunlay o'chiriladi. Tarix yozuvi qoladi.
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 p-3 text-[13px] space-y-1">
            <div><b>Дог №:</b> <span className="font-mono">{row.contractNo}</span></div>
            <div><b>Дата:</b> {fmtDateRu(row.date)}</div>
            <div><b>Клиент:</b> {row.client || '—'}</div>
            <div><b>Объект:</b> {row.object || '—'}</div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
          <Button
            onClick={() => delMut.mutate()}
            disabled={delMut.isPending}
            className="bg-rose-600 hover:bg-rose-700 text-white"
          >
            {delMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
            O'chirish
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
            <History className="h-5 w-5 text-indigo-600" /> Qator tarixi
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
            <div className="text-center text-slate-400 py-8">Tarix bo'sh</div>
          )}
          {items.map((h) => (
            <div key={h.id} className="rounded-lg ring-1 ring-slate-200 p-3 bg-white">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <ActionBadge action={h.action} />
                  <span className="text-[12px] font-semibold text-slate-700">{h.actorName || 'Tizim'}</span>
                </div>
                <span className="text-[11px] text-slate-400 tabular-nums">{fmtDateTime(h.createdAt)}</span>
              </div>
              {Array.isArray(h.fieldsChanged) && h.fieldsChanged.length > 0 && h.fieldsChanged[0] !== '*' && (
                <div className="text-[11.5px] text-slate-500 mt-1">
                  O'zgargan maydonlar: <span className="font-mono text-slate-700">{h.fieldsChanged.join(', ')}</span>
                </div>
              )}
              {h.changes && typeof h.changes === 'object' && (
                <details className="mt-1.5">
                  <summary className="text-[11px] text-indigo-600 hover:text-indigo-800 cursor-pointer">Tafsilot</summary>
                  <pre className="mt-1.5 text-[10.5px] bg-slate-50 rounded p-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(h.changes, null, 2)}</pre>
                </details>
              )}
              {h.note && <div className="text-[11.5px] text-slate-500 mt-1 italic">{h.note}</div>}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionBadge({ action }: { action: string }) {
  const cls = {
    created:  'bg-emerald-50 text-emerald-700 ring-emerald-200',
    edited:   'bg-amber-50 text-amber-700 ring-amber-200',
    deleted:  'bg-rose-50 text-rose-700 ring-rose-200',
    imported: 'bg-violet-50 text-violet-700 ring-violet-200',
  }[action] || 'bg-slate-50 text-slate-700 ring-slate-200';
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ring-1', cls)}>
      {action}
    </span>
  );
}
