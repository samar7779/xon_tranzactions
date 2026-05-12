'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BrandLogo } from './brand-logo';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const hydrate = useAuth((s) => s.hydrate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) {
      router.replace(`/${locale}/login`);
      return;
    }
    if (!user) {
      hydrate().finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, [token, user, hydrate, router, locale]);

  if (!ready) {
    return <SplashLoader />;
  }
  return <>{children}</>;
}

function SplashLoader() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      {/* Animatsiyalangan brand blob fonida */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-32 -left-32 w-[28rem] h-[28rem] rounded-full opacity-20 blur-3xl animate-float-slow"
          style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }}
        />
        <div
          className="absolute -bottom-32 -right-32 w-[28rem] h-[28rem] rounded-full opacity-15 blur-3xl animate-float-slow"
          style={{ background: 'radial-gradient(circle, #3b82f6, transparent)', animationDelay: '3s' }}
        />
      </div>

      <div className="relative flex flex-col items-center gap-5 animate-fade-up">
        {/* Pulsing logo */}
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-primary/30 blur-xl animate-pulse" />
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-700 grid place-items-center shadow-lg ring-1 ring-indigo-500/30">
            <BrandLogo className="w-9 h-9" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center">
          <div className="text-base font-semibold tracking-tight">Xon Tranzaksiyalar</div>
          <div className="text-xs text-muted-foreground mt-0.5">Yuklanmoqda...</div>
        </div>

        {/* Spinner dots */}
        <div className="flex gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}
