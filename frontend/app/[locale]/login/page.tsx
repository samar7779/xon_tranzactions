'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Loader2, ArrowRight, Eye, EyeOff, AlertCircle,
} from 'lucide-react';

import { useAuth } from '@/lib/auth';
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
  const [clock, setClock] = useState('00:00:00');

  useEffect(() => {
    if (token) router.replace(`/${locale}/dashboard`);
  }, [token, router, locale]);

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
    <div className="relative min-h-screen overflow-hidden font-mono
                    bg-[radial-gradient(ellipse_at_center,#0a1929_0%,#020618_70%,#000816_100%)]
                    text-cyan-100 selection:bg-cyan-400/30">

      {/* ─── HUD: dekorativ qatlamlar ─── */}
      <BackgroundHUD />

      {/* ─── Yuqori chap: tizim readout ─── */}
      <div className="absolute top-5 left-5 sm:top-7 sm:left-7 z-30 text-[10px] tracking-[0.2em] text-cyan-400/60 uppercase">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inset-0 rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
          </span>
          <span>SYS · ONLINE</span>
        </div>
        <div className="mt-1 text-cyan-400/40">{tApp('title').toUpperCase()}</div>
      </div>

      {/* ─── Yuqori o'ng: soat + til ─── */}
      <div className="absolute top-5 right-5 sm:top-7 sm:right-7 z-30 flex items-center gap-4">
        <div className="text-[10px] tracking-[0.2em] text-cyan-400/60 uppercase text-right">
          <div className="tabular-nums text-cyan-300">{clock}</div>
          <div className="text-cyan-400/40">TASHKENT</div>
        </div>
        <div className="border border-cyan-400/20 rounded-full p-0.5 bg-cyan-500/5">
          <LanguageSwitcher />
        </div>
      </div>

      {/* ─── 4 burchak HUD ramkasi ─── */}
      <CornerBrackets />

      {/* ─── Markaz: forma + aylanuvchi halqalar ─── */}
      <main className="relative z-10 min-h-screen flex items-center justify-center px-4">
        <div className="relative">
          {/* Aylanuvchi konsentrik halqalar */}
          <RotatingRings />

          {/* Forma paneli */}
          <div className="relative z-20 w-[400px] max-w-[92vw] p-8 sm:p-10
                          bg-[rgba(6,14,29,0.7)] backdrop-blur-md
                          border border-cyan-400/20 rounded-sm
                          shadow-[0_0_60px_-10px_rgba(34,211,238,0.25),inset_0_0_30px_-15px_rgba(34,211,238,0.15)]
                          animate-boot">

            {/* Yuqori chiziq */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />

            {/* Yuqori chap belgisi */}
            <div className="absolute -top-2 left-6 px-2 bg-[#020618] text-[9px] tracking-[0.3em] uppercase text-cyan-400">
              · ID · 0001 ·
            </div>

            <div className="font-sans">
              {/* Sarlavha */}
              <div className="mb-6 text-center">
                <h1 className="text-[22px] font-semibold tracking-[0.15em] uppercase text-cyan-50">
                  {t('loginTitle')}
                </h1>
                <div className="mt-2 flex items-center justify-center gap-2 text-[10px] tracking-[0.25em] uppercase text-cyan-400/60">
                  <span className="w-8 h-px bg-cyan-400/30" />
                  <span>Identity verify</span>
                  <span className="w-8 h-px bg-cyan-400/30" />
                </div>
              </div>

              {/* Forma */}
              <form onSubmit={onSubmit} className="space-y-5" noValidate>
                <HudField
                  id="email"
                  label="EMAIL"
                  type="email"
                  value={email}
                  onChange={(v) => { setEmail(v); setErrorMsg(null); }}
                  autoFocus
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
                  <div className="text-[10px] text-amber-300 tracking-[0.2em] uppercase flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Caps Lock · ON
                  </div>
                )}

                {errorMsg && (
                  <div className="flex items-start gap-2 px-3 py-2 border border-rose-400/30 bg-rose-500/10 text-[12px] text-rose-200 animate-fade-up">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span className="tracking-wider">{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="relative w-full h-12 mt-4 group overflow-hidden
                             bg-gradient-to-r from-cyan-500/20 via-cyan-400/30 to-cyan-500/20
                             border border-cyan-400/50
                             text-cyan-100 font-semibold tracking-[0.25em] uppercase text-[12px]
                             shadow-[0_0_30px_-5px_rgba(34,211,238,0.5),inset_0_0_20px_-10px_rgba(34,211,238,0.3)]
                             hover:bg-cyan-400/30 hover:shadow-[0_0_40px_-5px_rgba(34,211,238,0.8)]
                             hover:border-cyan-300
                             active:scale-[0.99]
                             disabled:opacity-60
                             transition-all duration-200
                             flex items-center justify-center gap-3"
                >
                  {/* Sweep animation */}
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

              {/* Pastki status liniya */}
              <div className="mt-7 pt-4 border-t border-cyan-400/15 flex items-center justify-between text-[9px] tracking-[0.25em] uppercase text-cyan-400/40">
                <span className="flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-cyan-400 animate-pulse" />
                  Encrypted
                </span>
                <span>AES-256</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ─── Pastki readout chiziq ─── */}
      <div className="absolute bottom-5 left-5 right-5 sm:bottom-7 sm:left-7 sm:right-7 z-30
                      flex items-center justify-between text-[9px] tracking-[0.25em] uppercase text-cyan-400/40">
        <span>· AUTHENTICATION REQUIRED ·</span>
        <span className="hidden sm:inline">REV 1.0 · {new Date().getFullYear()}</span>
      </div>

      <style jsx>{`
        @keyframes boot {
          0%   { opacity: 0; transform: scale(0.96); filter: brightness(0); }
          40%  { opacity: 1; filter: brightness(2); }
          100% { opacity: 1; transform: scale(1); filter: brightness(1); }
        }
        :global(.animate-boot) {
          animation: boot 0.8s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        @keyframes spin-cw { to { transform: rotate(360deg); } }
        @keyframes spin-ccw { to { transform: rotate(-360deg); } }
        :global(.spin-cw)  { animation: spin-cw  20s linear infinite; }
        :global(.spin-ccw) { animation: spin-ccw 30s linear infinite; }
        :global(.spin-fast){ animation: spin-cw  10s linear infinite; }

        @keyframes scan-v {
          0%   { transform: translateY(-100%); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        :global(.animate-scan-v) { animation: scan-v 6s linear infinite; }

        @keyframes pulse-ring {
          0%, 100% { opacity: 0.3; }
          50%      { opacity: 0.8; }
        }
        :global(.animate-pulse-ring) { animation: pulse-ring 2.5s ease-in-out infinite; }

        @keyframes grid-pan {
          0%   { background-position: 0 0; }
          100% { background-position: 60px 60px; }
        }
        :global(.animate-grid-pan) { animation: grid-pan 20s linear infinite; }
      `}</style>
    </div>
  );
}

/* ─── HUD field: futuristic input ─── */
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
      <label htmlFor={props.id} className="block text-[10px] tracking-[0.3em] uppercase text-cyan-400/60 font-mono">
        » {props.label}
      </label>
      <div className="relative group">
        {/* Burchak bracketlar */}
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
                     transition-all"
        />
        {props.right && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{props.right}</div>
        )}
      </div>
    </div>
  );
}

