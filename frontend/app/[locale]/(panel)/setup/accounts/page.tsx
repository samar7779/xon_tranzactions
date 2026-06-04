'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Search, RefreshCw, Trash2, Building2, Wallet, MoreVertical,
  Eye, X, Power, PowerOff, ArrowUpRight, FileSpreadsheet, Download, Loader2,
  Calendar, CheckCircle2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import { BankLogo } from '@/components/bank-logo';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { api, apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

export default function AccountsPage() {
  const tc = useTranslations('common');
  const t = useTranslations('accounts');
  const tNav = useTranslations('nav');
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = !!user?.permissions?.includes(PERMS.ACCOUNTS_MANAGE);

  const [q, setQ] = useState('');
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [exporting, setExporting] = useState(false);
  const [backfillAccount, setBackfillAccount] = useState<any>(null);
  const [bulkBackfillOpen, setBulkBackfillOpen] = useState(false);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<{ items: any[] }>('/bank-accounts'),
  });
  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });
  const { data: creds } = useQuery({
    queryKey: ['bank-credentials'],
    queryFn: () => api.get<{ items: any[] }>('/bank-credentials'),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/bank-accounts/${id}`),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['bank-accounts'] }); },
    onError: (e: any) => toast.error(e?.message),
  });
  const syncMut = useMutation({
    mutationFn: (id: string) => api.post(`/sync/account/${id}`),
    onSuccess: (r: any) => {
      toast.success(`✓ ${r?.fetched || 0} olindi · ${r?.saved || 0} saqlandi`);
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (e: any) => toast.error(e?.message),
  });
  const toggleSyncMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/bank-accounts/${id}`, { syncEnabled: enabled }),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['bank-accounts'] }); },
    onError: (e: any) => toast.error(e?.message),
  });
  const syncAllMut = useMutation({
    mutationFn: () => api.post<any>('/sync/run-all'),
    onSuccess: (r: any) => {
      toast.success(`Sync boshlandi — ${r?.accounts || 0} ta hisob (bir necha daqiqada tugaydi)`);
    },
    onError: (e: any) => toast.error(e?.message),
  });

  async function exportAll() {
    setExporting(true);
    try {
      await apiDownload('/bank-accounts/export', 'hisoblar.xlsx');
      toast.success('Hisoblar Excel qilib yuklab olindi');
    } catch (e: any) {
      toast.error(e?.message || 'Yuklashda xato');
    } finally {
      setExporting(false);
    }
  }

  // Banklar — aktivlar boshida (filtr uchun)
  const sortedBanks = useMemo(() => {
    return [...(banks?.items || [])].sort((a: any, b: any) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [banks]);

  // Filtering
  let filtered = accounts?.items || [];
  if (q) {
    const ql = q.toLowerCase();
    filtered = filtered.filter((a) =>
      a.accountNo?.includes(q) ||
      a.branch?.includes(q) ||
      a.ownerName?.toLowerCase().includes(ql) ||
      a.bank?.name?.toLowerCase().includes(ql),
    );
  }
  if (bankFilter !== 'all') filtered = filtered.filter((a) => a.bankId === bankFilter);
  if (statusFilter === 'on') filtered = filtered.filter((a) => a.syncEnabled);
  if (statusFilter === 'off') filtered = filtered.filter((a) => !a.syncEnabled);

  // Aggregates
  const totalBalance = filtered.reduce((s, a) => s + Number(a.balance || 0), 0);
  const totalCount = filtered.length;
  const onlineCount = filtered.filter((a) => a.syncEnabled).length;
  const byBank = useMemo(() => {
    const m = new Map<string, { name: string; total: number; count: number }>();
    filtered.forEach((a) => {
      const e = m.get(a.bankId) || { name: a.bank?.name || '—', total: 0, count: 0 };
      e.total += Number(a.balance || 0);
      e.count += 1;
      m.set(a.bankId, e);
    });
    return [...m.entries()];
  }, [filtered]);

  return (
    <>
      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full">
        {/* ═══ TOP STATS ═══ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <BigStat
            label={t('totalBalance')}
            value={formatMoney(totalBalance)}
            sub={t('accountsCount', { count: totalCount })}
            color="indigo"
            icon={Wallet}
          />
          <BigStat
            label={t('activeSync')}
            value={`${onlineCount} / ${totalCount}`}
            sub={t('autoRefreshOn')}
            color="emerald"
            icon={Power}
          />
          <BigStat
            label={tNav('banks')}
            value={String(byBank.length)}
            sub={byBank.slice(0, 2).map(([, v]) => v.name).join(' · ') || '—'}
            color="purple"
            icon={Building2}
          />
        </div>

        {/* ═══ FILTER BAR ═══ */}
        <Card className="border-0 shadow-soft">
          <CardContent className="p-4 lg:p-5">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  className="pl-9 h-10 rounded-xl bg-slate-50/60 border-slate-200 focus-visible:bg-white"
                  placeholder={t('searchPlaceholder')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" onClick={() => setQ('')}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Barchasiga sync + Excel yuklab olish — faqat ikonka */}
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncAllMut.mutate()}
                  disabled={syncAllMut.isPending}
                  title="Barcha hisoblarni sync qilish (bugungi kun)"
                  className="h-10 w-10 p-0 rounded-xl shrink-0"
                >
                  <RefreshCw className={cn('h-4 w-4', syncAllMut.isPending && 'animate-spin')} />
                </Button>
              )}
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setBulkBackfillOpen(true)}
                  title="Barcha hisoblar bo'yicha orqa sanaga sync (Sync chegarasi shartlarida)"
                  className="h-10 w-10 p-0 rounded-xl shrink-0 border-indigo-200 bg-indigo-50/40 hover:bg-indigo-100"
                >
                  <Calendar className="h-4 w-4 text-indigo-700" />
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={exportAll}
                disabled={exporting}
                title="Barcha hisoblarni Excel qilib yuklab olish"
                className="h-10 w-10 p-0 rounded-xl shrink-0"
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </Button>

              <Select value={bankFilter} onValueChange={setBankFilter}>
                <SelectTrigger className={cn(
                  "h-10 rounded-xl text-sm font-medium w-auto min-w-[160px] border-0",
                  bankFilter !== 'all'
                    ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                    : "bg-slate-50 ring-1 ring-slate-200 text-slate-700",
                )}>
                  <SelectValue placeholder={t('allBanks')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allBanks')}</SelectItem>
                  {sortedBanks.filter((b: any) => b.isActive).map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {b.name}
                      </span>
                    </SelectItem>
                  ))}
                  {sortedBanks.filter((b: any) => !b.isActive).length > 0 && (
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 font-semibold border-t border-slate-100 mt-1">
                      Aktiv emas
                    </div>
                  )}
                  {sortedBanks.filter((b: any) => !b.isActive).map((b: any) => (
                    <SelectItem key={b.id} value={b.id} className="text-slate-400">{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className={cn(
                  "h-10 rounded-xl text-sm font-medium w-auto min-w-[140px] border-0",
                  statusFilter !== 'all'
                    ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                    : "bg-slate-50 ring-1 ring-slate-200 text-slate-700",
                )}>
                  <SelectValue placeholder={t('syncEnabled')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allFilter')}</SelectItem>
                  <SelectItem value="on">Sync ON</SelectItem>
                  <SelectItem value="off">Sync OFF</SelectItem>
                </SelectContent>
              </Select>

              <div className="ml-auto inline-flex rounded-xl bg-slate-100 p-0.5 text-xs font-medium">
                <button
                  onClick={() => setView('grid')}
                  className={cn(
                    "px-3 h-9 rounded-lg transition-colors",
                    view === 'grid' ? "bg-white shadow-sm text-slate-900" : "text-slate-500",
                  )}
                >{t('cardView')}</button>
                <button
                  onClick={() => setView('list')}
                  className={cn(
                    "px-3 h-9 rounded-lg transition-colors",
                    view === 'list' ? "bg-white shadow-sm text-slate-900" : "text-slate-500",
                  )}
                >{t('tableView')}</button>
              </div>

              {canManage && (
                <div className="flex items-center gap-2">
                  <BulkImportDialog creds={creds?.items || []} />
                  <CreateAccountDialog creds={creds?.items || []} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ═══ LIST / GRID ═══ */}
        {isLoading ? (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="p-0">
            <EmptyState
              icon={Wallet}
              title={q || bankFilter !== 'all' ? "Hisob topilmadi" : "Hali hisob qo'shilmagan"}
              description={q ? "Filtrlarni o'zgartirib ko'ring" : "Avval Bank ulanishi qo'shing, keyin hisob raqamlarini kiriting"}
            />
          </CardContent></Card>
        ) : view === 'grid' ? (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                canManage={canManage}
                onSync={() => syncMut.mutate(a.id)}
                onDelete={() => confirm(tc('confirmDelete')) && removeMut.mutate(a.id)}
                onToggleSync={() => toggleSyncMut.mutate({ id: a.id, enabled: !a.syncEnabled })}
                onBackfill={() => setBackfillAccount(a)}
                busy={syncMut.isPending}
              />
            ))}
          </div>
        ) : (
          <Card className="border-0 shadow-soft overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                      <th className="text-left px-4 py-3">Bank · MFO</th>
                      <th className="text-left px-4 py-3">Hisob raqami</th>
                      <th className="text-left px-4 py-3">Egasi</th>
                      <th className="text-right px-4 py-3">Qoldiq</th>
                      <th className="text-left px-4 py-3">Sync</th>
                      <th className="text-left px-4 py-3">Oxirgi yangilanish</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((a) => {
                      return (
                        <tr key={a.id} className="hover:bg-slate-50/60 transition-colors group">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <BankLogo code={a.bank?.code || ''} name={a.bank?.name} size={36} />
                              <div className="min-w-0">
                                <div className="text-[13px] font-semibold truncate">{a.bank?.name || '—'}</div>
                                <div className="font-mono text-[10px] text-slate-500">MFO {a.branch}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] tabular-nums">{formatAccount(a.accountNo)}</td>
                          <td className="px-4 py-3 max-w-[200px]">
                            <div className="text-[12px] truncate">{a.ownerName || '—'}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap">
                            {formatMoney(Number(a.balance || 0), a.currency)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 ring-inset",
                              a.syncEnabled ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-500 ring-slate-200",
                            )}>
                              <span className={cn("w-1.5 h-1.5 rounded-full", a.syncEnabled ? "bg-emerald-500" : "bg-slate-300")} />
                              {a.syncEnabled ? 'ON' : 'OFF'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-500 tabular-nums">
                            {a.lastSyncedAt ? formatDateTime(a.lastSyncedAt) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {canManage && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => syncMut.mutate(a.id)} disabled={syncMut.isPending}>
                                    <RefreshCw className={cn("h-4 w-4 mr-2", syncMut.isPending && "animate-spin")} /> Hozir sync
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setBackfillAccount(a)}>
                                    <Calendar className="h-4 w-4 mr-2 text-indigo-600" /> Sana orqali sync (backfill)
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => toggleSyncMut.mutate({ id: a.id, enabled: !a.syncEnabled })}>
                                    {a.syncEnabled ? <PowerOff className="h-4 w-4 mr-2" /> : <Power className="h-4 w-4 mr-2" />}
                                    {a.syncEnabled ? 'Sync o\'chirish' : 'Sync yoqish'}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-rose-600" onClick={() => confirm(tc('confirmDelete')) && removeMut.mutate(a.id)}>
                                    <Trash2 className="h-4 w-4 mr-2" /> O'chirish
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Backfill dialog — hisob bo'yicha eski sanani sync qilish */}
      <AccountBackfillDialog
        account={backfillAccount}
        onClose={() => setBackfillAccount(null)}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['bank-accounts'] });
        }}
      />

      {/* Bulk backfill — barcha hisoblar bo'yicha orqa sanaga sync */}
      <BulkBackfillDialog
        open={bulkBackfillOpen}
        onClose={() => setBulkBackfillOpen(false)}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['bank-accounts'] });
        }}
      />
    </>
  );
}

