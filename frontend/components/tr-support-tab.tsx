'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowRight, Bot, Calendar, CheckCircle2, ChevronRight, Copy, FileSignature, KeyRound, Loader2, Lock,
  RotateCcw, Search, Undo2, UserCheck, Wallet, X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

/**
 * TR Support — Telegram agenti (@TRanSupport_bot) orqali, egasi tasdig'i bilan qilingan to'lov tahrirlari.
 * Kirish kodi server tomonda tekshiriladi (POST /tr-support/unlock). Kod shu brauzer sessiyasida eslab qolinadi.
 * Jadval: har tahrir — bitta ixcham qator; qatorga bosilsa to'liq ma'lumot oynasi (oldin/keyin, ID, sync, qaytarish).
 * "Ortga qaytarish" to'lovni oldingi holatiga qaytaradi va OplatyKv sync'ni bir marta ishga tushiradi.
 */

type State = {
  categoryName: string | null; subcategoryName: string | null; contractNumber: string | null;
  isContractManual?: boolean;
};
type Edit = {
  id: string; batchId: string; txId: string; txExternalId: string | null; txDate: string | null;
  amount: number | null; direction: string | null; before: State; after: State; changed: string[];
  approvedBy: string; comment: string | null; requestedBy: string | null;
  status: 'applied' | 'failed' | 'rolled_back'; error: string | null; syncResult: any;
  rolledBackAt: string | null; rolledBackBy: string | null; rollbackNote: string | null; createdAt: string;
};

const SS_KEY = 'trsupport.code';
const FIELDS = ['kontragent', 'kategoriya', 'shartnoma'] as const;
const FIELD_LABEL: Record<string, string> = { kontragent: 'Kontragent', kategoriya: 'Kategoriya', shartnoma: 'Shartnoma' };
const valOf = (s: State | null | undefined, f: string) =>
  (f === 'kontragent' ? s?.categoryName : f === 'kategoriya' ? s?.subcategoryName : s?.contractNumber) || null;

function readCode(): string | null {
  try { return window.sessionStorage.getItem(SS_KEY); } catch { return null; }
}
function saveCode(v: string | null) {
  try { if (v) window.sessionStorage.setItem(SS_KEY, v); else window.sessionStorage.removeItem(SS_KEY); } catch { /* storage yopiq */ }
}
function copy(text: string) {
  try {
    navigator.clipboard.writeText(text).then(() => toast.success('Nusxalandi'), () => toast.error('Nusxalanmadi'));
  } catch { toast.error('Nusxalanmadi'); }
}
const signed = (e: Edit) => (e.amount == null ? '—' : `${e.direction === 'OUT' ? '−' : '+'}${formatMoney(Math.abs(e.amount))}`);

export function TrSupportTab() {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => { setCode(readCode()); }, []);
  if (!code) return <Gate onOk={(c) => { saveCode(c); setCode(c); }} />;
  return <EditList code={code} onLocked={() => { saveCode(null); setCode(null); }} />;
}

