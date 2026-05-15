'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { XonSaroyLogo } from '@/components/xon-saroy-logo';

/**
 * Showcase — Xon Saroy fintech brand hero.
 * Bitta ekran, scroll yo'q.
 * Pro xususiyatlar: LIVE indicator, real bank logolari, jonli tranzaksiya stream,
 * valyuta kurs strip, mouse parallax, animated counter, refined dashboard.
 */
export default function ShowcasePage() {
  const [tilt, setTilt] = useState({ rx: 8, ry: -10 });
  const [bal, setBal] = useState(0);

  // Balans count-up
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

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const w = window.innerWidth, h = window.innerHeight;
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

      <div className="relative z-10 h-full flex flex-col items-center px-6 pt-4 pb-3">

        {/* LIVE bar — yuqorida */}
        <div className="showcase-fade-up flex items-center gap-2 px-3 py-1 rounded-full
                        bg-emerald-500/10 ring-1 ring-emerald-400/30 text-emerald-300
                        text-[10px] font-semibold tracking-[0.2em] uppercase mb-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-80" />
            <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
          Live · Real-time sync
        </div>

        {/* Brand logo */}
        <BrandHero />

        {/* Main composition */}
        <div className="relative flex-1 w-full max-w-[1200px] mx-auto mt-1"
             style={{ perspective: '2000px' }}>

          {/* CHAP USTUN — recent transactions */}
          <div className="absolute top-[5%] left-0 flex flex-col gap-2 z-20 w-[220px]">
            <ColumnLabel>Recent activity</ColumnLabel>
            <TxCard bank="kapital" name="ABU SAHIY MCHJ"     amount="+18 500 000" time="14:23" dir="in"  delay="0.2s" />
            <TxCard bank="kapital" name="PRIMER LLC"          amount="+12 200 000" time="13:48" dir="in"  delay="0.4s" />
            <TxCard bank="ipak"    name="Soliq to'lovi"       amount="−4 850 000"  time="12:05" dir="out" delay="0.6s" />
            <TxCard bank="kapital" name="OOO TASHKENT MALL"   amount="+7 300 000"  time="11:22" dir="in"  delay="0.8s" />
          </div>

          {/* O'NG USTUN — currency rates */}
          <div className="absolute top-[5%] right-0 flex flex-col gap-2 z-20 w-[200px]">
            <ColumnLabel>FX rates · UZS</ColumnLabel>
            <FxRow code="USD" rate="12 478"  delta="+0.3%" up delay="0.3s" />
            <FxRow code="EUR" rate="13 540"  delta="−0.1%"    delay="0.5s" />
            <FxRow code="GBP" rate="15 820"  delta="+0.5%" up delay="0.7s" />
            <FxRow code="RUB" rate="142.5"   delta="−1.2%"    delay="0.9s" />
          </div>

          {/* MARKAZ — 3D Dashboard */}
          <div className="absolute inset-0 grid place-items-center showcase-card-in">
            <div
              className="relative w-full max-w-[680px]"
              style={{
                transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
                transformStyle: 'preserve-3d',
                transition: 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <div className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-cyan-400/25 via-blue-500/15 to-amber-400/20 blur-3xl -z-10" />

              <div className="relative rounded-[22px] border border-white/10
                              bg-[rgba(18,28,52,0.6)] backdrop-blur-xl
                              shadow-[0_50px_120px_-20px_rgba(0,0,0,0.85)]
                              overflow-hidden">
                <div className="absolute inset-x-16 -top-px h-px bg-gradient-to-r from-transparent via-amber-300/70 to-transparent" />

                {/* Topbar */}
                <div className="flex items-center gap-2 px-4 pt-3 pb-2.5 border-b border-white/5">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center
                                  shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_10px_-2px_rgba(245,158,11,0.4)]">
                    <span className="text-[9px] font-black text-slate-900">XS</span>
                  </div>
                  <span className="text-[11px] font-semibold">Dashboard</span>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-white/[0.04] ring-1 ring-white/8
                                  text-[10px] text-white/40 min-w-[160px]">
                    <SearchIcon /> Search...
                  </div>
                  <NotifPill count={3} color="amber" />
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 ring-2 ring-white/20" />
                </div>

                <div className="p-3.5 space-y-3">
                  {/* Total balance — hero */}
                  <div className="rounded-2xl bg-gradient-to-br from-slate-900/85 to-slate-800/60 ring-1 ring-white/10 p-4 relative overflow-hidden">
                    <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-amber-400/15 blur-3xl" />
                    <div className="absolute -left-10 -bottom-10 w-32 h-32 rounded-full bg-cyan-400/12 blur-3xl" />
                    <div className="relative flex items-start justify-between">
                      <div>
                        <div className="text-[9px] uppercase tracking-[0.22em] text-white/45 font-semibold">Total Balance · UZS</div>
                        <div className="mt-1 text-[26px] font-bold tabular-nums tracking-tight
                                        bg-gradient-to-r from-amber-200 via-amber-300 to-amber-500 bg-clip-text text-transparent">
                          {formatMoney(bal)}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                          <span className="text-emerald-400 font-semibold flex items-center gap-1">
                            <TrendUp /> 12.5%
                          </span>
                          <span className="text-white/45">vs last month</span>
                        </div>
                      </div>
                      <button className="px-3 h-8 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 text-[10px] font-bold
                                          flex items-center gap-1 shadow-lg shadow-amber-500/30 hover:brightness-110 transition">
                        Send <ArrowRight />
                      </button>
                    </div>
                  </div>

                  {/* Chart — dual area */}
                  <div className="rounded-2xl bg-white/[0.025] ring-1 ring-white/8 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold">Payment analytics</span>
                        <span className="flex items-center gap-1 text-[9px] text-white/45">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Inflow
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 ml-2" /> Outflow
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/20 font-medium">Auraeoce ▾</span>
                    </div>
                    <DualMiniChart />
                    <div className="flex justify-between mt-1 text-[9px] text-white/40 px-1">
                      {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m) => <span key={m}>{m}</span>)}
                    </div>
                  </div>

                  {/* Stats row + bank partners */}
                  <div className="grid grid-cols-3 gap-2">
                    <StatTile label="Inflow"   value="48.2M" tone="emerald" trend="+8.3%" />
                    <StatTile label="Outflow"  value="22.7M" tone="rose"    trend="−2.1%" />
                    <StatTile label="Net flow" value="25.5M" tone="amber"   trend="+12.5%" />
                  </div>

                  {/* Integrated banks */}
                  <div className="rounded-2xl bg-white/[0.025] ring-1 ring-white/8 p-2.5 flex items-center gap-3">
                    <div className="text-[9px] uppercase tracking-[0.18em] text-white/45 font-semibold pl-1">Integrated</div>
                    <div className="flex items-center gap-2 flex-1">
                      <BankLogoChip src="/banks/kapital.webp" name="Kapitalbank" />
                      <BankLogoChip src="/banks/ipak.svg" name="Ipak Yo'li" />
                      <div className="flex-1" />
                      <span className="flex items-center gap-1 text-[9px] text-emerald-300 px-2 py-1 rounded-full bg-emerald-500/10 ring-1 ring-emerald-400/20 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> All sync OK
                      </span>
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

