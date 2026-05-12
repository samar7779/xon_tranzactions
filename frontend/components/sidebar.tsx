'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Receipt, Wallet, KeyRound, Building2,
  History, Users, Settings, LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { Button } from './ui/button';

interface NavItem {
  href: string;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  superAdminOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: '/dashboard', key: 'dashboard', icon: LayoutDashboard },
  { href: '/transactions', key: 'transactions', icon: Receipt },
  { href: '/accounts', key: 'accounts', icon: Wallet },
  { href: '/credentials', key: 'credentials', icon: KeyRound },
  { href: '/banks', key: 'banks', icon: Building2 },
  { href: '/sync-logs', key: 'syncLogs', icon: History },
  { href: '/admin-users', key: 'adminUsers', icon: Users, superAdminOnly: true },
];

export function Sidebar() {
  const t = useTranslations('nav');
  const tApp = useTranslations('app');
  const pathname = usePathname();
  const { locale } = useParams<{ locale: string }>();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="px-6 py-5 border-b">
        <div className="text-base font-semibold tracking-tight">{tApp('title')}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{tApp('tagline')}</div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.filter((n) => !n.superAdminOnly || user?.role === 'SUPERADMIN').map((item) => {
          const href = `/${locale}${item.href}`;
          const active = pathname === href || pathname.startsWith(href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {t(item.key)}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <div className="px-3 py-2">
          <div className="text-sm font-medium truncate">{user?.fullName || user?.email}</div>
          <div className="text-xs text-muted-foreground">{user?.role}</div>
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={logout}>
          <LogOut className="h-4 w-4" />
          {t('logout')}
        </Button>
      </div>
    </aside>
  );
}
