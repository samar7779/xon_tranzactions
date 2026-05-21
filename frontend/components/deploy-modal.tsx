'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import {
  Sparkles, RefreshCw, X, Loader2, AlertCircle, Rocket, CheckCircle2, Activity, Zap,
} from 'lucide-react';
import { api } from '@/lib/api';

interface DeployStatus {
  ok: boolean;
  state: 'idle' | 'running' | 'success' | 'failed';
  currentCommit?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  message?: string | null;
  error?: string | null;
  currentPhase?: string | null;
  completedPhases?: string[];
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number | null;
  progressPercent?: number | null;
}

export function DeployModal() {
  const t = useTranslations('deploy');
  const tp = useTranslations('deploy.phases');
  const [mounted, setMounted] = useState(false);
  const initialCommitRef = useRef<string | null>(null);
  const [dismissedNewVersion, setDismissedNewVersion] = useState<string | null>(null);
  const [dismissedFailed, setDismissedFailed] = useState<string | null>(null);
  const [showRunning, setShowRunning] = useState(true);

  useEffect(() => { setMounted(true); }, []);

  const { data } = useQuery<DeployStatus>({
    queryKey: ['deploy-status'],
    queryFn: () => api.get<DeployStatus>('/_deploy/status'),
    refetchInterval: 3_000,
  });

  useEffect(() => {
    if (!data?.currentCommit) return;
    if (initialCommitRef.current === null) {
      initialCommitRef.current = data.currentCommit;
    }
  }, [data?.currentCommit]);

  useEffect(() => {
    if (data?.state === 'running') setShowRunning(true);
  }, [data?.state]);

  if (!mounted || !data) return null;

  const isNewVersion =
    data.state === 'success' &&
    data.currentCommit &&
    initialCommitRef.current &&
    initialCommitRef.current !== data.currentCommit &&
    dismissedNewVersion !== data.currentCommit;

  const isFailed =
    data.state === 'failed' &&
    data.startedAt &&
    dismissedFailed !== data.startedAt;

  const isRunning = data.state === 'running' && showRunning;

  if (!isNewVersion && !isFailed && !isRunning) return null;

  // Aqlli faza tarjimasi: avval to'liq mos kelishi, keyin qisqaroq prefiks
  const phaseLabel = (raw: string | null | undefined): string => {
    if (!raw) return '';
    const tryLookup = (key: string): string | null => {
      try {
        const result = tp(key as any);
        if (result && typeof result === 'string' && !result.startsWith('deploy.phases')) {
          return result;
        }
      } catch { /* missing key */ }
      return null;
    };
    const exact = tryLookup(raw);
    if (exact) return exact;
    const parts = raw.split(/\s+/);
    for (let i = parts.length - 1; i >= 1; i--) {
      const prefix = parts.slice(0, i).join(' ');
      const found = tryLookup(prefix);
      if (found) return found;
    }
    return raw;
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] grid place-items-center p-4 animate-fade-in"
      style={{ background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(10px)' }}
    >
      {/* ═══════════════ RUNNING — KATTA, 2 USTUN ═══════════════ */}
      {isRunning && (
        <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-scale-in">
          {/* HERO header — animatsion fon */}
          <div className="relative h-44 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 overflow-hidden">
            <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-white/10 blur-3xl animate-pulse" />
            <div
              className="absolute -bottom-16 -left-16 w-60 h-60 rounded-full bg-amber-400/20 blur-2xl animate-pulse"
              style={{ animationDelay: '1s' }}
            />
            <div className="absolute top-8 left-1/3 w-40 h-40 rounded-full bg-cyan-300/15 blur-2xl" />
            <div
              className="absolute inset-0 opacity-[0.12]"
              style={{
                backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            />

            <div className="relative h-full flex items-center justify-between px-6 sm:px-8">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-lg shadow-emerald-400/60" />
                  <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/90">
                    {t('live')}
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {t('deploying')}
                </h2>
                <p className="text-[12px] sm:text-[13px] text-white/80 mt-1 max-w-md">
                  {t('deployingDesc')}
                </p>
              </div>
              <div className="hidden sm:grid w-24 h-24 rounded-3xl bg-white/15 backdrop-blur-md place-items-center ring-1 ring-white/30 shadow-2xl animate-float shrink-0">
                <Rocket className="h-12 w-12 text-white animate-bounce" />
              </div>
            </div>

            <button
              onClick={() => setShowRunning(false)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center text-white transition-all hover:scale-110"
              aria-label="Yopish"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* TANA — 2 ustun (lg+), mobile'da bitta ustun */}
          <div className="grid lg:grid-cols-[1.25fr_1fr] gap-6 p-6 sm:p-7">
            {/* ── CHAP: statistika + progress + joriy faza ── */}
            <div className="space-y-5">
              {/* 3 ta statistika kartochkasi */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 ring-1 ring-slate-200 p-3.5">
                  <div className="text-[9px] uppercase tracking-wider font-bold text-slate-500 mb-1">
                    {t('elapsed')}
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-slate-900 tabular-nums leading-none">
                    {data.elapsedSeconds ?? 0}
                    <span className="text-sm font-bold text-slate-400 ml-0.5">{t('second')}</span>
                  </div>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 ring-1 ring-indigo-200 p-3.5">
                  <div className="text-[9px] uppercase tracking-wider font-bold text-indigo-600 mb-1">
                    {t('remaining')}
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-indigo-700 tabular-nums leading-none">
                    {data.estimatedRemainingSeconds !== null && data.estimatedRemainingSeconds !== undefined
                      ? `~${data.estimatedRemainingSeconds}`
                      : '?'}
                    <span className="text-sm font-bold text-indigo-400 ml-0.5">{t('second')}</span>
                  </div>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 ring-1 ring-emerald-200 p-3.5">
                  <div className="text-[9px] uppercase tracking-wider font-bold text-emerald-600 mb-1 flex items-center gap-1">
                    <Zap className="h-2.5 w-2.5" /> Progress
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-emerald-700 tabular-nums leading-none">
                    {data.progressPercent ?? 0}
                    <span className="text-sm font-bold text-emerald-400 ml-0.5">%</span>
                  </div>
                </div>
              </div>

              {/* Katta progress bar */}
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden ring-1 ring-slate-200/60">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 transition-all duration-1000 ease-out relative"
                  style={{ width: `${data.progressPercent ?? 1}%` }}
                >
                  <div className="absolute inset-0 bg-white/30 animate-shimmer" />
                </div>
              </div>

              {/* Joriy faza — gradient ramkali */}
              {data.currentPhase && (
                <div className="rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-[1.5px] shadow-lg shadow-indigo-500/20">
                  <div className="rounded-2xl bg-white p-4 sm:p-5 flex items-center gap-4">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center shrink-0 shadow-lg shadow-indigo-500/30">
                      <Loader2 className="h-6 w-6 sm:h-7 sm:w-7 text-white animate-spin" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] uppercase tracking-widest font-bold text-indigo-600">
                        {t('phase')}
                      </div>
                      <div className="text-base sm:text-lg font-bold text-slate-900 mt-0.5 leading-tight">
                        {phaseLabel(data.currentPhase)}
                      </div>
                    </div>
                    <Activity className="h-5 w-5 text-indigo-400 animate-pulse hidden sm:block" />
                  </div>
                </div>
              )}
            </div>

            {/* ── O'NG: bajarilgan ro'yxat ── */}
            <div className="lg:border-l lg:border-slate-100 lg:pl-6 flex flex-col min-h-0">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 grid place-items-center">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </div>
                <h3 className="text-[13px] font-bold text-slate-700">
                  {t('completedTitle')}
                  {data.completedPhases && data.completedPhases.length > 0 && (
                    <span className="text-slate-400 font-medium ml-1">
                      · {data.completedPhases.length}
                    </span>
                  )}
                </h3>
              </div>
              <div className="space-y-1.5 max-h-72 lg:max-h-80 overflow-y-auto pr-1 -mr-1">
                {(!data.completedPhases || data.completedPhases.length === 0) ? (
                  <div className="text-[12px] text-slate-400 italic py-4 text-center">
                    {t('waiting')}
                  </div>
                ) : (
                  data.completedPhases.map((ph, i) => (
                    <div
                      key={`${i}-${ph}`}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-emerald-50/50 hover:bg-emerald-50 transition-colors animate-slide-in"
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span className="text-[12.5px] text-slate-700 font-medium truncate flex-1">
                        {phaseLabel(ph)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ NEW VERSION — KATTA, BIRINCHI EKRANNI MAFTUN QILUVCHI ═══════════════ */}
      {isNewVersion && (
        <div className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-scale-in">
          <div className="relative h-44 bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 overflow-hidden">
            <div
              className="absolute inset-0 opacity-[0.15]"
              style={{
                backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}
            />
            <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/15 blur-3xl animate-pulse" />
            <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full bg-yellow-300/20 blur-2xl" />

            <div className="relative h-full grid place-items-center">
              <div className="w-24 h-24 rounded-3xl bg-white/25 backdrop-blur-md grid place-items-center ring-2 ring-white/40 shadow-2xl animate-float">
                <Sparkles className="h-12 w-12 text-white drop-shadow-lg" />
              </div>
            </div>
            <button
              onClick={() => setDismissedNewVersion(data.currentCommit || null)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center text-white transition-all hover:scale-110"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-7 sm:p-8 space-y-5">
            <div className="text-center">
              <h2 className="text-2xl sm:text-3xl font-black text-slate-900 mb-2">
                {t('newVersionTitle')}
              </h2>
              <p className="text-[14px] text-slate-600 leading-relaxed max-w-sm mx-auto">
                {t('newVersionDesc')}
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 font-mono">
              <span>{t('newVersionCommit')}:</span>
              <code className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold">
                {data.currentCommit}
              </code>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-1">
              <button
                onClick={() => setDismissedNewVersion(data.currentCommit || null)}
                className="flex-1 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
              >
                {t('newVersionLater')}
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold text-sm shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                {t('newVersionBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ FAILED — KATTAROQ, TUSHUNARLI ═══════════════ */}
      {isFailed && (
        <div className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-scale-in">
          <div className="relative h-36 bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full bg-amber-300/20 blur-2xl" />
            <div className="relative h-full grid place-items-center">
              <div className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur-md grid place-items-center ring-1 ring-white/30 shadow-xl">
                <AlertCircle className="h-10 w-10 text-white" />
              </div>
            </div>
            <button
              onClick={() => setDismissedFailed(data.startedAt || null)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center text-white transition-all hover:scale-110"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-7 space-y-5">
            <div className="text-center">
              <h2 className="text-2xl sm:text-3xl font-black text-slate-900">{t('failedTitle')}</h2>
              <p className="text-[13.5px] text-slate-600 mt-2 leading-relaxed">{t('failedDesc')}</p>
            </div>

            {data.error && (
              <div className="rounded-2xl bg-rose-50 ring-1 ring-rose-200 p-4 text-[11.5px] font-mono text-rose-900 max-h-40 overflow-y-auto break-all">
                {data.error}
              </div>
            )}

            <button
              onClick={() => setDismissedFailed(data.startedAt || null)}
              className="w-full h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
            >
              {t('closeBtn')}
            </button>
          </div>
        </div>
      )}

      {/* Animatsiyalar */}
      <style jsx global>{`
        @keyframes deploy-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes deploy-scale-in {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes deploy-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes deploy-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        @keyframes deploy-slide-in {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .animate-fade-in { animation: deploy-fade-in 0.25s ease-out; }
        .animate-scale-in { animation: deploy-scale-in 0.32s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .animate-shimmer { animation: deploy-shimmer 2s linear infinite; }
        .animate-float { animation: deploy-float 3s ease-in-out infinite; }
        .animate-slide-in { animation: deploy-slide-in 0.3s ease-out both; }
      `}</style>
    </div>,
    document.body,
  );
}
