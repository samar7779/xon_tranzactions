'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, ShieldCheck, Pencil, Trash2, Lock, MoreVertical,
  Users, Shield, Check, ChevronDown, ChevronRight,
  Sparkles, Activity, Crown, Zap, Eye, Search, X, CheckCheck, FolderOpen,
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
interface PermItem { value: string; label: string; }
interface PermPage { name: string; description?: string; items: PermItem[]; }
interface PermModule { module: string; icon?: string; pages: PermPage[]; }
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

// Modul kartochkalari uchun rang palitrasi — index bo'yicha aylanadi
const MODULE_GRADIENTS = [
  'from-indigo-500 to-blue-600',
  'from-violet-500 to-purple-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-sky-600',
];

export default function RolesPage() {
  const t = useTranslations('roles');
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
    queryFn: () => api.get<{ all: string[]; groups: PermGroup[]; tree?: PermModule[] }>('/roles/permissions'),
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
            <div className="text-lg font-bold tracking-tight">{t('title')}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{t('subtitle')}</div>
          </div>
          {canManage && (
            <Button size="sm" onClick={openCreate} className="rounded-full font-semibold">
              <Plus className="h-3.5 w-3.5 mr-1.5" />{t('newRole')}
            </Button>
          )}
        </div>

        {(rolesData?.items?.length ?? 0) === 0 ? (
          <Card><CardContent className="p-0"><EmptyState icon={ShieldCheck} title={t('emptyTitle')} /></CardContent></Card>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {rolesData!.items.map((r) => {
              const grad = getRoleGrad(r.name);
              const coverage = totalPerms > 0 ? Math.round((r.permissions.length / totalPerms) * 100) : 0;
              return (
                <ProRoleCard
                  key={r.id}
                  role={r}
                  grad={grad}
                  coverage={coverage}
                  totalPerms={totalPerms}
                  canManage={canManage}
                  onEdit={() => openEdit(r)}
                  onDelete={() => confirm(tc('confirmDelete')) && removeMut.mutate(r.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      <RoleDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        permTree={permCatalog?.tree || []}
        permGroups={permCatalog?.groups || []}
      />
    </>
  );
}

function RoleDialog({
  open, onOpenChange, editing, permTree, permGroups,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Role | null;
  permTree: PermModule[];
  permGroups: PermGroup[];
}) {
  const t = useTranslations('roles');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  // Collapsible state — default'da barcha modullar yopiq (ustiga bosib ochiladi)
  const [openModules, setOpenModules] = useState<Set<string>>(new Set());
  const [openPages, setOpenPages] = useState<Set<string>>(new Set());
  const [permQuery, setPermQuery] = useState('');
  // "Ko'rinish nomi" va "Tavsif" — yashirin, sarlavhaga bosib ochiladi
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Modal har ochilganda modullar yopiq holatda boshlanadi (kerakligini ustiga bosib ochadi)
  useEffect(() => {
    if (open) {
      setOpenModules(new Set());
      setOpenPages(new Set());
      setDetailsOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setPermQuery('');
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
      // Joriy foydalanuvchining roli o'zgargan bo'lishi mumkin —
      // ruxsatlarni darrov /auth/me dan yangilaymiz (sidebar/route guard uchun).
      useAuth.getState().hydrate();
      // Modal yopilmaydi — user yana o'zgartirish kiritishi mumkin.
      // Faqat X yoki ESC bilan yopiladi.
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
  function toggleModule(mod: PermModule) {
    // Modul ichidagi barcha sahifa items ni toggle qilish
    const allItems = mod.pages.flatMap((p) => p.items);
    toggleGroup(allItems);
  }
  function toggleModuleExpand(name: string) {
    setOpenModules((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }
  function togglePageExpand(name: string) {
    setOpenPages((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  // Tree yo'q bo'lsa eski groups'dan tree quramiz (backward compat)
  const tree: PermModule[] = permTree.length > 0
    ? permTree
    : [{ module: t('allPermissions'), pages: permGroups.map((g) => ({ name: g.group, items: g.items })) }];

  // Qidiruv bo'yicha filtrlash — modul/sahifa/action label yoki value mos kelsa qoldiriladi
  const q = permQuery.trim().toLowerCase();
  const filteredTree: PermModule[] = !q
    ? tree
    : tree
        .map((mod) => {
          const modMatch = mod.module.toLowerCase().includes(q);
          const pages = mod.pages
            .map((p) => {
              const pageMatch = p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q);
              const items = modMatch || pageMatch
                ? p.items
                : p.items.filter((i) => i.label.toLowerCase().includes(q) || i.value.toLowerCase().includes(q));
              return { ...p, items };
            })
            .filter((p) => p.items.length > 0);
          return { ...mod, pages };
        })
        .filter((m) => m.pages.length > 0);

  // Ko'rinib turgan (filtrlangan) ruxsatlarni belgilash / tozalash
  function bulkVisible(select: boolean) {
    setPermissions((prev) => {
      const next = new Set(prev);
      filteredTree.forEach((m) => m.pages.forEach((p) => p.items.forEach((i) => {
        if (select) next.add(i.value); else next.delete(i.value);
      })));
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl w-[95vw] max-h-[96vh] h-[96vh] overflow-y-auto p-0 flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 px-6 py-5 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-dots opacity-15" />
          <div className="relative">
            <DialogHeader className="text-white">
              <DialogTitle className="text-white flex items-center gap-2">
                <Shield className="h-5 w-5" />
                {editing ? `${editing.label}` : t('createRole')}
              </DialogTitle>
              <DialogDescription className="text-white/80">
                {t('dialogDesc')}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {!editing && (
            <div className="space-y-2">
              <Label>{t('systemName')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="ACCOUNTANT" className="font-mono" />
            </div>
          )}
          {/* Ko'rinish nomi va Tavsif — yashirin, sarlavhaga bosib ochiladi */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
              {detailsOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('displayNameAndDesc')}</span>
              {!detailsOpen && label && (
                <span className="text-xs text-slate-400 dark:text-slate-500 truncate">· {label}</span>
              )}
            </button>
            {detailsOpen && (
              <div className="px-3 pb-3 pt-1 space-y-3 border-t border-slate-100 dark:border-slate-800">
                <div className="space-y-2">
                  <Label>{t('displayName')}</Label>
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('displayNamePlaceholder')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('description')}</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('optional')} />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Label className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="inline-grid place-items-center h-6 w-6 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm shadow-indigo-500/30">
                  <Lock className="h-3.5 w-3.5" />
                </span>
                <span>{t('permissions')}</span>
                <span className="hidden sm:inline text-[11px] font-normal text-slate-400 dark:text-slate-500">{t('permHint')}</span>
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-normal tabular-nums">
                <span className="font-bold text-indigo-700 dark:text-indigo-300">{permissions.size}</span> {t('selectedSuffix')}
              </span>
            </Label>

            {/* Toolbar — qidiruv + ommaviy belgilash/tozalash */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <Input
                  value={permQuery}
                  onChange={(e) => setPermQuery(e.target.value)}
                  placeholder={t('permSearchPlaceholder')}
                  className="pl-9 pr-9 h-9"
                />
                {permQuery && (
                  <button type="button" onClick={() => setPermQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 shrink-0"
                onClick={() => bulkVisible(true)}>
                <CheckCheck className="h-4 w-4" /> {tc('all')}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5 shrink-0 text-slate-500"
                onClick={() => bulkVisible(false)}>
                <X className="h-4 w-4" /> {tc('clear')}
              </Button>
            </div>

            <div className="space-y-2.5 max-h-[64vh] min-h-[360px] overflow-y-auto pr-1 -mr-1">
              {filteredTree.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400 dark:text-slate-500">
                  <Search className="h-8 w-8 opacity-40" />
                  <span className="text-sm">{t('permNotFound', { q: permQuery })}</span>
                </div>
              )}
              {filteredTree.map((mod, mi) => {
                const allItems = mod.pages.flatMap((p) => p.items);
                const modCount = allItems.filter((i) => permissions.has(i.value)).length;
                const modAll = allItems.length > 0 && modCount === allItems.length;
                const modSome = modCount > 0 && !modAll;
                const modPct = allItems.length ? Math.round((modCount / allItems.length) * 100) : 0;
                const isModOpen = !!q || openModules.has(mod.module);
                const grad = MODULE_GRADIENTS[mi % MODULE_GRADIENTS.length];
                return (
                  <div key={mod.module} className={cn(
                    "rounded-2xl border bg-white dark:bg-slate-900/50 overflow-hidden transition-all",
                    modCount > 0
                      ? "border-indigo-200/70 dark:border-indigo-900/50 shadow-sm shadow-indigo-500/5"
                      : "border-slate-200/80 dark:border-slate-700/50",
                  )}>
                    {/* MODUL header — bosish bilan ochiladi/yopiladi */}
                    <div className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <button type="button"
                        onClick={() => toggleModuleExpand(mod.module)}
                        className="text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors shrink-0">
                        {isModOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <span className={cn(
                        "inline-grid place-items-center h-8 w-8 rounded-xl text-white font-bold text-sm shrink-0 bg-gradient-to-br shadow-sm",
                        grad,
                      )}>
                        {mod.module.charAt(0).toUpperCase()}
                      </span>
                      <button type="button"
                        onClick={() => toggleModuleExpand(mod.module)}
                        className="flex flex-col items-start flex-1 min-w-0 text-left">
                        <span className="font-bold text-sm text-slate-800 dark:text-slate-200 truncate w-full">{mod.module}</span>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                          <FolderOpen className="h-3 w-3" /> {t('pagesCount', { n: mod.pages.length })}
                        </span>
                      </button>
                      <span className={cn(
                        "text-xs px-2.5 py-1 rounded-full tabular-nums font-semibold shrink-0",
                        modAll ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" : modSome ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
                      )}>{modCount}/{allItems.length}</span>
                      <button type="button"
                        onClick={() => toggleModule(mod)}
                        title={t('selectModulePerms')}
                        className={cn(
                          "w-5 h-5 rounded-md grid place-items-center text-white shrink-0 transition-colors",
                          modAll ? "bg-indigo-600" : modSome ? "bg-amber-500" : "bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600",
                        )}>
                        {modAll && <Check className="h-3.5 w-3.5" />}
                        {modSome && <span className="h-0.5 w-2.5 bg-white rounded" />}
                      </button>
                    </div>

                    {/* Progress chizig'i */}
                    <div className="h-1 bg-slate-100 dark:bg-slate-800">
                      <div className={cn("h-full bg-gradient-to-r transition-all duration-300", grad)} style={{ width: `${modPct}%` }} />
                    </div>

                    {/* PAGES — modul ochiq bo'lsa ko'rinadi */}
                    {isModOpen && (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                        {mod.pages.map((p) => {
                          const pageKey = `${mod.module}::${p.name}`;
                          const pageCount = p.items.filter((i) => permissions.has(i.value)).length;
                          const pageAll = pageCount === p.items.length;
                          const pageSome = pageCount > 0 && !pageAll;
                          const isPageOpen = !!q || openPages.has(pageKey);
                          return (
                            <div key={pageKey}>
                              {/* PAGE header */}
                              <div className="flex items-center gap-2 pl-4 pr-3 py-2 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-colors">
                                <button type="button"
                                  onClick={() => togglePageExpand(pageKey)}
                                  className="text-slate-300 dark:text-slate-600 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors shrink-0">
                                  {isPageOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </button>
                                <button type="button"
                                  onClick={() => toggleGroup(p.items)}
                                  title={t('selectPage')}
                                  className={cn(
                                    "w-4 h-4 rounded grid place-items-center text-white text-[9px] transition-colors shrink-0",
                                    pageAll ? "bg-indigo-600" : pageSome ? "bg-amber-500" : "bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600",
                                  )}>
                                  {pageAll && <Check className="h-2.5 w-2.5" />}
                                  {pageSome && <span className="h-0.5 w-1.5 bg-white rounded" />}
                                </button>
                                <button type="button"
                                  onClick={() => togglePageExpand(pageKey)}
                                  className="flex items-center gap-2 flex-1 min-w-0 text-left">
                                  <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 truncate">{p.name}</span>
                                  {p.description && <span className="hidden sm:inline text-[10px] text-slate-400 dark:text-slate-500 truncate">· {p.description}</span>}
                                </button>
                                <span className={cn(
                                  "text-[11px] px-2 py-0.5 rounded-full tabular-nums font-medium shrink-0",
                                  pageAll ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" : pageSome ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500",
                                )}>{pageCount}/{p.items.length}</span>
                              </div>

                              {/* ACTIONS — page ochiq bo'lsa */}
                              {isPageOpen && (
                                <div className="pl-10 pr-3 pb-3 pt-0.5 grid sm:grid-cols-2 gap-1.5">
                                  {p.items.map((i) => {
                                    const checked = permissions.has(i.value);
                                    return (
                                      <label key={i.value}
                                        className={cn(
                                          "group flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm cursor-pointer border transition-all",
                                          checked
                                            ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 ring-1 ring-indigo-200/60 dark:ring-indigo-800/60"
                                            : "bg-slate-50/60 dark:bg-slate-800/30 border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-white dark:hover:bg-slate-800",
                                        )}
                                      >
                                        <span className={cn(
                                          "grid place-items-center h-4 w-4 rounded-[5px] border-2 shrink-0 transition-colors",
                                          checked ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300 dark:border-slate-600 group-hover:border-indigo-400",
                                        )}>
                                          {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                                        </span>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => togglePerm(i.value)}
                                          className="sr-only"
                                        />
                                        <span className="flex-1 min-w-0">
                                          <span className={cn(
                                            "block text-[12px] font-medium truncate",
                                            checked ? "text-indigo-900 dark:text-indigo-200" : "text-slate-700 dark:text-slate-300",
                                          )}>{i.label}</span>
                                          <span className="block text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">{i.value}</span>
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
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

/**
 * Pro-level role card — modern, glassmorphic, info-dense lekin toza.
 * Hover'da quick action tugmalar paydo bo'ladi, coverage circular ring bilan,
 * modul bo'yicha permissions guruhlangan visualizatsiya.
 */
function ProRoleCard({
  role: r, grad, coverage, totalPerms, canManage, onEdit, onDelete,
}: {
  role: Role;
  grad: string;
  coverage: number;
  totalPerms: number;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('roles');
  const tc = useTranslations('common');
  // Permissions'larni modul bo'yicha guruhlash (visualizatsiya uchun)
  const byModule: Record<string, number> = {};
  r.permissions.forEach((p) => {
    const mod = p.split(':')[0];
    byModule[mod] = (byModule[mod] || 0) + 1;
  });
  const modules = Object.entries(byModule).slice(0, 6);

  // Coverage ring uchun SVG params
  const RADIUS = 28;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const dashOffset = CIRCUMFERENCE - (coverage / 100) * CIRCUMFERENCE;

  // Status: super = SUPERADMIN, system = boshqa system rollar, custom = foydalanuvchi
  const isSuper = r.name === 'SUPERADMIN';
  const status = isSuper ? 'super' : r.isSystem ? 'system' : 'custom';

  return (
    <div className="group relative">
      {/* Glow halo (hover'da yorqinlashadi) */}
      <div className={cn(
        "absolute -inset-0.5 rounded-2xl bg-gradient-to-br opacity-0 group-hover:opacity-40 blur-xl transition-opacity duration-500 -z-10",
        grad,
      )} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl ring-1 ring-slate-200/80 dark:ring-slate-700/80
                      shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.18)]
                      hover:-translate-y-1 hover:ring-slate-300 dark:hover:ring-slate-700
                      transition-all duration-300 overflow-hidden">
        {/* Top accent bar */}
        <div className={cn("h-1 bg-gradient-to-r", grad)} />

        {/* Body */}
        <div className="p-5">
          {/* Header: icon + name + actions */}
          <div className="flex items-start gap-4 mb-4">
            {/* Big rounded icon with glow */}
            <div className="relative shrink-0">
              <div className={cn(
                "absolute inset-0 rounded-2xl bg-gradient-to-br blur-lg opacity-50",
                grad,
              )} />
              <div className={cn(
                "relative w-14 h-14 rounded-2xl bg-gradient-to-br grid place-items-center text-white",
                "ring-2 ring-white shadow-md",
                grad,
              )}>
                {isSuper ? <Crown className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
              </div>
              {/* Status dot */}
              <span className={cn(
                "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-white",
                status === 'super' ? 'bg-amber-400' : status === 'system' ? 'bg-slate-400' : 'bg-emerald-500',
              )} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[16px] font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate">{r.label}</span>
                {isSuper && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 ring-1 ring-amber-200 dark:ring-amber-900 px-1.5 py-0.5 rounded-full">
                    <Sparkles className="h-2.5 w-2.5" /> {t('badgeSuper')}
                  </span>
                )}
                {r.isSystem && !isSuper && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 px-1.5 py-0.5 rounded-full">
                    <Lock className="h-2.5 w-2.5" /> {t('badgeSystem')}
                  </span>
                )}
                {!r.isSystem && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 px-1.5 py-0.5 rounded-full">
                    <Activity className="h-2.5 w-2.5" /> {t('badgeCustom')}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[10.5px] font-mono text-slate-500 dark:text-slate-400 truncate">{r.name}</div>
            </div>

            {/* Actions — hover'da ko'rinadi */}
            {canManage && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={onEdit}
                  title={tc('edit')}
                  className="w-8 h-8 rounded-lg grid place-items-center bg-slate-100 dark:bg-slate-800 hover:bg-indigo-600 text-slate-600 dark:text-slate-300 hover:text-white transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {!r.isSystem && (
                  <button
                    onClick={onDelete}
                    title={tc('delete')}
                    className="w-8 h-8 rounded-lg grid place-items-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 text-slate-600 dark:text-slate-300 hover:text-white transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Description */}
          {r.description ? (
            <p className="text-[12px] text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed mb-4 min-h-[32px]">{r.description}</p>
          ) : (
            <p className="text-[12px] text-slate-400 dark:text-slate-500 italic mb-4 min-h-[32px]">{t('noDescription')}</p>
          )}

          {/* Metrics grid: coverage ring + stats */}
          <div className="grid grid-cols-3 gap-3 mb-4 p-3 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/60 ring-1 ring-slate-100 dark:ring-slate-800">
            {/* Coverage ring (SVG) */}
            <div className="col-span-1 flex items-center justify-center">
              <div className="relative">
                <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
                  <circle cx="36" cy="36" r={RADIUS} fill="none" stroke="rgb(226,232,240)" strokeWidth="6" />
                  <circle
                    cx="36" cy="36" r={RADIUS}
                    fill="none"
                    stroke={`url(#grad-${r.id})`}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={dashOffset}
                    className="transition-all duration-1000 ease-out"
                  />
                  <defs>
                    <linearGradient id={`grad-${r.id}`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#a855f7" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 grid place-items-center">
                  <div className="text-center">
                    <div className="text-[15px] font-bold text-slate-800 dark:text-slate-200 tabular-nums leading-none">{coverage}%</div>
                    <div className="text-[8px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mt-0.5">{t('coverage')}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="col-span-2 flex flex-col justify-center gap-1.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <Zap className="h-3 w-3 text-indigo-500 dark:text-indigo-400" />
                  {t('permissions')}
                </span>
                <span className="font-bold tabular-nums text-[13px] text-slate-900 dark:text-slate-100">
                  {r.permissions.length}<span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">/{totalPerms}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <Users className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
                  {t('users')}
                </span>
                <span className="font-bold tabular-nums text-[13px] text-slate-900 dark:text-slate-100">
                  {r._count?.users ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <Eye className="h-3 w-3 text-cyan-500 dark:text-cyan-400" />
                  {t('modules')}
                </span>
                <span className="font-bold tabular-nums text-[13px] text-slate-900 dark:text-slate-100">
                  {Object.keys(byModule).length}
                </span>
              </div>
            </div>
          </div>

          {/* Module breakdown — chip'lar */}
          <div className="flex flex-wrap gap-1.5">
            {modules.map(([mod, count]) => (
              <span
                key={mod}
                className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-md
                           bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-300"
              >
                <span className="font-semibold">{mod}</span>
                <span className="text-slate-400 dark:text-slate-500">·</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-bold">{count}</span>
              </span>
            ))}
            {Object.keys(byModule).length > 6 && (
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium px-1.5 py-1">
                +{Object.keys(byModule).length - 6}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
