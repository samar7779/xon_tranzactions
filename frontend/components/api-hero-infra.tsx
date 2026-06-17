'use client';

import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { cn } from '@/lib/utils';

/**
 * Premium hero — Clerk.com uslubidagi infrastructure illustration.
 * Laptop (chap) → Authenticating card (markaz) → Server rack (o'ng)
 * Thin animated lines, monochrome dark theme, subtle glow.
 * SVG-based, lightweight, premium.
 */

export function ApiHeroInfra({ dark = true, className }: { dark?: boolean; className?: string }) {
  const reduced = usePrefersReducedMotion();

  return (
    <div className={cn('relative w-full h-full min-h-[420px] lg:min-h-[600px] overflow-hidden rounded-2xl', className)} aria-hidden="true">
      {/* Background — dark with subtle radial glow */}
      <div
        className="absolute inset-0"
        style={{
          background: dark
            ? 'radial-gradient(circle at center, #0f172a 0%, #020617 70%)'
            : 'radial-gradient(circle at center, #f1f5f9 0%, #e2e8f0 70%)',
        }}
      />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          backgroundImage: dark
            ? 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)'
            : 'linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
      />

      {/* Central radial glow — behind auth card */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-3xl opacity-60"
        style={{
          background: dark
            ? 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 65%)'
            : 'radial-gradient(circle, rgba(165,180,252,0.4) 0%, transparent 65%)',
        }}
      />

      {/* SVG infrastructure illustration */}
      <svg
        viewBox="0 0 800 500"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Gradients */}
          <linearGradient id="laptopBase" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={dark ? '#1e293b' : '#cbd5e1'} />
            <stop offset="1" stopColor={dark ? '#0f172a' : '#94a3b8'} />
          </linearGradient>
          <linearGradient id="laptopScreen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={dark ? '#1e293b' : '#e2e8f0'} />
            <stop offset="1" stopColor={dark ? '#0f172a' : '#cbd5e1'} />
          </linearGradient>
          <linearGradient id="serverGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={dark ? '#1e293b' : '#cbd5e1'} />
            <stop offset="1" stopColor={dark ? '#020617' : '#94a3b8'} />
          </linearGradient>
          {/* Line gradient — fading at edges */}
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={dark ? 'rgba(148,163,184,0)' : 'rgba(100,116,139,0)'} />
            <stop offset="0.15" stopColor={dark ? 'rgba(148,163,184,0.5)' : 'rgba(100,116,139,0.6)'} />
            <stop offset="0.85" stopColor={dark ? 'rgba(148,163,184,0.5)' : 'rgba(100,116,139,0.6)'} />
            <stop offset="1" stopColor={dark ? 'rgba(148,163,184,0)' : 'rgba(100,116,139,0)'} />
          </linearGradient>
          {/* Flowing packet gradient */}
          <radialGradient id="packetGlow">
            <stop offset="0" stopColor="#a5b4fc" stopOpacity="1" />
            <stop offset="1" stopColor="#a5b4fc" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ─── LEFT — Laptop (isometric) ─── */}
        <g transform="translate(120, 280)">
          {/* Laptop base */}
          <path
            d="M 0,0 L 160,0 L 180,18 L -20,18 Z"
            fill="url(#laptopBase)"
            stroke={dark ? '#334155' : '#64748b'}
            strokeWidth="0.5"
          />
          {/* Laptop base front edge */}
          <line x1="-20" y1="18" x2="180" y2="18" stroke={dark ? '#475569' : '#64748b'} strokeWidth="1" />
          {/* Laptop screen */}
          <path
            d="M 5,0 L 155,0 L 165,-95 L -5,-95 Z"
            fill="url(#laptopScreen)"
            stroke={dark ? '#334155' : '#64748b'}
            strokeWidth="0.5"
          />
          {/* Screen inner */}
          <rect x="0" y="-90" width="160" height="85" fill={dark ? '#020617' : '#1e293b'} opacity="0.7" />
          {/* Subtle screen content lines */}
          <line x1="15" y1="-75" x2="65" y2="-75" stroke={dark ? '#475569' : '#94a3b8'} strokeWidth="1" opacity="0.6" />
          <line x1="15" y1="-65" x2="85" y2="-65" stroke={dark ? '#475569' : '#94a3b8'} strokeWidth="1" opacity="0.4" />
          <line x1="15" y1="-55" x2="55" y2="-55" stroke={dark ? '#475569' : '#94a3b8'} strokeWidth="1" opacity="0.4" />
          <line x1="15" y1="-45" x2="75" y2="-45" stroke={dark ? '#475569' : '#94a3b8'} strokeWidth="1" opacity="0.3" />
          {/* Trackpad */}
          <rect x="65" y="3" width="30" height="10" rx="2" fill={dark ? '#0f172a' : '#94a3b8'} stroke={dark ? '#334155' : '#64748b'} strokeWidth="0.5" />
        </g>

        {/* ─── CONNECTING LINE — left to center ─── */}
        <g>
          <line
            x1="280" y1="290" x2="370" y2="250"
            stroke="url(#lineGrad)"
            strokeWidth="1"
            strokeDasharray="3,3"
          />
          {/* Animated packet */}
          {!reduced && (
            <motion.circle
              r="4"
              fill="url(#packetGlow)"
              initial={{ cx: 280, cy: 290 }}
              animate={{ cx: [280, 370], cy: [290, 250] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.8 }}
            />
          )}
        </g>

        {/* ─── RIGHT — Server rack (isometric, multiple units) ─── */}
        <g transform="translate(560, 180)">
          {/* Server unit 1 */}
          <ServerUnit y={0} dark={dark} />
          {/* Server unit 2 */}
          <ServerUnit y={50} dark={dark} />
          {/* Server unit 3 */}
          <ServerUnit y={100} dark={dark} />
          {/* Server unit 4 */}
          <ServerUnit y={150} dark={dark} />
        </g>

        {/* ─── CONNECTING LINE — center to right ─── */}
        <g>
          <line
            x1="430" y1="250" x2="560" y2="220"
            stroke="url(#lineGrad)"
            strokeWidth="1"
            strokeDasharray="3,3"
          />
          {!reduced && (
            <motion.circle
              r="4"
              fill="url(#packetGlow)"
              initial={{ cx: 430, cy: 250 }}
              animate={{ cx: [430, 560], cy: [250, 220] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.4, repeatDelay: 0.8 }}
            />
          )}
        </g>

        {/* Branch line — to other servers */}
        <g>
          <line
            x1="430" y1="250" x2="560" y2="290"
            stroke="url(#lineGrad)"
            strokeWidth="1"
            strokeDasharray="3,3"
          />
          {!reduced && (
            <motion.circle
              r="4"
              fill="url(#packetGlow)"
              initial={{ cx: 430, cy: 250 }}
              animate={{ cx: [430, 560], cy: [250, 290] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.8, repeatDelay: 0.8 }}
            />
          )}
        </g>
        <g>
          <line
            x1="430" y1="250" x2="560" y2="340"
            stroke="url(#lineGrad)"
            strokeWidth="1"
            strokeDasharray="3,3"
          />
          {!reduced && (
            <motion.circle
              r="4"
              fill="url(#packetGlow)"
              initial={{ cx: 430, cy: 250 }}
              animate={{ cx: [430, 560], cy: [250, 340] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 1.2, repeatDelay: 0.8 }}
            />
          )}
        </g>
      </svg>

      {/* ─── CENTER — Authenticating card (HTML) ─── */}
      <motion.div
        initial={{ opacity: 0, scale: reduced ? 1 : 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : 0.2 }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
      >
        {/* Subtle glow ring */}
        <div className="absolute -inset-3 rounded-2xl bg-indigo-500/20 blur-2xl" aria-hidden="true" />

        <div
          className={cn(
            'relative rounded-xl px-4 py-3 flex items-center gap-3 shadow-2xl',
            dark
              ? 'bg-slate-800/95 ring-1 ring-slate-700/80 text-slate-100'
              : 'bg-white ring-1 ring-slate-200 text-slate-800',
          )}
          style={{
            boxShadow: dark
              ? '0 20px 40px rgba(0,0,0,0.5), 0 0 30px rgba(99,102,241,0.15)'
              : '0 20px 40px rgba(0,0,0,0.1), 0 0 30px rgba(99,102,241,0.1)',
          }}
        >
          <Loader2 className={cn('h-3.5 w-3.5 animate-spin', dark ? 'text-slate-400' : 'text-slate-500')} />
          <span className="text-[12px] font-semibold tracking-tight">Authenticating...</span>
        </div>
      </motion.div>

      {/* Floating labels */}
      <motion.div
        initial={{ opacity: 0, x: reduced ? 0 : -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : 0.4 }}
        className="absolute bottom-[28%] left-[10%] text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-500"
      >
        Client
      </motion.div>
      <motion.div
        initial={{ opacity: 0, x: reduced ? 0 : 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : 0.4 }}
        className="absolute top-[20%] right-[12%] text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-500"
      >
        API Gateway
      </motion.div>

      {/* Floating tiny dots — atmospheric */}
      {!reduced && (
        <>
          {[
            { x: '15%', y: '20%', delay: 0 },
            { x: '85%', y: '70%', delay: 0.5 },
            { x: '25%', y: '85%', delay: 1 },
            { x: '75%', y: '15%', delay: 1.5 },
          ].map((d, i) => (
            <motion.div
              key={i}
              className="absolute w-1 h-1 rounded-full bg-indigo-400/60"
              style={{ left: d.x, top: d.y }}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 3, repeat: Infinity, delay: d.delay }}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ─── Server unit (isometric) ─────────────────────────────
function ServerUnit({ y, dark }: { y: number; dark: boolean }) {
  return (
    <g transform={`translate(0, ${y})`}>
      {/* Top face */}
      <path
        d="M 0,0 L 100,0 L 115,-10 L 15,-10 Z"
        fill={dark ? '#1e293b' : '#cbd5e1'}
        stroke={dark ? '#334155' : '#64748b'}
        strokeWidth="0.5"
      />
      {/* Front face */}
      <rect
        x="0" y="0" width="100" height="35"
        fill="url(#serverGrad)"
        stroke={dark ? '#334155' : '#64748b'}
        strokeWidth="0.5"
      />
      {/* Right (side) face */}
      <path
        d="M 100,0 L 115,-10 L 115,25 L 100,35 Z"
        fill={dark ? '#0f172a' : '#94a3b8'}
        stroke={dark ? '#334155' : '#64748b'}
        strokeWidth="0.5"
      />
      {/* Server LED light */}
      <circle cx="10" cy="8" r="1.5" fill="#10b981" opacity="0.9">
        <animate attributeName="opacity" values="0.9;0.3;0.9" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="10" cy="14" r="1.5" fill="#475569" opacity="0.6" />
      <circle cx="10" cy="20" r="1.5" fill="#475569" opacity="0.4" />
      {/* Server rack details (thin lines representing U-units) */}
      {[6, 12, 18, 24, 30].map((py, i) => (
        <line
          key={i}
          x1="25" y1={py} x2="90" y2={py}
          stroke={dark ? '#475569' : '#94a3b8'}
          strokeWidth="0.5"
          opacity={0.5}
        />
      ))}
      {/* Vent details */}
      <rect x="65" y="7" width="20" height="3" fill={dark ? '#0f172a' : '#94a3b8'} opacity="0.6" />
      <rect x="65" y="13" width="20" height="3" fill={dark ? '#0f172a' : '#94a3b8'} opacity="0.6" />
      <rect x="65" y="19" width="20" height="3" fill={dark ? '#0f172a' : '#94a3b8'} opacity="0.6" />
      <rect x="65" y="25" width="20" height="3" fill={dark ? '#0f172a' : '#94a3b8'} opacity="0.6" />
    </g>
  );
}
