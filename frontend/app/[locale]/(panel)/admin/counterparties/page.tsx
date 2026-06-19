'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Plus, Upload, Download, RefreshCw, X, Loader2,
  Briefcase, User, Phone, MapPin, FileText, Trash2, Eye, MoreVertical,
  AlertCircle, CheckCircle2, Clock, Star, Building2, Tag, Receipt,
  ChevronDown, Settings as SettingsIcon, Power, History, Lock, ShieldAlert,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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
  if (r >= 96) return make('AAA', 'Yuqori',    'emerald', 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900');
  if (r >= 91) return make('AA',  'Yuqori',    'emerald', 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900');
  if (r >= 86) return make('A',   'Yuqori',    'emerald', 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900');
  if (r >= 76) return make('BBB', "O'rta",     'blue',    'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-900');
  if (r >= 66) return make('BB',  "O'rta",     'blue',    'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-900');
  if (r >= 56) return make('B',   "O'rta",     'blue',    'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-900');
  if (r >= 51) return make('CCC', 'Qoniqarli', 'amber',   'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900');
  if (r >= 36) return make('CC',  'Qoniqarli', 'amber',   'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900');
  if (r >= 26) return make('C',   'Qoniqarli', 'amber',   'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900');
  return make('D',   'Quyi',      'rose',    'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900');
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
        stats?: { total: number; enrichedCount: number; enrichedPct: number; avgRating: number | null; ratedCount: number; lastFetchedAt: string | null };
      }>(`/counterparties?${p}`);
    },
  });

  const addMut = useMutation({
    mutationFn: (body: { inn: string; name: string }) =>
      api.post<{ ok: boolean; didoxFetched?: boolean }>('/counterparties', body),
    onSuccess: (r) => {
      toast.success(t('addedOk') + (r?.didoxFetched === false ? ` (${t('didoxNoResponse')})` : ''));
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
      toast.success(r?.message || t('refreshAllStarted'));
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
    enrichedCount: stats?.enrichedCount ?? 0,
    enrichedPct: stats?.enrichedPct ?? 0,
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
            label={t('kpiEnriched')}
            value={`${kpis.enrichedPct}%`}
            sub={t('kpiEnrichedSub', { n: kpis.enrichedCount, total: kpis.total })}
            progress={kpis.enrichedPct}
            icon={<CheckCircle2 className="h-5 w-5" strokeWidth={2.4} />}
            gradient="from-emerald-500 via-emerald-500 to-teal-600"
            shadow="shadow-emerald-500/30"
          />
          <KpiTile
            label={t('kpiAvgRating')}
            value={kpis.avgRating != null ? String(kpis.avgRating) : '—'}
            sub={kpis.ratedCount ? t('kpiRatedSub', { n: kpis.ratedCount }) : t('kpiNoRating')}
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

        {/* Search + compact filter dropdowns + actions */}
        <Card className="border-0 shadow-soft overflow-visible">
          <CardContent className="p-4 flex items-center gap-2 flex-wrap">
            {/* Settings icon — auto-refresh toggle, refresh all, truncate, tarix */}
            {canManage && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                title="Sozlamalar va tarix"
                aria-label="Sozlamalar"
                className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 hover:ring-slate-300 dark:hover:ring-slate-600 text-slate-600 dark:text-slate-300 transition-colors shrink-0"
              >
                <SettingsIcon className="h-4 w-4" />
              </button>
            )}

            {/* Search */}
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
              <Input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder={t('search')}
                className="pl-9 pr-8 h-10 rounded-xl bg-slate-50/60 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700 focus-visible:bg-white dark:focus-visible:bg-slate-800"
              />
              {q && (
                <button
                  onClick={() => { setQ(''); setPage(1); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Reyting filter dropdown */}
            <FilterDropdown
              label={t('rating')}
              allLabel={tc('all')}
              activeLabel={
                ratingTier === 'high' ? t('ratingHigh')
                : ratingTier === 'mid' ? t('ratingMid')
                : ratingTier === 'ok' ? t('ratingOk')
                : ratingTier === 'low' ? t('ratingLow')
                : ratingTier === 'none' ? t('ratingNone')
                : null
              }
              icon={<Star className="h-3.5 w-3.5" />}
              options={[
                { v: '',     label: tc('all'),        sub: undefined },
                { v: 'high', label: t('ratingHigh'),  sub: '≥86 (AAA/AA/A)',  tone: 'emerald' },
                { v: 'mid',  label: t('ratingMid'),   sub: '56-85 (BBB/BB/B)', tone: 'blue' },
                { v: 'ok',   label: t('ratingOk'),    sub: '26-55 (CCC/CC/C)', tone: 'amber' },
                { v: 'low',  label: t('ratingLow'),   sub: '≤25 (D)',          tone: 'rose' },
                { v: 'none', label: t('ratingNone'),  sub: t('ratingNoneSub'), tone: 'slate' },
              ]}
              value={ratingTier}
              onChange={(v) => { setRatingTier(v as any); setPage(1); }}
            />

            {/* Holat filter dropdown */}
            <FilterDropdown
              label={t('statusLabel')}
              allLabel={tc('all')}
              activeLabel={
                statusFilter === 'enriched' ? t('statusEnriched')
                : statusFilter === 'manual' ? t('statusManualShort')
                : statusFilter === 'never' ? t('statusNever')
                : statusFilter === 'error' ? tc('error')
                : null
              }
              icon={<Tag className="h-3.5 w-3.5" />}
              options={[
                { v: '',         label: tc('all') },
                { v: 'enriched', label: t('statusEnriched'), sub: t('statusEnrichedSub'), tone: 'emerald' },
                { v: 'manual',   label: t('statusManual'),   sub: t('statusManualSub'), tone: 'violet' },
                { v: 'never',    label: t('statusNever'),    sub: t('statusNeverSub'),            tone: 'amber' },
                { v: 'error',    label: tc('error'),         sub: t('statusErrorSub'),  tone: 'rose' },
              ]}
              value={statusFilter}
              onChange={(v) => { setStatusFilter(v as any); setPage(1); }}
            />

            {/* Saralash dropdown */}
            <FilterDropdown
              label={t('sortLabel')}
              allLabel={tc('all')}
              activeLabel={(() => {
                const k = `${sortBy}:${sortDir}`;
                if (k === 'addedAt:desc') return null; // default
                if (k === 'addedAt:asc')        return t('sortAddedOld');
                if (k === 'name:asc')           return t('sortNameAz');
                if (k === 'name:desc')          return t('sortNameZa');
                if (k === 'rating:desc')        return t('sortRatingHigh');
                if (k === 'rating:asc')         return t('sortRatingLow');
                if (k === 'lastFetchedAt:desc') return t('sortFetchedNew');
                if (k === 'lastFetchedAt:asc')  return t('sortFetchedOld');
                return null;
              })()}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              options={[
                { v: 'addedAt:desc',        label: t('sortAddedNew'),    sub: t('sortDefault') },
                { v: 'addedAt:asc',         label: t('sortAddedOld') },
                { v: 'name:asc',            label: t('sortNameAz') },
                { v: 'name:desc',           label: t('sortNameZa') },
                { v: 'rating:desc',         label: t('sortRatingHigh') },
                { v: 'rating:asc',          label: t('sortRatingLow') },
                { v: 'lastFetchedAt:desc',  label: t('sortFetchedNew') },
                { v: 'lastFetchedAt:asc',   label: t('sortFetchedOld') },
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
                className="text-[12px] text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 font-medium inline-flex items-center gap-1 px-3 h-10 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors"
              >
                <X className="h-3.5 w-3.5" /> {t('filterReset')}
              </button>
            )}

            {/* Actions — faqat Excel export icon (Yangi kontragent Settings dialogga ko'chirildi) */}
            <div className="ml-auto flex items-center gap-2">
              <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
              <button
                type="button"
                onClick={onExport}
                title={t('export')}
                aria-label={t('export')}
                className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:ring-blue-300 dark:hover:ring-blue-800 text-blue-600 dark:text-blue-400 transition-colors"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
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
                    <tr className="bg-slate-50/80 dark:bg-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
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
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {items.map((it) => {
                      const isRefreshing = refreshingInn === it.inn;
                      const grade = ratingGrade(it.rating ?? null);
                      const manual = !isStandardInn(it.inn);
                      return (
                        <tr
                          key={it.inn}
                          className="group cursor-pointer border-l-4 border-l-transparent hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:border-l-indigo-500 transition-all duration-150"
                          onClick={() => setDetailRow(it)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[12px] font-bold text-slate-900 dark:text-slate-100">{it.inn}</span>
                              {manual && (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[9px] font-bold uppercase tracking-wider"
                                  title={t('manualInnHint')}
                                >
                                  {t('manualBadge')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 max-w-[300px]">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate" title={it.name}>{it.name}</div>
                            {it.oked && (
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-1 mt-0.5" title={it.oked}>
                                <Building2 className="h-2.5 w-2.5 text-slate-400 dark:text-slate-500" />
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
                              <span className="text-slate-400 dark:text-slate-500 text-[11px]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">{it.phone || '—'}</td>
                          <td className="px-4 py-3 text-[11px] text-slate-600 dark:text-slate-300 truncate max-w-[200px]" title={it.vatStatus || ''}>
                            {it.vatStatus || '—'}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {isRefreshing ? (
                              <span className="inline-flex items-center gap-1 text-indigo-600">
                                <Loader2 className="h-3 w-3 animate-spin" /> {t('syncing')}
                              </span>
                            ) : it.lastFetchError ? (
                              <span className="inline-flex items-center gap-1 text-rose-600" title={it.lastFetchError}>
                                <AlertCircle className="h-3 w-3" /> {t('errorShort')}
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
            <div className="text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                {((page - 1) * perPage) + 1}–{Math.min(page * perPage, total)}
              </span> / {t('ofTotal', { n: total })}
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              {/* Har sahifada nechta */}
              <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span>{t('perPageLabel')}</span>
                <Select value={String(perPage)} onValueChange={(v) => { setPerPage(Number(v)); setPage(1); }}>
                  <SelectTrigger className="h-9 w-[78px] rounded-full text-xs font-semibold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100, 200].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Sahifaga sakrash */}
              <PageJumper page={page} totalPages={totalPages} onJump={setPage} label={t('goToPage')} />

              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)} className="h-9 w-9 p-0 rounded-full">«</Button>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-9 w-9 p-0 rounded-full">‹</Button>
                <div className="text-xs font-semibold tabular-nums px-3">{page} / {totalPages}</div>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-9 w-9 p-0 rounded-full">›</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="h-9 w-9 p-0 rounded-full">»</Button>
              </div>
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
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                {t('innLabel')} <span className="text-rose-500 dark:text-rose-400">*</span>
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
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                {t('nameLabel')} <span className="text-rose-500 dark:text-rose-400">*</span>
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
                <div className="text-[12px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('importResult')}</div>
                <div className="grid grid-cols-4 gap-2">
                  <ImportStat label={t('added')} value={importResult.added || 0} tone="emerald" />
                  <ImportStat label={t('updated')} value={importResult.updated || 0} tone="blue" />
                  <ImportStat label={t('unchanged')} value={importResult.skipped || 0} tone="amber" />
                  <ImportStat label={t('failed')} value={importResult.failed || 0} tone="rose" />
                </div>

                {/* O'zgarmaganlar haqida qisqacha izoh */}
                {importResult.skipped > 0 && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-300 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <b>{t('importUnchangedNote', { n: importResult.skipped })}</b> {t('importUnchangedDesc')}
                    </div>
                  </div>
                )}

                {/* O'zgargan / xato qatorlar ro'yxati */}
                {(importResult.rows || []).length > 0 ? (
                  <div className="max-h-72 overflow-y-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                    <div className="bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 sticky top-0">
                      {t('changedRows', { n: (importResult.rows || []).length })}
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
                        <span className="text-slate-500 dark:text-slate-400 truncate flex-1">{r.name || ''}</span>
                        {r.reason && <span className="text-slate-400 dark:text-slate-500 truncate" title={r.reason}>{r.reason}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 px-4 py-6 text-center text-[12px] text-slate-500 dark:text-slate-400">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                    {t('importNoChanges')}
                  </div>
                )}

                {/* Faqat yangi/yangilangan qatorlar bo'lsa — refresh tavsiya */}
                {(importResult.added > 0 || importResult.updated > 0) && (
                  <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-200 dark:ring-indigo-900 px-3 py-2 text-[11px] text-indigo-900 dark:text-indigo-300 flex items-start gap-2">
                    <RefreshCw className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      {t('importEnrichNote')} <b>"{t('refreshAll')}"</b> {t('importEnrichNote2')}
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

      {/* ─── Settings dialog (gear icon) ─── */}
      <CounterpartiesSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        canManage={canManage}
        onAddNew={() => {
          setSettingsOpen(false);
          setAddOpen(true);
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//   COUNTERPARTIES SETTINGS DIALOG
// ═══════════════════════════════════════════════════════════════

type ActivityLogEntry = {
  timestamp: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  details: any;
};

const ACTION_META: Record<string, { label: string; icon: string; tone: string }> = {
  refresh_all_started:     { label: 'Hammasini yangilash boshlandi',      icon: '🔄', tone: 'indigo' },
  refresh_all_completed:   { label: 'Hammasini yangilash yakunlandi',      icon: '✓',  tone: 'emerald' },
  auto_refresh_enabled:    { label: 'Avto-yangilash YOQILDI',              icon: '🟢', tone: 'emerald' },
  auto_refresh_disabled:   { label: 'Avto-yangilash O\'CHIRILDI',          icon: '🔴', tone: 'rose' },
  truncated:               { label: 'BAZA TOZALANDI (truncate)',           icon: '🗑️', tone: 'rose' },
  imported:                { label: 'Excel\'dan import qilindi',           icon: '📥', tone: 'violet' },
  manual_refresh:          { label: 'Qo\'lda yangilash',                   icon: '👆', tone: 'amber' },
  deleted:                 { label: 'Qator o\'chirildi',                   icon: '✗',  tone: 'rose' },
};

function CounterpartiesSettingsDialog({
  open, onOpenChange, canManage, onAddNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onAddNew: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'settings' | 'history'>('settings');
  const [truncateOpen, setTruncateOpen] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ['counterparties-settings'],
    queryFn: () => api.get<{ autoRefreshEnabled: boolean }>('/counterparties/_settings'),
    enabled: open,
    refetchOnWindowFocus: false,
  });

  const logQuery = useQuery({
    queryKey: ['counterparties-activity-log'],
    queryFn: () => api.get<{ ok: boolean; items: ActivityLogEntry[] }>('/counterparties/_activity-log?limit=100'),
    enabled: open && tab === 'history',
    refetchOnWindowFocus: false,
  });

  const toggleMut = useMutation({
    mutationFn: (enabled: boolean) => api.post<{ ok: boolean; enabled: boolean }>('/counterparties/_settings/auto-refresh', { enabled }),
    onSuccess: (r) => {
      toast.success(r.enabled ? 'Avto-yangilash YOQILDI' : 'Avto-yangilash O\'CHIRILDI');
      qc.invalidateQueries({ queryKey: ['counterparties-settings'] });
      qc.invalidateQueries({ queryKey: ['counterparties-activity-log'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const refreshAllMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; started?: boolean; message?: string }>('/counterparties/refresh-all'),
    onSuccess: (r: any) => {
      if (r?.ok && r?.started) toast.success(r?.message || 'Yangilash boshlandi');
      else toast.warning(r?.message || 'Yangilash boshlanmadi');
      qc.invalidateQueries({ queryKey: ['counterparties-activity-log'] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ['counterparties'] }), 30_000);
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const enabled = settingsQuery.data?.autoRefreshEnabled ?? true;
  const items = logQuery.data?.items || [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col">
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 dark:from-slate-200 dark:to-slate-100 grid place-items-center text-white dark:text-slate-900">
                  <SettingsIcon className="h-4 w-4" />
                </div>
                Kontragentlar — sozlamalar
              </DialogTitle>
              <DialogDescription className="text-[12px]">
                Auto-yangilash holatini boshqarish, hammasini yangilash, baza tozalash va tarix.
              </DialogDescription>
            </DialogHeader>
          </div>

          {/* Tabs */}
          <div className="px-5 pt-3 border-b border-slate-200 dark:border-slate-800 flex gap-1">
            <button
              onClick={() => setTab('settings')}
              className={cn(
                'px-3 py-2 text-[12.5px] font-semibold border-b-2 transition-colors -mb-px',
                tab === 'settings' ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              <SettingsIcon className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
              Sozlamalar
            </button>
            <button
              onClick={() => setTab('history')}
              className={cn(
                'px-3 py-2 text-[12.5px] font-semibold border-b-2 transition-colors -mb-px',
                tab === 'history' ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              <History className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
              Tarix
              {items.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold">
                  {items.length}
                </span>
              )}
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5">
            {tab === 'settings' ? (
              <div className="space-y-4">
                {/* Yangi kontragent qo'shish */}
                {canManage && (
                  <div className="rounded-xl ring-1 ring-indigo-200 dark:ring-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20 p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 grid place-items-center shrink-0">
                        <Plus className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-[13.5px] text-slate-900 dark:text-slate-100 mb-1">
                          Yangi kontragent
                        </div>
                        <div className="text-[11.5px] text-slate-600 dark:text-slate-400 mb-3">
                          INN va nom kiritib qo'shing — qolgani DIDOX/Chamber'dan avtomatik to'ldiriladi.
                        </div>
                        <Button
                          size="sm"
                          onClick={onAddNew}
                          className="bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm hover:from-indigo-600 hover:to-violet-700 gap-1.5"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Yangi kontragent qo'shish
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Auto-refresh toggle */}
                <div className={cn(
                  'rounded-xl ring-1 p-4 transition-all',
                  enabled
                    ? 'ring-emerald-200 dark:ring-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30'
                    : 'ring-rose-200 dark:ring-rose-900 bg-rose-50/50 dark:bg-rose-950/30',
                )}>
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'w-10 h-10 rounded-lg grid place-items-center shrink-0',
                      enabled
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                        : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
                    )}>
                      <Power className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-bold text-[13.5px] text-slate-900 dark:text-slate-100">
                          DIDOX va Chamber so'rovlari
                        </div>
                        <button
                          onClick={() => toggleMut.mutate(!enabled)}
                          disabled={toggleMut.isPending || settingsQuery.isLoading}
                          className={cn(
                            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
                            enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700',
                          )}
                        >
                          <span className={cn(
                            'inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform',
                            enabled ? 'translate-x-5' : 'translate-x-0.5',
                          )} />
                        </button>
                      </div>
                      <div className="text-[11.5px] text-slate-600 dark:text-slate-400 mt-1">
                        {enabled ? (
                          <>✓ Yoqilgan — har soatda (08:00-22:00) avtomatik yangilanadi va qo'lda ham ishlatish mumkin.</>
                        ) : (
                          <>✗ O'chirilgan — cron va qo'lda yangilash <strong>BLOKLANGAN</strong>. Hech qanday so'rov DIDOX/Chamber'ga yuborilmaydi.</>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Refresh all button */}
                <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 grid place-items-center shrink-0">
                      <RefreshCw className={cn('h-5 w-5', refreshAllMut.isPending && 'animate-spin')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[13.5px] text-slate-900 dark:text-slate-100 mb-1">
                        Hammasini yangilash
                      </div>
                      <div className="text-[11.5px] text-slate-600 dark:text-slate-400 mb-3">
                        Barcha standart INN'lar uchun DIDOX + Chamber so'rovi yuboriladi. Fonda ishlaydi.
                      </div>
                      <Button
                        size="sm"
                        onClick={() => refreshAllMut.mutate()}
                        disabled={refreshAllMut.isPending || !enabled}
                        className="bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm hover:from-amber-600 hover:to-orange-700 gap-1.5"
                      >
                        {refreshAllMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Hammasini yangilash
                      </Button>
                      {!enabled && (
                        <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-2 flex items-center gap-1.5">
                          <AlertCircle className="h-3 w-3" />
                          Avval yuqoridagi togglni yoqing — so'rovlar o'chirilgan
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Truncate (DANGER) */}
                <div className="rounded-xl ring-1 ring-rose-200 dark:ring-rose-900 bg-rose-50/30 dark:bg-rose-950/20 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 grid place-items-center shrink-0">
                      <ShieldAlert className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[13.5px] text-rose-900 dark:text-rose-300 mb-1">
                        Bazani tozalash (DANGER)
                      </div>
                      <div className="text-[11.5px] text-rose-700 dark:text-rose-400 mb-3">
                        BARCHA kontragentlar va ularning tarixi o'chiriladi. Bu amal qaytarib bo'lmaydi. Parol talab qilinadi.
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTruncateOpen(true)}
                        className="border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/30 gap-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Bazani tozalash...
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // ─── HISTORY TAB ───
              <div>
                {logQuery.isLoading ? (
                  <div className="py-12 text-center text-slate-400">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    <div className="text-[12px]">Tarix yuklanmoqda...</div>
                  </div>
                ) : items.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 dark:text-slate-500">
                    <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <div className="text-[13px] font-medium">Tarix bo'sh</div>
                    <div className="text-[11px] mt-1">Auto-refresh yoqilgach yoki amallar bajarilgach, bu yerda ko'rinadi.</div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {items.map((entry, i) => {
                      const meta = ACTION_META[entry.action] || { label: entry.action, icon: '•', tone: 'slate' };
                      const tones: Record<string, string> = {
                        indigo:  'bg-indigo-50  dark:bg-indigo-950/40  ring-indigo-200  dark:ring-indigo-900  text-indigo-900  dark:text-indigo-300',
                        emerald: 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-900 dark:text-emerald-300',
                        amber:   'bg-amber-50   dark:bg-amber-950/40   ring-amber-200   dark:ring-amber-900   text-amber-900   dark:text-amber-300',
                        rose:    'bg-rose-50    dark:bg-rose-950/40    ring-rose-200    dark:ring-rose-900    text-rose-900    dark:text-rose-300',
                        violet:  'bg-violet-50  dark:bg-violet-950/40  ring-violet-200  dark:ring-violet-900  text-violet-900  dark:text-violet-300',
                        slate:   'bg-slate-50   dark:bg-slate-900     ring-slate-200    dark:ring-slate-700   text-slate-700   dark:text-slate-300',
                      };
                      return (
                        <div
                          key={i}
                          className={cn('rounded-lg ring-1 px-3 py-2 flex items-start gap-2.5', tones[meta.tone] || tones.slate)}
                        >
                          <div className="text-lg leading-none shrink-0 mt-0.5">{meta.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12.5px] font-bold truncate">{meta.label}</div>
                            <div className="text-[10.5px] opacity-80 flex items-center gap-2 mt-0.5">
                              <Clock className="h-3 w-3" />
                              <span>{formatDateTime(entry.timestamp)}</span>
                              <span>·</span>
                              <span className="truncate">{entry.actorName || 'cron'}</span>
                            </div>
                            {entry.details && (
                              <div className="text-[10.5px] opacity-75 mt-1 font-mono">
                                {Object.entries(entry.details).map(([k, v]) => (
                                  <span key={k} className="mr-2">{k}={String(v)}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Yopish</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Truncate password dialog */}
      <TruncatePasswordDialog
        open={truncateOpen}
        onOpenChange={setTruncateOpen}
        onSuccess={() => {
          setTruncateOpen(false);
          onOpenChange(false);
          qc.invalidateQueries({ queryKey: ['counterparties'] });
          qc.invalidateQueries({ queryKey: ['counterparties-activity-log'] });
        }}
      />
    </>
  );
}

function TruncatePasswordDialog({
  open, onOpenChange, onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState('');

  const truncateMut = useMutation({
    mutationFn: (pw: string) => api.post<{ ok: boolean; deleted: { counterparties: number; history: number } }>('/counterparties/_truncate', { password: pw }),
    onSuccess: (r) => {
      toast.success(`Tozalandi: ${r.deleted.counterparties} kontragent + ${r.deleted.history} tarix qator`);
      setPassword('');
      onSuccess();
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  useEffect(() => {
    if (!open) setPassword('');
  }, [open]);

  const canSubmit = password.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
            <ShieldAlert className="h-5 w-5" />
            Bazani tozalashni tasdiqlash
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Bu amal <strong>QAYTARIB BO'LMAYDI</strong>. Barcha kontragentlar va ularning tarixi o'chiriladi.
          </DialogDescription>
        </DialogHeader>
        <div className="pt-2">
          <Label htmlFor="trunc-pw" className="text-[11.5px] font-bold uppercase tracking-wider">Parol</Label>
          <Input
            id="trunc-pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) truncateMut.mutate(password); }}
            placeholder="Parolni kiriting"
            className="mt-1.5 font-mono"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={truncateMut.isPending}>
            Bekor qilish
          </Button>
          <Button
            onClick={() => truncateMut.mutate(password)}
            disabled={!canSubmit || truncateMut.isPending}
            className="bg-rose-600 hover:bg-rose-700 text-white gap-1.5"
          >
            {truncateMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            HAMMASINI TOZALASH
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ────────────── helpers ──────────────

function KpiTile({
  label, value, sub, icon, gradient, shadow, small, progress,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  gradient: string;
  shadow?: string;
  small?: boolean;
  progress?: number; // 0-100
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
            <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 dark:text-slate-400 truncate">{label}</div>
          </div>
          <div className={cn(
            'font-black tabular-nums tracking-tight text-slate-900 dark:text-slate-100 truncate',
            small ? 'text-sm' : 'text-3xl',
          )} title={value}>
            {value}
          </div>
          {sub && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate">{sub}</div>}
          {progress != null && (
            <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700', gradient)}
                style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
              />
            </div>
          )}
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
  label, icon, activeLabel, allLabel, options, value, onChange,
}: {
  label: string;
  icon: React.ReactNode;
  activeLabel: string | null; // null = default selected (Hammasi)
  allLabel: string;
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
              ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-900 hover:bg-indigo-100 dark:hover:bg-indigo-900/30'
              : 'bg-slate-50/60 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800',
          )}
        >
          <span className={cn('shrink-0', isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500')}>{icon}</span>
          <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">{label}:</span>
          <span className="truncate max-w-[140px]">{activeLabel || allLabel}</span>
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
                selected && 'bg-indigo-50 dark:bg-indigo-950/40 focus:bg-indigo-100 dark:focus:bg-indigo-900/30',
              )}
            >
              <span className={cn(
                'w-2 h-2 rounded-full mt-1.5 shrink-0',
                opt.tone ? toneDot[opt.tone] : 'bg-slate-300',
              )} />
              <div className="min-w-0 flex-1">
                <div className={cn('text-[12px] font-semibold', selected && 'text-indigo-700 dark:text-indigo-300')}>
                  {opt.label}
                </div>
                {opt.sub && <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{opt.sub}</div>}
              </div>
              {selected && <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600 shrink-0 mt-1" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


function ImportStat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'rose' | 'blue' }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-700 dark:text-emerald-300'
    : tone === 'blue' ? 'bg-blue-50 dark:bg-blue-950/40 ring-blue-200 dark:ring-blue-900 text-blue-700 dark:text-blue-300'
    : tone === 'amber' ? 'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900 text-amber-700 dark:text-amber-300'
    : 'bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300';
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
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[9px] font-bold uppercase tracking-wider">
              {t('manualEntered')}
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
            <div className="text-[10px] uppercase tracking-wider font-bold opacity-70">{t('level')}</div>
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
            <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-700 dark:text-indigo-400 mb-0.5">{t('activityType')}</div>
            {(() => {
              const m = String(row.oked).match(/^(\d+)\s*-\s*(.+)$/);
              return m ? (
                <>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-snug">{m[2]}</div>
                  <div className="text-[10px] text-indigo-700 dark:text-indigo-400 font-mono mt-0.5">{t('code')}: {m[1]}</div>
                </>
              ) : (
                <div className="text-sm font-bold text-slate-800 dark:text-slate-200">{row.oked}</div>
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
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1">
            <MapPin className="h-3 w-3" /> {t('address')}
          </div>
          <div className="text-[13px] text-slate-800 dark:text-slate-200">{row.address}</div>
        </div>
      )}

      {/* Bank accounts */}
      <div className="rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 px-4 py-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-2">
          <Receipt className="h-3 w-3" /> {t('bankAccounts')}
        </div>
        {(row.bankAccounts || []).length === 0 ? (
          <div className="text-[12px] text-slate-400 dark:text-slate-500 italic">{t('noBankAccounts')}</div>
        ) : (
          <div className="space-y-1.5">
            {(row.bankAccounts as any[]).map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{b.account}</span>
                {b.mfo && <span className="text-slate-500 dark:text-slate-400">· MFO {b.mfo}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
        <div>
          {t('addedBy')}: <b className="text-slate-700 dark:text-slate-300">{row.addedByUser?.fullName || row.addedByUser?.email || '—'}</b>
          {' · '}
          {row.addedAt && <span>{formatDateTime(row.addedAt)}</span>}
        </div>
        <div>
          {t('lastFetched')}: <b className="text-slate-700 dark:text-slate-300">{row.lastFetchedAt ? formatDateTime(row.lastFetchedAt) : '—'}</b>
        </div>
      </div>

      {/* History (audit log) — collapsible, default closed */}
      <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden bg-white dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          className={cn(
            'w-full px-4 py-2.5 flex items-center gap-2 transition-colors text-left',
            historyOpen ? 'bg-indigo-50/50 dark:bg-indigo-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
          )}
        >
          <ChevronDown className={cn(
            'h-4 w-4 transition-transform shrink-0',
            historyOpen ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500 -rotate-90',
          )} />
          <Clock className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
          <span className="text-[11px] uppercase tracking-wider font-bold text-slate-600 dark:text-slate-300">{t('history')}</span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-auto">
            {historyQuery.isLoading ? '…' : history.length ? t('historyCount', { n: history.length }) : t('clickToExpand')}
          </span>
        </button>
        <div className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          historyOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}>
          <div className="overflow-hidden">
            <div className="border-t border-slate-100 dark:border-slate-800">
              {historyQuery.isLoading ? (
                <div className="px-4 py-4 text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> {t('loadingDots')}
                </div>
              ) : history.length === 0 ? (
                <div className="px-4 py-4 text-[11px] text-slate-400 dark:text-slate-500">{t('noHistoryYet')}</div>
              ) : (
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {history.map((h) => (
                    <HistoryRow key={h.id} h={h} t={t} />
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

const FIELD_LABEL_KEY: Record<string, string> = {
  name: 'fieldName',
  fullName: 'fullName',
  director: 'director',
  accountant: 'accountant',
  phone: 'phone',
  email: 'email',
  address: 'address',
  vatNumber: 'vatNumber',
  vatStatus: 'vatStatus',
  oked: 'oked',
  rating: 'rating',
  bankAccounts: 'bankAccounts',
  notes: 'fieldNotes',
  isActive: 'fieldActive',
};

function HistoryRow({ h, t }: { h: any; t: any }) {
  const [open, setOpen] = useState(false);
  const actionMeta: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    created:      { label: t('actionCreated'),     cls: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300', icon: <Plus className="h-3 w-3" /> },
    imported:     { label: t('actionImported'),    cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',       icon: <Upload className="h-3 w-3" /> },
    manual_edit:  { label: t('actionManualEdit'),  cls: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',   icon: <FileText className="h-3 w-3" /> },
    refreshed:    { label: t('actionRefreshed'),   cls: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',   icon: <RefreshCw className="h-3 w-3" /> },
    cron_refresh: { label: t('actionCronRefresh'), cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',     icon: <Clock className="h-3 w-3" /> },
    deleted:      { label: t('actionDeleted'),     cls: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',       icon: <Trash2 className="h-3 w-3" /> },
  };
  const m = actionMeta[h.action] || { label: h.action, cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300', icon: null };
  const changes = h.changes && typeof h.changes === 'object' ? h.changes : null;
  const hasChanges = changes && Object.keys(changes).length > 0;

  return (
    <div className="px-4 py-2 hover:bg-slate-50/40 dark:hover:bg-slate-800">
      <button
        type="button"
        onClick={() => hasChanges && setOpen((o) => !o)}
        className={cn('w-full flex items-start gap-2 text-left', hasChanges && 'cursor-pointer')}
      >
        <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider shrink-0', m.cls)}>
          {m.icon} {m.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-slate-700 dark:text-slate-300 flex items-center gap-1.5 flex-wrap">
            <b>{h.actorName || '—'}</b>
            {h.source && h.source !== 'none' && (
              <span className="text-slate-500 dark:text-slate-400">· {h.source}</span>
            )}
            {hasChanges && (
              <span className="text-[10px] text-indigo-600 font-semibold inline-flex items-center gap-0.5">
                {t('changesCount', { n: Object.keys(changes).length })}
                <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
              </span>
            )}
          </div>
          {h.note && !hasChanges && (
            <div className="text-[10px] text-slate-500 truncate" title={h.note}>{h.note}</div>
          )}
        </div>
        <div className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums shrink-0 pt-0.5">{formatDateTime(h.createdAt)}</div>
      </button>

      {/* O'zgarishlar tafsiloti */}
      {hasChanges && open && (
        <div className="mt-2 ml-1 space-y-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 p-2.5">
          {Object.entries(changes).map(([field, diff]: [string, any]) => (
            <div key={field} className="text-[11px]">
              <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                {FIELD_LABEL_KEY[field] ? t(FIELD_LABEL_KEY[field]) : field}
              </div>
              <div className="flex items-start gap-1.5 flex-wrap">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900 line-through max-w-[220px] truncate font-mono text-[10px]" title={formatHistoryValue(diff.old)}>
                  {formatHistoryValue(diff.old) || '—'}
                </span>
                <span className="text-slate-400 dark:text-slate-500 text-[10px] pt-0.5">→</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900 max-w-[220px] truncate font-mono text-[10px]" title={formatHistoryValue(diff.new)}>
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
      <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">{t('bankAccounts')}</Label>
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

      <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
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
      <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">{label}</Label>
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
    <div className={cn('rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2', fullWidth && 'md:col-span-2')}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1">
        <span className="text-slate-400 dark:text-slate-500">{icon}</span>
        {label}
      </div>
      <div className={cn('text-[13px] text-slate-800 dark:text-slate-200 break-words', mono && 'font-mono text-[12px]', !value && 'text-slate-400 dark:text-slate-500 italic')}>
        {value || '—'}
      </div>
    </div>
  );
}

function PageJumper({
  page, totalPages, onJump, label,
}: { page: number; totalPages: number; onJump: (n: number) => void; label: string }) {
  const [val, setVal] = useState(String(page));

  // Tashqi page o'zgarsa input ham yangilansin
  useEffect(() => { setVal(String(page)); }, [page]);

  function commit() {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) { setVal(String(page)); return; }
    const clamped = Math.max(1, Math.min(totalPages, n));
    if (clamped !== page) onJump(clamped);
    setVal(String(clamped));
  }

  return (
    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
      <span>{label}</span>
      <Input
        type="number"
        min={1}
        max={totalPages}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        className="h-9 w-[68px] text-center tabular-nums font-semibold text-xs"
      />
    </div>
  );
}
