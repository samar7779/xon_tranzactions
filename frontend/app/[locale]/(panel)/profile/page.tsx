'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  UserCircle, Mail, Shield, ShieldCheck, KeyRound, Clock, Hash,
  CheckCircle2, Sparkles, Zap, Lock, Activity, Layers, Crown,
  Camera, Upload, X, Trash2, History, Settings, Globe, Monitor,
  Smartphone, Wifi, LogIn, ChevronRight, Eye, EyeOff, Palette,
  Bell, MapPin, Calendar, ImagePlus, Sun, Moon, FileEdit, LogOut,
  Cog, Eye as EyeIcon, Database, Award, Target, Flame, TrendingUp,
  Timer,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Topbar } from '@/components/topbar';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAvatar, setAvatar } from '@/lib/use-avatar';
import { cn, formatDateTime } from '@/lib/utils';
import { PomodoroTimer } from '@/components/pomodoro-timer';
import { AntiStress } from '@/components/anti-stress';

interface MeResponse {
  id: string;
  email: string;
  fullName?: string | null;
  role?: string | null;
  roleId?: string | null;
  roleLabel?: string | null;
  permissions: string[];
  lastLoginAt?: string | null;
  createdAt?: string;
}

type Tab = 'profile' | 'security' | 'settings' | 'antistress';

