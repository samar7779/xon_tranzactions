'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Loader2, ArrowRight, Eye, EyeOff, AlertCircle,
} from 'lucide-react';

import { useAuth } from '@/lib/auth';
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
  const [focused, setFocused] = useState<string | null>(null);

  useEffect(() => {
    if (token) router.replace(`/${locale}/dashboard`);
  }, [token, router, locale]);

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
    <div className="relative min-h-screen overflow-hidden bg-[#f6f5f1]
                    text-[#0d0f17] selection:bg-[#3b3aed]/20">

      {/* Diagonal color ribbon — past chap burchakda */}
      <div className="absolute -bottom-1/3 -left-1/4 w-[1100px] h-[800px] rounded-[40%]
                      bg-gradient-to-br from-[#3b3aed] via-[#7a3aed] to-[#3a8eed]
                      blur-[120px] opacity-[0.18] rotate-[-12deg] pointer-events-none" />

      {/* Yuqori o'ng — kichik accent */}
      <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full
                      bg-gradient-to-br from-amber-300 to-rose-300
                      blur-[100px] opacity-[0.12] pointer-events-none" />

      {/* Vertical chiziq dekor */}
      <div className="absolute left-[8%] top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-[#0d0f17]/8 to-transparent hidden lg:block pointer-events-none" />
      <div className="absolute right-[8%] top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-[#0d0f17]/8 to-transparent hidden lg:block pointer-events-none" />

      {/* Yuqori panel */}
      <header className="relative z-30 px-6 sm:px-12 lg:px-20 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span className="text-[13px] font-semibold tracking-tight">{tApp('title')}</span>
        </div>
        <LanguageSwitcher />
      </header>

      {/* Asosiy kontent */}
      <main className="relative z-10 px-6 sm:px-12 lg:px-20 pb-20 pt-12 lg:pt-20">
        <div className="max-w-[480px] mx-auto lg:mx-0 lg:ml-[14%]">
          {/* Index sahifa raqami — editorial */}
          <div className="flex items-center gap-3 mb-6 animate-up" style={{ animationDelay: '0s' }}>
            <span className="text-[11px] tracking-[0.25em] uppercase text-[#0d0f17]/45 font-medium">
              01 / Login
            </span>
            <span className="flex-1 h-px bg-[#0d0f17]/10" />
          </div>

          {/* Katta editorial sarlavha */}
          <h1 className="text-[44px] sm:text-[56px] font-semibold leading-[0.95] tracking-[-0.03em] animate-up"
              style={{ animationDelay: '0.05s' }}>
            <span className="block">{t('loginTitle')}</span>
            <span className="block text-[#3b3aed] italic font-medium">— davom etamiz.</span>
          </h1>

          <p className="mt-6 text-[15px] text-[#0d0f17]/55 max-w-[360px] leading-relaxed animate-up"
             style={{ animationDelay: '0.1s' }}>
            {t('loginSubtitle')}
          </p>

          {/* Forma — kartasiz, faqat sharhli inputlar */}
          <form onSubmit={onSubmit} className="mt-10 space-y-7 animate-up" noValidate
                style={{ animationDelay: '0.15s' }}>

            <FloatField
              id="email"
              label={t('email')}
              type="email"
              value={email}
              onChange={(v) => { setEmail(v); setErrorMsg(null); }}
              autoFocus
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
              isFocused={focused === 'email'}
              placeholder="admin@xon.local"
            />

            <FloatField
              id="password"
              label={t('password')}
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(v) => { setPassword(v); setErrorMsg(null); }}
              onFocus={() => setFocused('password')}
              onBlur={() => setFocused(null)}
              isFocused={focused === 'password'}
              onKeyEvent={(e) => setCapsOn(e.getModifierState && e.getModifierState('CapsLock'))}
              right={
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="h-7 w-7 grid place-items-center rounded-md text-[#0d0f17]/40 hover:text-[#0d0f17] hover:bg-[#0d0f17]/5 transition"
                  tabIndex={-1}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
              hint={capsOn ? (
                <span className="text-[11px] text-amber-700 flex items-center gap-1 uppercase tracking-wider">
                  <AlertCircle className="h-3 w-3" />
                  Caps Lock
                </span>
              ) : null}
            />

            {errorMsg && (
              <div className="flex items-start gap-2 text-[13px] text-rose-700 animate-up">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Submit — bold solid tugma */}
            <button
              type="submit"
              disabled={busy}
              className="group relative inline-flex items-center gap-3 mt-4
                         pl-7 pr-3 h-14 rounded-full
                         bg-[#0d0f17] text-white font-medium text-[15px]
                         shadow-[0_12px_30px_-10px_rgba(13,15,23,0.5)]
                         hover:bg-[#1a1d2b] hover:shadow-[0_18px_40px_-10px_rgba(13,15,23,0.6)]
                         active:scale-[0.98]
                         disabled:opacity-60
                         transition-all duration-200 overflow-hidden"
            >
              <span className="relative tracking-tight">{busy ? t('submitting') : t('submit')}</span>
              <span className="relative w-10 h-10 rounded-full bg-[#3b3aed] grid place-items-center
                               group-hover:bg-[#4f4dff] transition-colors">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                ) : (
                  <ArrowRight className="h-4 w-4 text-white transition-transform group-hover:translate-x-0.5" />
                )}
              </span>
            </button>
          </form>
        </div>
      </main>

      {/* Pastki bar — kichik raqamlar, copyright */}
      <footer className="absolute bottom-0 left-0 right-0 px-6 sm:px-12 lg:px-20 py-6
                         flex items-center justify-between text-[11px] text-[#0d0f17]/40
                         border-t border-[#0d0f17]/5">
        <span>© {new Date().getFullYear()} Xon Saroy</span>
        <span className="font-mono tabular-nums">{tApp('title').toUpperCase()} · TASHKENT</span>
      </footer>

      {/* Dekorativ katta tipografika fonda — XON */}
      <div className="absolute -bottom-12 right-[-2%] text-[200px] sm:text-[280px] lg:text-[380px]
                      font-bold leading-none tracking-[-0.05em] text-[#0d0f17]/[0.03]
                      pointer-events-none select-none hidden md:block">
        XON
      </div>

      <style jsx>{`
        @keyframes up {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        :global(.animate-up) {
          animation: up 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
      `}</style>
    </div>
  );
}

/* ─── Floating-label input — kartasiz, faqat pastki chiziq + label ─── */
function FloatField(props: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  isFocused?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyEvent?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  placeholder?: string;
  right?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  const active = props.isFocused || props.value.length > 0;
  return (
    <div className="group relative">
      <Label
        htmlFor={props.id}
        className={`absolute left-0 pointer-events-none transition-all duration-200
                    ${active
                      ? 'top-0 text-[11px] font-medium uppercase tracking-[0.15em] text-[#3b3aed]'
                      : 'top-[26px] text-[15px] text-[#0d0f17]/45'}
                   `}
      >
        {props.label}
      </Label>

      <input
        id={props.id}
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        onKeyUp={props.onKeyEvent}
        onKeyDown={props.onKeyEvent}
        autoFocus={props.autoFocus}
        required
        autoComplete={props.id === 'email' ? 'email' : 'current-password'}
        inputMode={props.id === 'email' ? 'email' : undefined}
        placeholder={active ? props.placeholder : ''}
        className="w-full pt-6 pb-2 pr-10 text-[16px] bg-transparent
                   border-0 border-b border-[#0d0f17]/15
                   focus:outline-none focus:ring-0 focus:border-[#3b3aed]
                   placeholder:text-[#0d0f17]/30
                   transition-colors"
      />

      {props.right && (
        <div className="absolute right-0 bottom-2">{props.right}</div>
      )}

      {props.hint && (
        <div className="mt-1.5">{props.hint}</div>
      )}

      {/* Pastki chiziq — focus paytida indigo to'lqin */}
      <div className={`absolute left-0 bottom-0 h-px bg-[#3b3aed] transition-all duration-300
                       ${props.isFocused ? 'w-full' : 'w-0'}`} />
    </div>
  );
}

/* ─── Brand mark ─── */
function Mark() {
  return (
    <div className="w-9 h-9 rounded-lg bg-[#0d0f17] grid place-items-center">
      <svg viewBox="0 0 64 64" className="w-5 h-5" aria-hidden>
        <path d="M22 16 L22 40 M14 33 L22 41 L30 33"
          stroke="#34d399" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M42 48 L42 24 M34 31 L42 23 L50 31"
          stroke="#fb7185" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    </div>
  );
}
