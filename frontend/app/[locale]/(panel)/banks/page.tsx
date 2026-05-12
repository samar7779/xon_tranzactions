'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';

export default function BanksPage() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');

  const { data } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });

  return (
    <>
      <Topbar title={t('banks')} />
      <div className="flex-1 p-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kod</TableHead>
                  <TableHead>Nomi</TableHead>
                  <TableHead>API turi</TableHead>
                  <TableHead>API URL</TableHead>
                  <TableHead>{tc('actions')}</TableHead>
                  <TableHead className="text-right">Ulanishlar / Hisoblar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.items || []).map((b: any) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-sm">{b.code}</TableCell>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell><Badge variant="outline">{b.apiKind}</Badge></TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground max-w-[260px] truncate">{b.apiBaseUrl}</TableCell>
                    <TableCell>
                      <Badge variant={b.isActive ? 'success' : 'muted'}>{b.isActive ? tc('yes') : tc('no')}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {b._count?.credentials || 0} / {b._count?.accounts || 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
