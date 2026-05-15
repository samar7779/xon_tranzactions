'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { XonSaroyLogo } from '@/components/xon-saroy-logo';

/**
 * Showcase — pro level hero composition.
 * Markazda logo + sarlavha + 3D dashboard (mouse parallax) + animated counter
 * + floating coins, stat chips, cyan flow lines, constellation.
 */
export default function ShowcasePage() {
  const [bal, setBal] = useState(0);
  const [tilt, setTilt] = useState({ rx: 8, ry: -10 });

  // Balance counter — 0 dan target gacha
  useEffect(() => {
    const target = 12_504_500;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 2400);
      setBal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Mouse parallax — kursor harakatlansa karta egiladi
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
                 bg-[radial-gradient(ellipse_at_center,#1a2d63_0%,#0a1428_50%,#040810_100%)]"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <BackgroundNetwork />
      <ConstellationBottom />

      <div className="relative z-10 h-full flex flex-col items-center px-4 pt-4 pb-2">

        {/* LIVE pill */}
        <div className="showcase-fade-up inline-flex items-center gap-2 px-3 py-1 rounded-full
                        bg-emerald-500/10 ring-1 ring-emerald-400/30 text-emerald-300
                        text-[10px] font-semibold tracking-[0.2em] uppercase mb-3">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-80" />
            <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
          Live · Real-time sync
        </div>

        {/* Brand logo */}
        <div className="relative w-[240px] h-[180px] showcase-fade-up" style={{ animationDelay: '0.1s' }}>
          <div className="absolute inset-0 showcase-rays-spin pointer-events-none">
            {Array.from({ length: 18 }).map((_, i) => (
              <div
                key={i}
                className="absolute top-1/2 left-1/2 w-px h-[140px] origin-bottom"
                style={{
                  transform: `translate(-50%, -100%) rotate(${i * (360 / 18)}deg)`,
                  background: `linear-gradient(to top, transparent, rgba(251,191,36,${0.4 + (i % 3) * 0.2}), transparent)`,
                }}
              />
            ))}
          </div>
          <div className="absolute inset-0 -inset-x-10 bg-amber-400/30 blur-3xl rounded-full -z-10" />
          <div className="absolute inset-0 grid place-items-center">
            <XonSaroyLogo size={220} priority />
          </div>
        </div>

        {/* Title */}
        <h1 className="mt-1 text-[34px] sm:text-[44px] lg:text-[52px] font-bold tracking-[-0.025em] text-center leading-[0.95]
                       bg-gradient-to-b from-amber-100 via-amber-300 to-amber-600 bg-clip-text text-transparent
                       drop-shadow-[0_2px_14px_rgba(245,158,11,0.5)] showcase-fade-up"
            style={{ animationDelay: '0.2s' }}>
          XON SAROY TRANSACTIONS
        </h1>
        <p className="mt-2 text-white/65 text-[13px] sm:text-[14px] text-center showcase-fade-up tracking-wide"
           style={{ animationDelay: '0.3s' }}>
          Collect and manage all payments in one place.
        </p>

        {/* 3D dashboard + atrofdagi elementlar */}
        <div className="relative flex-1 w-full max-w-[1200px] mx-auto mt-3"
             style={{ perspective: '1900px' }}>

          {/* Floating coins */}
          <Coin sym="$" pos="top-[8%]  left-[10%]"   size="md" bg="from-blue-400 to-blue-700"   delay="0s"   />
          <Coin sym="€" pos="top-[2%]  left-[34%]"   size="md" bg="from-blue-500 to-blue-800"   delay="1.2s" />
          <Coin sym="£" pos="top-[12%] left-[22%]"   size="sm" bg="from-amber-300 to-amber-600" delay="2.4s" />
          <Coin sym="$" pos="top-[26%] right-[1%]"   size="md" bg="from-slate-100 to-slate-300" delay="0.6s" gold />
          <Coin sym="£" pos="bottom-[8%] right-[36%]" size="md" bg="from-amber-300 to-amber-600" delay="1.8s" />
          <Coin sym="€" pos="bottom-[2%] left-[24%]"  size="sm" bg="from-slate-100 to-slate-300" delay="3s"   gold />

          {/* Floating stat chips */}
          <StatChip label="Data" value="−13.8%"  dir="up"   pos="top-[18%] right-[6%]"  delay="0.4s" />
          <StatChip label="Nidt" value="−300.00" dir="up"   pos="top-[24%] right-[8%]"  delay="0.7s" />
          <StatChip label="Inol" value="3.58%"   dir="up"   pos="top-[30%] right-[5%]"  delay="1.0s" />
          <StatChip label="Data" value="−12.89%" dir="down" pos="bottom-[28%] left-[1%]" delay="1.3s" />
          <StatChip label="USD"  value="−4.7%"   dir="down" pos="bottom-[22%] left-[3%]" delay="1.6s" />

          {/* 3D dashboard */}
          <div className="absolute inset-0 grid place-items-center showcase-card-in">
            <div
              className="relative w-full max-w-[820px]"
              style={{
                transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
                transformStyle: 'preserve-3d',
                transition: 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <div className="absolute -inset-3 rounded-3xl bg-gradient-to-br from-cyan-400/25 via-blue-500/15 to-amber-400/20 blur-3xl -z-10" />

              <div className="relative rounded-[24px] border border-white/10
                              bg-[rgba(18,28,52,0.6)] backdrop-blur-xl
                              shadow-[0_50px_120px_-20px_rgba(0,0,0,0.85)]
                              overflow-hidden">
                {/* Top + bottom accent lines */}
                <div className="absolute inset-x-20 -top-px h-px bg-gradient-to-r from-transparent via-amber-300/80 to-transparent" />
                <div className="absolute inset-x-20 -bottom-px h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />

                {/* Topbar */}
                <div className="flex items-center gap-2 px-5 pt-3.5 pb-3 border-b border-white/5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center
                                  shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_12px_-2px_rgba(245,158,11,0.5)]">
                    <span className="text-[10px] font-black text-slate-900">XS</span>
                  </div>
                  <span className="text-[12px] font-semibold">Dashboard</span>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1.5 h-7 px-3 rounded-full bg-white/[0.04] ring-1 ring-white/8
                                  text-[11px] text-white/40 min-w-[220px]">
                    <SearchIcon /> Search transactions...
                  </div>
                  <NotifPill count={3} color="amber" />
                  <NotifPill count={2} color="cyan" />
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 ring-2 ring-white/20" />
                </div>

                <div className="grid grid-cols-12 gap-3 p-4">
                  {/* Chap: balance + 2 chart */}
                  <div className="col-span-7 space-y-3">
                    {/* TOTAL BALANCE — hero element */}
                    <div className="rounded-2xl bg-gradient-to-br from-slate-900/85 to-slate-800/55 ring-1 ring-white/10 p-4 relative overflow-hidden">
                      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-amber-400/15 blur-3xl" />
                      <div className="absolute -left-10 -bottom-10 w-32 h-32 rounded-full bg-cyan-400/12 blur-3xl" />
                      <div className="relative flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[9px] uppercase tracking-[0.22em] text-white/45 font-semibold">Total Balance · UZS</div>
                          <div className="mt-1 text-[28px] font-bold tabular-nums tracking-tight
                                          bg-gradient-to-r from-amber-100 via-amber-300 to-amber-500 bg-clip-text text-transparent
                                          drop-shadow-[0_2px_8px_rgba(245,158,11,0.3)]">
                            {formatMoney(bal)}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px]">
                            <span className="text-emerald-400 font-semibold flex items-center gap-1">
                              <TrendUp /> 12.5%
                            </span>
                            <span className="text-white/45">vs last month</span>
                          </div>
                        </div>
                        <button className="px-3.5 h-8 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 text-[11px] font-bold
                                            flex items-center gap-1 shadow-lg shadow-amber-500/30 hover:brightness-110 transition shrink-0">
                          Send <ArrowRight />
                        </button>
                      </div>
                    </div>

                    {/* Payment analytics */}
                    <div className="rounded-2xl bg-white/[0.025] ring-1 ring-white/8 p-3.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold">Payment analytics</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/20 font-medium">Auraeoce ▾</span>
                      </div>
                      <PaymentLineChart />
                      <div className="flex justify-between mt-1 text-[9px] text-white/40 px-1">
                        {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m) => <span key={m}>{m}</span>)}
                      </div>
                    </div>
                  </div>

                  {/* O'ng: bars + secure + card */}
                  <div className="col-span-5 space-y-3 relative">
                    <ConnectionLines />

                    {/* "▲ $50.00" badge — connection chizig'i yonida */}
                    <div className="absolute -left-14 top-7 z-10 text-[10px] text-emerald-300 font-bold flex items-center gap-1 showcase-fade-up"
                         style={{ animationDelay: '1.4s' }}>
                      <span className="text-emerald-400">▲</span> $50.00
                    </div>
                    <div className="absolute -left-14 bottom-20 z-10 text-[10px] text-emerald-300 font-bold flex items-center gap-1 showcase-fade-up"
                         style={{ animationDelay: '1.6s' }}>
                      <span className="text-emerald-400">▲</span> $75.00
                    </div>

                    {/* Transaction finance bars */}
                    <div className="rounded-2xl bg-white/[0.025] ring-1 ring-white/8 p-3.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold">Transaction finance</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/20 font-medium">Aqvdcoin ▾</span>
                      </div>
                      <TransactionBars />
                      <div className="flex justify-between mt-1 text-[9px] text-white/40 px-1">
                        {['Mar','Tue','Wed','Thu','Fri','Sat','Sun'].map((m) => <span key={m}>{m}</span>)}
                      </div>
                    </div>

                    {/* Secure Banking */}
                    <div className="rounded-2xl bg-white/[0.025] ring-1 ring-white/8 p-3 flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center shrink-0
                                      shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_12px_-2px_rgba(245,158,11,0.5)]">
                        <ShieldIcon />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-semibold">Secure Banking</div>
                        <div className="text-[9px] text-white/50">All transactions encrypted</div>
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
                        <div className="w-10 h-7 rounded-md bg-gradient-to-br from-amber-400 to-amber-600
                                        shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]" />
                        <div className="text-[11px] font-semibold text-slate-600">Credit</div>
                      </div>
                      <div className="relative mt-3 font-mono text-[13px] tracking-wider text-slate-800">
                        1234 5034 5678 3058
                      </div>
                      <div className="relative mt-2 flex items-center justify-between">
                        <div className="text-[8px] text-slate-500 uppercase tracking-[0.18em] font-semibold">XON SAROY</div>
                        <div className="flex gap-0.5">
                          <span className="w-5 h-5 rounded-full bg-rose-500/80" />
                          <span className="w-5 h-5 rounded-full bg-amber-400/80 -ml-2" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bank logos — pastda */}
              <div className="mt-3 flex items-center justify-center gap-3 showcase-fade-up" style={{ animationDelay: '1.5s' }}>
                <span className="text-[9px] uppercase tracking-[0.25em] text-white/35 font-semibold">Integrated</span>
                <BankPill src="/banks/kapital.webp" name="Kapitalbank" />
                <BankPill src="/banks/ipak.svg" name="Ipak Yo'li" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Floating coin ─── */
