'use client';

import { useState } from 'react';

/**
 * Showcase — TZ/1.jpeg va TZ/2.jpeg dagi marketing layout'larning
 * jonli animatsion versiyalari. Login talab qilinmaydi — preview uchun.
 */
export default function ShowcasePage() {
  const [tab, setTab] = useState<'gold' | 'purple'>('gold');

  return (
    <div className="min-h-screen bg-black">
      {/* Tab switcher */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex gap-1 p-1
                      bg-white/10 backdrop-blur-md rounded-full ring-1 ring-white/20">
        <button
          onClick={() => setTab('gold')}
          className={`px-4 py-1.5 rounded-full text-[12px] font-semibold transition-all ${
            tab === 'gold' ? 'bg-amber-400 text-slate-900 shadow-lg' : 'text-white/70 hover:text-white'
          }`}
        >
          Variant 1 · Gold
        </button>
        <button
          onClick={() => setTab('purple')}
          className={`px-4 py-1.5 rounded-full text-[12px] font-semibold transition-all ${
            tab === 'purple' ? 'bg-fuchsia-500 text-white shadow-lg' : 'text-white/70 hover:text-white'
          }`}
        >
          Variant 2 · Purple
        </button>
      </div>

      {tab === 'gold' ? <HeroGold /> : <HeroPurple />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   VARIANT 1 — GOLD / CYAN
   tz/1.jpeg dagi marketing tarhi asosida
   ═══════════════════════════════════════════════════════════ */
function HeroGold() {
  return (
    <div className="relative min-h-screen overflow-hidden text-white
                    bg-[radial-gradient(ellipse_at_center,#1e3a8a_0%,#0a1428_50%,#040810_100%)]">
      {/* Tarmoq nuqtalari */}
      <div className="absolute inset-0 opacity-30 pointer-events-none"
           style={{
             backgroundImage: 'radial-gradient(circle, rgba(96,165,250,0.5) 1px, transparent 1px)',
             backgroundSize: '40px 40px',
             maskImage: 'radial-gradient(ellipse 90% 90% at 50% 40%, #000 30%, transparent 80%)',
             WebkitMaskImage: 'radial-gradient(ellipse 90% 90% at 50% 40%, #000 30%, transparent 80%)',
           }} />

      {/* Diagonal yorug'lik */}
      <div className="absolute top-0 right-0 w-[420px] h-full pointer-events-none
                      bg-gradient-to-bl from-cyan-300/15 via-transparent to-transparent
                      animate-light-pulse" />

      {/* Pastki konstellatsiya — cyan tarmoq */}
      <div className="absolute -bottom-32 left-0 w-1/2 h-[400px] opacity-40 pointer-events-none">
        <ConstellationSvg color="rgba(56,189,248,0.7)" />
      </div>
      <div className="absolute -bottom-32 right-0 w-1/2 h-[400px] opacity-40 pointer-events-none scale-x-[-1]">
        <ConstellationSvg color="rgba(56,189,248,0.7)" />
      </div>

      <div className="relative z-10 flex flex-col items-center px-6 pt-20 pb-32">
        {/* ─── Brand logo (oltin, nurli) ─── */}
        <GoldBrandLogo />

        {/* ─── Title ─── */}
        <h1 className="mt-9 text-[44px] sm:text-[56px] font-bold tracking-[-0.02em] text-center leading-tight
                       bg-gradient-to-b from-amber-200 via-amber-300 to-amber-600 bg-clip-text text-transparent
                       drop-shadow-[0_2px_8px_rgba(245,158,11,0.3)] animate-fade-up">
          XON SAROY TRANSACTIONS
        </h1>
        <p className="mt-3 text-white/75 text-[17px] text-center animate-fade-up"
           style={{ animationDelay: '0.15s' }}>
          Collect and manage all payments in one place.
        </p>

        {/* ─── 3D Dashboard + floating coins ─── */}
        <div className="relative mt-16 w-full max-w-[920px]" style={{ perspective: '1800px' }}>
          {/* Floating coins (atrofda) */}
          <Coin sym="$"  pos="top-[18%] left-[2%]"   bg="bg-blue-500"   delay="0s" />
          <Coin sym="€"  pos="top-[6%] left-[35%]"   bg="bg-blue-600"   delay="1.2s" />
          <Coin sym="£"  pos="top-[2%] left-[20%]"   bg="bg-amber-400"  delay="2.4s" sm />
          <Coin sym="$"  pos="top-[35%] right-[-1%]" bg="bg-white"      delay="0.6s" textGold />
          <Coin sym="£"  pos="bottom-[8%] right-[40%]" bg="bg-amber-400" delay="1.8s" />
          <Coin sym="€"  pos="bottom-[-2%] left-[28%]" bg="bg-white"    delay="3s" textGold sm />

          {/* Stat chiplari */}
          <FloatChip text="Data" value="-13.8%" pos="top-[26%] right-[8%]" dir="up" delay="0.5s" />
          <FloatChip text="Nidt" value="-300.00" pos="top-[32%] right-[10%]" dir="up" delay="0.8s" />
          <FloatChip text="Data" value="-12.89%" pos="bottom-[20%] left-[2%]" dir="down" delay="1.1s" />

          <div className="relative animate-card-in"
               style={{
                 transform: 'rotateX(8deg) rotateY(-12deg) rotateZ(2deg)',
                 transformStyle: 'preserve-3d',
               }}>
            {/* Karta atrofidagi glow */}
            <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-cyan-400/20 via-blue-500/15 to-amber-400/10 blur-2xl -z-10" />

            <div className="relative rounded-3xl border border-white/10
                            bg-[rgba(20,30,55,0.4)] backdrop-blur-xl
                            shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)]
                            overflow-hidden">

              {/* Yuqori bar */}
              <div className="flex items-center gap-3 px-6 pt-5 pb-3">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center text-[8px] font-bold text-slate-900">XS</div>
                <span className="text-[13px] font-semibold">Dashboard</span>
                <div className="flex-1" />
                <div className="h-7 px-3 rounded-full bg-white/5 ring-1 ring-white/10 flex items-center gap-2 text-[11px] text-white/50 min-w-[180px]">
                  <span>🔍</span> Search...
                </div>
                <div className="w-7 h-7 rounded-full bg-amber-400/20 grid place-items-center text-[10px]">3</div>
                <div className="w-7 h-7 rounded-full bg-cyan-400/30 grid place-items-center text-[10px]">2</div>
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-300 to-amber-500" />
              </div>

              <div className="grid grid-cols-12 gap-4 p-5">
                {/* Chap: Payment analytics chart */}
                <div className="col-span-7 space-y-4">
                  <div className="rounded-xl p-4 bg-white/[0.03] ring-1 ring-white/8">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[12px] font-semibold">Payment analytics</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300">Auraeoce ▾</span>
                    </div>
                    <MiniLineChartGold />
                    <div className="flex justify-between mt-2 text-[9px] text-white/40 px-1">
                      {['Jan','Feb','Mar','Apr','Rel','Jun','Dec'].map((m) => <span key={m}>{m}</span>)}
                    </div>
                  </div>

                  {/* Pastdagi bar chart */}
                  <div className="rounded-xl p-4 bg-white/[0.03] ring-1 ring-white/8">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[12px] font-semibold">Transaction finance</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300">Aqvdcoin ▾</span>
                    </div>
                    <MiniBarsGold />
                    <div className="flex justify-between mt-2 text-[9px] text-white/40 px-1">
                      {['Mar','Tue','Wed','Thu','Fri','Sat','Sup'].map((m) => <span key={m}>{m}</span>)}
                    </div>
                  </div>
                </div>

                {/* O'ng: secure + card */}
                <div className="col-span-5 space-y-4">
                  {/* Connection lines (SVG, chartdan tashqariga) */}
                  <ConnectionPulses />

                  {/* Secure Banking */}
                  <div className="rounded-xl p-3.5 bg-white/[0.03] ring-1 ring-white/8 relative">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center">
                        <svg className="w-5 h-5 text-slate-900" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 1L4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5l-8-4zM10 17l-4-4 1.4-1.4L10 14.2l6.6-6.6L18 9l-8 8z"/>
                        </svg>
                      </div>
                      <div>
                        <div className="text-[12px] font-semibold">Secure Banking</div>
                        <div className="text-[10px] text-white/50">All transactions encrypted</div>
                      </div>
                    </div>
                    <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full w-[78%] bg-gradient-to-r from-amber-400 to-amber-500 animate-shimmer" />
                    </div>
                  </div>

                  {/* Credit card */}
                  <div className="rounded-xl p-4 bg-gradient-to-br from-slate-200 to-slate-400 text-slate-900 ring-1 ring-white/10
                                  shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]">
                    <div className="flex items-center justify-between">
                      <div className="w-9 h-7 rounded-md bg-gradient-to-br from-amber-400 to-amber-600" />
                      <div className="text-[11px] font-semibold text-slate-600">Credit</div>
                    </div>
                    <div className="mt-5 font-mono text-[13px] tracking-wider">1234 5034 5678 3058</div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="text-[8px] text-slate-500 uppercase tracking-wider">Cardholder</div>
                      <div className="flex gap-0.5">
                        <span className="w-5 h-5 rounded-full bg-rose-500/80" />
                        <span className="w-5 h-5 rounded-full bg-amber-400/80 -ml-2" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        :global(.animate-fade-up) { animation: fade-up 0.8s cubic-bezier(0.22, 1, 0.36, 1) both; }

        @keyframes card-in {
          from { opacity: 0; transform: rotateX(8deg) rotateY(-12deg) rotateZ(2deg) translateY(40px) scale(0.92); }
          to { opacity: 1; transform: rotateX(8deg) rotateY(-12deg) rotateZ(2deg) translateY(0) scale(1); }
        }
        :global(.animate-card-in) { animation: card-in 1s cubic-bezier(0.22, 1, 0.36, 1) 0.3s both; }

        @keyframes coin-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-14px) rotate(8deg); }
        }
        :global(.animate-coin) { animation: coin-float 6s ease-in-out infinite; }

        @keyframes light-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.7; }
        }
        :global(.animate-light-pulse) { animation: light-pulse 5s ease-in-out infinite; }

        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        :global(.animate-shimmer) {
          background-size: 200% 100%;
          animation: shimmer 2.5s linear infinite;
        }

        @keyframes ray-spin {
          to { transform: rotate(360deg); }
        }
        :global(.animate-rays) { animation: ray-spin 30s linear infinite; }

        @keyframes draw-line {
          to { stroke-dashoffset: 0; }
        }
        :global(.draw-line) {
          stroke-dasharray: 500;
          stroke-dashoffset: 500;
          animation: draw-line 2s cubic-bezier(0.22, 1, 0.36, 1) 0.8s forwards;
        }

        @keyframes flow-dash {
          to { stroke-dashoffset: -24; }
        }
        :global(.flow-dash) { animation: flow-dash 1.5s linear infinite; }

        @keyframes bar-grow {
          from { height: 0%; }
        }
        :global(.bar-grow) { animation: bar-grow 1.2s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>
    </div>
  );
}

