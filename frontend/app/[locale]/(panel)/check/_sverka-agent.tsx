'use client';
// Sverka AI agenti — farq sababini tushuntiradi, aybni (bank/biz) tasniflaydi,
// tuzatishni taklif qiladi. Foydalanuvchi tasdiqlab bajaradi (avto-tuzatish).

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Sparkles, Loader2, ShieldAlert, Building2, UserCog, GitFork, CheckCircle2,
  Lightbulb, ChevronDown, Download, CalendarClock, Scale, AlertTriangle, Wand2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

type Culprit = 'bank' | 'us' | 'mixed' | 'none' | 'unknown';
type Rec = 'recommend' | 'caution' | 'skip';

interface Finding { title: string; culprit?: string; detail: string }
interface Diagnosis {
  summary: string; culprit: Culprit; severity: string;
  findings: Finding[]; recommendation: string;
  actions: { addMissing?: Rec; fixDates?: Rec; fixAmounts?: Rec };
  cautionNote: string;
}
interface AddItem { b2Id: string | null; generalId: string | null; amount: number; direction: string | null; docNumber: string | null; name: string | null; purpose: string | null }
interface DateItem { txId: string; newDate: string; fromDate: string; amount: number; direction: string | null; docNumber: string | null; name: string | null }
interface AmtItem { txId: string; newAmount: number; dbAmount: number; bankAmount: number; diff: number; direction: string | null; docNumber: string | null; name: string | null; purpose: string | null }
interface UnresItem { txId: string | null; amount: number; direction: string | null; docNumber: string | null; name: string | null; purpose: string | null }
interface Proposed { addMissing: AddItem[]; fixDates: DateItem[]; fixAmounts: AmtItem[]; unresolved: UnresItem[] }
interface AnalyzeResult {
  ok: true; status: 'ok' | 'mismatch' | 'error'; error?: string;
  diagnosis: Diagnosis | null; proposed: Proposed | null; rec?: any;
}

