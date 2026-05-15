'use client';

import { useEffect, useRef, useState } from 'react';
import { XonSaroyLogo } from '@/components/xon-saroy-logo';

/**
 * Showcase — Xon Saroy brand + 3D dashboard.
 * Bitta ekranga sig'adi, scroll yo'q. Pro xususiyatlar:
 * mouse parallax, animated counter, floating particles, holographic shimmer.
 */
export default function ShowcasePage() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rx: 8, ry: -10 });
  const [bal, setBal] = useState(0);

  // ─── Balansni animatsion sanash ───
  useEffect(() => {
    const target = 12_504_500.0;
    const start = performance.now();
    const dur = 2200;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setBal(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ─── Mouse parallax ───
  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = (e.clientX - w / 2) / (w / 2);
    const y = (e.clientY - h / 2) / (h / 2);
    setTilt({ rx: 8 - y * 4, ry: -10 - x * 5 });
  }
  function onLeave() { setTilt({ rx: 8, ry: -10 }); }

  return (
    <div
      className="relative w-screen h-screen overflow-hidden text-white
                 bg-[radial-gradient(ellipse_at_center,#1a2d63_0%,#0a1428_45%,#020613_100%)]"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <Backdrop />
      <Particles />

      <div className="relative z-10 h-full flex flex-col items-center px-8 pt-8 pb-6">
        {/* ─── Brand logo (rasm + nurlar) ─── */}
        <BrandHero />

        {/* ─── 3D Dashboard + floating elementlar ─── */}
        <div className="relative flex-1 w-full max-w-[1040px] mx-auto mt-2"
             style={{ perspective: '1900px' }}>

          {/* Floating coins — kamroq, nafis joylashgan */}
          <Coin sym="€" pos="top-[4%] left-[8%]"   size="md" bg="from-blue-500 to-blue-700"    delay="0s" />
          <Coin sym="£" pos="top-[2%] left-[26%]"  size="sm" bg="from-amber-300 to-amber-500"  delay="1.2s" />
          <Coin sym="$" pos="top-[20%] right-[1%]" size="md" bg="from-slate-100 to-slate-300"  delay="0.6s" gold />
          <Coin sym="£" pos="bottom-[8%] right-[28%]" size="md" bg="from-amber-300 to-amber-500" delay="1.8s" />
          <Coin sym="€" pos="bottom-[-2%] left-[22%]" size="sm" bg="from-slate-100 to-slate-300" delay="2.6s" gold />

          {/* Refined stat chiplari — 3 ta */}
          <StatChip label="Data" value="−13.8%" dir="up"   pos="top-[14%] right-[8%]"  delay="0.4s" />
          <StatChip label="Nidt" value="−300.00" dir="up"  pos="top-[22%] right-[10%]" delay="0.7s" />
          <StatChip label="USD"  value="−4.7%"  dir="down" pos="bottom-[24%] left-[2%]" delay="1.0s" />

          {/* 3D Dashboard */}
          <div className="absolute inset-0 grid place-items-center showcase-card-in">
            <div
              ref={cardRef}
              className="relative w-full max-w-[880px]"
              style={{
                transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
                transformStyle: 'preserve-3d',
                transition: 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <div className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-cyan-400/20 via-blue-500/15 to-amber-400/15 blur-3xl -z-10" />

              <div className="relative rounded-[24px] border border-white/10
                              bg-[rgba(18,28,52,0.55)] backdrop-blur-xl
                              shadow-[0_50px_120px_-20px_rgba(0,0,0,0.85)]
                              overflow-hidden">
                <div className="absolute inset-x-16 -top-px h-px bg-gradient-to-r from-transparent via-amber-300/70 to-transparent" />
                <div className="absolute inset-x-16 -bottom-px h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />

                {/* Topbar */}
                <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-white/5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center
                                  shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_12px_-2px_rgba(245,158,11,0.5)]">
                    <span className="text-[10px] font-black text-slate-900">XS</span>
                  </div>
                  <span className="text-[12px] font-semibold tracking-tight">Dashboard</span>
                  <div className="flex-1" />
                  <div className="hidden sm:flex items-center gap-2 h-7 px-3 rounded-full bg-white/[0.04] ring-1 ring-white/8
                                  text-[11px] text-white/40 min-w-[200px]">
                    <SearchIcon /> Search transactions...
                  </div>
                  <NotifPill count={3} color="amber" />
                  <NotifPill count={2} color="cyan" />
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 ring-2 ring-white/20" />
                </div>

                <div className="grid grid-cols-12 gap-3 p-4">
                  {/* Chap: total balance + analytics */}
                  <div className="col-span-7 space-y-3">
                    {/* Total balance */}
                    <div className="rounded-2xl bg-gradient-to-br from-slate-900/80 to-slate-800/60 ring-1 ring-white/10 p-4 relative overflow-hidden">
                      <div className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-amber-400/15 blur-3xl" />
                      <div className="text-[10px] uppercase tracking-[0.2em] text-white/45 font-semibold">Total Balance</div>
                      <div className="mt-1 text-[28px] font-bold tabular-nums tracking-tight
                                      bg-gradient-to-r from-amber-200 via-amber-300 to-amber-500 bg-clip-text text-transparent">
                        ${formatMoney(bal)}
                      </div>
                      <div className="mt-2.5 flex items-center gap-3">
                        <button className="px-3.5 h-8 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 text-[11px] font-bold
                                            flex items-center gap-1 shadow-lg shadow-amber-500/30 hover:brightness-110 transition">
                          Send in now <ArrowRight />
                        </button>
                        <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1.5">
                          <TrendUp /> 12.5% <span className="text-white/40 font-normal">vs last month</span>
                        </span>
                      </div>
                    </div>

                    {/* Payment analytics */}
                    <div className="rounded-2xl bg-white/[0.025] ring-1 ring-white/8 p-3.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold">Payment analytics</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 font-medium ring-1 ring-amber-400/20">Auraeoce ▾</span>
                      </div>
                      <MiniLineChart />
                      <div className="flex justify-between mt-1 text-[9px] text-white/40 px-1">
                        {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m) => <span key={m}>{m}</span>)}
                      </div>
                    </div>
                  </div>

                  {/* O'ng: bars, secure, card */}
                  <div className="col-span-5 space-y-3 relative">
                    <ConnectionLines />

                    <div className="rounded-2xl bg-white/[0.025] ring-1 ring-white/8 p-3.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold">Transaction finance</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 font-medium ring-1 ring-amber-400/20">Aqvdcoin ▾</span>
                      </div>
                      <MiniBars />
                      <div className="flex justify-between mt-1 text-[9px] text-white/40 px-1">
                        {['Mar','Tue','Wed','Thu','Fri','Sat','Sun'].map((m) => <span key={m}>{m}</span>)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white/[0.025] ring-1 ring-white/8 p-3 flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center shrink-0
                                      shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_10px_-2px_rgba(245,158,11,0.4)]">
                        <ShieldIcon />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-semibold">Secure Banking</div>
                        <div className="text-[9px] text-white/50">End-to-end encrypted</div>
                        <div className="mt-1 h-0.5 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full w-[82%] bg-gradient-to-r from-amber-400 to-amber-300" />
                        </div>
                      </div>
                    </div>

                    {/* Credit card — holographic */}
                    <div className="relative rounded-2xl p-3.5 bg-gradient-to-br from-slate-100 via-slate-200 to-slate-100 text-slate-900
                                    ring-1 ring-white/20 shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6)] overflow-hidden">
                      <div className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent showcase-hologram pointer-events-none" />
                      <div className="relative flex items-center justify-between">
                        <div className="w-9 h-7 rounded-md bg-gradient-to-br from-amber-400 to-amber-600
                                        shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]" />
                        <div className="text-[11px] font-semibold text-slate-600">Credit</div>
                      </div>
                      <div className="relative mt-3 font-mono text-[12px] tracking-wider text-slate-800">
                        1234 5034 5678 3058
                      </div>
                      <div className="relative mt-2 flex items-center justify-between">
                        <div className="text-[8px] text-slate-500 uppercase tracking-[0.18em] font-semibold">XON SAROY</div>
                        <div className="flex gap-0.5">
                          <span className="w-4 h-4 rounded-full bg-rose-500/80" />
                          <span className="w-4 h-4 rounded-full bg-amber-400/80 -ml-1.5" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Brand hero ─── */
function BrandHero() {
  return (
    <div className="relative showcase-fade-up">
      {/* Aylanuvchi nurlar */}
      <div className="absolute inset-0 -z-10 showcase-rays-spin pointer-events-none">
        {Array.from({ length: 14 }).map((_, i) => (
          <div
            key={i}
            className="absolute top-1/2 left-1/2 w-px h-[110px] origin-bottom"
            style={{
              transform: `translate(-50%, -100%) rotate(${i * (360 / 14)}deg)`,
              background: 'linear-gradient(to top, transparent, rgba(251,191,36,0.55), transparent)',
            }}
          />
        ))}
      </div>

      <XonSaroyLogo size={220} glow priority />

      {/* Mirror reflection */}
      <div className="absolute left-0 right-0 -bottom-2 h-8 opacity-25 scale-y-[-1] pointer-events-none"
           style={{
             maskImage: 'linear-gradient(to bottom, black, transparent)',
             WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
           }}>
        <XonSaroyLogo size={220} />
      </div>
    </div>
  );
}

/* ─── Yordamchi komponentlar ─── */

function Coin({ sym, pos, size, bg, delay, gold }: {
  sym: string; pos: string; size: 'sm' | 'md'; bg: string; delay: string; gold?: boolean;
}) {
  return (
    <div className={`absolute ${pos} showcase-coin-float pointer-events-none z-20`}
         style={{ animationDelay: delay }}>
      <div className={`${size === 'sm' ? 'w-9 h-9 text-base' : 'w-12 h-12 text-xl'}
                       rounded-full bg-gradient-to-br ${bg} grid place-items-center font-bold
                       ${gold ? 'text-amber-700' : 'text-white'}
                       ring-2 ring-white/15
                       shadow-[0_8px_24px_-4px_rgba(0,0,0,0.7),inset_0_2px_0_rgba(255,255,255,0.35)]`}>
        {sym}
      </div>
    </div>
  );
}

function StatChip({ label, value, dir, pos, delay }: {
  label: string; value: string; dir: 'up' | 'down'; pos: string; delay: string;
}) {
  return (
    <div className={`absolute ${pos} showcase-coin-float pointer-events-none z-20 text-[11px] whitespace-nowrap`}
         style={{ animationDelay: delay }}>
      <div className="flex items-center gap-1.5 text-white/85 px-2.5 py-1 rounded-full
                      bg-white/[0.04] backdrop-blur-md ring-1 ring-white/10">
        <span className={dir === 'up' ? 'text-emerald-400 text-[9px]' : 'text-rose-400 text-[9px]'}>
          {dir === 'up' ? '▲' : '▼'}
        </span>
        <span className="text-white/55">{label}</span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
    </div>
  );
}

function MiniLineChart() {
  return (
    <svg viewBox="0 0 360 90" className="w-full h-[80px]">
      <defs>
        <linearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lc-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path d="M 0 65 Q 30 55 60 50 T 120 35 T 180 55 T 240 18 T 300 30 T 360 25 L 360 90 L 0 90 Z" fill="url(#lc-fill)" />
      <path d="M 0 65 Q 30 55 60 50 T 120 35 T 180 55 T 240 18 T 300 30 T 360 25"
            fill="none" stroke="url(#lc-stroke)" strokeWidth="2" strokeLinecap="round" className="showcase-draw" />
      <circle cx="240" cy="18" r="4" fill="#fde68a" />
      <circle cx="240" cy="18" r="9" fill="#fbbf24" opacity="0.3">
        <animate attributeName="r" values="6;14;6" dur="2.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0;0.4" dur="2.5s" repeatCount="indefinite" />
      </circle>
      <g transform="translate(240, 18)">
        <rect x="-30" y="-30" width="68" height="20" rx="4" fill="#0f172a" stroke="#fbbf24" strokeWidth="1" />
        <text x="4" y="-16" fontSize="9" fill="#fde68a" textAnchor="middle" fontWeight="700">1,000.00</text>
      </g>
      {[20, 40, 60].map((y) => <line key={y} x1="0" y1={y} x2="360" y2={y} stroke="#ffffff10" />)}
    </svg>
  );
}

function MiniBars() {
  const values = [50, 70, 95, 55, 85, 65, 80];
  return (
    <div className="flex items-end gap-1.5 h-[80px]">
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center">
          <div className="w-full max-w-[12px] rounded-t-md bg-gradient-to-t from-amber-700 to-amber-300 showcase-bar"
               style={{ height: `${v}%`, animationDelay: `${0.4 + i * 0.07}s` }} />
        </div>
      ))}
    </div>
  );
}