function GoldBrandLogo() {
  return (
    <div className="relative animate-fade-up">
      {/* Glow halo */}
      <div className="absolute inset-0 -inset-x-10 bg-amber-400/20 blur-3xl rounded-full -z-10" />

      {/* Aylanuvchi nurlar */}
      <div className="absolute inset-0 -z-10 animate-rays">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i}
               className="absolute top-1/2 left-1/2 w-px h-32 origin-bottom"
               style={{
                 transform: `translate(-50%, -100%) rotate(${i * 30}deg)`,
                 background: 'linear-gradient(to top, transparent, rgba(251,191,36,0.5), transparent)',
               }} />
        ))}
      </div>

      <svg viewBox="0 0 240 200" className="w-[260px] h-[180px]">
        <defs>
          <linearGradient id="gold-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="40%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#92400e" />
          </linearGradient>
          <filter id="gold-glow"><feGaussianBlur stdDeviation="2" /></filter>
        </defs>
        {/* Stilized X-shape mark */}
        <g stroke="url(#gold-grad)" strokeWidth="3" fill="none" strokeLinecap="round">
          <line x1="120" y1="40" x2="120" y2="160" />
          <line x1="50" y1="100" x2="190" y2="100" />
          <line x1="80" y1="60" x2="160" y2="140" />
          <line x1="160" y1="60" x2="80" y2="140" />
        </g>
        <g fill="url(#gold-grad)">
          <polygon points="120,55 132,90 120,75 108,90" />
          <polygon points="120,145 132,110 120,125 108,110" />
        </g>
        <text x="120" y="120" textAnchor="middle"
              fontSize="22" fontWeight="900" letterSpacing="2"
              fill="url(#gold-grad)" filter="url(#gold-glow)"
              fontFamily="serif">
          XON SAROY
        </text>
      </svg>

      {/* Pastdagi aks ettirish */}
      <div className="-mt-3 opacity-20 scale-y-[-1]"
           style={{ maskImage: 'linear-gradient(to bottom, black, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)' }}>
        <svg viewBox="0 0 240 200" className="w-[260px] h-[80px]">
          <text x="120" y="120" textAnchor="middle"
                fontSize="22" fontWeight="900" letterSpacing="2"
                fill="#fbbf24" fontFamily="serif">
            XON SAROY
          </text>
        </svg>
      </div>
    </div>
  );
}

