'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { Globe } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from './ui/dropdown-menu';
import { locales } from '@/i18n/config';

const LABEL: Record<string, string> = { uz: "O'zbekcha", ru: 'Русский', en: 'English' };

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(target: string) {
    if (target === locale) return;
    // /uz/... -> /ru/...
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
        <Button variant="ghost" size="sm" className="gap-2">
          <Globe className="h-4 w-4" />
          <span className="uppercase">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {locales.map((l) => (
          <DropdownMenuItem key={l} onClick={() => switchTo(l)}>
            <span className="uppercase mr-2 text-xs text-muted-foreground">{l}</span>
            {LABEL[l]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
