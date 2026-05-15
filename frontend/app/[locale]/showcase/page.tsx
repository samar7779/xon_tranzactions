'use client';

import Image from 'next/image';
import { useState } from 'react';
import { XonSaroyLogo } from '@/components/xon-saroy-logo';

/**
 * Showcase — marketing hero (soliqservis uslubida).
 * Chap: matn + CTA. O'ng: haqiqiy 3D rendering ikonalar (3dicons.co) + dotted flow + mouse parallax.
 */
export default function ShowcasePage() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
    const y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    setTilt({ x, y });
  }
  function onLeave() { setTilt({ x: 0, y: 0 }); }

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
        <span className="text-[13px] text-amber-300 font-semibold tabular-nums showcase-fade-up"
              style={{ animationDelay: '0.2s' }}>
          +998 71 202-3282
        </span>
      </header>

      {/* Hero */}
      <main className="relative z-10 px-8 lg:px-12 grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-8 h-[calc(100vh-72px)]">
        {/* CHAP */}
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

        {/* O'NG — 3D ikonalar kompozitsiyasi */}
        <div
          className="relative flex items-center justify-center"
          onMouseMove={onMove}
          onMouseLeave={onLeave}
        >
          {/* Aylanma glow halo */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full
                          bg-[radial-gradient(circle,rgba(251,191,36,0.20)_0%,rgba(99,102,241,0.12)_45%,transparent_70%)]
                          showcase-light-pulse pointer-events-none" />

          {/* Orbital halqalar */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full
                          border border-amber-300/15 showcase-orbit-cw pointer-events-none" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[460px] h-[460px] rounded-full
                          border border-white/10 showcase-orbit-ccw pointer-events-none" />

          {/* Dotted gold flow lines */}
          <FlowLines />

          {/* 3D ikonalar — turli o'lcham, turli pozitsiya, turli kechikish */}
          <Icon3D src="/3d/moneybag-400.webp" size={220} pos="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" delay="0s"   tilt={tilt} strength={1.0} z={20} />
          <Icon3D src="/3d/dollar-400.webp"   size={120} pos="top-[6%]  left-[14%]"  delay="0.2s" tilt={tilt} strength={1.4} z={15} />
          <Icon3D src="/3d/card-400.webp"     size={140} pos="top-[3%]  right-[10%]" delay="0.4s" tilt={tilt} strength={1.3} z={15} />
          <Icon3D src="/3d/chart-400.webp"    size={130} pos="bottom-[12%] left-[6%]" delay="0.6s" tilt={tilt} strength={1.2} z={15} />
          <Icon3D src="/3d/shield-400.webp"   size={120} pos="bottom-[6%] right-[14%]" delay="0.8s" tilt={tilt} strength={1.3} z={15} />
          <Icon3D src="/3d/wallet-400.webp"   size={90}  pos="top-[42%] right-[2%]"  delay="1.0s" tilt={tilt} strength={1.5} z={14} />
          <Icon3D src="/3d/lock-400.webp"     size={70}  pos="top-[40%] left-[2%]"   delay="1.2s" tilt={tilt} strength={1.5} z={14} />
          <Icon3D src="/3d/star-400.webp"     size={60}  pos="top-[20%] left-[44%]"  delay="1.4s" tilt={tilt} strength={1.6} z={14} />
          <Icon3D src="/3d/trophy-400.webp"   size={70}  pos="bottom-[28%] right-[36%]" delay="1.6s" tilt={tilt} strength={1.6} z={14} />

          {/* UI cards floating — real ma'lumot bilan */}
          <FloatCard pos="top-[4%] left-[35%]" delay="0.5s">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 grid place-items-center">
                <TrendUp className="text-white" />
              </div>
              <div>
                <div className="text-[8px] uppercase tracking-wider text-slate-500 font-semibold">Today</div>
                <div className="text-[11px] font-bold text-slate-900 tabular-nums">+12.5%</div>
              </div>
            </div>
          </FloatCard>

          <FloatCard pos="bottom-[2%] left-[26%]" delay="0.9s">
            <div className="flex items-center gap-2 min-w-[160px]">
              <div className="w-7 h-7 rounded-lg bg-white grid place-items-center overflow-hidden ring-1 ring-slate-200 shrink-0">
                <Image src="/banks/kapital.webp" alt="K" width={18} height={18} className="object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-semibold text-slate-800 truncate">ABU SAHIY MCHJ</div>
                <div className="text-[8px] text-slate-500 tabular-nums">14:23</div>
              </div>
              <div className="text-[10px] font-bold text-emerald-600 tabular-nums">+18.5M</div>
            </div>
          </FloatCard>

          <FloatCard pos="bottom-[36%] right-[0%]" delay="1.1s">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center text-amber-900 font-black text-[11px]">$</div>
              <div>
                <div className="text-[8px] uppercase tracking-wider text-slate-500 font-semibold">USD/UZS</div>
                <div className="text-[11px] font-bold text-slate-900 tabular-nums">12 478</div>
              </div>
              <span className="text-[9px] text-emerald-600 font-bold">+0.3%</span>
            </div>
          </FloatCard>

          {/* Particles */}
          <Particles />
        </div>
      </main>
    </div>
  );
}

