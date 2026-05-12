'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, UserCog } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { formatDateTime } from '@/lib/utils';

interface AdminItem {
  id: string;
  email: string;
  fullName?: string | null;
  role: string;
  roleId?: string | null;
  roleRef?: { id: string; name: string; label: string } | null;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
}

interface RoleItem { id: string; name: string; label: string }

export default function AdminUsersPage() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = user?.role === 'SUPERADMIN' || user?.permissions?.includes(PERMS.USERS_MANAGE);

  const { data } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ items: AdminItem[] }>('/admin-users'),
  });
  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<{ items: RoleItem[] }>('/roles'),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminItem | null>(null);

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin-users/${id}`),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  function openCreate() { setEditing(null); setOpen(true); }
  function openEdit(u: AdminItem) { setEditing(u); setOpen(true); }

  return (
    <>
      <Topbar title={t('adminUsers')} subtitle="Foydalanuvchilarni boshqaring va rollar tayinlang" />
      <div className="flex-1 p-6 lg:p-8 space-y-4">
        {canManage && (
          <div className="flex justify-end">
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Yangi admin</Button>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {(data?.items?.length ?? 0) === 0 ? (
              <EmptyState icon={UserCog} title="Foydalanuvchilar yo'q" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Foydalanuvchi</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Holat</TableHead>
                    <TableHead>Oxirgi kirish</TableHead>
                    <TableHead>Yaratilgan</TableHead>
                    {canManage && <TableHead className="text-right">{tc('actions')}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.items.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white text-sm font-semibold shrink-0">
                            {(u.fullName || u.email).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{u.fullName || '—'}</div>
                            <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{u.roleRef?.label || u.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.isActive ? 'success' : 'muted'}>
                          {u.isActive ? tc('yes') : tc('no')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(u.lastLoginAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(u.createdAt)}</TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <div className="inline-flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost"
                              onClick={() => confirm(tc('confirmDelete')) && removeMut.mutate(u.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <UserDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        roles={roles?.items || []}
      />
    </>
  );
}

function UserDialog({
  open, onOpenChange, editing, roles,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: AdminItem | null;
  roles: RoleItem[];
}) {
  const tc = useTranslations('common');
  const qc = useQueryClient();

  const [form, setForm] = useState({
    email: '', password: '', fullName: '', roleId: '', isActive: true,
  });

  useEffect(() => {
    if (open) {
      if (editing) {
        setForm({
          email: editing.email,
          password: '',
          fullName: editing.fullName || '',
          roleId: editing.roleId || '',
          isActive: editing.isActive,
        });
      } else {
        setForm({ email: '', password: '', fullName: '', roleId: '', isActive: true });
      }
    }
  }, [open, editing]);

  const mut = useMutation({
    mutationFn: async () => {
      if (editing) {
        return api.patch(`/admin-users/${editing.id}`, {
          fullName: form.fullName || undefined,
          roleId: form.roleId || null,
          isActive: form.isActive,
          password: form.password || undefined,
        });
      }
      return api.post('/admin-users', {
        email: form.email,
        password: form.password,
        fullName: form.fullName || undefined,
        roleId: form.roleId || undefined,
      });
    },
    onSuccess: () => {
      toast.success(tc('success'));
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Adminni tahrirlash' : 'Yangi admin'}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Email o'zgartirib bo'lmaydi. Parol bo'sh qoldirsangiz o'zgartirilmaydi."
              : 'Yangi admin yarating va rol tayinlang'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              disabled={!!editing}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="user@xon.local"
            />
          </div>
          <div className="space-y-2">
            <Label>{editing ? "Yangi parol (ixtiyoriy)" : "Parol"}</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="kamida 8 belgi"
            />
          </div>
          <div className="space-y-2">
            <Label>To'liq ism</Label>
            <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Rol</Label>
            <Select value={form.roleId} onValueChange={(v) => setForm({ ...form, roleId: v })}>
              <SelectTrigger><SelectValue placeholder="Rolni tanlang" /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="accent-primary" />
              <span>Faol foydalanuvchi</span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || (!editing && (!form.email || !form.password))}>
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
