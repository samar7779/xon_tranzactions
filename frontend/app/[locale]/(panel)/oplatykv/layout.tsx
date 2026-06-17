'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Topbar } from '@/components/topbar';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'overview', href: '/oplatykv',         label: 'ОплатыКв', img: '/sheets.png',         exact: true  },
  { key: 'crm',      href: '/oplatykv/crm',     label: 'CRM',      img: '/xon-saroy-logo.png', exact: false },
  { key: 'billing',  href: '/oplatykv/billing', label: 'Billing',  img: '/xonpay.jpg',         exact: false },
];

export default function OplatyKvLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('oplatykv');
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
        subtitle={t('subtitle')}
      />
      <div className="px-6 lg:px-8 pt-3 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-700 sticky top-0 z-30">
        <nav className="flex items-center gap-1" role="tablist">
          {TABS.map((t) => {
            const href = `/${locale}${t.href}`;
            const active = activeKey === t.key;
            return (
              <Link
                key={t.key}
                href={href}
                role="tab"
                aria-selected={active}
                className={cn(
                  'group inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px',
                  active
                    ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700',
                )}
              >
                <span className={cn(
                  'relative w-5 h-5 rounded-md overflow-hidden ring-1 transition-all shrink-0',
                  active ? 'ring-indigo-200 dark:ring-indigo-900 shadow-sm' : 'ring-slate-200 dark:ring-slate-700 group-hover:ring-slate-300 dark:group-hover:ring-slate-600',
                )}>
                  <Image src={t.img} alt={t.label} fill sizes="20px" className="object-contain" />
                </span>
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
