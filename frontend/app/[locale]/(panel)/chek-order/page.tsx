'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ReceiptText, Upload, FileText, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Hash, Search, Image as ImageIcon, ScanLine, X, Trash2, Eye, ChevronLeft, ChevronRight,
  Building2, CalendarDays, Coins, FileSignature, Landmark,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { TransactionsTabs } from '@/components/transactions-tabs';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';

type Cond = { account: boolean | null; date: boolean | null; amount: boolean | null; contract: boolean | null };
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

const RESULT_META: Record<string, { label: string; cls: string; Icon: any }> = {
  found:     { label: 'Topildi',   cls: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900', Icon: CheckCircle2 },
  mismatch:  { label: 'Nomuvofiq', cls: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900', Icon: AlertTriangle },
  not_found: { label: 'Topilmadi', cls: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900', Icon: XCircle },
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
  const fileRef = useRef<HTMLInputElement>(null);

  // Tarix
  const [hResult, setHResult] = useState<'all' | 'found' | 'mismatch' | 'not_found'>('all');
  const [hQ, setHQ] = useState('');
  const [hPage, setHPage] = useState(1);

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
    onSuccess: (r) => { setResults(r.results); refreshHistory(); toast.success(`${r.results.length} ta order tekshirildi`); },
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

  const busy = analyzeMut.isPending || manualMut.isPending;

  const onFile = useCallback((f: File | null) => {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { toast.error('Fayl 25 MB dan oshmasligi kerak'); return; }
    setResults(null);
    analyzeMut.mutate(f);
  }, [analyzeMut]);

  const stats = history?.stats;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Topbar title="Chek order" subtitle="Memorial order → tranzaksiyada bor-yo'qligini tekshirish" />
      <TransactionsTabs />

      <div className="px-6 lg:px-8 py-6 max-w-[1200px] mx-auto space-y-5">
        {/* Sarlavha */}
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-lg shadow-indigo-500/30 shrink-0">
            <ReceiptText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">Chek order tekshiruvi</h1>
            <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl">
              Memorial order suratini yuklang yoki order raqamini kiriting — agent uni o'qib, to'lov bizning tranzaksiyalarda bor-yo'qligini va shartlar (hisob · sana · summa · shartnoma) mos kelishini tekshiradi.
            </p>
          </div>
        </div>

        {canManage && (
          <Card className="border-0 shadow-soft overflow-hidden">
            {/* Rejim tanlash */}
            <div className="flex items-center gap-1 p-1 m-3 mb-0 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
              <button
                onClick={() => setMode('upload')}
                className={cn('flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors',
                  mode === 'upload' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}
              >
                <ImageIcon className="h-3.5 w-3.5" /> Surat / PDF
              </button>
              <button
                onClick={() => setMode('manual')}
                className={cn('flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors',
                  mode === 'manual' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}
              >
                <Hash className="h-3.5 w-3.5" /> Order raqami
              </button>
            </div>

            <div className="p-3">
              {mode === 'upload' ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0] || null); }}
                  onClick={() => !busy && fileRef.current?.click()}
                  className={cn(
                    'relative rounded-2xl border-2 border-dashed transition-all cursor-pointer grid place-items-center text-center px-6 py-12',
                    dragOver ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30 scale-[1.005]'
                      : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-900/40',
                    busy && 'pointer-events-none opacity-70',
                  )}
                >
                  <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0] || null)} />
                  {busy ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="relative">
                        <ScanLine className="h-10 w-10 text-indigo-500 animate-pulse" />
                      </div>
                      <div className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Agent hujjatni o'qiyapti…</div>
                      <div className="text-[11px] text-slate-400">Orderlarni ajratib, tranzaksiyalar bilan solishtiryapti</div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 dark:from-indigo-500/20 dark:to-violet-500/20 grid place-items-center">
                        <Upload className="h-6 w-6 text-indigo-500" />
                      </div>
                      <div className="text-[13.5px] font-semibold text-slate-700 dark:text-slate-200">Memorial order suratini bu yerga tashlang</div>
                      <div className="text-[11.5px] text-slate-400">yoki bosing — rasm yoki PDF · bitta suratда bir nechta order bo'lishi mumkin</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Order raqam(lar)i</label>
                  <textarea
                    value={orderNos}
                    onChange={(e) => setOrderNos(e.target.value)}
                    placeholder="13473268&#10;13425470&#10;(vergul, bo'sh joy yoki yangi qator bilan)"
                    rows={4}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] tabular-nums font-mono resize-y outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  <button
                    onClick={() => { setResults(null); manualMut.mutate(orderNos); }}
                    disabled={busy || !orderNos.trim()}
                    className="inline-flex items-center gap-2 px-4 h-9 rounded-xl bg-indigo-600 text-white text-[12.5px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Tranzaksiyada tekshir
                  </button>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Natijalar */}
        {results && results.length > 0 && (
          <div className="space-y-3">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">
              Natija — {results.length} ta order
            </div>
            {results.map((r, i) => <ResultCard key={i} r={r} />)}
          </div>
        )}

        {/* Tarix */}
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
                <input value={hQ} onChange={(e) => { setHQ(e.target.value); setHPage(1); }}
                  placeholder="Order / shartnoma / ism"
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
                              className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
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
                <button disabled={hPage <= 1} onClick={() => setHPage((p) => p - 1)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <span className="text-[12px] text-slate-500 tabular-nums">{hPage} / {history!.pageCount}</span>
                <button disabled={hPage >= (history?.pageCount ?? 1)} onClick={() => setHPage((p) => p + 1)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
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
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
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
        {/* Order ma'lumoti */}
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Order ma'lumoti</div>
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
                <div className="text-[11px] text-rose-500/80 mt-0.5">Bu order raqami (docNumber) bo'yicha to'lov yo'q</div>
              </div>
            </div>
          ) : (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Shartlar (topilgan tranzaksiya bilan)</div>
              <CondRow label="Hisob raqami" ok={r.conditions?.account} txVal={tx?.toAccount} orderVal={ex.recipientAccount} mono />
              <CondRow label="Sana" ok={r.conditions?.date} txVal={fmtDate(tx?.txnDate)} orderVal={fmtDate(ex.date)} />
              <CondRow label="Summa" ok={r.conditions?.amount} txVal={tx ? formatMoney(tx.amount, '') : ''} orderVal={ex.amount != null ? formatMoney(ex.amount, '') : ''} />
              <CondRow label="Shartnoma" ok={r.conditions?.contract} txVal={tx?.description || ''} orderVal={ex.contractNo || ''} mono />
              {tx && (
                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10.5px] text-slate-400 font-mono break-all">
                  ext: {tx.externalId || tx.id}
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

function CondRow({ label, ok, txVal, orderVal, mono }: { label: string; ok: boolean | null | undefined; txVal?: string | null; orderVal?: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-[12px]">
      <span className="shrink-0 mt-0.5">
        {ok === true ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          : ok === false ? <XCircle className="h-4 w-4 text-rose-500" />
          : <span className="inline-block w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 text-slate-400 text-[9px] leading-4 text-center">—</span>}
      </span>
      <span className="text-slate-500 dark:text-slate-400 w-24 shrink-0">{label}</span>
      <span className={cn('truncate', ok === false ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300', mono && 'font-mono')} title={`Tranz: ${txVal || '—'} · Order: ${orderVal || '—'}`}>
        {txVal || '—'}
      </span>
    </div>
  );
}

function CondDots({ c }: { c: Cond }) {
  const items: Array<[string, boolean | null]> = [['H', c.account], ['S', c.date], ['∑', c.amount], ['Д', c.contract]];
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
