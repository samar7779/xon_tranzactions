'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export default function AccountsPage() {
  const t = useTranslations('accounts');
  const tc = useTranslations('common');
  const qc = useQueryClient();

  const { data: accounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<{ items: any[] }>('/bank-accounts'),
  });
  const { data: creds } = useQuery({
    queryKey: ['bank-credentials'],
    queryFn: () => api.get<{ items: any[] }>('/bank-credentials'),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/bank-accounts/${id}`),
    onSuccess: () => {
      toast.success(tc('success'));
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (e: any) => toast.error(e?.message),
  });
  const syncMut = useMutation({
    mutationFn: (id: string) => api.post(`/sync/account/${id}`),
    onSuccess: (r: any) => {
      toast.success(`✓ ${r?.fetched || 0} olindi · ${r?.saved || 0} saqlandi`);
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <div className="flex-1 p-6 space-y-4">
        <div className="flex justify-end">
          <CreateAccountDialog creds={creds?.items || []} />
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('credential')}</TableHead>
                  <TableHead>{t('branch')}</TableHead>
                  <TableHead>{t('accountNo')}</TableHead>
                  <TableHead>{t('owner')}</TableHead>
                  <TableHead>{t('currency')}</TableHead>
                  <TableHead>{t('syncEnabled')}</TableHead>
                  <TableHead>{t('lastSync')}</TableHead>
                  <TableHead className="text-right">{tc('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(accounts?.items?.length ?? 0) === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">{t('noData')}</TableCell></TableRow>
                ) : (
                  accounts!.items.map((a: any) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.credential?.label || '—'}</TableCell>
                      <TableCell className="font-mono text-sm">{a.branch}</TableCell>
                      <TableCell className="font-mono text-sm">{a.accountNo}</TableCell>
                      <TableCell>{a.ownerName || '—'}</TableCell>
                      <TableCell>{a.currency}</TableCell>
                      <TableCell>
                        <Badge variant={a.syncEnabled ? 'success' : 'muted'}>
                          {a.syncEnabled ? tc('yes') : tc('no')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(a.lastSyncedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => syncMut.mutate(a.id)} disabled={syncMut.isPending}>
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => confirm(tc('confirmDelete')) && removeMut.mutate(a.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
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
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('credential')}</Label>
            <Select value={form.credentialId} onValueChange={(v) => setForm({ ...form, credentialId: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {creds.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.label} · {c.bank?.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('branch')}</Label>
              <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} placeholder="00974" />
            </div>
            <div className="space-y-2">
              <Label>{t('currency')}</Label>
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('accountNo')}</Label>
            <Input value={form.accountNo} onChange={(e) => setForm({ ...form, accountNo: e.target.value })} placeholder="20208000012345678001" />
          </div>
          <div className="space-y-2">
            <Label>{t('owner')}</Label>
            <Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tc('cancel')}</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>{tc('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
