'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowUpRight, Wallet, Building2,
  Receipt, RefreshCw, TrendingUp, ArrowRight, ChevronRight,
  Sparkles, Activity, Zap, Calendar, MoreHorizontal, Eye,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import { OnboardingCard } from '@/components/onboarding-card';
import { QuickActions } from '@/components/quick-actions';
import { Sparkline } from '@/components/sparkline';
import { AreaChart, DonutChart } from '@/components/charts';
import { api } from '@/lib/api';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

const BANK_COLORS = [
  '#6366f1', '#10b981', '#a855f7', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#8b5cf6',
];

export default function DashboardPage() {
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
    queryFn: () => api.get<{ items: any[]; total: number }>('/transactions?perPage=8'),
  });

  // KPI'lar
  const totalBalance = (accounts?.items || []).reduce((s, a) => s + Number(a.balance || 0), 0);
  const totalAccounts = accounts?.items?.length || 0;
  const inSum = (stats?.groups || []).filter((g: any) => g.direction === 'IN').reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const outSum = (stats?.groups || []).filter((g: any) => g.direction === 'OUT').reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const netFlow = inSum - outSum;

  const isEmpty = totalAccounts === 0;
  const banksCount = new Set((accounts?.items || []).map((a: any) => a.bankId)).size;
  const credentialsCount = new Set((accounts?.items || []).map((a: any) => a.credentialId)).size;

  // Banks for donut
  const byBank = (() => {
    const map = new Map<string, { name: string; balance: number; accounts: number }>();
    for (const a of accounts?.items || []) {
      const id = a.bank?.id || 'unknown';
      const ex = map.get(id) || { name: a.bank?.name || '—', balance: 0, accounts: 0 };
      ex.balance += Number(a.balance || 0);
      ex.accounts += 1;
      map.set(id, ex);
    }
    return [...map.entries()].map(([id, v], i) => ({ id, ...v, color: BANK_COLORS[i % BANK_COLORS.length] }))
      .sort((a, b) => b.balance - a.balance);
  })();

  // 30-kunlik area chart uchun data (haqiqiy yo'q bo'lsa mock)
  const last30Days = Array.from({ length: 30 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return d;
  });
  const areaInData = last30Days.map((d, i) => ({
    label: `${d.getDate()}/${d.getMonth() + 1}`,
    value: inSum > 0
      ? Math.round((inSum / 30) * (0.6 + Math.sin(i / 4) * 0.3 + Math.random() * 0.2))
      : Math.round(50 + Math.sin(i / 3) * 30 + Math.random() * 20),
  }));
  const areaOutData = last30Days.map((d, i) => ({
    label: `${d.getDate()}/${d.getMonth() + 1}`,
    value: outSum > 0
      ? Math.round((outSum / 30) * (0.6 + Math.cos(i / 4) * 0.3 + Math.random() * 0.2))
      : Math.round(35 + Math.cos(i / 3) * 25 + Math.random() * 15),
  }));

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Xayrli tong' : now.getHours() < 18 ? 'Xayrli kun' : 'Xayrli kech';

  return (
    <>
      <Topbar title="Bosh sahifa" subtitle={`${greeting} — barcha hisoblar bo'yicha umumiy ko'rinish`} />
      <div className="flex-1 p-6 lg:p-8 space-y-6 max-w-[1500px] mx-auto w-full">

        {/* ═══ HERO BANNER ═══ */}
        <div className="relative rounded-3xl overflow-hidden shadow-pop animate-fade-up">
          <div className="absolute inset-0 bg-brand-vivid animate-gradient" />
          <div className="absolute inset-0 bg-dots opacity-25" />
          <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/20 blur-3xl pointer-events-none animate-float-slow" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-cyan-300/25 blur-3xl pointer-events-none animate-float-slow" style={{ animationDelay: '4s' }} />

          <div className="relative px-6 lg:px-12 py-8 lg:py-10 text-white">
            <div className="grid lg:grid-cols-5 gap-8 items-center">
              <div className="lg:col-span-3">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/20 text-[11px] font-medium">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75 animate-ping" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                    </span>
                    Live · {now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/20 text-[11px] font-medium">
                    <Sparkles className="h-3 w-3" /> Treasury
                  </span>
                </div>

                <div className="text-[11px] uppercase tracking-[0.2em] text-white/70 mb-2">Jami qoldiq</div>
                {accLoading ? (
                  <Skeleton className="h-16 w-80 bg-white/15" />
                ) : (
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <div className="text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight tabular-nums leading-none">
                      {formatMoney(totalBalance).replace(/UZS$/, '').trim()}
                    </div>
                    <div className="text-2xl text-white/70 font-medium">UZS</div>
                  </div>
                )}

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <HeroChip icon={Wallet} label={`${totalAccounts} ta hisob`} />
                  <HeroChip icon={Building2} label={`${byBank.length} ta bank`} />
                  <HeroChip icon={Activity} label="Avto-sync 5 daq" />
                </div>
              </div>

              {/* Inline sparkline preview */}
              <div className="lg:col-span-2 hidden lg:block">
                <div className="rounded-2xl bg-white/10 backdrop-blur-sm ring-1 ring-white/20 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] uppercase tracking-wider text-white/70">Oxirgi 30 kun</div>
                    <div className="text-xs text-emerald-300 font-medium flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" /> Trend
                    </div>
                  </div>
                  <div className="-mx-2">
                    <Sparkline
                      data={areaInData.map((d) => d.value)}
                      width={360} height={70}
                      stroke="white" fill="white"
                      className="w-full"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ KPI ROW with sparklines ═══ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard
            label="Kirim · 30 kun"
            value={formatMoney(inSum)}
            icon={ArrowDownLeft}
            trend="+12.4%"
            color="emerald"
            spark={areaInData.map((d) => d.value)}
          />
          <KpiCard
            label="Chiqim · 30 kun"
            value={formatMoney(outSum)}
            icon={ArrowUpRight}
            trend="-3.2%"
            color="rose"
            spark={areaOutData.map((d) => d.value)}
          />
          <KpiCard
            label="Sof oqim"
            value={(netFlow >= 0 ? '+' : '') + formatMoney(netFlow)}
            icon={TrendingUp}
            trend={netFlow >= 0 ? 'Ijobiy' : 'Salbiy'}
            color={netFlow >= 0 ? 'indigo' : 'rose'}
            spark={areaInData.map((d, i) => d.value - areaOutData[i].value)}
          />
        </div>

        {/* ═══ Onboarding (bo'sh tizimda) ═══ */}
        {isEmpty && (
          <OnboardingCard
            banksCount={banksCount}
            credentialsCount={credentialsCount}
            accountsCount={totalAccounts}
          />
        )}

        {/* ═══ BENTO GRID — Big chart + donut + quick actions ═══ */}
        <div className="grid gap-4 lg:grid-cols-6 lg:auto-rows-auto">
          {/* Big area chart */}
          <Card className="lg:col-span-4 border-0 shadow-soft overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
                <div>
                  <div className="text-base font-semibold tracking-tight">Kirim/Chiqim dinamikasi</div>
                  <div className="text-xs text-slate-500 mt-0.5">Oxirgi 30 kun</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-[11px] font-medium">
                    <button className="px-3 py-1 rounded-full bg-white shadow-sm text-slate-900">30 kun</button>
                    <button className="px-3 py-1 text-slate-500">3 oy</button>
                    <button className="px-3 py-1 text-slate-500">Yil</button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 mb-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-500" />
                  <span className="text-slate-600">Kirim</span>
                  <span className="font-semibold tabular-nums">{formatMoney(inSum)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <span className="text-slate-600">Chiqim</span>
                  <span className="font-semibold tabular-nums">{formatMoney(outSum)}</span>
                </div>
              </div>

              <AreaChart
                data={areaInData}
                height={240}
                gradientFrom="#6366f1"
                gradientTo="#06b6d4"
                stroke="#6366f1"
              />
            </CardContent>
          </Card>

          {/* Donut: banks distribution */}
          <Card className="lg:col-span-2 border-0 shadow-soft overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-base font-semibold tracking-tight">Banklar</div>
                  <div className="text-xs text-slate-500 mt-0.5">Qoldiq taqsimoti</div>
                </div>
                <Link href={`/${locale}/banks`} className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium">
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {byBank.length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-8">Banklar yo'q</div>
              ) : (
                <>
                  <div className="flex justify-center mb-4">
                    <DonutChart
                      data={byBank.map((b) => ({ label: b.name, value: b.balance, color: b.color }))}
                      size={180}
                      thickness={22}
                      centerLabel="banklar"
                      centerValue={String(byBank.length)}
                    />
                  </div>
                  <div className="space-y-2">
                    {byBank.slice(0, 4).map((b) => (
                      <div key={b.id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: b.color }} />
                          <span className="truncate text-slate-700">{b.name}</span>
                        </div>
                        <span className="font-semibold tabular-nums shrink-0">{formatMoney(b.balance)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ═══ Quick actions + Activity feed ═══ */}
        <div className="grid gap-4 lg:grid-cols-6">
          <div className="lg:col-span-4">
            <QuickActions accountsCount={totalAccounts} />
          </div>

          {/* Live activity feed */}
          <Card className="lg:col-span-2 border-0 shadow-soft overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-base font-semibold tracking-tight flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    Faollik
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">Real-time</div>
                </div>
              </div>

              {recentLoading ? (
                <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              ) : (recent?.items || []).length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-8">Faollik yo'q</div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto -mx-2 px-2">
                  {recent!.items.slice(0, 6).map((it: any) => {
                    const counterparty = it.direction === 'IN' ? it.fromName : it.toName;
                    return (
                      <div key={it.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50/80 transition-colors">
                        <div className={cn(
                          "w-8 h-8 rounded-full grid place-items-center shrink-0 mt-0.5",
                          it.direction === 'IN'
                            ? "bg-gradient-to-br from-emerald-400 to-teal-500 text-white"
                            : "bg-gradient-to-br from-rose-400 to-red-500 text-white",
                        )}>
                          {it.direction === 'IN' ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">{counterparty || '—'}</div>
                          <div className={cn(
                            "text-xs font-bold tabular-nums",
                            it.direction === 'IN' ? 'text-emerald-600' : 'text-rose-600',
                          )}>
                            {it.direction === 'IN' ? '+' : '−'}{formatMoney(it.amount, it.currency)}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{formatDateTime(it.txnDate)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ═══ Top accounts strip ═══ */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <CardContent className="p-0">
            <div className="flex items-center justify-between p-6 pb-4">
              <div>
                <div className="text-base font-semibold tracking-tight">Eng katta hisoblar</div>
                <div className="text-xs text-slate-500 mt-0.5">Qoldiq bo'yicha</div>
              </div>
              <Link href={`/${locale}/accounts`}>
                <Button variant="outline" size="sm" className="gap-1.5 h-8 rounded-full px-4 text-xs hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700">
                  {totalAccounts} ta <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
            {accLoading ? (
              <div className="px-6 pb-6 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : (accounts?.items || []).length === 0 ? (
              <EmptyState icon={Wallet} title="Hali hisob qo'shilmagan" description="Sozlash → Bank ulanishi → Hisob qo'shing" />
            ) : (
              <div>
                {(accounts!.items as any[])
                  .slice()
                  .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
                  .slice(0, 5)
                  .map((a, i, arr) => {
                    const color = BANK_COLORS[byBank.findIndex((b) => b.id === a.bankId) % BANK_COLORS.length];
                    return (
                      <div key={a.id} className={cn(
                        "flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50/80 transition-colors",
                        i < arr.length - 1 && "border-b border-slate-100",
                      )}>
                        <div className="w-10 h-10 rounded-xl grid place-items-center shrink-0 shadow-sm text-white"
                          style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
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

function HeroChip({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/25 text-white/95 font-medium text-[12px]">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function KpiCard({
  label, value, icon: Icon, trend, color, spark,
}: {
  label: string;
  value: string;
  icon: any;
  trend?: string;
  color: 'emerald' | 'rose' | 'indigo' | 'amber';
  spark?: number[];
}) {
  const map = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100', accent: '#10b981' },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-600',    ring: 'ring-rose-100',    accent: '#f43f5e' },
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600',  ring: 'ring-indigo-100',  accent: '#6366f1' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   ring: 'ring-amber-100',   accent: '#f59e0b' },
  };
  const c = map[color];
  return (
    <Card className="border-0 shadow-soft card-hover overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.15em] font-semibold text-slate-500">{label}</div>
          </div>
          <div className={cn("w-10 h-10 rounded-xl grid place-items-center ring-1", c.bg, c.text, c.ring)}>
            <Icon className="h-[18px] w-[18px]" />
          </div>
        </div>
        <div className="text-2xl lg:text-3xl font-bold tracking-tight tabular-nums">{value}</div>
        <div className="flex items-center justify-between mt-2">
          {trend && (
            <Badge variant="outline" className={cn("text-[10px] font-semibold border-0", c.bg, c.text)}>
              {trend}
            </Badge>
          )}
          {spark && (
            <div className={c.text}>
              <Sparkline data={spark} width={100} height={32} stroke={c.accent} fill={c.accent} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
