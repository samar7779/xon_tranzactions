'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

export default function TransactionsPage() {
  const t = useTranslations('transactions');
  const tc = useTranslations('common');

  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const params = new URLSearchParams({ page: String(page), perPage: '25' });
  if (q) params.set('q', q);
  if (direction !== 'all') params.set('direction', direction);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', page, q, direction, dateFrom, dateTo],
    queryFn: () => api.get<{ items: any[]; total: number; page: number; perPage: number }>(`/transactions?${params}`),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <div className="flex-1 p-6 space-y-4">
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="md:col-span-2 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('search')}
                  className="pl-9"
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setPage(1); }}
                />
              </div>
              <Select value={direction} onValueChange={(v) => { setDirection(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder={t('allDirections')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allDirections')}</SelectItem>
                  <SelectItem value="IN">{t('dirIn')}</SelectItem>
                  <SelectItem value="OUT">{t('dirOut')}</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead>{t('direction')}</TableHead>
                  <TableHead>{t('from')}</TableHead>
                  <TableHead>{t('to')}</TableHead>
                  <TableHead>{t('description')}</TableHead>
                  <TableHead>{t('account')}</TableHead>
                  <TableHead className="text-right">{t('amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">{tc('loading')}</TableCell></TableRow>
                ) : (data?.items?.length ?? 0) === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">{t('noData')}</TableCell></TableRow>
                ) : (
                  data!.items.map((it: any) => (
                    <TableRow key={it.id}>
                      <TableCell className="tabular-nums whitespace-nowrap">{formatDateTime(it.txnDate)}</TableCell>
                      <TableCell>
                        <Badge variant={it.direction === 'IN' ? 'success' : 'secondary'}>
                          {it.direction === 'IN' ? t('dirIn') : t('dirOut')}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        <div className="text-sm">{it.fromName || '—'}</div>
                        <div className="text-xs text-muted-foreground font-mono">{it.fromAccount || ''}</div>
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        <div className="text-sm">{it.toName || '—'}</div>
                        <div className="text-xs text-muted-foreground font-mono">{it.toAccount || ''}</div>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-sm">{it.description || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {it.account?.accountNo || '—'}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums font-medium whitespace-nowrap',
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

        {data && data.total > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t('page')} {data.page} / {totalPages} · {data.total}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>›</Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
