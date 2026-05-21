'use client';

import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Plus, Edit3, Trash2, History, X, ChevronLeft, ChevronRight,
  Calendar, Loader2, Hash, ArrowDownLeft, ArrowUpRight, Filter as FilterIcon,
  Receipt, User2, Home, CreditCard, FileText, Tag as TagIcon, Activity,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatMoney } from '@/lib/utils';

type Category = 'MONTHLY' | 'FIRST' | 'GENERAL';

interface OplataKvItem {
  id: string;
  contractNo: string;
  date: string;
  paymentAmount: string | null;
  firstInstallment: string | null;
  monthlyAmount: string | null;
  purpose: string | null;
  txType: string | null;
  note: string | null;
  paymentCategory: Category | null;
  object: string | null;
  client: string | null;
  paymentMethod: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
}

const CATEGORY_LABEL: Record<Category, string> = {
  MONTHLY: 'ежемесячный',
  FIRST:   '1 взнос',
  GENERAL: 'Общий',
};

const CATEGORY_CLS: Record<Category, string> = {
  MONTHLY: 'bg-sky-50 text-sky-700 ring-sky-200',
  FIRST:   'bg-amber-50 text-amber-700 ring-amber-200',
  GENERAL: 'bg-violet-50 text-violet-700 ring-violet-200',
};

