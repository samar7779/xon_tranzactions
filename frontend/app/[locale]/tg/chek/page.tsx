'use client';

// Telegram Mini App — Chek order "Tekshirish" (guruh a'zolari uchun, AdminUser'siz).
// Telegramdan ochilsa: initData tekshiriladi → guest token → tekshirish.
// Boshqa joydan: "Telegram orqali kiring" sahifasi.
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Loader2, ShieldCheck, Send, Upload, Hash, Image as ImageIcon, FileText,
  CheckCircle2, XCircle, AlertTriangle, RotateCcw, ScanLine,
} from 'lucide-react';
import { api, setToken } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

type Cond = { order: boolean | null; account: boolean | null; date: boolean | null; amount: boolean | null; contract: boolean | null };
type Extracted = { orderNo: string; amount?: number | null; contractNo?: string | null; recipientName?: string | null; date?: string | null };
type MatchedTx = { amount: number; currency: string; toName: string | null; docNumber: string | null; description: string | null } | null;
type OrderResult = { orderNos: string[]; extracted: Extracted; result: 'found' | 'mismatch' | 'not_found'; matchedTx: MatchedTx; conditions: Cond | null };

const RES: Record<string, { key: string; cls: string; Icon: any }> = {
  found: { key: 'found', cls: 'bg-emerald-500', Icon: CheckCircle2 },
  mismatch: { key: 'mismatch', cls: 'bg-amber-500', Icon: AlertTriangle },
  not_found: { key: 'notFound', cls: 'bg-rose-500', Icon: XCircle },
};

export default function TgChekPage() {
  const t = useTranslations('chekOrder');
  const [phase, setPhase] = useState<'checking' | 'denied' | 'ready'>('checking');
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    const boot = () => {
      const wa = (window as any).Telegram?.WebApp;
      if (!wa) { if (!cancelled) setPhase('denied'); return; }
      try { wa.ready?.(); wa.expand?.(); } catch { /* skip */ }
      const initData: string = wa.initData || '';
      if (!initData) { if (!cancelled) setPhase('denied'); return; }
      api.post<{ token: string; user: { name: string } }>('/chek-order/tg/auth', { initData })
        .then((r) => { if (cancelled) return; setToken(r.token); setUser(r.user); setPhase('ready'); })
        .catch((e: any) => { if (cancelled) return; setErr(e?.message || ''); setPhase('denied'); });
    };
    if ((window as any).Telegram?.WebApp) boot();
    else {
      const s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-web-app.js';
      s.async = true;
      s.onload = boot;
      s.onerror = () => { if (!cancelled) setPhase('denied'); };
      document.head.appendChild(s);
    }
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-50 to-indigo-50/40 dark:from-slate-950 dark:to-indigo-950/20 text-slate-800 dark:text-slate-100">
      {phase === 'checking' && <Checking label={t('tg.checking')} />}
      {phase === 'denied' && <Denied t={t} err={err} onRetry={() => { setPhase('checking'); setTimeout(() => window.location.reload(), 50); }} />}
      {phase === 'ready' && <Checker t={t} userName={user?.name || ''} />}
    </div>
  );
}

function Checking({ label }: { label: string }) {
  return (
    <div className="min-h-[100dvh] grid place-items-center px-6">
      <div className="text-center space-y-4">
        <div className="relative w-16 h-16 mx-auto">
          <span className="absolute inset-0 rounded-2xl bg-indigo-400/30 blur-xl animate-pulse" />
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center shadow-lg">
            <Loader2 className="h-7 w-7 text-white animate-spin" />
          </div>
        </div>
        <div className="text-[14px] font-semibold text-slate-500 dark:text-slate-400">{label}</div>
      </div>
    </div>
  );
}

function Denied({ t, err, onRetry }: { t: any; err: string; onRetry: () => void }) {
  return (
    <div className="min-h-[100dvh] grid place-items-center px-6">
      <div className="w-full max-w-sm text-center space-y-5">
        <div className="relative w-20 h-20 mx-auto">
          <span className="absolute inset-0 rounded-3xl bg-sky-400/25 blur-2xl" />
          <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-sky-500 via-cyan-500 to-blue-600 grid place-items-center shadow-xl shadow-sky-500/30">
            <Send className="h-9 w-9 text-white" />
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-sky-500">{t('tg.onlyTelegram')}</div>
          <h1 className="mt-1.5 text-[22px] font-extrabold tracking-tight">{t('tg.denied')}</h1>
          <p className="mt-2 text-[13.5px] text-slate-500 dark:text-slate-400 leading-relaxed">{err || t('tg.openHint')}</p>
        </div>
        <button onClick={onRetry} className="inline-flex items-center gap-2 h-11 px-6 rounded-2xl bg-gradient-to-r from-sky-600 to-blue-600 text-white text-[14px] font-semibold shadow-lg shadow-sky-500/25 active:scale-95 transition-transform">
          <RotateCcw className="h-4 w-4" /> {t('tg.retry')}
        </button>
        <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 pt-2"><ShieldCheck className="h-3.5 w-3.5" /> {t('tg.secured')}</div>
      </div>
    </div>
  );
}

