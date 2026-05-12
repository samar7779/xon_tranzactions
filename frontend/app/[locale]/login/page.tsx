'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Loader2, ArrowRight, Eye, EyeOff,
  Mail, Lock, AlertCircle, CornerDownLeft, ShieldCheck,
} from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LanguageSwitcher } from '@/components/language-switcher';

export default function LoginPage() {
  const t = useTranslations('auth');
  const tApp = useTranslations('app');
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const login = useAuth((s) => s.login);
  const token = useAuth((s) => s.token);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sichqoncha kuzatuvchi spotlight — premium signature effect
  const cardRef = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState({ x: 0, y: 0, active: false });

  // Real-vaqt soat (Toshkent)
  const [clock, setClock] = useState({ time: '', date: '' });

  useEffect(() => {
    if (token) router.replace(`/${locale}/dashboard`);
  }, [token, router, locale]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const time = now.toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Asia/Tashkent', hour12: false,
      });
      const date = now.toLocaleDateString('en-GB', {
        weekday: 'short', day: '2-digit', month: 'short',
        timeZone: 'Asia/Tashkent',
      });
      setClock({ time, date });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSpot({ x: e.clientX - r.left, y: e.clientY - r.top, active: true });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setBusy(true);
    try {
      await login(email, password);
      toast.success(t('welcome'));
      router.replace(`/${locale}/dashboard`);
    } catch (err: any) {
      const msg = err?.message || t('invalidCredentials');
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06070d] text-white selection:bg-indigo-500/30">

      {/* ─── Fon qatlamlari ─── */}
      <Backdrop />

      {/* ─── Yuqori panel: brand + soat + til ─── */}
      <header className="absolute top-0 left-0 right-0 z-30 px-6 sm:px-10 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LogoMark />
          <div>
            <div className="text-[13px] font-semibold tracking-tight">{tApp('title')}</div>
            <div className="text-[10px] text-white/40 uppercase tracking-[0.18em]">Xon Saroy</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full
                          bg-white/[0.04] border border-white/8 backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            <span className="text-[11px] text-white/55 font-mono tabular-nums">{clock.time}</span>
            <span className="text-[11px] text-white/30">·</span>
            <span className="text-[11px] text-white/40">{clock.date} · Tashkent</span>
          </div>
          <div className="rounded-full p-0.5 bg-white/[0.04] border border-white/8 backdrop-blur">
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      {/* ─── Markaz: forma ustuni ─── */}
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-24">
        {/* Sarlavha — kartadan tashqarida, premium hierarchy */}
        <div className="text-center mb-9 animate-fade-up">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                          bg-indigo-500/10 border border-indigo-400/20 text-indigo-300
                          text-[10px] font-medium tracking-[0.15em] uppercase mb-5">
            <ShieldCheck className="h-3 w-3" />
            Secure access
          </div>

          <h1 className="text-[34px] sm:text-[40px] font-semibold leading-[1.05] tracking-tight">
            <span className="text-white/95">Welcome</span>{' '}
            <span className="bg-gradient-to-r from-indigo-300 via-blue-300 to-cyan-300 bg-clip-text text-transparent">
              back
            </span>
          </h1>
          <p className="mt-3 text-[14px] text-white/45 max-w-sm mx-auto">
            {t('loginSubtitle')}
          </p>
        </div>

        {/* Karta — spotlight effekt bilan */}
        <div
          ref={cardRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setSpot((s) => ({ ...s, active: false }))}
          className="relative w-full max-w-[420px] rounded-2xl p-7 sm:p-8
                     bg-[rgba(13,15,28,0.6)] backdrop-blur-2xl
                     border border-white/8
                     shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]
                     animate-card-in"
        >
          {/* Spotlight gradient — sichqonchani kuzatadi */}
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300"
            style={{
              opacity: spot.active ? 1 : 0,
              background: `radial-gradient(420px circle at ${spot.x}px ${spot.y}px, rgba(99,102,241,0.13), transparent 45%)`,
            }}
          />
          {/* Yuqori chiziq — premium accent */}
          <div className="pointer-events-none absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-indigo-400/60 to-transparent" />

          {/* Forma */}
          <form onSubmit={onSubmit} className="relative space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[11px] font-medium text-white/55 uppercase tracking-wider">
                {t('email')}
              </Label>
              <div className="relative group">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/35 group-focus-within:text-indigo-300 transition-colors pointer-events-none" />
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setErrorMsg(null); }}
                  autoFocus
                  required
                  placeholder="admin@xon.local"
                  className="h-12 pl-10 text-[15px] text-white placeholder:text-white/25
                             bg-white/[0.03] border-white/8 rounded-xl
                             focus-visible:ring-2 focus-visible:ring-indigo-400/30 focus-visible:border-indigo-400/50
                             focus-visible:bg-white/[0.05]
                             transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[11px] font-medium text-white/55 uppercase tracking-wider">
                  {t('password')}
                </Label>
                {capsOn && (
                  <span className="text-[10px] text-amber-300 flex items-center gap-1 animate-fade-up uppercase tracking-wider">
                    <AlertCircle className="h-3 w-3" />
                    Caps Lock
                  </span>
                )}
              </div>
              <div className="relative group">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/35 group-focus-within:text-indigo-300 transition-colors pointer-events-none" />
                <Input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErrorMsg(null); }}
                  onKeyUp={(e) => setCapsOn(e.getModifierState && e.getModifierState('CapsLock'))}
                  onKeyDown={(e) => setCapsOn(e.getModifierState && e.getModifierState('CapsLock'))}
                  required
                  placeholder="••••••••"
                  className="h-12 pl-10 pr-11 text-[15px] text-white placeholder:text-white/25
                             bg-white/[0.03] border-white/8 rounded-xl
                             focus-visible:ring-2 focus-visible:ring-indigo-400/30 focus-visible:border-indigo-400/50
                             focus-visible:bg-white/[0.05]
                             transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center
                             rounded-lg text-white/40 hover:text-white hover:bg-white/8
                             transition-colors"
                  tabIndex={-1}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl
                              bg-rose-500/8 border border-rose-400/25 text-[13px] text-rose-200
                              animate-fade-up">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="relative w-full h-12 mt-2 rounded-xl font-medium text-[15px] text-white
                         bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500
                         shadow-[0_10px_30px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_0_rgba(255,255,255,0.15)]
                         hover:shadow-[0_14px_40px_-8px_rgba(99,102,241,0.85),inset_0_1px_0_0_rgba(255,255,255,0.2)]
                         hover:brightness-110 active:scale-[0.99]
                         disabled:opacity-60 disabled:hover:brightness-100
                         transition-all duration-200
                         flex items-center justify-center gap-2 group overflow-hidden"
            >
              <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full
                               bg-gradient-to-r from-transparent via-white/25 to-transparent
                               transition-transform duration-700 ease-out" />
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('submitting')}
                </>
              ) : (
                <>
                  <span className="relative">{t('submit')}</span>
                  <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-1" />
                  <kbd className="relative ml-1 hidden sm:inline-flex items-center justify-center h-5 w-5 rounded
                                  border border-white/25 bg-white/10 text-[10px]">
                    <CornerDownLeft className="h-2.5 w-2.5" />
                  </kbd>
                </>
              )}
            </button>
          </form>

          {/* Karta ichidagi xavfsizlik chip */}
          <div className="relative mt-6 pt-5 border-t border-white/8 flex items-center justify-center gap-2 text-[11px] text-white/35">
            <ShieldCheck className="h-3 w-3" />
            <span>End-to-end shifrlash · AES-256 · JWT auth</span>
          </div>
        </div>

        {/* Karta ostida — partner banklar (subtle) */}
        <div className="mt-10 flex flex-col items-center gap-3 animate-fade-up" style={{ animationDelay: '0.15s' }}>
          <div className="text-[10px] text-white/30 uppercase tracking-[0.2em]">Integrated banks</div>
          <div className="flex items-center gap-5 text-[12px] text-white/45 font-medium tracking-wide">
            <span>KAPITALBANK</span>
            <span className="w-1 h-1 rounded-full bg-white/15" />
            <span>UZUM BANK</span>
            <span className="w-1 h-1 rounded-full bg-white/15" />
            <span>UPC</span>
          </div>
        </div>
      </main>

      {/* ─── Pastki bar ─── */}
      <footer className="absolute bottom-0 left-0 right-0 z-10 px-6 sm:px-10 py-5
                         flex items-center justify-between text-[11px] text-white/30">
        <span>© {new Date().getFullYear()} Xon Saroy · Internal system</span>
        <span className="hidden sm:inline">v1.0 · build {process.env.NODE_ENV?.slice(0,4) || 'dev'}</span>
      </footer>

      <style jsx>{`
        @keyframes card-in {
          from { opacity: 0; transform: translateY(12px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        :global(.animate-card-in) {
          animation: card-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes beam {
          0%   { transform: translateX(-100%); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateX(100%); opacity: 0; }
        }
        :global(.animate-beam) {
          animation: beam 14s linear infinite;
        }
        @keyframes scan {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        :global(.animate-scan) {
          animation: scan 18s linear infinite;
        }
      `}</style>
    </div>
  );
}

