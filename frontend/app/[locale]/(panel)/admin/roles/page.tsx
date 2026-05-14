'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, ShieldCheck, Pencil, Trash2, Lock, MoreVertical,
  Users, Shield, Check,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface PermGroup { group: string; items: { value: string; label: string }[] }
interface Role {
  id: string; name: string; label: string; description?: string;
  permissions: string[]; isSystem: boolean;
  _count?: { users: number };
}

const ROLE_GRADIENTS: Record<string, string> = {
  SUPERADMIN: 'from-rose-500 to-red-600',
  ADMIN: 'from-indigo-500 to-blue-600',
  ACCOUNTANT: 'from-emerald-500 to-teal-600',
  VIEWER: 'from-slate-400 to-slate-500',
};

function getRoleGrad(name: string) {
  return ROLE_GRADIENTS[name] || 'from-purple-500 to-violet-600';
}

export default function RolesPage() {
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = !!user?.permissions?.includes(PERMS.ROLES_MANAGE);

  const { data: rolesData } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<{ items: Role[] }>('/roles'),
  });
  const { data: permCatalog } = useQuery({
    queryKey: ['roles-permissions'],
    queryFn: () => api.get<{ all: string[]; groups: PermGroup[] }>('/roles/permissions'),
  });

  const [editing, setEditing] = useState<Role | null>(null);
  const [open, setOpen] = useState(false);

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/roles/${id}`),
    onSuccess: () => { toast.success(tc('success')); qc.invalidateQueries({ queryKey: ['roles'] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  function openCreate() { setEditing(null); setOpen(true); }
  function openEdit(r: Role) { setEditing(r); setOpen(true); }

  const totalPerms = permCatalog?.all?.length || 0;

  return (
    <>
      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold tracking-tight">Rollar</div>
            <div className="text-xs text-slate-500">Rollarni boshqaring va har biriga ruxsatlar bering</div>
          </div>
          {canManage && (
            <Button size="sm" onClick={openCreate} className="rounded-full font-semibold">
              <Plus className="h-3.5 w-3.5 mr-1.5" />Yangi rol
            </Button>
          )}
        </div>

        {(rolesData?.items?.length ?? 0) === 0 ? (
          <Card><CardContent className="p-0"><EmptyState icon={ShieldCheck} title="Hali rollar yo'q" /></CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rolesData!.items.map((r) => {
              const grad = getRoleGrad(r.name);
              const coverage = totalPerms > 0 ? Math.round((r.permissions.length / totalPerms) * 100) : 0;
              return (
                <Card key={r.id} className="group relative border-0 shadow-soft card-hover overflow-hidden">
                  <div className={cn("h-1.5 bg-gradient-to-r", grad)} />
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn("w-11 h-11 rounded-xl bg-gradient-to-br grid place-items-center text-white shrink-0 shadow-sm", grad)}>
                          <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[14px] font-bold tracking-tight truncate">{r.label}</span>
                            {r.isSystem && <Lock className="h-3 w-3 text-slate-400 shrink-0" />}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 truncate">{r.name}</div>
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
                            <DropdownMenuItem onClick={() => openEdit(r)}>
                              <Pencil className="h-4 w-4 mr-2" /> Tahrirlash
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-rose-600" onClick={() => confirm(tc('confirmDelete')) && removeMut.mutate(r.id)}>
                              <Trash2 className="h-4 w-4 mr-2" /> O'chirish
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    {r.description && (
                      <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed mb-3">{r.description}</p>
                    )}

                    {/* Coverage bar */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                        <span>Ruxsatlar qamrovi</span>
                        <span className="font-semibold tabular-nums text-slate-700">{r.permissions.length} / {totalPerms}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className={cn("h-full bg-gradient-to-r transition-all", grad)} style={{ width: `${coverage}%` }} />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-3">
                      {r.permissions.slice(0, 4).map((p) => (
                        <span key={p} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-50 ring-1 ring-slate-100 text-slate-600">{p}</span>
                      ))}
                      {r.permissions.length > 4 && (
                        <span className="text-[10px] text-slate-500 font-medium px-1">+{r.permissions.length - 4}</span>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <Users className="h-3 w-3" /> {r._count?.users ?? 0} ta foydalanuvchi
                      </span>
                      {r.isSystem && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                          <Lock className="h-2.5 w-2.5" /> System
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <RoleDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        permGroups={permCatalog?.groups || []}
      />
    </>
  );
}

function RoleDialog({
  open, onOpenChange, editing, permGroups,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Role | null;
  permGroups: PermGroup[];
}) {
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      if (editing) {
        setName(editing.name);
        setLabel(editing.label);
        setDescription(editing.description || '');
        setPermissions(new Set(editing.permissions));
      } else {
        setName(''); setLabel(''); setDescription(''); setPermissions(new Set());
      }
    }
  }, [editing, open]);

  const mut = useMutation({
    mutationFn: async () => {
      const body = { label, description, permissions: [...permissions] };
      if (editing) return api.patch(`/roles/${editing.id}`, body);
      return api.post('/roles', { name: name.toUpperCase(), ...body });
    },
    onSuccess: () => {
      toast.success(tc('success'));
      qc.invalidateQueries({ queryKey: ['roles'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message),
  });

  function togglePerm(p: string) {
    setPermissions((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }
  function toggleGroup(items: { value: string }[]) {
    const allSelected = items.every((i) => permissions.has(i.value));
    setPermissions((prev) => {
      const next = new Set(prev);
      if (allSelected) items.forEach((i) => next.delete(i.value));
      else items.forEach((i) => next.add(i.value));
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 px-6 py-5 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-dots opacity-15" />
          <div className="relative">
            <DialogHeader className="text-white">
              <DialogTitle className="text-white flex items-center gap-2">
                <Shield className="h-5 w-5" />
                {editing ? `${editing.label}` : 'Yangi rol yaratish'}
              </DialogTitle>
              <DialogDescription className="text-white/80">
                Rolga nom bering va kerakli ruxsatlarni belgilang
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {!editing && (
            <div className="space-y-2">
              <Label>Tizim nomi (lotin, katta harf)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="ACCOUNTANT" className="font-mono" />
            </div>
          )}
          <div className="space-y-2">
            <Label>Ko'rinish nomi</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Hisobchi" />
          </div>
          <div className="space-y-2">
            <Label>Tavsif</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ixtiyoriy" />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center justify-between">
              <span>Ruxsatlar</span>
              <span className="text-xs text-slate-500 font-normal tabular-nums">
                <span className="font-bold text-indigo-700">{permissions.size}</span> ta belgilangan
              </span>
            </Label>
            <div className="border rounded-xl divide-y divide-slate-100 max-h-[44vh] overflow-y-auto bg-slate-50/40">
              {permGroups.map((g) => {
                const all = g.items.every((i) => permissions.has(i.value));
                const some = g.items.some((i) => permissions.has(i.value));
                const count = g.items.filter((i) => permissions.has(i.value)).length;
                return (
                  <div key={g.group} className="p-3 bg-white/60">
                    <button type="button"
                      onClick={() => toggleGroup(g.items)}
                      className="flex items-center justify-between w-full text-left text-sm font-semibold mb-2 hover:text-indigo-700 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <div className={cn(
                          "w-4 h-4 rounded grid place-items-center text-white text-[10px] transition-colors",
                          all ? "bg-indigo-600" : some ? "bg-amber-500" : "bg-slate-200",
                        )}>
                          {all && <Check className="h-3 w-3" />}
                          {!all && some && <span className="h-0.5 w-2 bg-white rounded" />}
                        </div>
                        {g.group}
                      </span>
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full tabular-nums",
                        all ? "bg-emerald-100 text-emerald-700" : some ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500",
                      )}>{count}/{g.items.length}</span>
                    </button>
                    <div className="grid sm:grid-cols-2 gap-1">
                      {g.items.map((i) => (
                        <label key={i.value}
                          className={cn(
                            "flex items-start gap-2 px-2 py-1.5 rounded-lg text-sm cursor-pointer hover:bg-slate-50 transition-colors",
                            permissions.has(i.value) && "bg-indigo-50/60",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={permissions.has(i.value)}
                            onChange={() => togglePerm(i.value)}
                            className="mt-0.5 accent-indigo-600 h-3.5 w-3.5 rounded"
                          />
                          <span className="flex-1">
                            <div className="text-[12px] font-medium text-slate-700">{i.label}</div>
                            <div className="text-[10px] font-mono text-slate-400">{i.value}</div>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 pb-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || (!editing && !name) || !label}>
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
