'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BrandLogo } from './brand-logo';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const hydrate = useAuth((s) => s.hydrate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) {
      router.replace(`/${locale}/login`);
      return;
    }
    if (!user) {
      hydrate().finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, [token, user, hydrate, router, locale]);

  if (!ready) {
    return <SplashLoader />;
  }
  return <>{children}</>;
}

function SplashLoader() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 overflow-hidden">
      {/* ─── Gradient mesh background ─── */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-1/3 -left-1/4 w-[60rem] h-[60rem] rounded-full splash-blob-1" />
        <div className="absolute -bottom-1/3 -right-1/4 w-[60rem] h-[60rem] rounded-full splash-blob-2" />
        <div className="absolute top-1/3 right-1/4 w-[40rem] h-[40rem] rounded-full splash-blob-3" />
      </div>

      {/* ─── Subtle grid overlay ─── */}
      <div
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
          maskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, #000 30%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, #000 30%, transparent 80%)',
        }}
      />

      {/* ─── Orbiting particles ─── */}
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <div className="relative w-[400px] h-[400px]">
          <div className="absolute inset-0 rounded-full border border-indigo-400/10 splash-rotate-cw" />
          <div className="absolute inset-8 rounded-full border border-cyan-400/10 splash-rotate-ccw" />
          {/* particles */}
          {[0, 60, 120, 180, 240, 300].map((deg, i) => (
            <div
              key={i}
              className="absolute top-1/2 left-1/2 w-1.5 h-1.5 rounded-full splash-rotate-cw"
              style={{
                animation: `splash-rotate-cw ${8 + i}s linear infinite`,
                transform: `rotate(${deg}deg) translateX(190px) translateY(-50%)`,
                background: i % 2 === 0 ? '#6366f1' : '#06b6d4',
                boxShadow: i % 2 === 0 ? '0 0 12px rgba(99,102,241,0.8)' : '0 0 12px rgba(6,182,212,0.8)',
              }}
            />
          ))}
        </div>
      </div>

      {/* ─── Main content ─── */}
      <div className="relative flex flex-col items-center gap-7 animate-splash-in">

        {/* Logo with concentric rings */}
        <div className="relative w-32 h-32 grid place-items-center">
          {/* Pulsing rings — outwards */}
          <span className="absolute inset-0 rounded-full border border-indigo-400/40 splash-ping" style={{ animationDelay: '0s' }} />
          <span className="absolute inset-0 rounded-full border border-indigo-400/30 splash-ping" style={{ animationDelay: '0.7s' }} />
          <span className="absolute inset-0 rounded-full border border-indigo-400/20 splash-ping" style={{ animationDelay: '1.4s' }} />

          {/* Glow behind */}
          <span className="absolute w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 blur-2xl opacity-60 animate-pulse" />

          {/* Logo box */}
          <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-500 grid place-items-center shadow-2xl shadow-indigo-500/50 ring-1 ring-white/20">
            <BrandLogo className="w-11 h-11" />
            {/* shine */}
            <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
              <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/30 to-white/0 splash-shine" />
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="text-center space-y-1">
          <div className="text-xl font-bold tracking-tight text-white">Xon Tranzaksiyalar</div>
          <div className="text-[11px] uppercase tracking-[0.3em] text-slate-400 font-medium">
            Treasury System
          </div>
        </div>

        {/* Loading bar */}
        <div className="w-48 space-y-2">
          <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500 rounded-full splash-progress" />
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-indigo-400 splash-dot" style={{ animationDelay: '0ms' }} />
            <span className="w-1 h-1 rounded-full bg-blue-400 splash-dot" style={{ animationDelay: '200ms' }} />
            <span className="w-1 h-1 rounded-full bg-cyan-400 splash-dot" style={{ animationDelay: '400ms' }} />
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-medium ml-2">
              Yuklanmoqda
            </span>
          </div>
        </div>

      </div>

      <style jsx>{`
        :global(.splash-blob-1) {
          background: radial-gradient(circle, rgba(99, 102, 241, 0.5), transparent 60%);
          filter: blur(80px);
          animation: splash-blob-1 18s ease-in-out infinite;
        }
        :global(.splash-blob-2) {
          background: radial-gradient(circle, rgba(6, 182, 212, 0.45), transparent 60%);
          filter: blur(80px);
          animation: splash-blob-2 22s ease-in-out infinite;
        }
        :global(.splash-blob-3) {
          background: radial-gradient(circle, rgba(168, 85, 247, 0.3), transparent 60%);
          filter: blur(80px);
          animation: splash-blob-1 26s ease-in-out infinite reverse;
        }

        @keyframes splash-blob-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(60px, 40px) scale(1.15); }
          66%      { transform: translate(-40px, 30px) scale(0.9); }
        }
        @keyframes splash-blob-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(-70px, -30px) scale(1.1); }
          66%      { transform: translate(50px, -50px) scale(0.95); }
        }

        @keyframes splash-rotate-cw  { from { transform: rotate(0deg); }   to { transform: rotate(360deg); } }
        @keyframes splash-rotate-ccw { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        :global(.splash-rotate-cw)  { animation: splash-rotate-cw 30s linear infinite; }
        :global(.splash-rotate-ccw) { animation: splash-rotate-ccw 24s linear infinite; }

        @keyframes splash-ping {
          0%   { transform: scale(1);   opacity: 0.85; }
          80%  { transform: scale(1.7); opacity: 0; }
          100% { transform: scale(1.7); opacity: 0; }
        }
        :global(.splash-ping) {
          animation: splash-ping 2.1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        @keyframes splash-shine {
          0%   { transform: translateX(-120%) translateY(-120%) rotate(35deg); }
          100% { transform: translateX(120%)  translateY(120%)  rotate(35deg); }
        }
        :global(.splash-shine) {
          animation: splash-shine 3.5s ease-in-out infinite;
        }

        @keyframes splash-progress {
          0%   { transform: translateX(-100%); width: 30%; }
          50%  { transform: translateX(150%); width: 50%; }
          100% { transform: translateX(400%); width: 30%; }
        }
        :global(.splash-progress) {
          animation: splash-progress 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite;
        }

        @keyframes splash-dot {
          0%, 100% { opacity: 0.3; transform: scale(0.9); }
          50%      { opacity: 1;   transform: scale(1.3); }
        }
        :global(.splash-dot) {
          animation: splash-dot 1.2s ease-in-out infinite;
        }

        @keyframes splash-in {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        :global(.animate-splash-in) {
          animation: splash-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
      `}</style>
    </div>
  );
}
