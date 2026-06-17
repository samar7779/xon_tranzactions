'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Check, X as XIcon } from 'lucide-react';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { cn } from '@/lib/utils';

/**
 * Premium isometric infrastructure illustration.
 * Laptop (chap) ─── dashed flow lines ─── 4×Server rack (o'ng, 'API GATEWAY')
 * Markazda glassmorphism status pill with dynamic glow.
 *
 *  pulseKey — har o'zgargan vaqtda packet wave ishga tushadi
 *  state    — 'idle'|'processing'|'success'|'error'
 *  statusText — pill ichidagi matn (i18n uchun customizable)
 */

export type InfraState = 'idle' | 'processing' | 'success' | 'error';

export function ApiHeroInfra({
  dark = true,
  className,
  fullBleed = false,
  pulseKey = 0,
  state = 'idle',
  statusText,
}: {
  dark?: boolean;
  className?: string;
  fullBleed?: boolean;
  pulseKey?: number;
  state?: InfraState;
  statusText?: string;
}) {
  const reduced = usePrefersReducedMotion();

  // State-based colors
  const accent = state === 'success' ? '#10b981'
              : state === 'error' ? '#f43f5e'
              : '#818cf8'; // indigo default
  const accentGlow = state === 'success' ? 'rgba(16,185,129,0.35)'
                  : state === 'error' ? 'rgba(244,63,94,0.35)'
                  : 'rgba(129,140,248,0.32)';

  const defaultStatusText = state === 'success' ? 'Authenticated'
                          : state === 'error' ? 'Authentication failed'
                          : state === 'processing' ? 'Authenticating'
                          : 'Waiting for credentials';
  const shownText = statusText || defaultStatusText;

  return (
    <div className={cn('relative w-full h-full min-h-[420px] lg:min-h-[600px] overflow-hidden', !fullBleed && 'rounded-2xl', className)} aria-hidden="true">
      {/* Background — subtle blue-gray gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: dark
            ? 'radial-gradient(ellipse at center, #0f172a 0%, #020617 75%)'
            : 'radial-gradient(ellipse at center, #f1f5f9 0%, #e2e8f0 75%)',
        }}
      />

      {/* Dot-grid pattern (not lines — DOTS) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: dark
            ? 'radial-gradient(circle, rgba(148,163,184,0.18) 1px, transparent 1px)'
            : 'radial-gradient(circle, rgba(100,116,139,0.25) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 85%)',
        }}
      />

      {/* Central radial glow — behind status pill */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[460px] h-[460px] rounded-full blur-3xl pointer-events-none transition-all duration-700"
        style={{
          background: `radial-gradient(circle, ${accentGlow} 0%, transparent 65%)`,
        }}
      />

      {/* SVG infrastructure illustration */}
      <svg
        viewBox="0 0 900 540"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio={fullBleed ? 'xMidYMid slice' : 'xMidYMid meet'}
      >
        <defs>
          {/* Isometric gradients — laptop */}
          <linearGradient id="lpTop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={dark ? '#334155' : '#cbd5e1'} />
            <stop offset="1" stopColor={dark ? '#1e293b' : '#94a3b8'} />
          </linearGradient>
          <linearGradient id="lpBase" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={dark ? '#475569' : '#e2e8f0'} />
            <stop offset="1" stopColor={dark ? '#1e293b' : '#94a3b8'} />
          </linearGradient>
          <linearGradient id="lpScreenFront" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={dark ? '#1e293b' : '#cbd5e1'} />
            <stop offset="1" stopColor={dark ? '#0f172a' : '#94a3b8'} />
          </linearGradient>
          <linearGradient id="lpScreenInner" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={dark ? '#020617' : '#1e293b'} />
            <stop offset="1" stopColor={dark ? '#0f172a' : '#334155'} />
          </linearGradient>

          {/* Server gradients */}
          <linearGradient id="svTop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={dark ? '#475569' : '#e2e8f0'} />
            <stop offset="1" stopColor={dark ? '#334155' : '#cbd5e1'} />
          </linearGradient>
          <linearGradient id="svFront" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={dark ? '#334155' : '#cbd5e1'} />
            <stop offset="1" stopColor={dark ? '#1e293b' : '#94a3b8'} />
          </linearGradient>
          <linearGradient id="svSide" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={dark ? '#1e293b' : '#94a3b8'} />
            <stop offset="1" stopColor={dark ? '#0f172a' : '#64748b'} />
          </linearGradient>

          {/* Line gradient — fading at edges */}
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="transparent" />
            <stop offset="0.12" stopColor={dark ? 'rgba(148,163,184,0.55)' : 'rgba(100,116,139,0.6)'} />
            <stop offset="0.88" stopColor={dark ? 'rgba(148,163,184,0.55)' : 'rgba(100,116,139,0.6)'} />
            <stop offset="1" stopColor="transparent" />
          </linearGradient>

          {/* Packet glow gradients (state-based) */}
          <radialGradient id="pkIdle">
            <stop offset="0" stopColor="#a5b4fc" stopOpacity="1" />
            <stop offset="0.5" stopColor="#818cf8" stopOpacity="0.7" />
            <stop offset="1" stopColor="#818cf8" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="pkSuccess">
            <stop offset="0" stopColor="#6ee7b7" stopOpacity="1" />
            <stop offset="0.5" stopColor="#10b981" stopOpacity="0.7" />
            <stop offset="1" stopColor="#10b981" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="pkError">
            <stop offset="0" stopColor="#fda4af" stopOpacity="1" />
            <stop offset="0.5" stopColor="#f43f5e" stopOpacity="0.7" />
            <stop offset="1" stopColor="#f43f5e" stopOpacity="0" />
          </radialGradient>

          {/* Soft drop shadow */}
          <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
            <feOffset dx="0" dy="6" />
            <feComponentTransfer><feFuncA type="linear" slope="0.25" /></feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* CSS animation for flowing dashes */}
          <style>{`
            @keyframes flowDash { to { stroke-dashoffset: -16; } }
            .flow-line { animation: ${reduced ? 'none' : 'flowDash 1.2s linear infinite'}; }
          `}</style>
        </defs>

        {/* ─── LEFT — Laptop (isometric, refined) ─── */}
        <g transform="translate(150, 290)" filter="url(#softShadow)">
          {/* Base bottom shadow plane (slight) */}
          <ellipse cx="80" cy="30" rx="100" ry="6" fill={dark ? '#020617' : '#94a3b8'} opacity="0.18" />

          {/* Laptop base — isometric */}
          <path d="M -10,18 L 170,18 L 195,30 L -35,30 Z" fill="url(#lpBase)" />
          <path d="M 0,0 L 160,0 L 170,18 L -10,18 Z" fill="url(#lpTop)" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.4" />

          {/* Trackpad */}
          <rect x="55" y="3" width="50" height="10" rx="2" fill={dark ? '#0f172a' : '#94a3b8'} opacity="0.7" />
          <rect x="55" y="3" width="50" height="10" rx="2" fill="none" stroke={dark ? '#334155' : '#64748b'} strokeWidth="0.3" />

          {/* Hinge highlight */}
          <line x1="5" y1="0" x2="155" y2="0" stroke={dark ? '#64748b' : '#cbd5e1'} strokeWidth="0.4" opacity="0.6" />

          {/* Laptop screen */}
          <path d="M 5,0 L 155,0 L 170,-110 L -10,-110 Z" fill="url(#lpScreenFront)" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.4" />

          {/* Screen inner (dark display) */}
          <rect x="0" y="-105" width="160" height="100" fill="url(#lpScreenInner)" rx="2" />

          {/* Screen content — code-like lines */}
          <g opacity="0.55">
            {/* Window controls (mac-style dots) */}
            <circle cx="10" cy="-97" r="1.2" fill="#fb7185" opacity="0.7" />
            <circle cx="15" cy="-97" r="1.2" fill="#fbbf24" opacity="0.7" />
            <circle cx="20" cy="-97" r="1.2" fill="#34d399" opacity="0.7" />
            {/* Code lines */}
            <line x1="10" y1="-85" x2="60" y2="-85" stroke={accent} strokeWidth="1.2" opacity="0.6" strokeLinecap="round" />
            <line x1="14" y1="-77" x2="90" y2="-77" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="1" opacity="0.5" strokeLinecap="round" />
            <line x1="14" y1="-69" x2="70" y2="-69" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="1" opacity="0.5" strokeLinecap="round" />
            <line x1="20" y1="-61" x2="100" y2="-61" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="1" opacity="0.4" strokeLinecap="round" />
            <line x1="20" y1="-53" x2="75" y2="-53" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="1" opacity="0.4" strokeLinecap="round" />
            <line x1="14" y1="-45" x2="50" y2="-45" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="1" opacity="0.3" strokeLinecap="round" />
            <line x1="14" y1="-37" x2="110" y2="-37" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="1" opacity="0.4" strokeLinecap="round" />
            <line x1="20" y1="-29" x2="85" y2="-29" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="1" opacity="0.3" strokeLinecap="round" />
            <line x1="14" y1="-21" x2="55" y2="-21" stroke={accent} strokeWidth="1.2" opacity="0.55" strokeLinecap="round" />
          </g>

          {/* State icon — fills center of screen when success/error */}
          {state === 'success' && (
            <g transform="translate(80, -55)">
              <circle r="18" fill={accent} opacity="0.25">
                <animate attributeName="r" values="18;26;18" dur="1.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.25;0;0.25" dur="1.4s" repeatCount="indefinite" />
              </circle>
              <circle r="14" fill={accent} />
              <path d="M -6,0 L -2,5 L 7,-5" stroke="white" strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}
          {state === 'error' && (
            <g transform="translate(80, -55)">
              <circle r="14" fill={accent} />
              <line x1="-6" y1="-6" x2="6" y2="6" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
              <line x1="6" y1="-6" x2="-6" y2="6" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
            </g>
          )}
        </g>

        {/* ─── CONNECTION LINES — flowing dash animation ─── */}
        {/* Laptop → Status pill */}
        <line
          x1="335" y1="305" x2="420" y2="280"
          stroke="url(#lineGrad)" strokeWidth="1.5"
          strokeDasharray="6,6" strokeLinecap="round"
          className="flow-line"
        />
        {/* Pill → Server 1 (top) */}
        <line
          x1="490" y1="280" x2="620" y2="220"
          stroke="url(#lineGrad)" strokeWidth="1.5"
          strokeDasharray="6,6" strokeLinecap="round"
          className="flow-line" style={{ animationDelay: '0.15s' }}
        />
        {/* Pill → Server 2 */}
        <line
          x1="490" y1="280" x2="620" y2="275"
          stroke="url(#lineGrad)" strokeWidth="1.5"
          strokeDasharray="6,6" strokeLinecap="round"
          className="flow-line" style={{ animationDelay: '0.3s' }}
        />
        {/* Pill → Server 3 */}
        <line
          x1="490" y1="280" x2="620" y2="330"
          stroke="url(#lineGrad)" strokeWidth="1.5"
          strokeDasharray="6,6" strokeLinecap="round"
          className="flow-line" style={{ animationDelay: '0.45s' }}
        />
        {/* Pill → Server 4 (bottom) */}
        <line
          x1="490" y1="280" x2="620" y2="385"
          stroke="url(#lineGrad)" strokeWidth="1.5"
          strokeDasharray="6,6" strokeLinecap="round"
          className="flow-line" style={{ animationDelay: '0.6s' }}
        />

        {/* ─── PACKET WAVE — one-shot on pulseKey change ─── */}
        <AnimatePresence mode="wait">
          {pulseKey > 0 && !reduced && (
            <PacketWave key={pulseKey} state={state} />
          )}
        </AnimatePresence>

        {/* ─── RIGHT — 4 Server racks (refined isometric) ─── */}
        <g transform="translate(620, 195)" filter="url(#softShadow)">
          <ServerUnit y={0} dark={dark} active={state !== 'idle'} />
          <ServerUnit y={55} dark={dark} active={state !== 'idle'} />
          <ServerUnit y={110} dark={dark} active={state !== 'idle'} />
          <ServerUnit y={165} dark={dark} active={state !== 'idle'} />
        </g>

        {/* Labels — Client + API Gateway (in SVG, properly aligned) */}
        <text x="180" y="475" fontSize="11" fontWeight="700" letterSpacing="2.5" fill={dark ? '#64748b' : '#475569'}>
          CLIENT
        </text>
        <text x="680" y="170" fontSize="11" fontWeight="700" letterSpacing="2.5" fill={dark ? '#64748b' : '#475569'}>
          API GATEWAY
        </text>
      </svg>

      {/* ─── CENTER — Floating status pill (HTML overlay for backdrop blur) ─── */}
      <motion.div
        initial={{ opacity: 0, scale: reduced ? 1 : 0.92, y: reduced ? 0 : 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : 0.15 }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
      >
        {/* Multi-layer glow behind pill */}
        <div
          className="absolute inset-0 -m-6 rounded-full blur-2xl transition-all duration-500"
          style={{ background: accentGlow }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 -m-3 rounded-2xl blur-xl transition-all duration-500"
          style={{ background: accentGlow }}
          aria-hidden="true"
        />

        <div
          className={cn(
            'relative rounded-full px-4 py-2 flex items-center gap-2.5 backdrop-blur-xl transition-colors duration-300 shadow-2xl',
            dark
              ? 'bg-slate-900/85 ring-1 ring-slate-700/60 text-slate-100'
              : 'bg-white/90 ring-1 ring-slate-200 text-slate-800',
          )}
        >
          <AnimatePresence mode="wait">
            {state === 'processing' && (
              <motion.div key="proc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5">
                <Loader2 className={cn('h-3 w-3 animate-spin', dark ? 'text-indigo-300' : 'text-indigo-600')} />
                <span className="text-[11.5px] font-semibold tracking-tight">{shownText}</span>
              </motion.div>
            )}
            {state === 'success' && (
              <motion.div key="ok" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-emerald-500 grid place-items-center">
                  <Check className="h-2 w-2 text-white" strokeWidth={3.5} />
                </div>
                <span className="text-[11.5px] font-semibold tracking-tight">{shownText}</span>
              </motion.div>
            )}
            {state === 'error' && (
              <motion.div key="err" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-rose-500 grid place-items-center">
                  <XIcon className="h-2 w-2 text-white" strokeWidth={3.5} />
                </div>
                <span className="text-[11.5px] font-semibold tracking-tight">{shownText}</span>
              </motion.div>
            )}
            {state === 'idle' && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5">
                <span className="relative flex h-2 w-2">
                  <span className={cn('absolute inline-flex h-full w-full rounded-full', dark ? 'bg-indigo-400' : 'bg-indigo-500', !reduced && 'animate-ping opacity-60')} />
                  <span className={cn('relative inline-flex rounded-full h-2 w-2', dark ? 'bg-indigo-400' : 'bg-indigo-500')} />
                </span>
                <span className="text-[11.5px] font-semibold tracking-tight opacity-80">{shownText}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Packet wave — one-shot triggered animation ────────────
function PacketWave({ state }: { state: InfraState }) {
  const gradId = state === 'success' ? 'pkSuccess'
              : state === 'error' ? 'pkError'
              : 'pkIdle';

  return (
    <>
      {/* Laptop → Pill */}
      <motion.circle
        r="6" fill={`url(#${gradId})`}
        initial={{ cx: 335, cy: 305, opacity: 0 }}
        animate={{ cx: [335, 420], cy: [305, 280], opacity: [0, 1, 0.6] }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      />
      {/* Pill → Server 1 */}
      <motion.circle
        r="6" fill={`url(#${gradId})`}
        initial={{ cx: 490, cy: 280, opacity: 0 }}
        animate={{ cx: [490, 620], cy: [280, 220], opacity: [0, 1, 0] }}
        transition={{ duration: 0.65, ease: 'easeOut', delay: 0.35 }}
      />
      {/* Pill → Server 2 */}
      <motion.circle
        r="6" fill={`url(#${gradId})`}
        initial={{ cx: 490, cy: 280, opacity: 0 }}
        animate={{ cx: [490, 620], cy: [280, 275], opacity: [0, 1, 0] }}
        transition={{ duration: 0.65, ease: 'easeOut', delay: 0.45 }}
      />
      {/* Pill → Server 3 */}
      <motion.circle
        r="6" fill={`url(#${gradId})`}
        initial={{ cx: 490, cy: 280, opacity: 0 }}
        animate={{ cx: [490, 620], cy: [280, 330], opacity: [0, 1, 0] }}
        transition={{ duration: 0.65, ease: 'easeOut', delay: 0.55 }}
      />
      {/* Pill → Server 4 */}
      <motion.circle
        r="6" fill={`url(#${gradId})`}
        initial={{ cx: 490, cy: 280, opacity: 0 }}
        animate={{ cx: [490, 620], cy: [280, 385], opacity: [0, 1, 0] }}
        transition={{ duration: 0.65, ease: 'easeOut', delay: 0.65 }}
      />
    </>
  );
}

// ─── Server unit — refined isometric ────────────────────
function ServerUnit({ y, dark, active }: { y: number; dark: boolean; active: boolean }) {
  return (
    <g transform={`translate(0, ${y})`}>
      {/* Top face (parallelogram) */}
      <path d="M 0,0 L 110,0 L 130,-14 L 20,-14 Z" fill="url(#svTop)" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.4" />

      {/* Front face */}
      <rect x="0" y="0" width="110" height="40" fill="url(#svFront)" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.4" />

      {/* Right side face (parallelogram) */}
      <path d="M 110,0 L 130,-14 L 130,26 L 110,40 Z" fill="url(#svSide)" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.4" />

      {/* Front panel — LED indicators */}
      <g transform="translate(8, 8)">
        {/* Active LED — emerald (always on) */}
        <circle cx="0" cy="0" r="1.8" fill="#10b981">
          {active && <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />}
        </circle>
        {/* Status LED 2 */}
        <circle cx="0" cy="6" r="1.8" fill={dark ? '#475569' : '#94a3b8'} opacity="0.6" />
        {/* Status LED 3 */}
        <circle cx="0" cy="12" r="1.8" fill={dark ? '#475569' : '#94a3b8'} opacity="0.4" />
      </g>

      {/* Rack U-unit lines (subtle horizontal stripes) */}
      <g transform="translate(20, 4)" opacity="0.55">
        <line x1="0" y1="0" x2="78" y2="0" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="0.5" />
        <line x1="0" y1="6" x2="78" y2="6" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="0.5" />
        <line x1="0" y1="12" x2="78" y2="12" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="0.5" />
        <line x1="0" y1="18" x2="78" y2="18" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="0.5" />
        <line x1="0" y1="24" x2="78" y2="24" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="0.5" />
        <line x1="0" y1="30" x2="78" y2="30" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="0.5" />
      </g>

      {/* Vent grilles on right */}
      <g transform="translate(72, 7)" opacity="0.7">
        <rect x="0" y="0" width="24" height="3" rx="0.5" fill={dark ? '#020617' : '#94a3b8'} />
        <rect x="0" y="6" width="24" height="3" rx="0.5" fill={dark ? '#020617' : '#94a3b8'} />
        <rect x="0" y="12" width="24" height="3" rx="0.5" fill={dark ? '#020617' : '#94a3b8'} />
        <rect x="0" y="18" width="24" height="3" rx="0.5" fill={dark ? '#020617' : '#94a3b8'} />
        <rect x="0" y="24" width="24" height="3" rx="0.5" fill={dark ? '#020617' : '#94a3b8'} />
      </g>

      {/* Top face highlight (depth) */}
      <line x1="0" y1="0" x2="110" y2="0" stroke={dark ? '#64748b' : '#cbd5e1'} strokeWidth="0.5" opacity="0.6" />
    </g>
  );
}
