'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Users, ShieldCheck, History, Zap, Trash2, Briefcase, Upload, KeyRound, Code2, FileSpreadsheet, Bot } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';

const TABS = [
  { key: 'users',          tKey: 'users',          icon: Users,        perm: PERMS.USERS_VIEW },
  { key: 'roles',          tKey: 'roles',          icon: ShieldCheck,  perm: PERMS.ROLES_VIEW },
  { key: 'login',          tKey: 'login',          icon: KeyRound,     perm: PERMS.ADMIN_LOGIN_VIEW },
  { key: 'counterparties', tKey: 'counterparties', icon: Briefcase,    perm: PERMS.COUNTERPARTIES_VIEW },
  { key: 'sync-logs',      tKey: 'syncLogs',       icon: History,      perm: PERMS.SYNC_VIEW },
  { key: 'api-explorer',   tKey: 'apiExplorer',    icon: Zap,          perm: PERMS.API_EXPLORER_VIEW },
  { key: 'cleanup',        tKey: 'cleanup',        icon: Trash2,       perm: PERMS.CLEANUP_VIEW },
  { key: 'import',         tKey: 'import',         icon: Upload,       perm: PERMS.IMPORT_VIEW },
  { key: 'export',         tKey: 'export',         icon: FileSpreadsheet, perm: PERMS.EXPORT_VIEW },
  { key: 'api-keys',       tKey: 'apiKeys',        icon: Code2,        perm: PERMS.API_KEYS_VIEW },
  { key: 'agent',          tKey: 'agent',          icon: Bot,          perm: PERMS.AGENT_VIEW },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { locale } = useParams<{ locale: string }>();
  const pathname = usePathname();
  const t = useTranslations('admin');
  const user = useAuth((s) => s.user);

  // Faqat ruxsat berilgan tab'lar ko'rinadi
  const visibleTabs = TABS.filter((tab) => user?.permissions?.includes(tab.perm));
  const activeTab = visibleTabs.find((tab) => pathname.includes(`/admin/${tab.key}`))?.key || visibleTabs[0]?.key;

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />

      {/* Tab bar — faqat ruxsat berilgan tab'lar */}
      <div className="sticky top-[80px] z-10 bg-muted/30 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
        <div className="px-6 lg:px-8">
          <div className="flex items-center gap-1 -mb-px overflow-x-auto">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <Link
                  key={tab.key}
                  href={`/${locale}/admin/${tab.key}`}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                    active
                      ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t(`tabs.${tab.tKey}`)}
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
