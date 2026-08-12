'use client';

// Chek order — memorial/kvitansiya → tranzaksiyada tekshirish (natija xulosasi + shartlar izohi)
import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Upload, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Hash, Search, Image as ImageIcon, ScanLine, Trash2, ChevronLeft, ChevronRight,
  Building2, CalendarDays, Coins, FileSignature, Landmark, FileText, RotateCcw,
  ZoomIn, X, ScrollText, ArrowRightLeft, Home, ClipboardList, History as HistoryIcon,
  User2, Tag,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';

type Cond = { order: boolean | null; account: boolean | null; date: boolean | null; amount: boolean | null; contract: boolean | null };
type Extracted = {
  orderNo: string; date?: string | null; amount?: number | null; payerName?: string | null;
  payerAccount?: string | null; recipientName?: string | null; recipientAccount?: string | null;
  contractNo?: string | null; purpose?: string | null;
};
type MatchedTx = {
  id: string; externalId: string | null; direction: string; amount: number; currency: string;
  txnDate: string; docNumber: string | null; reference: string | null;
  fromName: string | null; fromAccount: string | null; toName: string | null; toAccount: string | null;
  description: string | null; matchAccount?: string | null;
};
type OrderResult = {
  orderNos: string[]; extracted: Extracted; result: 'found' | 'mismatch' | 'not_found';
  matchedTx: MatchedTx | null; conditions: Cond | null;
};
type HistoryRow = {
  id: string; batchId: string; source: string; orderNo: string; orderDate: string | null;
  amount: number | null; payerName: string | null; recipientName: string | null;
  contractNo: string | null; result: 'found' | 'mismatch' | 'not_found'; conditions: Cond;
  matchedTxExtId: string | null; hasFile: boolean; createdByName: string | null; createdAt: string;
};

