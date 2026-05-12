'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Loader2, ArrowRight, Eye, EyeOff,
  ShieldCheck, BarChart3, Layers, Zap,
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token) router.replace(`/${locale}/dashboard`);
  }, [token, router, locale]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      toast.success(t('welcome'));
      router.replace(`/${locale}/dashboard`);
    } catch (err: any) {
      toast.error(err?.message || t('invalidCredentials'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* ─── Chap panel: brending ─── */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-blue-900 text-white">
        <div className="brand-blob bg-fuchsia-500/40 w-[420px] h-[420px] -top-20 -left-20 animate-float-slow" />
        <div className="brand-blob bg-sky-400/40 w-[360px] h-[360px] bottom-0 right-0 animate-float-slow" style={{ animationDelay: '3s' }} />
        <div className="bg-grid bg-grid-fade absolute inset-0 opacity-[0.08]" />

        <div className="relative z-10 flex flex-col w-full p-12 xl:p-16">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/10 backdrop-blur ring-1 ring-white/20 grid place-items-center">
              <Logo />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">{tApp('title')}</div>
              <div className="text-xs text-white/70">Xon Saroy</div>
            </div>
          </div>

          <div className="mt-auto">
            <h1 className="text-4xl xl:text-5xl font-semibold leading-[1.1] tracking-tight">
              Banklar bo'yicha<br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-indigo-200">
                yagona oyna
              </span>
            </h1>
            <p className="mt-5 text-white/75 text-base max-w-md leading-relaxed">
              Kapitalbank, UPC va boshqa banklardan kelgan tranzaksiyalarni
              real-vaqtda kuzating. Hisoblar, kirim/chiqim, sync — bir joyda.
            </p>

            <ul className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <Feature icon={Zap} text="Har 5 daqiqada avto-sync" />
              <Feature icon={ShieldCheck} text="AES-256 shifrlash" />
              <Feature icon={BarChart3} text="Kunlik statistika" />
              <Feature icon={Layers} text="Ko'p hisob qo'llab-quvvatlash" />
            </ul>
          </div>

          <div className="mt-12 text-xs text-white/50">
            © {new Date().getFullYear()} Xon Saroy · Ichki tizim
          </div>
        </div>
      </div>

      {/* ─── O'ng panel: forma ─── */}
      <div className="flex-1 flex items-center justify-center relative bg-background">
        <div className="absolute top-4 right-6">
          <LanguageSwitcher />
        </div>

        <div className="lg:hidden absolute top-6 left-6 flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground grid place-items-center">
            <Logo small />
          </div>
          <span className="text-sm font-semibold">{tApp('title')}</span>
        </div>

        <div className="w-full max-w-md px-6 sm:px-8 py-12 animate-fade-up">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight">{t('loginTitle')}</h2>
            <p className="text-sm text-muted-foreground mt-1.5">{t('loginSubtitle')}</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
                placeholder="admin@xon.local"
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('password')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full h-11 group" disabled={busy}>
              {busy ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('submitting')}</>
              ) : (
                <>{t('submit')} <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>
              )}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t text-xs text-muted-foreground text-center">
            Kirishda muammomi? Tizim administratoriga murojaat qiling.
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-7 h-7 rounded-md bg-white/10 ring-1 ring-white/15 grid place-items-center">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="text-white/85">{text}</span>
    </li>
  );
}

function Logo({ small = false }: { small?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={small ? 'w-5 h-5' : 'w-7 h-7'}>
      <path d="M22 16 L22 40 M14 33 L22 41 L30 33"
        stroke="#22c55e" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M42 48 L42 24 M34 31 L42 23 L50 31"
        stroke="#f87171" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}
