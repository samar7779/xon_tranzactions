'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2, AlertTriangle, Loader2, Database, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

export default function CleanupPage() {
  const t = useTranslations('cleanup');
  const tc = useTranslations('common');
  const me = useAuth((s) => s.user);
  const isSuperAdmin = me?.role === 'SUPERADMIN';

  const [accountNo, setAccountNo] = useState('');
  const [confirm, setConfirm] = useState('');
  const [lastResult, setLastResult] = useState<any>(null);

  const mut = useMutation({
    mutationFn: () =>
      api.post<any>('/transactions/cleanup-by-account', { accountNo: accountNo.trim(), confirm: confirm.trim() }),
    onSuccess: (r: any) => {
      setLastResult(r);
      if (r?.ok) {
        toast.success(t('successCount', { n: r.deleted }));
        setAccountNo('');
        setConfirm('');
      } else {
        toast.error(r?.error || tc('error'));
      }
    },
    onError: (e: any) => toast.error(e?.message || tc('error')),
  });

  const canSubmit = accountNo.trim().length >= 20 && confirm.trim() === accountNo.trim();

  return (
    <div className="flex-1 p-6 lg:p-8 w-full">
      <div className="max-w-2xl mx-auto space-y-5">
        {!isSuperAdmin && (
          <Card className="border-0 shadow-soft overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-rose-500 to-red-600" />
            <CardContent className="p-6 flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-base font-bold tracking-tight">{t('deniedTitle')}</div>
                <div
                  className="text-xs text-slate-500 mt-1"
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

        <Card className="border-0 shadow-soft overflow-hidden">
          <div className="bg-gradient-to-br from-rose-500 to-red-600 px-6 py-5 text-white">
            <div className="flex items-center gap-2 mb-1.5 text-white/80">
              <Trash2 className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-[0.15em] font-bold">{t('sectionLabel')}</span>
            </div>
            <div className="text-lg font-bold tracking-tight">{t('title')}</div>
            <div className="text-white/80 text-xs mt-0.5">{t('intro')}</div>
          </div>

          <CardContent className="p-6 space-y-4">
            {/* Ogohlantirish */}
            <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[12px] text-amber-900 leading-relaxed">
                <b>{t('warningTitle')}</b> {t('warningBody')}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                {t('accountLabel')} <span className="text-rose-500">*</span>
              </Label>
              <Input
                value={accountNo}
                onChange={(e) => setAccountNo(e.target.value.replace(/\D/g, '').slice(0, 20))}
                placeholder="20208000…"
                maxLength={20}
                disabled={!isSuperAdmin}
                className="font-mono"
              />
              <div className="text-[10px] text-slate-500">{t('accountCount', { n: accountNo.length })}</div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                {t('confirmLabel')} <span className="text-rose-500">*</span>
              </Label>
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 20))}
                placeholder={t('confirmPlaceholder')}
                maxLength={20}
                disabled={!isSuperAdmin || accountNo.trim().length < 20}
                className={cn(
                  'font-mono',
                  confirm && confirm !== accountNo && 'ring-2 ring-rose-300',
                  confirm && confirm === accountNo && 'ring-2 ring-emerald-300',
                )}
              />
              {confirm && confirm !== accountNo && (
                <div className="text-[10px] text-rose-600">{t('confirmMismatch')}</div>
              )}
            </div>

            <Button
              onClick={() => {
                if (!window.confirm(t('confirmDialog', { accountNo }))) return;
                mut.mutate();
              }}
              disabled={!isSuperAdmin || !canSubmit || mut.isPending}
              className="w-full h-11 rounded-xl font-semibold gap-2 bg-rose-600 hover:bg-rose-700 text-white"
            >
              {mut.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {t('submitting')}</>
              ) : (
                <><Trash2 className="h-4 w-4" /> {t('submit')}</>
              )}
            </Button>

            {lastResult && lastResult.ok && (
              <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-900">
                  <Database className="h-4 w-4 text-emerald-600" />
                  {t('resultTitle')}
                </div>
                <div className="text-[11px] text-emerald-800 mt-1.5 space-y-0.5">
                  <div>• {t('resultAccount')}: <span className="font-mono">{lastResult.account?.accountNo}</span> — {lastResult.account?.ownerName || '—'}</div>
                  <div>• {t('resultDeleted')}: <b>{lastResult.deleted}</b></div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
