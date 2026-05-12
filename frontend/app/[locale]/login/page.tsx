'use client';

import { useState, useEffect, useMemo } from 'react';
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
    <div className="min-h-screen flex bg-slate-50">
      {/* ─── Chap panel: mahsulot showcase ─── */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden text-white
                      bg-[radial-gradient(circle_at_30%_20%,#3b3aed_0%,#1e1b4b_45%,#0b1027_100%)]">
        {/* Animatsion blob'lar */}
        <div className="brand-blob bg-fuchsia-500/30 w-[460px] h-[460px] -top-24 -left-24 animate-float-slow" />
        <div className="brand-blob bg-cyan-400/30 w-[400px] h-[400px] bottom-0 right-0 animate-float-slow"
             style={{ animationDelay: '4s' }} />
        <div className="brand-blob bg-indigo-500/20 w-[320px] h-[320px] top-1/2 left-1/2 animate-float-slow"
             style={{ animationDelay: '2s' }} />
        <div className="bg-grid bg-grid-fade absolute inset-0 opacity-[0.06]" />

        <div className="relative z-10 flex flex-col w-full p-12 xl:p-16">
          {/* Yuqori chap — brand mark */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/10 backdrop-blur ring-1 ring-white/15 grid place-items-center shadow-lg">
              <Logo />
            </div>
            <div>
              <div className="text-[15px] font-semibold tracking-tight">{tApp('title')}</div>
              <div className="text-[11px] text-white/60 uppercase tracking-wider">Xon Saroy · Internal</div>
            </div>
          </div>

          {/* O'rta — product preview */}
          <div className="mt-auto pt-16">
            <LivePill />

            <h1 className="mt-5 text-4xl xl:text-[44px] font-semibold leading-[1.05] tracking-tight">
              Banklar bo'yicha<br />
              <span className="text-gradient-warm">yagona oyna</span>
            </h1>
            <p className="mt-4 text-white/65 text-[15px] max-w-md leading-relaxed">
              Kapitalbank va boshqa banklardan tranzaksiyalar real-vaqtda — bir
              joyda, shifrlangan, har 5 daqiqada sinxronlangan.
            </p>

            {/* Live demo card stack */}
            <div className="mt-10 max-w-md">
              <TodayCard />
              <TransactionStack />
            </div>
          </div>

          {/* Pastki chap — copyright */}
          <div className="mt-12 flex items-center justify-between text-[11px] text-white/40">
            <span>© {new Date().getFullYear()} Xon Saroy</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-ring" />
              All systems operational
            </span>
          </div>
        </div>
      </div>

      {/* ─── O'ng panel: forma ─── */}
      <div className="flex-1 flex items-center justify-center relative bg-background">
        {/* Til o'zgartirgich — yuqori o'ng */}
        <div className="absolute top-5 right-5 z-10">
          <LanguageSwitcher />
        </div>

        {/* Mobil header — faqat <lg */}
        <div className="lg:hidden absolute top-5 left-5 flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-brand grid place-items-center shadow-glow">
            <Logo small />
          </div>
          <div>
            <div className="text-[13px] font-semibold leading-tight">{tApp('title')}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Xon Saroy</div>
          </div>
        </div>

        <div className="w-full max-w-[400px] px-6 py-12 animate-fade-up">
          {/* Sarlavha */}
          <div className="mb-8">
            <h2 className="text-[28px] font-semibold tracking-tight leading-tight">
              {t('loginTitle')}
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              {t('loginSubtitle')}
            </p>
          </div>

          {/* Forma */}
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[13px] font-medium">
                {t('email')}
              </Label>
              <div className="relative group">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 group-focus-within:text-primary transition-colors pointer-events-none" />
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
                  className="h-12 pl-10 text-[15px] bg-white border-slate-200
                             focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:border-primary/60
                             transition-shadow"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[13px] font-medium">
                  {t('password')}
                </Label>
                {capsOn && (
                  <span className="text-[11px] text-amber-600 flex items-center gap-1 animate-fade-up">
                    <AlertCircle className="h-3 w-3" />
                    Caps Lock
                  </span>
                )}
              </div>
              <div className="relative group">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 group-focus-within:text-primary transition-colors pointer-events-none" />
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
                  className="h-12 pl-10 pr-11 text-[15px] bg-white border-slate-200
                             focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:border-primary/60
                             transition-shadow"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center
                             rounded-md text-muted-foreground hover:text-foreground hover:bg-slate-100
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
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 border border-rose-200/70 text-[13px] text-rose-700 animate-fade-up">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <Button
              type="submit"
              variant="gradient"
              className="w-full h-12 text-[15px] font-medium group mt-2"
              disabled={busy || !email || !password}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('submitting')}
                </>
              ) : (
                <>
                  <span>{t('submit')}</span>
                  <span className="ml-2 inline-flex items-center gap-1.5">
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 h-5 px-1.5 rounded
                                    border border-white/30 bg-white/10 text-[10px] text-white/80">
                      <CornerDownLeft className="h-2.5 w-2.5" />
                    </kbd>
                  </span>
                </>
              )}
            </Button>
          </form>

          {/* Pastki yordam */}
          <div className="mt-10 pt-6 border-t border-slate-200/70">
            <p className="text-[12px] text-muted-foreground text-center leading-relaxed">
              Kirishda muammomi?{' '}
              <span className="text-foreground/80 font-medium">
                Tizim administratoriga murojaat qiling.
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Yordamchi komponentlar ─── */

function LivePill() {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full
                     bg-emerald-500/10 ring-1 ring-emerald-400/30 text-emerald-300
                     text-[11px] font-medium tracking-wider uppercase">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
      </span>
      Real-time sync
    </span>
  );
}

