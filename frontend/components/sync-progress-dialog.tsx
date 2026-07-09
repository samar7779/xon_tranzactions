'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCcw, Layers, Split, Loader2, CheckCircle2, AlertTriangle, Sparkles, Clock } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// OplatyKv sync progress modal — admin + OplatyKv sahifalari uchun umumiy
export function SyncProgressDialog({
  open,
  onClose,
  isPending,
  result,
  bgStatus,
  error,
}: {
  open: boolean;
  onClose: () => void;
  isPending: boolean;
  result: any | null;
  bgStatus: any | null;
  error: string | null;
}) {
  const t = useTranslations('syncLogs');
  // Elapsed timer (faqat pending paytda yangilanadi)
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Hozir qaysi bosqich (heuristik — backend real-time signal yubormaydi)
  // Bosqichlarni vaqt asosida o'tkazamiz:
  //   0-3s   → Step 1 (sync)
  //   3-5s   → Step 2 (XATO cleanup)
  //   5s-?   → Step 3 (Fill objects) — uzoq davom etadi
  //   so'ngra → Step 4 (Split)
  // Bu faqat vizual taxmin — haqiqiy natija result kelganda ko'rsatiladi
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (isPending && !startedAt) {
      setStartedAt(Date.now());
      setElapsed(0);
      setActiveStep(0);
    }
    if (!isPending) {
      setStartedAt(null);
      return;
    }
    const tid = setInterval(() => {
      const now = Date.now();
      const elapsedSec = Math.round((now - (startedAt || now)) / 1000);
      setElapsed(elapsedSec);
      // Bosqich heuristikasi (3 bosqich: sync, fill, split)
      if (elapsedSec < 5) setActiveStep(0);
      else if (elapsedSec < 60) setActiveStep(1);
      else setActiveStep(2);
    }, 250);
    return () => clearInterval(tid);
  }, [open, isPending, startedAt]);

  // Modal yopilganda holatni reset qilamiz
  useEffect(() => {
    if (!open) {
      setStartedAt(null);
      setElapsed(0);
      setActiveStep(0);
    }
  }, [open]);

  // Bg jarayon holati (sync tugagandan keyin orqada davom etadi)
  const bgRunning = bgStatus?.running;
  const bgPhase = bgStatus?.phase;  // 'fill' | 'split' | 'done' | 'error'
  const bgFinished = bgStatus?.phase === 'done';
  const bgFill = bgStatus?.result?.fill;
  const bgSplit = bgStatus?.result?.split;

  const done = !!result && !isPending && !bgRunning && (bgFinished || !bgStatus);
  const errored = !!error && !isPending;

  // Bosqichlar tavsifi
  const steps = [
    {
      icon: RefreshCcw,
      title: t('step1Title'),
      desc: t('step1Desc'),
      done: !!result,
      active: isPending,
      result: result && (
        <>
          {t('stepAdded')}: <b>{result.added}</b>, {t('stepUpdated')}: <b>{result.updated}</b>, {t('stepSkipped')}: <b>{result.skipped}</b>
          {result.xatoQuickClean > 0 && (
            <>
              <br />
              🧹 {t('xatoSplitsCleaned')}: <b>{result.xatoQuickClean}</b> {t('rowsUnit')}
            </>
          )}
        </>
      ),
      color: 'emerald',
    },
    {
      icon: Layers,
      title: t('step2Title'),
      desc: t('step2Desc'),
      done: !!bgFill,
      active: bgRunning && bgPhase === 'fill',
      result: bgFill && (
        <>
          {t('stepFilled')}: <b>{bgFill.filled}</b>/{bgFill.total} · {t('stepCrmNotFound')}: <b>{bgFill.notFound}</b>
        </>
      ),
      color: 'indigo',
    },
    {
      icon: Split,
      title: t('step3Title'),
      desc: t('step3Desc'),
      done: !!bgSplit,
      active: bgRunning && bgPhase === 'split',
      result: bgSplit && (
        <>
          {t('contractsUnit', { n: bgSplit.contracts })} · {t('stepFilled')}: <b>{bgSplit.filled}</b>/{bgSplit.total} · {t('stepCrmNotFound')}: <b>{bgSplit.notFound}</b>
          {bgSplit.xatoCleaned > 0 && (
            <>
              <br />
              🧹 {t('xatoSplitsCleaned')}: <b>{bgSplit.xatoCleaned}</b> {t('rowsUnit')}
            </>
          )}
        </>
      ),
      color: 'violet',
    },
  ];

  const colorMap: Record<string, { ring: string; bg: string; text: string; iconBg: string }> = {
    emerald: { ring: 'ring-emerald-200 dark:ring-emerald-900', bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600' },
    rose:    { ring: 'ring-rose-200 dark:ring-rose-900',       bg: 'bg-rose-50 dark:bg-rose-950/40',       text: 'text-rose-700 dark:text-rose-300',       iconBg: 'bg-gradient-to-br from-rose-500 to-pink-600' },
    indigo:  { ring: 'ring-indigo-200 dark:ring-indigo-900',   bg: 'bg-indigo-50 dark:bg-indigo-950/40',   text: 'text-indigo-700 dark:text-indigo-300',   iconBg: 'bg-gradient-to-br from-indigo-500 to-blue-600' },
    violet:  { ring: 'ring-violet-200 dark:ring-violet-900',   bg: 'bg-violet-50 dark:bg-violet-950/40',   text: 'text-violet-700 dark:text-violet-300',   iconBg: 'bg-gradient-to-br from-violet-500 to-fuchsia-600' },
  };

  const totalSec = result?.duration || elapsed;
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent
        className="sm:max-w-2xl p-0 overflow-hidden gap-0"
        onInteractOutside={(e) => isPending && e.preventDefault()}
        onPointerDownOutside={(e) => isPending && e.preventDefault()}
      >
        {/* Hero header */}
        <div className={cn(
          'relative px-7 pt-6 pb-5 text-white',
          done && !errored ? 'bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500'
          : errored ? 'bg-gradient-to-br from-rose-500 via-red-500 to-pink-600'
          : 'bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600',
        )}>
          <div
            className="absolute inset-0 opacity-[0.12] pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          />
          <div className="relative">
            <div className="text-[10px] uppercase tracking-widest font-bold text-white/70 mb-1.5">
              OplatyKv Sync
            </div>
            <div className="flex items-center gap-3">
              <div className="text-2xl font-black tracking-tight">
                {done && !errored ? `✓ ${t('allDone')}`
                  : errored ? `✗ ${t('errorUpper')}`
                  : t('running')}
              </div>
              {isPending && <Loader2 className="h-6 w-6 animate-spin" />}
              {done && !errored && <Sparkles className="h-6 w-6" />}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[12px] text-white/85">
              <Clock className="h-3.5 w-3.5" />
              <span className="font-mono tabular-nums">{mm}:{ss}</span>
              {isPending && <span className="text-white/60">{t('waitDontClose')}</span>}
            </div>
          </div>
        </div>

        {/* Body — steps */}
        <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto bg-slate-50/40 dark:bg-slate-900/60">
          {steps.map((step, idx) => {
            const isActive = step.active;
            const isDone = step.done;
            const cmap = colorMap[step.color];
            const Icon = step.icon;

            return (
              <div
                key={idx}
                className={cn(
                  'rounded-2xl p-4 ring-1 transition-all',
                  isDone ? cn(cmap.bg, cmap.ring)
                  : isActive ? 'bg-white dark:bg-slate-800 ring-indigo-300 dark:ring-indigo-700 shadow-md shadow-indigo-500/20'
                  : 'bg-white dark:bg-slate-800 ring-slate-200 dark:ring-slate-700',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'w-10 h-10 rounded-xl grid place-items-center shrink-0 text-white shadow-md transition-all',
                    isDone ? cmap.iconBg
                    : isActive ? 'bg-gradient-to-br from-indigo-500 to-violet-600 animate-pulse'
                    : 'bg-slate-200 dark:bg-slate-700 shadow-none',
                  )}>
                    {isDone ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : isActive ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Icon className={cn('h-5 w-5', isActive || isDone ? 'text-white' : 'text-slate-400 dark:text-slate-500')} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      'text-[13px] font-bold leading-snug',
                      isDone ? cmap.text : isActive ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400',
                    )}>
                      {idx + 1}. {step.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                      {step.desc}
                    </div>
                    {isDone && step.result && (
                      <div className={cn('text-[12px] mt-2 tabular-nums', cmap.text)}>
                        {step.result}
                      </div>
                    )}
                    {isActive && (
                      <div className="mt-2 text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                        {t('running')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {errored && (
            <div className="rounded-2xl p-4 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div className="text-[12px] text-rose-700 dark:text-rose-300 font-semibold">{error}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {isPending ? t('processOngoing')
              : done ? t('readyRefreshOplata')
              : ''}
          </div>
          <Button
            onClick={onClose}
            disabled={isPending}
            className={cn(
              'h-10 px-5',
              done ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : '',
            )}
          >
            {isPending ? t('pleaseWait') : t('closeBtn')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