const CULPRIT_META: Record<Culprit, { cls: string; Icon: any }> = {
  bank:    { cls: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900', Icon: Building2 },
  us:      { cls: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 ring-sky-200 dark:ring-sky-900', Icon: UserCog },
  mixed:   { cls: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900', Icon: GitFork },
  none:    { cls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900', Icon: CheckCircle2 },
  unknown: { cls: 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 ring-slate-200 dark:ring-slate-700', Icon: ShieldAlert },
};

const m = (n: number) => formatMoney(Number(n || 0)).replace(' UZS', '');

export function SverkaAgentPanel({
  accountId, date, onApplied,
}: {
  accountId: string;
  date: string;
  onApplied?: (rec: any) => void;
}) {
  const t = useTranslations('sverkaAgent');
  const locale = useLocale();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<AnalyzeResult | null>(null);
  const [sel, setSel] = useState({ addMissing: false, fixDates: false, fixAmounts: false });
  const [expand, setExpand] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<any>(null);

  async function analyze() {
    setLoading(true);
    setApplied(null);
    try {
      // Og'ir amal: reconcile + diagnose (bank chaqiruvlari) + Claude — timeout uzun
      const r = await api.post<AnalyzeResult>('/transactions/reconcile/agent/analyze', { accountId, date, locale }, { timeout: 120_000 });
      setRes(r);
      const a = r.diagnosis?.actions || {};
      const p = r.proposed;
      // Agent tavsiyasiga qarab guruhlarni oldindan belgilaymiz (summa faqat "recommend"da)
      setSel({
        addMissing: !!p?.addMissing.length && a.addMissing !== 'skip',
        fixDates: !!p?.fixDates.length && a.fixDates !== 'skip',
        fixAmounts: !!p?.fixAmounts.length && a.fixAmounts === 'recommend',
      });
    } catch (e: any) {
      toast.error(e?.message || t('error'));
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!res?.proposed) return;
    const p = res.proposed;
    const groups: any = {};
    if (sel.addMissing && p.addMissing.length) {
      groups.addMissing = p.addMissing.map((i) => ({ b2Id: i.b2Id, generalId: i.generalId }));
    }
    if (sel.fixDates && p.fixDates.length) {
      groups.fixDates = p.fixDates.map((i) => ({ txId: i.txId, newDate: i.newDate }));
    }
    if (sel.fixAmounts && p.fixAmounts.length) {
      groups.fixAmounts = p.fixAmounts.map((i) => ({ txId: i.txId, newAmount: i.newAmount }));
    }
    if (!Object.keys(groups).length) { toast.error(t('applyNothing')); return; }

    setApplying(true);
    try {
      const r = await api.post<any>('/transactions/reconcile/agent/apply', { accountId, date, groups }, { timeout: 120_000 });
      setApplied(r);
      qc.invalidateQueries({ queryKey: ['reconcile-today'] });
      onApplied?.(r.rec);
      toast.success(t('applied'));
      // Natijani yangilash uchun qayta tahlil
      analyze();
    } catch (e: any) {
      toast.error(e?.message || t('error'));
    } finally {
      setApplying(false);
    }
  }

  // ── Boshlang'ich holat: tahlil tugmasi ──
  if (!res) {
    return (
      <div className="rounded-2xl overflow-hidden ring-1 ring-violet-200/70 dark:ring-violet-900/60 bg-gradient-to-br from-violet-50 via-fuchsia-50/50 to-indigo-50 dark:from-violet-950/30 dark:via-fuchsia-950/20 dark:to-indigo-950/30">
        <div className="p-4 flex items-center gap-3.5">
          <div className="relative w-11 h-11 shrink-0">
            <span className="absolute inset-0 rounded-2xl bg-violet-500/30 blur-lg" />
            <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-indigo-600 grid place-items-center shadow-lg shadow-violet-500/30">
              <Sparkles className="h-5 w-5 text-white" strokeWidth={2.2} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold text-slate-900 dark:text-slate-100">{t('title')}</div>
            <div className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-snug">{t('subtitle')}</div>
          </div>
          <button
            onClick={analyze}
            disabled={loading}
            className="shrink-0 inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white text-[12.5px] font-semibold shadow-md shadow-violet-500/25 active:scale-95 transition disabled:opacity-60"
          >
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('analyzing')}</> : <><Wand2 className="h-4 w-4" /> {t('analyzeBtn')}</>}
          </button>
        </div>
      </div>
    );
  }

  if (res.status === 'error') {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 p-4 text-[12px] text-rose-800 dark:text-rose-300 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div>{res.error || t('error')}</div>
      </div>
    );
  }

  const d = res.diagnosis!;
  const p = res.proposed!;
  const cm = CULPRIT_META[d.culprit] || CULPRIT_META.unknown;
  const newDiff = applied?.rec?.diff ? Math.abs(applied.rec.diff.credit || 0) + Math.abs(applied.rec.diff.debit || 0) : null;
  const nowOk = applied?.rec?.status === 'ok';

  return (
    <div className="rounded-2xl overflow-hidden ring-1 ring-violet-200/70 dark:ring-violet-900/60 bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 bg-gradient-to-r from-violet-50 to-fuchsia-50/60 dark:from-violet-950/40 dark:to-fuchsia-950/20 border-b border-violet-100 dark:border-violet-900/60">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 grid place-items-center shadow-md shadow-violet-500/30 shrink-0">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div className="text-[13px] font-bold text-slate-900 dark:text-slate-100 flex-1">{t('title')}</div>
        <button
          onClick={analyze}
          disabled={loading}
          className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 hover:underline disabled:opacity-60 inline-flex items-center gap-1"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          {t('reanalyze')}
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Ayb (culprit) + xulosa */}
        <div className="flex items-start gap-3">
          <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ring-1 text-[11.5px] font-bold shrink-0', cm.cls)}>
            <cm.Icon className="h-3.5 w-3.5" />
            {t(`culprit_${d.culprit}` as any)}
          </span>
          <p className="text-[13px] leading-relaxed text-slate-800 dark:text-slate-200 flex-1">{d.summary}</p>
        </div>

        {/* Findings */}
        {d.findings.length > 0 && (
          <div className="space-y-2">
            {d.findings.map((f, i) => (
              <div key={i} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 ring-1 ring-slate-200 dark:ring-slate-700 p-2.5">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800 dark:text-slate-200">
                  {f.culprit === 'bank' ? <Building2 className="h-3.5 w-3.5 text-rose-500" />
                    : f.culprit === 'us' ? <UserCog className="h-3.5 w-3.5 text-sky-500" />
                    : <ShieldAlert className="h-3.5 w-3.5 text-slate-400" />}
                  {f.title}
                </div>
                <div className="text-[11.5px] text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">{f.detail}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tavsiya */}
        {d.recommendation && (
          <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-200 dark:ring-indigo-900 p-3 flex items-start gap-2">
            <Lightbulb className="h-4 w-4 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">{t('recommendation')}</div>
              <div className="text-[12.5px] text-slate-800 dark:text-slate-200 mt-0.5 leading-snug">{d.recommendation}</div>
            </div>
          </div>
        )}

        {/* Ehtiyot */}
        {d.cautionNote && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 p-3 flex items-start gap-2 text-[12px] text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div><b>{t('caution')}:</b> {d.cautionNote}</div>
          </div>
        )}

        {/* Taklif qilingan tuzatishlar */}
        {(p.addMissing.length > 0 || p.fixDates.length > 0 || p.fixAmounts.length > 0) && (
          <div className="space-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('proposedTitle')}</div>

            {p.addMissing.length > 0 && (
              <ActionGroup
                keyName="addMissing" Icon={Download} tone="indigo"
                title={t('groupAddMissing')} count={p.addMissing.length}
                total={p.addMissing.reduce((s, i) => s + i.amount, 0)}
                rec={d.actions.addMissing} checked={sel.addMissing}
                onToggle={() => setSel((s) => ({ ...s, addMissing: !s.addMissing }))}
                expanded={!!expand.addMissing} onExpand={() => setExpand((e) => ({ ...e, addMissing: !e.addMissing }))}
                t={t}
              >
                {p.addMissing.map((i, k) => (
                  <ItemRow key={k} dir={i.direction} amount={i.amount} doc={i.docNumber} name={i.name} note={i.purpose} />
                ))}
              </ActionGroup>
            )}

            {p.fixDates.length > 0 && (
              <ActionGroup
                keyName="fixDates" Icon={CalendarClock} tone="emerald"
                title={t('groupFixDates')} count={p.fixDates.length}
                total={p.fixDates.reduce((s, i) => s + i.amount, 0)}
                rec={d.actions.fixDates} checked={sel.fixDates}
                onToggle={() => setSel((s) => ({ ...s, fixDates: !s.fixDates }))}
                expanded={!!expand.fixDates} onExpand={() => setExpand((e) => ({ ...e, fixDates: !e.fixDates }))}
                t={t}
              >
                {p.fixDates.map((i, k) => (
                  <ItemRow key={k} dir={i.direction} amount={i.amount} doc={i.docNumber} name={i.name}
                    note={`${i.fromDate} → ${i.newDate}`} />
                ))}
              </ActionGroup>
            )}

            {p.fixAmounts.length > 0 && (
              <ActionGroup
                keyName="fixAmounts" Icon={Scale} tone="orange"
                title={t('groupFixAmounts')} count={p.fixAmounts.length}
                total={p.fixAmounts.reduce((s, i) => s + Math.abs(i.diff), 0)}
                rec={d.actions.fixAmounts} checked={sel.fixAmounts}
                onToggle={() => setSel((s) => ({ ...s, fixAmounts: !s.fixAmounts }))}
                expanded={!!expand.fixAmounts} onExpand={() => setExpand((e) => ({ ...e, fixAmounts: !e.fixAmounts }))}
                t={t}
              >
                {p.fixAmounts.map((i, k) => (
                  <ItemRow key={k} dir={i.direction} amount={i.bankAmount} doc={i.docNumber} name={i.name}
                    note={t('amountBankVsDb', { bank: m(i.bankAmount), db: m(i.dbAmount) })} />
                ))}
              </ActionGroup>
            )}
          </div>
        )}

        {/* Hal qilib bo'lmaydigan */}
        {p.unresolved.length > 0 && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 ring-1 ring-slate-200 dark:ring-slate-700 p-3">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-700 dark:text-slate-300">
              <ShieldAlert className="h-4 w-4 text-slate-400" />
              {t('groupUnresolved')} · {p.unresolved.length}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t('groupUnresolvedHint')}</div>
          </div>
        )}

        {/* Natija (apply'dan keyin) */}
        {applied && (
          <div className={cn(
            'rounded-lg p-3 ring-1 flex items-center gap-2 text-[12.5px] font-semibold',
            nowOk ? 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-800 dark:text-emerald-300'
              : 'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900 text-amber-800 dark:text-amber-300',
          )}>
            {nowOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {nowOk ? t('nowMatches') : `${t('newDiff')}: ${m(newDiff || 0)}`}
          </div>
        )}

        {/* Bajarish tugmasi */}
        {(p.addMissing.length > 0 || p.fixDates.length > 0 || p.fixAmounts.length > 0) && (
          <button
            onClick={apply}
            disabled={applying || (!sel.addMissing && !sel.fixDates && !sel.fixAmounts)}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white text-[13px] font-bold shadow-md shadow-violet-500/25 active:scale-[0.99] transition disabled:opacity-50 disabled:active:scale-100 inline-flex items-center justify-center gap-2"
          >
            {applying ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('applying')}</> : <><CheckCircle2 className="h-4 w-4" /> {t('applyBtn')}</>}
          </button>
        )}
      </div>
    </div>
  );
}

function ActionGroup({
  keyName, Icon, tone, title, count, total, rec, checked, onToggle, expanded, onExpand, t, children,
}: {
  keyName: string; Icon: any; tone: 'indigo' | 'emerald' | 'orange';
  title: string; count: number; total: number; rec?: Rec;
  checked: boolean; onToggle: () => void; expanded: boolean; onExpand: () => void;
  t: any; children: React.ReactNode;
}) {
  const toneRing = tone === 'indigo' ? 'ring-indigo-200 dark:ring-indigo-900' : tone === 'emerald' ? 'ring-emerald-200 dark:ring-emerald-900' : 'ring-orange-200 dark:ring-orange-900';
  const toneIcon = tone === 'indigo' ? 'text-indigo-600 dark:text-indigo-400' : tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400';
  const recMeta: Record<Rec, { cls: string; label: string }> = {
    recommend: { cls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40', label: t('rec_recommend') },
    caution: { cls: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40', label: t('rec_caution') },
    skip: { cls: 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800', label: t('rec_skip') },
  };
  const rm = rec ? recMeta[rec] : null;
  return (
    <div className={cn('rounded-xl ring-1 bg-white dark:bg-slate-900 overflow-hidden', toneRing)}>
      <div className="flex items-center gap-2.5 p-2.5">
        <label className="flex items-center gap-2.5 flex-1 cursor-pointer min-w-0">
          <input
            type="checkbox" checked={checked} onChange={onToggle}
            className="w-4.5 h-4.5 rounded accent-violet-600 shrink-0"
          />
          <Icon className={cn('h-4 w-4 shrink-0', toneIcon)} />
          <span className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 truncate">{title}</span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">· {count}</span>
        </label>
        {rm && <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0', rm.cls)}>{rm.label}</span>}
        <span className="text-[11.5px] font-bold tabular-nums text-slate-700 dark:text-slate-300 shrink-0">{m(total)}</span>
        <button onClick={onExpand} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
          <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-50 dark:divide-slate-800/60 max-h-[240px] overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}

function ItemRow({ dir, amount, doc, name, note }: {
  dir: string | null; amount: number; doc: string | null; name: string | null; note: string | null;
}) {
  return (
    <div className="px-3 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className={cn('font-bold tabular-nums', dir === 'IN' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>
          {dir === 'IN' ? '+' : '−'}{m(amount)}
        </span>
        {doc && <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">#{doc}</span>}
      </div>
      {name && <div className="text-slate-600 dark:text-slate-300 truncate mt-0.5">{name}</div>}
      {note && <div className="text-[10.5px] text-slate-400 dark:text-slate-500 truncate mt-0.5">{note}</div>}
    </div>
  );
}
