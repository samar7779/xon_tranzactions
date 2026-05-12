'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Search, RefreshCw, Trash2, Building2, Wallet, Filter,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

export default function AccountsPage() {
  const t = useTranslations('accounts');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = user?.role === 'SUPERADMIN' || user?.permissions?.includes(PERMS.ACCOUNTS_MANAGE);

  const [q, setQ] = useState('');
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const { data: accounts } = useQuery({
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
      qc.invalidateQueries({ queryKey: ['stats-30d'] });
    },
    onError: (e: any) => toast.error(e?.message),
  });

  // Filter
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
  if (bankFilter !== 'all') {
    filtered = filtered.filter((a) => a.bankId === bankFilter);
  }

  // Aggregate stats
  const totalBalance = filtered.reduce((s, a) => s + Number(a.balance || 0), 0);
  const totalTxns = filtered.reduce((s, a) => s + (a._count?.transactions || 0), 0);

  return (
    <>
      <Topbar title={t('title')} subtitle={`${accounts?.items?.length || 0} ta hisob · ${banks?.items?.length || 0} ta bank`} />
      <div className="flex-1 p-6 lg:p-8 space-y-4">

        {/* Top summary bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryStat label="Jami qoldiq" value={formatMoney(totalBalance)} icon={Wallet} />
          <SummaryStat label="Hisoblar" value={String(filtered.length)} icon={Building2} />
          <SummaryStat label="Tranzaksiyalar" value={String(totalTxns)} icon={RefreshCw} />
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9 h-10" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Hisob raqami, MFO yoki bank" />
            </div>
            <Select value={bankFilter} onValueChange={setBankFilter}>
              <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="Hamma banklar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Hamma banklar</SelectItem>
                {(banks?.items || []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canManage && <CreateAccountDialog creds={creds?.items || []} />}
        </div>

        {filtered.length === 0 ? (
          <Card><CardContent className="p-0">
            <EmptyState
              icon={Wallet}
              title={q || bankFilter !== 'all' ? "Hisob topilmadi" : t('noData')}
              description="Bank ulanishi → Hisob raqami qo'shish tartibida sozlang"
            />
          </CardContent></Card>
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                canManage={canManage}
                onSync={() => syncMut.mutate(a.id)}
                onDelete={() => confirm(tc('confirmDelete')) && removeMut.mutate(a.id)}
                busy={syncMut.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SummaryStat({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
            <div className="text-xl font-semibold tabular-nums">{value}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AccountCard({
  account: a, canManage, onSync, onDelete, busy,
}: { account: any; canManage: boolean; onSync: () => void; onDelete: () => void; busy: boolean }) {
  const balance = Number(a.balance || 0);
  return (
    <Card className="group hover:shadow-pop transition-all hover:-translate-y-0.5">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 text-white grid place-items-center shrink-0">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{a.bank?.name}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{a.branch}</div>
            </div>
          </div>
          <Badge variant={a.syncEnabled ? 'success' : 'muted'} className="text-[10px]">
            {a.syncEnabled ? 'Sync ON' : 'OFF'}
          </Badge>
        </div>

        <div className="font-mono text-[11px] text-muted-foreground tracking-tight mb-1">
          {formatAccount(a.accountNo)}
        </div>
        {a.ownerName && <div className="text-xs text-muted-foreground truncate mb-3">{a.ownerName}</div>}

        <div className="mt-3 pt-3 border-t">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Qoldiq</div>
          <div className="text-2xl font-semibold tabular-nums mt-0.5">
            {formatMoney(balance, a.currency)}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
            {a.lastSyncedAt ? (
              <><RefreshCw className="h-2.5 w-2.5" /> {formatDateTime(a.lastSyncedAt)}</>
            ) : 'Hech qachon sync bo\'lmagan'}
          </div>
          <div className="flex gap-1">
            {canManage && (
              <>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onSync} disabled={busy} title="Hozir sync">
                  <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onDelete} title="O'chirish">
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </>
            )}
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
        <Button><Plus className="h-4 w-4 mr-2" />{t('add')}</Button>
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
              <p className="text-xs text-muted-foreground">Avval Bank ulanishi qo'shing → Sozlash → Bank ulanishlari</p>
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
