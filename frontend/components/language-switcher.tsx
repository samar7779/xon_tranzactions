'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { Globe, Check } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from './ui/dropdown-menu';
import { locales } from '@/i18n/config';
import { cn } from '@/lib/utils';

const LABEL: Record<string, string> = { uz: "O'zbekcha", ru: 'Русский', en: 'English' };

// SVG inline flag — Windows'da ham ko'rinadi (emoji'lar Windows'da render bo'lmaydi)
function FlagIcon({ code }: { code: string }) {
  const size = { w: 22, h: 16 };
  if (code === 'uz') {
    // O'zbekiston bayrog'i — moviy, oq, yashil 3 chiziq (hilol+yulduzlar soddalashtirilgan)
    return (
      <svg width={size.w} height={size.h} viewBox="0 0 22 16" className="rounded-sm shadow-sm ring-1 ring-slate-200 dark:ring-slate-700">
        <rect width="22" height="5.33" y="0" fill="#0099B5" />
        <rect width="22" height="0.5" y="5.33" fill="#CE1126" />
        <rect width="22" height="4.83" y="5.83" fill="#fff" />
        <rect width="22" height="0.5" y="10.66" fill="#CE1126" />
        <rect width="22" height="5.34" y="11.16" fill="#1EB53A" />
        <circle cx="5.2" cy="2.6" r="1.4" fill="#fff" />
        <circle cx="5.9" cy="2.6" r="1.2" fill="#0099B5" />
      </svg>
    );
  }
  if (code === 'ru') {
    // Rossiya bayrog'i — oq, moviy, qizil
    return (
      <svg width={size.w} height={size.h} viewBox="0 0 22 16" className="rounded-sm shadow-sm ring-1 ring-slate-200 dark:ring-slate-700">
        <rect width="22" height="5.33" y="0" fill="#fff" />
        <rect width="22" height="5.33" y="5.33" fill="#0039A6" />
        <rect width="22" height="5.34" y="10.66" fill="#D52B1E" />
      </svg>
    );
  }
  if (code === 'en') {
    // Buyuk Britaniya — Union Jack (soddalashtirilgan)
    return (
      <svg width={size.w} height={size.h} viewBox="0 0 22 16" className="rounded-sm shadow-sm ring-1 ring-slate-200 dark:ring-slate-700">
        <rect width="22" height="16" fill="#012169" />
        {/* Diagonal qizil + oq xochlar */}
        <path d="M0 0 L22 16 M22 0 L0 16" stroke="#fff" strokeWidth="2.4" />
        <path d="M0 0 L22 16 M22 0 L0 16" stroke="#C8102E" strokeWidth="1.2" />
        {/* O'rta xoch */}
        <rect x="9.2" y="0" width="3.6" height="16" fill="#fff" />
        <rect x="0" y="6.2" width="22" height="3.6" fill="#fff" />
        <rect x="9.8" y="0" width="2.4" height="16" fill="#C8102E" />
        <rect x="0" y="6.8" width="22" height="2.4" fill="#C8102E" />
      </svg>
    );
  }
  return null;
}

interface Props {
  compact?: boolean;
}

export function LanguageSwitcher({ compact = false }: Props) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(target: string) {
    if (target === locale) return;
    const segs = pathname.split('/');
    if (segs[1] && locales.includes(segs[1] as any)) {
      segs[1] = target;
    } else {
      segs.splice(1, 0, target);
    }
    router.push(segs.join('/') || '/');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button
            aria-label="Til"
            className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm grid place-items-center text-white transition-colors"
          >
            <Globe className="h-[18px] w-[18px]" />
          </button>
        ) : (
          <Button variant="ghost" size="sm" className="gap-2">
            <Globe className="h-4 w-4" />
            <span className="uppercase">{locale}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {locales.map((l) => {
          const active = l === locale;
          return (
            <DropdownMenuItem
              key={l}
              onClick={() => switchTo(l)}
              className={cn('cursor-pointer gap-2', active && 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300')}
            >
              <FlagIcon code={l} />
              <span className="flex-1">{LABEL[l]}</span>
              <span className="uppercase text-[10px] text-muted-foreground mr-1">{l}</span>
              {active && <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
