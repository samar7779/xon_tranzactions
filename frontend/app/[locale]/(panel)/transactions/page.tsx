'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Wand2, Link2Off, EyeOff, MoreHorizontal, Download,
  ArrowDownLeft, ArrowUpRight, TrendingUp, ChevronLeft, ChevronRight,
  X, Calendar, Wallet, FileText, Eye, FileSpreadsheet, Copy, Check,
  Hash, Receipt, Link2, History, Loader2,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
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

const MATCH_CONFIG: Record<string, { label: string; cls: string }> = {
  AUTO:      { label: 'Avto',          cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  MANUAL:    { label: 'Qo\'lda',        cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  PARTIAL:   { label: 'Qisman',        cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  IGNORED:   { label: 'E\'tiborsiz',    cls: 'bg-slate-50 text-slate-500 ring-slate-200' },
  UNMATCHED: { label: 'Bog\'lanmagan',  cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
};

export default function TransactionsPage() {
  const t = useTranslations('transactions');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManagePayments = !!user?.permissions?.includes(PERMS.PAYMENTS_MANAGE);

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
        toast.error('Bunday ID bilan tranzaksiya topilmadi');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Qidiruvda xato');
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
      if (r.ok) toast.success(`Bog'landi: ${r.customer.name}`);
      else toast.message(r.error || "Bog'lanmadi");
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
      toast.loading('Excel tayyorlanmoqda...', { id: 'tx-export' });
      await apiDownload(`/transactions/export?${p}`, `tranzaksiyalar-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Excel yuklab olindi', { id: 'tx-export' });
    } catch (e: any) {
      toast.error(e?.message || 'Eksportda xato', { id: 'tx-export' });
    }
  }

  function exportCsv() {
    if (!data?.items?.length) return toast.error("Eksport uchun ma'lumot yo'q");
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
        MATCH_CONFIG[it.matchStatus || 'UNMATCHED']?.label || '',
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
    toast.success('CSV eksport tayyor');
  }

  function exportJson() {
    if (!data?.items?.length) return toast.error("Eksport uchun ma'lumot yo'q");
    const blob = new Blob([JSON.stringify(data.items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('JSON eksport tayyor');
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
      <Topbar title={t('title')} subtitle={t('subtitle')} actions={
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="bg-white/15 hover:bg-white/25 text-white border-0 rounded-full backdrop-blur-sm">
                <Download className="h-3.5 w-3.5 mr-1.5" /> Eksport
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">Filtr bo'yicha (hammasi)</DropdownMenuLabel>
              <DropdownMenuItem onClick={exportExcel}>
                <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-600" /> Excel — barcha mos yozuvlar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">Joriy sahifa</DropdownMenuLabel>
              <DropdownMenuItem onClick={exportCsv}>
                <FileSpreadsheet className="h-4 w-4 mr-2 text-slate-500" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportJson}>
                <FileText className="h-4 w-4 mr-2 text-blue-600" /> JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={exportPrint}>
                <FileText className="h-4 w-4 mr-2 text-slate-600" /> Chop etish / PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      } />

      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full">

        {/* ═══ KPI ROW ═══ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Kirim · 30 kun"
            value={formatMoney(inSum)}
            icon={ArrowDownLeft}
            color="emerald"
            spark={spark(1.2)}
          />
          <StatCard
            label="Chiqim · 30 kun"
            value={formatMoney(outSum)}
            icon={ArrowUpRight}
            color="rose"
            spark={spark(0.9)}
          />
          <StatCard
            label="Sof oqim"
            value={(net >= 0 ? '+' : '') + formatMoney(net)}
            icon={TrendingUp}
            color={net >= 0 ? 'indigo' : 'rose'}
            spark={spark(1)}
          />
          <StatCard
            label="Tranzaksiya soni"
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
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  className="pl-9 h-10 rounded-xl bg-slate-50/60 border-slate-200 focus-visible:bg-white"
                  placeholder="Yuboruvchi, qabul qiluvchi, STIR, izoh..."
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setPage(1); }}
                />
                {q && (
                  <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" onClick={() => setQ('')}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Eski tarixni yuklash (backfill) */}
              <button
                onClick={() => setBackfillOpen(true)}
                title="Eski tarixni yuklash — sana oralig'i bo'yicha"
                className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 ring-1 ring-slate-200 hover:ring-indigo-200 transition-colors shrink-0"
              >
                <History className="h-4 w-4" />
              </button>

              {/* Tranzaksiya ID orqali qidirish */}
              <button
                onClick={() => setIdSearchOpen(true)}
                title="Tranzaksiya ID orqali qidirish"
                className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 ring-1 ring-slate-200 hover:ring-indigo-200 transition-colors shrink-0"
              >
                <Hash className="h-4 w-4" />
              </button>

              <FilterChip
                active={direction !== 'all'}
                label={direction === 'IN' ? 'Kirim' : direction === 'OUT' ? 'Chiqim' : 'Yo\'nalish'}
                value={direction}
                onChange={(v) => { setDirection(v); setPage(1); }}
                options={[
                  { value: 'all', label: 'Barchasi' },
                  { value: 'IN', label: 'Kirim' },
                  { value: 'OUT', label: 'Chiqim' },
                ]}
              />

              <FilterChip
                active={bankId !== 'all'}
                label={bankId === 'all' ? 'Bank' : (banks?.items.find((b: any) => b.id === bankId)?.name || 'Bank')}
                value={bankId}
                onChange={(v) => { setBankId(v); setPage(1); }}
                options={[
                  { value: 'all', label: 'Barcha banklar' },
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
                label={matchStatus === 'all' ? 'Bog\'lanish' : MATCH_CONFIG[matchStatus]?.label}
                value={matchStatus}
                onChange={(v) => { setMatchStatus(v); setPage(1); }}
                options={[
                  { value: 'all', label: 'Barchasi' },
                  { value: 'AUTO', label: 'Avto' },
                  { value: 'MANUAL', label: 'Qo\'lda' },
                  { value: 'PARTIAL', label: 'Qisman' },
                  { value: 'UNMATCHED', label: 'Bog\'lanmagan' },
                  { value: 'IGNORED', label: 'E\'tiborsiz' },
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
                    {dateFrom || dateTo ? `${dateFrom || '...'} → ${dateTo || '...'}` : 'Sana oralig\'i'}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="p-3 w-72">
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Dan</div>
                      <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Gacha</div>
                      <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-9" />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => { setDateFrom(''); setDateTo(''); }}>Tozalash</Button>
                      <Button size="sm" className="flex-1" onClick={() => setFilterOpen(false)}>Qo'llash</Button>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {(activeFilters > 0 || q) && (
                <button onClick={clearFilters} className="text-xs text-slate-500 hover:text-rose-600 font-medium flex items-center gap-1">
                  <X className="h-3.5 w-3.5" /> Tozalash ({activeFilters + (q ? 1 : 0)})
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
                title="Tranzaksiya topilmadi"
                description={q || activeFilters > 0 ? "Filtrlarni o'zgartirib ko'ring" : "Hozircha hech qanday tranzaksiya yo'q. Sync ishga tushishi bilan ko'rinadi."}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                      <th className="text-left px-4 py-3 w-40">Sana / Vaqt</th>
                      <th className="text-left px-4 py-3">Yo'nalish</th>
                      <th className="text-left px-4 py-3">Kontragent</th>
                      <th className="text-left px-4 py-3">Bank · Hisob</th>
                      <th className="text-left px-4 py-3">Holat</th>
                      <th className="text-right px-4 py-3">Summa</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered!.map((it: any) => {
                      const match = MATCH_CONFIG[it.matchStatus || 'UNMATCHED'];
                      const counterparty = it.direction === 'IN'
                        ? { name: it.fromName || '—', meta: it.fromInn || '' }
                        : { name: it.toName || '—', meta: it.toAccount || '' };
                      const initial = (counterparty.name || '?').charAt(0).toUpperCase();

                      return (
                        <tr key={it.id}
                          className="group hover:bg-slate-50/60 transition-colors cursor-pointer"
                          onClick={() => setDetailRow(it)}
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-[13px] font-medium tabular-nums">{formatDate(it.txnDate)}</div>
                            <div className="text-[10px] text-slate-500 tabular-nums">
                              {/* operationTime — bank bergan haqiqiy vaqt (HH:mm:ss); yo'q bo'lsa txnDate'dan */}
                              {it.operationTime
                                ? it.operationTime.slice(0, 5)
                                : (it.inputAt
                                    ? new Date(it.inputAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
                                    : '—')}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ring-inset",
                              it.direction === 'IN'
                                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                : "bg-rose-50 text-rose-700 ring-rose-200",
                            )}>
                              {it.direction === 'IN'
                                ? <><ArrowDownLeft className="h-3 w-3" /> Kirim</>
                                : <><ArrowUpRight className="h-3 w-3" /> Chiqim</>}
                            </span>
                          </td>
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
                          <td className="px-4 py-3">
                            <span className={cn(
                              "inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 ring-inset",
                              match.cls,
                            )}>
                              {match.label}
                            </span>
                          </td>
                          <td className={cn(
                            "px-4 py-3 text-right tabular-nums font-bold whitespace-nowrap",
                            it.direction === 'IN' ? 'text-emerald-600' : 'text-rose-600',
                          )}>
                            {it.direction === 'IN' ? '+' : '−'}{formatMoney(it.amount, it.currency)}
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            {canManagePayments && it.direction === 'IN' ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setDetailRow(it)}>
                                    <Eye className="h-4 w-4 mr-2" /> Tafsilot
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {it.matchStatus !== 'AUTO' && it.matchStatus !== 'MANUAL' && (
                                    <DropdownMenuItem onClick={() => autoMatchMut.mutate(it.id)}>
                                      <Wand2 className="h-4 w-4 mr-2" /> Avto-match (INN)
                                    </DropdownMenuItem>
                                  )}
                                  {(it.matchStatus === 'AUTO' || it.matchStatus === 'MANUAL' || it.matchStatus === 'PARTIAL') && (
                                    <DropdownMenuItem onClick={() => unlinkMut.mutate(it.id)}>
                                      <Link2Off className="h-4 w-4 mr-2" /> Bog'lanishni olib tashlash
                                    </DropdownMenuItem>
                                  )}
                                  {it.matchStatus !== 'IGNORED' && (
                                    <DropdownMenuItem onClick={() => ignoreMut.mutate(it.id)}>
                                      <EyeOff className="h-4 w-4 mr-2" /> E'tiborsiz qoldirish
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : (
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setDetailRow(it)}>
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            )}
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
              <span className="font-semibold text-slate-700 tabular-nums">{((page - 1) * perPage) + 1}–{Math.min(page * perPage, data.total)}</span> / {data.total} ta tranzaksiya
            </div>
            <div className="flex items-center gap-3">
              <Select value={String(perPage)} onValueChange={(v) => { setPerPage(Number(v)); setPage(1); }}>
                <SelectTrigger className="w-24 h-9 rounded-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10/sahifa</SelectItem>
                  <SelectItem value="25">25/sahifa</SelectItem>
                  <SelectItem value="50">50/sahifa</SelectItem>
                  <SelectItem value="100">100/sahifa</SelectItem>
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
      <TransactionDetailDialog row={detailRow} onClose={() => setDetailRow(null)} />

      {/* ═══ ESKI TARIXNI YUKLASH (BACKFILL) ═══ */}
      <BackfillDialog open={backfillOpen} onOpenChange={setBackfillOpen} banks={banks?.items || []} />

      {/* ═══ TRANZAKSIYA ID QIDIRUV ═══ */}
      <Dialog open={idSearchOpen} onOpenChange={setIdSearchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-indigo-600" /> Tranzaksiya ID orqali qidirish
            </DialogTitle>
            <DialogDescription>
              To'liq tranzaksiya ID'ni kiriting — topilsa, tafsilot oynasi ochiladi
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={idQuery}
              onChange={(e) => setIdQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') searchById(); }}
              placeholder="masalan: 60101234_5_20260514_..."
              className="font-mono text-xs"
            />
            <Button onClick={searchById} disabled={idSearching || !idQuery.trim()} className="shrink-0">
              {idSearching ? '...' : 'Topish'}
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
            {progress
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

            <div className="flex justify-end gap-2 pt-1">
              {allDone ? (
                <Button onClick={() => { setProgress(null); onOpenChange(false); }}>Yopish</Button>
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

function TransactionDetailDialog({ row, onClose }: { row: any; onClose: () => void }) {
  if (!row) return null;
  const isIn = row.direction === 'IN';
  const match = MATCH_CONFIG[row.matchStatus || 'UNMATCHED'];

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
                  {isIn ? 'KIRIM' : 'CHIQIM'}
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
              {isIn ? row.fromName : row.toName || '—'}
            </div>
          </div>
        </div>

        {/* ─── Body — scrollable ─── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4 bg-white">
          {/* Status + match badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ring-inset",
              match.cls,
            )}>
              <Link2 className="h-3 w-3" /> {match.label}
            </span>
            {row.docNumber && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600">
                <Receipt className="h-3 w-3" /> #{row.docNumber}
              </span>
            )}
          </div>

          {/* Yuboruvchi */}
          <DetailSection title="Yuboruvchi" icon={ArrowUpRight} highlighted={!isIn} tone="rose">
            <CopyRow label="Nomi" value={row.fromName || '—'} />
            <CopyRow label="STIR" value={row.fromInn} mono copyable />
            <CopyRow label="Hisob raqami" value={row.fromAccount} mono copyable />
            <CopyRow label="Bank MFO" value={row.fromMfo} mono />
          </DetailSection>

          {/* Qabul qiluvchi */}
          <DetailSection title="Qabul qiluvchi" icon={ArrowDownLeft} highlighted={isIn} tone="emerald">
            <CopyRow label="Nomi" value={row.toName || '—'} />
            <CopyRow label="STIR" value={row.toInn} mono copyable />
            <CopyRow label="Hisob raqami" value={row.toAccount} mono copyable />
            <CopyRow label="Bank MFO" value={row.toMfo} mono />
          </DetailSection>

          {/* To'lov maqsadi */}
          {row.description && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 mb-1.5">To'lov maqsadi</div>
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
                <div className="text-[13px] text-slate-900 leading-relaxed whitespace-pre-wrap">{row.description.trim()}</div>
                {row.purposeCode && (
                  <div className="mt-2 pt-2 border-t border-slate-200 text-[11px] text-slate-500">
                    Maqsad kodi: <span className="font-mono font-semibold text-slate-700">{row.purposeCode}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Vaqt ma'lumotlari */}
          <DetailSection title="Vaqt ma'lumotlari" icon={Calendar}>
            <CopyRow label="Hujjat sanasi" value={formatDate(row.txnDate)} />
            <CopyRow label="Operatsiya vaqti" value={row.operationTime} mono />
            <CopyRow
              label="Value date"
              value={row.valueDate ? formatDate(row.valueDate) : undefined}
            />
            <CopyRow label="Settlement vaqti" value={row.settlementTime} mono />
            <CopyRow
              label="Kiritilgan"
              value={row.inputAt ? formatDateTime(row.inputAt) : undefined}
            />
          </DetailSection>

          {/* Tizim ma'lumotlari */}
          <DetailSection title="Tizim ma'lumotlari" icon={Hash}>
            <CopyRow label="Bank" value={row.account?.bank?.name || '—'} />
            <CopyRow label="Mahalliy hisob" value={row.account?.accountNo} mono copyable />
            <CopyRow label="B2 ID" value={row.bankB2Id} mono copyable />
            <CopyRow label="Global ID (NCI)" value={row.bankGeneralId} mono copyable />
            {row.bankClientId && <CopyRow label="Klient ID" value={row.bankClientId} mono />}
            {row.docType && <CopyRow label="Hujjat turi" value={row.docType} mono />}
          </DetailSection>

          {/* Tranzaksiya ID — to'liq, alohida blok */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 mb-1.5">Tranzaksiya ID (composite)</div>
            <CopyBlock value={row.externalId || row.id} />
          </div>

          {/* Bankdan kelgan to'liq JSON */}
          {(row.metadata || row.rawExtra) && (
            <details className="rounded-xl border border-slate-200 overflow-hidden">
              <summary className="px-4 py-2.5 cursor-pointer text-[10px] font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2 uppercase tracking-[0.15em]">
                <FileText className="h-3.5 w-3.5" /> Bankdan kelgan to'liq JSON
              </summary>
              <div className="px-4 py-3 bg-slate-50/60 space-y-3">
                {row.metadata && <RawJsonBlock label="Raw javob (metadata)" data={row.metadata} />}
                {row.rawExtra && <RawJsonBlock label="Qo'shimcha fieldlar (rawExtra)" data={row.rawExtra} />}
              </div>
            </details>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RawJsonBlock({ label, data }: { label: string; data: any }) {
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
          {copied ? <><Check className="h-3 w-3 text-emerald-600" /> Nusxalandi</> : <><Copy className="h-3 w-3" /> Nusxalash</>}
        </button>
      </div>
      <pre className="p-2.5 bg-slate-900 text-slate-100 rounded-lg text-[10px] font-mono leading-relaxed overflow-x-auto max-h-64 overflow-y-auto">
        {str}
      </pre>
    </div>
  );
}

function DetailSection({
  title, icon: Icon, highlighted, tone, children,
}: {
  title: string;
  icon: any;
  highlighted?: boolean;
  tone?: 'rose' | 'emerald';
  children: React.ReactNode;
}) {
  const ring = highlighted
    ? tone === 'emerald' ? 'ring-emerald-200 bg-emerald-50/50' : 'ring-rose-200 bg-rose-50/50'
    : 'ring-slate-200 bg-slate-50/60';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 mb-1.5 flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {title}
        {highlighted && <span className="text-[9px] text-indigo-600 font-bold">· SIZ</span>}
      </div>
      <div className={cn("rounded-xl ring-1 px-4 py-2.5 divide-y divide-slate-100/80", ring)}>
        {children}
      </div>
    </div>
  );
}

function CopyRow({ label, value, mono, copyable }: { label: string; value?: string; mono?: boolean; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const isEmpty = !value || value === '—';

  function copy() {
    if (isEmpty) return;
    navigator.clipboard.writeText(value!);
    setCopied(true);
    toast.success(`${label} nusxalandi`);
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
          {isEmpty ? "bo'sh" : value}
        </div>
        {copyable && !isEmpty && (
          <button
            onClick={copy}
            className="shrink-0 p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 opacity-0 group-hover:opacity-100 transition-all"
            title="Nusxalash"
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
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success('Tranzaksiya ID nusxalandi');
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
        title="Nusxalash"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
