'use client';

import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { Loader2, Check, X as XIcon } from 'lucide-react';
import { useRef, useMemo } from 'react';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { cn } from '@/lib/utils';

/**
 * Premium isometric infrastructure illustration.
 * Layered depth, mouse parallax, atmospheric particles, real code editor mockup,
 * detailed server racks with port LEDs, continuous subtle data flow.
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Mouse parallax
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 60, damping: 22 });
  const sy = useSpring(my, { stiffness: 60, damping: 22 });
  const parallaxX = useTransform(sx, [-1, 1], [-10, 10]);
  const parallaxY = useTransform(sy, [-1, 1], [-6, 6]);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduced) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    const y = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
    mx.set(Math.max(-1, Math.min(1, x)));
    my.set(Math.max(-1, Math.min(1, y)));
  };
  const onLeave = () => { mx.set(0); my.set(0); };

  const accent = state === 'success' ? '#10b981'
              : state === 'error' ? '#f43f5e'
              : '#818cf8';
  const accentGlow = state === 'success' ? 'rgba(16,185,129,0.4)'
                  : state === 'error' ? 'rgba(244,63,94,0.4)'
                  : 'rgba(129,140,248,0.38)';

  const defaultStatusText = state === 'success' ? 'Authenticated'
                          : state === 'error' ? 'Authentication failed'
                          : state === 'processing' ? 'Authenticating'
                          : 'Waiting for credentials';
  const shownText = statusText || defaultStatusText;

  // Ambient floating particles (fixed positions, animated opacity/scale)
  const particles = useMemo(() => Array.from({ length: 22 }, (_, i) => ({
    x: (i * 137.5) % 100,
    y: (i * 67.3) % 100,
    size: 1 + (i % 3),
    delay: (i * 0.3) % 4,
    duration: 3 + (i % 4),
  })), []);

  return (
    <div
      ref={containerRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={cn('relative w-full h-full min-h-[420px] lg:min-h-[600px] overflow-hidden', !fullBleed && 'rounded-2xl', className)}
      aria-hidden="true"
    >
      {/* ─── BACKGROUND LAYERS ─── */}
      <div
        className="absolute inset-0"
        style={{
          background: dark
            ? 'radial-gradient(ellipse at 30% 50%, #0f172a 0%, #020617 70%)'
            : 'radial-gradient(ellipse at 30% 50%, #f1f5f9 0%, #e2e8f0 70%)',
        }}
      />

      {/* Aurora gradient blobs */}
      <motion.div
        animate={!reduced ? { x: [0, 40, -20, 0], y: [0, -30, 20, 0] } : {}}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 left-[15%] w-[420px] h-[420px] rounded-full blur-3xl pointer-events-none"
        style={{
          background: dark
            ? 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(165,180,252,0.32) 0%, transparent 70%)',
        }}
      />
      <motion.div
        animate={!reduced ? { x: [0, -30, 30, 0], y: [0, 30, -20, 0] } : {}}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        className="absolute bottom-[15%] right-[20%] w-[360px] h-[360px] rounded-full blur-3xl pointer-events-none"
        style={{
          background: dark
            ? 'radial-gradient(circle, rgba(34,211,238,0.14) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(165,243,252,0.28) 0%, transparent 70%)',
        }}
      />

      {/* Dot-grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: dark
            ? 'radial-gradient(circle, rgba(148,163,184,0.18) 1px, transparent 1px)'
            : 'radial-gradient(circle, rgba(100,116,139,0.22) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 85%)',
        }}
      />

      {/* Floating ambient particles */}
      {!reduced && particles.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: dark ? 'rgba(165,180,252,0.5)' : 'rgba(99,102,241,0.45)',
            boxShadow: dark ? '0 0 6px rgba(165,180,252,0.6)' : '0 0 4px rgba(99,102,241,0.4)',
          }}
          animate={{ opacity: [0.2, 0.8, 0.2], scale: [0.8, 1.2, 0.8] }}
          transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'easeInOut' }}
        />
      ))}

      {/* Central radial glow — pill behind */}
      <motion.div
        animate={{ scale: !reduced ? [1, 1.08, 1] : 1, opacity: !reduced ? [0.7, 1, 0.7] : 0.85 }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-3xl pointer-events-none transition-all duration-700"
        style={{ background: `radial-gradient(circle, ${accentGlow} 0%, transparent 65%)` }}
      />

      {/* ─── MOUSE PARALLAX WRAPPER ─── */}
      <motion.div
        className="absolute inset-0"
        style={{ x: parallaxX, y: parallaxY }}
      >
        {/* SVG infrastructure illustration */}
        <svg
          viewBox="0 0 900 540"
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio={fullBleed ? 'xMidYMid slice' : 'xMidYMid meet'}
        >
          <defs>
            {/* Laptop gradients */}
            <linearGradient id="lpTop" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={dark ? '#475569' : '#cbd5e1'} />
              <stop offset="1" stopColor={dark ? '#1e293b' : '#94a3b8'} />
            </linearGradient>
            <linearGradient id="lpBase" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={dark ? '#64748b' : '#e2e8f0'} />
              <stop offset="1" stopColor={dark ? '#1e293b' : '#94a3b8'} />
            </linearGradient>
            <linearGradient id="lpScreen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={dark ? '#1e293b' : '#cbd5e1'} />
              <stop offset="1" stopColor={dark ? '#0f172a' : '#94a3b8'} />
            </linearGradient>
            <linearGradient id="lpDisplay" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={dark ? '#0c1322' : '#1e293b'} />
              <stop offset="1" stopColor={dark ? '#020617' : '#0f172a'} />
            </linearGradient>

            {/* Server gradients */}
            <linearGradient id="svTop" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={dark ? '#64748b' : '#e2e8f0'} />
              <stop offset="1" stopColor={dark ? '#475569' : '#cbd5e1'} />
            </linearGradient>
            <linearGradient id="svFront" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={dark ? '#475569' : '#cbd5e1'} />
              <stop offset="0.5" stopColor={dark ? '#334155' : '#cbd5e1'} />
              <stop offset="1" stopColor={dark ? '#1e293b' : '#94a3b8'} />
            </linearGradient>
            <linearGradient id="svSide" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={dark ? '#1e293b' : '#94a3b8'} />
              <stop offset="1" stopColor={dark ? '#0f172a' : '#64748b'} />
            </linearGradient>

            {/* Line gradient */}
            <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="transparent" />
              <stop offset="0.12" stopColor={dark ? 'rgba(148,163,184,0.6)' : 'rgba(100,116,139,0.7)'} />
              <stop offset="0.88" stopColor={dark ? 'rgba(148,163,184,0.6)' : 'rgba(100,116,139,0.7)'} />
              <stop offset="1" stopColor="transparent" />
            </linearGradient>

            {/* Packet glow gradients */}
            <radialGradient id="pkIdle">
              <stop offset="0" stopColor="#c7d2fe" stopOpacity="1" />
              <stop offset="0.4" stopColor="#818cf8" stopOpacity="0.8" />
              <stop offset="1" stopColor="#818cf8" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="pkSuccess">
              <stop offset="0" stopColor="#a7f3d0" stopOpacity="1" />
              <stop offset="0.4" stopColor="#10b981" stopOpacity="0.8" />
              <stop offset="1" stopColor="#10b981" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="pkError">
              <stop offset="0" stopColor="#fecaca" stopOpacity="1" />
              <stop offset="0.4" stopColor="#f43f5e" stopOpacity="0.8" />
              <stop offset="1" stopColor="#f43f5e" stopOpacity="0" />
            </radialGradient>

            {/* Shadow filter */}
            <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="5" />
              <feOffset dx="0" dy="8" />
              <feComponentTransfer><feFuncA type="linear" slope="0.28" /></feComponentTransfer>
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Glow filter — for status indicators */}
            <filter id="ledGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Animated dashed lines */}
            <style>{`
              @keyframes flowDash { to { stroke-dashoffset: -16; } }
              .flow-line { animation: ${reduced ? 'none' : 'flowDash 1.4s linear infinite'}; }
              @keyframes shimmer { 0%,100% { opacity: 0.3; } 50% { opacity: 0.9; } }
              .shimmer-dot { animation: ${reduced ? 'none' : 'shimmer 1.8s ease-in-out infinite'}; }
            `}</style>
          </defs>

          {/* ─── LEFT — Premium MacBook with API console ─── */}
          <g transform="translate(105, 265)" filter="url(#softShadow)">
            {/* Soft floor reflection — bigger glow */}
            <ellipse cx="120" cy="48" rx="160" ry="9" fill={dark ? '#020617' : '#94a3b8'} opacity="0.28" />
            {/* Accent under-glow that responds to state */}
            <ellipse cx="120" cy="44" rx="120" ry="5" fill={
              state === 'success' ? '#10b981'
              : state === 'error' ? '#f43f5e'
              : state === 'processing' ? '#818cf8'
              : dark ? '#475569' : '#64748b'
            } opacity={state === 'idle' ? 0.18 : 0.4}>
              {state !== 'idle' && !reduced && (
                <animate attributeName="opacity" values="0.4;0.7;0.4" dur="1.5s" repeatCount="indefinite" />
              )}
            </ellipse>

            {/* Laptop base — premium isometric (wider/thinner) */}
            <path d="M -18,32 L 258,32 L 290,46 L -50,46 Z" fill="url(#lpBase)" />
            <path d="M -2,2 L 242,2 L 258,32 L -18,32 Z" fill="url(#lpTop)" stroke={dark ? '#475569' : '#94a3b8'} strokeWidth="0.5" />

            {/* Hinge groove — subtle dark line */}
            <line x1="2" y1="2" x2="240" y2="2" stroke={dark ? '#0f172a' : '#475569'} strokeWidth="1" opacity="0.6" />
            <line x1="3" y1="0.5" x2="240" y2="0.5" stroke={dark ? '#94a3b8' : '#e2e8f0'} strokeWidth="0.5" opacity="0.5" />

            {/* Trackpad — bigger, with subtle inner shadow */}
            <rect x="78" y="8" width="86" height="16" rx="3" fill={dark ? '#0f172a' : '#94a3b8'} opacity="0.85" />
            <rect x="78" y="8" width="86" height="16" rx="3" fill="none" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.4" />
            <rect x="79" y="9" width="84" height="1" fill={dark ? '#1e293b' : '#cbd5e1'} opacity="0.5" />

            {/* Front edge LED bar (Touch Bar / MacBook glow) */}
            <rect x="-8" y="29" width="252" height="0.8" fill={
              state === 'success' ? '#10b981'
              : state === 'error' ? '#f43f5e'
              : state === 'processing' ? '#a78bfa'
              : dark ? '#334155' : '#94a3b8'
            } opacity="0.7" />

            {/* ─── LAPTOP SCREEN (bigger, premium aluminum bezel) ─── */}
            {/* Outer aluminum frame — perspective trapezoid */}
            <path d="M 3,2 L 237,2 L 252,-145 L -12,-145 Z" fill="url(#lpScreen)" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.5" />

            {/* Inner bezel (dark) */}
            <path d="M 7,-1 L 233,-1 L 247,-140 L -7,-140 Z" fill={dark ? '#000' : '#0a0e1a'} />

            {/* ─── ACTIVE DISPLAY AREA ─── */}
            <rect x="0" y="-138" width="240" height="134" fill="url(#lpDisplay)" rx="3" />

            {/* Subtle screen glare — diagonal highlight */}
            <path d="M 0,-138 L 240,-138 L 130,-4 L 0,-4 Z" fill="white" opacity="0.025" />

            {/* macOS-style title bar — taller, refined */}
            <rect x="0" y="-138" width="240" height="14" fill={dark ? '#1a2438' : '#2a3447'} opacity="0.95" rx="3" />
            <rect x="0" y="-128" width="240" height="4" fill={dark ? '#1a2438' : '#2a3447'} opacity="0.95" />

            {/* Traffic light controls — bigger and clearer */}
            <circle cx="9" cy="-131" r="1.8" fill="#ff5f57" />
            <circle cx="16" cy="-131" r="1.8" fill="#febc2e" />
            <circle cx="23" cy="-131" r="1.8" fill="#28c840" />

            {/* Active file tab */}
            <rect x="40" y="-138" width="62" height="14" fill={dark ? '#0c1322' : '#020617'} opacity="0.85" rx="2" />
            <text x="48" y="-128.5" fontSize="4.2" fill={dark ? '#cbd5e1' : '#cbd5e1'} fontFamily="monospace" fontWeight="500">auth.ts</text>
            <circle cx="44" cy="-130.5" r="1.1" fill="#fbbf24" />
            {/* Tab close x */}
            <text x="95" y="-128.8" fontSize="4" fill={dark ? '#64748b' : '#475569'} fontFamily="monospace">×</text>

            {/* Inactive tabs */}
            <text x="108" y="-128.8" fontSize="4" fill={dark ? '#64748b' : '#64748b'} fontFamily="monospace" opacity="0.7">index.ts</text>
            <text x="138" y="-128.8" fontSize="4" fill={dark ? '#64748b' : '#64748b'} fontFamily="monospace" opacity="0.7">config.json</text>

            {/* Status indicator in top-right of title bar */}
            <g transform="translate(220, -131)">
              <circle r="2.5" fill={
                state === 'success' ? '#10b981'
                : state === 'error' ? '#f43f5e'
                : state === 'processing' ? '#a78bfa'
                : '#475569'
              }>
                {state === 'processing' && !reduced && (
                  <animate attributeName="opacity" values="1;0.3;1" dur="0.9s" repeatCount="indefinite" />
                )}
              </circle>
              <text x="5" y="1.5" fontSize="3.2" fontFamily="monospace" fontWeight="600" fill={
                state === 'success' ? '#34d399'
                : state === 'error' ? '#fb7185'
                : state === 'processing' ? '#c4b5fd'
                : '#64748b'
              }>
                {state === 'success' ? 'LIVE' : state === 'error' ? 'FAIL' : state === 'processing' ? 'SYNC' : 'IDLE'}
              </text>
            </g>

            {/* ─── CODE EDITOR — cleaner, bigger ─── */}
            <g transform="translate(0, -122)">
              {/* Line numbers gutter — refined */}
              <rect x="0" y="0" width="18" height="118" fill={dark ? '#0a0e1a' : '#0a0e1a'} opacity="0.65" />
              <line x1="18" y1="0" x2="18" y2="118" stroke={dark ? '#1e293b' : '#1e293b'} strokeWidth="0.3" />
              {[0, 11, 22, 33, 44, 55, 66, 77, 88, 99].map((y, i) => (
                <text key={i} x="14" y={y + 7.5} fontSize="4" fill={dark ? '#334155' : '#475569'} fontFamily="monospace" textAnchor="end" fontWeight="500">{i + 1}</text>
              ))}

              {/* Highlighted current line — soft accent */}
              <rect x="20" y="35" width="220" height="11" fill={
                state === 'success' ? '#10b981'
                : state === 'error' ? '#f43f5e'
                : state === 'processing' ? '#a78bfa'
                : '#a78bfa'
              } opacity={state === 'idle' ? 0 : 0.1} />

              {/* Code lines — bigger fonts, cleaner */}
              <g transform="translate(24, 4)">
                <text x="0" y="2.5" fontSize="4.5" fontFamily="monospace">
                  <tspan fill="#c084fc" fontWeight="600">const</tspan>
                  <tspan fill={dark ? '#e2e8f0' : '#e2e8f0'}> response </tspan>
                  <tspan fill="#94a3b8">=</tspan>
                  <tspan fill={dark ? '#e2e8f0' : '#e2e8f0'}> </tspan>
                  <tspan fill="#c084fc" fontWeight="600">await</tspan>
                </text>
                <text x="0" y="13.5" fontSize="4.5" fontFamily="monospace">
                  <tspan fill={dark ? '#e2e8f0' : '#e2e8f0'}>  fetch</tspan>
                  <tspan fill="#94a3b8">(</tspan>
                  <tspan fill="#86efac">'/api/v1/auth'</tspan>
                  <tspan fill="#94a3b8">, </tspan>
                  <tspan fill="#fbbf24">{'{'}</tspan>
                </text>
                <text x="0" y="24.5" fontSize="4.5" fontFamily="monospace">
                  <tspan fill={dark ? '#e2e8f0' : '#e2e8f0'}>    method</tspan>
                  <tspan fill="#94a3b8">: </tspan>
                  <tspan fill="#86efac">'POST'</tspan>
                  <tspan fill="#94a3b8">,</tspan>
                </text>
                <text x="0" y="35.5" fontSize="4.5" fontFamily="monospace">
                  <tspan fill={dark ? '#e2e8f0' : '#e2e8f0'}>    headers</tspan>
                  <tspan fill="#94a3b8">: </tspan>
                  <tspan fill="#fbbf24">{'{'}</tspan>
                </text>
                <text x="0" y="46.5" fontSize="4.5" fontFamily="monospace">
                  <tspan fill={dark ? '#e2e8f0' : '#e2e8f0'}>      </tspan>
                  <tspan fill="#86efac">'X-API-Key'</tspan>
                  <tspan fill="#94a3b8">: </tspan>
                  <tspan fill="#7dd3fc" fontWeight="600">apiKey</tspan>
                  <tspan fill="#94a3b8">,</tspan>
                </text>
                <text x="0" y="57.5" fontSize="4.5" fontFamily="monospace">
                  <tspan fill={dark ? '#e2e8f0' : '#e2e8f0'}>      </tspan>
                  <tspan fill="#86efac">'X-API-Secret'</tspan>
                  <tspan fill="#94a3b8">: </tspan>
                  <tspan fill="#7dd3fc" fontWeight="600">secret</tspan>
                </text>
                <text x="0" y="68.5" fontSize="4.5" fontFamily="monospace">
                  <tspan fill={dark ? '#e2e8f0' : '#e2e8f0'}>    </tspan>
                  <tspan fill="#fbbf24">{'}'}</tspan>
                </text>
                <text x="0" y="79.5" fontSize="4.5" fontFamily="monospace">
                  <tspan fill={dark ? '#e2e8f0' : '#e2e8f0'}>  </tspan>
                  <tspan fill="#94a3b8">{'});'}</tspan>
                </text>
                <text x="0" y="93.5" fontSize="4.5" fontFamily="monospace">
                  <tspan fill="#64748b" opacity="0.8">// </tspan>
                  <tspan fill={
                    state === 'success' ? '#86efac'
                    : state === 'error' ? '#fda4af'
                    : '#64748b'
                  } opacity={state === 'idle' ? 0.6 : 0.95}>
                    {state === 'success'
                      ? '→ { ok: true, scope: ["read","write"] }'
                      : state === 'error'
                      ? '→ { error: "unauthorized" }'
                      : state === 'processing'
                      ? '→ pending...'
                      : '→ awaiting auth...'}
                  </tspan>
                </text>

                {/* Blinking cursor on last line */}
                {!reduced && (
                  <rect x="3" y="100" width="1.6" height="5.5" fill="#34d399">
                    <animate attributeName="opacity" values="1;0;1" dur="0.9s" repeatCount="indefinite" />
                  </rect>
                )}
              </g>
            </g>

            {/* ─── BOTTOM CONSOLE BAR — premium IDE status line ─── */}
            <g transform="translate(0, -8)">
              <rect x="0" y="0" width="240" height="6" fill={dark ? '#1a2438' : '#1a2438'} opacity="0.95" />
              <rect x="0" y="0" width="240" height="6" fill={
                state === 'success' ? '#10b981'
                : state === 'error' ? '#f43f5e'
                : state === 'processing' ? '#a78bfa'
                : '#475569'
              } opacity={state === 'idle' ? 0.15 : 0.25} />

              {/* Status dot */}
              <circle cx="5" cy="3" r="1.5" fill={
                state === 'success' ? '#34d399'
                : state === 'error' ? '#fb7185'
                : state === 'processing' ? '#a78bfa'
                : '#64748b'
              }>
                {state === 'processing' && !reduced && (
                  <animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite" />
                )}
              </circle>

              {/* Status text */}
              <text x="10" y="4.2" fontSize="3.5" fontFamily="monospace" fontWeight="600" fill={
                state === 'success' ? '#a7f3d0'
                : state === 'error' ? '#fecaca'
                : state === 'processing' ? '#c4b5fd'
                : '#94a3b8'
              }>
                {state === 'processing' && 'POST /api/v1/auth · authenticating...'}
                {state === 'success' && '200 OK · session established · 47ms'}
                {state === 'error' && '401 unauthorized · invalid credentials'}
                {state === 'idle' && 'TypeScript · UTF-8 · LF · Ln 12, Col 4'}
              </text>
            </g>
          </g>

          {/* ─── CONNECTION LINES with flowing dashes ─── */}
          <line x1="400" y1="280" x2="500" y2="280" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="6,6" strokeLinecap="round" className="flow-line" />
          <line x1="500" y1="280" x2="620" y2="220" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="6,6" strokeLinecap="round" className="flow-line" style={{ animationDelay: '0.15s' }} />
          <line x1="500" y1="280" x2="620" y2="275" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="6,6" strokeLinecap="round" className="flow-line" style={{ animationDelay: '0.3s' }} />
          <line x1="500" y1="280" x2="620" y2="330" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="6,6" strokeLinecap="round" className="flow-line" style={{ animationDelay: '0.45s' }} />
          <line x1="500" y1="280" x2="620" y2="385" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="6,6" strokeLinecap="round" className="flow-line" style={{ animationDelay: '0.6s' }} />

          {/* Constant subtle ambient packets (always flowing) */}
          {!reduced && (
            <>
              <circle r="2.2" fill="url(#pkIdle)" opacity="0.6">
                <animateMotion dur="3s" repeatCount="indefinite" path="M 400,280 L 500,280" />
              </circle>
              <circle r="2.2" fill="url(#pkIdle)" opacity="0.5">
                <animateMotion dur="2.6s" repeatCount="indefinite" path="M 500,280 L 620,220" begin="0.4s" />
              </circle>
              <circle r="2.2" fill="url(#pkIdle)" opacity="0.5">
                <animateMotion dur="2.6s" repeatCount="indefinite" path="M 500,280 L 620,275" begin="0.9s" />
              </circle>
              <circle r="2.2" fill="url(#pkIdle)" opacity="0.5">
                <animateMotion dur="2.6s" repeatCount="indefinite" path="M 500,280 L 620,330" begin="1.4s" />
              </circle>
              <circle r="2.2" fill="url(#pkIdle)" opacity="0.5">
                <animateMotion dur="2.6s" repeatCount="indefinite" path="M 500,280 L 620,385" begin="1.9s" />
              </circle>
            </>
          )}

          {/* Triggered packet wave */}
          <AnimatePresence mode="wait">
            {pulseKey > 0 && !reduced && <PacketWave key={pulseKey} state={state} />}
          </AnimatePresence>

          {/* ─── RIGHT — 4 servers with port LEDs ─── */}
          <g transform="translate(620, 195)" filter="url(#softShadow)">
            <ServerUnit y={0} dark={dark} active={state !== 'idle'} accent={accent} reduced={reduced} />
            <ServerUnit y={55} dark={dark} active={state !== 'idle'} accent={accent} reduced={reduced} />
            <ServerUnit y={110} dark={dark} active={state !== 'idle'} accent={accent} reduced={reduced} />
            <ServerUnit y={165} dark={dark} active={state !== 'idle'} accent={accent} reduced={reduced} />
          </g>

          {/* Labels */}
          <text x="195" y="475" fontSize="11" fontWeight="700" letterSpacing="2.5" fill={dark ? '#64748b' : '#475569'}>CLIENT</text>
          <text x="675" y="170" fontSize="11" fontWeight="700" letterSpacing="2.5" fill={dark ? '#64748b' : '#475569'}>API GATEWAY</text>

          {/* Subtle technical metadata labels */}
          <text x="195" y="488" fontSize="6.5" fill={dark ? '#475569' : '#94a3b8'} fontFamily="monospace" opacity="0.75">192.168.1.42</text>
          <text x="675" y="182" fontSize="6.5" fill={dark ? '#475569' : '#94a3b8'} fontFamily="monospace" opacity="0.75">cluster-prod-01</text>
        </svg>
      </motion.div>

      {/* ─── CENTER — Floating status pill ─── */}
      <motion.div
        initial={{ opacity: 0, scale: reduced ? 1 : 0.92, y: reduced ? 0 : 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : 0.15 }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
      >
        {/* Triple glow layers */}
        <div className="absolute inset-0 -m-8 rounded-full blur-3xl transition-all duration-500" style={{ background: accentGlow }} aria-hidden="true" />
        <div className="absolute inset-0 -m-4 rounded-full blur-2xl transition-all duration-500" style={{ background: accentGlow }} aria-hidden="true" />
        <div className="absolute inset-0 -m-1 rounded-full blur-lg transition-all duration-500" style={{ background: accentGlow, opacity: 0.6 }} aria-hidden="true" />

        <motion.div
          animate={!reduced ? { y: [0, -3, 0] } : {}}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
          className={cn(
            'relative rounded-full px-4 py-2 flex items-center gap-2.5 backdrop-blur-xl transition-colors duration-300',
            dark
              ? 'bg-slate-900/85 ring-1 ring-slate-700/80 text-slate-100'
              : 'bg-white/90 ring-1 ring-slate-200 text-slate-800',
          )}
          style={{
            boxShadow: dark
              ? '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 40px rgba(99,102,241,0.15), inset 0 1px 0 rgba(255,255,255,0.05)'
              : '0 25px 50px -12px rgba(0,0,0,0.15), 0 0 40px rgba(99,102,241,0.1), inset 0 1px 0 rgba(255,255,255,1)',
          }}
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
                <span className="text-[11.5px] font-semibold tracking-tight opacity-85">{shownText}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
}

// ─── Triggered packet wave ─────────────────────────────
function PacketWave({ state }: { state: InfraState }) {
  const gradId = state === 'success' ? 'pkSuccess'
              : state === 'error' ? 'pkError'
              : 'pkIdle';
  return (
    <>
      <motion.circle r="7" fill={`url(#${gradId})`} initial={{ cx: 400, cy: 280, opacity: 0 }} animate={{ cx: [400, 500], cy: [280, 280], opacity: [0, 1, 0.6] }} transition={{ duration: 0.55, ease: 'easeOut' }} />
      <motion.circle r="7" fill={`url(#${gradId})`} initial={{ cx: 500, cy: 280, opacity: 0 }} animate={{ cx: [500, 620], cy: [280, 220], opacity: [0, 1, 0] }} transition={{ duration: 0.65, ease: 'easeOut', delay: 0.35 }} />
      <motion.circle r="7" fill={`url(#${gradId})`} initial={{ cx: 500, cy: 280, opacity: 0 }} animate={{ cx: [500, 620], cy: [280, 275], opacity: [0, 1, 0] }} transition={{ duration: 0.65, ease: 'easeOut', delay: 0.45 }} />
      <motion.circle r="7" fill={`url(#${gradId})`} initial={{ cx: 500, cy: 280, opacity: 0 }} animate={{ cx: [500, 620], cy: [280, 330], opacity: [0, 1, 0] }} transition={{ duration: 0.65, ease: 'easeOut', delay: 0.55 }} />
      <motion.circle r="7" fill={`url(#${gradId})`} initial={{ cx: 500, cy: 280, opacity: 0 }} animate={{ cx: [500, 620], cy: [280, 385], opacity: [0, 1, 0] }} transition={{ duration: 0.65, ease: 'easeOut', delay: 0.65 }} />
    </>
  );
}

// ─── Refined server unit with port LEDs ────────────────
function ServerUnit({ y, dark, active, accent, reduced }: { y: number; dark: boolean; active: boolean; accent: string; reduced: boolean }) {
  return (
    <g transform={`translate(0, ${y})`}>
      {/* Top face */}
      <path d="M 0,0 L 110,0 L 130,-14 L 20,-14 Z" fill="url(#svTop)" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.5" />
      {/* Top highlight */}
      <line x1="20" y1="-14" x2="130" y2="-14" stroke={dark ? '#94a3b8' : '#e2e8f0'} strokeWidth="0.5" opacity="0.5" />

      {/* Front face */}
      <rect x="0" y="0" width="110" height="40" fill="url(#svFront)" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.5" />

      {/* Right side face */}
      <path d="M 110,0 L 130,-14 L 130,26 L 110,40 Z" fill="url(#svSide)" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.5" />

      {/* Inset front panel (sunken effect) */}
      <rect x="3" y="3" width="104" height="34" fill={dark ? '#0f172a' : '#e2e8f0'} opacity="0.5" rx="1" />
      <rect x="3" y="3" width="104" height="34" fill="none" stroke={dark ? '#0f172a' : '#64748b'} strokeWidth="0.3" rx="1" />

      {/* LED status indicators (left side) */}
      <g transform="translate(8, 8)" filter="url(#ledGlow)">
        <circle cx="0" cy="0" r="2" fill="#10b981">
          {active && !reduced && <animate attributeName="opacity" values="1;0.4;1" dur="1.4s" repeatCount="indefinite" />}
        </circle>
        <circle cx="0" cy="7" r="2" fill={accent} opacity={active ? '0.85' : '0.4'}>
          {active && !reduced && <animate attributeName="opacity" values="0.85;0.3;0.85" dur="1.8s" repeatCount="indefinite" />}
        </circle>
        <circle cx="0" cy="14" r="2" fill={dark ? '#475569' : '#94a3b8'} opacity="0.5" />
      </g>

      {/* LCD display strip */}
      <rect x="18" y="6" width="38" height="6" rx="0.8" fill={dark ? '#1e293b' : '#475569'} />
      <rect x="18" y="6" width="38" height="6" rx="0.8" fill="none" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.3" />
      {/* LCD text */}
      <text x="20" y="11" fontSize="3.5" fill="#34d399" fontFamily="monospace" opacity={active ? '0.85' : '0.5'}>
        {active ? 'ONLINE' : 'STANDBY'}
      </text>

      {/* Network port row */}
      <g transform="translate(18, 18)">
        {[0, 6, 12, 18, 24].map((x, i) => (
          <g key={i}>
            <rect x={x} y="0" width="4" height="5" rx="0.5" fill={dark ? '#0f172a' : '#475569'} />
            {/* Port activity LED — randomly active */}
            {active && !reduced && (i % 2 === 0) && (
              <circle cx={x + 2} cy="2.5" r="0.8" fill="#34d399" className="shimmer-dot" style={{ animationDelay: `${i * 0.15}s` }} />
            )}
          </g>
        ))}
      </g>

      {/* Hard drive bay LEDs */}
      <g transform="translate(18, 28)">
        {[0, 4, 8, 12, 16].map((x, i) => (
          <circle key={i} cx={x} cy="0" r="0.8" fill={i < 3 ? '#10b981' : dark ? '#475569' : '#94a3b8'} opacity={i < 3 ? (active ? 0.9 : 0.5) : 0.5} />
        ))}
      </g>

      {/* Vent grilles (right) */}
      <g transform="translate(72, 7)" opacity="0.7">
        {[0, 5, 10, 15, 20, 25].map((y, i) => (
          <rect key={i} x="0" y={y} width="28" height="2.5" rx="0.4" fill={dark ? '#020617' : '#94a3b8'} />
        ))}
      </g>

      {/* Brand label */}
      <text x="76" y="36" fontSize="2.5" fill={dark ? '#475569' : '#64748b'} fontFamily="monospace" opacity="0.6">XT-SRV</text>
    </g>
  );
}
