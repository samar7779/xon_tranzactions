'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Send, History, Lock, Trash2, Plus, Eye, EyeOff, Loader2, X,
  Clock, Search, AlertCircle, CheckCircle2, ShieldCheck, MessageSquare,
  Bot, Users, Bell,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';

type ChatRole = 'approver' | 'watcher';
type SverkaChat = {
  chatId: string;
  role: ChatRole;
  name: string | null;
  addedAt: string;
  addedBy: string | null;
};
type HistoryEntry = {
  timestamp: string;
  action: string;
  source: 'web' | 'telegram';
  actorId: string | null;
  actorName: string | null;
  chatId?: string;
  details: any;
};

const ACTION_META: Record<string, { label: string; icon: string; tone: string }> = {
  'mismatch_detected':   { label: 'Yangi farq aniqlandi',          icon: '⚠️', tone: 'amber' },
  'fix-missing':         { label: 'Yo\'qolgan tx qo\'shildi',     icon: '➕', tone: 'emerald' },
  'fix-all-missing':     { label: 'Hammasini qo\'shish (bulk)',   icon: '➕', tone: 'emerald' },
  'fix-tx-date':         { label: 'Tx sanasi tuzatildi',          icon: '📅', tone: 'amber' },
  'fix-all-tx-date':     { label: 'Sanani tuzatish (bulk)',       icon: '📅', tone: 'amber' },
  'chat_added':          { label: 'Chat qo\'shildi',               icon: '👤', tone: 'indigo' },
  'chat_updated':        { label: 'Chat yangilandi',               icon: '✏️', tone: 'indigo' },
  'chat_removed':        { label: 'Chat o\'chirildi',              icon: '✗',  tone: 'rose' },
  'test_notification':   { label: 'Test xabarnomasi',              icon: '🧪', tone: 'violet' },
};

