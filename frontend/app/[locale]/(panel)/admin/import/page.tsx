'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Upload, Loader2, AlertTriangle, FileSpreadsheet, X,
  ChevronDown, ChevronRight, Info, Wallet, Briefcase, Users,
  FileSignature, Lock,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

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
  { key: 'counterparties', label: 'Kontragentlar',   icon: Briefcase,      description: 'INN va nom bo\'yicha (kelajakda)',        available: false },
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
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: 'slate' | 'emerald' | 'amber' | 'rose' }) {
  const colorMap = {
    slate:   'bg-slate-50 ring-slate-100 text-slate-700',
    emerald: 'bg-emerald-50 ring-emerald-100 text-emerald-700',
    amber:   'bg-amber-50 ring-amber-100 text-amber-700',
    rose:    'bg-rose-50 ring-rose-100 text-rose-700',
  };
  return (
    <div className={cn('rounded-xl ring-1 px-4 py-3', colorMap[color])}>
      <div className="text-[10px] uppercase tracking-wider font-bold opacity-75">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
