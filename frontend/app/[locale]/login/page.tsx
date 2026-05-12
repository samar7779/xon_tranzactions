'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Loader2, ArrowRight, Eye, EyeOff,
  Mail, Lock, AlertCircle,
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

  // 3D tilt + spotlight
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const [spot, setSpot] = useState({ x: 0, y: 0, active: false });

  useEffect(() => {
    if (token) router.replace(`/${locale}/dashboard`);
  }, [token, router, locale]);

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    // 3D tilt — markazga nisbatan, max ±5°
    const cx = r.width / 2;
    const cy = r.height / 2;
    const ry = ((x - cx) / cx) * 4;
    const rx = -((y - cy) / cy) * 4;
    setTilt({ rx, ry });
    setSpot({ x, y, active: true });
  }

  function handleLeave() {
    setTilt({ rx: 0, ry: 0 });
    setSpot((s) => ({ ...s, active: false }));
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
    <div className="relative min-h-screen overflow-hidden bg-[#fafbfd] text-slate-900
                    selection:bg-indigo-200/60">

      {/* ─── Boy gradient mesh fon ─── */}
      <VibrantBackdrop />

      {/* ─── Dekorativ wave chizig'i — fonda ─── */}
      <ChartWave />

      {/* ─── Yuqori panel ─── */}
      <header className="absolute top-0 left-0 right-0 z-30 px-6 sm:px-10 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 grid place-items-center shadow-sm">
            <svg viewBox="0 0 64 64" className="w-5 h-5" aria-hidden>
              <path d="M22 16 L22 40 M14 33 L22 41 L30 33"
                stroke="#22c55e" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d="M42 48 L42 24 M34 31 L42 23 L50 31"
                stroke="#f87171" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <div className="text-[13px] font-semibold tracking-tight text-slate-900">
            {tApp('title')}
          </div>
        </div>
        <LanguageSwitcher />
      </header>

      {/* ─── Markaz ─── */}
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-24"
            style={{ perspective: '1200px' }}>

        {/* Katta brand mark — kartadan tepada, dramatik */}
        <HeroLogo />

        {/* Karta — 3D tilt + spotlight */}
        <div
          ref={cardRef}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
          style={{
            transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
            transformStyle: 'preserve-3d',
            transition: 'transform 0.18s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          className="relative w-full max-w-[400px] animate-card-in mt-8"
        >
          {/* Animatsion gradient border halqa */}
          <div className="absolute -inset-px rounded-[20px] bg-[conic-gradient(from_0deg,rgba(99,102,241,0.4),rgba(6,182,212,0.4),rgba(236,72,153,0.4),rgba(99,102,241,0.4))] opacity-60 blur-[6px] animate-spin-slow" />

          <div className="relative rounded-2xl bg-white border border-slate-200/70
                          shadow-[0_30px_80px_-20px_rgba(15,23,42,0.18),0_8px_24px_-8px_rgba(99,102,241,0.12)]
                          overflow-hidden">

            {/* Spotlight glow */}
            <div
              className="pointer-events-none absolute inset-0 transition-opacity duration-300"
              style={{
                opacity: spot.active ? 1 : 0,
                background: `radial-gradient(420px circle at ${spot.x}px ${spot.y}px, rgba(99,102,241,0.10), transparent 50%)`,
              }}
            />

            {/* Yuqori dekorativ chiziq */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent" />

            <div className="relative p-8 sm:p-10">
              {/* Sarlavha */}
              <div className="mb-7">
                <h1 className="text-[26px] font-semibold tracking-tight leading-tight">
                  {t('loginTitle')}
                </h1>
                <p className="text-[13px] text-slate-500 mt-1.5">
                  {t('loginSubtitle')}
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-[12px] font-medium text-slate-700">
                    {t('email')}
                  </Label>
                  <div className="relative group">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors pointer-events-none" />
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
                      className="h-12 pl-10 text-[15px] bg-slate-50/60 border-slate-200 rounded-xl
                                 placeholder:text-slate-400
                                 focus-visible:ring-2 focus-visible:ring-indigo-500/20 focus-visible:border-indigo-500/60
                                 focus-visible:bg-white
                                 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-[12px] font-medium text-slate-700">
                      {t('password')}
                    </Label>
                    {capsOn && (
                      <span className="text-[10px] text-amber-600 flex items-center gap-1 animate-fade-up uppercase tracking-wider">
                        <AlertCircle className="h-3 w-3" />
                        Caps Lock
                      </span>
                    )}
                  </div>
                  <div className="relative group">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors pointer-events-none" />
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
                      className="h-12 pl-10 pr-11 text-[15px] bg-slate-50/60 border-slate-200 rounded-xl
                                 placeholder:text-slate-400
                                 focus-visible:ring-2 focus-visible:ring-indigo-500/20 focus-visible:border-indigo-500/60
                                 focus-visible:bg-white
                                 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center
                                 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100
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
                                  bg-rose-50 border border-rose-200 text-[13px] text-rose-700
                                  animate-fade-up">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="relative w-full h-12 mt-3 rounded-xl font-medium text-[15px] text-white
                             bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500
                             bg-[length:200%_200%] animate-gradient
                             shadow-[0_10px_28px_-8px_rgba(99,102,241,0.55),inset_0_1px_0_0_rgba(255,255,255,0.2)]
                             hover:shadow-[0_16px_40px_-8px_rgba(99,102,241,0.8)]
                             hover:brightness-110 active:scale-[0.99]
                             disabled:opacity-60 disabled:hover:brightness-100
                             transition-all duration-200
                             flex items-center justify-center gap-2 group overflow-hidden"
                >
                  <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full
                                   bg-gradient-to-r from-transparent via-white/30 to-transparent
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
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>

      <style jsx>{`
        @keyframes card-in {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        :global(.animate-card-in) {
          animation: card-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        @keyframes hero-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.85); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        :global(.animate-hero-in) {
          animation: hero-in 0.8s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        @keyframes blob-a {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(40px, -30px) scale(1.05); }
          66%      { transform: translate(-30px, 20px) scale(0.95); }
        }
        @keyframes blob-b {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(-50px, 30px) scale(1.08); }
          66%      { transform: translate(30px, -40px) scale(0.92); }
        }
        @keyframes blob-c {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(40px, 50px) scale(1.1); }
        }
        :global(.animate-blob-a) { animation: blob-a 18s ease-in-out infinite; }
        :global(.animate-blob-b) { animation: blob-b 22s ease-in-out infinite; }
        :global(.animate-blob-c) { animation: blob-c 26s ease-in-out infinite; }

        @keyframes spin-slow {
          to { transform: rotate(360deg); }
        }
        :global(.animate-spin-slow) { animation: spin-slow 12s linear infinite; }

        @keyframes ring-pulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50%      { transform: scale(1.15); opacity: 0.7; }
        }
        :global(.animate-ring-pulse) { animation: ring-pulse 3.5s ease-in-out infinite; }

        @keyframes draw-line {
          0%   { stroke-dashoffset: 1200; }
          50%  { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -1200; }
        }
        :global(.animate-draw) {
          stroke-dasharray: 1200;
          animation: draw-line 16s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

/* ─── Boy mesh gradient fon ─── */
function VibrantBackdrop() {
  return (
    <>
      <div className="absolute -top-32 -left-40 w-[700px] h-[700px] rounded-full
                      bg-[radial-gradient(circle,rgba(99,102,241,0.28),transparent_60%)]
                      blur-3xl animate-blob-a pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-[800px] h-[800px] rounded-full
                      bg-[radial-gradient(circle,rgba(6,182,212,0.22),transparent_60%)]
                      blur-3xl animate-blob-b pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] rounded-full
                      bg-[radial-gradient(circle,rgba(236,72,153,0.15),transparent_60%)]
                      blur-3xl animate-blob-c pointer-events-none" />
      <div className="absolute bottom-1/3 left-1/4 w-[450px] h-[450px] rounded-full
                      bg-[radial-gradient(circle,rgba(168,85,247,0.13),transparent_60%)]
                      blur-3xl animate-blob-a pointer-events-none"
           style={{ animationDelay: '5s' }} />
    </>
  );
}

/* ─── Fonda chizilayotgan chart wave ─── */
function ChartWave() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none opacity-40"
      viewBox="0 0 1440 900"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="wave-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="rgba(99,102,241,0)" />
          <stop offset="50%"  stopColor="rgba(99,102,241,0.5)" />
          <stop offset="100%" stopColor="rgba(6,182,212,0)" />
        </linearGradient>
        <linearGradient id="wave-grad-2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="rgba(236,72,153,0)" />
          <stop offset="50%"  stopColor="rgba(236,72,153,0.35)" />
          <stop offset="100%" stopColor="rgba(168,85,247,0)" />
        </linearGradient>
      </defs>
      <path
        d="M 0 600 Q 240 450 480 520 T 960 480 T 1440 540"
        stroke="url(#wave-grad)"
        strokeWidth="1.5"
        fill="none"
        className="animate-draw"
      />
      <path
        d="M 0 680 Q 360 620 720 640 T 1440 620"
        stroke="url(#wave-grad-2)"
        strokeWidth="1.5"
        fill="none"
        className="animate-draw"
        style={{ animationDelay: '4s' }}
      />
    </svg>
  );
}

/* ─── Katta brand logo — kartadan tepada ─── */
function HeroLogo() {
  return (
    <div className="relative animate-hero-in">
      {/* Pulsing tashqi halqalar */}
      <div className="absolute inset-0 rounded-full bg-indigo-400/20 blur-2xl animate-ring-pulse" />
      <div className="absolute inset-0 rounded-full bg-cyan-400/15 blur-3xl animate-ring-pulse"
           style={{ animationDelay: '1.5s' }} />

      {/* Orbit chiziq */}
      <div className="absolute -inset-4 rounded-full border border-indigo-300/30 animate-spin-slow" />
      <div className="absolute -inset-8 rounded-full border border-indigo-200/20 animate-spin-slow"
           style={{ animationDirection: 'reverse', animationDuration: '20s' }} />

      {/* Markaz */}
      <div className="relative w-[78px] h-[78px] rounded-2xl
                      bg-gradient-to-br from-white to-slate-50
                      border border-slate-200
                      shadow-[0_20px_50px_-15px_rgba(99,102,241,0.5),inset_0_1px_0_0_rgba(255,255,255,0.8)]
                      grid place-items-center">
        <svg viewBox="0 0 64 64" className="w-11 h-11" aria-hidden>
          <defs>
            <linearGradient id="logo-up" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%"  stopColor="#10b981" />
              <stop offset="100%" stopColor="#34d399" />
            </linearGradient>
            <linearGradient id="logo-down" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%"  stopColor="#fb7185" />
              <stop offset="100%" stopColor="#f43f5e" />
            </linearGradient>
          </defs>
          <path d="M22 16 L22 40 M14 33 L22 41 L30 33"
            stroke="url(#logo-up)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M42 48 L42 24 M34 31 L42 23 L50 31"
            stroke="url(#logo-down)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
    </div>
  );
}