function Coin({ sym, pos, size, bg, delay, gold }: {
  sym: string; pos: string; size: 'sm' | 'md'; bg: string; delay: string; gold?: boolean;
}) {
  return (
    <div className={`absolute ${pos} showcase-coin-float pointer-events-none z-20`}
         style={{ animationDelay: delay }}>
      <div className={`${size === 'sm' ? 'w-11 h-11 text-base' : 'w-14 h-14 text-2xl'}
                       rounded-full bg-gradient-to-br ${bg} grid place-items-center font-bold
                       ${gold ? 'text-amber-700' : 'text-white'}
                       ring-2 ring-white/15
                       shadow-[0_12px_28px_-4px_rgba(0,0,0,0.7),inset_0_2px_0_rgba(255,255,255,0.4)]`}>
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
        <span className={dir === 'up' ? 'text-emerald-400 text-[10px]' : 'text-rose-400 text-[10px]'}>
          {dir === 'up' ? '▲' : '▼'}
        </span>
        <span className="text-white/55">{label}</span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
    </div>
  );
}

function BankPill({ src, name }: { src: string; name: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white ring-1 ring-white/20">
      <Image src={src} alt={name} width={14} height={14} className="object-contain" />
      <span className="text-[10px] font-semibold text-slate-800 whitespace-nowrap">{name}</span>
    </div>
  );
}