function Gate({ onOk }: { onOk: (code: string) => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const unlock = useMutation({
    mutationFn: (c: string) => api.post('/tr-support/unlock', { code: c }),
    onSuccess: (_d, c) => onOk(c.trim()),
    onError: (e: any) => setErr(e?.message || "Kod noto'g'ri"),
  });
  const submit = () => { setErr(null); if (pw.trim()) unlock.mutate(pw.trim()); };
  return (
    <div className="flex-1 min-h-0 grid place-items-center bg-slate-50/40 dark:bg-slate-900 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 grid place-items-center">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-slate-800 dark:text-slate-100">TR Support</div>
            <div className="text-[11.5px] text-slate-500 dark:text-slate-400">Agent orqali qilingan tahrirlar. Kirish kodi kerak.</div>
          </div>
        </div>
        <div className="relative">
          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            type="password" inputMode="numeric" autoFocus value={pw} placeholder="Kirish kodi"
            onChange={(e) => { setPw(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            className="pl-9 h-10 text-[13px] tracking-widest"
          />
        </div>
        {err && <div className="mt-2 text-[11.5px] text-rose-600 dark:text-rose-400">{err}</div>}
        <Button className="mt-3 w-full h-9" onClick={submit} disabled={!pw.trim() || unlock.isPending}>
          {unlock.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Kirish'}
        </Button>
      </div>
    </div>
  );
}

function StatusPill({ e }: { e: Edit }) {
  if (e.status === 'rolled_back') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 whitespace-nowrap">
        <Undo2 className="h-3 w-3" /> Qaytarilgan
      </span>
    );
  }
  if (e.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-900 whitespace-nowrap">
        <AlertTriangle className="h-3 w-3" /> Qisman
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900 whitespace-nowrap">
      <CheckCircle2 className="h-3 w-3" /> Bajarildi
    </span>
  );
}

/** Shartnoma belgisi: XATO — qizil, yo'q — kulrang, bor — oddiy. */
function ContractChip({ v }: { v: string | null }) {
  if (!v) return <span className="text-slate-400">—</span>;
  const xato = v.toUpperCase() === 'XATO';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-bold tracking-wide whitespace-nowrap',
      xato
        ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900'
        : 'text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800',
    )}>
      <FileSignature className="h-3 w-3" /> {v}
    </span>
  );
}

