'use client';

/**
 * Pomodoro Focus Timer — 4 ta vizual stil bilan:
 *  - hourglass (qumli soat) — animatsiyali qum to'kilishi
 *  - ring (doira) — circular progress
 *  - digital (raqamli) — LED style countdown
 *  - bar (chiziq) — linear progress
 *
 * Foydalanuvchi har sessiya tugaganda hisoblash bo'ladi (localStorage).
 * Bugungi sessiyalar va jami fokus vaqti ko'rsatiladi.
 */

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  Play, Pause, RotateCcw, Hourglass, CircleDot, Hash, BarChart3,
  Coffee, Brain, Flame, Settings as SettingsIcon, Volume2, VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type TimerStyle = 'hourglass' | 'ring' | 'digital' | 'bar';
type Mode = 'focus' | 'break';

interface SessionStats {
  date: string;       // YYYY-MM-DD
  sessions: number;
  totalSeconds: number;
}

const STYLE_OPTIONS: { value: TimerStyle; label: string; icon: any }[] = [
  { value: 'hourglass', label: 'Qumli soat', icon: Hourglass },
  { value: 'ring',      label: 'Doira',      icon: CircleDot  },
  { value: 'digital',   label: 'Raqamli',    icon: Hash       },
  { value: 'bar',       label: 'Chiziq',     icon: BarChart3  },
];

const FOCUS_DURATION = 25 * 60; // 25 min
const BREAK_DURATION = 5 * 60;  // 5 min

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** localStorage'dan bugungi stats o'qish */
function loadStats(): SessionStats {
  if (typeof window === 'undefined') return { date: todayKey(), sessions: 0, totalSeconds: 0 };
  try {
    const raw = localStorage.getItem('pomodoro-stats');
    if (raw) {
      const s = JSON.parse(raw) as SessionStats;
      if (s.date === todayKey()) return s;
    }
  } catch {}
  return { date: todayKey(), sessions: 0, totalSeconds: 0 };
}

function saveStats(s: SessionStats) {
  localStorage.setItem('pomodoro-stats', JSON.stringify(s));
}

/** Yengil beep ovozi — Web Audio bilan */
function playDone() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      }, i * 100);
    });
  } catch {}
}

