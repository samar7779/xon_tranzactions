'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import {
  Search, Loader2, X, ChevronLeft, ChevronRight, Trash2, FileSignature,
  MessageSquare, CircleDot, Clock, CheckCircle2, XCircle, Ticket, Copy, Fingerprint,
  Send, Sparkles, Wand2, AlertTriangle, Coins, ArrowLeftRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type TicketRow = {
  id: string; ticketNo: number; contractNo: string | null; orderNos: string[];
  category: string | null; summary: string; details: string | null; transcript: any;
  status: string; priority: string | null; assignedToId: string | null; assignedToName: string | null;
  resolution: string | null; resolvedByName: string | null; resolvedAt: string | null;
  matchedTxExtId: string | null;
  createdByName: string | null; createdAt: string;
};

// Holat ranglari/ikonlari — yorliqlar t('chekOrder.tickets.status.*') orqali tarjima qilinadi
const STATUS: Record<string, { cls: string; Icon: any }> = {
  new: { cls: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-900', Icon: CircleDot },
  in_progress: { cls: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900', Icon: Clock },
  resolved: { cls: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900', Icon: CheckCircle2 },
  rejected: { cls: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700', Icon: XCircle },
};

const fmtDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

export function ChekTickets() {
  const tr = useTranslations('chekOrder');
  const stLabel = (k: string) => tr(`tickets.status.${STATUS[k] ? k : 'new'}`);
  const qc = useQueryClient();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<TicketRow | null>(null);
  useEffect(() => { setPage(1); }, [status, q]);

  const { data, isLoading } = useQuery({
    queryKey: ['chek-tickets', status, q, page],
    queryFn: () => api.get<{ items: TicketRow[]; total: number; pageCount: number; stats: Record<string, number> }>(
      `/chek-order/tickets?status=${status}&q=${encodeURIComponent(q)}&page=${page}`,
    ),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['chek-tickets'] });
    qc.invalidateQueries({ queryKey: ['chek-ticket-stats'] }); // sub-tab badge sonini yangilash
  };
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/chek-order/tickets/${id}`),
    onSuccess: () => { refresh(); toast.success(tr('toast.deleted')); },
    onError: (e: any) => toast.error(e?.message || tr('toast.error')),
  });
  const st = data?.stats;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          {st && Object.entries(STATUS).map(([k, m]) => (
            <span key={k} className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold', m.cls, 'ring-1')}>
              <m.Icon className="h-3 w-3" /> {st[k] || 0}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('tickets.search')} className="pl-8 pr-3 h-8 w-60 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12px] outline-none focus:ring-2 focus:ring-indigo-500/30" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12px] px-2 outline-none">
            <option value="all">{tr('history.all')}</option>
            <option value="new">{tr('tickets.status.new')}</option><option value="in_progress">{tr('tickets.status.in_progress')}</option>
            <option value="resolved">{tr('tickets.status.resolved')}</option><option value="rejected">{tr('tickets.status.rejected')}</option>
          </select>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 shadow-soft border-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left font-semibold px-3 py-2.5">№</th>
                <th className="text-left font-semibold px-3 py-2.5">{tr('tickets.th.problem')}</th>
                <th className="text-left font-semibold px-3 py-2.5">{tr('field.contract')}</th>
                <th className="text-left font-semibold px-3 py-2.5">{tr('tickets.th.status')}</th>
                <th className="text-left font-semibold px-3 py-2.5">{tr('history.th.who')}</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr><td colSpan={6} className="p-10 text-center text-slate-400">…</td></tr>
              ) : (data?.items?.length ?? 0) === 0 ? (
                <tr><td colSpan={6} className="p-12 text-center text-slate-400">
                  <Ticket className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  {tr('tickets.empty')}
                </td></tr>
              ) : data!.items.map((t) => {
                const m = STATUS[t.status] || STATUS.new;
                return (
                  <tr key={t.id} onClick={() => setDetail(t)} className="cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-3 py-2.5 font-mono font-bold text-slate-500 tabular-nums">#{t.ticketNo}</td>
                    <td className="px-3 py-2.5 max-w-[360px]">
                      <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{t.summary}</div>
                      {t.category && <div className="text-[11px] text-indigo-500">{t.category}</div>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-400">{t.contractNo || '—'}</td>
                    <td className="px-3 py-2.5"><span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md ring-1 text-[10.5px] font-bold whitespace-nowrap', m.cls)}><m.Icon className="h-3 w-3" /> {stLabel(t.status)}</span></td>
                    <td className="px-3 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">{t.createdByName || '—'} · {fmtDate(t.createdAt)}</td>
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { if (confirm(tr('history.confirmDelete'))) delMut.mutate(t.id); }} className="text-slate-400 hover:text-rose-600 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(data?.pageCount ?? 1) > 1 && (
          <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-slate-100 dark:border-slate-800">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-[12px] text-slate-500 tabular-nums">{page} / {data!.pageCount}</span>
            <button disabled={page >= (data?.pageCount ?? 1)} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
      </div>

      {detail && <TicketDetail t={detail} onClose={() => setDetail(null)} onSaved={() => { refresh(); setDetail(null); }} />}
    </div>
  );
}

function TicketDetail({ t, onClose, onSaved }: { t: TicketRow; onClose: () => void; onSaved: () => void }) {
  const tr = useTranslations('chekOrder');
  const tcm = useTranslations('common');
  const stLabel = (k: string) => tr(`tickets.status.${STATUS[k] ? k : 'new'}`);
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); toast.success(tcm('copied')); } catch { /* skip */ } };
  const qc = useQueryClient();
  const [status, setStatus] = useState(t.status);
  const [showChat, setShowChat] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);

  // Holat header'dagi icon bilan darhol o'zgaradi (modal yopilmaydi)
  const statusMut = useMutation({
    mutationFn: (s: string) => api.patch(`/chek-order/tickets/${t.id}`, { status: s }),
    onSuccess: (_d, s) => { setStatus(s); qc.invalidateQueries({ queryKey: ['chek-tickets'] }); qc.invalidateQueries({ queryKey: ['chek-ticket-stats'] }); toast.success(tr('tickets.savedToast')); },
    onError: (e: any) => toast.error(e?.message || tr('toast.error')),
  });
  const transcript: Array<{ role: string; content: string }> = Array.isArray(t.transcript) ? t.transcript : [];

  return (
    <div className="fixed inset-0 z-[9998]">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-full md:w-1/2 md:min-w-[720px] bg-white dark:bg-slate-900 shadow-2xl flex flex-col" style={{ animation: 'chekTicketSlide .26s cubic-bezier(0.22,1,0.36,1)' }} onClick={(e) => e.stopPropagation()}>
        <div className="p-5 bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 text-white relative shrink-0">
          <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center transition-colors"><X className="h-4 w-4" /></button>
          <div className="flex items-center gap-2 mb-2.5 pr-10">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/20 text-[11px] font-bold shrink-0"><Ticket className="h-3 w-3" /> {tr('tickets.detail.ticket', { no: t.ticketNo })}</div>
            {/* Holat — icon toolbar (bosilganda darhol qo'llanadi) */}
            <div className="flex items-center gap-1 ml-auto">
              {Object.entries(STATUS).map(([k, m]) => (
                <button key={k} onClick={() => statusMut.mutate(k)} disabled={statusMut.isPending} title={stLabel(k)}
                  className={cn('w-8 h-8 rounded-lg grid place-items-center transition-all disabled:opacity-60',
                    status === k ? 'bg-white text-indigo-700 shadow-md scale-105 ring-2 ring-white/60' : 'bg-white/15 text-white/85 hover:bg-white/30')}>
                  <m.Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
          <div className="text-[16px] font-bold leading-snug">{t.summary}</div>
          {t.category && <div className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-md bg-white/15 text-[11px] font-medium">{t.category}</div>}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          {t.details && (
            <div className="relative rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/25 dark:to-orange-950/10 ring-1 ring-amber-200/70 dark:ring-amber-900/40 p-4 pl-5 shadow-sm">
              <span className="absolute left-0 top-3.5 bottom-3.5 w-1.5 rounded-full bg-gradient-to-b from-amber-400 to-orange-500" />
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/40 grid place-items-center shrink-0"><AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" /></div>
                <div className="text-[13.5px] text-slate-800 dark:text-slate-100 leading-relaxed font-medium">{t.details}</div>
              </div>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2 text-[12px]">
            <div className="rounded-xl ring-1 ring-slate-100 dark:ring-slate-800 p-2.5"><div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">{tr('field.contract')}</div><div className="font-mono text-slate-700 dark:text-slate-200">{t.contractNo || '—'}</div></div>
            <div className="rounded-xl ring-1 ring-slate-100 dark:ring-slate-800 p-2.5"><div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">{tr('tickets.detail.orders')}</div><div className="font-mono text-slate-700 dark:text-slate-200 truncate">{(t.orderNos || []).join(', ') || '—'}</div></div>
          </div>

          {/* Ext ID — to'lovni topish uchun (tranzaksiya/ОплатыКв'da qidiriladi) */}
          {t.matchedTxExtId && (
            <div className="rounded-xl ring-1 ring-indigo-100 dark:ring-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 p-2.5 flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-indigo-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-indigo-500/80 font-semibold mb-0.5">{tr('tx.extId')} — {tr('tx.foundTitle')}</div>
                <div className="font-mono text-[12.5px] text-slate-700 dark:text-slate-200 truncate" title={t.matchedTxExtId}>{t.matchedTxExtId}</div>
              </div>
              <button onClick={() => copy(t.matchedTxExtId!)} title={tcm('copy')} className="w-8 h-8 rounded-lg grid place-items-center bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-500 hover:text-indigo-600 hover:ring-indigo-300 transition-colors shrink-0">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* To'lovni tuzatish — agent orqali boshlang'ich/oylik taqsimotini to'g'rilash */}
          <ResolvePanel ticket={t} onResolved={onSaved} />

          {/* Suhbat tarixi */}
          {transcript.length > 0 && (
            <div className="rounded-xl ring-1 ring-slate-100 dark:ring-slate-800 overflow-hidden">
              <button onClick={() => setShowChat((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <MessageSquare className="h-3.5 w-3.5 text-slate-400" /> {tr('tickets.detail.chatHistory', { n: transcript.length })}
                <span className="ml-auto text-slate-400 text-[11px]">{showChat ? tr('tickets.detail.hide') : tr('tickets.detail.show')}</span>
              </button>
              {showChat && (
                <div className="p-3 space-y-2 bg-slate-50 dark:bg-slate-950/40 max-h-64 overflow-y-auto">
                  {transcript.map((m, i) => (
                    <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[85%] px-3 py-1.5 rounded-xl text-[12px] whitespace-pre-wrap', m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-1 ring-slate-100 dark:ring-slate-700')}>{m.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="text-[11px] text-slate-400 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1"><FileSignature className="h-3 w-3" /> {t.createdByName || '—'} · {fmtDate(t.createdAt)}</span>
            {t.resolvedByName && <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {t.resolvedByName} · {fmtDate(t.resolvedAt)}</span>}
          </div>
        </div>
      </div>
      <style>{`@keyframes chekTicketSlide { from { transform: translateX(100%) } to { transform: translateX(0) } }`}</style>
    </div>
  );
}

// ─── To'lovni tuzatish paneli — agent boshlang'ich/oylik taqsimotini to'g'rilaydi ───
type ChatMsg = { role: 'user' | 'assistant'; content: string };
function ResolvePanel({ ticket, onResolved }: { ticket: TicketRow; onResolved: () => void }) {
  const tr = useTranslations('chekOrder');
  const locale = useLocale();
  const qc = useQueryClient();
  const money = (n: any) => Number(n || 0).toLocaleString('ru-RU');

  const { data: pctx } = useQuery({
    queryKey: ['chek-ticket-payment', ticket.id],
    queryFn: () => api.get<{ payment: any }>(`/chek-order/tickets/${ticket.id}/payment`),
  });
  const payment = pctx?.payment || null;

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [quick, setQuick] = useState<string[]>([]);
  const [proposal, setProposal] = useState<any>(null);
  const scRef = useRef<HTMLDivElement>(null);

  const chatMut = useMutation({
    mutationFn: (msgs: ChatMsg[]) => api.post<{ reply: string; quickReplies: string[]; proposal: any }>(`/chek-order/tickets/${ticket.id}/resolve/chat`, { messages: msgs, locale }),
    onSuccess: (r) => { setMessages((m) => [...m, { role: 'assistant', content: r.reply }]); setQuick(r.quickReplies || []); setProposal(r.proposal || null); },
    onError: (e: any) => toast.error(e?.message || tr('toast.error')),
  });
  const applyMut = useMutation({
    mutationFn: () => api.post(`/chek-order/tickets/${ticket.id}/resolve/apply`, {
      oplataKvId: proposal.oplataKvId, mode: proposal.mode,
      firstInstallment: proposal.firstInstallment, monthlyAmount: proposal.monthlyAmount,
    }),
    onSuccess: () => {
      toast.success(tr('resolve.appliedToast'));
      qc.invalidateQueries({ queryKey: ['chek-tickets'] });
      qc.invalidateQueries({ queryKey: ['chek-ticket-stats'] });
      onResolved();
    },
    onError: (e: any) => toast.error(e?.message || tr('toast.error')),
  });

  useEffect(() => { if (open && !messages.length && !chatMut.isPending) chatMut.mutate([]); /* eslint-disable-next-line */ }, [open]);
  useEffect(() => { scRef.current?.scrollTo({ top: scRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, chatMut.isPending, proposal]);

  const send = (text: string) => {
    const v = text.trim();
    if (!v || chatMut.isPending) return;
    const nx = [...messages, { role: 'user' as const, content: v }];
    setMessages(nx); setInput(''); setQuick([]); chatMut.mutate(nx);
  };

  if (!payment) {
    return <div className="rounded-xl ring-1 ring-slate-100 dark:ring-slate-800 p-3 text-[12px] text-slate-400">{tr('resolve.noPayment')}</div>;
  }

  const total = Number(payment.paymentAmount) || 0;
  const pct = (x: any) => (total > 0 ? Math.max(0, Math.min(100, (Number(x || 0) / total) * 100)) : 0);
  const propSum = proposal && proposal.mode === 'manual' ? (Number(proposal.firstInstallment || 0) + Number(proposal.monthlyAmount || 0)) : null;
  const sumOk = propSum != null && Math.abs(propSum - total) < 0.01;

  return (
    <div className="rounded-2xl ring-1 ring-violet-200/70 dark:ring-violet-900/50 overflow-hidden shadow-sm">
      <div className="px-4 py-3 bg-gradient-to-r from-violet-500 via-violet-600 to-indigo-600 text-white flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-white/20 grid place-items-center ring-1 ring-white/25"><Wand2 className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold leading-tight">{tr('resolve.title')}</div>
          <div className="text-[10.5px] text-white/80 tabular-nums">{tr('resolve.total')}: {money(total)}</div>
        </div>
      </div>
      <div className="p-3.5 space-y-2.5">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 ring-1 ring-slate-100 dark:ring-slate-800 p-2.5"><div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">{tr('resolve.total')}</div><div className="text-[14px] font-bold tabular-nums text-slate-800 dark:text-slate-100">{money(payment.paymentAmount)}</div></div>
          <div className="rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 ring-1 ring-indigo-100 dark:ring-indigo-900/50 p-2.5"><div className="text-[9px] uppercase tracking-wider text-indigo-500/80 font-semibold mb-0.5">{tr('resolve.first')}</div><div className="text-[14px] font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{money(payment.firstInstallment)}</div></div>
          <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 ring-1 ring-emerald-100 dark:ring-emerald-900/50 p-2.5"><div className="text-[9px] uppercase tracking-wider text-emerald-500/80 font-semibold mb-0.5">{tr('resolve.monthly')}</div><div className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{money(payment.monthlyAmount)}</div></div>
        </div>
        <div className="h-2 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 flex" title={`${Math.round(pct(payment.firstInstallment))}% / ${Math.round(pct(payment.monthlyAmount))}%`}>
          <div className="bg-gradient-to-r from-indigo-500 to-indigo-400 transition-all" style={{ width: `${pct(payment.firstInstallment)}%` }} />
          <div className="bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all" style={{ width: `${pct(payment.monthlyAmount)}%` }} />
        </div>
      </div>
      {!open ? (
        <div className="px-3.5 pb-3.5">
          <button onClick={() => setOpen(true)} className="group w-full h-10 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[13px] font-semibold shadow-md shadow-violet-500/25 hover:shadow-lg hover:shadow-violet-500/40 hover:-translate-y-0.5 transition-all inline-flex items-center justify-center gap-2"><Sparkles className="h-4 w-4 group-hover:rotate-12 transition-transform" /> {tr('resolve.open')}</button>
        </div>
      ) : (
        <div className="border-t border-slate-100 dark:border-slate-800">
          <div ref={scRef} className="max-h-[46vh] min-h-[220px] overflow-y-auto p-3 space-y-2 bg-slate-50 dark:bg-slate-950/40">
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[85%] px-3 py-2 rounded-2xl text-[12.5px] whitespace-pre-wrap leading-relaxed', m.role === 'user' ? 'bg-violet-600 text-white rounded-br-md' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-1 ring-slate-100 dark:ring-slate-700 rounded-bl-md')}>{m.content}</div>
              </div>
            ))}
            {chatMut.isPending && <div className="text-[11px] text-slate-400 flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> …</div>}
            {quick.length > 0 && !chatMut.isPending && (
              <div className="flex flex-wrap gap-1.5">
                {quick.map((q, i) => <button key={i} onClick={() => send(q)} className="px-3 h-8 rounded-full bg-white dark:bg-slate-800 ring-1 ring-violet-200 dark:ring-violet-800 text-[12px] font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40">{q}</button>)}
              </div>
            )}
            {proposal && (
              <div className="rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-violet-200 dark:ring-violet-800 p-3.5 space-y-3 shadow-md">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400"><Sparkles className="h-3.5 w-3.5" /> {tr('resolve.proposalTitle')}</div>
                {proposal.mode === 'auto' ? (
                  <div className="rounded-xl bg-violet-50 dark:bg-violet-950/30 ring-1 ring-violet-100 dark:ring-violet-900/50 p-3 text-[12.5px] font-medium text-violet-700 dark:text-violet-300 inline-flex items-center gap-2 w-full"><Wand2 className="h-4 w-4" /> {tr('resolve.auto')}</div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 ring-1 ring-indigo-100 dark:ring-indigo-900/50 p-2.5 flex items-center gap-2">
                        <Coins className="h-4 w-4 text-indigo-500 shrink-0" />
                        <div className="min-w-0"><div className="text-[9px] uppercase tracking-wider text-indigo-500/80 font-semibold">{tr('resolve.first')}</div><div className="text-[14px] font-bold tabular-nums text-indigo-700 dark:text-indigo-300 truncate">{money(proposal.firstInstallment)}</div></div>
                      </div>
                      <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 ring-1 ring-emerald-100 dark:ring-emerald-900/50 p-2.5 flex items-center gap-2">
                        <ArrowLeftRight className="h-4 w-4 text-emerald-500 shrink-0" />
                        <div className="min-w-0"><div className="text-[9px] uppercase tracking-wider text-emerald-500/80 font-semibold">{tr('resolve.monthly')}</div><div className="text-[14px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300 truncate">{money(proposal.monthlyAmount)}</div></div>
                      </div>
                    </div>
                    <div className={cn('flex items-center justify-center gap-1.5 text-[11.5px] font-semibold px-2 py-1.5 rounded-lg', sumOk ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400')}>
                      {sumOk ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      <span className="tabular-nums">{money(propSum)} {sumOk ? '=' : '≠'} {money(total)}</span>
                    </div>
                  </>
                )}
                <button onClick={() => applyMut.mutate()} disabled={applyMut.isPending || (proposal.mode === 'manual' && !sumOk)} className="w-full h-10 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[13px] font-semibold shadow-md shadow-emerald-500/25 hover:shadow-lg hover:shadow-emerald-500/40 disabled:opacity-50 disabled:shadow-none inline-flex items-center justify-center gap-2 transition-all">
                  {applyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {tr('resolve.apply')}
                </button>
              </div>
            )}
          </div>
          <div className="p-2.5 border-t border-slate-100 dark:border-slate-800 flex items-end gap-2">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} rows={1} placeholder={tr('resolve.placeholder')} className="flex-1 resize-none max-h-24 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[12.5px] outline-none focus:ring-2 focus:ring-violet-500/40" />
            <button onClick={() => send(input)} disabled={!input.trim() || chatMut.isPending} className="w-9 h-9 rounded-lg bg-violet-600 text-white grid place-items-center hover:bg-violet-700 disabled:opacity-40 shrink-0"><Send className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
