'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Loader2, ArrowRight, Eye, EyeOff, AlertCircle, X, LogIn,
} from 'lucide-react';

import { useAuth } from '@/lib/auth';
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
    <div className="relative w-screen h-screen overflow-hidden font-sans text-white">
      {/* Background: showcase animatsiyasi */}
      <div className={`absolute inset-0 transition-all duration-700 ${open ? 'scale-[0.97] brightness-50 blur-sm' : 'scale-100'}`}>
        <ShowcaseStage />
      </div>

      {/* Top-right: clock + language */}
      <div className="absolute top-5 right-5 z-30 flex items-center gap-4">
        <div className="text-[10px] tracking-[0.2em] text-cyan-300/70 uppercase text-right font-mono">
          <div className="tabular-nums text-cyan-200">{clock}</div>
          <div className="text-cyan-400/40">TASHKENT</div>
        </div>
        <div className="border border-cyan-400/25 rounded-full p-0.5 bg-cyan-500/5 backdrop-blur">
          <LanguageSwitcher />
        </div>
      </div>

      {/* Top-left: system online */}
      <div className="absolute top-5 left-5 z-30 text-[10px] tracking-[0.2em] text-cyan-300/70 uppercase font-mono">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inset-0 rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
          </span>
          <span>SYS · ONLINE</span>
        </div>
        <div className="mt-1 text-cyan-400/40">{tApp('title').toUpperCase()}</div>
      </div>

      {/* Kirish CTA — markazda pastda, faqat panel yopiq bo'lganda ko'rinadi */}
      <div className={`absolute bottom-12 left-1/2 -translate-x-1/2 z-40 transition-all duration-500 ${
        open ? 'opacity-0 translate-y-8 pointer-events-none' : 'opacity-100 translate-y-0'
      }`}>
        <button
          onClick={() => setOpen(true)}
          className="group relative px-8 h-14 rounded-full overflow-hidden
                     bg-gradient-to-r from-amber-500/90 via-amber-400 to-amber-500/90
                     ring-2 ring-amber-200/60
                     shadow-[0_15px_50px_-10px_rgba(245,158,11,0.7),inset_0_1px_0_rgba(255,255,255,0.4)]
                     hover:shadow-[0_20px_70px_-10px_rgba(245,158,11,0.9)]
                     hover:scale-105 active:scale-95
                     transition-all duration-300"
        >
          {/* Sweep glow */}
          <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full
                           bg-gradient-to-r from-transparent via-white/40 to-transparent
                           transition-transform duration-1000 ease-out" />
          {/* Sonar pulse */}
          <span className="absolute inset-0 rounded-full ring-2 ring-amber-300/60 animate-ping" style={{ animationDuration: '2s' }} />
          <span className="relative flex items-center gap-3 text-slate-900 font-bold tracking-[0.18em] uppercase text-[13px]">
            <LogIn className="h-4 w-4" />
            {t('submit')}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </span>
        </button>
      </div>

      {/* Right-side slide-in login panel */}
      <div className={`fixed top-0 right-0 h-full w-[420px] max-w-[92vw] z-50
                       transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]
                       ${open ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* Backdrop blur edge */}
        <div className="absolute inset-y-0 -left-12 w-12 bg-gradient-to-r from-transparent to-[rgba(6,14,29,0.85)] pointer-events-none" />

        <div className="relative h-full bg-[rgba(6,14,29,0.92)] backdrop-blur-xl
                        border-l border-cyan-400/30
                        shadow-[-20px_0_60px_-10px_rgba(0,0,0,0.7),inset_4px_0_30px_-15px_rgba(34,211,238,0.2)]
                        p-8 sm:p-10 flex flex-col">

          {/* Vertical accent line */}
          <div className="absolute inset-y-8 left-0 w-px bg-gradient-to-b from-transparent via-cyan-400 to-transparent" />

          {/* Close button */}
          <button
            onClick={() => setOpen(false)}
            className="absolute top-5 right-5 w-9 h-9 rounded-full grid place-items-center
                       bg-white/5 ring-1 ring-white/10 text-cyan-200/70
                       hover:bg-rose-500/20 hover:ring-rose-400/40 hover:text-rose-200
                       transition-all duration-200">
            <X className="h-4 w-4" />
          </button>

          {/* Sarlavha */}
          <div className="mt-6 mb-8">
            <div className="text-[10px] tracking-[0.3em] uppercase text-cyan-400/70 font-mono mb-2">· ID · 0001 ·</div>
            <h1 className="text-[24px] font-bold tracking-[0.06em] uppercase text-cyan-50">
              {t('loginTitle')}
            </h1>
            <div className="mt-2 flex items-center gap-2 text-[10px] tracking-[0.25em] uppercase text-cyan-400/60 font-mono">
              <span className="w-8 h-px bg-cyan-400/40" />
              <span>Identity verify</span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="space-y-5 flex-1" noValidate>
            <HudField
              id="email"
              label="EMAIL"
              type="email"
              value={email}
              onChange={(v) => { setEmail(v); setErrorMsg(null); }}
              autoFocus={open}
              placeholder="admin@xon.local"
            />

            <HudField
              id="password"
              label="PASSWORD"
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
                  aria-label={showPwd ? 'Hide' : 'Show'}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />

            {capsOn && (
              <div className="text-[10px] text-amber-300 tracking-[0.2em] uppercase flex items-center gap-1 font-mono">
                <AlertCircle className="h-3 w-3" />
                Caps Lock · ON
              </div>
            )}

            {errorMsg && (
              <div className="flex items-start gap-2 px-3 py-2 border border-rose-400/30 bg-rose-500/10 text-[12px] text-rose-200 rounded-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span className="tracking-wider">{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="relative w-full h-12 mt-4 group overflow-hidden rounded-sm
                         bg-gradient-to-r from-cyan-500/30 via-cyan-400/40 to-cyan-500/30
                         border border-cyan-400/60
                         text-cyan-50 font-semibold tracking-[0.25em] uppercase text-[12px]
                         shadow-[0_0_30px_-5px_rgba(34,211,238,0.5),inset_0_0_20px_-10px_rgba(34,211,238,0.4)]
                         hover:bg-cyan-400/40 hover:shadow-[0_0_40px_-5px_rgba(34,211,238,0.9)]
                         hover:border-cyan-300
                         active:scale-[0.99]
                         disabled:opacity-60
                         transition-all duration-200
                         flex items-center justify-center gap-3"
            >
              <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full
                               bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent
                               transition-transform duration-1000 ease-out" />
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="relative">PROCESSING</span>
                </>
              ) : (
                <>
                  <span className="relative">{t('submit')}</span>
                  <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>

          {/* Status liniya */}
          <div className="mt-6 pt-4 border-t border-cyan-400/15 flex items-center justify-between text-[9px] tracking-[0.25em] uppercase text-cyan-400/40 font-mono">
            <span className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-cyan-400 animate-pulse" />
              Encrypted
            </span>
            <span>AES-256</span>
          </div>
        </div>
      </div>

      {/* Pastki readout */}
      <div className="absolute bottom-5 left-5 right-5 z-30
                      flex items-center justify-between text-[9px] tracking-[0.25em] uppercase text-cyan-400/40 font-mono pointer-events-none">
        <span>· AUTHENTICATION REQUIRED ·</span>
        <span className="hidden sm:inline">REV 1.0 · {new Date().getFullYear()}</span>
      </div>
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
