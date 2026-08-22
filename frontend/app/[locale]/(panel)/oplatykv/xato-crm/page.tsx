'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Check, AlertTriangle, ArrowRight, ChevronDown,
  ChevronLeft, ChevronRight, RefreshCw, Building2, Scissors, Search, Copy, X, Download,
} from 'lucide-react';
import { api, apiDownload } from '@/lib/api';
import { formatMoney, cn } from '@/lib/utils';

type Mode = 'xato' | 'unsplit';

interface KvItem {
  id: string;
  contractNo: string;
  date: string;
  paymentAmount: string | null;
  object: string | null;
  client: string | null;
  purpose: string | null;
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
  viaXonpay?: boolean;
  type?: string | null;
}

const PER_PAGE = 20;

export default function XatoCrmPage() {
  const [mode, setMode] = useState<Mode>('xato');
  return (
    <div className="p-6 lg:p-8 space-y-4">
      {/* Sub-tablar */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/60">
        <SubTab active={mode === 'xato'} onClick={() => setMode('xato')} icon={AlertTriangle} label="Shartnoma yo'q" hint="CRM'dan topib biriktirish" />
        <SubTab active={mode === 'unsplit'} onClick={() => setMode('unsplit')} icon={Scissors} label="Split yo'q" hint="Ustunga (bosh./oylik) joylash" />
      </div>
      <ListView key={mode} mode={mode} />
    </div>
  );
}

function SubTab({ active, onClick, icon: Icon, label, hint }: { active: boolean; onClick: () => void; icon: any; label: string; hint: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3.5 py-2 rounded-lg text-left transition-all',
        active
          ? 'bg-white dark:bg-slate-950 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700'
          : 'hover:bg-white/60 dark:hover:bg-slate-900/50',
      )}
    >
      <div className={cn('flex items-center gap-1.5 text-[13px] font-semibold', active ? 'text-indigo-700 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400')}>
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{hint}</div>
    </button>
  );
}

