'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { XonSaroyLogo } from '@/components/xon-saroy-logo';

/**
 * Showcase — soliqservis uslubidagi 3D-style kompozitsiya:
 * platform + 2 telefon + laptop + markazda XON SAROY seal +
 * 3 floating cloud card + gold dotted flow lines.
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

        {/* O'NG — soliqservis-uslubidagi kompozitsiya */}
        <div className="relative h-full">
          {/* Cloud cards — yuqorida */}
          <CloudCard pos="top-[4%]  left-[10%]"  icon={<PercentIcon />}  color="amber" delay="0.4s" />
          <CloudCard pos="top-[0%]  left-[42%]"  icon={<ClockIcon />}    color="blue"  delay="0.6s" big />
          <CloudCard pos="top-[6%]  right-[6%]"  icon={<LockPenIcon />}  color="blue"  delay="0.8s" />

          {/* Dotted flow lines (cloud → platforma) */}
          <FlowLines />

          {/* Floating yellow arrow */}
          <div className="absolute top-[36%] left-[6%] showcase-coin-float pointer-events-none z-10"
               style={{ animationDelay: '0.5s' }}>
            <svg width="70" height="90" viewBox="0 0 60 80">
              <defs>
                <linearGradient id="arr-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fde68a" />
                  <stop offset="100%" stopColor="#d97706" />
                </linearGradient>
              </defs>
              <path d="M 20 5 L 50 35 L 35 35 L 35 75 L 5 75 L 5 35 L -10 35 Z"
                    fill="url(#arr-grad)"
                    transform="rotate(-25 25 40)"
                    style={{ filter: 'drop-shadow(0 10px 18px rgba(0,0,0,0.5))' }} />
            </svg>
          </div>

          {/* Floating gold ring "0" */}
          <div className="absolute top-[40%] right-[2%] showcase-coin-float pointer-events-none z-10"
               style={{ animationDelay: '0.9s' }}>
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-300 to-amber-600
                            ring-4 ring-amber-200/40
                            shadow-[0_12px_30px_-4px_rgba(245,158,11,0.7),inset_0_2px_0_rgba(255,255,255,0.5)]
                            grid place-items-center">
              <div className="w-8 h-8 rounded-full ring-[4px] ring-amber-900/40" />
            </div>
          </div>

          {/* Dot pattern circle */}
          <div className="absolute bottom-[6%] right-[-3%] w-28 h-28 opacity-50 pointer-events-none"
               style={{
                 backgroundImage: 'radial-gradient(circle, #fbbf24 1.5px, transparent 1.5px)',
                 backgroundSize: '11px 11px',
                 maskImage: 'radial-gradient(circle, black 60%, transparent 100%)',
                 WebkitMaskImage: 'radial-gradient(circle, black 60%, transparent 100%)',
               }} />

          {/* ASOSIY KOMPOZITSIYA — markazda */}
          <div className="absolute inset-x-0 bottom-[5%] flex items-end justify-center"
               style={{ perspective: '1800px' }}>
            <div className="relative w-full max-w-[720px] showcase-card-in">
              {/* Platform — 3D tilt */}
              <div className="relative" style={{ transform: 'rotateX(14deg)', transformStyle: 'preserve-3d' }}>
                <div className="relative w-full h-[60px] rounded-[28px]
                                bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900
                                ring-1 ring-white/15
                                shadow-[0_30px_80px_-15px_rgba(0,0,0,0.8)]
                                overflow-hidden">
                  <div className="absolute inset-0 opacity-50"
                       style={{
                         backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.5) 0.6px, transparent 0.6px)',
                         backgroundSize: '20px 20px',
                       }} />
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.30)_0%,transparent_70%)]" />
                </div>
                <div className="absolute -bottom-3 left-2 right-2 h-3 rounded-b-[28px]
                                bg-gradient-to-b from-slate-950 to-slate-900 ring-1 ring-white/5" />
              </div>

              {/* Platforma ustidagi elementlar — markazda guruhlangan */}
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-center gap-4 px-8 pb-4">
                {/* Chap telefon */}
                <div className="showcase-tx-in" style={{ animationDelay: '0.7s' }}>
                  <PhoneLeft />
                </div>

                {/* Markazdagi XON SAROY seal (yuqoriroq) */}
                <div className="self-end -mb-6 z-20 showcase-fade-up" style={{ animationDelay: '0.5s' }}>
                  <BrandSeal />
                </div>

                {/* O'ng telefon */}
                <div className="showcase-tx-in" style={{ animationDelay: '0.9s' }}>
                  <PhoneRight />
                </div>

                {/* Laptop */}
                <div className="showcase-tx-in self-end" style={{ animationDelay: '1.1s' }}>
                  <LaptopMock bal={bal} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ─── XON SAROY seal (markaziy oltin emblem) ─── */