function ConnectionLines() {
  return (
    <svg viewBox="0 0 200 280" className="absolute -left-28 top-0 w-[200px] h-full pointer-events-none -z-0">
      {Array.from({ length: 5 }).map((_, i) => {
        const y1 = 30 + i * 50;
        const y2 = 30 + i * 45;
        return (
          <g key={i}>
            <path d={`M 0 ${y1} Q 100 ${y1 - 10} 200 ${y2}`}
                  fill="none" stroke="#06b6d4" strokeWidth="1.5" strokeOpacity="0.5"
                  strokeDasharray="4 8"
                  className="showcase-flow"
                  style={{ animationDelay: `${i * 0.2}s` }} />
            <circle cx="200" cy={y2} r="2.5" fill="#22d3ee" />
          </g>
        );
      })}
    </svg>
  );
}

function Backdrop() {
  return (
    <>
      <div className="absolute top-0 right-0 w-[420px] h-full
                      bg-gradient-to-bl from-cyan-300/15 via-transparent to-transparent
                      showcase-light-pulse pointer-events-none" />
      <div className="absolute inset-0 opacity-25 pointer-events-none"
           style={{
             backgroundImage: 'radial-gradient(circle, rgba(96,165,250,0.5) 1px, transparent 1px)',
             backgroundSize: '38px 38px',
             maskImage: 'radial-gradient(ellipse 90% 90% at 50% 45%, #000 30%, transparent 80%)',
             WebkitMaskImage: 'radial-gradient(ellipse 90% 90% at 50% 45%, #000 30%, transparent 80%)',
           }} />
      <div className="absolute bottom-0 left-0 right-0 h-[260px] opacity-25 pointer-events-none">
        <ConstellationSvg />
      </div>
    </>
  );
}

