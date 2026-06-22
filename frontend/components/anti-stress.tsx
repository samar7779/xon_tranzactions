'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Type } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Theme {
  key: string;
  name: string;
  bg: [string, string, string];
  dot: string;   // "r,g,b"
  line: string;  // "r,g,b"
  text: string;
  accent: string;
}

const THEMES: Theme[] = [
  { key: 'violet', name: 'Binafsha', bg: ['#2e1065', '#4c1d95', '#6d28d9'], dot: '233,213,255', line: '196,181,253', text: '#f5f3ff', accent: '#a855f7' },
  { key: 'ocean',  name: 'Okean',    bg: ['#082f49', '#0c4a6e', '#0369a1'], dot: '186,230,253', line: '125,211,252', text: '#f0f9ff', accent: '#0ea5e9' },
  { key: 'sunset', name: 'Shafaq',   bg: ['#431407', '#7c2d12', '#b45309'], dot: '254,215,170', line: '253,186,116', text: '#fff7ed', accent: '#f97316' },
  { key: 'forest', name: "O'rmon",   bg: ['#052e16', '#14532d', '#15803d'], dot: '187,247,208', line: '134,239,172', text: '#f0fdf4', accent: '#22c55e' },
  { key: 'rose',   name: 'Atirgul',  bg: ['#4c0519', '#881337', '#be123c'], dot: '254,205,211', line: '253,164,175', text: '#fff1f2', accent: '#fb7185' },
  { key: 'night',  name: 'Tun',      bg: ['#020617', '#0f172a', '#1e293b'], dot: '203,213,225', line: '148,163,184', text: '#f8fafc', accent: '#818cf8' },
];

export function AntiStress({ onClose }: { onClose: () => void }) {
  const [themeKey, setThemeKey] = useState('violet');
  const [text, setText] = useState('Nafas oling');
  const theme = THEMES.find((t) => t.key === themeKey) || THEMES[0];
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Esc — yopish
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Constellation (butun ekran, sichqonchaga ergashadi)
  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let raf = 0;
    const size = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
    size();
    window.addEventListener('resize', size);
    const N = Math.min(120, Math.max(40, Math.floor(window.innerWidth / 16)));
    const P = Array.from({ length: N }, () => ({
      x: Math.random() * c.width, y: Math.random() * c.height,
      vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
    }));
    let mx = -999, my = -999;
    const onMove = (e: MouseEvent) => { mx = e.clientX; my = e.clientY; };
    window.addEventListener('mousemove', onMove);
    const loop = () => {
      const th = themeRef.current;
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of P) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > c.width) p.vx *= -1;
        if (p.y < 0 || p.y > c.height) p.vy *= -1;
        const dx = p.x - mx, dy = p.y - my, d = Math.hypot(dx, dy);
        if (d < 160 && d > 0) { p.x += dx / d * 0.6; p.y += dy / d * 0.6; }
      }
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const a = P[i], b = P[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 140) { ctx.strokeStyle = `rgba(${th.line},${(1 - d / 140) * 0.4})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      ctx.fillStyle = `rgba(${th.dot},.85)`;
      for (const p of P) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill(); }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size); window.removeEventListener('mousemove', onMove); };
  }, []);

  const display = text.trim() || '…';

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden animate-fade-up"
      style={{ background: `linear-gradient(160deg, ${theme.bg[0]}, ${theme.bg[1]} 55%, ${theme.bg[2]})`, transition: 'background .6s ease' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />

      {/* suzuvchi nusxalar (ambient) */}
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="anti-ghost absolute font-black tracking-tight whitespace-nowrap select-none pointer-events-none"
          style={{
            left: `${12 + i * 22}%`,
            color: theme.text,
            opacity: 0.12,
            fontSize: 'clamp(20px,3vw,44px)',
            animationDelay: `${i * 2.4}s`,
          }}
        >
          {display}
        </div>
      ))}

      {/* asosiy matn — nafas oladi */}
      <div className="absolute inset-0 grid place-items-center px-6 pointer-events-none">
        <div
          className="anti-breathe text-center font-black tracking-tight break-words max-w-[92vw]"
          style={{ color: theme.text, fontSize: 'clamp(40px,8vw,120px)', textShadow: `0 0 50px ${theme.accent}cc, 0 0 100px ${theme.accent}55` }}
        >
          {display}
        </div>
      </div>

      {/* sarlavha */}
      <div className="absolute top-5 left-6 flex items-center gap-2 text-white/80 text-sm font-semibold">
        <Sparkles className="h-4 w-4" /> Anti-stress · nafas oling, bo&apos;shashing
      </div>

      {/* yopish */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 z-10 w-11 h-11 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 backdrop-blur text-white transition-colors"
        aria-label="Yopish"
      >
        <X className="h-5 w-5" />
      </button>

      {/* boshqaruv paneli */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[min(560px,92vw)] z-10">
        <div className="rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20 p-4 shadow-2xl">
          {/* matn kiritish */}
          <div className="flex items-center gap-2 h-12 px-4 rounded-xl bg-white/10 border border-white/20 mb-3">
            <Type className="h-4 w-4 text-white/70 shrink-0" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 40))}
              placeholder="Matn yozing — ekranda suzadi…"
              className="flex-1 bg-transparent outline-none text-white placeholder-white/50 text-[15px] font-medium"
              maxLength={40}
            />
          </div>
          {/* ranglar */}
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {THEMES.map((th) => (
              <button
                key={th.key}
                onClick={() => setThemeKey(th.key)}
                title={th.name}
                className={cn(
                  'w-9 h-9 rounded-full transition-all ring-offset-2 ring-offset-transparent',
                  themeKey === th.key ? 'ring-2 ring-white scale-110' : 'ring-1 ring-white/40 hover:scale-105',
                )}
                style={{ background: `linear-gradient(135deg, ${th.bg[1]}, ${th.accent})` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
