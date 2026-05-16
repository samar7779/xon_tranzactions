'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ScanLine, Search, X, Loader2, AlertTriangle, CheckCircle2,
  Upload, ChevronDown, ChevronRight, FileSpreadsheet, Hash,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Mode = 'single' | 'bulk';

interface BulkRow {
  id: string;
  status: 'pending' | 'loading' | 'done' | 'error';
  result?: any;
  error?: string;
}

export function IdInspectorDialog({ iconOnly }: { iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('single');

  // single
  const [id, setId] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // bulk
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  const mut = useMutation({
    mutationFn: (rawId: string) => api.post<any>('/transactions/inspect-id', { id: rawId }, { timeout: 30_000 }),
    onSuccess: (r: any) => { setResult(r); setError(null); },
    onError: (e: any) => { setError(e?.message || 'Xato'); setResult(null); },
  });

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = id.trim();
    if (!trimmed) return;
    setResult(null);
    setError(null);
    mut.mutate(trimmed);
  }

  function clear() {
    setId('');
    setResult(null);
    setError(null);
  }

  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o) {
      setId(''); setResult(null); setError(null);
      setRows([]); setBulkProgress(0); setBulkRunning(false);
      setMode('single');
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setRows([]);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.postForm<{ ok: boolean; ids: string[]; error?: string }>(
        '/transactions/parse-ids-excel',
        fd,
      );
      if (!r.ok) throw new Error(r.error || 'Excel parse xatosi');
      const ids = r.ids || [];
      if (ids.length === 0) throw new Error("A ustunda ID topilmadi");
      setRows(ids.map((id) => ({ id, status: 'pending' })));
    } catch (err: any) {
      setError(err?.message || 'Yuklash xato');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function runBulk() {
    if (rows.length === 0 || bulkRunning) return;
    setBulkRunning(true);
    setBulkProgress(0);
    const updated = [...rows];
    for (let i = 0; i < updated.length; i++) {
      updated[i] = { ...updated[i], status: 'loading' };
      setRows([...updated]);
      try {
        // Timeout 60s — bank javobi 5-15s, ba'zan sekinroq
        const r = await api.post<any>('/transactions/inspect-id', { id: updated[i].id }, { timeout: 60_000 });
        updated[i] = { ...updated[i], status: 'done', result: r };
      } catch (e: any) {
        updated[i] = { ...updated[i], status: 'error', error: e?.message || 'xato' };
      }
      setRows([...updated]);
      setBulkProgress(i + 1);
      // Bankni urmaslik uchun IDlar orasida qisqa pauza
      if (i < updated.length - 1) {
        await new Promise((res) => setTimeout(res, 250));
      }
    }
    setBulkRunning(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          title="ID bo'yicha bankdan qidirish"
          className={cn(
            'inline-flex items-center justify-center rounded-xl shrink-0',
            'bg-gradient-to-br from-indigo-500 to-purple-600 text-white',
            'shadow-sm hover:shadow-lg hover:shadow-indigo-500/30',
            'transition-all duration-200 hover:scale-105 active:scale-95',
            'ring-1 ring-indigo-400/30',
            iconOnly ? 'w-10 h-10' : 'h-9 px-3 gap-2 text-[12px] font-semibold',
          )}
        >
          <ScanLine className={iconOnly ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
          {!iconOnly && <span>ID tekshirish</span>}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white">
              <ScanLine className="h-3.5 w-3.5" />
            </div>
            Tranzaksiya ID — bankdan qidirish
          </DialogTitle>
        </DialogHeader>

        {/* Mode tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg mt-2">
          <button
            onClick={() => setMode('single')}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors',
              mode === 'single' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <Hash className="h-3.5 w-3.5" />
            <span>Bitta ID</span>
          </button>
          <button
            onClick={() => setMode('bulk')}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors',
              mode === 'bulk' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Excel'dan import (A ustun)</span>
          </button>
        </div>

        {/* ── SINGLE ── */}
        {mode === 'single' && (
          <>
            <form onSubmit={submit} className="flex items-stretch gap-2 mt-3">
              <div className="relative flex-1">
                <Input
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="general_id_num_ddate_acc_ct_acc_dt_amount_sign"
                  className="h-10 pr-9 font-mono text-[11px]"
                  autoFocus
                />
                {id && (
                  <button
                    type="button"
                    onClick={clear}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button
                type="submit"
                disabled={!id.trim() || mut.isPending}
                className="h-10 px-4 rounded-xl font-semibold gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white"
              >
                {mut.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Qidirilmoqda</>
                ) : (
                  <><Search className="h-4 w-4" /> Qidirish</>
                )}
              </Button>
            </form>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 ring-1 ring-rose-200 text-rose-800 text-[12px] mt-3">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="break-all">{error}</div>
              </div>
            )}

            {result && <div className="mt-3"><SingleResult data={result} /></div>}
          </>
        )}

        {/* ── BULK ── */}
        {mode === 'bulk' && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                onClick={() => fileRef.current?.click()}
                disabled={uploading || bulkRunning}
                className="h-10 px-4 rounded-xl gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {uploading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...</>
                ) : (
                  <><Upload className="h-4 w-4" /> Excel yuklash (.xlsx)</>
                )}
              </Button>
              {rows.length > 0 && (
                <>
                  <div className="text-[12px] text-slate-600">
                    {rows.length} ta ID topildi
                    {bulkRunning && <span className="ml-2 text-indigo-600 font-semibold">· {bulkProgress}/{rows.length}</span>}
                  </div>
                  <Button
                    onClick={runBulk}
                    disabled={bulkRunning}
                    className="h-10 px-4 rounded-xl gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white ml-auto"
                  >
                    {bulkRunning ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Tekshirilyapti</>
                    ) : (
                      <><Search className="h-4 w-4" /> Tekshirishni boshlash</>
                    )}
                  </Button>
                </>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 ring-1 ring-rose-200 text-rose-800 text-[12px]">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="break-all">{error}</div>
              </div>
            )}

            {!rows.length && !uploading && !error && (
              <div className="text-center text-[12px] text-slate-400 py-8 rounded-xl ring-1 ring-dashed ring-slate-200">
                Excel faylda <b>A ustun</b>da ID'lar bo'lsin (har bir qator alohida ID).<br />
                Birinchi qator header bo'lishi mumkin — avtomatik aniqlanadi.
              </div>
            )}

            {rows.length > 0 && (
              <div className="rounded-xl ring-1 ring-slate-200 divide-y divide-slate-100 overflow-hidden">
                {rows.map((row, i) => (
                  <BulkRowItem key={i} row={row} index={i} />
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkRowItem({ row, index }: { row: BulkRow; index: number }) {
  const [open, setOpen] = useState(false);
  const isDone = row.status === 'done';
  const v = isDone ? verdictStyle(row.result?.verdict || 'no_data') : null;

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!isDone && row.status !== 'error'}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-slate-50',
          (!isDone && row.status !== 'error') && 'cursor-default',
        )}
      >
        <span className="text-slate-400 font-mono w-7 shrink-0">{index + 1}.</span>
        <span className="font-mono truncate flex-1 text-slate-700">{row.id}</span>
        {row.status === 'pending' && (
          <span className="text-[10px] text-slate-400 shrink-0">kutilmoqda</span>
        )}
        {row.status === 'loading' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500 shrink-0" />
        )}
        {row.status === 'error' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold shrink-0">
            xato
          </span>
        )}
        {isDone && v && (
          <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0', v.bg, v.text)}>
            {v.short}
          </span>
        )}
        {(isDone || row.status === 'error') && (
          open
            ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        )}
      </button>
      {open && isDone && (
        <div className="px-3 py-3 bg-slate-50/60 border-t border-slate-100">
          <SingleResult data={row.result} />
        </div>
      )}
      {open && row.status === 'error' && (
        <div className="px-3 py-2 bg-rose-50/60 border-t border-rose-100 text-[11px] text-rose-700 break-all">
          {row.error}
        </div>
      )}
    </div>
  );
}

