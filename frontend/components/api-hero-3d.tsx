'use client';

import { useRef, useState, useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { Copy, Check, ChevronDown, Activity, Zap, Database, Shield, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Premium 3D hero — CSS perspective + mouse parallax + glass morphism.
 * Layered "product mockup" cards floating in 3D space with aurora background.
 * Linear/Vercel/Resend uslubi.
 */

export function ApiHero3d({ dark = false }: { dark?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);

  // Mouse position (normalized -1..1 from center)
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 80, damping: 18 });
  const sy = useSpring(my, { stiffness: 80, damping: 18 });

  // Transform values
  const rotateY = useTransform(sx, [-1, 1], [-14, 14]);
  const rotateX = useTransform(sy, [-1, 1], [10, -10]);

  // Floating chips offsets
  const chip1X = useTransform(sx, [-1, 1], [-30, 30]);
  const chip1Y = useTransform(sy, [-1, 1], [-20, 20]);
  const chip2X = useTransform(sx, [-1, 1], [40, -40]);
  const chip2Y = useTransform(sy, [-1, 1], [25, -25]);
  const chip3X = useTransform(sx, [-1, 1], [-50, 50]);
  const chip3Y = useTransform(sy, [-1, 1], [35, -35]);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduced) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    const cy = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
    mx.set(Math.max(-1, Math.min(1, cx)));
    my.set(Math.max(-1, Math.min(1, cy)));
  };

  const onLeave = () => {
    mx.set(0);
    my.set(0);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="relative w-full h-full min-h-[420px] lg:min-h-[620px] flex items-center justify-center"
      style={{ perspective: '1500px' }}
      aria-hidden="true"
    >
      {/* ─── AURORA BACKGROUND ─── */}
      <Aurora dark={dark} animate={!reduced} />

      {/* ─── 3D STAGE ─── */}
      <div className="relative w-full max-w-[540px]" style={{ transformStyle: 'preserve-3d' }}>
        {/* Floating chip — top-left (behind, smaller) */}
        <motion.div
          style={{
            x: chip1X,
            y: chip1Y,
            rotateY: useTransform(rotateY, (v) => v * 0.5),
            rotateX: useTransform(rotateX, (v) => v * 0.5),
            transformStyle: 'preserve-3d',
            transform: 'translateZ(-80px)',
          }}
          className="absolute -top-8 -left-8 z-0"
        >
          <Chip method="GET" label="/api/v1/_meta/banks" depth={-80} />
        </motion.div>

        {/* Floating chip — top-right */}
        <motion.div
          style={{
            x: chip2X,
            y: chip2Y,
            rotateY: useTransform(rotateY, (v) => v * 0.4),
            rotateX: useTransform(rotateX, (v) => v * 0.4),
            transformStyle: 'preserve-3d',
            transform: 'translateZ(-40px)',
          }}
          className="absolute -top-12 -right-4 z-0 hidden sm:block"
        >
          <Chip method="GET" label="/transactions" depth={-40} small />
        </motion.div>

        {/* MAIN PRODUCT CARD — endpoint detail mock */}
        <motion.div
          style={{
            rotateY,
            rotateX,
            transformStyle: 'preserve-3d',
          }}
          className="relative z-10"
        >
          <ProductCard />
        </motion.div>

        {/* Floating chip — bottom-right (front, bigger shadow) */}
        <motion.div
          style={{
            x: chip3X,
            y: chip3Y,
            rotateY: useTransform(rotateY, (v) => v * 0.6),
            rotateX: useTransform(rotateX, (v) => v * 0.6),
            transformStyle: 'preserve-3d',
            transform: 'translateZ(40px)',
          }}
          className="absolute -bottom-10 -right-8 z-20"
        >
          <ResponseChip />
        </motion.div>

        {/* Floating stat chip — bottom-left */}
        <motion.div
          style={{
            x: useTransform(sx, [-1, 1], [-25, 25]),
            y: useTransform(sy, [-1, 1], [-15, 15]),
            transformStyle: 'preserve-3d',
            transform: 'translateZ(20px)',
          }}
          className="absolute -bottom-12 -left-12 z-20 hidden sm:block"
        >
          <StatChip />
        </motion.div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// AURORA BACKGROUND — animated radial gradients
// ════════════════════════════════════════════════════════
function Aurora({ dark, animate }: { dark: boolean; animate: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-50 dark:opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
      />

      {/* Animated aurora blobs */}
      <motion.div
        animate={animate ? { x: [0, 60, -40, 0], y: [0, -50, 30, 0] } : {}}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-[10%] left-[15%] w-[420px] h-[420px] rounded-full blur-3xl"
        style={{
          background: dark
            ? 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(165,180,252,0.55) 0%, transparent 70%)',
        }}
      />
      <motion.div
        animate={animate ? { x: [0, -80, 50, 0], y: [0, 60, -40, 0] } : {}}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        className="absolute top-[40%] right-[10%] w-[380px] h-[380px] rounded-full blur-3xl"
        style={{
          background: dark
            ? 'radial-gradient(circle, rgba(168,85,247,0.3) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(216,180,254,0.5) 0%, transparent 70%)',
        }}
      />
      <motion.div
        animate={animate ? { x: [0, 50, -30, 0], y: [0, -40, 50, 0] } : {}}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
        className="absolute bottom-[10%] left-[35%] w-[460px] h-[460px] rounded-full blur-3xl"
        style={{
          background: dark
            ? 'radial-gradient(circle, rgba(34,211,238,0.25) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(165,243,252,0.5) 0%, transparent 70%)',
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════
// MAIN PRODUCT CARD — endpoint detail mock (premium)
// ════════════════════════════════════════════════════════
function ProductCard() {
  return (
    <div className="relative">
      {/* Glow underneath */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/30 via-violet-500/30 to-fuchsia-500/30 blur-3xl scale-95 translate-y-6 -z-10" aria-hidden="true" />

      {/* Card */}
      <div
        className="rounded-2xl bg-white/80 dark:bg-slate-900/85 backdrop-blur-2xl ring-1 ring-slate-200/80 dark:ring-slate-700/60 overflow-hidden"
        style={{
          boxShadow:
            '0 30px 80px -20px rgba(99,102,241,0.25), 0 16px 40px -12px rgba(168,85,247,0.18), 0 2px 6px rgba(0,0,0,0.04)',
        }}
      >
        {/* Window chrome — minimal */}
        <div className="px-4 py-3 border-b border-slate-200/70 dark:border-slate-800 flex items-center justify-between bg-gradient-to-b from-slate-50/80 to-transparent dark:from-slate-800/40">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">GET</span>
            <code className="text-[12px] font-mono font-bold text-slate-800 dark:text-slate-200">/api/v1/transactions</code>
          </div>
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">v1</span>
        </div>

        {/* Body — code + response side */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr]">
          {/* Code panel */}
          <div className="bg-slate-950 p-3.5 sm:border-r border-slate-200/70 dark:border-slate-800">
            <div className="flex items-center gap-1.5 mb-2.5">
              <span className="text-[9px] uppercase tracking-widest font-bold text-slate-500">REQUEST</span>
              <div className="flex gap-1 ml-auto">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500/70" />
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500/70" />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
              </div>
            </div>
            <pre className="text-[10.5px] font-mono leading-[1.7] text-slate-300">
              <div><span className="text-violet-300">curl</span> <span className="text-cyan-300">https://...</span> <span className="text-slate-500">\</span></div>
              <div className="text-slate-500">{'  -H '}<span className="text-emerald-300">{'"X-API-Key"'}</span></div>
              <div className="text-slate-500">{'  -H '}<span className="text-emerald-300">{'"X-API-Secret"'}</span></div>
            </pre>
          </div>

          {/* Response panel */}
          <div className="p-3.5 bg-white/60 dark:bg-slate-900/60">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded font-mono text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">200</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">42ms</span>
              </div>
              <span className="text-[9px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">JSON</span>
            </div>
            <pre className="text-[10.5px] font-mono leading-[1.7] text-slate-800 dark:text-slate-200">
              <div>{'{'}</div>
              <div className="pl-2"><span className="text-rose-500 dark:text-rose-300">"ok"</span>: <span className="text-emerald-600 dark:text-emerald-300">true</span>,</div>
              <div className="pl-2"><span className="text-rose-500 dark:text-rose-300">"total"</span>: <span className="text-violet-600 dark:text-violet-300">12450</span>,</div>
              <div className="pl-2"><span className="text-rose-500 dark:text-rose-300">"items"</span>: [...]</div>
              <div>{'}'}</div>
            </pre>
          </div>
        </div>

        {/* Footer with live indicator */}
        <div className="px-4 py-2 border-t border-slate-200/70 dark:border-slate-800 flex items-center justify-between bg-slate-50/60 dark:bg-slate-800/30">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 animate-ping opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">Operational</span>
          </div>
          <code className="text-[9px] font-mono text-slate-400 dark:text-slate-500">scope: transactions:read</code>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// FLOATING CHIPS
// ════════════════════════════════════════════════════════
function Chip({ method, label, depth, small }: { method: string; label: string; depth: number; small?: boolean }) {
  return (
    <div
      className={cn(
        'relative rounded-xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl ring-1 ring-slate-200/80 dark:ring-slate-700/60',
        small ? 'px-2.5 py-1.5' : 'px-3 py-2',
      )}
      style={{
        boxShadow: `0 ${Math.abs(depth) / 4}px ${Math.abs(depth)}px -${Math.abs(depth) / 8}px rgba(99,102,241,${0.15 + Math.abs(depth) / 800})`,
      }}
    >
      <div className="flex items-center gap-2">
        <span className={cn(
          'rounded font-mono font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
          small ? 'px-1 py-px text-[8.5px]' : 'px-1.5 py-0.5 text-[9.5px]',
        )}>{method}</span>
        <code className={cn(
          'font-mono text-slate-700 dark:text-slate-300',
          small ? 'text-[10px]' : 'text-[11px]',
        )}>{label}</code>
      </div>
    </div>
  );
}

function ResponseChip() {
  return (
    <div
      className="relative rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl ring-1 ring-emerald-200/80 dark:ring-emerald-800/40 px-3.5 py-2.5"
      style={{
        boxShadow:
          '0 20px 40px -10px rgba(16,185,129,0.25), 0 6px 16px rgba(16,185,129,0.12)',
      }}
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 grid place-items-center">
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-bold text-slate-900 dark:text-slate-100">200</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">42ms</span>
          </div>
          <code className="text-[9.5px] font-mono text-emerald-600 dark:text-emerald-400">12,450 records</code>
        </div>
      </div>
    </div>
  );
}

function StatChip() {
  return (
    <div
      className="relative rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 px-3.5 py-2.5 text-white"
      style={{
        boxShadow:
          '0 20px 40px -10px rgba(99,102,241,0.45), 0 6px 16px rgba(168,85,247,0.25)',
      }}
    >
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 opacity-90" />
        <div>
          <div className="text-[11px] font-black leading-tight">14 endpoints</div>
          <div className="text-[9px] opacity-80 font-medium">REST · v1</div>
        </div>
      </div>
    </div>
  );
}
