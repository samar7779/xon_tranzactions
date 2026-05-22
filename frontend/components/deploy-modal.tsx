'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import {
  Sparkles, RefreshCw, X, Loader2, AlertCircle, Rocket, CheckCircle2, Activity, Zap,
  ChevronUp,
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

export function DeployModal() {
  const t = useTranslations('deploy');
  const tp = useTranslations('deploy.phases');
  const [mounted, setMounted] = useState(false);
  const initialCommitRef = useRef<string | null>(null);
  const [dismissedNewVersion, setDismissedNewVersion] = useState<string | null>(null);
  const [dismissedFailed, setDismissedFailed] = useState<string | null>(null);
  const [dismissedRunning, setDismissedRunning] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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

  // Yangi running boshlansa avto-ko'rinadi
  useEffect(() => {
    if (data?.state === 'running' && data.startedAt && dismissedRunning !== data.startedAt) {
      // Notification ko'rinadi (default), expanded yo'q
    }
  }, [data?.state, data?.startedAt, dismissedRunning]);

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

  const isRunning =
    data.state === 'running' &&
    data.startedAt &&
    dismissedRunning !== data.startedAt;

  if (!isNewVersion && !isFailed && !isRunning) return null;

  // Priority: failed > new version > running
  const activeKind: 'failed' | 'newVersion' | 'running' =
    isFailed ? 'failed' : isNewVersion ? 'newVersion' : 'running';

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

  const dismissNotification = () => {
    if (activeKind === 'failed') setDismissedFailed(data.startedAt || null);
    else if (activeKind === 'newVersion') setDismissedNewVersion(data.currentCommit || null);
    else setDismissedRunning(data.startedAt || null);
    setExpanded(false);
  };

  return createPortal(
    <>
      {/* ═══════════════ XABARNOMA (kichik, pastki-o'ngda) ═══════════════ */}
      {!expanded && (
        <div className="fixed bottom-4 right-4 z-[9998] animate-slide-up-in">
          <button
            onClick={() => setExpanded(true)}
            className={cn(
              'group relative pl-3 pr-9 py-2.5 rounded-2xl shadow-2xl ring-1 transition-all hover:scale-[1.02] active:scale-[0.98] min-w-[240px] text-left',
              activeKind === 'running'  && 'bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 ring-white/20 hover:shadow-indigo-500/40',
              activeKind === 'newVersion' && 'bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 ring-white/20 hover:shadow-emerald-500/40',
              activeKind === 'failed'   && 'bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 ring-white/20 hover:shadow-rose-500/40',
            )}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur grid place-items-center ring-1 ring-white/30 shrink-0">
                {activeKind === 'running' && <Loader2 className="h-4 w-4 text-white animate-spin" />}
                {activeKind === 'newVersion' && <Sparkles className="h-4 w-4 text-white" />}
                {activeKind === 'failed' && <AlertCircle className="h-4 w-4 text-white" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />
                  <div className="text-[10px] uppercase tracking-widest font-bold text-white/85 leading-none">
                    {activeKind === 'running'   && t('live')}
                    {activeKind === 'newVersion' && t('newVersionTitle')}
                    {activeKind === 'failed'    && t('failedTitle')}
                  </div>
                </div>
                <div className="text-[13px] font-bold text-white leading-tight mt-0.5 truncate">
                  {activeKind === 'running' && (
                    <>
                      {t('deploying')}
                      {typeof data.progressPercent === 'number' && (
                        <span className="ml-1.5 tabular-nums text-white/90">{data.progressPercent}%</span>
                      )}
                    </>
                  )}
                  {activeKind === 'newVersion' && t('newVersionBtn')}
                  {activeKind === 'failed' && (data.message || t('failedDesc'))}
                </div>
              </div>
              <ChevronUp className="h-4 w-4 text-white/70 group-hover:text-white transition-colors shrink-0" />
            </div>

            {/* Mini progress bar (faqat running uchun) */}
            {activeKind === 'running' && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/15 rounded-b-2xl overflow-hidden">
                <div
                  className="h-full bg-white/70 transition-all duration-1000 ease-out"
                  style={{ width: `${data.progressPercent ?? 1}%` }}
                />
              </div>
            )}
          </button>

          {/* Tashqi X — yopish */}
          <button
            onClick={(e) => { e.stopPropagation(); dismissNotification(); }}
            className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white/15 hover:bg-white/30 grid place-items-center text-white/80 hover:text-white transition-all"
            aria-label="Yopish"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* ═══════════════ TO'LIQ MODAL (faqat foydalanuvchi xohlasa) ═══════════════ */}
      {expanded && (
        <div
          className="fixed inset-0 z-[9999] grid place-items-center p-4 animate-fade-in"
          style={{ background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(10px)' }}
          onClick={() => setExpanded(false)}
        >
          {/* RUNNING — to'liq */}
          {activeKind === 'running' && (
            <div
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              {/* HERO — toza, ozroq joy egallaydi */}
              <div className="relative h-32 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 overflow-hidden">
                <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-white/10 blur-3xl animate-pulse" />
                <div
                  className="absolute inset-0 opacity-[0.12]"
                  style={{
                    backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
                    backgroundSize: '20px 20px',
                  }}
                />

                <div className="relative h-full flex items-center justify-between px-7">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-lg shadow-emerald-400/60" />
                      <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/90">
                        {t('live')}
                      </span>
                    </div>
                    <h2 className="text-2xl font-black text-white tracking-tight">
                      {t('deploying')}
                    </h2>
                  </div>
                  <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur-md grid place-items-center ring-1 ring-white/30 animate-float shrink-0">
                    <Rocket className="h-7 w-7 text-white" />
                  </div>
                </div>

                <button
                  onClick={() => setExpanded(false)}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center text-white transition-all hover:scale-110"
                  aria-label="Yopish"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* TANA */}
              <div className="p-6 space-y-5">
                {/* Katta progress bar — % o'rtada */}
                <div className="space-y-2">
                  <div className="relative h-9 bg-slate-100 rounded-2xl overflow-hidden ring-1 ring-slate-200/60">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 transition-all duration-1000 ease-out relative"
                      style={{ width: `${data.progressPercent ?? 1}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-shimmer" />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center font-black tabular-nums text-slate-900 text-base drop-shadow-sm">
                      {data.progressPercent ?? 0}%
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[12px] text-slate-600 font-medium tabular-nums">
                    <span>
                      <span className="text-slate-400">{t('elapsed')}:</span>{' '}
                      <b className="text-slate-800">{data.elapsedSeconds ?? 0}{t('second')}</b>
                    </span>
                    <span className="text-indigo-600">
                      {data.estimatedRemainingSeconds === null || data.estimatedRemainingSeconds === undefined
                        ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Yakunlanmoqda...</span>
                        : <>
                            <span className="text-slate-400">{t('remaining')}:</span>{' '}
                            <b>~{data.estimatedRemainingSeconds}{t('second')}</b>
                          </>}
                    </span>
                  </div>
                </div>

                {/* Joriy faza — katta, ko'rinarli */}
                {data.currentPhase && (
                  <div className="rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-[1.5px] shadow-lg shadow-indigo-500/20">
                    <div className="rounded-2xl bg-white p-4 flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center shrink-0 shadow-lg shadow-indigo-500/30">
                        <Loader2 className="h-6 w-6 text-white animate-spin" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-widest font-bold text-indigo-600">
                          {t('phase')}
                        </div>
                        <div className="text-base font-bold text-slate-900 mt-0.5 leading-tight">
                          {phaseLabel(data.currentPhase)}
                        </div>
                      </div>
                      <Activity className="h-5 w-5 text-indigo-400 animate-pulse" />
                    </div>
                  </div>
                )}

                {/* Bajarilgan ro'yxat */}
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="w-6 h-6 rounded-md bg-emerald-100 grid place-items-center">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    </div>
                    <h3 className="text-[12px] font-bold text-slate-700">
                      {t('completedTitle')}
                      {data.completedPhases && data.completedPhases.length > 0 && (
                        <span className="text-slate-400 font-medium ml-1">
                          · {data.completedPhases.length}
                        </span>
                      )}
                    </h3>
                  </div>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {(!data.completedPhases || data.completedPhases.length === 0) ? (
                      <div className="text-[12px] text-slate-400 italic py-3 text-center">
                        {t('waiting')}
                      </div>
                    ) : (
                      data.completedPhases.map((ph, i) => (
                        <div
                          key={`${i}-${ph}`}
                          className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-emerald-50/50 hover:bg-emerald-50 transition-colors animate-slide-in"
                          style={{ animationDelay: `${i * 25}ms` }}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
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

          {/* NEW VERSION — to'liq */}
          {activeKind === 'newVersion' && (
            <div
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative h-36 bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 overflow-hidden">
                <div
                  className="absolute inset-0 opacity-[0.15]"
                  style={{
                    backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
                    backgroundSize: '20px 20px',
                  }}
                />
                <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/15 blur-3xl animate-pulse" />
                <div className="relative h-full grid place-items-center">
                  <div className="w-20 h-20 rounded-3xl bg-white/25 backdrop-blur-md grid place-items-center ring-2 ring-white/40 shadow-xl animate-float">
                    <Sparkles className="h-10 w-10 text-white drop-shadow-lg" />
                  </div>
                </div>
                <button
                  onClick={() => setExpanded(false)}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center text-white transition-all hover:scale-110"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="text-center">
                  <h2 className="text-2xl font-black text-slate-900 mb-1.5">
                    {t('newVersionTitle')}
                  </h2>
                  <p className="text-[13px] text-slate-600 leading-relaxed">
                    {t('newVersionDesc')}
                  </p>
                </div>

                <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 font-mono">
                  <span>{t('newVersionCommit')}:</span>
                  <code className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold">
                    {data.currentCommit}
                  </code>
                </div>

                <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
                  <button
                    onClick={() => setDismissedNewVersion(data.currentCommit || null)}
                    className="flex-1 h-11 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
                  >
                    {t('newVersionLater')}
                  </button>
                  <button
                    onClick={() => window.location.reload()}
                    className="flex-1 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold text-sm shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t('newVersionBtn')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* FAILED — to'liq */}
          {activeKind === 'failed' && (
            <div
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative h-32 bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 overflow-hidden">
                <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
                <div className="relative h-full grid place-items-center">
                  <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md grid place-items-center ring-1 ring-white/30 shadow-xl">
                    <AlertCircle className="h-8 w-8 text-white" />
                  </div>
                </div>
                <button
                  onClick={() => setExpanded(false)}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center text-white transition-all hover:scale-110"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="text-center">
                  <h2 className="text-xl font-black text-slate-900">{t('failedTitle')}</h2>
                  <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">{t('failedDesc')}</p>
                </div>

                {data.error && (
                  <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 p-3 text-[11px] font-mono text-rose-900 max-h-32 overflow-y-auto break-all">
                    {data.error}
                  </div>
                )}

                <button
                  onClick={() => setDismissedFailed(data.startedAt || null)}
                  className="w-full h-11 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
                >
                  {t('closeBtn')}
                </button>
              </div>
            </div>
          )}
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
        @keyframes deploy-slide-up-in {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: deploy-fade-in 0.25s ease-out; }
        .animate-scale-in { animation: deploy-scale-in 0.32s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .animate-shimmer { animation: deploy-shimmer 2s linear infinite; }
        .animate-float { animation: deploy-float 3s ease-in-out infinite; }
        .animate-slide-in { animation: deploy-slide-in 0.3s ease-out both; }
        .animate-slide-up-in { animation: deploy-slide-up-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
      `}</style>
    </>,
    document.body,
  );
}
