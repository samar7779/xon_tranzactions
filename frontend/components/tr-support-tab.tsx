'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowRight, Bot, CheckCircle2, KeyRound, Loader2, Lock, RotateCcw, Search, Undo2, X,
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
 * "Ortga qaytarish" to'lovni oldingi holatiga qaytaradi va OplatyKv sync'ni bir marta ishga tushiradi.
 */

type State = {
  categoryName: string | null; subcategoryName: string | null; contractNumber: string | null;
};
type Edit = {
  id: string; batchId: string; txId: string; txExternalId: string | null; txDate: string | null;
  amount: number | null; direction: string | null; before: State; after: State; changed: string[];
  approvedBy: string; comment: string | null; requestedBy: string | null;
  status: 'applied' | 'failed' | 'rolled_back'; error: string | null; syncResult: any;
  rolledBackAt: string | null; rolledBackBy: string | null; rollbackNote: string | null; createdAt: string;
};

const SS_KEY = 'trsupport.code';
const FIELD_LABEL: Record<string, string> = { kontragent: 'Kontragent', kategoriya: 'Kategoriya', shartnoma: 'Shartnoma' };
const valOf = (s: State | null | undefined, f: string) =>
  (f === 'kontragent' ? s?.categoryName : f === 'kategoriya' ? s?.subcategoryName : s?.contractNumber) || null;

function readCode(): string | null {
  try { return window.sessionStorage.getItem(SS_KEY); } catch { return null; }
}
function saveCode(v: string | null) {
  try { if (v) window.sessionStorage.setItem(SS_KEY, v); else window.sessionStorage.removeItem(SS_KEY); } catch { /* storage yopiq */ }
}

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
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
        title={`${e.rolledBackBy || ''} · ${formatDateTime(e.rolledBackAt)}${e.rollbackNote ? ` · ${e.rollbackNote}` : ''}`}>
        <Undo2 className="h-3 w-3" /> Qaytarilgan
      </span>
    );
  }
  if (e.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-900"
        title={e.error || ''}>
        <AlertTriangle className="h-3 w-3" /> Qisman
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900">
      <CheckCircle2 className="h-3 w-3" /> Bajarildi
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
      setConfirm(null); setNote('');
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
                <th className="text-left px-3 py-2">Qachon</th>
                <th className="text-left px-3 py-2">To'lov</th>
                <th className="text-left px-3 py-2">Nima o'zgardi</th>
                <th className="text-left px-3 py-2">Tasdiqladi</th>
                <th className="text-left px-3 py-2">Izoh</th>
                <th className="text-left px-3 py-2">Holat</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {items.map((e) => (
                <tr key={e.id} className="align-top hover:bg-rose-50/30 dark:hover:bg-rose-950/10">
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300 tabular-nums">{formatDateTime(e.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div className="text-slate-700 dark:text-slate-200 tabular-nums whitespace-nowrap">
                      {formatDateTime(e.txDate)} · <b>{e.amount != null ? formatMoney(e.amount) : '—'}</b>
                    </div>
                    <div className="text-[10.5px] text-slate-400 font-mono truncate max-w-[220px]" title={e.txExternalId || e.txId}>{e.txExternalId || e.txId}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      {(e.changed || []).map((f) => (
                        <div key={f} className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 w-[74px]">{FIELD_LABEL[f] || f}</span>
                          <span className="text-slate-500 dark:text-slate-400 line-through decoration-slate-300">{valOf(e.before, f) || "yo'q"}</span>
                          <ArrowRight className="h-3 w-3 text-slate-400" />
                          <span className="font-semibold text-slate-800 dark:text-slate-100">{valOf(e.after, f) || "yo'q"}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-200 whitespace-nowrap">{e.approvedBy}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 max-w-[240px]"><span className="line-clamp-3" title={e.comment || ''}>{e.comment || '—'}</span></td>
                  <td className="px-3 py-2"><StatusPill e={e} />
                    {e.syncResult?.ok === false && <div className="mt-1 text-[10.5px] text-amber-600" title={e.syncResult?.error || ''}>sync xato</div>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {e.status !== 'rolled_back' && canRollback && (
                      <button
                        onClick={() => { setConfirm(e); setNote(''); }}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 hover:bg-rose-100 dark:hover:bg-rose-900/40"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Ortga qaytarish
                      </button>
                    )}
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

      {confirm && (
        <div className="fixed inset-0 z-[320] grid place-items-center bg-slate-950/50 backdrop-blur-sm p-4" onClick={() => !rollback.isPending && setConfirm(null)}>
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
