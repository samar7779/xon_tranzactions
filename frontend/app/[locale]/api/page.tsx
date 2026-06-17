'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Code2, KeyRound, Lock, CheckCircle2, ChevronDown, Play,
  Copy, Check, LogOut, Eye, EyeOff, Loader2, Globe, Sun, Moon,
  AlertCircle, Terminal, Sparkles, ArrowRight, Search, Menu, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { locales } from '@/i18n/config';
import dynamic from 'next/dynamic';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { IconBtn, PrimaryBtn, MethodBadge, Kbd, eyebrow } from '@/components/api-ui';
import { ApiCommandPalette, type PaletteEndpoint } from '@/components/api-command-palette';
import { SNIPPET_LANGS, genSnippet, type SnippetLang } from '@/lib/api-snippet-gen';
// Clerk.com uslubidagi infrastructure illustration — Laptop → Auth → Server
const ApiHeroInfra = dynamic(
  () => import('@/components/api-hero-infra').then((m) => m.ApiHeroInfra),
  {
    ssr: false,
    loading: () => <div className="w-full h-full bg-slate-100 dark:bg-slate-950 rounded-2xl animate-pulse" />,
  },
);

// Mini iridescent orb — login dekoratsiyasi
const ApiLogin3dOrb = dynamic(
  () => import('@/components/api-login-3d-orb').then((m) => m.ApiLogin3dOrb),
  { ssr: false, loading: () => null },
);

const LOCALE_LABEL: Record<string, string> = { uz: "O'zbekcha", ru: 'Русский', en: 'English' };

// ════════════════════════════════════════════════════════
// ENDPOINTS CATALOG
// ════════════════════════════════════════════════════════
interface EndpointParam {
  name: string;
  in: 'query' | 'path';
  required?: boolean;
  descKey?: string;
  example?: string;
}

interface Endpoint {
  method: 'GET' | 'POST';
  path: string;
  groupKey: 'start' | 'meta' | 'transactions' | 'oplatakv' | 'accounts' | 'counterparties';
  titleKey: string;
  descKey: string;
  scope?: string;
  params?: EndpointParam[];
}

const ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/api/v1/_whoami', groupKey: 'start', titleKey: 'whoamiT', descKey: 'whoamiD' },

  { method: 'GET', path: '/api/v1/_meta/all', groupKey: 'meta', titleKey: 'metaAllT', descKey: 'metaAllD' },
  { method: 'GET', path: '/api/v1/_meta/banks', groupKey: 'meta', titleKey: 'metaBanksT', descKey: 'metaBanksD' },
  { method: 'GET', path: '/api/v1/_meta/accounts', groupKey: 'meta', titleKey: 'metaAccountsT', descKey: 'metaAccountsD' },
  { method: 'GET', path: '/api/v1/_meta/categories', groupKey: 'meta', titleKey: 'metaCategoriesT', descKey: 'metaCategoriesD' },
  { method: 'GET', path: '/api/v1/_meta/enums', groupKey: 'meta', titleKey: 'metaEnumsT', descKey: 'metaEnumsD' },

  {
    method: 'GET', path: '/api/v1/transactions', groupKey: 'transactions',
    titleKey: 'txListT', descKey: 'txListD', scope: 'transactions:read',
    params: [
      { name: 'page', in: 'query', descKey: 'page', example: '1' },
      { name: 'perPage', in: 'query', descKey: 'perPage', example: '50' },
      { name: 'accountId', in: 'query', descKey: 'accountId', example: '' },
      { name: 'bankId', in: 'query', descKey: 'bankId', example: '' },
      { name: 'direction', in: 'query', descKey: 'direction', example: 'IN' },
      { name: 'dateFrom', in: 'query', descKey: 'dateFrom', example: '2026-01-01' },
      { name: 'dateTo', in: 'query', descKey: 'dateTo', example: '2026-12-31' },
      { name: 'q', in: 'query', descKey: 'q', example: '' },
    ],
  },
  {
    method: 'GET', path: '/api/v1/transactions/{id}', groupKey: 'transactions',
    titleKey: 'txOneT', descKey: 'txOneD', scope: 'transactions:read',
    params: [{ name: 'id', in: 'path', required: true, descKey: 'txId' }],
  },

  {
    method: 'GET', path: '/api/v1/oplata-kv', groupKey: 'oplatakv',
    titleKey: 'okListT', descKey: 'okListD', scope: 'oplatakv:read',
    params: [
      { name: 'page', in: 'query', descKey: 'page', example: '1' },
      { name: 'perPage', in: 'query', descKey: 'perPage', example: '50' },
      { name: 'contractNo', in: 'query', descKey: 'contractNo', example: '' },
      { name: 'dateFrom', in: 'query', descKey: 'dateFrom', example: '' },
      { name: 'dateTo', in: 'query', descKey: 'dateTo', example: '' },
      { name: 'q', in: 'query', descKey: 'qOplata', example: '' },
    ],
  },
  {
    method: 'GET', path: '/api/v1/oplata-kv/{id}', groupKey: 'oplatakv',
    titleKey: 'okOneT', descKey: 'okOneD', scope: 'oplatakv:read',
    params: [{ name: 'id', in: 'path', required: true, descKey: 'okId' }],
  },

  {
    method: 'GET', path: '/api/v1/accounts', groupKey: 'accounts',
    titleKey: 'acListT', descKey: 'acListD', scope: 'accounts:read',
    params: [{ name: 'q', in: 'query', descKey: 'qAccount', example: '' }],
  },
  {
    method: 'GET', path: '/api/v1/accounts/{idOrAccountNo}', groupKey: 'accounts',
    titleKey: 'acOneT', descKey: 'acOneD', scope: 'accounts:read',
    params: [{ name: 'idOrAccountNo', in: 'path', required: true, descKey: 'idOrAccountNo', example: '20208000305742909002' }],
  },

  {
    method: 'GET', path: '/api/v1/counterparties', groupKey: 'counterparties',
    titleKey: 'cpListT', descKey: 'cpListD', scope: 'counterparties:read',
    params: [
      { name: 'page', in: 'query', descKey: 'page', example: '1' },
      { name: 'perPage', in: 'query', descKey: 'perPage', example: '50' },
      { name: 'q', in: 'query', descKey: 'qCp', example: '' },
    ],
  },
  {
    method: 'GET', path: '/api/v1/counterparties/{inn}', groupKey: 'counterparties',
    titleKey: 'cpOneT', descKey: 'cpOneD', scope: 'counterparties:read',
    params: [{ name: 'inn', in: 'path', required: true, descKey: 'inn', example: '305212378' }],
  },
];

