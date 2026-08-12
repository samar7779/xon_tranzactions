'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ReceiptText, Upload, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Hash, Search, Image as ImageIcon, ScanLine, Trash2, ChevronLeft, ChevronRight,
  Building2, CalendarDays, Coins, FileSignature, Landmark, FileText, RotateCcw, Sparkles,
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
  description: string | null;
};
type OrderResult = {
  orderNo: string; extracted: Extracted; result: 'found' | 'mismatch' | 'not_found';
  matchedTx: MatchedTx | null; conditions: Cond | null;
};
type HistoryRow = {
  id: string; batchId: string; source: string; orderNo: string; orderDate: string | null;
  amount: number | null; payerName: string | null; recipientName: string | null;
  contractNo: string | null; result: 'found' | 'mismatch' | 'not_found'; conditions: Cond;
  matchedTxExtId: string | null; hasFile: boolean; createdByName: string | null; createdAt: string;
};

const RESULT_META: Record<string, { label: string; cls: string; Icon: any; glow: string }> = {
  found:     { label: 'Topildi',   cls: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900', Icon: CheckCircle2, glow: 'shadow-emerald-500/25' },
  mismatch:  { label: 'Nomuvofiq', cls: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900', Icon: AlertTriangle, glow: 'shadow-amber-500/25' },
  not_found: { label: 'Topilmadi', cls: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900', Icon: XCircle, glow: 'shadow-rose-500/25' },
};

const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

export default function ChekOrderPage() {
  const qc = useQueryClient();
  const canManage = useHasPermission(PERMS.CHEKORDER_MANAGE);
  const canView = useHasPermission(PERMS.CHEKORDER_VIEW);

  const [mode, setMode] = useState<'upload' | 'manual'>('upload');
  const [orderNos, setOrderNos] = useState('');
  const [results, setResults] = useState<OrderResult[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{ url: string; isPdf: boolean; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Tarix
  const [hResult, setHResult] = useState<'all' | 'found' | 'mismatch' | 'not_found'>('all');
  const [hQ, setHQ] = useState('');
  const [hPage, setHPage] = useState(1);

  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ['chek-order-history', hResult, hQ, hPage],
    queryFn: () => api.get<{ items: HistoryRow[]; total: number; pageCount: number; stats: { found: number; mismatch: number; not_found: number } }>(
      `/chek-order?result=${hResult}&q=${encodeURIComponent(hQ)}&page=${hPage}`,
    ),
    enabled: canView,
  });
  const refreshHistory = () => qc.invalidateQueries({ queryKey: ['chek-order-history'] });

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
  };

  const stats = history?.stats;
  const hasWork = !!preview || (mode === 'manual' && !!results);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <style>{`
        @keyframes chekScan { 0% { transform: translateY(-10%); opacity:.35 } 50% { opacity:1 } 100% { transform: translateY(1010%); opacity:.35 } }
        @keyframes chekPulse { 0%,100% { opacity:.55 } 50% { opacity:1 } }
        .chek-scanline { position:absolute; left:0; right:0; height:2.5px; background:linear-gradient(90deg,transparent,#818cf8 20%,#a78bfa 50%,#818cf8 80%,transparent); box-shadow:0 0 22px 6px rgba(129,140,248,.55); animation: chekScan 2.1s cubic-bezier(.4,0,.2,1) infinite; }
        .chek-scangrid { background-image:linear-gradient(rgba(129,140,248,.10) 1px,transparent 1px),linear-gradient(90deg,rgba(129,140,248,.10) 1px,transparent 1px); background-size:22px 22px; }
      `}</style>

      <Topbar title="Chek order" subtitle="Memorial order / kvitansiya → tranzaksiyada bor-yo'qligini tekshirish" />

      <div className="px-4 lg:px-6 py-5 w-full space-y-5">
        {/* Sarlavha */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-lg shadow-indigo-500/30 shrink-0">
              <ReceiptText className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Chek order tekshiruvi</h1>
              <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-3xl">
                Memorial order / naqd kvitansiya suratini yuklang — agent o'qib, to'lov bizning tranzaksiyalarda bor-yo'qligini va shartlar
                (order № · summa · shartnoma · sana · hisob) mos kelishini tekshiradi. Order raqami kvitansiyada bank hujjatidan farq qilsa ham, shartnoma+summa bo'yicha topadi.
              </p>
            </div>
          </div>
          {(preview || results) && canManage && (
            <button onClick={reset} className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
              <RotateCcw className="h-3.5 w-3.5" /> Yangi tekshiruv
            </button>
          )}
        </div>

        {canManage && (
          <div className={cn('grid gap-5', hasWork ? 'lg:grid-cols-[minmax(0,440px)_1fr]' : 'grid-cols-1')}>
            {/* ── CHAP: kirish / surat ── */}
            <Card className="border-0 shadow-soft overflow-hidden self-start">
              <div className="flex items-center gap-1 p-1 m-3 mb-0 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
                <button onClick={() => setMode('upload')}
                  className={cn('flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors',
                    mode === 'upload' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}>
                  <ImageIcon className="h-3.5 w-3.5" /> Surat / PDF
                </button>
                <button onClick={() => setMode('manual')}
                  className={cn('flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors',
                    mode === 'manual' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}>
                  <Hash className="h-3.5 w-3.5" /> Order raqami
                </button>
              </div>

              <div className="p-3">
                {mode === 'upload' ? (
                  preview ? (
                    // Surat preview + scan effekti (analiz paytida — ko'rinib turadi, yo'qolmaydi)
                    <div className="relative rounded-2xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-900">
                      {preview.isPdf ? (
                        <div className="aspect-[3/2] grid place-items-center text-slate-300">
                          <div className="text-center"><FileText className="h-12 w-12 mx-auto mb-2 opacity-70" /><div className="text-[12px] truncate max-w-[300px] px-4">{preview.name}</div></div>
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={preview.url} alt="order" className="w-full max-h-[560px] object-contain bg-slate-950" />
                      )}
                      {analyzing && (
                        <div className="absolute inset-0 chek-scangrid">
                          <div className="chek-scanline" style={{ top: 0 }} />
                          <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/5 via-transparent to-violet-500/10" />
                          <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-slate-950/90 to-transparent">
                            <div className="flex items-center gap-2 text-indigo-200">
                              <ScanLine className="h-4 w-4 animate-pulse" />
                              <span className="text-[12px] font-semibold" style={{ animation: 'chekPulse 1.4s ease-in-out infinite' }}>Agent hujjatni o'qiyapti — orderlarni ajratib, tranzaksiyalar bilan solishtiryapti…</span>
                            </div>
                          </div>
                        </div>
                      )}
                      <button onClick={() => fileRef.current?.click()} disabled={busy}
                        className="absolute top-2 right-2 inline-flex items-center gap-1 px-2.5 h-7 rounded-lg bg-slate-900/70 backdrop-blur text-white text-[11px] font-semibold hover:bg-slate-900 disabled:opacity-50">
                        <Upload className="h-3 w-3" /> Boshqa
                      </button>
                      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
                    </div>
                  ) : (
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0] || null); }}
                      onClick={() => !busy && fileRef.current?.click()}
                      className={cn('relative rounded-2xl border-2 border-dashed transition-all cursor-pointer grid place-items-center text-center px-6 py-16',
                        dragOver ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30 scale-[1.005]'
                          : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-900/40')}>
                      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 dark:from-indigo-500/20 dark:to-violet-500/20 grid place-items-center">
                          <Upload className="h-7 w-7 text-indigo-500" />
                        </div>
                        <div className="text-[14px] font-semibold text-slate-700 dark:text-slate-200">Memorial order / kvitansiya suratini tashlang</div>
                        <div className="text-[11.5px] text-slate-400">yoki bosing — rasm yoki PDF · bitta suratда bir nechta hujjat bo'lishi mumkin</div>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Order raqam(lar)i</label>
                    <textarea value={orderNos} onChange={(e) => setOrderNos(e.target.value)}
                      placeholder="268041120&#10;13425470&#10;(vergul, bo'sh joy yoki yangi qator bilan)"
                      rows={5}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] tabular-nums font-mono resize-y outline-none focus:ring-2 focus:ring-indigo-500/40" />
                    <button onClick={() => { setResults(null); manualMut.mutate(orderNos); }} disabled={busy || !orderNos.trim()}
                      className="inline-flex items-center gap-2 px-4 h-9 rounded-xl bg-indigo-600 text-white text-[12.5px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Tranzaksiyada tekshir
                    </button>
                    <p className="text-[11px] text-slate-400 pt-1">Eslatma: faqat raqam bo'yicha tekshiradi. To'liq (shartnoma+summa) tekshiruv uchun suratни yuklang.</p>
                  </div>
                )}
              </div>
            </Card>

            {/* ── O'NG: natijalar ── */}
            {hasWork && (
              <div className="space-y-3 min-w-0">
                {busy && !results ? (
                  <Card className="border-0 shadow-soft p-10 grid place-items-center">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <div className="relative w-14 h-14">
                        <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20" />
                        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin" />
                        <Sparkles className="absolute inset-0 m-auto h-5 w-5 text-indigo-500" />
                      </div>
                      <div className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Tahlil qilinyapti…</div>
                      <div className="text-[11px] text-slate-400 max-w-xs">Agent hujjatdan order, shartnoma, summa va sanani ajratib, tranzaksiyalar bilan solishtiryapti</div>
                    </div>
                  </Card>
                ) : results && results.length > 0 ? (
                  <>
                    <div className="text-[12px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">Natija — {results.length} ta</div>
                    {results.map((r, i) => <ResultCard key={i} r={r} />)}
                  </>
                ) : (
                  <Card className="border-0 shadow-soft p-10 grid place-items-center text-slate-400 text-[13px]">Natija chiqmadi</Card>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── TARIX ── */}
        <div className="pt-2">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-bold text-slate-800 dark:text-slate-200">Tarix</h2>
              {stats && (
                <div className="flex items-center gap-1.5">
                  <StatChip n={stats.found} label="Topildi" tone="emerald" />
                  <StatChip n={stats.mismatch} label="Nomuvofiq" tone="amber" />
                  <StatChip n={stats.not_found} label="Topilmadi" tone="rose" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={hQ} onChange={(e) => { setHQ(e.target.value); setHPage(1); }} placeholder="Order / shartnoma / ism"
                  className="pl-8 pr-3 h-8 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12px] outline-none focus:ring-2 focus:ring-indigo-500/30" />
              </div>
              <select value={hResult} onChange={(e) => { setHResult(e.target.value as any); setHPage(1); }}
                className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12px] px-2 outline-none">
                <option value="all">Barchasi</option>
                <option value="found">Topildi</option>
                <option value="mismatch">Nomuvofiq</option>
                <option value="not_found">Topilmadi</option>
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
                        <td className="px-3 py-2.5">
                          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md ring-1 text-[10.5px] font-bold whitespace-nowrap', meta.cls)}>
                            <meta.Icon className="h-3 w-3" /> {meta.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">{row.createdByName || '—'} · {fmtDate(row.createdAt)}</td>
                        <td className="px-3 py-2.5 text-right">
                          {canManage && (
                            <button onClick={() => { if (confirm("O'chirilsinmi?")) delMut.mutate(row.id); }}
                              className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                          )}
                        </td>
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
      </div>
    </div>
  );
}

// ─── Bitta order natija kartasi ───
function ResultCard({ r }: { r: OrderResult }) {
  const meta = RESULT_META[r.result];
  const ex = r.extracted;
  const tx = r.matchedTx;
  const c = r.conditions;
  const orderDiffers = c && c.order === false;
  return (
    <Card className={cn('border-0 shadow-lg overflow-hidden', meta.glow)}>
      <div className={cn('flex items-center justify-between gap-3 px-4 py-2.5 border-b',
        r.result === 'found' ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/40'
        : r.result === 'mismatch' ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/40'
        : 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/40')}>
        <div className="flex items-center gap-2.5">
          <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ring-1 text-[11.5px] font-bold', meta.cls)}>
            <meta.Icon className="h-3.5 w-3.5" /> {meta.label}
          </span>
          <span className="font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums">№ {r.orderNo}</span>
        </div>
        {ex.amount != null && <span className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tabular-nums">{formatMoney(ex.amount, '')} <span className="text-[10px] text-slate-400">so'm</span></span>}
      </div>

      <div className="p-4 grid gap-4 md:grid-cols-2">
        {/* Hujjat ma'lumoti */}
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Hujjatдan o'qildi</div>
          <InfoRow icon={<CalendarDays className="h-3.5 w-3.5" />} label="Sana" value={fmtDate(ex.date)} />
          <InfoRow icon={<FileSignature className="h-3.5 w-3.5" />} label="Shartnoma" value={ex.contractNo || '—'} mono />
          <InfoRow icon={<Landmark className="h-3.5 w-3.5" />} label="Oluvchi hisob" value={ex.recipientAccount || '—'} mono />
          <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Oluvchi" value={ex.recipientName || '—'} />
          {ex.payerName && <InfoRow icon={<Coins className="h-3.5 w-3.5" />} label="To'lovchi" value={ex.payerName} />}
        </div>

        {/* Solishtirish / topilgan tranzaksiya */}
        <div className="space-y-2">
          {r.result === 'not_found' ? (
            <div className="h-full grid place-items-center rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 p-4 text-center">
              <div>
                <XCircle className="h-7 w-7 text-rose-400 mx-auto mb-1.5" />
                <div className="text-[13px] font-semibold text-rose-700 dark:text-rose-300">Tranzaksiyada topilmadi</div>
                <div className="text-[11px] text-rose-500/80 mt-0.5">Order №, shartnoma va summa bo'yicha mos to'lov yo'q</div>
              </div>
            </div>
          ) : (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Shartlar (topilgan tranzaksiya bilan)</div>
              <CondRow label="Order №" ok={c?.order} txVal={tx?.docNumber} orderVal={r.orderNo} mono
                note={orderDiffers ? 'kvitansiya raqami bank hujjat raqamidan farq qiladi (normal)' : undefined} />
              <CondRow label="Summa" ok={c?.amount} txVal={tx ? formatMoney(tx.amount, '') : ''} orderVal={ex.amount != null ? formatMoney(ex.amount, '') : ''} />
              <CondRow label="Shartnoma" ok={c?.contract} txVal={tx?.description || ''} orderVal={ex.contractNo || ''} mono />
              <CondRow label="Sana" ok={c?.date} txVal={fmtDate(tx?.txnDate)} orderVal={fmtDate(ex.date)} />
              <CondRow label="Hisob" ok={c?.account} txVal={tx?.toAccount} orderVal={ex.recipientAccount} mono />
              {tx && (
                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10.5px] text-slate-400 font-mono break-all">
                  bank docNumber: {tx.docNumber || '—'} · ext: {tx.externalId || tx.id}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
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

function CondRow({ label, ok, txVal, orderVal, mono, note }: { label: string; ok: boolean | null | undefined; txVal?: string | null; orderVal?: string | null; mono?: boolean; note?: string }) {
  return (
    <div className="flex items-start gap-2 text-[12px]">
      <span className="shrink-0 mt-0.5">
        {ok === true ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          : ok === false ? <XCircle className="h-4 w-4 text-rose-500" />
          : <span className="inline-block w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 text-slate-400 text-[9px] leading-4 text-center">—</span>}
      </span>
      <span className="text-slate-500 dark:text-slate-400 w-20 shrink-0">{label}</span>
      <span className="min-w-0">
        <span className={cn('block truncate', ok === false ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300', mono && 'font-mono')} title={`Tranz: ${txVal || '—'} · Hujjat: ${orderVal || '—'}`}>
          {txVal || '—'}
        </span>
        {note && <span className="block text-[10px] text-amber-600/80 dark:text-amber-400/70">{note}</span>}
      </span>
    </div>
  );
}

function CondDots({ c }: { c: Cond }) {
  const items: Array<[string, boolean | null]> = [['O', c.order], ['∑', c.amount], ['Д', c.contract], ['S', c.date], ['H', c.account]];
  return (
    <div className="flex items-center justify-center gap-1">
      {items.map(([k, v], i) => (
        <span key={i} title={k}
          className={cn('inline-grid place-items-center w-4 h-4 rounded text-[8px] font-bold',
            v === true ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
            : v === false ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-400')}>
          {v === true ? '✓' : v === false ? '✕' : '·'}
        </span>
      ))}
    </div>
  );
}

function StatChip({ n, label, tone }: { n: number; label: string; tone: 'emerald' | 'amber' | 'rose' }) {
  const cls = {
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
    amber: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
    rose: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
  }[tone];
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold', cls)}>
      <span className="tabular-nums font-bold">{n}</span> {label}
    </span>
  );
}
