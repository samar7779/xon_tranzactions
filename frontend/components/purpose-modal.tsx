'use client';

/**
 * Purpose Modal — to'lov maqsadini chiroyli pro-dizaynda ko'rsatish.
 *
 * Tranzaksiya / OplataKv qatorlarida "purpose info" ikoni bosilganda
 * ochiladi. Animatsiya bilan ochilib-yopiladi.
 *
 * MUHIM: faqat ESC yoki X tugmasi bilan yopiladi (overlay click ishlamaydi).
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, X, Copy, Check, Building2, Hash, Calendar, ArrowDownLeft,
  ArrowUpRight, Receipt, Sparkles, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, formatMoney } from '@/lib/utils';

export interface PurposeModalData {
  purpose: string | null;
  // Optional meta (har ikkala jadval uchun moslashtirilgan)
  amount?: number | string | null;
  currency?: string;
  direction?: 'IN' | 'OUT' | null;
  txnDate?: string | Date | null;
  contractNumber?: string | null;
  bankName?: string | null;
  accountNo?: string | null;
  ownerName?: string | null;
  // Tanlangan boshqa qisqa label'lar — modal ichida chip'lar
  externalId?: string | null;
  docNumber?: string | null;
  purposeCode?: string | null;
}

export function PurposeModal({
  open, onClose, data,
}: {
  open: boolean;
  onClose: () => void;
  data: PurposeModalData | null;
}) {
  const [copied, setCopied] = useState(false);

  // ESC tugmasi bilan yopish (overlay click esa YO'Q)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Modal yopilganda copied holatini reset qilamiz (300ms — animatsiya bilan birga)
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setCopied(false), 350);
      return () => clearTimeout(t);
    }
  }, [open]);

  function copyText() {
    if (!data?.purpose) return;
    navigator.clipboard.writeText(data.purpose);
    setCopied(true);
    toast.success("Matn nusxalandi");
    setTimeout(() => setCopied(false), 1500);
  }

  const hasMeta = !!(
    data?.amount != null ||
    data?.direction ||
    data?.txnDate ||
    data?.contractNumber ||
    data?.bankName ||
    data?.accountNo ||
    data?.docNumber ||
    data?.purposeCode
  );

  return (
    <AnimatePresence>
      {open && data && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          // Backdrop: BOSGAN paytda yopilmaydi (overlay click yo'q)
          // — faqat decorative blur
          className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
          aria-modal="true"
          role="dialog"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[680px] max-h-[88vh] overflow-hidden bg-gradient-to-br from-white via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] flex flex-col"
          >
            {/* ─── HEADER — gradient bilan, decorative ─── */}
            <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-7 py-6">
              {/* Decorative dots pattern */}
              <div
                className="absolute inset-0 opacity-[0.15] pointer-events-none"
                style={{
                  backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                }}
              />
              {/* Glow blob */}
              <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-white/10 blur-3xl" />
              <div className="absolute -bottom-12 -left-12 w-44 h-44 rounded-full bg-fuchsia-300/20 blur-3xl" />

              <div className="relative flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-md grid place-items-center ring-1 ring-white/30 shadow-xl shrink-0">
                  <FileText className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-white/80 mb-1 flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" />
                    To'lov maqsadi
                  </div>
                  <h2 className="text-[20px] font-black tracking-tight text-white leading-tight">
                    Naznachenie platezha
                  </h2>
                  {data.direction && data.amount != null && (
                    <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur-md ring-1 ring-white/20">
                      {data.direction === 'IN' ? (
                        <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-200" />
                      ) : (
                        <ArrowUpRight className="h-3.5 w-3.5 text-rose-200" />
                      )}
                      <span className="text-[14px] font-bold tabular-nums text-white">
                        {data.direction === 'IN' ? '+' : '−'}
                        {formatMoney(Math.abs(Number(data.amount)), data.currency || 'UZS')}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="shrink-0 w-9 h-9 rounded-lg bg-white/15 hover:bg-white/25 backdrop-blur-md grid place-items-center text-white transition-colors ring-1 ring-white/20"
                  aria-label="Yopish"
                  title="Yopish (ESC)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* ─── BODY — scrollable ─── */}
            <div className="flex-1 overflow-y-auto p-7 space-y-5">
              {/* Meta chips */}
              {hasMeta && (
                <div className="flex items-center gap-2 flex-wrap">
                  {data.txnDate && (
                    <Chip icon={<Calendar className="h-3 w-3" />}>
                      {formatDateTime(data.txnDate)}
                    </Chip>
                  )}
                  {data.bankName && (
                    <Chip icon={<Building2 className="h-3 w-3" />} tone="indigo">
                      {data.bankName}
                    </Chip>
                  )}
                  {data.accountNo && (
                    <Chip icon={<Hash className="h-3 w-3" />} mono>
                      {data.accountNo}
                    </Chip>
                  )}
                  {data.ownerName && (
                    <Chip tone="violet">{data.ownerName}</Chip>
                  )}
                  {data.contractNumber && (
                    <Chip icon={<Receipt className="h-3 w-3" />} tone="emerald" mono>
                      {data.contractNumber}
                    </Chip>
                  )}
                  {data.docNumber && (
                    <Chip mono>Док №{data.docNumber}</Chip>
                  )}
                  {data.purposeCode && (
                    <Chip mono tone="amber">Код {data.purposeCode}</Chip>
                  )}
                </div>
              )}

              {/* Purpose text — asosiy kartochka */}
              <div className="relative group">
                {/* Decorative gradient border */}
                <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-indigo-500/30 via-violet-500/30 to-fuchsia-500/30 opacity-0 group-hover:opacity-100 transition-opacity blur-md" aria-hidden="true" />

                <div className="relative rounded-2xl bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
                  {/* Header strip */}
                  <div className="px-4 py-2.5 bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-900 dark:to-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Info className="h-3 w-3" />
                      Asosiy matn
                    </div>
                    {data.purpose && (
                      <button
                        onClick={copyText}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md text-slate-600 dark:text-slate-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                      >
                        {copied ? (
                          <><Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> Nusxalandi</>
                        ) : (
                          <><Copy className="h-3 w-3" /> Nusxalash</>
                        )}
                      </button>
                    )}
                  </div>
                  {/* Body — purpose text */}
                  <div className="p-5">
                    {data.purpose ? (
                      <p className="text-[14.5px] leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words select-text">
                        {data.purpose}
                      </p>
                    ) : (
                      <p className="text-[13px] italic text-slate-400 dark:text-slate-500 text-center py-4">
                        To'lov maqsadi ko'rsatilmagan
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* External ID — pastda alohida (mono code) */}
              {data.externalId && (
                <div className="rounded-xl bg-slate-900 dark:bg-slate-950 ring-1 ring-slate-700 dark:ring-slate-800 px-3 py-2.5 flex items-start gap-2">
                  <div className="text-[9px] uppercase tracking-widest font-bold text-slate-400 mt-1 shrink-0">External ID</div>
                  <code className="flex-1 font-mono text-[11px] text-emerald-300 break-all leading-relaxed select-all">
                    {data.externalId}
                  </code>
                </div>
              )}
            </div>

            {/* ─── FOOTER — yopish ko'rsatkichi ─── */}
            <div className="px-7 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-[10px] font-semibold">ESC</kbd>
                <span>yoki</span>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-[10px] font-semibold">X</kbd>
                <span>bilan yopiladi</span>
              </span>
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 font-semibold text-[12px] transition-colors"
              >
                Yopish
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Chip({
  children, icon, tone = 'slate', mono,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'slate' | 'indigo' | 'violet' | 'emerald' | 'amber';
  mono?: boolean;
}) {
  const tones: Record<string, string> = {
    slate:   'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
    indigo:  'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-900',
    violet:  'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-900',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900',
    amber:   'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md ring-1 text-[11.5px] font-semibold ${tones[tone] || tones.slate} ${mono ? 'font-mono' : ''}`}>
      {icon}
      {children}
    </span>
  );
}

/** Icon tugma — har qator oxirida ko'rinadi, bosilganda modal ochiladi. */
export function PurposeInfoButton({
  data, className,
}: {
  data: PurposeModalData;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="To'lov maqsadi"
        className={`inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-gradient-to-br hover:from-indigo-500 hover:to-violet-600 text-slate-600 dark:text-slate-300 hover:text-white transition-all shadow-sm ${className || ''}`}
      >
        <FileText className="h-3.5 w-3.5" />
      </button>
      <PurposeModal open={open} onClose={() => setOpen(false)} data={data} />
    </>
  );
}