function EditList({ code, onLocked }: { code: string; onLocked: () => void }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canRollback = !!user?.permissions?.includes(PERMS.CATEGORIES_MANAGE);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [detail, setDetail] = useState<Edit | null>(null);
  const [confirm, setConfirm] = useState<Edit | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { const t = setTimeout(() => { setQd(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const list = useQuery({
    queryKey: ['tr-support-edits', page, qd],
    queryFn: () => apiFetch<{ ok: true; total: number; items: Edit[] }>(
      `/tr-support/edits?page=${page}&perPage=30${qd ? `&q=${encodeURIComponent(qd)}` : ''}`,
      { method: 'GET', headers: { 'x-tr-support-code': code } },
    ),
    retry: false,
  });
  useEffect(() => { if ((list.error as any)?.status === 403) onLocked(); }, [list.error, onLocked]);

  const rollback = useMutation({
    mutationFn: (e: Edit) => api.post(`/tr-support/edits/${e.id}/rollback`, { code, note: note.trim() || undefined }, { timeout: 180_000 }),
    onSuccess: (r: any) => {
      const s = r?.sync;
      toast.success(s?.ok === false
        ? `Ortga qaytarildi, lekin sync xato: ${s.error || ''}`
        : "Ortga qaytarildi va OplatyKv sync bajarildi");
      setConfirm(null); setNote(''); setDetail(null);
      qc.invalidateQueries({ queryKey: ['tr-support-edits'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['oplata-kv'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Ortga qaytarilmadi'),
  });

  const items = list.data?.items || [];
  const total = list.data?.total || 0;

  return (
    <>
      <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish (to'lov ID, kim tasdiqladi, izoh)…" className="pl-9 h-9 text-[12px]" />
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">
          <Bot className="h-3.5 w-3.5 text-violet-500" /> Agent tahrirlari: <b className="tabular-nums text-slate-700 dark:text-slate-200">{total}</b>
        </span>
        <button onClick={onLocked} className="ml-auto inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[11.5px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200">
          <Lock className="h-3.5 w-3.5" /> Qulflash
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-slate-50/40 dark:bg-slate-900">
        {list.isLoading ? (
          <div className="py-20 flex flex-col items-center gap-3 text-slate-400"><Loader2 className="h-7 w-7 animate-spin text-rose-500" /></div>
        ) : list.isError ? (
          <div className="py-16 text-center text-[12px] text-rose-600 dark:text-rose-400">{(list.error as any)?.message || 'Yuklanmadi'}</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-[12px] text-slate-400 dark:text-slate-500">Agent orqali qilingan tahrir hali yo'q</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-[10.5px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> Qachon</span></th>
                <th className="text-left px-3 py-2">To'lov sanasi</th>
                <th className="text-right px-3 py-2"><span className="inline-flex items-center gap-1 justify-end"><Wallet className="h-3 w-3" /> Summa</span></th>
                <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><FileSignature className="h-3 w-3" /> Shartnoma</span></th>
                <th className="text-left px-3 py-2">O'zgarish</th>
                <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><UserCheck className="h-3 w-3" /> Tasdiqladi</span></th>
                <th className="text-left px-3 py-2">Holat</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {items.map((e) => (
                <tr key={e.id} onClick={() => setDetail(e)}
                  className="hover:bg-rose-50/40 dark:hover:bg-rose-950/20 transition-colors cursor-pointer">
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300 tabular-nums">{formatDateTime(e.createdAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300 tabular-nums">{formatDateTime(e.txDate)}</td>
                  <td className={cn('px-3 py-2 whitespace-nowrap text-right font-bold tabular-nums',
                    e.direction === 'OUT' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
                    {signed(e)} <span className="text-[10px] font-semibold text-slate-400">UZS</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {(e.changed || []).includes('shartnoma') ? (
                      <span className="inline-flex items-center gap-1">
                        <ContractChip v={valOf(e.before, 'shartnoma')} />
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                        <ContractChip v={valOf(e.after, 'shartnoma')} />
                      </span>
                    ) : <ContractChip v={valOf(e.after, 'shartnoma')} />}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      {FIELDS.filter((f) => (e.changed || []).includes(f)).map((f) => (
                        <span key={f} title={`${FIELD_LABEL[f]}: ${valOf(e.before, f) || "yo'q"} → ${valOf(e.after, f) || "yo'q"}`}
                          className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">
                          {FIELD_LABEL[f]}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-200 max-w-[140px] truncate" title={e.approvedBy}>{e.approvedBy}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><StatusPill e={e} /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      {e.status !== 'rolled_back' && canRollback && (
                        <button
                          title="Ortga qaytarish"
                          onClick={(ev) => { ev.stopPropagation(); setConfirm(e); setNote(''); }}
                          className="inline-grid place-items-center h-7 w-7 rounded-lg text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end gap-2 text-[11.5px] text-slate-500 shrink-0">
        <span className="tabular-nums">{page}-sahifa · jami {total}</span>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Oldingi</Button>
        <Button variant="outline" size="sm" disabled={page * 30 >= total} onClick={() => setPage((p) => p + 1)}>Keyingi</Button>
      </div>

      {detail && (
        <Detail e={detail} canRollback={canRollback && detail.status !== 'rolled_back'}
          onClose={() => setDetail(null)} onRollback={() => { setConfirm(detail); setNote(''); }} />
      )}

      {confirm && (
        <div className="fixed inset-0 z-[330] grid place-items-center bg-slate-950/50 backdrop-blur-sm p-4" onClick={() => !rollback.isPending && setConfirm(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-800 p-5" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 grid place-items-center"><RotateCcw className="h-4 w-4" /></div>
                <div>
                  <div className="text-[14px] font-bold text-slate-800 dark:text-slate-100">Ortga qaytarish</div>
                  <div className="text-[11.5px] text-slate-500">To'lov oldingi holatiga qaytadi, keyin OplatyKv sync ishlaydi.</div>
                </div>
              </div>
              <button onClick={() => setConfirm(null)} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 flex flex-col gap-1.5 text-[12px]">
              {(confirm.changed || []).map((f) => (
                <div key={f} className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 w-[74px]">{FIELD_LABEL[f] || f}</span>
                  <span className="text-slate-500 line-through">{valOf(confirm.after, f) || "yo'q"}</span>
                  <ArrowRight className="h-3 w-3 text-slate-400" />
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{valOf(confirm.before, f) || "yo'q"}</span>
                </div>
              ))}
            </div>
            <Input className="mt-3 h-9 text-[12px]" placeholder="Izoh (ixtiyoriy): nega qaytarilmoqda" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirm(null)} disabled={rollback.isPending}>Bekor</Button>
              <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white" disabled={rollback.isPending} onClick={() => rollback.mutate(confirm)}>
                {rollback.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Bajarilmoqda…</> : <><RotateCcw className="h-3.5 w-3.5 mr-1" /> Ha, qaytarish</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Qator bosilganda: tahrirning to'liq ma'lumoti. */
function Detail({ e, canRollback, onClose, onRollback }: {
  e: Edit; canRollback: boolean; onClose: () => void; onRollback: () => void;
}) {
  const id = e.txExternalId || e.txId;
  const s = e.syncResult;
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5 text-[12px]">
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 pt-0.5">{k}</div>
      <div className="text-slate-700 dark:text-slate-200 min-w-0">{children}</div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[320] grid place-items-center bg-slate-950/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[90vh] overflow-auto rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-800"
        onClick={(ev) => ev.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500"><Bot className="h-3.5 w-3.5 text-violet-500" /> TR Support tahriri · {formatDateTime(e.createdAt)}</div>
            <div className={cn('mt-1 text-[22px] font-extrabold tabular-nums', e.direction === 'OUT' ? 'text-rose-600' : 'text-emerald-600')}>
              {signed(e)} <span className="text-[12px] font-semibold text-slate-400">UZS</span>
            </div>
            <div className="text-[11.5px] text-slate-500">To'lov sanasi: {formatDateTime(e.txDate)}</div>
          </div>
          <div className="flex items-center gap-2"><StatusPill e={e} />
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10.5px] uppercase tracking-wider text-slate-500">
                <tr><th className="text-left px-3 py-1.5">Ustun</th><th className="text-left px-3 py-1.5">Oldin</th><th className="text-left px-3 py-1.5">Keyin</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {FIELDS.map((f) => {
                  const ozg = (e.changed || []).includes(f);
                  return (
                    <tr key={f} className={ozg ? 'bg-violet-50/40 dark:bg-violet-950/10' : ''}>
                      <td className="px-3 py-1.5 font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">{FIELD_LABEL[f]}</td>
                      <td className={cn('px-3 py-1.5', ozg ? 'text-slate-500 line-through' : 'text-slate-500')}>{valOf(e.before, f) || "yo'q"}</td>
                      <td className={cn('px-3 py-1.5', ozg ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-400')}>
                        {ozg ? (valOf(e.after, f) || "yo'q") : "o'zgarmagan"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            <Row k="To'lov ID">
              <span className="inline-flex items-start gap-1.5">
                <code className="font-mono text-[11px] break-all text-slate-700 dark:text-slate-200">{id}</code>
                <button title="Nusxalash" onClick={() => copy(id)} className="shrink-0 text-slate-400 hover:text-slate-700"><Copy className="h-3.5 w-3.5" /></button>
              </span>
            </Row>
            <Row k="Tasdiqladi">{e.approvedBy}</Row>
            <Row k="Izoh"><span className="whitespace-pre-wrap">{e.comment || '—'}</span></Row>
            <Row k="Manba">{e.requestedBy || 'Telegram (TR Support bot)'}</Row>
            <Row k="OplatyKv sync">
              {!s ? '—' : s.ok === false
                ? <span className="text-amber-600">xato: {s.error || '—'}</span>
                : <span>bajarildi · qo'shildi {s.added ?? 0}, yangilandi {s.updated ?? 0}{s.at ? ` · ${formatDateTime(s.at)}` : ''}</span>}
            </Row>
            {e.status === 'failed' && e.error && <Row k="Xato"><span className="text-amber-700 dark:text-amber-300">{e.error}</span></Row>}
            {e.status === 'rolled_back' && (
              <Row k="Qaytarildi">
                {e.rolledBackBy || '—'} · {formatDateTime(e.rolledBackAt)}{e.rollbackNote ? ` · ${e.rollbackNote}` : ''}
              </Row>
            )}
            <Row k="Tasdiq guruhi"><code className="font-mono text-[11px] text-slate-500">{e.batchId}</code></Row>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
          {canRollback && (
            <Button size="sm" variant="outline" className="text-rose-700 border-rose-200 hover:bg-rose-50 dark:text-rose-300 dark:border-rose-900" onClick={onRollback}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Ortga qaytarish
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onClose}><X className="h-3.5 w-3.5 mr-1" /> Yopish</Button>
        </div>
      </div>
    </div>
  );
}