/* ─── BLOCKS ─── */

function BrandHero() {
  return (
    <div className="relative showcase-fade-up">
      <div className="absolute inset-0 -z-10 showcase-rays-spin pointer-events-none">
        {Array.from({ length: 16 }).map((_, i) => (
          <div
            key={i}
            className="absolute top-1/2 left-1/2 w-px h-[105px] origin-bottom"
            style={{
              transform: `translate(-50%, -100%) rotate(${i * (360 / 16)}deg)`,
              background: 'linear-gradient(to top, transparent, rgba(251,191,36,0.55), transparent)',
            }}
          />
        ))}
      </div>
      <XonSaroyLogo size={200} glow priority />
    </div>
  );
}

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] uppercase tracking-[0.22em] text-white/40 font-semibold pl-1 showcase-fade-up">
      {children}
    </div>
  );
}

function TxCard({
  bank, name, amount, time, dir, delay,
}: {
  bank: 'kapital' | 'ipak'; name: string; amount: string; time: string; dir: 'in' | 'out'; delay: string;
}) {
  const src = bank === 'kapital' ? '/banks/kapital.webp' : '/banks/ipak.svg';
  return (
    <div
      className="rounded-xl p-2.5 bg-[rgba(18,28,52,0.7)] backdrop-blur-md ring-1 ring-white/10
                 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)] showcase-tx-in"
      style={{ animationDelay: delay }}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-white grid place-items-center shrink-0 overflow-hidden">
          <Image src={src} alt={bank} width={20} height={20} className="object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-white/90 truncate">{name}</div>
          <div className="text-[9px] text-white/45 tabular-nums">{time}</div>
        </div>
        <div className={`text-[11px] font-bold tabular-nums whitespace-nowrap ${dir === 'in' ? 'text-emerald-300' : 'text-rose-300'}`}>
          {amount}
        </div>
      </div>
    </div>
  );
}

