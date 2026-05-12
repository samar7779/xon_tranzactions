'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';

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
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">Yuklanmoqda...</div>
      </div>
    );
  }
  return <>{children}</>;
}
