'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "Yuqoriga" tugmasi — panel scroll konteyneri (selector orqali topilgan
 * element) pastga 400px+ tushgan bo'lsa, o'ng pastki burchakda paydo bo'ladi
 * va bosilganda smooth scroll qiladi.
 */
export function ScrollToTop({
  targetSelector = '#panel-scroll',
  threshold = 400,
}: {
  targetSelector?: string;
  threshold?: number;
}) {
  const [visible, setVisible] = useState(false);
  const tc = useTranslations('common');

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(targetSelector);
    if (!el) return;

    function onScroll() {
      setVisible(el!.scrollTop > threshold);
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [targetSelector, threshold]);

  function jumpTop() {
    const el = document.querySelector<HTMLElement>(targetSelector);
    el?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <button
      type="button"
      onClick={jumpTop}
      aria-label={tc('scrollToTop')}
      title={tc('scrollToTop')}
      className={cn(
        'fixed bottom-24 right-6 z-40',
        'w-11 h-11 rounded-full',
        'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
        'shadow-[0_10px_30px_-6px_rgba(99,102,241,0.55),inset_0_1px_0_rgba(255,255,255,0.25)]',
        'ring-1 ring-white/20',
        'grid place-items-center',
        'transition-all duration-300 ease-out',
        'hover:scale-110 hover:shadow-[0_14px_36px_-6px_rgba(99,102,241,0.7)]',
        'active:scale-95',
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-3 pointer-events-none',
      )}
    >
      <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
    </button>
  );
}