function ListView({ mode }: { mode: Mode }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'found' | 'notfound'>('all');
  const [bulk, setBulk] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [qInput]);

  const filter = mode === 'xato' ? 'xatoOnly=true' : 'unsplitOnly=true';
  const kvQ = useQuery({
    queryKey: ['oplata-kv-xatocrm', mode, page, q],
    queryFn: () =>
      api.get<{ items: KvItem[]; total: number; pageCount: number }>(
        `/oplata-kv?${filter}&page=${page}&perPage=${PER_PAGE}&sortBy=date&sortDir=desc${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
  });
  const items = kvQ.data?.items || [];
  const total = kvQ.data?.total || 0;
  const pageCount = kvQ.data?.pageCount || 1;

  // Kompozit id — Excel qatorlarda sourceTxId null bo'lib, kompozit `id`da bo'ladi (bank kompozit).
  const compositeOf = (it: KvItem) => it.sourceTxId || it.id || '';
  const ids = useMemo(() => items.map(compositeOf).filter((x): x is string => !!x), [items]);
  const idsKey = ids.join(',');
  const matchQ = useQuery({
    queryKey: ['crm-match', idsKey],
    enabled: ids.length > 0,
    queryFn: () => api.post<Array<{ id: string; crm: CrmMatch | null }>>(
      '/crm/match-composites',
      { items: items.map((it) => ({ id: compositeOf(it), purpose: it.purpose || '', date: String(it.date || '').slice(0, 10) })) },
      { timeout: 180_000 },
    ),
  });
  const matchMap = useMemo(() => {
    const m = new Map<string, CrmMatch | null>();
    for (const r of matchQ.data || []) m.set(r.id, r.crm);
    return m;
  }, [matchQ.data]);

  const fix = useMutation({
    mutationFn: (p: { id: string; contractNo?: string; initialAmount?: number; monthlyAmount?: number }) =>
      api.post(`/oplata-kv/${p.id}/assign-from-crm`, {
        contractNo: p.contractNo,
        initialAmount: p.initialAmount,
        monthlyAmount: p.monthlyAmount,
      }, { timeout: 120_000 }),
    onSuccess: (r: any) => {
      const cat = r?.split?.item?.paymentCategory || r?.item?.paymentCategory;
      const catLabel = cat === 'FIRST' ? "boshlang'ich" : cat === 'MONTHLY' ? 'oylik' : cat === 'GENERAL' ? 'umumiy' : '';
      toast.success(`Bajarildi${catLabel ? ` · ${catLabel}` : ''}`);
      qc.invalidateQueries({ queryKey: ['oplata-kv-xatocrm'] });
      qc.invalidateQueries({ queryKey: ['oplata-kv'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
    onSettled: () => setConfirmId(null),
  });

  const foundItems = useMemo(() => items.filter((it) => matchMap.get(compositeOf(it))), [items, matchMap]);
  const matchedCount = foundItems.length;
  const displayItems = useMemo(() => {
    if (statusFilter === 'all') return items;
    return items.filter((it) => {
      const has = !!matchMap.get(compositeOf(it));
      return statusFilter === 'found' ? has : !has;
    });
  }, [items, matchMap, statusFilter]);

  const runBulk = async () => {
    if (bulk.running) return;
    const confirmMsg = mode === 'xato'
      ? "Barcha XATO to'lovlar CRM'dan topilib, topilganlariga shartnoma + ustun (CRM bo'yicha) qo'yiladi. Davom etilsinmi?"
      : "Barcha splitlanmagan to'lovlar CRM'dan topilib, CRM aytgan ustunga (boshlang'ich/oylik) joylanadi. Davom etilsinmi?";
    if (!window.confirm(confirmMsg)) return;
    // HAMMASI serverda — bitta so'rov (tez, client round-trip yo'q).
    setBulk({ running: true, done: 0, total: 0 });
    try {
      const r: any = await api.post('/oplata-kv/bulk-crm-fix', { mode }, { timeout: 900_000 });
      toast.success(`${r?.fixed ?? 0} ta to'g'irlandi (${r?.matched ?? 0} topildi, jami ${r?.total ?? 0} tekshirildi)`);
    } catch (e: any) {
      toast.error(e?.message || 'Xato');
    }
    setBulk({ running: false, done: 0, total: 0 });
    qc.invalidateQueries({ queryKey: ['oplata-kv-xatocrm'] });
    qc.invalidateQueries({ queryKey: ['oplata-kv'] });
  };

  // BARCHA qatorlarni server-side xlsx qilib yuklab olish (ustunlar Excel'da to'g'ri).
  const [downloading, setDownloading] = useState(false);
  const downloadXlsx = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await apiDownload(
        `/oplata-kv/export?${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}&sortBy=date&sortDir=desc`,
        `xato-crm-${mode}.xlsx`,
      );
    } catch (e: any) {
      toast.error(e?.message || 'Yuklab olishda xato');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Qidiruv (ix_id / shartnoma / mijoz / purpose bo'yicha) */}
      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="ix_id / shartnoma / mijoz / purpose bo'yicha qidirish…"
          className="w-full pl-8 pr-8 py-2 text-[13px] rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-indigo-400 outline-none text-slate-700 dark:text-slate-200"
        />
        {qInput && (
          <button onClick={() => setQInput('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
        )}
      </div>

      {/* Statistika qatori */}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className={cn('px-2.5 py-1 rounded-lg font-semibold', mode === 'xato' ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400' : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400')}>
          {mode === 'xato' ? 'Shartnoma yo\'q' : 'Split yo\'q'}: {total}
        </span>
        {ids.length > 0 && (
          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-semibold">
            {matchQ.isFetching ? 'CRM…' : `CRM'da topildi: ${matchedCount}/${items.length}`}
          </span>
        )}
        <button
          onClick={() => { kvQ.refetch(); matchQ.refetch(); }}
          className="h-7 w-7 grid place-items-center rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          title="Yangilash"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', (kvQ.isFetching || matchQ.isFetching) && 'animate-spin')} />
        </button>

        {/* Status filtri */}
        <div className="inline-flex rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
          {([['all', 'Hammasi'], ['found', 'Topildi'], ['notfound', 'Topilmadi']] as const).map(([v, lbl]) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              className={cn('px-2.5 py-1 text-[11.5px] font-medium transition-colors', statusFilter === v ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800')}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Yuklab olish (CSV/Excel) */}
        <button
          onClick={downloadXlsx}
          disabled={downloading}
          className="ml-auto px-2.5 py-1.5 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-[12px] font-medium flex items-center gap-1.5 disabled:opacity-60"
          title="Barcha qatorlarni Excel (xlsx) qilib yuklab olish"
        >
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Yuklab olish
        </button>

        {/* Bulk — BARCHA sahifadagilarni to'g'irlash (Split yo'q → server bulk; XATO → hammasini match+assign) */}
        {total > 0 && (
          <button
            onClick={runBulk}
            disabled={bulk.running}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-[12px] font-semibold shadow-sm flex items-center gap-1.5 disabled:opacity-70"
            title="Barcha sahifalardagi to'lovlarni to'g'irlaydi"
          >
            {bulk.running
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {bulk.total > 0 ? `${bulk.done}/${bulk.total}…` : 'Bajarilmoqda…'}</>
              : <><Check className="h-3.5 w-3.5" /> Barchasini to'g'irlash</>}
          </button>
        )}
      </div>

      {kvQ.isLoading && (
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
        </div>
      )}

      {!kvQ.isLoading && items.length === 0 && (
        <div className="text-center py-14 text-slate-500 dark:text-slate-400">
          <Check className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
          {mode === 'xato' ? 'Shartnomasiz to\'lov yo\'q. 🎉' : 'Splitlanmagan to\'lov yo\'q. 🎉'}
        </div>
      )}

      <div className="space-y-2">
        {displayItems.map((it) => {
          const crm = matchMap.get(compositeOf(it)) || null;
          const matching = matchQ.isFetching && !matchQ.data;
          const confirming = confirmId === it.id;
          const busy = fix.isPending && fix.variables?.id === it.id;
          const open = openId === it.id;
          const amt = Number(it.paymentAmount || 0);
          // Fix faqat CRM'da TOPILGANDA — topilmaganlarni bu yerdan to'g'irlamaymiz.
          const canFix = !!crm;
          const fixLabel = mode === 'xato' ? 'Qo\'shish' : 'To\'g\'irlash';

          return (
            <div key={it.id} className={cn('rounded-xl ring-1 bg-white dark:bg-slate-950 transition-shadow', open ? 'ring-indigo-300 dark:ring-indigo-800 shadow-sm' : 'ring-slate-200 dark:ring-slate-700')}>
              {/* Asosiy qator */}
              <div className="p-3 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] gap-3 items-center">
                {/* LEFT — to'lov */}
                <button onClick={() => setOpenId(open ? null : it.id)} className="text-left space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0', mode === 'xato' ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400' : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400')}>
                      {mode === 'xato' ? 'XATO' : 'SPLIT YO\'Q'}
                    </span>
                    <span className={cn('text-[13px] font-bold', amt < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100')}>{formatMoney(amt)} UZS</span>
                    <span className="text-[11px] text-slate-400 shrink-0">· {String(it.date).slice(0, 10)}</span>
                    <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform shrink-0', open && 'rotate-180')} />
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {mode === 'unsplit' && it.contractNo ? <span className="font-semibold text-slate-600 dark:text-slate-300">{it.contractNo} · </span> : null}
                    {it.object || '—'}{it.client ? ` · ${it.client}` : ''}
                  </div>
                </button>

                <div className="hidden md:flex justify-center text-slate-300 dark:text-slate-600"><ArrowRight className="h-4 w-4" /></div>

                {/* MID — CRM natija */}
                <div className="min-w-0">
                  {matching ? (
                    <div className="flex items-center gap-1.5 text-[12px] text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> CRM…</div>
                  ) : crm ? (
                    <div className="space-y-1">
                      <span className="inline-flex items-center gap-1 flex-wrap">
                        <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
                          <Building2 className="h-3 w-3" /> {crm.contract}
                        </span>
                        {crm.viaXonpay && (
                          <span className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-400 font-semibold">XonPay</span>
                        )}
                      </span>
                      <div className="flex flex-wrap gap-1 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">bosh: <b>{formatMoney(crm.initialAmount)}</b></span>
                        <span className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400">oylik: <b>{formatMoney(crm.monthlyAmount)}</b></span>
                        {crm.otherAmount > 0 && <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">boshqa: <b>{formatMoney(crm.otherAmount)}</b></span>}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> CRM'da topilmadi</div>
                  )}
                </div>

                {/* RIGHT — tugma */}
                <div className="flex justify-end">
                  {canFix && (!confirming ? (
                    <button
                      onClick={() => setConfirmId(it.id)}
                      disabled={busy}
                      className="text-[12px] px-3 py-1.5 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold shadow-sm flex items-center gap-1.5 disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {fixLabel}
                    </button>
                  ) : (
                    <button
                      onClick={() => fix.mutate({ id: it.id, contractNo: mode === 'xato' ? crm?.contract : undefined, initialAmount: crm?.initialAmount, monthlyAmount: crm?.monthlyAmount })}
                      disabled={busy}
                      className="text-[12px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm flex items-center gap-1.5 disabled:opacity-60 animate-pulse"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Tasdiqlash
                    </button>
                  ))}
                </div>
              </div>

              {/* Ochilgan batafsil */}
              {open && (
                <div className="px-3 pb-3 pt-1 border-t border-slate-100 dark:border-slate-800 grid md:grid-cols-2 gap-x-6 gap-y-1.5 text-[11.5px]">
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">ОплатыКв</div>
                    <D k="Shartnoma" v={it.contractNo || '—'} />
                    <D k="Summa" v={`${formatMoney(amt)} UZS`} />
                    <D k="Obyekt" v={it.object || '—'} />
                    <D k="Mijoz" v={it.client || '—'} />
                    <IdRow label="ix_id" value={it.id} />
                    {it.sourceTxId && <IdRow label="kompozit" value={it.sourceTxId} />}
                    {it.purpose && <div className="text-slate-500 dark:text-slate-400 rounded bg-slate-50 dark:bg-slate-900 px-2 py-1 mt-1">{it.purpose}</div>}
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">CRM</div>
                    {crm ? (
                      <>
                        <D k="Shartnoma" v={crm.contract} />
                        {crm.type && <D k="Turi" v={crm.type} />}
                        <D k="Boshlang'ich" v={formatMoney(crm.initialAmount)} />
                        <D k="Oylik" v={formatMoney(crm.monthlyAmount)} />
                        {crm.otherAmount > 0 && <D k="Boshqa" v={formatMoney(crm.otherAmount)} />}
                        <D k="Obyekt" v={crm.object || '—'} />
                        {crm.orderId && <D k="order_id" v={crm.orderId} />}
                        {crm.purpose && <div className="text-slate-500 dark:text-slate-400 rounded bg-slate-50 dark:bg-slate-900 px-2 py-1 mt-1">{crm.purpose}</div>}
                      </>
                    ) : (
                      <div className="text-amber-600 dark:text-amber-400">CRM'da bu id bo'yicha to'lov topilmadi.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="h-8 w-8 grid place-items-center rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-[12px] text-slate-500 dark:text-slate-400">{page} / {pageCount}</span>
          <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} className="h-8 w-8 grid place-items-center rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

function D({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-400 dark:text-slate-500 min-w-[74px]">{k}:</span>
      <span className="text-slate-700 dark:text-slate-200 font-medium break-all">{v}</span>
    </div>
  );
}

function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-slate-400 dark:text-slate-500 min-w-[74px] text-[10px] uppercase">{label}:</span>
      <span className="text-slate-500 dark:text-slate-400 font-mono text-[10px] break-all">{value}</span>
      <button
        onClick={() => { navigator.clipboard?.writeText(value); toast.success(`${label} nusxalandi`); }}
        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 shrink-0"
        title="Nusxalash"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}
