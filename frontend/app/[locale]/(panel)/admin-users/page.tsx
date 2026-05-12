'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export default function AdminUsersPage() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');

  const { data } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ items: any[] }>('/admin-users'),
  });

  return (
    <>
      <Topbar title={t('adminUsers')} />
      <div className="flex-1 p-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>FIO</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Faol</TableHead>
                  <TableHead>Oxirgi kirish</TableHead>
                  <TableHead>Yaratilgan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.items || []).map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>{u.fullName || '—'}</TableCell>
                    <TableCell><Badge variant="outline">{u.role}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={u.isActive ? 'success' : 'muted'}>{u.isActive ? tc('yes') : tc('no')}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(u.lastLoginAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(u.createdAt)}</TableCell>
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
