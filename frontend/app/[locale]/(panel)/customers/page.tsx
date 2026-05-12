'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Search, Pencil, Trash2, UserCircle, Building2, Phone, ArrowUpRight,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatMoney } from '@/lib/utils';

interface CustomerItem {
  id: string;
  name: string;
  shortName?: string | null;
  inn?: string | null;
  phone?: string | null;
  email?: string | null;
  isActive: boolean;
  _count: { contracts: number; transactions: number };
  stats: { contractsTotal: string; paidTotal: string; debt: string; contractsCount: number };
}

export default function CustomersPage() {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const { locale } = useParams<{ locale: string }>();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = user?.role === 'SUPERADMIN' || user?.permissions?.includes(PERMS.CUSTOMERS_MANAGE);

  const [q, setQ] = useState('');
  const params = new URLSearchParams();
  if (q) params.set('q', q);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', q],
    queryFn: () => api.get<{ items: CustomerItem[] }>(`/customers${q ? `?${params}` : ''}`),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <div className="flex-1 p-6 lg:p-8 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 h-10"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search')}
            />
          </div>
          {canManage && <CreateCustomerDialog />}
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}><CardContent className="p-6"><div className="h-32 animate-pulse rounded bg-muted/50" /></CardContent></Card>
            ))}
          </div>
        ) : (data?.items?.length ?? 0) === 0 ? (
          <Card><CardContent className="p-0"><EmptyState icon={UserCircle} title={t('noData')} description={t('subtitle')} action={canManage && <CreateCustomerDialog />} /></CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data!.items.map((c) => {
              const debt = Number(c.stats.debt);
              const paid = Number(c.stats.paidTotal);
              const total = Number(c.stats.contractsTotal);
              const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
              return (
                <Card key={c.id} className="hover:shadow-pop transition-all hover:-translate-y-0.5 group">
                  <CardContent className="p-5">
                    <Link href={`/${locale}/customers/${c.id}`} className="block">
                      <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white font-semibold shrink-0">
                          {(c.shortName || c.name).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold truncate group-hover:text-primary transition-colors">{c.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{c.inn || '—'}</div>
                        </div>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </Link>

                    <div className="mt-4 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{t('contractsTotal')}</span>
                        <span className="font-medium tabular-nums">{formatMoney(total)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{t('paidTotal')}</span>
                        <span className="font-medium text-success tabular-nums">{formatMoney(paid)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{t('debt')}</span>
                        <span className={cn("font-medium tabular-nums", debt > 0 ? "text-destructive" : "text-success")}>
                          {formatMoney(debt)}
                        </span>
                      </div>
                      {/* progress bar */}
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden mt-2">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t flex items-center justify-between">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" /> {c._count.contracts}</span>
                        {c.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone}</span>}
                      </div>
                      {canManage && (
                        <div className="inline-flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); }}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                            onClick={(e) => {
                              e.preventDefault();
                              if (confirm(tc('confirmDelete'))) removeMut.mutate(c.id);
                            }}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function CreateCustomerDialog() {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', inn: '', shortName: '', contactPerson: '', phone: '', email: '', address: '',
  });

  const mut = useMutation({
    mutationFn: () => api.post('/customers', form),
    onSuccess: () => {
      toast.success(tc('success'));
      qc.invalidateQueries({ queryKey: ['customers'] });
      setOpen(false);
      setForm({ name: '', inn: '', shortName: '', contactPerson: '', phone: '', email: '', address: '' });
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
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('name')}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder='OOO "Tashkent Mall"' />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('inn')}</Label>
              <Input value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value })} placeholder="300123456" />
            </div>
            <div className="space-y-2">
              <Label>{t('shortName')}</Label>
              <Input value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('contactPerson')}</Label>
            <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('phone')}</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+998 71 ..." />
            </div>
            <div className="space-y-2">
              <Label>{t('email')}</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('address')}</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tc('cancel')}</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !form.name}>{tc('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
