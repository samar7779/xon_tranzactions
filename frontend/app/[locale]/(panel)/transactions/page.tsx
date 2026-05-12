'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Wand2, Link2Off, EyeOff, MoreHorizontal,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

const MATCH_CONFIG: Record<string, { variant: any; label: string }> = {
  AUTO: { variant: 'success', label: 'Avto' },
  MANUAL: { variant: 'secondary', label: 'Qo\'lda' },
  PARTIAL: { variant: 'secondary', label: 'Qisman' },
  IGNORED: { variant: 'muted', label: 'E\'tiborsiz' },
  UNMATCHED: { variant: 'outline', label: 'Bog\'lanmagan' },
};

export default function TransactionsPage() {
  const t = useTranslations('transactions');
  const tp = useTranslations('payments');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManagePayments = user?.role === 'SUPERADMIN' || user?.permissions?.includes(PERMS.PAYMENTS_MANAGE);

  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState<string>('all');
  const [matchStatus, setMatchStatus] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const params = new URLSearchParams({ page: String(page), perPage: '25' });
  if (q) params.set('q', q);
  if (direction !== 'all') params.set('direction', direction);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', page, q, direction, matchStatus, dateFrom, dateTo],
    queryFn: () => api.get<{ items: any[]; total: number; page: number; perPage: number }>(`/transactions?${params}`),
  });

  // Client-side match filter
  const filtered = matchStatus === 'all'
    ? data?.items
    : data?.items.filter((it) => (it.matchStatus || 'UNMATCHED') === matchStatus);

  const autoMatchMut = useMutation({
    mutationFn: (id: string) => api.post(`/payments/auto-match/${id}`),
    onSuccess: (r: any) => {
      if (r.ok) toast.success(`Bog'landi: ${r.customer.name}`);
      else toast.message(r.error || "Bog'lanmadi");
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (e: any) => toast.error(e?.message),
  });
  const unlinkMut = useMutation({
    mutationFn: (id: string) => api.delete(`/payments/link/${id}`),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['transactions'] }); },
    onError: (e: any) => toast.error(e?.message),
  });
  const ignoreMut = useMutation({
    mutationFn: (id: string) => api.post(`/payments/ignore/${id}`),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['transactions'] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <div className="flex-1 p-6 lg:p-8 space-y-4">
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <div className="md:col-span-2 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder={t('search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
              </div>
              <Select value={direction} onValueChange={(v) => { setDirection(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder={t('allDirections')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allDirections')}</SelectItem>
                  <SelectItem value="IN">{t('dirIn')}</SelectItem>
                  <SelectItem value="OUT">{t('dirOut')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={matchStatus} onValueChange={setMatchStatus}>
                <SelectTrigger><SelectValue placeholder="Match" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barchasi</SelectItem>
                  <SelectItem value="UNMATCHED">Bog'lanmagan</SelectItem>
                  <SelectItem value="AUTO">Avto</SelectItem>
                  <SelectItem value="MANUAL">Qo'lda</SelectItem>
                  <SelectItem value="PARTIAL">Qisman</SelectItem>
                  <SelectItem value="IGNORED">E'tiborsiz</SelectItem>
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
                  <TableHead>Match</TableHead>
                  <TableHead className="text-right">{t('amount')}</TableHead>
                  {canManagePayments && <TableHead className="w-12"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">{tc('loading')}</TableCell></TableRow>
                ) : (filtered?.length ?? 0) === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">{t('noData')}</TableCell></TableRow>
                ) : (
                  filtered!.map((it: any) => {
                    const match = MATCH_CONFIG[it.matchStatus || 'UNMATCHED'];
                    return (
                      <TableRow key={it.id} className="group">
                        <TableCell className="tabular-nums whitespace-nowrap text-xs">{formatDateTime(it.txnDate)}</TableCell>
                        <TableCell>
                          <Badge variant={it.direction === 'IN' ? 'success' : 'secondary'}>
                            {it.direction === 'IN' ? t('dirIn') : t('dirOut')}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[180px]">
                          <div className="text-sm truncate">{it.fromName || '—'}</div>
                          {it.fromInn && <div className="text-[10px] font-mono text-muted-foreground">{it.fromInn}</div>}
                        </TableCell>
                        <TableCell className="max-w-[180px]">
                          <div className="text-sm truncate">{it.toName || '—'}</div>
                          <div className="text-[10px] font-mono text-muted-foreground">{it.toAccount || ''}</div>
                        </TableCell>
                        <TableCell><Badge variant={match.variant}>{match.label}</Badge></TableCell>
                        <TableCell className={cn(
                          'text-right tabular-nums font-medium whitespace-nowrap',
                          it.direction === 'IN' ? 'text-success' : 'text-destructive',
                        )}>
                          {it.direction === 'IN' ? '+' : '−'} {formatMoney(it.amount, it.currency)}
                        </TableCell>
                        {canManagePayments && (
                          <TableCell>
                            {it.direction === 'IN' && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {it.matchStatus !== 'AUTO' && it.matchStatus !== 'MANUAL' && (
                                    <DropdownMenuItem onClick={() => autoMatchMut.mutate(it.id)}>
                                      <Wand2 className="h-4 w-4 mr-2" /> Avto-match (INN)
                                    </DropdownMenuItem>
                                  )}
                                  {(it.matchStatus === 'AUTO' || it.matchStatus === 'MANUAL' || it.matchStatus === 'PARTIAL') && (
                                    <DropdownMenuItem onClick={() => unlinkMut.mutate(it.id)}>
                                      <Link2Off className="h-4 w-4 mr-2" /> Bog'lanishni olib tashlash
                                    </DropdownMenuItem>
                                  )}
                                  {it.matchStatus !== 'IGNORED' && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => ignoreMut.mutate(it.id)}>
                                        <EyeOff className="h-4 w-4 mr-2" /> E'tiborsiz qoldirish
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
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
