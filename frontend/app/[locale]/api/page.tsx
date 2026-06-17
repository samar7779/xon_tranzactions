'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Code2, KeyRound, Lock, ShieldCheck, CheckCircle2, Sparkles, ChevronDown, Play,
  Copy, Check, LogOut, Eye, EyeOff, Loader2, Globe, Activity, Zap, Infinity as InfinityIcon,
  AlertCircle, Server, ExternalLink, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ────────────────────────────────────────────────────────
// ENDPOINTS CATALOG (frontend'da hardcoded — backend bilan sinxron)
// ────────────────────────────────────────────────────────
interface Endpoint {
  method: 'GET' | 'POST';
  path: string;
  title: string;
  description: string;
  scope?: string;
  params?: { name: string; in: 'query' | 'path'; required?: boolean; description: string; example?: string }[];
}

const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/v1/_whoami',
    title: 'Whoami',
    description: 'Hozirgi API kalit ma\'lumotini qaytaradi — scope\'lar, nom, muddati.',
  },
  {
    method: 'GET',
    path: '/api/v1/transactions',
    title: 'Tranzaksiyalar ro\'yxati',
    description: 'Bank tranzaksiyalarini filter va pagination bilan olish.',
    scope: 'transactions:read',
    params: [
      { name: 'page', in: 'query', description: 'Sahifa (default 1)', example: '1' },
      { name: 'perPage', in: 'query', description: 'Sahifada (max 200)', example: '50' },
      { name: 'accountId', in: 'query', description: 'Hisob ID', example: '' },
      { name: 'direction', in: 'query', description: 'IN yoki OUT', example: 'IN' },
      { name: 'dateFrom', in: 'query', description: 'Sanadan (YYYY-MM-DD)', example: '2026-01-01' },
      { name: 'dateTo', in: 'query', description: 'Sanagacha (YYYY-MM-DD)', example: '2026-12-31' },
      { name: 'q', in: 'query', description: 'Erkin qidiruv', example: '' },
    ],
  },
  {
    method: 'GET',
    path: '/api/v1/transactions/{id}',
    title: 'Tranzaksiya tafsiloti',
    description: 'ID bo\'yicha bitta tranzaksiya.',
    scope: 'transactions:read',
    params: [
      { name: 'id', in: 'path', required: true, description: 'Tranzaksiya ID', example: '' },
    ],
  },
  {
    method: 'GET',
    path: '/api/v1/oplata-kv',
    title: 'ОплатыКв ro\'yxati',
    description: 'Kvartira to\'lovlari (Дог, sana, summa, mijoz, obyekt).',
    scope: 'oplatakv:read',
    params: [
      { name: 'page', in: 'query', description: 'Sahifa', example: '1' },
      { name: 'perPage', in: 'query', description: 'Sahifada', example: '50' },
      { name: 'contractNo', in: 'query', description: 'Shartnoma raqami', example: '' },
      { name: 'dateFrom', in: 'query', description: 'Sanadan', example: '' },
      { name: 'dateTo', in: 'query', description: 'Sanagacha', example: '' },
      { name: 'q', in: 'query', description: 'Qidirish (mijoz, obyekt, izoh)', example: '' },
    ],
  },
  {
    method: 'GET',
    path: '/api/v1/oplata-kv/{id}',
    title: 'ОплатыКв qator tafsiloti',
    description: 'ID bo\'yicha bitta to\'lov qatori.',
    scope: 'oplatakv:read',
    params: [
      { name: 'id', in: 'path', required: true, description: 'OplataKv ID', example: '' },
    ],
  },
  {
    method: 'GET',
    path: '/api/v1/accounts',
    title: 'Hisob raqamlar',
    description: 'Bank hisoblari ro\'yxati. Bank credentials va parollar BERILMAYDI.',
    scope: 'accounts:read',
    params: [
      { name: 'q', in: 'query', description: 'Qidirish', example: '' },
    ],
  },
  {
    method: 'GET',
    path: '/api/v1/accounts/{id}',
    title: 'Hisob tafsiloti',
    description: 'ID bo\'yicha bitta hisob.',
    scope: 'accounts:read',
    params: [{ name: 'id', in: 'path', required: true, description: 'Account ID', example: '' }],
  },
  {
    method: 'GET',
    path: '/api/v1/counterparties',
    title: 'Kontragentlar',
    description: 'Kontragentlar ro\'yxati (INN, nomi, reyting).',
    scope: 'counterparties:read',
    params: [
      { name: 'page', in: 'query', description: 'Sahifa', example: '1' },
      { name: 'perPage', in: 'query', description: 'Sahifada', example: '50' },
      { name: 'q', in: 'query', description: 'INN yoki nom', example: '' },
    ],
  },
  {
    method: 'GET',
    path: '/api/v1/counterparties/{inn}',
    title: 'Kontragent tafsiloti (INN)',
    description: 'INN bo\'yicha kontragent.',
    scope: 'counterparties:read',
    params: [{ name: 'inn', in: 'path', required: true, description: 'INN (9/14 raqam)', example: '305212378' }],
  },
];

