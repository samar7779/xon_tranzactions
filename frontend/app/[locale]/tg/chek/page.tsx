'use client';

// Telegram Mini App — Chek order "Tekshirish" (guruh a'zolari uchun, AdminUser'siz).
// Bot deep-link/Mini App orqali kirilsa initData → guest token → AYNAN
// webdagi Tekshirish UI (ChekCheck) ochiladi. Boshqa joydan → botga yo'naltirish.
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ShieldCheck, Send, RotateCcw, ScanLine } from 'lucide-react';
import { api, setToken } from '@/lib/api';
import { ChekCheck, type OrderResult } from '@/components/chek-check';
import { ChekAssistant } from '@/components/chek-assistant';

export default function TgChekPage() {
  const t = useTranslations('chekOrder');
  const [phase, setPhase] = useState<'checking' | 'gate' | 'denied' | 'ready'>('checking');
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [botUsername, setBotUsername] = useState('');
  const [err, setErr] = useState('');
  const [results, setResults] = useState<OrderResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const done = (p: Promise<any>) => p
      .then((r) => { if (cancelled) return; setToken(r.token); setUser(r.user); setPhase('ready'); })
      .catch((e: any) => { if (cancelled) return; setErr(e?.message || ''); setPhase('denied'); });

    // 1) Botdan kelgan shaxsiy havola (?k=<token>)
    const k = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('k') : null;
    if (k) { done(api.post('/chek-order/tg/redeem', { token: k })); return () => { cancelled = true; }; }

    // 2) Mini App (Telegram WebApp ichida) — initData
    const gate = () => {
      api.get<{ botUsername: string }>('/chek-order/tg/public-config')
        .then((c) => { if (cancelled) return; setBotUsername(c?.botUsername || ''); setPhase('gate'); })
        .catch(() => { if (!cancelled) setPhase('gate'); });
    };
    const boot = () => {
      const wa = (window as any).Telegram?.WebApp;
      const initData: string = wa?.initData || '';
      if (initData) { try { wa.ready?.(); wa.expand?.(); } catch { /* skip */ } done(api.post('/chek-order/tg/auth', { initData })); return; }
      gate();
    };
    if ((window as any).Telegram?.WebApp) boot();
    else {
      const s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-web-app.js';
      s.async = true;
      s.onload = boot; s.onerror = boot;
      document.head.appendChild(s);
    }
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-50 to-indigo-50/40 dark:from-slate-950 dark:to-indigo-950/20 text-slate-800 dark:text-slate-100">
      {phase === 'checking' && <Checking label={t('tg.checking')} />}
      {phase === 'gate' && <Gate t={t} botUsername={botUsername} />}
      {phase === 'denied' && <Gate t={t} botUsername={botUsername} err={err} onRetry={() => window.location.reload()} />}
      {phase === 'ready' && (
        <>
          <div className="max-w-6xl mx-auto px-4 py-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center shadow-md shrink-0"><ScanLine className="h-5 w-5 text-white" /></div>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-bold leading-tight">{t('tg.brand')}</div>
                <div className="text-[11.5px] text-slate-400 truncate">{user?.name ? `${t('tg.welcome')}, ${user.name}` : t('subtitle')}</div>
              </div>
            </div>
            <ChekCheck guest onResultsChange={setResults} />
          </div>
          {/* AI yordamchi — muammo → murojaat (natija chiqganda ekran chekkasida) */}
          <ChekAssistant
            context={{ orders: (results || []).map((r) => ({
              orderNos: r.orderNos,
              contractNo: r.matchedTx?.contractNumber || r.extracted.contractNo,
              docContractNo: r.extracted.contractNo,
              amount: r.extracted.amount,
              result: r.result,
              matchedTxExtId: r.matchedTx?.externalId,
            })) }}
            visible={!!results && results.length > 0}
          />
        </>
      )}
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

function Gate({ t, botUsername, err, onRetry }: { t: any; botUsername: string; err?: string; onRetry?: () => void }) {
  const uname = (botUsername || '').replace(/^@/, '');
  const botLink = uname ? `https://t.me/${uname}?start=chek` : '';
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
          <h1 className="mt-1.5 text-[22px] font-extrabold tracking-tight">{err ? t('tg.denied') : t('tg.brand')}</h1>
          <p className="mt-2 text-[13.5px] text-slate-500 dark:text-slate-400 leading-relaxed">{err || t('tg.openHint')}</p>
        </div>
        {botLink ? (
          <a href={botLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 h-12 px-7 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-[15px] font-bold shadow-lg shadow-sky-500/30 active:scale-95 transition-transform">
            <Send className="h-4.5 w-4.5" /> Telegram orqali kirish
          </a>
        ) : onRetry ? (
          <button onClick={onRetry} className="inline-flex items-center gap-2 h-11 px-6 rounded-2xl bg-gradient-to-r from-sky-600 to-blue-600 text-white text-[14px] font-semibold shadow-lg shadow-sky-500/25 active:scale-95 transition-transform">
            <RotateCcw className="h-4 w-4" /> {t('tg.retry')}
          </button>
        ) : null}
        <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 pt-2"><ShieldCheck className="h-3.5 w-3.5" /> {t('tg.secured')}</div>
      </div>
    </div>
  );
}
