'use client';
// Sverka AI — OMMAVIY tahlil: barcha farqli hisoblarni ketma-ket tahlil qilib,
// yondan ochiladigan pro drawer'da to'liq ko'rsatadi va tuzatishni taklif qiladi.

import { useState, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Sparkles, Loader2, CheckCircle2, AlertTriangle, ChevronDown, Wand2,
  Download, CalendarClock, Scale, ShieldAlert, Lightbulb, ListChecks,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CULPRIT_META, ActionGroup, ItemRow, m, type AnalyzeResult, type Culprit } from './_sverka-agent';

interface AccountInput {
  accountId: string;
  accountNo?: string;
  bankName?: string | null;
  ownerName?: string | null;
  diff?: { credit?: number; debit?: number; formula?: number };
}

type Sel = { addMissing: boolean; fixDates: boolean; fixAmounts: boolean };
type CardState = {
  status: 'pending' | 'analyzing' | 'done' | 'error' | 'applying' | 'applied';
  res?: AnalyzeResult;
  error?: string;
  sel: Sel;
  applied?: any;
};

const emptySel: Sel = { addMissing: false, fixDates: false, fixAmounts: false };

function hasFix(res?: AnalyzeResult): boolean {
  const p = res?.proposed;
  return !!p && (p.addMissing.length > 0 || p.fixDates.length > 0 || p.fixAmounts.length > 0);
}
function selCount(c: CardState): number {
  const p = c.res?.proposed;
  if (!p) return 0;
  return (c.sel.addMissing ? p.addMissing.length : 0)
    + (c.sel.fixDates ? p.fixDates.length : 0)
    + (c.sel.fixAmounts ? p.fixAmounts.length : 0);
}
const accDiff = (a: AccountInput) => Math.abs(a.diff?.credit || 0) + Math.abs(a.diff?.debit || 0);

