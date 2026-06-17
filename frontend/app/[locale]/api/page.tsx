'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Code2, KeyRound, Lock, ShieldCheck, CheckCircle2, ChevronDown, Play,
  Copy, Check, LogOut, Eye, EyeOff, Loader2, Activity, Globe, Sun, Moon,
  AlertCircle, Server, Terminal, Sparkles, ArrowRight, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { locales } from '@/i18n/config';
import dynamic from 'next/dynamic';

const Api3dHero = dynamic(
  () => import('@/components/api-3d-hero').then((m) => m.Api3dHero),
  {
    ssr: false,
    loading: () => <div className="w-full h-full bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-950/40 dark:to-violet-950/40 rounded-2xl animate-pulse" />,
  },
);

const LOCALE_LABEL: Record<string, string> = { uz: "O'zbekcha", ru: 'Русский', en: 'English' };

// ════════════════════════════════════════════════════════
// ENDPOINTS CATALOG (i18n kalitlar bilan)
// ════════════════════════════════════════════════════════
interface Endpoint {
  method: 'GET' | 'POST';
  path: string;
  groupKey: 'start' | 'meta' | 'transactions' | 'oplatakv' | 'accounts' | 'counterparties';
  titleKey: string;
  descKey: string;
  scope?: string;
  params?: { name: string; in: 'query' | 'path'; required?: boolean; descKey?: string; description?: string; example?: string }[];
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
      { name: 'page', in: 'query', description: 'page (default 1)', example: '1' },
      { name: 'perPage', in: 'query', description: 'max 200', example: '50' },
      { name: 'accountId', in: 'query', description: 'account id', example: '' },
      { name: 'bankId', in: 'query', description: 'bank id', example: '' },
      { name: 'direction', in: 'query', description: 'IN | OUT', example: 'IN' },
      { name: 'dateFrom', in: 'query', description: 'YYYY-MM-DD', example: '2026-01-01' },
      { name: 'dateTo', in: 'query', description: 'YYYY-MM-DD', example: '2026-12-31' },
      { name: 'q', in: 'query', description: 'free text', example: '' },
    ],
  },
  {
    method: 'GET', path: '/api/v1/transactions/{id}', groupKey: 'transactions',
    titleKey: 'txOneT', descKey: 'txOneD', scope: 'transactions:read',
    params: [{ name: 'id', in: 'path', required: true, description: 'transaction id' }],
  },

  {
    method: 'GET', path: '/api/v1/oplata-kv', groupKey: 'oplatakv',
    titleKey: 'okListT', descKey: 'okListD', scope: 'oplatakv:read',
    params: [
      { name: 'page', in: 'query', description: '', example: '1' },
      { name: 'perPage', in: 'query', description: '', example: '50' },
      { name: 'contractNo', in: 'query', description: '', example: '' },
      { name: 'dateFrom', in: 'query', description: 'YYYY-MM-DD', example: '' },
      { name: 'dateTo', in: 'query', description: 'YYYY-MM-DD', example: '' },
      { name: 'q', in: 'query', description: '', example: '' },
    ],
  },
  {
    method: 'GET', path: '/api/v1/oplata-kv/{id}', groupKey: 'oplatakv',
    titleKey: 'okOneT', descKey: 'okOneD', scope: 'oplatakv:read',
    params: [{ name: 'id', in: 'path', required: true, description: '' }],
  },

  {
    method: 'GET', path: '/api/v1/accounts', groupKey: 'accounts',
    titleKey: 'acListT', descKey: 'acListD', scope: 'accounts:read',
    params: [{ name: 'q', in: 'query', description: '', example: '' }],
  },
  {
    method: 'GET', path: '/api/v1/accounts/{idOrAccountNo}', groupKey: 'accounts',
    titleKey: 'acOneT', descKey: 'acOneD', scope: 'accounts:read',
    params: [{ name: 'idOrAccountNo', in: 'path', required: true, description: 'id or accountNo', example: '20208000305742909002' }],
  },

  {
    method: 'GET', path: '/api/v1/counterparties', groupKey: 'counterparties',
    titleKey: 'cpListT', descKey: 'cpListD', scope: 'counterparties:read',
    params: [
      { name: 'page', in: 'query', description: '', example: '1' },
      { name: 'perPage', in: 'query', description: '', example: '50' },
      { name: 'q', in: 'query', description: '', example: '' },
    ],
  },
  {
    method: 'GET', path: '/api/v1/counterparties/{inn}', groupKey: 'counterparties',
    titleKey: 'cpOneT', descKey: 'cpOneD', scope: 'counterparties:read',
    params: [{ name: 'inn', in: 'path', required: true, description: '', example: '305212378' }],
  },
];