function Coin({ sym, pos, bg, delay, sm, textGold }: {
  sym: string; pos: string; bg: string; delay: string; sm?: boolean; textGold?: boolean;
}) {
  return (
    <div className={`absolute ${pos} animate-coin pointer-events-none z-20`}
         style={{ animationDelay: delay }}>
      <div className={`${sm ? 'w-9 h-9 text-base' : 'w-12 h-12 text-xl'} rounded-full ${bg} grid place-items-center font-bold
                       ${textGold ? 'text-amber-600' : 'text-white'}
                       shadow-[0_6px_20px_-4px_rgba(0,0,0,0.6),inset_0_2px_0_rgba(255,255,255,0.3)]
                       ring-2 ring-white/10`}>
        {sym}
      </div>
    </div>
  );
}

function FloatChip({ text, value, pos, dir, delay }: {
  text: string; value: string; pos: string; dir: 'up' | 'down'; delay: string;
}) {
  return (
    <div className={`absolute ${pos} animate-coin pointer-events-none z-20 text-[11px]`}
         style={{ animationDelay: delay }}>
      <div className="flex items-center gap-1.5 text-white/85 whitespace-nowrap">
        <span className={dir === 'up' ? 'text-emerald-400' : 'text-rose-400'}>
          {dir === 'up' ? '▲' : '▼'}
        </span>
        <span className="text-white/60">{text}</span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
    </div>
  );
}

