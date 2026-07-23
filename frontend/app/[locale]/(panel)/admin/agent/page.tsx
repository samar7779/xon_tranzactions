'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot, Loader2, Save, Play, Lock, CalendarDays, Clock, KeyRound, Building2, Info, Send,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface AgentConfig {
  ok: boolean;
  enabled: boolean;
  hasToken: boolean;
  tokenHint: string | null;
  groupId: string | null;
  dateFrom: string | null;
  dailyTime: string;
  lastResult: string | null;
  pendingCount: number;
}

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

  const [botToken, setBotToken] = useState('');
  const [groupId, setGroupId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dailyTime, setDailyTime] = useState('09:00');
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!cfg || initialized) return;
    setGroupId(cfg.groupId || '');
    setDateFrom(cfg.dateFrom || '');
    setDailyTime(cfg.dailyTime || '09:00');
    setInitialized(true);
  }, [cfg, initialized]);

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
      {/* ─── Sarlavha + holat ─── */}
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
          {canManage && (
            <button
              onClick={toggleEnabled}
              disabled={saveMut.isPending}
              title={cfg?.enabled ? "O'chirish" : 'Yoqish'}
              className={cn('relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-60', cfg?.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600')}
            >
              <span className={cn('absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform', cfg?.enabled && 'translate-x-5')} />
            </button>
          )}
        </div>

        <CardContent className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Kutayotgan XATO" value={String(cfg?.pendingCount ?? 0)} tone={((cfg?.pendingCount ?? 0) > 0) ? 'amber' : 'emerald'} />
            <StatTile label="Bot" value={cfg?.hasToken ? `bor ${cfg.tokenHint || ''}` : "yo'q"} tone={cfg?.hasToken ? 'emerald' : 'rose'} />
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

      {/* ─── Sozlama ─── */}
      {canManage && (
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
      )}

      {/* ─── Tushuntirish ─── */}
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
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">{icon}{label}</label>
      {children}
    </div>
  );
}

function StatTile({ label, value, tone, mono }: { label: string; value: string; tone: 'slate' | 'emerald' | 'amber' | 'rose'; mono?: boolean }) {
  const cls = {
    slate: 'bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-700 dark:text-emerald-300',
    amber: 'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900 text-amber-700 dark:text-amber-300',
    rose: 'bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300',
  }[tone];
  return (
    <div className={cn('rounded-xl ring-1 px-3 py-2.5', cls)}>
      <div className="text-[9.5px] uppercase tracking-wider font-bold opacity-70">{label}</div>
      <div className={cn('text-[14px] font-bold mt-0.5 truncate', mono && 'font-mono text-[12px]')}>{value}</div>
    </div>
  );
}
