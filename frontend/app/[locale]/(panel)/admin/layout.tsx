'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Users, ShieldCheck, History, Zap } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'users',        label: 'Adminlar',     icon: Users },
  { key: 'roles',        label: 'Rollar',       icon: ShieldCheck },
  { key: 'sync-logs',    label: 'Sync tarixi',  icon: History },
  { key: 'api-explorer', label: 'API Explorer', icon: Zap },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { locale } = useParams<{ locale: string }>();
  const pathname = usePathname();

  const activeTab = TABS.find((t) => pathname.includes(`/admin/${t.key}`))?.key || 'users';

  return (
    <>
      <Topbar title="Admin paneli" subtitle="Foydalanuvchilar, rollar, sync va API boshqaruvi" />

      {/* Tab bar */}
      <div className="sticky top-[80px] z-10 bg-muted/30 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-[1500px] mx-auto px-6 lg:px-8">
          <div className="flex items-center gap-1 -mb-px overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <Link
                  key={tab.key}
                  href={`/${locale}/admin/${tab.key}`}
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
