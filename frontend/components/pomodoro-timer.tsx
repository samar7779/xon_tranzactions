'use client';

/**
 * Pomodoro Focus Timer — ZAMONAVIY 4 ta dizayn:
 *  - orb (premium pulsing sphere) — default
 *  - liquid (modern water filling glass)
 *  - ring (minimalist clean ring with bold typography)
 *  - display (frosted glass + neon digital)
 *
 * Sound to'g'rilandi: AudioContext ref'ga saqlanadi va birinchi Start
 * bosilganda yaratiladi (autoplay policy uchun).
 */

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  Play, Pause, RotateCcw, Sparkles, Droplets, Circle, Hash,
  Coffee, Brain, Flame, Settings as SettingsIcon, Volume2, VolumeX,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type TimerStyle = 'orb' | 'liquid' | 'ring' | 'display';
type Mode = 'focus' | 'break';

interface SessionStats {
  date: string;
  sessions: number;
  totalSeconds: number;
}

const STYLE_OPTIONS: { value: TimerStyle; label: string; icon: any }[] = [
  { value: 'orb',     label: 'Orb',         icon: Sparkles },
  { value: 'liquid',  label: 'Suyuq',       icon: Droplets },
  { value: 'ring',    label: 'Doira',       icon: Circle   },
  { value: 'display', label: 'Display',     icon: Hash     },
];

function todayKey() { return new Date().toISOString().slice(0, 10); }

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

