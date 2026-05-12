'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

const STATUS_ICON: Record<string, any> = {
  SUCCESS: CheckCircle2,
  FAILED: XCircle,
  RUNNING: Loader2,
  PARTIAL: AlertTriangle,
};

export default function SyncLogsPage() {
  const t = useTranslations('syncLogs');

  const { data } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: () => api.get<{ items: any[] }>('/sync/logs?limit=100'),
    refetchInterval: 10_000,
  });

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <div className="flex-1 p-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('startedAt')}</TableHead>
                  <TableHead>{t('source')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead className="text-right">{t('fetched')}</TableHead>
                  <TableHead className="text-right">{t('saved')}</TableHead>
                  <TableHead className="text-right">{t('errors')}</TableHead>
                  <TableHead className="text-right">{t('duration')}</TableHead>
                  <TableHead>{t('errorMessage')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.items?.length ?? 0) === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">{t('noData')}</TableCell></TableRow>
                ) : (
                  data!.items.map((l: any) => {
                    const Icon = STATUS_ICON[l.status] || CheckCircle2;
                    const tone =
                      l.status === 'SUCCESS' ? 'success'
                      : l.status === 'FAILED' ? 'destructive'
                      : l.status === 'PARTIAL' ? 'secondary'
                      : 'muted';
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="tabular-nums whitespace-nowrap text-xs">{formatDateTime(l.startedAt)}</TableCell>
                        <TableCell className="font-mono text-xs">{l.source}</TableCell>
                        <TableCell>
                          <Badge variant={tone as any}>
                            <Icon className={`h-3 w-3 mr-1 ${l.status === 'RUNNING' ? 'animate-spin' : ''}`} />
                            {l.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{l.fetched}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.saved}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.errors}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {l.durationMs ? `${l.durationMs} ms` : '—'}
                        </TableCell>
                        <TableCell className="max-w-[300px] truncate text-xs text-destructive">{l.errorMessage || '—'}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
