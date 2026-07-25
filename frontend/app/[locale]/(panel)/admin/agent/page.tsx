'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot, Loader2, Save, Play, Lock, CalendarDays, Clock, KeyRound, Building2, Info, Send, Users, Plus,
  Sparkles, BrainCircuit, CheckCircle2, XCircle, UserCog, ChevronDown, Settings2, Activity, Cpu,
  History, MessageSquare, X, Search, Download, Pencil, ChevronLeft, ChevronRight,
  Paperclip, Trash2, ImageIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface WlEntry { id: string; name: string }
interface AgentConfig {
  ok: boolean;
  enabled: boolean;
  hasToken: boolean;
  tokenHint: string | null;
  botUsername: string | null;
  groupId: string | null;
  dateFrom: string | null;
  dailyTime: string;
  lastResult: string | null;
  pendingCount: number;
  whitelist: WlEntry[];
  aiEnabled: boolean;
  hasAiKey: boolean;
  aiKeyHint: string | null;
  aiModel: string;
  aiIntervalMin: number;
  aiName: string | null;
  aiFromHour: number;
  aiToHour: number;
}

interface AiRunResult { id: string; ok: boolean; decision?: 'approve' | 'reject' | 'human'; reason?: string; error?: string }
interface AiRunResponse { ok: boolean; processed: number; results: AiRunResult[] }

interface AiStatusCounts { pending: number; processing: number; needsReview: number; agentApproved: number; agentRejected: number }
interface AiStatusResponse { ok: boolean; enabled: boolean; hasKey: boolean; running: boolean; model: string; intervalMin: number; name: string; fromHour: number; toHour: number; counts: AiStatusCounts }

interface AiActivityRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  agentState: 'processing' | 'needs_review' | 'done' | null;
  agentReason: string | null;
  agentAt: string;
  contractNo: string | null;
  client: string | null;
  object: string | null;
  amount: number | null;
  byAgent: boolean;
}
interface AiActivityResponse { ok: boolean; total: number; page: number; perPage: number; rows: AiActivityRow[] }

type ChatMsg = { role: 'user' | 'assistant'; content: string; hasImage?: boolean };
type ChatImage = { data: string; mediaType: string };
interface ChatHistoryRow { role: 'user' | 'assistant'; content: string; hasImage: boolean; at: string }
interface ChatHistoryResponse { ok: boolean; rows: ChatHistoryRow[] }