function ConstellationSvg() {
  const pts = [
    [60, 200], [140, 240], [220, 180], [310, 220], [380, 160], [450, 230],
    [520, 200], [610, 240], [700, 180], [780, 220], [860, 200], [950, 230],
    [180, 90], [260, 50], [380, 80], [500, 60], [620, 90], [740, 70], [860, 100],
    [40, 80], [120, 30], [820, 30], [920, 80],
  ];
  return (
    <svg viewBox="0 0 1000 280" className="w-full h-full" preserveAspectRatio="none">
      {pts.map(([x, y], i) =>
        pts.slice(i + 1).map(([x2, y2], j) => {
          const d = Math.hypot(x - x2, y - y2);
          if (d > 140) return null;
          return (
            <line key={`${i}-${j}`} x1={x} y1={y} x2={x2} y2={y2}
                  stroke="rgba(56,189,248,0.6)" strokeWidth="0.5" opacity="0.5" />
          );
        }),
      )}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.8" fill="rgba(125,211,252,0.9)"
                className="showcase-twinkle"
                style={{ animationDelay: `${(i * 0.31) % 3}s` }} />
      ))}
    </svg>
  );
}

function Particles() {
  const items = Array.from({ length: 14 }, (_, i) => ({
    left: `${(i * 73) % 100}%`,
    bottom: `${(i * 31) % 40}%`,
    delay: `${(i * 0.7) % 8}s`,
    size: i % 3 === 0 ? 3 : 1.5,
  }));
  return (
    <div className="absolute inset-0 pointer-events-none">
      {items.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-amber-300/60 showcase-particle"
          style={{
            left: p.left, bottom: p.bottom,
            width: p.size, height: p.size,
            animationDelay: p.delay,
            boxShadow: '0 0 6px rgba(251,191,36,0.8)',
          }}
        />
      ))}
    </div>
  );
}

/* ─── Inline ikonalar ─── */
function SearchIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4-4" strokeLinecap="round" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg className="w-4 h-4 text-slate-900" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1 4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5l-8-4zm-2 16-4-4 1.4-1.4L10 14.2l6.6-6.6L18 9l-8 8z" />
    </svg>
  );
}
function ArrowRight() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 12h14M13 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TrendUp() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M3 17l6-6 4 4 8-8M21 7v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NotifPill({ count, color }: { count: number; color: 'amber' | 'cyan' }) {
  const cls = color === 'amber'
    ? 'bg-amber-400/15 text-amber-300 ring-amber-400/25'
    : 'bg-cyan-400/15 text-cyan-300 ring-cyan-400/25';
  return (
    <div className={`relative w-8 h-8 rounded-full grid place-items-center ring-1 ${cls}`}>
      <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-rose-500 text-white text-[9px] font-bold grid place-items-center px-1">
        {count}
      </span>
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function formatMoney(n: number): string {
  const [int, dec] = n.toFixed(2).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + dec;
}
