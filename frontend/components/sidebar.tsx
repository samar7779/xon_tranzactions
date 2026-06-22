'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Building2, ShieldCheck, BadgeDollarSign, Home, X, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useUI } from '@/lib/ui';
import { useAvatar } from '@/lib/use-avatar';
import { PERMS } from '@/lib/permissions';
import { useEffect, useRef } from 'react';

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
  PERMS.API_KEYS_VIEW,
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

/** Kartochka ichidagi to'liq tarkib (brand + nav + user) — desktop va mobil uchun umumiy */
function SidebarContent({ onItemClick }: { onItemClick?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { locale } = useParams<{ locale: string }>();
  const user = useAuth((s) => s.user);
  const avatarUrl = useAvatar(user?.id);

  const canAny = (perms?: string[]) => {
    if (!perms || perms.length === 0) return true;
    if (!user) return false;
    return perms.some((p) => user.permissions?.includes(p));
  };

  const visibleItems = NAV.filter((n) => canAny(n.permissions));
  const groups = Array.from(new Set(visibleItems.map((i) => i.group || 'main')));
  const initial = (user?.fullName || user?.email || '?').charAt(0).toUpperCase();

  return (
    <>
      {/* Brand */}
      <Link href={`/${locale}/dashboard`} aria-label={t('home')} onClick={onItemClick} className="sb3d-brand">
        <span className="sb3d-emblem">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2c.34 4.6 1.6 5.86 6.2 6.2-4.6.34-5.86 1.6-6.2 6.2-.34-4.6-1.6-5.86-6.2-6.2 4.6-.34 5.86-1.6 6.2-6.2z" />
          </svg>
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-[#1e1b38] z-10" />
        </span>
        <div className="min-w-0">
          <div className="sb3d-wm">XON SAROY</div>
          <div className="sb3d-sub">Transactions</div>
        </div>
      </Link>

      {/* Navigatsiya */}
      <nav className="sb3d-nav">
        {groups.map((g) => {
          const items = visibleItems.filter((i) => (i.group || 'main') === g);
          if (items.length === 0) return null;
          return (
            <div key={g}>
              <div className="sb3d-navlbl">{GROUP_KEY[g] ? t(GROUP_KEY[g]) : g}</div>
              {items.map((item) => {
                const href = `/${locale}${item.href}`;
                const active = pathname === href || pathname.startsWith(href + '/');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={href}
                    onClick={onItemClick}
                    className={cn('sb3d-item', active && 'act')}
                  >
                    <span className="sb3d-tile"><Icon className="h-[17px] w-[17px]" /></span>
                    <span className="truncate">{t(item.key)}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Foydalanuvchi kartasi */}
      <div className="sb3d-user">
        <div className="sb3d-uav">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            initial
          )}
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-[#1e1b38]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="sb3d-unm truncate">{user?.fullName || user?.email || '—'}</div>
          <div className="sb3d-url truncate">{user?.roleLabel || user?.role || '—'}</div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-violet-300 dark:text-violet-400/60" />
      </div>
    </>
  );
}

export function Sidebar() {
  const mobileNavOpen = useUI((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUI((s) => s.setMobileNavOpen);
  const pathname = usePathname();
  const tc = useTranslations('common');

  // 3D tilt refs
  const cardRef = useRef<HTMLDivElement>(null);
  const sheenRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    if (cardRef.current) cardRef.current.style.transform = `rotateY(${px * 7}deg) rotateX(${-py * 5}deg)`;
    if (sheenRef.current) {
      sheenRef.current.style.backgroundPosition = `${50 + px * 60}% ${50 + py * 60}%`;
      sheenRef.current.style.opacity = '0.45';
    }
  };
  const handleLeave = () => {
    if (cardRef.current) cardRef.current.style.transform = 'rotateY(0deg) rotateX(0deg)';
    if (sheenRef.current) sheenRef.current.style.opacity = '0.2';
  };

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
      {/* Desktop sidebar — 3D interaktiv */}
      <aside
        className="sb3d-scene hidden lg:block w-[288px] shrink-0"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <div ref={cardRef} className="sb3d-card">
          <div className="sb3d-aurora" />
          <div className="sb3d-grain" />
          <div className="sb3d-orb" />
          <div ref={sheenRef} className="sb3d-sheen" />
          <SidebarContent />
        </div>
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

      {/* Mobil drawer — chap tomondan sirpanib chiqadi (tilt'siz) */}
      <aside
        className={cn(
          'lg:hidden fixed top-0 left-0 bottom-0 w-[284px] max-w-[85vw] z-50 p-3',
          'transform transition-transform duration-300 ease-out',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label={tc('menu')}
      >
        <div className="sb3d-card sb3d-card--static">
          <div className="sb3d-aurora" />
          <div className="sb3d-grain" />
          <div className="sb3d-orb" />
          <button
            onClick={() => setMobileNavOpen(false)}
            className="absolute top-3 right-3 z-10 w-9 h-9 grid place-items-center rounded-full text-violet-400 hover:text-violet-700 hover:bg-violet-100/60 dark:hover:bg-white/10 transition-colors"
            aria-label={tc('close')}
            style={{ transform: 'translateZ(50px)' }}
          >
            <X className="h-5 w-5" />
          </button>
          <SidebarContent onItemClick={() => setMobileNavOpen(false)} />
        </div>
      </aside>
    </>
  );
}
