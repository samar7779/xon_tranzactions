'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Trash2, Wifi, AlertCircle, CheckCircle2, KeyRound, MoreVertical,
  Activity, RefreshCw, Lock, Shield, Globe, Eye, EyeOff, Copy, Check, Pencil,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { BankLogo } from '@/components/bank-logo';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime } from '@/lib/utils';

const BANK_COLORS = [
  { from: '#6366f1', to: '#4f46e5' },
  { from: '#10b981', to: '#059669' },
  { from: '#a855f7', to: '#7c3aed' },
  { from: '#f59e0b', to: '#d97706' },
  { from: '#ec4899', to: '#db2777' },
  { from: '#06b6d4', to: '#0891b2' },
];

export default function CredentialsPage() {
  const t = useTranslations('credentials');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const isSuperAdmin = me?.role === 'SUPERADMIN';
  const [revealed, setRevealed] = useState<any>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: creds, isLoading } = useQuery({
    queryKey: ['bank-credentials'],
    queryFn: () => api.get<{ items: any[] }>('/bank-credentials'),
  });
  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });

  const bankColorMap = useMemo(() => {
    const m = new Map<string, { from: string; to: string }>();
    (banks?.items || []).forEach((b, i) => m.set(b.id, BANK_COLORS[i % BANK_COLORS.length]));
    return m;
  }, [banks]);

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

  const revealMut = useMutation({
    mutationFn: (id: string) => api.get<any>(`/bank-credentials/${id}/reveal-password`),
    onSuccess: (r) => setRevealed(r),
    onError: (e: any) => toast.error(e?.message || 'Parolni ko\'rish uchun ruxsat yo\'q'),
  });

  const list = creds?.items || [];
  const activeCount = list.filter((c: any) => c.isActive).length;
  const errorCount = list.filter((c: any) => c.lastError).length;
  const verifiedCount = list.filter((c: any) => c.lastVerifiedAt && !c.lastError).length;

  return (
    <>
      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold tracking-tight">Bank ulanishlari</div>
            <div className="text-xs text-slate-500">Banklar API uchun login/parol — har bir ulanish bir nechta hisobni o'z ichiga oladi</div>
          </div>
          <Button
            size="sm"
            onClick={() => { setEditing(null); setDialogOpen(true); }}
            className="bg-white text-indigo-700 hover:bg-white/90 rounded-full font-semibold shadow-sm"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />{t('add')}
          </Button>
        </div>

        {/* ═══ KPI ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile label="Jami ulanish" value={String(list.length)} icon={KeyRound} color="indigo" />
          <KpiTile label="Faol" value={String(activeCount)} icon={CheckCircle2} color="emerald" />
          <KpiTile label="Tekshirilgan" value={String(verifiedCount)} icon={Shield} color="cyan" />
          <KpiTile label="Xato bilan" value={String(errorCount)} icon={AlertCircle} color="rose" />
        </div>

        {/* ═══ CONNECTION CARDS ═══ */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
          </div>
        ) : list.length === 0 ? (
          <Card className="border-0 shadow-soft">
            <CardContent className="p-0">
              <EmptyState
                icon={KeyRound}
                title="Hali bank ulanishi qo'shilmagan"
                description="Birinchi bank ulanishini qo'shing — login va parol bilan, IP whitelist orqali avtomatik avtorizatsiya"
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((c: any) => {
              const color = bankColorMap.get(c.bankId) || BANK_COLORS[0];
              const status: 'ok' | 'error' | 'untested' = c.lastError ? 'error' : c.lastVerifiedAt ? 'ok' : 'untested';
              return (
                <CredentialCard
                  key={c.id}
                  cred={c}
                  color={color}
                  status={status}
                  onTest={() => testMut.mutate(c.id)}
                  onDelete={() => confirm(tc('confirmDelete')) && removeMut.mutate(c.id)}
                  onReveal={isSuperAdmin ? () => revealMut.mutate(c.id) : undefined}
                  onEdit={() => { setEditing(c); setDialogOpen(true); }}
                  testing={testMut.isPending}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Qo'shish / Tahrirlash modali */}
      <CredDialog
        banks={banks?.items || []}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />

      {/* Parolni ko'rsatish modali */}
      <RevealPasswordDialog data={revealed} onClose={() => setRevealed(null)} />
    </>
  );
}

function RevealPasswordDialog({ data, onClose }: { data: any; onClose: () => void }) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);

  function copy(field: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    toast.success(`${field} nusxalandi`);
    setTimeout(() => setCopiedField(null), 2000);
  }

  if (!data) return null;

  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 px-6 py-4 text-white">
          <div className="flex items-center gap-2 mb-1">
            <Eye className="h-4 w-4" />
            <span className="text-[11px] uppercase tracking-wider font-bold">Maxfiy ma'lumotlar</span>
          </div>
          <div className="text-base font-bold tracking-tight">{data.label}</div>
          <div className="text-xs text-white/80">{data.bank}</div>
        </div>
        <div className="p-5 space-y-3">
          <RevealRow label="Login" value={data.loginFull} onCopy={() => copy('Login', data.loginFull)} copied={copiedField === 'Login'} />
          <RevealRow label="Bank MFO" value={data.branch || '—'} onCopy={() => copy('MFO', data.branch || '')} copied={copiedField === 'MFO'} />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Parol</div>
            <div className="flex items-center gap-2 bg-amber-50 ring-1 ring-amber-200 rounded-xl px-3 py-2.5">
              <code className="flex-1 font-mono text-sm text-slate-900 break-all select-all">
                {showPwd ? data.password : '•'.repeat(Math.min(data.password.length, 16))}
              </code>
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="text-amber-700 hover:text-amber-900 shrink-0 p-1"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => copy('Parol', data.password)}
                className="text-amber-700 hover:text-amber-900 shrink-0 p-1"
              >
                {copiedField === 'Parol' ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[10px] text-rose-600">
              <Shield className="h-3 w-3" />
              Ehtiyot bo'ling: parolni faqat ishonchli joyda nusxalang. Bu amal logga yoziladi.
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RevealRow({ label, value, onCopy, copied }: { label: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">{label}</div>
      <div className="flex items-center gap-2 bg-slate-50 ring-1 ring-slate-200 rounded-xl px-3 py-2">
        <code className="flex-1 font-mono text-sm text-slate-900 break-all">{value}</code>
        <button type="button" onClick={onCopy} className="text-slate-500 hover:text-slate-900 shrink-0 p-1">
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function KpiTile({
  label, value, icon: Icon, color,
}: {
  label: string;
  value: string;
  icon: any;
  color: 'indigo' | 'emerald' | 'cyan' | 'rose';
}) {
  const m = {
    indigo:  { grad: 'from-indigo-500 to-blue-600',     bg: 'bg-indigo-50' },
    emerald: { grad: 'from-emerald-500 to-teal-600',    bg: 'bg-emerald-50' },
    cyan:    { grad: 'from-cyan-500 to-sky-600',        bg: 'bg-cyan-50' },
    rose:    { grad: 'from-rose-500 to-red-600',        bg: 'bg-rose-50' },
  }[color];
  return (
    <Card className="border-0 shadow-soft card-hover relative overflow-hidden">
      <div className={cn("absolute -top-12 -right-12 w-32 h-32 rounded-full blur-2xl opacity-30 bg-gradient-to-br", m.grad)} />
      <CardContent className="p-5 relative">
        <div className="flex items-start justify-between mb-2">
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500">{label}</div>
          <div className={cn("w-9 h-9 rounded-xl grid place-items-center bg-gradient-to-br text-white shadow-sm", m.grad)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-3xl font-bold tracking-tight tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function CredentialCard({
  cred: c, color, status, onTest, onDelete, onReveal, onEdit, testing,
}: {
  cred: any;
  color: { from: string; to: string };
  status: 'ok' | 'error' | 'untested';
  onTest: () => void;
  onDelete: () => void;
  onReveal?: () => void;
  onEdit: () => void;
  testing: boolean;
}) {
  return (
    <Card className="group border-0 shadow-soft card-hover overflow-hidden relative">
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${color.from}, ${color.to})` }} />

      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <BankLogo code={c.bank?.code || ''} name={c.bank?.name} size={44} />
            <div className="min-w-0">
              <div className="text-[14px] font-bold truncate tracking-tight">{c.label}</div>
              <div className="text-[11px] text-slate-500 truncate">{c.bank?.name}</div>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 -mr-1">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onTest} disabled={testing}>
                <Wifi className={cn("h-4 w-4 mr-2", testing && "animate-pulse")} /> Ulanishni tekshirish
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4 mr-2" /> Tahrirlash
              </DropdownMenuItem>
              {onReveal && (
                <DropdownMenuItem onClick={onReveal} className="text-amber-700">
                  <Eye className="h-4 w-4 mr-2" /> Parolni ko'rsatish
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-rose-600" onClick={onDelete}>
                <Trash2 className="h-4 w-4 mr-2" /> O'chirish
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Login */}
        <div className="rounded-xl bg-slate-50/60 ring-1 ring-slate-100 px-3 py-2 mb-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Login</span>
            <span className="font-mono text-xs text-slate-700">{(c.loginPrefix || '') + c.loginName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">MFO</span>
            <span className="font-mono text-xs text-slate-700">{c.branch || '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Avtorizatsiya</span>
            <span className="text-xs font-medium text-slate-700 flex items-center gap-1">
              {c.authMode === 'IP_WHITELIST' ? <><Globe className="h-3 w-3" /> IP Whitelist</> : <><Lock className="h-3 w-3" /> SMS SID</>}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Yo'l</span>
            <span className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold",
              c.useProxy ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600",
            )}>
              {c.useProxy ? '🔀 ahost orqali' : '↗ to\'g\'ridan-to\'g\'ri'}
            </span>
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between">
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ring-1 ring-inset",
            status === 'ok' && "bg-emerald-50 text-emerald-700 ring-emerald-200",
            status === 'error' && "bg-rose-50 text-rose-700 ring-rose-200",
            status === 'untested' && "bg-slate-50 text-slate-500 ring-slate-200",
          )}>
            <span className="relative flex h-1.5 w-1.5">
              {status === 'ok' && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />}
              <span className={cn(
                "relative inline-flex rounded-full h-1.5 w-1.5",
                status === 'ok' && "bg-emerald-500",
                status === 'error' && "bg-rose-500",
                status === 'untested' && "bg-slate-300",
              )} />
            </span>
            {status === 'ok' && 'Ulangan'}
            {status === 'error' && 'Xato'}
            {status === 'untested' && 'Tekshirilmagan'}
          </span>
          <div className="text-[10px] text-slate-400">
            {c.lastVerifiedAt ? formatDateTime(c.lastVerifiedAt) : 'Hech qachon'}
          </div>
        </div>

        {c.lastError && (
          <div className="mt-3 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-2.5 py-2 text-[11px] text-rose-700 truncate">
            <AlertCircle className="h-3 w-3 inline mr-1" /> {c.lastError}
          </div>
        )}

        <Button
          size="sm" variant="outline" onClick={onTest} disabled={testing}
          className="w-full mt-3 h-9 rounded-xl text-xs font-medium gap-1.5 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700"
        >
          <Wifi className={cn("h-3.5 w-3.5", testing && "animate-pulse")} />
          {testing ? 'Tekshirilmoqda...' : 'Ulanishni tekshirish'}
        </Button>
      </CardContent>
    </Card>
  );
}

const EMPTY_FORM = {
  bankId: '', label: '', loginPrefix: 'IB#', loginName: '', password: '', branch: '', authMode: 'IP_WHITELIST', useProxy: true,
};

function CredDialog({
  banks, open, onOpenChange, editing,
}: {
  banks: any[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: any;
}) {
  const t = useTranslations('credentials');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const isEdit = !!editing;
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        bankId: editing.bankId || '',
        label: editing.label || '',
        loginPrefix: editing.loginPrefix || '',
        loginName: editing.loginName || '',
        password: '',
        branch: editing.branch || '',
        authMode: editing.authMode || 'IP_WHITELIST',
        useProxy: editing.useProxy ?? true,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editing]);

  const mut = useMutation({
    mutationFn: () => {
      const payload: any = { ...form };
      if (isEdit && !payload.password) delete payload.password;
      return isEdit
        ? api.patch(`/bank-credentials/${editing.id}`, payload)
        : api.post('/bank-credentials', payload);
    },
    onSuccess: () => {
      toast.success(tc('success'));
      qc.invalidateQueries({ queryKey: ['bank-credentials'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Ulanishni tahrirlash' : t('add')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('bank')}</Label>
              <Select value={form.bankId} onValueChange={(v) => setForm({ ...form, bankId: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {/* Aktiv banklar */}
                  {banks.filter((b) => b.isActive).length > 0 && (
                    <>
                      <div className="px-2 py-1 text-[10px] uppercase tracking-wider font-bold text-emerald-700 bg-emerald-50">
                        ✓ Aktiv (API ishlaydi)
                      </div>
                      {banks.filter((b) => b.isActive).map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </>
                  )}
                  {/* Noaktiv banklar */}
                  {banks.filter((b) => !b.isActive).length > 0 && (
                    <>
                      <div className="px-2 py-1 text-[10px] uppercase tracking-wider font-bold text-slate-500 bg-slate-50 mt-1">
                        🚧 Kelajakda (hozir tanlash mumkin emas)
                      </div>
                      {banks.filter((b) => !b.isActive).map((b) => (
                        <SelectItem key={b.id} value={b.id} disabled className="opacity-60">
                          {b.name}
                        </SelectItem>
                      ))}
                    </>
                  )}
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
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="KapitalBank #1" />
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
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={isEdit ? "Bo'sh qoldirsangiz o'zgartirilmaydi" : ''}
            />
            {isEdit && (
              <div className="text-[10px] text-slate-500">Parolni o'zgartirish uchun yangi parolni kiriting</div>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t('branch')}</Label>
            <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value.replace(/\D/g, '').slice(0, 5) })} placeholder="00974" maxLength={5} />
            <div className="text-[10px] text-slate-500">5 xonalik MFO kod</div>
          </div>

          {/* ahost proxy toggle */}
          <div className={cn(
            "rounded-xl p-3 transition-all flex items-center gap-3 ring-1",
            form.useProxy ? "bg-emerald-50/60 ring-emerald-200" : "bg-slate-50 ring-slate-200",
          )}>
            <button
              type="button"
              onClick={() => setForm({ ...form, useProxy: !form.useProxy })}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full ring-1 ring-inset transition-colors",
                form.useProxy ? "bg-emerald-500 ring-emerald-600" : "bg-slate-300 ring-slate-400",
              )}
            >
              <span className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-1 ring-black/5 transition-transform mt-1",
                form.useProxy ? "translate-x-6" : "translate-x-1",
              )} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold text-slate-900">ahost orqali yuborish</div>
              <div className="text-[10px] text-slate-600 mt-0.5">
                {form.useProxy
                  ? "Bank API'ga so'rovlar ahost (37.153.159.11) orqali — IP whitelist'da bor"
                  : "To'g'ridan-to'g'ri bizning server (185.228.88.247) dan — whitelist talab qiladi"}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>{tc('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
