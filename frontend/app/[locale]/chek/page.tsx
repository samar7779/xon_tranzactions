'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Database, History, Settings, ShieldAlert, ClipboardCheck,
  Globe, Moon, Sun, LogOut, ChevronDown, Check,
} from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/components/theme-provider';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { PERMS } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import {
  CHEK_LANGS, DEFAULT_CHEK_LANG, makeT, type ChekLang,
} from './i18n';
import { BazaTab } from './baza-tab';
import { TarixTab } from './tarix-tab';

const LS_LANG = 'chek.lang';

type TabKey = 'baza' | 'tarix' | 'sozlamalar';

export default function ChekPage() {
  return (
    <AuthGuard>
      <ChekInner />
    </AuthGuard>
  );
}

function ChekInner() {
  const user = useAuth((s) => s.user);
  const perms = user?.permissions || [];

  const [lang, setLang] = useState<ChekLang>(DEFAULT_CHEK_LANG);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_LANG) as ChekLang | null;
      if (saved && CHEK_LANGS.some((l) => l.code === saved)) setLang(saved);
    } catch { /* ignore */ }
  }, []);
  function changeLang(l: ChekLang) {
    setLang(l);
    try { localStorage.setItem(LS_LANG, l); } catch {}
  }

  const t = useMemo(() => makeT(lang), [lang]);

  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string; icon: React.ReactNode; can: boolean }[] = [
      { key: 'baza', label: t('tab_baza'), icon: <Database className="h-4 w-4" />, can: perms.includes(PERMS.CHEK_BAZA) },
      { key: 'tarix', label: t('tab_tarix'), icon: <History className="h-4 w-4" />, can: perms.includes(PERMS.CHEK_TARIX) },
      { key: 'sozlamalar', label: t('tab_sozlamalar'), icon: <Settings className="h-4 w-4" />, can: perms.includes(PERMS.CHEK_SOZLAMALAR) },
    ];
    return list;
  }, [t, perms]);

  const allowed = tabs.filter((x) => x.can);
  const [active, setActive] = useState<TabKey>('baza');
  useEffect(() => {
    // Ruxsat berilgan birinchi tabga o'tamiz (agar joriy tab ruxsatsiz bo'lsa)
    if (allowed.length > 0 && !allowed.some((x) => x.key === active)) {
      setActive(allowed[0].key);
    }
  }, [allowed, active]);

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-indigo-50 via-slate-50 to-violet-100 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950/60 overflow-hidden">
      {/* Dekorativ rangli bloblar */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-24 w-[420px] h-[420px] rounded-full bg-indigo-400/20 dark:bg-indigo-600/15 blur-[100px]" />
        <div className="absolute top-1/3 -right-32 w-[480px] h-[480px] rounded-full bg-fuchsia-400/20 dark:bg-fuchsia-600/10 blur-[110px]" />
        <div className="absolute -bottom-40 left-1/3 w-[420px] h-[420px] rounded-full bg-violet-400/15 dark:bg-violet-600/10 blur-[100px]" />
      </div>

      {/* ═══ Header — PRO ═══ */}
      <header className="relative z-30 sticky top-0 bg-gradient-to-r from-white/85 via-violet-50/70 to-indigo-50/80 dark:from-slate-900/85 dark:via-slate-900/80 dark:to-indigo-950/50 backdrop-blur-2xl border-b border-white/50 dark:border-slate-800/70 shadow-[0_4px_30px_-12px_rgba(79,70,229,0.35)]">
        {/* Dekorativ fon */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-12 right-[22%] w-80 h-44 rounded-full bg-violet-400/20 dark:bg-violet-600/20 blur-3xl" />
          <div className="absolute top-0 right-0 w-[28rem] h-full bg-fuchsia-300/15 dark:bg-fuchsia-700/10 blur-3xl" />
          <div className="absolute inset-0 opacity-[0.045] dark:opacity-[0.07]"
            style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #4f46e5 1px, transparent 0)', backgroundSize: '20px 20px' }} />
        </div>

        {/* Yuqori gradient chiziq */}
        <div className="relative h-0.5 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500" />

        <div className="relative w-full px-4 sm:px-6 lg:px-10 h-16 flex items-center justify-between gap-3">
          {/* Branding */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center text-white shadow-lg shadow-violet-500/40 ring-1 ring-white/40">
                <ClipboardCheck className="h-[22px] w-[22px]" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900">
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-70" />
              </span>
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-black tracking-tight text-slate-900 dark:text-slate-100 truncate flex items-center gap-2">
                {t('appTitle')}
                <span className="hidden sm:inline-flex text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-sm">Pro</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{t('subtitle')}</div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            <ThemeToggle />
            <LangSwitcher lang={lang} onChange={changeLang} />
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5 hidden sm:block" />
            <UserMenu lang={lang} />
          </div>
        </div>

        {/* Tab nav — pill segmented */}
        {allowed.length > 0 && (
          <div className="relative w-full px-4 sm:px-6 lg:px-10 pb-2.5">
            <nav className="inline-flex items-center gap-1 p-1 rounded-2xl bg-slate-100/80 dark:bg-slate-800/60 ring-1 ring-slate-200/70 dark:ring-slate-700">
              {allowed.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActive(tab.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-bold transition-all',
                    active === tab.key
                      ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm ring-1 ring-slate-200/70 dark:ring-slate-700'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200',
                  )}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        )}
      </header>

      {/* ═══ Content ═══ */}
      <main className="relative z-10 w-full px-4 sm:px-6 lg:px-10 py-6">
        {allowed.length === 0 ? (
          <div className="mt-16 text-center">
            <div className="w-16 h-16 rounded-3xl bg-rose-50 dark:bg-rose-950/40 grid place-items-center mx-auto mb-4">
              <ShieldAlert className="h-8 w-8 text-rose-500" />
            </div>
            <div className="text-lg font-bold text-slate-800 dark:text-slate-200">{t('accessDenied')}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">{t('noTabAccess')}</div>
          </div>
        ) : active === 'baza' ? (
          <BazaTab lang={lang} />
        ) : active === 'tarix' ? (
          <TarixTab lang={lang} canEdit />
        ) : (
          <SozlamalarTab lang={lang} />
        )}
      </main>
    </div>
  );
}

function SozlamalarTab({ lang }: { lang: ChekLang }) {
  const t = makeT(lang);
  return (
    <div className="rounded-2xl bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl ring-1 ring-white/60 dark:ring-slate-800 shadow-[0_20px_50px_-25px_rgba(79,70,229,0.35)] p-10 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 grid place-items-center mx-auto mb-3">
        <Settings className="h-7 w-7 text-slate-400" />
      </div>
      <div className="text-base font-bold text-slate-800 dark:text-slate-200">{t('settingsTitle')}</div>
      <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('comingSoon')}</div>
    </div>
  );
}

