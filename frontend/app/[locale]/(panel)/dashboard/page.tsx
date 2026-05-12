'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Wallet, TrendingUp } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<{ total: number; groups: StatsGroup[] }>('/transactions/stats'),
  });
  const { data: recent } = useQuery({
    queryKey: ['recent'],
    queryFn: () =>
      api.get<{ items: any[]; total: number }>('/transactions?perPage=10'),
  });

  const sumByDir = (dir: 'IN' | 'OUT') =>
    stats?.groups
      ?.filter((g) => g.direction === dir)
      ?.reduce((acc, g) => acc + Number(g._sum.amount || 0), 0) ?? 0;
  const inSum = sumByDir('IN');
  const outSum = sumByDir('OUT');

  return (
    <>
      <Topbar title={t('title')} />
      <div className="flex-1 p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label={t('totalIn')}
            value={formatMoney(inSum)}
            icon={ArrowDownRight}
            tone="success"
          />
          <KpiCard
            label={t('totalOut')}
            value={formatMoney(outSum)}
            icon={ArrowUpRight}
            tone="destructive"
          />
          <KpiCard
            label={t('balance')}
            value={formatMoney(inSum - outSum)}
            icon={TrendingUp}
            tone="primary"
          />
          <KpiCard
            label={t('totalTransactions')}
            value={String(stats?.total ?? 0)}
            icon={Wallet}
            tone="muted"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('recentTransactions')}</CardTitle>
            <CardDescription>{tx('subtitle')}</CardDescription>
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
                {(recent?.items || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                      {tx('noData')}
                    </TableCell>
                  </TableRow>
                ) : (
                  recent!.items.map((it: any) => (
                    <TableRow key={it.id}>
                      <TableCell className="tabular-nums">{formatDateTime(it.txnDate)}</TableCell>
                      <TableCell>
                        <Badge variant={it.direction === 'IN' ? 'success' : 'secondary'}>
                          {it.direction === 'IN' ? tx('dirIn') : tx('dirOut')}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{it.fromName || it.fromAccount || '—'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{it.toName || it.toAccount || '—'}</TableCell>
                      <TableCell className={cn(
                        'text-right tabular-nums font-medium',
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
  label, value, icon: Icon, tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'success' | 'destructive' | 'primary' | 'muted';
}) {
  const toneClasses: Record<typeof tone, string> = {
    success: 'bg-success/10 text-success',
    destructive: 'bg-destructive/10 text-destructive',
    primary: 'bg-primary/10 text-primary',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground font-medium">{label}</span>
          <span className={cn('p-2 rounded-lg', toneClasses[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