const RESULT_META: Record<string, { label: string; cls: string; Icon: any; glow: string }> = {
  found:     { label: 'Topildi',   cls: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900', Icon: CheckCircle2, glow: 'shadow-emerald-500/20' },
  mismatch:  { label: 'Nomuvofiq', cls: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900', Icon: AlertTriangle, glow: 'shadow-amber-500/20' },
  not_found: { label: 'Topilmadi', cls: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900', Icon: XCircle, glow: 'shadow-rose-500/20' },
};

const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

// Oddiy tilда xulosa — begona/yangi foydalanuvchi ham tushunsin
function verdictOf(r: OrderResult): string {
  const c = r.conditions;
  if (r.result === 'not_found')
    return "Bu to'lov bizning tranzaksiyalarda TOPILMADI — ya'ni bunday to'lov bizga tushmagan yoki hali qayd etilmagan.";
  if (r.result === 'found')
    return "To'lov tranzaksiyalarda TOPILDI, muhim shartlar (summa va shartnoma) mos keldi — bu bizga tushgan haqiqiy to'lov.";
  // mismatch
  const bad: string[] = [];
  if (c?.amount === false) bad.push('summa');
  if (c?.contract === false) bad.push('shartnoma');
  if (bad.length === 0 && c?.order === false && c?.account === false) bad.push('order raqami va hisob');
  const badTxt = bad.length ? bad.join(' va ') : "ba'zi shartlar";
  return `O'xshash to'lov topildi, LEKIN ${badTxt} mos kelmadi. Bu boshqa to'lov bo'lishi mumkin — qo'lда tekshirish tavsiya etiladi.`;
}

const condWord = (ok: boolean | null | undefined) => ok === true ? 'mos keldi' : ok === false ? 'mos kelmadi' : 'tekshirilmadi';

export default function ChekOrderPage() {
  const qc = useQueryClient();
  const canManage = useHasPermission(PERMS.CHEKORDER_MANAGE);
  const canView = useHasPermission(PERMS.CHEKORDER_VIEW);
  const canHistory = useHasPermission(PERMS.CHEKORDER_HISTORY);

  const [view, setView] = useState<'check' | 'history'>('check');
  const [mode, setMode] = useState<'upload' | 'manual' | 'contract'>('upload');
  const [orderNos, setOrderNos] = useState('');
  const [results, setResults] = useState<OrderResult[] | null>(null);
  // Shartnoma rejimi
  const [contractQ, setContractQ] = useState('');
  const [contractQDeb, setContractQDeb] = useState('');
  const [selectedContract, setSelectedContract] = useState<string | null>(null);
  const [suggFocused, setSuggFocused] = useState(false);
  useEffect(() => { const id = setTimeout(() => setContractQDeb(contractQ), 300); return () => clearTimeout(id); }, [contractQ]);

  const { data: sugg, isFetching: suggesting } = useQuery({
    queryKey: ['chek-crm-suggest', contractQDeb],
    queryFn: () => api.get<{ items: any[] }>(`/chek-order/crm-suggest?q=${encodeURIComponent(contractQDeb)}`),
    enabled: mode === 'contract' && contractQDeb.trim().length >= 2 && !selectedContract,
  });
  const { data: cPayments, isLoading: payLoading } = useQuery({
    queryKey: ['chek-contract-payments', selectedContract],
    queryFn: () => api.get<{ items: MatchedTx[] }>(`/chek-order/contract-payments?contract=${encodeURIComponent(selectedContract || '')}`),
    enabled: mode === 'contract' && !!selectedContract,
  });
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{ url: string; isPdf: boolean; name: string } | null>(null);
  const [zoom, setZoom] = useState(false);
  const [lbZoom, setLbZoom] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setActiveResult(0); }, [results]);

  const [hResult, setHResult] = useState<'all' | 'found' | 'mismatch' | 'not_found'>('all');
  const [hQ, setHQ] = useState('');
  const [hPage, setHPage] = useState(1);

  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(false); };
    if (zoom) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoom]);

  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ['chek-order-history', hResult, hQ, hPage],
    queryFn: () => api.get<{ items: HistoryRow[]; total: number; pageCount: number; stats: { found: number; mismatch: number; not_found: number } }>(
      `/chek-order?result=${hResult}&q=${encodeURIComponent(hQ)}&page=${hPage}`,
    ),
    enabled: canHistory,
  });
  const refreshHistory = () => { if (canHistory) qc.invalidateQueries({ queryKey: ['chek-order-history'] }); };

  const analyzeMut = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append('file', f); return api.postForm<{ results: OrderResult[] }>('/chek-order/analyze', fd, { timeout: 120_000 }); },
    onSuccess: (r) => { setResults(r.results); refreshHistory(); toast.success(`${r.results.length} ta hujjat tekshirildi`); },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });
  const manualMut = useMutation({
    mutationFn: (nums: string) => api.post<{ results: OrderResult[] }>('/chek-order/manual', { orderNos: nums }),
    onSuccess: (r) => { setResults(r.results); refreshHistory(); toast.success(`${r.results.length} ta order tekshirildi`); },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/chek-order/${id}`),
    onSuccess: () => { refreshHistory(); toast.success("O'chirildi"); },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const analyzing = analyzeMut.isPending;
  const busy = analyzing || manualMut.isPending;
  const stats = history?.stats;
  // Natija ostidagi CRM panel — joriy natija shartnomasi (topilgan/nomuvofiq bo'lsa)
  const activeR = results?.[activeResult];
  const panelContract = activeR && activeR.result !== 'not_found' ? (activeR.extracted.contractNo || null) : null;

  const onFile = useCallback((f: File | null) => {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { toast.error('Fayl 25 MB dan oshmasligi kerak'); return; }
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    setPreview((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return { url: URL.createObjectURL(f), isPdf, name: f.name }; });
    setResults(null);
    analyzeMut.mutate(f);
  }, [analyzeMut]);

  const reset = () => {
    setResults(null);
    setPreview((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return null; });
    setOrderNos('');
    setContractQ(''); setSelectedContract(null);
  };

  const pickContract = (c: string) => {
    setSelectedContract(c);
    setContractQ(c);
    setSuggFocused(false);
    setResults(null);
  };
  // Shartnoma to'lovi tanlanganda — to'g'ridan-to'g'ri "topilgan" natija sifatida ko'rsatamiz
  const pickPayment = (tx: MatchedTx) => {
    setResults([{
      orderNos: [tx.docNumber || tx.id],
      extracted: {
        orderNo: tx.docNumber || '', contractNo: selectedContract || undefined,
        amount: tx.amount, date: tx.txnDate, recipientAccount: tx.toAccount || undefined,
        recipientName: tx.toName || undefined, payerName: tx.fromName || undefined,
      },
      result: 'found',
      matchedTx: tx,
      conditions: { order: true, account: true, amount: true, contract: true, date: true },
    }]);
  };
  const showSugg = mode === 'contract' && !selectedContract && contractQDeb.trim().length >= 2 && suggFocused && (suggesting || (sugg?.items?.length ?? 0) > 0);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <style>{`
        @keyframes chekScan { 0% { top:-70px; opacity:.35 } 50% { opacity:1 } 100% { top:100%; opacity:.35 } }
        @keyframes chekPulse { 0%,100% { opacity:.5 } 50% { opacity:1 } }
        @keyframes chekShimmer { 0% { background-position:200% 0 } 100% { background-position:-200% 0 } }
        @keyframes chekSpin { to { transform: rotate(360deg) } }
        .chek-scanline { position:absolute; left:0; right:0; top:-70px; height:70px; background:linear-gradient(to bottom, transparent, rgba(129,140,248,.32) 55%, rgba(167,139,250,.12), transparent); box-shadow:0 0 40px 10px rgba(129,140,248,.30); animation: chekScan 2.2s cubic-bezier(.45,0,.55,1) infinite; }
        .chek-scangrid { background-image:linear-gradient(rgba(129,140,248,.09) 1px,transparent 1px),linear-gradient(90deg,rgba(129,140,248,.09) 1px,transparent 1px); background-size:26px 26px; }
        .chek-corner { position:absolute; width:26px; height:26px; border:2.5px solid rgba(129,140,248,.85); box-shadow:0 0 12px rgba(129,140,248,.5); animation: chekPulse 1.6s ease-in-out infinite; }
        .chek-corner.tl { top:12px; left:12px; border-right:0; border-bottom:0; border-top-left-radius:9px }
        .chek-corner.tr { top:12px; right:12px; border-left:0; border-bottom:0; border-top-right-radius:9px }
        .chek-corner.bl { bottom:12px; left:12px; border-right:0; border-top:0; border-bottom-left-radius:9px }
        .chek-corner.br { bottom:12px; right:12px; border-left:0; border-top:0; border-bottom-right-radius:9px }
        .chek-shimmer { background:linear-gradient(100deg, rgba(148,163,184,.09) 30%, rgba(148,163,184,.22) 50%, rgba(148,163,184,.09) 70%); background-size:200% 100%; animation: chekShimmer 1.4s ease-in-out infinite; border-radius:8px; }
        .chek-loader { width:52px; height:52px; border-radius:9999px; background:conic-gradient(from 90deg, rgba(129,140,248,0) 0deg, rgba(129,140,248,.15) 90deg, #818cf8 300deg, #a78bfa 360deg); -webkit-mask:radial-gradient(closest-side, transparent 63%, #000 65%); mask:radial-gradient(closest-side, transparent 63%, #000 65%); animation: chekSpin .9s linear infinite; filter:drop-shadow(0 0 6px rgba(129,140,248,.45)); }
      `}</style>

      <Topbar title="Chek order" subtitle="Memorial order / kvitansiya → tranzaksiyada bor-yo'qligini tekshirish" />

      <div className="px-4 lg:px-6 py-5 w-full space-y-4">
        {/* Sub-tablar + Yangi tekshiruv */}
        <div className="flex items-end justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-1">
            <SubTab active={view === 'check'} onClick={() => setView('check')} icon={<ClipboardList className="h-4 w-4" />} label="Tekshirish" />
            {canHistory && (
              <SubTab active={view === 'history'} onClick={() => setView('history')} icon={<HistoryIcon className="h-4 w-4" />} label="Tarix"
                badge={stats ? (stats.found + stats.mismatch + stats.not_found) : undefined} />
            )}
          </div>
          {(preview || results) && canManage && view === 'check' && (
            <button onClick={reset}
              className="group mb-1.5 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-[12px] font-semibold shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/40 hover:-translate-y-0.5 transition-all">
              <RotateCcw className="h-4 w-4 transition-transform duration-500 group-hover:-rotate-180" /> Yangi tekshiruv
            </button>
          )}
        </div>

        {view === 'check' ? (
          <>
            {canManage && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,640px)_1fr]">
                {/* CHAP: surat / kirish */}
                <Card className="border-0 shadow-soft overflow-visible self-start">
                  <div className="flex items-center gap-1 p-1 m-3 mb-0 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
                    <button onClick={() => setMode('upload')} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors', mode === 'upload' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700')}>
                      <ImageIcon className="h-3.5 w-3.5" /> Surat / PDF
                    </button>
                    <button onClick={() => setMode('manual')} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors', mode === 'manual' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700')}>
                      <Hash className="h-3.5 w-3.5" /> Order raqami
                    </button>
                    <button onClick={() => setMode('contract')} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors', mode === 'contract' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700')}>
                      <FileSignature className="h-3.5 w-3.5" /> Shartnoma
                    </button>
                  </div>

                  <div className="p-3">
                    {mode === 'upload' ? (
                      preview ? (
                        <div className="relative rounded-2xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-950 group">
                          {preview.isPdf ? (
                            <div className="aspect-[3/2] grid place-items-center text-slate-300"><div className="text-center"><FileText className="h-14 w-14 mx-auto mb-2 opacity-70" /><div className="text-[12px] truncate max-w-[340px] px-4">{preview.name}</div></div></div>
                          ) : (
                            <button onClick={() => setZoom(true)} className="block w-full cursor-zoom-in" title="Kattalashtirish">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={preview.url} alt="order" className="w-full max-h-[860px] min-h-[380px] object-contain" />
                              {!analyzing && (
                                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 px-2 h-7 rounded-lg bg-slate-900/70 backdrop-blur text-white text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                                  <ZoomIn className="h-3.5 w-3.5" /> Kattalashtirish
                                </span>
                              )}
                            </button>
                          )}
                          {analyzing && (
                            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                              <div className="absolute inset-0 chek-scangrid" />
                              <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 via-transparent to-violet-500/10" />
                              <div className="chek-scanline" />
                              <span className="chek-corner tl" /><span className="chek-corner tr" /><span className="chek-corner bl" /><span className="chek-corner br" />
                              <div className="absolute top-3 left-3 w-9 h-9 rounded-xl bg-indigo-600/85 backdrop-blur grid place-items-center text-white shadow-lg shadow-indigo-500/40" style={{ animation: 'chekPulse 1.4s ease-in-out infinite' }}>
                                <ScanLine className="h-5 w-5" />
                              </div>
                            </div>
                          )}
                          <button onClick={() => fileRef.current?.click()} disabled={busy} className="absolute top-2 right-2 inline-flex items-center gap-1 px-2.5 h-7 rounded-lg bg-slate-900/70 backdrop-blur text-white text-[11px] font-semibold hover:bg-slate-900 disabled:opacity-50">
                            <Upload className="h-3 w-3" /> Boshqa
                          </button>
                          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
                        </div>
                      ) : (
                        <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
                          onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0] || null); }}
                          onClick={() => !busy && fileRef.current?.click()}
                          className={cn('relative rounded-2xl border-2 border-dashed transition-all cursor-pointer grid place-items-center text-center px-6 py-20',
                            dragOver ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30 scale-[1.005]' : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-900/40')}>
                          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 dark:from-indigo-500/20 dark:to-violet-500/20 grid place-items-center"><Upload className="h-7 w-7 text-indigo-500" /></div>
                            <div className="text-[14px] font-semibold text-slate-700 dark:text-slate-200">Memorial order / kvitansiya suratini tashlang</div>
                            <div className="text-[11.5px] text-slate-400">yoki bosing — rasm yoki PDF · bitta suratда bir nechta hujjat bo'lishi mumkin</div>
                          </div>
                        </div>
                      )
                    ) : mode === 'manual' ? (
                      <div className="space-y-2">
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Order raqam(lar)i</label>
                        <textarea value={orderNos} onChange={(e) => setOrderNos(e.target.value)} placeholder="268041120&#10;13425470" rows={5}
                          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] tabular-nums font-mono resize-y outline-none focus:ring-2 focus:ring-indigo-500/40" />
                        <button onClick={() => { setResults(null); manualMut.mutate(orderNos); }} disabled={busy || !orderNos.trim()} className="inline-flex items-center gap-2 px-4 h-9 rounded-xl bg-indigo-600 text-white text-[12.5px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Tranzaksiyada tekshir
                        </button>
                        <p className="text-[11px] text-slate-400 pt-1">Eslatma: faqat raqam bo'yicha. To'liq (hisob+shartnoma+summa) tekshiruv uchun suratни yuklang.</p>
                      </div>
                    ) : (
                      /* ── SHARTNOMA rejimi — CRM taklif + to'lovlar ── */
                      <div className="space-y-3">
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Shartnoma raqami</label>
                        <div className="relative">
                          <FileSignature className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            value={contractQ}
                            onChange={(e) => { setContractQ(e.target.value.toUpperCase()); if (selectedContract) { setSelectedContract(null); setResults(null); } }}
                            onFocus={() => setSuggFocused(true)}
                            onBlur={() => setTimeout(() => setSuggFocused(false), 150)}
                            placeholder="Shartnoma raqamini yozing — CRM'dan qidiriladi"
                            className="w-full pl-9 pr-9 h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] font-mono outline-none focus:ring-2 focus:ring-indigo-500/40" />
                          {selectedContract && (
                            <button onClick={() => { setSelectedContract(null); setContractQ(''); setResults(null); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500"><X className="h-4 w-4" /></button>
                          )}
                          {showSugg && (
                            <div className="absolute z-20 mt-1 left-0 right-0 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-xl max-h-72 overflow-y-auto">
                              {suggesting && (sugg?.items?.length ?? 0) === 0 ? (
                                <div className="p-4 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
                              ) : (sugg?.items || []).map((s: any, i: number) => (
                                <button key={i} onMouseDown={(e) => { e.preventDefault(); pickContract(s.contract); }}
                                  className="w-full text-left px-3 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 border-b border-slate-50 dark:border-slate-800 last:border-0 transition-colors">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono font-semibold text-[13px] text-slate-800 dark:text-slate-200">{s.contract}</span>
                                    {s.status && <span className="text-[10px] text-slate-400">{s.status}</span>}
                                  </div>
                                  <div className="text-[11.5px] text-slate-500 truncate">{[s.clientFullName, s.object, s.apartmentNumber && `№ ${s.apartmentNumber}`].filter(Boolean).join(' · ') || '—'}</div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {selectedContract && (
                          <div className="rounded-xl ring-1 ring-slate-100 dark:ring-slate-800 overflow-hidden">
                            <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center justify-between">
                              <span>To'lovlar</span>
                              <span className="tabular-nums">{cPayments?.items?.length ?? 0} ta</span>
                            </div>
                            {payLoading ? (
                              <div className="p-6 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
                            ) : (cPayments?.items?.length ?? 0) === 0 ? (
                              <div className="p-6 text-center text-[12px] text-slate-400">Bu shartnoma bo'yicha tranzaksiya topilmadi</div>
                            ) : (
                              <div className="max-h-80 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800">
                                {(cPayments?.items || []).map((tx) => {
                                  const active = results?.[0]?.matchedTx?.id === tx.id;
                                  return (
                                    <button key={tx.id} onClick={() => pickPayment(tx)}
                                      className={cn('w-full text-left px-3 py-2.5 transition-colors', active ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50')}>
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-[12px] tabular-nums text-slate-500">{fmtDate(tx.txnDate)}</span>
                                        <span className={cn('text-[13px] font-bold tabular-nums', tx.direction === 'IN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>{tx.direction === 'IN' ? '+' : '−'}{formatMoney(tx.amount, '')}</span>
                                      </div>
                                      <div className="flex items-center justify-between gap-2 mt-0.5">
                                        <span className="text-[11px] text-slate-400 font-mono">№ {tx.docNumber || '—'}</span>
                                        <span className="text-[10.5px] text-slate-400 truncate max-w-[240px]">{tx.fromName || tx.toName || ''}</span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                        {!selectedContract && <p className="text-[11px] text-slate-400">Shartnomani tanlang — to'lovlari chiqadi. Kerakli to'lovni bosing.</p>}
                      </div>
                    )}
                  </div>
                </Card>

                {/* O'NG: natija */}
                <div className="space-y-3 min-w-0">
                  {busy && !results ? (
                    <Card className="border-0 shadow-soft overflow-hidden relative">
                      <div className="chek-shimmer h-12" />
                      <div className="p-4 grid gap-4 md:grid-cols-2">
                        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="flex items-center gap-2"><div className="chek-shimmer w-5 h-5 rounded-md" /><div className="chek-shimmer h-3.5 flex-1" style={{ maxWidth: `${70 - i * 6}%` }} /></div>)}</div>
                        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="flex items-center gap-2"><div className="chek-shimmer w-4 h-4 rounded-full" /><div className="chek-shimmer h-3.5 flex-1" style={{ maxWidth: `${75 - i * 5}%` }} /></div>)}</div>
                      </div>
                      <div className="border-t border-slate-100 dark:border-slate-800 p-4"><div className="chek-shimmer h-28 rounded-xl" /></div>
                      {/* markazда pro loader — konik-gradient halqa + pulslanuvchi scan icon (matnsiz) */}
                      <div className="absolute inset-0 grid place-items-center pointer-events-none">
                        <div className="relative w-[68px] h-[68px] grid place-items-center rounded-2xl bg-white/75 dark:bg-slate-900/75 backdrop-blur-md shadow-lg shadow-indigo-500/10 ring-1 ring-slate-100/80 dark:ring-slate-800">
                          <div className="chek-loader" />
                          <ScanLine className="absolute h-5 w-5 text-indigo-500" style={{ animation: 'chekPulse 1.4s ease-in-out infinite' }} />
                        </div>
                      </div>
                    </Card>
                  ) : results && results.length > 0 ? (
                    <>
                      <div className="flex items-center justify-between gap-2 px-1">
                        <div className="text-[12px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Natija — {results.length} ta</div>
                      </div>
                      {results.length > 1 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {results.map((r, i) => {
                            const m = RESULT_META[r.result];
                            const on = i === activeResult;
                            return (
                              <button key={i} onClick={() => setActiveResult(i)}
                                className={cn('inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-semibold ring-1 transition-colors',
                                  on ? 'bg-indigo-600 text-white ring-indigo-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700')}>
                                <m.Icon className={cn('h-3.5 w-3.5', on ? 'text-white' : (r.result === 'found' ? 'text-emerald-500' : r.result === 'mismatch' ? 'text-amber-500' : 'text-rose-500'))} />
                                <span className="font-mono tabular-nums">№ {r.orderNos[0]}{r.orderNos.length > 1 ? ` +${r.orderNos.length - 1}` : ''}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {results[activeResult] && <ResultCard r={results[activeResult]} />}
                    </>
                  ) : (
                    <Card className="border-0 shadow-soft p-12 grid place-items-center text-center">
                      <div className="text-slate-300 dark:text-slate-600">
                        <ScanLine className="h-10 w-10 mx-auto mb-2" />
                        <div className="text-[13px] text-slate-400">{mode === 'contract' ? "Shartnoma va to'lovni tanlang — natija shu yerда chiqadi" : "Suratni yuklang — natija shu yerда chiqadi"}</div>
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            )}
            {canManage && panelContract && <ContractInfoPanel contract={panelContract} />}
          </>
        ) : (
          /* ── TARIX ── */
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                {stats && <><StatChip n={stats.found} label="Topildi" tone="emerald" /><StatChip n={stats.mismatch} label="Nomuvofiq" tone="amber" /><StatChip n={stats.not_found} label="Topilmadi" tone="rose" /></>}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={hQ} onChange={(e) => { setHQ(e.target.value); setHPage(1); }} placeholder="Order / shartnoma / ism" className="pl-8 pr-3 h-8 w-60 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12px] outline-none focus:ring-2 focus:ring-indigo-500/30" />
                </div>
                <select value={hResult} onChange={(e) => { setHResult(e.target.value as any); setHPage(1); }} className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12px] px-2 outline-none">
                  <option value="all">Barchasi</option><option value="found">Topildi</option><option value="mismatch">Nomuvofiq</option><option value="not_found">Topilmadi</option>
                </select>
              </div>
            </div>
            <Card className="border-0 shadow-soft overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2.5">Order №</th>
                      <th className="text-left font-semibold px-3 py-2.5">Sana</th>
                      <th className="text-right font-semibold px-3 py-2.5">Summa</th>
                      <th className="text-left font-semibold px-3 py-2.5">Shartnoma</th>
                      <th className="text-left font-semibold px-3 py-2.5">Oluvchi</th>
                      <th className="text-center font-semibold px-3 py-2.5">Shartlar</th>
                      <th className="text-left font-semibold px-3 py-2.5">Natija</th>
                      <th className="text-left font-semibold px-3 py-2.5">Kim · Qachon</th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {histLoading ? (
                      <tr><td colSpan={9} className="p-10 text-center text-slate-400">…</td></tr>
                    ) : (history?.items?.length ?? 0) === 0 ? (
                      <tr><td colSpan={9} className="p-10 text-center text-slate-400">Hali tekshiruv yo'q</td></tr>
                    ) : history!.items.map((row) => {
                      const meta = RESULT_META[row.result];
                      return (
                        <tr key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="px-3 py-2.5 font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{row.orderNo}</td>
                          <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">{fmtDate(row.orderDate)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">{row.amount != null ? formatMoney(row.amount, '') : '—'}</td>
                          <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-400">{row.contractNo || '—'}</td>
                          <td className="px-3 py-2.5 max-w-[160px] truncate text-slate-600 dark:text-slate-400" title={row.recipientName || ''}>{row.recipientName || '—'}</td>
                          <td className="px-3 py-2.5"><CondDots c={row.conditions} /></td>
                          <td className="px-3 py-2.5"><span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md ring-1 text-[10.5px] font-bold whitespace-nowrap', meta.cls)}><meta.Icon className="h-3 w-3" /> {meta.label}</span></td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">{row.createdByName || '—'} · {fmtDate(row.createdAt)}</td>
                          <td className="px-3 py-2.5 text-right">{canManage && <button onClick={() => { if (confirm("O'chirilsinmi?")) delMut.mutate(row.id); }} className="text-slate-400 hover:text-rose-600 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(history?.pageCount ?? 1) > 1 && (
                <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-slate-100 dark:border-slate-800">
                  <button disabled={hPage <= 1} onClick={() => setHPage((p) => p - 1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  <span className="text-[12px] text-slate-500 tabular-nums">{hPage} / {history!.pageCount}</span>
                  <button disabled={hPage >= (history?.pageCount ?? 1)} onClick={() => setHPage((p) => p + 1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* Lightbox — surat kattalashtirilgan (bosib yana zoom) */}
      {zoom && preview && !preview.isPdf && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/90 backdrop-blur-sm overflow-auto p-4" onClick={() => { setZoom(false); setLbZoom(false); }}>
          <div className="sticky top-0 z-10 flex items-center justify-end gap-2">
            <button className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white transition-colors" title={lbZoom ? 'Kichraytirish' : 'Kattalashtirish'} onClick={(e) => { e.stopPropagation(); setLbZoom((v) => !v); }}>
              {lbZoom ? <ZoomIn className="h-5 w-5 rotate-45" /> : <ZoomIn className="h-5 w-5" />}
            </button>
            <button className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white transition-colors" onClick={(e) => { e.stopPropagation(); setZoom(false); setLbZoom(false); }}><X className="h-5 w-5" /></button>
          </div>
          <div className="min-h-full grid place-items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt="order"
              className={cn('rounded-lg shadow-2xl transition-all duration-200', lbZoom ? 'max-w-none w-auto cursor-zoom-out' : 'max-w-full max-h-[86vh] object-contain cursor-zoom-in')}
              style={lbZoom ? { width: 'min(2400px, 190vw)' } : undefined}
              onClick={(e) => { e.stopPropagation(); setLbZoom((v) => !v); }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Natija kartasi ───
function ResultCard({ r }: { r: OrderResult }) {
  const meta = RESULT_META[r.result];
  const ex = r.extracted;
  const tx = r.matchedTx;
  const c = r.conditions;
  const orderDiffers = c && c.order === false;
  const acctVal = tx?.matchAccount || tx?.toAccount;
  const [modal, setModal] = useState<null | 'tx' | 'kv'>(null);

  return (
    <Card className={cn('border-0 shadow-lg overflow-hidden', meta.glow)}>
      <div className={cn('flex items-center justify-between gap-3 px-4 py-2.5 border-b',
        r.result === 'found' ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/40'
        : r.result === 'mismatch' ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/40'
        : 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/40')}>
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ring-1 text-[11.5px] font-bold', meta.cls)}><meta.Icon className="h-3.5 w-3.5" /> {meta.label}</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {r.orderNos.map((no, i) => (
              <span key={i} className="font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums text-[13px]">№ {no}</span>
            ))}
            {r.orderNos.length > 1 && <span className="text-[10px] text-slate-400 font-medium">(1 to'lov · {r.orderNos.length} hujjat)</span>}
          </div>
        </div>
        {ex.amount != null && <span className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tabular-nums">{formatMoney(ex.amount, '')} <span className="text-[10px] text-slate-400">so'm</span></span>}
      </div>

      {/* Oddiy tildagi xulosa — begona foydalanuvchi ham tushunsin */}
      <div className={cn('flex items-start gap-2 px-4 py-2.5 text-[12px] leading-relaxed border-b',
        r.result === 'found' ? 'bg-emerald-50/40 dark:bg-emerald-950/10 text-emerald-800 dark:text-emerald-300 border-emerald-100/60 dark:border-emerald-900/30'
        : r.result === 'mismatch' ? 'bg-amber-50/40 dark:bg-amber-950/10 text-amber-800 dark:text-amber-300 border-amber-100/60 dark:border-amber-900/30'
        : 'bg-rose-50/40 dark:bg-rose-950/10 text-rose-800 dark:text-rose-300 border-rose-100/60 dark:border-rose-900/30')}>
        <meta.Icon className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{verdictOf(r)}</span>
      </div>

      <div className="p-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Hujjatдan o'qildi</div>
          <InfoRow icon={<Landmark className="h-3.5 w-3.5" />} label="Hisob (oluvchi)" value={ex.recipientAccount || '—'} mono />
          <InfoRow icon={<Coins className="h-3.5 w-3.5" />} label="Summa" value={ex.amount != null ? formatMoney(ex.amount, '') : '—'} />
          <InfoRow icon={<FileSignature className="h-3.5 w-3.5" />} label="Shartnoma" value={ex.contractNo || '—'} mono />
          <InfoRow icon={<CalendarDays className="h-3.5 w-3.5" />} label="Sana" value={fmtDate(ex.date)} />
          <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Oluvchi" value={ex.recipientName || '—'} />
          {ex.payerName && <InfoRow icon={<Coins className="h-3.5 w-3.5" />} label="To'lovchi" value={ex.payerName} />}
        </div>

        <div className="space-y-2">
          {r.result === 'not_found' ? (
            <div className="h-full grid place-items-center rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 p-4 text-center">
              <div><XCircle className="h-7 w-7 text-rose-400 mx-auto mb-1.5" /><div className="text-[13px] font-semibold text-rose-700 dark:text-rose-300">Tranzaksiyada topilmadi</div><div className="text-[11px] text-rose-500/80 mt-0.5">Order №, hisob, shartnoma va summa bo'yicha mos to'lov yo'q</div></div>
            </div>
          ) : (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Shartlar tekshiruvi</div>
              <div className="text-[10.5px] text-slate-400 -mt-1 mb-1">Hujjatдаги ma'lumot topilgan tranzaksiyaga mos kelishini tekshirish:</div>
              <CondRow label="Order №" ok={c?.order} txVal={tx?.docNumber} mono note={orderDiffers ? 'kvitansiya raqami bank hujjat raqamidan farq qiladi — bu normal' : undefined} />
              <CondRow label="Hisob" ok={c?.account} txVal={acctVal} mono />
              <CondRow label="Summa" ok={c?.amount} txVal={tx ? formatMoney(tx.amount, '') : ''} />
              <CondRow label="Shartnoma" ok={c?.contract} txVal={ex.contractNo || ''} mono />
              <CondRow label="Sana" ok={c?.date} txVal={fmtDate(tx?.txnDate)} />
            </>
          )}
        </div>
      </div>

      {/* Topilgan tranzaksiya — to'liq + amallar */}
      {tx && (
        <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-4">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"><ScrollText className="h-3.5 w-3.5" /> Topilgan tranzaksiya</div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setModal('tx')}
                className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 transition-colors" title="Tranzaksiya ma'lumoti">
                <ArrowRightLeft className="h-3.5 w-3.5" /> Tranzaksiya
              </button>
              {ex.contractNo && (
                <button onClick={() => setModal('kv')}
                  className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg bg-violet-600 text-white text-[11px] font-semibold hover:bg-violet-700 transition-colors" title="ОплатыКв to'lovlari">
                  <Home className="h-3.5 w-3.5" /> ОплатыКв
                </button>
              )}
            </div>
          </div>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-[12px]">
            <TxRow label="Summa" value={`${formatMoney(tx.amount, '')} ${tx.currency}`} strong />
            <TxRow label="Sana" value={fmtDate(tx.txnDate)} />
            <TxRow label="Bank docNumber" value={tx.docNumber || '—'} mono />
            <TxRow label="Yo'nalish" value={tx.direction === 'IN' ? 'Kirim' : 'Chiqim'} />
            <TxRow label="To'lovchi" value={tx.fromName || '—'} />
            <TxRow label="Oluvchi" value={tx.toName || '—'} />
            <TxRow label="Debet hisob" value={tx.fromAccount || '—'} mono />
            <TxRow label="Kredit hisob" value={tx.toAccount || '—'} mono />
            <TxRow label="Izoh" value={tx.description || '—'} full />
            <TxRow label="Ext ID" value={tx.externalId || tx.id} mono full />
          </div>
        </div>
      )}

      {modal === 'tx' && tx && <TxDetailModal txId={tx.id} onClose={() => setModal(null)} />}
      {modal === 'kv' && ex.contractNo && <OplataKvModal contract={ex.contractNo} onClose={() => setModal(null)} />}
    </Card>
  );
}

// ─── Tranzaksiya to'liq ma'lumot modali (read-only, tahrirlash tugmalarisiz) ───
function TxDetailModal({ txId, onClose }: { txId: string; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  const { data: d, isLoading } = useQuery({ queryKey: ['chek-tx-detail', txId], queryFn: () => api.get<any>(`/transactions/${txId}`) });
  const [open, setOpen] = useState<Set<string>>(new Set(['yub', 'qab', 'maqsad', 'vaqt', 'tizim']));
  const toggle = (k: string) => setOpen((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const isIn = d?.direction === 'IN';

  return (
    <div className="fixed inset-0 z-[9998] bg-slate-950/70 backdrop-blur-sm grid place-items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-3xl my-6 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {isLoading || !d ? (
          <div className="p-16 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
        ) : (
          <>
            <div className={cn('p-5 text-white relative', isIn ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-rose-500 to-red-600')}>
              <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center"><X className="h-4 w-4" /></button>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/20 text-[11px] font-bold mb-2"><ArrowRightLeft className="h-3 w-3" /> {isIn ? 'KIRIM' : 'CHIQIM'} · {fmtDate(d.txnDate)}{d.operationTime ? ` · ${d.operationTime}` : ''}</div>
              <div className="text-2xl font-bold tabular-nums">{isIn ? '+' : '−'}{formatMoney(Number(d.amount), '')} <span className="text-sm font-medium opacity-80">{d.currency}</span></div>
              {(d.counterpartyDisplay || d.category?.name) && <div className="text-[12px] opacity-90 mt-0.5">{d.counterpartyDisplay || d.category?.name}</div>}
            </div>

            <div className="p-5 space-y-2.5 max-h-[74vh] overflow-y-auto">
              {/* Tepа kartalar */}
              <div className="grid gap-2 sm:grid-cols-2">
                <TopCard icon={<Building2 className="h-3.5 w-3.5" />} label="Kontragent" value={d.counterpartyDisplay || d.category?.name || '—'} />
                <TopCard icon={<Landmark className="h-3.5 w-3.5" />} label="Kategoriya" value={[d.category?.name, d.subcategory?.name].filter(Boolean).join(' · ') || '—'} />
                {d.contractNumber && <TopCard icon={<FileSignature className="h-3.5 w-3.5" />} label="Shartnoma" value={d.contractNumber} sub={d.contractCustomer || undefined} mono />}
              </div>

              {/* Yig'iladigan bo'limlar */}
              <Collapse open={open.has('yub')} onToggle={() => toggle('yub')} icon={<Coins className="h-3.5 w-3.5" />} title="Yuboruvchi">
                <DRow label="Nomi" value={d.fromName || '—'} />
                <DRow label="Hisob" value={d.fromAccount || '—'} mono />
                {d.fromInn && <DRow label="INN" value={d.fromInn} mono />}
              </Collapse>
              <Collapse open={open.has('qab')} onToggle={() => toggle('qab')} icon={<Landmark className="h-3.5 w-3.5" />} title="Qabul qiluvchi">
                <DRow label="Nomi" value={d.toName || '—'} />
                <DRow label="Hisob" value={d.toAccount || '—'} mono />
                {d.toInn && <DRow label="INN" value={d.toInn} mono />}
              </Collapse>
              <Collapse open={open.has('maqsad')} onToggle={() => toggle('maqsad')} icon={<FileText className="h-3.5 w-3.5" />} title="To'lov maqsadi">
                <p className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed break-words">{d.description || '—'}</p>
                {d.purposeCode && <DRow label="Maqsad kodi" value={d.purposeCode} mono />}
              </Collapse>
              <Collapse open={open.has('vaqt')} onToggle={() => toggle('vaqt')} icon={<CalendarDays className="h-3.5 w-3.5" />} title="Vaqt ma'lumotlari">
                <DRow label="Hujjat sanasi" value={fmtDate(d.txnDate)} />
                {d.valueDate && <DRow label="Value date" value={fmtDate(d.valueDate)} />}
                {d.operationTime && <DRow label="Operatsiya vaqti" value={d.operationTime} />}
                {d.inputAt && <DRow label="Kiritilgan" value={fmtDate(d.inputAt)} />}
              </Collapse>
              <Collapse open={open.has('tizim')} onToggle={() => toggle('tizim')} icon={<Hash className="h-3.5 w-3.5" />} title="Tizim ma'lumotlari">
                {d.bank?.name && <DRow label="Bank" value={d.bank.name} />}
                <DRow label="Bank docNumber" value={d.docNumber || '—'} mono />
                {d.bankB2Id && <DRow label="B2 ID" value={d.bankB2Id} mono />}
                {d.bankGeneralId && <DRow label="Global ID (NCI)" value={d.bankGeneralId} mono />}
                {d.bankClientId && <DRow label="Klient ID" value={d.bankClientId} mono />}
                <DRow label="Ext ID" value={d.externalId || d.id} mono />
              </Collapse>
              {d.metadata && (
                <Collapse open={open.has('json')} onToggle={() => toggle('json')} icon={<FileText className="h-3.5 w-3.5" />} title="Bankdan kelgan to'liq JSON">
                  <pre className="text-[10.5px] leading-relaxed text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2.5 overflow-x-auto max-h-64 overflow-y-auto">{JSON.stringify(d.metadata, null, 2)}</pre>
                </Collapse>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TopCard({ icon, label, value, sub, mono }: { icon: React.ReactNode; label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl ring-1 ring-slate-100 dark:ring-slate-800 px-3 py-2">
      <span className="text-slate-400 shrink-0">{icon}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 w-20 shrink-0">{label}</span>
      <span className="min-w-0">
        <span className={cn('block text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 truncate', mono && 'font-mono')}>{value}</span>
        {sub && <span className="block text-[11px] text-slate-500 truncate">{sub}</span>}
      </span>
    </div>
  );
}

function Collapse({ open, onToggle, icon, title, children }: { open: boolean; onToggle: () => void; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl ring-1 ring-slate-100 dark:ring-slate-800 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
        <span className="text-slate-400">{icon}</span>
        <span className="flex-1 text-left uppercase tracking-wider text-[10.5px] text-slate-500 dark:text-slate-400">{title}</span>
        <ChevronRight className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-90')} />
      </button>
      {open && <div className="px-3 pb-3 pt-0.5 space-y-1">{children}</div>}
    </div>
  );
}

function DRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-[12px]">
      <span className="text-slate-400 w-28 shrink-0">{label}</span>
      <span className={cn('min-w-0 break-words text-slate-700 dark:text-slate-200', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

// ─── ОплатыКв to'lovlari modali (shartnoma bo'yicha, read-only) ───
function OplataKvModal({ contract, onClose }: { contract: string; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  const { data, isLoading } = useQuery({
    queryKey: ['chek-kv', contract],
    queryFn: () => api.get<{ items: any[]; sums: { paymentAmount: number } }>(`/oplata-kv?contractNos=${encodeURIComponent(contract)}&perPage=50`),
  });
  const items = data?.items || [];
  return (
    <div className="fixed inset-0 z-[9998] bg-slate-950/70 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 text-white relative bg-gradient-to-br from-violet-500 to-indigo-600">
          <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center"><X className="h-4 w-4" /></button>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/20 text-[11px] font-bold mb-2"><Home className="h-3 w-3" /> ОплатыКв · {contract}</div>
          <div className="text-2xl font-bold tabular-nums">{formatMoney(data?.sums?.paymentAmount || 0, '')} <span className="text-sm font-medium opacity-80">so'm</span></div>
          <div className="text-[11px] opacity-80 mt-0.5">{items.length} ta to'lov</div>
        </div>
        <div className="p-3">
          {isLoading ? (
            <div className="p-8 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-[13px]">Bu shartnoma bo'yicha ОплатыКв to'lovi yo'q</div>
          ) : (
            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-100 dark:ring-slate-800">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                  <tr><th className="text-left px-3 py-2 font-semibold">Sana</th><th className="text-right px-3 py-2 font-semibold">Summa</th><th className="text-left px-3 py-2 font-semibold">Tip</th><th className="text-left px-3 py-2 font-semibold">Obyekt</th><th className="text-left px-3 py-2 font-semibold">crm_status</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((it: any) => (
                    <tr key={it.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmtDate(it.date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">{it.paymentAmount != null ? formatMoney(Number(it.paymentAmount), '') : '—'}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{it.txType || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{it.object || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{it.crmStatus || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function TxRow({ label, value, mono, strong, full }: { label: string; value: string; mono?: boolean; strong?: boolean; full?: boolean }) {
  return (
    <div className={cn('flex items-start gap-2', full && 'sm:col-span-2')}>
      <span className="text-slate-400 w-28 shrink-0">{label}</span>
      <span className={cn('min-w-0 break-words', mono && 'font-mono', strong ? 'font-bold text-slate-800 dark:text-slate-200' : 'text-slate-600 dark:text-slate-300')}>{value}</span>
    </div>
  );
}

function InfoRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-slate-400 shrink-0">{icon}</span>
      <span className="text-slate-400 w-24 shrink-0">{label}</span>
      <span className={cn('text-slate-700 dark:text-slate-200 truncate', mono && 'font-mono')} title={value}>{value}</span>
    </div>
  );
}

function CondRow({ label, ok, txVal, mono, note }: { label: string; ok: boolean | null | undefined; txVal?: string | null; mono?: boolean; note?: string }) {
  const wordCls = ok === true ? 'text-emerald-600 dark:text-emerald-400' : ok === false ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400';
  return (
    <div className="flex items-start gap-2 text-[12px]">
      <span className="shrink-0 mt-0.5">
        {ok === true ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : ok === false ? <XCircle className="h-4 w-4 text-rose-500" /> : <span className="inline-block w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 text-slate-400 text-[9px] leading-4 text-center">—</span>}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-600 dark:text-slate-300 font-medium">{label}</span>
          <span className={cn('text-[11px] font-semibold', wordCls)}>· {condWord(ok)}</span>
        </div>
        {txVal && <span className={cn('block truncate text-[11px] text-slate-400', mono && 'font-mono')} title={txVal}>{txVal}</span>}
        {note && <span className="block text-[10px] text-amber-600/80 dark:text-amber-400/70">{note}</span>}
      </div>
    </div>
  );
}

function CondDots({ c }: { c: Cond }) {
  const items: Array<[string, boolean | null]> = [['O', c.order], ['H', c.account], ['∑', c.amount], ['Д', c.contract], ['S', c.date]];
  return (
    <div className="flex items-center justify-center gap-1">
      {items.map(([k, v], i) => (
        <span key={i} title={k} className={cn('inline-grid place-items-center w-4 h-4 rounded text-[8px] font-bold', v === true ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : v === false ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-400')}>{v === true ? '✓' : v === false ? '✕' : '·'}</span>
      ))}
    </div>
  );
}

// ─── Natija ostidagi shartnoma (CRM) paneli ───
function ContractInfoPanel({ contract }: { contract: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['chek-contract-info', contract],
    queryFn: () => api.get<any>(`/chek-order/contract-info?contract=${encodeURIComponent(contract)}`),
  });
  const pct = data?.contractValue ? Math.min(100, Math.max(0, Math.round((data.totalPaid / data.contractValue) * 100))) : null;
  const money = (n: any) => (n == null ? '—' : formatMoney(Number(n), ''));

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50/60 to-violet-50/40 dark:from-indigo-950/20 dark:to-violet-950/10">
        <FileSignature className="h-4 w-4 text-indigo-500" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Shartnoma ma'lumoti</span>
        <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[13px]">{contract}</span>
        {data && (
          <span className={cn('ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold ring-1',
            data.found ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 ring-slate-200 dark:ring-slate-700')}>
            {data.found ? <><CheckCircle2 className="h-3 w-3" /> CRM'da bor</> : "CRM'da yo'q"}
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="p-10 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-indigo-500" /></div>
      ) : data ? (
        <div className="p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={<User2 className="h-4 w-4" />} label="Mijoz" value={data.customerName || '—'} />
            <StatTile icon={<Building2 className="h-4 w-4" />} label="Obyekt" value={data.objectName || '—'} />
            <StatTile icon={<Home className="h-4 w-4" />} label="Xonadon" value={data.apartmentNumber ? `№ ${data.apartmentNumber}` : '—'}
              sub={[data.rooms && `${data.rooms} xona`, data.area && `${data.area} m²`, data.block && `Блок ${data.block}`, data.floor && `${data.floor}-qavat`].filter(Boolean).join(' · ') || undefined} />
            <StatTile icon={<Tag className="h-4 w-4" />} label="crm_status" value={data.virtualStatus || '—'} />
          </div>
          <div className="rounded-xl ring-1 ring-slate-100 dark:ring-slate-800 p-4">
            <div className="grid gap-3 sm:grid-cols-3 mb-3">
              <MoneyTile label="Kelishuv qiymati" value={money(data.contractValue)} tone="slate" />
              <MoneyTile label="To'langan" value={money(data.totalPaid)} tone="emerald" />
              <MoneyTile label="Qoldiq" value={money(data.remaining)} tone="amber" />
            </div>
            {pct != null && (
              <div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1"><span>To'lov jarayoni · {data.paymentCount} ta to'lov</span><span className="font-semibold tabular-nums">{pct}%</span></div>
                <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function StatTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl ring-1 ring-slate-100 dark:ring-slate-800 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1"><span className="text-indigo-400">{icon}</span>{label}</div>
      <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate" title={value}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 truncate mt-0.5" title={sub}>{sub}</div>}
    </div>
  );
}

function MoneyTile({ label, value, tone }: { label: string; value: string; tone: 'slate' | 'emerald' | 'amber' }) {
  const cls = { slate: 'text-slate-800 dark:text-slate-200', emerald: 'text-emerald-600 dark:text-emerald-400', amber: 'text-amber-600 dark:text-amber-400' }[tone];
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">{label}</div>
      <div className={cn('text-[15px] font-bold tabular-nums', cls)}>{value}</div>
    </div>
  );
}

function SubTab({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={cn('relative flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors',
      active ? 'border-indigo-500 text-indigo-700 dark:text-indigo-300' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200')}>
      {icon} {label}
      {badge != null && badge > 0 && <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold grid place-items-center tabular-nums">{badge}</span>}
    </button>
  );
}

function StatChip({ n, label, tone }: { n: number; label: string; tone: 'emerald' | 'amber' | 'rose' }) {
  const cls = { emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300', amber: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300', rose: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' }[tone];
  return <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold', cls)}><span className="tabular-nums font-bold">{n}</span> {label}</span>;
}