// ──────────── Components ────────────

function BigStat({
  label, value, sub, color, icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  color: 'indigo' | 'emerald' | 'purple';
  icon: any;
}) {
  const m = {
    indigo:  { grad: 'from-indigo-500 to-blue-600',     bg: 'bg-indigo-50',  ring: 'ring-indigo-100',  text: 'text-indigo-700' },
    emerald: { grad: 'from-emerald-500 to-teal-600',    bg: 'bg-emerald-50', ring: 'ring-emerald-100', text: 'text-emerald-700' },
    purple:  { grad: 'from-purple-500 to-fuchsia-600',  bg: 'bg-purple-50',  ring: 'ring-purple-100',  text: 'text-purple-700' },
  }[color];
  return (
    <Card className="border-0 shadow-soft card-hover overflow-hidden relative">
      <div className={cn("absolute -top-16 -right-16 w-44 h-44 rounded-full blur-3xl opacity-30 bg-gradient-to-br", m.grad)} />
      <CardContent className="p-6 relative">
        <div className="flex items-start justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500">{label}</div>
          <div className={cn("w-10 h-10 rounded-xl grid place-items-center bg-gradient-to-br text-white shadow-sm", m.grad)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-2xl lg:text-3xl font-bold tracking-tight tabular-nums">{value}</div>
        <div className="text-[11px] text-slate-500 mt-1 truncate">{sub}</div>
      </CardContent>
    </Card>
  );
}

function AccountCard({
  account: a, canManage, onSync, onDelete, onToggleSync, onBackfill, busy,
}: {
  account: any;
  canManage: boolean;
  onSync: () => void;
  onDelete: () => void;
  onToggleSync: () => void;
  onBackfill: () => void;
  busy: boolean;
}) {
  const balance = Number(a.balance || 0);
  const hasBalance = balance > 0;
  return (
    <Card className="group relative border border-slate-200 shadow-sm hover:shadow-lg hover:border-slate-300 transition-all overflow-hidden bg-white">
      <CardContent className="p-0">
        {/* Header — bank logo, name, menu */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <BankLogo code={a.bank?.code || ''} name={a.bank?.name} size={40} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold truncate tracking-tight text-slate-900">{a.bank?.name}</div>
            <div className="text-[10px] font-mono text-slate-400">MFO {a.branch} · {a.currency}</div>
          </div>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 -mr-1 shrink-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onSync} disabled={busy}>
                  <RefreshCw className={cn("h-4 w-4 mr-2", busy && "animate-spin")} /> Hozir sync
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onBackfill}>
                  <Calendar className="h-4 w-4 mr-2 text-indigo-600" /> Sana orqali sync (backfill)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onToggleSync}>
                  {a.syncEnabled ? <PowerOff className="h-4 w-4 mr-2" /> : <Power className="h-4 w-4 mr-2" />}
                  {a.syncEnabled ? 'Sync o\'chirish' : 'Sync yoqish'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-rose-600" onClick={onDelete}>
                  <Trash2 className="h-4 w-4 mr-2" /> O'chirish
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Owner name */}
        <div className="px-4 pb-2">
          <div className="text-[13px] font-semibold text-slate-800 truncate">{a.ownerName || '—'}</div>
          <div className="font-mono text-[11px] text-slate-400 tracking-tight">{formatAccount(a.accountNo)}</div>
        </div>

        {/* Balance — big, prominent */}
        <div className={cn(
          "mx-4 mb-3 rounded-xl px-4 py-3",
          hasBalance ? "bg-gradient-to-br from-indigo-50 to-blue-50 ring-1 ring-indigo-100" : "bg-slate-50 ring-1 ring-slate-100",
        )}>
          <div className="text-[9px] uppercase tracking-[0.15em] text-slate-500 font-bold mb-0.5">Qoldiq</div>
          <div className={cn(
            "text-xl font-bold tracking-tight tabular-nums",
            hasBalance ? "text-indigo-900" : "text-slate-400",
          )}>
            {formatMoney(balance, a.currency)}
          </div>
        </div>

        {/* Footer — sync status + last sync */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50/40">
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold",
            a.syncEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500",
          )}>
            <span className="relative flex h-1.5 w-1.5">
              {a.syncEnabled && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />}
              <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", a.syncEnabled ? "bg-emerald-500" : "bg-slate-400")} />
            </span>
            {a.syncEnabled ? 'Sync ON' : 'Sync OFF'}
          </span>
          <div className="text-[10px] text-slate-400 flex items-center gap-1 tabular-nums">
            {a.lastSyncedAt ? <><RefreshCw className="h-2.5 w-2.5" /> {formatDateTime(a.lastSyncedAt)}</> : 'Hech sync bo\'lmagan'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatAccount(n?: string) {
  if (!n) return '';
  return n.replace(/(\d{4})/g, '$1 ').trim();
}

function CreateAccountDialog({ creds }: { creds: any[] }) {
  const t = useTranslations('accounts');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ credentialId: '', branch: '', accountNo: '', ownerName: '', currency: 'UZS' });

  const mut = useMutation({
    mutationFn: () => api.post('/bank-accounts', { ...form, branch: form.branch.padStart(5, '0') }),
    onSuccess: () => {
      toast.success(tc('success'));
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
      setOpen(false);
      setForm({ credentialId: '', branch: '', accountNo: '', ownerName: '', currency: 'UZS' });
    },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-indigo-600 text-white hover:bg-indigo-700 rounded-full font-semibold shadow-sm">
          <Plus className="h-3.5 w-3.5 mr-1.5" />{t('add')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('add')}</DialogTitle>
          <DialogDescription>Bank → ulanish → hisob raqami qo'shing</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Bank ulanishi</Label>
            <Select value={form.credentialId} onValueChange={(v) => setForm({ ...form, credentialId: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {creds.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.label} · {c.bank?.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {creds.length === 0 && (
              <p className="text-xs text-slate-500">Avval Bank ulanishi qo'shing → Sozlash → Bank ulanishlari</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>MFO <span className="text-rose-500">*</span></Label>
              <Input
                value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                placeholder="00974"
                maxLength={5}
                className={cn('font-mono', !form.branch && 'ring-1 ring-rose-200')}
              />
              <div className="text-[10px] text-slate-500">5 xonalik MFO kod — majburiy</div>
            </div>
            <div className="space-y-2">
              <Label>Valyuta <span className="text-rose-500">*</span></Label>
              <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UZS">UZS</SelectItem>
                  <SelectItem value="RUB">RUB</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Hisob raqami</Label>
            <Input value={form.accountNo} onChange={(e) => setForm({ ...form, accountNo: e.target.value })} placeholder="20208000012345678001" className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label>Egasi (ixtiyoriy)</Label>
            <Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Asosiy hisob, USD hisobi va h.k." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tc('cancel')}</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !form.credentialId || !form.branch || !form.accountNo}>{tc('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────── Bulk import dialog — paste qilib ko'p hisob qo'shish ───────────
function BulkImportDialog({ creds }: { creds: any[] }) {
  const t = useTranslations('accounts');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [credentialId, setCredentialId] = useState('');
  const [branch, setBranch] = useState('00974');
  const [currency, setCurrency] = useState('UZS');
  const [rawText, setRawText] = useState('');
  const [result, setResult] = useState<any>(null);

  // Matnni parse qilish: "NAME\tACCOUNT_NO" (tab) yoki "NAME   ACCOUNT_NO" (space)
  // Yoki faqat ACCOUNT_NO (har qatorda bittadan)
  const parsed = useMemo(() => {
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.map((line) => {
      // Oxirgi 20 raqamlik son = hisob raqami
      const match = line.match(/(\d{20})\s*$/);
      if (match) {
        const accountNo = match[1];
        const ownerName = line.slice(0, match.index).trim();
        return { accountNo, ownerName: ownerName || undefined };
      }
      // Faqat raqam bo'lsa
      const digits = line.replace(/\D/g, '');
      if (digits.length === 20) return { accountNo: digits };
      return { accountNo: line, error: '20 belgilik hisob raqami topilmadi' };
    });
  }, [rawText]);

  const validCount = parsed.filter((p: any) => !p.error).length;
  const invalidCount = parsed.filter((p: any) => p.error).length;

  const mut = useMutation({
    mutationFn: () => api.post<any>('/bank-accounts/bulk', {
      credentialId,
      branch: branch.padStart(5, '0'),
      currency,
      accounts: parsed.filter((p: any) => !p.error).map((p: any) => ({ accountNo: p.accountNo, ownerName: p.ownerName })),
    }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
      toast.success(`✓ ${r.added} qo'shildi · ${r.skipped} skip · ${r.errors?.length || 0} xato`);
    },
    onError: (e: any) => toast.error(e?.message),
  });

  function reset() {
    setRawText('');
    setResult(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="rounded-full font-medium gap-1.5">
          <FileSpreadsheet className="h-3.5 w-3.5" /> {t('bulkAdd')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0">
        <div className="px-6 py-5 border-b border-slate-200 bg-gradient-to-br from-indigo-500 to-blue-600 text-white">
          <DialogTitle className="text-white text-base font-bold">Ko'p hisob qo'shish</DialogTitle>
          <DialogDescription className="text-white/85 text-xs mt-1">
            Excel/Sheets'dan nusxalab paste qiling — formatda: "NOMI &nbsp;&nbsp; HISOB_NO" (har qatorda bittadan)
          </DialogDescription>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
          {/* Settings */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Bank ulanishi</Label>
              <Select value={credentialId} onValueChange={setCredentialId}>
                <SelectTrigger><SelectValue placeholder="— tanlang —" /></SelectTrigger>
                <SelectContent>
                  {creds.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.label} · {c.bank?.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">MFO</Label>
              <Input value={branch} onChange={(e) => setBranch(e.target.value.replace(/\D/g, '').slice(0, 5))} className="font-mono" maxLength={5} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Valyuta</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UZS">UZS</SelectItem>
                  <SelectItem value="RUB">RUB</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Tahlil</Label>
              <div className="h-9 rounded-md ring-1 ring-slate-200 px-3 flex items-center text-[12px] font-medium">
                <span className="text-emerald-700">{validCount}</span>
                <span className="text-slate-400 mx-1">/</span>
                <span className="text-slate-700">{parsed.length}</span>
                {invalidCount > 0 && <span className="text-rose-600 ml-2">({invalidCount} xato)</span>}
              </div>
            </div>
          </div>

          {/* Paste area */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
              Hisoblar ro'yxati (paste)
            </Label>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={10}
              className="w-full font-mono text-[12px] rounded-xl border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
              placeholder={"APELSIN RESIDENCE\t20208000904501402001\nART-ZAL BARAKA BIZNES\t20208000004793065002\n..."}
            />
            <div className="text-[10px] text-slate-500">
              Tab yoki bo'sh joy bilan ajratilgan. Hisob raqami 20 belgilik bo'lishi shart.
            </div>
          </div>

          {/* Preview parsed */}
          {parsed.length > 0 && (
            <div>
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5 block">
                Qabul qilinadigan ro'yxat (birinchi 10 ta)
              </Label>
              <div className="rounded-xl border border-slate-200 max-h-44 overflow-y-auto divide-y divide-slate-100 bg-slate-50/40">
                {parsed.slice(0, 10).map((p: any, i: number) => (
                  <div key={i} className={cn("px-3 py-1.5 text-[11px] flex items-center gap-3", p.error && "bg-rose-50/40")}>
                    <span className={cn("inline-block w-5 text-center font-bold", p.error ? "text-rose-600" : "text-emerald-600")}>
                      {p.error ? '✗' : '✓'}
                    </span>
                    <span className="font-mono text-slate-700 w-44 truncate">{p.accountNo}</span>
                    <span className="text-slate-600 truncate flex-1">{p.ownerName || (p.error || '—')}</span>
                  </div>
                ))}
                {parsed.length > 10 && (
                  <div className="px-3 py-1.5 text-[10px] text-slate-500 text-center">… va yana {parsed.length - 10} ta</div>
                )}
              </div>
            </div>
          )}

          {/* Result after import */}
          {result && (
            <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3 space-y-1 text-[12px]">
              <div className="font-bold text-emerald-900">Natija:</div>
              <div>✓ <span className="font-semibold">{result.added}</span> ta yangi qo'shildi</div>
              <div>↺ <span className="font-semibold">{result.skipped}</span> ta allaqachon mavjud (skip)</div>
              {result.errors?.length > 0 && (
                <div className="text-rose-700">✗ <span className="font-semibold">{result.errors.length}</span> ta xato</div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-slate-200 bg-slate-50/60">
          <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Bekor qilish</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !credentialId || !branch || validCount === 0}
          >
            {mut.isPending ? 'Qo\'shilmoqda...' : `${validCount} ta hisobni qo'shish`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────── Backfill dialog (per-account, sana orqali sync) ────────────
function AccountBackfillDialog({
  account, onClose, onSuccess,
}: {
  account: any | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  })();

  const [dateFrom, setDateFrom] = useState(sevenDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [result, setResult] = useState<any>(null);

  // Account o'zgarganda sana'larni reset (bir oyga oxirgi default)
  useMemo(() => {
    if (account) {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setDateFrom(d.toISOString().slice(0, 10));
      setDateTo(new Date().toISOString().slice(0, 10));
      setResult(null);
    }
  }, [account?.id]);

  const [startedAt, setStartedAt] = useState<string | null>(null);
  const backfillMut = useMutation({
    mutationFn: () => api.post<any>('/sync/backfill', {
      scope: 'account',
      accountId: account?.id,
      dateFrom,
      dateTo,
    }, { timeout: 60_000 }),
    onSuccess: (r: any) => {
      setResult(r);
      if (r?.ok) {
        toast.success(`Backfill ishga tushdi · ${r?.days ?? 0} ta sana`);
        // startedAt saqlash — polling shu vaqtdan boshlanadi
        if (r?.startedAt) setStartedAt(r.startedAt);
        onSuccess();
      } else {
        toast.error(r?.error || 'Backfill xato');
      }
    },
    onError: (e: any) => {
      setResult({ ok: false, error: e?.message || 'Xato' });
      toast.error(e?.message || 'So\'rov xato');
    },
  });

  // Real-time polling — backfill boshlangandan keyin har 2 sekundda status tekshiriladi
  const statusQuery = useQuery({
    queryKey: ['backfill-status', startedAt, account?.id],
    queryFn: () => api.get<{ ok: boolean; items: any[] }>(
      `/sync/backfill/status?since=${encodeURIComponent(startedAt!)}`,
    ),
    enabled: !!startedAt && !!account?.id,
    refetchInterval: (q) => {
      const data = q.state.data as { items?: any[] } | undefined;
      const items = data?.items || [];
      // Faqat shu account uchun loglar
      const myLogs = items.filter((l: any) => l.accountId === account?.id);
      // Hamma tugagan bo'lsa polling to'xtatamiz
      const allDone = myLogs.length > 0 && myLogs.every((l: any) => l.status !== 'RUNNING');
      return allDone ? false : 2000;
    },
    refetchIntervalInBackground: true,
  });

  // Bu hisob bilan bog'liq loglar (eng yangi avval)
  const myLogs = useMemo(() => {
    if (!statusQuery.data?.items || !account?.id) return [];
    return statusQuery.data.items
      .filter((l: any) => l.accountId === account.id)
      .sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }, [statusQuery.data, account?.id]);

  const runningCount = myLogs.filter((l: any) => l.status === 'RUNNING').length;
  const totalFetched = myLogs.reduce((s: number, l: any) => s + (l.fetched || 0), 0);
  const totalSaved = myLogs.reduce((s: number, l: any) => s + (l.saved || 0), 0);
  const totalErrors = myLogs.reduce((s: number, l: any) => s + (l.errors || 0), 0);
  const finishedCount = myLogs.filter((l: any) => l.status === 'SUCCESS').length;
  const failedCount = myLogs.filter((l: any) => l.status === 'FAILED').length;
  const isAllDone = myLogs.length > 0 && runningCount === 0;

  // Sana farqi (ko'rsatish uchun)
  const dayDiff = (() => {
    if (!dateFrom || !dateTo) return 0;
    const a = new Date(dateFrom);
    const b = new Date(dateTo);
    const diff = Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return diff;
  })();

  // Modal yopilganda holat tozalash
  useEffect(() => {
    if (!account) {
      setResult(null);
      setStartedAt(null);
    }
  }, [account?.id]);

  const isOpen = !!account;
  return (
    <Dialog open={isOpen} onOpenChange={(v) => {
      if (!v) {
        // RUNNING bo'lsa ham yopib bo'ladi, lekin polling to'xtaydi
        setResult(null);
        setStartedAt(null);
        onClose();
      }
    }}>
      <DialogContent className="sm:max-w-[640px] p-0 overflow-hidden gap-0 max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600 px-6 pt-5 pb-4 text-white">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-white/15 grid place-items-center">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/70">Sync orqa sanaga</div>
              <div className="text-lg font-black tracking-tight">Backfill</div>
            </div>
          </div>
          {account && (
            <div className="text-[11.5px] text-white/85 mt-2 font-mono truncate">
              {account.bank?.name} · {account.accountNo}
              {account.ownerName && <span className="ml-1 opacity-80">· {account.ownerName}</span>}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {!result?.ok && (
            <>
              <div className="text-[12px] text-slate-600 leading-relaxed">
                Tanlangan sana oralig'i uchun bank API'sidan tranzaksiyalarni qayta yuklab
                DB'ga qo'shadi (dublikatlar avtomatik o'tkazib yuboriladi).
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">Sanadan</Label>
                  <Input type="date" value={dateFrom} max={today} onChange={(e) => setDateFrom(e.target.value)} className="h-10" />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">Sanagacha</Label>
                  <Input type="date" value={dateTo} max={today} onChange={(e) => setDateTo(e.target.value)} className="h-10" />
                </div>
              </div>

              {dateFrom && dateTo && dayDiff > 0 && (
                <div className={cn(
                  'rounded-lg ring-1 px-3 py-2 text-[12px] inline-flex items-center gap-2',
                  dayDiff > 90 ? 'bg-amber-50 ring-amber-200 text-amber-800' : 'bg-slate-50 ring-slate-200 text-slate-700',
                )}>
                  <Calendar className="h-3.5 w-3.5" />
                  <span><b>{dayDiff}</b> ta kun tanlandi</span>
                  {dayDiff > 90 && <span className="text-amber-600">· uzoq sana, bir necha daqiqa ketishi mumkin</span>}
                </div>
              )}
            </>
          )}

          {result && !result.ok && (
            <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3 flex items-start gap-2.5">
              <X className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
              <div className="text-[12.5px] text-rose-800">
                <div className="font-bold mb-0.5">Xato</div>
                <div className="text-rose-700">{result.error || "Noma'lum xato"}</div>
              </div>
            </div>
          )}

          {/* REAL-TIME PROGRESS */}
          {result?.ok && (
            <>
              {/* Status banner — RUNNING / DONE / FAILED */}
              <div className={cn(
                'rounded-xl ring-1 px-4 py-3 flex items-center gap-3',
                runningCount > 0 && 'bg-indigo-50 ring-indigo-200',
                isAllDone && failedCount === 0 && 'bg-emerald-50 ring-emerald-200',
                isAllDone && failedCount > 0 && 'bg-rose-50 ring-rose-200',
              )}>
                <div className={cn(
                  'w-10 h-10 rounded-xl grid place-items-center text-white shrink-0',
                  runningCount > 0 && 'bg-indigo-600',
                  isAllDone && failedCount === 0 && 'bg-emerald-600',
                  isAllDone && failedCount > 0 && 'bg-rose-600',
                )}>
                  {runningCount > 0
                    ? <Loader2 className="h-5 w-5 animate-spin" />
                    : isAllDone && failedCount === 0
                      ? <CheckCircle2 className="h-5 w-5" />
                      : <X className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold">
                    {runningCount > 0 && `Sync qilinmoqda... (${runningCount}/${myLogs.length || result.days || 1})`}
                    {isAllDone && failedCount === 0 && 'Backfill muvaffaqiyatli yakunlandi'}
                    {isAllDone && failedCount > 0 && `${failedCount} ta sana xato bilan tugadi`}
                    {myLogs.length === 0 && '⏳ Boshlanmoqda...'}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5">
                    {result.actualFrom} → {result.actualTo} · {result.days ?? 1} ta sana
                  </div>
                </div>
              </div>

              {/* Statistika kartalari */}
              <div className="grid grid-cols-4 gap-2">
                <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2.5">
                  <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-500">Bajarildi</div>
                  <div className="text-[18px] font-black text-slate-800 tabular-nums">
                    {finishedCount + failedCount}<span className="text-[12px] text-slate-400 font-normal">/{result.days ?? 1}</span>
                  </div>
                </div>
                <div className="rounded-lg bg-cyan-50 ring-1 ring-cyan-200 px-3 py-2.5">
                  <div className="text-[9.5px] uppercase tracking-wider font-bold text-cyan-700">Bankdan olindi</div>
                  <div className="text-[18px] font-black text-cyan-800 tabular-nums">{totalFetched}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2.5">
                  <div className="text-[9.5px] uppercase tracking-wider font-bold text-emerald-700">DB ga saqlandi</div>
                  <div className="text-[18px] font-black text-emerald-800 tabular-nums">{totalSaved}</div>
                </div>
                <div className={cn(
                  'rounded-lg ring-1 px-3 py-2.5',
                  totalErrors > 0 ? 'bg-rose-50 ring-rose-200' : 'bg-slate-50 ring-slate-200',
                )}>
                  <div className={cn('text-[9.5px] uppercase tracking-wider font-bold', totalErrors > 0 ? 'text-rose-700' : 'text-slate-500')}>
                    Xato
                  </div>
                  <div className={cn('text-[18px] font-black tabular-nums', totalErrors > 0 ? 'text-rose-700' : 'text-slate-400')}>
                    {totalErrors}
                  </div>
                </div>
              </div>

              {/* Per-day log ro'yxati */}
              {myLogs.length > 0 && (
                <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden">
                  <div className="bg-slate-100 px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 flex items-center justify-between">
                    <span>Sana bo'yicha jarayon</span>
                    <span className="font-normal text-[9.5px] normal-case tracking-normal">
                      {runningCount > 0 ? 'jonli yangilanmoqda...' : 'tugadi'}
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {myLogs.map((log: any) => (
                      <div key={log.id} className="flex items-center gap-3 px-3 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                        <div className={cn(
                          'w-7 h-7 rounded-lg grid place-items-center shrink-0',
                          log.status === 'RUNNING' && 'bg-indigo-100 text-indigo-600',
                          log.status === 'SUCCESS' && 'bg-emerald-100 text-emerald-700',
                          log.status === 'FAILED' && 'bg-rose-100 text-rose-700',
                        )}>
                          {log.status === 'RUNNING' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {log.status === 'SUCCESS' && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {log.status === 'FAILED' && <X className="h-3.5 w-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-mono text-slate-700 truncate" title={log.source}>
                            {log.source}
                          </div>
                          {log.errorMessage && (
                            <div className="text-[10.5px] text-rose-600 truncate" title={log.errorMessage}>
                              ⚠ {log.errorMessage}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] tabular-nums shrink-0">
                          <span className="text-cyan-700" title="Bank API javobi">
                            <b>{log.fetched ?? 0}</b><span className="text-slate-400">fetch</span>
                          </span>
                          <span className="text-emerald-700" title="DB ga saqlangan">
                            <b>{log.saved ?? 0}</b><span className="text-slate-400">saved</span>
                          </span>
                          {log.errors > 0 && (
                            <span className="text-rose-700" title="Xato">
                              <b>{log.errors}</b><span className="text-slate-400">err</span>
                            </span>
                          )}
                          {log.durationMs && (
                            <span className="text-slate-500" title="Vaqt">
                              {(log.durationMs / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 px-5 py-3 border-t border-slate-100 bg-slate-50/40">
          {result?.ok ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                {runningCount > 0 ? "Fonda davom ettirib yopish" : "Yopish"}
              </Button>
              {isAllDone && (
                <Button
                  onClick={() => { setResult(null); setStartedAt(null); }}
                  variant="outline"
                  className="border-indigo-300 text-indigo-700"
                >
                  <RefreshCw className="h-4 w-4 mr-1.5" /> Yangi backfill
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
              <Button
                onClick={() => backfillMut.mutate()}
                disabled={!dateFrom || !dateTo || dayDiff <= 0 || backfillMut.isPending}
                className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white"
              >
                {backfillMut.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  : <RefreshCw className="h-4 w-4 mr-1.5" />}
                {backfillMut.isPending ? 'Ishga tushirilmoqda...' : 'Backfill ishga tushirish'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────── Bulk backfill (barcha hisoblar bo'yicha orqa sanaga sync) ────────────
function BulkBackfillDialog({
  open, onClose, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  // Sync chegarasi (minimal sana)
  const settingsQuery = useQuery({
    queryKey: ['sync-settings'],
    queryFn: () => api.get<{ ok: boolean; syncMinDate: string | null }>('/sync/settings'),
    enabled: open,
  });
  const syncMinDate = settingsQuery.data?.syncMinDate || null;

  const defaultFrom = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today);
  const [result, setResult] = useState<any>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);

  // Yangidan ochilganda reset
  useMemo(() => {
    if (open) {
      setResult(null);
      setStartedAt(null);
      // Default — Sync chegarasidan boshlab (agar bor bo'lsa) yoki -30 kun
      const min = syncMinDate || defaultFrom;
      setDateFrom(min);
      setDateTo(today);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, syncMinDate]);

  const backfillMut = useMutation({
    mutationFn: () => api.post<any>('/sync/backfill', {
      scope: 'all',
      dateFrom,
      dateTo,
    }, { timeout: 60_000 }),
    onSuccess: (r: any) => {
      setResult(r);
      if (r?.ok) {
        toast.success(`Backfill boshlandi · ${r.accounts ?? 0} hisob · ${r.days ?? 0} sana`);
        if (r?.startedAt) setStartedAt(r.startedAt);
        onSuccess();
      } else {
        toast.error(r?.error || 'Backfill xato');
      }
    },
    onError: (e: any) => {
      setResult({ ok: false, error: e?.message || 'Xato' });
      toast.error(e?.message || "So'rov xato");
    },
  });

  // Polling — barcha sync log'lar status
  const statusQuery = useQuery({
    queryKey: ['bulk-backfill-status', startedAt],
    queryFn: () => api.get<{ ok: boolean; items: any[] }>(
      `/sync/backfill/status?since=${encodeURIComponent(startedAt!)}`,
    ),
    enabled: !!startedAt,
    refetchInterval: (q) => {
      const data = q.state.data as { items?: any[] } | undefined;
      const items = data?.items || [];
      const allDone = items.length > 0 && items.every((l: any) => l.status !== 'RUNNING');
      return allDone ? false : 3000;
    },
  });

  const logs = useMemo(() => {
    if (!statusQuery.data?.items) return [];
    return [...statusQuery.data.items].sort(
      (a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }, [statusQuery.data]);

  const runningCount = logs.filter((l: any) => l.status === 'RUNNING').length;
  const finishedCount = logs.filter((l: any) => l.status === 'SUCCESS').length;
  const failedCount = logs.filter((l: any) => l.status === 'FAILED').length;
  const totalFetched = logs.reduce((s: number, l: any) => s + (l.fetched || 0), 0);
  const totalSaved = logs.reduce((s: number, l: any) => s + (l.saved || 0), 0);
  const isAllDone = logs.length > 0 && runningCount === 0;

  // Sync chegarasi shartini tekshirish
  const fromTooEarly = !!syncMinDate && dateFrom < syncMinDate;
  const dayDiff = (() => {
    if (!dateFrom || !dateTo) return 0;
    const a = new Date(dateFrom);
    const b = new Date(dateTo);
    return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
  })();

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) {
        setResult(null);
        setStartedAt(null);
        onClose();
      }
    }}>
      <DialogContent className="sm:max-w-[720px] p-0 overflow-hidden gap-0 max-h-[92vh] flex flex-col">
        <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600 px-6 pt-5 pb-4 text-white shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-white/15 grid place-items-center">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/70">Bulk sync</div>
              <div className="text-lg font-black tracking-tight">Barcha hisoblar — orqa sanaga sync</div>
            </div>
          </div>
          <div className="text-[11.5px] text-white/85 mt-2 leading-relaxed">
            Tanlangan sana oralig'ida barcha sync yoqilgan hisoblar uchun bank API'sidan
            tranzaksiyalarni qayta yuklab oladi. Sync chegarasidan oldingi sanalarga chiqib
            ketmaydi.
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {syncMinDate && (
            <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[12px] inline-flex items-center gap-2 text-amber-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Sync chegarasi (minimal sana): <b className="tabular-nums">{syncMinDate}</b> — bundan oldinga chiqib bo'lmaydi
            </div>
          )}

          {!result?.ok && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">Sanadan</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    min={syncMinDate || undefined}
                    max={today}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-10"
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">Sanagacha</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    min={syncMinDate || undefined}
                    max={today}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="h-10"
                  />
                </div>
              </div>

              {fromTooEarly && (
                <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-[12px] text-rose-800 inline-flex items-center gap-2">
                  <X className="h-3.5 w-3.5" />
                  Sanadan {syncMinDate} dan oldin bo'lmasligi kerak
                </div>
              )}

              {!fromTooEarly && dayDiff > 0 && (
                <div className={cn(
                  'rounded-lg ring-1 px-3 py-2 text-[12px] inline-flex items-center gap-2',
                  dayDiff > 60 ? 'bg-amber-50 ring-amber-200 text-amber-800' : 'bg-slate-50 ring-slate-200 text-slate-700',
                )}>
                  <Calendar className="h-3.5 w-3.5" />
                  <b>{dayDiff}</b> ta kun · barcha sync yoqilgan hisoblar uchun
                  {dayDiff > 60 && <span className="text-amber-600">· uzoq vaqt ketishi mumkin</span>}
                </div>
              )}
            </>
          )}

          {result && !result.ok && (
            <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3 flex items-start gap-2.5">
              <X className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
              <div className="text-[12.5px] text-rose-800">
                <div className="font-bold mb-0.5">Xato</div>
                <div className="text-rose-700">{result.error || "Noma'lum xato"}</div>
              </div>
            </div>
          )}

          {result?.ok && (
            <>
              <div className={cn(
                'rounded-xl ring-1 px-4 py-3 flex items-center gap-3',
                runningCount > 0 && 'bg-indigo-50 ring-indigo-200',
                isAllDone && failedCount === 0 && 'bg-emerald-50 ring-emerald-200',
                isAllDone && failedCount > 0 && 'bg-rose-50 ring-rose-200',
              )}>
                <div className={cn(
                  'w-10 h-10 rounded-xl grid place-items-center text-white shrink-0',
                  runningCount > 0 && 'bg-indigo-600',
                  isAllDone && failedCount === 0 && 'bg-emerald-600',
                  isAllDone && failedCount > 0 && 'bg-rose-600',
                )}>
                  {runningCount > 0
                    ? <Loader2 className="h-5 w-5 animate-spin" />
                    : isAllDone && failedCount === 0
                      ? <CheckCircle2 className="h-5 w-5" />
                      : <X className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold">
                    {runningCount > 0 && `Sync qilinmoqda... (${finishedCount + failedCount}/${result.accounts ?? 0})`}
                    {isAllDone && failedCount === 0 && `Backfill yakunlandi — ${result.accounts ?? 0} hisob`}
                    {isAllDone && failedCount > 0 && `${failedCount} ta sana xato bilan tugadi`}
                    {logs.length === 0 && '⏳ Boshlanmoqda...'}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5">
                    {result.actualFrom} → {result.actualTo} · {result.accounts ?? 0} hisob · {result.days ?? 0} sana
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2.5">
                  <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-500">Bajarildi</div>
                  <div className="text-[16px] font-black text-slate-800 tabular-nums">
                    {finishedCount + failedCount}<span className="text-[11px] text-slate-400 font-normal">/{result.accounts ?? 0}</span>
                  </div>
                </div>
                <div className="rounded-lg bg-cyan-50 ring-1 ring-cyan-200 px-3 py-2.5">
                  <div className="text-[9.5px] uppercase tracking-wider font-bold text-cyan-700">Olindi</div>
                  <div className="text-[16px] font-black text-cyan-800 tabular-nums">{totalFetched}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2.5">
                  <div className="text-[9.5px] uppercase tracking-wider font-bold text-emerald-700">Saqlandi</div>
                  <div className="text-[16px] font-black text-emerald-800 tabular-nums">{totalSaved}</div>
                </div>
                <div className={cn(
                  'rounded-lg ring-1 px-3 py-2.5',
                  failedCount > 0 ? 'bg-rose-50 ring-rose-200' : 'bg-slate-50 ring-slate-200',
                )}>
                  <div className={cn('text-[9.5px] uppercase tracking-wider font-bold', failedCount > 0 ? 'text-rose-700' : 'text-slate-500')}>
                    Xato
                  </div>
                  <div className={cn('text-[16px] font-black tabular-nums', failedCount > 0 ? 'text-rose-700' : 'text-slate-400')}>
                    {failedCount}
                  </div>
                </div>
              </div>

              {logs.length > 0 && (
                <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden">
                  <div className="bg-slate-100 px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-600 flex items-center justify-between">
                    <span>Hisob bo'yicha jarayon ({logs.length})</span>
                    <span className="font-normal text-[9.5px] normal-case tracking-normal">
                      {runningCount > 0 ? 'jonli yangilanmoqda...' : 'tugadi'}
                    </span>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {logs.map((log: any) => (
                      <div key={log.id} className="flex items-center gap-3 px-3 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                        <div className={cn(
                          'w-7 h-7 rounded-lg grid place-items-center shrink-0',
                          log.status === 'RUNNING' && 'bg-indigo-100 text-indigo-600',
                          log.status === 'SUCCESS' && 'bg-emerald-100 text-emerald-700',
                          log.status === 'FAILED' && 'bg-rose-100 text-rose-700',
                        )}>
                          {log.status === 'RUNNING' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {log.status === 'SUCCESS' && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {log.status === 'FAILED' && <X className="h-3.5 w-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11.5px] font-mono text-slate-700 truncate" title={log.source}>
                            {log.source}
                          </div>
                          {log.errorMessage && (
                            <div className="text-[10px] text-rose-600 truncate" title={log.errorMessage}>
                              ⚠ {log.errorMessage}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10.5px] tabular-nums shrink-0">
                          <span className="text-cyan-700"><b>{log.fetched ?? 0}</b></span>
                          <span className="text-emerald-700"><b>{log.saved ?? 0}</b></span>
                          {log.errors > 0 && <span className="text-rose-700"><b>{log.errors}</b></span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 px-5 py-3 border-t border-slate-100 bg-slate-50/40">
          {result?.ok ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                {runningCount > 0 ? 'Fonda davom ettirib yopish' : 'Yopish'}
              </Button>
              {isAllDone && (
                <Button
                  onClick={() => { setResult(null); setStartedAt(null); }}
                  variant="outline"
                  className="border-indigo-300 text-indigo-700"
                >
                  <RefreshCw className="h-4 w-4 mr-1.5" /> Yangi backfill
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
              <Button
                onClick={() => backfillMut.mutate()}
                disabled={!dateFrom || !dateTo || dayDiff <= 0 || fromTooEarly || backfillMut.isPending}
                className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white"
              >
                {backfillMut.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  : <Calendar className="h-4 w-4 mr-1.5" />}
                {backfillMut.isPending ? 'Ishga tushirilmoqda...' : 'Hammasini sync qilish'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