const groupOrder: Array<Endpoint['groupKey']> = ['start', 'meta', 'transactions', 'oplatakv', 'accounts', 'counterparties'];

// ════════════════════════════════════════════════════════
// FLAG ICONS
// ════════════════════════════════════════════════════════
function FlagIcon({ code }: { code: string }) {
  const w = 20, h = 14;
  if (code === 'uz') return (
    <svg width={w} height={h} viewBox="0 0 22 16" className="rounded-sm ring-1 ring-slate-200/60 dark:ring-slate-700 shrink-0">
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
    <svg width={w} height={h} viewBox="0 0 22 16" className="rounded-sm ring-1 ring-slate-200/60 dark:ring-slate-700 shrink-0">
      <rect width="22" height="5.33" y="0" fill="#fff" />
      <rect width="22" height="5.33" y="5.33" fill="#0039A6" />
      <rect width="22" height="5.34" y="10.66" fill="#D52B1E" />
    </svg>
  );
  if (code === 'en') return (
    <svg width={w} height={h} viewBox="0 0 22 16" className="rounded-sm ring-1 ring-slate-200/60 dark:ring-slate-700 shrink-0">
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
// LANG SWITCHER
// ════════════════════════════════════════════════════════
function LangSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useParams<{ locale: string }>();
  const [open, setOpen] = useState(false);

  const switchTo = (target: string) => {
    if (target === locale) { setOpen(false); return; }
    const segs = pathname.split('/');
    if (segs[1] && (locales as readonly string[]).includes(segs[1])) {
      segs[1] = target;
    } else {
      segs.splice(1, 0, target);
    }
    router.push(segs.join('/') || '/');
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-[12px] font-semibold text-slate-700 dark:text-slate-300 transition-colors"
      >
        <FlagIcon code={locale} />
        <span className="hidden sm:inline uppercase">{locale}</span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-lg overflow-hidden">
            {locales.map((l) => {
              const active = l === locale;
              return (
                <button
                  key={l}
                  onClick={() => switchTo(l)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-[12.5px] hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors',
                    active && 'bg-indigo-50 dark:bg-indigo-950/40',
                  )}
                >
                  <FlagIcon code={l} />
                  <span className="flex-1 text-left text-slate-800 dark:text-slate-200">{LOCALE_LABEL[l]}</span>
                  <span className="uppercase text-[10px] text-slate-400">{l}</span>
                  {active && <Check className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// THEME TOGGLE
// ════════════════════════════════════════════════════════
function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('theme');
      const isDark = stored === 'dark';
      setDark(isDark);
      if (isDark) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    } catch { /* ignore */ }
  }, []);

  const toggle = () => {
    setDark((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('theme', next ? 'dark' : 'light');
        if (next) document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
      } catch { /* ignore */ }
      return next;
    });
  };

  return { dark, toggle };
}

function ThemeToggle({ dark, toggle }: { dark: boolean; toggle: () => void }) {
  return (
    <button
      onClick={toggle}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
      title={dark ? 'Light' : 'Dark'}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

// ════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════
export default function DeveloperApiPage() {
  const { dark, toggle } = useTheme();
  const [authedKey, setAuthedKey] = useState<{ keyId: string; secret: string; whoami: any } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('xt_dev_api_auth');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.keyId && parsed?.secret) setAuthedKey(parsed);
      }
    } catch { /* ignore */ }
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
      {/* Top nav */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/85 backdrop-blur-md">
        <div className="w-full px-4 lg:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 grid place-items-center shadow-sm shrink-0">
              <Code2 className="h-4 w-4 text-white" />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold tracking-tight text-[14.5px] truncate">{t('pageTitle')}</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">v1</span>
            </div>
            {/* User info chip — agar kirgan bo'lsa */}
            {authedKey && whoamiKey && (
              <div className="hidden md:flex items-center gap-2 ml-3 pl-3 border-l border-slate-200 dark:border-slate-700 min-w-0">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 grid place-items-center text-white shrink-0 ring-2 ring-white dark:ring-slate-950 shadow-sm">
                  <span className="text-[11px] font-black">{(whoamiKey.name || 'A').charAt(0).toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-slate-800 dark:text-slate-200 leading-tight truncate max-w-[180px]" title={whoamiKey.name}>
                    {whoamiKey.name}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="w-1 h-1 rounded-full bg-emerald-500" />
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">{scopes.length} {t('header.scopes')}</span>
                    {clientIp && (
                      <>
                        <span className="text-[10px] text-slate-400 dark:text-slate-600">·</span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                          <Globe className="h-2.5 w-2.5" />
                          <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400" title={clientIp}>{clientIp}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right */}
          <div className="flex items-center gap-1 shrink-0">
            <ThemeToggle dark={dark} toggle={toggle} />
            <LangSwitcher />
            {authedKey && (
              <button
                onClick={doLogout}
                className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md hover:bg-rose-50 dark:hover:bg-rose-950/40 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-400 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('header.logout')}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {authedKey ? (
        <AuthenticatedView authed={authedKey} dark={dark} />
      ) : (
        <LandingView onLogin={(auth) => setAuthedKey(auth)} dark={dark} />
      )}
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

  const doLogin = async () => {
    setError(null);
    if (!keyId.trim() || !secret.trim()) { setError(t('login.errorRequired')); return; }
    setLoading(true);
    try {
      const resp = await fetch(`${window.location.origin}/api/v1/_whoami`, {
        headers: { 'X-API-Key': keyId.trim(), 'X-API-Secret': secret.trim() },
      });
      const data = await resp.json();
      if (!resp.ok) { setError(data?.message || `HTTP ${resp.status}`); return; }
      const auth = { keyId: keyId.trim(), secret: secret.trim(), whoami: data };
      sessionStorage.setItem('xt_dev_api_auth', JSON.stringify(auth));
      onLogin(auth);
    } catch (e: any) {
      setError(e?.message || t('login.errorNetwork'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none [background-image:linear-gradient(to_right,rgba(0,0,0,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.04)_1px,transparent_1px)] dark:[background-image:linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="absolute -top-20 -right-20 w-[600px] h-[600px] bg-gradient-to-br from-indigo-200/40 to-violet-200/40 dark:from-indigo-700/15 dark:to-violet-700/15 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full px-4 lg:px-8 xl:px-12 pt-8 pb-16 grid lg:grid-cols-[1fr_1fr] gap-10 items-center max-w-[1700px] mx-auto">
        {/* Left — 3D model (no labels) */}
        <div className="relative h-[460px] lg:h-[600px]">
          <Api3dHero className="absolute inset-0" dark={dark} />
        </div>

        {/* Right — Login card */}
        <div className="lg:max-w-md w-full mx-auto lg:ml-auto">
          <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 shadow-2xl shadow-indigo-500/5 dark:shadow-violet-900/10 p-6 lg:p-7">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 grid place-items-center shadow-md">
                <KeyRound className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-[15px] font-black text-slate-900 dark:text-slate-100 leading-tight">{t('login.title')}</h2>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{t('login.subtitle')}</p>
              </div>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400 mb-1 block">{t('login.keyLabel')}</label>
                <input
                  type="text"
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  placeholder={t('login.keyPlaceholder')}
                  className="w-full h-11 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/80 ring-1 ring-slate-200 dark:ring-slate-700 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:bg-white dark:focus:bg-slate-800 outline-none text-[13px] font-mono text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400 mb-1 flex items-center justify-between">
                  <span>{t('login.secretLabel')}</span>
                  <button type="button" onClick={() => setShowSecret(!showSecret)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 normal-case font-normal">
                    {showSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                </label>
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={t('login.secretPlaceholder')}
                  onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }}
                  className="w-full h-11 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/80 ring-1 ring-slate-200 dark:ring-slate-700 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:bg-white dark:focus:bg-slate-800 outline-none text-[13px] font-mono text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 text-rose-500 dark:text-rose-400 mt-0.5 shrink-0" />
                  <div className="text-[11.5px] text-rose-700 dark:text-rose-300 leading-relaxed">{error}</div>
                </div>
              )}

              <button
                onClick={doLogin}
                disabled={loading || !keyId.trim() || !secret.trim()}
                className="w-full h-11 rounded-lg bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 text-white dark:text-slate-900 font-bold text-[13px] flex items-center justify-center gap-2 transition-all"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{t('login.submit')} <ArrowRight className="h-4 w-4" /></>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════
// AUTHENTICATED VIEW
// ════════════════════════════════════════════════════════
function groupEndpoints(endpoints: Endpoint[]) {
  const map = new Map<string, Endpoint[]>();
  endpoints.forEach((ep) => {
    if (!map.has(ep.groupKey)) map.set(ep.groupKey, []);
    map.get(ep.groupKey)!.push(ep);
  });
  return groupOrder.filter((g) => map.has(g)).map((g) => ({ key: g, endpoints: map.get(g)! }));
}

function AuthenticatedView({ authed, dark }: {
  authed: { keyId: string; secret: string; whoami: any };
  dark: boolean;
}) {
  const t = useTranslations('api');
  const [activeEp, setActiveEp] = useState<string>(ENDPOINTS[0].path);
  const [search, setSearch] = useState('');
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
  const current = ENDPOINTS.find((e) => e.path === activeEp);

  return (
    <div className="w-full px-4 lg:px-6 xl:px-8 py-6 grid lg:grid-cols-[300px_1fr] gap-6 max-w-[1900px] mx-auto">
      <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-110px)] lg:overflow-y-auto -mx-2 px-2">
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('sidebar.searchPlaceholder')}
            className="w-full h-9 pl-8 pr-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 ring-1 ring-slate-200 dark:ring-slate-700 focus:ring-slate-400 dark:focus:ring-slate-500 focus:bg-white dark:focus:bg-slate-800 outline-none text-[12.5px] text-slate-800 dark:text-slate-200"
          />
        </div>

        <nav className="space-y-3">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="px-2 mb-1 text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">
                {t(`groups.${g.key}`)}
              </div>
              <div className="space-y-0.5">
                {g.endpoints.map((ep) => {
                  const active = ep.path === activeEp;
                  const allowed = accessible(ep);
                  return (
                    <button
                      key={ep.path}
                      onClick={() => setActiveEp(ep.path)}
                      disabled={!allowed}
                      className={cn(
                        'w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors',
                        active ? 'bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                        !allowed && 'opacity-40 cursor-not-allowed',
                      )}
                    >
                      <span className={cn(
                        'px-1 py-px rounded font-mono text-[8.5px] font-bold shrink-0 w-9 text-center',
                        ep.method === 'GET' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
                      )}>{ep.method}</span>
                      <span className="text-[12px] text-slate-700 dark:text-slate-300 truncate flex-1">{t(`eps.${ep.titleKey}`)}</span>
                      {!allowed && <Lock className="h-2.5 w-2.5 text-slate-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <main>
        {current && <EndpointDetail endpoint={current} authed={authed} allowed={accessible(current)} />}
      </main>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// ENDPOINT DETAIL
// ════════════════════════════════════════════════════════
function MethodBadge({ method }: { method: 'GET' | 'POST' }) {
  return (
    <span className={cn(
      'px-1.5 py-0.5 rounded font-mono text-[10px] font-bold',
      method === 'GET' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    )}>{method}</span>
  );
}

function EndpointDetail({
  endpoint, authed, allowed,
}: { endpoint: Endpoint; authed: { keyId: string; secret: string }; allowed: boolean }) {
  const t = useTranslations('api');
  const [params, setParams] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<{ status: number; data: any; ms: number; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const initial: Record<string, string> = {};
    (endpoint.params || []).forEach((p) => { initial[p.name] = p.example || ''; });
    setParams(initial);
    setResponse(null);
  }, [endpoint.path]);

  const builtPath = useMemo(() => {
    let path = endpoint.path;
    (endpoint.params || []).filter((p) => p.in === 'path').forEach((p) => {
      const v = params[p.name] || `{${p.name}}`;
      path = path.replace(`{${p.name}}`, encodeURIComponent(v));
    });
    const qs = new URLSearchParams();
    (endpoint.params || []).filter((p) => p.in === 'query').forEach((p) => {
      const v = (params[p.name] || '').trim();
      if (v) qs.set(p.name, v);
    });
    return path + (qs.toString() ? '?' + qs.toString() : '');
  }, [endpoint, params]);

  const execute = async () => {
    setLoading(true);
    setResponse(null);
    const start = Date.now();
    try {
      const resp = await fetch(`${window.location.origin}${builtPath}`, {
        method: endpoint.method,
        headers: { 'X-API-Key': authed.keyId, 'X-API-Secret': authed.secret },
      });
      const ms = Date.now() - start;
      const text = await resp.text();
      let data: any; try { data = JSON.parse(text); } catch { data = text; }
      setResponse({ status: resp.status, data, ms, ok: resp.ok });
    } catch (e: any) {
      setResponse({ status: 0, data: { error: e?.message || 'Network error' }, ms: Date.now() - start, ok: false });
    } finally {
      setLoading(false);
    }
  };

  const curlText = useMemo(() => {
    return `curl ${typeof window !== 'undefined' ? window.location.origin : ''}${builtPath} \\
  -H "X-API-Key: ${authed.keyId}" \\
  -H "X-API-Secret: ${authed.secret}"`;
  }, [builtPath, authed]);

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[10.5px] uppercase tracking-widest text-slate-400 dark:text-slate-500 font-bold mb-1.5">
          {t(`groups.${endpoint.groupKey}`)}
        </div>
        <h1 className="text-2xl lg:text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100">
          {t(`eps.${endpoint.titleKey}`)}
        </h1>
        <p className="text-[14px] text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
          {t(`eps.${endpoint.descKey}`)}
        </p>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700">
            <MethodBadge method={endpoint.method} />
            <code className="text-[12.5px] font-mono font-bold text-slate-800 dark:text-slate-200">{endpoint.path}</code>
          </div>
          {endpoint.scope && (
            <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <Lock className="h-3 w-3" />
              <code className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-mono font-bold">{endpoint.scope}</code>
            </div>
          )}
        </div>

        {!allowed && (
          <div className="mt-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-3 py-2.5 flex items-start gap-2">
            <Lock className="h-4 w-4 text-rose-500 dark:text-rose-400 mt-0.5 shrink-0" />
            <div className="text-[12px] text-rose-700 dark:text-rose-300 leading-relaxed">
              {t('detail.scopeMissing')}
            </div>
          </div>
        )}
      </div>

      {/* Try-it */}
      <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="text-[12.5px] font-bold text-slate-800 dark:text-slate-200">{t('detail.tryIt')}</span>
          </div>
          <code className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[300px]" title={builtPath}>{builtPath}</code>
        </div>

        {endpoint.params && endpoint.params.length > 0 && (
          <div className="px-5 py-4 space-y-3 border-b border-slate-200 dark:border-slate-800">
            {endpoint.params.map((p) => (
              <div key={p.name} className="grid sm:grid-cols-[160px_1fr] gap-2 sm:gap-4 items-start">
                <div className="pt-1.5">
                  <div className="flex items-center gap-1">
                    <code className="text-[12px] font-mono font-bold text-slate-800 dark:text-slate-200">{p.name}</code>
                    {p.required && <span className="text-rose-500 text-[10px] font-bold">*</span>}
                  </div>
                  <div className="text-[9.5px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mt-0.5">{p.in}</div>
                </div>
                <div>
                  <input
                    value={params[p.name] || ''}
                    onChange={(e) => setParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
                    placeholder={p.example || ''}
                    className="w-full h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 ring-1 ring-slate-200 dark:ring-slate-700 focus:ring-slate-400 dark:focus:ring-slate-500 focus:bg-white dark:focus:bg-slate-800 outline-none text-[12.5px] font-mono text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors"
                  />
                  {p.description && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{p.description}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-5 py-3 flex items-center justify-end gap-2">
          <button
            onClick={execute}
            disabled={loading || !allowed}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 text-white dark:text-slate-900 font-bold text-[12.5px] transition-all"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            {t('detail.execute')}
          </button>
        </div>
      </div>

      {response && (
        <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                'px-2 py-0.5 rounded font-mono text-[11px] font-bold',
                response.ok ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
              )}>
                {response.status}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{response.ms}ms</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">{t('detail.response')}</span>
            </div>
          </div>
          <pre className="px-5 py-4 text-[11.5px] font-mono text-slate-800 dark:text-slate-200 leading-relaxed max-h-[500px] overflow-auto whitespace-pre-wrap break-all">
            {typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2)}
          </pre>
        </div>
      )}

      <div className="rounded-xl ring-1 ring-slate-800 bg-slate-950 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{t('detail.curl')}</span>
          </div>
          <button onClick={copyCurl} className="inline-flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-emerald-400">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? t('detail.copied') : t('detail.copy')}
          </button>
        </div>
        <pre className="px-4 py-3 text-[11.5px] font-mono text-emerald-300 overflow-x-auto">{curlText}</pre>
      </div>
    </div>
  );
}