function MiniLineChartGold() {
  return (
    <svg viewBox="0 0 320 100" className="w-full h-[100px]">
      <defs>
        <linearGradient id="ml-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M 0 70 Q 40 60 60 50 T 120 40 T 180 55 T 240 25 T 320 35 L 320 100 L 0 100 Z"
            fill="url(#ml-fill)" opacity="0.8" />
      <path d="M 0 70 Q 40 60 60 50 T 120 40 T 180 55 T 240 25 T 320 35"
            fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" className="draw-line" />
      <circle cx="240" cy="25" r="4" fill="#fde68a" />
      <g transform="translate(240, 25)">
        <rect x="-30" y="-32" width="68" height="20" rx="4" fill="#1e293b" stroke="#fbbf24" strokeWidth="1" />
        <text x="4" y="-18" fontSize="9" fill="#fde68a" textAnchor="middle" fontWeight="700">1,000.00</text>
      </g>
      {[20, 40, 60, 80].map((y) => <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="#ffffff10" />)}
    </svg>
  );
}

function MiniBarsGold() {
  const values = [55, 75, 90, 60, 85, 65, 80];
  return (
    <div className="flex items-end gap-2 h-[80px]">
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
          <div className="w-full max-w-[12px] rounded-t-md bg-gradient-to-t from-amber-700 to-amber-300 bar-grow"
               style={{ height: `${v}%`, animationDelay: `${0.3 + i * 0.08}s` }} />
        </div>
      ))}
    </div>
  );
}

function ConnectionPulses() {
  return (
    <svg viewBox="0 0 200 280" className="absolute -left-32 top-4 w-[200px] h-[280px] pointer-events-none">
      {Array.from({ length: 5 }).map((_, i) => {
        const y1 = 30 + i * 50;
        const y2 = 30 + i * 35;
        return (
          <g key={i}>
            <path d={`M 0 ${y1} Q 100 ${y1} 200 ${y2}`}
                  fill="none" stroke="#06b6d4" strokeWidth="1.5" strokeOpacity="0.4"
                  strokeDasharray="4 8" className="flow-dash"
                  style={{ animationDelay: `${i * 0.2}s` }} />
            <circle cx="200" cy={y2} r="3" fill="#06b6d4" />
          </g>
        );
      })}
    </svg>
  );
}

