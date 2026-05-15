'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { XonSaroyLogo } from '@/components/xon-saroy-logo';

/**
 * Showcase — marketing hero (chap matn + o'ng 3D illustratsiya).
 * new.soliqservis.uz uslubida: floating cloud cards, telefon mock'lari,
 * laptop dashboard, gold dotted flow lines, animated entrance.
 */
export default function ShowcasePage() {
  const [bal, setBal] = useState(0);

  useEffect(() => {
    const target = 12_504_500;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 2200);
      setBal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden text-white
                    bg-[linear-gradient(135deg,#1e40af_0%,#2563eb_55%,#1e3a8a_100%)]">

      <Stars />
      <Glows />

      {/* Top nav */}
      <header className="relative z-30 px-8 lg:px-12 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 showcase-fade-up">
          <XonSaroyLogo size={42} />
          <div>
            <div className="text-[14px] font-bold tracking-tight leading-none">Xon Saroy</div>
            <div className="text-[10px] text-white/55 uppercase tracking-[0.18em] mt-0.5">Treasury</div>
          </div>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-[13px] text-white/75 showcase-fade-up"
             style={{ animationDelay: '0.1s' }}>
          <a className="hover:text-white transition-colors cursor-pointer">Imkoniyatlar</a>
          <a className="hover:text-white transition-colors cursor-pointer">Banklar</a>
          <a className="hover:text-white transition-colors cursor-pointer">Tariflar</a>
          <a className="hover:text-white transition-colors cursor-pointer">Yangiliklar</a>
        </nav>
        <div className="flex items-center gap-2 showcase-fade-up" style={{ animationDelay: '0.2s' }}>
          <span className="text-[13px] text-amber-300 font-semibold tabular-nums">+998 71 202-3282</span>
        </div>
      </header>

      {/* Hero — 2 ustun */}
      <main className="relative z-10 px-8 lg:px-12 grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-8 h-[calc(100vh-72px)]">
        {/* CHAP — matn + CTA */}
        <div className="flex flex-col justify-center showcase-fade-up" style={{ animationDelay: '0.15s' }}>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur
                          text-[10px] uppercase tracking-[0.2em] font-semibold text-amber-300 w-fit mb-5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inset-0 rounded-full bg-amber-300 opacity-75" />
              <span className="relative rounded-full h-1.5 w-1.5 bg-amber-300" />
            </span>
            Live · Banks integrated
          </div>

          <h1 className="text-[34px] sm:text-[42px] lg:text-[48px] font-bold leading-[1.05] tracking-[-0.025em] max-w-[560px]">
            <span className="bg-gradient-to-r from-amber-200 via-amber-300 to-amber-500 bg-clip-text text-transparent">
              "Xon Saroy"
            </span>{' '}
            <span className="text-white">bank tranzaksiyalarini boshqarish — bir joyda.</span>
          </h1>
          <p className="mt-4 text-[14px] sm:text-[15px] text-white/65 max-w-[480px] leading-relaxed">
            Kapitalbank, Ipak Yo'li va boshqa banklar bilan integratsiya. Real-time sync,
            avto sverka, kirim/chiqim analitika va shifrlangan saqlash.
          </p>

          <div className="mt-7 flex items-center gap-3 flex-wrap">
            <button className="px-5 h-11 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 text-[13px] font-bold
                                flex items-center gap-2 shadow-[0_10px_30px_-8px_rgba(245,158,11,0.6)]
                                hover:brightness-110 active:scale-[0.98] transition-all">
              <ArrowInBox /> Kirish
            </button>
            <button className="px-5 h-11 rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur text-white text-[13px] font-semibold
                                hover:bg-white/15 transition-colors">
              Ro'yxatdan o'tish
            </button>
          </div>

          {/* Trust strip */}
          <div className="mt-8 flex items-center gap-5">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-semibold">Integrated banks</span>
            <div className="flex items-center gap-2">
              <BankPill src="/banks/kapital.webp" name="Kapitalbank" />
              <BankPill src="/banks/ipak.svg" name="Ipak Yo'li" />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 max-w-[440px] gap-1 pt-5 border-t border-white/10 showcase-fade-up"
               style={{ animationDelay: '0.3s' }}>
            <Metric label="Tranzaksiya" value="6 762" />
            <Metric label="Banklar" value="2" />
            <Metric label="Hisoblar" value="139" />
          </div>
        </div>

        {/* O'NG — 3D illustration */}
        <div className="relative">
          <Illustration bal={bal} />
        </div>
      </main>
    </div>
  );
}

/* ─────────────── ILLUSTRATION ─────────────── */

function Illustration({ bal }: { bal: number }) {
  return (
    <div className="absolute inset-0">
      {/* Yumshoq aylanma kosmik fon */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full
                      bg-[radial-gradient(circle,rgba(251,191,36,0.18)_0%,rgba(99,102,241,0.10)_40%,transparent_70%)] showcase-light-pulse" />

      {/* Dotted flow paths */}
      <FlowPaths />

      {/* 4 floating cloud cards */}
      <CloudCard
        pos="top-[4%] left-[18%]"
        icon={<PercentIcon />}
        color="amber"
        delay="0.4s"
      />
      <CloudCard
        pos="top-[14%] right-[8%]"
        icon={<GearIcon />}
        color="blue"
        delay="0.6s"
      />
      <CloudCard
        pos="top-[35%] left-[2%]"
        icon={<ShieldIcon />}
        color="amber"
        delay="0.8s"
      />
      <CloudCard
        pos="top-[44%] right-[2%]"
        icon={<ArrowUpIcon />}
        color="blue"
        delay="1.0s"
      />

      {/* Phone (chap, balandroq) */}
      <PhoneMock pos="bottom-[6%] left-[10%] rotate-[-8deg]" delay="0.5s" variant="login" />

      {/* Laptop (markaz) */}
      <LaptopMock pos="bottom-[4%] left-1/2 -translate-x-1/2" delay="0.3s" bal={bal} />

      {/* Phone (o'ng, balandroq) */}
      <PhoneMock pos="bottom-[12%] right-[8%] rotate-[10deg]" delay="0.7s" variant="dashboard" />

      {/* Gold coins */}
      <Coin pos="top-[26%] right-[34%]" delay="1.2s" />
      <Coin pos="bottom-[20%] left-[36%]" delay="1.4s" small />

      {/* XON SAROY seal */}
      <BrandSeal pos="bottom-[28%] left-1/2 -translate-x-1/2" />
    </div>
  );
}

function CloudCard({ pos, icon, color, delay }: { pos: string; icon: React.ReactNode; color: 'amber' | 'blue'; delay: string }) {
  const cls = color === 'amber'
    ? 'from-amber-300 to-amber-500'
    : 'from-blue-400 to-indigo-600';
  return (
    <div className={`absolute ${pos} showcase-tx-in pointer-events-none`} style={{ animationDelay: delay }}>
      <div className="showcase-coin-float" style={{ animationDelay: delay }}>
        {/* Cloud shape with icon */}
        <div className="relative w-[78px] h-[58px]">
          {/* Cloud silhouette */}
          <svg viewBox="0 0 100 70" className="absolute inset-0 w-full h-full">
            <defs>
              <linearGradient id={`cl-${color}-${delay}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color === 'amber' ? '#1e3a8a' : '#1e40af'} stopOpacity="0.9" />
                <stop offset="100%" stopColor={color === 'amber' ? '#0f172a' : '#1e1b4b'} stopOpacity="0.95" />
              </linearGradient>
              <filter id={`sh-${color}-${delay}`}>
                <feDropShadow dx="0" dy="6" stdDeviation="4" floodColor="rgba(0,0,0,0.4)" />
              </filter>
            </defs>
            <path
              d="M 25 50 Q 8 50 8 38 Q 8 28 18 26 Q 20 14 32 14 Q 40 8 50 14 Q 62 10 72 18 Q 88 18 88 32 Q 92 38 88 46 Q 88 56 75 56 L 32 56 Q 22 56 25 50 Z"
              fill={`url(#cl-${color}-${delay})`}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="1"
              filter={`url(#sh-${color}-${delay})`}
            />
          </svg>
          {/* Icon in center */}
          <div className={`absolute inset-0 grid place-items-center`}>
            <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${cls} grid place-items-center
                            shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_12px_-2px_rgba(0,0,0,0.5)]`}>
              {icon}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneMock({ pos, delay, variant }: { pos: string; delay: string; variant: 'login' | 'dashboard' }) {
  return (
    <div className={`absolute ${pos} showcase-tx-in pointer-events-none`} style={{ animationDelay: delay }}>
      <div className="relative w-[145px] h-[260px] rounded-[26px] bg-gradient-to-b from-slate-200 to-slate-400 p-1.5
                      shadow-[0_30px_60px_-15px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.5)]">
        <div className="w-full h-full rounded-[20px] bg-gradient-to-b from-blue-900 to-blue-950 overflow-hidden relative">
          {/* Notch */}
          <div className="absolute top-1 left-1/2 -translate-x-1/2 w-12 h-3 rounded-full bg-black/80" />

          {/* Status bar */}
          <div className="pt-5 px-2.5 flex items-center justify-between text-[7px] text-white/70 font-semibold">
            <span>9:41</span>
            <span>●●● 100%</span>
          </div>

          {variant === 'login' ? (
            <div className="px-3 mt-3 flex flex-col items-center">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center
                              shadow-[0_4px_12px_-2px_rgba(245,158,11,0.6)]">
                <span className="text-[10px] font-black text-slate-900">XS</span>
              </div>
              <div className="mt-3 text-[8px] font-bold text-white">Xon Saroy</div>
              <div className="mt-3 w-full space-y-2">
                <div className="h-6 rounded-md bg-white/10 ring-1 ring-white/15" />
                <div className="h-6 rounded-md bg-white/10 ring-1 ring-white/15" />
                <div className="h-6 rounded-md bg-gradient-to-r from-amber-400 to-amber-500" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5 w-full">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-md bg-white/5 ring-1 ring-white/10" />
                ))}
              </div>
            </div>
          ) : (
            <div className="px-3 mt-3">
              <div className="text-[7px] text-white/55">Total</div>
              <div className="text-[12px] font-bold bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text text-transparent tabular-nums">
                12 504 500
              </div>
              <svg viewBox="0 0 130 50" className="w-full h-[34px] mt-1">
                <path d="M 0 35 Q 20 30 35 28 T 70 18 T 100 22 T 130 12"
                      fill="none" stroke="#fbbf24" strokeWidth="1.5" />
                <path d="M 0 35 Q 20 30 35 28 T 70 18 T 100 22 T 130 12 L 130 50 L 0 50 Z"
                      fill="url(#phone-fill)" />
                <defs>
                  <linearGradient id="phone-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="mt-2 space-y-1.5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-1.5 p-1.5 rounded bg-white/5 ring-1 ring-white/10">
                    <div className="w-4 h-4 rounded bg-emerald-500/70" />
                    <div className="flex-1 space-y-0.5">
                      <div className="h-1 rounded-full w-3/4 bg-white/40" />
                      <div className="h-1 rounded-full w-1/2 bg-white/20" />
                    </div>
                    <div className="h-2 rounded w-8 bg-emerald-500/30" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LaptopMock({ pos, delay, bal }: { pos: string; delay: string; bal: number }) {
  return (
    <div className={`absolute ${pos} showcase-tx-in pointer-events-none`} style={{ animationDelay: delay }}>
      <div className="relative w-[420px]">
        {/* Screen */}
        <div className="relative w-full h-[260px] rounded-t-xl bg-slate-800 p-1.5
                        shadow-[0_30px_60px_-15px_rgba(0,0,0,0.7)]">
          <div className="w-full h-full rounded-t-md bg-gradient-to-b from-blue-900 via-blue-950 to-slate-950 overflow-hidden p-3">
            {/* Top bar */}
            <div className="flex items-center gap-2 pb-2 border-b border-white/8">
              <div className="w-5 h-5 rounded bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center">
                <span className="text-[7px] font-black text-slate-900">XS</span>
              </div>
              <span className="text-[9px] font-semibold text-white">Dashboard</span>
              <div className="flex-1" />
              <span className="text-[8px] text-white/40">●●●</span>
            </div>
            {/* Balance hero */}
            <div className="mt-2 rounded-lg bg-gradient-to-br from-slate-900/80 to-slate-800/40 ring-1 ring-white/10 p-2">
              <div className="text-[7px] uppercase tracking-wider text-white/50 font-semibold">Total balance · UZS</div>
              <div className="text-[14px] font-bold tabular-nums bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text text-transparent">
                {formatBig(bal)}
              </div>
              <div className="mt-0.5 text-[7px] text-emerald-400 font-semibold">▲ 12.5% vs last month</div>
            </div>
            {/* Mini chart */}
            <div className="mt-2 rounded-lg bg-white/[0.03] ring-1 ring-white/8 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[8px] font-semibold text-white">Payment analytics</span>
                <span className="text-[7px] text-amber-300">+8.4%</span>
              </div>
              <svg viewBox="0 0 240 50" className="w-full h-[42px]">
                <defs>
                  <linearGradient id="lapt-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M 0 38 Q 20 30 40 32 T 80 22 T 120 28 T 160 15 T 200 20 T 240 12 L 240 50 L 0 50 Z"
                      fill="url(#lapt-fill)" />
                <path d="M 0 38 Q 20 30 40 32 T 80 22 T 120 28 T 160 15 T 200 20 T 240 12"
                      fill="none" stroke="#fbbf24" strokeWidth="1.2" />
              </svg>
            </div>
            {/* Mini stat tiles */}
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {[
                ['Inflow', '48.2M', 'emerald'],
                ['Outflow', '22.7M', 'rose'],
                ['Net', '25.5M', 'amber'],
              ].map(([l, v, c]) => (
                <div key={l} className="rounded-md bg-white/[0.04] ring-1 ring-white/8 p-1.5">
                  <div className="text-[6px] uppercase tracking-wider text-white/45 font-semibold">{l}</div>
                  <div className={`text-[10px] font-bold tabular-nums ${c === 'emerald' ? 'text-emerald-300' : c === 'rose' ? 'text-rose-300' : 'text-amber-300'}`}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Laptop base */}
        <div className="relative w-[470px] h-3 -ml-[25px] rounded-b-2xl bg-gradient-to-b from-slate-700 to-slate-900
                        shadow-[0_15px_30px_-5px_rgba(0,0,0,0.5)]">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-1 rounded-b bg-slate-950" />
        </div>
      </div>
    </div>
  );
}

function Coin({ pos, delay, small }: { pos: string; delay: string; small?: boolean }) {
  const size = small ? 'w-9 h-9 text-base' : 'w-12 h-12 text-xl';
  return (
    <div className={`absolute ${pos} showcase-coin-float pointer-events-none`} style={{ animationDelay: delay }}>
      <div className={`${size} rounded-full bg-gradient-to-br from-amber-300 to-amber-600 grid place-items-center
                       text-amber-900 font-black ring-2 ring-amber-200/30
                       shadow-[0_10px_24px_-4px_rgba(245,158,11,0.6),inset_0_2px_0_rgba(255,255,255,0.4)]`}>
        $
      </div>
    </div>
  );
}

function BrandSeal({ pos }: { pos: string }) {
  return (
    <div className={`absolute ${pos} showcase-fade-up pointer-events-none`} style={{ animationDelay: '0.9s' }}>
      <div className="relative w-[110px] h-[110px]">
        <div className="absolute inset-0 rounded-full bg-amber-400/20 blur-2xl -z-10" />
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-300 via-amber-500 to-amber-700
                        ring-2 ring-amber-200/40
                        shadow-[0_15px_40px_-10px_rgba(245,158,11,0.6),inset_0_2px_0_rgba(255,255,255,0.4),inset_0_-2px_4px_rgba(0,0,0,0.2)]
                        grid place-items-center">
          <div className="w-[88px] h-[88px] rounded-full bg-gradient-to-br from-amber-200 to-amber-500 grid place-items-center
                          ring-1 ring-amber-700/20">
            <XonSaroyLogo size={66} />
          </div>
        </div>
        <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full showcase-rays-spin">
          <text fontFamily="serif" fontSize="9" fontWeight="900" letterSpacing="3" fill="#92400e">
            <textPath href="#seal-circle" startOffset="0">
              · XON SAROY · TREASURY · XON SAROY · TREASURY ·
            </textPath>
          </text>
          <defs>
            <path id="seal-circle" d="M 100 100 m -56 0 a 56 56 0 1 1 112 0 a 56 56 0 1 1 -112 0" />
          </defs>
        </svg>
      </div>
    </div>
  );
}

function FlowPaths() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 700 600" preserveAspectRatio="none">
      {/* Cloud → laptop curves with animated flow */}
      <path d="M 165 70  Q 250 200 350 350" stroke="rgba(251,191,36,0.5)" strokeWidth="1.5" fill="none"
            strokeDasharray="3 6" className="showcase-flow" />
      <path d="M 540 90  Q 480 220 380 360" stroke="rgba(251,191,36,0.5)" strokeWidth="1.5" fill="none"
            strokeDasharray="3 6" className="showcase-flow" style={{ animationDelay: '0.4s' }} />
      <path d="M 60 230  Q 180 320 280 400" stroke="rgba(251,191,36,0.4)" strokeWidth="1.5" fill="none"
            strokeDasharray="3 6" className="showcase-flow" style={{ animationDelay: '0.2s' }} />
      <path d="M 620 290 Q 540 380 440 420" stroke="rgba(251,191,36,0.4)" strokeWidth="1.5" fill="none"
            strokeDasharray="3 6" className="showcase-flow" style={{ animationDelay: '0.6s' }} />
      {/* End dots */}
      <circle cx="165" cy="70"  r="3" fill="#fbbf24" />
      <circle cx="540" cy="90"  r="3" fill="#fbbf24" />
      <circle cx="60"  cy="230" r="3" fill="#fbbf24" />
      <circle cx="620" cy="290" r="3" fill="#fbbf24" />
    </svg>
  );
}

function Stars() {
  const items = Array.from({ length: 30 }, (_, i) => ({
    left: `${(i * 37) % 100}%`,
    top: `${(i * 23) % 100}%`,
    size: i % 4 === 0 ? 2 : 1,
    delay: `${(i * 0.4) % 4}s`,
  }));
  return (
    <div className="absolute inset-0 pointer-events-none">
      {items.map((p, i) => (
        <span key={i}
              className="absolute rounded-full bg-white/60 showcase-twinkle"
              style={{ left: p.left, top: p.top, width: p.size, height: p.size, animationDelay: p.delay }} />
      ))}
    </div>
  );
}

function Glows() {
  return (
    <>
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-amber-400/15 blur-[120px] showcase-light-pulse" />
      <div className="absolute -bottom-40 -right-40 w-[700px] h-[700px] rounded-full bg-indigo-400/15 blur-[120px] showcase-light-pulse"
           style={{ animationDelay: '3s' }} />
    </>
  );
}

/* ─── Helpers ─── */

function BankPill({ src, name }: { src: string; name: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white ring-1 ring-white/20">
      <Image src={src} alt={name} width={14} height={14} className="object-contain" />
      <span className="text-[10px] font-semibold text-slate-800 whitespace-nowrap">{name}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/40 font-semibold">{label}</div>
      <div className="text-[18px] font-bold tabular-nums text-white mt-0.5">{value}</div>
    </div>
  );
}

function formatBig(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/* ─── Icons ─── */
function PercentIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-slate-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="19" y1="5" x2="5" y2="19" strokeLinecap="round" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-slate-900" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1 4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5l-8-4zm-2 16-4-4 1.4-1.4L10 14.2l6.6-6.6L18 9l-8 8z" />
    </svg>
  );
}
function ArrowUpIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ArrowInBox() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 17l5-5-5-5M15 12H3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
