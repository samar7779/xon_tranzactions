'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Loader2, ArrowRight, Eye, EyeOff, AlertCircle, X, LogIn,
} from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ShowcaseStage } from '@/components/showcase-stage';

export default function LoginPage() {
  const t = useTranslations('auth');
  const tApp = useTranslations('app');
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const login = useAuth((s) => s.login);
  const token = useAuth((s) => s.token);
  const hasHydrated = useAuth((s) => s.hasHydrated);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [clock, setClock] = useState('00:00:00');
  const [isMobile, setIsMobile] = useState(false);

  // Mobile aniqlash — ShowcaseStage'ni DOM'dan butunlay olib tashlaymiz
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (hasHydrated && token) router.replace(`/${locale}/dashboard`);
  }, [hasHydrated, token, router, locale]);

  useEffect(() => {
    const tick = () => {
      const t = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Asia/Tashkent', hour12: false,
      });
      setClock(t);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ESC orqali yopish
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    <div className="relative w-full overflow-x-hidden md:w-screen md:h-screen md:overflow-hidden font-sans text-white">
      {/* ============ DESKTOP (md+) ============ */}
      {/* Background: showcase animatsiyasi — mobile'da DOM'da umuman bo'lmaydi */}
      {!isMobile && (
        <div className={`hidden md:block absolute inset-0 transition-all duration-700 ease-out
                         ${open ? 'scale-[0.98] brightness-[0.78]' : 'scale-100 brightness-100'}`}>
          <ShowcaseStage />
        </div>
      )}
      {/* Vignette overlay — panel ochilganda chap tomon biroz qoraytadi (faqat desktop) */}
      <div className={`hidden md:block absolute inset-0 pointer-events-none transition-opacity duration-700
                       ${open ? 'opacity-100' : 'opacity-0'}`}
           style={{ background: 'radial-gradient(ellipse 80% 80% at 30% 50%, transparent 0%, rgba(2,6,18,0.55) 80%)' }} />

      {/* Desktop: top-right clock + language */}
      <div className="hidden md:flex absolute top-5 right-5 z-30 items-center gap-4">
        <div className="text-[10px] tracking-[0.2em] text-cyan-300/70 uppercase text-right font-mono">
          <div className="tabular-nums text-cyan-200">{clock}</div>
          <div className="text-cyan-400/40">{t('tashkent')}</div>
        </div>
        <div className="border border-cyan-400/25 rounded-full p-0.5 bg-cyan-500/5 backdrop-blur">
          <LanguageSwitcher />
        </div>
      </div>

      {/* Desktop: top-left system online */}
      <div className="hidden md:block absolute top-5 left-5 z-30 text-[10px] tracking-[0.2em] text-cyan-300/70 uppercase font-mono">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inset-0 rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
          </span>
          <span>{t('systemOnline')}</span>
        </div>
        <div className="mt-1 text-cyan-400/40">{tApp('title').toUpperCase()}</div>
      </div>

      {/* Desktop: pastki readout */}
      <div className={cn(
        "hidden md:flex absolute bottom-5 left-5 right-5 z-30",
        "items-center justify-between text-[9px] tracking-[0.25em] uppercase text-cyan-400/40 font-mono pointer-events-none",
      )}>
        <span>· {t('authRequired')} ·</span>
        <span>REV 1.0 · {new Date().getFullYear()}</span>
      </div>

      {/* ============ MOBIL (faqat md dan kichik) ============ */}
      <div className="md:hidden relative flex flex-col min-h-[100dvh] overflow-hidden">
        {/* Mobil fon */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#031020] via-[#06182d] to-[#020912]" />
        {/* Yengil to'r */}
        <div className="absolute inset-0 opacity-[0.08] pointer-events-none"
             style={{
               backgroundImage:
                 'linear-gradient(rgba(34,211,238,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.5) 1px, transparent 1px)',
               backgroundSize: '32px 32px',
             }} />
        {/* Markaziy yorug'lik */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-cyan-500/20 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-56 h-56 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />

        {/* Mobil top bar — online + language */}
        <div className="relative z-20 flex items-center justify-between px-4 pt-4">
          <div className="text-[9px] tracking-[0.2em] text-cyan-300/70 uppercase font-mono">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inset-0 rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
              </span>
              <span>{t('systemOnline')}</span>
            </div>
          </div>
          <div className="border border-cyan-400/25 rounded-full p-0.5 bg-cyan-500/5 backdrop-blur">
            <LanguageSwitcher />
          </div>
        </div>

        {/* Markaziy brand + CTA — flex bilan vertikal markazda */}
        <div className="relative z-20 flex-1 flex flex-col items-center justify-center px-6 py-8 gap-8">
          {/* Brand */}
          <div className="text-center">
            <div className="text-[40px] font-black tracking-[0.06em] uppercase
                            bg-gradient-to-br from-amber-300 via-amber-500 to-amber-700
                            bg-clip-text text-transparent leading-none
                            drop-shadow-[0_0_30px_rgba(245,158,11,0.4)]">
              XON SAROY
            </div>
            <div className="mt-3 text-[11px] tracking-[0.3em] uppercase text-cyan-300/80 font-mono px-4">
              {tApp('tagline')}
            </div>
            <div className="mt-5 flex items-center justify-center gap-2 text-[10px] tracking-[0.25em] uppercase text-cyan-400/60 font-mono">
              <span className="w-6 h-px bg-cyan-400/40" />
              <span>· REAL-TIME ·</span>
              <span className="w-6 h-px bg-cyan-400/40" />
            </div>
          </div>

          {/* Soat */}
          <div className="text-center font-mono">
            <div className="text-[28px] tabular-nums text-cyan-200 tracking-[0.1em]">{clock}</div>
            <div className="text-[9px] tracking-[0.3em] uppercase text-cyan-400/50 mt-1">{t('tashkent')}</div>
          </div>

          {/* CTA Kirish tugmasi */}
          <button
            onClick={() => setOpen(true)}
            className="group relative w-full max-w-[320px] h-16 rounded-2xl overflow-hidden
                       bg-gradient-to-r from-amber-500/90 via-amber-400 to-amber-500/90
                       ring-2 ring-amber-200/60
                       shadow-[0_15px_50px_-10px_rgba(245,158,11,0.7),inset_0_1px_0_rgba(255,255,255,0.4)]
                       active:scale-95
                       transition-all duration-300"
          >
            <span className="absolute inset-0 -translate-x-full group-active:translate-x-full
                             bg-gradient-to-r from-transparent via-white/40 to-transparent
                             transition-transform duration-1000 ease-out" />
            <span className="absolute inset-0 rounded-2xl ring-2 ring-amber-300/60 animate-ping" style={{ animationDuration: '2s' }} />
            <span className="relative flex items-center justify-center gap-3 text-slate-900 font-bold tracking-[0.18em] uppercase text-[14px]">
              <LogIn className="h-5 w-5" />
              {t('submit')}
              <ArrowRight className="h-5 w-5" />
            </span>
          </button>
        </div>

        {/* Mobil pastki readout */}
        <div className="relative z-20 flex items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]
                        text-[9px] tracking-[0.25em] uppercase text-cyan-400/40 font-mono">
          · {t('authRequired')} ·
        </div>
      </div>

      {/* Right-side slide-in login panel — telefonda to'liq ekran */}
      <div className={`fixed top-0 right-0 h-full w-full sm:w-[460px] sm:max-w-[92vw] z-50
                       transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]
                       ${open ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* Soft fade edge to the left of panel — faqat sm+ */}
        <div className="hidden sm:block absolute inset-y-0 -left-16 w-16 bg-gradient-to-r from-transparent to-[rgba(6,14,29,0.6)] pointer-events-none" />

        <div className="relative h-full overflow-y-auto overflow-x-hidden
                        bg-[linear-gradient(180deg,rgba(8,18,38,0.95)_0%,rgba(6,14,29,0.97)_100%)]
                        backdrop-blur-xl
                        border-l border-cyan-400/30
                        shadow-[-30px_0_80px_-10px_rgba(0,0,0,0.7),inset_4px_0_30px_-15px_rgba(34,211,238,0.25)]
                        p-5 sm:p-9 md:p-11 flex flex-col">

          {/* HUD background — subtle scan grid */}
          <div className="absolute inset-0 opacity-[0.06] pointer-events-none"
               style={{
                 backgroundImage:
                   'linear-gradient(rgba(34,211,238,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.6) 1px, transparent 1px)',
                 backgroundSize: '40px 40px',
                 maskImage: 'radial-gradient(ellipse 80% 60% at 50% 50%, #000 30%, transparent 80%)',
                 WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 50%, #000 30%, transparent 80%)',
               }} />

          {/* Top scan beam — yuqoridan pastga sirpanadi */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent
                          shadow-[0_0_15px_rgba(34,211,238,0.7)] login-scan-v pointer-events-none" />

          {/* Vertical accent line */}
          <div className="absolute inset-y-8 left-0 w-px bg-gradient-to-b from-transparent via-cyan-400/80 to-transparent" />

          {/* 4 HUD corner brackets */}
          <span className="absolute top-3 left-3 w-3 h-3 border-l border-t border-cyan-400/60 pointer-events-none" />
          <span className="absolute top-3 right-3 w-3 h-3 border-r border-t border-cyan-400/60 pointer-events-none" />
          <span className="absolute bottom-3 left-3 w-3 h-3 border-l border-b border-cyan-400/60 pointer-events-none" />
          <span className="absolute bottom-3 right-3 w-3 h-3 border-r border-b border-cyan-400/60 pointer-events-none" />

          {/* Title glow halo */}
          <div className="absolute top-12 left-1/2 -translate-x-1/2 w-64 h-32 bg-cyan-400/15 blur-3xl pointer-events-none rounded-full" />

          {/* Close button */}
          <button
            onClick={() => setOpen(false)}
            className="absolute top-5 right-5 z-10 w-9 h-9 rounded-full grid place-items-center
                       bg-white/5 ring-1 ring-white/10 text-cyan-200/70
                       hover:bg-rose-500/20 hover:ring-rose-400/40 hover:text-rose-200
                       hover:rotate-90
                       transition-all duration-300">
            <X className="h-4 w-4" />
          </button>

          {/* Sarlavha */}
          <div className="relative mt-4 sm:mt-6 mb-6 sm:mb-8" style={{ animation: open ? 'login-stagger 0.6s 0.15s both' : 'none' }}>
            <div className="flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase text-cyan-400/80 font-mono mb-2">
              <span className="w-4 h-px bg-cyan-400/60" />
              <span>· ID · 0001 ·</span>
              <span className="flex-1 h-px bg-gradient-to-r from-cyan-400/30 to-transparent" />
            </div>
            <h1 className="text-[20px] sm:text-[26px] font-bold tracking-[0.06em] uppercase text-cyan-50
                           drop-shadow-[0_0_18px_rgba(34,211,238,0.5)]">
              {t('loginTitle')}
            </h1>
            <div className="mt-2 flex items-center gap-2 text-[10px] tracking-[0.25em] uppercase text-cyan-400/70 font-mono">
              <span className="relative flex h-1 w-1">
                <span className="animate-ping absolute inset-0 rounded-full bg-cyan-400 opacity-75" />
                <span className="relative rounded-full h-1 w-1 bg-cyan-400" />
              </span>
              <span>{t('identityVerify')}</span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="relative space-y-5 flex-1" noValidate>
            <div style={{ animation: open ? 'login-stagger 0.6s 0.25s both' : 'none' }}>
              <HudField
                id="email"
                label={t('emailLabel')}
                type="email"
                value={email}
                onChange={(v) => { setEmail(v); setErrorMsg(null); }}
                autoFocus={open}
                placeholder="admin@xon.local"
              />
            </div>

            <div style={{ animation: open ? 'login-stagger 0.6s 0.35s both' : 'none' }}>
              <HudField
                id="password"
                label={t('passwordLabel')}
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(v) => { setPassword(v); setErrorMsg(null); }}
                onKeyEvent={(e) => setCapsOn(e.getModifierState && e.getModifierState('CapsLock'))}
                placeholder="••••••••"
                right={
                  <button
                    type="button"
                    onClick={() => setShowPwd((s) => !s)}
                    className="text-cyan-400/50 hover:text-cyan-300 transition"
                    tabIndex={-1}
                    aria-label={showPwd ? t('hidePassword') : t('showPassword')}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                }
              />
            </div>

            {capsOn && (
              <div className="text-[10px] text-amber-300 tracking-[0.2em] uppercase flex items-center gap-1 font-mono">
                <AlertCircle className="h-3 w-3" />
                {t('capsLockOn')}
              </div>
            )}

            {errorMsg && (
              <div className="flex items-start gap-2 px-3 py-2 border border-rose-400/40 bg-rose-500/10
                              text-[12px] text-rose-200 rounded-sm
                              shadow-[0_0_20px_-5px_rgba(244,63,94,0.5)]">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span className="tracking-wider">{errorMsg}</span>
              </div>
            )}

            <div style={{ animation: open ? 'login-stagger 0.6s 0.45s both' : 'none' }}>
              <button
                type="submit"
                disabled={busy}
                className="relative w-full h-13 mt-4 group overflow-hidden rounded-sm
                           bg-gradient-to-r from-cyan-500/30 via-cyan-400/50 to-cyan-500/30
                           border border-cyan-400/70
                           text-cyan-50 font-semibold tracking-[0.28em] uppercase text-[12px]
                           shadow-[0_0_35px_-5px_rgba(34,211,238,0.6),inset_0_0_20px_-10px_rgba(34,211,238,0.5)]
                           hover:bg-cyan-400/40 hover:shadow-[0_0_50px_-5px_rgba(34,211,238,1)]
                           hover:border-cyan-200
                           active:scale-[0.99]
                           disabled:opacity-60
                           transition-all duration-200
                           flex items-center justify-center gap-3 h-12"
              >
                <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full
                                 bg-gradient-to-r from-transparent via-cyan-200/50 to-transparent
                                 transition-transform duration-1000 ease-out" />
                {/* Corner accents on button */}
                <span className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-200" />
                <span className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-200" />
                <span className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-200" />
                <span className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-200" />
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="relative">{t('processing')}</span>
                  </>
                ) : (
                  <>
                    <span className="relative">{t('submit')}</span>
                    <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>

              {/* ESC hint */}
              <div className="text-center mt-3 text-[9px] tracking-[0.3em] uppercase text-cyan-400/40 font-mono">
                <kbd className="px-1.5 py-0.5 bg-cyan-500/10 border border-cyan-400/30 rounded">ESC</kbd> {t('pressEscToClose')}
              </div>
            </div>
          </form>

          {/* Status liniya */}
          <div className="relative mt-6 pt-4 border-t border-cyan-400/15 flex items-center justify-between
                          text-[9px] tracking-[0.25em] uppercase text-cyan-400/50 font-mono">
            <span className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-cyan-400 animate-pulse" />
              {t('encrypted')}
            </span>
            <span className="tabular-nums text-cyan-300/70">{clock}</span>
            <span>AES-256</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes login-stagger {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes login-scan-v {
          0%   { transform: translateY(0); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        :global(.login-scan-v) {
          animation: login-scan-v 5s linear infinite;
        }
      `}</style>

    </div>
  );
}

function HudField(props: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  onKeyEvent?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  placeholder?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={props.id} className="block text-[10px] tracking-[0.3em] uppercase text-cyan-400/70 font-mono">
        » {props.label}
      </label>
      <div className="relative group">
        <span className="absolute -top-px -left-px w-2 h-2 border-l border-t border-cyan-400/60 group-focus-within:border-cyan-300" />
        <span className="absolute -top-px -right-px w-2 h-2 border-r border-t border-cyan-400/60 group-focus-within:border-cyan-300" />
        <span className="absolute -bottom-px -left-px w-2 h-2 border-l border-b border-cyan-400/60 group-focus-within:border-cyan-300" />
        <span className="absolute -bottom-px -right-px w-2 h-2 border-r border-b border-cyan-400/60 group-focus-within:border-cyan-300" />

        <input
          id={props.id}
          type={props.type}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyUp={props.onKeyEvent}
          onKeyDown={props.onKeyEvent}
          autoFocus={props.autoFocus}
          autoComplete={props.id === 'email' ? 'email' : 'current-password'}
          required
          placeholder={props.placeholder}
          className="w-full h-11 px-3 pr-10 text-[14px] font-mono tracking-wider
                     bg-cyan-500/[0.04] border border-cyan-400/20
                     text-cyan-50 placeholder:text-cyan-400/25
                     focus:outline-none focus:border-cyan-400/60 focus:bg-cyan-500/[0.08]
                     focus:shadow-[inset_0_0_15px_-5px_rgba(34,211,238,0.4)]
                     transition-all rounded-sm"
        />
        {props.right && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{props.right}</div>
        )}
      </div>
    </div>
  );
}