function verdictStyle(verdict: string): { bg: string; ring: string; text: string; title: string; short: string } {
  const map: Record<string, { bg: string; ring: string; text: string; title: string; short: string }> = {
    found:     { bg: 'bg-emerald-50', ring: 'ring-emerald-200', text: 'text-emerald-900', title: '✅ Bankda mavjud',          short: '✅ Mavjud' },
    shifted:   { bg: 'bg-amber-50',   ring: 'ring-amber-200',   text: 'text-amber-900',   title: "⚠️ Boshqa kunga ko'chirilgan", short: '⚠️ Kun siljigan' },
    cancelled: { bg: 'bg-rose-50',    ring: 'ring-rose-200',    text: 'text-rose-900',    title: "🔴 Bekor qilingan to'lov",   short: '🔴 Bekor' },
    no_data:   { bg: 'bg-slate-50',   ring: 'ring-slate-200',   text: 'text-slate-700',   title: "ℹ️ Ma'lumot olinmadi",        short: 'ℹ️ Yo\'q' },
    partial:   { bg: 'bg-amber-50',   ring: 'ring-amber-200',   text: 'text-amber-900',   title: "⚠️ To'liq emas",               short: '⚠️ Qisman' },
  };
  return map[verdict] || map.no_data;
}

function SingleResult({ data }: { data: any }) {
  const p = data.parsed || {};
  const v = verdictStyle(data.verdict || 'no_data');
  return (
    <div className="space-y-3">
      <div className={cn('px-4 py-3 rounded-xl ring-1', v.bg, v.ring, v.text)}>
        <div className="text-[13px] font-bold">{v.title}</div>
      </div>
      <InfoBox title="Bu ID ga tegishli to'lov">
        <KV k="general_id" v={p.generalId} mono />
        <KV k="num" v={p.num} mono />
        <KV k="sana" v={p.ddate} />
        <KV k="summa" v={p.amountSom != null ? p.amountSom.toLocaleString('uz-UZ') + " so'm" : '—'} />
        <KV k="yo'nalish" v={p.direction} />
        <KV k="acc_dt (debit)" v={p.accDt} mono small />
        <KV k="acc_ct (credit)" v={p.accCt} mono small />
      </InfoBox>
    </div>
  );
}

function InfoBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">{title}</div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function KV({ k, v, mono, small }: { k: string; v: any; mono?: boolean; small?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="text-[11px] text-slate-500 shrink-0 min-w-[110px]">{k}</span>
      <span
        className={cn(
          'flex-1 break-all text-slate-800',
          mono && 'font-mono',
          small ? 'text-[10.5px]' : 'text-[12px]',
        )}
      >
        {v ?? '—'}
      </span>
    </div>
  );
}
