'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ZoomIn, ZoomOut, Maximize2, RotateCw, Download, Printer,
  ChevronLeft, ChevronRight, Loader2, ImageOff, FileText, Building2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api, apiDownload } from '@/lib/api';

/**
 * Planirovka ko'ruvchi — CRM'dagi xonadon reja rasmini (uploads/plans/...)
 * full-screen ko'rsatadi. Yaqinlashtirish/uzoqlashtirish (buttons + scroll +
 * drag), aylantirish, yuklab olish (backend proxy orqali), chop etish.
 *
 * Ma'lumot manbai: GET /oplata-kv/contract-plan?contractNo=...
 * (CRM /show detail ichidan uploads/plans yo'li avtomatik topiladi.)
 */

type PlanMedia = {
  ok: boolean;
  contract: string;
  plans: string[];
  contractDoc: string | null;
  apartmentNumber: string | null;
  objectName: string | null;
  typeName: string | null;
  crmConnected: boolean;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function PlanViewerDialog({
  open, onClose, contractNo,
}: {
  open: boolean;
  onClose: () => void;
  contractNo: string | null;
}) {
  const t = useTranslations('oplatykv');

  const [idx, setIdx] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [imgLoading, setImgLoading] = useState(true);
  const [imgError, setImgError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  const query = useQuery({
    queryKey: ['oplata-kv-contract-plan', contractNo],
    queryFn: () => api.get<PlanMedia>(
      `/oplata-kv/contract-plan?contractNo=${encodeURIComponent(contractNo || '')}`,
      { timeout: 40000 },
    ),
    enabled: open && !!contractNo,
    staleTime: 5 * 60_000,
  });

  const data = query.data;
  const plans = data?.plans ?? [];
  const currentUrl = plans[idx] || null;

  const resetTransform = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setRotation(0);
  }, []);

  // Modal ochilganda / yopilganda holatni tozalaymiz
  useEffect(() => {
    if (!open) {
      setIdx(0);
      resetTransform();
    }
  }, [open, resetTransform]);

  // Rasm almashganda transformni reset + loading
  useEffect(() => {
    resetTransform();
    setImgLoading(true);
    setImgError(false);
  }, [idx, currentUrl, resetTransform]);

  // ── Zoom (cursor markazida) — native wheel listener (passive: false) ──
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setScale((s) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const ns = clamp(s * factor, MIN_SCALE, MAX_SCALE);
        if (ns === s) return s;
        setOffset((o) => ({
          x: cx - (cx - o.x) * (ns / s),
          y: cy - (cy - o.y) * (ns / s),
        }));
        return ns;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open]);

  // ── Drag (pan) ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.startX), y: d.oy + (e.clientY - d.startY) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const zoomBy = (factor: number) => {
    setScale((s) => {
      const ns = clamp(s * factor, MIN_SCALE, MAX_SCALE);
      if (ns === s) return s;
      // markazga nisbatan miqyoslash — offset'ni proporsional to'g'rilaymiz
      setOffset((o) => ({ x: o.x * (ns / s), y: o.y * (ns / s) }));
      return ns;
    });
  };

  const go = (delta: number) => {
    if (plans.length < 2) return;
    setIdx((i) => (i + delta + plans.length) % plans.length);
  };

  // ── Klaviatura: Esc yopadi, ↔ almashadi, +/- zoom ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '+' || e.key === '=') zoomBy(1.25);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.25);
      else if (e.key === '0') resetTransform();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plans.length]);

  const niceName = useCallback((withIndex = true): string => {
    const parts = ['Planirovka'];
    if (data?.objectName) parts.push(data.objectName);
    if (data?.apartmentNumber) parts.push(String(data.apartmentNumber).replace(/[№#]/g, '').trim());
    else if (contractNo) parts.push(contractNo);
    if (withIndex && plans.length > 1) parts.push(String(idx + 1));
    return parts.filter(Boolean).join(' ').trim() || 'planirovka';
  }, [data, contractNo, plans.length, idx]);

  const doDownload = async () => {
    if (!currentUrl) return;
    setDownloading(true);
    try {
      const p = new URLSearchParams();
      p.set('url', currentUrl);
      p.set('name', niceName());
      await apiDownload(`/oplata-kv/contract-plan/download?${p.toString()}`, `${niceName()}.png`);
      toast.success(t('planDownloaded'));
    } catch (e: any) {
      toast.error(e?.message || t('planDownloadError'));
    } finally {
      setDownloading(false);
    }
  };

  const doPrint = () => {
    if (!currentUrl) return;
    const w = window.open('', '_blank', 'width=1000,height=1300');
    if (!w) { toast.error(t('planPrintBlocked')); return; }
    const title = niceName(false);
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
      `<style>@page{margin:8mm}html,body{margin:0;height:100%}` +
      `body{display:flex;align-items:center;justify-content:center}` +
      `img{max-width:100%;max-height:100vh;object-fit:contain}</style></head>` +
      `<body><img src="${currentUrl}" onload="setTimeout(function(){window.focus();window.print();},250)"/></body></html>`,
    );
    w.document.close();
  };

  const doDownloadDoc = async () => {
    if (!data?.contractDoc) return;
    try {
      // docx to'g'ridan-to'g'ri presigned URL bilan ochiladi (Content-Disposition CRM tomonda)
      window.open(data.contractDoc, '_blank');
    } catch (e: any) {
      toast.error(e?.message || t('planDownloadError'));
    }
  };

  const isLoading = query.isLoading;
  const crmError = data && data.crmConnected === false;
  const empty = !isLoading && !crmError && plans.length === 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-3 sm:p-4 pointer-events-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[1280px] h-[92vh] rounded-2xl overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 ring-1 ring-slate-800 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative px-5 py-3.5 border-b border-slate-800 bg-gradient-to-r from-slate-900 to-slate-950 flex items-center gap-3 shrink-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 grid place-items-center shadow-lg shrink-0">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">{t('planViewerTitle')}</div>
                <div className="text-[15px] font-bold text-white truncate">
                  {data?.objectName || t('planViewerSubtitle')}
                  {data?.apartmentNumber && (
                    <span className="ml-2 text-[12px] font-semibold text-amber-300">№ {data.apartmentNumber}</span>
                  )}
                  {contractNo && (
                    <span className="ml-2 text-[11.5px] font-mono font-normal text-slate-400">#{contractNo}</span>
                  )}
                </div>
              </div>

              {/* Toolbar */}
              {!!currentUrl && (
                <div className="hidden sm:flex items-center gap-1 mr-1">
                  <ToolBtn title={t('planZoomOut')} onClick={() => zoomBy(1 / 1.25)}><ZoomOut className="h-4 w-4" /></ToolBtn>
                  <span className="text-[11px] font-mono text-slate-400 w-11 text-center tabular-nums">{Math.round(scale * 100)}%</span>
                  <ToolBtn title={t('planZoomIn')} onClick={() => zoomBy(1.25)}><ZoomIn className="h-4 w-4" /></ToolBtn>
                  <ToolBtn title={t('planReset')} onClick={resetTransform}><Maximize2 className="h-4 w-4" /></ToolBtn>
                  <ToolBtn title={t('planRotate')} onClick={() => setRotation((r) => (r + 90) % 360)}><RotateCw className="h-4 w-4" /></ToolBtn>
                  <div className="w-px h-6 bg-slate-700 mx-1" />
                  <ToolBtn title={t('planDownload')} onClick={doDownload} disabled={downloading}>
                    {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </ToolBtn>
                  <ToolBtn title={t('planPrint')} onClick={doPrint}><Printer className="h-4 w-4" /></ToolBtn>
                </div>
              )}

              <button
                onClick={onClose}
                className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 grid place-items-center text-slate-300 transition-colors shrink-0"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body — image viewport */}
            <div
              ref={viewportRef}
              className="relative flex-1 min-h-0 overflow-hidden bg-[radial-gradient(circle_at_center,#1e293b_0,#020617_75%)] grid place-items-center select-none"
              style={{ cursor: currentUrl && !imgError ? (dragging ? 'grabbing' : 'grab') : 'default' }}
            >
              {isLoading ? (
                <div className="text-center text-slate-400">
                  <div className="w-11 h-11 mx-auto mb-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  <div className="text-[13px]">{t('planLoading')}</div>
                </div>
              ) : crmError ? (
                <div className="text-center px-8">
                  <ImageOff className="h-12 w-12 text-rose-400 mx-auto mb-3" />
                  <div className="text-rose-200 font-semibold mb-1">{t('planCrmError')}</div>
                  <div className="text-[13px] text-slate-400">{t('planCrmErrorHint')}</div>
                </div>
              ) : empty ? (
                <div className="text-center px-8">
                  <ImageOff className="h-12 w-12 text-slate-500 mx-auto mb-3" />
                  <div className="text-slate-200 font-semibold mb-1">{t('planNotFound')}</div>
                  <div className="text-[13px] text-slate-400 mb-4">{t('planNotFoundHint')}</div>
                  {data?.contractDoc && (
                    <button
                      onClick={doDownloadDoc}
                      className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[12.5px] font-semibold transition-colors"
                    >
                      <FileText className="h-4 w-4" /> {t('planDownloadDoc')}
                    </button>
                  )}
                </div>
              ) : currentUrl ? (
                <>
                  {imgLoading && !imgError && (
                    <div className="absolute inset-0 grid place-items-center pointer-events-none">
                      <Loader2 className="h-8 w-8 text-amber-500 animate-spin" />
                    </div>
                  )}
                  {imgError && (
                    <div className="absolute inset-0 grid place-items-center text-center px-8">
                      <div>
                        <ImageOff className="h-12 w-12 text-rose-400 mx-auto mb-3" />
                        <div className="text-rose-200 font-semibold mb-1">{t('planLoadFailed')}</div>
                        <div className="text-[13px] text-slate-400 mb-4">{t('planLoadFailedHint')}</div>
                        <button
                          onClick={() => window.open(currentUrl, '_blank')}
                          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[12.5px] font-semibold transition-colors"
                        >
                          <ChevronRight className="h-4 w-4" /> {t('planOpenNewTab')}
                        </button>
                      </div>
                    </div>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={currentUrl}
                    src={currentUrl}
                    alt={niceName(false)}
                    draggable={false}
                    onLoad={() => { setImgLoading(false); setImgError(false); }}
                    onError={() => { setImgLoading(false); setImgError(true); }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onDoubleClick={resetTransform}
                    className="max-w-full max-h-full object-contain will-change-transform"
                    style={{
                      transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
                      transition: dragging ? 'none' : 'transform 0.12s ease-out',
                      opacity: imgLoading || imgError ? 0 : 1,
                    }}
                  />

                  {/* Prev / Next (bir nechta rasm bo'lsa) */}
                  {plans.length > 1 && (
                    <>
                      <NavBtn side="left" onClick={() => go(-1)}><ChevronLeft className="h-6 w-6" /></NavBtn>
                      <NavBtn side="right" onClick={() => go(1)}><ChevronRight className="h-6 w-6" /></NavBtn>
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-900/80 ring-1 ring-slate-700 text-[12px] font-semibold text-slate-200 tabular-nums">
                        {idx + 1} / {plans.length}
                      </div>
                    </>
                  )}
                </>
              ) : null}

              {/* Mobil uchun zoom pill (pastda) */}
              {!!currentUrl && (
                <div className="sm:hidden absolute bottom-4 right-4 flex items-center gap-1 bg-slate-900/85 ring-1 ring-slate-700 rounded-xl p-1">
                  <ToolBtn title={t('planZoomOut')} onClick={() => zoomBy(1 / 1.25)}><ZoomOut className="h-4 w-4" /></ToolBtn>
                  <ToolBtn title={t('planZoomIn')} onClick={() => zoomBy(1.25)}><ZoomIn className="h-4 w-4" /></ToolBtn>
                  <ToolBtn title={t('planDownload')} onClick={doDownload} disabled={downloading}>
                    {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </ToolBtn>
                </div>
              )}
            </div>

            {/* Footer hint */}
            <div className="px-5 py-2 border-t border-slate-800 bg-slate-900/70 shrink-0 flex items-center justify-between gap-2">
              <div className="text-[11px] text-slate-500 truncate">{t('planHint')}</div>
              {data?.contractDoc && plans.length > 0 && (
                <button
                  onClick={doDownloadDoc}
                  className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-300 hover:text-white transition-colors shrink-0"
                >
                  <FileText className="h-3.5 w-3.5" /> {t('planDownloadDoc')}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ToolBtn({
  children, title, onClick, disabled,
}: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 grid place-items-center text-slate-300 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function NavBtn({
  children, side, onClick,
}: {
  children: React.ReactNode; side: 'left' | 'right'; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'absolute top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-slate-900/80 hover:bg-slate-800 ring-1 ring-slate-700 grid place-items-center text-slate-200 transition-colors ' +
        (side === 'left' ? 'left-4' : 'right-4')
      }
    >
      {children}
    </button>
  );
}