export function PomodoroTimer() {
  const [style, setStyle] = useState<TimerStyle>('hourglass');
  const [mode, setMode] = useState<Mode>('focus');
  const [running, setRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(FOCUS_DURATION);
  const [stats, setStats] = useState<SessionStats>({ date: todayKey(), sessions: 0, totalSeconds: 0 });
  const [muted, setMuted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [focusMin, setFocusMin] = useState(25);
  const [breakMin, setBreakMin] = useState(5);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Boot: localStorage'dan o'qish
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setStats(loadStats());
    const savedStyle = localStorage.getItem('pomodoro-style') as TimerStyle | null;
    if (savedStyle && STYLE_OPTIONS.some((o) => o.value === savedStyle)) setStyle(savedStyle);
    const savedMuted = localStorage.getItem('pomodoro-muted');
    if (savedMuted === 'true') setMuted(true);
    const savedFocus = parseInt(localStorage.getItem('pomodoro-focus-min') || '25', 10);
    const savedBreak = parseInt(localStorage.getItem('pomodoro-break-min') || '5', 10);
    if (savedFocus > 0) setFocusMin(savedFocus);
    if (savedBreak > 0) setBreakMin(savedBreak);
    setSecondsLeft((savedFocus || 25) * 60);
  }, []);

  // Tick
  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          // Tugadi!
          clearInterval(intervalRef.current!);
          handleComplete();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  function handleComplete() {
    setRunning(false);
    if (!muted) playDone();

    if (mode === 'focus') {
      // Fokus tugadi — stats yangilash + break'ga o'tish
      const newStats: SessionStats = {
        date: todayKey(),
        sessions: stats.sessions + 1,
        totalSeconds: stats.totalSeconds + focusMin * 60,
      };
      setStats(newStats);
      saveStats(newStats);
      toast.success(`🎉 ${focusMin} daqiqa fokus tugadi! Endi ${breakMin} daqiqa dam`, { duration: 5000 });
      setMode('break');
      setSecondsLeft(breakMin * 60);
    } else {
      toast.info(`☕ Dam tugadi — yana ishga!`, { duration: 4000 });
      setMode('focus');
      setSecondsLeft(focusMin * 60);
    }
  }

  function start() { setRunning(true); }
  function pause() { setRunning(false); }
  function reset() {
    setRunning(false);
    setSecondsLeft(mode === 'focus' ? focusMin * 60 : breakMin * 60);
  }
  function switchMode(m: Mode) {
    setMode(m);
    setRunning(false);
    setSecondsLeft(m === 'focus' ? focusMin * 60 : breakMin * 60);
  }
  function changeStyle(s: TimerStyle) {
    setStyle(s);
    localStorage.setItem('pomodoro-style', s);
  }
  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem('pomodoro-muted', String(next));
  }

  const totalDuration = mode === 'focus' ? focusMin * 60 : breakMin * 60;
  const progress = totalDuration > 0 ? 1 - secondsLeft / totalDuration : 0; // 0 to 1
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const accentColor = mode === 'focus' ? 'amber' : 'cyan';
  const accentGrad = mode === 'focus' ? 'from-amber-500 to-orange-600' : 'from-cyan-500 to-blue-600';

  // Bugungi jami fokus vaqti
  const totalMin = Math.floor(stats.totalSeconds / 60);
  const totalH = Math.floor(totalMin / 60);
  const totalM = totalMin % 60;
  const totalStr = totalH > 0 ? `${totalH}s ${totalM}d` : `${totalM} daqiqa`;

  return (
    <div className="border-0 shadow-soft overflow-hidden rounded-2xl bg-white">
      {/* Header */}
      <div className={cn(
        "px-6 py-5 border-b border-slate-100 flex items-center gap-3",
        mode === 'focus' ? 'bg-gradient-to-br from-amber-50 to-orange-50' : 'bg-gradient-to-br from-cyan-50 to-blue-50',
      )}>
        <div className={cn(
          "w-10 h-10 rounded-xl bg-gradient-to-br grid place-items-center text-white shadow-md",
          accentGrad,
        )}>
          {mode === 'focus' ? <Brain className="h-5 w-5" /> : <Coffee className="h-5 w-5" />}
        </div>
        <div className="flex-1">
          <div className="text-base font-bold text-slate-900">
            {mode === 'focus' ? 'Fokus rejimi' : 'Dam olish'}
          </div>
          <div className="text-xs text-slate-500">
            Pomodoro · {mode === 'focus' ? `${focusMin} daqiqa ish` : `${breakMin} daqiqa dam`}
          </div>
        </div>

        {/* Style chooser */}
        <div className="flex items-center gap-1">
          <button
            onClick={toggleMute}
            className={cn(
              "w-8 h-8 rounded-lg grid place-items-center transition-colors",
              muted ? "bg-slate-100 text-slate-400" : "bg-emerald-50 text-emerald-700",
            )}
            title={muted ? 'Ovoz o\'chirilgan' : 'Ovoz yoqilgan'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              "w-8 h-8 rounded-lg grid place-items-center transition-colors",
              showSettings ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500 hover:text-slate-700",
            )}
            title="Sozlamalar"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1 block">Fokus (daqiqa)</label>
              <input
                type="number"
                value={focusMin}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(120, parseInt(e.target.value) || 25));
                  setFocusMin(v);
                  localStorage.setItem('pomodoro-focus-min', String(v));
                  if (mode === 'focus' && !running) setSecondsLeft(v * 60);
                }}
                className="w-full px-3 h-9 rounded-lg ring-1 ring-slate-200 text-sm bg-white"
                min={1}
                max={120}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1 block">Dam (daqiqa)</label>
              <input
                type="number"
                value={breakMin}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(60, parseInt(e.target.value) || 5));
                  setBreakMin(v);
                  localStorage.setItem('pomodoro-break-min', String(v));
                  if (mode === 'break' && !running) setSecondsLeft(v * 60);
                }}
                className="w-full px-3 h-9 rounded-lg ring-1 ring-slate-200 text-sm bg-white"
                min={1}
                max={60}
              />
            </div>
          </div>
          {/* Style chooser */}
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Dizayn</label>
            <div className="grid grid-cols-4 gap-1.5">
              {STYLE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = style === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => changeStyle(opt.value)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2 rounded-lg ring-1 transition-all",
                      active
                        ? "bg-indigo-50 ring-indigo-300 text-indigo-700 shadow-sm"
                        : "bg-white ring-slate-200 text-slate-600 hover:ring-slate-300",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-[10px] font-semibold">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Mode tabs */}
      <div className="px-6 pt-4 flex items-center gap-2">
        <button
          onClick={() => switchMode('focus')}
          className={cn(
            "flex-1 py-2 rounded-lg text-[12px] font-bold transition-all",
            mode === 'focus' ? 'bg-amber-500 text-white shadow-md' : 'bg-slate-100 text-slate-500',
          )}
        >
          <Brain className="inline h-3.5 w-3.5 mr-1" /> Fokus
        </button>
        <button
          onClick={() => switchMode('break')}
          className={cn(
            "flex-1 py-2 rounded-lg text-[12px] font-bold transition-all",
            mode === 'break' ? 'bg-cyan-500 text-white shadow-md' : 'bg-slate-100 text-slate-500',
          )}
        >
          <Coffee className="inline h-3.5 w-3.5 mr-1" /> Dam
        </button>
      </div>

      {/* Visualization */}
      <div className="px-6 py-8 grid place-items-center min-h-[280px]">
        {style === 'hourglass' && <Hourglass3D progress={progress} mode={mode} timeStr={timeStr} running={running} />}
        {style === 'ring' && <RingTimer progress={progress} mode={mode} timeStr={timeStr} />}
        {style === 'digital' && <DigitalTimer timeStr={timeStr} mode={mode} progress={progress} />}
        {style === 'bar' && <BarTimer progress={progress} mode={mode} timeStr={timeStr} />}
      </div>

      {/* Controls */}
      <div className="px-6 pb-5 flex items-center justify-center gap-2">
        {!running ? (
          <button
            onClick={start}
            className={cn(
              "px-6 h-12 rounded-xl text-white font-bold shadow-lg transition-all hover:scale-105 active:scale-95 inline-flex items-center gap-2",
              `bg-gradient-to-br ${accentGrad}`,
            )}
          >
            <Play className="h-4 w-4" />
            Boshlash
          </button>
        ) : (
          <button
            onClick={pause}
            className="px-6 h-12 rounded-xl bg-slate-200 text-slate-700 font-bold hover:bg-slate-300 transition-all inline-flex items-center gap-2"
          >
            <Pause className="h-4 w-4" />
            To'xtatish
          </button>
        )}
        <button
          onClick={reset}
          className="w-12 h-12 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors grid place-items-center"
          title="Qaytarish"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      {/* Today's stats */}
      <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 grid grid-cols-2 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 grid place-items-center text-white shadow-md">
            <Flame className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Bugungi sessiya</div>
            <div className="text-lg font-black text-slate-900 tabular-nums leading-none mt-0.5">{stats.sessions}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-md">
            <Brain className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Jami fokus</div>
            <div className="text-lg font-black text-slate-900 tabular-nums leading-none mt-0.5">{totalStr}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ HOURGLASS — qumli soat ═══════════════════ */

function Hourglass3D({ progress, mode, timeStr, running }: { progress: number; mode: Mode; timeStr: string; running: boolean }) {
  // Qumli soat: top sand decreases, bottom increases
  // progress: 0 = top to'la, 1 = bottom to'la
  const sandColor = mode === 'focus' ? '#f59e0b' : '#06b6d4';
  const sandColorLight = mode === 'focus' ? '#fcd34d' : '#67e8f9';

  // Top sand: starts at y=12 (top), goes to y=48 (middle) as progress increases
  // We represent top sand height: (1-progress) * maxHeight
  const topSandHeight = (1 - progress) * 36; // max 36 units
  const bottomSandHeight = progress * 36;

  return (
    <div className="relative">
      {/* Outer glow */}
      <div className={cn(
        "absolute -inset-4 rounded-full blur-2xl opacity-40",
        mode === 'focus' ? 'bg-amber-400' : 'bg-cyan-400',
      )} />

      <svg viewBox="0 0 100 140" width="180" height="252" className="relative">
        <defs>
          {/* Sand gradient */}
          <linearGradient id="sand-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={sandColorLight} />
            <stop offset="100%" stopColor={sandColor} />
          </linearGradient>
          {/* Glass gradient */}
          <linearGradient id="glass-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(148,163,184,0.1)" />
            <stop offset="50%" stopColor="rgba(148,163,184,0.25)" />
            <stop offset="100%" stopColor="rgba(148,163,184,0.1)" />
          </linearGradient>
          {/* ClipPath — top triangle */}
          <clipPath id="top-clip">
            <path d="M 15 12 L 85 12 L 50 65 Z" />
          </clipPath>
          {/* ClipPath — bottom triangle */}
          <clipPath id="bottom-clip">
            <path d="M 50 75 L 85 128 L 15 128 Z" />
          </clipPath>
        </defs>

        {/* Frame top */}
        <rect x="10" y="8" width="80" height="4" rx="2" fill="#94a3b8" />
        {/* Frame bottom */}
        <rect x="10" y="128" width="80" height="4" rx="2" fill="#94a3b8" />

        {/* Glass body */}
        <path d="M 15 12 L 85 12 L 50 65 L 85 128 L 15 128 L 50 75 Z" fill="url(#glass-grad)" stroke="#cbd5e1" strokeWidth="1.5" />

        {/* TOP SAND — clipped triangle, height decreases */}
        <g clipPath="url(#top-clip)">
          <rect x="10" y={12 + (36 - topSandHeight)} width="80" height={topSandHeight} fill="url(#sand-grad)" />
        </g>

        {/* BOTTOM SAND — clipped triangle, height increases from bottom */}
        <g clipPath="url(#bottom-clip)">
          <rect x="10" y={128 - bottomSandHeight} width="80" height={bottomSandHeight} fill="url(#sand-grad)" />
        </g>

        {/* Sand falling stream (faqat running bo'lganda) */}
        {running && progress > 0 && progress < 1 && (
          <>
            <rect x="49" y="65" width="2" height="10" fill={sandColor} opacity="0.9">
              <animate attributeName="opacity" values="0.4;1;0.4" dur="0.4s" repeatCount="indefinite" />
            </rect>
            {/* Particles */}
            <circle cx="50" cy="68" r="1" fill={sandColorLight}>
              <animate attributeName="cy" values="65;75" dur="0.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;0" dur="0.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="50" cy="70" r="0.8" fill={sandColor}>
              <animate attributeName="cy" values="65;75" dur="0.5s" begin="0.25s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;0" dur="0.5s" begin="0.25s" repeatCount="indefinite" />
            </circle>
          </>
        )}

        {/* Center pinch (decorative) */}
        <circle cx="50" cy="70" r="2" fill="#94a3b8" />
      </svg>

      {/* Time display — ostida */}
      <div className="text-center mt-3">
        <div className={cn(
          "text-4xl font-black tabular-nums tracking-tight",
          mode === 'focus' ? 'text-amber-600' : 'text-cyan-600',
        )}>
          {timeStr}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ RING — doira ═══════════════════ */

function RingTimer({ progress, mode, timeStr }: { progress: number; mode: Mode; timeStr: string }) {
  const RADIUS = 90;
  const CIRC = 2 * Math.PI * RADIUS;
  const dashOffset = CIRC - progress * CIRC;
  const color = mode === 'focus' ? '#f59e0b' : '#06b6d4';
  const colorLight = mode === 'focus' ? '#fcd34d' : '#67e8f9';

  return (
    <div className="relative">
      <svg width="220" height="220" viewBox="0 0 220 220" className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colorLight} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx="110" cy="110" r={RADIUS} fill="none" stroke="rgb(226,232,240)" strokeWidth="14" />
        <circle
          cx="110" cy="110" r={RADIUS}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashOffset}
          className="transition-all duration-1000 ease-linear"
          style={{ filter: `drop-shadow(0 0 8px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className={cn(
            "text-5xl font-black tabular-nums tracking-tight",
            mode === 'focus' ? 'text-amber-600' : 'text-cyan-600',
          )}>
            {timeStr}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-1 font-bold">
            {Math.round(progress * 100)}% bajarildi
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ DIGITAL — raqamli LED ═══════════════════ */

function DigitalTimer({ timeStr, mode, progress }: { timeStr: string; mode: Mode; progress: number }) {
  return (
    <div className="text-center">
      {/* LED display */}
      <div className={cn(
        "px-8 py-6 rounded-2xl bg-slate-900 ring-4 ring-slate-800 shadow-2xl",
        mode === 'focus' ? 'shadow-amber-500/30' : 'shadow-cyan-500/30',
      )}>
        <div className={cn(
          "text-7xl font-black tabular-nums tracking-tight font-mono",
          mode === 'focus' ? 'text-amber-400' : 'text-cyan-400',
        )} style={{
          textShadow: mode === 'focus'
            ? '0 0 20px rgba(251,191,36,0.8), 0 0 40px rgba(251,191,36,0.4)'
            : '0 0 20px rgba(34,211,238,0.8), 0 0 40px rgba(34,211,238,0.4)',
        }}>
          {timeStr}
        </div>
      </div>
      {/* Mini progress */}
      <div className="mt-4 px-4">
        <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-1000 ease-linear",
              mode === 'focus' ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-cyan-400 to-blue-500',
            )}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mt-2">
          {Math.round(progress * 100)}% bajarildi
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ BAR — chiziq ═══════════════════ */

function BarTimer({ progress, mode, timeStr }: { progress: number; mode: Mode; timeStr: string }) {
  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-6">
        <div className={cn(
          "text-6xl font-black tabular-nums tracking-tight",
          mode === 'focus' ? 'text-amber-600' : 'text-cyan-600',
        )}>
          {timeStr}
        </div>
      </div>

      {/* Big bar */}
      <div className="relative h-12 rounded-2xl bg-slate-100 overflow-hidden ring-1 ring-slate-200">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-2xl transition-all duration-1000 ease-linear bg-gradient-to-r",
            mode === 'focus' ? 'from-amber-400 to-orange-500' : 'from-cyan-400 to-blue-500',
          )}
          style={{ width: `${progress * 100}%`, boxShadow: `0 0 20px ${mode === 'focus' ? 'rgba(251,191,36,0.5)' : 'rgba(34,211,238,0.5)'}` }}
        />
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-sm font-bold text-slate-800 mix-blend-difference">
            {Math.round(progress * 100)}%
          </span>
        </div>
      </div>

      {/* Tick marks */}
      <div className="mt-2 flex justify-between text-[9px] text-slate-400 font-mono">
        {[0, 25, 50, 75, 100].map((p) => (
          <span key={p} className={cn(progress * 100 >= p && (mode === 'focus' ? 'text-amber-600 font-bold' : 'text-cyan-600 font-bold'))}>
            {p}%
          </span>
        ))}
      </div>
    </div>
  );
}