export function PomodoroTimer() {
  const [style, setStyle] = useState<TimerStyle>('orb');
  const [mode, setMode] = useState<Mode>('focus');
  const [running, setRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [stats, setStats] = useState<SessionStats>({ date: todayKey(), sessions: 0, totalSeconds: 0 });
  const [muted, setMuted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [focusMin, setFocusMin] = useState(25);
  const [breakMin, setBreakMin] = useState(5);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Boot — localStorage'dan
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
          clearInterval(intervalRef.current!);
          handleComplete();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  /** AudioContext ni user-interaction'da yaratamiz (autoplay policy) */
  function ensureAudio() {
    if (typeof window === 'undefined') return null;
    if (!audioCtxRef.current) {
      try {
        const AC = (window.AudioContext || (window as any).webkitAudioContext);
        if (AC) audioCtxRef.current = new AC();
      } catch {}
    }
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }

  function playDone() {
    if (muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        setTimeout(() => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
          osc.connect(gain).connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.7);
        }, i * 110);
      });
    } catch {}
  }

  function playClick() {
    if (muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {}
  }

  function handleComplete() {
    setRunning(false);
    playDone();

    if (mode === 'focus') {
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

  function start() { ensureAudio(); playClick(); setRunning(true); }
  function pause() { playClick(); setRunning(false); }
  function reset() {
    playClick();
    setRunning(false);
    setSecondsLeft(mode === 'focus' ? focusMin * 60 : breakMin * 60);
  }
  function switchMode(m: Mode) {
    playClick();
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
  const progress = totalDuration > 0 ? 1 - secondsLeft / totalDuration : 0;
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const accentGrad = mode === 'focus' ? 'from-amber-500 to-orange-600' : 'from-cyan-500 to-blue-600';
  const totalMin = Math.floor(stats.totalSeconds / 60);
  const totalH = Math.floor(totalMin / 60);
  const totalM = totalMin % 60;
  const totalStr = totalH > 0 ? `${totalH}s ${totalM}d` : `${totalM} daqiqa`;

  return (
    <div className="border-0 shadow-soft overflow-hidden rounded-2xl bg-white dark:bg-slate-900">
      {/* Header */}
      <div className={cn(
        "px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3",
        mode === 'focus' ? 'bg-gradient-to-br from-amber-50 dark:from-amber-950/40 to-orange-50 dark:to-orange-950/40' : 'bg-gradient-to-br from-cyan-50 dark:from-cyan-950/40 to-blue-50 dark:to-blue-950/40',
      )}>
        <div className={cn(
          "w-10 h-10 rounded-xl bg-gradient-to-br grid place-items-center text-white shadow-md",
          accentGrad,
        )}>
          {mode === 'focus' ? <Brain className="h-5 w-5" /> : <Coffee className="h-5 w-5" />}
        </div>
        <div className="flex-1">
          <div className="text-base font-bold text-slate-900 dark:text-slate-100">
            {mode === 'focus' ? 'Fokus rejimi' : 'Dam olish'}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Pomodoro · {mode === 'focus' ? `${focusMin} daqiqa ish` : `${breakMin} daqiqa dam`}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleMute}
            className={cn(
              "w-8 h-8 rounded-lg grid place-items-center transition-colors",
              muted ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500" : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300",
            )}
            title={muted ? "Ovoz o'chirilgan" : "Ovoz yoqilgan"}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              "w-8 h-8 rounded-lg grid place-items-center transition-colors",
              showSettings ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300",
            )}
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1 block">Fokus (daqiqa)</label>
              <input
                type="number"
                value={focusMin}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(120, parseInt(e.target.value) || 25));
                  setFocusMin(v);
                  localStorage.setItem('pomodoro-focus-min', String(v));
                  if (mode === 'focus' && !running) setSecondsLeft(v * 60);
                }}
                className="w-full px-3 h-9 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 text-sm bg-white dark:bg-slate-900"
                min={1} max={120}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1 block">Dam (daqiqa)</label>
              <input
                type="number"
                value={breakMin}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(60, parseInt(e.target.value) || 5));
                  setBreakMin(v);
                  localStorage.setItem('pomodoro-break-min', String(v));
                  if (mode === 'break' && !running) setSecondsLeft(v * 60);
                }}
                className="w-full px-3 h-9 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 text-sm bg-white dark:bg-slate-900"
                min={1} max={60}
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-2 block">Zamonaviy dizayn — har birini ko'rib turing</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {STYLE_OPTIONS.map((opt) => {
                const active = style === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => changeStyle(opt.value)}
                    className={cn(
                      "group relative rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1",
                      active
                        ? "ring-2 ring-indigo-500 shadow-[0_15px_40px_-10px_rgba(99,102,241,0.5)]"
                        : "ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-indigo-300 hover:shadow-lg",
                    )}
                  >
                    {/* Active glow */}
                    {active && (
                      <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 opacity-40 blur-lg -z-10" />
                    )}

                    {/* Top: Mini live preview */}
                    <div className={cn(
                      "h-24 flex items-center justify-center relative overflow-hidden",
                      active
                        ? "bg-gradient-to-br from-amber-50 dark:from-amber-950/40 to-orange-100 dark:to-orange-900/30"
                        : "bg-slate-50 dark:bg-slate-900",
                    )}>
                      <StylePreview style={opt.value} active={active} mode={mode} />
                    </div>

                    {/* Bottom: Label */}
                    <div className={cn(
                      "px-2 py-2.5 text-center transition-colors",
                      active
                        ? "bg-gradient-to-br from-indigo-50 dark:from-indigo-950/40 to-violet-50 dark:to-violet-950/40"
                        : "bg-white dark:bg-slate-900",
                    )}>
                      <div className={cn(
                        "text-[12px] font-bold tracking-tight",
                        active ? "text-indigo-700 dark:text-indigo-300" : "text-slate-700 dark:text-slate-300",
                      )}>
                        {opt.label}
                      </div>
                      {active && (
                        <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-600 text-white text-[8px] uppercase tracking-wider font-bold">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          Tanlangan
                        </div>
                      )}
                    </div>
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
            mode === 'focus' ? 'bg-amber-500 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
          )}
        >
          <Brain className="inline h-3.5 w-3.5 mr-1" /> Fokus
        </button>
        <button
          onClick={() => switchMode('break')}
          className={cn(
            "flex-1 py-2 rounded-lg text-[12px] font-bold transition-all",
            mode === 'break' ? 'bg-cyan-500 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
          )}
        >
          <Coffee className="inline h-3.5 w-3.5 mr-1" /> Dam
        </button>
      </div>

      {/* Visualization */}
      <div className="px-6 py-8 grid place-items-center min-h-[320px]">
        {style === 'orb' && <OrbTimer progress={progress} mode={mode} timeStr={timeStr} running={running} />}
        {style === 'liquid' && <LiquidTimer progress={progress} mode={mode} timeStr={timeStr} running={running} />}
        {style === 'ring' && <MinimalRing progress={progress} mode={mode} timeStr={timeStr} />}
        {style === 'display' && <ModernDisplay timeStr={timeStr} mode={mode} progress={progress} />}
      </div>

      {/* Controls */}
      <div className="px-6 pb-5 flex items-center justify-center gap-2">
        {!running ? (
          <button
            onClick={start}
            className={cn(
              "px-8 h-12 rounded-2xl text-white font-bold shadow-lg transition-all hover:scale-105 active:scale-95 inline-flex items-center gap-2",
              `bg-gradient-to-br ${accentGrad}`,
            )}
            style={{
              boxShadow: mode === 'focus'
                ? '0 10px 30px -10px rgba(245,158,11,0.6)'
                : '0 10px 30px -10px rgba(6,182,212,0.6)',
            }}
          >
            <Play className="h-4 w-4 fill-current" />
            Boshlash
          </button>
        ) : (
          <button
            onClick={pause}
            className="px-8 h-12 rounded-2xl bg-slate-800 text-white font-bold hover:bg-slate-900 transition-all inline-flex items-center gap-2 shadow-lg"
          >
            <Pause className="h-4 w-4 fill-current" />
            To'xtatish
          </button>
        )}
        <button
          onClick={reset}
          className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors grid place-items-center shadow-sm"
          title="Qaytarish"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      {/* Today's stats */}
      <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 grid place-items-center text-white shadow-md">
            <Flame className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">Bugungi sessiya</div>
            <div className="text-lg font-black text-slate-900 dark:text-slate-100 tabular-nums leading-none mt-0.5">{stats.sessions}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-md">
            <Brain className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">Jami fokus</div>
            <div className="text-lg font-black text-slate-900 dark:text-slate-100 tabular-nums leading-none mt-0.5">{totalStr}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════ ORB — premium pulsing sphere ═════════════════════ */

