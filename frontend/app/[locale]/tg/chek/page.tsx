'use client';

// Telegram Mini App — Chek order "Tekshirish" (guruh a'zolari uchun, AdminUser'siz).
// Bot deep-link/Mini App orqali kirilsa initData → guest token → AYNAN
// webdagi Tekshirish UI (ChekCheck) ochiladi. Boshqa joydan → botga yo'naltirish.
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ShieldCheck, Send, RotateCcw, ScanLine, UserX, PowerOff, ShieldAlert } from 'lucide-react';
import { api, setToken } from '@/lib/api';
import { cn } from '@/lib/utils';
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
  const kind: 'gate' | 'not_member' | 'disabled' | 'other' =
    !err ? 'gate'
      : /a'zo emas|не состоите|not.*(member|group)|in the group/i.test(err) ? 'not_member'
        : /yoqilmagan|отключ|disabled|turned off/i.test(err) ? 'disabled'
          : 'other';

  const M = ({
    gate:       { grad: 'from-sky-500 via-cyan-500 to-blue-600', glow: 'bg-sky-400/30', eyebrowCls: 'text-sky-500', ringCls: 'ring-sky-100 dark:ring-sky-900/40', Icon: Send, eyebrow: t('tg.onlyTelegram'), title: t('tg.brand'), msg: t('tg.openHint') },
    not_member: { grad: 'from-amber-500 via-orange-500 to-rose-500', glow: 'bg-amber-400/30', eyebrowCls: 'text-amber-500', ringCls: 'ring-amber-100 dark:ring-amber-900/40', Icon: UserX, eyebrow: t('tg.denied'), title: t('tg.notMember'), msg: t('tg.notMemberHint') },
    disabled:   { grad: 'from-slate-400 via-slate-500 to-slate-600', glow: 'bg-slate-400/30', eyebrowCls: 'text-slate-500', ringCls: 'ring-slate-100 dark:ring-slate-800', Icon: PowerOff, eyebrow: t('tg.denied'), title: t('tg.disabled'), msg: t('tg.disabledHint') },
    other:      { grad: 'from-rose-500 via-red-500 to-rose-600', glow: 'bg-rose-400/30', eyebrowCls: 'text-rose-500', ringCls: 'ring-rose-100 dark:ring-rose-900/40', Icon: ShieldAlert, eyebrow: t('tg.denied'), title: t('tg.denied'), msg: err || t('tg.openHint') },
  } as const)[kind];

  return (
    <div className="min-h-[100dvh] grid place-items-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="relative rounded-[28px] bg-white/70 dark:bg-slate-900/60 backdrop-blur-xl ring-1 ring-slate-200/70 dark:ring-slate-800 shadow-[0_30px_80px_-28px_rgba(15,23,42,0.4)] px-7 py-9 text-center overflow-hidden">
          <div className={cn('absolute -top-20 left-1/2 -translate-x-1/2 w-56 h-56 rounded-full blur-3xl opacity-60 pointer-events-none', M.glow)} />
          <div className="relative">
            <div className="relative w-[84px] h-[84px] mx-auto mb-5">
              <span className={cn('absolute inset-0 rounded-[24px] blur-2xl opacity-80', M.glow)} />
              <div className={cn('relative w-[84px] h-[84px] rounded-[24px] bg-gradient-to-br grid place-items-center shadow-xl ring-[6px] ring-white/70 dark:ring-slate-900/70', M.grad)}>
                <M.Icon className="h-9 w-9 text-white" strokeWidth={2} />
              </div>
            </div>
            <div className={cn('text-[10.5px] font-bold uppercase tracking-[0.2em]', M.eyebrowCls)}>{M.eyebrow}</div>
            <h1 className="mt-2 text-[23px] font-extrabold tracking-tight text-slate-900 dark:text-slate-50 text-balance">{M.title}</h1>
            <p className="mt-2.5 text-[13.5px] text-slate-500 dark:text-slate-400 leading-relaxed">{M.msg}</p>

            <div className="mt-6">
              {kind === 'gate' && botLink ? (
                <a href={botLink} target="_blank" rel="noreferrer" className={cn('inline-flex items-center gap-2 h-12 px-7 rounded-2xl bg-gradient-to-r text-white text-[15px] font-bold shadow-lg active:scale-95 transition-transform', M.grad)}>
                  <Send className="h-4.5 w-4.5" /> Telegram orqali kirish
                </a>
              ) : onRetry ? (
                <button onClick={onRetry} className="inline-flex items-center gap-2 h-11 px-6 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[14px] font-semibold shadow-lg hover:opacity-90 active:scale-95 transition-all">
                  <RotateCcw className="h-4 w-4" /> {t('tg.retry')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5" /> {t('tg.secured')}</div>
      </div>
    </div>
  );
}
