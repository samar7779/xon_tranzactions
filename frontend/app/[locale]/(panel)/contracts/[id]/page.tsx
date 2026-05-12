'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Clock, AlertCircle, CircleDashed } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/skeleton';
import { api } from '@/lib/api';
import { cn, formatDate, formatDateTime, formatMoney } from '@/lib/utils';

const STAGE_ICON: Record<string, any> = {
  PENDING: CircleDashed,
  PARTIAL: Clock,
  PAID: Check,
  OVERDUE: AlertCircle,
};
const STAGE_TONE: Record<string, string> = {
  PENDING: 'text-muted-foreground bg-muted',
  PARTIAL: 'text-info bg-info/10',
  PAID: 'text-success bg-success/10',
  OVERDUE: 'text-destructive bg-destructive/10',
};

export default function ContractDetailPage() {
  const t = useTranslations('contracts');
  const tp = useTranslations('payments');
  const { id, locale } = useParams<{ id: string; locale: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['contract', id],
    queryFn: () => api.get<any>(`/contracts/${id}`),
  });

  return (
    <>
      <Topbar title={data?.title || t('title')} subtitle={data?.number || ''} />
      <div className="flex-1 p-6 lg:p-8 space-y-6">
        <Link href={`/${locale}/contracts`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t('title')}
        </Link>

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            {/* Header card */}
            <Card>
              <CardContent className="p-6">
                <div className="flex flex-col lg:flex-row gap-6 lg:items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-muted-foreground">{data.number}</span>
                      <Badge variant={data.status === 'ACTIVE' ? 'success' : 'muted'}>{t('status' + data.status)}</Badge>
                    </div>
                    <h2 className="text-2xl font-semibold tracking-tight">{data.title}</h2>
                    <Link href={`/${locale}/customers/${data.customerId}`} className="text-sm text-primary hover:underline">
                      {data.customer.name}
                    </Link>
                    {data.projectAddress && <div className="text-sm text-muted-foreground">{data.projectAddress}</div>}
                  </div>

                  <div className="grid grid-cols-3 gap-6 lg:gap-8">
                    <Stat label={t('totalAmount')} value={formatMoney(Number(data.totalAmount))} />
                    <Stat label={t('paid')} value={formatMoney(Number(data.paidTotal))} tone="success" />
                    <Stat label={t('debt')} value={formatMoney(Number(data.debt))} tone={Number(data.debt) > 0 ? 'destructive' : 'success'} />
                  </div>
                </div>

                <div className="mt-6">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                    <span>{t('progress')}</span>
                    <span className="tabular-nums">{data.progressPct.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all" style={{ width: `${Math.min(100, data.progressPct)}%` }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stages */}
            <Card>
              <CardHeader>
                <CardTitle>{t('stages')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.stages.map((s: any) => {
                  const Icon = STAGE_ICON[s.status];
                  const tone = STAGE_TONE[s.status];
                  const amount = Number(s.amount);
                  const paid = Number(s.paidAmount);
                  const pct = amount > 0 ? Math.min(100, (paid / amount) * 100) : 0;
                  return (
                    <div key={s.id} className="rounded-xl border p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className={cn("w-10 h-10 rounded-lg grid place-items-center shrink-0", tone)}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold">{s.ordinal}. {s.title}</span>
                              <Badge variant={s.status === 'PAID' ? 'success' : s.status === 'OVERDUE' ? 'destructive' : s.status === 'PARTIAL' ? 'secondary' : 'outline'}>
                                {t('stageStatus' + s.status)}
                              </Badge>
                              {s.percentage && (
                                <span className="text-xs text-muted-foreground">{Number(s.percentage)}%</span>
                              )}
                            </div>
                            {s.dueDate && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {t('stageDueDate')}: {formatDate(s.dueDate)}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs text-muted-foreground">{formatMoney(paid)} / {formatMoney(amount)}</div>
                          <div className="font-semibold tabular-nums mt-0.5">
                            {paid >= amount ? (
                              <span className="text-success">{t('stageStatusPAID')}</span>
                            ) : (
                              <span className="text-destructive">−{formatMoney(amount - paid)}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={cn(
                          "h-full transition-all",
                          s.status === 'PAID' && 'bg-success',
                          s.status === 'PARTIAL' && 'bg-info',
                          s.status === 'OVERDUE' && 'bg-destructive',
                          (s.status === 'PENDING') && 'bg-muted-foreground/30',
                        )} style={{ width: `${pct}%` }} />
                      </div>

                      {/* Payments under this stage */}
                      {s.payments && s.payments.length > 0 && (
                        <div className="mt-3 pt-3 border-t space-y-1.5">
                          {s.payments.map((p: any) => (
                            <div key={p.id} className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <Badge variant={p.source === 'AUTO' ? 'success' : 'secondary'} className="text-[10px]">
                                  {tp('source' + p.source)}
                                </Badge>
                                <span className="text-muted-foreground">{formatDateTime(p.transaction.txnDate)}</span>
                                <span className="text-muted-foreground">·</span>
                                <span>{p.transaction.fromName}</span>
                              </div>
                              <span className="tabular-nums font-medium text-success">+{formatMoney(Number(p.amount))}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'destructive' }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={cn(
        "text-xl font-semibold tabular-nums mt-1",
        tone === 'success' && 'text-success',
        tone === 'destructive' && 'text-destructive',
      )}>{value}</div>
    </div>
  );
}
