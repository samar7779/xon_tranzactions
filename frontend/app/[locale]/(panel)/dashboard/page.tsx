'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowUpRight, Wallet, Building2,
  Receipt, RefreshCw, TrendingUp, ArrowRight, ChevronRight,
  Sparkles, Activity,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import { OnboardingCard } from '@/components/onboarding-card';
import { QuickActions } from '@/components/quick-actions';
import { Sparkline } from '@/components/sparkline';
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
  const { data: stats } = useQuery({
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
  const inSum = (stats?.groups || []).filter((g: any) => g.direction === 'IN').reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const outSum = (stats?.groups || []).filter((g: any) => g.direction === 'OUT').reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const netFlow = inSum - outSum;

  // Bo'sh tizimda onboarding ko'rsatamiz
  const isEmpty = totalAccounts === 0 && (recent?.items?.length || 0) === 0;

  // Banks/credentials count for onboarding
  const banksCount = new Set((accounts?.items || []).map((a: any) => a.bankId)).size;
  const credentialsCount = new Set((accounts?.items || []).map((a: any) => a.credentialId)).size;

  // Mock sparkline data (real data kelganda almashtiriladi)
  const sparkIn = [3, 5, 4, 7, 6, 8, 7, 9, 8, 11, 9, 12];
  const sparkOut = [5, 4, 6, 5, 7, 5, 8, 6, 9, 7, 10, 8];
  const sparkNet = sparkIn.map((v, i) => v - sparkOut[i]);

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

  const COLORS = [
    'from-indigo-500 to-blue-600',
    'from-emerald-500 to-teal-600',
    'from-purple-500 to-fuchsia-600',
    'from-amber-500 to-orange-600',
    'from-pink-500 to-rose-600',
    'from-cyan-500 to-sky-600',
  ];

  return (
    <>
      <Topbar title={t('title')} subtitle="Treasury — barcha hisoblar bo'yicha umumiy ko'rinish" />
      <div className="flex-1 p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto w-full">

        {/* ─── ANIMATED GRADIENT HERO ─── */}
        <div className="relative rounded-3xl overflow-hidden shadow-pop animate-fade-up">
          <div className="absolute inset-0 bg-brand-vivid animate-gradient" />
          <div className="absolute inset-0 bg-dots opacity-25" />
          <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/20 blur-3xl pointer-events-none animate-float-slow" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-cyan-300/25 blur-3xl pointer-events-none animate-float-slow" style={{ animationDelay: '4s' }} />

          <div className="relative px-8 lg:px-12 py-10 lg:py-14 text-white">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/20 text-[11px] font-medium mb-4">
              <Sparkles className="h-3 w-3" /> Treasury Overview
            </span>

            <div className="text-[11px] uppercase tracking-[0.2em] text-white/70 mb-2">Jami qoldiq</div>
            {accLoading ? (
              <Skeleton className="h-16 w-80 bg-white/15" />
            ) : (
              <div className="flex items-baseline gap-3 flex-wrap">
                <div className="text-5xl lg:text-7xl font-bold tracking-tight tabular-nums leading-none">
                  {formatMoney(totalBalance).replace(/UZS$/, '').trim()}
                </div>
                <div className="text-2xl text-white/70 font-medium">UZS</div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <HeroChip icon={Wallet} label={`${totalAccounts} ta hisob`} />
              <HeroChip icon={Building2} label={`${byBank.length} ta bank`} />
              <HeroChip icon={Activity} label="Real-time sync" pulse />
            </div>
          </div>
        </div>

        {/* ─── GRADIENT KPI CARDS bilan SPARKLINES ─── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <GradientKpi
            label="Kirim · 30 kun"
            value={formatMoney(inSum)}
            icon={ArrowDownLeft}
            gradient="bg-brand-success"
            shadow="shadow-glow-green"
            spark={sparkIn}
          />
          <GradientKpi
            label="Chiqim · 30 kun"
            value={formatMoney(outSum)}
            icon={ArrowUpRight}
            gradient="bg-brand-rose"
            shadow="shadow-glow-rose"
            spark={sparkOut}
          />
          <GradientKpi
            label="Sof oqim"
            value={(netFlow >= 0 ? '+' : '') + formatMoney(netFlow)}
            icon={TrendingUp}
            gradient={netFlow >= 0 ? 'bg-brand-vivid' : 'bg-brand-rose'}
            shadow={netFlow >= 0 ? 'shadow-glow' : 'shadow-glow-rose'}
            spark={sparkNet}
          />
        </div>

        {/* ─── Onboarding (faqat bo'sh tizimda) yoki Quick Actions ─── */}
        {isEmpty
          ? <OnboardingCard banksCount={banksCount} credentialsCount={credentialsCount} accountsCount={totalAccounts} />
          : <QuickActions accountsCount={totalAccounts} />
        }

        {/* ─── Banklar + Top hisoblar ─── */}
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2 card-hover overflow-hidden border-0 shadow-soft">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="text-base font-semibold tracking-tight">Banklar</div>
                  <div className="text-xs text-slate-500 mt-0.5">Qoldiq taqsimoti</div>
                </div>
                <Link href={`/${locale}/banks`} className="text-[11px] text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-0.5 font-medium">
                  Hammasi <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="space-y-4">
                {byBank.length === 0 ? (
                  <div className="text-sm text-slate-400 text-center py-8">Hisoblar yo'q</div>
                ) : byBank.slice(0, 6).map((b, i) => {
                  const pct = totalBalance > 0 ? (b.balance / totalBalance) * 100 : 0;
                  return (
                    <div key={b.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cn("w-2 h-2 rounded-full bg-gradient-to-br", COLORS[i % COLORS.length])} />
                          <span className="text-sm font-medium text-slate-700 truncate">{b.name}</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums">{formatMoney(b.balance)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", COLORS[i % COLORS.length])}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-400 tabular-nums w-9 text-right">{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3 card-hover overflow-hidden border-0 shadow-soft">
            <CardContent className="p-0">
              <div className="flex items-center justify-between p-6 pb-4">
                <div>
                  <div className="text-base font-semibold tracking-tight">Top hisoblar</div>
                  <div className="text-xs text-slate-500 mt-0.5">Qoldiq bo'yicha</div>
                </div>
                <Link href={`/${locale}/accounts`} className="text-[11px] text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-0.5 font-medium">
                  {totalAccounts} ta <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              {accLoading ? (
                <div className="px-6 pb-6 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
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
                        <div className={cn("w-10 h-10 rounded-xl bg-gradient-to-br grid place-items-center shrink-0 shadow-sm text-white", COLORS[i % COLORS.length])}>
                          <Building2 className="h-[18px] w-[18px]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold truncate">{a.bank?.name || '—'}</div>
                          <div className="font-mono text-[11px] text-slate-500 truncate">{a.accountNo}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold tabular-nums tracking-tight">{formatMoney(Number(a.balance || 0), a.currency)}</div>
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
        <Card className="border-0 shadow-soft card-hover">
          <CardContent className="p-0">
            <div className="flex items-center justify-between p-6 pb-4">
              <div>
                <div className="text-base font-semibold tracking-tight">{t('recentTransactions')}</div>
                <div className="text-xs text-slate-500 mt-0.5">Barcha hisoblar bo'yicha</div>
              </div>
              <Link href={`/${locale}/transactions`}>
                <Button variant="outline" size="sm" className="gap-1.5 h-9 rounded-full px-4 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700">
                  Hammasi <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
            {recentLoading ? (
              <div className="px-6 pb-6 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : (recent?.items || []).length === 0 ? (
              <EmptyState icon={Receipt} title={tx('noData')} description="Hisob qo'shilgandan keyin tranzaksiyalar avtomatik yuklanadi" />
            ) : (
              <div>
                {recent!.items.map((it: any, i: number, arr: any[]) => {
                  const counterparty = it.direction === 'IN'
                    ? (it.fromName || it.fromAccount || '—')
                    : (it.toName || it.toAccount || '—');
                  return (
                    <div key={it.id} className={cn(
                      "flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50/80 transition-colors",
                      i < arr.length - 1 && "border-b border-slate-100",
                    )}>
                      <div className={cn(
                        "w-11 h-11 rounded-full grid place-items-center shrink-0 shadow-sm",
                        it.direction === 'IN'
                          ? "bg-gradient-to-br from-emerald-400 to-teal-500 text-white"
                          : "bg-gradient-to-br from-rose-400 to-red-500 text-white",
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
                        "text-right shrink-0 font-bold tabular-nums tracking-tight text-base",
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

function HeroChip({ icon: Icon, label, pulse }: { icon: any; label: string; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/25 text-white/95 font-medium text-[12px]">
      <span className="relative">
        <Icon className="h-3.5 w-3.5" />
        {pulse && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />}
      </span>
      {label}
    </span>
  );
}

function GradientKpi({
  label, value, icon: Icon, gradient, shadow, spark,
}: { label: string; value: string; icon: any; gradient: string; shadow: string; spark?: number[] }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl text-white p-6 group cursor-default card-hover", gradient, shadow)}>
      <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/15 blur-2xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-32 h-32 rounded-full bg-black/10 blur-2xl pointer-events-none" />

      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold text-white/85">{label}</div>
          <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm ring-1 ring-white/30 grid place-items-center group-hover:scale-110 transition-transform">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-3xl font-bold tracking-tight tabular-nums">{value}</div>
        {spark && (
          <div className="mt-3 -mb-2 -mx-2 text-white/85">
            <Sparkline data={spark} width={240} height={42} stroke="white" fill="white" />
          </div>
        )}
      </div>
    </div>
  );
}
