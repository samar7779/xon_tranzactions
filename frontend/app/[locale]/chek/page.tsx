'use client';

import { useEffect, useMemo, useState } from 'react';
import { Database, History, Settings, ShieldAlert, ClipboardCheck } from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';
import { useAuth } from '@/lib/auth';
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* ═══ Header ═══ */}
      <header className="sticky top-0 z-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 grid place-items-center text-white shadow-lg shadow-indigo-500/30 shrink-0">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-black tracking-tight text-slate-900 dark:text-slate-100 truncate">{t('appTitle')}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{t('subtitle')}</div>
            </div>
          </div>

          {/* Til tanlash */}
          <div className="flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 p-1">
            {CHEK_LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => changeLang(l.code)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-[12px] font-semibold transition-all',
                  lang === l.code
                    ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200',
                )}
                title={l.label}
              >
                <span className="mr-1">{l.flag}</span>{l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab nav */}
        {allowed.length > 0 && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <nav className="flex items-center gap-1 -mb-px">
              {allowed.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActive(tab.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-bold border-b-2 transition-colors',
                    active === tab.key
                      ? 'border-indigo-500 text-indigo-700 dark:text-indigo-300'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200',
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
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
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
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-10 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 grid place-items-center mx-auto mb-3">
        <Settings className="h-7 w-7 text-slate-400" />
      </div>
      <div className="text-base font-bold text-slate-800 dark:text-slate-200">{t('settingsTitle')}</div>
      <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('comingSoon')}</div>
    </div>
  );
}
