'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Lock, Loader2, Send, Save, KeyRound, Bot, Users, Clock, Timer, Power, Eye, EyeOff,
  Server, Link2, KeySquare,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { makeT, type ChekLang } from './i18n';

const CHEK_PASS = '7779';
const LS_UNLOCK = 'chek.sozlamalar.unlocked';

interface TgConfig {
  botToken: string; groupId: string; intervalMin: number;
  fromHour: number; toHour: number; enabled: boolean;
}

export function SozlamalarTab({ lang }: { lang: ChekLang }) {
  const t = makeT(lang);
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    try { if (sessionStorage.getItem(LS_UNLOCK) === '1') setUnlocked(true); } catch {}
  }, []);

  if (!unlocked) return <PasswordGate t={t} onUnlock={() => {
    try { sessionStorage.setItem(LS_UNLOCK, '1'); } catch {}
    setUnlocked(true);
  }} />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start max-w-6xl mx-auto">
      <TgSettings t={t} />
      <HrSettings t={t} />
    </div>
  );
}

function PasswordGate({ t, onUnlock }: { t: (k: string) => string; onUnlock: () => void }) {
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState(false);
  const [show, setShow] = useState(false);
  function submit() {
    if (pwd === CHEK_PASS) { setErr(false); onUnlock(); }
    else { setErr(true); }
  }
  return (
    <div className="max-w-md mx-auto mt-8">
      <div className="rounded-3xl bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl ring-1 ring-white/60 dark:ring-slate-800 shadow-[0_20px_50px_-25px_rgba(79,70,229,0.35)] overflow-hidden">
        <div className="relative bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-6 pt-8 pb-7 text-center overflow-hidden">
          <div className="absolute -top-10 -right-8 w-36 h-36 rounded-full bg-white/15 blur-2xl" />
          <div className="relative mx-auto w-16 h-16 rounded-2xl bg-white/25 backdrop-blur grid place-items-center ring-1 ring-white/50 shadow-lg">
            <Lock className="h-8 w-8 text-white" />
          </div>
          <div className="relative mt-3.5 text-lg font-black text-white">{t('settingsTitle')}</div>
          <div className="relative text-[13px] text-white/85 mt-0.5">{t('password')}</div>
        </div>
        <div className="p-6">
          <div className="relative">
            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              type={show ? 'text' : 'password'}
              value={pwd}
              inputMode="numeric"
              autoFocus
              onChange={(e) => { setPwd(e.target.value); setErr(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="••••"
              className={cn('h-12 pl-10 pr-10 rounded-xl text-center text-lg tracking-[0.4em] font-bold', err && 'border-rose-400 ring-2 ring-rose-300')}
            />
            <button onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {err && <div className="text-[12px] text-rose-600 font-medium mt-2 text-center">{t('wrongPassword')}</div>}
          <Button onClick={submit} disabled={!pwd} className="w-full h-11 mt-4 rounded-xl gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 font-bold">
            <Lock className="h-4 w-4" /> {t('unlock')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TgSettings({ t }: { t: (k: string) => string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['chek-tg-config'],
    queryFn: () => api.get<TgConfig>('/chek/tg-config'),
    staleTime: 5_000,
  });

  const [cfg, setCfg] = useState<TgConfig>({ botToken: '', groupId: '', intervalMin: 5, fromHour: 9, toHour: 21, enabled: false });
  const [showToken, setShowToken] = useState(false);
  useEffect(() => { if (data) setCfg(data); }, [data]);

  const save = useMutation({
    mutationFn: (body: TgConfig) => api.patch('/chek/tg-config', body),
    onSuccess: () => toast.success(t('saved')),
    onError: (e: any) => toast.error(e?.message || t('error')),
  });
  const test = useMutation({
    mutationFn: () => api.post('/chek/tg-test', {}),
    onSuccess: (r: any) => r?.ok ? toast.success(t('testSent')) : toast.error(r?.error || t('error')),
    onError: (e: any) => toast.error(e?.message || t('error')),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div>
      <div className="rounded-3xl bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl ring-1 ring-white/60 dark:ring-slate-800 shadow-[0_20px_50px_-25px_rgba(79,70,229,0.35)] overflow-hidden">
        {/* Hero */}
        <div className="relative bg-gradient-to-br from-sky-500 to-blue-600 px-6 py-6 overflow-hidden">
          <div className="absolute -top-10 -right-8 w-40 h-40 rounded-full bg-white/15 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/25 backdrop-blur grid place-items-center ring-1 ring-white/40">
              <Send className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="text-white font-black text-lg">{t('tgTitle')}</div>
              <div className="text-white/85 text-[12px]">{t('tgDesc')}</div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Yoqilgan toggle */}
          <button onClick={() => setCfg((c) => ({ ...c, enabled: !c.enabled }))}
            className={cn('w-full flex items-center justify-between gap-3 h-14 px-4 rounded-2xl ring-1 transition-colors',
              cfg.enabled ? 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900' : 'bg-slate-50 dark:bg-slate-800/50 ring-slate-200 dark:ring-slate-700')}>
            <span className="flex items-center gap-2.5">
              <Power className={cn('h-5 w-5', cfg.enabled ? 'text-emerald-500' : 'text-slate-400')} />
              <span className="font-bold text-[14px] text-slate-800 dark:text-slate-200">{t('enabledLabel')}</span>
            </span>
            <span className={cn('relative w-11 h-6 rounded-full transition-colors', cfg.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600')}>
              <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', cfg.enabled && 'translate-x-5')} />
            </span>
          </button>

          <SField icon={<Bot className="h-3.5 w-3.5 text-sky-500" />} label={t('botToken')}>
            <div className="relative">
              <Input type={showToken ? 'text' : 'password'} value={cfg.botToken} onChange={(e) => setCfg((c) => ({ ...c, botToken: e.target.value }))}
                placeholder="123456:ABC..." className="h-11 rounded-xl font-mono text-[13px] pr-10" />
              <button onClick={() => setShowToken((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </SField>

          <SField icon={<Users className="h-3.5 w-3.5 text-sky-500" />} label={t('groupId')}>
            <Input value={cfg.groupId} onChange={(e) => setCfg((c) => ({ ...c, groupId: e.target.value }))}
              placeholder="-1001234567890" className="h-11 rounded-xl font-mono text-[13px]" />
          </SField>

          <div className="grid grid-cols-3 gap-3">
            <SField icon={<Timer className="h-3.5 w-3.5 text-indigo-500" />} label={t('intervalMin')}>
              <Input type="number" min={1} value={cfg.intervalMin} onChange={(e) => setCfg((c) => ({ ...c, intervalMin: Number(e.target.value) }))} className="h-11 rounded-xl tabular-nums" />
            </SField>
            <SField icon={<Clock className="h-3.5 w-3.5 text-indigo-500" />} label={t('fromHour')}>
              <Input type="number" min={0} max={23} value={cfg.fromHour} onChange={(e) => setCfg((c) => ({ ...c, fromHour: Number(e.target.value) }))} className="h-11 rounded-xl tabular-nums" />
            </SField>
            <SField icon={<Clock className="h-3.5 w-3.5 text-indigo-500" />} label={t('toHour')}>
              <Input type="number" min={0} max={24} value={cfg.toHour} onChange={(e) => setCfg((c) => ({ ...c, toHour: Number(e.target.value) }))} className="h-11 rounded-xl tabular-nums" />
            </SField>
          </div>

          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !cfg.botToken || !cfg.groupId} className="h-11 rounded-xl gap-1.5 font-semibold">
              {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t('test')}
            </Button>
            <Button onClick={() => save.mutate(cfg)} disabled={save.isPending} className="flex-1 h-11 rounded-xl gap-1.5 font-bold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface HrConfig { url: string; apiKey: string; apiSecret: string; }

function HrSettings({ t }: { t: (k: string) => string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['chek-hr-config'],
    queryFn: () => api.get<HrConfig>('/chek/hr-config'),
    staleTime: 5_000,
  });
  const [cfg, setCfg] = useState<HrConfig>({ url: 'https://hr.xonapps.uz/api/v1', apiKey: '', apiSecret: '' });
  const [showSecret, setShowSecret] = useState(false);
  useEffect(() => { if (data) setCfg(data); }, [data]);

  const save = useMutation({
    mutationFn: (body: HrConfig) => api.patch('/chek/hr-config', body),
    onSuccess: () => toast.success(t('saved')),
    onError: (e: any) => toast.error(e?.message || t('error')),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; count?: number; error?: string }>('/chek/hr-test', {}),
    onSuccess: (r: any) => r?.ok ? toast.success(`${t('testSent')} · ${r.count ?? 0}`) : toast.error(r?.error || t('error')),
    onError: (e: any) => toast.error(e?.message || t('error')),
  });

  if (isLoading) return null;

  return (
    <div>
      <div className="rounded-3xl bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl ring-1 ring-white/60 dark:ring-slate-800 shadow-[0_20px_50px_-25px_rgba(79,70,229,0.35)] overflow-hidden">
        <div className="relative bg-gradient-to-br from-violet-500 to-fuchsia-600 px-6 py-6 overflow-hidden">
          <div className="absolute -top-10 -right-8 w-40 h-40 rounded-full bg-white/15 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/25 backdrop-blur grid place-items-center ring-1 ring-white/40">
              <Server className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="text-white font-black text-lg">{t('hrTitle')}</div>
              <div className="text-white/85 text-[12px]">{t('hrDesc')}</div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <SField icon={<Link2 className="h-3.5 w-3.5 text-violet-500" />} label={t('hrUrl')}>
            <Input value={cfg.url} onChange={(e) => setCfg((c) => ({ ...c, url: e.target.value }))}
              placeholder="https://hr.xonapps.uz/api/v1" className="h-11 rounded-xl font-mono text-[13px]" />
          </SField>
          <SField icon={<KeyRound className="h-3.5 w-3.5 text-violet-500" />} label={t('apiKey')}>
            <Input value={cfg.apiKey} onChange={(e) => setCfg((c) => ({ ...c, apiKey: e.target.value }))}
              placeholder="xs_key_..." className="h-11 rounded-xl font-mono text-[13px]" />
          </SField>
          <SField icon={<KeySquare className="h-3.5 w-3.5 text-violet-500" />} label={t('apiSecret')}>
            <div className="relative">
              <Input type={showSecret ? 'text' : 'password'} value={cfg.apiSecret} onChange={(e) => setCfg((c) => ({ ...c, apiSecret: e.target.value }))}
                placeholder="xs_sec_..." className="h-11 rounded-xl font-mono text-[13px] pr-10" />
              <button onClick={() => setShowSecret((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </SField>

          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !cfg.url || !cfg.apiKey || !cfg.apiSecret} className="h-11 rounded-xl gap-1.5 font-semibold">
              {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />} {t('test')}
            </Button>
            <Button onClick={() => save.mutate(cfg)} disabled={save.isPending} className="flex-1 h-11 rounded-xl gap-1.5 font-bold bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SField({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-[0.15em] font-bold text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
        {icon} {label}
      </label>
      {children}
    </div>
  );
}
