'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, FileText, X } from 'lucide-react';
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatDate, formatMoney } from '@/lib/utils';

const STATUS_COLOR: Record<string, any> = {
  ACTIVE: 'success',
  COMPLETED: 'muted',
  DRAFT: 'outline',
  CANCELLED: 'destructive',
  SUSPENDED: 'secondary',
};

export default function ContractsPage() {
  const t = useTranslations('contracts');
  const tc = useTranslations('common');
  const { locale } = useParams<{ locale: string }>();
  const search = useSearchParams();
  const customerIdFilter = search.get('customerId');

  const user = useAuth((s) => s.user);
  const canManage = !!user?.permissions?.includes(PERMS.CONTRACTS_MANAGE);

  const { data: contracts, isLoading } = useQuery({
    queryKey: ['contracts', customerIdFilter],
    queryFn: () => api.get<{ items: any[] }>(`/contracts${customerIdFilter ? `?customerId=${customerIdFilter}` : ''}`),
  });
  const { data: customers } = useQuery({
    queryKey: ['customers-mini'],
    queryFn: () => api.get<{ items: any[] }>('/customers'),
  });

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <div className="flex-1 p-6 lg:p-8 space-y-4">
        <div className="flex justify-end">
          {canManage && <CreateContractDialog customers={customers?.items || []} preselectCustomerId={customerIdFilter} />}
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">{tc('loading')}</div>
            ) : (contracts?.items?.length ?? 0) === 0 ? (
              <EmptyState icon={FileText} title={t('noData')} description={t('subtitle')} />
            ) : (
              <div className="divide-y">
                {contracts!.items.map((c) => (
                  <Link key={c.id} href={`/${locale}/contracts/${c.id}`}
                    className="flex items-center gap-4 p-4 hover:bg-accent/40 transition-colors group">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium group-hover:text-primary transition-colors">{c.title}</span>
                        <Badge variant={STATUS_COLOR[c.status]}>{t('status' + c.status)}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                        <span className="font-mono">{c.number}</span>
                        <span>·</span>
                        <span>{c.customer?.name}</span>
                        <span>·</span>
                        <span>{formatDate(c.signDate)}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold tabular-nums">{formatMoney(Number(c.totalAmount))}</div>
                      <div className="text-xs tabular-nums">
                        <span className="text-success">{formatMoney(Number(c.paidTotal))}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className={cn(Number(c.debt) > 0 ? "text-destructive" : "text-muted-foreground")}>
                          {formatMoney(Number(c.debt))}
                        </span>
                      </div>
                    </div>
                    <div className="w-24 shrink-0">
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600" style={{ width: `${Math.min(100, c.progressPct)}%` }} />
                      </div>
                      <div className="text-[10px] text-right text-muted-foreground mt-0.5 tabular-nums">
                        {c.progressPct.toFixed(0)}%
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ─────── Yangi shartnoma yaratish dialog ───────

interface StageDraft { title: string; amount: string; percentage?: string; dueDate?: string }

const PRESETS: Record<string, (total: number) => StageDraft[]> = {
  '30/70': (t) => [
    { title: 'Avans', percentage: '30', amount: (t * 0.3).toFixed(0) },
    { title: 'Yakuniy', percentage: '70', amount: (t * 0.7).toFixed(0) },
  ],
  '30/30/40': (t) => [
    { title: 'Avans', percentage: '30', amount: (t * 0.3).toFixed(0) },
    { title: 'Oraliq', percentage: '30', amount: (t * 0.3).toFixed(0) },
    { title: 'Yakuniy', percentage: '40', amount: (t * 0.4).toFixed(0) },
  ],
};

function CreateContractDialog({ customers, preselectCustomerId }: { customers: any[]; preselectCustomerId?: string | null }) {
  const t = useTranslations('contracts');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const [form, setForm] = useState({
    customerId: preselectCustomerId || '',
    title: '', description: '', projectAddress: '',
    totalAmount: '', signDate: new Date().toISOString().slice(0, 10),
  });
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [preset, setPreset] = useState<string>('custom');

  useEffect(() => {
    if (!open) {
      setForm({ customerId: preselectCustomerId || '', title: '', description: '', projectAddress: '', totalAmount: '', signDate: new Date().toISOString().slice(0, 10) });
      setStages([]);
      setPreset('custom');
    }
  }, [open, preselectCustomerId]);

  function applyPreset(key: string) {
    setPreset(key);
    const total = Number(form.totalAmount);
    if (key in PRESETS && total > 0) {
      setStages(PRESETS[key](total));
    } else if (key === 'custom' && stages.length === 0) {
      setStages([{ title: 'Avans', amount: '' }]);
    }
  }

  function addStage() {
    setStages([...stages, { title: '', amount: '' }]);
  }
  function removeStage(i: number) {
    setStages(stages.filter((_, idx) => idx !== i));
  }
  function updateStage(i: number, patch: Partial<StageDraft>) {
    setStages(stages.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  const stagesSum = stages.reduce((s, st) => s + Number(st.amount || 0), 0);
  const total = Number(form.totalAmount || 0);
  const sumOk = Math.abs(stagesSum - total) < 0.01 && stages.length > 0;

  const mut = useMutation({
    mutationFn: () => api.post('/contracts', {
      customerId: form.customerId,
      title: form.title,
      description: form.description || undefined,
      projectAddress: form.projectAddress || undefined,
      totalAmount: Number(form.totalAmount),
      signDate: form.signDate,
      stages: stages.map((s) => ({
        title: s.title,
        amount: Number(s.amount),
        percentage: s.percentage ? Number(s.percentage) : undefined,
        dueDate: s.dueDate || undefined,
      })),
    }),
    onSuccess: () => {
      toast.success(tc('success'));
      qc.invalidateQueries({ queryKey: ['contracts'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" />{t('add')}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('add')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('customer')}</Label>
              <Select value={form.customerId} onValueChange={(v) => setForm({ ...form, customerId: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('signDate')}</Label>
              <Input type="date" value={form.signDate} onChange={(e) => setForm({ ...form, signDate: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('projectTitle')}</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Tashkent Mall qurilishi" />
          </div>
          <div className="space-y-2">
            <Label>{t('projectAddress')}</Label>
            <Input value={form.projectAddress} onChange={(e) => setForm({ ...form, projectAddress: e.target.value })} placeholder="Toshkent shahar, Yunusobod tumani" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('totalAmount')} (UZS)</Label>
              <Input type="number" inputMode="numeric" value={form.totalAmount}
                onChange={(e) => { setForm({ ...form, totalAmount: e.target.value }); if (preset !== 'custom') applyPreset(preset); }}
                placeholder="1500000000" />
            </div>
            <div className="space-y-2">
              <Label>{t('stagesPreset')}</Label>
              <Select value={preset} onValueChange={applyPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30/70">{t('preset3070')}</SelectItem>
                  <SelectItem value="30/30/40">{t('preset30_30_40')}</SelectItem>
                  <SelectItem value="custom">{t('preset_custom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Stages editor */}
          <div className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">{t('stages')}</Label>
              <div className="text-xs">
                <span className="text-muted-foreground">Jami: </span>
                <span className={cn("tabular-nums font-medium", sumOk ? 'text-success' : 'text-destructive')}>
                  {formatMoney(stagesSum)}
                </span>
                <span className="text-muted-foreground"> / {formatMoney(total)}</span>
              </div>
            </div>

            {stages.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                {t('stagesPreset')} tanlang yoki qo'lda qo'shing
              </div>
            ) : (
              <div className="space-y-2">
                {stages.map((s, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      <Input value={s.title} onChange={(e) => updateStage(i, { title: e.target.value })}
                        placeholder={t('stageTitle')} className="h-9" />
                    </div>
                    <div className="col-span-3">
                      <Input type="number" value={s.amount}
                        onChange={(e) => updateStage(i, { amount: e.target.value })}
                        placeholder={t('stageAmount')} className="h-9 tabular-nums" />
                    </div>
                    <div className="col-span-2">
                      <Input type="number" value={s.percentage || ''}
                        onChange={(e) => updateStage(i, { percentage: e.target.value })}
                        placeholder="%" className="h-9" />
                    </div>
                    <div className="col-span-2">
                      <Input type="date" value={s.dueDate || ''}
                        onChange={(e) => updateStage(i, { dueDate: e.target.value })}
                        className="h-9" />
                    </div>
                    <div className="col-span-1">
                      <Button size="sm" variant="ghost" className="h-9 w-9 p-0" onClick={() => removeStage(i)}>
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button size="sm" variant="outline" onClick={addStage} className="mt-2">
              <Plus className="h-3 w-3 mr-1" /> {t('addStage')}
            </Button>

            {!sumOk && stages.length > 0 && (
              <div className="text-xs text-destructive mt-2">{t('sumMismatch')}</div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tc('cancel')}</Button>
          <Button onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.customerId || !form.title || !form.totalAmount || !sumOk}>
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