export default function AdminAgentPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = !!user?.permissions?.includes(PERMS.AGENT_MANAGE);

  const cfgQuery = useQuery({
    queryKey: ['agent-config'],
    queryFn: () => api.get<AgentConfig>('/agent/config'),
    refetchInterval: 30_000,
  });
  const cfg = cfgQuery.data;

  const aiStatusQuery = useQuery({
    queryKey: ['agent-ai-status'],
    queryFn: () => api.get<AiStatusResponse>('/agent/ai/status'),
    refetchInterval: 12_000,
  });
  const aiStatus = aiStatusQuery.data;

  const [botToken, setBotToken] = useState('');
  const [groupId, setGroupId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dailyTime, setDailyTime] = useState('09:00');
  const [whitelist, setWhitelist] = useState<WlEntry[]>([]);
  const [aiKey, setAiKey] = useState('');
  const [aiModel, setAiModel] = useState('claude-sonnet-4-6');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiIntervalMin, setAiIntervalMin] = useState('5');
  const [aiName, setAiName] = useState('AI Agent');
  const [aiFromHour, setAiFromHour] = useState('0');
  const [aiToHour, setAiToHour] = useState('24');
  const [editKey, setEditKey] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [digestOpen, setDigestOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Faoliyat modal
  const [actOpen, setActOpen] = useState(false);
  const [actQ, setActQ] = useState('');
  const [actQDebounced, setActQDebounced] = useState('');
  const [actPage, setActPage] = useState(1);
  const [actExporting, setActExporting] = useState(false);
  const ACT_PER_PAGE = 20;

  // Suhbat drawer
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatImage, setChatImage] = useState<ChatImage | null>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cfg || initialized) return;
    setGroupId(cfg.groupId || '');
    setDateFrom(cfg.dateFrom || '');
    setDailyTime(cfg.dailyTime || '09:00');
    setWhitelist(cfg.whitelist || []);
    setAiModel(cfg.aiModel || 'claude-sonnet-4-6');
    setAiEnabled(!!cfg.aiEnabled);
    setAiIntervalMin(String(cfg.aiIntervalMin || 5));
    setAiName(cfg.aiName || 'AI Agent');
    setAiFromHour(String(cfg.aiFromHour ?? 0));
    setAiToHour(String(cfg.aiToHour ?? 24));
    setInitialized(true);
  }, [cfg, initialized]);

  // Faoliyat qidiruvi — debounce ~300ms
  useEffect(() => {
    const t = setTimeout(() => { setActQDebounced(actQ.trim()); setActPage(1); }, 300);
    return () => clearTimeout(t);
  }, [actQ]);

  const wlSave = useMutation({
    mutationFn: (list: WlEntry[]) => api.put('/agent/config', { whitelist: list }),
    onSuccess: () => { toast.success('Saqlandi'); qc.invalidateQueries({ queryKey: ['agent-config'] }); },
    onError: (e: any) => toast.error(e?.message || 'Saqlanmadi'),
  });
  const addWl = () => setWhitelist((p) => [...p, { id: '', name: '' }]);
  const setWl = (i: number, patch: Partial<WlEntry>) => setWhitelist((p) => p.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const rmWl = (i: number) => setWhitelist((p) => p.filter((_, j) => j !== i));

  const saveMut = useMutation({
    mutationFn: (patch: Partial<AgentConfig> & { botToken?: string }) => api.put('/agent/config', patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agent-config'] }); },
    onError: (e: any) => toast.error(e?.message || 'Saqlanmadi'),
  });

  const saveConfig = () => {
    saveMut.mutate(
      { botToken: botToken.trim() || undefined, groupId, dateFrom: dateFrom || null, dailyTime } as any,
      { onSuccess: () => { toast.success('Saqlandi'); setBotToken(''); qc.invalidateQueries({ queryKey: ['agent-config'] }); } },
    );
  };
  const toggleEnabled = () => {
    if (!cfg) return;
    saveMut.mutate({ enabled: !cfg.enabled } as any, {
      onSuccess: () => { toast.success(cfg.enabled ? "Agent o'chirildi" : 'Agent yoqildi'); qc.invalidateQueries({ queryKey: ['agent-config'] }); },
    });
  };

  const runMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; count?: number; error?: string }>('/agent/run', {}, { timeout: 120_000 }),
    onSuccess: (r) => {
      if (r.ok) toast.success(r.count ? `Jo'natildi — ${r.count} ta XATO` : "XATO yo'q — xabar jo'natilmadi");
      else toast.error(r.error || 'Ishga tushmadi');
      qc.invalidateQueries({ queryKey: ['agent-config'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const aiSaveMut = useMutation({
    mutationFn: () => api.put('/agent/config', {
      aiKey: aiKey.trim() || undefined,
      aiModel,
      aiEnabled,
      aiIntervalMin: Number(aiIntervalMin) || 5,
      aiName: aiName.trim() || 'AI Agent',
      aiFromHour: Math.min(24, Math.max(0, Number(aiFromHour) || 0)),
      aiToHour: Math.min(24, Math.max(0, Number(aiToHour) === 0 ? 24 : (Number(aiToHour) || 24))),
    }),
    onSuccess: () => {
      toast.success('Saqlandi');
      setAiKey('');
      setEditKey(false);
      qc.invalidateQueries({ queryKey: ['agent-config'] });
      qc.invalidateQueries({ queryKey: ['agent-ai-status'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Saqlanmadi'),
  });

  // Faoliyat ro'yxati (modal)
  const actQuery = useQuery({
    queryKey: ['agent-ai-activity', actQDebounced, actPage],
    queryFn: () => api.get<AiActivityResponse>(`/agent/ai/activity?q=${encodeURIComponent(actQDebounced)}&page=${actPage}&perPage=${ACT_PER_PAGE}`),
    enabled: actOpen,
    refetchInterval: actOpen ? 15_000 : false,
  });
  const actTotal = actQuery.data?.total ?? 0;
  const actPages = Math.max(1, Math.ceil(actTotal / ACT_PER_PAGE));

  // Faoliyat → Excel (CSV) — barcha mos qatorlarni oladi
  const exportActivity = async () => {
    setActExporting(true);
    try {
      const res = await api.get<AiActivityResponse>(`/agent/ai/activity?q=${encodeURIComponent(actQDebounced)}&page=1&perPage=1000`);
      const rows = res.rows || [];
      const header = ['Sana', 'Klient', 'Shartnoma', 'Summa', 'Qaror', 'Sabab'];
      const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [header.map(esc).join(',')];
      for (const r of rows) {
        lines.push([
          esc(fmtDateTime(r.agentAt)),
          esc(r.client || ''),
          esc(r.contractNo || ''),
          esc(r.amount != null ? String(r.amount) : ''),
          esc(decisionBadge(r).label),
          esc(r.agentReason || ''),
        ].join(','));
      }
      const csv = '﻿' + lines.join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'agent-faoliyat.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message || 'Yuklab bo\'lmadi');
    } finally {
      setActExporting(false);
    }
  };

  const agentName = aiStatus?.name || cfg?.aiName || 'AI Agent';

  // Suhbat (chat) — tarix DB'da (stateful)
  const chatHistoryQuery = useQuery({
    queryKey: ['agent-ai-chat-history'],
    queryFn: () => api.get<ChatHistoryResponse>('/agent/ai/chat/history'),
    enabled: chatOpen,
  });
  // Tarixdan chatMsgs'ni seed qilish (optimistik ko'rsatish uchun)
  useEffect(() => {
    const rows = chatHistoryQuery.data?.rows;
    if (!rows) return;
    setChatMsgs(rows.map((r) => ({ role: r.role, content: r.content, hasImage: r.hasImage })));
  }, [chatHistoryQuery.data]);

  // ESC bilan yopish (backdrop bosilganda YOPILMAYDI)
  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setChatOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatOpen]);

  // Yangi xabar kelganda pastga scroll
  useEffect(() => {
    if (chatOpen) chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMsgs, chatOpen]);

  const chatMut = useMutation({
    mutationFn: (body: { message: string; image?: ChatImage }) =>
      api.post<{ ok: boolean; reply?: string; error?: string }>('/agent/ai/chat', body, { timeout: 60_000 }),
    onSuccess: (r) => {
      if (r.ok && r.reply) setChatMsgs((p) => [...p, { role: 'assistant', content: r.reply as string }]);
      else toast.error(r.error || 'Javob kelmadi');
      qc.invalidateQueries({ queryKey: ['agent-ai-chat-history'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });
  const sendChat = () => {
    const content = chatInput.trim();
    if ((!content && !chatImage) || chatMut.isPending) return;
    const img = chatImage;
    setChatMsgs((p) => [...p, { role: 'user', content, hasImage: !!img }]);
    setChatInput('');
    setChatImage(null);
    chatMut.mutate({ message: content, image: img || undefined });
  };

  const chatClearMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; deleted: number }>('/agent/ai/chat/clear', {}),
    onSuccess: () => {
      setChatMsgs([]);
      qc.invalidateQueries({ queryKey: ['agent-ai-chat-history'] });
      chatHistoryQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });
  const clearChat = () => {
    if (chatClearMut.isPending) return;
    if (!window.confirm('Suhbat tarixi butunlay o\'chirilsinmi?')) return;
    chatClearMut.mutate();
  };

  // Rasm biriktirish — FileReader orqali base64, prefiksni ajratib olamiz
  const onChatFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // bir xil faylni qayta tanlash mumkin bo'lsin
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Faqat rasm biriktiring'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Rasm 5 MB dan katta bo'lmasin"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      const comma = res.indexOf(',');
      const data = comma >= 0 ? res.slice(comma + 1) : res; // "data:<mime>;base64," prefiksini olib tashlaymiz
      setChatImage({ data, mediaType: file.type });
    };
    reader.onerror = () => toast.error("Rasmni o'qib bo'lmadi");
    reader.readAsDataURL(file);
  };

  const [aiRunSummary, setAiRunSummary] = useState<{ approve: number; reject: number; human: number; error: number } | null>(null);
  const aiRunMut = useMutation({
    mutationFn: () => api.post<AiRunResponse>('/agent/ai/run', { limit: 20 }, { timeout: 120_000 }),
    onSuccess: (data) => {
      const results = data.results || [];
      const approve = results.filter((r) => r.ok && r.decision === 'approve').length;
      const reject = results.filter((r) => r.ok && r.decision === 'reject').length;
      const human = results.filter((r) => r.ok && r.decision === 'human').length;
      const error = results.filter((r) => !r.ok || r.error).length;
      setAiRunSummary({ approve, reject, human, error });
      toast.success(`${data.processed} ta ariza ko'rib chiqildi`);
      qc.invalidateQueries({ queryKey: ['agent-config'] });
      qc.invalidateQueries({ queryKey: ['agent-ai-status'] });
      qc.invalidateQueries({ queryKey: ['agent-ai-activity'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const configured = !!(cfg?.hasToken && cfg?.groupId);

  if (cfgQuery.isLoading) {
    return (
      <div className="flex-1 grid place-items-center py-24 text-slate-400">
        <div className="flex items-center gap-2 text-[13px]"><Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 lg:p-8 w-full space-y-5">
      {/* ═══════════════ 🤖 AI Agent (asosiy) ═══════════════ */}
      {canManage && (
        <Card className="border-0 shadow-soft overflow-hidden">
          {/* Sarlavha + jonli holat */}
          <div className={cn(
            'px-5 py-4 flex items-center gap-3.5 border-b bg-gradient-to-r',
            aiEnabled
              ? 'border-violet-100 dark:border-violet-950 from-violet-500/[0.10] via-fuchsia-500/[0.04] to-transparent'
              : 'border-slate-100 dark:border-slate-800 from-slate-500/[0.06] to-transparent',
          )}>
            <div className={cn(
              'w-11 h-11 rounded-2xl grid place-items-center shadow-md shrink-0',
              aiEnabled ? 'bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-violet-500/30' : 'bg-gradient-to-br from-slate-400 to-slate-600',
            )}>
              <BrainCircuit className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[15px] font-bold text-slate-800 dark:text-slate-100">🤖 AI Agent</span>
                <span className={cn(
                  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ring-1',
                  aiEnabled
                    ? 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-800'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700',
                )}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', aiEnabled ? 'bg-violet-500 animate-pulse' : 'bg-slate-400')} />
                  {aiEnabled ? 'Yoqilgan' : "O'chirilgan"}
                </span>
                {aiStatus?.running ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ring-1 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" /> 🟢 Ishlamoqda
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ring-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Kutmoqda
                  </span>
                )}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ring-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700">
                  ⏱ har {aiStatus?.intervalMin ?? cfg?.aiIntervalMin ?? 5} daq
                </span>
                {(() => {
                  const fh = aiStatus?.fromHour ?? cfg?.aiFromHour ?? 0;
                  const th = aiStatus?.toHour ?? cfg?.aiToHour ?? 24;
                  const always = fh === 0 && th === 24;
                  return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ring-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700">
                      🕘 {always ? 'doim' : `${fh}:00–${th}:00`}
                    </span>
                  );
                })()}
              </div>
              <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                AI Agent yangi arizalarni avtomat tekshiradi: ariza faylini o&apos;qiydi, obyekt mosligini tekshiradi (boshqa obyektga o&apos;tkazib bo&apos;lmaydi), maqsadga qarab kategoriya tanlaydi — so&apos;ng tasdiqlaydi, rad etadi yoki xodimga qoldiradi.
              </div>
            </div>
            <button
              onClick={() => setAiEnabled((v) => !v)}
              title={aiEnabled ? "O'chirish" : 'Yoqish'}
              className={cn('relative w-12 h-7 rounded-full transition-colors shrink-0', aiEnabled ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-600')}
            >
              <span className={cn('absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform', aiEnabled && 'translate-x-5')} />
            </button>
            <button
              onClick={() => setAiOpen((v) => !v)}
              title={aiOpen ? "Yig'ish" : 'Ochish'}
              className="w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 transition-colors"
            >
              <ChevronDown className={cn('h-5 w-5 transition-transform', !aiOpen && '-rotate-90')} />
            </button>
          </div>

          {aiOpen && (
          <CardContent className="p-5 space-y-4">
            {/* Model + avtomat izohi */}
            <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] font-semibold ring-1 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700">
                <Cpu className="h-3.5 w-3.5" /> {aiStatus?.model || cfg?.aiModel || 'claude-sonnet-4-6'}
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                {`🔄 Har ${aiStatus?.intervalMin ?? cfg?.aiIntervalMin ?? 5} daqiqada avtomat tekshiradi — faqat kutilayotgan ariza bo'lsa (rasxod tejaladi). Ishlangan ariza qayta ishlanmaydi.`}
              </span>
            </div>

            {/* Dashboard sarlavha + tugmalar */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-[12px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <Activity className="h-4 w-4 text-violet-600 dark:text-violet-400" /> Holat paneli
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setActOpen(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold ring-1 bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:ring-violet-300 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
                >
                  <History className="h-4 w-4" /> Faoliyat
                </button>
                <button
                  onClick={() => setChatOpen(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold ring-1 bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:ring-violet-300 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
                >
                  <MessageSquare className="h-4 w-4" /> Suhbat
                </button>
              </div>
            </div>

            {/* Dashboard hisoblagichlar */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatTile label="Kutilmoqda" value={String(aiStatus?.counts.pending ?? 0)} tone="amber" />
              <StatTile
                label="Ishlanmoqda"
                value={String(aiStatus?.counts.processing ?? 0)}
                tone={(aiStatus?.counts.processing ?? 0) > 0 ? 'violet' : 'slate'}
                pulse={(aiStatus?.counts.processing ?? 0) > 0}
              />
              <StatTile label="Ko'rib chiqish" value={String(aiStatus?.counts.needsReview ?? 0)} tone={(aiStatus?.counts.needsReview ?? 0) > 0 ? 'amber' : 'slate'} />
              <StatTile label="Agent tasdiqladi" value={String(aiStatus?.counts.agentApproved ?? 0)} tone="emerald" />
              <StatTile label="Agent rad etdi" value={String(aiStatus?.counts.agentRejected ?? 0)} tone="rose" />
            </div>

            {/* Sozlama: kalit + nomi + model + oraliq + ish vaqti */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Qator 1 — AI kalit (to'liq eni) */}
              <div className="md:col-span-2">
                <Field label="AI kalit" icon={<Lock className="h-3.5 w-3.5" />}>
                  {cfg?.hasAiKey && !editKey ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold ring-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Kalit saqlangan ({cfg.aiKeyHint || '••••'})
                      </span>
                      <button
                        onClick={() => setEditKey(true)}
                        className="inline-flex items-center gap-1 h-9 px-2.5 rounded-lg text-[11.5px] font-semibold ring-1 bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:ring-violet-300 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" /> O&apos;zgartirish
                      </button>
                    </div>
                  ) : (
                    <>
                      <Input
                        value={aiKey}
                        onChange={(e) => setAiKey(e.target.value)}
                        type="password"
                        placeholder="sk-ant-api03-…"
                        className="h-9 rounded-lg font-mono text-[12px]"
                      />
                      <div className="text-[10.5px] text-slate-400 dark:text-slate-500">
                        Anthropic API kaliti (shifrlab saqlanadi){cfg?.hasAiKey && (
                          <button onClick={() => { setEditKey(false); setAiKey(''); }} className="ml-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline">bekor qilish</button>
                        )}
                      </div>
                    </>
                  )}
                </Field>
              </div>

              {/* Qator 2 — Agent nomi | Model */}
              <Field label="Agent nomi" icon={<Bot className="h-3.5 w-3.5" />}>
                <Input
                  value={aiName}
                  onChange={(e) => setAiName(e.target.value)}
                  placeholder="AI Agent"
                  className="h-9 rounded-lg text-[12px]"
                />
                <div className="text-[10.5px] text-slate-400 dark:text-slate-500">Agent shu nom bilan ishlaydi — qarorlarda shu nom ko&apos;rinadi</div>
              </Field>
              <Field label="Model" icon={<Sparkles className="h-3.5 w-3.5" />}>
                <div className="relative">
                  <select
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    className="w-full h-9 pl-3 pr-8 rounded-lg bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 text-[12px] font-mono outline-none focus:ring-2 focus:ring-violet-400 appearance-none cursor-pointer hover:ring-violet-300 transition"
                  >
                    <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                    <option value="claude-opus-4-8">claude-opus-4-8</option>
                    <option value="claude-haiku-4-5">claude-haiku-4-5</option>
                    {aiModel && !['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'].includes(aiModel) && (
                      <option value={aiModel}>{aiModel}</option>
                    )}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
                <div className="text-[10.5px] text-slate-400 dark:text-slate-500">AI model — javob sifati va narxi shunga bog&apos;liq</div>
              </Field>

              {/* Qator 3 — Tekshirish oralig'i | Ish vaqti */}
              <Field label="Tekshirish oralig'i (daqiqa)" icon={<Clock className="h-3.5 w-3.5" />}>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={aiIntervalMin}
                  onChange={(e) => setAiIntervalMin(e.target.value)}
                  placeholder="5"
                  className="h-9 rounded-lg font-mono text-[12px]"
                />
                <div className="text-[10.5px] text-slate-400 dark:text-slate-500">Necha daqiqada bir marta yangi arizalarni tekshiradi</div>
              </Field>
              <Field label="Ish vaqti (soat)" icon={<Clock className="h-3.5 w-3.5" />}>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={24}
                    value={aiFromHour}
                    onChange={(e) => setAiFromHour(e.target.value)}
                    placeholder="0"
                    aria-label="dan"
                    className="h-9 rounded-lg font-mono text-[12px] w-20 text-center"
                  />
                  <span className="text-slate-400 dark:text-slate-500 text-[13px] shrink-0">—</span>
                  <Input
                    type="number"
                    min={0}
                    max={24}
                    value={aiToHour}
                    onChange={(e) => setAiToHour(e.target.value)}
                    placeholder="24"
                    aria-label="gacha"
                    className="h-9 rounded-lg font-mono text-[12px] w-20 text-center"
                  />
                </div>
                <div className="text-[10.5px] text-slate-400 dark:text-slate-500">Agent shu soatlar oralig&apos;ida ishlaydi (0–24 = doim)</div>
              </Field>
            </div>

            <div className="flex items-center gap-3 flex-wrap pt-1">
              <Button onClick={() => aiSaveMut.mutate()} disabled={aiSaveMut.isPending} className="h-10 gap-2 bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold">
                {aiSaveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Saqlash
              </Button>
              <Button onClick={() => aiRunMut.mutate()} disabled={aiRunMut.isPending} variant="outline" className="h-10 gap-2 text-[13px] font-semibold">
                {aiRunMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Kutilayotgan arizalarni tekshirish
              </Button>
              <span className="text-[10.5px] text-slate-400 ml-auto">🔒 AI kalit AES-256 bilan shifrlanadi</span>
            </div>

            {aiRunSummary && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold ring-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Tasdiqlandi: {aiRunSummary.approve}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold ring-1 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900">
                  <XCircle className="h-3.5 w-3.5" /> Rad etildi: {aiRunSummary.reject}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold ring-1 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900">
                  <UserCog className="h-3.5 w-3.5" /> Xodimga: {aiRunSummary.human}
                </span>
                {aiRunSummary.error > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold ring-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700">
                    <Info className="h-3.5 w-3.5" /> Xato: {aiRunSummary.error}
                  </span>
                )}
              </div>
            )}

          </CardContent>
          )}
        </Card>
      )}

      {/* ═══════════════ 📜 Faoliyat modal ═══════════════ */}
      {actOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setActOpen(false)} />
          <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
            {/* Sarlavha */}
            <div className="px-5 py-3.5 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-violet-500/[0.08] to-transparent">
              <div className="w-9 h-9 rounded-xl grid place-items-center shrink-0 bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md">
                <History className="h-4.5 w-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold text-slate-800 dark:text-slate-100">Agent faoliyati</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{actTotal.toLocaleString('ru-RU')} ta yozuv</div>
              </div>
              <Button onClick={exportActivity} disabled={actExporting} variant="outline" className="h-8 gap-1.5 text-[12px] font-semibold">
                {actExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Excel
              </Button>
              <button onClick={() => setActOpen(false)} className="w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 transition-colors">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* Qidiruv */}
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <Input
                  value={actQ}
                  onChange={(e) => setActQ(e.target.value)}
                  placeholder="Klient, shartnoma yoki obyekt bo'yicha qidirish…"
                  className="h-9 pl-9 rounded-lg text-[12.5px]"
                />
                {actQuery.isFetching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />}
              </div>
            </div>

            {/* Ro'yxat */}
            <div className="flex-1 overflow-auto divide-y divide-slate-100 dark:divide-slate-800">
              {actQuery.isLoading ? (
                <div className="px-4 py-10 grid place-items-center text-slate-400 text-[12px]"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : (actQuery.data?.rows?.length ?? 0) === 0 ? (
                <div className="px-4 py-10 text-[12.5px] text-slate-400 dark:text-slate-500 text-center">Faoliyat topilmadi</div>
              ) : (
                actQuery.data!.rows.map((r) => {
                  const badge = decisionBadge(r);
                  return (
                    <div key={r.id} className="px-5 py-2.5 flex items-start gap-3">
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ring-1 shrink-0 mt-0.5', badge.cls)}>
                        {badge.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap text-[12px]">
                          <span className="font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[220px]">{r.client || '—'}</span>
                          {r.contractNo && <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{r.contractNo}</span>}
                          {r.amount != null && (
                            <span className="font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300">{r.amount.toLocaleString('ru-RU')}</span>
                          )}
                        </div>
                        {r.agentReason && (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 break-words whitespace-pre-wrap">{r.agentReason}</div>
                        )}
                      </div>
                      <div className="text-[10.5px] text-slate-400 dark:text-slate-500 shrink-0 mt-0.5 tabular-nums">{fmtDateTime(r.agentAt)}</div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Sahifalash */}
            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <span className="text-[11.5px] text-slate-500 dark:text-slate-400">{actPage} / {actPages}</span>
              <div className="flex items-center gap-2 ml-auto">
                <Button onClick={() => setActPage((p) => Math.max(1, p - 1))} disabled={actPage <= 1 || actQuery.isFetching} variant="outline" className="h-8 gap-1 text-[12px]">
                  <ChevronLeft className="h-4 w-4" /> Oldingi
                </Button>
                <Button onClick={() => setActPage((p) => Math.min(actPages, p + 1))} disabled={actPage >= actPages || actQuery.isFetching} variant="outline" className="h-8 gap-1 text-[12px]">
                  Keyingi <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ 💬 Suhbat drawer (o'ng tomon) ═══════════════ */}
      {chatOpen && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
          {/* Backdrop — bosilganda YOPILMAYDI (faqat X yoki ESC) */}
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
          <div className="absolute inset-y-0 right-0 w-full sm:max-w-[460px] flex flex-col bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 animate-in slide-in-from-right duration-300">
            {/* Sarlavha */}
            <div className="px-5 py-3.5 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-violet-500/[0.08] to-transparent shrink-0">
              <div className="w-9 h-9 rounded-xl grid place-items-center shrink-0 bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md">
                <Bot className="h-4.5 w-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold text-slate-800 dark:text-slate-100 truncate">{agentName}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Suhbat</div>
              </div>
              <button
                onClick={clearChat}
                disabled={chatClearMut.isPending || chatMsgs.length === 0}
                title="Tarixni tozalash"
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[11.5px] font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500 shrink-0 transition-colors"
              >
                {chatClearMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Tarixni tozalash
              </button>
              <button onClick={() => setChatOpen(false)} className="w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 transition-colors">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* Xabarlar */}
            <div ref={chatScrollRef} className="flex-1 overflow-auto p-4 space-y-3 bg-slate-50/40 dark:bg-slate-950/30">
              {chatHistoryQuery.isLoading ? (
                <div className="h-full grid place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : chatMsgs.length === 0 && !chatMut.isPending ? (
                <div className="h-full grid place-items-center text-center px-6">
                  <div className="text-slate-400 dark:text-slate-500">
                    <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-60" />
                    <div className="text-[12.5px]">Agent bilan suhbatlashing — savol bering.</div>
                  </div>
                </div>
              ) : (
                chatMsgs.map((m, i) => (
                  <div key={i} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-0.5 px-1">
                      {m.role === 'user' ? 'Siz' : agentName}
                    </span>
                    <div className={cn(
                      'max-w-[85%] px-3.5 py-2 rounded-2xl text-[12.5px] whitespace-pre-wrap break-words',
                      m.role === 'user'
                        ? 'bg-violet-600 text-white rounded-br-sm'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-1 ring-slate-200 dark:ring-slate-700 rounded-bl-sm',
                    )}>
                      {m.hasImage && (
                        <span className={cn(
                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold mb-1 mr-1 align-middle',
                          m.role === 'user' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300',
                        )}>
                          <ImageIcon className="h-3 w-3" /> rasm
                        </span>
                      )}
                      {m.content || (m.hasImage ? '' : '—')}
                    </div>
                  </div>
                ))
              )}
              {chatMut.isPending && (
                <div className="flex flex-col items-start">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-0.5 px-1">{agentName}</span>
                  <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Kiritish */}
            <div className="border-t border-slate-100 dark:border-slate-800 shrink-0">
              {chatImage && (
                <div className="px-4 pt-3">
                  <div className="relative inline-block">
                    <img
                      src={`data:${chatImage.mediaType};base64,${chatImage.data}`}
                      alt="biriktirilgan rasm"
                      className="h-16 w-16 object-cover rounded-lg ring-1 ring-slate-200 dark:ring-slate-700"
                    />
                    <button
                      onClick={() => setChatImage(null)}
                      title="Rasmni olib tashlash"
                      className="absolute -top-2 -right-2 w-5 h-5 grid place-items-center rounded-full bg-slate-700 text-white shadow hover:bg-rose-600 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
              <div className="px-4 py-3 flex items-center gap-2">
                <input ref={chatFileRef} type="file" accept="image/*" onChange={onChatFile} className="hidden" />
                <button
                  onClick={() => chatFileRef.current?.click()}
                  disabled={chatMut.isPending}
                  title="Rasm biriktirish"
                  className="w-10 h-10 grid place-items-center rounded-xl shrink-0 text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/40 disabled:opacity-40 transition-colors"
                >
                  <Paperclip className="h-4.5 w-4.5" />
                </button>
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  placeholder="Xabar yozing…"
                  className="h-10 rounded-xl text-[13px]"
                />
                <Button onClick={sendChat} disabled={chatMut.isPending || (!chatInput.trim() && !chatImage)} className="h-10 w-10 p-0 shrink-0 bg-violet-600 hover:bg-violet-700 text-white">
                  {chatMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ ⚙️ Telegram digest sozlamasi (yashirin) ═══════════════ */}
      {canManage && (
        <Card className="border-0 shadow-soft overflow-hidden">
          <button
            onClick={() => setDigestOpen((v) => !v)}
            className="w-full px-5 py-4 flex items-center gap-3.5 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl grid place-items-center shrink-0 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <Settings2 className="h-4.5 w-4.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13.5px] font-bold text-slate-700 dark:text-slate-200">⚙️ Telegram digest sozlamasi (XATO to&apos;lovlar)</span>
                <span className={cn(
                  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ring-1',
                  cfg?.enabled
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700',
                )}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', cfg?.enabled ? 'bg-emerald-500' : 'bg-slate-400')} />
                  {cfg?.enabled ? 'Yoqilgan' : "O'chirilgan"}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Ikkilamchi — kunlik XATO to&apos;lov digesti (bot token, guruh, whitelist)</div>
            </div>
            <ChevronDown className={cn('h-5 w-5 text-slate-400 shrink-0 transition-transform', digestOpen && 'rotate-180')} />
          </button>

          {digestOpen && (
            <div className="border-t border-slate-100 dark:border-slate-800 p-4 space-y-4 bg-slate-50/40 dark:bg-slate-900/30">
              {/* Holat */}
              <Card className="border-0 shadow-soft overflow-hidden">
                <div className={cn(
                  'px-5 py-4 flex items-center gap-3.5 border-b bg-gradient-to-r',
                  cfg?.enabled
                    ? 'border-emerald-100 dark:border-emerald-950 from-emerald-500/[0.09] via-teal-500/[0.04] to-transparent'
                    : 'border-slate-100 dark:border-slate-800 from-slate-500/[0.06] to-transparent',
                )}>
                  <div className={cn(
                    'w-11 h-11 rounded-2xl grid place-items-center shadow-md shrink-0',
                    cfg?.enabled ? 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/30' : 'bg-gradient-to-br from-slate-400 to-slate-600',
                  )}>
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-bold text-slate-800 dark:text-slate-100">AI Agent — XATO to'lov digest</span>
                      <span className={cn(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ring-1',
                        cfg?.enabled
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700',
                      )}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', cfg?.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400')} />
                        {cfg?.enabled ? 'Yoqilgan' : "O'chirilgan"}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Kuniga bir marta Telegram guruhga bitta xabar: nechta XATO to'lov borligini aytadi + tugma bilan ro'yxatga olib boradi.
                    </div>
                  </div>
                  <button
                    onClick={toggleEnabled}
                    disabled={saveMut.isPending}
                    title={cfg?.enabled ? "O'chirish" : 'Yoqish'}
                    className={cn('relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-60', cfg?.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600')}
                  >
                    <span className={cn('absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform', cfg?.enabled && 'translate-x-5')} />
                  </button>
                </div>

                <CardContent className="p-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatTile label="Kutayotgan XATO" value={String(cfg?.pendingCount ?? 0)} tone={((cfg?.pendingCount ?? 0) > 0) ? 'amber' : 'emerald'} />
                    <StatTile label="Bot" value={cfg?.hasToken ? (cfg.botUsername || `bor ${cfg.tokenHint || ''}`) : "yo'q"} tone={cfg?.hasToken ? 'emerald' : 'rose'} mono={!!cfg?.botUsername} />
                    <StatTile label="Guruh" value={cfg?.groupId || "yo'q"} tone={cfg?.groupId ? 'emerald' : 'rose'} mono />
                    <StatTile label="Kunlik vaqt" value={cfg?.dailyTime || '09:00'} tone="slate" />
                  </div>
                  {cfg?.lastResult && (
                    <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5" /> Oxirgi: {cfg.lastResult}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Sozlama */}
              <Card className="border-0 shadow-soft">
                <CardContent className="p-5 space-y-4">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Sozlama
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label={`Bot token ${cfg?.hasToken ? "(o'rnatilgan — bo'sh qoldirsa o'zgarmaydi)" : ''}`} icon={<Lock className="h-3.5 w-3.5" />}>
                      <Input value={botToken} onChange={(e) => setBotToken(e.target.value)} type="password" placeholder="123456:ABC-..." className="h-9 rounded-lg font-mono text-[12px]" />
                    </Field>
                    <Field label="Guruh chat ID" icon={<Building2 className="h-3.5 w-3.5" />}>
                      <Input value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="-1001234567890" className="h-9 rounded-lg font-mono text-[12px]" />
                    </Field>
                    <Field label="Qaysi sanadan XATO hisoblasin" icon={<CalendarDays className="h-3.5 w-3.5" />}>
                      <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 rounded-lg text-[12px]" />
                    </Field>
                    <Field label="Kunlik vaqt (Toshkent)" icon={<Clock className="h-3.5 w-3.5" />}>
                      <Input type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} className="h-9 rounded-lg text-[12px] w-32" />
                    </Field>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap pt-1">
                    <Button onClick={saveConfig} disabled={saveMut.isPending} className="h-10 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold">
                      {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Saqlash
                    </Button>
                    <Button onClick={() => runMut.mutate()} disabled={runMut.isPending || !configured} variant="outline" className="h-10 gap-2 text-[13px] font-semibold">
                      {runMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Hozir jo'natish (sinov)
                    </Button>
                    {!configured && <span className="text-[11px] text-amber-600 dark:text-amber-400">Avval bot token + guruh ID</span>}
                    <span className="text-[10.5px] text-slate-400 ml-auto">🔒 Bot token AES-256 bilan shifrlanadi</span>
                  </div>
                </CardContent>
              </Card>

              {/* Ruxsat berilganlar (chat_id whitelist) */}
              <Card className="border-0 shadow-soft">
                <CardContent className="p-5 space-y-3">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Ruxsat berilganlar (chat_id)
                  </div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
                    Faqat shu chat_id&apos;lar «Ro&apos;yxat»ni ocha oladi (qolganlar uchun ma&apos;lumot ko&apos;rinmaydi). chat_id&apos;ni bilish: xodim Telegram&apos;da <b>@userinfobot</b> ga <b>/start</b> yozadi → «Id» raqami.
                  </div>
                  <div className="space-y-2">
                    {whitelist.length === 0 && <div className="text-[12px] text-slate-400 dark:text-slate-500">Hali hech kim qo&apos;shilmagan</div>}
                    {whitelist.map((w, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input value={w.id} onChange={(e) => setWl(i, { id: e.target.value.replace(/\D/g, '') })} placeholder="chat_id (123456789)" className="h-9 rounded-lg font-mono text-[12px] w-48" />
                        <Input value={w.name} onChange={(e) => setWl(i, { name: e.target.value })} placeholder="Ism" className="h-9 rounded-lg text-[12px] flex-1" />
                        <button onClick={() => rmWl(i)} className="w-9 h-9 grid place-items-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0">✕</button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={addWl} variant="outline" className="h-9 gap-1.5 text-[12px]"><Plus className="h-4 w-4" /> Qo&apos;shish</Button>
                    <Button onClick={() => wlSave.mutate(whitelist)} disabled={wlSave.isPending} className="h-9 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold ml-auto">
                      {wlSave.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Ro&apos;yxatni saqlash
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Tushuntirish */}
              <Card className="border-0 shadow-soft">
                <CardContent className="p-5 text-[12px] text-slate-600 dark:text-slate-300 space-y-1.5">
                  <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><Send className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Agent hozir nima qiladi</div>
                  <div>• Har kuni <b>{cfg?.dailyTime}</b> da (Toshkent) sozlangan <b>Telegram guruhga bitta xabar</b> jo'natadi.</div>
                  <div>• Xabarda: nechta <b>XATO to'lov</b> (CRM'da tasdiqlanmagan) borligi + <b>«Barcha XATO to'lovlarni ko'rish»</b> tugmasi.</div>
                  <div>• Tugma bosilganda — <b>ОплатыКв</b> sahifasi XATO filtri bilan ochiladi (barcha XATO to'lovlar). Xodim o'sha yerda shartnoma tanlaydi + ariza yuklaydi.</div>
                  <div>• XATO bo'lmasa — xabar jo'natilmaydi.</div>
                  <div className="text-slate-400 dark:text-slate-500 pt-1">Keyingi bosqich: tugma Telegram ichida mini web ochadi (faqat guruh a'zolari), agent shartnomani o'zi taxmin qiladi.</div>
                </CardContent>
              </Card>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function decisionBadge(r: AiActivityRow): { label: string; cls: string } {
  if (r.status === 'approved') return { label: '✓ Tasdiqladi', cls: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900' };
  if (r.status === 'rejected') return { label: '✗ Rad etdi', cls: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900' };
  if (r.agentState === 'needs_review') return { label: '👁 Xodimga qoldirdi', cls: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900' };
  return { label: '⏳ Ishlanmoqda', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700' };
}

function fmtDateTime(s: string): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">{icon}{label}</label>
      {children}
    </div>
  );
}

function StatTile({ label, value, tone, mono, pulse }: { label: string; value: string; tone: 'slate' | 'emerald' | 'amber' | 'rose' | 'violet'; mono?: boolean; pulse?: boolean }) {
  const cls = {
    slate: 'bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-700 dark:text-emerald-300',
    amber: 'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900 text-amber-700 dark:text-amber-300',
    rose: 'bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300',
    violet: 'bg-violet-50 dark:bg-violet-950/40 ring-violet-200 dark:ring-violet-900 text-violet-700 dark:text-violet-300',
  }[tone];
  return (
    <div className={cn('rounded-xl ring-1 px-3 py-2.5', cls, pulse && 'animate-pulse ring-2')}>
      <div className="text-[9.5px] uppercase tracking-wider font-bold opacity-70">{label}</div>
      <div className={cn('text-[14px] font-bold mt-0.5 truncate', mono && 'font-mono text-[12px]')}>{value}</div>
    </div>
  );
}