/* ─── Fon: aurora + grid + scan line ─── */
function Backdrop() {
  return (
    <>
      {/* Yuqorida yagona warm glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px]
                      bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.25)_0%,rgba(59,130,246,0.12)_25%,transparent_60%)]
                      blur-2xl pointer-events-none" />

      {/* Past o'ng — cyan accent */}
      <div className="absolute bottom-0 right-0 w-[700px] h-[500px]
                      bg-[radial-gradient(ellipse_at_bottom_right,rgba(6,182,212,0.15)_0%,transparent_60%)]
                      pointer-events-none" />

      {/* Past chap — fuchsia accent */}
      <div className="absolute bottom-1/4 left-0 w-[500px] h-[400px]
                      bg-[radial-gradient(ellipse_at_bottom_left,rgba(217,70,239,0.08)_0%,transparent_55%)]
                      pointer-events-none" />

      {/* Grid */}
      <div className="absolute inset-0 opacity-[0.025] pointer-events-none"
           style={{
             backgroundImage:
               'linear-gradient(to right, rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,1) 1px, transparent 1px)',
             backgroundSize: '56px 56px',
             maskImage: 'radial-gradient(ellipse 80% 60% at 50% 50%, #000 30%, transparent 75%)',
             WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 50%, #000 30%, transparent 75%)',
           }} />

      {/* Scan line — yagona sekin tushuvchi chiziq */}
      <div className="absolute inset-x-0 h-[2px] pointer-events-none animate-scan
                      bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent
                      shadow-[0_0_20px_rgba(99,102,241,0.6)]" />

      {/* Yuqori horizontal beam */}
      <div className="absolute top-[20%] inset-x-0 h-px overflow-hidden pointer-events-none">
        <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent animate-beam" />
      </div>

      {/* Noise grain — qog'oz tuyg'usi */}
      <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay pointer-events-none"
           style={{
             backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' /%3E%3C/svg%3E\")",
           }} />

      {/* Yulduz nuqtalar */}
      <div className="absolute inset-0 opacity-[0.18] pointer-events-none"
           style={{
             backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)',
             backgroundSize: '90px 90px',
             maskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, #000 20%, transparent 75%)',
             WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, #000 20%, transparent 75%)',
           }} />
    </>
  );
}

function LogoMark() {
  return (
    <div className="relative w-11 h-11 rounded-xl grid place-items-center
                    bg-gradient-to-br from-indigo-500/20 to-blue-500/10
                    border border-white/10
                    shadow-[0_8px_24px_-8px_rgba(99,102,241,0.6),inset_0_1px_0_0_rgba(255,255,255,0.1)]">
      {/* Glow halo */}
      <div className="absolute inset-0 rounded-xl bg-indigo-500/20 blur-xl -z-10" />
      <svg viewBox="0 0 64 64" className="w-6 h-6" aria-hidden>
        <path d="M22 16 L22 40 M14 33 L22 41 L30 33"
          stroke="#34d399" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M42 48 L42 24 M34 31 L42 23 L50 31"
          stroke="#fb7185" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    </div>
  );
}
