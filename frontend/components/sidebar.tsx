'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Building2, ShieldCheck, BadgeDollarSign, BookUser, CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';

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
  { href: '/crm',          key: 'crm',          icon: BookUser,        group: 'main',  permission: PERMS.CRM_VIEW },
  // Biling — XonPay reconciliation (Kapitalbank vs CRM)
  { href: '/biling',       key: 'biling',       icon: CreditCard,       group: 'main',  permission: PERMS.CRM_VIEW },

  { href: '/setup',        key: 'banks',        icon: Building2,        group: 'setup', permission: PERMS.BANKS_VIEW },

  { href: '/admin',        key: 'adminPanel',   icon: ShieldCheck,      group: 'system', permission: PERMS.USERS_VIEW },
];

const GROUP_KEY: Record<string, string> = {
  main: 'groupMain',
  setup: 'groupSetup',
  system: 'groupSystem',
};

export function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { locale } = useParams<{ locale: string }>();
  const user = useAuth((s) => s.user);

  const can = (perm?: string) => {
    if (!perm) return true;
    if (!user) return false;
    return user.permissions?.includes(perm) ?? false;
  };

  const visibleItems = NAV.filter((n) => can(n.permission));
  const groups = Array.from(new Set(visibleItems.map((i) => i.group || 'main')));

  return (
    <aside className="hidden lg:flex w-[260px] shrink-0 flex-col bg-white border-r border-slate-200/80 relative">
      {/* Brand — premium wordmark */}
      <Link
        href={`/${locale}/dashboard`}
        aria-label={t('home')}
        className="group relative block px-5 pt-6 pb-5 border-b border-slate-100"
      >
        <div className="relative flex items-center gap-3">
          {/* XON SAROY logo */}
          <span className="relative w-12 h-12 shrink-0 grid place-items-center">
            <span className="absolute inset-0 bg-amber-400/20 blur-xl rounded-full" />
            <Image
              src="/xon-saroy-logo.png"
              alt="Xon Saroy"
              width={48}
              height={48}
              priority
              className="relative w-full h-full object-contain drop-shadow-[0_2px_8px_rgba(245,158,11,0.35)]"
            />
            {/* Live dot */}
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white grid place-items-center">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
            </span>
          </span>

          {/* Wordmark */}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-black tracking-[0.05em] uppercase
                            bg-gradient-to-br from-amber-600 via-amber-700 to-amber-800
                            bg-clip-text text-transparent leading-none">
              XON SAROY
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-block w-1 h-1 rounded-full bg-amber-500" />
              <span className="text-[9px] font-bold tracking-[0.22em] uppercase text-slate-500">
                Transactions
              </span>
            </div>
          </div>
        </div>

        {/* Animated underline accent */}
        <span className="absolute left-5 right-5 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-300/70 to-transparent" />
      </Link>

      {/* Nav */}
      <nav className="flex-1 px-3 pt-4 pb-4 space-y-5 overflow-y-auto">
        {groups.map((g) => {
          const items = visibleItems.filter((i) => (i.group || 'main') === g);
          if (items.length === 0) return null;
          return (
            <div key={g}>
              <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase text-slate-400">
                {GROUP_KEY[g] ? t(GROUP_KEY[g]) : g}
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
    </aside>
  );
}
