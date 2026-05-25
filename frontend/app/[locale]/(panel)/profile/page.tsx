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
  Bell, MapPin, Calendar,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Topbar } from '@/components/topbar';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, formatDateTime } from '@/lib/utils';

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

type Tab = 'overview' | 'activity' | 'security' | 'settings';

const PERM_GROUP_META: Record<string, { navKey: string; from: string; to: string; chip: string }> = {
  dashboard:    { navKey: 'dashboard',    from: 'from-indigo-500',  to: 'to-blue-600',     chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  transactions: { navKey: 'transactions', from: 'from-emerald-500', to: 'to-teal-600',     chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  accounts:     { navKey: 'accounts',     from: 'from-cyan-500',    to: 'to-sky-600',      chip: 'bg-cyan-50 text-cyan-700 ring-cyan-200' },
  credentials:  { navKey: 'credentials',  from: 'from-violet-500',  to: 'to-purple-600',   chip: 'bg-violet-50 text-violet-700 ring-violet-200' },
  banks:        { navKey: 'banks',        from: 'from-blue-500',    to: 'to-indigo-600',   chip: 'bg-blue-50 text-blue-700 ring-blue-200' },
  sync:         { navKey: 'syncLogs',     from: 'from-amber-500',   to: 'to-orange-600',   chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  users:        { navKey: 'adminUsers',   from: 'from-rose-500',    to: 'to-pink-600',     chip: 'bg-rose-50 text-rose-700 ring-rose-200' },
  roles:        { navKey: 'roles',        from: 'from-fuchsia-500', to: 'to-purple-600',   chip: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200' },
  system:       { navKey: 'adminPanel',   from: 'from-slate-600',   to: 'to-slate-800',    chip: 'bg-slate-100 text-slate-700 ring-slate-200' },
  customers:    { navKey: 'customers',    from: 'from-lime-500',    to: 'to-emerald-600',  chip: 'bg-lime-50 text-lime-700 ring-lime-200' },
  contracts:    { navKey: 'contracts',    from: 'from-orange-500',  to: 'to-rose-600',     chip: 'bg-orange-50 text-orange-700 ring-orange-200' },
  payments:     { navKey: 'payments',     from: 'from-green-500',   to: 'to-emerald-600',  chip: 'bg-green-50 text-green-700 ring-green-200' },
};
const FALLBACK_META = { navKey: '', from: 'from-slate-400', to: 'to-slate-600', chip: 'bg-slate-50 text-slate-700 ring-slate-200' };

const ACTION_KEY: Record<string, string> = {
  view: 'actionView',
  manage: 'actionManage',
  test: 'actionTest',
  run: 'actionRun',
  deploy: 'actionDeploy',
};

export default function ProfilePage() {
  const t = useTranslations('profile');
  const tNav = useTranslations('nav');
  const cachedUser = useAuth((s) => s.user);

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    staleTime: 30_000,
  });

  const user = me || (cachedUser as any as MeResponse | null);
  const [tab, setTab] = useState<Tab>('overview');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Avatar localStorage'dan o'qish (keyin backend'ga ko'chiriladi)
  useEffect(() => {
    if (user?.id && typeof window !== 'undefined') {
      const stored = localStorage.getItem(`avatar_${user.id}`);
      if (stored) setAvatarUrl(stored);
    }
  }, [user?.id]);

  const initial = (user?.fullName || user?.email || '?').charAt(0).toUpperCase();
  const permissions = user?.permissions || [];

  const grouped = permissions.reduce<Record<string, string[]>>((acc, p) => {
    const [resource, action] = p.split(':');
    if (!acc[resource]) acc[resource] = [];
    acc[resource].push(action || p);
    return acc;
  }, {});

  const moduleCount = Object.keys(grouped).length;
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
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Rasm hajmi 2MB dan oshmasligi kerak');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setAvatarUrl(dataUrl);
      if (user?.id) localStorage.setItem(`avatar_${user.id}`, dataUrl);
      toast.success('Profil rasmi yangilandi');
    };
    reader.readAsDataURL(file);
  }

  function removeAvatar() {
    setAvatarUrl(null);
    if (user?.id) localStorage.removeItem(`avatar_${user.id}`);
    toast.success('Rasm olib tashlandi');
  }

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />

      <div className="flex-1 p-6 lg:p-8 w-full">
        <div className="w-full space-y-6">

          {/* ═══ HERO — pro premium ═══ */}
          <ProHero
            user={user}
            avatarUrl={avatarUrl}
            initial={initial}
            isSuper={isSuper}
            powerKey={powerKey}
            powerColor={powerColor}
            actionCount={actionCount}
            onAvatarUpload={handleAvatarUpload}
            onAvatarRemove={removeAvatar}
            t={t}
          />

          {/* ═══ TAB BAR ═══ */}
          <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-2xl">
            <TabButton
              active={tab === 'overview'}
              onClick={() => setTab('overview')}
              icon={<UserCircle className="h-4 w-4" />}
              label="Umumiy"
              gradient="from-indigo-500 to-violet-600"
            />
            <TabButton
              active={tab === 'activity'}
              onClick={() => setTab('activity')}
              icon={<Activity className="h-4 w-4" />}
              label="Faoliyat"
              gradient="from-emerald-500 to-teal-600"
            />
            <TabButton
              active={tab === 'security'}
              onClick={() => setTab('security')}
              icon={<Lock className="h-4 w-4" />}
              label="Xavfsizlik"
              gradient="from-amber-500 to-orange-600"
            />
            <TabButton
              active={tab === 'settings'}
              onClick={() => setTab('settings')}
              icon={<Settings className="h-4 w-4" />}
              label="Sozlamalar"
              gradient="from-slate-500 to-slate-700"
            />
          </div>

          {/* ═══ TAB CONTENT ═══ */}
          {tab === 'overview' && (
            <OverviewTab
              user={user}
              permissions={permissions}
              grouped={grouped}
              moduleCount={moduleCount}
              actionCount={actionCount}
              t={t}
              tNav={tNav}
            />
          )}
          {tab === 'activity' && <ActivityTab user={user} t={t} />}
          {tab === 'security' && <SecurityTab t={t} />}
          {tab === 'settings' && <SettingsTab t={t} />}
        </div>
      </div>
    </>
  );
}