// dd.mm.yyyy formatda chiqarish
function fmtDateRu(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()} ${hh}:${mn}`;
}

function fmtNum(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  if (!isFinite(n) || n === 0) return n === 0 ? '0' : '—';
  return formatMoney(n);
}

function amountCls(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'text-slate-400';
  const n = typeof v === 'string' ? Number(v) : v;
  if (!isFinite(n) || n === 0) return 'text-slate-400';
  return n > 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold';
}

export default function OplataKvPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = !!user?.permissions?.includes(PERMS.OPLATAKV_MANAGE);

  // Filters
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  // Dialog state
  const [editRow, setEditRow] = useState<OplataKvItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<OplataKvItem | null>(null);
  const [historyRow, setHistoryRow] = useState<OplataKvItem | null>(null);

  // URL params for list query
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('perPage', String(perPage));
    if (q.trim()) p.set('q', q.trim());
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo)   p.set('dateTo', dateTo);
    if (categoryFilter !== 'all') p.set('paymentCategory', categoryFilter);
    return p.toString();
  }, [page, perPage, q, dateFrom, dateTo, categoryFilter]);

  const listQuery = useQuery({
    queryKey: ['oplata-kv', qs],
    queryFn: () => api.get<{
      ok: boolean;
      page: number; perPage: number; total: number; pageCount: number;
      items: OplataKvItem[];
      sums: { paymentAmount: number; firstInstallment: number; monthlyAmount: number };
    }>(`/oplata-kv?${qs}`),
    placeholderData: (prev) => prev,
  });

  // Filtr o'zgarganda sahifani 1-ga qaytarish
  useEffect(() => { setPage(1); }, [q, dateFrom, dateTo, categoryFilter, perPage]);

  const items = listQuery.data?.items || [];
  const total = listQuery.data?.total || 0;
  const pageCount = listQuery.data?.pageCount || 1;
  const sums = listQuery.data?.sums || { paymentAmount: 0, firstInstallment: 0, monthlyAmount: 0 };

  return (
    <div className="flex-1 p-3 sm:p-6 lg:p-8 w-full">
      <div className="w-full space-y-5">
        {/* ═══ KPI / Sums ═══ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <SumCard label="Сумма оплаты" value={sums.paymentAmount}    color="indigo" />
          <SumCard label="1 взнос"       value={sums.firstInstallment} color="amber" />
          <SumCard label="ежемесячный"   value={sums.monthlyAmount}    color="sky" />
          <CountCard label="Жами yozuv"  count={total} />
        </div>

        {/* ═══ Filter bar ═══ */}
        <Card className="border-0 shadow-soft overflow-visible">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  className="pl-9 h-10 rounded-xl bg-slate-50/60"
                  placeholder="Qidiruv — Дог №, Клиент, Объект, Назначение..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full grid place-items-center text-slate-400 hover:text-white hover:bg-rose-500"
                    onClick={() => setQ('')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-slate-400" />
                <Input
                  type="date"
                  className="h-10 rounded-xl w-[140px]"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
                <span className="text-slate-400">—</span>
                <Input
                  type="date"
                  className="h-10 rounded-xl w-[140px]"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>

              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-10 rounded-xl w-[170px]">
                  <FilterIcon className="h-4 w-4 mr-1 text-slate-400" />
                  <SelectValue placeholder="Оплата" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barchasi (Оплата)</SelectItem>
                  <SelectItem value="MONTHLY">ежемесячный</SelectItem>
                  <SelectItem value="FIRST">1 взнос</SelectItem>
                  <SelectItem value="GENERAL">Общий</SelectItem>
                </SelectContent>
              </Select>

              {canManage && (
                <Button
                  onClick={() => setCreateOpen(true)}
                  className="h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md"
                >
                  <Plus className="h-4 w-4 mr-1" /> Yangi qator
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ═══ Table ═══ */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10.5px] tracking-wider">
                <tr>
                  <Th>Дог №</Th>
                  <Th>Дата</Th>
                  <Th align="right">Сумма оплаты</Th>
                  <Th align="right">1 взнос</Th>
                  <Th align="right">ежемесячный</Th>
                  <Th>Оплата</Th>
                  <Th>Клиент</Th>
                  <Th>Объект</Th>
                  <Th>Способ оплаты</Th>
                  <Th>Назначение</Th>
                  <Th>Тип</Th>
                  <Th>Примечание</Th>
                  <Th>ID</Th>
                  <Th align="center">Amallar</Th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading && Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {Array.from({ length: 14 }).map((__, j) => (
                      <td key={j} className="px-3 py-2.5"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))}
                {!listQuery.isLoading && items.length === 0 && (
                  <tr><td colSpan={14} className="p-12 text-center text-slate-400">
                    Hech qanday qator topilmadi
                  </td></tr>
                )}
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-[12px] font-semibold text-slate-800">{it.contractNo}</td>
                    <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{fmtDateRu(it.date)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', amountCls(it.paymentAmount))}>{fmtNum(it.paymentAmount)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', amountCls(it.firstInstallment))}>{fmtNum(it.firstInstallment)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', amountCls(it.monthlyAmount))}>{fmtNum(it.monthlyAmount)}</td>
                    <td className="px-3 py-2.5">
                      {it.paymentCategory ? (
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-semibold ring-1', CATEGORY_CLS[it.paymentCategory])}>
                          {CATEGORY_LABEL[it.paymentCategory]}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[180px] truncate" title={it.client || ''}>{it.client || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5 max-w-[160px] truncate" title={it.object || ''}>{it.object || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5 max-w-[140px] truncate" title={it.paymentMethod || ''}>{it.paymentMethod || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5 max-w-[220px] truncate" title={it.purpose || ''}>{it.purpose || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5">{it.txType || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5 max-w-[180px] truncate" title={it.note || ''}>{it.note || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-slate-400" title={it.id}>{it.id.slice(0, 8)}…</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <IconBtn title="Tarix" onClick={() => setHistoryRow(it)} color="slate">
                          <History className="h-3.5 w-3.5" />
                        </IconBtn>
                        {canManage && (
                          <>
                            <IconBtn title="Tahrirlash" onClick={() => setEditRow(it)} color="indigo">
                              <Edit3 className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn title="O'chirish" onClick={() => setDeleteRow(it)} color="rose">
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconBtn>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-[12px] text-slate-500">
            <div>Jami: <b className="text-slate-700">{total.toLocaleString('ru-RU')}</b> qator</div>
            <div className="flex items-center gap-2">
              <Select value={String(perPage)} onValueChange={(v) => setPerPage(Number(v))}>
                <SelectTrigger className="h-8 w-[80px] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <button
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-slate-100 disabled:opacity-30"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              ><ChevronLeft className="h-4 w-4" /></button>
              <span className="tabular-nums">{page} / {pageCount}</span>
              <button
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-slate-100 disabled:opacity-30"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              ><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </Card>
      </div>

      {/* Create / Edit dialog */}
      <OplataKvFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['oplata-kv'] })}
      />
      <OplataKvFormDialog
        open={!!editRow}
        row={editRow}
        onClose={() => setEditRow(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['oplata-kv'] })}
      />

      {/* Delete confirm */}
      <DeleteConfirmDialog
        row={deleteRow}
        onClose={() => setDeleteRow(null)}
        onDeleted={() => qc.invalidateQueries({ queryKey: ['oplata-kv'] })}
      />

      {/* History viewer */}
      <HistoryDialog row={historyRow} onClose={() => setHistoryRow(null)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th className={cn(
      'px-3 py-2.5 font-semibold whitespace-nowrap',
      align === 'right' && 'text-right',
      align === 'center' && 'text-center',
      align === 'left' && 'text-left',
    )}>{children}</th>
  );
}

function IconBtn({ children, title, onClick, color }: {
  children: React.ReactNode; title: string; onClick: () => void;
  color: 'indigo' | 'rose' | 'slate';
}) {
  const colorCls = {
    indigo: 'hover:bg-indigo-50 hover:text-indigo-700 text-slate-500',
    rose:   'hover:bg-rose-50 hover:text-rose-700 text-slate-500',
    slate:  'hover:bg-slate-100 text-slate-500',
  }[color];
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn('w-7 h-7 grid place-items-center rounded-md transition-colors', colorCls)}
    >
      {children}
    </button>
  );
}

function SumCard({ label, value, color }: { label: string; value: number; color: 'indigo' | 'amber' | 'sky' }) {
  const cls = {
    indigo: 'from-indigo-500 to-violet-600 shadow-indigo-500/20',
    amber:  'from-amber-500 to-orange-600 shadow-amber-500/20',
    sky:    'from-sky-500 to-cyan-600 shadow-sky-500/20',
  }[color];
  const icon = {
    indigo: <Receipt className="h-5 w-5" />,
    amber:  <ArrowUpRight className="h-5 w-5" />,
    sky:    <Activity className="h-5 w-5" />,
  }[color];
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <CardContent className="p-4 flex items-center gap-3">
        <span className={cn('w-10 h-10 rounded-xl grid place-items-center text-white bg-gradient-to-br shadow-md shrink-0', cls)}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
          <div className={cn('text-xl font-bold tabular-nums mt-0.5', value < 0 ? 'text-rose-600' : 'text-slate-900')}>
            {formatMoney(value, '')}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CountCard({ label, count }: { label: string; count: number }) {
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <CardContent className="p-4 flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center text-white bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/20 shrink-0">
          <Hash className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
          <div className="text-xl font-bold tabular-nums mt-0.5 text-slate-900">
            {count.toLocaleString('ru-RU')} <span className="text-sm font-semibold text-slate-400">ta</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────
// Create / Edit dialog
// ─────────────────────────────────────────────────────────
function OplataKvFormDialog({
  open, row, onClose, onSaved,
}: {
  open: boolean; row?: OplataKvItem | null;
  onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!row;

  const [contractNo, setContractNo] = useState('');
  const [date, setDate] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [firstInstallment, setFirstInstallment] = useState('');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [txType, setTxType] = useState('');
  const [note, setNote] = useState('');
  const [paymentCategory, setPaymentCategory] = useState<string>('');
  const [object, setObject] = useState('');
  const [client, setClient] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');

  useEffect(() => {
    if (!open) return;
    if (row) {
      setContractNo(row.contractNo || '');
      setDate(row.date ? new Date(row.date).toISOString().slice(0, 10) : '');
      setPaymentAmount(row.paymentAmount ?? '');
      setFirstInstallment(row.firstInstallment ?? '');
      setMonthlyAmount(row.monthlyAmount ?? '');
      setPurpose(row.purpose ?? '');
      setTxType(row.txType ?? '');
      setNote(row.note ?? '');
      setPaymentCategory(row.paymentCategory ?? '');
      setObject(row.object ?? '');
      setClient(row.client ?? '');
      setPaymentMethod(row.paymentMethod ?? '');
    } else {
      setContractNo(''); setDate(new Date().toISOString().slice(0, 10));
      setPaymentAmount(''); setFirstInstallment(''); setMonthlyAmount('');
      setPurpose(''); setTxType(''); setNote('');
      setPaymentCategory(''); setObject(''); setClient(''); setPaymentMethod('');
    }
  }, [open, row]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const numOrUndef = (s: string) => {
        const v = s.trim();
        if (v === '') return undefined;
        const n = Number(v.replace(/\s+/g, '').replace(',', '.'));
        return isNaN(n) ? undefined : n;
      };
      const body: any = {
        contractNo: contractNo.trim(),
        date,
        paymentAmount:    numOrUndef(paymentAmount),
        firstInstallment: numOrUndef(firstInstallment),
        monthlyAmount:    numOrUndef(monthlyAmount),
        purpose: purpose.trim() || undefined,
        txType: txType.trim() || undefined,
        note: note.trim() || undefined,
        paymentCategory: paymentCategory || undefined,
        object: object.trim() || undefined,
        client: client.trim() || undefined,
        paymentMethod: paymentMethod.trim() || undefined,
      };
      if (isEdit && row) {
        return api.patch(`/oplata-kv/${row.id}`, body);
      }
      return api.post('/oplata-kv', body);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Tahrir saqlandi' : 'Qator qoshildi');
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || 'Xatolik yuz berdi'),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? <Edit3 className="h-5 w-5 text-indigo-600" /> : <Plus className="h-5 w-5 text-indigo-600" />}
            {isEdit ? 'Qatorni tahrirlash' : 'Yangi qator'}
          </DialogTitle>
          <DialogDescription>
            ОплатыКв jadvali · har qanday o'zgarish history'ga avto yoziladi
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <Field label="Дог № *">
            <Input value={contractNo} onChange={(e) => setContractNo(e.target.value)} placeholder="7331MSO26KK" />
          </Field>
          <Field label="Дата *">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>

          <Field label="Сумма оплаты">
            <Input value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="0" inputMode="decimal" />
          </Field>
          <Field label="1 взнос">
            <Input value={firstInstallment} onChange={(e) => setFirstInstallment(e.target.value)} placeholder="0" inputMode="decimal" />
          </Field>

          <Field label="ежемесячный">
            <Input value={monthlyAmount} onChange={(e) => setMonthlyAmount(e.target.value)} placeholder="0" inputMode="decimal" />
          </Field>
          <Field label="Оплата (turi)">
            <Select value={paymentCategory || 'none'} onValueChange={(v) => setPaymentCategory(v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="MONTHLY">ежемесячный</SelectItem>
                <SelectItem value="FIRST">1 взнос</SelectItem>
                <SelectItem value="GENERAL">Общий</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Клиент">
            <Input value={client} onChange={(e) => setClient(e.target.value)} />
          </Field>
          <Field label="Объект">
            <Input value={object} onChange={(e) => setObject(e.target.value)} />
          </Field>

          <Field label="Способ оплаты">
            <Input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="naqd / karta / transfer" />
          </Field>
          <Field label="Тип">
            <Input value={txType} onChange={(e) => setTxType(e.target.value)} />
          </Field>

          <Field label="Назначение платежа" full>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </Field>

          <Field label="Примечание" full>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!contractNo.trim() || !date || saveMut.isPending}
            className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white"
          >
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
            {isEdit ? 'Saqlash' : 'Qoshish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('space-y-1', full && 'col-span-2')}>
      <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">{label}</label>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Delete confirm
// ─────────────────────────────────────────────────────────
function DeleteConfirmDialog({ row, onClose, onDeleted }: {
  row: OplataKvItem | null; onClose: () => void; onDeleted: () => void;
}) {
  const delMut = useMutation({
    mutationFn: () => api.delete(`/oplata-kv/${row!.id}`),
    onSuccess: () => { toast.success('Qator o\'chirildi'); onDeleted(); onClose(); },
    onError: (e: any) => toast.error(e?.message || 'O\'chirib bo\'lmadi'),
  });

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-700">
            <Trash2 className="h-5 w-5" /> O'chirishni tasdiqlash
          </DialogTitle>
          <DialogDescription>
            Quyidagi qator butunlay o'chiriladi. Tarix yozuvi qoladi.
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 p-3 text-[13px] space-y-1">
            <div><b>Дог №:</b> <span className="font-mono">{row.contractNo}</span></div>
            <div><b>Дата:</b> {fmtDateRu(row.date)}</div>
            <div><b>Клиент:</b> {row.client || '—'}</div>
            <div><b>Объект:</b> {row.object || '—'}</div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
          <Button
            onClick={() => delMut.mutate()}
            disabled={delMut.isPending}
            className="bg-rose-600 hover:bg-rose-700 text-white"
          >
            {delMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
            O'chirish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────
// History viewer
// ─────────────────────────────────────────────────────────
function HistoryDialog({ row, onClose }: { row: OplataKvItem | null; onClose: () => void }) {
  const historyQuery = useQuery({
    queryKey: ['oplata-kv-history', row?.id],
    queryFn: () => api.get<{ ok: boolean; items: any[] }>(`/oplata-kv/${row!.id}/history?limit=200`),
    enabled: !!row,
  });

  const items = historyQuery.data?.items || [];

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-indigo-600" /> Qator tarixi
          </DialogTitle>
          {row && (
            <DialogDescription className="font-mono text-[12px]">
              Дог № {row.contractNo} · {fmtDateRu(row.date)}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-2 py-2">
          {historyQuery.isLoading && Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
          {!historyQuery.isLoading && items.length === 0 && (
            <div className="text-center text-slate-400 py-8">Tarix bo'sh</div>
          )}
          {items.map((h) => (
            <div key={h.id} className="rounded-lg ring-1 ring-slate-200 p-3 bg-white">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <ActionBadge action={h.action} />
                  <span className="text-[12px] font-semibold text-slate-700">{h.actorName || 'Tizim'}</span>
                </div>
                <span className="text-[11px] text-slate-400 tabular-nums">{fmtDateTime(h.createdAt)}</span>
              </div>
              {Array.isArray(h.fieldsChanged) && h.fieldsChanged.length > 0 && h.fieldsChanged[0] !== '*' && (
                <div className="text-[11.5px] text-slate-500 mt-1">
                  O'zgargan maydonlar: <span className="font-mono text-slate-700">{h.fieldsChanged.join(', ')}</span>
                </div>
              )}
              {h.changes && typeof h.changes === 'object' && (
                <details className="mt-1.5">
                  <summary className="text-[11px] text-indigo-600 hover:text-indigo-800 cursor-pointer">Tafsilot</summary>
                  <pre className="mt-1.5 text-[10.5px] bg-slate-50 rounded p-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(h.changes, null, 2)}</pre>
                </details>
              )}
              {h.note && <div className="text-[11.5px] text-slate-500 mt-1 italic">{h.note}</div>}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionBadge({ action }: { action: string }) {
  const cls = {
    created:  'bg-emerald-50 text-emerald-700 ring-emerald-200',
    edited:   'bg-amber-50 text-amber-700 ring-amber-200',
    deleted:  'bg-rose-50 text-rose-700 ring-rose-200',
    imported: 'bg-violet-50 text-violet-700 ring-violet-200',
  }[action] || 'bg-slate-50 text-slate-700 ring-slate-200';
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ring-1', cls)}>
      {action}
    </span>
  );
}
