'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Receipt, Wallet, KeyRound, Building2,
  History, Users, LogOut, ShieldCheck,
  UserCircle, FileText, BadgeDollarSign,
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
  { href: '/dashboard',    key: 'dashboard',    icon: LayoutDashboard,  group: 'main',    permission: PERMS.DASHBOARD_VIEW },

  // Billing — asosiy biznes oqim
  { href: '/customers',    key: 'customers',    icon: UserCircle,       group: 'billing', permission: PERMS.CUSTOMERS_VIEW },
  { href: '/contracts',    key: 'contracts',    icon: FileText,         group: 'billing', permission: PERMS.CONTRACTS_VIEW },
  { href: '/transactions', key: 'transactions', icon: BadgeDollarSign,  group: 'billing', permission: PERMS.TRANSACTIONS_VIEW },

  // Banklar
  { href: '/accounts',     key: 'accounts',     icon: Wallet,           group: 'data',    permission: PERMS.ACCOUNTS_VIEW },
  { href: '/credentials',  key: 'credentials',  icon: KeyRound,         group: 'data',    permission: PERMS.CREDENTIALS_VIEW },
  { href: '/banks',        key: 'banks',        icon: Building2,        group: 'data',    permission: PERMS.BANKS_VIEW },

  // Tizim
  { href: '/sync-logs',    key: 'syncLogs',     icon: History,          group: 'system',  permission: PERMS.SYNC_VIEW },
  { href: '/admin-users',  key: 'adminUsers',   icon: Users,            group: 'system',  permission: PERMS.USERS_VIEW },
  { href: '/roles',        key: 'roles',        icon: ShieldCheck,      group: 'system',  permission: PERMS.ROLES_VIEW },
];

const GROUP_LABEL: Record<string, string> = {
  main: 'Asosiy',
  billing: 'Billing',
  data: 'Banklar',
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
    <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-card border-r relative">
      <div className="px-5 py-5 border-b">
        <Link href={`/${locale}/dashboard`} className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-700 grid place-items-center shadow-sm ring-1 ring-indigo-500/30">
            <BrandLogo className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight truncate">{tApp('title')}</div>
            <div className="text-[11px] text-muted-foreground truncate">Xon Saroy</div>
          </div>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        {groups.map((g) => {
          const items = visibleItems.filter((i) => (i.group || 'main') === g);
          if (items.length === 0) return null;
          return (
            <div key={g}>
              <div className="px-3 mb-1.5 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground/70">
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
                        'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
                      )}
                      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
                      <span className="truncate">{t(item.key)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white text-sm font-semibold shrink-0">
            {(user?.fullName || user?.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{user?.fullName || user?.email}</div>
            <div className="text-[11px] text-muted-foreground truncate">{user?.roleLabel || user?.role}</div>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 mt-1 text-muted-foreground hover:text-foreground" onClick={logout}>
          <LogOut className="h-4 w-4" />
          {t('logout')}
        </Button>
      </div>
    </aside>
  );
}