// ───────────────────── Header pro elementlari ─────────────────────

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <button
      onClick={toggleTheme}
      title="Theme"
      className="w-9 h-9 rounded-xl grid place-items-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
    >
      {mounted && theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}

function LangSwitcher({ lang, onChange }: { lang: ChekLang; onChange: (l: ChekLang) => void }) {
  const cur = CHEK_LANGS.find((l) => l.code === lang) || CHEK_LANGS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
          <Globe className="h-4 w-4 text-indigo-500" />
          <span className="hidden sm:inline">{cur.label}</span>
          <span className="sm:hidden">{cur.flag}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {CHEK_LANGS.map((l) => (
          <DropdownMenuItem key={l.code} onSelect={() => onChange(l.code)} className="gap-2 cursor-pointer">
            <span>{l.flag}</span>
            <span className="flex-1">{l.label}</span>
            {l.code === lang && <Check className="h-4 w-4 text-indigo-500" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ lang }: { lang: ChekLang }) {
  const t = makeT(lang);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const name = user?.fullName || user?.email || '—';
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  function doLogout() {
    logout();
    router.replace(`/${locale}/login`);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white font-bold text-sm grid place-items-center shadow-md shadow-violet-500/30 ring-1 ring-white/30 hover:scale-105 transition-transform">
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 truncate">{user?.fullName || '—'}</div>
          {user?.email && <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user.email}</div>}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={doLogout} className="gap-2 cursor-pointer text-rose-600 focus:text-rose-600">
          <LogOut className="h-4 w-4" /> {t('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
