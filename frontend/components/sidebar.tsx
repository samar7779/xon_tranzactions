'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Building2, ShieldCheck, BadgeDollarSign, Home, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useUI } from '@/lib/ui';
import { PERMS } from '@/lib/permissions';
import { useEffect } from 'react';

interface NavItem {
  href: string;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Bitta yoki bir nechta permission'lardan birortasi yetarli */
  permissions?: string[];
  group?: string;
}

const ADMIN_PERMS = [
  PERMS.USERS_VIEW,
  PERMS.ROLES_VIEW,
  PERMS.ADMIN_LOGIN_VIEW,
  PERMS.COUNTERPARTIES_VIEW,
  PERMS.SYNC_VIEW,
  PERMS.API_EXPLORER_VIEW,
  PERMS.CLEANUP_VIEW,
  PERMS.IMPORT_VIEW,
];

const NAV: NavItem[] = [
  { href: '/dashboard',    key: 'dashboard',    icon: LayoutDashboard,  group: 'main',  permissions: [PERMS.DASHBOARD_VIEW] },
  { href: '/transactions', key: 'transactions', icon: BadgeDollarSign,  group: 'main',  permissions: [PERMS.TRANSACTIONS_VIEW] },
  // ОплатыКв — CRM + Billing bitta bo'lim, tab bar bilan
  { href: '/oplatykv',     key: 'oplatykv',     icon: Home,             group: 'main',  permissions: [PERMS.CRM_VIEW, PERMS.OPLATAKV_VIEW] },

  { href: '/setup',        key: 'banks',        icon: Building2,        group: 'setup', permissions: [PERMS.BANKS_VIEW, PERMS.ACCOUNTS_VIEW, PERMS.CREDENTIALS_VIEW] },

  // Admin panel — har qanday admin permission'i bo'lsa link ko'rinadi
  { href: '/admin',        key: 'adminPanel',   icon: ShieldCheck,      group: 'system', permissions: ADMIN_PERMS },
];

const GROUP_KEY: Record<string, string> = {
  main: 'groupMain',
  setup: 'groupSetup',
  system: 'groupSystem',
};

function SidebarContent({ onItemClick }: { onItemClick?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { locale } = useParams<{ locale: string }>();
  const user = useAuth((s) => s.user);

  /** Kamida bittasi mavjud bo'lsa true (bir nechta permissions'dan birortasi yetarli) */
  const canAny = (perms?: string[]) => {
    if (!perms || perms.length === 0) return true;
    if (!user) return false;
    return perms.some((p) => user.permissions?.includes(p));
  };

  const visibleItems = NAV.filter((n) => canAny(n.permissions));
  const groups = Array.from(new Set(visibleItems.map((i) => i.group || 'main')));

  return (
    <>
      {/* Brand — premium wordmark */}
      <Link
        href={`/${locale}/dashboard`}
        aria-label={t('home')}
        onClick={onItemClick}
        className="group relative block px-5 pt-6 pb-5 border-b border-slate-100 dark:border-slate-800"
      >
        <div className="relative flex items-center gap-3">
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
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900 grid place-items-center">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-black tracking-[0.05em] uppercase
                            bg-gradient-to-br from-amber-600 via-amber-700 to-amber-800
                            bg-clip-text text-transparent leading-none">
              XON SAROY
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-block w-1 h-1 rounded-full bg-amber-500" />
              <span className="text-[9px] font-bold tracking-[0.22em] uppercase text-slate-500 dark:text-slate-400">
                Transactions
              </span>
            </div>
          </div>
        </div>
        <span className="absolute left-5 right-5 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-300/70 to-transparent" />
      </Link>

      <nav className="flex-1 px-3 pt-4 pb-4 space-y-5 overflow-y-auto">
        {groups.map((g) => {
          const items = visibleItems.filter((i) => (i.group || 'main') === g);
          if (items.length === 0) return null;
          return (
            <div key={g}>
              <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase text-slate-400 dark:text-slate-500">
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
                      onClick={onItemClick}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all',
                        active
                          ? 'bg-gradient-to-r from-indigo-50 to-blue-50 text-indigo-700 shadow-sm ring-1 ring-indigo-100 dark:from-indigo-950/60 dark:to-blue-950/60 dark:text-indigo-300 dark:ring-indigo-900'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                      )}
                    >
                      <Icon className={cn('h-[18px] w-[18px] shrink-0 transition-colors', active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300')} />
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
    </>
  );
}

export function Sidebar() {
  const mobileNavOpen = useUI((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUI((s) => s.setMobileNavOpen);
  const pathname = usePathname();

  // Yo'l o'zgarganda mobil drawer'ni yopish
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  // Drawer ochiq paytda body scroll'ni bloklash
  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileNavOpen]);

  return (
    <>
      {/* Desktop sidebar — lg dan boshlab */}
      <aside className="hidden lg:flex w-[260px] shrink-0 flex-col bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 relative">
        <SidebarContent />
      </aside>

      {/* Mobil overlay backdrop */}
      <div
        className={cn(
          'lg:hidden fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 transition-opacity',
          mobileNavOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />

      {/* Mobil drawer — chap tomondan sirpanib chiqadi */}
      <aside
        className={cn(
          'lg:hidden fixed top-0 left-0 bottom-0 w-[280px] max-w-[85vw] bg-white dark:bg-slate-900 shadow-2xl z-50',
          'flex flex-col transform transition-transform duration-300 ease-out',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Mobile navigation"
      >
        <button
          onClick={() => setMobileNavOpen(false)}
          className="absolute top-3 right-3 w-9 h-9 grid place-items-center rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Yopish"
        >
          <X className="h-5 w-5" />
        </button>
        <SidebarContent onItemClick={() => setMobileNavOpen(false)} />
      </aside>
    </>
  );
}