function FxRow({
  code, rate, delta, up, delay,
}: {
  code: string; rate: string; delta: string; up?: boolean; delay: string;
}) {
  return (
    <div
      className="rounded-xl p-2.5 bg-[rgba(18,28,52,0.7)] backdrop-blur-md ring-1 ring-white/10
                 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)] flex items-center gap-2 showcase-tx-in"
      style={{ animationDelay: delay }}
    >
      <div className="text-[10px] font-bold tracking-wider text-white/90 w-9">{code}</div>
      <div className="text-[12px] font-bold tabular-nums text-white flex-1">{rate}</div>
      <FxSpark up={!!up} />
      <span className={`text-[10px] font-semibold tabular-nums ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
        {delta}
      </span>
    </div>
  );
}

function FxSpark({ up }: { up: boolean }) {
  const path = up
    ? "M0 14 L8 12 L16 13 L24 8 L32 9 L40 5"
    : "M0 5  L8 7  L16 6  L24 11 L32 10 L40 14";
  const color = up ? '#10b981' : '#f43f5e';
  return (
    <svg viewBox="0 0 40 18" className="w-10 h-4">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatTile({ label, value, tone, trend }: {
  label: string; value: string; tone: 'emerald' | 'rose' | 'amber'; trend: string;
}) {
  const c = {
    emerald: { text: 'text-emerald-300', trendCls: 'text-emerald-400', bg: 'from-emerald-500/15 to-emerald-500/5' },
    rose:    { text: 'text-rose-300',    trendCls: 'text-rose-400',    bg: 'from-rose-500/15 to-rose-500/5' },
    amber:   { text: 'text-amber-300',   trendCls: 'text-amber-400',   bg: 'from-amber-500/15 to-amber-500/5' },
  }[tone];
  return (
    <div className={`rounded-xl bg-gradient-to-br ${c.bg} ring-1 ring-white/10 p-2.5`}>
      <div className="text-[9px] uppercase tracking-[0.18em] text-white/45 font-semibold">{label}</div>
      <div className={`mt-0.5 text-[16px] font-bold tabular-nums ${c.text}`}>{value}</div>
      <div className={`text-[9px] font-semibold tabular-nums ${c.trendCls}`}>{trend}</div>
    </div>
  );
}

function BankLogoChip({ src, name }: { src: string; name: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white ring-1 ring-white/15">
      <Image src={src} alt={name} width={14} height={14} className="object-contain" />
      <span className="text-[10px] font-semibold text-slate-800 whitespace-nowrap">{name}</span>
    </div>
  );
}

function DualMiniChart() {
  return (
    <svg viewBox="0 0 400 90" className="w-full h-[88px]">
      <defs>
        <linearGradient id="in-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="out-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[20, 40, 60].map((y) => <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="#ffffff10" />)}
      {/* Outflow — pastroq */}
      <path d="M 0 60 Q 30 55 60 58 T 120 50 T 180 55 T 240 45 T 300 52 T 360 48 T 400 50 L 400 90 L 0 90 Z" fill="url(#out-fill)" />
      <path d="M 0 60 Q 30 55 60 58 T 120 50 T 180 55 T 240 45 T 300 52 T 360 48 T 400 50"
            fill="none" stroke="#f43f5e" strokeWidth="1.8" strokeLinecap="round" className="showcase-draw" />
      {/* Inflow — yuqoriroq */}
      <path d="M 0 50 Q 30 40 60 35 T 120 25 T 180 38 T 240 15 T 300 22 T 360 18 T 400 14 L 400 90 L 0 90 Z" fill="url(#in-fill)" />
      <path d="M 0 50 Q 30 40 60 35 T 120 25 T 180 38 T 240 15 T 300 22 T 360 18 T 400 14"
            fill="none" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" className="showcase-draw" />
      {/* Pulse dot */}
      <circle cx="240" cy="15" r="3.5" fill="#fde68a" />
      <circle cx="240" cy="15" r="8" fill="#fbbf24" opacity="0.35">
        <animate attributeName="r" values="5;12;5" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.45;0;0.45" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <g transform="translate(240, 15)">
        <rect x="-32" y="-30" width="72" height="20" rx="4" fill="#0f172a" stroke="#fbbf24" strokeWidth="1" />
        <text x="4" y="-16" fontSize="9" fill="#fde68a" textAnchor="middle" fontWeight="700">+8.4M UZS</text>
      </g>
    </svg>
  );
}

/* ─── Background ─── */

function Backdrop() {
  return (
    <>
      <div className="absolute top-0 right-0 w-[420px] h-full
                      bg-gradient-to-bl from-cyan-300/15 via-transparent to-transparent
                      showcase-light-pulse pointer-events-none" />
      <div className="absolute top-0 left-0 w-[420px] h-full
                      bg-gradient-to-br from-amber-400/8 via-transparent to-transparent
                      showcase-light-pulse pointer-events-none"
           style={{ animationDelay: '2.5s' }} />
      <div className="absolute inset-0 opacity-25 pointer-events-none"
           style={{
             backgroundImage: 'radial-gradient(circle, rgba(96,165,250,0.5) 1px, transparent 1px)',
             backgroundSize: '38px 38px',
             maskImage: 'radial-gradient(ellipse 90% 90% at 50% 45%, #000 30%, transparent 80%)',
             WebkitMaskImage: 'radial-gradient(ellipse 90% 90% at 50% 45%, #000 30%, transparent 80%)',
           }} />
      <div className="absolute bottom-0 left-0 right-0 h-[240px] opacity-25 pointer-events-none">
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
  const items = Array.from({ length: 12 }, (_, i) => ({
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

/* ─── Inline icons ─── */
function SearchIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4-4" strokeLinecap="round" />
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
    <div className={`relative w-7 h-7 rounded-full grid place-items-center ring-1 ${cls}`}>
      <span className="absolute -top-1 -right-1 min-w-[13px] h-[13px] rounded-full bg-rose-500 text-white text-[8px] font-bold grid place-items-center px-1">
        {count}
      </span>
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function formatMoney(n: number): string {
  const [int, dec] = n.toFixed(2).split('.');
  return '$' + int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + dec;
}
