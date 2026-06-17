'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  UserCircle, LogOut, ChevronDown, Bell, AlertCircle, CheckCircle2, ChevronRight, Menu,
  Rocket, Loader2, Sparkles,
} from 'lucide-react';
import { useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useUI } from '@/lib/ui';
import { useAvatar } from '@/lib/use-avatar';
import { PERMS } from '@/lib/permissions';
import { api } from '@/lib/api';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { LanguageSwitcher } from './language-switcher';
import { cn } from '@/lib/utils';

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Topbar({ title, subtitle, actions }: TopbarProps) {
  const t = useTranslations('nav');
  const tb = useTranslations('topbar');
  const tn = useTranslations('notifications');
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const toggleMobileNav = useUI((s) => s.toggleMobileNav);
  const initial = (user?.fullName || user?.email || '?').charAt(0).toUpperCase();
  // Reaktiv avatar — profilda yuklanganda darrov yangilanadi
  const avatarUrl = useAvatar(user?.id);

  const canSeeSync = !!user?.permissions?.includes(PERMS.SYNC_VIEW);
  const { data: syncLogs } = useQuery({
    queryKey: ['topbar-sync-failures'],
    queryFn: () => api.get<{ items: any[] }>('/sync/logs?limit=20'),
    refetchInterval: 30_000,
    enabled: canSeeSync,
  });
  const failures = (syncLogs?.items || []).filter((l) => l.status === 'FAILED').slice(0, 5);

  // Deploy holati — bell ichida ko'rsatish uchun
  const { data: deployStatus } = useQuery({
    queryKey: ['deploy-status'],
    queryFn: () => api.get<{
      state: 'idle' | 'running' | 'success' | 'failed';
      currentCommit?: string;
      progressPercent?: number | null;
      currentPhase?: string | null;
      elapsedSeconds?: number;
    }>('/_deploy/status'),
    refetchInterval: 3_000,
  });
  const initialDeployCommitRef = useRef<string | null>(null);
  if (deployStatus?.currentCommit && initialDeployCommitRef.current === null) {
    initialDeployCommitRef.current = deployStatus.currentCommit;
  }
  const hasDeployRunning = deployStatus?.state === 'running';
  const hasNewDeployVersion =
    deployStatus?.state === 'success' &&
    !!deployStatus.currentCommit &&
    !!initialDeployCommitRef.current &&
    initialDeployCommitRef.current !== deployStatus.currentCommit;
  const hasDeployFailed = deployStatus?.state === 'failed';
  const hasDeployBadge = hasDeployRunning || hasNewDeployVersion || hasDeployFailed;

  const notifCount = failures.length + (hasDeployBadge ? 1 : 0);

  const openDeployModal = () => {
    window.dispatchEvent(new CustomEvent('open-deploy-modal'));
  };

  return (
    <header className="sticky top-0 z-20">
      <div className="relative overflow-hidden bg-brand-vivid animate-gradient">
        <div className="absolute inset-0 bg-dots opacity-15 pointer-events-none" />
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/15 blur-3xl pointer-events-none animate-float-slow" />

        <div className="relative flex h-20 items-center justify-between px-4 sm:px-6 lg:px-8 text-white gap-3 sm:gap-4">
          {/* Mobil hamburger tugmasi — faqat lg dan kichik ekranlarda */}
          <button
            onClick={toggleMobileNav}
            className="lg:hidden w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm grid place-items-center text-white transition-colors shrink-0"
            aria-label="Menyu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight truncate">{title}</h1>
            {subtitle && <p className="text-[11px] sm:text-[13px] text-white/85 truncate mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actions}

            {/* Bildirishnomalar — bell ichida sync xatolari + deploy holati */}
            {(canSeeSync || hasDeployBadge) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={tn('title')}
                    className="relative w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm grid place-items-center text-white transition-colors"
                  >
                    <Bell className="h-[18px] w-[18px]" />
                    {notifCount > 0 && (
                      <span className={cn(
                        'absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full text-white text-[9px] font-bold grid place-items-center px-1 ring-2 ring-indigo-600',
                        hasDeployRunning && failures.length === 0 ? 'bg-indigo-500' : 'bg-rose-500',
                      )}>
                        {notifCount > 9 ? '9+' : notifCount}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                    <span>{tn('title')}</span>
                    {failures.length > 0 && <span className="text-rose-600">{tn('errorsCount', { count: failures.length })}</span>}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />

                  {/* DEPLOY status item (eng yuqorida, agar aktiv bo'lsa) */}
                  {hasDeployBadge && deployStatus && (
                    <>
                      <DropdownMenuItem
                        onClick={openDeployModal}
                        className="px-3 py-2.5 cursor-pointer"
                      >
                        <div className="flex items-start gap-2 w-full">
                          <div className={cn(
                            'w-8 h-8 rounded-xl grid place-items-center shrink-0 ring-1',
                            hasDeployRunning   && 'bg-gradient-to-br from-indigo-500 to-violet-600 ring-indigo-200',
                            hasNewDeployVersion && 'bg-gradient-to-br from-emerald-500 to-teal-600 ring-emerald-200',
                            hasDeployFailed    && 'bg-gradient-to-br from-rose-500 to-red-600 ring-rose-200',
                          )}>
                            {hasDeployRunning   && <Loader2 className="h-4 w-4 text-white animate-spin" />}
                            {hasNewDeployVersion && <Sparkles className="h-4 w-4 text-white" />}
                            {hasDeployFailed    && <AlertCircle className="h-4 w-4 text-white" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                              {hasDeployRunning && (
                                <>
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  Tizim yangilanmoqda
                                </>
                              )}
                              {hasNewDeployVersion && 'Yangi versiya tayyor'}
                              {hasDeployFailed    && 'Deploy muvaffaqiyatsiz'}
                            </div>
                            <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                              {hasDeployRunning && (
                                <span className="flex items-center gap-1">
                                  <span className="tabular-nums font-semibold text-indigo-600 dark:text-indigo-400">{deployStatus.progressPercent ?? 0}%</span>
                                  <span className="text-slate-300 dark:text-slate-600">·</span>
                                  <span>{deployStatus.elapsedSeconds ?? 0}s</span>
                                  {deployStatus.currentPhase && (
                                    <>
                                      <span className="text-slate-300 dark:text-slate-600">·</span>
                                      <span className="truncate">{deployStatus.currentPhase}</span>
                                    </>
                                  )}
                                </span>
                              )}
                              {hasNewDeployVersion && (
                                <span>Sahifani yangilang — yangi imkoniyatlar tayyor</span>
                              )}
                              {hasDeployFailed && (
                                <span className="text-rose-600">Batafsil ko'rish uchun bosing</span>
                              )}
                            </div>
                            {/* Mini progress bar */}
                            {hasDeployRunning && (
                              <div className="mt-1.5 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-1000"
                                  style={{ width: `${deployStatus.progressPercent ?? 1}%` }}
                                />
                              </div>
                            )}
                          </div>
                          <Rocket className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 shrink-0" />
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}

                  {/* Sync xatolari */}
                  {canSeeSync && failures.length === 0 && !hasDeployBadge && (
                    <div className="px-3 py-6 text-center">
                      <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/40 grid place-items-center mx-auto mb-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{tn('allGood')}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{tn('noErrors')}</div>
                    </div>
                  )}
                  {canSeeSync && failures.length > 0 && (
                    <div className="max-h-72 overflow-y-auto">
                      {failures.map((l) => (
                        <DropdownMenuItem
                          key={l.id}
                          onClick={() => router.push(`/${locale}/admin/sync-logs`)}
                          className="px-3 py-2 cursor-pointer"
                        >
                          <div className="flex items-start gap-2 w-full">
                            <div className="w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-950/40 grid place-items-center shrink-0">
                              <AlertCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">{tn('syncError')}</div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">{l.errorMessage || l.source}</div>
                              <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 tabular-nums">{new Date(l.startedAt).toLocaleString('uz-UZ', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</div>
                            </div>
                          </div>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => router.push(`/${locale}/admin/sync-logs`)}
                        className="justify-center text-indigo-600 font-medium cursor-pointer"
                      >
                        {tn('viewAll')}
                        <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </DropdownMenuItem>
                    </div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Til — faqat ikonka */}
            <LanguageSwitcher compact />

            {/* Foydalanuvchi dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm transition-colors group">
                  <span className="relative w-9 h-9 rounded-full bg-gradient-to-br from-white/40 to-white/10 ring-1 ring-white/50 grid place-items-center text-white text-sm font-bold shadow-sm overflow-hidden">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      initial
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-indigo-600 z-10" />
                  </span>
                  <div className="hidden sm:block min-w-0 text-left">
                    <div className="text-[12px] font-semibold truncate max-w-[180px]">{user?.fullName || user?.email || '—'}</div>
                    <div className="text-[10px] text-white/80 truncate">{user?.roleLabel || user?.role || '—'}</div>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-white/70 group-hover:text-white transition-colors" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-[13px] font-semibold truncate">{user?.fullName || '—'}</div>
                  <div className="text-[11px] text-slate-500 truncate font-normal">{user?.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push(`/${locale}/profile`)} className="cursor-pointer">
                  <UserCircle className="h-4 w-4 mr-2" /> {tb('myProfile')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-rose-600 cursor-pointer" onClick={logout}>
                  <LogOut className="h-4 w-4 mr-2" /> {t('logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
