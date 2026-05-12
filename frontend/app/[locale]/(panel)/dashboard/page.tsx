'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight, AlertTriangle, FileText, Users,
  TrendingUp, Receipt,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { SkeletonRow } from '@/components/skeleton';
import { api } from '@/lib/api';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tx = useTranslations('transactions');
  const { locale } = useParams<{ locale: string }>();

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<{ items: any[] }>('/customers'),
  });
  const { data: contracts } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api.get<{ items: any[] }>('/contracts'),
  });
  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ['recent'],
    queryFn: () => api.get<{ items: any[]; total: number }>('/transactions?perPage=10'),
  });

  const totalContracts = (contracts?.items || []).reduce((s, c) => s + Number(c.totalAmount), 0);
  const totalPaid = (contracts?.items || []).reduce((s, c) => s + Number(c.paidTotal), 0);
  const totalDebt = totalContracts - totalPaid;
  const overdueCount = (contracts?.items || []).reduce((s, c: any) => {
    return s + (c.stages || []).filter((st: any) =>
      st.status === 'OVERDUE' || (st.dueDate && new Date(st.dueDate) < new Date() && st.status !== 'PAID'),
    ).length;
  }, 0);
  const activeContracts = (contracts?.items || []).filter((c) => c.status === 'ACTIVE').length;

  const topDebtors = (customers?.items || [])
    .map((c: any) => ({ ...c, debtNum: Number(c.stats.debt) }))
    .filter((c) => c.debtNum > 0)
    .sort((a, b) => b.debtNum - a.debtNum)
    .slice(0, 5);

  return (
    <>
      <Topbar title={t('title')} subtitle="Billing & Bank monitoring" />
      <div className="flex-1 p-6 lg:p-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Jami shartnomalar" value={formatMoney(totalContracts)} icon={FileText} tone="primary" sub={`${activeContracts} ta faol`} />
          <KpiCard label="To'langan" value={formatMoney(totalPaid)} icon={ArrowDownRight} tone="success" sub={totalContracts > 0 ? `${((totalPaid / totalContracts) * 100).toFixed(0)}% bajarildi` : '—'} />
          <KpiCard label="Qoldiq qarz" value={formatMoney(totalDebt)} icon={TrendingUp} tone={totalDebt > 0 ? 'destructive' : 'success'} sub={`${customers?.items?.length || 0} mijoz`} />
          <KpiCard label="Muddati o'tgan bosqichlar" value={String(overdueCount)} icon={AlertTriangle} tone={overdueCount > 0 ? 'warning' : 'muted'} sub={overdueCount > 0 ? "Diqqat kerak" : "Hammasi yaxshi"} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Yirik qarzdorlar
              </CardTitle>
              <CardDescription>Eng katta qoldiq bo'yicha</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {topDebtors.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">Qarzdor mijozlar yo'q</div>
              ) : topDebtors.map((c: any) => (
                <Link key={c.id} href={`/${locale}/customers/${c.id}`}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/40 transition-colors group">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white text-sm font-semibold shrink-0">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c._count.contracts} ta shartnoma</div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums text-destructive shrink-0">
                    {formatMoney(c.debtNum)}
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" />
                {t('recentTransactions')}
              </CardTitle>
              <CardDescription>So'nggi bank tranzaksiyalari va billing'ga match holati</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tx('date')}</TableHead>
                    <TableHead>{tx('from')}</TableHead>
                    <TableHead>Match</TableHead>
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
                    recent!.items.map((it: any) => (
                      <TableRow key={it.id}>
                        <TableCell className="tabular-nums whitespace-nowrap text-xs">{formatDateTime(it.txnDate)}</TableCell>
                        <TableCell className="max-w-[200px]">
                          <div className="text-sm truncate">{it.fromName || it.fromAccount || '—'}</div>
                          {it.fromInn && <div className="text-[10px] font-mono text-muted-foreground">{it.fromInn}</div>}
                        </TableCell>
                        <TableCell>
                          <MatchBadge status={it.matchStatus} />
                        </TableCell>
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
      </div>
    </>
  );
}

function MatchBadge({ status }: { status?: string }) {
  const config: Record<string, { variant: any; label: string }> = {
    AUTO: { variant: 'success', label: 'Avto' },
    MANUAL: { variant: 'secondary', label: "Qo'lda" },
    PARTIAL: { variant: 'secondary', label: 'Qisman' },
    IGNORED: { variant: 'muted', label: "E'tiborsiz" },
    UNMATCHED: { variant: 'outline', label: "Bog'lanmagan" },
  };
  const c = config[status || 'UNMATCHED'] || config.UNMATCHED;
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function KpiCard({
  label, value, icon: Icon, tone, sub,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'success' | 'destructive' | 'primary' | 'muted' | 'warning';
  sub?: string;
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
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