/* ═══════════════════ HERO ═══════════════════ */

function ProHero({
  user, avatarUrl, initial, isSuper, powerKey, powerColor, actionCount,
  onAvatarUpload, onAvatarRemove, t,
}: any) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className="relative bg-gradient-to-br from-indigo-700 via-violet-700 to-blue-700 overflow-hidden">
        {/* Background fx */}
        <div className="absolute inset-0 bg-dots opacity-10 pointer-events-none" />
        <div className="absolute -top-32 -right-20 w-96 h-96 rounded-full bg-fuchsia-400/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-20 w-96 h-96 rounded-full bg-cyan-400/15 blur-3xl pointer-events-none" />

        <div className="relative px-8 py-10 lg:py-12 text-white">
          <div className="flex items-center gap-6 lg:gap-8 flex-wrap">
            {/* Avatar — upload qilish mumkin */}
            <div className="relative shrink-0 group/avatar">
              {/* Rotating ring */}
              <svg className="absolute -inset-2 w-[calc(100%+1rem)] h-[calc(100%+1rem)] animate-[spin_18s_linear_infinite]" viewBox="0 0 100 100" aria-hidden>
                <defs>
                  <linearGradient id="profRing" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
                    <stop offset="50%" stopColor="rgba(255,255,255,0.0)" />
                    <stop offset="100%" stopColor="rgba(252,165,165,0.85)" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="48" fill="none" stroke="url(#profRing)" strokeWidth="1.5" strokeDasharray="6 4" />
              </svg>

              <div className="relative w-28 h-28 rounded-3xl bg-gradient-to-br from-white/40 via-white/15 to-white/5 ring-2 ring-white/50 backdrop-blur-md grid place-items-center shadow-2xl overflow-hidden">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white text-5xl font-black">{initial}</span>
                )}

                {/* Hover overlay — upload */}
                <button
                  onClick={() => fileRef.current?.click()}
                  className="absolute inset-0 bg-black/60 grid place-items-center opacity-0 group-hover/avatar:opacity-100 transition-opacity"
                >
                  <Camera className="h-8 w-8 text-white" />
                </button>
              </div>

              {/* Verified badge */}
              <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 ring-4 ring-indigo-700 grid place-items-center shadow-lg">
                <CheckCircle2 className="h-4 w-4 text-white" />
              </span>

              {/* Avatar remove tugmasi */}
              {avatarUrl && (
                <button
                  onClick={onAvatarRemove}
                  className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-rose-500 ring-2 ring-indigo-700 grid place-items-center shadow-lg hover:bg-rose-600 transition-colors"
                  title="Rasmni olib tashlash"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onAvatarUpload(f);
                  e.target.value = '';
                }}
              />
            </div>

            {/* Identity */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-2 text-white/80 text-[11px] uppercase tracking-[0.2em] font-bold">
                <Sparkles className="h-3 w-3" />
                {t('myAccount')}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-400/20 ring-1 ring-emerald-300/40 text-emerald-200 text-[9px]">
                  <span className="w-1 h-1 rounded-full bg-emerald-300 animate-pulse" />
                  {t('sessionActive')}
                </span>
              </div>

              <div className="text-4xl lg:text-5xl font-black tracking-tight truncate bg-gradient-to-r from-white via-indigo-100 to-white bg-clip-text text-transparent">
                {user?.fullName || user?.email || '—'}
              </div>

              <div className="text-white/85 mt-2 text-sm truncate flex items-center gap-2">
                <Mail className="h-3.5 w-3.5" />
                {user?.email}
              </div>

              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <span className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shadow-lg',
                  isSuper
                    ? 'bg-gradient-to-r from-amber-300 to-rose-400 text-rose-900 ring-1 ring-white/30'
                    : 'bg-white/15 backdrop-blur-sm ring-1 ring-white/20 text-white',
                )}>
                  {isSuper ? <Crown className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  {user?.roleLabel || user?.role || '—'}
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm ring-1 ring-white/15 text-xs font-semibold text-white">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                  {t('verified')}
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm ring-1 ring-white/15 text-xs font-semibold text-white">
                  <Activity className="h-3.5 w-3.5" />
                  {t('activeAccount')}
                </span>
              </div>
            </div>

            {/* Power level */}
            <div className="shrink-0 hidden md:block">
              <div className={cn('relative p-1 rounded-2xl bg-gradient-to-br shadow-2xl', powerColor)}>
                <div className="px-5 py-3 rounded-xl bg-indigo-950/40 backdrop-blur-sm text-center min-w-[160px]">
                  <div className="text-[9px] uppercase tracking-[0.2em] font-bold text-white/70 mb-1 flex items-center justify-center gap-1">
                    <Zap className="h-3 w-3" />
                    {t('powerLevel')}
                  </div>
                  <div className="text-2xl font-black tracking-tight text-white">{t(powerKey)}</div>
                  <div className="mt-1.5 h-1 rounded-full bg-white/20 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full bg-gradient-to-r', powerColor)}
                      style={{ width: `${Math.min(100, isSuper ? 100 : (actionCount / 22) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
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
          : 'text-slate-600 hover:text-slate-900 hover:bg-white',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* ═══════════════════ OVERVIEW TAB ═══════════════════ */

function OverviewTab({ user, permissions, grouped, moduleCount, actionCount, t, tNav }: any) {
  return (
    <div className="space-y-6">
      {/* STAT STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<KeyRound className="h-4 w-4" />}
          gradient="from-indigo-500 to-violet-600"
          label={t('accessLevel')}
          value={String(actionCount)}
          suffix={t('permissionsCount')}
        />
        <StatCard
          icon={<Layers className="h-4 w-4" />}
          gradient="from-emerald-500 to-teal-600"
          label={t('modules')}
          value={String(moduleCount)}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          gradient="from-amber-500 to-orange-600"
          label={t('lastLogin')}
          value={user?.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}
          small
        />
        <StatCard
          icon={<Hash className="h-4 w-4" />}
          gradient="from-slate-500 to-slate-700"
          label={t('userId')}
          value={user?.id ? user.id.slice(0, 10) + '…' : '—'}
          mono
          small
        />
      </div>

      {/* PERMISSIONS */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="bg-gradient-to-br from-slate-50 to-white px-6 py-5 border-b border-slate-100">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1 text-slate-500">
                <KeyRound className="h-3.5 w-3.5" />
                <span className="text-[10px] uppercase tracking-[0.15em] font-bold">{t('permissions')}</span>
              </div>
              <div className="text-xl font-bold tracking-tight text-slate-800">{t('permissionsTitle')}</div>
              <div className="text-xs text-slate-500 mt-0.5">{t('permissionsSubtitle')}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-3xl font-black tracking-tight bg-gradient-to-br from-indigo-600 to-violet-600 bg-clip-text text-transparent leading-none">
                  {moduleCount}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mt-1">{t('modules')}</div>
              </div>
              <div className="w-px h-10 bg-slate-200" />
              <div className="text-right">
                <div className="text-3xl font-black tracking-tight bg-gradient-to-br from-emerald-600 to-teal-600 bg-clip-text text-transparent leading-none">
                  {actionCount}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mt-1">{t('totalActions')}</div>
              </div>
            </div>
          </div>
        </div>

        <CardContent className="p-6">
          {permissions.length === 0 ? (
            <div className="text-center py-10 text-sm text-slate-500">{t('noPermissions')}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {Object.entries(grouped).map(([resource, actions]: any) => {
                const meta = PERM_GROUP_META[resource] || FALLBACK_META;
                let label = resource;
                try { if (meta.navKey) label = tNav(meta.navKey); } catch { /* */ }
                return (
                  <div
                    key={resource}
                    className="group relative rounded-2xl bg-white ring-1 ring-slate-200 hover:ring-indigo-300 hover:-translate-y-0.5 hover:shadow-xl transition-all overflow-hidden"
                  >
                    <div className={cn('h-1 bg-gradient-to-r', meta.from, meta.to)} />
                    <div className={cn(
                      'absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-[0.04] transition-opacity pointer-events-none',
                      meta.from, meta.to,
                    )} />
                    <div className="relative p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className={cn(
                          'w-10 h-10 rounded-xl bg-gradient-to-br grid place-items-center text-white shadow-md',
                          meta.from, meta.to,
                        )}>
                          <Shield className="h-5 w-5" />
                        </div>
                        <span className={cn(
                          'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1',
                          meta.chip,
                        )}>
                          {actions.length}×
                        </span>
                      </div>
                      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-0.5">{resource}</div>
                      <div className="text-base font-bold text-slate-800 mb-3 truncate">{label}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {actions.map((a: string) => {
                          const k = ACTION_KEY[a];
                          let actionLabel = a;
                          try { if (k) actionLabel = t(k); } catch { /* */ }
                          return (
                            <span
                              key={a}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-50 text-slate-700 text-[10px] font-semibold ring-1 ring-slate-200"
                            >
                              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
                              {actionLabel}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ═══════════════════ ACTIVITY TAB ═══════════════════ */

function ActivityTab({ user, t }: any) {
  // Hozircha sintetik tarix — keyin backend log'lariga ulanadi
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
    <div className="space-y-6">
      {/* CURRENT SESSION */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-emerald-500 to-teal-600" />
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shadow-md">
              <Wifi className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-800">Joriy sessiya</div>
              <div className="text-xs text-slate-500">Hozir tizimda faolsiz</div>
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold ring-1 ring-emerald-200">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
                <span className="relative rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Online
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <InfoTile icon={<Monitor className="h-4 w-4" />} label="Qurilma" value="Windows" />
            <InfoTile icon={<Globe className="h-4 w-4" />} label="Brauzer" value="Chrome" />
            <InfoTile icon={<MapPin className="h-4 w-4" />} label="Joylashuv" value="Toshkent" />
            <InfoTile icon={<Calendar className="h-4 w-4" />} label="Kirgan vaqt" value={formatDateTime(sessions[0].time)} small />
          </div>
        </CardContent>
      </Card>

      {/* LOGIN HISTORY */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="bg-gradient-to-br from-slate-50 to-white px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-md">
              <History className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-800">Kirish tarixi</div>
              <div className="text-xs text-slate-500">Tizimga oxirgi marta qachon kirilgan</div>
            </div>
          </div>
        </div>
        <CardContent className="p-0">
          <div className="divide-y divide-slate-100">
            {sessions.map((s) => (
              <div key={s.id} className="px-6 py-4 flex items-center gap-4 hover:bg-slate-50/60 transition-colors">
                <div className={cn(
                  "w-10 h-10 rounded-xl grid place-items-center shrink-0",
                  s.current
                    ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md"
                    : "bg-slate-100 text-slate-500",
                )}>
                  <LogIn className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-slate-800 flex items-center gap-2">
                    {s.device}
                    {s.current && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold bg-emerald-100 text-emerald-700">
                        Joriy
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-3">
                    <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> {s.ip}</span>
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {s.location}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold text-slate-700">{formatDateTime(s.time)}</div>
                  <div className="text-[10px] text-slate-400">{s.browser}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-6 py-3 bg-slate-50/60 border-t border-slate-100 text-center text-[11px] text-slate-500">
            <Sparkles className="inline h-3 w-3 mr-1" />
            To'liq audit tarix backendga ulangach ko'rinadi
          </div>
        </CardContent>
      </Card>

      {/* CREATED INFO */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-600" />
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white shadow-md">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-800">Hisob ma'lumotlari</div>
              <div className="text-xs text-slate-500">Yaratilgan va o'zgartirish tarixi</div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <InfoTile icon={<Hash className="h-4 w-4" />} label="ID" value={user?.id?.slice(0, 14) + '…' || '—'} mono small />
            <InfoTile icon={<Mail className="h-4 w-4" />} label="Email" value={user?.email || '—'} small />
            <InfoTile icon={<Calendar className="h-4 w-4" />} label="Yaratilgan" value={user?.createdAt ? formatDateTime(user.createdAt) : '—'} small />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ═══════════════════ SECURITY TAB ═══════════════════ */

function SecurityTab({ t }: any) {
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  const strength = newPw.length >= 12 ? 'strong' : newPw.length >= 8 ? 'medium' : newPw.length >= 4 ? 'weak' : 'none';
  const strengthColor = { none: 'bg-slate-200', weak: 'bg-rose-500', medium: 'bg-amber-500', strong: 'bg-emerald-500' }[strength];
  const strengthWidth = { none: '0%', weak: '33%', medium: '66%', strong: '100%' }[strength];

  return (
    <div className="space-y-6">
      {/* PASSWORD CHANGE */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-600" />
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white shadow-md">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-800">Parolni o'zgartirish</div>
              <div className="text-xs text-slate-500">Kuchli parol ishlatish tavsiya etiladi (12+ belgi)</div>
            </div>
          </div>

          <div className="space-y-4 max-w-lg">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Joriy parol</label>
              <div className="relative">
                <Input
                  type={showOld ? 'text' : 'password'}
                  value={oldPw}
                  onChange={(e) => setOldPw(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowOld(!showOld)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  {showOld ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Yangi parol</label>
              <div className="relative">
                <Input
                  type={showNew ? 'text' : 'password'}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {newPw && (
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className={cn("h-full transition-all duration-300", strengthColor)} style={{ width: strengthWidth }} />
                  </div>
                  <div className="text-[10px] text-slate-500 flex items-center justify-between">
                    <span>Parol kuchi: <span className={cn(
                      "font-bold",
                      strength === 'strong' && 'text-emerald-700',
                      strength === 'medium' && 'text-amber-700',
                      strength === 'weak' && 'text-rose-700',
                    )}>{strength === 'strong' ? 'Kuchli' : strength === 'medium' ? 'O\'rtacha' : strength === 'weak' ? 'Zaif' : '—'}</span></span>
                    <span>{newPw.length} belgi</span>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">Yangi parolni tasdiqlash</label>
              <Input
                type={showNew ? 'text' : 'password'}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="••••••••"
              />
              {confirmPw && newPw !== confirmPw && (
                <div className="text-[10px] text-rose-600 mt-1">Parollar mos kelmaydi</div>
              )}
            </div>

            <Button
              onClick={() => toast.info('Parol o\'zgartirish backendga ulanmagan')}
              disabled={!oldPw || !newPw || newPw !== confirmPw || newPw.length < 4}
              className="bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
            >
              <Lock className="h-4 w-4 mr-1.5" />
              Parolni o'zgartirish
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* SECURITY TIPS */}
      <div className="grid md:grid-cols-2 gap-4">
        <SecurityTip
          icon={<Lock />}
          gradient="from-emerald-500 to-teal-600"
          title="Xavfsiz parol"
          body="12+ belgi, katta/kichik harf, raqam va maxsus belgi ishlating"
        />
        <SecurityTip
          icon={<Shield />}
          gradient="from-indigo-500 to-violet-600"
          title="Begona qurilmalardan chiqing"
          body="Boshqa qurilmada login bo'lsangiz, ishingiz tugagach albatta chiqing"
        />
      </div>
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
          <div className="text-sm font-bold tracking-tight text-slate-800">{title}</div>
          <div className="text-[12px] text-slate-600 mt-1 leading-relaxed">{body}</div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════ SETTINGS TAB ═══════════════════ */

function SettingsTab({ t }: any) {
  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-slate-500 to-slate-700" />
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 grid place-items-center text-white shadow-md">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-800">Interfeys sozlamalari</div>
              <div className="text-xs text-slate-500">Tema, til va boshqa shaxsiy sozlamalar</div>
            </div>
          </div>

          <div className="space-y-3">
            <SettingRow
              icon={<Palette className="h-4 w-4" />}
              title="Tema"
              description="Yorug' / Tungi rejim"
              value="Yorug'"
            />
            <SettingRow
              icon={<Globe className="h-4 w-4" />}
              title="Til"
              description="Interfeys tili"
              value="O'zbek"
            />
            <SettingRow
              icon={<Bell className="h-4 w-4" />}
              title="Bildirishnomalar"
              description="Push va email bildirishnomalari"
              value="Yoqilgan"
            />
          </div>

          <div className="mt-4 p-3 rounded-xl bg-amber-50 ring-1 ring-amber-200 text-[12px] text-amber-800 flex items-start gap-2">
            <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <div>
              Bu bo'lim hali sozlash uchun tayyorlanmoqda. Tema/til o'zgartirish keyingi versiyalarda mavjud bo'ladi.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingRow({ icon, title, description, value }: any) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
      <div className="w-8 h-8 rounded-lg bg-white ring-1 ring-slate-200 grid place-items-center text-slate-600 shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-slate-800">{title}</div>
        <div className="text-[11px] text-slate-500">{description}</div>
      </div>
      <div className="text-[12px] font-semibold text-slate-700">{value}</div>
      <ChevronRight className="h-4 w-4 text-slate-400" />
    </div>
  );
}

/* ═══════════════════ HELPERS ═══════════════════ */

function InfoTile({ icon, label, value, mono, small }: any) {
  return (
    <div className="p-3 rounded-xl bg-slate-50 ring-1 ring-slate-100">
      <div className="flex items-center gap-2 text-slate-500 mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-bold">{label}</span>
      </div>
      <div className={cn(
        "font-bold text-slate-800 truncate",
        small ? "text-[12px]" : "text-base",
        mono && "font-mono",
      )} title={value}>
        {value}
      </div>
    </div>
  );
}

function StatCard({ icon, gradient, label, value, suffix, mono, small }: any) {
  return (
    <Card className="border-0 shadow-soft overflow-hidden group hover:shadow-lg transition-shadow">
      <div className={cn('h-1 bg-gradient-to-r', gradient)} />
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={cn('w-8 h-8 rounded-xl bg-gradient-to-br grid place-items-center text-white shadow-md group-hover:scale-110 transition-transform', gradient)}>
            {icon}
          </div>
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 truncate">{label}</div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <div
            className={cn(
              'font-black text-slate-800 truncate',
              small ? 'text-base' : 'text-2xl',
              mono && 'font-mono',
            )}
            title={value}
          >
            {value}
          </div>
          {suffix && (
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{suffix}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