function PaymentLineChart() {
  return (
    <svg viewBox="0 0 380 100" className="w-full h-[100px]">
      <defs>
        <linearGradient id="pl-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pl-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path d="M 0 75 Q 30 60 60 55 T 120 40 T 180 60 T 240 18 T 300 35 T 380 28 L 380 100 L 0 100 Z"
            fill="url(#pl-fill)" />
      <path d="M 0 75 Q 30 60 60 55 T 120 40 T 180 60 T 240 18 T 300 35 T 380 28"
            fill="none" stroke="url(#pl-stroke)" strokeWidth="2.5" strokeLinecap="round" className="showcase-draw" />
      <circle cx="240" cy="18" r="4.5" fill="#fde68a" />
      <circle cx="240" cy="18" r="9" fill="#fbbf24" opacity="0.35">
        <animate attributeName="r" values="6;14;6" dur="2.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.45;0;0.45" dur="2.5s" repeatCount="indefinite" />
      </circle>
      <g transform="translate(240, 18)">
        <rect x="-34" y="-32" width="74" height="20" rx="4" fill="#0f172a" stroke="#fbbf24" strokeWidth="1" />
        <text x="3" y="-18" fontSize="9" fill="#fde68a" textAnchor="middle" fontWeight="700" fontFamily="monospace">
          ▲ 1 000.00
        </text>
      </g>
      {[25, 50, 75].map((y) => <line key={y} x1="0" y1={y} x2="380" y2={y} stroke="#ffffff10" />)}
    </svg>
  );
}

