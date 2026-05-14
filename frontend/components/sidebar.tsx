'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Building2,
  LogOut, ShieldCheck, BadgeDollarSign,
  Bell, ChevronUp, UserCircle, Settings, ChevronRight,
  AlertCircle, CheckCircle2, FileSpreadsheet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { api } from '@/lib/api';
import { Button } from './ui/button';
import { BrandLogo } from './brand-logo';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from './ui/dropdown-menu';

interface NavItem {
  href: string;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  group?: string;
}

const NAV: NavItem[] = [
  { href: '/dashboard',    key: 'dashboard',    icon: LayoutDashboard,  group: 'main',  permission: PERMS.DASHBOARD_VIEW },
  { href: '/transactions', key: 'transactions', icon: BadgeDollarSign,  group: 'main',  permission: PERMS.TRANSACTIONS_VIEW },
  { href: '/statement',    key: 'statement',    icon: FileSpreadsheet,  group: 'main',  permission: PERMS.TRANSACTIONS_VIEW },

  { href: '/setup',        key: 'banks',        icon: Building2,        group: 'setup', permission: PERMS.BANKS_VIEW },

  { href: '/admin',        key: 'adminPanel',   icon: ShieldCheck,      group: 'system', permission: PERMS.USERS_VIEW },
];

const GROUP_LABEL: Record<string, string> = {
  main: 'Asosiy',
  setup: 'Sozlash',
  system: 'Tizim',
};

export function Sidebar() {
  const t = useTranslations('nav');
  const tApp = useTranslations('app');
  const pathname = usePathname();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  const can = (perm?: string) => {
    if (!perm) return true;
    if (!user) return false;
    return user.permissions?.includes(perm) ?? false;
  };

  const visibleItems = NAV.filter((n) => can(n.permission));
  const groups = Array.from(new Set(visibleItems.map((i) => i.group || 'main')));

  // Live notification count: recent sync failures
  const { data: syncLogs } = useQuery({
    queryKey: ['sidebar-sync-failures'],
    queryFn: () => api.get<{ items: any[] }>('/sync/logs?limit=20'),
    refetchInterval: 30_000,
    enabled: can(PERMS.SYNC_VIEW),
  });
  const failures = (syncLogs?.items || []).filter((l) => l.status === 'FAILED').slice(0, 5);
  const notifCount = failures.length;

  return (
    <aside className="hidden lg:flex w-[260px] shrink-0 flex-col bg-white border-r border-slate-200/80 relative">
      {/* Brand */}
      <div className="px-6 pt-6 pb-4">
        <Link href={`/${locale}/dashboard`} className="flex items-center gap-3 group">
          <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 grid place-items-center shadow-lg shadow-indigo-500/20">
            <BrandLogo className="w-6 h-6" />
            <span className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-indigo-400 to-blue-500 blur-md opacity-30 group-hover:opacity-50 transition-opacity -z-10" />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight truncate">{tApp('title')}</div>
            <div className="text-[11px] text-slate-500 truncate">Xon Saroy · treasury</div>
          </div>
        </Link>
      </div>

      {/* Notifications bell */}
      <div className="px-3 mb-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors group">
              <div className="relative">
                <Bell className="h-[18px] w-[18px] text-slate-400 group-hover:text-slate-600 transition-colors" />
                {notifCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] rounded-full bg-rose-500 text-white text-[9px] font-bold grid place-items-center px-1 ring-2 ring-white">
                    {notifCount > 9 ? '9+' : notifCount}
                  </span>
                )}
              </div>
              <span className="text-sm font-medium flex-1 text-left">Bildirishnomalar</span>
              {notifCount > 0 && (
                <span className="text-[10px] text-rose-600 font-bold">{notifCount} yangi</span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="w-80">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-500 flex items-center justify-between">
              <span>Bildirishnomalar</span>
              {notifCount > 0 && <span className="text-rose-600">{notifCount} ta xato</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {failures.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-50 grid place-items-center mx-auto mb-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="text-xs font-medium text-slate-700">Hammasi joyida</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Hech qanday xato yo'q</div>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {failures.map((l) => (
                  <DropdownMenuItem
                    key={l.id}
                    onClick={() => router.push(`/${locale}/admin/sync-logs`)}
                    className="px-3 py-2 cursor-pointer"
                  >
                    <div className="flex items-start gap-2 w-full">
                      <div className="w-7 h-7 rounded-lg bg-rose-50 grid place-items-center shrink-0">
                        <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold text-slate-700">Sync xato</div>
                        <div className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">{l.errorMessage || l.source}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">{new Date(l.startedAt).toLocaleString('uz-UZ', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</div>
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => router.push(`/${locale}/admin/sync-logs`)}
                  className="justify-center text-indigo-600 font-medium cursor-pointer"
                >
                  Barchasini ko'rish
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </DropdownMenuItem>
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pb-4 space-y-5 overflow-y-auto">
        {groups.map((g) => {
          const items = visibleItems.filter((i) => (i.group || 'main') === g);
          if (items.length === 0) return null;
          return (
            <div key={g}>
              <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase text-slate-400">
                {GROUP_LABEL[g] || g}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const href = `/${locale}${item.href}`;
                  const active = pathname === href || pathname.startsWith(href + '/');
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={href}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all',
                        active
                          ? 'bg-gradient-to-r from-indigo-50 to-blue-50 text-indigo-700 shadow-sm ring-1 ring-indigo-100'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                      )}
                    >
                      <Icon className={cn('h-[18px] w-[18px] shrink-0 transition-colors', active ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600')} />
                      <span className="truncate">{t(item.key)}</span>
                      {active && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User dropdown */}
      <div className="border-t border-slate-100 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 px-2 py-2 rounded-xl bg-slate-50/50 hover:bg-slate-100 transition-colors group">
              <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white text-sm font-semibold shrink-0 shadow-md shadow-indigo-500/20">
                {(user?.fullName || user?.email || '?').charAt(0).toUpperCase()}
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white">
                  <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
                </span>
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-[13px] font-semibold truncate">{user?.fullName || user?.email}</div>
                <div className="text-[10px] text-slate-500 truncate">{user?.roleLabel || user?.role}</div>
              </div>
              <ChevronUp className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <div className="text-[13px] font-semibold truncate">{user?.fullName || '—'}</div>
              <div className="text-[11px] text-slate-500 truncate font-normal">{user?.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <UserCircle className="h-4 w-4 mr-2" /> Profilim
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="h-4 w-4 mr-2" /> Sozlamalar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-rose-600" onClick={logout}>
              <LogOut className="h-4 w-4 mr-2" /> {t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