export function SverkaAgentBatch({
  accounts, date, onClose, onUpdated,
}: {
  accounts: AccountInput[];
  date: string;
  onClose: () => void;
  onUpdated: (accountId: string, rec: any) => void;
}) {
  const t = useTranslations('sverkaAgent');
  const locale = useLocale();
  const qc = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [cards, setCards] = useState<Record<string, CardState>>(() =>
    Object.fromEntries(accounts.map((a) => [a.accountId, { status: 'pending' as const, sel: { ...emptySel } }])),
  );
  const [expand, setExpand] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(true);
  const [fixingAll, setFixingAll] = useState(false);

  useEffect(() => { setMounted(true); requestAnimationFrame(() => setShown(true)); }, []);

  // ── Ketma-ket tahlil (natijalar kelib tushadi) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const a of accounts) {
        if (cancelled) return;
        setCards((c) => ({ ...c, [a.accountId]: { ...c[a.accountId], status: 'analyzing' } }));
        try {
          const r = await api.post<AnalyzeResult>(
            '/transactions/reconcile/agent/analyze',
            { accountId: a.accountId, date, locale },
            { timeout: 120_000 },
          );
          if (cancelled) return;
          const act = r.diagnosis?.actions || {};
          const p = r.proposed;
          const sel: Sel = {
            addMissing: !!p?.addMissing.length && act.addMissing !== 'skip',
            fixDates: !!p?.fixDates.length && act.fixDates !== 'skip',
            fixAmounts: !!p?.fixAmounts.length && act.fixAmounts === 'recommend',
          };
          setCards((c) => ({ ...c, [a.accountId]: { ...c[a.accountId], status: 'done', res: r, sel } }));
          if (r.status === 'ok' && r.rec) onUpdated(a.accountId, r.rec); // sync-first hal qilgan bo'lsa
        } catch (e: any) {
          if (cancelled) return;
          setCards((c) => ({ ...c, [a.accountId]: { ...c[a.accountId], status: 'error', error: e?.message || t('error') } }));
        }
      }
      if (!cancelled) setRunning(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !fixingAll) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, fixingAll]);

  const list = accounts.map((a) => ({ a, c: cards[a.accountId] }));
  const doneCount = list.filter(({ c }) => c && c.status !== 'pending' && c.status !== 'analyzing').length;
  const fixableCount = list.filter(({ c }) => c && hasFix(c.res) && c.status !== 'applied').length;
  const totalDiff = accounts.reduce((s, a) => s + accDiff(a), 0);
  const totalSelected = Object.values(cards).reduce((s, c) => s + (c.status !== 'applied' ? selCount(c) : 0), 0);

  function toggleSel(accountId: string, key: keyof Sel) {
    setCards((c) => ({ ...c, [accountId]: { ...c[accountId], sel: { ...c[accountId].sel, [key]: !c[accountId].sel[key] } } }));
  }

  async function applyOne(accountId: string): Promise<boolean> {
    const c = cards[accountId];
    if (!c?.res?.proposed) return false;
    if (!c.sel.addMissing && !c.sel.fixDates && !c.sel.fixAmounts) return false;
    setCards((s) => ({ ...s, [accountId]: { ...s[accountId], status: 'applying' } }));
    try {
      // which(bool) — server fresh diagnose'dan target quradi (stale emas, race-safe)
      const r = await api.post<any>('/transactions/reconcile/agent/apply', { accountId, date, which: c.sel }, { timeout: 120_000 });
      setCards((s) => ({ ...s, [accountId]: { ...s[accountId], status: 'applied', applied: r } }));
      qc.invalidateQueries({ queryKey: ['reconcile-today'] });
      if (r.rec) onUpdated(accountId, r.rec);
      return true;
    } catch (e: any) {
      toast.error(e?.message || t('error'));
      setCards((s) => ({ ...s, [accountId]: { ...s[accountId], status: 'done' } }));
      return false;
    }
  }

  async function applyAll() {
    setFixingAll(true);
    let ok = 0;
    for (const { a, c } of list) {
      if (c && c.res && c.status !== 'applied' && selCount(c) > 0) {
        if (await applyOne(a.accountId)) ok++;
      }
    }
    setFixingAll(false);
    if (ok > 0) toast.success(t('applied'));
  }

  if (!mounted) return null;

  const drawer = (
    <div className="fixed inset-0 z-[60] flex justify-end" onClick={() => !fixingAll && onClose()}>
      <div className={cn('absolute inset-0 bg-slate-900/60 transition-opacity duration-300', shown ? 'opacity-100' : 'opacity-0')} />
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative h-full w-full md:w-[56%] md:min-w-[760px] max-w-[980px] bg-slate-50 dark:bg-slate-950 shadow-2xl flex flex-col transition-transform duration-300 ease-out',
          shown ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* ═══ Header ═══ */}
        <div className="relative overflow-hidden shrink-0 bg-gradient-to-br from-violet-600 via-fuchsia-600 to-indigo-700 text-white">
          <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
          <div className="relative px-5 py-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 ring-1 ring-white/25 grid place-items-center shrink-0 backdrop-blur">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-bold leading-tight">{t('batchTitle')}</div>
              <div className="text-[12px] text-white/80">{t('batchSubtitle', { n: accounts.length })}</div>
            </div>
            <button onClick={() => !fixingAll && onClose()} className="w-9 h-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 transition shrink-0" aria-label="close">
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
          {/* Progress */}
          <div className="relative h-1 bg-white/15">
            <div className="h-full bg-white/80 transition-all duration-500" style={{ width: `${accounts.length ? (doneCount / accounts.length) * 100 : 0}%` }} />
          </div>
        </div>

        {/* ═══ Summary strip ═══ */}
        <div className="shrink-0 grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
          <Stat icon={<ListChecks className="h-3.5 w-3.5" />} label={t('statAnalyzed')} value={`${doneCount}/${accounts.length}`} spin={running} />
          <Stat icon={<Wand2 className="h-3.5 w-3.5" />} label={t('statFixable')} value={String(fixableCount)} tone="violet" />
          <Stat icon={<AlertTriangle className="h-3.5 w-3.5" />} label={t('statTotalDiff')} value={m(totalDiff)} tone="amber" />
        </div>

        {/* ═══ Cards ═══ */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {list.map(({ a, c }) => (
            <BatchCard
              key={a.accountId}
              a={a} c={c} t={t}
              expanded={!!expand[a.accountId]}
              onExpand={() => setExpand((e) => ({ ...e, [a.accountId]: !e[a.accountId] }))}
              onToggleSel={(k) => toggleSel(a.accountId, k)}
              onApply={() => applyOne(a.accountId)}
              grpExpand={expand}
              setGrpExpand={setExpand}
            />
          ))}
        </div>

        {/* ═══ Footer ═══ */}
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
          <button
            onClick={applyAll}
            disabled={fixingAll || totalSelected === 0}
            className="w-full h-12 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white text-[14px] font-bold shadow-lg shadow-violet-500/25 active:scale-[0.99] transition disabled:opacity-50 disabled:active:scale-100 inline-flex items-center justify-center gap-2"
          >
            {fixingAll
              ? <><Loader2 className="h-4.5 w-4.5 animate-spin" /> {t('applyingAll')}</>
              : <><Wand2 className="h-4.5 w-4.5" /> {t('fixAllAccounts')}{totalSelected > 0 ? ` · ${totalSelected}` : ''}</>}
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(drawer, document.body);
}

