'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, X, Send, Loader2, Sparkles, CheckCircle2, Ticket } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Msg = { role: 'user' | 'assistant'; content: string };
type Proposal = { summary: string; category?: string; contractNo?: string; orderNos?: string[]; details?: string; priority?: string } | null;

export function ChekAssistant({ context, onCreated }: { context: any; onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [proposal, setProposal] = useState<Proposal>(null);
  const [assignee, setAssignee] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: assignees } = useQuery({
    queryKey: ['chek-assignees'],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/chek-order/assignees'),
    enabled: open && !!proposal,
  });

  const chatMut = useMutation({
    mutationFn: (msgs: Msg[]) => api.post<{ reply: string; quickReplies: string[]; proposal: Proposal }>('/chek-order/assistant/chat', { messages: msgs, context }),
    onSuccess: (r) => {
      setMessages((m) => [...m, { role: 'assistant', content: r.reply }]);
      setQuickReplies(r.quickReplies || []);
      if (r.proposal) setProposal(r.proposal);
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const createMut = useMutation({
    mutationFn: () => api.post<{ ticketNo: number }>('/chek-order/tickets', {
      ...proposal, assignedToId: assignee || undefined, transcript: messages,
      matchedTxExtId: context?.orders?.[0]?.matchedTxExtId,
    }),
    onSuccess: (r) => {
      toast.success(`Murojaat yaratildi (№${r.ticketNo})`);
      setMessages((m) => [...m, { role: 'assistant', content: `✅ Murojaat №${r.ticketNo} yaratildi${assignee ? ' va mas\'ulga biriktirildi' : ''}. "Murojaatlar" bo'limida ko'rasiz.` }]);
      setProposal(null); setQuickReplies([]); setAssignee('');
      onCreated?.();
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  useEffect(() => {
    if (open && messages.length === 0 && !chatMut.isPending) chatMut.mutate([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, chatMut.isPending, proposal]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || chatMut.isPending) return;
    const next = [...messages, { role: 'user' as const, content: t }];
    setMessages(next); setInput(''); setQuickReplies([]);
    chatMut.mutate(next);
  };
  const resetChat = () => { setMessages([]); setQuickReplies([]); setProposal(null); setAssignee(''); chatMut.mutate([]); };

  return (
    <>
      <button onClick={() => setOpen(true)} title="AI yordamchi — muammo bo'yicha suhbat"
        className="fixed bottom-6 right-6 z-[9990] w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-xl shadow-indigo-500/40 grid place-items-center hover:scale-105 active:scale-95 transition-transform">
        <Bot className="h-6 w-6" />
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900 animate-pulse" />
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[9995]">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-[460px] bg-white dark:bg-slate-900 shadow-2xl flex flex-col" style={{ animation: 'chekSlideIn .22s ease' }}>
            <div className="p-4 bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 grid place-items-center"><Bot className="h-5 w-5" /></div>
              <div className="flex-1 min-w-0"><div className="font-bold text-[15px]">AI Yordamchi</div><div className="text-[11px] opacity-80">Muammoni ayting — murojaat qilaman</div></div>
              <button onClick={resetChat} title="Yangi suhbat" className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 grid place-items-center"><Sparkles className="h-4 w-4" /></button>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 grid place-items-center"><X className="h-4 w-4" /></button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-950">
              {messages.map((m, i) => <Bubble key={i} role={m.role} text={m.content} />)}
              {chatMut.isPending && <Bubble role="assistant" text="" typing />}
              {quickReplies.length > 0 && !chatMut.isPending && (
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {quickReplies.map((q, i) => (
                    <button key={i} onClick={() => send(q)} className="px-3 h-8 rounded-full bg-white dark:bg-slate-800 ring-1 ring-indigo-200 dark:ring-indigo-800 text-[12px] font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors">{q}</button>
                  ))}
                </div>
              )}
              {proposal && (
                <div className="rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-indigo-200 dark:ring-indigo-800 shadow-lg p-3.5 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400"><Ticket className="h-3.5 w-3.5" /> Murojaat taklifi</div>
                  <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{proposal.summary}</div>
                  {proposal.category && <div><span className="inline-block px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[11px] font-medium">{proposal.category}</span></div>}
                  {proposal.details && <div className="text-[12px] text-slate-500 dark:text-slate-400">{proposal.details}</div>}
                  {(proposal.contractNo || (proposal.orderNos || []).length > 0) && (
                    <div className="text-[11px] text-slate-400 font-mono">{[proposal.contractNo, (proposal.orderNos || []).join(', ')].filter(Boolean).join(' · ')}</div>
                  )}
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Mas'ul</label>
                    <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full mt-1 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[12px] px-2 outline-none">
                      <option value="">— tanlanmagan —</option>
                      {(assignees?.items || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => createMut.mutate()} disabled={createMut.isPending} className="flex-1 h-9 rounded-lg bg-indigo-600 text-white text-[12.5px] font-semibold hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                      {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Murojaat yaratish
                    </button>
                    <button onClick={() => setProposal(null)} className="h-9 px-3 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 text-[12px] text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">Bekor</button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex items-end gap-2">
                <textarea value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                  rows={1} placeholder="Muammoni yozing…"
                  className="flex-1 resize-none max-h-28 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[13px] outline-none focus:ring-2 focus:ring-indigo-500/40" />
                <button onClick={() => send(input)} disabled={!input.trim() || chatMut.isPending} className="w-10 h-10 rounded-xl bg-indigo-600 text-white grid place-items-center hover:bg-indigo-700 disabled:opacity-40 shrink-0"><Send className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
          <style>{`@keyframes chekSlideIn { from { transform: translateX(100%) } to { transform: translateX(0) } } @keyframes chekBounce { 0%,80%,100% { transform: translateY(0); opacity:.4 } 40% { transform: translateY(-4px); opacity:1 } }`}</style>
        </div>, document.body)}
    </>
  );
}

function Bubble({ role, text, typing }: { role: 'user' | 'assistant'; text: string; typing?: boolean }) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[85%] px-3.5 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap break-words',
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
