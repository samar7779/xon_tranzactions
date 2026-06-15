'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertOctagon, Trash2, Edit3, Search, Calendar, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, X, CheckCircle2, ArrowRight, FileText, Wallet,
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

export default function ChangesPage() {
  const qc = useQueryClient();
  const canCheck = useHasPermission(PERMS.CHANGED_TXN_CHECK);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [accountId, setAccountId] = useState<string>('all');
  const [changeType, setChangeType] = useState<string>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 25;
  const [checkOpen, setCheckOpen] = useState(false);
  const [detail, setDetail] = useState<ChangeItem | null>(null);

  const accountsQ = useQuery({
    queryKey: ['bank-accounts-for-changes'],
    queryFn: () => api.get<{ items: any[] }>('/bank-accounts'),
  });

  const listQ = useQuery({
    queryKey: ['transactions-changes', dateFrom, dateTo, accountId, changeType, q, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (accountId && accountId !== 'all') params.set('accountId', accountId);
      if (changeType && changeType !== 'all') params.set('changeType', changeType);
      if (q.trim()) params.set('q', q.trim());
      params.set('page', String(page));
      params.set('perPage', String(perPage));
      return api.get<{ ok: boolean; total: number; items: ChangeItem[] }>(`/transactions/changes/list?${params}`);
    },
  });

  const items = listQ.data?.items || [];
  const total = listQ.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const deletedCount = items.filter((i) => i.changeType === 'DELETED').length;
  const editedCount = items.filter((i) => i.changeType === 'EDITED').length;

  return (
    <>
      <Topbar title="O'zgargan to'lovlar" subtitle="Bank tomonida o'chirilgan yoki o'zgartirilgan tranzaksiyalar tarixi" />
      <TransactionsTabs />

      <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-0 shadow-soft">
            <CardContent className="p-5">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Jami yozuvlar</div>
              <div className="text-3xl font-black text-slate-800 mt-1 tabular-nums">{total}</div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-soft">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-rose-600 font-bold inline-flex items-center gap-1">
                    <Trash2 className="h-3 w-3" /> O'chirilgan (sahifada)
                  </div>
                  <div className="text-3xl font-black text-rose-700 mt-1 tabular-nums">{deletedCount}</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-soft">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-amber-600 font-bold inline-flex items-center gap-1">
                    <Edit3 className="h-3 w-3" /> Tahrirlangan (sahifada)
                  </div>
                  <div className="text-3xl font-black text-amber-700 mt-1 tabular-nums">{editedCount}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="border-0 shadow-soft">
          <CardContent className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <div className="md:col-span-2 relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <Input
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setPage(1); }}
                  placeholder="Composite ID, shartnoma, hisob raqami..."
                  className="h-10 pl-9 pr-3"
                />
              </div>
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
              <Select value={changeType} onValueChange={(v) => { setChangeType(v); setPage(1); }}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Turi" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hammasi</SelectItem>
                  <SelectItem value="DELETED">O'chirilgan</SelectItem>
                  <SelectItem value="EDITED">Tahrirlangan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Sanadan (aniqlangan)</Label>
                <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-10" />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Sanagacha</Label>
                <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-10" />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  variant="outline"
                  className="h-10 gap-2"
                  onClick={() => {
                    setQ(''); setDateFrom(''); setDateTo('');
                    setAccountId('all'); setChangeType('all'); setPage(1);
                  }}
                >
                  <X className="h-4 w-4" /> Tozalash
                </Button>
                {canCheck && (
                  <Button
                    onClick={() => setCheckOpen(true)}
                    className="h-10 gap-2 bg-gradient-to-br from-indigo-600 to-violet-600 text-white"
                    title="Sana orqali qo'lda tekshirish"
                  >
                    <RefreshCw className="h-4 w-4" /> Tekshirish
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* List */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600 font-semibold">
                <tr>
                  <th className="px-4 py-3 text-left w-28">Turi</th>
                  <th className="px-4 py-3 text-left">Aniqlangan</th>
                  <th className="px-4 py-3 text-left">Bank · Hisob</th>
                  <th className="px-4 py-3 text-left">Composite ID</th>
                  <th className="px-4 py-3 text-left">Shartnoma</th>
                  <th className="px-4 py-3 text-right">Summa</th>
                  <th className="px-4 py-3 text-left">O'zgarishlar</th>
                </tr>
              </thead>
              <tbody>
                {listQ.isLoading && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Yuklanmoqda...
                  </td></tr>
                )}
                {!listQ.isLoading && items.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center">
                    <AlertOctagon className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                    <div className="text-[14px] font-semibold text-slate-700">Yozuvlar yo'q</div>
                    <div className="text-[12px] text-slate-500 mt-1">
                      Sync har safar ishlaganda avtomatik tekshiriladi. Yoki "Tekshirish" tugmasini bosing.
                    </div>
                  </td></tr>
                )}
                {items.map((it) => {
                  const isDel = it.changeType === 'DELETED';
                  return (
                    <tr
                      key={it.id}
                      onClick={() => setDetail(it)}
                      className={cn(
                        'border-t border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer',
                        isDel && 'bg-rose-50/30',
                      )}
                    >
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ring-1',
                          isDel
                            ? 'bg-rose-50 text-rose-700 ring-rose-200'
                            : 'bg-amber-50 text-amber-700 ring-amber-200',
                        )}>
                          {isDel ? <Trash2 className="h-3 w-3" /> : <Edit3 className="h-3 w-3" />}
                          {isDel ? "O'CHIRILGAN" : 'TAHRIR'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums whitespace-nowrap">{formatDateTime(it.detectedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800 text-[12px]">{it.bankNameSnap || it.account?.bank?.name || '—'}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{it.accountNoSnap || it.account?.accountNo || '—'}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[10.5px] text-slate-600 max-w-[260px] truncate" title={it.externalId}>
                        {it.externalId}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11.5px] text-indigo-700 font-semibold">{it.contractNumber || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        {it.amount ? (
                          <span className={cn(
                            'tabular-nums font-semibold',
                            it.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700',
                          )}>
                            {it.direction === 'IN' ? '+' : '−'}{formatMoney(Math.abs(Number(it.amount)), 'UZS')}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {it.fieldsChanged && it.fieldsChanged.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {it.fieldsChanged.slice(0, 4).map((f) => (
                              <span key={f} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium">{f}</span>
                            ))}
                            {it.fieldsChanged.length > 4 && (
                              <span className="text-[10px] text-slate-500">+{it.fieldsChanged.length - 4}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400">{isDel ? 'butun yozuv' : '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > perPage && (
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-[12px] text-slate-600">
              <div>Jami: <b className="tabular-nums">{total}</b> · sahifa {page}/{totalPages}</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Detail modal */}
      <ChangeDetailDialog item={detail} onClose={() => setDetail(null)} />

      {/* Check modal */}
      <ManualCheckDialog
        open={checkOpen}
        onClose={() => setCheckOpen(false)}
        accounts={accountsQ.data?.items || []}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['transactions-changes'] })}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────
// Detail dialog — eski vs yangi qiymatlarni ko'rsatadi
// ────────────────────────────────────────────────────────
function ChangeDetailDialog({ item, onClose }: { item: ChangeItem | null; onClose: () => void }) {
  if (!item) return null;
  const isDel = item.changeType === 'DELETED';
  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[760px] p-0 overflow-hidden gap-0 max-h-[90vh] flex flex-col">
        <div className={cn(
          'px-6 pt-5 pb-4 text-white shrink-0',
          isDel
            ? 'bg-gradient-to-br from-rose-600 via-red-600 to-pink-600'
            : 'bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-500',
        )}>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-white/15 grid place-items-center">
              {isDel ? <Trash2 className="h-5 w-5" /> : <Edit3 className="h-5 w-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/80">
                {isDel ? "Bank tomonida o'chirilgan" : "Bank tomonida tahrirlangan"}
              </div>
              <div className="text-lg font-black tracking-tight">
                {item.bankNameSnap || item.account?.bank?.name || '—'} · {item.accountNoSnap || item.account?.accountNo || ''}
              </div>
            </div>
          </div>
          <div className="text-[11.5px] text-white/85 mt-2 font-mono break-all">{item.externalId}</div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <InfoRow label="Aniqlangan" value={formatDateTime(item.detectedAt)} />
            <InfoRow label="Aniqlovchi" value={item.detectedBy || '—'} />
            <InfoRow label="Tranzaksiya sanasi" value={item.txnDate ? new Date(item.txnDate).toLocaleDateString('ru-RU') : '—'} />
            <InfoRow label="Yo'nalish" value={item.direction === 'IN' ? 'Kirim' : item.direction === 'OUT' ? 'Chiqim' : '—'} />
            <InfoRow label="Summa" value={item.amount ? formatMoney(Math.abs(Number(item.amount)), 'UZS') : '—'} />
            <InfoRow label="Shartnoma" value={item.contractNumber || '—'} mono />
          </div>

          {item.note && (
            <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-[12px] text-slate-700">
              {item.note}
            </div>
          )}

          {!isDel && item.fieldsChanged?.length > 0 && (
            <div className="rounded-xl ring-1 ring-amber-200 bg-amber-50/40 overflow-hidden">
              <div className="px-4 py-2 bg-amber-100/60 text-[11px] uppercase tracking-wider font-bold text-amber-800">
                O'zgargan maydonlar
              </div>
              <div className="divide-y divide-amber-200/50">
                {item.fieldsChanged.map((f) => {
                  const oldV = item.oldData?.[f]?.old ?? null;
                  const newV = item.oldData?.[f]?.new ?? null;
                  return (
                    <div key={f} className="px-4 py-2.5 text-[12px] flex items-center gap-3">
                      <div className="font-mono font-bold text-amber-900 w-32 shrink-0">{f}</div>
                      <div className="flex-1 flex items-center gap-2 min-w-0">
                        <code className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 break-all">{String(oldV ?? '—')}</code>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <code className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 break-all">{String(newV ?? '—')}</code>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isDel && item.oldData && (
            <div className="rounded-xl ring-1 ring-rose-200 bg-rose-50/40 overflow-hidden">
              <div className="px-4 py-2 bg-rose-100/60 text-[11px] uppercase tracking-wider font-bold text-rose-800">
                O'chirilgan yozuv (snapshot)
              </div>
              <pre className="px-4 py-3 text-[10.5px] font-mono text-slate-700 overflow-x-auto max-h-[300px]">
                {JSON.stringify(item.oldData, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 px-5 py-3 border-t border-slate-100 bg-slate-50/40">
          <Button variant="ghost" onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2">
      <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-500">{label}</div>
      <div className={cn('text-[12.5px] font-semibold text-slate-800 truncate', mono && 'font-mono')}>{value}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Manual check dialog — sana orqali qo'lda tekshirish
// ────────────────────────────────────────────────────────
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

  // Sync chegarasini olamiz
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
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-indigo-600" />
            Qo'lda tekshirish (re-verify)
          </DialogTitle>
          <DialogDescription>
            Tanlangan sana oralig'idagi mavjud tranzaksiyalarni bank API bilan solishtirib o'chirilgan/o'zgartirilganlarini aniqlaydi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {minDate && (
            <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[12px] inline-flex items-center gap-2 text-amber-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Sync chegarasi: <b className="tabular-nums">{minDate}</b> — bundan oldinga chiqib bo'lmaydi
            </div>
          )}

          {!result && (
            <>
              <div>
                <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">Hisob</Label>
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
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">Sanadan</Label>
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
                  <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1 block">Sanagacha</Label>
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
                <div className="text-[11px] text-slate-600 inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  <b>{dayDiff}</b> ta kun · {accountId === 'all' ? 'barcha sync hisoblar' : '1 ta hisob'}
                </div>
              )}
            </>
          )}

          {result?.ok && (
            <div className="space-y-3">
              <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3 flex items-start gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                <div className="text-[12.5px] text-emerald-800">
                  <div className="font-bold mb-0.5">Tekshirish yakunlandi</div>
                  <div>
                    {result.checked} hisob tekshirildi · <b>{result.deleted}</b> o'chirilgan · <b>{result.edited}</b> tahrirlangan
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

        <DialogFooter>
          {result?.ok ? (
            <Button onClick={onClose}>Yopish</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Bekor</Button>
              <Button
                onClick={() => mut.mutate()}
                disabled={mut.isPending || fromTooEarly || dayDiff <= 0}
                className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white"
              >
                {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                {mut.isPending ? 'Tekshirilmoqda...' : 'Tekshirishni boshlash'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
