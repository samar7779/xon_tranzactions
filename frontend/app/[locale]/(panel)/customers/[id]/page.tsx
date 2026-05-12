'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, FileText, Phone, Mail, MapPin } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/skeleton';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn, formatDate, formatMoney } from '@/lib/utils';

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'success',
  COMPLETED: 'muted',
  DRAFT: 'outline',
  CANCELLED: 'destructive',
  SUSPENDED: 'secondary',
};
const STAGE_STATUS_COLOR: Record<string, string> = {
  PENDING: 'outline',
  PARTIAL: 'secondary',
  PAID: 'success',
  OVERDUE: 'destructive',
};

export default function CustomerDetailPage() {
  const t = useTranslations('customers');
  const tCon = useTranslations('contracts');
  const { id, locale } = useParams<{ id: string; locale: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<any>(`/customers/${id}`),
  });

  return (
    <>
      <Topbar title={data?.name || t('title')} subtitle={data?.inn || ''} />
      <div className="flex-1 p-6 lg:p-8 space-y-6">
        <Link href={`/${locale}/customers`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t('title')}
        </Link>

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              {/* Customer info card */}
              <Card className="md:col-span-1">
                <CardHeader>
                  <CardTitle>{t('title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {data.inn && <Row icon={Building2} label={t('inn')} value={data.inn} mono />}
                  {data.contactPerson && <Row label={t('contactPerson')} value={data.contactPerson} />}
                  {data.phone && <Row icon={Phone} label={t('phone')} value={data.phone} />}
                  {data.email && <Row icon={Mail} label={t('email')} value={data.email} />}
                  {data.address && <Row icon={MapPin} label={t('address')} value={data.address} />}
                  {data.bankAccount && <Row label={t('bankAccount')} value={data.bankAccount} mono />}
                </CardContent>
              </Card>

              {/* KPI cards */}
              <Card className="md:col-span-2">
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <Kpi label={t('contractsTotal')} value={formatMoney(Number(data.stats.contractsTotal))} tone="primary" />
                    <Kpi label={t('paidTotal')} value={formatMoney(Number(data.stats.paidTotal))} tone="success" />
                    <Kpi label={t('debt')} value={formatMoney(Number(data.stats.debt))} tone={Number(data.stats.debt) > 0 ? 'destructive' : 'success'} />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Contracts */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{tCon('title')}</CardTitle>
                <Link href={`/${locale}/contracts?customerId=${id}`}>
                  <Button variant="outline" size="sm">{tCon('add')}</Button>
                </Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data.contracts?.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-8">{tCon('noData')}</div>
                ) : (
                  data.contracts.map((c: any) => {
                    const total = Number(c.totalAmount);
                    const paid = c.stages.reduce((s: number, st: any) => s + Number(st.paidAmount), 0);
                    const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
                    return (
                      <Link key={c.id} href={`/${locale}/contracts/${c.id}`}
                        className="block rounded-xl border p-4 hover:bg-accent/50 transition-colors group">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium group-hover:text-primary transition-colors">{c.title}</span>
                              <Badge variant={STATUS_COLOR[c.status] as any}>{tCon('status' + c.status)}</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground font-mono mt-0.5">{c.number}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-semibold tabular-nums">{formatMoney(total)}</div>
                            <div className="text-xs text-muted-foreground">{c._count.stages} ta bosqich</div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-xs">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="tabular-nums w-12 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      </Link>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

function Row({ icon: Icon, label, value, mono }: { icon?: any; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      {Icon && <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn('truncate', mono && 'font-mono text-xs')}>{value}</div>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: 'primary' | 'success' | 'destructive' }) {
  const toneClasses = {
    primary: 'text-primary',
    success: 'text-success',
    destructive: 'text-destructive',
  };
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums mt-1", toneClasses[tone])}>{value}</div>
    </div>
  );
}