function TodayCard() {
  return (
    <div className="rounded-2xl bg-white/[0.06] ring-1 ring-white/10 backdrop-blur-md p-5
                    shadow-[0_8px_40px_-8px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-white/50">Bugun · Net flow</div>
        <div className="text-[11px] text-emerald-300 flex items-center gap-1 font-medium">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 7L5 4L8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          +12.4%
        </div>
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
        +45 280 000 <span className="text-base font-normal text-white/50">UZS</span>
      </div>
      <div className="mt-3 flex items-center gap-4 text-[12px] text-white/55">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          12 kirim
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
          4 chiqim
        </span>
      </div>
    </div>
  );
}

function TransactionStack() {
  // Static demo data — har refresh'da bir xil ko'rinadi
  const items = useMemo(() => [
    { bank: 'KAPITALBANK',     who: 'ABU SAHIY MCHJ',        amount: '+18 500 000', dir: 'in',  time: '14:23' },
    { bank: 'KAPITALBANK',     who: 'PRIMER LLC',            amount: '+12 200 000', dir: 'in',  time: '13:48' },
    { bank: 'UZUM BANK',       who: "Soliq to'lovi",         amount: '−4 850 000',  dir: 'out', time: '12:05' },
  ], []);

  return (
    <div className="mt-3 space-y-2 relative">
      {items.map((it, i) => (
        <div
          key={i}
          className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 backdrop-blur-sm p-3.5
                     flex items-center gap-3 text-[13px]
                     transition-all duration-500"
          style={{
            opacity: 1 - i * 0.15,
            transform: `translateY(0) scale(${1 - i * 0.015})`,
          }}
        >
          <div className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0
                          ${it.dir === 'in' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {it.dir === 'in' ? (
                <path d="M7 11V3M3 7L7 3L11 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M7 3V11M3 7L7 11L11 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white/85 font-medium truncate">{it.who}</div>
            <div className="text-[11px] text-white/40 tracking-wide">{it.bank} · {it.time}</div>
          </div>
          <div className={`tabular-nums font-medium text-[13px]
                          ${it.dir === 'in' ? 'text-emerald-300' : 'text-rose-300'}`}>
            {it.amount}
          </div>
        </div>
      ))}
    </div>
  );
}

function Logo({ small = false }: { small?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={small ? 'w-5 h-5' : 'w-7 h-7'} aria-hidden>
      <path d="M22 16 L22 40 M14 33 L22 41 L30 33"
        stroke="#22c55e" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M42 48 L42 24 M34 31 L42 23 L50 31"
        stroke="#f87171" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
