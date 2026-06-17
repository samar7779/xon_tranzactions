'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, UserCog, MoreVertical, Search, X,
  Shield, Users, CheckCircle2, XCircle, KeyRound,
  LayoutGrid, List, Mail, Clock, Sparkles, Crown, Lock, Activity,
  Eye, EyeOff, Copy,
} from 'lucide-react';
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
  roleId?: string | null;
  roleRef?: { id: string; name: string; label: string } | null;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
}

interface RoleItem { id: string; name: string; label: string }

const ROLE_COLORS: Record<string, { grad: string; bg: string; text: string }> = {
  SUPERADMIN: { grad: 'from-rose-500 to-red-600', bg: 'bg-rose-50 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-300' },
  ADMIN: { grad: 'from-indigo-500 to-blue-600', bg: 'bg-indigo-50 dark:bg-indigo-950/40', text: 'text-indigo-700 dark:text-indigo-300' },
  ACCOUNTANT: { grad: 'from-emerald-500 to-teal-600', bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300' },
  VIEWER: { grad: 'from-slate-400 to-slate-500', bg: 'bg-slate-50 dark:bg-slate-900', text: 'text-slate-700 dark:text-slate-300' },
};

function getRoleColor(role: string) {
  return ROLE_COLORS[role] || { grad: 'from-purple-500 to-violet-600', bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-300' };
}

function getInitials(name?: string | null, email?: string) {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export default function AdminUsersPage() {
  const t = useTranslations('adminUsers');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const canManage = !!me?.permissions?.includes(PERMS.USERS_MANAGE);

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
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin-users/${id}`),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: any) => toast.error(e?.message),
  });
  const toggleActiveMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/admin-users/${id}`, { isActive }),
    onSuccess: (_d, v) => {
      toast.success(v.isActive ? t('userActivated') : t('userBlocked'));
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
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
    filtered = filtered.filter((u) => u.roleRef?.id === roleFilter);
  }

  const stats = useMemo(() => {
    const items = data?.items || [];
    return {
      total: items.length,
      active: items.filter((u) => u.isActive).length,
      admins: items.filter((u) => !!u.roleRef).length,
      recent: items.filter((u) => u.lastLoginAt && (Date.now() - new Date(u.lastLoginAt).getTime() < 7 * 86400000)).length,
    };
  }, [data]);

  return (
    <>
      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full">
        {/* ═══ KPI ═══ (header olib tashlandi) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile label={tc('total')} value={String(stats.total)} icon={Users} color="indigo" />
          <KpiTile label={t('kpiActive')} value={String(stats.active)} icon={CheckCircle2} color="emerald" />
          <KpiTile label={t('kpiBlocked')} value={String(stats.total - stats.active)} icon={XCircle} color="rose" />
          <KpiTile label={t('kpiLast7Days')} value={String(stats.recent)} icon={Activity} color="cyan" />
        </div>

        {/* ═══ Action bar: Yangi admin (chap) + Search + Filter + View Toggle (o'ng) ═══ */}
        <div className="flex items-center gap-3 flex-wrap">
          {canManage && (
            <Button onClick={openCreate} className="rounded-xl font-semibold h-10 shadow-md
                                                    bg-gradient-to-br from-indigo-600 to-violet-600
                                                    hover:from-indigo-700 hover:to-violet-700">
              <Plus className="h-4 w-4 mr-1.5" /> {t('newAdmin')}
            </Button>
          )}

          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
            <Input
              className="pl-9 h-10 rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus-visible:bg-white dark:focus-visible:bg-slate-900"
              placeholder={t('searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300" onClick={() => setQ('')}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className={cn(
              "h-10 rounded-xl text-sm font-medium w-auto min-w-[160px] border-0",
              roleFilter !== 'all'
                ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-900"
                : "bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-300",
            )}>
              <SelectValue placeholder={t('allRoles')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allRoles')}</SelectItem>
              {(roles?.items || []).map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View toggle — Card / Table */}
          <div className="inline-flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl h-10">
            <button
              onClick={() => setViewMode('card')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] font-semibold transition-colors',
                viewMode === 'card' ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
              )}
              title={t('cardViewTitle')}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              {t('cardView')}
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] font-semibold transition-colors',
                viewMode === 'table' ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
              )}
              title={t('tableViewTitle')}
            >
              <List className="h-3.5 w-3.5" />
              {t('tableView')}
            </button>
          </div>
        </div>

        {/* ═══ Content ═══ */}
        {isLoading ? (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="p-0">
            <EmptyState icon={UserCog} title={t('emptyTitle')} description={t('emptyDesc')} />
          </CardContent></Card>
        ) : viewMode === 'card' ? (
          <div className="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((u) => (
              <ProAdminCard
                key={u.id}
                user={u}
                canManage={canManage}
                onEdit={() => openEdit(u)}
                onToggle={() => toggleActiveMut.mutate({ id: u.id, isActive: !u.isActive })}
                onDelete={() => confirm(tc('confirmDelete')) && removeMut.mutate(u.id)}
              />
            ))}
          </div>
        ) : (
          <AdminTable
            items={filtered}
            canManage={canManage}
            onEdit={openEdit}
            onToggle={(u) => toggleActiveMut.mutate({ id: u.id, isActive: !u.isActive })}
            onDelete={(u) => confirm(tc('confirmDelete')) && removeMut.mutate(u.id)}
          />
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
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500 dark:text-slate-400">{label}</div>
          <div className={cn("w-9 h-9 rounded-xl grid place-items-center bg-gradient-to-br text-white shadow-sm", m.grad)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-3xl font-bold tracking-tight tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Pro admin kartochkasi — glass, hover glow, status efekt (active/blocked).
 */
function ProAdminCard({
  user: u, canManage, onEdit, onToggle, onDelete,
}: {
  user: AdminItem;
  canManage: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('adminUsers');
  const tc = useTranslations('common');
  const role = u.roleRef?.label || t('noRoleAssigned');
  const roleKey = u.roleRef?.name || '';
  const c = getRoleColor(roleKey);
  const isSuper = roleKey === 'SUPERADMIN';
  const isActive = u.isActive;

  // Oxirgi kirish — yaqindami yoki uzoq?
  const lastLoginAgo = u.lastLoginAt ? Math.floor((Date.now() - new Date(u.lastLoginAt).getTime()) / 86400000) : null;
  const isOnline = lastLoginAgo !== null && lastLoginAgo === 0;
  const isRecent = lastLoginAgo !== null && lastLoginAgo <= 7;

  return (
    <div className="group relative">
      {/* Glow halo */}
      <div className={cn(
        "absolute -inset-0.5 rounded-2xl bg-gradient-to-br opacity-0 group-hover:opacity-40 blur-xl transition-opacity duration-500 -z-10",
        isActive ? c.grad : 'from-slate-400 to-slate-600',
      )} />

      <div className={cn(
        "relative bg-white dark:bg-slate-900 rounded-2xl ring-1 overflow-hidden transition-all duration-300",
        "shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.18)]",
        "hover:-translate-y-1",
        isActive
          ? "ring-slate-200/80 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600"
          : "ring-rose-200 dark:ring-rose-900 grayscale-[60%] opacity-80 hover:opacity-100 hover:grayscale-0",
      )}>
        {/* Top accent bar */}
        <div className={cn("h-1 bg-gradient-to-r", c.grad)} />

        {/* Bloklangan watermark */}
        {!isActive && (
          <div className="absolute top-3 right-12 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                          bg-rose-100 dark:bg-rose-950/40 ring-1 ring-rose-300 dark:ring-rose-900 text-rose-700 dark:text-rose-300 text-[10px] font-bold uppercase tracking-wider
                          animate-pulse">
            <Lock className="h-2.5 w-2.5" /> {t('blocked')}
          </div>
        )}

        {/* Online pulse */}
        {isActive && isOnline && (
          <div className="absolute top-3 right-12 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                          bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-300 dark:ring-emerald-900 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
              <span className="relative rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Online
          </div>
        )}

        <div className="p-5">
          {/* Header */}
          <div className="flex items-start gap-4 mb-4">
            <div className="relative shrink-0">
              {/* Avatar glow */}
              <div className={cn(
                "absolute inset-0 rounded-2xl bg-gradient-to-br blur-lg opacity-50",
                c.grad,
              )} />
              <div className={cn(
                "relative w-14 h-14 rounded-2xl bg-gradient-to-br grid place-items-center text-white font-bold text-base",
                "ring-2 ring-white dark:ring-slate-900 shadow-md",
                c.grad,
              )}>
                {getInitials(u.fullName, u.email)}
              </div>
              {/* Status dot */}
              <span className={cn(
                "absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full ring-2 ring-white dark:ring-slate-900 grid place-items-center",
                isActive ? 'bg-emerald-500' : 'bg-rose-500',
              )}>
                {isActive
                  ? <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                  : <XCircle className="h-2.5 w-2.5 text-white" />}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate">
                  {u.fullName || '—'}
                </span>
                {isSuper && <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
              </div>
              <div className="flex items-center gap-1 mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400 min-w-0">
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">{u.email}</span>
              </div>
            </div>

            {/* Quick actions — hover'da */}
            {canManage && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={onEdit}
                  title={tc('edit')}
                  className="w-8 h-8 rounded-lg grid place-items-center bg-slate-100 dark:bg-slate-800 hover:bg-indigo-600 text-slate-600 dark:text-slate-300 hover:text-white transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={onToggle}
                  title={isActive ? t('block') : t('activate')}
                  className={cn(
                    "w-8 h-8 rounded-lg grid place-items-center transition-colors",
                    isActive
                      ? "bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 text-slate-600 dark:text-slate-300 hover:text-white"
                      : "bg-slate-100 dark:bg-slate-800 hover:bg-emerald-600 text-slate-600 dark:text-slate-300 hover:text-white",
                  )}
                >
                  {isActive ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={onDelete}
                  title={tc('delete')}
                  className="w-8 h-8 rounded-lg grid place-items-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 text-slate-600 dark:text-slate-300 hover:text-white transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Role badge */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold ring-1 ring-inset",
              c.bg, c.text,
            )}>
              {isSuper ? <Crown className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
              {role}
            </span>
            {isRecent && isActive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                               bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold">
                <Sparkles className="h-2.5 w-2.5" /> {t('activeUser')}
              </span>
            )}
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-gradient-to-br from-slate-50 dark:from-slate-800 to-slate-100/60 dark:to-slate-800/60 ring-1 ring-slate-100 dark:ring-slate-700">
            <div className="space-y-0.5">
              <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {t('lastLogin')}
              </div>
              <div className="text-[11.5px] font-semibold text-slate-700 dark:text-slate-300">
                {u.lastLoginAt
                  ? lastLoginAgo === 0
                    ? <span className="text-emerald-700 dark:text-emerald-300">{tc('today')}</span>
                    : lastLoginAgo === 1
                      ? <span className="text-emerald-600 dark:text-emerald-400">{tc('yesterday')}</span>
                      : lastLoginAgo && lastLoginAgo <= 7
                        ? <span className="text-amber-600 dark:text-amber-400">{t('daysAgo', { n: lastLoginAgo })}</span>
                        : <span className="text-slate-500 dark:text-slate-400">{t('daysAgo', { n: lastLoginAgo })}</span>
                  : <span className="text-slate-400 dark:text-slate-500 italic">{t('never')}</span>}
              </div>
            </div>
            <div className="space-y-0.5 text-right">
              <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                {t('created')}
              </div>
              <div className="text-[11.5px] font-semibold text-slate-700 dark:text-slate-300">
                {formatDateTime(u.createdAt)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Admin jadval ko'rinishi — kompakt, tartibli ro'yxat.
 */
function AdminTable({
  items, canManage, onEdit, onToggle, onDelete,
}: {
  items: AdminItem[];
  canManage: boolean;
  onEdit: (u: AdminItem) => void;
  onToggle: (u: AdminItem) => void;
  onDelete: (u: AdminItem) => void;
}) {
  const t = useTranslations('adminUsers');
  const tc = useTranslations('common');
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 uppercase text-[10.5px] tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">{t('colUser')}</th>
              <th className="text-left px-3 py-3">{t('colRole')}</th>
              <th className="text-left px-3 py-3">{tc('status')}</th>
              <th className="text-left px-3 py-3">{t('lastLogin')}</th>
              <th className="text-left px-3 py-3">{t('created')}</th>
              <th className="text-right px-4 py-3">{tc('actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {items.map((u) => {
              const role = u.roleRef?.label || '—';
              const roleKey = u.roleRef?.name || '';
              const c = getRoleColor(roleKey);
              const isSuper = roleKey === 'SUPERADMIN';
              return (
                <tr key={u.id} className={cn(
                  "hover:bg-slate-50/60 dark:hover:bg-slate-800 transition-colors",
                  !u.isActive && "opacity-50 bg-rose-50/30 dark:bg-rose-950/20",
                )}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-9 h-9 rounded-full grid place-items-center text-white text-[11px] font-bold bg-gradient-to-br shrink-0",
                        c.grad,
                      )}>
                        {getInitials(u.fullName, u.email)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                          {u.fullName || '—'}
                          {isSuper && <Crown className="h-3 w-3 text-amber-500" />}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold", c.bg, c.text)}>
                      <Shield className="h-2.5 w-2.5" /> {role}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {u.isActive ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 text-[12px] font-semibold">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        {t('active')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 text-[12px] font-semibold">
                        <Lock className="h-3 w-3" />
                        {t('blocked')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-700 dark:text-slate-300 text-[12px]">
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <span className="text-slate-400 dark:text-slate-500 italic">{t('never')}</span>}
                  </td>
                  <td className="px-3 py-3 text-slate-700 dark:text-slate-300 text-[12px]">
                    {formatDateTime(u.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManage && (
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => onEdit(u)}
                          title={tc('edit')}
                          className="w-8 h-8 rounded-lg grid place-items-center bg-slate-100 dark:bg-slate-800 hover:bg-indigo-600 text-slate-600 dark:text-slate-300 hover:text-white transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => onToggle(u)}
                          title={u.isActive ? t('block') : t('activate')}
                          className={cn(
                            "w-8 h-8 rounded-lg grid place-items-center transition-colors",
                            u.isActive
                              ? "bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 text-slate-600 dark:text-slate-300 hover:text-white"
                              : "bg-slate-100 dark:bg-slate-800 hover:bg-emerald-600 text-slate-600 dark:text-slate-300 hover:text-white",
                          )}
                        >
                          {u.isActive ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => onDelete(u)}
                          title={tc('delete')}
                          className="w-8 h-8 rounded-lg grid place-items-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 text-slate-600 dark:text-slate-300 hover:text-white transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  const t = useTranslations('adminUsers');
  const tc = useTranslations('common');
  const qc = useQueryClient();

  const [form, setForm] = useState({
    email: '', password: '', fullName: '', roleId: '', isActive: true,
  });
  const [showPassword, setShowPassword] = useState(false);

  // Kuchli tasodifiy parol — har turdan kamida bittadan (12 belgi)
  function generatePassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // I, O olib tashlangan (chalkashmaslik uchun)
    const lower = 'abcdefghijkmnpqrstuvwxyz';    // l, o olib tashlangan
    const digits = '23456789';                   // 0, 1 olib tashlangan
    const symbols = '!@#$%&*?';
    const all = upper + lower + digits + symbols;
    const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
    const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
    for (let i = chars.length; i < 12; i++) chars.push(pick(all));
    // Aralashtirish (Fisher–Yates)
    for (let i = chars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const pwd = chars.join('');
    setForm((f) => ({ ...f, password: pwd }));
    setShowPassword(true);
  }

  async function copyPassword() {
    if (!form.password) return;
    try {
      await navigator.clipboard.writeText(form.password);
      toast.success(tc('copied'));
    } catch {
      toast.error(tc('copyError'));
    }
  }

  useEffect(() => {
    if (open) {
      setShowPassword(false);
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
          <DialogTitle>{editing ? t('editAdmin') : t('newAdmin')}</DialogTitle>
          <DialogDescription>
            {editing
              ? t('editAdminDesc')
              : t('newAdminDesc')}
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
            <div className="flex items-center justify-between">
              <Label>{editing ? t('newPasswordOptional') : t('password')}</Label>
              <button
                type="button"
                onClick={generatePassword}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" /> {t('autoPassword')}
              </button>
            </div>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={t('passwordPlaceholder')}
                className="pr-[4.5rem] font-mono tracking-wide"
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? t('hide') : t('show')}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={copyPassword}
                  disabled={!form.password}
                  title={tc('copy')}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('fullName')}</Label>
            <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>{t('role')}</Label>
            <Select value={form.roleId} onValueChange={(v) => setForm({ ...form, roleId: v })}>
              <SelectTrigger><SelectValue placeholder={t('selectRole')} /></SelectTrigger>
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
              <span>{t('activeUser')}</span>
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
