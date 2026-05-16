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

export default function CounterpartiesPage() {
  const t = useTranslations('counterparties');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const canManage = !!me?.permissions?.includes(PERMS.COUNTERPARTIES_MANAGE);

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [addOpen, setAddOpen] = useState(false);
  const [addInn, setAddInn] = useState('');
  const [addName, setAddName] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [detailRow, setDetailRow] = useState<Counterparty | null>(null);
  const [refreshingInn, setRefreshingInn] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const listQuery = useQuery({
    queryKey: ['counterparties', page, perPage, q],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      if (q) p.set('q', q);
      return api.get<{
        ok: boolean; total: number; page: number; perPage: number;
        items: Counterparty[]; didoxConfigured: boolean;
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
    mutationFn: () => api.post<{ total: number; updated: number; failed: number }>('/counterparties/refresh-all'),
    onSuccess: (r: any) => {
      toast.success(`${r.updated}/${r.total} yangilandi${r.failed ? ` (${r.failed} xato)` : ''}`);
      qc.invalidateQueries({ queryKey: ['counterparties'] });
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  const deleteMut = useMutation({
    mutationFn: (inn: string) => api.delete(`/counterparties/${inn}`),
    onSuccess: () => { toast.success(t('deletedOk')); qc.invalidateQueries({ queryKey: ['counterparties'] }); },
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
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      await apiDownload(`/counterparties/export?${p}`, `kontragentlar-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      toast.error(e?.message || tc('error'));
    }
  }

  const items = listQuery.data?.items || [];
  const total = listQuery.data?.total || 0;
  const didoxOk = listQuery.data?.didoxConfigured ?? true;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // KPI
  const kpis = useMemo(() => {
    const activeVat = items.filter((i) => /активн|faol|active/i.test(i.vatStatus || '')).length;
    const ratings = items.map((i) => i.rating).filter((r): r is number => typeof r === 'number');
    const avgRating = ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
    const lastRefresh = items.reduce<string | null>((acc, it) => {
      if (!it.lastFetchedAt) return acc;
      if (!acc || it.lastFetchedAt > acc) return it.lastFetchedAt;
      return acc;
    }, null);
    return { activeVat, avgRating, lastRefresh };
  }, [items]);

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
                    <Button
                      onClick={() => setAddOpen(true)}
                      className="bg-white text-indigo-700 hover:bg-white/90 font-semibold gap-1.5 h-9"
                    >
                      <Plus className="h-4 w-4" /> {t('add')}
                    </Button>
                    <Button
                      onClick={() => setImportOpen(true)}
                      variant="outline"
                      className="bg-white/15 hover:bg-white/25 text-white border-white/30 gap-1.5 h-9"
                    >
                      <Upload className="h-4 w-4" /> {t('import')}
                    </Button>
                  </>
                )}
                <Button
                  onClick={onExport}
                  variant="outline"
                  className="bg-white/15 hover:bg-white/25 text-white border-white/30 gap-1.5 h-9"
                >
                  <Download className="h-4 w-4" /> {t('export')}
                </Button>
                {canManage && (
                  <Button
                    onClick={() => refreshAllMut.mutate()}
                    disabled={refreshAllMut.isPending}
                    variant="outline"
                    className="bg-white/15 hover:bg-white/25 text-white border-white/30 gap-1.5 h-9"
                  >
                    {refreshAllMut.isPending
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <RefreshCw className="h-4 w-4" />}
                    {t('refreshAll')}
                  </Button>
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
            value={String(total)}
            icon={<Briefcase className="h-4 w-4" />}
            gradient="from-indigo-500 to-violet-600"
          />
          <KpiTile
            label={t('kpiActiveVat')}
            value={String(kpis.activeVat)}
            icon={<CheckCircle2 className="h-4 w-4" />}
            gradient="from-emerald-500 to-teal-600"
          />
          <KpiTile
            label={t('kpiAvgRating')}
            value={kpis.avgRating ? String(kpis.avgRating) : '—'}
            icon={<Star className="h-4 w-4" />}
            gradient="from-amber-500 to-orange-600"
          />
          <KpiTile
            label={t('lastRefreshed')}
            value={kpis.lastRefresh ? formatDateTime(kpis.lastRefresh) : t('neverRefreshed')}
            sub={t('nextRefresh').replace('{n}', nextCronText)}
            icon={<Clock className="h-4 w-4" />}
            gradient="from-slate-500 to-slate-700"
            small
          />
        </div>

        {/* Search bar */}
        <Card className="border-0 shadow-soft overflow-visible">
          <CardContent className="p-4 flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[260px]">
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
                      const ratingTone = it.rating == null
                        ? 'bg-slate-50 text-slate-500 ring-slate-200'
                        : it.rating >= 60 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : it.rating >= 30 ? 'bg-amber-50 text-amber-700 ring-amber-200'
                        : 'bg-rose-50 text-rose-700 ring-rose-200';
                      return (
                        <tr key={it.inn} className="group hover:bg-slate-50/60 transition-colors cursor-pointer" onClick={() => setDetailRow(it)}>
                          <td className="px-4 py-3 font-mono text-[12px] font-bold text-slate-900">{it.inn}</td>
                          <td className="px-4 py-3 max-w-[280px]">
                            <div className="font-semibold text-slate-900 truncate" title={it.name}>{it.name}</div>
                            {it.fullName && it.fullName !== it.name && (
                              <div className="text-[10px] text-slate-500 truncate" title={it.fullName}>{it.fullName}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 max-w-[220px]">
                            <div className="text-[12px] truncate" title={it.director || ''}>{it.director || '—'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ring-1 ring-inset tabular-nums',
                              ratingTone,
                            )}>
                              {it.rating != null ? it.rating : '—'}
                            </span>
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
                <div className="grid grid-cols-3 gap-2">
                  <ImportStat label={t('added')} value={importResult.added} tone="emerald" />
                  <ImportStat label={t('skipped')} value={importResult.skipped} tone="amber" />
                  <ImportStat label={t('failed')} value={importResult.failed} tone="rose" />
                </div>
                <div className="max-h-72 overflow-y-auto rounded-xl ring-1 ring-slate-200 divide-y divide-slate-100">
                  {(importResult.rows || []).map((r: any, i: number) => (
                    <div key={i} className="px-3 py-2 flex items-center gap-2 text-[11px]">
                      <span className={cn(
                        'w-2 h-2 rounded-full shrink-0',
                        r.status === 'added' ? 'bg-emerald-500' :
                        r.status === 'skipped' ? 'bg-amber-500' : 'bg-rose-500',
                      )} />
                      <span className="font-mono font-bold">{r.inn}</span>
                      <span className="text-slate-500 truncate flex-1">{r.name || ''}</span>
                      {r.reason && <span className="text-slate-400 truncate" title={r.reason}>{r.reason}</span>}
                    </div>
                  ))}
                </div>
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
    </div>
  );
}

// ────────────── helpers ──────────────

function KpiTile({
  label, value, sub, icon, gradient, small,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  gradient: string;
  small?: boolean;
}) {
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={cn('w-8 h-8 rounded-xl bg-gradient-to-br grid place-items-center text-white shadow-md', gradient)}>
            {icon}
          </div>
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 truncate">{label}</div>
        </div>
        <div className={cn('font-black tabular-nums tracking-tight text-slate-900 truncate', small ? 'text-sm' : 'text-2xl')} title={value}>
          {value}
        </div>
        {sub && <div className="text-[10px] text-slate-500 mt-1 truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ImportStat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'rose' }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 ring-emerald-200 text-emerald-700'
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
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-indigo-600" />
          {row.name}
        </DialogTitle>
        <DialogDescription className="font-mono">{row.inn}</DialogDescription>
      </DialogHeader>

      {/* Rating */}
      {row.rating != null && (
        <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 ring-1 ring-amber-200 px-4 py-3 flex items-center gap-3">
          <Star className="h-5 w-5 text-amber-600" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider font-bold text-amber-700">{t('rating')}</div>
            <div className="text-2xl font-black tabular-nums text-amber-900">{row.rating}</div>
          </div>
          {row.ratingTitle && (
            <div className="text-[11px] text-amber-700 text-right max-w-[160px]">{row.ratingTitle}</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DetailField icon={<User className="h-3.5 w-3.5" />} label={t('director')} value={row.director} />
        <DetailField icon={<User className="h-3.5 w-3.5" />} label={t('accountant')} value={row.accountant} />
        <DetailField icon={<Phone className="h-3.5 w-3.5" />} label={t('phone')} value={row.phone} mono />
        <DetailField icon={<Tag className="h-3.5 w-3.5" />} label={t('email')} value={row.email} />
        <DetailField icon={<Tag className="h-3.5 w-3.5" />} label={t('vatStatus')} value={row.vatStatus} />
        <DetailField icon={<Receipt className="h-3.5 w-3.5" />} label={t('vatNumber')} value={row.vatNumber} mono />
        <DetailField icon={<Building2 className="h-3.5 w-3.5" />} label={t('oked')} value={row.oked} fullWidth />
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