function OrbTimer({ progress, mode, timeStr, running }: { progress: number; mode: Mode; timeStr: string; running: boolean }) {
  const grad1 = mode === 'focus' ? '#fbbf24' : '#22d3ee';
  const grad2 = mode === 'focus' ? '#f97316' : '#3b82f6';
  const glow  = mode === 'focus' ? 'rgba(251,191,36,0.6)' : 'rgba(34,211,238,0.6)';

  return (
    <div className="relative">
      {/* Ambient pulse halos */}
      <div className="absolute inset-0 rounded-full animate-ping" style={{ background: `radial-gradient(circle, ${glow}, transparent 60%)`, animationDuration: '3s' }} />
      <div className="absolute inset-4 rounded-full animate-ping" style={{ background: `radial-gradient(circle, ${glow}, transparent 60%)`, animationDuration: '4s', animationDelay: '1s' }} />

      {/* Main orb */}
      <div className="relative w-64 h-64">
        {/* Outer glow */}
        <div className="absolute inset-0 rounded-full blur-3xl" style={{ background: `radial-gradient(circle, ${glow}, transparent 70%)` }} />

        {/* Sphere */}
        <div
          className={cn("relative w-full h-full rounded-full overflow-hidden", running && "animate-[pulse_3s_ease-in-out_infinite]")}
          style={{
            background: `radial-gradient(circle at 30% 30%, ${grad1}, ${grad2} 70%, ${grad2} 100%)`,
            boxShadow: `inset 0 -20px 40px rgba(0,0,0,0.3), inset 20px 20px 60px rgba(255,255,255,0.4), 0 30px 60px ${glow}`,
          }}
        >
          {/* Inner highlight */}
          <div className="absolute top-6 left-8 w-24 h-24 rounded-full blur-2xl bg-white/40" />

          {/* Progress arc — outer rim */}
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4" />
            <circle
              cx="50" cy="50" r="46"
              fill="none"
              stroke="white"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 46}
              strokeDashoffset={(1 - progress) * 2 * Math.PI * 46}
              className="transition-all duration-1000 ease-linear"
              style={{ filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.8))' }}
            />
          </svg>

          {/* Time display */}
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="text-5xl font-black text-white tabular-nums tracking-tight drop-shadow-lg">{timeStr}</div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/80 font-bold mt-1">
                {Math.round(progress * 100)}%
              </div>
            </div>
          </div>
        </div>

        {/* Orbital satellites — sekin aylanadi */}
        {running && (
          <div className="absolute inset-0 animate-[spin_8s_linear_infinite]">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 w-3 h-3 rounded-full" style={{ background: 'white', boxShadow: `0 0 12px ${glow}` }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ═════════════════════ LIQUID — water filling glass ═════════════════════ */

function LiquidTimer({ progress, mode, timeStr, running }: { progress: number; mode: Mode; timeStr: string; running: boolean }) {
  const grad1 = mode === 'focus' ? '#fbbf24' : '#22d3ee';
  const grad2 = mode === 'focus' ? '#f97316' : '#0ea5e9';
  // Water level — progress oshganda suv pasayadi (qum kabi) yoki ko'tariladi?
  // Pomodoro logika: vaqt o'tgan sari liquid TUGAYDI (yoki to'ladi — visualizatsiya tanlovi)
  // Bizda: tugashga yaqinlashganda suv PASAYADI
  const waterLevel = 1 - progress; // 1 = to'la, 0 = bo'sh

  return (
    <div className="relative">
      {/* Outer glow */}
      <div className="absolute -inset-6 rounded-full blur-3xl opacity-40" style={{ background: `radial-gradient(circle, ${grad1}, transparent)` }} />

      {/* Glass container */}
      <div className="relative w-52 h-72">
        <svg viewBox="0 0 100 140" className="w-full h-full">
          <defs>
            <linearGradient id="liquid-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={grad1} stopOpacity="0.9" />
              <stop offset="100%" stopColor={grad2} stopOpacity="1" />
            </linearGradient>
            <linearGradient id="glass-grad-modern" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.4)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0.1)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.4)" />
            </linearGradient>
            <clipPath id="glass-clip">
              <path d="M 25 10 L 75 10 L 78 130 Q 50 138 22 130 Z" />
            </clipPath>
          </defs>

          {/* Glass body */}
          <path d="M 25 10 L 75 10 L 78 130 Q 50 138 22 130 Z" fill="url(#glass-grad-modern)" stroke="rgba(148,163,184,0.5)" strokeWidth="1.5" />

          {/* WATER (clipped) */}
          <g clipPath="url(#glass-clip)">
            {/* Water body */}
            <rect x="0" y={10 + (1 - waterLevel) * 120} width="100" height="130" fill="url(#liquid-grad)" />

            {/* Wave animations */}
            {running && waterLevel > 0.05 && (
              <>
                <path
                  d={`M 0 ${10 + (1 - waterLevel) * 120} Q 25 ${10 + (1 - waterLevel) * 120 - 3} 50 ${10 + (1 - waterLevel) * 120} T 100 ${10 + (1 - waterLevel) * 120} L 100 130 L 0 130 Z`}
                  fill="url(#liquid-grad)"
                  opacity="0.85"
                >
                  <animate
                    attributeName="d"
                    dur="3s"
                    repeatCount="indefinite"
                    values={`M 0 ${10 + (1 - waterLevel) * 120} Q 25 ${10 + (1 - waterLevel) * 120 - 3} 50 ${10 + (1 - waterLevel) * 120} T 100 ${10 + (1 - waterLevel) * 120} L 100 130 L 0 130 Z;
                             M 0 ${10 + (1 - waterLevel) * 120} Q 25 ${10 + (1 - waterLevel) * 120 + 3} 50 ${10 + (1 - waterLevel) * 120} T 100 ${10 + (1 - waterLevel) * 120} L 100 130 L 0 130 Z;
                             M 0 ${10 + (1 - waterLevel) * 120} Q 25 ${10 + (1 - waterLevel) * 120 - 3} 50 ${10 + (1 - waterLevel) * 120} T 100 ${10 + (1 - waterLevel) * 120} L 100 130 L 0 130 Z`}
                  />
                </path>

                {/* Bubbles */}
                <circle cx="35" cy="100" r="1.5" fill="white" opacity="0.7">
                  <animate attributeName="cy" values="125;30" dur="4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;0.7;0" dur="4s" repeatCount="indefinite" />
                </circle>
                <circle cx="60" cy="80" r="1" fill="white" opacity="0.7">
                  <animate attributeName="cy" values="125;30" dur="5s" begin="1s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;0.7;0" dur="5s" begin="1s" repeatCount="indefinite" />
                </circle>
                <circle cx="45" cy="60" r="1.2" fill="white" opacity="0.7">
                  <animate attributeName="cy" values="125;30" dur="6s" begin="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;0.7;0" dur="6s" begin="2s" repeatCount="indefinite" />
                </circle>
              </>
            )}
          </g>

          {/* Glass shine */}
          <path d="M 30 15 L 35 15 L 38 125 L 33 128 Z" fill="white" opacity="0.3" />
          {/* Rim highlight */}
          <ellipse cx="50" cy="10" rx="25" ry="3" fill="rgba(255,255,255,0.4)" />
        </svg>
      </div>

      {/* Time display — overlay */}
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <div className={cn(
          "px-4 py-2 rounded-2xl backdrop-blur-md bg-white/40 ring-1 ring-white/60 shadow-xl",
          mode === 'focus' ? 'text-amber-700' : 'text-cyan-700',
        )}>
          <div className="text-4xl font-black tabular-nums tracking-tight drop-shadow">{timeStr}</div>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════ MINIMAL RING — clean modern ═════════════════════ */

function MinimalRing({ progress, mode, timeStr }: { progress: number; mode: Mode; timeStr: string }) {
  const RADIUS = 100;
  const CIRC = 2 * Math.PI * RADIUS;
  const dashOffset = CIRC - progress * CIRC;
  const color = mode === 'focus' ? '#f59e0b' : '#06b6d4';
  const colorLight = mode === 'focus' ? '#fcd34d' : '#67e8f9';

  return (
    <div className="relative">
      <svg width="240" height="240" viewBox="0 0 240 240" className="-rotate-90">
        <defs>
          <linearGradient id="minring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colorLight} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
          <filter id="minring-glow">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        {/* Subtle track */}
        <circle cx="120" cy="120" r={RADIUS} fill="none" stroke="rgb(241,245,249)" strokeWidth="8" />
        {/* Glow layer */}
        <circle
          cx="120" cy="120" r={RADIUS}
          fill="none"
          stroke="url(#minring-grad)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashOffset}
          className="transition-all duration-1000 ease-linear"
          filter="url(#minring-glow)"
          opacity="0.6"
        />
        {/* Main stroke */}
        <circle
          cx="120" cy="120" r={RADIUS}
          fill="none"
          stroke="url(#minring-grad)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashOffset}
          className="transition-all duration-1000 ease-linear"
        />
        {/* End dot */}
        <circle
          cx="120" cy="120" r={RADIUS}
          fill="none"
          stroke="transparent"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className={cn(
            "text-6xl font-black tabular-nums tracking-tight",
            mode === 'focus' ? 'text-slate-900 dark:text-slate-100' : 'text-slate-900 dark:text-slate-100',
          )}>
            {timeStr}
          </div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500 mt-2 font-bold">
            {mode === 'focus' ? 'Fokus' : 'Dam olish'}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════ STYLE PREVIEW — har dizayn uchun mini live ═════════════════════ */

function StylePreview({ style, active, mode }: { style: TimerStyle; active: boolean; mode: Mode }) {
  const accent1 = mode === 'focus' ? '#f59e0b' : '#06b6d4';
  const accent2 = mode === 'focus' ? '#f97316' : '#0ea5e9';

  if (style === 'orb') {
    return (
      <div className="relative">
        <div className="absolute inset-0 rounded-full blur-xl opacity-50" style={{ background: accent1 }} />
        <div
          className="relative w-16 h-16 rounded-full grid place-items-center text-white font-black text-[10px] shadow-lg"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${accent1}, ${accent2} 70%, ${accent2})`,
            boxShadow: `inset 0 -4px 8px rgba(0,0,0,0.3), inset 6px 6px 12px rgba(255,255,255,0.4), 0 8px 20px ${accent1}80`,
          }}
        >
          <div className="absolute top-1 left-2 w-5 h-5 rounded-full blur-md bg-white/50" />
          <span className="relative drop-shadow">25:00</span>
        </div>
        {/* Orbit dot */}
        {active && (
          <div className="absolute inset-0 animate-[spin_4s_linear_infinite]">
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-white shadow-md" style={{ boxShadow: `0 0 6px ${accent1}` }} />
          </div>
        )}
      </div>
    );
  }

  if (style === 'liquid') {
    return (
      <svg viewBox="0 0 60 80" width="44" height="58">
        <defs>
          <linearGradient id={`prev-liq-${active ? 'a' : 'i'}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={accent1} stopOpacity="0.9" />
            <stop offset="100%" stopColor={accent2} />
          </linearGradient>
          <clipPath id={`prev-clip-${active ? 'a' : 'i'}`}>
            <path d="M 15 8 L 45 8 L 47 72 Q 30 76 13 72 Z" />
          </clipPath>
        </defs>
        {/* Glass */}
        <path d="M 15 8 L 45 8 L 47 72 Q 30 76 13 72 Z" fill="rgba(148,163,184,0.15)" stroke="rgba(148,163,184,0.6)" strokeWidth="1" />
        {/* Water — 60% to'la */}
        <g clipPath={`url(#prev-clip-${active ? 'a' : 'i'})`}>
          <rect x="0" y="34" width="60" height="50" fill={`url(#prev-liq-${active ? 'a' : 'i'})`} />
          {active && (
            <path d="M 0 34 Q 15 31 30 34 T 60 34 L 60 80 L 0 80 Z" fill={`url(#prev-liq-${active ? 'a' : 'i'})`} opacity="0.7">
              <animate
                attributeName="d"
                dur="2s"
                repeatCount="indefinite"
                values="M 0 34 Q 15 31 30 34 T 60 34 L 60 80 L 0 80 Z;M 0 34 Q 15 37 30 34 T 60 34 L 60 80 L 0 80 Z;M 0 34 Q 15 31 30 34 T 60 34 L 60 80 L 0 80 Z"
              />
            </path>
          )}
        </g>
        {/* Rim */}
        <ellipse cx="30" cy="8" rx="15" ry="2" fill="rgba(255,255,255,0.4)" />
      </svg>
    );
  }

  if (style === 'ring') {
    const R = 18;
    const C = 2 * Math.PI * R;
    return (
      <div className="relative">
        <svg width="60" height="60" viewBox="0 0 60 60" className="-rotate-90">
          <circle cx="30" cy="30" r={R} fill="none" stroke="rgb(226,232,240)" strokeWidth="4" />
          <circle
            cx="30" cy="30" r={R}
            fill="none"
            stroke={accent1}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * 0.4}
            style={{ filter: `drop-shadow(0 0 3px ${accent1})` }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-[9px] font-black tabular-nums text-slate-700 dark:text-slate-300">25:00</span>
        </div>
      </div>
    );
  }

  // display
  return (
    <div
      className="px-3 py-2 rounded-lg"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.95), rgba(248,250,252,0.85))',
        boxShadow: `0 4px 12px ${accent1}40`,
      }}
    >
      <div
        className="text-xl font-black tabular-nums bg-clip-text text-transparent"
        style={{
          backgroundImage: `linear-gradient(135deg, ${accent1}, ${accent2})`,
        }}
      >
        25:00
      </div>
    </div>
  );
}

