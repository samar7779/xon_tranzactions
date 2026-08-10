'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  HandCoins, Plus, Search, Edit3, Trash2, XCircle, Loader2, Wallet, FileText,
  ChevronLeft, ChevronRight, X, CheckCircle2, Ban, Sparkles, RotateCcw,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { TransactionsTabs } from '@/components/transactions-tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';

type Vznos = {
  id: string; contractNo: string; projectName: string | null; contractDate: string | null;
  contractValue: number | null; fullName: string | null; apartmentArea: number | null;
  apartmentNo: string | null; floor: string | null; block: string | null; terraceArea: number | null;
  comment: string | null; inCrm: boolean; status: string; paid: number; remaining: number | null;
  createdByName: string | null; cancelledByName: string | null; transferToContractNo: string | null;
};

const money = (n: any) => (n == null ? '—' : formatMoney(Number(n)));

export default function VznosPage() {
  const qc = useQueryClient();
  const canManage = useHasPermission(PERMS.VZNOS_MANAGE);
  const [q, setQ] = useState('');
  const [project, setProject] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const perPage = 20;
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState<Vznos | null>(null);
  const [cancelRow, setCancelRow] = useState<Vznos | null>(null);

  useEffect(() => { setPage(1); }, [q, project, status]);

  const { data: stats } = useQuery({
    queryKey: ['vznos-stats', project],
    queryFn: () => api.get<{ count: number; totalValue: number; totalPaid: number; totalRemaining: number; paidPercent: number }>(`/vznos/stats?project=${project}`),
  });
  const { data: objects } = useQuery({ queryKey: ['vznos-objects'], queryFn: () => api.get<string[]>('/vznos/objects') });
  const { data, isLoading } = useQuery({
    queryKey: ['vznos-list', q, project, status, page],
    queryFn: () => api.get<{ items: Vznos[]; total: number }>(`/vznos?q=${encodeURIComponent(q)}&project=${project}&status=${status}&page=${page}`),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/vznos/${id}`),
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ['vznos-list'] }); qc.invalidateQueries({ queryKey: ['vznos-stats'] }); },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const rows = data?.items || [];

  return (
    <>
      <Topbar title="Взнос от имени клиента" subtitle="O'z shartnomalarimiz reestri — o'zimiz to'laydiganlar (tushum emas)" />
      <TransactionsTabs />

      <div className="flex-1 p-3 sm:p-5 lg:p-6 space-y-5 w-full">
        {/* Kartalar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <StatCard icon={FileText} color="indigo" label="Shartnomalar" value={(stats?.count ?? 0).toLocaleString('ru-RU')} sub="active" />
          <StatCard icon={Wallet} color="violet" label="Umumiy qiymat" value={money(stats?.totalValue).replace(' UZS', '')} sub="UZS" />
          <StatCard icon={CheckCircle2} color="emerald" label="To'langan" value={money(stats?.totalPaid).replace(' UZS', '')} sub="UZS" />
          <StatCard icon={HandCoins} color="amber" label="Qoldiq" value={money(stats?.totalRemaining).replace(' UZS', '')} sub={`${stats?.paidPercent ?? 0}% to'langan`} />
        </div>

        {/* Filtrlar */}
        <Card className="border-0 shadow-soft overflow-visible">
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Shartnoma, ФИШ, loyiha, xonadon..."
                className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-indigo-400 text-[14px]" />
            </div>
            <select value={project} onChange={(e) => setProject(e.target.value)}
              className="h-10 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-indigo-400 text-[13px]">
              <option value="all">Barcha loyihalar</option>
              {(objects || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5">
              {[{ k: 'all', l: 'Barchasi' }, { k: 'active', l: 'Faol' }, { k: 'cancelled', l: 'Bekor' }].map((s) => (
                <button key={s.k} onClick={() => setStatus(s.k)}
                  className={cn('px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors', status === s.k ? 'bg-white dark:bg-slate-950 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500')}>
                  {s.l}
                </button>
              ))}
            </div>
            {canManage && (
              <button onClick={() => { setEditRow(null); setFormOpen(true); }}
                className="ml-auto inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white text-[13px] font-semibold shadow-lg shadow-indigo-500/25">
                <Plus className="h-4 w-4" /> Shartnoma qo'shish
              </button>
            )}
          </CardContent>
        </Card>

        {/* Jadval */}
        <Card className="border-0 shadow-soft">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] min-w-[1200px]">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-left">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Шартнома №</th>
                    <th className="px-3 py-2.5 font-medium">Лойиха</th>
                    <th className="px-3 py-2.5 font-medium">Сана</th>
                    <th className="px-3 py-2.5 font-medium text-right">Киймат</th>
                    <th className="px-3 py-2.5 font-medium">ФИШ</th>
                    <th className="px-3 py-2.5 font-medium text-right">Майдон</th>
                    <th className="px-3 py-2.5 font-medium">Хонадон №</th>
                    <th className="px-3 py-2.5 font-medium">Кават</th>
                    <th className="px-3 py-2.5 font-medium">Блок</th>
                    <th className="px-3 py-2.5 font-medium text-right">Терраса</th>
                    <th className="px-3 py-2.5 font-medium text-right">Туланган</th>
                    <th className="px-3 py-2.5 font-medium text-right">Қолдиқ</th>
                    <th className="px-3 py-2.5 font-medium">Коммент</th>
                    <th className="px-3 py-2.5 font-medium text-right">Амаллар</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && <tr><td colSpan={14} className="px-3 py-10 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>}
                  {!isLoading && rows.length === 0 && <tr><td colSpan={14} className="px-3 py-10 text-center text-slate-400 text-[13px]">Shartnoma topilmadi</td></tr>}
                  {rows.map((r) => {
                    const cancelled = r.status === 'cancelled';
                    return (
                      <tr key={r.id} className={cn('border-t border-slate-100 dark:border-slate-800 align-top', cancelled && 'opacity-60 bg-slate-50/50 dark:bg-slate-900/40')}>
                        <td className="px-3 py-2.5">
                          <div className="font-mono font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                            {r.contractNo}
                            {r.inCrm && <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">CRM</span>}
                          </div>
                          {cancelled && <span className="text-[10px] text-rose-500">Bekor → {r.transferToContractNo}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{r.projectName || '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-500">{r.contractDate ? String(r.contractDate).slice(0, 10) : '—'}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{money(r.contractValue)}</td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 max-w-[160px] truncate" title={r.fullName || ''}>{r.fullName || '—'}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-500">{r.apartmentArea != null ? Number(r.apartmentArea) : '—'}</td>
                        <td className="px-3 py-2.5 text-slate-500">{r.apartmentNo || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-500">{r.floor || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-500">{r.block || '—'}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-500">{r.terraceArea != null ? Number(r.terraceArea) : '—'}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">{money(r.paid)}</td>
                        <td className={cn('px-3 py-2.5 text-right font-mono font-semibold', r.remaining != null && r.remaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500')}>{r.remaining != null ? money(r.remaining) : '—'}</td>
                        <td className="px-3 py-2.5 text-slate-400 max-w-[140px] truncate" title={r.comment || ''}>{r.comment || '—'}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            {canManage && !cancelled && (
                              <>
                                <button onClick={() => { setEditRow(r); setFormOpen(true); }} title="Tahrirlash" className="w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"><Edit3 className="h-3.5 w-3.5" /></button>
                                <button onClick={() => setCancelRow(r)} title="Bekor qilish (o'tkazish)" className="w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"><RotateCcw className="h-3.5 w-3.5" /></button>
                                <button onClick={() => { if (confirm(`${r.contractNo} — o'chirilsinmi?`)) delMut.mutate(r.id); }} title="O'chirish" className="w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"><Trash2 className="h-3.5 w-3.5" /></button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {total > perPage && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800 text-[12px]">
                <span className="text-slate-400">Jami: <b className="text-slate-600 dark:text-slate-300">{total}</b></span>
                <div className="flex items-center gap-1">
                  <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="inline-flex items-center gap-0.5 h-8 px-2.5 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /> Oldingi</button>
                  <span className="px-2 text-slate-500 font-medium">{page} / {totalPages}</span>
                  <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="inline-flex items-center gap-0.5 h-8 px-2.5 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40">Keyingi <ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <VznosFormDialog open={formOpen} onClose={() => setFormOpen(false)} row={editRow} objects={objects || []} />
      <CancelDialog row={cancelRow} onClose={() => setCancelRow(null)} />
    </>
  );
}

function StatCard({ icon: Icon, color, label, value, sub }: { icon: any; color: string; label: string; value: string; sub?: string }) {
  const c: Record<string, string> = {
    indigo: 'from-indigo-500 to-violet-600', violet: 'from-violet-500 to-fuchsia-600',
    emerald: 'from-emerald-500 to-teal-600', amber: 'from-amber-500 to-orange-600',
  };
  return (
    <Card className="border-0 shadow-soft">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn('w-11 h-11 rounded-xl grid place-items-center text-white shadow-md bg-gradient-to-br shrink-0', c[color])}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{label}</div>
          <div className="text-[18px] font-black text-slate-800 dark:text-slate-100 truncate">{value}</div>
          {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Qo'shish / tahrirlash dialogi ───
function VznosFormDialog({ open, onClose, row, objects }: { open: boolean; onClose: () => void; row: Vznos | null; objects: string[] }) {
  const qc = useQueryClient();
  const isEdit = !!row;
  const [f, setF] = useState<any>({});
  const [crmChecked, setCrmChecked] = useState<null | { found: boolean }>(null);

  useEffect(() => {
    if (!open) return;
    setCrmChecked(null);
    setF(row ? {
      contractNo: row.contractNo, projectName: row.projectName || '', contractDate: row.contractDate ? String(row.contractDate).slice(0, 10) : '',
      contractValue: row.contractValue ?? '', fullName: row.fullName || '', apartmentArea: row.apartmentArea ?? '', apartmentNo: row.apartmentNo || '',
      floor: row.floor || '', block: row.block || '', terraceArea: row.terraceArea ?? '', comment: row.comment || '',
    } : { contractNo: '', projectName: '', contractDate: '', contractValue: '', fullName: '', apartmentArea: '', apartmentNo: '', floor: '', block: '', terraceArea: '', comment: '' });
  }, [open, row]);

  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const lookupMut = useMutation({
    mutationFn: (cn: string) => api.get<{ found: boolean; fullName: string | null; projectName: string | null; apartmentNo: string | null }>(`/vznos/crm-lookup?contractNo=${encodeURIComponent(cn)}`),
    onSuccess: (r) => {
      setCrmChecked({ found: r.found });
      if (r.found) {
        setF((p: any) => ({ ...p, fullName: p.fullName || r.fullName || '', projectName: p.projectName || r.projectName || '', apartmentNo: p.apartmentNo || r.apartmentNo || '' }));
        toast.success('CRM\'da topildi — ma\'lumot tortildi');
      } else toast('CRM\'da yo\'q — to\'liq qo\'lda kiriting');
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const num = (v: any) => { const n = Number(String(v).replace(/\s/g, '')); return isNaN(n) || v === '' ? null : n; };
  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        contractNo: f.contractNo, projectName: f.projectName || null, contractDate: f.contractDate || null,
        contractValue: num(f.contractValue), fullName: f.fullName || null, apartmentArea: num(f.apartmentArea),
        apartmentNo: f.apartmentNo || null, floor: f.floor || null, block: f.block || null, terraceArea: num(f.terraceArea), comment: f.comment || null,
      };
      return isEdit ? api.patch(`/vznos/${row!.id}`, body) : api.post('/vznos', body);
    },
    onSuccess: (r: any) => {
      toast.success(isEdit ? 'Saqlandi' : `Qo'shildi${r?.recategorized ? ` · ${r.recategorized} to'lov bog'landi` : ''}`);
      qc.invalidateQueries({ queryKey: ['vznos-list'] }); qc.invalidateQueries({ queryKey: ['vznos-stats'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const inputCls = 'mt-1 w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-indigo-400 text-[13px]';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/40 dark:to-violet-950/40 shrink-0">
          <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">{isEdit ? 'Shartnomani tahrirlash' : 'Yangi shartnoma'}</DialogTitle>
          <DialogDescription className="text-[12px] text-slate-500 mt-0.5">Взнос от имени клиента — o'z shartnomamiz. Qo'shilганда mos to'lovlar avtomat bog'lanadi.</DialogDescription>
        </div>
        <div className="p-6 space-y-3 overflow-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[11px] font-medium text-slate-500">Шартнома № *</label>
              <div className="flex gap-2">
                <input value={f.contractNo || ''} disabled={isEdit} onChange={(e) => { set('contractNo', e.target.value.toUpperCase()); setCrmChecked(null); }} className={cn(inputCls, 'font-mono flex-1', isEdit && 'opacity-60')} />
                {!isEdit && <button onClick={() => f.contractNo?.trim() && lookupMut.mutate(f.contractNo.trim())} disabled={lookupMut.isPending} className="mt-1 h-10 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-medium inline-flex items-center gap-1 shrink-0">{lookupMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} CRM</button>}
              </div>
              {crmChecked && <div className={cn('text-[11px] mt-0.5', crmChecked.found ? 'text-emerald-600' : 'text-amber-600')}>{crmChecked.found ? 'CRM\'da topildi' : 'CRM\'da yo\'q — qo\'lda kiriting'}</div>}
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[11px] font-medium text-slate-500">Лойиха (obyekt)</label>
              <input list="vznos-objects" value={f.projectName || ''} onChange={(e) => set('projectName', e.target.value)} className={inputCls} />
              <datalist id="vznos-objects">{objects.map((o) => <option key={o} value={o} />)}</datalist>
            </div>
            <div><label className="text-[11px] font-medium text-slate-500">Шартнома санаси</label><input type="date" value={f.contractDate || ''} onChange={(e) => set('contractDate', e.target.value)} className={inputCls} /></div>
            <div><label className="text-[11px] font-medium text-slate-500">Шартнома киймати</label><input inputMode="numeric" value={f.contractValue ?? ''} onChange={(e) => set('contractValue', e.target.value)} className={cn(inputCls, 'text-right font-mono')} /></div>
            <div className="col-span-2"><label className="text-[11px] font-medium text-slate-500">ФИШ</label><input value={f.fullName || ''} onChange={(e) => set('fullName', e.target.value)} className={inputCls} /></div>
            <div><label className="text-[11px] font-medium text-slate-500">Хонадон № (тартиб)</label><input value={f.apartmentNo || ''} onChange={(e) => set('apartmentNo', e.target.value)} className={inputCls} /></div>
            <div><label className="text-[11px] font-medium text-slate-500">Умумий майдон</label><input inputMode="decimal" value={f.apartmentArea ?? ''} onChange={(e) => set('apartmentArea', e.target.value)} className={cn(inputCls, 'text-right font-mono')} /></div>
            <div><label className="text-[11px] font-medium text-slate-500">Кават</label><input value={f.floor || ''} onChange={(e) => set('floor', e.target.value)} className={inputCls} /></div>
            <div><label className="text-[11px] font-medium text-slate-500">Блок</label><input value={f.block || ''} onChange={(e) => set('block', e.target.value)} className={inputCls} /></div>
            <div><label className="text-[11px] font-medium text-slate-500">Терраса майдони</label><input inputMode="decimal" value={f.terraceArea ?? ''} onChange={(e) => set('terraceArea', e.target.value)} className={cn(inputCls, 'text-right font-mono')} /></div>
            <div className="col-span-2"><label className="text-[11px] font-medium text-slate-500">Коммент</label><input value={f.comment || ''} onChange={(e) => set('comment', e.target.value)} className={inputCls} /></div>
          </div>
        </div>
        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 h-10 rounded-xl text-[13px] font-medium text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">Bekor</button>
          <button onClick={() => saveMut.mutate()} disabled={!f.contractNo?.trim() || saveMut.isPending} className="px-5 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold inline-flex items-center gap-2 disabled:opacity-40">{saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Saqlash</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bekor qilish (o'tkazish) dialogi ───
function CancelDialog({ row, onClose }: { row: Vznos | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { if (row) { setTarget(''); setReason(''); } }, [row]);

  const mut = useMutation({
    mutationFn: () => api.post(`/vznos/${row!.id}/cancel`, { transferToContractNo: target.trim(), reason }),
    onSuccess: (r: any) => { toast.success(`Bekor qilindi · ${r?.transferred ?? 0} to'lov ${r?.to} ga o'tkazildi`); qc.invalidateQueries({ queryKey: ['vznos-list'] }); qc.invalidateQueries({ queryKey: ['vznos-stats'] }); onClose(); },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40">
          <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"><Ban className="h-5 w-5 text-amber-600" /> Bekor qilish</DialogTitle>
          <DialogDescription className="text-[12px] text-slate-500 mt-0.5">{row?.contractNo} to'lovlari boshqa (ro'yxatдаgi) shartnomaga o'tkaziladi.</DialogDescription>
        </div>
        <div className="p-6 space-y-3">
          <div>
            <label className="text-[12px] font-medium text-slate-600">Maqsadli shartnoma № *</label>
            <input value={target} onChange={(e) => setTarget(e.target.value.toUpperCase())} placeholder="Ro'yxatдаgi active shartnoma"
              className="mt-1 w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-amber-400 text-[14px] font-mono" />
            <div className="text-[11px] text-slate-400 mt-0.5">To'langan: <b>{money(row?.paid)}</b> — shu summa o'tkaziladi</div>
          </div>
          <div>
            <label className="text-[12px] font-medium text-slate-600">Sabab (ixtiyoriy)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-amber-400 text-[13px]" />
          </div>
        </div>
        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 h-10 rounded-xl text-[13px] font-medium text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">Bekor</button>
          <button onClick={() => mut.mutate()} disabled={!target.trim() || mut.isPending} className="px-5 h-10 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-semibold inline-flex items-center gap-2 disabled:opacity-40">{mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Bekor qilib o'tkazish</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