const groupOrder: Array<Endpoint['groupKey']> = ['start', 'meta', 'transactions', 'oplatakv', 'accounts', 'counterparties'];

// ════════════════════════════════════════════════════════
// FLAG ICONS
// ════════════════════════════════════════════════════════
function FlagIcon({ code }: { code: string }) {
  const w = 20, h = 14;
  if (code === 'uz') return (
    <svg width={w} height={h} viewBox="0 0 22 16" className="rounded-sm ring-1 ring-slate-200/60 dark:ring-slate-700 shrink-0" aria-hidden="true">
      <rect width="22" height="5.33" y="0" fill="#0099B5" />
      <rect width="22" height="0.5" y="5.33" fill="#CE1126" />
      <rect width="22" height="4.83" y="5.83" fill="#fff" />
      <rect width="22" height="0.5" y="10.66" fill="#CE1126" />
      <rect width="22" height="5.34" y="11.16" fill="#1EB53A" />
      <circle cx="5.2" cy="2.6" r="1.4" fill="#fff" />
      <circle cx="5.9" cy="2.6" r="1.2" fill="#0099B5" />
    </svg>
  );
  if (code === 'ru') return (
    <svg width={w} height={h} viewBox="0 0 22 16" className="rounded-sm ring-1 ring-slate-200/60 dark:ring-slate-700 shrink-0" aria-hidden="true">
      <rect width="22" height="5.33" y="0" fill="#fff" />
      <rect width="22" height="5.33" y="5.33" fill="#0039A6" />
      <rect width="22" height="5.34" y="10.66" fill="#D52B1E" />
    </svg>
  );
  if (code === 'en') return (
    <svg width={w} height={h} viewBox="0 0 22 16" className="rounded-sm ring-1 ring-slate-200/60 dark:ring-slate-700 shrink-0" aria-hidden="true">
      <rect width="22" height="16" fill="#012169" />
      <path d="M0 0 L22 16 M22 0 L0 16" stroke="#fff" strokeWidth="2.4" />
      <path d="M0 0 L22 16 M22 0 L0 16" stroke="#C8102E" strokeWidth="1.2" />
      <rect x="9.2" y="0" width="3.6" height="16" fill="#fff" />
      <rect x="0" y="6.2" width="22" height="3.6" fill="#fff" />
      <rect x="9.8" y="0" width="2.4" height="16" fill="#C8102E" />
      <rect x="0" y="6.8" width="22" height="2.4" fill="#C8102E" />
    </svg>
  );
  return null;
}

// ════════════════════════════════════════════════════════
// LANG SWITCHER — keyboard accessible
// ════════════════════════════════════════════════════════
function LangSwitcher() {
  const t = useTranslations('api');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { locale } = useParams<{ locale: string }>();
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reduced = usePrefersReducedMotion();

  const switchTo = (target: string) => {
    if (target === locale) { setOpen(false); return; }
    const segs = pathname.split('/');
    if (segs[1] && (locales as readonly string[]).includes(segs[1])) {
      segs[1] = target;
    } else {
      segs.splice(1, 0, target);
    }
    const url = (segs.join('/') || '/') + (sp.toString() ? `?${sp.toString()}` : '');
    router.push(url);
    setOpen(false);
  };

  // Keyboard navigation
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx((i) => (i + 1) % locales.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx((i) => (i - 1 + locales.length) % locales.length); }
    else if (e.key === 'Enter') { e.preventDefault(); switchTo(locales[focusIdx]); }
  };

  useEffect(() => {
    if (open) itemRefs.current[focusIdx]?.focus();
  }, [focusIdx, open]);

  return (
    <div className="relative" onKeyDown={onKey}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('header.lang')}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none transition-colors"
      >
        <FlagIcon code={locale} />
        <span className="hidden sm:inline uppercase">{locale}</span>
        <ChevronDown className="h-3 w-3 text-slate-400" aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              role="listbox"
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={{ duration: reduced ? 0 : 0.15 }}
              className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 shadow-lg overflow-hidden origin-top-right"
            >
              {locales.map((l, i) => {
                const active = l === locale;
                return (
                  <button
                    key={l}
                    ref={(el) => { itemRefs.current[i] = el; }}
                    role="option"
                    aria-selected={active}
                    onClick={() => switchTo(l)}
                    onMouseEnter={() => setFocusIdx(i)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-[12.5px] hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus:bg-slate-50 dark:focus:bg-slate-800 outline-none',
                      active && 'bg-indigo-50 dark:bg-indigo-950/40',
                    )}
                  >
                    <FlagIcon code={l} />
                    <span className="flex-1 text-left text-slate-800 dark:text-slate-200">{LOCALE_LABEL[l]}</span>
                    <span className="uppercase text-[10px] text-slate-400">{l}</span>
                    {active && <Check className="h-3 w-3 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />}
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// THEME
// ════════════════════════════════════════════════════════
function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem('theme');
      const isDark = stored === 'dark';
      setDark(isDark);
      document.documentElement.classList.toggle('dark', isDark);
    } catch { /* ignore */ }
  }, []);
  const toggle = () => {
    setDark((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('theme', next ? 'dark' : 'light');
        document.documentElement.classList.toggle('dark', next);
      } catch { /* ignore */ }
      return next;
    });
  };
  return { dark, toggle };
}

