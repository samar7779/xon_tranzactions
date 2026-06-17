'use client';
import { useEffect, useState } from 'react';

/**
 * Foydalanuvchining 'prefers-reduced-motion' tizim sozlamasini kuzatadi.
 * 3D scene + framer-motion animatsiyalarini o'chirish uchun ishlatiladi —
 * vestibular muammosi bo'lganlar uchun majburiy a11y talab.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}
