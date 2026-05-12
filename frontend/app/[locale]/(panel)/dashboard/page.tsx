'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowUpRight, Wallet, Building2,
  Activity, Hash, Receipt, RefreshCw,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { Skeleton, SkeletonRow } from '@/components/skeleton';
import { api } from '@/lib/api';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tx = useTranslations('transactions');
  const ta = useTranslations('accounts');
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
    queryFn: () => api.get<{ items: any[]; total: number }>('/transactions?perPage=8'),
  });

  // Jami balanslar
  const totalBalance = (accounts?.items || []).reduce((s, a) => s + Number(a.balance || 0), 0);
  const totalAccounts = accounts?.items?.length || 0;

  // 30 kunlik kirim/chiqim
  const inSum = (stats?.groups || [])
    .filter((g: any) => g.direction === 'IN')
    .reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const outSum = (stats?.groups || [])
    .filter((g: any) => g.direction === 'OUT')
    .reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);

  // Banklar bo'yicha taqsimot
  const byBank = (() => {
    const map = new Map<string, { name: string; code: string; accounts: number; balance: number }>();
    for (const a of accounts?.items || []) {
      const bankId = a.bank?.id || 'unknown';
      const existing = map.get(bankId) || { name: a.bank?.name || 'Noma\'lum', code: a.bank?.code || '', accounts: 0, balance: 0 };
      existing.accounts += 1;
      existing.balance += Number(a.balance || 0);
      map.set(bankId, existing);
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.balance - a.balance);
  })();

  return (
    <>
      <Topbar title={t('title')} subtitle="Treasury — barcha hisoblar bo'yicha umumiy ko'rinish" />
      <div className="flex-1 p-6 lg:p-8 space-y-6">

        {/* Hero KPI'lar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Jami qoldiq"
            value={accLoading ? '—' : formatMoney(totalBalance)}
            icon={Wallet}
            tone="primary"
            sub={`${totalAccounts} ta hisob`}
            loading={accLoading}
          />
          <KpiCard
            label="Banklar"
            value={String(byBank.length)}
            icon={Building2}
            tone="muted"
            sub={`${banks?.items?.length || 0} ta umumiy`}
          />
          <KpiCard
            label="Kirim · 30 kun"
            value={formatMoney(inSum)}
            icon={ArrowDownLeft}
            tone="success"
            loading={statsLoading}
          />
          <KpiCard
            label="Chiqim · 30 kun"
            value={formatMoney(outSum)}
            icon={ArrowUpRight}
            tone="destructive"
            loading={statsLoading}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">

          {/* Banklar bo'yicha taqsimot */}
          <Card className="lg:col-span-1 overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4 text-primary" />
                Banklar bo'yicha
              </CardTitle>
              <CardDescription>Qoldiq taqsimoti</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {byBank.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">Hisoblar yo'q</div>
              ) : byBank.map((b) => {
                const pct = totalBalance > 0 ? (b.balance / totalBalance) * 100 : 0;
                return (
                  <div key={b.id} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium truncate">{b.name}</span>
                      <span className="tabular-nums text-muted-foreground text-xs">{b.accounts} hisob</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-indigo-500 to-blue-600 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-medium tabular-nums w-24 text-right">{formatMoney(b.balance)}</span>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* So'nggi tranzaksiyalar */}
          <Card className="lg:col-span-2 overflow-hidden">
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Receipt className="h-4 w-4 text-primary" />
                  {t('recentTransactions')}
                </CardTitle>
                <CardDescription>Barcha hisoblar bo'yicha so'nggi yozuvlar</CardDescription>
              </div>
              <Link href={`/${locale}/transactions`} className="text-xs text-primary hover:underline">
                Hammasini ko'rish →
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tx('date')}</TableHead>
                    <TableHead>Kontragent</TableHead>
                    <TableHead>Hisob</TableHead>
                    <TableHead className="text-right">{tx('amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentLoading ? (
                    Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={4} />)
                  ) : (recent?.items || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="p-0">
                        <EmptyState icon={Receipt} title={tx('noData')} description="Bank ulanishi qo'shilgandan keyin tranzaksiyalar yuklanadi" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    recent!.items.map((it: any) => {
                      const counterparty = it.direction === 'IN'
                        ? (it.fromName || it.fromAccount || '—')
                        : (it.toName || it.toAccount || '—');
                      return (
                        <TableRow key={it.id}>
                          <TableCell className="tabular-nums whitespace-nowrap text-xs">{formatDateTime(it.txnDate)}</TableCell>
                          <TableCell className="max-w-[220px]">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "w-7 h-7 rounded-full grid place-items-center shrink-0",
                                it.direction === 'IN' ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                              )}>
                                {it.direction === 'IN' ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                              </span>
                              <span className="text-sm truncate">{counterparty}</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {it.account?.accountNo || '—'}
                          </TableCell>
                          <TableCell className={cn(
                            'text-right tabular-nums font-medium whitespace-nowrap',
                            it.direction === 'IN' ? 'text-success' : 'text-destructive',
                          )}>
                            {it.direction === 'IN' ? '+' : '−'}{formatMoney(it.amount, it.currency)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Hisoblar ro'yxati — qisqacha */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-primary" />
                Hisoblar
              </CardTitle>
              <CardDescription>Eng katta qoldiqlar</CardDescription>
            </div>
            <Link href={`/${locale}/accounts`} className="text-xs text-primary hover:underline">
              Barcha {totalAccounts} ta hisob →
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {accLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : (accounts?.items || []).length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="Hali hisob qo'shilmagan"
                description="Bank → Bank ulanishi → Hisob qo'shing tartibida sozlang"
              />
            ) : (
              <div className="divide-y">
                {(accounts!.items as any[])
                  .slice()
                  .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
                  .slice(0, 6)
                  .map((a) => (
                    <div key={a.id} className="flex items-center gap-4 px-4 py-3 hover:bg-accent/30 transition-colors">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{a.bank?.name || '—'}</span>
                          <span className="text-[10px] text-muted-foreground">·</span>
                          <span className="font-mono text-xs text-muted-foreground">{a.branch}</span>
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground truncate">{a.accountNo}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold tabular-nums">{formatMoney(Number(a.balance || 0), a.currency)}</div>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                          {a.lastSyncedAt && <><RefreshCw className="h-2.5 w-2.5" /> {formatDateTime(a.lastSyncedAt)}</>}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function KpiCard({
  label, value, icon: Icon, tone, sub, loading,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'success' | 'destructive' | 'primary' | 'muted' | 'warning';
  sub?: string;
  loading?: boolean;
}) {
  const toneClasses: Record<typeof tone, string> = {
    success: 'bg-success/10 text-success ring-success/20',
    destructive: 'bg-destructive/10 text-destructive ring-destructive/20',
    primary: 'bg-primary/10 text-primary ring-primary/20',
    muted: 'bg-muted text-muted-foreground ring-border',
    warning: 'bg-warning/10 text-warning ring-warning/20',
  };
  return (
    <Card className="hover:shadow-soft transition-all hover:-translate-y-0.5">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
          <span className={cn('p-2 rounded-lg ring-1', toneClasses[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
        {loading ? (
          <Skeleton className="h-7 w-32" />
        ) : (
          <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        )}
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
