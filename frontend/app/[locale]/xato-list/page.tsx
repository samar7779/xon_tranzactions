'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Search, User, Building2, X, ChevronLeft, ChevronRight,
  Loader2, ArrowDownLeft, ArrowUpRight, CheckCircle2, Layers, Link2, ShieldCheck,
  Clock, Send, RotateCcw, Copy, Paperclip, Upload, FileCheck2,
} from 'lucide-react';

interface XatoRow {
  id: string;
  date: string | null;
  contractNo: string;
  amount: number | null;
  client: string | null;
  object: string | null;
  txType: string | null;
  purpose: string | null;
  pending?: boolean;
  rejected?: boolean;
}
interface XatoResp { ok: boolean; count: number; rows: XatoRow[]; me?: string }

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
function fmtCompact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)} mlrd`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)} mln`;
  if (a >= 1e3) return `${Math.round(v / 1e3)} ming`;
  return String(v);
}

type Flow = 'all' | 'in' | 'out' | 'pending';

export default function XatoListPage() {
  const [data, setData] = useState<XatoResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [flow, setFlow] = useState<Flow>('all');
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
  const [arizaFile, setArizaFile] = useState<File | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedRef = useRef<XatoRow | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (f && f.size > 25 * 1024 * 1024) {
      setAssignError('Fayl hajmi 25MB dan oshmasligi kerak');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setArizaFile(f);
    setAssignError('');
  };

  useEffect(() => { setPage(1); }, [q, flow]);

  const closeModal = () => { setSelected(null); setCq(''); setCrmItems([]); setChosen(''); setArizaFile(null); setAssignError(''); };

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
    if (!selected || !chosen || !arizaFile) return;
    setAssigning(true); setAssignError('');
    try {
      const fd = new FormData();
      fd.append('oplataKvId', selected.id);
      fd.append('contractNo', chosen);
      fd.append('file', arizaFile);
      let url: string;
      if (tgAuth) { fd.append('auth', JSON.stringify(tgAuth)); url = `${API_URL}/agent/tg/submit`; }
      else { fd.append('key', key); url = `${API_URL}/agent/submit`; }
      const res = await fetch(url, { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) throw new Error(d?.error || d?.message || 'Xatolik');
      // Ariza yuborildi — to'lov "kutilmoqda" bo'ldi (yo'qolmaydi, tasdiq kutadi)
      setData((prev) => prev ? { ...prev, rows: prev.rows.map((x) => x.id === selected.id ? { ...x, pending: true } : x) } : prev);
      closeModal();
    } catch (e: any) {
      setAssignError(e?.message || 'Yuborishda xato');
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

  // ─── Real vaqt: har 45s da jonli yangilash (modal ochiq bo'lmasa) ───
  useEffect(() => {
    if (!tgAuth && !key) return;
    const iv = setInterval(() => {
      if (selectedRef.current) return; // modal ochiq — tegmaymiz
      const req = tgAuth
        ? fetch(`${API_URL}/agent/tg/list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth: tgAuth }) })
        : fetch(`${API_URL}/agent/xato-list?key=${encodeURIComponent(key)}`);
      req.then((r) => r.ok ? r.json() : null).then((j) => { if (j?.ok) setData(j as XatoResp); }).catch(() => {});
    }, 45000);
    return () => clearInterval(iv);
  }, [tgAuth, key]);

  const allRows = data?.rows || [];
  const stats = useMemo(() => {
    let inC = 0, outC = 0, inSum = 0, outSum = 0, pendingC = 0;
    for (const r of allRows) {
      const a = r.amount ?? 0;
      if (a < 0) { outC++; outSum += a; } else { inC++; inSum += a; }
      if (r.pending) pendingC++;
    }
    return { inC, outC, inSum, outSum, pendingC };
  }, [allRows]);

  const rows = allRows.filter((r) => {
    const a = r.amount ?? 0;
    if (flow === 'in' && a < 0) return false;
    if (flow === 'out' && a >= 0) return false;
    if (flow === 'pending' && !r.pending) return false;
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

  const who = tgAuth?.first_name || data?.me || '';
  const photo = tgAuth?.photo_url || '';

  return (
    <div className="min-h-screen bg-[radial-gradient(120%_60%_at_50%_0%,#f5f3ff_0%,#f8fafc_38%,#f1f5f9_100%)] dark:bg-[radial-gradient(120%_60%_at_50%_0%,#1e1b4b_0%,#020617_45%)] text-slate-800 dark:text-slate-100">

      {/* ═══ Hero header ═══ */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600" />
        <div className="absolute -top-24 -right-10 w-80 h-80 rounded-full bg-fuchsia-400/30 blur-3xl" />
        <div className="absolute -bottom-28 -left-10 w-80 h-80 rounded-full bg-indigo-400/30 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '22px 22px' }} />

        <div className="relative mx-auto max-w-[1600px] px-4 sm:px-6 pt-5 pb-14 text-white">
          <div className="flex items-center gap-3">
            {photo ? (
              <img src={photo} alt="" className="w-11 h-11 rounded-2xl object-cover ring-2 ring-white/40 shadow-lg"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur grid place-items-center ring-2 ring-white/25 shadow-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              {who ? (
                <div className="text-[12px] text-white/75 leading-tight truncate">Assalomu alaykum, <b className="text-white">{who}</b> 👋</div>
              ) : (
                <div className="text-[12px] text-white/75 leading-tight">Xush kelibsiz 👋</div>
              )}
              <div className="text-[19px] sm:text-[22px] font-extrabold leading-tight tracking-tight">XATO to&apos;lovlar</div>
            </div>

            <div className="ml-auto flex items-center gap-1.5 rounded-2xl bg-white/12 backdrop-blur-md ring-1 ring-white/25 px-3.5 py-2 shadow-lg">
              <div className="text-right leading-none">
                <div className="text-[24px] sm:text-[28px] font-black tabular-nums">{data ? data.count : '—'}</div>
                <div className="text-[9.5px] uppercase tracking-wider text-white/70 mt-0.5">jami xato</div>
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[12px] text-white/75 max-w-2xl flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2 py-0.5 text-[10.5px] font-semibold text-white">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" /> Jonli · 45s
            </span>
            <span>CRM&apos;da tasdiqlanmagan to&apos;lovlar — to&apos;g&apos;ri shartnomani biriktiring, ro&apos;yxatdan yo&apos;qoladi.</span>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mx-auto max-w-md mt-10 px-6">
          <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-rose-200 dark:ring-rose-900/60 p-6 text-center shadow-xl">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-50 dark:bg-rose-950/40 grid place-items-center mb-3">
              <ShieldCheck className="w-6 h-6 text-rose-500" />
            </div>
            <div className="text-[14px] font-bold text-rose-700 dark:text-rose-300">{error}</div>
            <div className="text-[12px] text-slate-400 mt-1">Ruxsat yo&apos;q yoki havola noto&apos;g&apos;ri.</div>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-[1600px] px-3 sm:px-6 -mt-8 relative z-10 pb-10">

          {/* ═══ Stat + filter cards ═══ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            <StatCard tone="slate" label="Yuklangan" value={data ? String(allRows.length) : '—'}
              hint={data ? `${data.count} ta jami` : ''} icon={<Layers className="w-4 h-4" />}
              active={flow === 'all'} onClick={() => setFlow('all')} />
            <StatCard tone="emerald" label="Kirim" value={data ? String(stats.inC) : '—'}
              hint={data ? fmtCompact(stats.inSum) : ''} icon={<ArrowDownLeft className="w-4 h-4" />}
              active={flow === 'in'} onClick={() => setFlow(flow === 'in' ? 'all' : 'in')} />
            <StatCard tone="rose" label="Chiqim" value={data ? String(stats.outC) : '—'}
              hint={data ? fmtCompact(stats.outSum) : ''} icon={<ArrowUpRight className="w-4 h-4" />}
              active={flow === 'out'} onClick={() => setFlow(flow === 'out' ? 'all' : 'out')} />
            <StatCard tone="amber" label="Jarayonda" value={data ? String(stats.pendingC) : '—'}
              hint={data ? 'tasdiq kutilmoqda' : ''} icon={<Clock className="w-4 h-4" />}
              active={flow === 'pending'} onClick={() => setFlow(flow === 'pending' ? 'all' : 'pending')} />
          </div>

          {/* ═══ Sticky search bar ═══ */}
          <div className="sticky top-2 z-20 mt-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Shartnoma, klient, obyekt yoki izoh bo'yicha qidirish…"
                className="w-full h-12 pl-10 pr-10 rounded-2xl bg-white/90 dark:bg-slate-900/85 backdrop-blur-md ring-1 ring-slate-200/80 dark:ring-slate-700 shadow-lg shadow-slate-900/5 outline-none focus:ring-2 focus:ring-violet-400 text-[13.5px] transition"
              />
              {q && (
                <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {data && rows.length > 0 && (
            <div className="mt-2 px-1 text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">{rows.length} ta · sahifa {safePage}/{totalPages}</div>
          )}

          {/* ═══ Grid ═══ */}
          {!data ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 mt-4">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="mt-16 text-center">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 grid place-items-center shadow-sm mb-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <div className="text-[14px] font-semibold text-slate-500 dark:text-slate-300">Topilmadi</div>
              <div className="text-[12px] text-slate-400 mt-0.5">Qidiruv yoki filtrni o&apos;zgartiring</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 mt-4">
              {pageRows.map((r) => {
                const isIn = (r.amount ?? 0) >= 0;
                return (
                  <button key={r.id} onClick={() => setSelected(r)}
                    className={`group relative text-left rounded-2xl bg-white dark:bg-slate-900 ring-1 p-4 pl-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] hover:shadow-[0_12px_36px_-8px_rgba(15,23,42,0.18)] hover:-translate-y-0.5 transition-all duration-200 overflow-hidden ${r.pending ? 'ring-amber-300/80 dark:ring-amber-800 bg-amber-50/40 dark:bg-amber-950/10' : 'ring-slate-200/70 dark:ring-slate-800 hover:ring-slate-300 dark:hover:ring-slate-700'}`}>
                    <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${r.pending ? 'bg-gradient-to-b from-amber-400 to-amber-500' : isIn ? 'bg-gradient-to-b from-emerald-400 to-emerald-500' : 'bg-gradient-to-b from-rose-400 to-rose-500'}`} />

                    <div className="flex items-start justify-between gap-2">
                      <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 px-2 py-1 font-mono font-bold text-[12px] text-rose-700 dark:text-rose-300 ring-1 ring-rose-100 dark:ring-rose-900/50">
                        {r.contractNo}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-extrabold tabular-nums ${isIn ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'}`}>
                        {isIn ? <ArrowDownLeft className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                        {fmtMoney(r.amount)}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="tabular-nums font-medium">{fmtDate(r.date)}</span>
                      {r.object && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">
                          <Building2 className="w-3 h-3" />{r.object}
                        </span>
                      )}
                      {r.txType && (
                        <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">{r.txType}</span>
                      )}
                    </div>

                    {r.client && (
                      <div className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                        <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{r.client}</span>
                      </div>
                    )}
                    {r.purpose && (
                      <div className="mt-1 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2">{r.purpose}</div>
                    )}

                    {r.pending ? (
                      <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/50 px-2 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-900/50">
                        <Clock className="w-3.5 h-3.5" /> Tasdiq kutilmoqda
                      </div>
                    ) : r.rejected ? (
                      <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-100 dark:bg-rose-950/50 px-2 py-1 text-[11px] font-bold text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900/50">
                        <RotateCcw className="w-3.5 h-3.5" /> Rad etilgan — qayta yuboring
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-rose-500/0 group-hover:text-rose-600 dark:group-hover:text-rose-300 transition-colors">
                        <Link2 className="w-3.5 h-3.5" /> Shartnoma biriktirish →
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* ═══ Pagination ═══ */}
          {data && totalPages > 1 && (
            <div className="flex items-center justify-center gap-1.5 mt-6 flex-wrap">
              <button onClick={() => setPage(1)} disabled={safePage <= 1}
                className="h-9 px-3 grid place-items-center rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[12px] font-semibold shadow-sm disabled:opacity-40 hover:ring-violet-300 transition">« 1</button>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
                className="h-9 w-9 grid place-items-center rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm disabled:opacity-40 hover:ring-violet-300 transition">
                <ChevronLeft className="w-4 h-4" />
              </button>
              {(() => {
                const nums: (number | string)[] = [];
                const start = Math.max(1, safePage - 1);
                const end = Math.min(totalPages, safePage + 1);
                if (start > 1) nums.push('…l');
                for (let i = start; i <= end; i++) nums.push(i);
                if (end < totalPages) nums.push('…r');
                return nums.map((n, i) => typeof n === 'number' ? (
                  <button key={i} onClick={() => setPage(n)}
                    className={`h-9 min-w-[36px] px-2.5 grid place-items-center rounded-xl text-[13px] font-bold tabular-nums shadow-sm ring-1 transition ${n === safePage ? 'bg-violet-600 text-white ring-violet-600' : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 hover:ring-violet-300'}`}>{n}</button>
                ) : (
                  <span key={i} className="px-1 text-slate-400 select-none">…</span>
                ));
              })()}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                className="h-9 w-9 grid place-items-center rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm disabled:opacity-40 hover:ring-violet-300 transition">
                <ChevronRight className="w-4 h-4" />
              </button>
              <button onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}
                className="h-9 px-3 grid place-items-center rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[12px] font-semibold shadow-sm disabled:opacity-40 hover:ring-violet-300 transition">{totalPages} »</button>
            </div>
          )}
        </div>
      )}

      {/* ═══ Biriktirish modali ═══ */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center animate-in fade-in duration-150" onClick={closeModal}>
          <div className="bg-white dark:bg-slate-900 w-full sm:max-w-2xl sm:rounded-3xl rounded-t-3xl max-h-[92vh] overflow-y-auto shadow-2xl ring-1 ring-slate-200/50 dark:ring-slate-800 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 z-10">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 grid place-items-center">
                <Link2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="font-bold text-[15px] text-slate-800 dark:text-slate-100">Shartnoma biriktirish</div>
              <button onClick={closeModal} className="ml-auto w-8 h-8 grid place-items-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* To'lov ma'lumoti — alohida maydonlar */}
              <div className="relative rounded-2xl bg-slate-50 dark:bg-slate-800/50 ring-1 ring-slate-100 dark:ring-slate-800 p-4 overflow-hidden">
                <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${((selected.amount ?? 0) < 0) ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 px-2 py-1 font-mono font-bold text-[12px] text-rose-700 dark:text-rose-300 ring-1 ring-rose-100 dark:ring-rose-900/50">{selected.contractNo}</span>
                  {selected.txType && <span className="text-[10.5px] text-slate-400 truncate max-w-[45%]">{selected.txType}</span>}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  <InfoField label="Sana" value={fmtDate(selected.date)} />
                  <InfoField label="Summa" value={fmtMoney(selected.amount)} valueClass={((selected.amount ?? 0) < 0) ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'} />
                  {selected.client && <div className="col-span-2"><InfoField label="Klient" value={selected.client} /></div>}
                  {selected.object && <div className="col-span-2"><InfoField label="Obyekt" value={selected.object} /></div>}
                  {selected.purpose && <div className="col-span-2"><InfoField label="Maqsad (izoh)" value={selected.purpose} multiline /></div>}
                  <div className="col-span-2"><InfoField label="ID" value={selected.id} mono copyable breakAll /></div>
                </div>
              </div>

              {selected.pending ? (
                <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-900/50 p-5 text-center">
                  <div className="w-11 h-11 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-900/40 grid place-items-center mb-2">
                    <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="text-[13.5px] font-bold text-amber-800 dark:text-amber-200">Ariza yuborilgan — tasdiq kutilmoqda</div>
                  <div className="text-[11.5px] text-amber-700/80 dark:text-amber-300/70 mt-1">Tasdiqlovchi xodim ko&apos;rib chiqib fayl bilan tasdiqlaydi.</div>
                </div>
              ) : (
              <>
              {selected.rejected && (
                <div className="flex items-start gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-900/50 p-3 text-[11.5px] text-rose-700 dark:text-rose-300">
                  <RotateCcw className="w-4 h-4 shrink-0 mt-0.5" /> <span>Oldingi ariza <b>rad etilgan</b>. To&apos;g&apos;ri shartnomani tanlab qayta yuboring.</span>
                </div>
              )}
              {/* CRM qidiruv */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">To&apos;g&apos;ri CRM shartnomasi</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    value={cq}
                    onChange={(e) => { setCq(e.target.value); setChosen(''); }}
                    placeholder="Shartnoma raqami yoki mijoz ismi…"
                    className="w-full h-11 pl-9 pr-3 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-indigo-400 text-[13px] transition"
                  />
                  {crmLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 animate-spin" />}
                </div>
                {crmItems.length > 0 && (
                  <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto shadow-sm">
                    {crmItems.map((it: any, i: number) => (
                      <button key={i} onClick={() => { setChosen(it.contract || ''); setCq(it.contract || ''); setCrmItems([]); }}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors">
                        <div className="font-mono font-bold text-[12px] text-indigo-700 dark:text-indigo-300">{it.contract}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{it.clientFullName || it.client_full_name || it.customerName || it.client || it.object || ''}</div>
                      </button>
                    ))}
                  </div>
                )}
                {chosen && (
                  <div className="flex items-center gap-1.5 text-[12px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Tanlandi: {chosen}
                  </div>
                )}
              </div>

              {/* Ariza fayli — MAJBURIY */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" /> Ariza fayli <span className="text-rose-500">*majburiy</span>
                </label>
                <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={onPickFile} className="hidden" />
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className={`w-full flex flex-col items-center justify-center gap-1.5 py-5 px-3 rounded-xl border-2 border-dashed transition-all text-[12px] ${arizaFile ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:border-violet-400 hover:bg-violet-50/40 dark:hover:bg-violet-950/10'}`}>
                  {arizaFile ? <FileCheck2 className="w-6 h-6" /> : <Upload className="w-6 h-6" />}
                  <span className="truncate max-w-full font-semibold">{arizaFile ? arizaFile.name : 'Ariza faylini tanlang'}</span>
                  <span className="text-[10px] text-slate-400">{arizaFile ? `${(arizaFile.size / 1024 / 1024).toFixed(1)} MB` : 'PDF, DOC, JPG, PNG — max 25MB'}</span>
                </button>
              </div>

              {assignError && (
                <div className="flex items-start gap-2 text-[12px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{assignError}</span>
                </div>
              )}

              <button onClick={doAssign} disabled={!chosen || !arizaFile || assigning}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-[14px] shadow-lg shadow-violet-600/25 transition-all flex items-center justify-center gap-2">
                {assigning ? <><Loader2 className="w-4 h-4 animate-spin" /> Yuborilmoqda…</> : <><Send className="w-4 h-4" /> Ariza yuborish</>}
              </button>
              <div className="text-[10.5px] text-slate-400 dark:text-slate-500 text-center">Shartnoma + ariza fayli bilan yuboriladi — tasdiqlovchi xodim tasdiqlagach to&apos;lov to&apos;g&apos;rlanadi.</div>
              </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Info maydoni (modal) ─── */
function InfoField({ label, value, valueClass, mono, multiline, copyable, breakAll }: {
  label: string; value: string; valueClass?: string; mono?: boolean; multiline?: boolean; copyable?: boolean; breakAll?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">{label}</div>
      <div className={`flex items-start gap-1.5 font-semibold text-slate-800 dark:text-slate-200 ${mono ? 'font-mono text-[11px]' : 'text-[12.5px]'} ${valueClass || ''}`}>
        <span className={
          multiline ? 'font-normal text-[12px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words'
          : breakAll ? 'break-all leading-relaxed'
          : 'truncate'
        }>{value}</span>
        {copyable && (
          <button onClick={() => navigator.clipboard?.writeText(value)} className="shrink-0 mt-0.5 text-slate-400 hover:text-violet-500 transition-colors" title="Nusxa olish">
            <Copy className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Stat/filter card ─── */
function StatCard({ tone, label, value, hint, icon, active, onClick }: {
  tone: 'slate' | 'emerald' | 'rose' | 'amber'; label: string; value: string; hint: string;
  icon: ReactNode; active: boolean; onClick: () => void;
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800',
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40',
    rose: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40',
  };
  const ring: Record<string, string> = {
    slate: 'ring-slate-400 dark:ring-slate-500',
    emerald: 'ring-emerald-400',
    rose: 'ring-rose-400',
    amber: 'ring-amber-400',
  };
  return (
    <button onClick={onClick}
      className={`text-left rounded-2xl bg-white/80 dark:bg-slate-900/70 backdrop-blur ring-1 p-3 shadow-sm transition-all hover:shadow-md ${active ? `ring-2 ${ring[tone]}` : 'ring-slate-200/70 dark:ring-slate-800'}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</span>
        <span className={`w-6 h-6 rounded-lg grid place-items-center ${tones[tone]}`}>{icon}</span>
      </div>
      <div className="text-[20px] font-black tabular-nums text-slate-800 dark:text-slate-100 mt-0.5">{value}</div>
      <div className="text-[10.5px] text-slate-400 truncate">{hint}</div>
    </button>
  );
}

/* ─── Skeleton ─── */
function SkeletonCard() {
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200/70 dark:ring-slate-800 p-4 pl-5 relative overflow-hidden">
      <span className="absolute left-0 top-0 bottom-0 w-1.5 bg-slate-200 dark:bg-slate-800" />
      <div className="flex items-center justify-between">
        <div className="h-6 w-24 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
        <div className="h-6 w-20 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
      </div>
      <div className="h-3 w-40 rounded bg-slate-100 dark:bg-slate-800 animate-pulse mt-3" />
      <div className="h-3.5 w-32 rounded bg-slate-100 dark:bg-slate-800 animate-pulse mt-3" />
      <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800 animate-pulse mt-2" />
    </div>
  );
}
