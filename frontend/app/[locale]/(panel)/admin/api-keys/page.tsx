'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Search, Copy, Check, KeyRound, ShieldAlert, CircleSlash, RefreshCw,
  Edit3, Trash2, Eye, EyeOff, Loader2, Activity, Globe, AlertOctagon, Code2,
  X, CheckCircle2, BarChart3, Clock, ExternalLink,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';

interface ApiKey {
  id: string;
  keyId: string;
  secretPreview: string;
  name: string;
  description: string | null;
  scopes: string[];
  expiresAt: string | null;
  isActive: boolean;
  allowedIps: string[];
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  totalRequests: number;
  revokedAt: string | null;
  revokedReason: string | null;
}

interface ScopeMeta {
  value: string;
  label: string;
  description: string;
}

export default function ApiKeysPage() {
  const qc = useQueryClient();
  const canManage = useHasPermission(PERMS.API_KEYS_MANAGE);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiKey | null>(null);
  const [detailTarget, setDetailTarget] = useState<ApiKey | null>(null);
  const [createdResult, setCreatedResult] = useState<{ keyId: string; secret: string; name: string } | null>(null);

  const listQ = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<{ ok: boolean; items: ApiKey[] }>('/api-keys'),
  });
  const scopesQ = useQuery({
    queryKey: ['api-keys-scopes'],
    queryFn: () => api.get<{ ok: boolean; scopes: ScopeMeta[] }>('/api-keys/scopes'),
  });
  const statsQ = useQuery({
    queryKey: ['api-keys-stats'],
    queryFn: () => api.get<any>('/api-keys/stats'),
  });

  const items = listQ.data?.items || [];
  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const t = q.trim().toLowerCase();
    return items.filter((it) =>
      it.name.toLowerCase().includes(t) ||
      it.keyId.toLowerCase().includes(t) ||
      it.description?.toLowerCase().includes(t),
    );
  }, [items, q]);

  const activeCount = items.filter((i) => i.isActive).length;
  const revokedCount = items.filter((i) => !i.isActive).length;

  const onCreated = (result: { keyId: string; secret: string; name: string }) => {
    setCreatedResult(result);
    qc.invalidateQueries({ queryKey: ['api-keys'] });
  };

  return (
    <div className="flex-1 p-3 sm:p-5 lg:p-6 space-y-5 w-full">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span className="inline-flex w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white items-center justify-center shadow-md">
              <Code2 className="h-5 w-5" />
            </span>
            Developer API
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1.5">
            Tashqi tizim integratsiyasi uchun API kalitlar. Har kalit o'z scope va muddatiga ega.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => listQ.refetch()}
            disabled={listQ.isFetching}
            className="h-9 gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', listQ.isFetching && 'animate-spin')} />
            Yangilash
          </Button>
          {canManage && (
            <Button
              onClick={() => setCreateOpen(true)}
              className="h-9 gap-1.5 bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md hover:shadow-lg"
            >
              <Plus className="h-4 w-4" /> Yangi API kalit
            </Button>
          )}
        </div>
      </div>

      {/* ═══ KPI ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <KpiCard label="Jami kalitlar" value={items.length} icon={KeyRound} tone="indigo" />
        <KpiCard label="Faol" value={activeCount} icon={CheckCircle2} tone="emerald" />
        <KpiCard label="Bekor qilingan" value={revokedCount} icon={CircleSlash} tone="slate" />
        <KpiCard
          label="So'rovlar (24 soat)"
          value={statsQ.data?.last24h ?? 0}
          sub={`jami: ${(statsQ.data?.total ?? 0).toLocaleString('ru-RU')}`}
          icon={Activity}
          tone="amber"
        />
      </div>

      {/* ═══ SEARCH ═══ */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-soft p-3 lg:p-4">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nom, key ID, tavsif bo'yicha qidirish..."
            className="h-10 pl-9"
          />
        </div>
      </div>

      {/* ═══ TABLE ═══ */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 font-bold">
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="px-3 py-3 text-left">Nom</th>
                <th className="px-3 py-3 text-left">Key ID</th>
                <th className="px-3 py-3 text-left">Scope'lar</th>
                <th className="px-3 py-3 text-left">Holat</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">Oxirgi ishlatilgan</th>
                <th className="px-3 py-3 text-right">So'rovlar</th>
                <th className="px-3 py-3 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {listQ.isLoading && (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Yuklanmoqda...
                </td></tr>
              )}
              {!listQ.isLoading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-20 text-center">
                  <div className="inline-flex flex-col items-center max-w-md">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 grid place-items-center mb-3 ring-1 ring-amber-200 dark:ring-amber-900">
                      <Code2 className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="text-[15px] font-bold text-slate-800 dark:text-slate-200">
                      {q.trim() ? "Topilmadi" : "Hali API kalit yo'q"}
                    </div>
                    <div className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                      {q.trim()
                        ? "Filterlarni o'zgartiring yoki tozalang."
                        : "Tashqi tizim integratsiyasi uchun birinchi API kalitni yarating."}
                    </div>
                    {canManage && !q.trim() && (
                      <Button
                        onClick={() => setCreateOpen(true)}
                        className="mt-5 gap-2 bg-gradient-to-br from-amber-500 to-orange-600 text-white"
                      >
                        <Plus className="h-4 w-4" /> Birinchi kalitni yaratish
                      </Button>
                    )}
                  </div>
                </td></tr>
              )}
              {filtered.map((it) => (
                <tr
                  key={it.id}
                  className={cn(
                    'border-b border-slate-100 dark:border-slate-800 transition-colors cursor-pointer',
                    it.isActive
                      ? 'hover:bg-amber-50/40 dark:hover:bg-amber-950/20'
                      : 'bg-slate-50/40 dark:bg-slate-800/30 opacity-70 hover:opacity-100',
                  )}
                  onClick={() => setDetailTarget(it)}
                >
                  <td className="px-3 py-3">
                    <div className="font-bold text-slate-800 dark:text-slate-200 text-[13px]">{it.name}</div>
                    {it.description && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[280px]">{it.description}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 max-w-[200px] truncate" title={it.keyId}>
                    {it.keyId}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[280px]">
                      {it.scopes.length === 0 && <span className="text-[11px] text-slate-400">scope yo'q</span>}
                      {it.scopes.slice(0, 3).map((s) => (
                        <span key={s} className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-900">
                          {s}
                        </span>
                      ))}
                      {it.scopes.length > 3 && (
                        <span className="text-[10px] text-slate-500">+{it.scopes.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {it.isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> FAOL
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900">
                        <CircleSlash className="h-2.5 w-2.5" /> BEKOR
                      </span>
                    )}
                    {it.expiresAt && new Date(it.expiresAt) < new Date() && (
                      <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
                        muddat o'tgan
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[11.5px] whitespace-nowrap text-slate-700 dark:text-slate-300">
                    {it.lastUsedAt ? (
                      <>
                        <div className="tabular-nums">{formatDateTime(it.lastUsedAt)}</div>
                        {it.lastUsedIp && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{it.lastUsedIp}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-400">hech qachon</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-bold text-slate-800 dark:text-slate-200">
                    {it.totalRequests.toLocaleString('ru-RU')}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setDetailTarget(it)} title="Tafsilot">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {canManage && (
                        <>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditTarget(it)} title="Tahrirlash">
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <DeleteButton apiKey={it} />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODALS */}
      <CreateApiKeyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        scopes={scopesQ.data?.scopes || []}
        onCreated={onCreated}
      />
      <SecretRevealDialog
        result={createdResult}
        onClose={() => setCreatedResult(null)}
      />
      <EditApiKeyDialog
        apiKey={editTarget}
        scopes={scopesQ.data?.scopes || []}
        onClose={() => setEditTarget(null)}
      />
      <ApiKeyDetailDialog
        apiKey={detailTarget}
        scopes={scopesQ.data?.scopes || []}
        canManage={canManage}
        onClose={() => setDetailTarget(null)}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// KPI Card
// ══════════════════════════════════════════════════════════
function KpiCard({
  label, value, sub, icon: Icon, tone,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: any;
  tone: 'indigo' | 'emerald' | 'slate' | 'amber';
}) {
  const tones: Record<string, { bg: string; ring: string; iconBg: string; iconText: string; valText: string }> = {
    indigo:  { bg: 'from-indigo-50/80 to-white dark:from-indigo-950/30 dark:to-slate-900',  ring: 'ring-indigo-100 dark:ring-indigo-900',  iconBg: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',   iconText: 'text-indigo-700 dark:text-indigo-300',  valText: 'text-slate-900 dark:text-slate-100' },
    emerald: { bg: 'from-emerald-50/80 to-white dark:from-emerald-950/30 dark:to-slate-900',ring: 'ring-emerald-100 dark:ring-emerald-900',iconBg: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',iconText: 'text-emerald-700 dark:text-emerald-300',valText: 'text-emerald-700 dark:text-emerald-300' },
    slate:   { bg: 'from-slate-50/80 to-white dark:from-slate-800/60 dark:to-slate-900',    ring: 'ring-slate-200 dark:ring-slate-700',    iconBg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',         iconText: 'text-slate-700 dark:text-slate-300',    valText: 'text-slate-900 dark:text-slate-100' },
    amber:   { bg: 'from-amber-50/80 to-white dark:from-amber-950/30 dark:to-slate-900',    ring: 'ring-amber-100 dark:ring-amber-900',    iconBg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',      iconText: 'text-amber-700 dark:text-amber-300',    valText: 'text-amber-700 dark:text-amber-300' },
  };
  const t = tones[tone];
  return (
    <div className={cn('relative rounded-2xl bg-gradient-to-br ring-1 shadow-soft overflow-hidden px-4 py-3.5 lg:px-5 lg:py-4', t.bg, t.ring)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className={cn('text-[10px] uppercase tracking-widest font-bold', t.iconText)}>{label}</div>
          <div className={cn('text-2xl lg:text-3xl font-black tabular-nums leading-none mt-1', t.valText)}>
            {typeof value === 'number' ? value.toLocaleString('ru-RU') : value}
          </div>
          {sub && <div className="text-[10.5px] text-slate-500 dark:text-slate-400 font-medium mt-1.5">{sub}</div>}
        </div>
        <div className={cn('w-10 h-10 lg:w-11 lg:h-11 rounded-xl grid place-items-center shrink-0 ring-1 ring-white/40', t.iconBg)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Create dialog
// ══════════════════════════════════════════════════════════
function CreateApiKeyDialog({
  open, onClose, scopes, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  scopes: ScopeMeta[];
  onCreated: (r: { keyId: string; secret: string; name: string }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [expiryMode, setExpiryMode] = useState<'never' | 'days' | 'date'>('never');
  const [expiryDays, setExpiryDays] = useState<number>(90);
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [allowedIps, setAllowedIps] = useState<string>('');

  useMemo(() => {
    if (open) {
      setName('');
      setDescription('');
      setSelectedScopes(new Set());
      setExpiryMode('never');
      setExpiryDays(90);
      setExpiryDate('');
      setAllowedIps('');
    }
  }, [open]);

  const mut = useMutation({
    mutationFn: (vals: any) => api.post<any>('/api-keys', vals),
    onSuccess: (r: any) => {
      if (r?.ok) {
        onCreated({ keyId: r.key.keyId, secret: r.key.secret, name: r.key.name });
        onClose();
      } else {
        toast.error(r?.error || 'Xato');
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Yaratish xato'),
  });

  const toggleScope = (s: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const onSubmit = () => {
    if (!name.trim()) { toast.error('Nom kerak'); return; }
    if (selectedScopes.size === 0) { toast.error('Kamida bitta scope tanlang'); return; }
    let expiresAt: string | null = null;
    if (expiryMode === 'days') {
      const d = new Date();
      d.setDate(d.getDate() + expiryDays);
      expiresAt = d.toISOString();
    } else if (expiryMode === 'date' && expiryDate) {
      expiresAt = new Date(expiryDate).toISOString();
    }
    const ips = allowedIps.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    mut.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      scopes: Array.from(selectedScopes),
      expiresAt,
      allowedIps: ips,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[680px] p-0 overflow-hidden gap-0 max-h-[92vh] flex flex-col">
        <div className="bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 px-6 py-5 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/20 grid place-items-center ring-1 ring-white/30">
              <KeyRound className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/85">Yangi API kalit</div>
              <div className="text-xl font-black tracking-tight">Developer API kalit yaratish</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1.5 block">Nom *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: 1C Integration" className="h-10" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1.5 block">Tavsif</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ixtiyoriy — qaerda ishlatiladi" className="h-10" />
          </div>

          {/* Scopes */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-2 block">
              Ruxsatlar (scope) — kamida bitta
            </Label>
            <div className="space-y-1.5">
              {scopes.map((s) => {
                const checked = selectedScopes.has(s.value);
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => toggleScope(s.value)}
                    className={cn(
                      'w-full text-left rounded-xl ring-1 px-3 py-2.5 transition-all',
                      checked
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 ring-indigo-300 dark:ring-indigo-800'
                        : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'w-5 h-5 rounded ring-2 grid place-items-center shrink-0 mt-0.5',
                        checked ? 'bg-indigo-600 ring-indigo-600' : 'bg-white dark:bg-slate-800 ring-slate-300 dark:ring-slate-600',
                      )}>
                        {checked && <Check className="h-3 w-3 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 dark:text-slate-200 text-[13px]">{s.label}</span>
                          <code className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">{s.value}</code>
                        </div>
                        <div className="text-[11.5px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">{s.description}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Expiry */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-2 block">Muddati</Label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {(['never', 'days', 'date'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setExpiryMode(m)}
                  className={cn(
                    'h-10 rounded-lg ring-1 text-[12.5px] font-semibold transition-colors',
                    expiryMode === m
                      ? 'bg-indigo-600 text-white ring-indigo-600'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  {m === 'never' ? 'Cheksiz' : m === 'days' ? 'N kun keyin' : 'Aniq sana'}
                </button>
              ))}
            </div>
            {expiryMode === 'days' && (
              <div className="relative">
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(Math.max(1, Number(e.target.value) || 1))}
                  className="h-10 pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500 pointer-events-none">kun</span>
              </div>
            )}
            {expiryMode === 'date' && (
              <Input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="h-10"
                min={new Date().toISOString().slice(0, 10)}
              />
            )}
          </div>

          {/* IP whitelist */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1.5 block">
              IP whitelist (ixtiyoriy)
            </Label>
            <Input
              value={allowedIps}
              onChange={(e) => setAllowedIps(e.target.value)}
              placeholder="vergul yoki probel bilan ajrating: 192.168.1.1, 10.0.0.5"
              className="h-10"
            />
            <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-1">
              Bo'sh qoldirsangiz — barcha IP'lardan kirish mumkin.
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40">
          <Button variant="ghost" onClick={onClose}>Bekor</Button>
          <Button
            onClick={onSubmit}
            disabled={mut.isPending || !name.trim() || selectedScopes.size === 0}
            className="bg-gradient-to-br from-amber-500 to-orange-600 text-white"
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
            Yaratish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════
// Secret reveal dialog
// ══════════════════════════════════════════════════════════
function SecretRevealDialog({
  result, onClose,
}: { result: { keyId: string; secret: string; name: string } | null; onClose: () => void }) {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [secretVisible, setSecretVisible] = useState(true);

  const copy = async (text: string, which: 'key' | 'secret') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'key') { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 1500); }
      else { setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 1500); }
    } catch { /* ignore */ }
  };

  if (!result) return null;

  return (
    <Dialog open={!!result} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[680px] p-0 overflow-hidden gap-0">
        <div className="bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 px-6 py-5 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/20 grid place-items-center ring-1 ring-white/30">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/85">Muvaffaqiyat</div>
              <div className="text-xl font-black tracking-tight">"{result.name}" yaratildi</div>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 px-4 py-3 flex items-start gap-2.5">
            <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="text-[12.5px] text-amber-900 dark:text-amber-200 leading-relaxed">
              <div className="font-bold mb-1">⚠ Secret hozir oxirgi marotaba ko'rsatilmoqda!</div>
              Dialog yopilgandan keyin secret hech qachon ko'rsatilmaydi. Saqlab oling — masalan parol menejerida.
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1.5 block">
              X-API-Key
            </Label>
            <div className="relative">
              <code className="block w-full px-3 py-2.5 pr-12 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-[12.5px] break-all">
                {result.keyId}
              </code>
              <button
                onClick={() => copy(result.keyId, 'key')}
                className="absolute right-2 top-2 p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                {copiedKey ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-slate-500" />}
              </button>
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-rose-600 dark:text-rose-400 mb-1.5 flex items-center justify-between">
              <span>X-API-Secret (bir marta ko'rsatiladi)</span>
              <button onClick={() => setSecretVisible((v) => !v)} className="text-slate-400 hover:text-slate-600 normal-case font-normal">
                {secretVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </Label>
            <div className="relative">
              <code className="block w-full px-3 py-2.5 pr-12 rounded-lg bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 text-rose-900 dark:text-rose-200 font-mono text-[12.5px] break-all">
                {secretVisible ? result.secret : '••••••••••••••••••••••••••••••••••••'}
              </code>
              <button
                onClick={() => copy(result.secret, 'secret')}
                className="absolute right-2 top-2 p-1.5 rounded hover:bg-rose-200/60 dark:hover:bg-rose-900/40"
              >
                {copiedSecret ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-rose-600 dark:text-rose-400" />}
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 ring-1 ring-slate-200 dark:ring-slate-700 p-3 text-[11.5px] text-slate-700 dark:text-slate-300 font-mono leading-relaxed">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-2">curl misol</div>
            <code className="block break-all">
              curl https://transactions.xonapps.uz/api/v1/_whoami \<br />
              &nbsp;&nbsp;-H {`"X-API-Key: ${result.keyId}"`} \<br />
              &nbsp;&nbsp;-H {`"X-API-Secret: ${result.secret}"`}
            </code>
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-slate-100 dark:border-slate-800">
          <Button onClick={onClose} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Check className="h-4 w-4 mr-1.5" /> Saqladim, davom ettiraman
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════
// Edit dialog
// ══════════════════════════════════════════════════════════
function EditApiKeyDialog({
  apiKey, scopes, onClose,
}: { apiKey: ApiKey | null; scopes: ScopeMeta[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [isActive, setIsActive] = useState(true);
  const [allowedIps, setAllowedIps] = useState('');
  const [expiresAt, setExpiresAt] = useState<string>('');

  useMemo(() => {
    if (apiKey) {
      setName(apiKey.name);
      setDescription(apiKey.description || '');
      setSelectedScopes(new Set(apiKey.scopes));
      setIsActive(apiKey.isActive);
      setAllowedIps(apiKey.allowedIps.join(', '));
      setExpiresAt(apiKey.expiresAt ? apiKey.expiresAt.slice(0, 10) : '');
    }
  }, [apiKey]);

  const mut = useMutation({
    mutationFn: (vals: any) => api.patch<any>(`/api-keys/${apiKey?.id}`, vals),
    onSuccess: () => {
      toast.success('Saqlandi');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  if (!apiKey) return null;

  const toggleScope = (s: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  return (
    <Dialog open={!!apiKey} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[640px] p-0 overflow-hidden gap-0 max-h-[92vh] flex flex-col">
        <div className="bg-gradient-to-br from-indigo-600 to-violet-600 px-6 py-5 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/20 grid place-items-center ring-1 ring-white/30">
              <Edit3 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/85">Tahrirlash</div>
              <div className="text-xl font-black tracking-tight">{apiKey.name}</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Nom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Tavsif</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-10" />
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 ring-1 ring-slate-200 dark:ring-slate-700">
            <div>
              <div className="text-[12.5px] font-bold text-slate-800 dark:text-slate-200">Faol</div>
              <div className="text-[10.5px] text-slate-500 dark:text-slate-400">O'chirilsa kalit so'rovlarni rad etadi</div>
            </div>
            <label className="relative inline-block">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="sr-only peer" />
              <span className="block w-11 h-6 rounded-full bg-slate-300 dark:bg-slate-700 peer-checked:bg-emerald-600 transition-colors" />
              <span className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow ring-1 ring-slate-200 transition-transform peer-checked:translate-x-5" />
            </label>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2 block">Scope'lar</Label>
            <div className="space-y-1.5">
              {scopes.map((s) => {
                const checked = selectedScopes.has(s.value);
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => toggleScope(s.value)}
                    className={cn(
                      'w-full text-left rounded-lg ring-1 px-3 py-2 transition-all flex items-center gap-2',
                      checked ? 'bg-indigo-50 dark:bg-indigo-950/40 ring-indigo-300 dark:ring-indigo-800'
                              : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700',
                    )}
                  >
                    <div className={cn(
                      'w-4 h-4 rounded ring-2 grid place-items-center shrink-0',
                      checked ? 'bg-indigo-600 ring-indigo-600' : 'bg-white dark:bg-slate-800 ring-slate-300 dark:ring-slate-600',
                    )}>
                      {checked && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                    <code className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300">{s.value}</code>
                    <span className="text-[11px] text-slate-500">— {s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Muddati (sana)</Label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-10" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">IP whitelist</Label>
              <Input value={allowedIps} onChange={(e) => setAllowedIps(e.target.value)} placeholder="bo'sh = barcha" className="h-10" />
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 px-5 py-3 border-t border-slate-100 dark:border-slate-800">
          <Button variant="ghost" onClick={onClose}>Bekor</Button>
          <Button
            onClick={() => mut.mutate({
              name,
              description: description || null,
              scopes: Array.from(selectedScopes),
              isActive,
              expiresAt: expiresAt || null,
              allowedIps: allowedIps.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean),
            })}
            disabled={mut.isPending}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Check className="h-4 w-4 mr-1.5" />}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════
// Detail dialog — info + stats + logs
// ══════════════════════════════════════════════════════════
function ApiKeyDetailDialog({
  apiKey, scopes, canManage, onClose,
}: { apiKey: ApiKey | null; scopes: ScopeMeta[]; canManage: boolean; onClose: () => void }) {
  const statsQ = useQuery({
    queryKey: ['api-key-stats', apiKey?.id],
    queryFn: () => api.get<any>(`/api-keys/stats?apiKeyId=${apiKey?.id}`),
    enabled: !!apiKey,
  });
  const logsQ = useQuery({
    queryKey: ['api-key-logs', apiKey?.id],
    queryFn: () => api.get<any>(`/api-keys/logs?apiKeyId=${apiKey?.id}&perPage=100`),
    enabled: !!apiKey,
  });

  if (!apiKey) return null;
  const scopeMap = new Map(scopes.map((s) => [s.value, s]));
  const logs = logsQ.data?.items || [];
  const stats = statsQ.data;

  return (
    <Dialog open={!!apiKey} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[920px] p-0 overflow-hidden gap-0 max-h-[92vh] flex flex-col">
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-6 py-5 text-white shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/60">API kalit</div>
              <div className="text-2xl font-black tracking-tight mt-0.5 truncate">{apiKey.name}</div>
              {apiKey.description && (
                <div className="text-[12px] text-white/70 mt-1 leading-relaxed">{apiKey.description}</div>
              )}
              <div className="mt-2 font-mono text-[11px] text-white/80 bg-black/30 rounded-md px-2.5 py-1 inline-block break-all">
                {apiKey.keyId}
              </div>
            </div>
            <button onClick={onClose} className="text-white/60 hover:text-white p-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50/30 dark:bg-slate-900/40">
          {/* Quick stats */}
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MiniStat label="Jami so'rov" value={stats.total ?? 0} icon={BarChart3} />
              <MiniStat label="24 soat" value={stats.last24h ?? 0} icon={Clock} />
              <MiniStat label="7 kun" value={stats.last7d ?? 0} icon={Clock} />
              <MiniStat
                label="Holat"
                value={apiKey.isActive ? 'FAOL' : 'BEKOR'}
                tone={apiKey.isActive ? 'emerald' : 'rose'}
                icon={apiKey.isActive ? CheckCircle2 : CircleSlash}
              />
            </div>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
            <InfoRow label="Yaratildi" value={formatDateTime(apiKey.createdAt)} />
            <InfoRow label="Yaratuvchi" value={apiKey.createdByEmail || '—'} />
            <InfoRow label="Muddati" value={apiKey.expiresAt ? formatDateTime(apiKey.expiresAt) : 'Cheksiz'} />
            <InfoRow label="Oxirgi ishlatilgan" value={apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : 'hech qachon'} />
            <InfoRow label="Oxirgi IP" value={apiKey.lastUsedIp || '—'} mono />
            <InfoRow label="Jami so'rovlar" value={apiKey.totalRequests.toLocaleString('ru-RU')} />
          </div>

          {/* Scopes */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-2">Scope'lar</div>
            <div className="flex flex-wrap gap-1.5">
              {apiKey.scopes.length === 0 && <span className="text-[12px] text-slate-400">scope yo'q</span>}
              {apiKey.scopes.map((s) => {
                const meta = scopeMap.get(s);
                return (
                  <span key={s} className="px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-200 dark:ring-indigo-900 text-[11px]">
                    <code className="font-mono font-bold text-indigo-800 dark:text-indigo-300">{s}</code>
                    {meta && <span className="text-slate-600 dark:text-slate-400 ml-1.5">— {meta.label}</span>}
                  </span>
                );
              })}
            </div>
          </div>

          {/* IP whitelist */}
          {apiKey.allowedIps.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1">
                <Globe className="h-3 w-3" /> IP whitelist
              </div>
              <div className="flex flex-wrap gap-1.5">
                {apiKey.allowedIps.map((ip) => (
                  <code key={ip} className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-mono">{ip}</code>
                ))}
              </div>
            </div>
          )}

          {/* Top stats */}
          {stats && (stats.topPaths?.length > 0 || stats.topIps?.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {stats.topPaths?.length > 0 && (
                <div className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 p-3">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">Eng ko'p so'ralgan endpoint'lar</div>
                  <div className="space-y-1">
                    {stats.topPaths.map((r: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-[11.5px]">
                        <code className="font-mono text-slate-700 dark:text-slate-300 truncate flex-1">{r.path}</code>
                        <span className="ml-2 font-bold tabular-nums text-slate-600">{r.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {stats.topIps?.length > 0 && (
                <div className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 p-3">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">Eng ko'p kelgan IP'lar</div>
                  <div className="space-y-1">
                    {stats.topIps.map((r: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-[11.5px]">
                        <code className="font-mono text-slate-700 dark:text-slate-300">{r.ip}</code>
                        <span className="font-bold tabular-nums text-slate-600">{r.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Logs */}
          <div className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 text-[10px] uppercase tracking-wider font-bold text-slate-500 flex items-center justify-between">
              <span>So'nggi so'rovlar ({logs.length})</span>
              {logsQ.isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {logs.length === 0 && (
                <div className="px-4 py-6 text-center text-[12px] text-slate-400">Log yo'q</div>
              )}
              <table className="w-full text-[11.5px]">
                <tbody>
                  {logs.map((log: any) => (
                    <tr key={log.id} className="border-b border-slate-100 dark:border-slate-800 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-1.5 tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={cn(
                          'px-1.5 py-0.5 rounded font-mono text-[10px] font-bold',
                          log.method === 'GET' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' :
                          log.method === 'POST' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' :
                          'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
                        )}>{log.method}</span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-slate-700 dark:text-slate-300 truncate max-w-[280px]" title={log.path}>{log.path}</td>
                      <td className="px-3 py-1.5">
                        <span className={cn(
                          'font-mono font-bold tabular-nums text-[11px]',
                          log.statusCode < 300 ? 'text-emerald-700 dark:text-emerald-400' :
                          log.statusCode < 400 ? 'text-amber-700 dark:text-amber-400' :
                          'text-rose-700 dark:text-rose-400',
                        )}>{log.statusCode}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{log.durationMs}ms</td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{log.ip || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 px-5 py-3 border-t border-slate-100 dark:border-slate-800">
          <Button variant="ghost" onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2">
      <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">{label}</div>
      <div className={cn('text-[12.5px] font-bold text-slate-800 dark:text-slate-200 truncate mt-0.5', mono && 'font-mono')}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, tone = 'slate' }: { label: string; value: number | string; icon: any; tone?: 'slate' | 'emerald' | 'rose' }) {
  const tones: Record<string, string> = {
    slate: 'text-slate-700 dark:text-slate-300',
    emerald: 'text-emerald-700 dark:text-emerald-300',
    rose: 'text-rose-700 dark:text-rose-300',
  };
  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2.5">
      <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={cn('text-xl font-black tabular-nums mt-0.5', tones[tone])}>
        {typeof value === 'number' ? value.toLocaleString('ru-RU') : value}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Delete button
// ══════════════════════════════════════════════════════════
function DeleteButton({ apiKey }: { apiKey: ApiKey }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => api.delete(`/api-keys/${apiKey.id}`),
    onSuccess: () => {
      toast.success("O'chirildi");
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
      onClick={() => {
        if (!confirm(`"${apiKey.name}" kalitini butunlay o'chirasizmi?\n\nBu amalni qaytarib bo'lmaydi.`)) return;
        mut.mutate();
      }}
      disabled={mut.isPending}
      title="O'chirish"
    >
      {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </Button>
  );
}
