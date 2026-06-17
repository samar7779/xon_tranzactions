'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import {
  Code2, KeyRound, Lock, ShieldCheck, CheckCircle2, ChevronDown, Play,
  Copy, Check, LogOut, Eye, EyeOff, Loader2, Activity, Zap, Infinity as InfinityIcon,
  AlertCircle, Server, ExternalLink, Terminal, BookOpen, Sparkles, ChevronRight,
  ArrowRight, Search, Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { locales } from '@/i18n/config';
import dynamic from 'next/dynamic';

// 3D hero — dynamic import (server-side render qilinmaydi, browser-only)
const Api3dHero = dynamic(
  () => import('@/components/api-3d-hero').then((m) => m.Api3dHero),
  { ssr: false, loading: () => <div className="w-full h-full bg-gradient-to-br from-indigo-100 to-violet-100 rounded-2xl animate-pulse" /> },
);

const LOCALE_LABEL: Record<string, string> = { uz: "O'zbekcha", ru: 'Русский', en: 'English' };

// SVG flags
function FlagIcon({ code }: { code: string }) {
  const w = 20, h = 14;
  if (code === 'uz') return (
    <svg width={w} height={h} viewBox="0 0 22 16" className="rounded-sm ring-1 ring-slate-200/60 shrink-0">
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
    <svg width={w} height={h} viewBox="0 0 22 16" className="rounded-sm ring-1 ring-slate-200/60 shrink-0">
      <rect width="22" height="5.33" y="0" fill="#fff" />
      <rect width="22" height="5.33" y="5.33" fill="#0039A6" />
      <rect width="22" height="5.34" y="10.66" fill="#D52B1E" />
    </svg>
  );
  if (code === 'en') return (
    <svg width={w} height={h} viewBox="0 0 22 16" className="rounded-sm ring-1 ring-slate-200/60 shrink-0">
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
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-slate-100 text-[12px] font-semibold text-slate-700 transition-colors"
      >
        <FlagIcon code={locale} />
        <span className="hidden sm:inline uppercase">{locale}</span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg bg-white ring-1 ring-slate-200 shadow-lg overflow-hidden">
            {locales.map((l) => {
              const active = l === locale;
              return (
                <button
                  key={l}
                  onClick={() => switchTo(l)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-[12.5px] hover:bg-slate-50 transition-colors',
                    active && 'bg-indigo-50',
                  )}
                >
                  <FlagIcon code={l} />
                  <span className="flex-1 text-left text-slate-800">{LOCALE_LABEL[l]}</span>
                  <span className="uppercase text-[10px] text-slate-400">{l}</span>
                  {active && <Check className="h-3 w-3 text-indigo-600" />}
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
// ENDPOINTS CATALOG
// ════════════════════════════════════════════════════════
interface Endpoint {
  method: 'GET' | 'POST';
  path: string;
  title: string;
  description: string;
  scope?: string;
  group: string;
  params?: { name: string; in: 'query' | 'path'; required?: boolean; description: string; example?: string }[];
}

const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET', path: '/api/v1/_whoami', group: 'Boshlanish',
    title: 'Whoami', description: 'Hozirgi API kalit ma\'lumotini qaytaradi.',
  },

  // META
  {
    method: 'GET', path: '/api/v1/_meta/all', group: 'Meta (filter qurish uchun)',
    title: 'Hammasi (banks, accounts, categories, enums)',
    description: 'Filter UI qurish uchun barcha ma\'lumotlar bitta javobda. Scope kerak emas.',
  },
  {
    method: 'GET', path: '/api/v1/_meta/banks', group: 'Meta (filter qurish uchun)',
    title: 'Banklar', description: 'Tizimdagi barcha banklar ro\'yxati.',
  },
  {
    method: 'GET', path: '/api/v1/_meta/accounts', group: 'Meta (filter qurish uchun)',
    title: 'Hisob raqamlar', description: 'Barcha hisob raqamlar (qisqacha — id, accountNo, ownerName, bank).',
  },
  {
    method: 'GET', path: '/api/v1/_meta/categories', group: 'Meta (filter qurish uchun)',
    title: 'Kategoriya va subkategoriyalar', description: 'Ierarxik — har kategoriya o\'z subkategoriyalari bilan.',
  },
  {
    method: 'GET', path: '/api/v1/_meta/enums', group: 'Meta (filter qurish uchun)',
    title: 'Enum qiymatlar', description: 'direction, status, type, source, matchStatus va h.k. — labellar bilan.',
  },

  // TRANSACTIONS
  {
    method: 'GET', path: '/api/v1/transactions', group: 'Tranzaksiyalar',
    title: 'Tranzaksiyalar ro\'yxati',
    description: 'Filter va pagination bilan.',
    scope: 'transactions:read',
    params: [
      { name: 'page', in: 'query', description: 'Sahifa (default 1)', example: '1' },
      { name: 'perPage', in: 'query', description: 'Sahifada (max 200)', example: '50' },
      { name: 'accountId', in: 'query', description: 'Hisob ID (yoki _meta/accounts dan)', example: '' },
      { name: 'bankId', in: 'query', description: 'Bank ID', example: '' },
      { name: 'direction', in: 'query', description: 'IN yoki OUT', example: 'IN' },
      { name: 'dateFrom', in: 'query', description: 'YYYY-MM-DD', example: '2026-01-01' },
      { name: 'dateTo', in: 'query', description: 'YYYY-MM-DD', example: '2026-12-31' },
      { name: 'q', in: 'query', description: 'Erkin qidiruv (nom, STIR, shartnoma, izoh)', example: '' },
    ],
  },
  {
    method: 'GET', path: '/api/v1/transactions/{id}', group: 'Tranzaksiyalar',
    title: 'Tranzaksiya tafsiloti', description: 'ID bo\'yicha bitta tranzaksiya.',
    scope: 'transactions:read',
    params: [{ name: 'id', in: 'path', required: true, description: 'Tranzaksiya ID' }],
  },

  // OPLATA-KV
  {
    method: 'GET', path: '/api/v1/oplata-kv', group: 'ОплатыКв',
    title: 'Kvartira to\'lovlari ro\'yxati',
    description: 'Дог, sana, summa, mijoz, obyekt.',
    scope: 'oplatakv:read',
    params: [
      { name: 'page', in: 'query', description: 'Sahifa', example: '1' },
      { name: 'perPage', in: 'query', description: 'Sahifada', example: '50' },
      { name: 'contractNo', in: 'query', description: 'Shartnoma raqami', example: '' },
      { name: 'dateFrom', in: 'query', description: 'YYYY-MM-DD', example: '' },
      { name: 'dateTo', in: 'query', description: 'YYYY-MM-DD', example: '' },
      { name: 'q', in: 'query', description: 'Mijoz, obyekt yoki izoh', example: '' },
    ],
  },
  {
    method: 'GET', path: '/api/v1/oplata-kv/{id}', group: 'ОплатыКв',
    title: 'Tafsilot', description: 'ID bo\'yicha bitta qator.',
    scope: 'oplatakv:read',
    params: [{ name: 'id', in: 'path', required: true, description: 'OplataKv ID' }],
  },

  // ACCOUNTS
  {
    method: 'GET', path: '/api/v1/accounts', group: 'Hisob raqamlar',
    title: 'Hisoblar ro\'yxati',
    description: 'Bank credentials va parollar BERILMAYDI.',
    scope: 'accounts:read',
    params: [{ name: 'q', in: 'query', description: 'Hisob raqam yoki egasi', example: '' }],
  },
  {
    method: 'GET', path: '/api/v1/accounts/{idOrAccountNo}', group: 'Hisob raqamlar',
    title: 'Hisob tafsiloti', description: 'ID (cuid) yoki hisob raqami (20 raqam) qabul qiladi.',
    scope: 'accounts:read',
    params: [{ name: 'idOrAccountNo', in: 'path', required: true, description: 'Account ID yoki hisob raqami', example: '20208000305742909002' }],
  },

  // COUNTERPARTIES
  {
    method: 'GET', path: '/api/v1/counterparties', group: 'Kontragentlar',
    title: 'Kontragentlar ro\'yxati',
    description: 'INN, nomi, reyting, manba.',
    scope: 'counterparties:read',
    params: [
      { name: 'page', in: 'query', description: 'Sahifa', example: '1' },
      { name: 'perPage', in: 'query', description: 'Sahifada', example: '50' },
      { name: 'q', in: 'query', description: 'INN yoki nom', example: '' },
    ],
  },
  {
    method: 'GET', path: '/api/v1/counterparties/{inn}', group: 'Kontragentlar',
    title: 'Tafsilot (INN)', description: 'INN bo\'yicha kontragent.',
    scope: 'counterparties:read',
    params: [{ name: 'inn', in: 'path', required: true, description: 'INN (9/14 raqam)', example: '305212378' }],
  },
];

// Group endpoints
function groupEndpoints(endpoints: Endpoint[]) {
  const groups = new Map<string, Endpoint[]>();
  endpoints.forEach((ep) => {
    if (!groups.has(ep.group)) groups.set(ep.group, []);
    groups.get(ep.group)!.push(ep);
  });
  return Array.from(groups.entries()).map(([name, eps]) => ({ name, endpoints: eps }));
}

// ════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════
export default function DeveloperApiPage() {
  const { locale } = useParams<{ locale: string }>();
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

  const whoamiKey = authedKey?.whoami?.key;
  const scopes: string[] = whoamiKey?.scopes || [];

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      {/* Top nav — butun ekran, user info, til, chiqish */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="w-full px-4 lg:px-6 h-14 flex items-center justify-between gap-3">
          {/* Left — brand + page title */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 grid place-items-center shadow-sm shrink-0">
              <Code2 className="h-4 w-4 text-white" />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold tracking-tight text-[14.5px] truncate">Developer API</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold bg-slate-100 text-slate-600 shrink-0">v1</span>
            </div>
            {/* User info chip — agar kirgan bo'lsa */}
            {authedKey && whoamiKey && (
              <div className="hidden md:flex items-center gap-2 ml-3 pl-3 border-l border-slate-200 min-w-0">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 grid place-items-center text-white shrink-0 ring-2 ring-white shadow-sm">
                  <span className="text-[11px] font-black">{(whoamiKey.name || 'A').charAt(0).toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-slate-800 leading-tight truncate max-w-[180px]" title={whoamiKey.name}>
                    {whoamiKey.name}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-emerald-500" />
                    <code className="font-mono text-[10px] text-slate-500 truncate max-w-[160px]" title={authedKey.keyId}>
                      {authedKey.keyId.slice(0, 18)}…
                    </code>
                    <span className="text-[10px] text-slate-400">·</span>
                    <span className="text-[10px] text-slate-500">{scopes.length} scope</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right — language + actions */}
          <div className="flex items-center gap-1 shrink-0">
            <LangSwitcher />
            {authedKey && (
              <button
                onClick={doLogout}
                className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md hover:bg-rose-50 text-[12px] font-semibold text-slate-600 hover:text-rose-700 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Chiqish</span>
              </button>
            )}
            <a
              href={`/${locale}/dashboard`}
              className="hidden sm:inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2.5 h-8 rounded-md hover:bg-slate-100"
            >
              <span className="hidden lg:inline">Panelga</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </header>

      {authedKey ? (
        <AuthenticatedView authed={authedKey} />
      ) : (
        <LandingView onLogin={(auth) => setAuthedKey(auth)} />
      )}

      <footer className="border-t border-slate-200 mt-20 py-6 text-center text-[11.5px] text-slate-500">
        © Xon Saroy · Tranzaksiyalar tizimi · Developer API v1
      </footer>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// LANDING VIEW (login)
// ════════════════════════════════════════════════════════
function LandingView({ onLogin }: { onLogin: (auth: { keyId: string; secret: string; whoami: any }) => void }) {
  const [keyId, setKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doLogin = async () => {
    setError(null);
    if (!keyId.trim() || !secret.trim()) { setError('Key va Secret majburiy'); return; }
    setLoading(true);
    try {
      const resp = await fetch(`${window.location.origin}/api/v1/_whoami`, {
        headers: { 'X-API-Key': keyId.trim(), 'X-API-Secret': secret.trim() },
      });
      const data = await resp.json();
      if (!resp.ok) { setError(data?.message || `Xato (HTTP ${resp.status})`); return; }
      const auth = { keyId: keyId.trim(), secret: secret.trim(), whoami: data };
      sessionStorage.setItem('xt_dev_api_auth', JSON.stringify(auth));
      onLogin(auth);
    } catch (e: any) {
      setError(e?.message || 'Tarmoq xatosi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-200">
        {/* subtle grid bg */}
        <div className="absolute inset-0 pointer-events-none [background-image:linear-gradient(to_right,rgba(0,0,0,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.04)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="absolute -top-20 -right-20 w-[500px] h-[500px] bg-gradient-to-br from-indigo-200/40 to-violet-200/40 rounded-full blur-3xl pointer-events-none" />

        <div className="relative w-full px-4 lg:px-8 xl:px-12 pt-12 pb-16 grid lg:grid-cols-[1fr_1fr] gap-10 items-center max-w-[1700px] mx-auto">
          {/* Left — 3D model */}
          <div className="relative h-[420px] lg:h-[560px]">
            <Api3dHero className="absolute inset-0" />
            {/* Bottom centered minimal label */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-md ring-1 ring-slate-200 text-[11px] font-bold uppercase tracking-widest text-slate-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              API · v1 · Production ready
            </div>
          </div>

          {/* Right — Login card */}
          <div className="lg:max-w-md w-full mx-auto lg:ml-auto">
            <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-2xl shadow-indigo-500/5 p-6 lg:p-7">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 grid place-items-center shadow-md">
                  <KeyRound className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-[15px] font-black text-slate-900 leading-tight">API kalitini kiriting</h2>
                  <p className="text-[11.5px] text-slate-500 mt-0.5 leading-relaxed">
                    Administrator beradigan key + secret
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-1 block">X-API-Key</label>
                  <input
                    type="text"
                    value={keyId}
                    onChange={(e) => setKeyId(e.target.value)}
                    placeholder="xk_live_..."
                    className="w-full h-11 px-3 rounded-lg bg-slate-50 ring-1 ring-slate-200 focus:ring-indigo-500 focus:bg-white outline-none text-[13px] font-mono text-slate-800 placeholder:text-slate-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-1 flex items-center justify-between">
                    <span>X-API-Secret</span>
                    <button type="button" onClick={() => setShowSecret(!showSecret)} className="text-slate-400 hover:text-slate-700 normal-case font-normal">
                      {showSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                  </label>
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="xs_live_..."
                    onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }}
                    className="w-full h-11 px-3 rounded-lg bg-slate-50 ring-1 ring-slate-200 focus:ring-indigo-500 focus:bg-white outline-none text-[13px] font-mono text-slate-800 placeholder:text-slate-400 transition-colors"
                  />
                </div>

                {error && (
                  <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 px-3 py-2 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 text-rose-500 mt-0.5 shrink-0" />
                    <div className="text-[11.5px] text-rose-700 leading-relaxed">{error}</div>
                  </div>
                )}

                <button
                  onClick={doLogin}
                  disabled={loading || !keyId.trim() || !secret.trim()}
                  className="w-full h-11 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-[13px] flex items-center justify-center gap-2 transition-all"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Kirish <ArrowRight className="h-4 w-4" /></>}
                </button>
              </div>

              <div className="text-[11px] text-slate-500 text-center mt-5 leading-relaxed">
                Tokeningiz yo'qmi? Admin bilan bog'laning yoki{' '}
                <a href="https://t.me/Tm_SaMaR" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline font-medium">@Tm_SaMaR</a> ga yozing.
              </div>
            </div>
          </div>
        </div>
      </section>

    </>
  );
}

function Pill({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-100 ring-1 ring-slate-200 text-[11px] font-medium text-slate-700">
      <Icon className="h-3 w-3 text-indigo-600" />
      {text}
    </div>
  );
}

function MethodBadge({ method }: { method: 'GET' | 'POST' }) {
  return (
    <span className={cn(
      'px-1.5 py-0.5 rounded font-mono text-[10px] font-bold',
      method === 'GET' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700',
    )}>{method}</span>
  );
}

// ════════════════════════════════════════════════════════
// AUTHENTICATED VIEW — sidebar + main panel
// ════════════════════════════════════════════════════════
function AuthenticatedView({ authed }: { authed: { keyId: string; secret: string; whoami: any } }) {
  const [activeEp, setActiveEp] = useState<string>(ENDPOINTS[0].path);
  const [search, setSearch] = useState('');
  const whoami = authed.whoami?.key;
  const scopes: string[] = whoami?.scopes || [];
  const accessible = (ep: Endpoint) => !ep.scope || scopes.includes(ep.scope);

  const filtered = useMemo(() => {
    if (!search.trim()) return ENDPOINTS;
    const t = search.toLowerCase();
    return ENDPOINTS.filter((ep) =>
      ep.title.toLowerCase().includes(t) ||
      ep.path.toLowerCase().includes(t) ||
      ep.description.toLowerCase().includes(t),
    );
  }, [search]);

  const groups = groupEndpoints(filtered);
  const current = ENDPOINTS.find((e) => e.path === activeEp);

  return (
    <div className="w-full px-4 lg:px-6 xl:px-8 py-6 grid lg:grid-cols-[320px_1fr] gap-6 max-w-[1900px] mx-auto">
      {/* SIDEBAR */}
      <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-110px)] lg:overflow-y-auto -mx-2 px-2">
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Endpoint qidirish..."
            className="w-full h-9 pl-8 pr-3 rounded-lg bg-slate-50 ring-1 ring-slate-200 focus:ring-slate-400 focus:bg-white outline-none text-[12.5px]"
          />
        </div>

        {/* Endpoint groups */}
        <nav className="space-y-3">
          {groups.map((g) => (
            <div key={g.name}>
              <div className="px-2 mb-1 text-[10px] uppercase tracking-widest font-bold text-slate-400">
                {g.name}
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
                        active ? 'bg-slate-100 ring-1 ring-slate-200' : 'hover:bg-slate-50',
                        !allowed && 'opacity-40 cursor-not-allowed',
                      )}
                    >
                      <span className={cn(
                        'px-1 py-px rounded font-mono text-[8.5px] font-bold shrink-0 w-9 text-center',
                        ep.method === 'GET' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700',
                      )}>{ep.method}</span>
                      <span className="text-[12px] text-slate-700 truncate flex-1">{ep.title}</span>
                      {!allowed && <Lock className="h-2.5 w-2.5 text-slate-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* MAIN PANEL */}
      <main>
        {current && <EndpointDetail endpoint={current} authed={authed} allowed={accessible(current)} />}
      </main>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// ENDPOINT DETAIL — info + try-it + response + curl
// ════════════════════════════════════════════════════════
function EndpointDetail({
  endpoint, authed, allowed,
}: { endpoint: Endpoint; authed: { keyId: string; secret: string }; allowed: boolean }) {
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
      {/* Header */}
      <div>
        <div className="text-[10.5px] uppercase tracking-widest text-slate-400 font-bold mb-1.5">{endpoint.group}</div>
        <h1 className="text-2xl lg:text-3xl font-black tracking-tight text-slate-900">{endpoint.title}</h1>
        <p className="text-[14px] text-slate-600 mt-2 leading-relaxed">{endpoint.description}</p>

        <div className="flex items-center gap-3 mt-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 ring-1 ring-slate-200">
            <MethodBadge method={endpoint.method} />
            <code className="text-[12.5px] font-mono font-bold text-slate-800">{endpoint.path}</code>
          </div>
          {endpoint.scope && (
            <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <Lock className="h-3 w-3" />
              <code className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono font-bold">{endpoint.scope}</code>
            </div>
          )}
        </div>

        {!allowed && (
          <div className="mt-3 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-3 py-2.5 flex items-start gap-2">
            <Lock className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
            <div className="text-[12px] text-rose-700 leading-relaxed">
              Kalitingizda <code className="font-mono font-bold">{endpoint.scope}</code> scope yo'q. Administrator bilan bog'laning.
            </div>
          </div>
        )}
      </div>

      {/* Try-it */}
      <div className="rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
            <span className="text-[12.5px] font-bold text-slate-800">Try it</span>
          </div>
          <code className="text-[11px] text-slate-500 truncate max-w-[300px]" title={builtPath}>{builtPath}</code>
        </div>

        {endpoint.params && endpoint.params.length > 0 && (
          <div className="px-5 py-4 space-y-3 border-b border-slate-200">
            {endpoint.params.map((p) => (
              <div key={p.name} className="grid sm:grid-cols-[160px_1fr] gap-2 sm:gap-4 items-start">
                <div className="pt-1.5">
                  <div className="flex items-center gap-1">
                    <code className="text-[12px] font-mono font-bold text-slate-800">{p.name}</code>
                    {p.required && <span className="text-rose-500 text-[10px] font-bold">*</span>}
                  </div>
                  <div className="text-[9.5px] uppercase tracking-wider text-slate-400 mt-0.5">{p.in}</div>
                </div>
                <div>
                  <input
                    value={params[p.name] || ''}
                    onChange={(e) => setParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
                    placeholder={p.example || ''}
                    className="w-full h-9 px-3 rounded-lg bg-slate-50 ring-1 ring-slate-200 focus:ring-slate-400 focus:bg-white outline-none text-[12.5px] font-mono text-slate-800 placeholder:text-slate-400 transition-colors"
                  />
                  <div className="text-[11px] text-slate-500 mt-1">{p.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-5 py-3 flex items-center justify-end gap-2">
          <button
            onClick={execute}
            disabled={loading || !allowed}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-[12.5px] transition-all"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-white" />}
            Ishga tushirish
          </button>
        </div>
      </div>

      {/* Response */}
      {response && (
        <div className="rounded-xl ring-1 ring-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                'px-2 py-0.5 rounded font-mono text-[11px] font-bold',
                response.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700',
              )}>
                {response.status}
              </span>
              <span className="text-[11px] text-slate-500 tabular-nums">{response.ms}ms</span>
              <span className="text-[11px] text-slate-400">Response</span>
            </div>
          </div>
          <pre className="px-5 py-4 text-[11.5px] font-mono text-slate-800 leading-relaxed max-h-[500px] overflow-auto bg-white whitespace-pre-wrap break-all">
            {typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2)}
          </pre>
        </div>
      )}

      {/* curl */}
      <div className="rounded-xl ring-1 ring-slate-800 bg-slate-950 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">curl</span>
          </div>
          <button onClick={copyCurl} className="inline-flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-emerald-400">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Nusxalandi' : 'Nusxalash'}
          </button>
        </div>
        <pre className="px-4 py-3 text-[11.5px] font-mono text-emerald-300 overflow-x-auto">{curlText}</pre>
      </div>
    </div>
  );
}
