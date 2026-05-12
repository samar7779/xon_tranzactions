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

  // Karta ustida sichqoncha kuzatuvchi yumshoq glow
  const cardRef = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState({ x: 0, y: 0, active: false });

  useEffect(() => {
    if (token) router.replace(`/${locale}/dashboard`);
  }, [token, router, locale]);

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
    <div className="relative min-h-screen overflow-hidden bg-[#fafbfd] text-slate-900
                    selection:bg-indigo-200/60">

      {/* ─── Pastel gradient mesh fon ─── */}
      <SoftBackdrop />

      {/* ─── Yuqori panel ─── */}
      <header className="absolute top-0 left-0 right-0 z-30 px-6 sm:px-10 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <div className="text-[13px] font-semibold tracking-tight text-slate-900">
            {tApp('title')}
          </div>
        </div>
        <LanguageSwitcher />
      </header>

      {/* ─── Markaz ─── */}
      <main className="relative z-10 min-h-screen flex items-center justify-center px-4 py-20">
        <div
          ref={cardRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setSpot((s) => ({ ...s, active: false }))}
          className="relative w-full max-w-[400px] rounded-2xl
                     bg-white border border-slate-200/70
                     shadow-[0_20px_60px_-15px_rgba(15,23,42,0.15)]
                     animate-card-in"
        >
          {/* Spotlight glow sichqoncha kuzatadi */}
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300"
            style={{
              opacity: spot.active ? 1 : 0,
              background: `radial-gradient(420px circle at ${spot.x}px ${spot.y}px, rgba(99,102,241,0.08), transparent 50%)`,
            }}
          />

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

            {/* Forma */}
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
                           shadow-[0_10px_28px_-8px_rgba(99,102,241,0.55),inset_0_1px_0_0_rgba(255,255,255,0.18)]
                           hover:shadow-[0_14px_36px_-8px_rgba(99,102,241,0.75),inset_0_1px_0_0_rgba(255,255,255,0.25)]
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
      </main>

      <style jsx>{`
        @keyframes card-in {
          from { opacity: 0; transform: translateY(10px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        :global(.animate-card-in) {
          animation: card-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes float-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(30px, -20px) scale(1.05); }
        }
        @keyframes float-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(-25px, 25px) scale(1.08); }
        }
        :global(.animate-blob-1) { animation: float-1 16s ease-in-out infinite; }
        :global(.animate-blob-2) { animation: float-2 20s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

/* Yumshoq pastel fon — yorug', tinch, lekin tirik */
function SoftBackdrop() {
  return (
    <>
      <div className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full
                      bg-[radial-gradient(circle,rgba(99,102,241,0.18),transparent_60%)]
                      blur-2xl animate-blob-1 pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-[700px] h-[700px] rounded-full
                      bg-[radial-gradient(circle,rgba(6,182,212,0.14),transparent_60%)]
                      blur-2xl animate-blob-2 pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[400px] h-[400px] rounded-full
                      bg-[radial-gradient(circle,rgba(244,114,182,0.08),transparent_60%)]
                      blur-2xl pointer-events-none" />
    </>
  );
}

function LogoMark() {
  return (
    <div className="relative w-9 h-9 rounded-xl grid place-items-center
                    bg-white border border-slate-200
                    shadow-[0_4px_12px_-4px_rgba(15,23,42,0.1)]">
      <svg viewBox="0 0 64 64" className="w-5 h-5" aria-hidden>
        <path d="M22 16 L22 40 M14 33 L22 41 L30 33"
          stroke="#22c55e" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M42 48 L42 24 M34 31 L42 23 L50 31"
          stroke="#f87171" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    </div>
  );
}
