'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { UserCircle, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { LanguageSwitcher } from './language-switcher';

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Topbar({ title, subtitle, actions }: TopbarProps) {
  const t = useTranslations('nav');
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const initial = (user?.fullName || user?.email || '?').charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-20">
      <div className="relative overflow-hidden bg-brand-vivid animate-gradient">
        <div className="absolute inset-0 bg-dots opacity-15 pointer-events-none" />
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/15 blur-3xl pointer-events-none animate-float-slow" />

        <div className="relative flex h-20 items-center justify-between px-6 lg:px-8 text-white gap-4">
          <div className="min-w-0">
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight truncate">{title}</h1>
            {subtitle && <p className="text-[13px] text-white/85 truncate mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actions}

            {/* Til — faqat ikonka */}
            <LanguageSwitcher compact />

            {/* Foydalanuvchi dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm transition-colors group">
                  <span className="relative w-9 h-9 rounded-full bg-gradient-to-br from-white/40 to-white/10 ring-1 ring-white/50 grid place-items-center text-white text-sm font-bold shadow-sm">
                    {initial}
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-indigo-600" />
                  </span>
                  <div className="hidden sm:block min-w-0 text-left">
                    <div className="text-[12px] font-semibold truncate max-w-[180px]">{user?.fullName || user?.email || '—'}</div>
                    <div className="text-[10px] text-white/80 truncate">{user?.roleLabel || user?.role || '—'}</div>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-white/70 group-hover:text-white transition-colors" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-[13px] font-semibold truncate">{user?.fullName || '—'}</div>
                  <div className="text-[11px] text-slate-500 truncate font-normal">{user?.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push(`/${locale}/profile`)} className="cursor-pointer">
                  <UserCircle className="h-4 w-4 mr-2" /> Profilim
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-rose-600 cursor-pointer" onClick={logout}>
                  <LogOut className="h-4 w-4 mr-2" /> {t('logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
