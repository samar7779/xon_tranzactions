'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, UserCog, MoreVertical, Search, X,
  Shield, Users, CheckCircle2, XCircle, KeyRound,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatDateTime } from '@/lib/utils';

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

const ROLE_COLORS: Record<string, { grad: string; bg: string; text: string }> = {
  SUPERADMIN: { grad: 'from-rose-500 to-red-600', bg: 'bg-rose-50', text: 'text-rose-700' },
  ADMIN: { grad: 'from-indigo-500 to-blue-600', bg: 'bg-indigo-50', text: 'text-indigo-700' },
  ACCOUNTANT: { grad: 'from-emerald-500 to-teal-600', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  VIEWER: { grad: 'from-slate-400 to-slate-500', bg: 'bg-slate-50', text: 'text-slate-700' },
};

function getRoleColor(role: string) {
  return ROLE_COLORS[role] || { grad: 'from-purple-500 to-violet-600', bg: 'bg-purple-50', text: 'text-purple-700' };
}

function getInitials(name?: string | null, email?: string) {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export default function AdminUsersPage() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const canManage = !!(me?.role === 'SUPERADMIN' || me?.permissions?.includes(PERMS.USERS_MANAGE));

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ items: AdminItem[] }>('/admin-users'),
  });
  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<{ items: RoleItem[] }>('/roles'),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminItem | null>(null);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin-users/${id}`),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  function openCreate() { setEditing(null); setOpen(true); }
  function openEdit(u: AdminItem) { setEditing(u); setOpen(true); }

  // Filter
  let filtered = data?.items || [];
  if (q) {
    const ql = q.toLowerCase();
    filtered = filtered.filter((u) =>
      u.email.toLowerCase().includes(ql) || u.fullName?.toLowerCase().includes(ql)
    );
  }
  if (roleFilter !== 'all') {
    filtered = filtered.filter((u) => (u.roleRef?.id || u.role) === roleFilter);
  }

  const stats = useMemo(() => {
    const items = data?.items || [];
    return {
      total: items.length,
      active: items.filter((u) => u.isActive).length,
      admins: items.filter((u) => u.role === 'SUPERADMIN' || u.role === 'ADMIN').length,
      recent: items.filter((u) => u.lastLoginAt && (Date.now() - new Date(u.lastLoginAt).getTime() < 7 * 86400000)).length,
    };
  }, [data]);

  return (
    <>
      <Topbar
        title={t('adminUsers')}
        subtitle="Foydalanuvchilarni boshqaring va rollar tayinlang"
        actions={canManage ? (
          <Button size="sm" onClick={openCreate} className="bg-white text-indigo-700 hover:bg-white/90 rounded-full font-semibold shadow-sm">
            <Plus className="h-3.5 w-3.5 mr-1.5" />Yangi admin
          </Button>
        ) : null}
      />

      <div className="flex-1 p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto w-full">

        {/* ═══ KPI ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile label="Jami" value={String(stats.total)} icon={Users} color="indigo" />
          <KpiTile label="Faol" value={String(stats.active)} icon={CheckCircle2} color="emerald" />
          <KpiTile label="Adminlar" value={String(stats.admins)} icon={Shield} color="rose" />
          <KpiTile label="Oxirgi 7 kun kirgan" value={String(stats.recent)} icon={UserCog} color="cyan" />
        </div>

        {/* ═══ Filter ═══ */}
        <Card className="border-0 shadow-soft">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  className="pl-9 h-10 rounded-xl bg-slate-50/60 border-slate-200 focus-visible:bg-white"
                  placeholder="Email yoki ism..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" onClick={() => setQ('')}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className={cn(
                  "h-10 rounded-xl text-sm font-medium w-auto min-w-[160px] border-0",
                  roleFilter !== 'all'
                    ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                    : "bg-slate-50 ring-1 ring-slate-200 text-slate-700",
                )}>
                  <SelectValue placeholder="Hamma rollar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hamma rollar</SelectItem>
                  {(roles?.items || []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* ═══ User Grid ═══ */}
        {isLoading ? (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="p-0">
            <EmptyState icon={UserCog} title="Foydalanuvchilar yo'q" description="Birinchi adminni qo'shish uchun yuqoridagi tugmani bosing" />
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((u) => {
              const role = u.roleRef?.label || u.role;
              const roleKey = u.role;
              const c = getRoleColor(roleKey);
              return (
                <Card key={u.id} className="group border-0 shadow-soft card-hover overflow-hidden relative">
                  <div className={cn("h-1.5 bg-gradient-to-r", c.grad)} />
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          "w-12 h-12 rounded-full grid place-items-center shrink-0 shadow-sm text-white text-sm font-bold bg-gradient-to-br",
                          c.grad,
                        )}>
                          {getInitials(u.fullName, u.email)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[14px] font-bold truncate tracking-tight">{u.fullName || '—'}</div>
                          <div className="text-[11px] text-slate-500 truncate">{u.email}</div>
                        </div>
                      </div>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 -mr-1">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(u)}>
                              <Pencil className="h-4 w-4 mr-2" /> Tahrirlash
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-rose-600" onClick={() => confirm(tc('confirmDelete')) && removeMut.mutate(u.id)}>
                              <Trash2 className="h-4 w-4 mr-2" /> O'chirish
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset", c.bg, c.text)} style={{ borderColor: 'transparent' }}>
                        <Shield className="h-3 w-3" /> {role}
                      </span>
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 ring-inset",
                        u.isActive ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-500 ring-slate-200",
                      )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", u.isActive ? "bg-emerald-500" : "bg-slate-300")} />
                        {u.isActive ? 'Faol' : 'Bloklangan'}
                      </span>
                    </div>

                    <div className="rounded-xl bg-slate-50/60 ring-1 ring-slate-100 px-3 py-2 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Oxirgi kirish</span>
                        <span className="text-slate-700">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Hech qachon'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Yaratilgan</span>
                        <span className="text-slate-700">{formatDateTime(u.createdAt)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
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

function KpiTile({
  label, value, icon: Icon, color,
}: {
  label: string;
  value: string;
  icon: any;
  color: 'indigo' | 'emerald' | 'rose' | 'cyan';
}) {
  const m = {
    indigo:  { grad: 'from-indigo-500 to-blue-600' },
    emerald: { grad: 'from-emerald-500 to-teal-600' },
    rose:    { grad: 'from-rose-500 to-red-600' },
    cyan:    { grad: 'from-cyan-500 to-sky-600' },
  }[color];
  return (
    <Card className="border-0 shadow-soft card-hover relative overflow-hidden">
      <div className={cn("absolute -top-12 -right-12 w-32 h-32 rounded-full blur-2xl opacity-30 bg-gradient-to-br", m.grad)} />
      <CardContent className="p-5 relative">
        <div className="flex items-start justify-between mb-2">
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500">{label}</div>
          <div className={cn("w-9 h-9 rounded-xl grid place-items-center bg-gradient-to-br text-white shadow-sm", m.grad)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-3xl font-bold tracking-tight tabular-nums">{value}</div>
      </CardContent>
    </Card>
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
                className="accent-indigo-600 h-4 w-4 rounded" />
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
