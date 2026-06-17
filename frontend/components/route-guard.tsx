'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';

/**
 * Route darajasida ruxsat tekshiruvi.
 *
 * Sidebar'da link ko'rinmasligi yetarli emas — foydalanuvchi URL'ni qo'lda
 * yozib ham kirishi mumkin. Shu sababli har bir panel sahifasi shu yerda
 * o'ziga kerakli permission bilan bog'lanadi. Ruxsat bo'lmasa — sahifa
 * o'rniga "ruxsat yo'q" ekrani ko'rsatiladi.
 *
 * Eslatma: hech qanday hardcode rol yo'q — faqat user.permissions[] tekshiriladi.
 */
const ROUTE_PERMISSIONS: { prefix: string; permission: string }[] = [
  // Eng aniq (uzun) yo'llar birinchi — find() birinchi mosini oladi
  { prefix: '/setup/banks', permission: PERMS.BANKS_VIEW },
  { prefix: '/setup/accounts', permission: PERMS.ACCOUNTS_VIEW },
  { prefix: '/setup/credentials', permission: PERMS.CREDENTIALS_VIEW },
  { prefix: '/setup', permission: PERMS.BANKS_VIEW },
  { prefix: '/admin/users', permission: PERMS.USERS_VIEW },
  { prefix: '/admin/roles', permission: PERMS.ROLES_VIEW },
  { prefix: '/admin/sync-logs', permission: PERMS.SYNC_VIEW },
  { prefix: '/admin/api-explorer', permission: PERMS.CREDENTIALS_MANAGE },
  { prefix: '/admin', permission: PERMS.USERS_VIEW },
  { prefix: '/dashboard', permission: PERMS.DASHBOARD_VIEW },
  { prefix: '/transactions', permission: PERMS.TRANSACTIONS_VIEW },
  { prefix: '/statement', permission: PERMS.TRANSACTIONS_VIEW },
  { prefix: '/check', permission: PERMS.TRANSACTIONS_VIEW },
  { prefix: '/changes', permission: PERMS.CHANGED_TXN_VIEW },
  { prefix: '/customers', permission: PERMS.CUSTOMERS_VIEW },
  { prefix: '/contracts', permission: PERMS.CONTRACTS_VIEW },
  { prefix: '/oplatykv/crm', permission: PERMS.CRM_VIEW },
  { prefix: '/oplatykv/billing', permission: PERMS.CRM_VIEW },
  { prefix: '/oplatykv', permission: PERMS.OPLATAKV_VIEW },
];

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { locale } = useParams<{ locale: string }>();
  const user = useAuth((s) => s.user);

  // /uz/admin/roles → /admin/roles (locale segmentini olib tashlaymiz)
  const segments = pathname.split('/').filter(Boolean);
  const path = '/' + segments.slice(1).join('/');

  const rule = ROUTE_PERMISSIONS.find(
    (r) => path === r.prefix || path.startsWith(r.prefix + '/'),
  );

  // Qoidasi yo'q yo'l — cheklov qo'ymaymiz
  if (!rule) return <>{children}</>;

  const allowed = user?.permissions?.includes(rule.permission) ?? false;
  if (allowed) return <>{children}</>;

  return (
    <div className="flex-1 grid place-items-center p-8">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/40 grid place-items-center mx-auto mb-5">
          <ShieldAlert className="h-8 w-8 text-rose-500" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Bu sahifaga ruxsatingiz yo'q
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
          Bu bo'limni ko'rish uchun kerakli ruxsat rolingizga berilmagan.
          Agar bu xato deb hisoblasangiz, tizim administratoriga murojaat qiling.
        </p>
        <Link
          href={`/${locale}/dashboard`}
          className="inline-flex items-center gap-2 mt-6 px-4 h-10 rounded-xl
                     bg-slate-900 dark:bg-slate-800 text-white text-sm font-medium
                     hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Bosh sahifaga qaytish
        </Link>
      </div>
    </div>
  );
}