function Stat({ icon, label, value, tone, spin }: { icon: React.ReactNode; label: string; value: string; tone?: 'violet' | 'amber'; spin?: boolean }) {
  const c = tone === 'violet' ? 'text-violet-600 dark:text-violet-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300';
  return (
    <div className="px-3 py-2.5 text-center">
      <div className="flex items-center justify-center gap-1 text-[9.5px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">
        {spin ? <Loader2 className="h-3 w-3 animate-spin" /> : icon}{label}
      </div>
      <div className={cn('text-[15px] font-bold tabular-nums mt-0.5', c)}>{value}</div>
    </div>
  );
}

function BatchCard({
  a, c, t, expanded, onExpand, onToggleSel, onApply, grpExpand, setGrpExpand,
}: {
  a: AccountInput; c: CardState; t: any;
  expanded: boolean; onExpand: () => void;
  onToggleSel: (k: keyof Sel) => void; onApply: () => void;
  grpExpand: Record<string, boolean>; setGrpExpand: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const st = c?.status || 'pending';
  const d = c?.res?.diagnosis;
  const p = c?.res?.proposed;
  const culprit = (d?.culprit || 'unknown') as Culprit;
  const cm = CULPRIT_META[culprit] || CULPRIT_META.unknown;
  const applied = c?.applied;
  const nowOk = applied?.rec?.status === 'ok';
  const newDiff = applied?.rec?.diff ? Math.abs(applied.rec.diff.credit || 0) + Math.abs(applied.rec.diff.debit || 0) : null;
  const canFix = hasFix(c?.res) && st !== 'applied';

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
      {/* Card header */}
      <button onClick={onExpand} className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-slate-900 dark:text-slate-100 truncate">{a.bankName || '—'}</span>
            <code className="text-[10.5px] font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{a.accountNo}</code>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{a.ownerName || '—'}</div>
          {/* Collapsed: qisqa xulosa */}
          {st === 'done' && d?.summary && !expanded && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-1">{d.summary}</div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[12px] font-bold text-amber-700 dark:text-amber-300 tabular-nums">{m(accDiff(a))}</span>
          {/* Status */}
          {st === 'pending' && <span className="text-[10px] text-slate-400">{t('pending')}</span>}
          {st === 'analyzing' && <span className="inline-flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400"><Loader2 className="h-3 w-3 animate-spin" />{t('analyzing')}</span>}
          {(st === 'done' || st === 'applying') && d && (
            <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded ring-1 text-[10px] font-bold', cm.cls)}>
              <cm.Icon className="h-3 w-3" />{t(`culprit_${culprit}` as any)}
            </span>
          )}
          {st === 'applied' && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />{nowOk ? t('nowMatches') : `${t('newDiff')} ${m(newDiff || 0)}`}
            </span>
          )}
          {st === 'error' && <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400"><AlertTriangle className="h-3 w-3" />{t('error')}</span>}
        </div>
        <ChevronDown className={cn('h-4 w-4 text-slate-400 shrink-0 transition-transform', expanded && 'rotate-180')} />
      </button>

      {/* Expanded */}
      {expanded && (st === 'done' || st === 'applying' || st === 'applied') && d && p && (
        <div className="border-t border-slate-100 dark:border-slate-800 p-3.5 space-y-3">
          <p className="text-[12.5px] leading-relaxed text-slate-800 dark:text-slate-200">{d.summary}</p>

          {d.findings?.length > 0 && (
            <div className="space-y-1.5">
              {d.findings.map((f: any, i: number) => (
                <div key={i} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 ring-1 ring-slate-200 dark:ring-slate-700 p-2">
                  <div className="text-[11.5px] font-semibold text-slate-800 dark:text-slate-200">{f.title}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{f.detail}</div>
                </div>
              ))}
            </div>
          )}

          {d.recommendation && (
            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-200 dark:ring-indigo-900 p-2.5 flex items-start gap-2">
              <Lightbulb className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
              <div className="text-[12px] text-slate-800 dark:text-slate-200">{d.recommendation}</div>
            </div>
          )}
          {d.cautionNote && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 p-2.5 text-[11.5px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><div>{d.cautionNote}</div>
            </div>
          )}

          {/* Action groups */}
          {(p.addMissing.length > 0 || p.fixDates.length > 0 || p.fixAmounts.length > 0) && st !== 'applied' && (
            <div className="space-y-2">
              {p.addMissing.length > 0 && (
                <ActionGroup keyName={`${a.accountId}:add`} Icon={Download} tone="indigo" title={t('groupAddMissing')}
                  count={p.addMissing.length} total={p.addMissing.reduce((s: number, i: any) => s + i.amount, 0)}
                  rec={d.actions.addMissing} checked={c.sel.addMissing} onToggle={() => onToggleSel('addMissing')}
                  expanded={!!grpExpand[`${a.accountId}:add`]} onExpand={() => setGrpExpand((e) => ({ ...e, [`${a.accountId}:add`]: !e[`${a.accountId}:add`] }))} t={t}>
                  {p.addMissing.map((i: any, k: number) => <ItemRow key={k} dir={i.direction} amount={i.amount} doc={i.docNumber} name={i.name} note={i.purpose} />)}
                </ActionGroup>
              )}
              {p.fixDates.length > 0 && (
                <ActionGroup keyName={`${a.accountId}:date`} Icon={CalendarClock} tone="emerald" title={t('groupFixDates')}
                  count={p.fixDates.length} total={p.fixDates.reduce((s: number, i: any) => s + i.amount, 0)}
                  rec={d.actions.fixDates} checked={c.sel.fixDates} onToggle={() => onToggleSel('fixDates')}
                  expanded={!!grpExpand[`${a.accountId}:date`]} onExpand={() => setGrpExpand((e) => ({ ...e, [`${a.accountId}:date`]: !e[`${a.accountId}:date`] }))} t={t}>
                  {p.fixDates.map((i: any, k: number) => <ItemRow key={k} dir={i.direction} amount={i.amount} doc={i.docNumber} name={i.name} note={`${i.fromDate} → ${i.newDate}`} />)}
                </ActionGroup>
              )}
              {p.fixAmounts.length > 0 && (
                <ActionGroup keyName={`${a.accountId}:amt`} Icon={Scale} tone="orange" title={t('groupFixAmounts')}
                  count={p.fixAmounts.length} total={p.fixAmounts.reduce((s: number, i: any) => s + Math.abs(i.diff), 0)}
                  rec={d.actions.fixAmounts} checked={c.sel.fixAmounts} onToggle={() => onToggleSel('fixAmounts')}
                  expanded={!!grpExpand[`${a.accountId}:amt`]} onExpand={() => setGrpExpand((e) => ({ ...e, [`${a.accountId}:amt`]: !e[`${a.accountId}:amt`] }))} t={t}>
                  {p.fixAmounts.map((i: any, k: number) => <ItemRow key={k} dir={i.direction} amount={i.bankAmount} doc={i.docNumber} name={i.name} note={t('amountBankVsDb', { bank: m(i.bankAmount), db: m(i.dbAmount) })} />)}
                </ActionGroup>
              )}
            </div>
          )}

          {p.unresolved?.length > 0 && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-slate-400" />{t('groupUnresolved')} · {p.unresolved.length}
            </div>
          )}

          {/* Per-account apply */}
          {canFix && (
            <button
              onClick={onApply}
              disabled={st === 'applying' || (!c.sel.addMissing && !c.sel.fixDates && !c.sel.fixAmounts)}
              className="w-full h-10 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[12.5px] font-bold transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {st === 'applying' ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('applying')}</> : <><CheckCircle2 className="h-4 w-4" /> {t('applyBtn')}</>}
            </button>
          )}
          {st === 'applied' && (
            <div className={cn('rounded-xl p-2.5 text-[12px] font-semibold flex items-center gap-2', nowOk ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300')}>
              {nowOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {nowOk ? t('nowMatches') : `${t('newDiff')}: ${m(newDiff || 0)}`}
            </div>
          )}
        </div>
      )}

      {/* Expanded but not fixable / error */}
      {expanded && st === 'error' && (
        <div className="border-t border-slate-100 dark:border-slate-800 p-3.5 text-[12px] text-rose-700 dark:text-rose-300">{c?.error || t('error')}</div>
      )}
    </div>
  );
}