export default function ProfilePage() {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const cachedUser = useAuth((s) => s.user);

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    staleTime: 30_000,
  });

  const user = me || (cachedUser as any as MeResponse | null);
  const [tab, setTab] = useState<Tab>('profile');
  const [timerOpen, setTimerOpen] = useState(false);
  // useAvatar — reaktiv (boshqa joylar bilan sinxron)
  const avatarUrl = useAvatar(user?.id);

  const initial = (user?.fullName || user?.email || '?').charAt(0).toUpperCase();
  const permissions = user?.permissions || [];
  const moduleCount = new Set(permissions.map((p) => p.split(':')[0])).size;
  const actionCount = permissions.length;
  const isSuper = user?.role === 'SUPERADMIN';

  // Power level
  let powerKey: 'powerSuper' | 'powerHigh' | 'powerMid' | 'powerLow';
  let powerColor: string;
  if (isSuper) { powerKey = 'powerSuper'; powerColor = 'from-amber-400 via-rose-500 to-fuchsia-600'; }
  else if (actionCount >= 15) { powerKey = 'powerHigh'; powerColor = 'from-indigo-500 to-violet-600'; }
  else if (actionCount >= 6) { powerKey = 'powerMid'; powerColor = 'from-blue-500 to-cyan-600'; }
  else { powerKey = 'powerLow'; powerColor = 'from-slate-500 to-slate-700'; }

  function handleAvatarUpload(file: File) {
    if (!user?.id) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('avatarTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setAvatar(user.id, dataUrl); // emit qiladi — barcha komponentlar yangilaydi
      toast.success(t('avatarUpdated'));
    };
    reader.readAsDataURL(file);
  }

  function removeAvatar() {
    if (!user?.id) return;
    setAvatar(user.id, null);
    toast.success(t('avatarRemoved'));
  }

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />

      <div className="flex-1 p-6 lg:p-8 w-full">
        <div className="w-full space-y-6">

          {/* ═══ PRO HERO — ultra premium ═══ */}
          <UltraHero
            user={user}
            avatarUrl={avatarUrl}
            initial={initial}
            isSuper={isSuper}
            powerKey={powerKey}
            powerColor={powerColor}
            actionCount={actionCount}
            moduleCount={moduleCount}
            t={t}
            tc={tc}
            onTimerClick={() => setTimerOpen(true)}
          />

          {/* ═══ TAB BAR ═══ */}
          <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
            <TabButton
              active={tab === 'profile'}
              onClick={() => setTab('profile')}
              icon={<UserCircle className="h-4 w-4" />}
              label={t('tabProfile')}
              gradient="from-indigo-500 to-violet-600"
            />
            <TabButton
              active={tab === 'security'}
              onClick={() => setTab('security')}
              icon={<Lock className="h-4 w-4" />}
              label={t('tabSecurity')}
              gradient="from-amber-500 to-orange-600"
            />
            <TabButton
              active={tab === 'settings'}
              onClick={() => setTab('settings')}
              icon={<Settings className="h-4 w-4" />}
              label={t('tabSettings')}
              gradient="from-slate-500 to-slate-700"
            />
            <TabButton
              active={tab === 'antistress'}
              onClick={() => setTab('antistress')}
              icon={<Sparkles className="h-4 w-4" />}
              label="Anti-stress"
              gradient="from-fuchsia-500 to-violet-600"
            />
          </div>

          {/* ═══ TAB CONTENT ═══ */}
          {tab === 'profile' && (
            <ProfileTab
              user={user}
              avatarUrl={avatarUrl}
              initial={initial}
              onAvatarUpload={handleAvatarUpload}
              onAvatarRemove={removeAvatar}
            />
          )}
          {tab === 'security' && <SecurityTab user={user} />}
          {tab === 'settings' && <SettingsTab />}
          {tab === 'antistress' && <AntiStress onClose={() => setTab('profile')} />}
        </div>
      </div>

      {/* POMODORO TIMER MODAL — Timer iconni Hero'da bosish bilan ochiladi */}
      <Dialog open={timerOpen} onOpenChange={setTimerOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <PomodoroTimer />
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ═══════════════════ ULTRA HERO ═══════════════════ */

function UltraHero({ user, avatarUrl, initial, isSuper, powerKey, powerColor, actionCount, moduleCount, t, tc, onTimerClick }: any) {
  // Hisob yashi (kunlarda)
  const daysActive = user?.createdAt
    ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000)
    : 0;

  return (
    <div className="relative overflow-hidden rounded-3xl">
      {/* Multi-layer animated background */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-700 via-purple-800 to-blue-900" />

      {/* Animated mesh */}
      <div className="absolute inset-0 opacity-40">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-fuchsia-500/30 blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute top-1/4 right-0 w-[400px] h-[400px] rounded-full bg-cyan-400/25 blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
        <div className="absolute -bottom-32 left-1/3 w-[450px] h-[450px] rounded-full bg-amber-400/20 blur-3xl animate-pulse" style={{ animationDuration: '12s', animationDelay: '4s' }} />
      </div>

      {/* Grid pattern */}
      <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
           style={{
             backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
             backgroundSize: '40px 40px',
             maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, #000 30%, transparent 80%)',
             WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, #000 30%, transparent 80%)',
           }}
      />

      {/* Scanlines effect */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay"
           style={{ backgroundImage: 'repeating-linear-gradient(0deg, white, white 1px, transparent 1px, transparent 4px)' }}
      />

      <div className="relative px-6 lg:px-10 py-8 lg:py-10 text-white">
        {/* Top row: status badges */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/15 text-[10px] uppercase tracking-[0.2em] font-bold text-white/90">
              <Sparkles className="h-3 w-3" />
              {t('myAccount')}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-400/20 backdrop-blur-md ring-1 ring-emerald-300/40 text-[10px] uppercase tracking-[0.2em] font-bold text-emerald-200">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inset-0 rounded-full bg-emerald-300 opacity-75" />
                <span className="relative rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              Online
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-md ring-1 ring-white/20 text-[11px] font-semibold hover:bg-white/15 transition-colors">
              <FileEdit className="h-3.5 w-3.5" />
              {tc('edit')}
            </button>
          </div>
        </div>

        {/* Main row: avatar + identity + actions */}
        <div className="flex items-start gap-8 lg:gap-10 flex-wrap">
          {/* AVATAR — extra large with glow */}
          <div className="relative shrink-0">
            {/* Outer glow */}
            <div className="absolute -inset-4 bg-gradient-to-br from-fuchsia-500 via-purple-500 to-cyan-400 opacity-50 blur-2xl rounded-full" />

            {/* Rotating ring */}
            <svg className="absolute -inset-3 w-[calc(100%+1.5rem)] h-[calc(100%+1.5rem)] animate-[spin_20s_linear_infinite]" viewBox="0 0 100 100">
              <defs>
                <linearGradient id="heroRing1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
                  <stop offset="50%" stopColor="rgba(255,255,255,0)" />
                  <stop offset="100%" stopColor="rgba(252,165,165,0.9)" />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="48" fill="none" stroke="url(#heroRing1)" strokeWidth="1.5" strokeDasharray="8 4" />
            </svg>

            {/* Counter-rotating ring */}
            <svg className="absolute -inset-1.5 w-[calc(100%+0.75rem)] h-[calc(100%+0.75rem)] animate-[spin_30s_linear_infinite_reverse]" viewBox="0 0 100 100">
              <defs>
                <linearGradient id="heroRing2" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="rgba(34,211,238,0.7)" />
                  <stop offset="100%" stopColor="rgba(244,114,182,0.7)" />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="49" fill="none" stroke="url(#heroRing2)" strokeWidth="0.5" strokeDasharray="2 6" />
            </svg>

            {/* Avatar */}
            <div className="relative w-36 h-36 lg:w-40 lg:h-40 rounded-3xl bg-gradient-to-br from-white/30 via-white/10 to-white/5 ring-4 ring-white/30 backdrop-blur-md shadow-[0_25px_60px_-12px_rgba(0,0,0,0.7)] overflow-hidden grid place-items-center">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-6xl lg:text-7xl font-black drop-shadow-lg">{initial}</span>
              )}
            </div>

            {/* Verified crown */}
            <span className={cn(
              "absolute -bottom-2 -right-2 w-10 h-10 rounded-2xl ring-4 ring-purple-900 grid place-items-center shadow-xl",
              isSuper
                ? "bg-gradient-to-br from-amber-300 via-amber-400 to-rose-500"
                : "bg-gradient-to-br from-emerald-400 to-emerald-600",
            )}>
              {isSuper ? <Crown className="h-5 w-5 text-white" /> : <CheckCircle2 className="h-5 w-5 text-white" />}
            </span>
          </div>

          {/* IDENTITY */}
          <div className="min-w-0 flex-1">
            <div className="text-5xl lg:text-6xl font-black tracking-tight truncate bg-gradient-to-br from-white via-white to-indigo-200 bg-clip-text text-transparent leading-none mb-2">
              {user?.fullName || user?.email || '—'}
            </div>

            <div className="flex items-center gap-2 text-white/90 text-sm">
              <Mail className="h-4 w-4 text-white/60" />
              <span className="font-medium">{user?.email}</span>
            </div>

            {/* Pills row */}
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <span className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shadow-lg backdrop-blur-md",
                isSuper
                  ? 'bg-gradient-to-r from-amber-300/90 to-rose-400/90 text-rose-950 ring-1 ring-white/40'
                  : 'bg-white/15 ring-1 ring-white/25 text-white',
              )}>
                {isSuper ? <Crown className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {user?.roleLabel || user?.role || '—'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-md ring-1 ring-white/20 text-xs font-semibold text-white">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                {t('verified')}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-md ring-1 ring-white/20 text-xs font-semibold text-white">
                <Activity className="h-3.5 w-3.5 text-cyan-300" />
                {t('activeAccount')}
              </span>
            </div>

            {/* INLINE MINI STATS — glass cards */}
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MiniStat icon={<KeyRound className="h-3.5 w-3.5" />} label={t('permissions')} value={String(actionCount)} accent="text-cyan-300" />
              <MiniStat icon={<Layers className="h-3.5 w-3.5" />} label={t('modules')} value={String(moduleCount)} accent="text-emerald-300" />
              <MiniStat icon={<Flame className="h-3.5 w-3.5" />} label={t('daysActive')} value={String(daysActive)} accent="text-amber-300" />
              <MiniStat icon={<Award className="h-3.5 w-3.5" />} label={t('powerLevel')} value={t(powerKey)} accent="text-fuchsia-300" small />
            </div>
          </div>

          {/* RIGHT — Pomodoro Timer button (avval power level edi) */}
          <div className="shrink-0 hidden lg:block">
            <button
              onClick={onTimerClick}
              title={t('pomodoroOpen')}
              className="group relative"
            >
              {/* Pulsing glow rings */}
              <span className="absolute inset-0 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity" />
              <span className="absolute inset-0 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 animate-ping opacity-30" style={{ animationDuration: '3s' }} />

              <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-600 grid place-items-center shadow-2xl ring-4 ring-white/30
                              group-hover:scale-105 group-active:scale-95 transition-transform duration-300">
                <Timer className="h-12 w-12 text-white drop-shadow-lg" strokeWidth={2.2} />
                {/* Tick marks */}
                <span className="absolute top-1 left-1/2 -translate-x-1/2 w-0.5 h-2 bg-white/70 rounded-full" />
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-0.5 h-2 bg-white/70 rounded-full" />
                <span className="absolute left-1 top-1/2 -translate-y-1/2 h-0.5 w-2 bg-white/70 rounded-full" />
                <span className="absolute right-1 top-1/2 -translate-y-1/2 h-0.5 w-2 bg-white/70 rounded-full" />
              </div>

              {/* Label */}
              <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.25em] font-bold text-white/90 whitespace-nowrap">
                Pomodoro
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, accent, small }: any) {
  return (
    <div className="rounded-xl bg-white/10 backdrop-blur-md ring-1 ring-white/15 px-3 py-2">
      <div className={cn("flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold", accent)}>
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn("font-black text-white tabular-nums mt-0.5", small ? "text-sm" : "text-xl")}>
        {value}
      </div>
    </div>
  );
}

