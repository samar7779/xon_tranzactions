'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Trash2, AlertTriangle, Loader2, Database, ShieldAlert, Info, ListChecks,
  Building2, User, Wallet, Calendar, X, Receipt,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatMoney } from '@/lib/utils';

interface CountResp {
  ok: boolean;
  error?: string;
  account?: {
    id: string; accountNo: string; ownerName?: string | null;
    branch?: string | null; balance?: any; currency?: string;
    bank?: { id: string; code: string; name: string } | null;
  };
  count?: number;
  paymentsCount?: number;
  firstTxnDate?: string | null;
  lastTxnDate?: string | null;
}

export default function CleanupPage() {
  const t = useTranslations('cleanup');
  const tc = useTranslations('common');
  const me = useAuth((s) => s.user);
  const isSuperAdmin = me?.role === 'SUPERADMIN';

  const [accountNo, setAccountNo] = useState('');
  const [confirm, setConfirm] = useState('');
  const [lastResult, setLastResult] = useState<any>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [countInfo, setCountInfo] = useState<CountResp | null>(null);

  const countMut = useMutation({
    mutationFn: () => api.get<CountResp>(`/transactions/count-by-account/${encodeURIComponent(accountNo.trim())}`),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error || tc('error'));
        return;
      }
      setCountInfo(r);
      setConfirmOpen(true);
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  const mut = useMutation({
    mutationFn: () =>
      api.post<any>('/transactions/cleanup-by-account', { accountNo: accountNo.trim(), confirm: confirm.trim() }),
    onSuccess: (r: any) => {
      setLastResult(r);
      setConfirmOpen(false);
      if (r?.ok) {
        toast.success(t('successCount', { n: r.deleted }));
        setAccountNo('');
        setConfirm('');
        setCountInfo(null);
      } else {
        toast.error(r?.error || tc('error'));
      }
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  const canSubmit = accountNo.trim().length >= 20 && confirm.trim() === accountNo.trim();

  return (
    <div className="flex-1 p-6 lg:p-8 w-full">
      <div className="w-full space-y-5">
        {!isSuperAdmin && (
          <Card className="border-0 shadow-soft overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-rose-500 to-red-600" />
            <CardContent className="p-6 flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-base font-bold tracking-tight">{t('deniedTitle')}</div>
                <div
                  className="text-xs text-slate-500 dark:text-slate-400 mt-1"
                  dangerouslySetInnerHTML={{
                    __html: t('deniedBody', { role: me?.role || '—' })
                      .replace('SUPERADMIN', '<b>SUPERADMIN</b>')
                      .replace(/(:\s)([^.<]+)\.$/, '$1<b>$2</b>.'),
                  }}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Hero — full width */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <div className="relative bg-gradient-to-br from-rose-500 via-red-500 to-rose-700 px-8 py-7 text-white overflow-hidden">
            <div className="absolute inset-0 bg-dots opacity-15 pointer-events-none" />
            <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-white/10 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-rose-300/15 blur-3xl pointer-events-none" />

            <div className="relative flex items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-white/15 ring-2 ring-white/30 backdrop-blur-md grid place-items-center shrink-0">
                <Trash2 className="h-8 w-8" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5 text-white/80">
                  <span className="text-[10px] uppercase tracking-[0.18em] font-bold">{t('sectionLabel')}</span>
                </div>
                <div className="text-2xl lg:text-3xl font-black tracking-tight">{t('title')}</div>
                <div className="text-white/85 text-sm mt-1 max-w-3xl">{t('intro')}</div>
              </div>
            </div>
          </div>
        </Card>

        {/* Two-column grid: left = info & warning, right = form */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

          {/* LEFT — info panel */}
          <div className="lg:col-span-5 space-y-4">
            <Card className="border-0 shadow-soft overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-500" />
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 grid place-items-center shrink-0">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold tracking-tight text-amber-900 dark:text-amber-300">{t('warningTitle')}</div>
                    <div className="text-[12px] text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">{t('warningBody')}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-slate-400 to-slate-600" />
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3 text-slate-500 dark:text-slate-400">
                  <ListChecks className="h-3.5 w-3.5" />
                  <span className="text-[10px] uppercase tracking-[0.15em] font-bold">{t('whatDeleted')}</span>
                </div>
                <ul className="space-y-2 text-[12px] text-slate-700 dark:text-slate-300">
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                    <span>{t('item1')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                    <span>{t('item2')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                    <span dangerouslySetInnerHTML={{ __html: t.raw('item3Keep') as string }} />
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-soft overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-indigo-400 to-blue-500" />
              <CardContent className="p-5 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-200 dark:ring-indigo-900 grid place-items-center shrink-0">
                  <Info className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div
                  className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: t.raw('safetyTip') as string }}
                />
              </CardContent>
            </Card>
          </div>

          {/* RIGHT — form */}
          <div className="lg:col-span-7">
            <Card className="border-0 shadow-soft overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-rose-500 to-red-600" />
              <CardContent className="p-6 space-y-5">
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                    {t('accountLabel')} <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    value={accountNo}
                    onChange={(e) => setAccountNo(e.target.value.replace(/\D/g, '').slice(0, 20))}
                    placeholder="20208000…"
                    maxLength={20}
                    disabled={!isSuperAdmin}
                    className="font-mono h-12 text-base tracking-wider"
                  />
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">{t('accountCount', { n: accountNo.length })}</div>
                    <div className="h-1 w-32 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          accountNo.length === 20 ? 'bg-emerald-500' : 'bg-rose-400',
                        )}
                        style={{ width: `${(accountNo.length / 20) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                    {t('confirmLabel')} <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 20))}
                    placeholder={t('confirmPlaceholder')}
                    maxLength={20}
                    disabled={!isSuperAdmin || accountNo.trim().length < 20}
                    className={cn(
                      'font-mono h-12 text-base tracking-wider',
                      confirm && confirm !== accountNo && 'ring-2 ring-rose-300',
                      confirm && confirm === accountNo && 'ring-2 ring-emerald-300',
                    )}
                  />
                  {confirm && confirm !== accountNo && (
                    <div className="text-[10px] text-rose-600 dark:text-rose-400">{t('confirmMismatch')}</div>
                  )}
                </div>

                <Button
                  onClick={() => countMut.mutate()}
                  disabled={!isSuperAdmin || !canSubmit || mut.isPending || countMut.isPending}
                  className="w-full h-12 rounded-xl font-semibold gap-2 bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-500/20 disabled:shadow-none"
                >
                  {countMut.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t('loadingCount')}</>
                  ) : mut.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t('submitting')}</>
                  ) : (
                    <><Trash2 className="h-4 w-4" /> {t('submit')}</>
                  )}
                </Button>

                {lastResult && lastResult.ok && (
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 px-5 py-4">
                    <div className="flex items-center gap-2 text-[12px] font-bold text-emerald-900 dark:text-emerald-300 uppercase tracking-wider">
                      <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      {t('resultTitle')}
                    </div>
                    <div className="text-[12px] text-emerald-800 dark:text-emerald-300 mt-2 space-y-1">
                      <div>• {t('resultAccount')}: <span className="font-mono">{lastResult.account?.accountNo}</span> — {lastResult.account?.ownerName || '—'}</div>
                      <div>• {t('resultDeleted')}: <b className="text-base">{lastResult.deleted}</b></div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* ─── Modern confirmation dialog ─── */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!mut.isPending) setConfirmOpen(o); }}>
        <DialogContent className="max-w-lg p-0 overflow-hidden gap-0 [&>button]:hidden">
          {/* Header */}
          <div className="relative bg-gradient-to-br from-rose-500 via-red-500 to-rose-700 px-6 py-5 text-white overflow-hidden">
            <div className="absolute inset-0 bg-dots opacity-15 pointer-events-none" />
            <div className="absolute -top-12 -right-8 w-44 h-44 rounded-full bg-white/10 blur-3xl pointer-events-none" />
            <div className="relative flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/15 ring-2 ring-white/30 backdrop-blur-md grid place-items-center shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogHeader>
                  <DialogTitle className="text-xl font-black tracking-tight text-white">{t('confirmTitle')}</DialogTitle>
                  <DialogDescription className="text-white/85 text-[12px] mt-1">{t('confirmDesc')}</DialogDescription>
                </DialogHeader>
              </div>
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={mut.isPending}
                className="text-white/70 hover:text-white shrink-0 p-1 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4 bg-white dark:bg-slate-900">
            {/* Account card */}
            {countInfo?.account && (
              <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 px-4 py-3 bg-slate-50/60 dark:bg-slate-900/60 space-y-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 dark:text-slate-400">
                  <Building2 className="h-3 w-3" />
                  {countInfo.account.bank?.name || '—'}
                  {countInfo.account.branch && (
                    <span className="ml-auto font-mono text-[10px] text-slate-400 dark:text-slate-500">MFO {countInfo.account.branch}</span>
                  )}
                </div>
                <div className="font-mono text-sm font-bold tracking-wider text-slate-900 dark:text-slate-100">{countInfo.account.accountNo}</div>
                {countInfo.account.ownerName && (
                  <div className="flex items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-300">
                    <User className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                    {countInfo.account.ownerName}
                  </div>
                )}
                {countInfo.account.balance != null && (
                  <div className="flex items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-300 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <Wallet className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                    <span className="font-semibold tabular-nums">
                      {formatMoney(Number(countInfo.account.balance), countInfo.account.currency || 'UZS')}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <StatBox
                icon={<Database className="h-4 w-4" />}
                gradient="from-rose-500 to-red-600"
                label={t('txnCount')}
                value={String(countInfo?.count ?? 0)}
                emphasize
              />
              <StatBox
                icon={<Receipt className="h-4 w-4" />}
                gradient="from-violet-500 to-purple-600"
                label={t('linkedPayments')}
                value={String(countInfo?.paymentsCount ?? 0)}
              />
              <StatBox
                icon={<Calendar className="h-4 w-4" />}
                gradient="from-slate-500 to-slate-700"
                label={t('firstTxn')}
                value={countInfo?.firstTxnDate ? formatDate(countInfo.firstTxnDate) : '—'}
                small
              />
              <StatBox
                icon={<Calendar className="h-4 w-4" />}
                gradient="from-slate-500 to-slate-700"
                label={t('lastTxn')}
                value={countInfo?.lastTxnDate ? formatDate(countInfo.lastTxnDate) : '—'}
                small
              />
            </div>

            {/* Empty hint or warning */}
            {countInfo && (countInfo.count ?? 0) === 0 ? (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-4 py-3 flex items-start gap-2.5">
                <Info className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
                <div className="text-[12px] text-slate-600 dark:text-slate-300">{t('nothingToDelete')}</div>
              </div>
            ) : (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 px-4 py-3 flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-[12px] text-amber-900 dark:text-amber-300 leading-relaxed">
                  <b>{t('warningTitle')}</b> {t('warningBody')}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={mut.isPending}
                className="flex-1 h-11 rounded-xl"
              >
                {tc('cancel')}
              </Button>
              <Button
                onClick={() => mut.mutate()}
                disabled={mut.isPending || !countInfo?.ok || (countInfo?.count ?? 0) === 0}
                className="flex-1 h-11 rounded-xl font-semibold gap-2 bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-500/20"
              >
                {mut.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {t('deleting')}</>
                ) : (
                  <><Trash2 className="h-4 w-4" /> {t('confirmDelete')}</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatBox({
  icon, gradient, label, value, emphasize, small,
}: {
  icon: React.ReactNode;
  gradient: string;
  label: string;
  value: string;
  emphasize?: boolean;
  small?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-xl ring-1 px-3 py-2.5 transition-colors',
      emphasize ? 'bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900' : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700',
    )}>
      <div className="flex items-center gap-2 mb-1">
        <div className={cn('w-6 h-6 rounded-lg bg-gradient-to-br grid place-items-center text-white shrink-0', gradient)}>
          {icon}
        </div>
        <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500 dark:text-slate-400 truncate">{label}</div>
      </div>
      <div className={cn(
        'font-black tabular-nums tracking-tight truncate',
        small ? 'text-sm' : 'text-2xl',
        emphasize ? 'text-rose-700 dark:text-rose-300' : 'text-slate-800 dark:text-slate-200',
      )}>
        {value}
      </div>
    </div>
  );
}
