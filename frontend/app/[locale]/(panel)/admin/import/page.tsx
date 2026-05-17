'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Upload, Loader2, AlertTriangle, FileSpreadsheet, X,
  ChevronDown, ChevronRight, Info, Wallet, Briefcase, Users,
  FileSignature, Lock, Download, Trash2, History,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { api, apiDownload } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';

interface ImportResult {
  total: number;
  added: number;
  skipped: number;
  errors: number;
  errorRows: Array<{ row: number; reason: string }>;
}

type ImportKind = 'transactions' | 'counterparties' | 'customers' | 'contracts';

interface KindDef {
  key: ImportKind;
  label: string;
  icon: any;
  description: string;
  available: boolean;
}

const KINDS: KindDef[] = [
  { key: 'transactions',   label: 'Tranzaksiyalar',  icon: Wallet,         description: "Bank vipiskasi formatiga moslangan Excel", available: true },
  { key: 'counterparties', label: 'Kontragentlar',   icon: Briefcase,      description: 'INN va Nom bo\'yicha (dublikat skip)',     available: true },
  { key: 'customers',      label: 'Mijozlar',        icon: Users,          description: 'CRM mijozlarini import (kelajakda)',       available: false },
  { key: 'contracts',      label: 'Shartnomalar',    icon: FileSignature,  description: 'Shartnomalar tarixi (kelajakda)',          available: false },
];

