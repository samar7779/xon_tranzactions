'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowUpRight, Wallet, Building2,
  Receipt, RefreshCw, TrendingUp, ArrowRight, ChevronRight,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import { api } from '@/lib/api';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tx = useTranslations('transactions');
  const { locale } = useParams<{ locale: string }>();

  const { data: accounts, isLoading: accLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<{ items: any[] }>('/bank-accounts'),
  });
  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats-30d'],
    queryFn: () => {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      return api.get<any>(`/transactions/stats?from=${from.toISOString().slice(0, 10)}`);
    },
  });
  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ['recent'],
    queryFn: () => api.get<{ items: any[]; total: number }>('/transactions?perPage=6'),
  });

  const totalBalance = (accounts?.items || []).reduce((s, a) => s + Number(a.balance || 0), 0);
  const totalAccounts = accounts?.items?.length || 0;

  const inSum = (stats?.groups || [])
    .filter((g: any) => g.direction === 'IN')
    .reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const outSum = (stats?.groups || [])
    .filter((g: any) => g.direction === 'OUT')
    .reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const netFlow = inSum - outSum;

  const byBank = (() => {
    const map = new Map<string, { name: string; code: string; accounts: number; balance: number }>();
    for (const a of accounts?.items || []) {
      const id = a.bank?.id || 'unknown';
      const ex = map.get(id) || { name: a.bank?.name || '—', code: a.bank?.code || '', accounts: 0, balance: 0 };
      ex.accounts += 1;
      ex.balance += Number(a.balance || 0);
      map.set(id, ex);
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.balance - a.balance);
  })();

  return (
    <>
      <Topbar title={t('title')} subtitle="Treasury — barcha hisoblar bo'yicha umumiy ko'rinish" />
      <div className="flex-1 p-6 lg:p-10 space-y-8 max-w-[1400px] mx-auto w-full">

        {/* ─── HERO BANNER ─── */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-blue-900 text-white shadow-pop">
          {/* Decorative blobs */}
          <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-blue-400/20 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-fuchsia-500/15 blur-3xl pointer-events-none" />
          <div className="absolute inset-0 bg-grid bg-grid-fade opacity-[0.04]" />

          <div className="relative p-8 lg:p-10">
            <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
              {/* Big balance number */}
              <div className="lg:col-span-2">
                <div className="text-[11px] uppercase tracking-widest text-indigo-200/80 mb-3">Jami qoldiq</div>
                {accLoading ? (
                  <Skeleton className="h-14 w-72 bg-white/10" />
                ) : (
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <div className="text-5xl lg:text-6xl font-semibold tracking-tight tabular-nums leading-none">
                      {formatMoney(totalBalance).replace(/UZS$/, '').trim()}
                    </div>
                    <div className="text-xl text-indigo-200/80 font-medium">UZS</div>
                  </div>
                )}
                <div className="mt-4 flex items-center gap-3 text-sm text-indigo-100/90">
                  <span className="inline-flex items-center gap-1.5">
                    <Wallet className="h-4 w-4" /> {totalAccounts} hisob
                  </span>
                  <span className="text-indigo-200/40">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="h-4 w-4" /> {byBank.length} bank
                  </span>
                </div>
              </div>

              {/* Flow stats inline */}
              <div className="grid grid-cols-3 lg:grid-cols-1 gap-4 self-end">
                <FlowStat icon={ArrowDownLeft} label="Kirim · 30 kun" value={formatMoney(inSum)} tone="success" />
                <FlowStat icon={ArrowUpRight} label="Chiqim · 30 kun" value={formatMoney(outSum)} tone="warm" />
                <FlowStat icon={TrendingUp} label="Sof oqim" value={(netFlow >= 0 ? '+' : '') + formatMoney(netFlow)} tone={netFlow >= 0 ? 'success' : 'warm'} />
              </div>
            </div>
          </div>
        </div>

        {/* ─── Banks distribution + Accounts top ─── */}
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2 border-slate-200/80 card-hover">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="text-base font-semibold tracking-tight">Banklar bo'yicha</div>
                  <div className="text-xs text-slate-500 mt-0.5">Qoldiq taqsimoti</div>
                </div>
                <Link href={`/${locale}/banks`} className="text-[11px] text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-0.5">
                  Hammasi <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="space-y-3.5">
                {byBank.length === 0 ? (
                  <div className="text-sm text-slate-400 text-center py-8">Hisoblar yo'q</div>
                ) : byBank.slice(0, 6).map((b) => {
                  const pct = totalBalance > 0 ? (b.balance / totalBalance) * 100 : 0;
                  return (
                    <div key={b.id} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700 truncate">{b.name}</span>
                        <span className="text-xs font-medium tabular-nums">{formatMoney(b.balance)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-600 transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-400 tabular-nums w-10 text-right">{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Top accounts */}
          <Card className="lg:col-span-3 border-slate-200/80 card-hover overflow-hidden">
            <CardContent className="p-0">
              <div className="flex items-center justify-between p-6 pb-4">
                <div>
                  <div className="text-base font-semibold tracking-tight">Eng katta hisoblar</div>
                  <div className="text-xs text-slate-500 mt-0.5">Qoldiq bo'yicha tartiblangan</div>
                </div>
                <Link href={`/${locale}/accounts`} className="text-[11px] text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-0.5">
                  {totalAccounts} ta <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              {accLoading ? (
                <div className="px-6 space-y-2 pb-6">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
                </div>
              ) : (accounts?.items || []).length === 0 ? (
                <EmptyState icon={Wallet} title="Hali hisob qo'shilmagan" description="Sozlash → Bank ulanishi → Hisob qo'shing" />
              ) : (
                <div>
                  {(accounts!.items as any[])
                    .slice()
                    .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
                    .slice(0, 5)
                    .map((a, i, arr) => (
                      <div key={a.id} className={cn(
                        "flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50/80 transition-colors",
                        i < arr.length - 1 && "border-b border-slate-100",
                      )}>
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-50 to-blue-50 text-indigo-600 grid place-items-center shrink-0 ring-1 ring-indigo-100">
                          <Building2 className="h-[18px] w-[18px]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold truncate">{a.bank?.name || '—'}</div>
                          <div className="font-mono text-[11px] text-slate-500 truncate">{a.accountNo}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-semibold tabular-nums tracking-tight">{formatMoney(Number(a.balance || 0), a.currency)}</div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1 justify-end">
                            {a.lastSyncedAt ? <><RefreshCw className="h-2.5 w-2.5" /> {formatDateTime(a.lastSyncedAt)}</> : 'Sync yo\'q'}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ─── Recent transactions ─── */}
        <Card className="border-slate-200/80 card-hover">
          <CardContent className="p-0">
            <div className="flex items-center justify-between p-6 pb-4">
              <div>
                <div className="text-base font-semibold tracking-tight">{t('recentTransactions')}</div>
                <div className="text-xs text-slate-500 mt-0.5">Barcha hisoblar bo'yicha</div>
              </div>
              <Link href={`/${locale}/transactions`}>
                <Button variant="outline" size="sm" className="gap-1.5 h-8">
                  Hammasini ko'rish <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
            {recentLoading ? (
              <div className="px-6 pb-6 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : (recent?.items || []).length === 0 ? (
              <EmptyState icon={Receipt} title={tx('noData')} description="Hisob qo'shilgandan keyin tranzaksiyalar avtomatik yuklanadi" />
            ) : (
              <div>
                {recent!.items.map((it: any, i: number, arr: any[]) => {
                  const counterparty = it.direction === 'IN'
                    ? (it.fromName || it.fromAccount || '—')
                    : (it.toName || it.toAccount || '—');
                  return (
                    <div
                      key={it.id}
                      className={cn(
                        "flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50/80 transition-colors",
                        i < arr.length - 1 && "border-b border-slate-100",
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-full grid place-items-center shrink-0",
                        it.direction === 'IN'
                          ? "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"
                          : "bg-rose-50 text-rose-600 ring-1 ring-rose-100",
                      )}>
                        {it.direction === 'IN' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold truncate">{counterparty}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                          <span>{formatDateTime(it.txnDate)}</span>
                          {it.fromInn && <><span className="text-slate-300">·</span> <span className="font-mono">{it.fromInn}</span></>}
                        </div>
                      </div>
                      <div className={cn(
                        "text-right shrink-0 font-semibold tabular-nums tracking-tight",
                        it.direction === 'IN' ? 'text-emerald-600' : 'text-rose-600',
                      )}>
                        {it.direction === 'IN' ? '+' : '−'}{formatMoney(it.amount, it.currency)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function FlowStat({
  icon: Icon, label, value, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: 'success' | 'warm';
}) {
  const toneClasses = {
    success: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20',
    warm: 'bg-rose-400/10 text-rose-300 ring-rose-400/20',
  };
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={cn('p-1.5 rounded-md ring-1', toneClasses[tone])}>
          <Icon className="h-3 w-3" />
        </span>
        <span className="text-[11px] text-indigo-100/70">{label}</span>
      </div>
      <div className="text-[15px] font-semibold tabular-nums tracking-tight text-white">{value}</div>
    </div>
  );
}
