'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Type, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Theme {
  key: string;
  name: string;
  bg: [string, string, string];
  dot: string;   // "r,g,b"
  line: string;  // "r,g,b"
  accent: string;
}

const THEMES: Theme[] = [
  { key: 'violet', name: 'Binafsha', bg: ['#2e1065', '#4c1d95', '#6d28d9'], dot: '233,213,255', line: '196,181,253', accent: '#a855f7' },
  { key: 'ocean',  name: 'Okean',    bg: ['#082f49', '#0c4a6e', '#0369a1'], dot: '186,230,253', line: '125,211,252', accent: '#0ea5e9' },
  { key: 'sunset', name: 'Shafaq',   bg: ['#431407', '#7c2d12', '#b45309'], dot: '254,215,170', line: '253,186,116', accent: '#f97316' },
  { key: 'forest', name: "O'rmon",   bg: ['#052e16', '#14532d', '#15803d'], dot: '187,247,208', line: '134,239,172', accent: '#22c55e' },
  { key: 'rose',   name: 'Atirgul',  bg: ['#4c0519', '#881337', '#be123c'], dot: '254,205,211', line: '253,164,175', accent: '#fb7185' },
  { key: 'night',  name: 'Tun',      bg: ['#020617', '#0f172a', '#1e293b'], dot: '203,213,225', line: '148,163,184', accent: '#818cf8' },
];

const AMBIENT = 130;
const MAX = 820;

