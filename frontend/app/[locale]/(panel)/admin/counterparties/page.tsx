'use client';

import { useState, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Plus, Upload, Download, RefreshCw, X, Loader2,
  Briefcase, User, Phone, MapPin, FileText, Trash2, Eye, MoreVertical,
  AlertCircle, CheckCircle2, Clock, Star, Building2, Tag, Receipt,
  ChevronDown,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { api, apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatDateTime } from '@/lib/utils';

interface Counterparty {
  inn: string;
  name: string;
  fullName?: string | null;
  director?: string | null;
  accountant?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  vatNumber?: string | null;
  vatStatus?: string | null;
  oked?: string | null;
  rating?: number | null;
  ratingTitle?: string | null;
  bankAccounts?: any[] | null;
  founders?: any[] | null;
  addedBy: string;
  addedByUser?: { id: string; fullName?: string | null; email: string } | null;
  addedAt: string;
  lastFetchedAt?: string | null;
  lastFetchError?: string | null;
  isActive: boolean;
  registrationDate?: string | null;
  registrationNumber?: string | null;
}

const TASHKENT_TZ_OFFSET_MS = 5 * 60 * 60 * 1000;
function tashkentNowHour(): number {
  return new Date(Date.now() + TASHKENT_TZ_OFFSET_MS).getUTCHours();
}

// Tadbirkorlik sub'ektining barqarorlik reytingi shkalasi
//   96-100 AAA · 91-95 AA · 86-90 A    → Yuqori
//   76-85 BBB · 66-75 BB · 56-65 B    → O'rta
//   51-55 CCC · 36-50 CC · 26-35 C    → Qoniqarli
//   ≤25 D                              → Quyi
type RatingGrade = {
  letter: string;
  level: 'Yuqori' | "O'rta" | 'Qoniqarli' | 'Quyi';
  tone: 'emerald' | 'blue' | 'amber' | 'rose';
  chip: string;
};
function ratingGrade(rating: number | null | undefined): RatingGrade | null {
  if (rating == null) return null;
  const r = Math.round(rating);
  const make = (letter: string, level: RatingGrade['level'], tone: RatingGrade['tone'], chip: string) => ({
    letter, level, tone, chip,
  });
  if (r >= 96) return make('AAA', 'Yuqori',    'emerald', 'bg-emerald-50 text-emerald-700 ring-emerald-200');
  if (r >= 91) return make('AA',  'Yuqori',    'emerald', 'bg-emerald-50 text-emerald-700 ring-emerald-200');
  if (r >= 86) return make('A',   'Yuqori',    'emerald', 'bg-emerald-50 text-emerald-700 ring-emerald-200');
  if (r >= 76) return make('BBB', "O'rta",     'blue',    'bg-blue-50 text-blue-700 ring-blue-200');
  if (r >= 66) return make('BB',  "O'rta",     'blue',    'bg-blue-50 text-blue-700 ring-blue-200');
  if (r >= 56) return make('B',   "O'rta",     'blue',    'bg-blue-50 text-blue-700 ring-blue-200');
  if (r >= 51) return make('CCC', 'Qoniqarli', 'amber',   'bg-amber-50 text-amber-700 ring-amber-200');
  if (r >= 36) return make('CC',  'Qoniqarli', 'amber',   'bg-amber-50 text-amber-700 ring-amber-200');
  if (r >= 26) return make('C',   'Qoniqarli', 'amber',   'bg-amber-50 text-amber-700 ring-amber-200');
  return make('D',   'Quyi',      'rose',    'bg-rose-50 text-rose-700 ring-rose-200');
}

function isStandardInn(inn: string): boolean {
  return /^\d{9}$|^\d{14}$/.test(inn);
}

export default function CounterpartiesPage() {
  const t = useTranslations('counterparties');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const canManage = !!me?.permissions?.includes(PERMS.COUNTERPARTIES_MANAGE);

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  // Filters
  const [ratingTier, setRatingTier] = useState<'' | 'high' | 'mid' | 'ok' | 'low' | 'none'>('');
  const [statusFilter, setStatusFilter] = useState<'' | 'manual' | 'error' | 'never' | 'enriched'>('');
  const [sortBy, setSortBy] = useState<'addedAt' | 'name' | 'rating' | 'lastFetchedAt'>('addedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [addOpen, setAddOpen] = useState(false);
  const [addInn, setAddInn] = useState('');
  const [addName, setAddName] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [detailRow, setDetailRow] = useState<Counterparty | null>(null);
  const [editRow, setEditRow] = useState<Counterparty | null>(null);
  const [refreshingInn, setRefreshingInn] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function buildQueryParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (ratingTier) p.set('ratingTier', ratingTier);
    if (statusFilter) p.set('status', statusFilter);
    if (sortBy !== 'addedAt' || sortDir !== 'desc') {
      p.set('sortBy', sortBy);
      p.set('sortDir', sortDir);
    }
    return p;
  }

  const listQuery = useQuery({
    queryKey: ['counterparties', page, perPage, q, ratingTier, statusFilter, sortBy, sortDir],
    queryFn: () => {
      const p = buildQueryParams();
      p.set('page', String(page));
      p.set('perPage', String(perPage));
      return api.get<{
        ok: boolean; total: number; page: number; perPage: number;
        items: Counterparty[]; didoxConfigured: boolean;
        stats?: { total: number; activeVat: number; avgRating: number | null; ratedCount: number; lastFetchedAt: string | null };
      }>(`/counterparties?${p}`);
    },
  });

  const addMut = useMutation({
    mutationFn: (body: { inn: string; name: string }) =>
      api.post<{ ok: boolean; didoxFetched?: boolean }>('/counterparties', body),
    onSuccess: (r) => {
      toast.success(t('addedOk') + (r?.didoxFetched === false ? ' (DIDOX javob bermadi — keyin cron yangilaydi)' : ''));
      setAddOpen(false); setAddInn(''); setAddName('');
      qc.invalidateQueries({ queryKey: ['counterparties'] });
    },
    onError: (e: any) => {
      const msg = e?.message || t('addError');
      if (/409|allaqachon|already|существует/i.test(msg)) toast.error(t('duplicate'));
      else toast.error(msg);
    },
  });

  const refreshMut = useMutation({
    mutationFn: (inn: string) =>
      api.post<{ ok: boolean; source?: string; error?: string }>(`/counterparties/${inn}/refresh`),
    onMutate: (inn) => setRefreshingInn(inn),
    onSuccess: (r) => {
      if (r?.ok) {
        const src = r.source && r.source !== 'none' ? ` (${r.source})` : '';
        toast.success(t('refreshOk') + src);
      } else {
        toast.warning(r?.error || t('refreshError'));
      }
      qc.invalidateQueries({ queryKey: ['counterparties'] });
    },
    onError: (e: any) => toast.error(e?.message || t('refreshError')),
    onSettled: () => setRefreshingInn(null),
  });

  const refreshAllMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; started?: boolean; message?: string }>('/counterparties/refresh-all'),
    onSuccess: (r: any) => {
      toast.success(r?.message || 'Yangilash fonda boshlandi');
      // 30 soniyadan keyin sahifani avto-yangilaymiz
      setTimeout(() => qc.invalidateQueries({ queryKey: ['counterparties'] }), 30_000);
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  const deleteMut = useMutation({
    mutationFn: (inn: string) => api.delete(`/counterparties/${inn}`),
    onSuccess: () => { toast.success(t('deletedOk')); qc.invalidateQueries({ queryKey: ['counterparties'] }); },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  const editMut = useMutation({
    mutationFn: (body: { inn: string; data: any }) => api.patch(`/counterparties/${body.inn}`, body.data),
    onSuccess: () => {
      toast.success(t('refreshOk'));
      setEditRow(null);
      qc.invalidateQueries({ queryKey: ['counterparties'] });
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  const importMut = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/counterparties/import`, {
        method: 'POST',
        body: form,
        headers: { Authorization: `Bearer ${useAuth.getState().token || ''}` },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (r) => {
      setImportResult(r);
      qc.invalidateQueries({ queryKey: ['counterparties'] });
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  async function onExport() {
    try {
      const p = buildQueryParams();
      await apiDownload(`/counterparties/export?${p}`, `kontragentlar-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      toast.error(e?.message || tc('error'));
    }
  }

  const items = listQuery.data?.items || [];
  const total = listQuery.data?.total || 0;
  const didoxOk = listQuery.data?.didoxConfigured ?? true;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // KPI — backend'dan global stats (butun DB bo'yicha, sahifa emas)
  const stats = listQuery.data?.stats;
  const kpis = {
    total: stats?.total ?? total,
    activeVat: stats?.activeVat ?? 0,
    avgRating: stats?.avgRating ?? null,
    ratedCount: stats?.ratedCount ?? 0,
    lastRefresh: stats?.lastFetchedAt || null,
  };

  // Bir soat ichida keyingi cron vaqti
  const nextCronText = useMemo(() => {
    const hour = tashkentNowHour();
    if (hour >= 22 || hour < 8) return '08:00';
    return `${String(hour + 1).padStart(2, '0')}:00`;
  }, [listQuery.dataUpdatedAt]);

  return (
    <div className="flex-1 p-6 lg:p-8 w-full">
      <div className="w-full space-y-5">

        {/* Header + actions */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-blue-600 px-6 py-5 text-white overflow-hidden">
            <div className="absolute inset-0 bg-dots opacity-15 pointer-events-none" />
            <div className="absolute -top-12 -right-8 w-44 h-44 rounded-full bg-white/10 blur-3xl pointer-events-none" />
            <div className="relative flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-white/15 ring-2 ring-white/30 backdrop-blur-md grid place-items-center text-white">
                  <Briefcase className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-2xl font-black tracking-tight">{t('title')}</div>
                  <div className="text-white/80 text-xs mt-0.5">{t('subtitle')}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {canManage && (
                  <>
                    <IconBtn title={t('add')} onClick={() => setAddOpen(true)} primary>
                      <Plus className="h-5 w-5" />
                    </IconBtn>
                    <IconBtn title={t('import')} onClick={() => setImportOpen(true)}>
                      <Upload className="h-5 w-5" />
                    </IconBtn>
                  </>
                )}
                <IconBtn title={t('export')} onClick={onExport}>
                  <Download className="h-5 w-5" />
                </IconBtn>
                {canManage && (
                  <IconBtn
                    title={t('refreshAll')}
                    onClick={() => refreshAllMut.mutate()}
                    disabled={refreshAllMut.isPending}
                  >
                    {refreshAllMut.isPending
                      ? <Loader2 className="h-5 w-5 animate-spin" />
                      : <RefreshCw className="h-5 w-5" />}
                  </IconBtn>
                )}
              </div>
            </div>
          </div>
        </Card>

        {!didoxOk && (
          <Card className="border-0 shadow-soft overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-500" />
            <CardContent className="p-4 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[12px] text-amber-900">{t('didoxNotConfigured')}</div>
            </CardContent>
          </Card>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiTile
            label={t('kpiTotal')}
            value={String(kpis.total)}
            icon={<Building2 className="h-5 w-5" strokeWidth={2.4} />}
            gradient="from-indigo-500 via-violet-500 to-violet-600"
            shadow="shadow-violet-500/30"
          />
          <KpiTile
            label={t('kpiActiveVat')}
            value={String(kpis.activeVat)}
            sub={kpis.total ? `${Math.round((kpis.activeVat / kpis.total) * 100)}% jami'dan` : undefined}
            icon={<CheckCircle2 className="h-5 w-5" strokeWidth={2.4} />}
            gradient="from-emerald-500 via-emerald-500 to-teal-600"
            shadow="shadow-emerald-500/30"
          />
          <KpiTile
            label={t('kpiAvgRating')}
            value={kpis.avgRating != null ? String(kpis.avgRating) : '—'}
            sub={kpis.ratedCount ? `${kpis.ratedCount} ta reytingli` : 'reyting yo\'q'}
            icon={<Star className="h-5 w-5 fill-current" strokeWidth={2.4} />}
            gradient="from-amber-400 via-orange-500 to-rose-500"
            shadow="shadow-amber-500/30"
          />
          <KpiTile
            label={t('lastRefreshed')}
            value={kpis.lastRefresh ? formatDateTime(kpis.lastRefresh) : t('neverRefreshed')}
            sub={t('nextRefresh').replace('{n}', nextCronText)}
            icon={<RefreshCw className="h-5 w-5" strokeWidth={2.4} />}
            gradient="from-blue-500 via-cyan-500 to-sky-600"
            shadow="shadow-cyan-500/30"
            small
          />
        </div>

        {/* Search + compact filter dropdowns */}
        <Card className="border-0 shadow-soft overflow-visible">
          <CardContent className="p-4 flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder={t('search')}
                className="pl-9 h-10 rounded-xl bg-slate-50/60 border-slate-200 focus-visible:bg-white"
              />
              {q && (
                <button
                  onClick={() => { setQ(''); setPage(1); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Reyting filter dropdown */}
            <FilterDropdown
              label="Reyting"
              activeLabel={
                ratingTier === 'high' ? 'Yuqori'
                : ratingTier === 'mid' ? "O'rta"
                : ratingTier === 'ok' ? 'Qoniqarli'
                : ratingTier === 'low' ? 'Quyi'
                : ratingTier === 'none' ? "Reyting yo'q"
                : null
              }
              icon={<Star className="h-3.5 w-3.5" />}
              options={[
                { v: '',     label: 'Hammasi',        sub: undefined },
                { v: 'high', label: 'Yuqori',         sub: '≥86 (AAA/AA/A)',  tone: 'emerald' },
                { v: 'mid',  label: "O'rta",          sub: '56-85 (BBB/BB/B)', tone: 'blue' },
                { v: 'ok',   label: 'Qoniqarli',      sub: '26-55 (CCC/CC/C)', tone: 'amber' },
                { v: 'low',  label: 'Quyi',           sub: '≤25 (D)',          tone: 'rose' },
                { v: 'none', label: "Reyting yo'q",   sub: 'Hali enrich qilinmagan', tone: 'slate' },
              ]}
              value={ratingTier}
              onChange={(v) => { setRatingTier(v as any); setPage(1); }}
            />

            {/* Holat filter dropdown */}
            <FilterDropdown
              label="Holat"
              activeLabel={
                statusFilter === 'enriched' ? "To'liq ma'lumot"
                : statusFilter === 'manual' ? "Qo'lda"
                : statusFilter === 'never' ? 'Yangilanmagan'
                : statusFilter === 'error' ? 'Xato'
                : null
              }
              icon={<Tag className="h-3.5 w-3.5" />}
              options={[
                { v: '',         label: 'Hammasi' },
                { v: 'enriched', label: "To'liq ma'lumot", sub: 'DIDOX/Chamber javob bergan', tone: 'emerald' },
                { v: 'manual',   label: "Qo'lda kiritilgan", sub: 'Nostandart INN (kod0088 va h.k.)', tone: 'violet' },
                { v: 'never',    label: 'Yangilanmagan',    sub: 'Cron hali tegmagan',            tone: 'amber' },
                { v: 'error',    label: 'Xato',             sub: 'DIDOX/Chamber javob bermagan',  tone: 'rose' },
              ]}
              value={statusFilter}
              onChange={(v) => { setStatusFilter(v as any); setPage(1); }}
            />

            {/* Saralash dropdown */}
            <FilterDropdown
              label="Saralash"
              activeLabel={(() => {
                const k = `${sortBy}:${sortDir}`;
                if (k === 'addedAt:desc') return null; // default
                if (k === 'addedAt:asc')        return 'Eski qo\'shilgan';
                if (k === 'name:asc')           return 'Nomi A-Z';
                if (k === 'name:desc')          return 'Nomi Z-A';
                if (k === 'rating:desc')        return 'Reyting (yuqori)';
                if (k === 'rating:asc')         return 'Reyting (past)';
                if (k === 'lastFetchedAt:desc') return 'Yangi yangilangan';
                if (k === 'lastFetchedAt:asc')  return 'Eski yangilangan';
                return null;
              })()}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              options={[
                { v: 'addedAt:desc',        label: 'Yangi qo\'shilgan',    sub: 'Default' },
                { v: 'addedAt:asc',         label: 'Eski qo\'shilgan' },
                { v: 'name:asc',            label: 'Nomi A-Z' },
                { v: 'name:desc',           label: 'Nomi Z-A' },
                { v: 'rating:desc',         label: 'Reyting (yuqori)' },
                { v: 'rating:asc',          label: 'Reyting (past)' },
                { v: 'lastFetchedAt:desc',  label: 'Yangi yangilangan' },
                { v: 'lastFetchedAt:asc',   label: 'Eski yangilangan' },
              ]}
              value={`${sortBy}:${sortDir}`}
              onChange={(v) => {
                const [b, d] = (v as string).split(':');
                setSortBy(b as any);
                setSortDir(d as any);
                setPage(1);
              }}
            />

            {/* Tozalash */}
            {(ratingTier || statusFilter || q || sortBy !== 'addedAt' || sortDir !== 'desc') && (
              <button
                onClick={() => {
                  setQ(''); setRatingTier(''); setStatusFilter('');
                  setSortBy('addedAt'); setSortDir('desc'); setPage(1);
                }}
                className="text-[12px] text-slate-500 hover:text-rose-600 font-medium inline-flex items-center gap-1 px-3 h-10 rounded-xl hover:bg-rose-50 transition-colors"
              >
                <X className="h-3.5 w-3.5" /> {t('filterReset')}
              </button>
            )}
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <CardContent className="p-0">
            {listQuery.isLoading ? (
              <div className="p-6 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : items.length === 0 ? (
              <EmptyState icon={Briefcase} title={t('noData')} description={q ? '' : t('subtitle')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                      <th className="text-left px-4 py-3 w-28">{t('innLabel')}</th>
                      <th className="text-left px-4 py-3">{t('nameLabel')}</th>
                      <th className="text-left px-4 py-3 w-48">{t('director')}</th>
                      <th className="text-left px-4 py-3 w-20">{t('rating')}</th>
                      <th className="text-left px-4 py-3 w-32">{t('phone')}</th>
                      <th className="text-left px-4 py-3 w-44">{t('vatStatus')}</th>
                      <th className="text-left px-4 py-3 w-32">{t('lastFetched')}</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((it) => {
                      const isRefreshing = refreshingInn === it.inn;
                      const grade = ratingGrade(it.rating ?? null);
                      const manual = !isStandardInn(it.inn);
                      return (
                        <tr key={it.inn} className="group hover:bg-slate-50/60 transition-colors cursor-pointer" onClick={() => setDetailRow(it)}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[12px] font-bold text-slate-900">{it.inn}</span>
                              {manual && (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700 text-[9px] font-bold uppercase tracking-wider"
                                  title="Nostandart INN — qo'lda kiritilgan, avto-yangilanmaydi"
                                >
                                  Qo'lda
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 max-w-[300px]">
                            <div className="font-semibold text-slate-900 truncate" title={it.name}>{it.name}</div>
                            {it.oked && (
                              <div className="text-[10px] text-slate-500 truncate flex items-center gap-1 mt-0.5" title={it.oked}>
                                <Building2 className="h-2.5 w-2.5 text-slate-400" />
                                {String(it.oked).replace(/^\d+\s*-\s*/, '')}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 max-w-[220px]">
                            <div className="text-[12px] truncate" title={it.director || ''}>{it.director || '—'}</div>
                          </td>
                          <td className="px-4 py-3">
                            {grade ? (
                              <div className="inline-flex items-center gap-1">
                                <span className={cn(
                                  'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-bold ring-1 ring-inset tabular-nums',
                                  grade.chip,
                                )}>
                                  {it.rating}
                                </span>
                                <span className={cn(
                                  'inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-black ring-1 ring-inset',
                                  grade.chip,
                                )} title={grade.level}>
                                  {grade.letter}
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">{it.phone || '—'}</td>
                          <td className="px-4 py-3 text-[11px] text-slate-600 truncate max-w-[200px]" title={it.vatStatus || ''}>
                            {it.vatStatus || '—'}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">
                            {isRefreshing ? (
                              <span className="inline-flex items-center gap-1 text-indigo-600">
                                <Loader2 className="h-3 w-3 animate-spin" /> {t('syncing')}
                              </span>
                            ) : it.lastFetchError ? (
                              <span className="inline-flex items-center gap-1 text-rose-600" title={it.lastFetchError}>
                                <AlertCircle className="h-3 w-3" /> xato
                              </span>
                            ) : it.lastFetchedAt ? (
                              formatDateTime(it.lastFetchedAt)
                            ) : '—'}
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setDetailRow(it)}>
                                  <Eye className="h-4 w-4 mr-2" /> {t('openDetail')}
                                </DropdownMenuItem>
                                {canManage && (
                                  <DropdownMenuItem onClick={() => refreshMut.mutate(it.inn)} disabled={isRefreshing}>
                                    <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} /> {t('refreshOne')}
                                  </DropdownMenuItem>
                                )}
                                {canManage && (
                                  <DropdownMenuItem onClick={() => setEditRow(it)}>
                                    <FileText className="h-4 w-4 mr-2" /> {t('edit')}
                                  </DropdownMenuItem>
                                )}
                                {canManage && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-rose-600 focus:text-rose-700"
                                      onClick={() => {
                                        if (window.confirm(t('confirmDelete', { name: it.name }))) deleteMut.mutate(it.inn);
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" /> {t('delete')}
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
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

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-xs text-slate-500">
              <span className="font-semibold text-slate-700 tabular-nums">
                {((page - 1) * perPage) + 1}–{Math.min(page * perPage, total)}
              </span> / {t('ofTotal', { n: total })}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)} className="h-9 w-9 p-0 rounded-full">«</Button>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-9 w-9 p-0 rounded-full">‹</Button>
              <div className="text-xs font-semibold tabular-nums px-3">{page} / {totalPages}</div>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-9 w-9 p-0 rounded-full">›</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="h-9 w-9 p-0 rounded-full">»</Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Add dialog ─── */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!addMut.isPending) setAddOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-indigo-600" /> {t('add')}
            </DialogTitle>
            <DialogDescription className="text-[12px]">{t('innHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                {t('innLabel')} <span className="text-rose-500">*</span>
              </Label>
              <Input
                value={addInn}
                onChange={(e) => setAddInn(e.target.value.replace(/\D/g, '').slice(0, 14))}
                placeholder={t('innPlaceholder')}
                className="font-mono h-11"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                {t('nameLabel')} <span className="text-rose-500">*</span>
              </Label>
              <Input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder={t('namePlaceholder')}
                className="h-11"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && addInn && addName && !addMut.isPending) {
                    addMut.mutate({ inn: addInn.trim(), name: addName.trim() });
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addMut.isPending} className="flex-1">
                {tc('cancel')}
              </Button>
              <Button
                onClick={() => addMut.mutate({ inn: addInn.trim(), name: addName.trim() })}
                disabled={!addInn || !addName || addMut.isPending}
                className="flex-1 gap-2 bg-indigo-600 hover:bg-indigo-700"
              >
                {addMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('saving')}</> : <>{t('saveBtn')}</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Import dialog ─── */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!importMut.isPending) { setImportOpen(o); if (!o) setImportResult(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-indigo-600" /> {t('importTitle')}
            </DialogTitle>
            <DialogDescription className="text-[12px]">{t('importHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {!importResult && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importMut.mutate(f);
                  }}
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importMut.isPending}
                  className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 gap-2"
                >
                  {importMut.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('uploading')}</>
                    : <><Upload className="h-4 w-4" /> {t('selectFile')}</>}
                </Button>
              </>
            )}
            {importResult && (
              <div className="space-y-3">
                <div className="text-[12px] font-bold uppercase tracking-wider text-slate-500">{t('importResult')}</div>
                <div className="grid grid-cols-4 gap-2">
                  <ImportStat label="Qo'shildi" value={importResult.added || 0} tone="emerald" />
                  <ImportStat label="Yangilandi" value={importResult.updated || 0} tone="blue" />
                  <ImportStat label="O'zgarmagan" value={importResult.skipped || 0} tone="amber" />
                  <ImportStat label="Xato" value={importResult.failed || 0} tone="rose" />
                </div>

                {/* O'zgarmaganlar haqida qisqacha izoh */}
                {importResult.skipped > 0 && (
                  <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[11px] text-amber-900 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <b>{importResult.skipped} ta qator o'zgarmagan</b> — INN va nom DB'da xuddi shunday turibdi.
                      Ro'yxatga qo'shilmadi (UI'ni og'irlashtirmaslik uchun).
                    </div>
                  </div>
                )}

                {/* O'zgargan / xato qatorlar ro'yxati */}
                {(importResult.rows || []).length > 0 ? (
                  <div className="max-h-72 overflow-y-auto rounded-xl ring-1 ring-slate-200 divide-y divide-slate-100">
                    <div className="bg-slate-50 px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 sticky top-0">
                      O'zgargan qatorlar ({(importResult.rows || []).length})
                    </div>
                    {(importResult.rows || []).map((r: any, i: number) => (
                      <div key={i} className="px-3 py-2 flex items-center gap-2 text-[11px]">
                        <span className={cn(
                          'w-2 h-2 rounded-full shrink-0',
                          r.status === 'added' ? 'bg-emerald-500' :
                          r.status === 'updated' ? 'bg-blue-500' :
                          r.status === 'skipped' ? 'bg-amber-500' : 'bg-rose-500',
                        )} />
                        <span className="font-mono font-bold">{r.inn}</span>
                        <span className="text-slate-500 truncate flex-1">{r.name || ''}</span>
                        {r.reason && <span className="text-slate-400 truncate" title={r.reason}>{r.reason}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-4 py-6 text-center text-[12px] text-slate-500">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                    Hammasi o'z joyida — DB allaqachon Excel bilan bir xil. Hech narsa o'zgartirilmadi.
                  </div>
                )}

                {/* Faqat yangi/yangilangan qatorlar bo'lsa — refresh tavsiya */}
                {(importResult.added > 0 || importResult.updated > 0) && (
                  <div className="rounded-lg bg-indigo-50 ring-1 ring-indigo-200 px-3 py-2 text-[11px] text-indigo-900 flex items-start gap-2">
                    <RefreshCw className="h-3.5 w-3.5 text-indigo-600 shrink-0 mt-0.5" />
                    <div>
                      Yangi qatorlar uchun direktor, telefon, reyting va boshqa ma'lumotlar
                      keyingi soatlik cron'da (08:00–22:00) avtomatik to'ldiriladi.
                      Yoki <b>"Hammasini yangilash"</b> tugmasini bosing.
                    </div>
                  </div>
                )}

                <Button onClick={() => { setImportOpen(false); setImportResult(null); }} className="w-full">
                  {tc('close')}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Detail dialog ─── */}
      <Dialog open={!!detailRow} onOpenChange={(o) => { if (!o) setDetailRow(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detailRow && <CounterpartyDetail row={detailRow} t={t} />}
        </DialogContent>
      </Dialog>

      {/* ─── Edit dialog (qo'lda tahrirlash) ─── */}
      <Dialog open={!!editRow} onOpenChange={(o) => { if (!editMut.isPending && !o) setEditRow(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {editRow && (
            <CounterpartyEditForm
              row={editRow}
              t={t}
              tc={tc}
              busy={editMut.isPending}
              onCancel={() => setEditRow(null)}
              onSave={(data) => editMut.mutate({ inn: editRow.inn, data })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ────────────── helpers ──────────────

function KpiTile({
  label, value, sub, icon, gradient, shadow, small,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  gradient: string;
  shadow?: string;
  small?: boolean;
}) {
  return (
    <Card className="border-0 shadow-soft overflow-hidden group hover:shadow-lg hover:-translate-y-0.5 transition-all">
      <CardContent className="p-4 relative">
        {/* Subtle gradient corner accent */}
        <div className={cn(
          'absolute -top-4 -right-4 w-24 h-24 rounded-full bg-gradient-to-br opacity-[0.08] blur-xl pointer-events-none transition-opacity group-hover:opacity-[0.15]',
          gradient,
        )} />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <div className={cn(
              'w-10 h-10 rounded-2xl bg-gradient-to-br grid place-items-center text-white shadow-lg group-hover:scale-110 transition-transform',
              gradient, shadow,
            )}>
              {icon}
            </div>
            <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 truncate">{label}</div>
          </div>
          <div className={cn(
            'font-black tabular-nums tracking-tight text-slate-900 truncate',
            small ? 'text-sm' : 'text-3xl',
          )} title={value}>
            {value}
          </div>
          {sub && <div className="text-[10px] text-slate-500 mt-1 truncate">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

type FilterOption = {
  v: string;
  label: string;
  sub?: string;
  tone?: 'slate' | 'emerald' | 'blue' | 'amber' | 'rose' | 'violet';
};

function FilterDropdown({
  label, icon, activeLabel, options, value, onChange,
}: {
  label: string;
  icon: React.ReactNode;
  activeLabel: string | null; // null = default selected (Hammasi)
  options: FilterOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const isActive = activeLabel !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 px-3 h-10 rounded-xl text-[12px] font-semibold ring-1 transition-colors',
            isActive
              ? 'bg-indigo-50 text-indigo-700 ring-indigo-200 hover:bg-indigo-100'
              : 'bg-slate-50/60 text-slate-700 ring-slate-200 hover:bg-slate-100',
          )}
        >
          <span className={cn('shrink-0', isActive ? 'text-indigo-600' : 'text-slate-400')}>{icon}</span>
          <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">{label}:</span>
          <span className="truncate max-w-[140px]">{activeLabel || 'Hammasi'}</span>
          {isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 ml-0.5 shrink-0" />
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {options.map((opt) => {
          const selected = opt.v === value;
          const toneDot: Record<string, string> = {
            slate: 'bg-slate-400', emerald: 'bg-emerald-500', blue: 'bg-blue-500',
            amber: 'bg-amber-500', rose: 'bg-rose-500', violet: 'bg-violet-500',
          };
          return (
            <DropdownMenuItem
              key={opt.v || 'all'}
              onClick={() => onChange(opt.v)}
              className={cn(
                'cursor-pointer flex items-start gap-2',
                selected && 'bg-indigo-50 focus:bg-indigo-100',
              )}
            >
              <span className={cn(
                'w-2 h-2 rounded-full mt-1.5 shrink-0',
                opt.tone ? toneDot[opt.tone] : 'bg-slate-300',
              )} />
              <div className="min-w-0 flex-1">
                <div className={cn('text-[12px] font-semibold', selected && 'text-indigo-700')}>
                  {opt.label}
                </div>
                {opt.sub && <div className="text-[10px] text-slate-500 truncate">{opt.sub}</div>}
              </div>
              {selected && <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600 shrink-0 mt-1" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IconBtn({
  title, onClick, disabled, primary, children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex items-center justify-center w-10 h-10 rounded-xl transition-all shrink-0',
        'hover:scale-105 active:scale-95',
        primary
          ? 'bg-white text-indigo-700 hover:bg-white shadow-lg shadow-black/10'
          : 'bg-white/15 hover:bg-white/30 text-white ring-1 ring-white/20 backdrop-blur-sm',
        disabled && 'opacity-60 cursor-not-allowed pointer-events-none',
      )}
    >
      {children}
    </button>
  );
}

function ImportStat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'rose' | 'blue' }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 ring-emerald-200 text-emerald-700'
    : tone === 'blue' ? 'bg-blue-50 ring-blue-200 text-blue-700'
    : tone === 'amber' ? 'bg-amber-50 ring-amber-200 text-amber-700'
    : 'bg-rose-50 ring-rose-200 text-rose-700';
  return (
    <div className={cn('rounded-xl ring-1 px-3 py-2 text-center', cls)}>
      <div className="text-[9px] uppercase tracking-wider font-bold opacity-80">{label}</div>
      <div className="text-xl font-black tabular-nums">{value}</div>
    </div>
  );
}

function CounterpartyDetail({ row, t }: { row: Counterparty; t: any }) {
  const grade = ratingGrade(row.rating ?? null);
  const manual = !isStandardInn(row.inn);
  const [historyOpen, setHistoryOpen] = useState(false);

  // History data — faqat ochilganda yuklaymiz (lazy)
  const historyQuery = useQuery({
    queryKey: ['counterparty-history', row.inn],
    queryFn: () => api.get<{ items: any[] }>(`/counterparties/${row.inn}/history?limit=50`),
    staleTime: 10_000,
    enabled: historyOpen,
  });
  const history = historyQuery.data?.items || [];

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-indigo-600" />
          {row.name}
        </DialogTitle>
        <DialogDescription className="flex items-center gap-2">
          <span className="font-mono">{row.inn}</span>
          {manual && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700 text-[9px] font-bold uppercase tracking-wider">
              Qo'lda kiritilgan
            </span>
          )}
        </DialogDescription>
      </DialogHeader>

      {/* Rating with grade letter + level */}
      {grade && (
        <div className={cn(
          'rounded-xl ring-1 px-4 py-3 flex items-center gap-3',
          grade.chip,
        )}>
          <Star className="h-5 w-5 shrink-0" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">{t('rating')}</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <div className="text-2xl font-black tabular-nums">{row.rating}</div>
              <div className="text-xl font-black tracking-tight">{grade.letter}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider font-bold opacity-70">Daraja</div>
            <div className="text-sm font-bold mt-0.5">{grade.level}</div>
          </div>
        </div>
      )}

      {/* Faoliyat turi (Chamber'dan OKED) — prominent */}
      {row.oked && (
        <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 ring-1 ring-indigo-200 px-4 py-3 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shrink-0">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-700 mb-0.5">Faoliyat turi (OKED)</div>
            {(() => {
              const m = String(row.oked).match(/^(\d+)\s*-\s*(.+)$/);
              return m ? (
                <>
                  <div className="text-sm font-bold text-slate-800 leading-snug">{m[2]}</div>
                  <div className="text-[10px] text-indigo-700 font-mono mt-0.5">Kod: {m[1]}</div>
                </>
              ) : (
                <div className="text-sm font-bold text-slate-800">{row.oked}</div>
              );
            })()}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DetailField icon={<User className="h-3.5 w-3.5" />} label={t('director')} value={row.director} />
        <DetailField icon={<User className="h-3.5 w-3.5" />} label={t('accountant')} value={row.accountant} />
        <DetailField icon={<Phone className="h-3.5 w-3.5" />} label={t('phone')} value={row.phone} mono />
        <DetailField icon={<Tag className="h-3.5 w-3.5" />} label={t('email')} value={row.email} />
        <DetailField icon={<Tag className="h-3.5 w-3.5" />} label={t('vatStatus')} value={row.vatStatus} fullWidth />
        <DetailField icon={<Receipt className="h-3.5 w-3.5" />} label={t('vatNumber')} value={row.vatNumber} mono />
      </div>

      {row.address && (
        <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
            <MapPin className="h-3 w-3" /> {t('address')}
          </div>
          <div className="text-[13px] text-slate-800">{row.address}</div>
        </div>
      )}

      {/* Bank accounts */}
      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">
          <Receipt className="h-3 w-3" /> {t('bankAccounts')}
        </div>
        {(row.bankAccounts || []).length === 0 ? (
          <div className="text-[12px] text-slate-400 italic">{t('noBankAccounts')}</div>
        ) : (
          <div className="space-y-1.5">
            {(row.bankAccounts as any[]).map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono font-bold text-slate-800">{b.account}</span>
                {b.mfo && <span className="text-slate-500">· MFO {b.mfo}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
        <div>
          {t('addedBy')}: <b className="text-slate-700">{row.addedByUser?.fullName || row.addedByUser?.email || '—'}</b>
          {' · '}
          {row.addedAt && <span>{formatDateTime(row.addedAt)}</span>}
        </div>
        <div>
          {t('lastFetched')}: <b className="text-slate-700">{row.lastFetchedAt ? formatDateTime(row.lastFetchedAt) : '—'}</b>
        </div>
      </div>

      {/* History (audit log) — collapsible, default closed */}
      <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden bg-white">
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          className={cn(
            'w-full px-4 py-2.5 flex items-center gap-2 transition-colors text-left',
            historyOpen ? 'bg-indigo-50/50' : 'hover:bg-slate-50',
          )}
        >
          <ChevronDown className={cn(
            'h-4 w-4 transition-transform shrink-0',
            historyOpen ? 'text-indigo-600' : 'text-slate-400 -rotate-90',
          )} />
          <Clock className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-[11px] uppercase tracking-wider font-bold text-slate-600">Tarix</span>
          <span className="text-[10px] text-slate-500 ml-auto">
            {historyQuery.isLoading ? '…' : history.length ? `${history.length} ta yozuv` : 'bosing'}
          </span>
        </button>
        <div className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          historyOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}>
          <div className="overflow-hidden">
            <div className="border-t border-slate-100">
              {historyQuery.isLoading ? (
                <div className="px-4 py-4 text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Yuklanmoqda…
                </div>
              ) : history.length === 0 ? (
                <div className="px-4 py-4 text-[11px] text-slate-400">Hozircha yozuv yo'q</div>
              ) : (
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {history.map((h) => (
                    <HistoryRow key={h.id} h={h} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  name: 'Nomi',
  fullName: 'To\'liq nom',
  director: 'Direktor',
  accountant: 'Bosh hisobchi',
  phone: 'Telefon',
  email: 'Email',
  address: 'Manzil',
  vatNumber: 'QQS reg kodi',
  vatStatus: 'QQS holati',
  oked: 'OKED',
  rating: 'Reyting',
  bankAccounts: 'Bank hisoblari',
  notes: 'Izoh',
  isActive: 'Faol',
};

function HistoryRow({ h }: { h: any }) {
  const [open, setOpen] = useState(false);
  const actionMeta: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    created:      { label: 'Qo\'shildi',         cls: 'bg-emerald-100 text-emerald-700', icon: <Plus className="h-3 w-3" /> },
    imported:     { label: 'Import',             cls: 'bg-blue-100 text-blue-700',       icon: <Upload className="h-3 w-3" /> },
    manual_edit:  { label: 'Tahrir',             cls: 'bg-violet-100 text-violet-700',   icon: <FileText className="h-3 w-3" /> },
    refreshed:    { label: 'Yangilash',          cls: 'bg-indigo-100 text-indigo-700',   icon: <RefreshCw className="h-3 w-3" /> },
    cron_refresh: { label: 'Avto-yangilash',     cls: 'bg-slate-100 text-slate-700',     icon: <Clock className="h-3 w-3" /> },
    deleted:      { label: 'O\'chirildi',        cls: 'bg-rose-100 text-rose-700',       icon: <Trash2 className="h-3 w-3" /> },
  };
  const m = actionMeta[h.action] || { label: h.action, cls: 'bg-slate-100 text-slate-700', icon: null };
  const changes = h.changes && typeof h.changes === 'object' ? h.changes : null;
  const hasChanges = changes && Object.keys(changes).length > 0;

  return (
    <div className="px-4 py-2 hover:bg-slate-50/40">
      <button
        type="button"
        onClick={() => hasChanges && setOpen((o) => !o)}
        className={cn('w-full flex items-start gap-2 text-left', hasChanges && 'cursor-pointer')}
      >
        <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider shrink-0', m.cls)}>
          {m.icon} {m.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-slate-700 flex items-center gap-1.5 flex-wrap">
            <b>{h.actorName || '—'}</b>
            {h.source && h.source !== 'none' && (
              <span className="text-slate-500">· {h.source}</span>
            )}
            {hasChanges && (
              <span className="text-[10px] text-indigo-600 font-semibold inline-flex items-center gap-0.5">
                {Object.keys(changes).length} o'zgarish
                <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
              </span>
            )}
          </div>
          {h.note && !hasChanges && (
            <div className="text-[10px] text-slate-500 truncate" title={h.note}>{h.note}</div>
          )}
        </div>
        <div className="text-[10px] text-slate-400 tabular-nums shrink-0 pt-0.5">{formatDateTime(h.createdAt)}</div>
      </button>

      {/* O'zgarishlar tafsiloti */}
      {hasChanges && open && (
        <div className="mt-2 ml-1 space-y-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-200 p-2.5">
          {Object.entries(changes).map(([field, diff]: [string, any]) => (
            <div key={field} className="text-[11px]">
              <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-0.5">
                {FIELD_LABEL[field] || field}
              </div>
              <div className="flex items-start gap-1.5 flex-wrap">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 ring-1 ring-rose-200 line-through max-w-[220px] truncate font-mono text-[10px]" title={formatHistoryValue(diff.old)}>
                  {formatHistoryValue(diff.old) || '—'}
                </span>
                <span className="text-slate-400 text-[10px] pt-0.5">→</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 max-w-[220px] truncate font-mono text-[10px]" title={formatHistoryValue(diff.new)}>
                  {formatHistoryValue(diff.new) || '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatHistoryValue(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    // bankAccounts uchun chiroyli ko'rinish
    return v.map((b: any) => {
      if (b?.account) return `${b.account}${b.mfo ? ` (MFO ${b.mfo})` : ''}`;
      return JSON.stringify(b);
    }).join('; ');
  }
  try { return JSON.stringify(v); } catch { return String(v); }
}

function CounterpartyEditForm({
  row, t, tc, busy, onCancel, onSave,
}: {
  row: Counterparty;
  t: any;
  tc: any;
  busy: boolean;
  onCancel: () => void;
  onSave: (data: any) => void;
}) {
  const [form, setForm] = useState({
    name: row.name || '',
    fullName: row.fullName || '',
    director: row.director || '',
    accountant: row.accountant || '',
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    vatNumber: row.vatNumber || '',
    vatStatus: row.vatStatus || '',
    oked: row.oked || '',
    rating: row.rating == null ? '' : String(row.rating),
    notes: '',
  });
  const [accounts, setAccounts] = useState<Array<{ account: string; mfo: string }>>(
    Array.isArray(row.bankAccounts) && row.bankAccounts.length > 0
      ? (row.bankAccounts as any[]).map((b) => ({ account: b.account || '', mfo: b.mfo || '' }))
      : [{ account: '', mfo: '' }],
  );

  function submit() {
    const data: any = {
      name: form.name.trim(),
      fullName: form.fullName.trim() || null,
      director: form.director.trim() || null,
      accountant: form.accountant.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      vatNumber: form.vatNumber.trim() || null,
      vatStatus: form.vatStatus.trim() || null,
      oked: form.oked.trim() || null,
      rating: form.rating === '' ? null : Number(form.rating),
      bankAccounts: accounts.filter((a) => a.account.trim()).map((a) => ({
        account: a.account.trim(), mfo: a.mfo.trim() || null,
      })),
    };
    onSave(data);
  }

  return (
    <div className="space-y-3">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-indigo-600" />
          {t('edit')} — {row.inn}
        </DialogTitle>
      </DialogHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <EditField label={t('nameLabel') + ' *'} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <EditField label={t('fullName')} value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} />
        <EditField label={t('director')} value={form.director} onChange={(v) => setForm({ ...form, director: v })} />
        <EditField label={t('accountant')} value={form.accountant} onChange={(v) => setForm({ ...form, accountant: v })} />
        <EditField label={t('phone')} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} mono />
        <EditField label={t('email')} value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <EditField label={t('vatNumber')} value={form.vatNumber} onChange={(v) => setForm({ ...form, vatNumber: v })} mono />
        <EditField label={t('vatStatus')} value={form.vatStatus} onChange={(v) => setForm({ ...form, vatStatus: v })} />
        <EditField label={t('oked')} value={form.oked} onChange={(v) => setForm({ ...form, oked: v })} fullWidth />
        <EditField label={t('rating')} value={form.rating} onChange={(v) => setForm({ ...form, rating: v.replace(/\D/g, '') })} mono />
        <EditField label={t('address')} value={form.address} onChange={(v) => setForm({ ...form, address: v })} fullWidth />
      </div>

      {/* Bank hisoblari */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] uppercase tracking-wider font-bold text-slate-500">{t('bankAccounts')}</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1"
            onClick={() => setAccounts([...accounts, { account: '', mfo: '' }])}
          >
            <Plus className="h-3 w-3" /> +
          </Button>
        </div>
        {accounts.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              placeholder="20208000…"
              value={a.account}
              onChange={(e) => {
                const next = [...accounts]; next[i] = { ...next[i], account: e.target.value.replace(/\D/g, '').slice(0, 20) };
                setAccounts(next);
              }}
              className="font-mono text-[12px] h-9 flex-1"
            />
            <Input
              placeholder="MFO"
              value={a.mfo}
              onChange={(e) => {
                const next = [...accounts]; next[i] = { ...next[i], mfo: e.target.value.replace(/\D/g, '').slice(0, 5) };
                setAccounts(next);
              }}
              className="font-mono text-[12px] h-9 w-24"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 w-9 p-0 text-rose-600"
              onClick={() => setAccounts(accounts.filter((_, j) => j !== i))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
        <Button variant="outline" onClick={onCancel} disabled={busy} className="flex-1">
          {tc('cancel')}
        </Button>
        <Button
          onClick={submit}
          disabled={busy || !form.name.trim()}
          className="flex-1 gap-2 bg-indigo-600 hover:bg-indigo-700"
        >
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('saving')}</> : <>{t('saveBtn')}</>}
        </Button>
      </div>
    </div>
  );
}

function EditField({
  label, value, onChange, mono, fullWidth,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div className={cn('space-y-1', fullWidth && 'md:col-span-2')}>
      <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn('h-9 text-[13px]', mono && 'font-mono text-[12px]')}
      />
    </div>
  );
}

function DetailField({
  icon, label, value, mono, fullWidth,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div className={cn('rounded-xl ring-1 ring-slate-200 px-3 py-2', fullWidth && 'md:col-span-2')}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className={cn('text-[13px] text-slate-800 break-words', mono && 'font-mono text-[12px]', !value && 'text-slate-400 italic')}>
        {value || '—'}
      </div>
    </div>
  );
}
