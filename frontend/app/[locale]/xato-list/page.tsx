'use client';

import { useEffect, useState } from 'react';

interface XatoRow {
  id: string;
  date: string | null;
  contractNo: string;
  amount: number | null;
  client: string | null;
  object: string | null;
  txType: string | null;
  purpose: string | null;
}
interface XatoResp { ok: boolean; count: number; rows: XatoRow[] }

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
}
function fmtMoney(v: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('ru-RU');
}

export default function XatoListPage() {
  const [data, setData] = useState<XatoResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 30;

  useEffect(() => { setPage(1); }, [q]);

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('key') || '';
    if (!key) { setError("Kalit yo'q — noto'g'ri havola"); return; }
    fetch(`${API_URL}/agent/xato-list?key=${encodeURIComponent(key)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.message || `Xatolik (${r.status})`);
        return j as XatoResp;
      })
      .then(setData)
      .catch((e) => setError(e?.message || 'Xatolik'));
  }, []);

  const rows = (data?.rows || []).filter((r) => {
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return (
      r.contractNo?.toLowerCase().includes(s) ||
      r.client?.toLowerCase().includes(s) ||
      r.object?.toLowerCase().includes(s) ||
      r.purpose?.toLowerCase().includes(s)
    );
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * perPage, safePage * perPage);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gradient-to-r from-rose-600 to-orange-600 text-white px-4 py-3 shadow-md">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚠️</span>
          <div>
            <div className="text-[15px] font-bold leading-tight">XATO to'lovlar</div>
            <div className="text-[11px] text-white/85">CRM'da tasdiqlanmagan · ariza/shartnoma kerak</div>
          </div>
          {data && (
            <span className="ml-auto bg-white/20 rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums">{data.count} ta</span>
          )}
        </div>
      </div>

      {error ? (
        <div className="p-6 text-center text-rose-600 dark:text-rose-400 text-[13px]">{error}</div>
      ) : !data ? (
        <div className="p-10 text-center text-slate-400 text-[13px]">Yuklanmoqda…</div>
      ) : (
        <div className="p-3 sm:p-4 w-full">
          {/* Qidiruv */}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Qidirish — shartnoma, klient, obyekt…"
            className="w-full sm:max-w-lg h-10 px-3 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-rose-400 text-[13px]"
          />
          <div className="text-[11px] text-slate-400 px-1 mt-2 mb-3">{rows.length} ta · sahifa {safePage}/{totalPages}</div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
          {pageRows.map((r) => (
            <div key={r.id} className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="font-mono font-bold text-[13px] text-rose-700 dark:text-rose-300">{r.contractNo}</div>
                <div className={`text-[14px] font-bold tabular-nums ${((r.amount ?? 0) < 0) ? 'text-rose-600' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {fmtMoney(r.amount)}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2 flex-wrap text-[11.5px] text-slate-500 dark:text-slate-400">
                <span className="tabular-nums">{fmtDate(r.date)}</span>
                {r.object && <><span className="text-slate-300">·</span><span>🏠 {r.object}</span></>}
                {r.txType && <><span className="text-slate-300">·</span><span>{r.txType}</span></>}
              </div>
              {r.client && <div className="mt-1 text-[12.5px] font-medium text-slate-700 dark:text-slate-200">👤 {r.client}</div>}
              {r.purpose && <div className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400 line-clamp-3">{r.purpose}</div>}
              <div className="mt-1.5 font-mono text-[9.5px] text-slate-300 dark:text-slate-600 truncate">{r.id}</div>
            </div>
          ))}
          </div>

          {rows.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-[13px]">Topilmadi</div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
                className="h-9 px-4 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[13px] font-semibold disabled:opacity-40">← Oldingi</button>
              <span className="text-[13px] tabular-nums text-slate-500 dark:text-slate-400">{safePage} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                className="h-9 px-4 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[13px] font-semibold disabled:opacity-40">Keyingi →</button>
            </div>
          )}
          <div className="h-6" />
        </div>
      )}
    </div>
  );
}
