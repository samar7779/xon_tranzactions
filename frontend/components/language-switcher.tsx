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
const FLAG: Record<string, string> = { uz: '🇺🇿', ru: '🇷🇺', en: '🇬🇧' };

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
              className={cn('cursor-pointer', active && 'bg-indigo-50 text-indigo-700')}
            >
              <span className="mr-2 text-base leading-none">{FLAG[l]}</span>
              <span className="flex-1">{LABEL[l]}</span>
              <span className="uppercase text-[10px] text-muted-foreground mr-1">{l}</span>
              {active && <Check className="h-3.5 w-3.5 text-indigo-600" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