/* ═══════════════════ TABS ═══════════════════ */

function TabButton({ active, onClick, icon, label, gradient }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-4 h-11 rounded-xl text-[13px] font-semibold transition-all',
        active
          ? cn('text-white shadow-md bg-gradient-to-br', gradient)
          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-800',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* ═══════════════════ PROFILE TAB — Avatar + History + Permissions ═══════════════════ */

function ProfileTab({ user, avatarUrl, initial, onAvatarUpload, onAvatarRemove }: any) {
  return (
    <div className="space-y-6">
      {/* AVATAR UPLOAD — big pro section */}
      <AvatarUploadSection
        avatarUrl={avatarUrl}
        initial={initial}
        onUpload={onAvatarUpload}
        onRemove={onAvatarRemove}
      />

      {/* LOGIN HISTORY */}
      <LoginHistorySection user={user} />
    </div>
  );
}

function AvatarUploadSection({ avatarUrl, initial, onUpload, onRemove }: any) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onUpload(f);
  }

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className="bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/40 dark:to-violet-950/40 px-6 py-5 border-b border-indigo-100 dark:border-indigo-900">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-md">
            <ImagePlus className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-bold text-slate-900 dark:text-slate-100">{t('avatarTitle')}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{t('avatarFormats')}</div>
          </div>
        </div>
      </div>

      <CardContent className="p-6">
        <div className="grid md:grid-cols-[280px_1fr] gap-6 items-start">
          {/* Current avatar preview */}
          <div className="flex flex-col items-center">
            <div className="relative">
              <div className="absolute -inset-2 bg-gradient-to-br from-indigo-400 via-violet-500 to-fuchsia-500 rounded-3xl opacity-50 blur-xl" />
              <div className="relative w-48 h-48 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 ring-4 ring-white dark:ring-slate-900 shadow-xl overflow-hidden grid place-items-center">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-slate-400 dark:text-slate-500 text-7xl font-black">{initial}</span>
                )}
              </div>
              {avatarUrl && (
                <button
                  onClick={onRemove}
                  className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-rose-500 ring-4 ring-white dark:ring-slate-900 grid place-items-center shadow-lg hover:bg-rose-600 transition-colors"
                  title={tc('delete')}
                >
                  <X className="h-4 w-4 text-white" />
                </button>
              )}
            </div>
            <div className="mt-3 text-center">
              <div className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">{avatarUrl ? t('avatarCurrent') : t('avatarDefault')}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{t('avatarStoredBrowser')}</div>
            </div>
          </div>

          {/* Upload area */}
          <div className="space-y-3">
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                "relative cursor-pointer rounded-2xl border-2 border-dashed transition-all p-8 text-center",
                dragOver
                  ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40 scale-[1.02]"
                  : "border-slate-300 dark:border-slate-700 hover:border-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800",
              )}
            >
              <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-lg mb-3">
                <Upload className="h-7 w-7" />
              </div>
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">
                {t('dropzoneText')} <span className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2">{t('dropzoneSelect')}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('dropzoneHint')}
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                  e.target.value = '';
                }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 text-center">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mx-auto mb-1" />
                <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">PNG / JPG</div>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 text-center">
                <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400 mx-auto mb-1" />
                <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">{t('chip2mb')}</div>
              </div>
              <div className="p-3 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 ring-1 ring-cyan-200 dark:ring-cyan-900 text-center">
                <Database className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mx-auto mb-1" />
                <div className="text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">{t('chipBrowser')}</div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LoginHistorySection({ user }: any) {
  const t = useTranslations('profile');
  const sessions = [
    {
      id: 'current',
      device: 'Chrome · Windows',
      browser: 'Chrome 120',
      ip: '192.168.1.1',
      location: 'Toshkent, O\'zbekiston',
      time: new Date().toISOString(),
      current: true,
    },
    {
      id: 'prev',
      device: 'Chrome · Windows',
      browser: 'Chrome 120',
      ip: '192.168.1.1',
      location: 'Toshkent, O\'zbekiston',
      time: user?.lastLoginAt || new Date(Date.now() - 86400000).toISOString(),
      current: false,
    },
  ];

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 px-6 py-5 border-b border-emerald-100 dark:border-emerald-900">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow-md">
            <History className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="text-base font-bold text-slate-900 dark:text-slate-100">{t('loginHistory')}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{t('loginHistorySubtitle')}</div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold ring-1 ring-emerald-200 dark:ring-emerald-900">
            <Wifi className="h-3.5 w-3.5" />
            {t('sessionCount', { n: sessions.length })}
          </span>
        </div>
      </div>

      <CardContent className="p-0">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {sessions.map((s) => (
            <div key={s.id} className="px-6 py-4 flex items-center gap-4 hover:bg-slate-50/60 dark:hover:bg-slate-800 transition-colors">
              <div className={cn(
                "w-12 h-12 rounded-2xl grid place-items-center shrink-0 shadow-md",
                s.current
                  ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
              )}>
                {s.current ? <Wifi className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  {s.device}
                  {s.current && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wider font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-500" />
                      </span>
                      {t('sessionCurrent')}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> {s.ip}</span>
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {s.location}</span>
                  <span className="inline-flex items-center gap-1"><Monitor className="h-3 w-3" /> {s.browser}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[12px] font-bold text-slate-700 dark:text-slate-300">{formatDateTime(s.time)}</div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{s.current ? t('sessionNowActive') : t('sessionEnded')}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 text-center text-[11px] text-slate-500 dark:text-slate-400">
          <Sparkles className="inline h-3 w-3 mr-1 text-amber-500" />
          {t('auditHistoryNote')}
        </div>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════ SECURITY TAB — Actions Table + Tips ═══════════════════ */

function SecurityTab({ user }: any) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  // Sintetik amallar — keyin backend audit log'idan keladi
  const actions = [
    { id: 1, action: t('actLogin'), module: 'auth', ip: '192.168.1.1', time: new Date().toISOString(), status: 'success' },
    { id: 2, action: t('actTxEdited'), module: 'transactions', ip: '192.168.1.1', time: new Date(Date.now() - 3600000).toISOString(), status: 'success' },
    { id: 3, action: t('actRoleCreated'), module: 'roles', ip: '192.168.1.1', time: new Date(Date.now() - 7200000).toISOString(), status: 'success' },
    { id: 4, action: t('actSyncRestarted'), module: 'sync', ip: '192.168.1.1', time: new Date(Date.now() - 14400000).toISOString(), status: 'success' },
    { id: 5, action: t('actUserPwdUpdate'), module: 'users', ip: '192.168.1.1', time: new Date(Date.now() - 86400000).toISOString(), status: 'success' },
  ];

  const moduleColors: Record<string, string> = {
    auth: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-900',
    transactions: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900',
    roles: 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300 ring-fuchsia-200 dark:ring-fuchsia-900',
    sync: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900',
    users: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
  };

  return (
    <div className="space-y-6">
      {/* SECURITY STATUS */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-emerald-500 to-teal-600" />
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow-md">
              <Shield className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-base font-bold text-slate-800 dark:text-slate-200">{t('securityStatus')}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t('accountProtected')}</div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold ring-1 ring-emerald-200 dark:ring-emerald-900">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('secure')}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SecurityCheck icon={<Lock className="h-4 w-4" />} label={t('checkPasswordSet')} status="ok" />
            <SecurityCheck icon={<CheckCircle2 className="h-4 w-4" />} label={t('checkAccountVerified')} status="ok" />
            <SecurityCheck icon={<Wifi className="h-4 w-4" />} label={t('checkActiveSession')} status="ok" />
          </div>
        </CardContent>
      </Card>

      {/* ACTIONS TABLE */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 px-6 py-5 border-b border-amber-100 dark:border-amber-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white shadow-md">
              <Activity className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">{t('actionsDone')}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t('actionsDoneSubtitle')}</div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-bold ring-1 ring-amber-200 dark:ring-amber-900">
              {t('actionCount', { n: actions.length })}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-6 py-3">{t('colAction')}</th>
                <th className="text-left px-3 py-3">{t('colModule')}</th>
                <th className="text-left px-3 py-3">IP</th>
                <th className="text-left px-3 py-3">{tc('time')}</th>
                <th className="text-right px-6 py-3">{tc('status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {actions.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800 transition-colors">
                  <td className="px-6 py-3 font-semibold text-slate-800 dark:text-slate-200">{a.action}</td>
                  <td className="px-3 py-3">
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ring-1",
                      moduleColors[a.module] || 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
                    )}>
                      {a.module}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">{a.ip}</td>
                  <td className="px-3 py-3 text-slate-600 dark:text-slate-300 text-[12px]">{formatDateTime(a.time)}</td>
                  <td className="px-6 py-3 text-right">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold ring-1 ring-emerald-200 dark:ring-emerald-900">
                      <CheckCircle2 className="h-3 w-3" />
                      {t('statusSuccess')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 text-center text-[11px] text-slate-500 dark:text-slate-400">
          <Sparkles className="inline h-3 w-3 mr-1 text-amber-500" />
          {t('auditLogNote')}
        </div>
      </Card>

      {/* TIPS */}
      <div className="grid md:grid-cols-2 gap-4">
        <SecurityTip
          icon={<Lock />}
          gradient="from-emerald-500 to-teal-600"
          title={t('tipPasswordTitle')}
          body={t('tipPasswordBody')}
        />
        <SecurityTip
          icon={<Shield />}
          gradient="from-indigo-500 to-violet-600"
          title={t('tipLogoutTitle')}
          body={t('tipLogoutBody')}
        />
      </div>
    </div>
  );
}

function SecurityCheck({ icon, label, status }: { icon: React.ReactNode; label: string; status: 'ok' | 'warn' | 'err' }) {
  const cls = {
    ok:   'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-700 dark:text-emerald-300',
    warn: 'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900 text-amber-700 dark:text-amber-300',
    err:  'bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300',
  }[status];
  const dot = {
    ok:   'bg-emerald-500',
    warn: 'bg-amber-500',
    err:  'bg-rose-500',
  }[status];
  return (
    <div className={cn("p-3 rounded-xl ring-1 flex items-center gap-3", cls)}>
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 text-[12px] font-semibold">{label}</div>
      <span className={cn("w-2 h-2 rounded-full", dot)} />
    </div>
  );
}

function SecurityTip({ icon, gradient, title, body }: any) {
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className={cn("h-1 bg-gradient-to-r", gradient)} />
      <CardContent className="p-5 flex items-start gap-3">
        <div className={cn("w-10 h-10 rounded-xl bg-gradient-to-br grid place-items-center text-white shrink-0 shadow-md", gradient)}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold tracking-tight text-slate-800 dark:text-slate-200">{title}</div>
          <div className="text-[12px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{body}</div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════ SETTINGS TAB — Working theme switcher ═══════════════════ */

function SettingsTab() {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [notifications, setNotifications] = useState(true);

  // Theme'ni localStorage'dan o'qish va html elementga class qo'yish
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (stored) {
      setTheme(stored);
      document.documentElement.classList.toggle('dark', stored === 'dark');
    }
    const storedNotif = localStorage.getItem('notifications');
    if (storedNotif !== null) setNotifications(storedNotif === 'true');
  }, []);

  function applyTheme(newTheme: 'light' | 'dark') {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    toast.success(newTheme === 'dark' ? `🌙 ${t('themeDarkOn')}` : `☀️ ${t('themeLightOn')}`);
  }

  function toggleNotifications() {
    const newVal = !notifications;
    setNotifications(newVal);
    localStorage.setItem('notifications', String(newVal));
    toast.success(newVal ? `🔔 ${t('notifOn')}` : `🔕 ${t('notifOff')}`);
  }

  return (
    <div className="space-y-6">
      {/* THEME */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/40 dark:to-purple-950/40 px-6 py-5 border-b border-violet-100 dark:border-violet-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 grid place-items-center text-white shadow-md">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">{t('appearance')}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t('appearanceSubtitle')}</div>
            </div>
          </div>
        </div>

        <CardContent className="p-6">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">{t('theme')}</div>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <button
              onClick={() => applyTheme('light')}
              className={cn(
                "relative p-5 rounded-2xl ring-2 transition-all text-left group",
                theme === 'light'
                  ? "ring-indigo-500 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/40 shadow-lg"
                  : "ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 hover:ring-slate-300 dark:hover:ring-slate-600",
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-12 h-12 rounded-xl grid place-items-center shadow-md transition-all",
                  theme === 'light' ? "bg-gradient-to-br from-amber-400 to-orange-500 scale-110" : "bg-slate-100 dark:bg-slate-800",
                )}>
                  <Sun className={cn("h-6 w-6", theme === 'light' ? 'text-white' : 'text-slate-500 dark:text-slate-400')} />
                </div>
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-200">{t('themeLight')}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{t('themeLightDesc')}</div>
                </div>
              </div>
              {theme === 'light' && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-indigo-600 grid place-items-center shadow-md">
                  <CheckCircle2 className="h-4 w-4 text-white" />
                </div>
              )}
              {/* Mini preview */}
              <div className="mt-3 h-2 rounded-full bg-gradient-to-r from-yellow-200 via-amber-300 to-orange-300" />
            </button>

            <button
              onClick={() => applyTheme('dark')}
              className={cn(
                "relative p-5 rounded-2xl ring-2 transition-all text-left group",
                theme === 'dark'
                  ? "ring-indigo-500 bg-gradient-to-br from-slate-800 to-slate-900 shadow-lg"
                  : "ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 hover:ring-slate-300 dark:hover:ring-slate-600",
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-12 h-12 rounded-xl grid place-items-center shadow-md transition-all",
                  theme === 'dark' ? "bg-gradient-to-br from-indigo-500 to-violet-700 scale-110" : "bg-slate-100 dark:bg-slate-800",
                )}>
                  <Moon className={cn("h-6 w-6", theme === 'dark' ? 'text-white' : 'text-slate-500 dark:text-slate-400')} />
                </div>
                <div>
                  <div className={cn("font-bold", theme === 'dark' ? 'text-white' : 'text-slate-800')}>{t('themeDark')}</div>
                  <div className={cn("text-[11px]", theme === 'dark' ? 'text-white/60' : 'text-slate-500')}>{t('themeDarkDesc')}</div>
                </div>
              </div>
              {theme === 'dark' && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-indigo-600 grid place-items-center shadow-md">
                  <CheckCircle2 className="h-4 w-4 text-white" />
                </div>
              )}
              {/* Mini preview */}
              <div className="mt-3 h-2 rounded-full bg-gradient-to-r from-indigo-900 via-violet-700 to-purple-800" />
            </button>
          </div>

          <div className="mt-4 p-3 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 ring-1 ring-cyan-200 dark:ring-cyan-900 text-[11px] text-cyan-800 dark:text-cyan-300 flex items-start gap-2">
            <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
            <div>
              <span className="font-bold">{t('storedBrowserLabel')}</span> {t('storedBrowserBefore')} <code className="font-mono">localStorage</code>{t('storedBrowserAfter')}
              {theme === 'dark' && ` ${t('darkPartialNote')}`}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* NOTIFICATIONS */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-rose-500 to-pink-600" />
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 grid place-items-center text-white shadow-md">
              <Bell className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">{t('notifications')}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t('notificationsSubtitle')}</div>
            </div>
            <button
              onClick={toggleNotifications}
              className={cn(
                "relative w-14 h-8 rounded-full transition-colors",
                notifications ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700",
              )}
            >
              <span className={cn(
                "absolute top-1 w-6 h-6 rounded-full bg-white shadow-md transition-all",
                notifications ? "left-7" : "left-1",
              )} />
            </button>
          </div>

          <div className="text-[11px] text-slate-500 dark:text-slate-400 pl-13">
            {notifications
              ? `✓ ${t('notifEnabledHint')}`
              : `○ ${t('notifDisabledHint')}`}
          </div>
        </CardContent>
      </Card>

      {/* LANGUAGE */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-cyan-500 to-blue-600" />
        <CardContent className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 grid place-items-center text-white shadow-md">
            <Globe className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="text-base font-bold text-slate-900 dark:text-slate-100">{tc('language')}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{t('languageHint')}</div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 text-xs font-bold ring-1 ring-cyan-200 dark:ring-cyan-900">
            UZ · RU · EN
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
