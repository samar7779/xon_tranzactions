'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BadgeDollarSign, FileSpreadsheet, Scale, AlertOctagon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tranzaksiyalar bo'limining tab navigatsiyasi:
 * Tranzaksiyalar · Vipiska · Sverka. Har bir tab o'z route'iga olib boradi.
 */
export function TransactionsTabs() {
  const t = useTranslations('nav');
  const { locale } = useParams<{ locale: string }>();
  const pathname = usePathname();

  const tabs = [
    { href: '/transactions', key: 'transactions', icon: BadgeDollarSign,  label: null },
    { href: '/statement',    key: 'statement',    icon: FileSpreadsheet,  label: null },
    { href: '/check',        key: 'check',        icon: Scale,            label: null },
    { href: '/changes',      key: 'changes',      icon: AlertOctagon,     label: "O'zgargan to'lovlar" },
  ] as const;

  return (
    <div className="bg-white border-b border-slate-200/70">
      <nav className="flex items-center gap-1 px-6 lg:px-8 -mb-px">
        {tabs.map((tab) => {
          const href = `/${locale}${tab.href}`;
          const active = pathname === href || pathname?.startsWith(href + '/');
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={href}
              className={cn(
                'relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors',
                'border-b-2 -mb-px',
                active
                  ? 'border-indigo-500 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300',
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-indigo-600' : 'text-slate-400')} />
              <span>{tab.label || t(tab.key)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
