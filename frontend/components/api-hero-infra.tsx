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

          {/* ─── LEFT — Refined isometric laptop with code editor ─── */}
          <g transform="translate(150, 290)" filter="url(#softShadow)">
            {/* Floor reflection (subtle) */}
            <ellipse cx="80" cy="34" rx="105" ry="6" fill={dark ? '#020617' : '#94a3b8'} opacity="0.22" />

            {/* Laptop base — isometric */}
            <path d="M -10,18 L 170,18 L 195,30 L -35,30 Z" fill="url(#lpBase)" />
            <path d="M 0,0 L 160,0 L 170,18 L -10,18 Z" fill="url(#lpTop)" stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth="0.5" />

            {/* Base highlight (top edge) */}
            <line x1="2" y1="0" x2="158" y2="0" stroke={dark ? '#94a3b8' : '#e2e8f0'} strokeWidth="0.5" opacity="0.7" />

            {/* Trackpad */}
            <rect x="55" y="3.5" width="50" height="10" rx="2.5" fill={dark ? '#0f172a' : '#94a3b8'} opacity="0.8" />
            <rect x="55" y="3.5" width="50" height="10" rx="2.5" fill="none" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.3" />

            {/* Laptop screen */}
            <path d="M 5,0 L 155,0 L 170,-115 L -10,-115 Z" fill="url(#lpScreen)" stroke={dark ? '#475569' : '#64748b'} strokeWidth="0.4" />

            {/* Screen bezel (inner border) */}
            <path d="M 8,-2 L 152,-2 L 167,-110 L -7,-110 Z" fill={dark ? '#020617' : '#0f172a'} opacity="0.4" />

            {/* Actual display (clipped) */}
            <rect x="0" y="-108" width="160" height="103" fill="url(#lpDisplay)" rx="2.5" />

            {/* Window title bar */}
            <rect x="0" y="-108" width="160" height="13" fill={dark ? '#1e293b' : '#334155'} opacity="0.6" rx="2.5" />
            <rect x="0" y="-101" width="160" height="6" fill={dark ? '#1e293b' : '#334155'} opacity="0.6" />

            {/* Mac controls */}
            <circle cx="7" cy="-101.5" r="1.4" fill="#ef4444" />
            <circle cx="13" cy="-101.5" r="1.4" fill="#f59e0b" />
            <circle cx="19" cy="-101.5" r="1.4" fill="#10b981" />

            {/* File tabs */}
            <rect x="30" y="-105" width="40" height="9" rx="1" fill={dark ? '#334155' : '#475569'} opacity="0.6" />
            <text x="36" y="-99" fontSize="4" fill={dark ? '#94a3b8' : '#cbd5e1'} fontFamily="monospace">auth.ts</text>

            {/* Code editor content — colored syntax */}
            <g transform="translate(0, -90)">
              {/* Line numbers gutter */}
              <rect x="0" y="0" width="14" height="88" fill={dark ? '#020617' : '#0f172a'} opacity="0.6" />
              {[0, 8, 16, 24, 32, 40, 48, 56, 64, 72].map((y, i) => (
                <text key={i} x="11" y={y + 6} fontSize="3.5" fill={dark ? '#475569' : '#64748b'} fontFamily="monospace" textAnchor="end">{i + 1}</text>
              ))}

              {/* Code lines with syntax colors */}
              <g transform="translate(18, 4)">
                {/* import { ... } */}
                <text x="0" y="2" fontSize="3.5" fontFamily="monospace">
                  <tspan fill="#c084fc">const</tspan>
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}> response = </tspan>
                  <tspan fill="#c084fc">await</tspan>
                </text>
                <text x="0" y="10" fontSize="3.5" fontFamily="monospace">
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}>  fetch(</tspan>
                  <tspan fill="#34d399">'/api/v1/auth'</tspan>
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}>, {'{'}</tspan>
                </text>
                <text x="0" y="18" fontSize="3.5" fontFamily="monospace">
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}>    method: </tspan>
                  <tspan fill="#34d399">'POST'</tspan>
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}>,</tspan>
                </text>
                <text x="0" y="26" fontSize="3.5" fontFamily="monospace">
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}>    headers: {'{'}</tspan>
                </text>
                <text x="0" y="34" fontSize="3.5" fontFamily="monospace">
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}>      </tspan>
                  <tspan fill="#34d399">'X-API-Key'</tspan>
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}>: </tspan>
                  <tspan fill="#fbbf24">key</tspan>
                </text>
                <text x="0" y="42" fontSize="3.5" fontFamily="monospace">
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}>      </tspan>
                  <tspan fill="#34d399">'X-API-Secret'</tspan>
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}>: </tspan>
                  <tspan fill="#fbbf24">sec</tspan>
                </text>
                <text x="0" y="50" fontSize="3.5" fontFamily="monospace">
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}>    {'}'}</tspan>
                </text>
                <text x="0" y="58" fontSize="3.5" fontFamily="monospace">
                  <tspan fill={dark ? '#94a3b8' : '#cbd5e1'}>  {'}'});</tspan>
                </text>
                <text x="0" y="68" fontSize="3.5" fontFamily="monospace">
                  <tspan fill="#64748b">// </tspan>
                  <tspan fill="#64748b" fillOpacity="0.7">{'{ ok: true, total: 12,450 }'}</tspan>
                </text>
                {!reduced && (
                  <rect x="32" y="64" width="1.2" height="4.5" fill="#34d399">
                    <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
                  </rect>
                )}
              </g>
            </g>

            {/* State badge — kichik corner badge, kod ustini yopmaydi */}
            {state === 'processing' && (
              <g transform="translate(148, -103)">
                <circle r="3.5" fill="#0f172a" opacity="0.7" />
                <circle r="2" fill="#818cf8">
                  <animate attributeName="opacity" values="1;0.35;1" dur="0.9s" repeatCount="indefinite" />
                </circle>
              </g>
            )}
            {state === 'success' && (
              <g transform="translate(148, -103)">
                <circle r="4.5" fill="#10b981" opacity="0.25">
                  <animate attributeName="r" values="4.5;7;4.5" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.25;0;0.25" dur="1.4s" repeatCount="indefinite" />
                </circle>
                <circle r="3.5" fill="#10b981" />
                <path d="M -1.6,0 L -0.4,1.3 L 1.8,-1.3" stroke="white" strokeWidth="0.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
            {state === 'error' && (
              <g transform="translate(148, -103)">
                <circle r="3.5" fill="#f43f5e" />
                <line x1="-1.5" y1="-1.5" x2="1.5" y2="1.5" stroke="white" strokeWidth="0.7" strokeLinecap="round" />
                <line x1="1.5" y1="-1.5" x2="-1.5" y2="1.5" stroke="white" strokeWidth="0.7" strokeLinecap="round" />
              </g>
            )}

            {/* Bottom status strip — terminal log overlay (only when active) */}
            {state !== 'idle' && (
              <g transform="translate(0, -14)">
                <rect x="0" y="0" width="160" height="9" fill={dark ? '#1e293b' : '#0f172a'} opacity="0.92" />
                <rect x="0" y="0" width="160" height="9" fill={
                  state === 'success' ? '#10b981' : state === 'error' ? '#f43f5e' : '#818cf8'
                } opacity="0.12" />
                <circle cx="5" cy="4.5" r="1.3" fill={
                  state === 'success' ? '#34d399' : state === 'error' ? '#fb7185' : '#a78bfa'
                }>
                  {state === 'processing' && (
                    <animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite" />
                  )}
                </circle>
                <text x="10" y="6" fontSize="3.5" fontFamily="monospace" fill={
                  state === 'success' ? '#a7f3d0' : state === 'error' ? '#fecaca' : '#c7d2fe'
                }>
                  {state === 'processing' && '→ POST /api/v1/auth'}
                  {state === 'success' && '✓ 200 OK · authenticated'}
                  {state === 'error' && '✗ 401 unauthorized'}
                </text>
              </g>
            )}
          </g>

          {/* ─── CONNECTION LINES with flowing dashes ─── */}
          <line x1="335" y1="305" x2="420" y2="280" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="6,6" strokeLinecap="round" className="flow-line" />
          <line x1="490" y1="280" x2="620" y2="220" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="6,6" strokeLinecap="round" className="flow-line" style={{ animationDelay: '0.15s' }} />
          <line x1="490" y1="280" x2="620" y2="275" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="6,6" strokeLinecap="round" className="flow-line" style={{ animationDelay: '0.3s' }} />
          <line x1="490" y1="280" x2="620" y2="330" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="6,6" strokeLinecap="round" className="flow-line" style={{ animationDelay: '0.45s' }} />
          <line x1="490" y1="280" x2="620" y2="385" stroke="url(#lineGrad)" strokeWidth="1.5" strokeDasharray="6,6" strokeLinecap="round" className="flow-line" style={{ animationDelay: '0.6s' }} />

          {/* Constant subtle ambient packets (always flowing) */}
          {!reduced && (
            <>
              <circle r="2.2" fill="url(#pkIdle)" opacity="0.6">
                <animateMotion dur="3s" repeatCount="indefinite" path="M 335,305 L 420,280" />
              </circle>
              <circle r="2.2" fill="url(#pkIdle)" opacity="0.5">
                <animateMotion dur="2.6s" repeatCount="indefinite" path="M 490,280 L 620,220" begin="0.4s" />
              </circle>
              <circle r="2.2" fill="url(#pkIdle)" opacity="0.5">
                <animateMotion dur="2.6s" repeatCount="indefinite" path="M 490,280 L 620,275" begin="0.9s" />
              </circle>
              <circle r="2.2" fill="url(#pkIdle)" opacity="0.5">
                <animateMotion dur="2.6s" repeatCount="indefinite" path="M 490,280 L 620,330" begin="1.4s" />
              </circle>
              <circle r="2.2" fill="url(#pkIdle)" opacity="0.5">
                <animateMotion dur="2.6s" repeatCount="indefinite" path="M 490,280 L 620,385" begin="1.9s" />
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
          <text x="180" y="475" fontSize="11" fontWeight="700" letterSpacing="2.5" fill={dark ? '#64748b' : '#475569'}>CLIENT</text>
          <text x="675" y="170" fontSize="11" fontWeight="700" letterSpacing="2.5" fill={dark ? '#64748b' : '#475569'}>API GATEWAY</text>

          {/* Subtle technical metadata labels */}
          <text x="180" y="488" fontSize="6.5" fill={dark ? '#475569' : '#94a3b8'} fontFamily="monospace" opacity="0.75">192.168.1.42</text>
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
      <motion.circle r="7" fill={`url(#${gradId})`} initial={{ cx: 335, cy: 305, opacity: 0 }} animate={{ cx: [335, 420], cy: [305, 280], opacity: [0, 1, 0.6] }} transition={{ duration: 0.55, ease: 'easeOut' }} />
      <motion.circle r="7" fill={`url(#${gradId})`} initial={{ cx: 490, cy: 280, opacity: 0 }} animate={{ cx: [490, 620], cy: [280, 220], opacity: [0, 1, 0] }} transition={{ duration: 0.65, ease: 'easeOut', delay: 0.35 }} />
      <motion.circle r="7" fill={`url(#${gradId})`} initial={{ cx: 490, cy: 280, opacity: 0 }} animate={{ cx: [490, 620], cy: [280, 275], opacity: [0, 1, 0] }} transition={{ duration: 0.65, ease: 'easeOut', delay: 0.45 }} />
      <motion.circle r="7" fill={`url(#${gradId})`} initial={{ cx: 490, cy: 280, opacity: 0 }} animate={{ cx: [490, 620], cy: [280, 330], opacity: [0, 1, 0] }} transition={{ duration: 0.65, ease: 'easeOut', delay: 0.55 }} />
      <motion.circle r="7" fill={`url(#${gradId})`} initial={{ cx: 490, cy: 280, opacity: 0 }} animate={{ cx: [490, 620], cy: [280, 385], opacity: [0, 1, 0] }} transition={{ duration: 0.65, ease: 'easeOut', delay: 0.65 }} />
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