function BrandSeal() {
  return (
    <div className="relative w-[140px] h-[140px]">
      <div className="absolute inset-0 rounded-full bg-amber-400/30 blur-2xl -z-10" />
      {/* Tashqi oltin ring */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-200 via-amber-500 to-amber-800
                      ring-2 ring-amber-300/50
                      shadow-[0_15px_40px_-8px_rgba(245,158,11,0.8),inset_0_3px_0_rgba(255,255,255,0.5),inset_0_-3px_8px_rgba(0,0,0,0.25)]
                      grid place-items-center">
        <div className="w-[108px] h-[108px] rounded-full bg-gradient-to-br from-amber-100 via-amber-300 to-amber-500
                        ring-1 ring-amber-900/20 grid place-items-center">
          <XonSaroyLogo size={84} />
        </div>
      </div>
      {/* Aylanuvchi yozuv */}
      <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full showcase-rays-spin">
        <defs>
          <path id="seal-text-path" d="M 100 100 m -70 0 a 70 70 0 1 1 140 0 a 70 70 0 1 1 -140 0" />
        </defs>
        <text fontFamily="serif" fontSize="10" fontWeight="900" letterSpacing="4" fill="#78350f">
          <textPath href="#seal-text-path" startOffset="0">
            · XON SAROY · TREASURY · XON SAROY · TREASURY ·
          </textPath>
        </text>
      </svg>
    </div>
  );
}

/* ─── Cloud Card (3D cloud + icon yuqorida) ─── */
function CloudCard({
  pos, icon, color, delay, big,
}: {
  pos: string; icon: React.ReactNode; color: 'amber' | 'blue'; delay: string; big?: boolean;
}) {
  const w = big ? 140 : 110;
  const iconBg = color === 'amber'
    ? 'from-amber-300 to-amber-500'
    : 'from-blue-400 to-indigo-600';
  return (
    <div className={`absolute ${pos} showcase-tx-in pointer-events-none`} style={{ animationDelay: delay }}>
      <div className="showcase-coin-float" style={{ animationDelay: delay }}>
        <div className="relative" style={{ width: w, height: w * 0.78 }}>
          {/* Cloud silhouette — to'q ko'k */}
          <svg viewBox="0 0 140 110" className="absolute inset-0 w-full h-full">
            <defs>
              <linearGradient id={`cl-${color}-${delay}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b4869" />
                <stop offset="100%" stopColor="#1e293b" />
              </linearGradient>
              <filter id={`sh-${color}-${delay}`}>
                <feDropShadow dx="0" dy="10" stdDeviation="6" floodColor="rgba(0,0,0,0.5)" />
              </filter>
            </defs>
            <path
              d="M 35 75 Q 12 75 12 55 Q 12 38 28 36 Q 30 18 48 18 Q 60 8 75 18 Q 90 10 105 22 Q 132 22 132 50 Q 138 60 132 70 Q 132 85 110 85 L 48 85 Q 32 85 35 75 Z"
              fill={`url(#cl-${color}-${delay})`}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="1.2"
              filter={`url(#sh-${color}-${delay})`}
            />
            {/* Highlight glare on cloud top */}
            <ellipse cx="65" cy="32" rx="40" ry="10" fill="rgba(255,255,255,0.10)" />
          </svg>
          {/* Icon (3D-like bevel) — cloud ichida markazda */}
          <div className="absolute inset-0 grid place-items-center">
            <div className={`${big ? 'w-12 h-12' : 'w-10 h-10'} rounded-2xl bg-gradient-to-br ${iconBg} grid place-items-center
                            shadow-[inset_0_2px_0_rgba(255,255,255,0.5),inset_0_-2px_4px_rgba(0,0,0,0.25),0_8px_20px_-2px_rgba(0,0,0,0.5)]
                            -mt-2`}>
              {icon}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── PhoneLeft — login screen with notification overlay ─── */
function PhoneLeft() {
  return (
    <div className="relative w-[140px] h-[260px]">
      <div className="absolute inset-0 rounded-[24px] bg-gradient-to-b from-slate-300 to-slate-500 p-1.5
                      shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.5)]">
        <div className="w-full h-full rounded-[18px] bg-gradient-to-b from-slate-800 to-slate-950 overflow-hidden relative">
          <div className="absolute top-1 left-1/2 -translate-x-1/2 w-10 h-2.5 rounded-full bg-black/80" />
          <div className="pt-4 px-2.5 flex items-center justify-between text-[6px] text-white/60 font-semibold">
            <span>9:41</span>
            <span>●●●</span>
          </div>
          <div className="px-2 mt-2 space-y-1.5">
            <div className="h-12 rounded-md bg-white/10 ring-1 ring-white/15" />
            <div className="h-2.5 rounded-md bg-white/15" />
            <div className="h-2.5 rounded-md bg-white/10 w-3/4" />
            <div className="h-6 rounded-md bg-gradient-to-r from-rose-500 to-rose-600 ring-1 ring-white/15" />
            <div className="h-6 rounded-md bg-gradient-to-r from-emerald-400 to-emerald-600 ring-1 ring-white/15" />
          </div>
        </div>
      </div>
      {/* Floating notification card */}
      <div className="absolute -top-3 -right-4 w-[100px] rounded-xl bg-gradient-to-b from-slate-700 to-slate-900 p-2 ring-1 ring-white/10
                      shadow-[0_15px_30px_-8px_rgba(0,0,0,0.6)] z-10">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-md bg-gradient-to-br from-amber-400 to-amber-600 grid place-items-center">
            <svg className="w-3 h-3 text-slate-900" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1L4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5l-8-4z" />
            </svg>
          </div>
          <div className="text-[7px] font-semibold text-white/85">XON SAROY</div>
        </div>
        <div className="mt-1 text-[6px] text-white/55 leading-tight">Yangi to'lov</div>
        <div className="mt-0.5 text-[8px] font-bold text-emerald-400 tabular-nums">+1 250 000</div>
      </div>
    </div>
  );
}

/* ─── PhoneRight — app dashboard screen ─── */
function PhoneRight() {
  return (
    <div className="relative w-[130px] h-[240px] rotate-[4deg]">
      <div className="absolute inset-0 rounded-[22px] bg-gradient-to-b from-slate-300 to-slate-500 p-1.5
                      shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.5)]">
        <div className="w-full h-full rounded-[16px] bg-gradient-to-b from-white to-slate-100 overflow-hidden relative">
          {/* Top bar */}
          <div className="px-2 pt-2 flex items-center justify-between">
            <div className="w-3 h-3 rounded-full bg-slate-300" />
            <span className="text-[6px] font-bold text-slate-700">Korxonalar</span>
            <div className="w-3 h-3 rounded-full bg-slate-300" />
          </div>
          {/* List items */}
          <div className="mt-2 px-1.5 space-y-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-1 p-1 rounded bg-slate-50 ring-1 ring-slate-200">
                <div className="w-4 h-4 rounded bg-gradient-to-br from-blue-400 to-blue-600" />
                <div className="flex-1 space-y-0.5">
                  <div className="h-0.5 rounded-full w-3/4 bg-slate-300" />
                  <div className="h-0.5 rounded-full w-1/2 bg-slate-200" />
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
            ))}
          </div>
          {/* Bottom CTA */}
          <div className="absolute bottom-1.5 left-1.5 right-1.5 h-5 rounded-md bg-gradient-to-r from-blue-500 to-indigo-600
                          grid place-items-center text-white text-[6px] font-bold">
            Davom etish
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Laptop ─── */
function LaptopMock({ bal }: { bal: number }) {
  return (
    <div className="relative w-[260px]">
      <div className="relative w-full h-[160px] rounded-t-lg bg-slate-200 p-1
                      shadow-[0_30px_60px_-15px_rgba(0,0,0,0.7)]">
        <div className="w-full h-full rounded-t-md bg-white overflow-hidden p-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-gradient-to-br from-amber-400 to-amber-600" />
              <span className="text-[7px] font-bold text-slate-800">Dashboard</span>
            </div>
            <span className="text-[6px] text-slate-400">●●●</span>
          </div>
          {/* Balance */}
          <div className="mt-1.5 rounded-md bg-slate-900 p-1.5">
            <div className="text-[5px] uppercase tracking-wider text-white/55 font-semibold">Total · UZS</div>
            <div className="text-[10px] font-bold tabular-nums bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text text-transparent">
              {formatBig(bal)}
            </div>
          </div>
          {/* Mini list */}
          <div className="mt-1.5 space-y-0.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-1 p-1 rounded bg-slate-50">
                <div className="w-3 h-3 rounded bg-slate-300" />
                <div className="flex-1 space-y-0.5">
                  <div className="h-0.5 rounded-full w-3/4 bg-slate-400" />
                </div>
                <div className="h-1.5 rounded w-5 bg-emerald-500/40" />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Laptop base */}
      <div className="relative w-[290px] h-2 -ml-[15px] rounded-b-2xl bg-gradient-to-b from-slate-400 to-slate-600
                      shadow-[0_15px_30px_-5px_rgba(0,0,0,0.5)]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 rounded-b bg-slate-700" />
      </div>
    </div>
  );
}

/* ─── Flow lines (cloudlar → platforma) ─── */
function FlowLines() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 600 600" preserveAspectRatio="none">
      <path d="M 70 70  C 100 200 200 340 280 400" stroke="rgba(251,191,36,0.55)" strokeWidth="1.5"
            strokeDasharray="3 7" fill="none" className="showcase-flow" />
      <path d="M 310 50 C 310 200 310 320 310 400" stroke="rgba(251,191,36,0.55)" strokeWidth="1.5"
            strokeDasharray="3 7" fill="none" className="showcase-flow" style={{ animationDelay: '0.3s' }} />
      <path d="M 540 90 C 480 200 380 320 330 400" stroke="rgba(251,191,36,0.55)" strokeWidth="1.5"
            strokeDasharray="3 7" fill="none" className="showcase-flow" style={{ animationDelay: '0.6s' }} />
      {[[70,70],[310,50],[540,90]].map(([x,y], i) => (
        <circle key={i} cx={x} cy={y} r="3.5" fill="#fbbf24" />
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
    <svg className="w-5 h-5 text-slate-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
      <line x1="19" y1="5" x2="5" y2="19" strokeLinecap="round" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockPenIcon() {
  return (
    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
      <path d="M12 15v3" strokeLinecap="round" />
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