/* ═════════════════════ MODERN DISPLAY — frosted glass + neon ═════════════════════ */

function ModernDisplay({ timeStr, mode, progress }: { timeStr: string; mode: Mode; progress: number }) {
  const color = mode === 'focus' ? 'rgb(251 191 36)' : 'rgb(34 211 238)';

  return (
    <div className="w-full max-w-md">
      {/* Glass card */}
      <div
        className="relative rounded-3xl p-8 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.95), rgba(248,250,252,0.85))',
          backdropFilter: 'blur(20px)',
          boxShadow: `0 25px 50px -12px rgba(0,0,0,0.15), 0 0 40px ${mode === 'focus' ? 'rgba(251,191,36,0.2)' : 'rgba(34,211,238,0.2)'}`,
          border: '1px solid rgba(255,255,255,0.5)',
        }}
      >
        {/* Background glow */}
        <div
          className="absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl"
          style={{ background: color, opacity: 0.3 }}
        />
        <div
          className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full blur-3xl"
          style={{ background: color, opacity: 0.2 }}
        />

        {/* Mode label */}
        <div className="relative text-center mb-4">
          <span className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.3em] font-bold",
            mode === 'focus' ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700',
          )}>
            {mode === 'focus' ? <Brain className="h-3 w-3" /> : <Coffee className="h-3 w-3" />}
            {mode === 'focus' ? 'Fokus' : 'Dam olish'}
          </span>
        </div>

        {/* Time — large, modern */}
        <div className="relative text-center">
          <div
            className="text-8xl font-black tabular-nums tracking-tight bg-clip-text text-transparent"
            style={{
              backgroundImage: mode === 'focus'
                ? 'linear-gradient(135deg, #f59e0b, #f97316)'
                : 'linear-gradient(135deg, #06b6d4, #3b82f6)',
              filter: `drop-shadow(0 4px 12px ${mode === 'focus' ? 'rgba(245,158,11,0.3)' : 'rgba(6,182,212,0.3)'})`,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {timeStr}
          </div>
        </div>

        {/* Modern progress bar */}
        <div className="relative mt-6">
          <div className="h-2 rounded-full bg-slate-200/60 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-linear"
              style={{
                width: `${progress * 100}%`,
                background: mode === 'focus'
                  ? 'linear-gradient(90deg, #fbbf24, #f97316)'
                  : 'linear-gradient(90deg, #22d3ee, #3b82f6)',
                boxShadow: `0 0 12px ${color}`,
              }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-slate-500">
            <span>{Math.round(progress * 100)}%</span>
            <span>100%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
