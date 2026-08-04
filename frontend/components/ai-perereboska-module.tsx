'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Sparkles, Upload, FileText, Loader2, CheckCircle2, AlertTriangle,
  History, Settings, ArrowRightLeft, Trash2, Plus, RotateCcw,
  Wand2, ShieldCheck, ShieldAlert, Wallet, Ban, RefreshCw, Eye, ExternalLink,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

// Agent matni (notes/izoh) — markdown render (o'qishga qulay)
function MdText({ children }: { children: string }) {
  return (
    <div className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-300 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_ul]:space-y-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1 [&_strong]:font-semibold [&_strong]:text-slate-800 dark:[&_strong]:text-slate-100 [&_code]:font-mono [&_code]:text-[11px]">
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
type DestRow = { contractNo: string; amount: string; client?: string | null; object?: string | null; found?: boolean; balance?: number | null };
type AnalyzeResult = {
  ok: boolean;
  extracted: {
    fromContractNo: string | null; fromClient: string | null; objectName: string | null; fromBalance: number | null;
    totalAmount: number; destinations: Array<{ contractNo: string; amount: number; client: string | null; object: string | null; found: boolean; balance: number | null }>;
    applicantName: string | null; confidence: string | null; notes: string | null; date: string;
  };
  balanceEnough: boolean;
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
          'absolute right-0 top-0 h-full w-full max-w-6xl bg-slate-50 dark:bg-slate-950 shadow-2xl flex flex-col transition-transform duration-300 ease-out',
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  // Tahrirlanadigan forma
  const [fromCn, setFromCn] = useState('');
  const [fromBalance, setFromBalance] = useState<number | null>(null);
  const [fromMeta, setFromMeta] = useState<{ client: string | null; object: string | null }>({ client: null, object: null });
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [dests, setDests] = useState<DestRow[]>([]);

  // Fayl preview URL (rasm ham, PDF ham — ochib ko'rish uchun)
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const reset = () => {
    setFile(null); setResult(null); setShowPreview(false); setFromCn(''); setFromBalance(null);
    setFromMeta({ client: null, object: null }); setDate(''); setNote(''); setDests([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const analyzeMut = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append('file', f); return api.postForm<AnalyzeResult>('/oplata-kv/perereboska/analyze', fd, { timeout: 90_000 }); },
    onSuccess: (r) => {
      setResult(r);
      const e = r.extracted;
      setFromCn(e.fromContractNo || '');
      setFromBalance(e.fromBalance);
      setFromMeta({ client: e.fromClient, object: e.objectName });
      setDate(e.date || new Date().toISOString().slice(0, 10));
      setDests((e.destinations || []).map((d) => ({ contractNo: d.contractNo, amount: String(d.amount || ''), client: d.client, object: d.object, found: d.found, balance: d.balance })));
      if (r.agentState === 'verified') toast.success('Agent: hujjat mos ✓');
      else toast('Agent: tekshirish kerak ⚠️', { description: r.agentReason });
    },
    onError: (e: any) => toast.error(e?.message || 'Tahlil xatosi'),
  });

  const destTotal = useMemo(() => dests.reduce((s, d) => s + num(d.amount), 0), [dests]);
  const balanceShort = fromBalance != null && destTotal > fromBalance + 0.01;

  const createMut = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Ariza fayli yo'q");
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

  const onFile = (f: File | null) => { setFile(f); setResult(null); if (f) analyzeMut.mutate(f); };
  const setDest = (i: number, patch: Partial<DestRow>) => setDests((p) => p.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const addDest = () => setDests((p) => [...p, { contractNo: '', amount: '' }]);
  const rmDest = (i: number) => setDests((p) => p.filter((_, idx) => idx !== i));

  const canCreate = !!file && !!fromCn.trim() && !!date && dests.length > 0 &&
    dests.every((d) => d.contractNo.trim() && num(d.amount) > 0) && !balanceShort && !createMut.isPending;

  const isImg = !!file && file.type.startsWith('image/');

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      {/* 1. Ariza yuklash — pro */}
      <div>
        <div className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">1 · Arizani yuklang</div>
        {!file ? (
          <label className="group relative flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-violet-400 dark:hover:border-violet-600 bg-white dark:bg-slate-900 hover:bg-violet-50/40 dark:hover:bg-violet-950/20 p-10 cursor-pointer transition-all overflow-hidden">
            <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-gradient-to-br from-violet-200 to-fuchsia-200 dark:from-violet-900/40 dark:to-fuchsia-900/40 blur-2xl opacity-40 group-hover:opacity-70 transition-opacity" />
            <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 grid place-items-center text-white shadow-lg shadow-fuchsia-500/30 group-hover:scale-110 transition-transform">
              <Upload className="h-7 w-7" />
            </div>
            <div className="relative text-center">
              <div className="text-[14px] font-bold text-slate-700 dark:text-slate-200">Arizani shu yerga tashlang</div>
              <div className="text-[12px] text-slate-400 mt-0.5">PDF yoki rasm · agent o'qib, переброска ma'lumotini ajratadi</div>
            </div>
          </label>
        ) : (
          <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 p-3 flex items-center gap-4">
            <button onClick={() => setShowPreview(true)} title="Ochib ko'rish"
              className="group/thumb relative w-24 h-28 rounded-xl overflow-hidden shrink-0 ring-1 ring-slate-200 dark:ring-slate-700 grid place-items-center bg-slate-50 dark:bg-slate-800">
              {isImg && previewUrl
                ? <img src={previewUrl} alt="ariza" className="w-full h-full object-cover" />
                : <div className="flex flex-col items-center gap-1 text-rose-500"><FileText className="h-9 w-9" /><span className="text-[10px] font-bold">PDF</span></div>}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity grid place-items-center">
                <Eye className="h-6 w-6 text-white" />
              </div>
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{file.name}</div>
              <div className="text-[11px] text-slate-400">{(file.size / 1024).toFixed(0)} KB · {isImg ? 'rasm' : 'PDF'}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => setShowPreview(true)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30">
                  <Eye className="h-3 w-3" /> Ochib ko'rish
                </button>
                <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <RefreshCw className="h-3 w-3" /> O'zgartirish
                </button>
                <button onClick={reset} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30">
                  <Trash2 className="h-3 w-3" /> Olib tashlash
                </button>
              </div>
              <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
            </div>
          </div>
        )}
      </div>

      {/* Analiz jarayoni — pro */}
      {analyzeMut.isPending && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-600 p-5 text-white shadow-lg shadow-fuchsia-500/25">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/15 grid place-items-center shrink-0">
              <Sparkles className="h-6 w-6 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-[14px]">Agent arizani o'qiyapti…</div>
              <div className="text-[12px] text-white/80">Claude vision hujjatni tahlil qilmoqda</div>
              <div className="mt-2.5 h-1.5 rounded-full bg-white/20 overflow-hidden">
                <div className="h-full w-1/2 rounded-full bg-white/80 animate-pulse" />
              </div>
            </div>
            <Loader2 className="h-6 w-6 animate-spin shrink-0" />
          </div>
        </div>
      )}

      {/* 2. Natija */}
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
            {result.extracted.notes && (
              <div className="mt-2.5 rounded-lg bg-white/70 dark:bg-slate-900/50 ring-1 ring-slate-200/70 dark:ring-slate-700/50 px-3 py-2">
                <MdText>{result.extracted.notes}</MdText>
              </div>
            )}
            {result.extracted.applicantName && <div className="mt-2 text-[11.5px] text-slate-500 dark:text-slate-400">👤 Arizachi: {result.extracted.applicantName}</div>}
          </div>

          {/* Qoldiq jadvali */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-violet-500" />
              <span className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">Shartnomalar qoldig'i</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] min-w-[520px]">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="px-4 py-2 font-medium">Shartnoma</th>
                    <th className="px-2 py-2 font-medium text-right">Joriy qoldiq</th>
                    <th className="px-2 py-2 font-medium text-right">O'tkazma</th>
                    <th className="px-4 py-2 font-medium text-right">Yangi qoldiq</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Manba */}
                  <tr className="border-t border-slate-100 dark:border-slate-800 bg-rose-50/30 dark:bg-rose-950/10">
                    <td className="px-4 py-2">
                      <div className="font-mono font-semibold text-slate-800 dark:text-slate-100">{fromCn || '—'} <span className="text-[9px] text-slate-400 font-sans">MANBA</span></div>
                      <div className="text-[10px] text-slate-400 truncate">{fromMeta.client || ''}{fromMeta.object ? ` · ${fromMeta.object}` : ''}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{fromBalance != null ? formatMoney(fromBalance) : '—'}</td>
                    <td className="px-2 py-2 text-right font-mono text-rose-600">−{formatMoney(destTotal)}</td>
                    <td className={cn('px-4 py-2 text-right font-mono font-semibold', balanceShort ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100')}>
                      {fromBalance != null ? formatMoney(fromBalance - destTotal) : '—'}
                    </td>
                  </tr>
                  {/* Maqsadlar */}
                  {dests.map((d, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-4 py-2">
                        <div className="font-mono text-slate-700 dark:text-slate-200">{d.contractNo || '—'}</div>
                        <div className="text-[10px] text-slate-400 truncate">{d.client || ''}{d.object ? ` · ${d.object}` : ''}</div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{d.balance != null ? formatMoney(d.balance) : '—'}</td>
                      <td className="px-2 py-2 text-right font-mono text-emerald-600">+{formatMoney(num(d.amount))}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold text-slate-800 dark:text-slate-100">{d.balance != null ? formatMoney(d.balance + num(d.amount)) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Qoldiq yetmasa — blok */}
          {balanceShort && (
            <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-900 p-3.5 flex items-start gap-2.5">
              <Ban className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
              <div className="text-[12.5px] text-rose-700 dark:text-rose-300">
                <b>Manba qoldig'i yetarli emas — переброска qilib bo'lmaydi.</b>
                <div className="mt-0.5">Qoldiq <b>{formatMoney(fromBalance || 0)}</b>, o'tkazma <b>{formatMoney(destTotal)}</b> (yetmayapti: {formatMoney(destTotal - (fromBalance || 0))}). Summani kamaytiring yoki arizani tekshiring.</div>
              </div>
            </div>
          )}

          {/* Tahrirlanadigan forma */}
          <div className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">2 · Tekshiring va to'g'irlang</div>
          <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-slate-500">Manba shartnoma</label>
                <input value={fromCn} onChange={(e) => setFromCn(e.target.value.toUpperCase())}
                  className="mt-1 w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-violet-400 text-[13px] font-mono" />
                {fromMeta.client && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{fromMeta.client}{fromMeta.object ? ` · ${fromMeta.object}` : ''}</div>}
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
                      className="w-40 h-9 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-violet-400 text-[13px] text-right font-mono" />
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

            <div className="flex items-center justify-between pt-2 text-[12px] border-t border-slate-100 dark:border-slate-800">
              <span className="text-slate-500">Maqsadlar jami: <b className="font-mono">{formatMoney(destTotal)}</b></span>
              <span className="text-slate-500">{dests.length} ta shartnoma</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pb-4">
            <button onClick={reset} className="px-4 h-11 rounded-xl text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Tozalash</button>
            <button onClick={() => createMut.mutate()} disabled={!canCreate}
              className="px-5 h-11 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 shadow-lg shadow-fuchsia-500/25">
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Tasdiqlash va yaratish
            </button>
          </div>
        </>
      )}

      {/* PDF/rasm — ochib ko'rish overlay */}
      {showPreview && previewUrl && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex flex-col" onClick={() => setShowPreview(false)}>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-white shrink-0" onClick={(e) => e.stopPropagation()}>
            <span className="text-[13px] font-medium truncate">{file?.name}</span>
            <div className="flex items-center gap-2 shrink-0">
              <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] bg-white/15 hover:bg-white/25 transition-colors"><ExternalLink className="h-3.5 w-3.5" /> Yangi tabda</a>
              <button onClick={() => setShowPreview(false)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] bg-white/15 hover:bg-white/25 transition-colors"><X className="h-3.5 w-3.5" /> Yopish</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 px-4 pb-4" onClick={(e) => e.stopPropagation()}>
            {isImg
              ? <img src={previewUrl} alt="ariza" className="max-h-full max-w-full mx-auto object-contain rounded-lg" />
              : <iframe src={previewUrl} title="ariza" className="w-full h-full rounded-lg bg-white" />}
          </div>
        </div>
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
    if (reason === null) return;
    reverseMut.mutate({ id, reason });
  };

  const STAT: Array<{ k: typeof status; label: string }> = [
    { k: 'all', label: 'Barchasi' }, { k: 'active', label: 'Bajarilgan' }, { k: 'cancelled', label: 'Bekor qilingan' },
  ];

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto">
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
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick}
      className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors', on ? 'bg-violet-600' : 'bg-slate-300 dark:bg-slate-600')}>
      <span className={cn('inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform', on ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </button>
  );
}

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

  return (
    <div className="p-6 space-y-3 max-w-2xl mx-auto">
      {!data?.hasKey && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-900 p-3 text-[12px] text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> AI kalit sozlanmagan. Admin → Agent → AI kalit bo'limidan kiriting (agent ariza o'qishi uchun kerak).
        </div>
      )}

      <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
        <div className="flex items-center gap-3 p-4">
          <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Agent (AI o'qish)</div><div className="text-[11.5px] text-slate-400">O'chirilsa — oddiy qo'lda переброска</div></div>
          <Toggle on={local.aiEnabled} onClick={() => setLocal({ ...local, aiEnabled: !local.aiEnabled })} />
        </div>
        <div className="flex items-center gap-3 p-4">
          <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Qat'iy tekshiruv</div><div className="text-[11.5px] text-slate-400">Yoqilsa — nomuvofiqlikda ogohlantirish kuchli</div></div>
          <Toggle on={local.strict} onClick={() => setLocal({ ...local, strict: !local.strict })} />
        </div>
        <div className="flex items-center gap-3 p-4">
          <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Telegram xabar</div><div className="text-[11.5px] text-slate-400">Переброска yaratilganda/bekor qilinganda guruhga xabar</div></div>
          <Toggle on={local.tgNotify} onClick={() => setLocal({ ...local, tgNotify: !local.tgNotify })} />
        </div>
        <div className="flex items-center gap-3 p-4">
          <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">AI model</div><div className="text-[11.5px] text-slate-400">Ariza o'qish uchun Claude modeli</div></div>
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
