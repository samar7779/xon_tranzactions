'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertOctagon, Trash2, Edit3, Search, Calendar, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, X, CheckCircle2, ArrowRight, FileText,
  Wallet, Activity, Filter, Database, Sparkles, Banknote, ListChecks, Wand2,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { TransactionsTabs } from '@/components/transactions-tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn, formatMoney, formatDateTime } from '@/lib/utils';
import { useHasPermission } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';

interface ChangeItem {
  id: string;
  txId: string | null;
  externalId: string;
  accountId: string | null;
  changeType: 'DELETED' | 'EDITED';
  fieldsChanged: string[];
  oldData: any;
  newData: any;
  txnDate: string | null;
  amount: string | null;
  direction: 'IN' | 'OUT' | null;
  contractNumber: string | null;
  bankNameSnap: string | null;
  accountNoSnap: string | null;
  detectedAt: string;
  detectedBy: string | null;
  note: string | null;
  account?: { id: string; accountNo: string; ownerName: string | null; bank?: { name: string; code: string } } | null;
}

interface ListResp {
  ok: boolean;
  total: number;
  totals: { deleted: number; edited: number };
  page: number;
  perPage: number;
  items: ChangeItem[];
}

export default function ChangesPage() {
  const qc = useQueryClient();
  const canCheck = useHasPermission(PERMS.CHANGED_TXN_CHECK);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [accountId, setAccountId] = useState<string>('all');
  const [changeType, setChangeType] = useState<string>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [checkOpen, setCheckOpen] = useState(false);
  const [detail, setDetail] = useState<ChangeItem | null>(null);

  const accountsQ = useQuery({
    queryKey: ['bank-accounts-for-changes'],
    queryFn: () => api.get<{ items: any[] }>('/bank-accounts'),
  });

  const listQ = useQuery({
    queryKey: ['transactions-changes', dateFrom, dateTo, accountId, changeType, q, page, perPage],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (accountId && accountId !== 'all') params.set('accountId', accountId);
      if (changeType && changeType !== 'all') params.set('changeType', changeType);
      if (q.trim()) params.set('q', q.trim());
      params.set('page', String(page));
      params.set('perPage', String(perPage));
      return api.get<ListResp>(`/transactions/changes/list?${params}`);
    },
  });

  const items = listQ.data?.items || [];
  const total = listQ.data?.total || 0;
  const totals = listQ.data?.totals || { deleted: 0, edited: 0 };
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const hasActiveFilters = !!(dateFrom || dateTo || (accountId !== 'all') || (changeType !== 'all') || q.trim());

  // Aniq summa — sahifadagi yozuvlar bo'yicha
  const pageAmount = items.reduce((acc, it) => acc + (it.amount ? Math.abs(Number(it.amount)) : 0), 0);

  return (
    <>
      <Topbar title="O'zgargan to'lovlar" subtitle="Bank tomonida o'chirilgan yoki o'zgartirilgan tranzaksiyalar tarixi" />
      <TransactionsTabs />

      <div className="flex-1 p-3 sm:p-5 lg:p-6 space-y-5 w-full">
        {/* ═══ KPI ROW ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <KpiCard
            label="Jami yozuvlar"
            sub={hasActiveFilters ? 'filterga mos' : 'umumiy'}
            value={total.toLocaleString('ru-RU')}
            icon={ListChecks}
            tone="indigo"
          />
          <KpiCard
            label="Bank o'chirgan"
            sub={hasActiveFilters ? 'filterga mos' : 'umumiy'}
            value={totals.deleted.toLocaleString('ru-RU')}
            icon={Trash2}
            tone="rose"
          />
          <KpiCard
            label="Bank o'zgartirgan"
            sub={hasActiveFilters ? 'filterga mos' : 'umumiy'}
            value={totals.edited.toLocaleString('ru-RU')}
            icon={Edit3}
            tone="amber"
          />
          <KpiCard
            label="Sahifa summasi"
            sub={`${items.length} ta yozuv`}
            value={formatMoney(pageAmount, 'UZS').replace(' UZS', '')}
            suffix="UZS"
            icon={Banknote}
            tone="slate"
          />
        </div>

        {/* ═══ FILTERS BAR (inline, no card wrapper) ═══ */}
        <div className="bg-white rounded-2xl shadow-soft px-3 py-3 lg:px-4 lg:py-3 space-y-3">
          <div className="grid grid-cols-12 gap-2.5">
            {/* Search — keng */}
            <div className="col-span-12 lg:col-span-4 relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <Input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder="Composite ID, shartnoma, hisob raqami, bank nomi..."
                className="h-10 pl-9 pr-9"
              />
              {q && (
                <button
                  onClick={() => { setQ(''); setPage(1); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100"
                >
                  <X className="h-3.5 w-3.5 text-slate-400" />
                </button>
              )}
            </div>

            {/* Hisob */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-3">
              <Select value={accountId} onValueChange={(v) => { setAccountId(v); setPage(1); }}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Barcha hisoblar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha hisoblar</SelectItem>
                  {(accountsQ.data?.items || []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.accountNo}{a.ownerName ? ' · ' + a.ownerName : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Turi */}
            <div className="col-span-6 sm:col-span-3 lg:col-span-2">
              <Select value={changeType} onValueChange={(v) => { setChangeType(v); setPage(1); }}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hammasi</SelectItem>
                  <SelectItem value="DELETED">O'chirilgan</SelectItem>
                  <SelectItem value="EDITED">Tahrirlangan</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sanadan */}
            <div className="col-span-6 sm:col-span-3 lg:col-span-2">
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-10" />
            </div>

            {/* Sanagacha */}
            <div className="col-span-6 sm:col-span-3 lg:col-span-1">
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-10" />
            </div>
          </div>

          {/* Bottom action row */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-3 text-[11.5px] text-slate-500">
              {hasActiveFilters ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 font-medium">
                  <Filter className="h-3 w-3" /> filterlar aktiv
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-slate-400">
                  <Filter className="h-3 w-3" /> filtrlar yo'q
                </span>
              )}
              <span className="hidden lg:inline-flex items-center gap-1.5 text-slate-500">
                <Database className="h-3 w-3" />
                Sahifada: <b className="text-slate-700 tabular-nums">{items.length}</b> / {total.toLocaleString('ru-RU')}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5 text-slate-600"
                  onClick={() => {
                    setQ(''); setDateFrom(''); setDateTo('');
                    setAccountId('all'); setChangeType('all'); setPage(1);
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Tozalash
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => listQ.refetch()}
                disabled={listQ.isFetching}
                title="Qayta yuklash"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', listQ.isFetching && 'animate-spin')} />
                Yangilash
              </Button>
              {canCheck && (
                <Button
                  onClick={async () => {
                    if (!confirm("Status PENDING→COMPLETED bo'lgan barcha 'tahrirlangan' yozuvlarni o'chirasizmi?\n\n(Bu normal hayot sikli, bank tahriri emas — shovqin sifatida tushgan)")) return;
                    try {
                      const r: any = await api.post('/transactions/changes/cleanup-benign');
                      if (r?.ok) {
                        toast.success(`Tozalandi: ${r.deleted} ta yozuv`);
                        qc.invalidateQueries({ queryKey: ['transactions-changes'] });
                      } else {
                        toast.error(r?.message || 'Tozalanmadi');
                      }
                    } catch (e: any) {
                      toast.error(e?.message || 'Xato');
                    }
                  }}
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50"
                  title="PENDING→COMPLETED (normal flow) yozuvlarini o'chirish"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Noise tozalash
                </Button>
              )}
              {canCheck && (
                <Button
                  onClick={() => setCheckOpen(true)}
                  size="sm"
                  className="h-9 gap-1.5 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-md hover:shadow-lg hover:scale-[1.02] transition-all"
                  title="Sana orqali qo'lda tekshirish"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Qo'lda tekshirish
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ═══ TABLE ═══ */}
        <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-gradient-to-b from-slate-50 to-slate-50/40 text-[10px] uppercase tracking-wider text-slate-600 font-bold">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-3 text-left w-12">#</th>
                  <th className="px-3 py-3 text-left w-32">Turi</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Aniqlangan</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Tranzaksiya sanasi</th>
                  <th className="px-3 py-3 text-left">Bank · Hisob</th>
                  <th className="px-3 py-3 text-left">Composite ID</th>
                  <th className="px-3 py-3 text-left">Shartnoma</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Summa</th>
                  <th className="px-3 py-3 text-left">O'zgarishlar</th>
                  <th className="px-3 py-3 text-left w-20">Kim</th>
                </tr>
              </thead>
              <tbody>
                {listQ.isLoading && (
                  <tr><td colSpan={10} className="px-4 py-16 text-center text-slate-400">
                    <Loader2 className="h-6 w-6 animate-spin inline mr-2" />
                    <span className="font-medium">Yuklanmoqda...</span>
                  </td></tr>
                )}
                {!listQ.isLoading && items.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-20 text-center">
                    <div className="inline-flex flex-col items-center max-w-md">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 grid place-items-center mb-3 ring-1 ring-slate-200">
                        <AlertOctagon className="h-7 w-7 text-slate-400" />
                      </div>
                      <div className="text-[15px] font-bold text-slate-800">Yozuvlar topilmadi</div>
                      <div className="text-[12.5px] text-slate-500 mt-1.5 leading-relaxed">
                        {hasActiveFilters
                          ? "Filterlar ostida hech narsa topilmadi. Filterni o'zgartiring yoki tozalang."
                          : "Sync har safar ishlaganda avtomatik tekshiriladi. Hozircha bank tomonida o'zgargan to'lovlar yo'q."}
                      </div>
                      {canCheck && !hasActiveFilters && (
                        <Button
                          onClick={() => setCheckOpen(true)}
                          variant="outline"
                          className="mt-5 gap-2"
                        >
                          <Sparkles className="h-4 w-4" /> Qo'lda tekshirishni boshlash
                        </Button>
                      )}
                    </div>
                  </td></tr>
                )}
                {items.map((it, idx) => {
                  const isDel = it.changeType === 'DELETED';
                  const rowNum = (page - 1) * perPage + idx + 1;
                  return (
                    <tr
                      key={it.id}
                      onClick={() => setDetail(it)}
                      className={cn(
                        'border-b border-slate-100 hover:bg-indigo-50/30 transition-colors cursor-pointer group',
                        isDel && 'bg-rose-50/20',
                      )}
                    >
                      <td className="px-3 py-3 text-[11px] text-slate-400 tabular-nums">{rowNum}</td>
                      <td className="px-3 py-3">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold ring-1 whitespace-nowrap',
                          isDel
                            ? 'bg-rose-50 text-rose-700 ring-rose-200'
                            : 'bg-amber-50 text-amber-700 ring-amber-200',
                        )}>
                          {isDel ? <Trash2 className="h-3 w-3" /> : <Edit3 className="h-3 w-3" />}
                          {isDel ? "O'CHIRILGAN" : 'TAHRIRLANGAN'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-700 tabular-nums whitespace-nowrap text-[12px]">
                        {formatDateTime(it.detectedAt)}
                      </td>
                      <td className="px-3 py-3 text-slate-600 tabular-nums whitespace-nowrap text-[12px]">
                        {it.txnDate ? new Date(it.txnDate).toLocaleDateString('ru-RU') : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-800 text-[12.5px] leading-tight">
                          {it.bankNameSnap || it.account?.bank?.name || '—'}
                        </div>
                        <div className="text-[10.5px] text-slate-500 font-mono mt-0.5">
                          {it.accountNoSnap || it.account?.accountNo || '—'}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-[10.5px] text-slate-600 max-w-[200px] truncate" title={it.externalId}>
                        {it.externalId}
                      </td>
                      <td className="px-3 py-3">
                        {it.contractNumber ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 font-mono text-[11.5px] font-semibold">
                            {it.contractNumber}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {it.amount ? (
                          <span className={cn(
                            'tabular-nums font-bold text-[13px]',
                            it.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700',
                          )}>
                            {it.direction === 'IN' ? '+' : '−'}{formatMoney(Math.abs(Number(it.amount)), 'UZS').replace(' UZS', '')}
                            <span className="text-[10px] text-slate-400 ml-1 font-medium">UZS</span>
                          </span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {isDel ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold ring-1 ring-rose-100">
                            <Trash2 className="h-2.5 w-2.5" /> butun yozuv
                          </span>
                        ) : it.fieldsChanged && it.fieldsChanged.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {it.fieldsChanged.slice(0, 4).map((f) => (
                              <span key={f} className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold ring-1 ring-amber-100 font-mono">
                                {f}
                              </span>
                            ))}
                            {it.fieldsChanged.length > 4 && (
                              <span className="text-[10px] text-slate-500 px-1 py-0.5">+{it.fieldsChanged.length - 4}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[10.5px] text-slate-500 max-w-[120px] truncate" title={it.detectedBy || ''}>
                        {it.detectedBy ? (
                          it.detectedBy.startsWith('manual:')
                            ? <span className="text-indigo-700 font-medium">{it.detectedBy.replace('manual:', '')}</span>
                            : <span className="text-slate-500">{it.detectedBy}</span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          {total > 0 && (
            <div className="px-4 py-3 border-t border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[12px] text-slate-600">
              <div className="flex items-center gap-3">
                <span>
                  Jami: <b className="tabular-nums text-slate-800">{total.toLocaleString('ru-RU')}</b>
                </span>
                <span className="text-slate-300">·</span>
                <span>
                  Sahifa <b className="tabular-nums text-slate-800">{page}</b>/<b className="tabular-nums">{totalPages}</b>
                </span>
                <span className="text-slate-300 hidden sm:inline">·</span>
                <div className="hidden sm:flex items-center gap-1.5">
                  <Label className="text-[11px] text-slate-500 m-0">Sahifada:</Label>
                  <Select value={String(perPage)} onValueChange={(v) => { setPerPage(Number(v)); setPage(1); }}>
                    <SelectTrigger className="h-7 w-16 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)} className="h-8 px-2">«</Button>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-8 px-2">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 text-[12px] font-semibold text-slate-700 tabular-nums">{page}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-8 px-2">
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="h-8 px-2">»</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <ChangeDetailDialog item={detail} onClose={() => setDetail(null)} />
      <ManualCheckDialog
        open={checkOpen}
        onClose={() => setCheckOpen(false)}
        accounts={accountsQ.data?.items || []}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['transactions-changes'] })}
      />
    </>
  );
}

// ════════════════════════════════════════════════════════
// KPI Card
// ════════════════════════════════════════════════════════
function KpiCard({
  label, sub, value, suffix, icon: Icon, tone,
}: {
  label: string;
  sub?: string;
  value: string;
  suffix?: string;
  icon: any;
  tone: 'indigo' | 'rose' | 'amber' | 'slate' | 'emerald';
}) {
  const tones: Record<string, { bg: string; ring: string; iconBg: string; iconText: string; valText: string }> = {
    indigo: { bg: 'from-indigo-50/80 to-white', ring: 'ring-indigo-100', iconBg: 'bg-indigo-100 text-indigo-700', iconText: 'text-indigo-700', valText: 'text-slate-900' },
    rose:   { bg: 'from-rose-50/80 to-white',   ring: 'ring-rose-100',   iconBg: 'bg-rose-100 text-rose-700',     iconText: 'text-rose-700',   valText: 'text-rose-700' },
    amber:  { bg: 'from-amber-50/80 to-white',  ring: 'ring-amber-100',  iconBg: 'bg-amber-100 text-amber-700',   iconText: 'text-amber-700',  valText: 'text-amber-700' },
    slate:  { bg: 'from-slate-50/80 to-white',  ring: 'ring-slate-200',  iconBg: 'bg-slate-100 text-slate-700',   iconText: 'text-slate-700',  valText: 'text-slate-900' },
    emerald:{ bg: 'from-emerald-50/80 to-white',ring: 'ring-emerald-100',iconBg: 'bg-emerald-100 text-emerald-700',iconText: 'text-emerald-700',valText: 'text-emerald-700' },
  };
  const t = tones[tone];
  return (
    <div className={cn(
      'relative rounded-2xl bg-gradient-to-br ring-1 shadow-soft overflow-hidden px-4 py-3.5 lg:px-5 lg:py-4 group hover:shadow-md transition-shadow',
      t.bg, t.ring,
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className={cn('text-[10px] uppercase tracking-widest font-bold', t.iconText)}>
            {label}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5 flex-wrap">
            <div className={cn('text-2xl lg:text-3xl font-black tabular-nums leading-none', t.valText)}>
              {value}
            </div>
            {suffix && <span className="text-[10px] text-slate-400 font-bold uppercase">{suffix}</span>}
          </div>
          {sub && <div className="text-[10.5px] text-slate-500 font-medium mt-1.5">{sub}</div>}
        </div>
        <div className={cn('w-10 h-10 lg:w-11 lg:h-11 rounded-xl grid place-items-center shrink-0 ring-1 ring-white/40', t.iconBg)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Detail dialog
// ════════════════════════════════════════════════════════
function ChangeDetailDialog({ item, onClose }: { item: ChangeItem | null; onClose: () => void }) {
  if (!item) return null;
  const isDel = item.changeType === 'DELETED';
  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[820px] p-0 overflow-hidden gap-0 max-h-[92vh] flex flex-col">
        <div className={cn(
          'px-6 pt-5 pb-4 text-white shrink-0',
          isDel
            ? 'bg-gradient-to-br from-rose-600 via-red-600 to-pink-600'
            : 'bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-500',
        )}>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/20 grid place-items-center ring-1 ring-white/30">
              {isDel ? <Trash2 className="h-6 w-6" /> : <Edit3 className="h-6 w-6" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/80">
                {isDel ? "Bank tomonida o'chirilgan" : "Bank tomonida tahrirlangan"}
              </div>
              <div className="text-xl font-black tracking-tight leading-tight">
                {item.bankNameSnap || item.account?.bank?.name || '—'}
                <span className="text-white/70 mx-2">·</span>
                <span className="text-white/90 font-mono text-base">{item.accountNoSnap || item.account?.accountNo || ''}</span>
              </div>
            </div>
          </div>
          <div className="text-[11px] text-white/85 mt-3 font-mono break-all bg-black/15 rounded-lg px-3 py-1.5">
            <span className="opacity-70 mr-2">ID:</span>{item.externalId}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 bg-slate-50/40">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 text-[12px]">
            <InfoRow label="Aniqlangan" value={formatDateTime(item.detectedAt)} icon={Calendar} />
            <InfoRow label="Aniqlovchi" value={item.detectedBy || '—'} icon={Activity} />
            <InfoRow label="Tranzaksiya sanasi" value={item.txnDate ? new Date(item.txnDate).toLocaleDateString('ru-RU') : '—'} icon={Calendar} />
            <InfoRow label="Yo'nalish" value={item.direction === 'IN' ? '⬇ Kirim' : item.direction === 'OUT' ? '⬆ Chiqim' : '—'} />
            <InfoRow label="Summa" value={item.amount ? formatMoney(Math.abs(Number(item.amount)), 'UZS') : '—'} mono />
            <InfoRow label="Shartnoma" value={item.contractNumber || '—'} mono />
          </div>

          {item.note && (
            <div className="rounded-xl bg-white ring-1 ring-slate-200 px-3.5 py-2.5 text-[12px] text-slate-700 flex items-start gap-2">
              <FileText className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
              <span>{item.note}</span>
            </div>
          )}

          {!isDel && item.fieldsChanged?.length > 0 && (
            <div className="rounded-2xl ring-1 ring-amber-200 bg-white overflow-hidden shadow-soft">
              <div className="px-4 py-2.5 bg-gradient-to-r from-amber-100/80 to-amber-50 text-[11px] uppercase tracking-wider font-bold text-amber-800 flex items-center gap-2">
                <Edit3 className="h-3.5 w-3.5" /> O'zgargan maydonlar ({item.fieldsChanged.length})
              </div>
              <div className="divide-y divide-amber-100">
                {item.fieldsChanged.map((f) => {
                  const oldV = item.oldData?.[f]?.old ?? null;
                  const newV = item.oldData?.[f]?.new ?? null;
                  return (
                    <div key={f} className="px-4 py-3 text-[12px] flex items-center gap-3 hover:bg-amber-50/30 transition-colors">
                      <div className="font-mono font-bold text-amber-900 w-32 shrink-0 text-[11.5px]">{f}</div>
                      <div className="flex-1 flex items-center gap-2 min-w-0 flex-wrap">
                        <code className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 break-all font-mono text-[11.5px] font-semibold">
                          {String(oldV ?? '—')}
                        </code>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <code className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 break-all font-mono text-[11.5px] font-semibold">
                          {String(newV ?? '—')}
                        </code>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isDel && item.oldData && (
            <div className="rounded-2xl ring-1 ring-rose-200 bg-white overflow-hidden shadow-soft">
              <div className="px-4 py-2.5 bg-gradient-to-r from-rose-100/80 to-rose-50 text-[11px] uppercase tracking-wider font-bold text-rose-800 flex items-center gap-2">
                <Trash2 className="h-3.5 w-3.5" /> O'chirilgan yozuv snapshot
              </div>
              <pre className="px-4 py-3 text-[10.5px] font-mono text-slate-700 overflow-x-auto max-h-[320px] bg-slate-50/60">
                {JSON.stringify(item.oldData, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 px-5 py-3 border-t border-slate-100 bg-white">
          <Button variant="ghost" onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value, mono, icon: Icon }: { label: string; value: string; mono?: boolean; icon?: any }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2 shadow-soft/50">
      <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className={cn('text-[12.5px] font-bold text-slate-800 truncate mt-0.5', mono && 'font-mono')}>{value}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Manual check dialog
// ════════════════════════════════════════════════════════
function ManualCheckDialog({
  open, onClose, accounts, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  accounts: any[];
  onSuccess: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 10);
    return d.toISOString().slice(0, 10);
  })();

  const settingsQ = useQuery({
    queryKey: ['sync-settings-changes'],
    queryFn: () => api.get<{ ok: boolean; syncMinDate: string | null }>('/sync/settings'),
    enabled: open,
  });
  const minDate = settingsQ.data?.syncMinDate || null;

  const [accountId, setAccountId] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today);
  const [result, setResult] = useState<any>(null);

  useMemo(() => {
    if (open) {
      setResult(null);
      if (minDate && defaultFrom < minDate) setDateFrom(minDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, minDate]);

  const mut = useMutation({
    mutationFn: () => api.post<any>('/transactions/changes/check', {
      accountId: accountId === 'all' ? undefined : accountId,
      dateFrom,
      dateTo,
    }, { timeout: 600_000 }),
    onSuccess: (r: any) => {
      setResult(r);
      if (r?.ok) {
        toast.success(`Tekshirildi: ${r.deleted ?? 0} o'chirilgan, ${r.edited ?? 0} tahrirlangan`);
        onSuccess();
      } else {
        toast.error(r?.error || 'Xato');
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const fromTooEarly = !!minDate && dateFrom < minDate;
  const dayDiff = (() => {
    if (!dateFrom || !dateTo) return 0;
    return Math.floor((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
  })();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setResult(null); onClose(); } }}>
      <DialogContent className="sm:max-w-[620px] p-0 overflow-hidden gap-0">
        <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/20 grid place-items-center ring-1 ring-white/30">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/85">Qo'lda re-verify</div>
              <div className="text-xl font-black tracking-tight">Sana orqali tekshirish</div>
            </div>
          </div>
          <div className="text-[12px] text-white/85 mt-3 leading-relaxed">
            Tanlangan sana oralig'idagi mavjud tranzaksiyalarni bank API bilan solishtirib
            o'chirilgan / o'zgartirilganlarini aniqlaydi.
          </div>
        </div>

        <div className="p-5 space-y-4">
          {minDate && (
            <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[12px] inline-flex items-center gap-2 text-amber-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Sync chegarasi: <b className="tabular-nums">{minDate}</b> — bundan oldinga chiqib bo'lmaydi
            </div>
          )}

          {!result && (
            <>
              <div>
                <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Hisob</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Barcha sync yoqilgan hisoblar</SelectItem>
                    {accounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.accountNo}{a.ownerName ? ' · ' + a.ownerName : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Sanadan</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    min={minDate || undefined}
                    max={today}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-10"
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5 block">Sanagacha</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    min={minDate || undefined}
                    max={today}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="h-10"
                  />
                </div>
              </div>
              {fromTooEarly && (
                <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-[12px] text-rose-800 inline-flex items-center gap-2">
                  <X className="h-3.5 w-3.5" /> Sanadan {minDate} dan oldin bo'lmasligi kerak
                </div>
              )}
              {!fromTooEarly && dayDiff > 0 && (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-700 inline-flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-slate-500" />
                  <b className="tabular-nums">{dayDiff}</b> ta kun ·{' '}
                  <b>{accountId === 'all' ? 'barcha sync hisoblar' : '1 ta hisob'}</b>
                </div>
              )}
            </>
          )}

          {result?.ok && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3 flex items-start gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                <div className="text-[12.5px] text-emerald-900">
                  <div className="font-bold mb-1">Tekshirish yakunlandi</div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <ResultBadge label="Tekshirildi" value={result.checked} color="indigo" />
                    <ResultBadge label="O'chirilgan" value={result.deleted} color="rose" />
                    <ResultBadge label="Tahrirlangan" value={result.edited} color="amber" />
                  </div>
                </div>
              </div>
              {result.skippedAccounts?.length > 0 && (
                <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[11.5px] text-amber-800">
                  <b>O'tkazib yuborilgan ({result.skippedAccounts.length}):</b>{' '}
                  {result.skippedAccounts.slice(0, 5).join(', ')}
                  {result.skippedAccounts.length > 5 && '...'}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t border-slate-100 bg-slate-50/40">
          {result?.ok ? (
            <Button onClick={onClose}>Yopish</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Bekor</Button>
              <Button
                onClick={() => mut.mutate()}
                disabled={mut.isPending || fromTooEarly || dayDiff <= 0}
                className="bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-md"
              >
                {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                {mut.isPending ? 'Tekshirilmoqda...' : 'Tekshirishni boshlash'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultBadge({ label, value, color }: { label: string; value: number; color: 'indigo' | 'rose' | 'amber' }) {
  const styles: Record<string, string> = {
    indigo: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
    rose: 'bg-rose-100 text-rose-800 ring-rose-200',
    amber: 'bg-amber-100 text-amber-800 ring-amber-200',
  };
  return (
    <div className={cn('rounded-lg px-2.5 py-1.5 ring-1 text-center', styles[color])}>
      <div className="text-[9px] uppercase tracking-wider font-bold opacity-80">{label}</div>
      <div className="text-lg font-black tabular-nums leading-none mt-0.5">{value ?? 0}</div>
    </div>
  );
}