/* ─── 4 burchak HUD bracketlari ─── */
function CornerBrackets() {
  const brackets = [
    'top-4 left-4 border-t border-l',
    'top-4 right-4 border-t border-r',
    'bottom-4 left-4 border-b border-l',
    'bottom-4 right-4 border-b border-r',
  ];
  return (
    <>
      {brackets.map((c, i) => (
        <span key={i} className={`absolute ${c} w-8 h-8 border-cyan-400/40 pointer-events-none z-20`} />
      ))}
    </>
  );
}

/* ─── Aylanuvchi konsentrik halqalar (Arc Reactor effekti) ─── */
function RotatingRings() {
  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none z-0">
      {/* Eng katta halqa — sekin, dashed */}
      <div className="absolute w-[680px] h-[680px] rounded-full border border-dashed border-cyan-400/15 spin-cw" />
      {/* O'rta halqa — qarama-qarshi yo'nalish */}
      <div className="absolute w-[560px] h-[560px] rounded-full border border-cyan-400/20 spin-ccw" />
      {/* Halqa belgilari bilan */}
      <svg className="absolute w-[480px] h-[480px] spin-cw" viewBox="0 0 480 480">
        <circle cx="240" cy="240" r="200" fill="none" stroke="rgba(34,211,238,0.25)" strokeWidth="1" strokeDasharray="2 6" />
        <circle cx="240" cy="40" r="3" fill="rgba(34,211,238,0.8)" />
        <circle cx="440" cy="240" r="2" fill="rgba(34,211,238,0.5)" />
        <circle cx="240" cy="440" r="2" fill="rgba(34,211,238,0.5)" />
        <circle cx="40" cy="240" r="2" fill="rgba(34,211,238,0.5)" />
      </svg>
      {/* Eng ichki halqa — tez */}
      <svg className="absolute w-[420px] h-[420px] spin-fast" viewBox="0 0 420 420">
        <defs>
          <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"  stopColor="rgba(34,211,238,0)" />
            <stop offset="50%" stopColor="rgba(34,211,238,0.7)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0)" />
          </linearGradient>
        </defs>
        <circle cx="210" cy="210" r="190" fill="none" stroke="url(#ring-grad)" strokeWidth="2" strokeDasharray="40 80" />
      </svg>

      {/* Glow nuqta markazda */}
      <div className="absolute w-[440px] h-[440px] rounded-full bg-cyan-400/5 blur-3xl animate-pulse-ring" />
    </div>
  );
}

/* ─── Fon: grid + scan + starfield ─── */
function BackgroundHUD() {
  return (
    <>
      {/* Animated grid */}
      <div className="absolute inset-0 opacity-[0.15] animate-grid-pan pointer-events-none"
           style={{
             backgroundImage:
               'linear-gradient(to right, rgba(34,211,238,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(34,211,238,0.15) 1px, transparent 1px)',
             backgroundSize: '60px 60px',
             maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, #000 30%, transparent 75%)',
             WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, #000 30%, transparent 75%)',
           }} />

      {/* Cyan center glow */}
      <div className="absolute inset-0 pointer-events-none"
           style={{ background: 'radial-gradient(ellipse 50% 60% at 50% 50%, rgba(34,211,238,0.12), transparent 70%)' }} />

      {/* Scan line — vertical */}
      <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent
                      shadow-[0_0_20px_rgba(34,211,238,0.7)] animate-scan-v pointer-events-none" />

      {/* Star particles */}
      <div className="absolute inset-0 opacity-30 pointer-events-none"
           style={{
             backgroundImage: 'radial-gradient(circle, rgba(165,243,252,0.6) 0.8px, transparent 1px)',
             backgroundSize: '80px 80px',
             maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, #000 20%, transparent 80%)',
             WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, #000 20%, transparent 80%)',
           }} />
    </>
  );
}
