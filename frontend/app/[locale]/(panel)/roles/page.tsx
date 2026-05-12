'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, ShieldCheck, Pencil, Trash2, Lock } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
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

export default function RolesPage() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = user?.role === 'SUPERADMIN' || user?.permissions?.includes(PERMS.ROLES_MANAGE);

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

  return (
    <>
      <Topbar title={t('roles')} subtitle="Rollarni boshqaring va har biriga ruxsatlar bering" />
      <div className="flex-1 p-6 lg:p-8 space-y-4">
        {canManage && (
          <div className="flex justify-end">
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Yangi rol</Button>
          </div>
        )}

        {(rolesData?.items?.length ?? 0) === 0 ? (
          <Card><CardContent className="p-0"><EmptyState icon={ShieldCheck} title="Hali rollar yo'q" /></CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rolesData!.items.map((r) => (
              <Card key={r.id} className="hover:shadow-soft transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-semibold truncate">{r.label}</span>
                        {r.isSystem && (
                          <Badge variant="muted" className="ml-1 gap-1">
                            <Lock className="h-3 w-3" /> system
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground mt-0.5">{r.name}</div>
                      {r.description && (
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{r.description}</p>
                      )}
                    </div>
                    {canManage && !r.isSystem && (
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => confirm(tc('confirmDelete')) && removeMut.mutate(r.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                    {canManage && r.isSystem && (
                      <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-1">
                    {r.permissions.slice(0, 6).map((p) => (
                      <span key={p} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{p}</span>
                    ))}
                    {r.permissions.length > 6 && (
                      <span className="text-[10px] text-muted-foreground">+{r.permissions.length - 6}</span>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                    <span>{r.permissions.length} ruxsat</span>
                    <span>{r._count?.users ?? 0} foydalanuvchi</span>
                  </div>
                </CardContent>
              </Card>
            ))}
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

  useMemo(() => {
    if (editing) {
      setName(editing.name);
      setLabel(editing.label);
      setDescription(editing.description || '');
      setPermissions(new Set(editing.permissions));
    } else {
      setName(''); setLabel(''); setDescription(''); setPermissions(new Set());
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

  const isSystem = editing?.isSystem === true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Rolni tahrirlash — ${editing.label}` : 'Yangi rol'}</DialogTitle>
          <DialogDescription>
            {isSystem
              ? "Tizim roli — ruxsatlarini o'zgartirib bo'lmaydi, lekin nomi va tavsifini almashtirish mumkin"
              : "Rolga nom bering va kerakli ruxsatlarni belgilang"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
              <span className="text-xs text-muted-foreground font-normal">{permissions.size} ta belgilangan</span>
            </Label>
            <div className="border rounded-lg divide-y max-h-[40vh] overflow-y-auto">
              {permGroups.map((g) => {
                const all = g.items.every((i) => permissions.has(i.value));
                const some = g.items.some((i) => permissions.has(i.value));
                return (
                  <div key={g.group} className="p-3">
                    <button type="button"
                      disabled={isSystem}
                      onClick={() => toggleGroup(g.items)}
                      className={cn(
                        "flex items-center justify-between w-full text-left text-sm font-medium mb-2",
                        isSystem && "cursor-not-allowed",
                      )}
                    >
                      <span>{g.group}</span>
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded",
                        all ? "bg-primary/10 text-primary" : some ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground",
                      )}>{g.items.filter((i) => permissions.has(i.value)).length}/{g.items.length}</span>
                    </button>
                    <div className="grid sm:grid-cols-2 gap-1">
                      {g.items.map((i) => (
                        <label key={i.value}
                          className={cn(
                            "flex items-start gap-2 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-muted/60",
                            isSystem && "cursor-not-allowed opacity-70",
                          )}
                        >
                          <input
                            type="checkbox"
                            disabled={isSystem}
                            checked={permissions.has(i.value)}
                            onChange={() => togglePerm(i.value)}
                            className="mt-0.5 accent-primary"
                          />
                          <span className="flex-1">
                            <div>{i.label}</div>
                            <div className="text-[10px] font-mono text-muted-foreground">{i.value}</div>
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || (!editing && !name) || !label}>
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
