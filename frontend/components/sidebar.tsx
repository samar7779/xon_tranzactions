'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Wallet, KeyRound, Building2,
  History, Users, LogOut, ShieldCheck, BadgeDollarSign,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { Button } from './ui/button';
import { BrandLogo } from './brand-logo';

interface NavItem {
  href: string;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  group?: string;
}

const NAV: NavItem[] = [
  { href: '/dashboard',    key: 'dashboard',    icon: LayoutDashboard,  group: 'main',  permission: PERMS.DASHBOARD_VIEW },
  { href: '/accounts',     key: 'accounts',     icon: Wallet,           group: 'main',  permission: PERMS.ACCOUNTS_VIEW },
  { href: '/transactions', key: 'transactions', icon: BadgeDollarSign,  group: 'main',  permission: PERMS.TRANSACTIONS_VIEW },

  { href: '/banks',        key: 'banks',        icon: Building2,        group: 'setup', permission: PERMS.BANKS_VIEW },
  { href: '/credentials',  key: 'credentials',  icon: KeyRound,         group: 'setup', permission: PERMS.CREDENTIALS_VIEW },

  { href: '/sync-logs',    key: 'syncLogs',     icon: History,          group: 'system', permission: PERMS.SYNC_VIEW },
  { href: '/admin-users',  key: 'adminUsers',   icon: Users,            group: 'system', permission: PERMS.USERS_VIEW },
  { href: '/roles',        key: 'roles',        icon: ShieldCheck,      group: 'system', permission: PERMS.ROLES_VIEW },
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
  const { locale } = useParams<{ locale: string }>();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  const can = (perm?: string) => {
    if (!perm) return true;
    if (!user) return false;
    if (user.role === 'SUPERADMIN') return true;
    return user.permissions?.includes(perm) ?? false;
  };

  const visibleItems = NAV.filter((n) => can(n.permission));
  const groups = Array.from(new Set(visibleItems.map((i) => i.group || 'main')));

  return (
    <aside className="hidden lg:flex w-[260px] shrink-0 flex-col bg-white border-r border-slate-200/80 relative">
      {/* Brand */}
      <div className="px-6 py-6">
        <Link href={`/${locale}/dashboard`} className="flex items-center gap-3 group">
          <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 grid place-items-center shadow-lg shadow-indigo-500/20">
            <BrandLogo className="w-6 h-6" />
            <span className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-indigo-400 to-blue-500 blur-md opacity-30 group-hover:opacity-50 transition-opacity -z-10" />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight truncate">{tApp('title')}</div>
            <div className="text-[11px] text-slate-500 truncate">Xon Saroy treasury</div>
          </div>
        </Link>
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

      {/* User card */}
      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-slate-50/50">
          <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white text-sm font-semibold shrink-0 shadow-md shadow-indigo-500/20">
            {(user?.fullName || user?.email || '?').charAt(0).toUpperCase()}
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold truncate">{user?.fullName || user?.email}</div>
            <div className="text-[10px] text-slate-500 truncate">{user?.roleLabel || user?.role}</div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 mt-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-50"
          onClick={logout}
        >
          <LogOut className="h-4 w-4" />
          {t('logout')}
        </Button>
      </div>
    </aside>
  );
}