function TransactionBars() {
  const values = [55, 75, 90, 60, 85, 65, 80];
  return (
    <div className="flex items-end gap-2 h-[90px]">
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center">
          <div className="w-full max-w-[14px] rounded-t-md bg-gradient-to-t from-amber-700 via-amber-500 to-amber-200 showcase-bar
                          shadow-[0_0_8px_rgba(251,191,36,0.4)]"
               style={{ height: `${v}%`, animationDelay: `${0.4 + i * 0.07}s` }} />
        </div>
      ))}
    </div>
  );
}

function ConnectionLines() {
  return (
    <svg viewBox="0 0 200 320" className="absolute -left-32 top-0 w-[200px] h-full pointer-events-none -z-0 overflow-visible">
      <defs>
        <linearGradient id="cl-flow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(34,211,238,0)" />
          <stop offset="50%" stopColor="rgba(34,211,238,0.7)" />
          <stop offset="100%" stopColor="rgba(34,211,238,1)" />
        </linearGradient>
        <radialGradient id="cl-dot" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="rgba(34,211,238,0)" />
        </radialGradient>
      </defs>
      {Array.from({ length: 5 }).map((_, i) => {
        const y1 = 30 + i * 55;
        const y2 = 30 + i * 50;
        return (
          <g key={i}>
            <path d={`M 0 ${y1} Q 100 ${y1 - 10} 200 ${y2}`}
                  fill="none" stroke="url(#cl-flow)" strokeWidth="1.6"
                  strokeDasharray="4 8"
                  className="showcase-flow"
                  style={{ animationDelay: `${i * 0.2}s` }} />
            {/* Glow dot */}
            <circle cx="200" cy={y2} r="8" fill="url(#cl-dot)" />
            <circle cx="200" cy={y2} r="3" fill="#22d3ee" />
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Background ─── */
function BackgroundNetwork() {
  return (
    <>
      <div className="absolute top-0 right-0 w-[450px] h-full
                      bg-gradient-to-bl from-cyan-300/15 via-transparent to-transparent
                      showcase-light-pulse pointer-events-none" />
      <div className="absolute top-0 left-0 w-[450px] h-full
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
    </>
  );
}

function ConstellationBottom() {
  const pts = [
    [60, 200], [140, 240], [220, 180], [310, 220], [380, 160], [450, 230],
    [520, 200], [610, 240], [700, 180], [780, 220], [860, 200], [950, 230],
    [180, 90], [260, 50], [380, 80], [500, 60], [620, 90], [740, 70], [860, 100],
    [40, 80], [120, 30], [820, 30], [920, 80],
  ];
  return (
    <div className="absolute bottom-0 left-0 right-0 h-[260px] opacity-30 pointer-events-none">
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
    </div>
  );
}

/* ─── Helpers ─── */
function formatMoney(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/* ─── Icons ─── */
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
    <svg className="w-5 h-5 text-slate-900" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5l-8-4zM10 17l-4-4 1.4-1.4L10 14.2l6.6-6.6L18 9l-8 8z" />
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
      <span className="absolute -top-1 -right-1 min-w-[13px] h-[13px] rounded-full bg-rose-500 text-white text-[8px] font-bold grid place-items-center px-1">
        {count}
      </span>
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" />
      </svg>
    </div>
  );
}
