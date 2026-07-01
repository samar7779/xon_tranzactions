'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth';
import { ShowcaseStage } from './showcase-stage';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useParams<{ locale: string }>();
  const token = useAuth((s) => s.token);
  const hydrate = useAuth((s) => s.hydrate);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // localStorage'dan o'qib bo'lguncha kutamiz — aks holda birinchi
    // render'da token=null ko'rinib, login'ga noto'g'ri yo'naltirib yuboramiz.
    if (!hasHydrated) return;

    if (!token) {
      // Login'dan keyin foydalanuvchi shu sahifaga qaytsin (dashboard'ga emas).
      // Masalan /uz/chek ni ochib, login bo'lgach yana /uz/chek ga qaytadi.
      const next = pathname && !pathname.includes('/login') ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/${locale}/login${next}`);
      return;
    }
    // Panel har ochilganda /auth/me dan yangi ruxsatlarni olamiz — rol
    // o'zgartirilgan bo'lsa, keshlangan eski ruxsatlar bilan qolmaymiz.
    hydrate().finally(() => setReady(true));
  }, [hasHydrated, token, hydrate, router, locale, pathname]);

  if (!hasHydrated || !ready) {
    return <SplashLoader />;
  }
  return <>{children}</>;
}

function SplashLoader() {
  const tc = useTranslations('common');
  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Showcase animatsiyasi to'liq ekranda */}
      <ShowcaseStage />

      {/* Pastki o'rtada: progress bar + status text */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3">
        <div className="w-56 h-0.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 rounded-full splash-progress shadow-[0_0_12px_rgba(245,158,11,0.7)]" />
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-amber-200/80 font-mono">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inset-0 rounded-full bg-amber-400 opacity-75" />
            <span className="relative rounded-full h-1.5 w-1.5 bg-amber-400" />
          </span>
          {tc('updating')}
        </div>
      </div>

      <style jsx>{`
        @keyframes splash-progress {
          0%   { transform: translateX(-100%); width: 30%; }
          50%  { transform: translateX(150%); width: 50%; }
          100% { transform: translateX(400%); width: 30%; }
        }
        :global(.splash-progress) {
          animation: splash-progress 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite;
        }
      `}</style>
    </div>
  );
}
