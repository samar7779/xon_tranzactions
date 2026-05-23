'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  KeyRound, AlertCircle, RefreshCw, CheckCircle2, Eye, EyeOff, Loader2, Lock,
  Hash, Shield,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';
import { BankLogo } from '@/components/bank-logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

interface AuthIssueAccount {
  accountId: string;
  accountNo: string;
  branch: string;
  ownerName: string | null;
  errorMessage: string;
  lastFailedAt: string;
}

interface AuthIssue {
  credentialId: string;
  bankId: string;
  bankCode: string;
  bankName: string;
  label: string | null;
  loginPrefix: string | null;
  loginName: string;
  authMode: string;
  useProxy: boolean;
  credLastError: string | null;
  credLastVerifiedAt: string | null;
  accounts: AuthIssueAccount[];
  latestErrorAt: string;
  totalFailingAccounts: number;
}

export default function AdminLoginIssuesPage() {
  const qc = useQueryClient();
  const t = useTranslations('adminLogin');
  const tc = useTranslations('common');

  const [updateModal, setUpdateModal] = useState<AuthIssue | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-login-issues'],
    queryFn: () => api.get<{ ok: boolean; items: AuthIssue[] }>('/bank-credentials/auth-issues'),
    refetchInterval: 30_000,
  });

  const items = data?.items || [];

  return (
    <div className="flex-1 p-3 sm:p-6 lg:p-8 space-y-5 w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white shadow-md shadow-amber-500/30">
            <KeyRound className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] sm:text-[18px] font-bold text-slate-900 truncate">{t('title')}</h2>
            <p className="text-[11px] sm:text-[12px] text-slate-500 truncate">{t('subtitle')}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          {tc('refresh')}
        </Button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="grid place-items-center py-20 text-slate-400 text-[12px]">
          <Loader2 className="h-6 w-6 animate-spin mb-2" />
          {tc('loading')}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-emerald-200 rounded-xl p-10 text-center shadow-sm">
          <div className="w-14 h-14 rounded-full bg-emerald-50 grid place-items-center mx-auto mb-3">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" />
          </div>
          <div className="text-[15px] font-bold text-slate-900">{t('allGoodTitle')}</div>
          <div className="text-[12px] text-slate-500 mt-1.5 max-w-md mx-auto">{t('allGoodBody')}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Summary banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-[12px] text-amber-900 leading-relaxed">
              <span className="font-semibold">{t('summaryTitle', { count: items.length })}</span>
              <span className="mx-1.5 text-amber-700">·</span>
              <span>{t('summaryHint')}</span>
            </div>
          </div>

          {/* Cards */}
          {items.map((issue) => (
            <IssueCard
              key={issue.credentialId}
              issue={issue}
              onUpdate={() => setUpdateModal(issue)}
            />
          ))}
        </div>
      )}

      {/* Update password modal */}
      {updateModal && (
        <UpdatePasswordDialog
          issue={updateModal}
          onClose={() => setUpdateModal(null)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['admin-login-issues'] });
            setUpdateModal(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Issue Card
// ─────────────────────────────────────────────────────────────────
function IssueCard({ issue, onUpdate }: { issue: AuthIssue; onUpdate: () => void }) {
  const t = useTranslations('adminLogin');
  const tc = useTranslations('common');
  const fullLogin = (issue.loginPrefix || '') + issue.loginName;

  return (
    <div className="bg-white border border-rose-200 rounded-xl overflow-hidden shadow-sm">
      {/* Top stripe — red accent */}
      <div className="h-1 bg-gradient-to-r from-rose-500 via-amber-500 to-rose-500" />

      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3 sm:gap-4 flex-wrap sm:flex-nowrap">
          {/* Bank logosi */}
          <BankLogo code={issue.bankCode} name={issue.bankName} size={44} />


          {/* Main info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="text-[14px] font-bold text-slate-900">{issue.bankName}</h3>
              {issue.label && (
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                  {issue.label}
                </span>
              )}
              <span className="text-[10px] uppercase tracking-wider font-semibold text-rose-700 bg-rose-50 ring-1 ring-rose-200 px-1.5 py-0.5 rounded">
                {t('authError')}
              </span>
            </div>

            {/* Login + accounts count */}
            <div className="flex items-center gap-3 flex-wrap text-[11.5px] text-slate-600">
              <span className="flex items-center gap-1">
                <Lock className="h-3 w-3 text-slate-400" />
                <span className="font-mono">{fullLogin}</span>
              </span>
              <span className="flex items-center gap-1">
                <Hash className="h-3 w-3 text-slate-400" />
                {t('failingAccounts', { count: issue.totalFailingAccounts })}
              </span>
              <span className="flex items-center gap-1">
                <Shield className="h-3 w-3 text-slate-400" />
                {issue.authMode}
              </span>
            </div>

            {/* Latest error time */}
            <div className="mt-1 text-[10.5px] text-slate-500">
              {t('latestError')}: <span className="tabular-nums font-medium text-rose-700">{formatDateTime(issue.latestErrorAt)}</span>
            </div>
          </div>

          {/* Action */}
          <Button
            onClick={onUpdate}
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 shrink-0 w-full sm:w-auto"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {t('updatePasswordBtn')}
          </Button>
        </div>

        {/* Failing accounts list */}
        <div className="mt-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
            {t('failingAccountsLabel')}
          </div>
          {issue.accounts.slice(0, 5).map((acc) => (
            <div key={acc.accountId} className="bg-slate-50 rounded-lg px-3 py-2 text-[11.5px]">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-mono font-semibold text-slate-800">
                  {acc.accountNo}
                  {acc.ownerName && <span className="text-slate-500 font-normal ml-1.5">· {acc.ownerName}</span>}
                </div>
                <div className="text-[10px] text-slate-500 tabular-nums">{formatDateTime(acc.lastFailedAt)}</div>
              </div>
              {acc.errorMessage && (
                <div className="text-[10.5px] text-rose-700 mt-1 leading-relaxed line-clamp-2">
                  {acc.errorMessage}
                </div>
              )}
            </div>
          ))}
          {issue.accounts.length > 5 && (
            <div className="text-[10.5px] text-slate-500 px-3 italic">
              {t('andMore', { count: issue.accounts.length - 5 })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Update password modal
// ─────────────────────────────────────────────────────────────────
function UpdatePasswordDialog({
  issue, onClose, onSuccess,
}: {
  issue: AuthIssue;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useTranslations('adminLogin');
  const tc = useTranslations('common');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const mut = useMutation({
    mutationFn: async () => {
      // 1) Parolni yangilash
      await api.patch(`/bank-credentials/${issue.credentialId}`, { password });
      // 2) Yangi parol bilan testConnection chaqirish (xato pattern'i yo'qolishi uchun)
      try {
        await api.post(`/bank-credentials/${issue.credentialId}/test`);
      } catch (e) {
        // Test xato bersa ham parol saqlangan — userga foydali xabar beramiz
        throw new Error(t('testFailedAfterSave'));
      }
    },
    onSuccess: () => {
      toast.success(t('updateSuccess'));
      onSuccess();
    },
    onError: (e: any) => {
      toast.error(e?.message || tc('error'));
    },
  });

  const canSave = password.length >= 4 && password === confirmPassword && !mut.isPending;
  const fullLogin = (issue.loginPrefix || '') + issue.loginName;

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o && !mut.isPending) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white">
              <KeyRound className="h-3.5 w-3.5" />
            </div>
            {t('updatePasswordTitle')}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {t('updatePasswordDesc', { bank: issue.bankName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          {/* Bank info */}
          <div className="bg-slate-50 rounded-lg px-3 py-2 text-[11px] space-y-0.5">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">{t('bankLabel')}:</span>
              <span className="font-semibold text-slate-800">{issue.bankName}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">{t('loginLabel')}:</span>
              <span className="font-mono font-semibold text-slate-800">{fullLogin}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">{t('failingAccountsLabel')}:</span>
              <span className="font-semibold text-rose-700">{issue.totalFailingAccounts}</span>
            </div>
          </div>

          {/* New password */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
              {t('newPasswordLabel')}
            </label>
            <div className="relative">
              <Input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('newPasswordPlaceholder')}
                className="font-mono pr-9"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                tabIndex={-1}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Confirm password */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
              {t('confirmPasswordLabel')}
            </label>
            <Input
              type={showPwd ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('confirmPasswordPlaceholder')}
              className="font-mono"
            />
            {confirmPassword.length > 0 && confirmPassword !== password && (
              <div className="text-[10.5px] text-rose-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {t('passwordMismatch')}
              </div>
            )}
          </div>

          {/* Hint */}
          <div className="text-[10.5px] text-amber-700 bg-amber-50 px-2 py-1.5 rounded-md ring-1 ring-amber-200 flex items-start gap-1.5">
            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{t('updateHint')}</span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>{tc('cancel')}</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!canSave}
            className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {mut.isPending ? t('updating') : t('saveAndTestBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
