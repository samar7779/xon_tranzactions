'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';

/** Login bo'lgan foydalanuvchining shaxsiy sozlamalarini (accent + sevimlilar) yuklaydi. */
export function PrefsInit() {
  const userId = useAuth((s) => s.user?.id) ?? null;
  const init = usePrefs((s) => s.init);
  useEffect(() => {
    init(userId);
  }, [userId, init]);
  return null;
}
