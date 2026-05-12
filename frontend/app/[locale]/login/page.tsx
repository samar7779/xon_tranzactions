'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Loader2, ArrowRight, Eye, EyeOff,
  Mail, Lock, AlertCircle, CornerDownLeft,
} from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
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

  // Qochuvchi tugma — forma to'lmaganida sichqonchadan qochadi
  const btnRef = useRef<HTMLButtonElement>(null);
  const [btnOffset, setBtnOffset] = useState({ x: 0, y: 0 });
  const formIncomplete = !email || !password;

  useEffect(() => {
    if (token) router.replace(`/${locale}/dashboard`);
  }, [token, router, locale]);

  useEffect(() => {
    if (!formIncomplete) {
      setBtnOffset({ x: 0, y: 0 });
      return;
    }
    // Touch qurilmalarda qochish kerakmas
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
      return;
    }

    const onMove = (e: MouseEvent) => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);

      const TRIGGER = 110;   // shu masofadan yaqin kelsa qochadi
      const MAX_PUSH = 90;   // maksimal siljish px

      if (dist < TRIGGER) {
        const strength = Math.pow(1 - dist / TRIGGER, 1.2);
        const norm = Math.max(dist, 1);
        // O'qish oson bo'lishi uchun gorizontal kuchroq, vertikal mayinroq
        const ox = -(dx / norm) * MAX_PUSH * strength;
        const oy = -(dy / norm) * MAX_PUSH * strength * 0.6;
        setBtnOffset({ x: ox, y: oy });
      } else {
        setBtnOffset({ x: 0, y: 0 });
      }
    };

    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [formIncomplete]);

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
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden
                    bg-[radial-gradient(ellipse_at_top,#1e1b4b_0%,#0b1027_55%,#05060f_100%)]
                    text-white px-4 py-8">

      {/* ─── Fon: animatsion blob'lar va grid ─── */}
      <BackgroundFX />

      {/* ─── Yuqori chap: brand mark ─── */}
      <div className="absolute top-5 left-5 sm:top-7 sm:left-7 z-20 flex items-center gap-2.5">
        <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur ring-1 ring-white/15 grid place-items-center shadow-lg">
          <Logo />
        </div>
        <div>
          <div className="text-[13px] font-semibold tracking-tight leading-tight">{tApp('title')}</div>
          <div className="text-[10px] text-white/55 uppercase tracking-[0.15em]">Xon Saroy</div>
        </div>
      </div>

      {/* ─── Yuqori o'ng: til o'zgartirgich ─── */}
      <div className="absolute top-5 right-5 sm:top-7 sm:right-7 z-20">
        <div className="glass-dark rounded-full p-1">
          <LanguageSwitcher />
        </div>
      </div>

      {/* ─── Markaz: glass card ─── */}
      <div className="relative z-10 w-full max-w-[420px] animate-card-in">
        {/* Karta atrofidagi yumshoq glow */}
        <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-indigo-500/40 via-blue-500/30 to-cyan-400/40 blur-xl opacity-60 -z-10" />

        <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-2xl
                        shadow-[0_30px_60px_-15px_rgba(0,0,0,0.7)] p-7 sm:p-10">

          {/* "LIVE" pill */}
          <div className="flex justify-center mb-6">
            <LivePill />
          </div>

          {/* Sarlavha */}
          <div className="text-center mb-7">
            <h1 className="text-[26px] sm:text-[28px] font-semibold tracking-tight leading-tight">
              {t('loginTitle')}
            </h1>
            <p className="text-[13px] text-white/55 mt-2">
              {t('loginSubtitle')}
            </p>
          </div>

          {/* Forma */}
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[12px] font-medium text-white/70">
                {t('email')}
              </Label>
              <div className="relative group">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 group-focus-within:text-indigo-300 transition-colors pointer-events-none" />
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
                  className="h-12 pl-10 text-[15px] text-white placeholder:text-white/30
                             bg-white/[0.04] border-white/10 rounded-xl
                             focus-visible:ring-2 focus-visible:ring-indigo-400/40 focus-visible:border-indigo-400/60
                             transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[12px] font-medium text-white/70">
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
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 group-focus-within:text-indigo-300 transition-colors pointer-events-none" />
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
                  className="h-12 pl-10 pr-11 text-[15px] text-white placeholder:text-white/30
                             bg-white/[0.04] border-white/10 rounded-xl
                             focus-visible:ring-2 focus-visible:ring-indigo-400/40 focus-visible:border-indigo-400/60
                             transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center
                             rounded-lg text-white/50 hover:text-white hover:bg-white/10
                             transition-colors"
                  tabIndex={-1}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Inline xato */}
            {errorMsg && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-500/10 border border-rose-400/30 text-[13px] text-rose-200 animate-fade-up">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              ref={btnRef}
              type="submit"
              disabled={busy || formIncomplete}
              style={{
                transform: `translate(${btnOffset.x}px, ${btnOffset.y}px)`,
                transition: 'transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.2s, filter 0.2s',
              }}
              className="relative w-full h-12 mt-2 rounded-xl font-medium text-[15px] text-white
                         bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500
                         bg-[length:200%_200%] animate-gradient
                         shadow-[0_10px_30px_-8px_rgba(99,102,241,0.6)]
                         hover:shadow-[0_14px_40px_-8px_rgba(99,102,241,0.8)]
                         hover:brightness-110 active:scale-[0.99]
                         disabled:opacity-60 disabled:hover:brightness-100
                         flex items-center justify-center gap-2 group overflow-hidden"
            >
              {/* Tugma ichidagi shimmer */}
              <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full
                               bg-gradient-to-r from-transparent via-white/20 to-transparent
                               transition-transform duration-700" />
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
                                  border border-white/30 bg-white/10 text-[10px]">
                    <CornerDownLeft className="h-2.5 w-2.5" />
                  </kbd>
                </>
              )}
            </button>
          </form>

          {/* Pastki yordam */}
          <div className="mt-7 pt-5 border-t border-white/10">
            <p className="text-[12px] text-white/45 text-center leading-relaxed">
              Kirishda muammomi?{' '}
              <span className="text-white/70 font-medium">Tizim administratoriga murojaat qiling.</span>
            </p>
          </div>
        </div>
      </div>

      {/* ─── Pastki bar: tizim holati ─── */}
      <div className="absolute bottom-5 left-0 right-0 flex items-center justify-between px-6 sm:px-8 text-[11px] text-white/35 z-10">
        <span>© {new Date().getFullYear()} Xon Saroy</span>
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          All systems operational
        </span>
      </div>

      {/* Inline style — globals.css'ga tegmasdan */}
      <style jsx>{`
        @keyframes card-in {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        :global(.animate-card-in) {
          animation: card-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        :global(.glass-dark) {
          background: rgba(255, 255, 255, 0.06);
          backdrop-filter: saturate(180%) blur(14px);
          -webkit-backdrop-filter: saturate(180%) blur(14px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </div>
  );
}

/* ─── Animatsion fon ─── */
function BackgroundFX() {
  return (
    <>
      {/* Aurora blob'lar */}
      <div className="brand-blob bg-indigo-500/40 w-[600px] h-[600px] -top-40 -left-40 animate-float-slow" />
      <div className="brand-blob bg-cyan-400/30 w-[500px] h-[500px] top-1/3 -right-32 animate-float-slow"
           style={{ animationDelay: '3s' }} />
      <div className="brand-blob bg-fuchsia-500/25 w-[460px] h-[460px] -bottom-32 left-1/4 animate-float-slow"
           style={{ animationDelay: '6s' }} />
      <div className="brand-blob bg-blue-500/20 w-[380px] h-[380px] top-1/4 left-1/3 animate-float-slow"
           style={{ animationDelay: '9s' }} />

      {/* Grid pattern fade */}
      <div className="bg-grid bg-grid-fade absolute inset-0 opacity-[0.07]" />

      {/* Yulduz nuqtalar */}
      <div className="absolute inset-0 opacity-40"
           style={{
             backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)',
             backgroundSize: '32px 32px',
             maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, #000 30%, transparent 80%)',
             WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, #000 30%, transparent 80%)',
           }} />

      {/* Noise tekstura — qog'oz tuyg'usi */}
      <div className="absolute inset-0 opacity-[0.02] mix-blend-overlay pointer-events-none"
           style={{
             backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' /%3E%3C/svg%3E\")",
           }} />
    </>
  );
}

/* ─── Kichik komponentlar ─── */

function LivePill() {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full
                     bg-emerald-500/10 ring-1 ring-emerald-400/30 text-emerald-300
                     text-[10px] font-medium tracking-[0.15em] uppercase">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
      </span>
      Real-time sync
    </span>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="w-6 h-6" aria-hidden>
      <path d="M22 16 L22 40 M14 33 L22 41 L30 33"
        stroke="#22c55e" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M42 48 L42 24 M34 31 L42 23 L50 31"
        stroke="#f87171" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
