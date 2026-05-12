'use client';

import { LanguageSwitcher } from './language-switcher';

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Topbar({ title, subtitle, actions }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20">
      <div className="relative overflow-hidden bg-brand-vivid animate-gradient">
        <div className="absolute inset-0 bg-dots opacity-15 pointer-events-none" />
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/15 blur-3xl pointer-events-none animate-float-slow" />

        <div className="relative flex h-20 items-center justify-between px-6 lg:px-8 text-white">
          <div className="min-w-0">
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight truncate">{title}</h1>
            {subtitle && <p className="text-[13px] text-white/85 truncate mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <LanguageSwitcher />
          </div>
        </div>
      </div>
    </header>
  );
}