function Checker({ t, userName }: { t: any; userName: string }) {
  const [mode, setMode] = useState<'upload' | 'manual'>('upload');
  const [orderNos, setOrderNos] = useState('');
  const [results, setResults] = useState<OrderResult[] | null>(null);
  const [preview, setPreview] = useState<{ url: string; isPdf: boolean; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const analyze = useCallback(async (f: File) => {
    if (f.size > 25 * 1024 * 1024) { setError(t('toast.fileTooLarge')); return; }
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    setPreview((p) => { if (p?.url) URL.revokeObjectURL(p.url); return { url: URL.createObjectURL(f), isPdf, name: f.name }; });
    setResults(null); setError(''); setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await api.postForm<{ results: OrderResult[] }>('/chek-order/analyze', fd, { timeout: 120_000 });
      setResults(r.results);
    } catch (e: any) { setError(e?.message || 'Xato'); } finally { setBusy(false); }
  }, [t]);

  const runManual = async () => {
    if (!orderNos.trim()) return;
    setResults(null); setError(''); setBusy(true);
    try {
      const r = await api.post<{ results: OrderResult[] }>('/chek-order/manual', { orderNos });
      setResults(r.results);
    } catch (e: any) { setError(e?.message || 'Xato'); } finally { setBusy(false); }
  };

  const reset = () => { setResults(null); setOrderNos(''); setError(''); setPreview((p) => { if (p?.url) URL.revokeObjectURL(p.url); return null; }); };

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center shadow-md shrink-0"><ScanLine className="h-5 w-5 text-white" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold leading-tight">{t('tg.brand')}</div>
          <div className="text-[11.5px] text-slate-400 truncate">{userName ? `${t('tg.welcome')}, ${userName}` : t('subtitle')}</div>
        </div>
        {(results || preview) && (
          <button onClick={reset} className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-indigo-600 text-white text-[12px] font-semibold active:scale-95 transition-transform"><RotateCcw className="h-3.5 w-3.5" /> {t('newCheck')}</button>
        )}
      </div>

      {/* Mode */}
      <div className="flex items-center gap-1 p-1 bg-white dark:bg-slate-900 rounded-2xl ring-1 ring-slate-200/70 dark:ring-slate-800 w-full">
        <button onClick={() => setMode('upload')} className={cn('flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl text-[13px] font-semibold transition-colors', mode === 'upload' ? 'bg-indigo-600 text-white' : 'text-slate-500')}><ImageIcon className="h-4 w-4" /> {t('mode.photo')}</button>
        <button onClick={() => setMode('manual')} className={cn('flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl text-[13px] font-semibold transition-colors', mode === 'manual' ? 'bg-indigo-600 text-white' : 'text-slate-500')}><Hash className="h-4 w-4" /> {t('mode.orderNo')}</button>
      </div>

      {/* Input */}
      {mode === 'upload' ? (
        preview ? (
          <div className="relative rounded-2xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-950">
            {preview.isPdf ? (
              <div className="aspect-[3/2] grid place-items-center text-slate-300"><div className="text-center"><FileText className="h-12 w-12 mx-auto mb-2 opacity-70" /><div className="text-[12px] px-4 truncate max-w-[280px]">{preview.name}</div></div></div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt="order" className="w-full max-h-[420px] object-contain" />
            )}
            {busy && (
              <div className="absolute inset-0 grid place-items-center bg-slate-950/50 backdrop-blur-sm">
                <div className="text-center text-white"><Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" /><div className="text-[12px]">{t('tg.checking')}</div></div>
              </div>
            )}
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="absolute top-2 right-2 inline-flex items-center gap-1 px-2.5 h-8 rounded-lg bg-slate-900/70 backdrop-blur text-white text-[11px] font-semibold"><Upload className="h-3 w-3" /> {t('upload.another')}</button>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])} />
          </div>
        ) : (
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="w-full rounded-2xl border-2 border-dashed border-indigo-300 dark:border-indigo-800 bg-white dark:bg-slate-900 px-6 py-12 grid place-items-center text-center active:scale-[0.99] transition-transform">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])} />
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 grid place-items-center"><Upload className="h-7 w-7 text-indigo-500" /></div>
              <div className="text-[14px] font-semibold text-slate-700 dark:text-slate-200">{t('upload.drop')}</div>
              <div className="text-[11.5px] text-slate-400 max-w-[260px]">{t('upload.hint')}</div>
            </div>
          </button>
        )
      ) : (
        <div className="space-y-2.5 bg-white dark:bg-slate-900 rounded-2xl ring-1 ring-slate-200/70 dark:ring-slate-800 p-3.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t('manual.label')}</label>
          <textarea value={orderNos} onChange={(e) => setOrderNos(e.target.value)} rows={4} placeholder="268041120&#10;13425470"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[14px] font-mono tabular-nums resize-y outline-none focus:ring-2 focus:ring-indigo-500/40" />
          <button onClick={runManual} disabled={busy || !orderNos.trim()} className="w-full h-11 rounded-xl bg-indigo-600 text-white text-[14px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t('manual.button')}
          </button>
        </div>
      )}

      {error && <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-900 text-rose-600 dark:text-rose-300 text-[12.5px] px-3.5 py-2.5 inline-flex items-center gap-2 w-full"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</div>}

      {/* Results */}
      {results && results.length > 0 && (
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t('result.count', { n: results.length })}</div>
          {results.map((r, i) => <ResultCard key={i} r={r} t={t} />)}
        </div>
      )}
    </div>
  );
}

