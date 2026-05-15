'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Building2, ShieldCheck, BadgeDollarSign,
  FileSpreadsheet, Scale, BookUser,
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
  { href: '/statement',    key: 'statement',    icon: FileSpreadsheet,  group: 'main',  permission: PERMS.TRANSACTIONS_VIEW },
  { href: '/check',        key: 'check',        icon: Scale,           group: 'main',  permission: PERMS.TRANSACTIONS_VIEW },
  { href: '/crm',          key: 'crm',          icon: BookUser,        group: 'main',  permission: PERMS.CRM_VIEW },

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
  const tApp = useTranslations('app');
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
          {/* Monogram tile */}
          <span className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-blue-600 grid place-items-center text-white shadow-lg shadow-indigo-500/30 group-hover:shadow-indigo-500/50 transition-shadow overflow-hidden shrink-0">
            {/* Inner glossy overlay */}
            <span className="absolute inset-0 bg-gradient-to-b from-white/25 to-transparent" />
            {/* Crossing arrows monogram — in/out flow */}
            <svg viewBox="0 0 32 32" className="relative w-6 h-6" aria-hidden>
              <path d="M11 7 V21 M6 16 L11 21 L16 16"
                stroke="#a7f3d0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d="M21 25 V11 M16 16 L21 11 L26 16"
                stroke="#fda4af" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            {/* Pulsing dot */}
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white grid place-items-center">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
            </span>
          </span>

          {/* Wordmark */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1">
              <span className="text-[17px] font-black tracking-tight bg-gradient-to-br from-slate-900 via-indigo-700 to-violet-700 bg-clip-text text-transparent leading-none">
                XON
              </span>
              <span className="text-[12px] font-bold text-slate-400 tracking-tight leading-none">
                TX
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-block w-1 h-1 rounded-full bg-indigo-500" />
              <span className="text-[9px] font-bold tracking-[0.18em] uppercase text-slate-500">
                {tApp('title').replace(/Xon\s*/i, '').trim() || 'Treasury'}
              </span>
            </div>
          </div>
        </div>

        {/* Animated underline accent */}
        <span className="absolute left-5 right-5 bottom-0 h-px bg-gradient-to-r from-transparent via-indigo-300/60 to-transparent" />
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