function ConstellationSvg({ color }: { color: string }) {
  // Tasodifiy nuqtalar va ulanishlar
  const pts = [
    [50, 50], [120, 90], [180, 60], [240, 120], [80, 160], [200, 180], [300, 90], [350, 200], [40, 220], [280, 250],
  ];
  return (
    <svg viewBox="0 0 400 300" className="w-full h-full">
      {pts.map(([x, y], i) => pts.slice(i + 1).map(([x2, y2], j) => {
        const d = Math.hypot(x - x2, y - y2);
        if (d > 130) return null;
        return <line key={`${i}-${j}`} x1={x} y1={y} x2={x2} y2={y2} stroke={color} strokeWidth="0.5" opacity="0.5" />;
      }))}
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2" fill={color} />)}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   VARIANT 2 — PURPLE / ORBITAL
   tz/2.jpeg dagi marketing tarhi asosida
   ═══════════════════════════════════════════════════════════ */
function HeroPurple() {
  return (
    <div className="relative min-h-screen overflow-hidden text-white
                    bg-[radial-gradient(ellipse_at_top,#1e1b3a_0%,#0f0a24_50%,#06030f_100%)]">
      {/* Olti burchakli pattern */}
      <div className="absolute inset-0 opacity-[0.08] pointer-events-none"
           style={{
             backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='52' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 0L60 17v18L30 52 0 35V17z' fill='none' stroke='%23a855f7' stroke-width='1'/%3E%3C/svg%3E\")",
             backgroundSize: '60px 52px',
           }} />

      {/* Yumshoq glow */}
      <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[900px] h-[700px]
                      bg-[radial-gradient(ellipse_at_center,rgba(217,70,239,0.20),transparent_60%)]
                      pointer-events-none animate-light-pulse" />

      <div className="relative z-10 flex flex-col items-center px-6 pt-16 pb-32">
        {/* ─── Brand logo (bnafsha, nurli) ─── */}
        <PurpleBrandLogo />

        {/* ─── 3D Dashboard + orbital ring ─── */}
        <div className="relative mt-12 w-full max-w-[1000px]" style={{ perspective: '2000px' }}>
          {/* Pastki-chap: Secure Banking floating */}
          <div className="absolute bottom-[12%] -left-4 z-30 animate-card-in"
               style={{ animationDelay: '0.7s' }}>
            <div className="rounded-2xl p-4 bg-[rgba(30,30,55,0.7)] backdrop-blur-xl ring-1 ring-white/10
                            shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)] w-[220px]">
              <div className="text-[10px] uppercase tracking-wider text-white/50 mb-2">Secure Banking</div>
              <div className="rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 p-3 h-[88px] relative overflow-hidden">
                <div className="w-7 h-5 rounded bg-amber-500/80" />
                <div className="mt-3 flex gap-0.5">
                  <span className="w-5 h-5 rounded-full bg-rose-500/80" />
                  <span className="w-5 h-5 rounded-full bg-amber-400/80 -ml-2" />
                </div>
                <div className="absolute right-3 bottom-3 flex gap-0.5">
                  <span className="w-7 h-1 rounded-full bg-white/40" />
                  <span className="w-3 h-1 rounded-full bg-white/40" />
                </div>
              </div>
            </div>
          </div>

          {/* Yuqori-o'ng: Payment Analytics floating */}
          <div className="absolute top-0 right-0 z-30 animate-card-in"
               style={{ animationDelay: '0.5s' }}>
            <div className="rounded-2xl p-4 bg-[rgba(30,30,55,0.7)] backdrop-blur-xl ring-1 ring-white/10
                            shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)] w-[280px]">
              <div className="text-[12px] font-semibold mb-3">Payment Analytics</div>
              <div className="flex items-end gap-1.5 h-[90px]">
                {[40, 55, 90, 60, 70, 95, 50, 65, 75, 55, 80, 60].map((v, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className={`w-full rounded-t-sm bar-grow ${
                      i % 2 === 0
                        ? 'bg-gradient-to-t from-blue-700 to-blue-400'
                        : 'bg-gradient-to-t from-amber-600 to-amber-400'
                    }`} style={{ height: `${v}%`, animationDelay: `${0.5 + i * 0.06}s` }} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-[8px] text-white/40">
                {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m) => <span key={m}>{m}</span>)}
              </div>
            </div>
          </div>

          {/* Markaz: asosiy dashboard 3D karta */}
          <div className="relative animate-card-in mx-auto max-w-[640px]"
               style={{
                 transform: 'rotateX(6deg) rotateY(-10deg)',
                 transformStyle: 'preserve-3d',
               }}>
            <div className="absolute -inset-1 rounded-3xl bg-gradient-to-br from-fuchsia-500/20 via-purple-600/15 to-blue-500/10 blur-2xl -z-10" />

            <div className="relative rounded-3xl overflow-hidden ring-1 ring-white/10
                            shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)]
                            grid grid-cols-[120px_1fr] bg-white">
              {/* Sidebar */}
              <div className="bg-gradient-to-b from-slate-800 to-slate-900 text-white p-4 space-y-1">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-fuchsia-400 to-purple-600" />
                </div>
                {['Dashboard', 'Transactions', 'Payments', 'Settings'].map((item, i) => (
                  <div key={item} className={`text-[11px] px-2 py-1.5 rounded ${i === 1 ? 'bg-white/10 text-white' : 'text-white/50'}`}>
                    {item}
                  </div>
                ))}
              </div>

              {/* Asosiy */}
              <div className="p-5 text-slate-900">
                <div className="text-[14px] font-bold mb-3">UI Dashboard</div>
                <div className="rounded-xl bg-slate-900 text-white p-4 mb-3">
                  <div className="text-[10px] text-white/60">Total Balance</div>
                  <div className="text-[22px] font-bold tabular-nums mt-0.5">$1,250,450.00</div>
                  <button className="mt-2 px-3 h-7 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 text-[10px] font-bold flex items-center gap-1">
                    Send in now →
                  </button>
                </div>
                <div className="text-[11px] font-semibold mb-2">Payment Analytics</div>
                <div className="space-y-1.5">
                  {[
                    { name: 'Beolm Anarice', date: 'Jan 17, 2022', amount: '$11,250.00', trend: '11.2%', color: 'text-emerald-600' },
                    { name: 'Credit Card', date: 'Nei 21, 2023', amount: '$33,250.00', trend: '12.3%', color: 'text-emerald-600' },
                    { name: 'Banktnianment', date: 'Jan 6, 2023', amount: '+$1,250.00', trend: '3.9%', color: 'text-emerald-600' },
                  ].map((r) => (
                    <div key={r.name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-[10px]">
                      <div className="w-6 h-6 rounded bg-slate-200 grid place-items-center">📄</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800 truncate">{r.name}</div>
                        <div className="text-slate-400 text-[9px]">{r.date}</div>
                      </div>
                      <div className="font-semibold text-slate-900 tabular-nums">{r.amount}</div>
                      <div className={`tabular-nums font-semibold ${r.color}`}>{r.trend} ↗</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* O'ng: Transaction Flows orbital ring */}
          <div className="absolute bottom-[8%] right-0 z-30 animate-card-in"
               style={{ animationDelay: '0.9s' }}>
            <OrbitalFlowRing />
          </div>

          {/* Pastki yarim orbital halqalar */}
          <div className="absolute -bottom-12 left-0 right-0 h-[200px] pointer-events-none">
            <div className="absolute inset-x-[15%] inset-y-0 border-2 border-amber-400/20 rounded-[50%]" />
            <div className="absolute inset-x-[5%] inset-y-4 border border-cyan-400/15 rounded-[50%]" />
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        :global(.animate-fade-up) { animation: fade-up 0.8s cubic-bezier(0.22, 1, 0.36, 1) both; }

        @keyframes card-in {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        :global(.animate-card-in) { animation: card-in 0.9s cubic-bezier(0.22, 1, 0.36, 1) both; }

        @keyframes light-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        :global(.animate-light-pulse) { animation: light-pulse 5s ease-in-out infinite; }

        @keyframes orbit {
          to { transform: rotate(360deg); }
        }
        :global(.animate-orbit) { animation: orbit 12s linear infinite; }
        :global(.animate-orbit-reverse) { animation: orbit 16s linear infinite reverse; }

        @keyframes ray-spin {
          to { transform: rotate(360deg); }
        }
        :global(.animate-rays-slow) { animation: ray-spin 40s linear infinite; }

        @keyframes bar-grow {
          from { height: 0%; }
        }
        :global(.bar-grow) { animation: bar-grow 1.2s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>
    </div>
  );
}

function PurpleBrandLogo() {
  return (
    <div className="relative animate-fade-up">
      <div className="absolute inset-0 -inset-x-12 bg-fuchsia-500/20 blur-3xl rounded-full -z-10" />

      {/* Aylanuvchi nurlar */}
      <div className="absolute inset-0 -z-10 animate-rays-slow">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i}
               className="absolute top-1/2 left-1/2 w-px h-40 origin-bottom"
               style={{
                 transform: `translate(-50%, -100%) rotate(${i * 22.5}deg)`,
                 background: 'linear-gradient(to top, transparent, rgba(217,70,239,0.5), transparent)',
               }} />
        ))}
      </div>

      <svg viewBox="0 0 260 220" className="w-[280px] h-[200px]">
        <defs>
          <linearGradient id="purple-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0abfc" />
            <stop offset="50%" stopColor="#d946ef" />
            <stop offset="100%" stopColor="#7e22ce" />
          </linearGradient>
          <filter id="purple-glow"><feGaussianBlur stdDeviation="2.5" /></filter>
        </defs>
        <g stroke="url(#purple-grad)" strokeWidth="3" fill="none" strokeLinecap="round">
          <line x1="130" y1="50" x2="130" y2="170" />
          <line x1="55" y1="110" x2="205" y2="110" />
          <line x1="88" y1="68" x2="172" y2="152" />
          <line x1="172" y1="68" x2="88" y2="152" />
        </g>
        <g fill="url(#purple-grad)">
          <polygon points="130,65 142,100 130,82 118,100" />
          <polygon points="130,155 142,120 130,138 118,120" />
        </g>
        <text x="130" y="130" textAnchor="middle"
              fontSize="20" fontWeight="900" letterSpacing="2.5"
              fill="url(#purple-grad)" filter="url(#purple-glow)"
              fontFamily="serif">
          XON SAROY
        </text>
      </svg>

      <div className="-mt-3 opacity-25 scale-y-[-1]"
           style={{ maskImage: 'linear-gradient(to bottom, black, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)' }}>
        <svg viewBox="0 0 260 220" className="w-[280px] h-[80px]">
          <text x="130" y="130" textAnchor="middle"
                fontSize="20" fontWeight="900" letterSpacing="2.5"
                fill="#d946ef" fontFamily="serif">
            XON SAROY
          </text>
        </svg>
      </div>
    </div>
  );
}

function OrbitalFlowRing() {
  const nodes = [
    { angle: 0, label: 'Users', icon: '👥' },
    { angle: 90, label: 'Bank', icon: '🏛' },
    { angle: 180, label: 'Banks', icon: '🏦' },
    { angle: 270, label: 'User', icon: '👤' },
  ];
  return (
    <div className="relative w-[280px] h-[280px]">
      {/* Tashqi halqa — aylanuvchi nuqtalar bilan */}
      <div className="absolute inset-0 rounded-full border-2 border-amber-400/30">
        <div className="absolute inset-0 animate-orbit">
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i}
                  className="absolute w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                  style={{
                    top: '50%', left: '50%',
                    transform: `translate(-50%, -50%) rotate(${i * 45}deg) translateY(-140px)`,
                  }} />
          ))}
        </div>
      </div>

      {/* O'rta halqa — teskari */}
      <div className="absolute inset-4 rounded-full border border-cyan-400/30">
        <div className="absolute inset-0 animate-orbit-reverse">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i}
                  className="absolute w-1 h-1 rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.9)]"
                  style={{
                    top: '50%', left: '50%',
                    transform: `translate(-50%, -50%) rotate(${i * 60}deg) translateY(-128px)`,
                  }} />
          ))}
        </div>
      </div>

      {/* Markazdagi tugun */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full
                      bg-gradient-to-br from-blue-600 to-indigo-900 ring-2 ring-cyan-400/50
                      grid place-items-center text-center
                      shadow-[0_0_30px_rgba(99,102,241,0.6)]">
        <div className="text-[10px] font-bold text-white leading-tight">Transaction<br/>Flows</div>
      </div>

      {/* 4 ta nod — yon tugunlar */}
      {nodes.map((n) => {
        const rad = (n.angle * Math.PI) / 180;
        const r = 100;
        const x = Math.cos(rad) * r;
        const y = Math.sin(rad) * r;
        return (
          <div key={n.label}
               className="absolute top-1/2 left-1/2 w-14 h-14 -translate-x-1/2 -translate-y-1/2
                          rounded-full bg-gradient-to-br from-slate-700 to-slate-900 ring-2 ring-amber-400/40
                          grid place-items-center"
               style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}>
            <div className="text-[18px]">{n.icon}</div>
            <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-amber-300 whitespace-nowrap font-semibold">
              {n.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