export default function ImportPage() {
  const [activeKind, setActiveKind] = useState<ImportKind>('transactions');

  return (
    <div className="flex-1 p-6 lg:p-8 w-full space-y-5">
      {/* ─── Hub header ─── */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-600 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/15 grid place-items-center">
              <Upload className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-white/80">Admin / Import</div>
              <div className="text-lg font-bold">Ma'lumotlarni qo'lda import qilish</div>
              <div className="text-[11px] text-white/75 mt-0.5">
                Qaysi turdagi ma'lumotni import qilishni tanlang
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ─── Kind selector (cards) ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {KINDS.map((k) => {
          const Icon = k.icon;
          const active = activeKind === k.key;
          return (
            <button
              key={k.key}
              onClick={() => k.available && setActiveKind(k.key)}
              disabled={!k.available}
              className={cn(
                'group relative rounded-2xl p-4 text-left transition-all',
                active
                  ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/25'
                  : k.available
                    ? 'bg-white ring-1 ring-slate-200 hover:ring-indigo-300 hover:shadow-md cursor-pointer'
                    : 'bg-slate-50 ring-1 ring-slate-100 cursor-not-allowed opacity-60',
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={cn(
                  'w-9 h-9 rounded-xl grid place-items-center',
                  active ? 'bg-white/20' : 'bg-indigo-50',
                )}>
                  <Icon className={cn('h-4 w-4', active ? 'text-white' : 'text-indigo-600')} />
                </div>
                {!k.available && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700 ring-1 ring-amber-200">
                    <Lock className="h-2.5 w-2.5" />
                    Tez orada
                  </span>
                )}
              </div>
              <div className={cn('text-[13px] font-bold', active ? 'text-white' : 'text-slate-800')}>
                {k.label}
              </div>
              <div className={cn('text-[10.5px] mt-0.5', active ? 'text-white/85' : 'text-slate-500')}>
                {k.description}
              </div>
            </button>
          );
        })}
      </div>

      {/* ─── Active panel ─── */}
      {activeKind === 'transactions' && <TransactionsImportPanel />}
      {activeKind === 'counterparties' && <CounterpartiesImportPanel />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TRANZAKSIYALAR import paneli (ilgari butun sahifa edi)
// ═══════════════════════════════════════════════════════════════════════
const TXN_COLUMNS: Array<{ letter: string; header: string; description: string; required?: boolean }> = [
  { letter: 'A', header: 'Р/С',                description: 'Hisob raqami', required: true },
  { letter: 'B', header: 'Банк Названия',      description: "Bank nomi (bo'sh bo'lsa, A bo'yicha avto)" },
  { letter: 'C', header: 'ДАТА',               description: 'Sana (dd.MM.yyyy)', required: true },
  { letter: 'D', header: 'Наименование счета', description: 'Hisob nomi' },
  { letter: 'E', header: 'Контрагент',         description: 'Kontragent' },
  { letter: 'F', header: 'Категория',          description: 'Kategoriya (yangi nomlar ham qabul qilinadi)' },
  { letter: 'G', header: '№Заявка/Дог',        description: 'Shartnoma raqami' },
  { letter: 'H', header: 'ОборотДебет',        description: 'Chiqim (OUT)' },
  { letter: 'I', header: 'ОборотКредит',       description: 'Kirim (IN)' },
  { letter: 'J', header: 'Назначение платежа', description: "To'lov maqsadi" },
  { letter: 'K', header: 'ID',                 description: 'Unikal ID (dublikat skip)', required: true },
];

function TransactionsImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);

  const mut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.postForm<ImportResult>('/import/transactions', fd, { timeout: 300_000 });
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.errors === 0) {
        toast.success(`${r.added} ta tranzaksiya qo'shildi`);
      } else {
        toast(`Tugadi: ${r.added} qo'shildi, ${r.errors} xato`, {
          icon: '⚠️',
          style: { background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' },
        });
      }
    },
    onError: (e: any) => {
      toast.error(e?.message || 'Import xato');
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    mut.mutate(file);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="space-y-5">
      {/* Upload card */}
      <Card className="border-0 shadow-soft">
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center gap-2 pb-1">
            <Wallet className="h-4 w-4 text-indigo-600" />
            <div className="text-sm font-semibold text-slate-800">Tranzaksiyalarni Excel'dan import qilish</div>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={mut.isPending}
              className="h-12 px-5 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold"
            >
              {mut.isPending ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Yuklanmoqda...</>
              ) : (
                <><Upload className="h-5 w-5" /> Excel yuklash (.xlsx)</>
              )}
            </Button>
            {fileName && !mut.isPending && (
              <div className="text-[12px] text-slate-600 flex items-center gap-1.5">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> {fileName}
              </div>
            )}
          </div>

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Jami qator"      value={result.total}   color="slate" />
                <Stat label="Qo'shildi"       value={result.added}   color="emerald" />
                <Stat label="Dublikat skip"   value={result.skipped} color="amber" />
                <Stat label="Xato"            value={result.errors}  color="rose" />
              </div>
              {result.errors > 0 && (
                <div className="rounded-xl ring-1 ring-rose-200 bg-rose-50/40 overflow-hidden">
                  <button
                    onClick={() => setErrorsOpen((o) => !o)}
                    className="w-full px-4 py-2.5 flex items-center justify-between text-left text-[12px] font-semibold text-rose-900 hover:bg-rose-50"
                  >
                    <span className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      {result.errors} ta xato qatorlar
                    </span>
                    {errorsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  {errorsOpen && (
                    <div className="max-h-80 overflow-y-auto divide-y divide-rose-100">
                      {result.errorRows.map((e, i) => (
                        <div key={i} className="px-4 py-2 text-[11px] flex items-baseline gap-3">
                          <span className="font-mono text-rose-700 shrink-0">Qator {e.row}:</span>
                          <span className="text-slate-700">{e.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Format guide */}
      <Card className="border-0 shadow-soft">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <Info className="h-4 w-4 text-indigo-600" />
            <div className="text-sm font-semibold text-slate-800">Excel format</div>
          </div>
          <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500 w-10">#</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Sarlavha</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Izoh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {TXN_COLUMNS.map((c) => (
                  <tr key={c.letter} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-mono font-bold text-indigo-700">{c.letter}</td>
                    <td className="px-3 py-2 font-mono text-slate-800">
                      {c.header}
                      {c.required && <span className="text-rose-600 ml-1" title="Majburiy">*</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{c.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-[10.5px] text-slate-500 space-y-1">
            <div>• <b>Summa formati:</b> 596616522,10 (vergul decimal) yoki oddiy raqam</div>
            <div>• <b>Yo'nalish:</b> ОборотДебет &gt; 0 → CHIQIM, ОборотКредит &gt; 0 → KIRIM</div>
            <div>• <b>Dublikat skip:</b> ID ustun bo'yicha — agar shu ID DB'da bor bo'lsa, skip</div>
            <div>• <b>Kategoriya:</b> bizning ro'yxatda yo'q nomlar matn sifatida saqlanadi va UI'da ko'rsatiladi</div>
            <div>• <b>Birinchi qator (header)</b> avtomatik o'tkazib yuboriladi</div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Import tarixi ─── */}
      <BatchHistorySection refreshKey={mut.isSuccess ? Date.now() : 0} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// IMPORT TARIXI — yuklab olish va o'chirish
// ═══════════════════════════════════════════════════════════════════════
interface ImportBatch {
  id: string;
  kind: string;
  fileName: string | null;
  fileSize: number | null;
  importedBy: string | null;
  importedAt: string;
  rowsTotal: number;
  rowsAdded: number;
  rowsSkipped: number;
  rowsErrors: number;
  notes: string | null;
}

function BatchHistorySection({ refreshKey }: { refreshKey: number }) {
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState<ImportBatch | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false); // hidden by default — ustga bosilganda ochiladi

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['import-batches', refreshKey],
    queryFn: () => api.get<{ ok: boolean; items: ImportBatch[] }>('/import/batches'),
    enabled: expanded, // faqat bo'lim ochilganda fetch qiladi
  });

  const delMut = useMutation({
    // 60k+ qator ham normal o'chsin uchun 5 minut timeout
    mutationFn: (id: string) => api.delete<{ ok: boolean; deleted: number }>(`/import/batches/${id}`, { timeout: 300_000 }),
    onSuccess: (r) => {
      toast.success(`${r.deleted} ta tranzaksiya o'chirildi`);
      setConfirmDel(null);
      qc.invalidateQueries({ queryKey: ['import-batches'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['tx-stats'] });
      refetch();
    },
    onError: (e: any) => toast.error(e?.message || "O'chirish xato"),
  });

  async function handleDownload(b: ImportBatch) {
    if (downloadingId) return;
    setDownloadingId(b.id);
    const t = toast.loading('Excel tayyorlanmoqda...');
    try {
      await apiDownload(`/import/batches/${b.id}/export`, b.fileName ? `${b.fileName.replace(/\.xlsx?$/, '')}_backup.xlsx` : `import-${b.id}.xlsx`);
      toast.success('Excel yuklab olindi', { id: t });
    } catch (e: any) {
      toast.error(e?.message || 'Yuklab olish xato', { id: t });
    } finally {
      setDownloadingId(null);
    }
  }

  function formatSize(b: number | null): string {
    if (!b) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  const batches = data?.items || [];

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      {/* Collapsible header — ustga bosilsa ochiladi/yopiladi */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-6 py-4 flex items-center gap-2 hover:bg-slate-50/60 transition-colors text-left"
      >
        <History className="h-4 w-4 text-indigo-600 shrink-0" />
        <div className="text-sm font-semibold text-slate-800">Import tarixi</div>
        {expanded && (
          <span className="text-[11px] text-slate-400">{batches.length} ta yozuv</span>
        )}
        <span className="ml-auto text-slate-400">
          {expanded
            ? <ChevronDown className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
      <CardContent className="px-6 pb-6 pt-0">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-slate-400 justify-center text-[12px]">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...
          </div>
        ) : batches.length === 0 ? (
          <div className="text-center text-[12px] text-slate-400 py-8 rounded-xl ring-1 ring-dashed ring-slate-200">
            Hozircha import qilinmagan
          </div>
        ) : (
          <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden divide-y divide-slate-100">
            {batches.map((b) => (
              <div key={b.id} className="px-4 py-3 hover:bg-slate-50/60 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-fuchsia-50 grid place-items-center shrink-0 mt-0.5">
                    <FileSpreadsheet className="h-4 w-4 text-fuchsia-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-semibold text-slate-800 truncate" title={b.fileName || ''}>
                        {b.fileName || '(nomsiz)'}
                      </span>
                      {b.notes && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">LEGACY</span>
                      )}
                    </div>
                    <div className="text-[10.5px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{formatDateTime(b.importedAt)}</span>
                      <span className="text-slate-300">·</span>
                      <span>{b.importedBy || '—'}</span>
                      <span className="text-slate-300">·</span>
                      <span>{formatSize(b.fileSize)}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10.5px]">
                      <span className="text-slate-500">Jami: <b className="text-slate-700">{b.rowsTotal}</b></span>
                      <span className="text-emerald-600">+{b.rowsAdded}</span>
                      {b.rowsSkipped > 0 && <span className="text-amber-600">~{b.rowsSkipped}</span>}
                      {b.rowsErrors > 0 && <span className="text-rose-600">×{b.rowsErrors}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleDownload(b)}
                      disabled={downloadingId === b.id}
                      title="Excel yuklab olish"
                      className={cn(
                        'inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
                        downloadingId === b.id
                          ? 'bg-emerald-100 text-emerald-700 cursor-wait'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                      )}
                    >
                      {downloadingId === b.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Download className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => setConfirmDel(b)}
                      disabled={delMut.isPending}
                      title="Bu importning barcha tranzaksiyalarini o'chirish"
                      className={cn(
                        'inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
                        delMut.isPending
                          ? 'bg-rose-100 text-rose-700 cursor-wait'
                          : 'bg-rose-50 text-rose-700 hover:bg-rose-100',
                      )}
                    >
                      {delMut.isPending && confirmDel?.id === b.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      )}

      {/* Delete confirmation — Dialog Card tashqarisida bo'lishi mumkin (portal'ga ochiladi) */}
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && !delMut.isPending && setConfirmDel(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700">
              <AlertTriangle className="h-5 w-5" />
              Importni o'chirishni tasdiqlash
            </DialogTitle>
            <DialogDescription className="text-[12px] pt-2">
              <b>{confirmDel?.fileName || '(nomsiz)'}</b> import bilan birga
              {' '}<b className="text-rose-700">{confirmDel?.rowsAdded || 0} ta tranzaksiya</b> o'chiriladi.
              Bu amal qaytarib bo'lmaydi.
              {confirmDel?.notes && (
                <div className="mt-2 px-2 py-1.5 rounded-md bg-amber-50 text-amber-800 text-[11px]">
                  <b>Eslatma:</b> {confirmDel.notes}
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDel(null)} disabled={delMut.isPending}>
              Bekor
            </Button>
            <Button
              onClick={() => confirmDel && delMut.mutate(confirmDel.id)}
              disabled={delMut.isPending}
              className="bg-rose-600 hover:bg-rose-700 text-white gap-2"
            >
              {delMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Ha, o'chirish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: 'slate' | 'emerald' | 'amber' | 'rose' | 'indigo' }) {
  const colorMap = {
    slate:   'bg-slate-50 ring-slate-100 text-slate-700',
    emerald: 'bg-emerald-50 ring-emerald-100 text-emerald-700',
    amber:   'bg-amber-50 ring-amber-100 text-amber-700',
    rose:    'bg-rose-50 ring-rose-100 text-rose-700',
    indigo:  'bg-indigo-50 ring-indigo-100 text-indigo-700',
  };
  return (
    <div className={cn('rounded-xl ring-1 px-4 py-3', colorMap[color])}>
      <div className="text-[10px] uppercase tracking-wider font-bold opacity-75">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// KONTRAGENTLAR import paneli — /counterparties/import
// Excel: A=INN, B=Nom
// ═══════════════════════════════════════════════════════════════════════
interface CounterpartyImportResult {
  total: number;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: Array<{ inn: string; name?: string; status: 'added' | 'updated' | 'skipped' | 'failed'; reason?: string }>;
}

const CP_COLUMNS: Array<{ letter: string; header: string; description: string; required?: boolean }> = [
  { letter: 'A', header: 'INN', description: 'Kontragent INN (9 yoki 14 raqam)', required: true },
  { letter: 'B', header: 'Nom', description: 'Tashkilot nomi (DIDOX cron orqali avto-yangilanadi)' },
];

function CounterpartiesImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<CounterpartyImportResult | null>(null);
  const [failedOpen, setFailedOpen] = useState(false);

  const mut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.postForm<CounterpartyImportResult>('/counterparties/import', fd, { timeout: 300_000 });
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.failed === 0) {
        toast.success(`${r.added} qo'shildi, ${r.updated} yangilandi`);
      } else {
        toast(`Tugadi: ${r.added + r.updated} ishlandi, ${r.failed} xato`, {
          icon: '⚠️',
          style: { background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' },
        });
      }
    },
    onError: (e: any) => {
      toast.error(e?.message || 'Import xato');
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    mut.mutate(file);
    if (fileRef.current) fileRef.current.value = '';
  }

  const failedRows = result?.rows?.filter((r) => r.status === 'failed') || [];

  return (
    <div className="space-y-5">
      <Card className="border-0 shadow-soft">
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center gap-2 pb-1">
            <Briefcase className="h-4 w-4 text-indigo-600" />
            <div className="text-sm font-semibold text-slate-800">Kontragentlarni Excel'dan import qilish</div>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={mut.isPending}
              className="h-12 px-5 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold"
            >
              {mut.isPending ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Yuklanmoqda...</>
              ) : (
                <><Upload className="h-5 w-5" /> Excel yuklash (.xlsx)</>
              )}
            </Button>
            {fileName && !mut.isPending && (
              <div className="text-[12px] text-slate-600 flex items-center gap-1.5">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> {fileName}
              </div>
            )}
          </div>

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Stat label="Jami"        value={result.total}   color="slate" />
                <Stat label="Qo'shildi"   value={result.added}   color="emerald" />
                <Stat label="Yangilandi"  value={result.updated} color="indigo" />
                <Stat label="Skip"        value={result.skipped} color="amber" />
                <Stat label="Xato"        value={result.failed}  color="rose" />
              </div>
              {result.failed > 0 && (
                <div className="rounded-xl ring-1 ring-rose-200 bg-rose-50/40 overflow-hidden">
                  <button
                    onClick={() => setFailedOpen((o) => !o)}
                    className="w-full px-4 py-2.5 flex items-center justify-between text-left text-[12px] font-semibold text-rose-900 hover:bg-rose-50"
                  >
                    <span className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      {result.failed} ta xato qatorlar
                    </span>
                    {failedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  {failedOpen && (
                    <div className="max-h-80 overflow-y-auto divide-y divide-rose-100">
                      {failedRows.map((r, i) => (
                        <div key={i} className="px-4 py-2 text-[11px] flex items-baseline gap-3">
                          <span className="font-mono text-rose-700 shrink-0">INN {r.inn}:</span>
                          <span className="text-slate-700">{r.reason || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Format guide */}
      <Card className="border-0 shadow-soft">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <Info className="h-4 w-4 text-indigo-600" />
            <div className="text-sm font-semibold text-slate-800">Excel format</div>
          </div>
          <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500 w-10">#</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Sarlavha</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Izoh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {CP_COLUMNS.map((c) => (
                  <tr key={c.letter} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-mono font-bold text-indigo-700">{c.letter}</td>
                    <td className="px-3 py-2 font-mono text-slate-800">
                      {c.header}
                      {c.required && <span className="text-rose-600 ml-1" title="Majburiy">*</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{c.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-[10.5px] text-slate-500 space-y-1">
            <div>• <b>Birinchi qator (header)</b> avtomatik o'tkazib yuboriladi</div>
            <div>• <b>INN majburiy</b> — bo'sh qatorlar o'tkazib yuboriladi</div>
            <div>• <b>Dublikat:</b> INN allaqachon DB'da bo'lsa, nomi yangilanadi (skip emas)</div>
            <div>• <b>Nom bo'sh bo'lsa</b> — DIDOX cron orqali fon rejimida to'ldiriladi</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