function ThemeToggle({ dark, toggle }: { dark: boolean; toggle: () => void }) {
  const t = useTranslations('api');
  const reduced = usePrefersReducedMotion();
  return (
    <IconBtn
      onClick={toggle}
      aria-label={dark ? t('header.themeLight') : t('header.themeDark')}
      title={dark ? t('header.themeLight') : t('header.themeDark')}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={dark ? 'sun' : 'moon'}
          initial={{ rotate: reduced ? 0 : -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: reduced ? 0 : 90, opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
          className="grid place-items-center"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </motion.span>
      </AnimatePresence>
    </IconBtn>
  );
}

// ════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════
export default function DeveloperApiPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white dark:bg-slate-950" />}>
      <PageInner />
    </Suspense>
  );
}

function PageInner() {
  const { dark, toggle } = useTheme();
  const reduced = usePrefersReducedMotion();
  const [authedKey, setAuthedKey] = useState<{ keyId: string; secret: string; whoami: any } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('xt_dev_api_auth');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.keyId && parsed?.secret) setAuthedKey(parsed);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  const doLogout = () => {
    setAuthedKey(null);
    sessionStorage.removeItem('xt_dev_api_auth');
  };

  const t = useTranslations('api');
  const whoamiKey = authedKey?.whoami?.key;
  const clientIp: string | null = authedKey?.whoami?.client?.ip ?? null;
  const scopes: string[] = whoamiKey?.scopes || [];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased transition-colors">
      {/* Skip link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-indigo-600 focus:text-white focus:text-sm"
      >
        Skip to main content
      </a>

      {/* Top nav */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/85 backdrop-blur-md">
        <div className="w-full px-3 lg:px-5 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 grid place-items-center shadow-sm shrink-0">
              <Code2 className="h-4 w-4 text-white" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold tracking-tight text-[14.5px] truncate">{t('pageTitle')}</span>
              <span className={cn(eyebrow, 'px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 shrink-0')}>v1</span>
            </div>
            {authedKey && whoamiKey && (
              <div className="hidden md:flex items-center gap-2 ml-2 pl-2.5 border-l border-slate-200 dark:border-slate-700 min-w-0">
                <div className="w-7 h-7 rounded-full bg-emerald-500 grid place-items-center text-white shrink-0 ring-2 ring-white dark:ring-slate-950 shadow-sm">
                  <span className="text-[11px] font-black">{(whoamiKey.name || 'A').charAt(0).toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-slate-800 dark:text-slate-200 leading-tight truncate max-w-[180px]" title={whoamiKey.name}>
                    {whoamiKey.name}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="w-1 h-1 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">{scopes.length} {t('header.scopes')}</span>
                    {clientIp && (
                      <>
                        <span className="text-[10px] text-slate-400 dark:text-slate-600" aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                          <Globe className="h-2.5 w-2.5" aria-hidden="true" />
                          <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400" title={clientIp}>{clientIp}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <ThemeToggle dark={dark} toggle={toggle} />
            <LangSwitcher />
            {authedKey && (
              <IconBtn
                onClick={doLogout}
                tone="rose"
                aria-label={t('header.logout')}
                title={t('header.logout')}
              >
                <LogOut className="h-4 w-4" />
              </IconBtn>
            )}
          </div>
        </div>
      </header>

      <main id="main-content">
        <AnimatePresence mode="wait">
          {hydrated && authedKey ? (
            <motion.div
              key="auth"
              initial={{ opacity: 0, y: reduced ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -8 }}
              transition={{ duration: reduced ? 0 : 0.25 }}
            >
              <AuthenticatedView authed={authedKey} dark={dark} />
            </motion.div>
          ) : hydrated ? (
            <motion.div
              key="land"
              initial={{ opacity: 0, y: reduced ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -8 }}
              transition={{ duration: reduced ? 0 : 0.25 }}
            >
              <LandingView onLogin={(auth) => setAuthedKey(auth)} dark={dark} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// LANDING (login)
// ════════════════════════════════════════════════════════
function LandingView({ onLogin, dark }: {
  onLogin: (auth: { keyId: string; secret: string; whoami: any }) => void;
  dark: boolean;
}) {
  const t = useTranslations('api');
  const [keyId, setKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Progressive disclosure state machine ───
  // 'key'        — faqat key input ko'rinadi
  // 'secret'     — secret input ham ochiladi
  // 'ready'      — submit tugmasi ham ochiladi
  // 'submitting' — server bilan tekshirilmoqda
  type Stage = 'key' | 'secret' | 'ready' | 'submitting';
  const [stage, setStage] = useState<Stage>('key');

  // ─── Infra illustration triggers ───
  const [pulseKey, setPulseKey] = useState(0);
  const [infraState, setInfraState] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');

  const firePulse = (state: 'processing' | 'success' | 'error') => {
    setInfraState(state);
    setPulseKey((p) => p + 1);
  };

  const validate = (value: string) => {
    if (!value.trim()) {
      setError(t('login.errorRequired'));
    } else if (error === t('login.errorRequired')) {
      setError(null);
    }
  };

  // Key field — Enter yoki blur to'liq input bilan → progress to secret
  const advanceFromKey = () => {
    if (!keyId.trim() || stage !== 'key') return;
    firePulse('processing');
    setError(null);
    setTimeout(() => {
      setStage('secret');
      setInfraState('idle');
    }, 1200);
  };

  // Secret field — Enter yoki blur to'liq input bilan → progress to ready
  const advanceFromSecret = () => {
    if (!secret.trim() || stage !== 'secret') return;
    firePulse('processing');
    setError(null);
    setTimeout(() => {
      setStage('ready');
      setInfraState('idle');
    }, 1200);
  };

  const doLogin = async () => {
    setError(null);
    if (!keyId.trim() || !secret.trim()) {
      setError(t('login.errorRequired'));
      return;
    }
    setLoading(true);
    setStage('submitting');
    firePulse('processing');

    try {
      const resp = await fetch(`${window.location.origin}/api/v1/_whoami`, {
        headers: { 'X-API-Key': keyId.trim(), 'X-API-Secret': secret.trim() },
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (resp.status === 401) setError(t('login.errorInvalidKey'));
        else if (resp.status === 403) setError(t('login.errorForbidden'));
        else if (resp.status >= 500) setError(t('login.errorServer'));
        else setError(data?.message || `HTTP ${resp.status}`);
        firePulse('error');
        setStage('ready');
        // Reset infra back to idle after 2.5s
        setTimeout(() => setInfraState('idle'), 2500);
        return;
      }
      // Success — fire success animation, then transition
      firePulse('success');
      const auth = { keyId: keyId.trim(), secret: secret.trim(), whoami: data };
      sessionStorage.setItem('xt_dev_api_auth', JSON.stringify(auth));
      setTimeout(() => onLogin(auth), 900);
    } catch (e: any) {
      setError(e?.message || t('login.errorNetwork'));
      firePulse('error');
      setStage('ready');
      setTimeout(() => setInfraState('idle'), 2500);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = keyId.trim() && secret.trim();
  const reduced = usePrefersReducedMotion();

  return (
    <section className="relative overflow-hidden min-h-[calc(100vh-56px)] bg-white dark:bg-slate-950">
      <div className="grid lg:grid-cols-[1.4fr_minmax(380px,460px)] min-h-[calc(100vh-56px)]">
        {/* ─── LEFT — Illustration (no card, edge-to-edge in column) ─── */}
        <div className="relative h-[300px] sm:h-[400px] lg:h-auto order-2 lg:order-1">
          <ApiHeroInfra dark={dark} className="absolute inset-0 w-full h-full" fullBleed pulseKey={pulseKey} state={infraState} />
          {/* Right edge fade — soft transition into login area */}
          <div
            className="hidden lg:block absolute top-0 right-0 bottom-0 w-32 pointer-events-none"
            aria-hidden="true"
            style={{
              background: dark
                ? 'linear-gradient(to right, transparent, rgba(2,6,23,1))'
                : 'linear-gradient(to right, transparent, rgba(255,255,255,1))',
            }}
          />
        </div>

        {/* ─── RIGHT — Login (own column, clean background) ─── */}
        <div className="relative px-6 lg:px-10 py-10 lg:py-12 flex items-center order-1 lg:order-2">
          <div className="w-full max-w-[440px] mx-auto lg:mx-0 relative">
          {/* Header row — badge + mini 3D orb */}
          <div className="flex items-start justify-between gap-4 mb-5">
            <motion.div
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0 : 0.3 }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl ring-1 ring-emerald-200 dark:ring-emerald-900/60 text-emerald-700 dark:text-emerald-300 text-[10.5px] font-bold uppercase tracking-widest shadow-sm"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className={cn('absolute inline-flex h-full w-full rounded-full bg-emerald-400', !reduced && 'animate-ping opacity-75')} />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              Production · v1
            </motion.div>

            {/* Mini 3D orb — login dekoratsiyasi */}
            <motion.div
              initial={{ opacity: 0, scale: reduced ? 1 : 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: reduced ? 0 : 0.6, delay: reduced ? 0 : 0.1 }}
              className="relative w-20 h-20 sm:w-24 sm:h-24 -mt-2 shrink-0"
            >
              {/* Glow behind */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-500/40 to-fuchsia-500/40 blur-2xl scale-90" aria-hidden="true" />
              <ApiLogin3dOrb className="absolute inset-0" />
            </motion.div>
          </div>

          {/* Gradient title — compact */}
          <motion.h1
            initial={{ opacity: 0, y: reduced ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : 0.4, delay: reduced ? 0 : 0.05 }}
            className="text-4xl sm:text-5xl lg:text-[56px] font-black tracking-tight leading-[1.0]"
          >
            <span className="block bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 dark:from-indigo-400 dark:via-violet-400 dark:to-fuchsia-400 bg-clip-text text-transparent">
              Developer API
            </span>
          </motion.h1>

          {/* Login form */}
          <motion.form
            onSubmit={(e) => { e.preventDefault(); doLogin(); }}
            initial={{ opacity: 0, y: reduced ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : 0.4, delay: reduced ? 0 : 0.15 }}
            className="mt-7 space-y-3 relative"
          >
            {/* Glass card wrapper */}
            <div className="absolute -inset-4 rounded-2xl bg-gradient-to-br from-indigo-500/8 via-violet-500/8 to-fuchsia-500/8 dark:from-indigo-500/15 dark:via-violet-500/15 dark:to-fuchsia-500/15 blur-2xl -z-10" aria-hidden="true" />

            {/* STEP 1 — Key input (har doim ko'rinadi) */}
            <div>
              <label htmlFor="api-key" className={cn(eyebrow, 'mb-2 flex items-center justify-between text-slate-600 dark:text-slate-400')}>
                <span>{t('login.keyLabel')}</span>
                <span className="text-[9px] normal-case tracking-normal text-slate-400 font-medium">Step 1 / 3</span>
              </label>
              <div className="relative group">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-500/0 via-violet-500/0 to-fuchsia-500/0 group-focus-within:from-indigo-500/30 group-focus-within:via-violet-500/30 group-focus-within:to-fuchsia-500/30 blur-md transition-all" aria-hidden="true" />
                <input
                  id="api-key"
                  type="text"
                  value={keyId}
                  onChange={(e) => { setKeyId(e.target.value); validate(e.target.value); }}
                  onBlur={() => { if (keyId.trim() && stage === 'key') advanceFromKey(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); advanceFromKey(); } }}
                  placeholder={t('login.keyPlaceholder')}
                  autoComplete="off"
                  aria-required="true"
                  disabled={stage === 'submitting' || infraState === 'processing'}
                  className="relative w-full h-12 px-4 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none text-[13.5px] font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all disabled:opacity-60"
                />
                {/* Check indicator — key bosqichi tugaganda */}
                {(stage === 'secret' || stage === 'ready' || stage === 'submitting') && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-emerald-500 grid place-items-center"
                  >
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  </motion.div>
                )}
              </div>
            </div>

            {/* STEP 2 — Secret input (faqat key to'ldirilgach ochiladi) */}
            <AnimatePresence>
              {(stage === 'secret' || stage === 'ready' || stage === 'submitting') && (
                <motion.div
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={{ duration: reduced ? 0 : 0.35 }}
                >
                  <label htmlFor="api-secret" className={cn(eyebrow, 'mb-2 flex items-center justify-between text-slate-600 dark:text-slate-400')}>
                    <span className="flex items-center gap-2">
                      {t('login.secretLabel')}
                      <button type="button" onClick={() => setShowSecret(!showSecret)} aria-label={showSecret ? 'Hide secret' : 'Show secret'} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 normal-case font-normal focus-visible:ring-2 focus-visible:ring-indigo-500 rounded p-0.5 outline-none">
                        {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </span>
                    <span className="text-[9px] normal-case tracking-normal text-slate-400 font-medium">Step 2 / 3</span>
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-500/0 via-violet-500/0 to-fuchsia-500/0 group-focus-within:from-indigo-500/30 group-focus-within:via-violet-500/30 group-focus-within:to-fuchsia-500/30 blur-md transition-all" aria-hidden="true" />
                    <input
                      id="api-secret"
                      type={showSecret ? 'text' : 'password'}
                      value={secret}
                      onChange={(e) => { setSecret(e.target.value); validate(e.target.value); }}
                      onBlur={() => { if (secret.trim() && stage === 'secret') advanceFromSecret(); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (stage === 'secret') advanceFromSecret();
                          else if (stage === 'ready') doLogin();
                        }
                      }}
                      placeholder={t('login.secretPlaceholder')}
                      autoComplete="off"
                      aria-required="true"
                      autoFocus={stage === 'secret'}
                      disabled={stage === 'submitting' || infraState === 'processing'}
                      className="relative w-full h-12 px-4 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none text-[13.5px] font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all disabled:opacity-60"
                    />
                    {(stage === 'ready' || stage === 'submitting') && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-emerald-500 grid place-items-center"
                      >
                        <Check className="h-3 w-3 text-white" strokeWidth={3} />
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                aria-live="polite"
                className="rounded-xl bg-rose-50/90 dark:bg-rose-950/40 backdrop-blur-sm ring-1 ring-rose-200 dark:ring-rose-900 px-3.5 py-2.5 flex items-start gap-2"
              >
                <AlertCircle className="h-4 w-4 text-rose-500 dark:text-rose-400 mt-0.5 shrink-0" aria-hidden="true" />
                <div className="text-[12.5px] text-rose-700 dark:text-rose-300 leading-relaxed font-medium">{error}</div>
              </motion.div>
            )}

            {/* STEP 3 — Submit (faqat ready yoki submitting holatda) */}
            <AnimatePresence>
              {(stage === 'ready' || stage === 'submitting') && (
                <motion.div
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={{ duration: reduced ? 0 : 0.35 }}
                  className="relative group pt-1"
                >
                  <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 opacity-60 group-hover:opacity-100 blur transition-opacity" aria-hidden="true" />
                  <button
                    type="submit"
                    disabled={loading || !canSubmit || stage === 'submitting'}
                    className="relative w-full h-12 py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 hover:from-indigo-500 hover:via-violet-500 hover:to-fuchsia-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-[14px] flex items-center justify-center gap-2 transition-all outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 shadow-lg shadow-violet-500/25"
                  >
                    {loading || stage === 'submitting' ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <>
                        <span>{t('login.submit')}</span>
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </>
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Trust strip */}
            <div className="pt-3 flex items-center justify-center gap-4 text-[11.5px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3 w-3 text-emerald-500" />
                <span className="font-medium">SHA-256</span>
              </span>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">/</span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-indigo-500" />
                <span className="font-medium">Scope-based</span>
              </span>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">/</span>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-violet-500" />
                <span className="font-medium">Audit log</span>
              </span>
            </div>
          </motion.form>
        </div>
      </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════
// AUTHENTICATED VIEW — three-column layout
// ════════════════════════════════════════════════════════
function groupEndpoints(endpoints: Endpoint[]) {
  const map = new Map<string, Endpoint[]>();
  endpoints.forEach((ep) => {
    if (!map.has(ep.groupKey)) map.set(ep.groupKey, []);
    map.get(ep.groupKey)!.push(ep);
  });
  return groupOrder.filter((g) => map.has(g)).map((g) => ({ key: g, endpoints: map.get(g)! }));
}

function AuthenticatedView({ authed }: {
  authed: { keyId: string; secret: string; whoami: any };
  dark: boolean;
}) {
  const t = useTranslations('api');
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // URL persistence for active endpoint
  const activeEp = sp.get('ep') || ENDPOINTS[0].path;
  const setActiveEp = (path: string) => {
    const params = new URLSearchParams(sp.toString());
    params.set('ep', path);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const [search, setSearch] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Snippet language — localStorage persist
  const [snippetLang, setSnippetLang] = useState<SnippetLang>(() => {
    if (typeof window === 'undefined') return 'curl';
    try {
      const saved = localStorage.getItem('xt-api-snippet-lang') as SnippetLang | null;
      return saved && ['curl', 'node', 'php', 'python'].includes(saved) ? saved : 'curl';
    } catch { return 'curl'; }
  });
  useEffect(() => {
    try { localStorage.setItem('xt-api-snippet-lang', snippetLang); } catch { /* ignore */ }
  }, [snippetLang]);

  const whoami = authed.whoami?.key;
  const scopes: string[] = whoami?.scopes || [];
  const accessible = (ep: Endpoint) => !ep.scope || scopes.includes(ep.scope);

  const filtered = useMemo(() => {
    if (!search.trim()) return ENDPOINTS;
    const s = search.toLowerCase();
    return ENDPOINTS.filter((ep) =>
      t(`eps.${ep.titleKey}`).toLowerCase().includes(s) ||
      ep.path.toLowerCase().includes(s) ||
      t(`eps.${ep.descKey}`).toLowerCase().includes(s),
    );
  }, [search, t]);

  const groups = groupEndpoints(filtered);
  const current = ENDPOINTS.find((e) => e.path === activeEp) || ENDPOINTS[0];

  // ─── Endpoint detail state (hoisted) ───
  const [params, setParams] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<{ status: number; data: any; ms: number; ok: boolean } | null>(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    const initial: Record<string, string> = {};
    (current.params || []).forEach((p) => { initial[p.name] = p.example || ''; });
    setParams(initial);
    setResponse(null);
  }, [current.path]);

  const builtPath = useMemo(() => {
    let path = current.path;
    (current.params || []).filter((p) => p.in === 'path').forEach((p) => {
      const v = params[p.name] || `{${p.name}}`;
      path = path.replace(`{${p.name}}`, encodeURIComponent(v));
    });
    const qs = new URLSearchParams();
    (current.params || []).filter((p) => p.in === 'query').forEach((p) => {
      const v = (params[p.name] || '').trim();
      if (v) qs.set(p.name, v);
    });
    return path + (qs.toString() ? '?' + qs.toString() : '');
  }, [current, params]);

  const execute = async (epPath?: string) => {
    const ep = epPath ? ENDPOINTS.find((e) => e.path === epPath) || current : current;
    setExecuting(true);
    setResponse(null);
    const start = Date.now();
    try {
      // Re-build path if running from palette (different endpoint)
      let url = ep.path;
      if (ep === current) {
        url = builtPath;
      }
      const resp = await fetch(`${window.location.origin}${url}`, {
        method: ep.method,
        headers: { 'X-API-Key': authed.keyId, 'X-API-Secret': authed.secret },
      });
      const ms = Date.now() - start;
      const text = await resp.text();
      let data: any; try { data = JSON.parse(text); } catch { data = text; }
      setResponse({ status: resp.status, data, ms, ok: resp.ok });
    } catch (e: any) {
      setResponse({ status: 0, data: { error: e?.message || 'Network error' }, ms: Date.now() - start, ok: false });
    } finally {
      setExecuting(false);
    }
  };

  const snippetText = useMemo(() => genSnippet(snippetLang, {
    method: current.method,
    url: `${typeof window !== 'undefined' ? window.location.origin : ''}${builtPath}`,
    keyId: authed.keyId,
    secret: authed.secret,
  }), [snippetLang, current, builtPath, authed]);

  const copyText = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch { toast.error('Failed to copy'); }
  };

  // Sidebar/'/' search focus shortcut
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="w-full px-3 lg:px-5 xl:px-6 py-4 max-w-[1800px] mx-auto">
      <div className="grid lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_440px] gap-5">
        {/* Sidebar */}
        <SidebarNav
          search={search}
          setSearch={setSearch}
          searchRef={searchRef}
          groups={groups}
          activeEp={activeEp}
          setActiveEp={(p) => { setActiveEp(p); setNavOpen(false); }}
          accessible={accessible}
          openPalette={() => setPaletteOpen(true)}
          navOpen={navOpen}
          setNavOpen={setNavOpen}
        />

        {/* Main — Description */}
        <EndpointDescription
          endpoint={current}
          params={params}
          setParams={setParams}
          allowed={accessible(current)}
          executing={executing}
          execute={() => execute()}
          builtPath={builtPath}
        />

        {/* Right rail — sticky code+response */}
        <RightRail
          endpoint={current}
          response={response}
          snippetText={snippetText}
          snippetLang={snippetLang}
          setSnippetLang={setSnippetLang}
          copyText={copyText}
        />
      </div>

      {/* Cmd+K palette */}
      <ApiCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        endpoints={ENDPOINTS.map((ep) => ({
          method: ep.method,
          path: ep.path,
          titleKey: ep.titleKey,
          descKey: ep.descKey,
          groupKey: ep.groupKey,
          scope: ep.scope,
          accessible: accessible(ep),
        })) as PaletteEndpoint[]}
        onSelect={(path) => setActiveEp(path)}
        onExecute={(path) => execute(path)}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────
// SIDEBAR NAV (with mobile drawer)
// ────────────────────────────────────────────────────────
function SidebarNav({
  search, setSearch, searchRef, groups, activeEp, setActiveEp, accessible, openPalette, navOpen, setNavOpen,
}: {
  search: string; setSearch: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement>;
  groups: { key: string; endpoints: Endpoint[] }[];
  activeEp: string;
  setActiveEp: (p: string) => void;
  accessible: (ep: Endpoint) => boolean;
  openPalette: () => void;
  navOpen: boolean;
  setNavOpen: (v: boolean) => void;
}) {
  const t = useTranslations('api');

  return (
    <>
      {/* Mobile hamburger button (floating, above content) */}
      <div className="lg:hidden flex items-center justify-between mb-2">
        <button
          onClick={() => setNavOpen(true)}
          className="inline-flex items-center gap-2 px-3 h-9 rounded-md bg-slate-100 dark:bg-slate-800 text-[13px] font-semibold text-slate-700 dark:text-slate-300 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none"
          aria-label={t('sidebar.open')}
          aria-controls="endpoint-sidebar"
          aria-expanded={navOpen}
        >
          <Menu className="h-4 w-4" />
          Endpoints
        </button>
        <button
          onClick={openPalette}
          className="inline-flex items-center gap-2 px-3 h-9 rounded-md bg-slate-100 dark:bg-slate-800 text-[13px] font-semibold text-slate-700 dark:text-slate-300 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none"
        >
          <Search className="h-4 w-4" />
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      {/* Mobile backdrop */}
      {navOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 z-40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — drawer on mobile, sticky on desktop */}
      <aside
        id="endpoint-sidebar"
        className={cn(
          'fixed inset-y-0 left-0 w-72 z-50 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 transform transition-transform duration-200',
          'lg:relative lg:w-auto lg:translate-x-0 lg:z-auto lg:border-0',
          'lg:sticky lg:top-[68px] lg:h-[calc(100vh-80px)] overflow-y-auto px-3 py-3',
          navOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex items-center justify-between mb-3 lg:hidden">
          <span className="text-[13px] font-bold text-slate-700 dark:text-slate-300">Endpoints</span>
          <button onClick={() => setNavOpen(false)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        {/* Search with ⌘K hint */}
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" aria-hidden="true" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('sidebar.searchPlaceholder')}
            className="w-full h-9 pl-8 pr-16 rounded-md bg-slate-50 dark:bg-slate-800/60 ring-1 ring-slate-200 dark:ring-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none text-[12.5px] text-slate-800 dark:text-slate-200"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
            <Kbd>⌘K</Kbd>
          </div>
        </div>

        <nav className="space-y-3">
          {groups.map((g) => (
            <div key={g.key}>
              <div className={cn('px-2 mb-1', eyebrow)}>{t(`groups.${g.key}`)}</div>
              <div className="space-y-0.5">
                {g.endpoints.map((ep) => {
                  const active = ep.path === activeEp;
                  const allowed = accessible(ep);
                  return (
                    <button
                      key={ep.path}
                      onClick={() => allowed && setActiveEp(ep.path)}
                      disabled={!allowed}
                      className={cn(
                        'w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none',
                        active ? 'bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                        !allowed && 'opacity-40 cursor-not-allowed',
                      )}
                    >
                      <MethodBadge method={ep.method} size="sm" />
                      <span className="text-[12px] text-slate-700 dark:text-slate-300 truncate flex-1">{t(`eps.${ep.titleKey}`)}</span>
                      {!allowed && <Lock className="h-2.5 w-2.5 text-slate-400 shrink-0" aria-label="Locked" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

// ────────────────────────────────────────────────────────
// ENDPOINT DESCRIPTION (middle column)
// ────────────────────────────────────────────────────────
function EndpointDescription({
  endpoint, params, setParams, allowed, executing, execute, builtPath,
}: {
  endpoint: Endpoint;
  params: Record<string, string>;
  setParams: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  allowed: boolean;
  executing: boolean;
  execute: () => void;
  builtPath: string;
}) {
  const t = useTranslations('api');
  return (
    <section>
      <div>
        <div className={cn(eyebrow, 'mb-1.5')}>{t(`groups.${endpoint.groupKey}`)}</div>
        <h1 className="text-2xl lg:text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100">
          {t(`eps.${endpoint.titleKey}`)}
        </h1>
        <p className="text-[14px] text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
          {t(`eps.${endpoint.descKey}`)}
        </p>

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700">
            <MethodBadge method={endpoint.method} />
            <code className="text-[12.5px] font-mono font-bold text-slate-800 dark:text-slate-200">{endpoint.path}</code>
          </div>
          {endpoint.scope && (
            <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <Lock className="h-3 w-3" aria-hidden="true" />
              <code className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-mono font-bold">{endpoint.scope}</code>
            </div>
          )}
        </div>

        {!allowed && (
          <div role="alert" className="mt-3 rounded-md bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-3 py-2.5 flex items-start gap-2">
            <Lock className="h-4 w-4 text-rose-500 dark:text-rose-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="text-[12px] text-rose-700 dark:text-rose-300 leading-relaxed">{t('detail.scopeMissing')}</div>
          </div>
        )}
      </div>

      {/* Try-it params */}
      <div className="mt-6 rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            <span className="text-[12.5px] font-bold text-slate-800 dark:text-slate-200">{t('detail.tryIt')}</span>
          </div>
          <code className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[260px] xl:max-w-[300px]" title={builtPath}>{builtPath}</code>
        </div>

        {endpoint.params && endpoint.params.length > 0 && (
          <div className="px-5 py-4 space-y-3 border-b border-slate-200 dark:border-slate-800">
            {endpoint.params.map((p) => (
              <div key={p.name} className="grid grid-cols-[110px_1fr] sm:grid-cols-[140px_1fr] md:grid-cols-[160px_1fr] gap-3 items-start">
                <div className="pt-1.5">
                  <div className="flex items-center gap-1">
                    <code className="text-[12px] font-mono font-bold text-slate-800 dark:text-slate-200 truncate">{p.name}</code>
                    {p.required && <span className="text-rose-500 text-[10px] font-bold">*</span>}
                  </div>
                  <div className="text-[9.5px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mt-0.5">{p.in}</div>
                </div>
                <div>
                  <input
                    value={params[p.name] || ''}
                    onChange={(e) => setParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
                    placeholder={p.example || ''}
                    aria-label={p.name}
                    className="w-full h-9 px-3 rounded-md bg-slate-50 dark:bg-slate-800/60 ring-1 ring-slate-200 dark:ring-slate-700 focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 outline-none text-[12.5px] font-mono text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all"
                  />
                  {p.descKey && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{t(`paramDesc.${p.descKey}`)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-5 py-3 flex items-center justify-end">
          <PrimaryBtn onClick={execute} disabled={executing || !allowed} size="sm">
            {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />}
            {t('detail.execute')}
          </PrimaryBtn>
        </div>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────
// RIGHT RAIL — sticky code + response
// ────────────────────────────────────────────────────────
function RightRail({
  endpoint, response, snippetText, snippetLang, setSnippetLang, copyText,
}: {
  endpoint: Endpoint;
  response: { status: number; data: any; ms: number; ok: boolean } | null;
  snippetText: string;
  snippetLang: SnippetLang;
  setSnippetLang: (l: SnippetLang) => void;
  copyText: (text: string, msg: string) => void;
}) {
  const t = useTranslations('api');
  const reduced = usePrefersReducedMotion();
  return (
    <aside className="xl:sticky xl:top-[68px] xl:max-h-[calc(100vh-80px)] xl:overflow-y-auto space-y-4 mt-4 xl:mt-0">
      {/* Code snippet — language tabs */}
      <div className="rounded-xl ring-1 ring-slate-800 bg-slate-950 overflow-hidden">
        <div className="border-b border-slate-800 flex items-center justify-between bg-slate-900">
          <div className="flex items-center">
            {SNIPPET_LANGS.map((l) => {
              const active = l.key === snippetLang;
              return (
                <button
                  key={l.key}
                  onClick={() => setSnippetLang(l.key)}
                  className={cn(
                    'px-3 py-2 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none border-b-2',
                    active
                      ? 'border-emerald-400 text-emerald-300'
                      : 'border-transparent text-slate-500 hover:text-slate-300',
                  )}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => copyText(snippetText, t('detail.copied'))}
            className="px-3 h-9 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-emerald-400 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none rounded"
            aria-label={t('detail.copy')}
          >
            <Copy className="h-3 w-3" aria-hidden="true" />
            {t('detail.copy')}
          </button>
        </div>
        <pre className="px-4 py-3 text-[11.5px] font-mono text-emerald-300 overflow-x-auto leading-relaxed">{snippetText}</pre>
      </div>

      {/* Response */}
      <AnimatePresence mode="wait">
        {response && (
          <motion.div
            key={`r-${response.status}`}
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : 0.25 }}
            className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'px-2 py-0.5 rounded font-mono text-[11px] font-bold',
                  response.ok ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
                )}>{response.status}</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{response.ms}ms</span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">{t('detail.response')}</span>
              </div>
              <button
                onClick={() => copyText(typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2), t('detail.copied'))}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none rounded px-1.5 py-0.5"
                aria-label={t('detail.copyResponse')}
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                {t('detail.copy')}
              </button>
            </div>
            <pre className="px-4 py-3 text-[11.5px] font-mono text-slate-800 dark:text-slate-200 leading-relaxed max-h-[500px] overflow-auto whitespace-pre-wrap break-all">
              {typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}
