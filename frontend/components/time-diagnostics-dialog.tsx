'use client';
// Vaqt diagnostikasi — "nega hamma qatorda bir xil vaqt?" savoliga javob.
// Bazadagi XOM bank javobini (metadata.time / stime / input_time) ko'rsatadi.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { X, Clock, Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface DiagResponse {
  ok: true;
  date: string;
  total: number;
  lastSyncedAt: string | null;
  operationTimes: Array<{ time: string | null; count: number }>;
  settlementTimes: Array<{ time: string | null; count: number }>;
  samples: Array<{
    id: string; doc_number: string | null; direction: string; amount: string;
    raw_ddate: string | null; raw_time: string | null; raw_stime: string | null;
    raw_input_date: string | null; raw_input_time: string | null;
    operation_time: string | null; settlement_time: string | null;
    txn_date: string; synced_at: string;
  }>;
  recentSyncLogs: Array<{
    source: string; status: string; fetched: number; saved: number;
    startedAt: string; finishedAt: string | null;
  }>;
  verdict: string;
}

const todayTashkent = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const hhmm = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }) : '—';

export function TimeDiagnosticsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [date, setDate] = useState(todayTashkent());

  const { data, isLoading, error, refetch, isFetching } = useQuery<DiagResponse>({
    queryKey: ['time-diagnostics', date],
    queryFn: () => api.get(`/transactions/time-diagnostics?date=${date}`, { timeout: 60_000 }),
    enabled: open,
    retry: false,
  });

  if (!open || typeof document === 'undefined') return null;

  const distinctOp = (data?.operationTimes || []).filter((r) => r.time).length;
  const oneValue = distinctOp === 1;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 overflow-y-auto bg-slate-900/50 backdrop-blur-sm">
      <div className="w-full max-w-3xl my-6 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-slate-50 to-indigo-50/60 dark:from-slate-900 dark:to-indigo-950/40 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-md shrink-0">
            <Clock className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-slate-900 dark:text-slate-100">Vaqt diagnostikasi</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Bank har bir tranzaksiyaga alohida vaqt beryaptimi — xom javobdan tekshiriladi
            </div>
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-[12px]"
          />
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="w-9 h-9 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 grid place-items-center text-slate-500 hover:text-indigo-600 shrink-0"
            title="Yangilash"
          >
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 grid place-items-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {isLoading ? (
            <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" /></div>
          ) : error ? (
            <div className="text-[12px] text-rose-600 dark:text-rose-400">{(error as any)?.message || 'Xato'}</div>
          ) : data ? (
            <>
              {/* Xulosa */}
              <div className={cn(
                'rounded-xl ring-1 px-4 py-3 text-[12.5px] font-semibold flex items-start gap-2',
                oneValue
                  ? 'bg-amber-50 dark:bg-amber-950/30 ring-amber-200 dark:ring-amber-900 text-amber-800 dark:text-amber-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/30 ring-emerald-200 dark:ring-emerald-900 text-emerald-800 dark:text-emerald-300',
              )}>
                {oneValue ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
                <div>
                  {data.verdict}
                  <div className="font-normal opacity-80 mt-1">
                    {data.date} · {data.total.toLocaleString('ru-RU')} ta tranzaksiya ·
                    oxirgi sync: {hhmm(data.lastSyncedAt)}
                  </div>
                </div>
              </div>

              {/* Vaqt taqsimoti */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TimeList title="Operatsiya vaqti (time)" rows={data.operationTimes} />
                <TimeList title="Hisob-kitob vaqti (stime)" rows={data.settlementTimes} />
              </div>

              {/* Xom javob namunalari */}
              <div>
                <div className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                  Bankdan kelgan xom qiymatlar (oxirgi 8 ta)
                </div>
                <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="text-left px-2.5 py-2 font-semibold">№</th>
                        <th className="text-left px-2.5 py-2 font-semibold">ddate</th>
                        <th className="text-left px-2.5 py-2 font-semibold">time</th>
                        <th className="text-left px-2.5 py-2 font-semibold">stime</th>
                        <th className="text-left px-2.5 py-2 font-semibold">input</th>
                        <th className="text-left px-2.5 py-2 font-semibold">bazada (txn_date)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {data.samples.map((s) => (
                        <tr key={s.id} className="font-mono">
                          <td className="px-2.5 py-1.5">{s.doc_number || '—'}</td>
                          <td className="px-2.5 py-1.5">{s.raw_ddate || '—'}</td>
                          <td className="px-2.5 py-1.5 font-bold text-slate-800 dark:text-slate-100">{s.raw_time || '—'}</td>
                          <td className="px-2.5 py-1.5">{s.raw_stime || '—'}</td>
                          <td className="px-2.5 py-1.5">{[s.raw_input_date, s.raw_input_time].filter(Boolean).join(' ') || '—'}</td>
                          <td className="px-2.5 py-1.5 text-slate-500 dark:text-slate-400">{hhmm(s.txn_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Sync loglari — "sync to'xtaganmi?" savoli uchun */}
              {data.recentSyncLogs.length > 0 && (
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                    Shu kungi oxirgi sync'lar
                  </div>
                  <div className="space-y-1">
                    {data.recentSyncLogs.map((l, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-bold',
                          l.status === 'SUCCESS'
                            ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                            : 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300',
                        )}>
                          {l.status}
                        </span>
                        <span className="truncate flex-1 text-slate-600 dark:text-slate-300">{l.source}</span>
                        <span className="text-slate-400 dark:text-slate-500 tabular-nums">
                          {l.fetched} olindi · {l.saved} saqlandi
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 tabular-nums">{hhmm(l.startedAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TimeList({ title, rows }: { title: string; rows: Array<{ time: string | null; count: number }> }) {
  return (
    <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/60 text-[10.5px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
        {title}
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-48 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-slate-400">—</div>
        ) : rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[11.5px]">
            <span className="font-mono text-slate-700 dark:text-slate-200">{r.time || <span className="italic text-slate-400">bo'sh</span>}</span>
            <span className="tabular-nums text-slate-500 dark:text-slate-400">{r.count.toLocaleString('ru-RU')} ta</span>
          </div>
        ))}
      </div>
    </div>
  );
}