// ────────────────────────────────────────────────────────
// MAIN PAGE
// ────────────────────────────────────────────────────────
export default function DeveloperApiPage() {
  const { locale } = useParams<{ locale: string }>();
  const [keyId, setKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [authedKey, setAuthedKey] = useState<{ keyId: string; secret: string; whoami: any } | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Reload from sessionStorage (login persistsa, lekin tab yopilsa o'chadi)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('xt_dev_api_auth');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.keyId && parsed?.secret) {
          setAuthedKey(parsed);
        }
      }
    } catch { /* ignore */ }
  }, []);

  const doLogin = async () => {
    setLoginError(null);
    if (!keyId.trim() || !secret.trim()) {
      setLoginError('Key va Secret majburiy');
      return;
    }
    setLoginLoading(true);
    try {
      const resp = await fetch(`${window.location.origin}/api/v1/_whoami`, {
        headers: { 'X-API-Key': keyId.trim(), 'X-API-Secret': secret.trim() },
      });
      const data = await resp.json();
      if (!resp.ok) {
        setLoginError(data?.message || data?.error?.message || `Xato (HTTP ${resp.status})`);
        return;
      }
      const auth = { keyId: keyId.trim(), secret: secret.trim(), whoami: data };
      setAuthedKey(auth);
      sessionStorage.setItem('xt_dev_api_auth', JSON.stringify(auth));
      setKeyId('');
      setSecret('');
    } catch (e: any) {
      setLoginError(e?.message || 'Tarmoq xatosi');
    } finally {
      setLoginLoading(false);
    }
  };

  const doLogout = () => {
    setAuthedKey(null);
    sessionStorage.removeItem('xt_dev_api_auth');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 relative overflow-x-hidden">
      {/* Background gradient blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-20 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl" />
        {/* Floating endpoint pills */}
        <FloatingPills />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-slate-800/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 grid place-items-center shadow-lg shadow-amber-500/30">
              <Code2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="font-black tracking-tight text-white text-[15px] leading-none">Xon Tranzaksiyalar</div>
              <div className="text-[10px] uppercase tracking-widest text-amber-400 font-bold mt-0.5">Developer API · v1</div>
            </div>
          </div>
          {authedKey && (
            <button
              onClick={doLogout}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-[12px] font-semibold text-slate-300 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" /> Chiqish
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        {!authedKey ? (
          <LandingView
            keyId={keyId}
            setKeyId={setKeyId}
            secret={secret}
            setSecret={setSecret}
            showSecret={showSecret}
            setShowSecret={setShowSecret}
            onLogin={doLogin}
            loginLoading={loginLoading}
            loginError={loginError}
          />
        ) : (
          <AuthenticatedView authed={authedKey} />
        )}
      </main>

      <footer className="relative z-10 border-t border-slate-800/60 mt-20">
        <div className="max-w-7xl mx-auto px-6 py-6 text-center text-[11px] text-slate-500">
          <span>© Xon Saroy · Tranzaksiyalar tizimi · Developer API</span>
          <span className="mx-2 text-slate-700">·</span>
          <a href={`/${locale}/dashboard`} className="text-slate-400 hover:text-amber-400 inline-flex items-center gap-1">
            Asosiy panelga qaytish <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </footer>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// FLOATING PILLS (decorative background)
// ────────────────────────────────────────────────────────
function FloatingPills() {
  const pills = [
    { method: 'GET', path: '/api/v1/transactions', top: '15%', left: '8%' },
    { method: 'GET', path: '/api/v1/oplata-kv', top: '32%', right: '10%' },
    { method: 'GET', path: '/api/v1/accounts', top: '55%', left: '5%' },
    { method: 'GET', path: '/api/v1/counterparties', top: '70%', right: '6%' },
    { method: 'GET', path: '/api/v1/_whoami', top: '85%', left: '20%' },
  ];
  return (
    <>
      {pills.map((p, i) => (
        <div
          key={i}
          className="absolute hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/40 ring-1 ring-slate-700/60 backdrop-blur-sm text-[10px] font-mono opacity-50"
          style={{ top: p.top, left: p.left, right: p.right }}
        >
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">{p.method}</span>
          <span className="text-slate-400">{p.path}</span>
        </div>
      ))}
    </>
  );
}

// ────────────────────────────────────────────────────────
// LANDING VIEW (not authenticated)
// ────────────────────────────────────────────────────────
function LandingView({
  keyId, setKeyId, secret, setSecret, showSecret, setShowSecret,
  onLogin, loginLoading, loginError,
}: {
  keyId: string; setKeyId: (v: string) => void;
  secret: string; setSecret: (v: string) => void;
  showSecret: boolean; setShowSecret: (v: boolean) => void;
  onLogin: () => void;
  loginLoading: boolean;
  loginError: string | null;
}) {
  return (
    <div className="grid lg:grid-cols-[1.3fr_1fr] gap-10 lg:gap-16 items-center">
      {/* Left — hero */}
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 ring-1 ring-amber-500/30 text-amber-300 text-[11px] font-bold uppercase tracking-widest mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          v1 · Production Ready
        </div>
        <h1 className="text-4xl lg:text-6xl font-black tracking-tight text-white leading-[1.05]">
          Xon Tranzaksiyalar uchun<br />
          <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 bg-clip-text text-transparent">
            Developer API
          </span>
        </h1>
        <p className="text-[15px] lg:text-[16px] text-slate-400 mt-5 leading-relaxed max-w-xl">
          Tashqi tizim integratsiyasi uchun zamonaviy REST API. Token bilan himoyalangan,
          scope orqali nazorat ostida, JSON javoblar — Postman, Python, JS yoki istalgan
          HTTP klient bilan.
        </p>

        {/* Curl example */}
        <div className="mt-8 rounded-2xl bg-slate-900/80 ring-1 ring-slate-800 overflow-hidden shadow-2xl shadow-amber-500/5">
          <div className="px-4 py-2.5 bg-slate-800/60 border-b border-slate-800 flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-rose-500/80" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
            </div>
            <span className="ml-3 text-[11px] text-slate-500 font-mono">~ / xon-tranzaksiyalar-api · v1</span>
          </div>
          <pre className="px-4 py-4 text-[12px] font-mono text-slate-300 leading-relaxed overflow-x-auto">
            <span className="text-amber-400">$</span> <span className="text-emerald-400">curl</span> https://transactions.xonapps.uz/api/v1/transactions \{'\n'}
            {'  '}-H <span className="text-orange-300">"X-API-Key: xk_live_xxxxxxx"</span> \{'\n'}
            {'  '}-H <span className="text-orange-300">"X-API-Secret: xs_live_xxxxxxx"</span>{'\n'}
            <span className="text-slate-500">{'{ "ok": true, "total": 1234, "items": [...] }'}</span>
          </pre>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mt-8">
          <StatPill icon={Activity} label="UPTIME" value="99.9%" />
          <StatPill icon={Server} label="ENDPOINT'LAR" value={`${ENDPOINTS.length}+`} />
          <StatPill icon={Zap} label="LATENCY" value="<100ms" />
          <StatPill icon={InfinityIcon} label="TOKENLAR" value="∞" />
        </div>
      </div>

      {/* Right — login card */}
      <div className="lg:max-w-[420px] w-full mx-auto">
        <div className="rounded-3xl bg-slate-900/80 ring-1 ring-slate-800 backdrop-blur-sm shadow-2xl shadow-amber-500/10 p-6 lg:p-7">
          <div className="text-center mb-6">
            <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 items-center justify-center shadow-lg shadow-amber-500/40 mb-4">
              <Lock className="h-7 w-7 text-white" />
            </div>
            <h2 className="text-xl font-black text-white tracking-tight">API kalitini kiriting</h2>
            <p className="text-[12px] text-slate-400 mt-1.5 leading-relaxed">
              Tashqi tizim integratsiyasi uchun administrator beradigan API tokeningizni kiriting.
            </p>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <KeyRound className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-amber-400/60" />
              <input
                type="text"
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
                placeholder="xk_live_..."
                className="w-full h-12 pl-10 pr-3 rounded-xl bg-slate-800/60 ring-1 ring-slate-700 focus:ring-amber-500 outline-none text-[13px] font-mono text-slate-200 placeholder:text-slate-600"
              />
            </div>
            <div className="relative">
              <Lock className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-amber-400/60" />
              <input
                type={showSecret ? 'text' : 'password'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="xs_live_..."
                onKeyDown={(e) => { if (e.key === 'Enter') onLogin(); }}
                className="w-full h-12 pl-10 pr-10 rounded-xl bg-slate-800/60 ring-1 ring-slate-700 focus:ring-amber-500 outline-none text-[13px] font-mono text-slate-200 placeholder:text-slate-600"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-amber-400"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {loginError && (
              <div className="rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
                <div className="text-[12px] text-rose-300 leading-relaxed">{loginError}</div>
              </div>
            )}

            <button
              onClick={onLogin}
              disabled={loginLoading || !keyId.trim() || !secret.trim()}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50"
            >
              {loginLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Kirish <ChevronDown className="h-4 w-4 -rotate-90" /></>}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            <Feature icon={ShieldCheck} text="SHA-256 hash" />
            <Feature icon={CheckCircle2} text="Scope nazorati" />
            <Feature icon={Sparkles} text="Audit log" />
          </div>

          <div className="text-[11px] text-slate-500 text-center mt-5 leading-relaxed">
            Tokeningiz yo'qmi? Administrator bilan bog'laning yoki{' '}
            <a href="https://t.me/Tm_SaMaR" target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">@Tm_SaMaR</a> ga yozing.
          </div>
        </div>
      </div>
    </div>
  );
}

function StatPill({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-900/60 ring-1 ring-slate-800 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-amber-400/80 font-bold">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-xl lg:text-2xl font-black text-white mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function Feature({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="inline-flex items-center gap-1 text-[10px] text-slate-400 justify-center">
      <Icon className="h-3 w-3 text-emerald-400" />
      <span>{text}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// AUTHENTICATED VIEW
// ────────────────────────────────────────────────────────
function AuthenticatedView({ authed }: { authed: { keyId: string; secret: string; whoami: any } }) {
  const [expanded, setExpanded] = useState<string | null>(ENDPOINTS[0].path);
  const whoami = authed.whoami?.key;
  const scopes: string[] = whoami?.scopes || [];

  const accessible = (ep: Endpoint) => !ep.scope || scopes.includes(ep.scope);

  return (
    <div className="grid lg:grid-cols-[1fr_2fr] gap-8">
      {/* Sidebar — whoami + endpoints */}
      <aside className="space-y-5">
        {/* Whoami card */}
        <div className="rounded-2xl bg-slate-900/80 ring-1 ring-slate-800 p-5">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Tizimga ulangan
          </div>
          <div className="text-white font-black text-lg tracking-tight truncate">{whoami?.name || 'API kalit'}</div>
          {whoami?.description && (
            <div className="text-[11.5px] text-slate-400 mt-1 leading-relaxed">{whoami.description}</div>
          )}
          <div className="mt-3 px-2.5 py-1.5 rounded-lg bg-slate-800/60 font-mono text-[10.5px] text-amber-300 break-all">
            {authed.keyId}
          </div>
          {whoami?.expiresAt && (
            <div className="text-[10.5px] text-slate-500 mt-2">
              Muddati: <b className="text-slate-300 tabular-nums">{new Date(whoami.expiresAt).toLocaleString('ru-RU')}</b>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-1">
            {scopes.map((s: string) => (
              <span key={s} className="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold bg-indigo-500/15 ring-1 ring-indigo-500/30 text-indigo-300">
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Endpoint list */}
        <div className="rounded-2xl bg-slate-900/80 ring-1 ring-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-400 font-bold">
            Endpoint'lar
          </div>
          <div className="divide-y divide-slate-800/60">
            {ENDPOINTS.map((ep) => {
              const allowed = accessible(ep);
              const active = expanded === ep.path;
              return (
                <button
                  key={ep.path}
                  onClick={() => setExpanded(ep.path)}
                  disabled={!allowed}
                  className={cn(
                    'w-full text-left px-4 py-3 flex items-center gap-2 transition-colors',
                    active ? 'bg-amber-500/10' : 'hover:bg-slate-800/40',
                    !allowed && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  <span className={cn(
                    'px-1.5 py-0.5 rounded font-mono text-[9px] font-bold',
                    ep.method === 'GET' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400',
                  )}>{ep.method}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-bold text-slate-200 truncate">{ep.title}</div>
                    <code className="text-[10px] font-mono text-slate-500 truncate block">{ep.path}</code>
                  </div>
                  {!allowed && <Lock className="h-3 w-3 text-slate-600" />}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Right — endpoint detail + try-it */}
      <section>
        {expanded ? (
          <TryItPanel
            endpoint={ENDPOINTS.find((e) => e.path === expanded)!}
            authed={authed}
            allowed={accessible(ENDPOINTS.find((e) => e.path === expanded)!)}
          />
        ) : (
          <div className="rounded-2xl bg-slate-900/40 ring-1 ring-slate-800 p-12 text-center text-slate-500">
            Chap tomondan endpoint tanlang
          </div>
        )}
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// TRY-IT PANEL
// ────────────────────────────────────────────────────────
function TryItPanel({
  endpoint, authed, allowed,
}: { endpoint: Endpoint; authed: { keyId: string; secret: string }; allowed: boolean }) {
  const [params, setParams] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<{ status: number; data: any; ms: number; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Reset params on endpoint change
    const initial: Record<string, string> = {};
    (endpoint.params || []).forEach((p) => { initial[p.name] = p.example || ''; });
    setParams(initial);
    setResponse(null);
  }, [endpoint.path]);

  const buildUrl = useMemo(() => {
    let path = endpoint.path;
    // Path params
    (endpoint.params || []).filter((p) => p.in === 'path').forEach((p) => {
      const v = params[p.name] || `{${p.name}}`;
      path = path.replace(`{${p.name}}`, encodeURIComponent(v));
    });
    // Query params
    const qs = new URLSearchParams();
    (endpoint.params || []).filter((p) => p.in === 'query').forEach((p) => {
      const v = (params[p.name] || '').trim();
      if (v) qs.set(p.name, v);
    });
    const qsStr = qs.toString();
    return path + (qsStr ? '?' + qsStr : '');
  }, [endpoint, params]);

  const execute = async () => {
    setLoading(true);
    setResponse(null);
    const start = Date.now();
    try {
      const resp = await fetch(`${window.location.origin}${buildUrl}`, {
        method: endpoint.method,
        headers: {
          'X-API-Key': authed.keyId,
          'X-API-Secret': authed.secret,
        },
      });
      const ms = Date.now() - start;
      const text = await resp.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = text; }
      setResponse({ status: resp.status, data, ms, ok: resp.ok });
    } catch (e: any) {
      setResponse({ status: 0, data: { error: e?.message || 'Network error' }, ms: Date.now() - start, ok: false });
    } finally {
      setLoading(false);
    }
  };

  const curlExample = useMemo(() => {
    return `curl ${window.location.origin}${buildUrl} \\
  -H "X-API-Key: ${authed.keyId}" \\
  -H "X-API-Secret: ${authed.secret}"`;
  }, [buildUrl, authed]);

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlExample);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="rounded-2xl bg-slate-900/80 ring-1 ring-slate-800 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-800 bg-gradient-to-br from-slate-900 to-slate-800/40">
        <div className="flex items-center gap-3">
          <span className={cn(
            'px-2 py-1 rounded font-mono text-[11px] font-bold',
            endpoint.method === 'GET' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400',
          )}>{endpoint.method}</span>
          <code className="font-mono text-[13px] text-white font-bold">{endpoint.path}</code>
        </div>
        <h2 className="text-xl font-black text-white mt-3">{endpoint.title}</h2>
        <p className="text-[12.5px] text-slate-400 mt-1 leading-relaxed">{endpoint.description}</p>
        {endpoint.scope && (
          <div className="mt-3 inline-flex items-center gap-1.5 text-[10.5px] text-slate-400">
            <Lock className="h-3 w-3" />
            Scope kerak: <code className="px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 font-mono font-bold">{endpoint.scope}</code>
          </div>
        )}
      </div>

      {!allowed && (
        <div className="px-6 py-4 bg-rose-500/10 border-b border-rose-500/30">
          <div className="flex items-start gap-2">
            <Lock className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
            <div className="text-[12.5px] text-rose-300">
              Sizning kalitingizda <code className="font-mono font-bold">{endpoint.scope}</code> scope yo'q.
              Administrator bilan bog'laning.
            </div>
          </div>
        </div>
      )}

      {/* Params */}
      {endpoint.params && endpoint.params.length > 0 && (
        <div className="px-6 py-4 border-b border-slate-800">
          <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-3">Parametrlar</div>
          <div className="space-y-2">
            {endpoint.params.map((p) => (
              <div key={p.name} className="grid grid-cols-[120px_1fr] gap-3 items-start">
                <div className="pt-2">
                  <code className="font-mono text-[11.5px] font-bold text-amber-300">{p.name}</code>
                  {p.required && <span className="text-rose-400 ml-1">*</span>}
                  <div className="text-[9.5px] uppercase tracking-wider text-slate-500 mt-0.5">{p.in}</div>
                </div>
                <div>
                  <input
                    value={params[p.name] || ''}
                    onChange={(e) => setParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
                    placeholder={p.example || p.description}
                    className="w-full h-9 px-3 rounded-lg bg-slate-800/60 ring-1 ring-slate-700 focus:ring-amber-500 outline-none text-[12px] font-mono text-slate-200 placeholder:text-slate-600"
                  />
                  <div className="text-[10.5px] text-slate-500 mt-1">{p.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Try button */}
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
        <code className="font-mono text-[11px] text-slate-400 truncate flex-1" title={buildUrl}>
          {buildUrl}
        </code>
        <button
          onClick={execute}
          disabled={loading || !allowed}
          className="inline-flex items-center gap-1.5 px-4 h-10 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-50 text-white font-bold shadow-lg shadow-amber-500/20 text-[13px] transition-all"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-white" />}
          Try it
        </button>
      </div>

      {/* Response */}
      {response && (
        <div className="px-6 py-4 border-b border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className={cn(
                'px-2 py-0.5 rounded font-mono text-[11px] font-bold',
                response.ok ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400',
              )}>
                {response.status}
              </span>
              <span className="text-[11px] text-slate-500 tabular-nums">{response.ms}ms</span>
            </div>
          </div>
          <pre className="rounded-lg bg-slate-950 ring-1 ring-slate-800 p-4 text-[11.5px] font-mono text-slate-300 max-h-[400px] overflow-auto whitespace-pre-wrap break-all">
            {typeof response.data === 'string'
              ? response.data
              : JSON.stringify(response.data, null, 2)}
          </pre>
        </div>
      )}

      {/* curl example */}
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400">curl misol</div>
          <button onClick={copyCurl} className="inline-flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-amber-400">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Nusxalandi' : 'Nusxalash'}
          </button>
        </div>
        <pre className="rounded-lg bg-slate-950 ring-1 ring-slate-800 p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto">{curlExample}</pre>
      </div>
    </div>
  );
}
