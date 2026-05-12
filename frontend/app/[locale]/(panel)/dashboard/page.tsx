'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight, ArrowUpRight, Wallet, TrendingUp, Receipt,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { Skeleton, SkeletonRow } from '@/components/skeleton';
import { api } from '@/lib/api';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

interface StatsGroup {
  direction: 'IN' | 'OUT';
  status: string;
  _sum: { amount: string | null };
  _count: number;
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tx = useTranslations('transactions');

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<{ total: number; groups: StatsGroup[] }>('/transactions/stats'),
  });
  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ['recent'],
    queryFn: () => api.get<{ items: any[]; total: number }>('/transactions?perPage=10'),
  });

  const sumByDir = (dir: 'IN' | 'OUT') =>
    stats?.groups
      ?.filter((g) => g.direction === dir)
      ?.reduce((acc, g) => acc + Number(g._sum.amount || 0), 0) ?? 0;
  const inSum = sumByDir('IN');
  const outSum = sumByDir('OUT');
  const net = inSum - outSum;

  return (
    <>
      <Topbar title={t('title')} />
      <div className="flex-1 p-6 lg:p-8 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label={t('totalIn')}
            value={formatMoney(inSum)}
            icon={ArrowDownRight}
            tone="success"
            loading={statsLoading}
          />
          <KpiCard
            label={t('totalOut')}
            value={formatMoney(outSum)}
            icon={ArrowUpRight}
            tone="destructive"
            loading={statsLoading}
          />
          <KpiCard
            label={t('balance')}
            value={formatMoney(net)}
            icon={TrendingUp}
            tone={net >= 0 ? 'primary' : 'destructive'}
            loading={statsLoading}
          />
          <KpiCard
            label={t('totalTransactions')}
            value={statsLoading ? '—' : String(stats?.total ?? 0)}
            icon={Wallet}
            tone="muted"
            loading={statsLoading}
          />
        </div>

        {/* Recent transactions */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>{t('recentTransactions')}</CardTitle>
              <CardDescription>{tx('subtitle')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx('date')}</TableHead>
                  <TableHead>{tx('direction')}</TableHead>
                  <TableHead>{tx('from')}</TableHead>
                  <TableHead>{tx('to')}</TableHead>
                  <TableHead className="text-right">{tx('amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={5} />)
                ) : (recent?.items || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <EmptyState
                        icon={Receipt}
                        title={tx('noData')}
                        description="Bank ulanishi va hisob qo'shilgandan keyin tranzaksiyalar avto-yuklanadi"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  recent!.items.map((it: any) => (
                    <TableRow key={it.id}>
                      <TableCell className="tabular-nums whitespace-nowrap text-sm">{formatDateTime(it.txnDate)}</TableCell>
                      <TableCell>
                        <Badge variant={it.direction === 'IN' ? 'success' : 'secondary'}>
                          {it.direction === 'IN' ? tx('dirIn') : tx('dirOut')}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{it.fromName || it.fromAccount || '—'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{it.toName || it.toAccount || '—'}</TableCell>
                      <TableCell className={cn(
                        'text-right tabular-nums font-medium whitespace-nowrap',
                        it.direction === 'IN' ? 'text-success' : 'text-destructive',
                      )}>
                        {it.direction === 'IN' ? '+' : '−'} {formatMoney(it.amount, it.currency)}
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

function KpiCard({
  label, value, icon: Icon, tone, loading,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'success' | 'destructive' | 'primary' | 'muted';
  loading?: boolean;
}) {
  const toneClasses: Record<typeof tone, string> = {
    success: 'bg-success/10 text-success ring-success/20',
    destructive: 'bg-destructive/10 text-destructive ring-destructive/20',
    primary: 'bg-primary/10 text-primary ring-primary/20',
    muted: 'bg-muted text-muted-foreground ring-border',
  };
  return (
    <Card className="hover:shadow-soft transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
          <span className={cn('p-2 rounded-lg ring-1 transition-transform group-hover:scale-105', toneClasses[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
        {loading ? (
          <Skeleton className="h-7 w-32" />
        ) : (
          <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        )}
      </CardContent>
    </Card>
  );
}
