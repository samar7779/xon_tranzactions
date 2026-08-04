'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Sparkles, Upload, FileText, Loader2, CheckCircle2, AlertTriangle,
  History, Settings, ArrowRightLeft, Trash2, Plus, RotateCcw, Landmark,
  Wand2, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
type DestRow = { contractNo: string; amount: string; client?: string | null; object?: string | null; found?: boolean };
type AnalyzeResult = {
  ok: boolean;
  extracted: {
    fromContractNo: string | null; fromClient: string | null; objectName: string | null;
    totalAmount: number; destinations: Array<{ contractNo: string; amount: number; client: string | null; object: string | null; found: boolean }>;
    applicantName: string | null; confidence: string | null; notes: string | null; date: string;
  };
  agentState: 'verified' | 'needs_review';
  agentReason: string;
  warnings: string[];
};

const num = (s: any) => { const n = Number(String(s ?? '').replace(/\s/g, '')); return isNaN(n) ? 0 : n; };

// ═══════════════════════════════════════════════════════════════
export function AiPerereboskaModule({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'work' | 'history' | 'settings'>('work');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!mounted) return null;

  const TABS: Array<{ key: typeof tab; label: string; icon: any }> = [
    { key: 'work', label: 'Ishlash', icon: Wand2 },
    { key: 'history', label: 'Tarix', icon: History },
    { key: 'settings', label: 'Sozlamalar', icon: Settings },
  ];

  return createPortal(
    <div className={cn('fixed inset-0 z-[100]', open ? 'pointer-events-auto' : 'pointer-events-none')}>
      <div
        className={cn('absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')}
        onClick={onClose}
      />
      <div
        className={cn(
          'absolute right-0 top-0 h-full w-full max-w-3xl bg-slate-50 dark:bg-slate-950 shadow-2xl flex flex-col transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="shrink-0 bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-600 text-white">
          <div className="px-5 pt-4 pb-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 grid place-items-center shadow-inner">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/70">Xon Saroy · ОплатыКв</div>
              <div className="text-lg font-black tracking-tight">AI Переброска</div>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-white/15 grid place-items-center transition-colors" title="Yopish (ESC)">
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* Tabs */}
          <div className="px-3 flex gap-1">
            {TABS.map((tt) => (
              <button
                key={tt.key}
                onClick={() => setTab(tt.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-2 rounded-t-lg text-[13px] font-semibold transition-colors',
                  tab === tt.key ? 'bg-slate-50 dark:bg-slate-950 text-violet-700 dark:text-violet-300' : 'text-white/80 hover:bg-white/10',
                )}
              >
                <tt.icon className="h-4 w-4" /> {tt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {tab === 'work' && <WorkTab onDone={onClose} />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'settings' && <SettingsTab />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 1 — ISHLASH: ariza yuklash → agent o'qish → tasdiqlash → yaratish
// ═══════════════════════════════════════════════════════════════
function WorkTab({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  // Tahrirlanadigan forma (agent o'qiganidan keyin to'ldiriladi)
  const [fromCn, setFromCn] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [dests, setDests] = useState<DestRow[]>([]);

  const reset = () => { setFile(null); setResult(null); setFromCn(''); setDate(''); setNote(''); setDests([]); if (fileRef.current) fileRef.current.value = ''; };

  const analyzeMut = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append('file', f); return api.postForm<AnalyzeResult>('/oplata-kv/perereboska/analyze', fd, { timeout: 90_000 }); },
    onSuccess: (r) => {
      setResult(r);
      const e = r.extracted;
      setFromCn(e.fromContractNo || '');
      setDate(e.date || new Date().toISOString().slice(0, 10));
      setDests((e.destinations || []).map((d) => ({ contractNo: d.contractNo, amount: String(d.amount || ''), client: d.client, object: d.object, found: d.found })));
      if (r.agentState === 'verified') toast.success('Agent: hujjat mos ✓');
      else toast('Agent: tekshirish kerak ⚠️', { description: r.agentReason });
    },
    onError: (e: any) => toast.error(e?.message || 'Tahlil xatosi'),
  });

  const createMut = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Ariza fayli yo\'q');
      const fd = new FormData();
      fd.append('fromContractNo', fromCn.trim());
      fd.append('amount', String(destTotal));
      fd.append('date', date);
      fd.append('note', note);
      fd.append('destinations', JSON.stringify(dests.map((d) => ({ contractNo: d.contractNo.trim(), amount: num(d.amount) }))));
      fd.append('file', file);
      fd.append('agentUsed', 'true');
      if (result) { fd.append('agentState', result.agentState); fd.append('agentReason', result.agentReason); fd.append('agentData', JSON.stringify(result.extracted)); }
      return api.postForm('/oplata-kv/perereboska', fd, { timeout: 60_000 });
    },
    onSuccess: () => { toast.success('Переброска yaratildi ✓'); qc.invalidateQueries({ queryKey: ['oplatakv'] }); qc.invalidateQueries({ queryKey: ['perereboska-history'] }); reset(); onDone(); },
    onError: (e: any) => toast.error(e?.message || 'Yaratishda xato'),
  });

  const destTotal = useMemo(() => dests.reduce((s, d) => s + num(d.amount), 0), [dests]);
  const onFile = (f: File | null) => { setFile(f); setResult(null); if (f) analyzeMut.mutate(f); };
  const setDest = (i: number, patch: Partial<DestRow>) => setDests((p) => p.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const addDest = () => setDests((p) => [...p, { contractNo: '', amount: '' }]);
  const rmDest = (i: number) => setDests((p) => p.filter((_, idx) => idx !== i));

  const canCreate = !!file && !!fromCn.trim() && !!date && dests.length > 0 && dests.every((d) => d.contractNo.trim() && num(d.amount) > 0) && !createMut.isPending;

  return (
    <div className="p-5 space-y-4">
      {/* 1. Ariza yuklash */}
      <div>
        <div className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">1 · Arizani yuklang</div>
        <label className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 cursor-pointer transition-colors',
          file ? 'border-violet-300 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20' : 'border-slate-300 dark:border-slate-700 hover:border-violet-400',
        )}>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
          {file ? <FileText className="h-8 w-8 text-violet-500" /> : <Upload className="h-8 w-8 text-slate-400" />}
          <div className="text-center">
            {file ? (
              <><div className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[400px]">{file.name}</div>
                <div className="text-[11px] text-slate-400">{(file.size / 1024).toFixed(0)} KB · qayta yuklash uchun bosing</div></>
            ) : (
              <><div className="text-[13px] font-medium text-slate-600 dark:text-slate-300">Ariza (PDF yoki rasm)</div>
                <div className="text-[11px] text-slate-400">Agent o'qib, переброска ma'lumotini ajratadi</div></>
            )}
          </div>
        </label>
      </div>

      {analyzeMut.isPending && (
        <div className="flex items-center gap-2 text-[13px] text-violet-600 dark:text-violet-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Agent arizani o'qiyapti...
        </div>
      )}

      {/* 2. Agent xulosasi + tahrir */}
      {result && (
        <>
          {/* Agent verdikt */}
          <div className={cn('rounded-2xl p-4 ring-1',
            result.agentState === 'verified'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 ring-emerald-200 dark:ring-emerald-900'
              : 'bg-amber-50 dark:bg-amber-950/30 ring-amber-200 dark:ring-amber-900')}>
            <div className="flex items-center gap-2 font-bold text-[14px]">
              {result.agentState === 'verified'
                ? <><ShieldCheck className="h-5 w-5 text-emerald-600" /> <span className="text-emerald-700 dark:text-emerald-300">Agent: hujjat mos</span></>
                : <><ShieldAlert className="h-5 w-5 text-amber-600" /> <span className="text-amber-700 dark:text-amber-300">Agent: tekshirish kerak</span></>}
            </div>
            {result.warnings.length > 0 && (
              <ul className="mt-2 space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[12px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            )}
            {result.extracted.notes && <div className="mt-2 text-[11.5px] text-slate-500 dark:text-slate-400 italic">📝 {result.extracted.notes}</div>}
            {result.extracted.applicantName && <div className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400">👤 Arizachi: {result.extracted.applicantName}</div>}
          </div>

          {/* Tahrirlanadigan forma */}
          <div className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">2 · Tekshiring va to'g'irlang</div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-slate-500">Manba shartnoma</label>
                <input value={fromCn} onChange={(e) => setFromCn(e.target.value.toUpperCase())}
                  className="mt-1 w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-violet-400 text-[13px] font-mono" />
                {result.extracted.fromClient && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{result.extracted.fromClient}{result.extracted.objectName ? ` · ${result.extracted.objectName}` : ''}</div>}
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500">Sana</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  className="mt-1 w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-violet-400 text-[13px]" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-medium text-slate-500">Maqsadli shartnomalar</label>
                <button onClick={addDest} className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-700"><Plus className="h-3 w-3" /> Qo'shish</button>
              </div>
              <div className="space-y-2">
                {dests.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1">
                      <input value={d.contractNo} onChange={(e) => setDest(i, { contractNo: e.target.value.toUpperCase() })} placeholder="Shartnoma №"
                        className="w-full h-9 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-violet-400 text-[13px] font-mono" />
                      {d.client && <div className="text-[10px] text-slate-400 mt-0.5 truncate">{d.client}{d.object ? ` · ${d.object}` : ''}</div>}
                    </div>
                    <input value={d.amount} onChange={(e) => setDest(i, { amount: e.target.value })} placeholder="Summa" inputMode="numeric"
                      className="w-36 h-9 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-violet-400 text-[13px] text-right font-mono" />
                    <button onClick={() => rmDest(i)} className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-500">Izoh (ixtiyoriy)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-violet-400 text-[13px]" />
            </div>

            <div className="flex items-center justify-between pt-1 text-[12px] border-t border-slate-100 dark:border-slate-800">
              <span className="text-slate-500">Maqsadlar jami: <b className="font-mono">{formatMoney(destTotal)}</b></span>
              <span className="text-slate-500">{dests.length} ta shartnoma</span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={reset} className="px-4 h-11 rounded-xl text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Tozalash</button>
            <button onClick={() => createMut.mutate()} disabled={!canCreate}
              className="px-5 h-11 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 shadow-lg shadow-fuchsia-500/25">
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Tasdiqlash va yaratish
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 2 — TARIX: filtrlar + orqaga qaytarish
// ═══════════════════════════════════════════════════════════════
function HistoryTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'all' | 'active' | 'cancelled'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['perereboska-history', status, dateFrom, dateTo, q],
    queryFn: () => api.get<{ items: any[]; total: number }>(`/oplata-kv/perereboska/history?status=${status}&dateFrom=${dateFrom}&dateTo=${dateTo}&q=${encodeURIComponent(q)}`),
  });

  const reverseMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.delete(`/oplata-kv/perereboska/${id}?reason=${encodeURIComponent(reason)}`),
    onSuccess: () => { toast.success('Переброска orqaga qaytarildi'); qc.invalidateQueries({ queryKey: ['perereboska-history'] }); qc.invalidateQueries({ queryKey: ['oplatakv'] }); },
    onError: (e: any) => toast.error(e?.message || 'Qaytarishda xato'),
  });

  const doReverse = (id: string) => {
    const reason = window.prompt('Orqaga qaytarish sababi (ixtiyoriy):', '') ?? null;
    if (reason === null) return; // bekor qilindi
    reverseMut.mutate({ id, reason });
  };

  const STAT: Array<{ k: typeof status; label: string }> = [
    { k: 'all', label: 'Barchasi' }, { k: 'active', label: 'Bajarilgan' }, { k: 'cancelled', label: 'Bekor qilingan' },
  ];

  return (
    <div className="p-5 space-y-4">
      {/* Filtrlar */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
          {STAT.map((s) => (
            <button key={s.k} onClick={() => setStatus(s.k)}
              className={cn('px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors', status === s.k ? 'bg-white dark:bg-slate-950 text-violet-700 dark:text-violet-300 shadow-sm' : 'text-slate-500')}>
              {s.label}
            </button>
          ))}
        </div>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 px-2.5 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[12px] outline-none focus:ring-2 focus:ring-violet-400" />
        <span className="text-slate-400 text-[12px]">—</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 px-2.5 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[12px] outline-none focus:ring-2 focus:ring-violet-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Shartnoma / mijoz / obyekt..." className="flex-1 min-w-[160px] h-9 px-3 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[12px] outline-none focus:ring-2 focus:ring-violet-400" />
      </div>

      {isLoading && <div className="flex items-center gap-2 text-[13px] text-slate-400 py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...</div>}
      {!isLoading && (data?.items || []).length === 0 && <div className="text-center text-[13px] text-slate-400 py-10">Переброска topilmadi</div>}

      <div className="space-y-2">
        {(data?.items || []).map((g) => {
          const dests = Array.isArray(g.destinations) ? g.destinations : [];
          const cancelled = g.status === 'cancelled';
          return (
            <div key={g.id} className={cn('rounded-xl ring-1 p-3.5', cancelled ? 'bg-slate-50 dark:bg-slate-900/50 ring-slate-200 dark:ring-slate-800 opacity-75' : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-800')}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white">
                  <ArrowRightLeft className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[13px] font-bold text-slate-800 dark:text-slate-100">{g.fromContractNo}</span>
                    <span className="text-slate-400">→</span>
                    <span className="font-mono text-[12px] text-slate-600 dark:text-slate-300">{dests.map((d: any) => d.contractNo).join(', ')}</span>
                    {g.agentUsed && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300"><Sparkles className="h-2.5 w-2.5" />AI</span>}
                    {cancelled && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300">BEKOR QILINGAN</span>}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {g.objectName || '—'} · {g.fromClient || ''} · {g.date ? String(g.date).slice(0, 10) : ''}
                  </div>
                  {cancelled && g.cancelReason && <div className="text-[11px] text-rose-400 mt-0.5">Sabab: {g.cancelReason}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono font-bold text-[14px] text-slate-800 dark:text-slate-100">{formatMoney(Number(g.amount))}</div>
                  {!cancelled && (
                    <button onClick={() => doReverse(g.id)} disabled={reverseMut.isPending}
                      className="mt-1 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50">
                      <RotateCcw className="h-3 w-3" /> Orqaga qaytarish
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 3 — SOZLAMALAR
// ═══════════════════════════════════════════════════════════════
function SettingsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['perereboska-settings'],
    queryFn: () => api.get<{ aiEnabled: boolean; aiModel: string; strict: boolean; tgNotify: boolean; hasKey: boolean }>('/oplata-kv/perereboska-settings'),
  });
  const [local, setLocal] = useState<{ aiEnabled: boolean; aiModel: string; strict: boolean; tgNotify: boolean } | null>(null);
  useEffect(() => { if (data) setLocal({ aiEnabled: data.aiEnabled, aiModel: data.aiModel, strict: data.strict, tgNotify: data.tgNotify }); }, [data]);

  const saveMut = useMutation({
    mutationFn: (body: any) => api.post('/oplata-kv/perereboska-settings', body),
    onSuccess: () => { toast.success('Sozlamalar saqlandi'); qc.invalidateQueries({ queryKey: ['perereboska-settings'] }); },
    onError: (e: any) => toast.error(e?.message || 'Saqlashda xato'),
  });

  if (isLoading || !local) return <div className="flex items-center gap-2 text-[13px] text-slate-400 py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...</div>;

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button onClick={onClick} className={cn('w-11 h-6 rounded-full transition-colors relative shrink-0', on ? 'bg-violet-600' : 'bg-slate-300 dark:bg-slate-600')}>
      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );

  return (
    <div className="p-5 space-y-3 max-w-xl">
      {!data?.hasKey && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-900 p-3 text-[12px] text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> AI kalit sozlanmagan. Admin → Agent → AI kalit bo'limidan kiriting (agent ariza o'qishi uchun kerak).
        </div>
      )}

      <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
        <div className="flex items-center gap-3 p-4">
          <div className="flex-1"><div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Agent (AI o'qish)</div><div className="text-[11.5px] text-slate-400">O'chirilsa — oddiy qo'lda переброска</div></div>
          <Toggle on={local.aiEnabled} onClick={() => setLocal({ ...local, aiEnabled: !local.aiEnabled })} />
        </div>
        <div className="flex items-center gap-3 p-4">
          <div className="flex-1"><div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Qat'iy tekshiruv</div><div className="text-[11.5px] text-slate-400">Yoqilsa — nomuvofiqlikda ogohlantirish kuchli (yaratishdan oldin ko'rib chiqish shart)</div></div>
          <Toggle on={local.strict} onClick={() => setLocal({ ...local, strict: !local.strict })} />
        </div>
        <div className="flex items-center gap-3 p-4">
          <div className="flex-1"><div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Telegram xabar</div><div className="text-[11.5px] text-slate-400">Переброска yaratilganda/bekor qilinganda guruhga xabar</div></div>
          <Toggle on={local.tgNotify} onClick={() => setLocal({ ...local, tgNotify: !local.tgNotify })} />
        </div>
        <div className="flex items-center gap-3 p-4">
          <div className="flex-1"><div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">AI model</div><div className="text-[11.5px] text-slate-400">Ariza o'qish uchun Claude modeli</div></div>
          <select value={local.aiModel} onChange={(e) => setLocal({ ...local, aiModel: e.target.value })}
            className="h-9 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-[12px] outline-none focus:ring-2 focus:ring-violet-400">
            <option value="claude-sonnet-4-6">Sonnet (tez, arzon)</option>
            <option value="claude-opus-4-6">Opus (aniqroq)</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => saveMut.mutate(local)} disabled={saveMut.isPending}
          className="px-5 h-11 rounded-xl text-[13px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-2">
          {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Saqlash
        </button>
      </div>
    </div>
  );
}
