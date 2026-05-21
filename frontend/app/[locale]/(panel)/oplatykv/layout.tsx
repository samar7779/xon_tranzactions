'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { BookUser, CreditCard, Home } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'overview', href: '/oplatykv',         label: 'ОплатыКв', icon: Home,       exact: true  },
  { key: 'crm',      href: '/oplatykv/crm',     label: 'CRM',      icon: BookUser,   exact: false },
  { key: 'billing',  href: '/oplatykv/billing', label: 'Billing',  icon: CreditCard, exact: false },
];

export default function OplatyKvLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { locale } = useParams<{ locale: string }>();
  const activeKey = (() => {
    if (pathname === `/${locale}/oplatykv`) return 'overview';
    const match = TABS.find((t) => !t.exact && pathname.startsWith(`/${locale}${t.href}`));
    return match?.key || 'overview';
  })();

  return (
    <>
      <Topbar
        title="ОплатыКв"
        subtitle="Kvartira to'lovlari · CRM va Bank sverkasi"
      />
      <div className="px-6 lg:px-8 pt-3 bg-white border-b border-slate-200/80 sticky top-0 z-30">
        <nav className="flex items-center gap-1" role="tablist">
          {TABS.map((t) => {
            const href = `/${locale}${t.href}`;
            const active = activeKey === t.key;
            const Icon = t.icon;
            return (
              <Link
                key={t.key}
                href={href}
                role="tab"
                aria-selected={active}
                className={cn(
                  'group inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px',
                  active
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300',
                )}
              >
                <Icon className={cn('h-4 w-4 transition-colors', active ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600')} />
                <span>{t.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </>
  );
}