export function SverkaTelegramDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState<'chats' | 'history' | 'bot'>('chats');

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setVerified(false);
        setPassword('');
        setTab('chats');
      }, 300);
    }
  }, [open]);

  const verifyMut = useMutation({
    mutationFn: (pw: string) => api.post<{ ok: boolean }>('/sverka-telegram/verify-password', { password: pw }),
    onSuccess: (r) => {
      if (r.ok) {
        setVerified(true);
        toast.success('Kirish muvaffaqiyatli');
      } else {
        toast.error('Noto\'g\'ri parol');
        setPassword('');
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1100px] w-full max-h-[92vh] overflow-hidden p-0 gap-0 flex flex-col">
        {/* Header */}
        <div className="px-7 py-5 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-950/40 dark:to-blue-950/40">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-lg">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 grid place-items-center text-white shadow-md shrink-0">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[18px] font-bold">Sverka — Telegram boshqaruvi</div>
                <div className="text-[12px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                  Chat ID lar, rollar (tasdiqlovchi/kuzatuvchi), tarix va bot sozlamalari.
                </div>
              </div>
            </DialogTitle>
            <DialogDescription className="sr-only">Sverka Telegram boshqaruv paneli</DialogDescription>
          </DialogHeader>
        </div>

        {!verified ? (
          // ─── PAROL KIRITISH ───
          <div className="p-12 flex-1 min-h-[400px] grid place-items-center">
            <div className="max-w-md mx-auto text-center">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-sky-100 to-blue-100 dark:from-sky-950 dark:to-blue-950 ring-1 ring-sky-200 dark:ring-sky-800 grid place-items-center mb-5">
                <Lock className="h-9 w-9 text-sky-600 dark:text-sky-400" />
              </div>
              <h3 className="text-[18px] font-bold text-slate-900 dark:text-slate-100 mb-1">
                Parol kerak
              </h3>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-6">
                Telegram boshqaruv paneliga kirish uchun parolni kiriting.
              </p>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && password.length > 0) verifyMut.mutate(password);
                }}
                placeholder="••••"
                className="font-mono text-center text-[18px] tracking-widest h-12"
                autoFocus
              />
              <Button
                onClick={() => verifyMut.mutate(password)}
                disabled={password.length === 0 || verifyMut.isPending}
                className="w-full mt-3 h-11 bg-gradient-to-br from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white gap-1.5"
              >
                {verifyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Kirish
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="px-7 pt-3 border-b border-slate-200 dark:border-slate-800 flex gap-2">
              <TabBtn active={tab === 'chats'} onClick={() => setTab('chats')} icon={<Users className="h-4 w-4" />}>
                Chatlar
              </TabBtn>
              <TabBtn active={tab === 'history'} onClick={() => setTab('history')} icon={<History className="h-4 w-4" />}>
                Tarix
              </TabBtn>
              <TabBtn active={tab === 'bot'} onClick={() => setTab('bot')} icon={<Bot className="h-4 w-4" />}>
                Bot sozlamalari
              </TabBtn>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-7">
              {tab === 'chats' && <ChatsTab />}
              {tab === 'history' && <HistoryTab />}
              {tab === 'bot' && <BotTab />}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="px-7 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-10 px-5">Yopish</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({ active, onClick, icon, children }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-3 text-[13.5px] font-semibold border-b-2 transition-colors -mb-px inline-flex items-center gap-2',
        active
          ? 'border-sky-600 text-sky-700 dark:text-sky-300'
          : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── CHATS TAB ─────────────────────────────────────────────
function ChatsTab() {
  const qc = useQueryClient();
  const [newChatId, setNewChatId] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<ChatRole>('watcher');

  const chatsQuery = useQuery({
    queryKey: ['sverka-tg-chats'],
    queryFn: () => api.get<SverkaChat[]>('/sverka-telegram/chats'),
    refetchOnWindowFocus: false,
  });

  const addMut = useMutation({
    mutationFn: (body: { chatId: string; role: ChatRole; name?: string }) =>
      api.post<SverkaChat>('/sverka-telegram/chats', body),
    onSuccess: () => {
      toast.success('Chat saqlandi');
      setNewChatId('');
      setNewName('');
      setNewRole('watcher');
      qc.invalidateQueries({ queryKey: ['sverka-tg-chats'] });
      qc.invalidateQueries({ queryKey: ['sverka-tg-history'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const removeMut = useMutation({
    mutationFn: (chatId: string) => api.delete(`/sverka-telegram/chats/${encodeURIComponent(chatId)}`),
    onSuccess: () => {
      toast.success('Chat o\'chirildi');
      qc.invalidateQueries({ queryKey: ['sverka-tg-chats'] });
      qc.invalidateQueries({ queryKey: ['sverka-tg-history'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const testMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; sent: number; failed: number; errors: string[] }>('/sverka-telegram/test'),
    onSuccess: (r) => {
      if (r.sent > 0) toast.success(`${r.sent} ta chatga test yuborildi`);
      if (r.failed > 0) toast.error(`${r.failed} ta xato: ${r.errors[0] || ''}`);
      qc.invalidateQueries({ queryKey: ['sverka-tg-history'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const resetMut = useMutation({
    mutationFn: () => api.post<{ ok: true; cleared: number }>('/sverka-telegram/reset-notified'),
    onSuccess: (r) => {
      toast.success(`Notifikatsiyalar reset qilindi (${r.cleared} ta hisob). Keyingi sverka'da barcha farqlar uchun xabar yuboriladi.`);
      qc.invalidateQueries({ queryKey: ['sverka-tg-history'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const chats = chatsQuery.data || [];

  return (
    <div className="space-y-5">
      {/* Add new chat form */}
      <div className="rounded-xl ring-1 ring-sky-200 dark:ring-sky-900 bg-sky-50/40 dark:bg-sky-950/20 p-5">
        <div className="text-[12.5px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300 mb-3 flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Yangi chat qo'shish
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1.5fr_160px] gap-3">
          <div>
            <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Chat ID</Label>
            <Input
              value={newChatId}
              onChange={(e) => setNewChatId(e.target.value)}
              placeholder="-1001234567890 yoki 123456789"
              className="h-10 mt-1.5 font-mono text-[13px]"
            />
          </div>
          <div>
            <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Nom (ixtiyoriy)</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Masalan: Ali aka"
              className="h-10 mt-1.5 text-[13px]"
            />
          </div>
          <div>
            <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Rol</Label>
            <Select value={newRole} onValueChange={(v) => setNewRole(v as ChatRole)}>
              <SelectTrigger className="h-10 mt-1.5 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="watcher">Kuzatuvchi</SelectItem>
                <SelectItem value="approver">Tasdiqlovchi</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
          <div className="text-[12px] text-slate-500 dark:text-slate-400">
            <strong>Tasdiqlovchi</strong> — inline tugmali xabarnoma · <strong>Kuzatuvchi</strong> — faqat matn.
          </div>
          <Button
            onClick={() => addMut.mutate({ chatId: newChatId.trim(), role: newRole, name: newName.trim() || undefined })}
            disabled={!newChatId.trim() || addMut.isPending}
            className="h-10 px-5 bg-sky-600 hover:bg-sky-700 text-white gap-1.5"
          >
            {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Qo'shish
          </Button>
        </div>
      </div>

      {/* Chats list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[12.5px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Chatlar ({chats.length})
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (confirm('Notifikatsiyalar tarixini tozalaysizmi? Keyingi sverka\'da yuborilmagan barcha farqlar uchun yangi xabar yuboriladi.')) {
                  resetMut.mutate();
                }
              }}
              disabled={resetMut.isPending}
              className="h-9 text-[12.5px] gap-1.5 px-3 border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950/40"
              title="Bugungi notified set'ni tozalash — keyingi sverka'da barcha farqlar uchun xabar yuboriladi"
            >
              {resetMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
              Notif. reset
            </Button>
            <Button
              variant="outline"
              onClick={() => testMut.mutate()}
              disabled={chats.length === 0 || testMut.isPending}
              className="h-9 text-[12.5px] gap-1.5 px-4"
            >
              {testMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
              Test yuborish
            </Button>
          </div>
        </div>

        {chatsQuery.isLoading ? (
          <div className="py-12 text-center text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
          </div>
        ) : chats.length === 0 ? (
          <div className="py-16 text-center text-slate-400 dark:text-slate-500">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <div className="text-[14px] font-medium">Hozircha chat yo'q</div>
            <div className="text-[12px] mt-1">Yuqoridagi forma orqali chat qo'shing.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {chats.map((c) => (
              <div
                key={c.chatId}
                className={cn(
                  'rounded-xl ring-1 px-4 py-3 flex items-center gap-3 transition-colors',
                  c.role === 'approver'
                    ? 'bg-emerald-50/50 dark:bg-emerald-950/30 ring-emerald-200 dark:ring-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                    : 'bg-slate-50/60 dark:bg-slate-900 ring-slate-200 dark:ring-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60',
                )}
              >
                <div className={cn(
                  'w-10 h-10 rounded-lg grid place-items-center shrink-0 text-[13px] font-bold',
                  c.role === 'approver'
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
                )}>
                  {c.role === 'approver' ? '✓' : '👁'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[13.5px] font-bold text-slate-800 dark:text-slate-200 truncate">{c.chatId}</div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {c.name && <><strong>{c.name}</strong> · </>}
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider',
                      c.role === 'approver'
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
                    )}>
                      {c.role === 'approver' ? 'tasdiqlovchi' : 'kuzatuvchi'}
                    </span>
                    {c.addedBy && <> · {c.addedBy}</>}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Chat ${c.chatId} ni o'chirasizmi?`)) {
                      removeMut.mutate(c.chatId);
                    }
                  }}
                  disabled={removeMut.isPending}
                  className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 p-2 rounded-md transition-colors disabled:opacity-50"
                  title="O'chirish"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── HISTORY TAB ──────────────────────────────────────────
function HistoryTab() {
  const [hq, setHq] = useState('');
  const [hqDebounced, setHqDebounced] = useState('');
  const [hActor, setHActor] = useState('');
  const [hPage, setHPage] = useState(1);
  const perPage = 15;

  useEffect(() => {
    const t = setTimeout(() => setHqDebounced(hq.trim()), 300);
    return () => clearTimeout(t);
  }, [hq]);

  useEffect(() => { setHPage(1); }, [hqDebounced, hActor]);

  const historyQuery = useQuery({
    queryKey: ['sverka-tg-history', hPage, hqDebounced, hActor],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('page', String(hPage));
      p.set('perPage', String(perPage));
      if (hqDebounced) p.set('q', hqDebounced);
      if (hActor) p.set('actorName', hActor);
      return api.get<{ ok: boolean; items: HistoryEntry[]; total: number; actors: string[]; actions: string[] }>(
        `/sverka-telegram/history?${p.toString()}`,
      );
    },
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  const items = historyQuery.data?.items || [];
  const total = historyQuery.data?.total || 0;
  const actors = historyQuery.data?.actors || [];
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            value={hq}
            onChange={(e) => setHq(e.target.value)}
            placeholder="Qidiruv..."
            className="pl-9 pr-8 h-9 text-[12.5px]"
          />
          {hq && (
            <button onClick={() => setHq('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={hActor || '__all__'} onValueChange={(v) => setHActor(v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-[180px] h-9 text-[12.5px]"><SelectValue placeholder="Aktor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Hamma</SelectItem>
            {actors.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
        <span>{historyQuery.isFetching && <Loader2 className="h-3 w-3 inline mr-1 animate-spin" />}Jami: <strong>{total}</strong></span>
        <span>Sahifa <strong>{hPage}</strong> / {totalPages}</span>
      </div>

      {/* Items */}
      {historyQuery.isLoading ? (
        <div className="py-12 text-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-slate-400">
          <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <div className="text-[13px]">Tarix bo'sh</div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((entry, i) => {
            const meta = ACTION_META[entry.action] || { label: entry.action, icon: '•', tone: 'slate' };
            const tones: Record<string, string> = {
              indigo:  'bg-indigo-50 dark:bg-indigo-950/40 ring-indigo-200 dark:ring-indigo-900',
              emerald: 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900',
              amber:   'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900',
              rose:    'bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900',
              violet:  'bg-violet-50 dark:bg-violet-950/40 ring-violet-200 dark:ring-violet-900',
              slate:   'bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-800',
            };
            return (
              <div key={i} className={cn('rounded-lg ring-1 px-3 py-2 flex items-start gap-2.5', tones[meta.tone])}>
                <div className="text-lg leading-none shrink-0 mt-0.5">{meta.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-bold truncate">{meta.label}</div>
                  <div className="text-[10.5px] text-slate-500 flex items-center gap-2 mt-0.5">
                    <Clock className="h-3 w-3" />
                    <span>{formatDateTime(entry.timestamp)}</span>
                    <span>·</span>
                    <span className="truncate">{entry.actorName || (entry.source === 'telegram' ? 'telegram' : 'web')}</span>
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-wider',
                      entry.source === 'telegram'
                        ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
                    )}>{entry.source}</span>
                  </div>
                  {entry.details && Object.keys(entry.details).length > 0 && (
                    <div className="text-[10.5px] text-slate-500 mt-1 font-mono">
                      {Object.entries(entry.details).map(([k, v]) => (
                        <span key={k} className="mr-2">{k}=<strong>{String(v)}</strong></span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
          <Button variant="outline" size="sm" onClick={() => setHPage((p) => Math.max(1, p - 1))} disabled={hPage <= 1} className="h-8 text-[11.5px]">← Oldingi</Button>
          <span className="text-[11.5px] text-slate-500">Sahifa <strong>{hPage}</strong> / {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setHPage((p) => Math.min(totalPages, p + 1))} disabled={hPage >= totalPages} className="h-8 text-[11.5px]">Keyingi →</Button>
        </div>
      )}
    </div>
  );
}

// ─── BOT TAB ──────────────────────────────────────────────
function BotTab() {
  const qc = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [newToken, setNewToken] = useState('');

  const tokenQuery = useQuery({
    queryKey: ['sverka-tg-bot-token'],
    queryFn: () => api.get<{ token: string; masked: string }>('/sverka-telegram/bot-token'),
    refetchOnWindowFocus: false,
  });

  const tokenMut = useMutation({
    mutationFn: (token: string) => api.post<{ ok: true }>('/sverka-telegram/bot-token', { token }),
    onSuccess: () => {
      toast.success('Token yangilandi');
      setNewToken('');
      setShowToken(false);
      qc.invalidateQueries({ queryKey: ['sverka-tg-bot-token'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 grid place-items-center shrink-0">
            <Bot className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="font-bold text-[13.5px] text-slate-900 dark:text-slate-100">Telegram bot tokeni</div>
            <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
              Bot token (Telegram'da @BotFather'dan oling). Token o'zgartirilsa, eski chatlar ham yangi bot bilan ishlaydi.
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Joriy token</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                value={showToken ? (tokenQuery.data?.token || '') : (tokenQuery.data?.masked || '')}
                readOnly
                className="font-mono text-[11.5px]"
              />
              <button
                onClick={() => setShowToken((v) => !v)}
                className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                title={showToken ? 'Yashirish' : 'Ko\'rsatish'}
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="pt-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Yangi token</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
                placeholder="123456:ABC-DEF1234..."
                className="font-mono text-[11.5px]"
              />
              <Button
                size="sm"
                onClick={() => tokenMut.mutate(newToken.trim())}
                disabled={!newToken.trim() || tokenMut.isPending}
                className="bg-sky-600 hover:bg-sky-700 text-white"
              >
                {tokenMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Saqlash'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl ring-1 ring-amber-200 dark:ring-amber-900 bg-amber-50/40 dark:bg-amber-950/20 p-4">
        <div className="text-[11.5px] text-amber-900 dark:text-amber-300 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Maslahat:</strong> Yangi chat ID olish uchun: bot'ga xabar yuboring va
            <code className="ml-1 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 rounded font-mono text-[10.5px]">
              https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates
            </code> ga kiring — javobdan <strong>chat.id</strong> ni ko'chiring.
          </div>
        </div>
      </div>
    </div>
  );
}
