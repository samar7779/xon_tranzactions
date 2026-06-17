'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Check, X as XIcon } from 'lucide-react';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { cn } from '@/lib/utils';

/**
 * Premium hero — Clerk.com uslubidagi infrastructure illustration.
 * Reaktiv: foydalanuvchi harakatlariga javob beradi.
 *
 *  pulseKey — har o'zgargan vaqtda packet wave ishga tushadi (laptop → card → servers)
 *  state    — illustration umumiy holati:
 *               idle       — kutmoqda
 *               processing — auth card spinner aylanyapti, packet ketmoqda
 *               success    — laptop screen yashil glow, check
 *               error      — laptop screen qizil glow, X
 */

export type InfraState = 'idle' | 'processing' | 'success' | 'error';

export function ApiHeroInfra({
  dark = true,
  className,
  fullBleed = false,
  pulseKey = 0,
  state = 'idle',
}: {
  dark?: boolean;
  className?: string;
  fullBleed?: boolean;
  pulseKey?: number;
  state?: InfraState;
}) {
  const reduced = usePrefersReducedMotion();

  // Screen accent color asoslangan state
  const screenAccent = state === 'success' ? '#10b981' : state === 'error' ? '#f43f5e' : null;
  const screenGlow = state === 'success' ? 'rgba(16,185,129,0.4)'
                    : state === 'error' ? 'rgba(244,63,94,0.4)'
                    : null;

  return (
    <div className={cn('relative w-full h-full min-h-[420px] lg:min-h-[600px] overflow-hidden', !fullBleed && 'rounded-2xl', className)} aria-hidden="true">
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
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-3xl opacity-60 transition-colors duration-500"
        style={{
          background: screenGlow
            ? `radial-gradient(circle, ${screenGlow} 0%, transparent 65%)`
            : (dark
              ? 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 65%)'
              : 'radial-gradient(circle, rgba(165,180,252,0.4) 0%, transparent 65%)'),
        }}
      />

      {/* SVG infrastructure illustration */}
      <svg
        viewBox="0 0 800 500"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio={fullBleed ? 'xMidYMid slice' : 'xMidYMid meet'}
      >
        <defs>
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
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={dark ? 'rgba(148,163,184,0)' : 'rgba(100,116,139,0)'} />
            <stop offset="0.15" stopColor={dark ? 'rgba(148,163,184,0.45)' : 'rgba(100,116,139,0.55)'} />
            <stop offset="0.85" stopColor={dark ? 'rgba(148,163,184,0.45)' : 'rgba(100,116,139,0.55)'} />
            <stop offset="1" stopColor={dark ? 'rgba(148,163,184,0)' : 'rgba(100,116,139,0)'} />
          </linearGradient>
          <radialGradient id="packetGlow">
            <stop offset="0" stopColor="#a5b4fc" stopOpacity="1" />
            <stop offset="1" stopColor="#a5b4fc" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="packetGlowSuccess">
            <stop offset="0" stopColor="#34d399" stopOpacity="1" />
            <stop offset="1" stopColor="#34d399" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="packetGlowError">
            <stop offset="0" stopColor="#fb7185" stopOpacity="1" />
            <stop offset="1" stopColor="#fb7185" stopOpacity="0" />
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
          <line x1="-20" y1="18" x2="180" y2="18" stroke={dark ? '#475569' : '#64748b'} strokeWidth="1" />
          {/* Laptop screen */}
          <path
            d="M 5,0 L 155,0 L 165,-95 L -5,-95 Z"
            fill="url(#laptopScreen)"
            stroke={dark ? '#334155' : '#64748b'}
            strokeWidth="0.5"
          />
          {/* Screen inner — color reacts to state */}
          <rect
            x="0" y="-90" width="160" height="85"
            fill={screenAccent || (dark ? '#020617' : '#1e293b')}
            opacity={screenAccent ? "0.5" : "0.7"}
            style={{ transition: 'fill 0.5s, opacity 0.5s' }}
          />
          {/* Content lines */}
          <line x1="15" y1="-75" x2="65" y2="-75" stroke={dark ? '#475569' : '#94a3b8'} strokeWidth="1" opacity="0.6" />
          <line x1="15" y1="-65" x2="85" y2="-65" stroke={dark ? '#475569' : '#94a3b8'} strokeWidth="1" opacity="0.4" />
          <line x1="15" y1="-55" x2="55" y2="-55" stroke={dark ? '#475569' : '#94a3b8'} strokeWidth="1" opacity="0.4" />
          <line x1="15" y1="-45" x2="75" y2="-45" stroke={dark ? '#475569' : '#94a3b8'} strokeWidth="1" opacity="0.3" />
          {/* Trackpad */}
          <rect x="65" y="3" width="30" height="10" rx="2" fill={dark ? '#0f172a' : '#94a3b8'} stroke={dark ? '#334155' : '#64748b'} strokeWidth="0.5" />

          {/* Success/Error icon — center of screen */}
          {state === 'success' && (
            <g transform="translate(80, -45)">
              <circle r="14" fill="#10b981" opacity="0.25">
                <animate attributeName="r" values="14;22;14" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.25;0;0.25" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle r="12" fill="#10b981" />
              <path d="M -5,0 L -2,4 L 6,-4" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}
          {state === 'error' && (
            <g transform="translate(80, -45)">
              <circle r="12" fill="#f43f5e" />
              <line x1="-5" y1="-5" x2="5" y2="5" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="5" y1="-5" x2="-5" y2="5" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </g>
          )}
        </g>

        {/* ─── LINES — static dashed (no constant signal) ─── */}
        <line x1="280" y1="290" x2="370" y2="250" stroke="url(#lineGrad)" strokeWidth="1" strokeDasharray="3,3" />
        <line x1="430" y1="250" x2="560" y2="220" stroke="url(#lineGrad)" strokeWidth="1" strokeDasharray="3,3" />
        <line x1="430" y1="250" x2="560" y2="290" stroke="url(#lineGrad)" strokeWidth="1" strokeDasharray="3,3" />
        <line x1="430" y1="250" x2="560" y2="340" stroke="url(#lineGrad)" strokeWidth="1" strokeDasharray="3,3" />

        {/* ─── PACKET WAVE — pulseKey o'zgarganda ishga tushadi ─── */}
        <AnimatePresence mode="wait">
          {pulseKey > 0 && !reduced && (
            <PacketWave key={pulseKey} state={state} />
          )}
        </AnimatePresence>

        {/* ─── RIGHT — Server rack ─── */}
        <g transform="translate(560, 180)">
          <ServerUnit y={0} dark={dark} />
          <ServerUnit y={50} dark={dark} />
          <ServerUnit y={100} dark={dark} />
          <ServerUnit y={150} dark={dark} />
        </g>
      </svg>

      {/* ─── CENTER — Authenticating card (HTML) ─── */}
      <motion.div
        initial={{ opacity: 0, scale: reduced ? 1 : 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : 0.2 }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
      >
        <div className={cn(
          'absolute -inset-3 rounded-2xl blur-2xl transition-colors duration-500',
          state === 'success' && 'bg-emerald-500/30',
          state === 'error' && 'bg-rose-500/30',
          state !== 'success' && state !== 'error' && 'bg-indigo-500/20',
        )} aria-hidden="true" />

        <div
          className={cn(
            'relative rounded-xl px-4 py-3 flex items-center gap-3 shadow-2xl transition-colors duration-300',
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
          <AnimatePresence mode="wait">
            {state === 'processing' && (
              <motion.div key="proc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-3">
                <Loader2 className={cn('h-3.5 w-3.5 animate-spin', dark ? 'text-slate-400' : 'text-slate-500')} />
                <span className="text-[12px] font-semibold tracking-tight">Authenticating...</span>
              </motion.div>
            )}
            {state === 'success' && (
              <motion.div key="ok" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-3">
                <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 grid place-items-center">
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                </div>
                <span className="text-[12px] font-semibold tracking-tight">Authenticated</span>
              </motion.div>
            )}
            {state === 'error' && (
              <motion.div key="err" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-3">
                <div className="w-3.5 h-3.5 rounded-full bg-rose-500 grid place-items-center">
                  <XIcon className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                </div>
                <span className="text-[12px] font-semibold tracking-tight">Authentication failed</span>
              </motion.div>
            )}
            {state === 'idle' && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                <span className="text-[12px] font-semibold tracking-tight opacity-70">Waiting for credentials</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Floating labels */}
      <div className="absolute bottom-[28%] left-[10%] text-[10px] uppercase tracking-widest font-bold text-slate-500">
        Client
      </div>
      <div className="absolute top-[20%] right-[12%] text-[10px] uppercase tracking-widest font-bold text-slate-500">
        API Gateway
      </div>
    </div>
  );
}

// ─── Packet wave — one-shot animation triggered by pulseKey ─
function PacketWave({ state }: { state: InfraState }) {
  const gradId = state === 'success' ? 'packetGlowSuccess'
              : state === 'error' ? 'packetGlowError'
              : 'packetGlow';

  return (
    <>
      {/* Laptop → Auth */}
      <motion.circle
        r="5"
        fill={`url(#${gradId})`}
        initial={{ cx: 280, cy: 290, opacity: 0 }}
        animate={{ cx: [280, 370], cy: [290, 250], opacity: [0, 1, 0.6] }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
      {/* Auth → Server 1 (after small delay) */}
      <motion.circle
        r="5"
        fill={`url(#${gradId})`}
        initial={{ cx: 430, cy: 250, opacity: 0 }}
        animate={{ cx: [430, 560], cy: [250, 220], opacity: [0, 1, 0] }}
        transition={{ duration: 0.7, ease: 'easeOut', delay: 0.4 }}
      />
      {/* Auth → Server 2 */}
      <motion.circle
        r="5"
        fill={`url(#${gradId})`}
        initial={{ cx: 430, cy: 250, opacity: 0 }}
        animate={{ cx: [430, 560], cy: [250, 290], opacity: [0, 1, 0] }}
        transition={{ duration: 0.7, ease: 'easeOut', delay: 0.55 }}
      />
      {/* Auth → Server 3 */}
      <motion.circle
        r="5"
        fill={`url(#${gradId})`}
        initial={{ cx: 430, cy: 250, opacity: 0 }}
        animate={{ cx: [430, 560], cy: [250, 340], opacity: [0, 1, 0] }}
        transition={{ duration: 0.7, ease: 'easeOut', delay: 0.7 }}
      />
    </>
  );
}

// ─── Server unit (isometric) ─────────────────────────────
function ServerUnit({ y, dark }: { y: number; dark: boolean }) {
  return (
    <g transform={`translate(0, ${y})`}>
      <path d="M 0,0 L 100,0 L 115,-10 L 15,-10 Z" fill={dark ? '#1e293b' : '#cbd5e1'} stroke={dark ? '#334155' : '#64748b'} strokeWidth="0.5" />
      <rect x="0" y="0" width="100" height="35" fill="url(#serverGrad)" stroke={dark ? '#334155' : '#64748b'} strokeWidth="0.5" />
      <path d="M 100,0 L 115,-10 L 115,25 L 100,35 Z" fill={dark ? '#0f172a' : '#94a3b8'} stroke={dark ? '#334155' : '#64748b'} strokeWidth="0.5" />
      <circle cx="10" cy="8" r="1.5" fill="#10b981" opacity="0.9">
        <animate attributeName="opacity" values="0.9;0.3;0.9" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="10" cy="14" r="1.5" fill="#475569" opacity="0.6" />
      <circle cx="10" cy="20" r="1.5" fill="#475569" opacity="0.4" />
      {[6, 12, 18, 24, 30].map((py, i) => (
        <line key={i} x1="25" y1={py} x2="90" y2={py} stroke={dark ? '#475569' : '#94a3b8'} strokeWidth="0.5" opacity={0.5} />
      ))}
      <rect x="65" y="7" width="20" height="3" fill={dark ? '#0f172a' : '#94a3b8'} opacity="0.6" />
      <rect x="65" y="13" width="20" height="3" fill={dark ? '#0f172a' : '#94a3b8'} opacity="0.6" />
      <rect x="65" y="19" width="20" height="3" fill={dark ? '#0f172a' : '#94a3b8'} opacity="0.6" />
      <rect x="65" y="25" width="20" height="3" fill={dark ? '#0f172a' : '#94a3b8'} opacity="0.6" />
    </g>
  );
}
