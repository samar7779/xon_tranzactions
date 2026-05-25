'use client';

import { useEffect, useState } from 'react';

/**
 * Foydalanuvchining profil rasmini localStorage'dan o'qish.
 * Avatar o'zgartirilganda barcha komponentlarda avto-yangilanadi
 * (custom 'avatar-changed' event orqali).
 */
export function useAvatar(userId: string | null | undefined) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || typeof window === 'undefined') {
      setAvatarUrl(null);
      return;
    }

    const read = () => {
      const stored = localStorage.getItem(`avatar_${userId}`);
      setAvatarUrl(stored);
    };

    read();

    // O'zgarishga reaktiv: custom event + boshqa tab'larda storage event
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.userId === userId) read();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === `avatar_${userId}`) read();
    };

    window.addEventListener('avatar-changed', onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('avatar-changed', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [userId]);

  return avatarUrl;
}

/** Avatar o'zgartirilganda barcha komponentlarga xabar berish */
export function emitAvatarChange(userId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('avatar-changed', { detail: { userId } }));
}

/** Avatar set qilish + emit */
export function setAvatar(userId: string, dataUrl: string | null) {
  if (typeof window === 'undefined') return;
  if (dataUrl) {
    localStorage.setItem(`avatar_${userId}`, dataUrl);
  } else {
    localStorage.removeItem(`avatar_${userId}`);
  }
  emitAvatarChange(userId);
}