function ResultCard({ r, t }: { r: OrderResult; t: any }) {
  const m = RES[r.result] || RES.not_found;
  const c = r.conditions;
  const conds: Array<[string, boolean | null]> = c
    ? [[t('cond.orderNo'), c.order], [t('field.account'), c.account], [t('field.amount'), c.amount], [t('field.contract'), c.contract], [t('field.date'), c.date]]
    : [];
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200/70 dark:ring-slate-800 overflow-hidden shadow-sm">
      <div className={cn('flex items-center gap-2 px-3.5 py-2.5 text-white', m.cls)}>
        <m.Icon className="h-4 w-4 shrink-0" />
        <span className="text-[13px] font-bold">{t(`result.${m.key}`)}</span>
        <span className="ml-auto font-mono font-bold tabular-nums text-[13px]">№ {r.orderNos[0]}{r.orderNos.length > 1 ? ` +${r.orderNos.length - 1}` : ''}</span>
      </div>
      <div className="p-3.5 space-y-2.5">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-slate-400">{t('field.amount')}</span>
          <span className="font-bold tabular-nums">{r.extracted.amount != null ? formatMoney(r.extracted.amount, '') : '—'} <span className="text-[10px] text-slate-400">{t('result.som')}</span></span>
        </div>
        {r.extracted.contractNo && (
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-slate-400">{t('field.contract')}</span>
            <span className="font-mono font-semibold">{r.matchedTx ? r.extracted.contractNo : r.extracted.contractNo}</span>
          </div>
        )}
        {conds.length > 0 && (
          <div className="pt-1 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{t('cond.title')}</div>
            {conds.map(([label, v], i) => (
              <div key={i} className="flex items-center justify-between text-[12.5px]">
                <span className="text-slate-500 dark:text-slate-400">{label}</span>
                <span className={cn('inline-flex items-center gap-1 font-semibold', v === true ? 'text-emerald-600 dark:text-emerald-400' : v === false ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400')}>
                  {v === true ? <CheckCircle2 className="h-3.5 w-3.5" /> : v === false ? <XCircle className="h-3.5 w-3.5" /> : <span className="w-3.5 text-center">—</span>}
                  {v === true ? t('condWord.match') : v === false ? t('condWord.mismatch') : t('condWord.notChecked')}
                </span>
              </div>
            ))}
          </div>
        )}
        {r.matchedTx && (
          <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-[12px] space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{t('tx.foundTitle')}</div>
            <div className="flex justify-between"><span className="text-slate-400">{t('field.amount')}</span><span className="font-semibold tabular-nums">{formatMoney(r.matchedTx.amount, '')} {r.matchedTx.currency}</span></div>
            <div className="flex justify-between gap-2"><span className="text-slate-400 shrink-0">{t('field.recipient')}</span><span className="text-right truncate">{r.matchedTx.toName || '—'}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}
