'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
/**
 * "Ruxsat yo'q" ekranidagi tugma qayerga yo'naltirishini aniqlash uchun —
 * foydalanuvchi haqiqatan ham kira oladigan birinchi sahifa (sidebar tartibida).
 * Har birida any-of ruxsat: ro'yxatdagi birortasi bo'lsa yetarli.
 */
const LANDING_ROUTES: { path: string; anyOf: string[] }[] = [
  { path: '/dashboard',    anyOf: [PERMS.DASHBOARD_VIEW] },
  { path: '/transactions', anyOf: [PERMS.TRANSACTIONS_VIEW] },
  { path: '/oplatykv',     anyOf: [PERMS.CRM_VIEW, PERMS.OPLATAKV_VIEW] },
  { path: '/setup/banks',       anyOf: [PERMS.BANKS_VIEW] },
  { path: '/setup/accounts',    anyOf: [PERMS.ACCOUNTS_VIEW] },
  { path: '/setup/credentials', anyOf: [PERMS.CREDENTIALS_VIEW] },
  { path: '/admin/users',     anyOf: [PERMS.USERS_VIEW] },
  { path: '/admin/roles',     anyOf: [PERMS.ROLES_VIEW] },
  { path: '/admin/sync-logs', anyOf: [PERMS.SYNC_VIEW] },
];

const ROUTE_PERMISSIONS: { prefix: string; permission: string }[] = [
  // Eng aniq (uzun) yo'llar birinchi — find() birinchi mosini oladi
  { prefix: '/setup/banks', permission: PERMS.BANKS_VIEW },
  { prefix: '/setup/accounts', permission: PERMS.ACCOUNTS_VIEW },
  { prefix: '/setup/credentials', permission: PERMS.CREDENTIALS_VIEW },
  { prefix: '/setup', permission: PERMS.BANKS_VIEW },
  { prefix: '/admin/users', permission: PERMS.USERS_VIEW },
  { prefix: '/admin/roles', permission: PERMS.ROLES_VIEW },
  { prefix: '/admin/sync-logs', permission: PERMS.SYNC_VIEW },
  { prefix: '/admin/api-keys', permission: PERMS.API_KEYS_VIEW },
  { prefix: '/admin/api-explorer', permission: PERMS.CREDENTIALS_MANAGE },
  { prefix: '/admin', permission: PERMS.USERS_VIEW },
  { prefix: '/dashboard', permission: PERMS.DASHBOARD_VIEW },
  { prefix: '/transactions', permission: PERMS.TRANSACTIONS_VIEW },
  { prefix: '/statement', permission: PERMS.TRANSACTIONS_VIPISKA_VIEW },
  { prefix: '/check', permission: PERMS.TRANSACTIONS_SVERKA_VIEW },
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
  const tc = useTranslations('common');

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

  return <AccessDenied locale={locale} tc={tc} />;
}

/**
 * "Ruxsat yo'q" ekrani — markazda 404 video (2 tadan tasodifiy bittasi),
 * matn + tugma esa pastki burchakda ixcham kartochkada. Sidebar/header yopilmaydi.
 */
function AccessDenied({ locale, tc }: { locale: string; tc: (k: string) => string }) {
  const user = useAuth((s) => s.user);
  // SSR/hydration mos bo'lishi uchun — birinchi video bilan boshlaymiz,
  // mount'dan keyin client tomonda tasodifiy tanlaymiz
  const [videoIdx, setVideoIdx] = useState(1);
  useEffect(() => {
    setVideoIdx(Math.random() < 0.5 ? 1 : 2);
  }, []);

  // Foydalanuvchi kira oladigan birinchi sahifa — dashboard'ga ruxsat
  // bo'lmasa, bor ruxsatli bo'limga yo'naltiramiz (aks holda loop bo'lardi).
  const landing = LANDING_ROUTES.find((r) =>
    r.anyOf.some((p) => user?.permissions?.includes(p)),
  );
  const backHref = `/${locale}${landing?.path ?? '/dashboard'}`;

  return (
    <div className="flex-1 relative grid place-items-center overflow-hidden p-6">
      {/* Markazdagi video */}
      <video
        key={videoIdx}
        src={`/404-${videoIdx}.mp4`}
        autoPlay
        loop
        muted
        playsInline
        className="w-full max-w-[560px] rounded-2xl"
      />

      {/* Matn + tugma — pastki chap burchakda ixcham kartochka */}
      <div className="absolute bottom-5 left-5 sm:bottom-7 sm:left-7 max-w-[300px]
                      rounded-2xl bg-white/85 dark:bg-slate-900/85 backdrop-blur-md
                      ring-1 ring-slate-200/80 dark:ring-slate-800 shadow-xl p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="grid place-items-center w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-950/40 shrink-0">
            <ShieldAlert className="h-4 w-4 text-rose-500" />
          </span>
          <h1 className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {tc('accessDenied')}
          </h1>
        </div>
        <p className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {tc('accessDeniedDesc')}
        </p>
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 mt-3 px-3.5 h-9 rounded-xl
                     bg-slate-900 dark:bg-slate-800 text-white text-[12.5px] font-medium
                     hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {tc('backToHome')}
        </Link>
      </div>
    </div>
  );
}

