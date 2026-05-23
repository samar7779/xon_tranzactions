'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * ShowcaseStage — qayta ishlatiluvchi hero composition.
 * Showcase sahifasida, login sahifa fonida va SplashLoader'da ishlatiladi.
 */
export function ShowcaseStage({ variant = 'full' }: { variant?: 'full' | 'minimal' } = {}) {
  const isMinimal = variant === 'minimal';
  const [bal, setBal] = useState(0);
  const [tilt, setTilt] = useState({ rx: 8, ry: -10 });

  // Balance counter — initial 0→target, keyin har 2s da yangi tranzaksiya kelgandek katta o'zgarish
  useEffect(() => {
    const baseTarget = 12_504_500;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let current = baseTarget;
    setBal(baseTarget);

    // Har 2 soniyada yangi target — ±1.5M oraliqda (KATTA ko'rinarli o'zgarish)
    intervalId = setInterval(() => {
      const delta = Math.floor((Math.random() - 0.45) * 3_000_000);
      current = Math.max(10_500_000, Math.min(14_500_000, current + delta));
      setBal(current);
    }, 2000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
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
                 bg-[radial-gradient(ellipse_at_center,#2d4a8a_0%,#162a55_45%,#0a162e_100%)]"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <BackgroundNetwork />
      {!isMinimal && <ConstellationBottom />}

      {/* MINIMAL VARIANT: subtle hero efektlar */}
      {isMinimal && (
        <>
          {/* Spotlight — markazda dashboard'ga e'tiborni jamlash */}
          <div className="absolute inset-0 pointer-events-none z-0"
               style={{
                 background: 'radial-gradient(ellipse 60% 55% at 50% 50%, rgba(96,165,250,0.18) 0%, rgba(245,158,11,0.06) 40%, transparent 75%)',
               }} />

          {/* Floating particle'lar — fonda asta-sekin uchadi (kichik va kam) */}
          <FloatingParticles />
        </>
      )}

      <div className="relative z-10 h-full flex flex-col items-center px-4 pt-2 pb-2">

        {/* 3D dashboard + atrofdagi elementlar */}
        <div className="relative flex-1 w-full max-w-[1200px] mx-auto"
             style={{ perspective: '1900px' }}>

          {!isMinimal && (
            <>
              {/* Storyset SVG scenes — dashboard yonida kichik dekoratsiya */}
              <SvgScene src="/showcase-tx.svg"        pos="top-[2%]    left-[22%]"  size={100} glow="cyan"  delay="0.8s" />
              <SvgScene src="/showcase-analytics.svg" pos="bottom-[2%] right-[22%]" size={100} glow="amber" delay="1.4s" />

              {/* Floating coins — qarish $ € */}
              <Coin sym="$" pos="top-[12%]  right-[42%]"  size="md" bg="from-slate-100 to-slate-300" delay="0.6s" gold />
              <Coin sym="€" pos="bottom-[12%] left-[42%]" size="sm" bg="from-blue-500 to-blue-800"   delay="3.0s" />

              {/* Logoli tokenlar — sichqonchadan qochadi */}
              <LogoCoin pos="top-[4%]    left-[42%]"   size="sm" delay="2.4s" />
              <LogoCoin pos="bottom-[14%] right-[40%]" size="md" delay="1.8s" />
              <LogoCoin pos="bottom-[2%]  left-[28%]"  size="sm" delay="0.7s" />

              {/* Bank live cards — CHAP TOMON (real-time transaction stream) */}
              <BankLiveCard
                pos="top-[6%] left-[1%]"  bank="kapital" name="Kapitalbank"
                who="ABU SAHIY MCHJ" amount="+18.5M" dir="in"  delay="0.5s"
              />
              <BankLiveCard
                pos="top-[28%] left-[1%]" bank="ipak"    name="Ipak Yo'li"
                who="LEVEL UP-STROY"    amount="+5.5M"  dir="in"  delay="1.0s"
              />
              <BankLiveCard
                pos="bottom-[22%] left-[2%]" bank="kapital" name="Kapitalbank"
                who="Soliq to'lovi"      amount="−4.8M" dir="out" delay="1.5s"
              />

              {/* Bank status cards — O'NG TOMON (bank ulanish holati) */}
              <BankStatusCard
                pos="top-[4%] right-[1%]"  bank="kapital" name="Kapitalbank"
                count="134 hsb"  active delay="0.7s"
              />
              <BankStatusCard
                pos="top-[42%] right-[1%]" bank="ipak"    name="Ipak Yo'li"
                count="5 hsb"    active delay="1.2s"
              />

              {/* Floating stat chips */}
              <StatChip label="Data" value="−13.8%"  dir="up"   pos="bottom-[36%] right-[3%]" delay="1.0s" />
              <StatChip label="Inol" value="3.58%"   dir="up"   pos="bottom-[30%] right-[1%]" delay="1.3s" />
              <StatChip label="Data" value="−12.89%" dir="down" pos="bottom-[28%] left-[1%]"  delay="1.3s" />
              <StatChip label="USD"  value="−4.7%"   dir="down" pos="bottom-[22%] left-[3%]"  delay="1.6s" />
            </>
          )}

          {/* 3D dashboard — minimal'da kattaroq + ko'proq efekt */}
          <div className="absolute inset-0 grid place-items-center showcase-card-in">
            <div
              className={isMinimal ? "relative w-full max-w-[1180px]" : "relative w-full max-w-[820px]"}
              style={{
                transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
                transformStyle: 'preserve-3d',
                transition: 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {/* Asosiy glow halo — minimal'da kattaroq va kuchliroq */}
              <div className={cn(
                "absolute rounded-[40px] blur-3xl -z-10",
                isMinimal
                  ? "-inset-12 bg-gradient-to-br from-cyan-400/40 via-blue-500/25 to-amber-400/35"
                  : "-inset-3 bg-gradient-to-br from-cyan-400/25 via-blue-500/15 to-amber-400/20",
              )} />

              {/* Minimal'da qo'shimcha — faqat burchak yorug'liklari (rings'siz, toza ko'rinish) */}
              {isMinimal && (
                <>
                  <div className="absolute -top-32 -left-32 w-96 h-96 bg-cyan-400/12 rounded-full blur-3xl pointer-events-none animate-pulse" style={{ animationDuration: '5s' }} />
                  <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-amber-400/12 rounded-full blur-3xl pointer-events-none animate-pulse" style={{ animationDuration: '5s', animationDelay: '2.5s' }} />
                </>
              )}

              {/* Title — dashboard yuqorisida, panel bilan birga 3D'da egiladi */}
              <div className="relative text-center mb-2 showcase-fade-up pointer-events-none"
                   style={{ animationDelay: '0.1s' }}>
                <h1 className={cn(
                  "font-bold tracking-[0.05em] leading-[0.95]",
                  "bg-gradient-to-r from-amber-200 via-amber-100 to-amber-200 bg-clip-text text-transparent",
                  "drop-shadow-[0_2px_14px_rgba(245,158,11,0.45)]",
                  "showcase-text-shimmer",
                  isMinimal
                    ? "text-[28px] sm:text-[36px] lg:text-[44px]"
                    : "text-[22px] sm:text-[28px] lg:text-[32px]",
                )}
                    style={{ backgroundSize: '200% 100%' }}>
                  XON SAROY TRANSACTIONS
                </h1>
                <div className="mx-auto mt-1 h-px w-[38%] bg-gradient-to-r from-transparent via-amber-300/70 to-transparent" />
                <div className={cn(
                  "uppercase tracking-[0.4em] text-amber-200/55 font-semibold mt-0.5",
                  isMinimal ? "text-[10px] sm:text-[11px]" : "text-[8px]",
                )}>
                  real-time banking platform
                </div>
              </div>

              <div className="relative rounded-[24px] border border-white/10
                              bg-[rgba(18,28,52,0.6)] backdrop-blur-xl
                              shadow-[0_50px_120px_-20px_rgba(0,0,0,0.85)]"
                   style={{ transformStyle: 'preserve-3d' }}>
                {/* Top + bottom accent lines */}
                <div className="absolute inset-x-20 -top-px h-px bg-gradient-to-r from-transparent via-amber-300/80 to-transparent" />
                <div className="absolute inset-x-20 -bottom-px h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />

                {/* Topbar */}
                <div className="flex items-center gap-2 px-5 pt-3.5 pb-3 border-b border-white/5">
                  <LogoDisc size={32} rounded="rounded-xl" />
                  <span className="text-[12px] font-semibold">Dashboard</span>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1.5 h-7 px-3 rounded-full bg-white/[0.04] ring-1 ring-white/8
                                  text-[11px] text-white/40 min-w-[220px]">
                    <SearchIcon /> <TypingSearch />
                  </div>
                  <NotifPill count={3} color="amber" pulse />
                  <NotifPill count={2} color="cyan" pulse />
                  <LogoDisc size={32} rounded="rounded-full" />
                </div>

                <div className={cn(
                  "grid grid-cols-12 gap-4",
                  isMinimal ? "p-6" : "p-4",
                )} style={{ transformStyle: 'preserve-3d' }}>
                  {/* Chap: balance + 2 chart */}
                  <div className="col-span-7 space-y-3" style={{ transformStyle: 'preserve-3d' }}>
                    {/* TOTAL BALANCE — hero element */}
                    <div className={cn(
                      "rounded-2xl bg-gradient-to-br from-slate-900/85 to-slate-800/55 ring-1 ring-white/10 relative overflow-hidden",
                      "transition-all duration-300 ease-out cursor-pointer",
                      "hover:ring-amber-400/80 hover:shadow-[0_40px_80px_-10px_rgba(245,158,11,0.55)]",
                      "hover:[transform:translateZ(80px)_scale(1.06)]",
                      "active:[transform:translateZ(50px)_scale(1.03)] active:duration-100",
                      isMinimal ? "p-5" : "p-4",
                    )}>
                      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-amber-400/15 blur-3xl" />
                      <div className="absolute -left-10 -bottom-10 w-32 h-32 rounded-full bg-cyan-400/12 blur-3xl" />
                      <div className="relative flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[9px] uppercase tracking-[0.22em] text-white/45 font-semibold">Total Balance · UZS</div>
                          <AnimatedBalanceDisplay value={bal} size={isMinimal ? 'lg' : 'md'} />

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

                    {/* Payment analytics — kattaroq, jonli effekt */}
                    <div className={cn(
                      "rounded-2xl bg-white/[0.025] ring-1 ring-white/8 relative overflow-hidden",
                      "transition-all duration-300 ease-out cursor-pointer",
                      "hover:ring-cyan-400/80 hover:shadow-[0_40px_80px_-10px_rgba(34,211,238,0.55)]",
                      "hover:bg-white/[0.06]",
                      "hover:[transform:translateZ(80px)_scale(1.06)]",
                      "active:[transform:translateZ(50px)_scale(1.03)] active:duration-100",
                      isMinimal ? "p-5" : "p-3.5",
                    )}>
                      {/* Yengil glow accent — top-left va bottom-right */}
                      <div className="absolute -top-12 -left-12 w-32 h-32 rounded-full bg-amber-400/8 blur-3xl pointer-events-none" />
                      <div className="absolute -bottom-12 -right-12 w-32 h-32 rounded-full bg-cyan-400/8 blur-3xl pointer-events-none" />

                      <div className="relative flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={cn("font-semibold", isMinimal ? "text-[13px]" : "text-[11px]")}>Payment analytics</span>
                          {/* LIVE indikator */}
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-400/15 ring-1 ring-emerald-400/30">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                            </span>
                            <span className="text-[8px] uppercase tracking-[0.18em] font-bold text-emerald-300">Live</span>
                          </span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/20 font-medium">Auraeoce ▾</span>
                      </div>
                      <PaymentLineChart tall={isMinimal} />
                      <div className="relative flex justify-between mt-2 text-[9px] text-white/40 px-1">
                        {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m) => <span key={m}>{m}</span>)}
                      </div>
                    </div>
                  </div>

                  {/* O'ng: bars + secure + card */}
                  <div className="col-span-5 space-y-3 relative" style={{ transformStyle: 'preserve-3d' }}>
                    {/* ConnectionLines (kok dashes) — faqat full variant'da */}
                    {!isMinimal && <ConnectionLines />}

                    {/* "▲ $50.00" badge — faqat full variant */}
                    {!isMinimal && (
                      <>
                        <div className="absolute -left-14 top-7 z-10 text-[10px] text-emerald-300 font-bold flex items-center gap-1 showcase-fade-up"
                             style={{ animationDelay: '1.4s' }}>
                          <span className="text-emerald-400">▲</span> $50.00
                        </div>
                        <div className="absolute -left-14 bottom-20 z-10 text-[10px] text-emerald-300 font-bold flex items-center gap-1 showcase-fade-up"
                             style={{ animationDelay: '1.6s' }}>
                          <span className="text-emerald-400">▲</span> $75.00
                        </div>
                      </>
                    )}

                    {/* Transaction finance bars */}
                    <div className="rounded-2xl bg-white/[0.025] ring-1 ring-white/8 p-3.5
                                    transition-all duration-300 ease-out cursor-pointer
                                    hover:ring-amber-400/80 hover:shadow-[0_40px_80px_-10px_rgba(245,158,11,0.55)]
                                    hover:bg-white/[0.06]
                                    hover:[transform:translateZ(80px)_scale(1.06)]
                                    active:[transform:translateZ(50px)_scale(1.03)] active:duration-100">
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
                    <div className="rounded-2xl bg-white/[0.025] ring-1 ring-white/8 p-3 flex items-center gap-2.5
                                    transition-all duration-300 ease-out cursor-pointer
                                    hover:ring-emerald-400/80 hover:shadow-[0_40px_80px_-10px_rgba(52,211,153,0.55)]
                                    hover:bg-white/[0.06]
                                    hover:[transform:translateZ(80px)_scale(1.06)]
                                    active:[transform:translateZ(50px)_scale(1.03)] active:duration-100">
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
                                    ring-1 ring-white/20 shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6)] overflow-hidden
                                    transition-all duration-300 ease-out cursor-pointer
                                    hover:ring-amber-400 hover:shadow-[0_45px_90px_-10px_rgba(245,158,11,0.7)]
                                    hover:[transform:translateZ(95px)_scale(1.08)_rotateZ(-1.5deg)]
                                    active:[transform:translateZ(60px)_scale(1.04)] active:duration-100">
                      <div className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent showcase-hologram pointer-events-none" />
                      <div className="relative flex items-center justify-between">
                        <LogoDisc size={28} rounded="rounded-full" />
                        <div className="text-[11px] font-semibold text-slate-600">Credit</div>
                      </div>
                      {/* Yashiringan karta raqami — faqat oxirgi 4 ta raqam ko'rinadi */}
                      <div className="relative mt-3 font-mono text-[13px] tracking-wider text-slate-700">
                        <MaskedCardNumber />
                      </div>
                      {/* Animatsiyali balans summasi */}
                      <div className="relative mt-2 flex items-end justify-between">
                        <div>
                          <div className="text-[8px] text-slate-500 uppercase tracking-[0.18em] font-semibold">Available</div>
                          <CardBalance />
                        </div>
                        <div className="flex gap-0.5">
                          <span className="w-5 h-5 rounded-full bg-rose-500/80" />
                          <span className="w-5 h-5 rounded-full bg-amber-400/80 -ml-2" />
                        </div>
                      </div>
                      <div className="relative mt-1.5 text-[8px] text-slate-500 uppercase tracking-[0.18em] font-semibold">XON SAROY</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bank logos — pastda (faqat full variant) */}
              {!isMinimal && (
                <div className="mt-3 flex items-center justify-center gap-3 showcase-fade-up" style={{ animationDelay: '1.5s' }}>
                  <span className="text-[9px] uppercase tracking-[0.25em] text-white/35 font-semibold">Integrated</span>
                  <BankPill src="/banks/kapital.webp" name="Kapitalbank" />
                  <BankPill src="/banks/ipak.svg" name="Ipak Yo'li" />
                </div>
              )}
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

/* ─── Logo coin (XON SAROY logoli dumaloq token — kursordan qochadi) ─── */
function LogoCoin({ pos, size, delay }: { pos: string; size: 'sm' | 'md'; delay: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [off, setOff] = useState({ x: 0, y: 0, ring: 0 });

  useEffect(() => {
    const FLEE_RADIUS = 110; // px — bu masofada kursor yaqinlashsa qochadi
    function onMove(e: MouseEvent) {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < FLEE_RADIUS) {
        const force = (FLEE_RADIUS - dist) / FLEE_RADIUS;
        const mag = 60; // max qochish masofasi
        setOff({ x: -(dx / (dist || 1)) * mag * force, y: -(dy / (dist || 1)) * mag * force, ring: force });
      } else if (off.x !== 0 || off.y !== 0) {
        setOff({ x: 0, y: 0, ring: 0 });
      }
    }
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = off.ring > 0;

  return (
    <div ref={wrapRef} className={`absolute ${pos} pointer-events-none z-20`}>
      <div style={{
        transform: `translate(${off.x}px, ${off.y}px)`,
        transition: 'transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}>
        <div className="showcase-coin-float" style={{ animationDelay: delay }}>
          <div className={`${size === 'sm' ? 'w-11 h-11 p-2' : 'w-14 h-14 p-2.5'}
                           relative rounded-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900
                           grid place-items-center transition-all duration-300`}
               style={{
                 // Tinch holat: faqat juda zaif neytral ring + soya, sariq yoq
                 boxShadow: active
                   ? `0 12px 28px -4px rgba(245,158,11,${0.5 + off.ring * 0.4}),inset 0 2px 0 rgba(255,255,255,0.15),0 0 ${20 + off.ring * 30}px rgba(245,158,11,${off.ring * 0.6})`
                   : '0 6px 14px -4px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.08)',
                 outline: active
                   ? `2px solid rgba(251,191,36,${0.4 + off.ring * 0.5})`
                   : '1px solid rgba(255,255,255,0.10)',
                 outlineOffset: '-1px',
               }}>
            {/* qochish paytida shock ring */}
            {active && (
              <span className="absolute inset-[-6px] rounded-full ring-2 ring-amber-300/60 animate-ping pointer-events-none" />
            )}
            <Image src="/xon-saroy-logo.png" alt="" width={48} height={48}
                   className={`w-full h-full object-contain transition-all duration-300 ${
                     active ? 'drop-shadow-[0_0_8px_rgba(245,158,11,0.7)] opacity-100' : 'opacity-70'
                   }`} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Storyset SVG scene — kichik dekorativ rasm ─── */
function SvgScene({ src, pos, size, glow, delay }: {
  src: string; pos: string; size: number; glow: 'cyan' | 'amber'; delay: string;
}) {
  const glowBg = glow === 'cyan' ? 'bg-cyan-400/15' : 'bg-amber-400/15';
  const shadow = glow === 'cyan'
    ? 'drop-shadow-[0_6px_18px_rgba(34,211,238,0.3)]'
    : 'drop-shadow-[0_6px_18px_rgba(245,158,11,0.3)]';
  return (
    <div className={`absolute ${pos} pointer-events-none z-[6] showcase-coin-float`}
         style={{ width: size, height: size, animationDelay: delay }}>
      <div className={`absolute inset-2 ${glowBg} blur-2xl rounded-full -z-10`} />
      <Image src={src} alt="" width={size} height={size} className={`w-full h-auto ${shadow}`} />
    </div>
  );
}

/* ─── Logo disc (mini logo for chip/avatar slots) ─── */
function LogoDisc({ size, rounded }: { size: number; rounded: string }) {
  return (
    <div className={`${rounded} grid place-items-center shrink-0
                     bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900
                     ring-1 ring-amber-400/40
                     shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_12px_-2px_rgba(245,158,11,0.45)]`}
         style={{ width: size, height: size, padding: size * 0.18 }}>
      <Image src="/xon-saroy-logo.png" alt="" width={size} height={size}
             className="w-full h-full object-contain drop-shadow-[0_0_4px_rgba(245,158,11,0.6)]" />
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

function BankLiveCard({ pos, bank, name, who, amount, dir, delay }: {
  pos: string; bank: 'kapital' | 'ipak'; name: string; who: string;
  amount: string; dir: 'in' | 'out'; delay: string;
}) {
  const src = bank === 'kapital' ? '/banks/kapital.webp' : '/banks/ipak.svg';
  return (
    <div className={`absolute ${pos} z-30 showcase-tx-in pointer-events-none w-[200px]`}
         style={{ animationDelay: delay }}>
      <div className="px-3 py-2 rounded-2xl bg-[rgba(18,28,52,0.85)] backdrop-blur ring-1 ring-white/10
                      shadow-[0_15px_40px_-10px_rgba(0,0,0,0.6)] showcase-coin-float"
           style={{ animationDelay: delay }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white grid place-items-center shrink-0 overflow-hidden ring-1 ring-white/20">
            <Image src={src} alt={name} width={20} height={20} className="object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold text-white/90 truncate">{name}</div>
            <div className="text-[9px] text-white/45 truncate">{who}</div>
          </div>
          <div className={`text-[11px] font-bold tabular-nums whitespace-nowrap ${dir === 'in' ? 'text-emerald-300' : 'text-rose-300'}`}>
            {amount}
          </div>
        </div>
        {/* Live pulse strip */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
            <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
          <span className="text-[8px] uppercase tracking-wider text-emerald-300/70 font-semibold">Live · just now</span>
        </div>
      </div>
    </div>
  );
}

function BankStatusCard({ pos, bank, name, count, active, delay }: {
  pos: string; bank: 'kapital' | 'ipak'; name: string; count: string; active?: boolean; delay: string;
}) {
  const src = bank === 'kapital' ? '/banks/kapital.webp' : '/banks/ipak.svg';
  return (
    <div className={`absolute ${pos} z-30 showcase-tx-in pointer-events-none w-[170px]`}
         style={{ animationDelay: delay }}>
      <div className="px-3 py-2.5 rounded-2xl bg-[rgba(18,28,52,0.85)] backdrop-blur ring-1 ring-white/10
                      shadow-[0_15px_40px_-10px_rgba(0,0,0,0.6)] showcase-coin-float"
           style={{ animationDelay: delay }}>
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-white grid place-items-center shrink-0 overflow-hidden ring-1 ring-white/20
                          shadow-[0_4px_12px_-2px_rgba(0,0,0,0.4)]">
            <Image src={src} alt={name} width={26} height={26} className="object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold text-white/90 truncate">{name}</div>
            <div className="text-[9px] text-white/50 tabular-nums">{count}</div>
          </div>
          {active && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400 opacity-75" />
              <span className="relative rounded-full h-2 w-2 bg-emerald-400" />
            </span>
          )}
        </div>
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

/** Balance — value o'zgarganda flash + scale efekt, smooth count animatsiya */
function AnimatedBalanceDisplay({ value, size = 'md' }: { value: number; size?: 'md' | 'lg' }) {
  const [display, setDisplay] = useState(value);
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (Math.abs(value - prev.current) < 1) return;
    setFlash(true);
    const from = prev.current;
    const to = value;
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prev.current = to;
      }
    };
    raf = requestAnimationFrame(tick);
    const flashOff = setTimeout(() => setFlash(false), 500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(flashOff);
    };
  }, [value]);

  return (
    <div className={cn(
      "mt-1 font-bold tabular-nums tracking-tight",
      "bg-gradient-to-r from-amber-100 via-amber-300 to-amber-500 bg-clip-text text-transparent",
      "transition-all duration-300 ease-out",
      size === 'lg' ? "text-[36px]" : "text-[28px]",
      flash
        ? "drop-shadow-[0_2px_28px_rgba(245,158,11,1)] scale-[1.06] brightness-125"
        : "drop-shadow-[0_2px_8px_rgba(245,158,11,0.3)] scale-100",
    )}>
      {formatMoney(display)}
    </div>
  );
}

function PaymentLineChart({ tall = false }: { tall?: boolean } = {}) {
  // 12 oy uchun Y qiymatlari — har 2.5s da yangilanadi (real-time chart effekt)
  const [ys, setYs] = useState<number[]>([75, 55, 40, 60, 18, 35, 28, 45, 32, 50, 22, 38]);
  useEffect(() => {
    const interval = setInterval(() => {
      setYs((prev) =>
        prev.map((y) => {
          const delta = (Math.random() - 0.5) * 30;
          return Math.max(12, Math.min(85, y + delta));
        }),
      );
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  // X koordinatalar — 12 nuqta, 380px ichida
  const xs = ys.map((_, i) => (380 / 11) * i);
  // Smooth path — cubic Bezier
  const buildPath = (close: boolean) => {
    let path = `M ${xs[0]} ${ys[0]}`;
    for (let i = 0; i < ys.length - 1; i++) {
      const x1 = xs[i] + (xs[i + 1] - xs[i]) / 2;
      const x2 = xs[i] + (xs[i + 1] - xs[i]) / 2;
      path += ` C ${x1} ${ys[i]}, ${x2} ${ys[i + 1]}, ${xs[i + 1]} ${ys[i + 1]}`;
    }
    if (close) path += ` L ${xs[xs.length - 1]} 100 L 0 100 Z`;
    return path;
  };

  // Eng past nuqta (peak) — tooltip va aylanaga
  let peakIdx = 0;
  for (let i = 1; i < ys.length; i++) if (ys[i] < ys[peakIdx]) peakIdx = i;
  const peakX = xs[peakIdx];
  const peakY = ys[peakIdx];

  return (
    <svg viewBox="0 0 380 100" className={cn("w-full", tall ? "h-[180px]" : "h-[130px]")} preserveAspectRatio="none">
      <defs>
        <linearGradient id="pl-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pl-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        {/* Glow filter — line uchun */}
        <filter id="pl-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <style>{`.pl-path-anim { transition: d 2200ms cubic-bezier(0.4, 0, 0.2, 1); }`}</style>
      </defs>
      {/* Grid lines */}
      {[25, 50, 75].map((y) => <line key={y} x1="0" y1={y} x2="380" y2={y} stroke="#ffffff10" />)}

      {/* Fill area */}
      <path d={buildPath(true)} fill="url(#pl-fill)" className="pl-path-anim" />
      {/* Line stroke + glow */}
      <path d={buildPath(false)}
            fill="none" stroke="url(#pl-stroke)" strokeWidth="3" strokeLinecap="round"
            className="pl-path-anim" filter="url(#pl-glow)" />

      {/* Travelling pulse dot — chap-o'ngga harakatlanadi */}
      <circle r="3.5" fill="#fde68a" filter="url(#pl-glow)">
        <animateMotion dur="4.5s" repeatCount="indefinite" rotate="auto" path={buildPath(false)} />
      </circle>

      {/* Peak dot — eng yuqori qiymat */}
      <circle cx={peakX} cy={peakY} r="5" fill="#fde68a" filter="url(#pl-glow)" style={{ transition: 'cx 2.2s, cy 2.2s' }} />
      <circle cx={peakX} cy={peakY} r="10" fill="#fbbf24" opacity="0.4" style={{ transition: 'cx 2.2s, cy 2.2s' }}>
        <animate attributeName="r" values="6;16;6" dur="2.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function TransactionBars() {
  const BAR_AREA_PX = 120;
  const [values, setValues] = useState<number[]>([55, 75, 90, 60, 85, 65, 80]);
  useEffect(() => {
    const interval = setInterval(() => {
      setValues((prev) =>
        prev.map((v) => {
          const delta = (Math.random() - 0.5) * 35;
          return Math.max(30, Math.min(95, v + delta));
        }),
      );
    }, 1400);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="flex items-end gap-2" style={{ height: BAR_AREA_PX }}>
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex justify-center items-end h-full">
          <div className="w-full max-w-[14px] rounded-t-md bg-gradient-to-t from-amber-700 via-amber-500 to-amber-200
                          shadow-[0_0_12px_rgba(251,191,36,0.55)]
                          transition-all duration-[1200ms] ease-in-out"
               style={{ height: `${(v / 100) * BAR_AREA_PX}px` }} />
        </div>
      ))}
    </div>
  );
}

/** Credit kartasi raqami — yashiringan (•••• •••• •••• 3058), real bank kartalari kabi */
function MaskedCardNumber() {
  // Bullet character animatsiyali — har 2s da subtle pulse
  return (
    <span className="inline-flex items-center gap-3 text-[14px] tracking-wider">
      <span className="text-slate-400 animate-pulse" style={{ animationDuration: '2s' }}>••••</span>
      <span className="text-slate-400 animate-pulse" style={{ animationDuration: '2s', animationDelay: '0.5s' }}>••••</span>
      <span className="text-slate-400 animate-pulse" style={{ animationDuration: '2s', animationDelay: '1s' }}>••••</span>
      <span className="text-slate-800 font-bold">3058</span>
    </span>
  );
}

/** Karta available balansi — yangi tranzaksiyalar kelgandek jonli o'zgaradi */
function CardBalance() {
  const [amt, setAmt] = useState(2_847_500);
  useEffect(() => {
    const interval = setInterval(() => {
      setAmt((prev) => {
        const delta = Math.floor((Math.random() - 0.4) * 250_000);
        return Math.max(1_500_000, Math.min(3_800_000, prev + delta));
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="mt-0.5 font-mono text-[13px] font-bold text-slate-900 tabular-nums">
      {formatMoney(amt).replace(' UZS', '')} <span className="text-[9px] text-slate-500 font-sans">UZS</span>
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

/* ─── Floating particles (minimal hero) — kichik, kam, sekin ─── */
function FloatingParticles() {
  // Faqat 8 ta kichik particle — chetlarda, dashboard'ni xira qilmaslik uchun
  const particles = [
    { x: 6,  y: 28, delay: 0,   dur: 18, col: 'bg-cyan-300/40' },
    { x: 11, y: 75, delay: 4.2, dur: 22, col: 'bg-amber-300/30' },
    { x: 18, y: 45, delay: 8.0, dur: 19, col: 'bg-cyan-200/35' },
    { x: 25, y: 88, delay: 2.5, dur: 24, col: 'bg-amber-300/25' },
    { x: 75, y: 15, delay: 6.1, dur: 20, col: 'bg-cyan-300/35' },
    { x: 82, y: 60, delay: 1.3, dur: 23, col: 'bg-amber-200/30' },
    { x: 89, y: 32, delay: 9.5, dur: 18, col: 'bg-cyan-300/30' },
    { x: 94, y: 78, delay: 3.7, dur: 21, col: 'bg-amber-300/35' },
  ];
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
      {particles.map((p, i) => (
        <span
          key={i}
          className={cn('absolute w-0.5 h-0.5 rounded-full showcase-particle-float', p.col)}
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            boxShadow: '0 0 6px currentColor',
          }}
        />
      ))}
    </div>
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

function NotifPill({ count, color, pulse }: { count: number; color: 'amber' | 'cyan'; pulse?: boolean }) {
  const [ringing, setRinging] = useState(false);

  // Avto-shake — pulse=true bo'lsa har 3-5s da silkinadi
  useEffect(() => {
    if (!pulse) return;
    const trigger = () => {
      setRinging(true);
      setTimeout(() => setRinging(false), 700);
    };
    // Tasodifiy intervallar bilan tabiiy ko'rinish
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = 3000 + Math.random() * 2500;
      timeout = setTimeout(() => {
        trigger();
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, [pulse]);

  const cls = color === 'amber'
    ? 'bg-amber-400/15 text-amber-300 ring-amber-400/25 hover:bg-amber-400/30 hover:ring-amber-400/60 hover:shadow-[0_0_20px_rgba(245,158,11,0.6)]'
    : 'bg-cyan-400/15 text-cyan-300 ring-cyan-400/25 hover:bg-cyan-400/30 hover:ring-cyan-400/60 hover:shadow-[0_0_20px_rgba(34,211,238,0.6)]';
  return (
    <button
      type="button"
      onClick={() => { setRinging(true); setTimeout(() => setRinging(false), 700); }}
      className={`relative w-8 h-8 rounded-full grid place-items-center ring-1 transition-all duration-200
                  hover:scale-110 active:scale-90 ${cls}`}>
      <span className="absolute -top-1 -right-1 min-w-[13px] h-[13px] rounded-full bg-rose-500 text-white text-[8px] font-bold grid place-items-center px-1
                       shadow-[0_0_8px_rgba(244,63,94,0.7)]">
        {count}
      </span>
      {ringing && (
        <span className="absolute inset-[-6px] rounded-full ring-2 ring-current animate-ping pointer-events-none" />
      )}
      <svg className={`w-3.5 h-3.5 ${ringing ? 'showcase-bell-shake' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** Search input typing efekt — yozadi, kutadi, o'chiradi, qaytadan */
function TypingSearch() {
  const QUERIES = [
    'Kapitalbank tranzaksiyalari',
    'oxirgi to\'lovlar',
    'sverka 2026-05',
    'kirim oboroti',
    'CRM mijozlar',
  ];
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'typing' | 'pause' | 'deleting'>('typing');
  const [qIdx, setQIdx] = useState(0);

  useEffect(() => {
    const current = QUERIES[qIdx];
    let timeout: ReturnType<typeof setTimeout>;
    if (phase === 'typing') {
      if (text.length < current.length) {
        timeout = setTimeout(() => setText(current.slice(0, text.length + 1)), 65);
      } else {
        timeout = setTimeout(() => setPhase('pause'), 1400);
      }
    } else if (phase === 'pause') {
      timeout = setTimeout(() => setPhase('deleting'), 300);
    } else {
      if (text.length > 0) {
        timeout = setTimeout(() => setText(text.slice(0, -1)), 35);
      } else {
        setQIdx((idx) => (idx + 1) % QUERIES.length);
        setPhase('typing');
      }
    }
    return () => clearTimeout(timeout);
  }, [text, phase, qIdx]);

  return (
    <span className="flex-1 truncate">
      {text || <span className="text-white/30">Search transactions...</span>}
      <span className="inline-block w-[1.5px] h-[10px] bg-white/60 ml-[1px] animate-pulse align-middle" />
    </span>
  );
}
