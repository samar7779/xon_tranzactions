'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Search, RefreshCw, Trash2, Building2, Wallet, MoreVertical,
  Eye, X, Power, PowerOff, ArrowUpRight, FileSpreadsheet, Download, Loader2,
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
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = !!user?.permissions?.includes(PERMS.ACCOUNTS_MANAGE);

  const [q, setQ] = useState('');
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [exporting, setExporting] = useState(false);

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
            label="Jami qoldiq"
            value={formatMoney(totalBalance)}
            sub={`${totalCount} ta hisob`}
            color="indigo"
            icon={Wallet}
          />
          <BigStat
            label="Faol sync"
            value={`${onlineCount} / ${totalCount}`}
            sub="Avto-yangilanish yoqilgan"
            color="emerald"
            icon={Power}
          />
          <BigStat
            label="Banklar"
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
                  placeholder="Hisob raqami, MFO, bank yoki egasi..."
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
                  title="Barcha hisoblarni sync qilish"
                  className="h-10 w-10 p-0 rounded-xl shrink-0"
                >
                  <RefreshCw className={cn('h-4 w-4', syncAllMut.isPending && 'animate-spin')} />
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
                  <SelectValue placeholder="Hamma banklar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hamma banklar</SelectItem>
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
                  <SelectValue placeholder="Sync holati" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barchasi</SelectItem>
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
                >Karta</button>
                <button
                  onClick={() => setView('list')}
                  className={cn(
                    "px-3 h-9 rounded-lg transition-colors",
                    view === 'list' ? "bg-white shadow-sm text-slate-900" : "text-slate-500",
                  )}
                >Jadval</button>
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
  account: a, canManage, onSync, onDelete, onToggleSync, busy,
}: {
  account: any;
  canManage: boolean;
  onSync: () => void;
  onDelete: () => void;
  onToggleSync: () => void;
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
          <FileSpreadsheet className="h-3.5 w-3.5" /> Ko'p qo'shish
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
