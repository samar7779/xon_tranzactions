'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Bot, X, Send, Loader2, Sparkles, CheckCircle2, Ticket } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Msg = { role: 'user' | 'assistant'; content: string };
type Proposal = { summary: string; category?: string; contractNo?: string; orderNos?: string[]; details?: string; priority?: string } | null;

export function ChekAssistant({ context, visible, onCreated }: { context: any; visible: boolean; onCreated?: () => void }) {
  const tr = useTranslations('chekOrder');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [proposal, setProposal] = useState<Proposal>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Kontekst kaliti — order o'zgarsa suhbat yangilanadi, aks holda SAQLANADI (yopib-ochsa ham)
  const ckey = JSON.stringify((context?.orders || []).map((o: any) => (o.orderNos || []).join(',')));
  const prevKey = useRef(ckey);

  const chatMut = useMutation({
    mutationFn: (msgs: Msg[]) => api.post<{ reply: string; quickReplies: string[]; proposal: Proposal }>('/chek-order/assistant/chat', { messages: msgs, context, locale }),
    onSuccess: (r) => {
      setMessages((m) => [...m, { role: 'assistant', content: r.reply }]);
      setQuickReplies(r.quickReplies || []);
      if (r.proposal) setProposal(r.proposal);
    },
    onError: (e: any) => toast.error(e?.message || tr('toast.error')),
  });

  const createMut = useMutation({
    mutationFn: () => api.post<{ ticketNo: number }>('/chek-order/tickets', {
      ...proposal, transcript: messages,
      matchedTxExtId: context?.orders?.[0]?.matchedTxExtId,
    }),
    onSuccess: (r) => {
      toast.success(tr('assistant.createdToast', { no: r.ticketNo }));
      setMessages((m) => [...m, { role: 'assistant', content: tr('assistant.createdMsg', { no: r.ticketNo }) }]);
      setProposal(null); setQuickReplies([]);
      onCreated?.();
    },
    onError: (e: any) => toast.error(e?.message || tr('toast.error')),
  });

  const startChat = () => chatMut.mutate([]);

  // Order o'zgarganda — suhbatni yangilaymiz (yangi order = yangi ish)
  useEffect(() => {
    if (prevKey.current !== ckey) {
      prevKey.current = ckey;
      setMessages([]); setQuickReplies([]); setProposal(null);
      if (open) startChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ckey]);
  // Birinchi ochilishда salomlashuv (suhbat bo'sh bo'lsa)
  useEffect(() => {
    if (open && messages.length === 0 && !chatMut.isPending) startChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, chatMut.isPending, proposal]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || chatMut.isPending) return;
    const next = [...messages, { role: 'user' as const, content: t }];
    setMessages(next); setInput(''); setQuickReplies([]); setSel(new Set());
    chatMut.mutate(next);
  };
  const toggleSel = (v: string) => setSel((p) => { const n = new Set(p); n.has(v) ? n.delete(v) : n.add(v); return n; });
  const sendSelected = () => { if (sel.size) send(Array.from(sel).join(', ')); };
  const resetChat = () => { setMessages([]); setQuickReplies([]); setProposal(null); startChat(); };

  if (!visible && !open) return null;

  return (
    <>
      {visible && (
        <div className="fixed right-5 top-1/2 -translate-y-1/2 z-[9990]">
          <button onClick={() => setOpen(true)} title={tr('assistant.title')} className="group relative block">
            {/* tovlanuvchi tashqi yog'du (aylanuvchi) */}
            <span aria-hidden className="absolute -inset-2 rounded-full opacity-60 group-hover:opacity-90 transition-opacity"
              style={{ background: 'conic-gradient(from 0deg, #6366f1, #22d3ee, #d946ef, #8b5cf6, #6366f1)', filter: 'blur(13px)', animation: 'chekRingSpin 7s linear infinite reverse' }} />
            {/* Aurora Orb — ichida jonli yorug'lik oqadi */}
            <span className="relative flex items-center justify-center w-16 h-16 rounded-full overflow-hidden ring-1 ring-white/15 group-hover:scale-110 active:scale-95 transition-transform duration-200"
              style={{ background: '#0e0b1e', animation: 'chekBreathe 4.5s ease-in-out infinite' }}>
              <span aria-hidden className="absolute"
                style={{ inset: '-40%', filter: 'blur(9px) saturate(1.35)', animation: 'chekRingSpin 7s linear infinite',
                  background: 'radial-gradient(38% 38% at 30% 28%, #22d3ee, transparent 60%), radial-gradient(42% 42% at 72% 30%, #6366f1, transparent 62%), radial-gradient(46% 46% at 68% 74%, #d946ef, transparent 60%), radial-gradient(40% 40% at 26% 70%, #8b5cf6, transparent 62%)' }} />
              <span aria-hidden className="absolute"
                style={{ inset: '-40%', filter: 'blur(9px) saturate(1.35)', mixBlendMode: 'screen', opacity: 0.85, animation: 'chekRingSpin 11s linear infinite reverse',
                  background: 'radial-gradient(38% 38% at 30% 28%, #22d3ee, transparent 60%), radial-gradient(42% 42% at 72% 30%, #6366f1, transparent 62%), radial-gradient(46% 46% at 68% 74%, #d946ef, transparent 60%), radial-gradient(40% 40% at 26% 70%, #8b5cf6, transparent 62%)' }} />
              <span aria-hidden className="absolute inset-0 rounded-full"
                style={{ background: 'radial-gradient(70% 70% at 50% 32%, rgba(255,255,255,.32), transparent 55%)' }} />
              <svg className="relative" width="26" height="26" viewBox="0 0 24 24"
                style={{ stroke: '#fff', fill: 'none', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', filter: 'drop-shadow(0 1px 3px rgba(10,4,40,.6))' }}>
                <path d="M12 3.5l1.6 4.3a3 3 0 0 0 1.8 1.8L19.7 11l-4.3 1.6a3 3 0 0 0-1.8 1.8L12 18.7l-1.6-4.3a3 3 0 0 0-1.8-1.8L4.3 11l4.3-1.6a3 3 0 0 0 1.8-1.8z" />
                <path d="M18.5 3.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6L16.3 6l1.6-.6z" />
              </svg>
            </span>
            <span className="absolute right-full top-1/2 -translate-y-1/2 mr-3 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[12px] font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg">{tr('assistant.title')}</span>
          </button>
        </div>
      )}

      {open && createPortal(
        <div className="fixed inset-0 z-[9995]">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-[780px] bg-white dark:bg-slate-900 shadow-2xl flex flex-col" style={{ animation: 'chekSlideIn .22s ease' }}>
            <div className="p-5 bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 text-white flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/15 grid place-items-center ring-1 ring-white/20"><Bot className="h-6 w-6" /></div>
              <div className="flex-1 min-w-0"><div className="font-bold text-[17px]">{tr('assistant.title')}</div><div className="text-[12px] opacity-85">{tr('assistant.subtitle')}</div></div>
              <button onClick={resetChat} title={tr('assistant.newChat')} className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 grid place-items-center"><Sparkles className="h-4.5 w-4.5" /></button>
              <button onClick={() => setOpen(false)} className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 grid place-items-center"><X className="h-5 w-5" /></button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-3.5 bg-slate-50 dark:bg-slate-950">
              {messages.map((m, i) => <Bubble key={i} role={m.role} text={m.content} />)}
              {chatMut.isPending && <Bubble role="assistant" text="" typing />}
              {quickReplies.length > 0 && !chatMut.isPending && (
                <div className="pl-1 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {quickReplies.map((q, i) => {
                      const on = sel.has(q);
                      return (
                        <button key={i} onClick={() => toggleSel(q)}
                          className={cn('inline-flex items-center gap-1 px-3.5 h-9 rounded-full text-[12.5px] font-medium ring-1 transition-colors',
                            on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white dark:bg-slate-800 ring-indigo-200 dark:ring-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40')}>
                          {on && <CheckCircle2 className="h-3.5 w-3.5" />} {q}
                        </button>
                      );
                    })}
                  </div>
                  {sel.size > 0 && (
                    <button onClick={sendSelected} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-indigo-600 text-white text-[12.5px] font-semibold hover:bg-indigo-700 transition-colors">
                      <Send className="h-3.5 w-3.5" /> {tr('assistant.send')}{sel.size > 1 ? ` (${sel.size})` : ''}
                    </button>
                  )}
                  <div className="text-[10.5px] text-slate-400">{tr('assistant.multiHint')}</div>
                </div>
              )}
              {proposal && (
                <div className="rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-indigo-200 dark:ring-indigo-800 shadow-lg p-4 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400"><Ticket className="h-3.5 w-3.5" /> {tr('assistant.proposalTitle')}</div>
                  <div className="text-[14px] font-semibold text-slate-800 dark:text-slate-100 leading-snug">{proposal.summary}</div>
                  {proposal.category && <div><span className="inline-block px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[11px] font-medium">{proposal.category}</span></div>}
                  {proposal.details && <div className="text-[12.5px] text-slate-500 dark:text-slate-400 leading-relaxed">{proposal.details}</div>}
                  {(proposal.contractNo || (proposal.orderNos || []).length > 0) && (
                    <div className="text-[11px] text-slate-400 font-mono">{[proposal.contractNo, (proposal.orderNos || []).join(', ')].filter(Boolean).join(' · ')}</div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => createMut.mutate()} disabled={createMut.isPending} className="flex-1 h-10 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                      {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {tr('assistant.createBtn')}
                    </button>
                    <button onClick={() => setProposal(null)} className="h-10 px-4 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 text-[12.5px] text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">{tr('assistant.cancel')}</button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex items-end gap-2">
                <textarea value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                  rows={1} placeholder={tr('assistant.placeholder')}
                  className="flex-1 resize-none max-h-32 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[13.5px] outline-none focus:ring-2 focus:ring-indigo-500/40" />
                <button onClick={() => send(input)} disabled={!input.trim() || chatMut.isPending} className="w-11 h-11 rounded-xl bg-indigo-600 text-white grid place-items-center hover:bg-indigo-700 disabled:opacity-40 shrink-0"><Send className="h-4.5 w-4.5" /></button>
              </div>
            </div>
          </div>
          <style>{`@keyframes chekSlideIn { from { transform: translateX(100%) } to { transform: translateX(0) } } @keyframes chekBounce { 0%,80%,100% { transform: translateY(0); opacity:.4 } 40% { transform: translateY(-4px); opacity:1 } } @keyframes chekRingSpin { to { transform: rotate(360deg) } }`}</style>
        </div>, document.body)}
      <style>{`@keyframes chekRingSpin { to { transform: rotate(360deg) } } @keyframes chekBreathe { 0%,100% { box-shadow: 0 10px 26px -8px rgba(99,102,241,.5), inset 0 1.5px 0 rgba(255,255,255,.4) } 50% { box-shadow: 0 16px 40px -6px rgba(217,70,239,.6), inset 0 1.5px 0 rgba(255,255,255,.45) } }`}</style>
    </>
  );
}

function Bubble({ role, text, typing }: { role: 'user' | 'assistant'; text: string; typing?: boolean }) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[82%] px-4 py-2.5 rounded-2xl text-[13.5px] leading-relaxed whitespace-pre-wrap break-words shadow-sm',
        isUser ? 'bg-indigo-600 text-white rounded-br-md' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-1 ring-slate-100 dark:ring-slate-700 rounded-bl-md')}>
        {typing ? (
          <span className="inline-flex gap-1 py-1">
            {[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400" style={{ animation: 'chekBounce 1.2s ease-in-out infinite', animationDelay: `${i * 0.15}s` }} />)}
          </span>
        ) : text}
      </div>
    </div>
  );
}
