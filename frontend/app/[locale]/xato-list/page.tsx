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
  const [key, setKey] = useState('');
  const [tgAuth, setTgAuth] = useState<Record<string, string> | null>(null);

  // Biriktirish modali
  const [selected, setSelected] = useState<XatoRow | null>(null);
  const [cq, setCq] = useState('');
  const [crmItems, setCrmItems] = useState<any[]>([]);
  const [crmLoading, setCrmLoading] = useState(false);
  const [chosen, setChosen] = useState('');
  const [name, setName] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');

  useEffect(() => { setPage(1); }, [q]);

  const closeModal = () => { setSelected(null); setCq(''); setCrmItems([]); setChosen(''); setAssignError(''); };

  // CRM shartnoma qidirish (modal ochiq bo'lsa, debounce)
  useEffect(() => {
    if (!selected || cq.trim().length < 2) { setCrmItems([]); return; }
    setCrmLoading(true);
    const t = setTimeout(() => {
      const req = tgAuth
        ? fetch(`${API_URL}/agent/tg/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth: tgAuth, q: cq.trim() }) })
        : fetch(`${API_URL}/agent/crm-search?key=${encodeURIComponent(key)}&q=${encodeURIComponent(cq.trim())}`);
      req.then((r) => r.json()).then((d) => setCrmItems(d?.items || [])).catch(() => setCrmItems([]))
        .finally(() => setCrmLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [cq, selected, key, tgAuth]);

  const doAssign = async () => {
    if (!selected || !chosen) return;
    setAssigning(true); setAssignError('');
    try {
      const res = tgAuth
        ? await fetch(`${API_URL}/agent/tg/assign`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ auth: tgAuth, oplataKvId: selected.id, contractNo: chosen }),
          })
        : await fetch(`${API_URL}/agent/assign`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, oplataKvId: selected.id, contractNo: chosen, name }),
          });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) throw new Error(d?.error || d?.message || 'Xatolik');
      setData((prev) => prev ? { ...prev, count: Math.max(0, prev.count - 1), rows: prev.rows.filter((x) => x.id !== selected.id) } : prev);
      closeModal();
    } catch (e: any) {
      setAssignError(e?.message || 'Biriktirishda xato');
    } finally {
      setAssigning(false);
    }
  };

  useEffect(() => {
    const parse = async (r: Response) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || `Xatolik (${r.status})`);
      return j as XatoResp;
    };
    const p = new URLSearchParams(window.location.search);
    const id = p.get('id');
    const hash = p.get('hash');
    // Telegram login_url — auth paramlari bilan kelgan
    if (id && hash) {
      const auth: Record<string, string> = {};
      for (const kk of ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']) {
        const v = p.get(kk);
        if (v != null) auth[kk] = v;
      }
      setTgAuth(auth);
      fetch(`${API_URL}/agent/tg/list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth }) })
        .then(parse).then(setData).catch((e) => setError(e?.message || 'Xatolik'));
      return;
    }
    // Kalit bilan (fallback/test)
    const k = p.get('key') || '';
    if (!k) { setError("Kirish ma'lumoti yo'q — noto'g'ri havola"); return; }
    setKey(k);
    fetch(`${API_URL}/agent/xato-list?key=${encodeURIComponent(k)}`)
      .then(parse).then(setData).catch((e) => setError(e?.message || 'Xatolik'));
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
            <div key={r.id} onClick={() => setSelected(r)} className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 p-3 shadow-sm cursor-pointer hover:ring-rose-300 dark:hover:ring-rose-700 hover:shadow-md transition-all">
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

      {/* ─── Biriktirish modali ─── */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={closeModal}>
          <div className="bg-white dark:bg-slate-900 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white dark:bg-slate-900 px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 z-10">
              <div className="font-bold text-[15px] text-slate-800 dark:text-slate-100">🔗 Shartnoma biriktirish</div>
              <button onClick={closeModal} className="ml-auto w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>
            <div className="p-4 space-y-4">
              {/* To'lov ma'lumoti */}
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 ring-1 ring-slate-100 dark:ring-slate-800 p-3 text-[12px] space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-rose-600 dark:text-rose-300">{selected.contractNo}</span>
                  <span className={`font-bold tabular-nums ${((selected.amount ?? 0) < 0) ? 'text-rose-600' : 'text-emerald-600 dark:text-emerald-400'}`}>{fmtMoney(selected.amount)}</span>
                </div>
                <div className="text-slate-500 dark:text-slate-400">{fmtDate(selected.date)}{selected.object ? ` · 🏠 ${selected.object}` : ''}</div>
                {selected.client && <div className="text-slate-600 dark:text-slate-300">👤 {selected.client}</div>}
                {selected.purpose && <div className="text-slate-500 dark:text-slate-400 text-[11px] line-clamp-3">{selected.purpose}</div>}
              </div>

              {/* CRM qidiruv */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">To'g'ri CRM shartnomasi</label>
                <input
                  value={cq}
                  onChange={(e) => { setCq(e.target.value); setChosen(''); }}
                  placeholder="Shartnoma raqami yoki mijoz ismi…"
                  className="w-full h-10 px-3 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-indigo-400 text-[13px]"
                />
                {crmLoading && <div className="text-[11px] text-slate-400">Qidirilmoqda…</div>}
                {crmItems.length > 0 && (
                  <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800 max-h-52 overflow-y-auto">
                    {crmItems.map((it: any, i: number) => (
                      <button key={i} onClick={() => { setChosen(it.contract || ''); setCq(it.contract || ''); setCrmItems([]); }}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors">
                        <div className="font-mono font-bold text-[12px] text-indigo-700 dark:text-indigo-300">{it.contract}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{it.clientFullName || it.client_full_name || it.customerName || it.client || it.object || ''}</div>
                      </button>
                    ))}
                  </div>
                )}
                {chosen && <div className="text-[12px] text-emerald-600 dark:text-emerald-400 font-semibold">✓ Tanlandi: {chosen}</div>}
              </div>

              {/* Ism — faqat kalit rejimda (Telegram'da ism o'zi ma'lum) */}
              {!tgAuth && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Ismingiz (kim biriktirdi)</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: Samar"
                    className="w-full h-10 px-3 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-indigo-400 text-[13px]" />
                </div>
              )}

              {assignError && <div className="text-[12px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 rounded-lg p-2.5">{assignError}</div>}

              <button onClick={doAssign} disabled={!chosen || assigning}
                className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-[14px] transition-colors">
                {assigning ? 'Biriktirilmoqda…' : 'Biriktir'}
              </button>
              <div className="text-[10.5px] text-slate-400 dark:text-slate-500 text-center">Faqat CRM'da mavjud shartnomani biriktira olasiz. Biriktirilgach to'lov ro'yxatdan yo'qoladi.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
