'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import {
  Sparkles, RefreshCw, X, Loader2, AlertCircle, Rocket, CheckCircle2, Activity,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

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

/**
 * Big visual modal'lar:
 *  - 'running'  → progress modal (faza, vaqt, jadval)
 *  - 'success' yangi commit bilan → "Yangi versiya" modal (yangilash tugma)
 *  - 'failed'   → xato modal
 */
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

  // Boshlang'ich commit'ni eslab qolamiz
  useEffect(() => {
    if (!data?.currentCommit) return;
    if (initialCommitRef.current === null) {
      initialCommitRef.current = data.currentCommit;
    }
  }, [data?.currentCommit]);

  // Running state qaytadan ko'rsatish
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

  // Translatsiya bilan faza nomini olish (yo'q bo'lsa raw qaytarish)
  const phaseLabel = (raw: string | null | undefined): string => {
    if (!raw) return '';
    try { return tp(raw as any) || raw; } catch { return raw; }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] grid place-items-center p-4 animate-fade-in"
      style={{ background: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(8px)' }}
    >
      {/* ─── RUNNING MODAL ─── */}
      {isRunning && (
        <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-scale-in">
          {/* Gradient header bilan aylanuvchi raket */}
          <div className="relative h-32 bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl animate-pulse" />
            <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-amber-400/20 blur-xl" />
            <div className="relative h-full grid place-items-center">
              <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm grid place-items-center ring-1 ring-white/30 animate-float">
                <Rocket className="h-8 w-8 text-white animate-bounce" />
              </div>
            </div>
            {/* Close X */}
            <button
              onClick={() => setShowRunning(false)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center text-white transition-colors"
              aria-label="Yopish"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-bold text-slate-900">{t('deploying')}</h2>
              <p className="text-[13px] text-slate-500 mt-1">{t('deployingDesc')}</p>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <span className="text-slate-500">{data.progressPercent ?? 0}%</span>
                <span className="text-slate-500 tabular-nums">
                  {t('elapsed')}: {data.elapsedSeconds ?? 0}{t('second')}
                  {data.estimatedRemainingSeconds !== null && data.estimatedRemainingSeconds !== undefined && (
                    <span className="ml-2 text-indigo-600">
                      · {t('remaining')}: ~{data.estimatedRemainingSeconds}{t('second')}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 transition-all duration-1000 ease-out relative"
                  style={{ width: `${data.progressPercent ?? 1}%` }}
                >
                  <div className="absolute inset-0 bg-white/30 animate-shimmer" />
                </div>
              </div>
            </div>

            {/* Joriy faza */}
            {data.currentPhase && (
              <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 ring-1 ring-indigo-100 p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white grid place-items-center shadow-sm shrink-0">
                  <Loader2 className="h-4 w-4 text-indigo-600 animate-spin" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-indigo-600">{t('phase')}</div>
                  <div className="text-[13px] font-semibold text-slate-800 truncate">
                    {phaseLabel(data.currentPhase)}
                  </div>
                </div>
              </div>
            )}

            {/* Tugagan fazalar ro'yxati */}
            {data.completedPhases && data.completedPhases.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {data.completedPhases.map((ph, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    <span className="truncate">{phaseLabel(ph)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── NEW VERSION MODAL ─── */}
      {isNewVersion && (
        <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden animate-scale-in">
          <div className="relative h-40 bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 overflow-hidden">
            <div className="absolute inset-0 bg-dots opacity-20 pointer-events-none" />
            <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/15 blur-3xl animate-pulse" />
            <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full bg-yellow-300/20 blur-2xl" />

            <div className="relative h-full grid place-items-center">
              <div className="w-20 h-20 rounded-3xl bg-white/25 backdrop-blur-md grid place-items-center ring-2 ring-white/40 shadow-xl animate-float">
                <Sparkles className="h-10 w-10 text-white drop-shadow-lg" />
              </div>
            </div>
            <button
              onClick={() => setDismissedNewVersion(data.currentCommit || null)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-7 space-y-5">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-slate-900 mb-1.5">
                {t('newVersionTitle')}
              </h2>
              <p className="text-[14px] text-slate-600 leading-relaxed max-w-sm mx-auto">
                {t('newVersionDesc')}
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 font-mono">
              <span>{t('newVersionCommit')}:</span>
              <code className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold">
                {data.currentCommit}
              </code>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
              <button
                onClick={() => setDismissedNewVersion(data.currentCommit || null)}
                className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
              >
                {t('newVersionLater')}
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold text-sm shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                {t('newVersionBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── FAILED MODAL ─── */}
      {isFailed && (
        <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-scale-in">
          <div className="relative h-32 bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
            <div className="relative h-full grid place-items-center">
              <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm grid place-items-center ring-1 ring-white/30">
                <AlertCircle className="h-8 w-8 text-white" />
              </div>
            </div>
            <button
              onClick={() => setDismissedFailed(data.startedAt || null)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-bold text-slate-900">{t('failedTitle')}</h2>
              <p className="text-[13px] text-slate-600 mt-1">{t('failedDesc')}</p>
            </div>

            {data.error && (
              <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 p-3 text-[11px] font-mono text-rose-900 max-h-32 overflow-y-auto break-all">
                {data.error}
              </div>
            )}

            <button
              onClick={() => setDismissedFailed(data.startedAt || null)}
              className="w-full h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
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
        .animate-fade-in { animation: deploy-fade-in 0.25s ease-out; }
        .animate-scale-in { animation: deploy-scale-in 0.32s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .animate-shimmer { animation: deploy-shimmer 2s linear infinite; }
        .animate-float { animation: deploy-float 3s ease-in-out infinite; }
      `}</style>
    </div>,
    document.body,
  );
}
