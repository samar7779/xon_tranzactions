'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Search, Check, AlertTriangle, ArrowRight,
  ChevronLeft, ChevronRight, RefreshCw, Building2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney, cn } from '@/lib/utils';

interface XatoItem {
  id: string;
  contractNo: string;
  date: string;
  paymentAmount: string | null;
  object: string | null;
  client: string | null;
  sourceTxId?: string | null;
}

interface CrmMatch {
  contract: string;
  initialAmount: number;
  monthlyAmount: number;
  otherAmount: number;
  amount: number;
  date: string;
  object: string | null;
  externalId: string;
  purpose: string;
  orderId: string | null;
}

const PER_PAGE = 20;

export default function XatoCrmPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // 1) XATO to'lovlar (shartnomasi topilmagan)
  const xatoQ = useQuery({
    queryKey: ['oplata-kv-xato', page],
    queryFn: () =>
      api.get<{ items: XatoItem[]; total: number; pageCount: number }>(
        `/oplata-kv?xatoOnly=true&page=${page}&perPage=${PER_PAGE}`,
      ),
  });
  const items = xatoQ.data?.items || [];
  const total = xatoQ.data?.total || 0;
  const pageCount = xatoQ.data?.pageCount || 1;

  // Kompozit id'lar (sourceTxId) — CRM'dan qidirish uchun
  const ids = useMemo(
    () => items.map((i) => i.sourceTxId).filter((x): x is string => !!x),
    [items],
  );
  const idsKey = ids.join(',');

  // 2) CRM batch-match (sana bo'yicha guruhlab tez)
  const matchQ = useQuery({
    queryKey: ['crm-match', idsKey],
    enabled: ids.length > 0,
    queryFn: () =>
      api.post<Array<{ id: string; crm: CrmMatch | null }>>(
        '/crm/match-composites',
        { ids },
        { timeout: 180_000 },
      ),
  });
  const matchMap = useMemo(() => {
    const m = new Map<string, CrmMatch | null>();
    for (const r of matchQ.data || []) m.set(r.id, r.crm);
    return m;
  }, [matchQ.data]);

  // 3) Qo'shish — CRM shartnomasini biriktirish + split
  const assign = useMutation({
    mutationFn: (p: { id: string; contractNo: string }) =>
      api.post<{ ok: boolean; found?: boolean; split?: any }>(
        `/oplata-kv/${p.id}/assign-from-crm`,
        { contractNo: p.contractNo },
        { timeout: 120_000 },
      ),
    onSuccess: (r) => {
      if (r?.ok) {
        const cat = r?.split?.item?.paymentCategory;
        toast.success(`Biriktirildi${cat ? ` · ${cat === 'FIRST' ? 'boshlang\'ich' : cat === 'MONTHLY' ? 'oylik' : cat}` : ''}`);
      } else {
        toast.error('Biriktirib bo\'lmadi');
      }
      qc.invalidateQueries({ queryKey: ['oplata-kv-xato'] });
      qc.invalidateQueries({ queryKey: ['oplata-kv'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
    onSettled: () => setConfirmId(null),
  });

  const matchedCount = items.filter((it) => it.sourceTxId && matchMap.get(it.sourceTxId)).length;

  return (
    <div className="p-6 lg:p-8 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Search className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            XATO → CRM biriktirish
          </h1>
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
            Shartnomasi topilmagan to'lovlar CRM'dan id bo'yicha qidiriladi — topilsa bir bosishda shartnoma va ustun (boshlang'ich/oylik) qo'yiladi.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <span className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-semibold">
            XATO: {total}
          </span>
          {ids.length > 0 && (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-semibold">
              {matchQ.isFetching ? '…' : `CRM'da topildi: ${matchedCount}/${items.length}`}
            </span>
          )}
          <button
            onClick={() => { xatoQ.refetch(); matchQ.refetch(); }}
            className="h-8 w-8 grid place-items-center rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
            title="Yangilash"
          >
            <RefreshCw className={cn('h-4 w-4', (xatoQ.isFetching || matchQ.isFetching) && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Loading */}
      {xatoQ.isLoading && (
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> XATO to'lovlar yuklanmoqda…
        </div>
      )}

      {/* Empty */}
      {!xatoQ.isLoading && items.length === 0 && (
        <div className="text-center py-14 text-slate-500 dark:text-slate-400">
          <Check className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
          XATO to'lov yo'q — hammasi shartnomaga biriktirilgan. 🎉
        </div>
      )}

      {/* Rows */}
      <div className="space-y-2.5">
        {items.map((it) => {
          const crm = it.sourceTxId ? matchMap.get(it.sourceTxId) : null;
          const matching = matchQ.isFetching && !matchQ.data;
          const confirming = confirmId === it.id;
          const busy = assign.isPending && assign.variables?.id === it.id;
          return (
            <div key={it.id} className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-950 p-3 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-center">
              {/* LEFT — XATO to'lov */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 font-semibold">XATO</span>
                  <span className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{formatMoney(Number(it.paymentAmount || 0))} UZS</span>
                  <span className="text-[11px] text-slate-400">· {it.date}</span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {it.object || '—'}{it.client ? ` · ${it.client}` : ''}
                </div>
                <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate" title={it.sourceTxId || ''}>
                  {it.sourceTxId || '(id yo\'q)'}
                </div>
              </div>

              {/* ARROW */}
              <div className="hidden md:flex justify-center text-slate-300 dark:text-slate-600">
                <ArrowRight className="h-5 w-5" />
              </div>

              {/* RIGHT — CRM natija + Qo'shish */}
              <div>
                {matching ? (
                  <div className="flex items-center gap-2 text-[12px] text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> CRM'da qidirilmoqda…</div>
                ) : crm ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                        <Building2 className="h-3 w-3" /> {crm.contract}
                      </span>
                      {!confirming ? (
                        <button
                          onClick={() => setConfirmId(it.id)}
                          disabled={busy}
                          className="text-[12px] px-3 py-1.5 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold shadow-sm flex items-center gap-1.5 disabled:opacity-60"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Qo'shish
                        </button>
                      ) : (
                        <button
                          onClick={() => assign.mutate({ id: it.id, contractNo: crm.contract })}
                          disabled={busy}
                          className="text-[12px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm flex items-center gap-1.5 disabled:opacity-60 animate-pulse"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Tasdiqlash
                        </button>
                      )}
                    </div>
                    {/* split — boshlang'ich / oylik / boshqa */}
                    <div className="flex gap-1.5 text-[10.5px]">
                      <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">bosh: <b>{formatMoney(crm.initialAmount)}</b></span>
                      <span className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400">oylik: <b>{formatMoney(crm.monthlyAmount)}</b></span>
                      {crm.otherAmount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">boshqa: <b>{formatMoney(crm.otherAmount)}</b></span>
                      )}
                    </div>
                    {crm.object && <div className="text-[10px] text-slate-400">{crm.object}</div>}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> CRM'da topilmadi
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="h-8 w-8 grid place-items-center rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[12px] text-slate-500 dark:text-slate-400">{page} / {pageCount}</span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            className="h-8 w-8 grid place-items-center rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