export function AntiStress({ onClose }: { onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [themeKey, setThemeKey] = useState('violet');
  const [text, setText] = useState('');
  const [showControls, setShowControls] = useState(false);

  const theme = THEMES.find((t) => t.key === themeKey) || THEMES[0];
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const textRef = useRef(text);
  textRef.current = text;

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => setMounted(true), []);

  // Esc bilan yopish + chiqishda fullscreen'dan chiqish
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onClose]);

  // Zarra tizimi — portal (canvas) render bo'lgach ishga tushadi
  useEffect(() => {
    if (!mounted) return;
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const off = document.createElement('canvas');
    const octx = off.getContext('2d', { willReadFrequently: true })!;
    let raf = 0;

    const size = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
    size();
    window.addEventListener('resize', size);

    type P = { x: number; y: number; vx: number; vy: number; tx: number | null; ty: number | null };
    const rnd = () => ({ x: Math.random() * c.width, y: Math.random() * c.height, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, tx: null, ty: null } as P);
    let P: P[] = Array.from({ length: AMBIENT }, rnd);
    let builtFor: string | null = null;

    const resize = (n: number) => {
      if (n > P.length) for (let i = P.length; i < n; i++) P.push(rnd());
      else if (n < P.length) P.length = n;
    };

    const computeTargets = (txt: string): { x: number; y: number }[] => {
      if (!txt) return [];
      const W = c.width, H = c.height;
      off.width = W; off.height = H;
      octx.clearRect(0, 0, W, H);
      octx.fillStyle = '#fff';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      let fs = Math.min(H * 0.34, (W * 0.88) / Math.max(1, txt.length * 0.58));
      fs = Math.max(46, fs);
      octx.font = `900 ${fs}px Inter, system-ui, sans-serif`;
      octx.fillText(txt, W / 2, H / 2);
      const d = octx.getImageData(0, 0, W, H).data;
      const pts: { x: number; y: number }[] = [];
      const step = 5;
      for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
        if (d[(y * W + x) * 4 + 3] > 128) pts.push({ x, y });
      }
      if (pts.length > MAX) {
        const k = Math.ceil(pts.length / MAX);
        const s: { x: number; y: number }[] = [];
        for (let i = 0; i < pts.length; i += k) s.push(pts[i]);
        return s;
      }
      return pts;
    };

    let mx = -999, my = -999;
    const onMove = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; };
    const onLeave = () => { mx = -999; my = -999; };
    // ustiga bosilsa — sochilib ketadi
    const onDown = (e: PointerEvent) => {
      const cx = e.clientX, cy = e.clientY;
      for (const p of P) {
        const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1;
        const f = 22 * (1 - Math.min(1, d / 700));
        p.vx += (dx / d) * f + (Math.random() - 0.5) * 8;
        p.vy += (dy / d) * f + (Math.random() - 0.5) * 8;
      }
    };
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('pointerdown', onDown);

    const loop = () => {
      const th = themeRef.current;
      // matn o'zgarsa — qayta yig'amiz
      if (textRef.current !== builtFor) {
        builtFor = textRef.current;
        const targets = computeTargets(builtFor || '');
        if (targets.length) {
          resize(targets.length);
          for (let i = 0; i < P.length; i++) { P[i].tx = targets[i].x; P[i].ty = targets[i].y; }
        } else {
          resize(AMBIENT);
          for (const p of P) { p.tx = null; p.ty = null; }
        }
      }
      const textMode = !!builtFor && P.length > 0 && P[0].tx != null;

      for (const p of P) {
        if (p.tx != null && p.ty != null) {
          p.vx += (p.tx - p.x) * 0.012;
          p.vy += (p.ty - p.y) * 0.012;
          p.vx *= 0.88; p.vy *= 0.88;
        } else {
          if (p.x < 0 || p.x > c.width) p.vx *= -1;
          if (p.y < 0 || p.y > c.height) p.vy *= -1;
        }
        const dx = p.x - mx, dy = p.y - my, d = Math.hypot(dx, dy);
        if (d < 130 && d > 0) { const f = (1 - d / 130) * 2.4; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
        p.x += p.vx; p.y += p.vy;
      }

      ctx.clearRect(0, 0, c.width, c.height);
      if (textMode) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${th.dot},.16)`;
        for (const p of P) { ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fill(); }
        ctx.fillStyle = `rgba(${th.dot},.95)`;
        for (const p of P) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.9, 0, 7); ctx.fill(); }
        ctx.globalCompositeOperation = 'source-over';
      } else {
        for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
          const a = P[i], b = P[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 145) { ctx.strokeStyle = `rgba(${th.line},${(1 - d / 145) * 0.4})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
        ctx.fillStyle = `rgba(${th.dot},.85)`;
        for (const p of P) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill(); }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerleave', onLeave);
      c.removeEventListener('pointerdown', onDown);
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[200] overflow-hidden animate-gradient"
      style={{ backgroundImage: `linear-gradient(160deg, ${theme.bg[0]}, ${theme.bg[1]} 55%, ${theme.bg[2]})`, transition: 'background-image .6s ease' }}
    >
      {/* depth orbs */}
      <div className="absolute -top-32 -left-24 w-96 h-96 rounded-full blur-3xl opacity-40 animate-float-slow pointer-events-none" style={{ background: theme.accent }} />
      <div className="absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-30 animate-float-slow pointer-events-none" style={{ background: theme.accent }} />
      {/* vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,.45) 100%)' }} />

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />

      {/* sarlavha */}
      <div className="absolute top-5 left-6 flex items-center gap-2 text-white/80 text-sm font-semibold pointer-events-none z-10">
        <Sparkles className="h-4 w-4" /> Anti-stress · nafas oling, bo&apos;shashing
      </div>

      {/* yopish */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 z-20 w-11 h-11 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 backdrop-blur text-white transition-colors"
        aria-label="Yopish"
      >
        <X className="h-5 w-5" />
      </button>

      {/* boshqaruvni ochish tugmasi */}
      {!showControls && (
        <button
          onClick={() => setShowControls(true)}
          className="absolute bottom-7 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 h-11 px-5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/20 text-white text-sm font-semibold transition-colors"
        >
          <SlidersHorizontal className="h-4 w-4" /> Sozlash
        </button>
      )}

      {/* boshqaruv paneli (yashirin — tugma bilan ochiladi) */}
      {showControls && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[min(560px,92vw)] z-20 animate-fade-up">
          <div className="rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20 p-4 shadow-2xl relative">
            <button
              onClick={() => setShowControls(false)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full grid place-items-center bg-white/15 hover:bg-white/25 backdrop-blur text-white"
              aria-label="Yopish"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 h-12 px-4 rounded-xl bg-white/10 border border-white/20 mb-3">
              <Type className="h-4 w-4 text-white/70 shrink-0" />
              <input
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 28))}
                placeholder="Matn yozing — zarralardan yig'iladi…"
                className="flex-1 bg-transparent outline-none text-white placeholder-white/50 text-[15px] font-medium"
                maxLength={28}
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {THEMES.map((th) => (
                <button
                  key={th.key}
                  onClick={() => setThemeKey(th.key)}
                  title={th.name}
                  className={cn(
                    'w-9 h-9 rounded-full transition-all',
                    themeKey === th.key ? 'ring-2 ring-white scale-110' : 'ring-1 ring-white/40 hover:scale-105',
                  )}
                  style={{ background: `linear-gradient(135deg, ${th.bg[1]}, ${th.accent})` }}
                />
              ))}
            </div>
            <div className="text-center text-[11px] text-white/55 mt-3">Ekranga bosing — zarralar sochilib ketadi ✨</div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
