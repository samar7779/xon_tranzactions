'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Building2, KeyRound, Wallet } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'banks',       label: 'Banklar',          icon: Building2 },
  { key: 'credentials', label: 'Bank ulanishlari', icon: KeyRound },
  { key: 'accounts',    label: 'Bank hisoblari',   icon: Wallet },
];

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  const { locale } = useParams<{ locale: string }>();
  const pathname = usePathname();

  const activeTab = TABS.find((t) => pathname.includes(`/setup/${t.key}`))?.key || 'banks';

  return (
    <>
      <Topbar title="Banklar" subtitle="Banklar, ulanishlar va hisob raqamlari" />

      {/* Tab bar */}
      <div className="sticky top-[80px] z-10 bg-muted/30 backdrop-blur-sm border-b border-slate-200">
        <div className="px-6 lg:px-8">
          <div className="flex items-center gap-1 -mb-px overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <Link
                  key={tab.key}
                  href={`/${locale}/setup/${tab.key}`}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                    active
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {children}
    </>
  );
}