/* ─── 3D Icon (Parallax bilan) ─── */
function Icon3D({
  src, size, pos, delay, tilt, strength, z,
}: {
  src: string;
  size: number;
  pos: string;
  delay: string;
  tilt: { x: number; y: number };
  strength: number;
  z: number;
}) {
  const px = tilt.x * 18 * strength;
  const py = tilt.y * 18 * strength;
  return (
    <div
      className={`absolute ${pos} showcase-coin-float pointer-events-none drop-shadow-[0_18px_36px_rgba(0,0,0,0.45)]`}
      style={{
        animationDelay: delay,
        zIndex: z,
        transform: `translate(${px}px, ${py}px)`,
        transition: 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        priority
        className="select-none"
        draggable={false}
        style={{ width: size, height: size }}
      />
    </div>
  );
}

/* ─── Floating UI card ─── */
function FloatCard({ pos, delay, children }: { pos: string; delay: string; children: React.ReactNode }) {
  return (
    <div className={`absolute ${pos} z-30 showcase-tx-in pointer-events-none`} style={{ animationDelay: delay }}>
      <div className="px-3 py-2 rounded-2xl bg-white/95 backdrop-blur ring-1 ring-white/20
                      shadow-[0_15px_40px_-10px_rgba(0,0,0,0.5)]">
        {children}
      </div>
    </div>
  );
}

/* ─── Gold dotted flow lines ─── */
function FlowLines() {
  return (
    <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[680px] h-[600px] pointer-events-none"
         viewBox="0 0 680 600">
      <defs>
        <radialGradient id="flow-dot" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="1" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Dollar → markaz */}
      <path d="M 130 70  Q 240 220 340 300" stroke="rgba(251,191,36,0.55)" strokeWidth="1.5" strokeDasharray="3 7" fill="none"
            className="showcase-flow" />
      {/* Card → markaz */}
      <path d="M 560 60  Q 460 200 360 290" stroke="rgba(251,191,36,0.55)" strokeWidth="1.5" strokeDasharray="3 7" fill="none"
            className="showcase-flow" style={{ animationDelay: '0.3s' }} />
      {/* Chart → markaz */}
      <path d="M 80 470  Q 200 400 320 340" stroke="rgba(251,191,36,0.45)" strokeWidth="1.5" strokeDasharray="3 7" fill="none"
            className="showcase-flow" style={{ animationDelay: '0.6s' }} />
      {/* Shield → markaz */}
      <path d="M 580 510 Q 460 430 360 350" stroke="rgba(251,191,36,0.45)" strokeWidth="1.5" strokeDasharray="3 7" fill="none"
            className="showcase-flow" style={{ animationDelay: '0.9s' }} />

      {/* Connection dots */}
      {[[130,70],[560,60],[80,470],[580,510]].map(([x,y], i) => (
        <circle key={i} cx={x} cy={y} r="4" fill="url(#flow-dot)" className="showcase-twinkle"
                style={{ transformOrigin: `${x}px ${y}px`, animationDelay: `${i * 0.5}s` }} />
      ))}
    </svg>
  );
}

/* ─── Background ─── */
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
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-amber-400/12 blur-[120px] showcase-light-pulse" />
      <div className="absolute -bottom-40 -right-40 w-[700px] h-[700px] rounded-full bg-indigo-400/12 blur-[120px] showcase-light-pulse"
           style={{ animationDelay: '3s' }} />
    </>
  );
}

function Particles() {
  const items = Array.from({ length: 10 }, (_, i) => ({
    left: `${(i * 73) % 100}%`,
    bottom: `${(i * 31) % 50}%`,
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

function TrendUp({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-3 h-3 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M3 17l6-6 4 4 8-8M21 7v6h-6" strokeLinecap="round" strokeLinejoin="round" />
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
