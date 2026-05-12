'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Wifi, AlertCircle, CheckCircle2 } from 'lucide-react';
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

export default function CredentialsPage() {
  const t = useTranslations('credentials');
  const tc = useTranslations('common');
  const qc = useQueryClient();

  const { data: creds } = useQuery({
    queryKey: ['bank-credentials'],
    queryFn: () => api.get<{ items: any[] }>('/bank-credentials'),
  });
  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/bank-credentials/${id}`),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['bank-credentials'] }); },
    onError: (e: any) => toast.error(e?.message),
  });
  const testMut = useMutation({
    mutationFn: (id: string) => api.post(`/bank-credentials/${id}/test`),
    onSuccess: (r: any) => {
      const n = r?.clients?.length || 0;
      toast.success(`${t('testSuccess')} (${n})`);
      qc.invalidateQueries({ queryKey: ['bank-credentials'] });
    },
    onError: (e: any) => toast.error(`${t('testFailed')}: ${e?.message}`),
  });

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <div className="flex-1 p-6 space-y-4">
        <div className="flex justify-end">
          <CreateCredDialog banks={banks?.items || []} />
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('label')}</TableHead>
                  <TableHead>{t('bank')}</TableHead>
                  <TableHead>{t('loginName')}</TableHead>
                  <TableHead>{t('branch')}</TableHead>
                  <TableHead>{t('authMode')}</TableHead>
                  <TableHead>{t('active')}</TableHead>
                  <TableHead>{t('lastVerified')}</TableHead>
                  <TableHead className="text-right">{tc('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(creds?.items?.length ?? 0) === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">{t('noData')}</TableCell></TableRow>
                ) : (
                  creds!.items.map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.label}</TableCell>
                      <TableCell>{c.bank?.name}</TableCell>
                      <TableCell className="font-mono text-sm">{(c.loginPrefix || '') + c.loginName}</TableCell>
                      <TableCell className="font-mono text-sm">{c.branch || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{c.authMode === 'IP_WHITELIST' ? t('ipWhitelist') : t('smsSid')}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.isActive ? 'success' : 'muted'}>
                          {c.isActive ? tc('yes') : tc('no')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.lastError ? (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <AlertCircle className="h-3 w-3" /> {formatDateTime(c.lastVerifiedAt)}
                          </span>
                        ) : c.lastVerifiedAt ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3 w-3" /> {formatDateTime(c.lastVerifiedAt)}
                          </span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => testMut.mutate(c.id)} disabled={testMut.isPending}>
                            <Wifi className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => confirm(tc('confirmDelete')) && removeMut.mutate(c.id)}>
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

function CreateCredDialog({ banks }: { banks: any[] }) {
  const t = useTranslations('credentials');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    bankId: '', label: '', loginPrefix: 'IB#', loginName: '', password: '', branch: '', authMode: 'IP_WHITELIST',
  });

  const mut = useMutation({
    mutationFn: () => api.post('/bank-credentials', form),
    onSuccess: () => {
      toast.success(tc('success'));
      qc.invalidateQueries({ queryKey: ['bank-credentials'] });
      setOpen(false);
      setForm({ bankId: '', label: '', loginPrefix: 'IB#', loginName: '', password: '', branch: '', authMode: 'IP_WHITELIST' });
    },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" />{t('add')}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('add')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('bank')}</Label>
              <Select value={form.bankId} onValueChange={(v) => setForm({ ...form, bankId: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('authMode')}</Label>
              <Select value={form.authMode} onValueChange={(v) => setForm({ ...form, authMode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IP_WHITELIST">{t('ipWhitelist')}</SelectItem>
                  <SelectItem value="SMS_SID">{t('smsSid')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('label')}</Label>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>{t('loginPrefix')}</Label>
              <Input value={form.loginPrefix} onChange={(e) => setForm({ ...form, loginPrefix: e.target.value })} placeholder="IB#" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>{t('loginName')}</Label>
              <Input value={form.loginName} onChange={(e) => setForm({ ...form, loginName: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('password')}</Label>
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>{t('branch')}</Label>
            <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} placeholder="00974" />
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
