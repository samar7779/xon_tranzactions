'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Search, RefreshCw, Trash2, Building2, Wallet, MoreVertical,
  Eye, X, Power, PowerOff, ArrowUpRight,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

const BANK_COLORS = [
  { from: '#6366f1', to: '#4f46e5' },   // indigo
  { from: '#10b981', to: '#059669' },   // emerald
  { from: '#a855f7', to: '#7c3aed' },   // purple
  { from: '#f59e0b', to: '#d97706' },   // amber
  { from: '#ec4899', to: '#db2777' },   // pink
  { from: '#06b6d4', to: '#0891b2' },   // cyan
  { from: '#ef4444', to: '#dc2626' },   // red
  { from: '#8b5cf6', to: '#6d28d9' },   // violet
];

export default function AccountsPage() {
  const t = useTranslations('accounts');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = !!(user?.role === 'SUPERADMIN' || user?.permissions?.includes(PERMS.ACCOUNTS_MANAGE));

  const [q, setQ] = useState('');
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');

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
      api.put(`/bank-accounts/${id}`, { syncEnabled: enabled }),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['bank-accounts'] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  // Bank → color map
  const bankColorMap = useMemo(() => {
    const m = new Map<string, { from: string; to: string }>();
    (banks?.items || []).forEach((b, i) => m.set(b.id, BANK_COLORS[i % BANK_COLORS.length]));
    return m;
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
      <Topbar
        title={t('title')}
        subtitle={`${accounts?.items?.length || 0} ta hisob · ${banks?.items?.length || 0} ta bank`}
        actions={canManage ? <CreateAccountDialog creds={creds?.items || []} /> : null}
      />
      <div className="flex-1 p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto w-full">

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
                  {(banks?.items || []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
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
                color={bankColorMap.get(a.bankId) || BANK_COLORS[0]}
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
                      const c = bankColorMap.get(a.bankId) || BANK_COLORS[0];
                      return (
                        <tr key={a.id} className="hover:bg-slate-50/60 transition-colors group">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-9 h-9 rounded-xl grid place-items-center text-white shadow-sm shrink-0"
                                style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }}>
                                <Building2 className="h-4 w-4" />
                              </div>
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
  account: a, color, canManage, onSync, onDelete, onToggleSync, busy,
}: {
  account: any;
  color: { from: string; to: string };
  canManage: boolean;
  onSync: () => void;
  onDelete: () => void;
  onToggleSync: () => void;
  busy: boolean;
}) {
  const balance = Number(a.balance || 0);
  return (
    <Card className="group relative border-0 shadow-soft card-hover overflow-hidden">
      {/* Color stripe top */}
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${color.from}, ${color.to})` }} />

      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl grid place-items-center shrink-0 shadow-sm text-white"
              style={{ background: `linear-gradient(135deg, ${color.from}, ${color.to})` }}>
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-bold truncate tracking-tight">{a.bank?.name}</div>
              <div className="text-[10px] font-mono text-slate-500">MFO {a.branch}</div>
            </div>
          </div>

          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 -mr-1">
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

        <div className="font-mono text-[11px] text-slate-500 tracking-tight mb-2">
          {formatAccount(a.accountNo)}
        </div>
        {a.ownerName && <div className="text-xs text-slate-700 truncate mb-3">{a.ownerName}</div>}

        <div className="rounded-xl bg-slate-50/60 ring-1 ring-slate-100 p-3.5 mt-3">
          <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mb-0.5">Qoldiq</div>
          <div className="text-2xl font-bold tracking-tight tabular-nums">
            {formatMoney(balance, a.currency)}
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 ring-inset",
            a.syncEnabled
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-slate-50 text-slate-500 ring-slate-200",
          )}>
            <span className="relative flex h-1.5 w-1.5">
              {a.syncEnabled && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />}
              <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", a.syncEnabled ? "bg-emerald-500" : "bg-slate-300")} />
            </span>
            {a.syncEnabled ? 'Sync ON' : 'Sync OFF'}
          </span>
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            {a.lastSyncedAt ? <><RefreshCw className="h-2.5 w-2.5" /> {formatDateTime(a.lastSyncedAt)}</> : 'Hech qachon'}
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
    mutationFn: () => api.post('/bank-accounts', form),
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
        <Button size="sm" className="bg-white text-indigo-700 hover:bg-white/90 rounded-full font-semibold shadow-sm">
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
              <Label>MFO</Label>
              <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} placeholder="00974" />
            </div>
            <div className="space-y-2">
              <Label>Valyuta</Label>
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
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
