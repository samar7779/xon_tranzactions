'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Sheet as SheetIcon, Loader2, AlertTriangle, CheckCircle2, Info, Plus, Trash2,
  Play, Save, PlugZap, Copy, Check, ChevronDown, ChevronRight, ArrowRight,
  Columns3, CalendarDays, Filter as FilterIcon, Hash, Link2,
  Download, Database, FileText, FileJson, FileCode2, FileSpreadsheet,
  KeyRound, Lock, Server, Send, Building2,
  Hammer, History, Eye, ChevronLeft, RefreshCw, Clock, X,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

// ─── Turlar ──────────────────────────────────────────────────────────
interface SheetColumn { col: string; field: string; }
interface SheetTarget {
  id: string;
  name: string;
  source?: 'oplatakv' | 'transaction';
  spreadsheetId: string;
  tabName: string;
  startRow: number;
  dateFrom: string | null;
  filter: { objects?: string[]; categories?: string[]; txTypes?: string[]; accounts?: string[]; amountSign?: 'pos' | 'neg' | null };
  writeMode?: 'replace' | 'upsert';
  keyField?: string;
  cron?: { enabled?: boolean; everyMinutes?: number; hourFrom?: number; hourTo?: number; days?: number[] };
  columns: SheetColumn[];
}
interface ConfigResp {
  ok: boolean;
  credentials: { available: boolean; clientEmail: string | null; projectId: string | null; source?: 'env' | 'db' | null };
  sheets: SheetTarget[];
}
interface RunResult {
  ok: boolean;
  step?: string;
  error?: string;
  sheet?: { id?: string; name?: string; spreadsheetId?: string; tabName?: string };
  clearedRanges?: string[];
  rowsFetched?: number;
  rowsWritten?: number;
  writtenRange?: string | null;
  columns?: SheetColumn[];
  dateFrom?: string | null;
  dateTo?: string;
  startRow?: number;
  durationMs?: number;
}

// ОплатыКв → hujayra maydonlari
const FIELDS: Array<{ value: string; label: string }> = [
  { value: 'id',              label: 'ix_id (noyob ID)' },
  { value: 'contractNo',      label: 'Дог № (shartnoma)' },
  { value: 'date',            label: 'Дата (sana)' },
  { value: 'paymentAmount',   label: 'Сумма оплаты' },
  { value: 'firstInstallment',label: '1 взнос' },
  { value: 'monthlyAmount',   label: 'ежемесячный' },
  { value: 'paymentCategory', label: 'Оплата (kategoriya)' },
  { value: 'object',          label: 'Объект' },
  { value: 'client',          label: 'Клиент' },
  { value: 'txType',          label: 'Тип' },
  { value: 'paymentMethod',   label: 'Способ оплаты' },
  { value: 'purpose',         label: 'Назначение' },
  { value: 'note',            label: 'Примечание' },
];
// Tranzaksiya → hujayra maydonlari (rus tilida — ОплатыКв kabi)
const TX_FIELDS: Array<{ value: string; label: string }> = [
  { value: 'externalId',     label: 'ID (external)' },
  { value: 'accountNo',      label: 'Расчётный счёт' },
  { value: 'bankName',       label: 'Банк' },
  { value: 'txnDate',        label: 'Дата' },
  { value: 'amount',         label: 'Сумма' },
  { value: 'direction',      label: 'Направление (IN/OUT)' },
  { value: 'fromName',       label: 'Отправитель' },
  { value: 'fromAccount',    label: 'Счёт отправителя' },
  { value: 'fromInn',        label: 'ИНН отправителя' },
  { value: 'toName',         label: 'Получатель' },
  { value: 'toAccount',      label: 'Счёт получателя' },
  { value: 'toInn',          label: 'ИНН получателя' },
  { value: 'description',    label: 'Назначение платежа' },
  { value: 'contractNumber', label: 'Договор' },
  { value: 'category',       label: 'Категория' },
  { value: 'subcategory',    label: 'Подкатегория' },
  { value: 'docNumber',      label: '№ документа' },
  { value: 'reference',      label: 'Reference' },
  { value: 'id',             label: 'Внутренний ID' },
];
const FIELD_LABEL: Record<string, string> = Object.fromEntries([...FIELDS, ...TX_FIELDS].map((f) => [f.value, f.label]));
const fieldsForSource = (src?: string) => (src === 'transaction' ? TX_FIELDS : FIELDS);

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'MONTHLY', label: 'ежемесячный' },
  { value: 'FIRST',   label: '1 взнос' },
  { value: 'GENERAL', label: 'Общий' },
];

// ─── Fayl yuklab olish: qaysi ma'lumot + qaysi format ───
const DATASETS: Array<{ key: string; label: string }> = [
  { key: 'oplatykv',     label: 'ОплатыКв (kvartira to\'lovlari)' },
  { key: 'transactions', label: 'Transaksiyalar' },
];
const DL_FORMATS: Array<{ key: string; label: string; ext: string; icon: any }> = [
  { key: 'json',         label: 'JSON',                ext: 'json', icon: FileJson },
  { key: 'csv',          label: 'CSV',                 ext: 'csv',  icon: FileSpreadsheet },
  { key: 'xlsx',         label: 'Excel',               ext: 'xlsx', icon: FileSpreadsheet },
  { key: 'sql-mysql',    label: 'SQL · MariaDB/MySQL', ext: 'sql',  icon: Database },
  { key: 'sql-postgres', label: 'SQL · PostgreSQL',    ext: 'sql',  icon: Database },
  { key: 'txt',          label: 'TXT (bloknot)',       ext: 'txt',  icon: FileText },
  { key: 'xml',          label: 'XML',                 ext: 'xml',  icon: FileCode2 },
  { key: 'html',         label: 'HTML',                ext: 'html', icon: FileCode2 },
  { key: 'md',           label: 'Markdown',            ext: 'md',   icon: FileText },
  { key: 'yaml',         label: 'YAML',                ext: 'yaml', icon: FileCode2 },
];

const STEP_LABEL: Record<string, string> = {
  auth:     'Autentifikatsiya (service-account)',
  validate: 'Sozlamalarni tekshirish',
  clear:    'Ustunlarni tozalash',
  fetch:    'ОплатыКв ma\'lumotini olish',
  write:    'Google Sheets\'ga yozish',
};

function blankSheet(idx: number): SheetTarget {
  return {
    id: `sheet-${Date.now()}-${idx}`,
    name: `Sheet ${idx + 1}`,
    source: 'oplatakv',
    spreadsheetId: '',
    tabName: '',
    startRow: 2,
    dateFrom: '',
    filter: { objects: [], categories: [], txTypes: [], accounts: [], amountSign: null },
    writeMode: 'replace',
    columns: [{ col: 'A', field: 'date' }, { col: 'B', field: 'contractNo' }],
  };
}

export default function AdminExportPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = !!user?.permissions?.includes(PERMS.EXPORT_MANAGE);
  const canRun = !!user?.permissions?.includes(PERMS.EXPORT_RUN);
  const canDownload = !!user?.permissions?.includes(PERMS.EXPORT_DOWNLOAD);
  const canAutsourcing = !!user?.permissions?.includes(PERMS.EXPORT_AUTSOURCING);

  const [tab, setTab] = useState<'sheets' | 'autsourcing' | 'shmitd'>('sheets');
  const [sheets, setSheets] = useState<SheetTarget[]>([]);
  const [dirty, setDirty] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Cron modal (avtomatik jadval + tarix)
  const [cronOpen, setCronOpen] = useState(false);
  const setSheetCron = (sheetId: string, cron: SheetTarget['cron']) => {
    setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, cron } : s)));
    setDirty(true);
  };

  // Fayl yuklab olish (JSON/SQL/Excel/...)
  const [dlOpen, setDlOpen] = useState(false);
  const [dlDataset, setDlDataset] = useState('oplatykv');
  const [downloading, setDownloading] = useState<string | null>(null);
  const doDownload = async (f: { key: string; ext: string; label: string }) => {
    setDownloading(f.key);
    try {
      await apiDownload(`/google-export/download?dataset=${dlDataset}&format=${f.key}`, `${dlDataset}.${f.ext}`);
      toast.success(`${f.label} yuklab olindi`);
    } catch (e: any) {
      toast.error(e?.message || 'Yuklab olishda xato');
    } finally {
      setDownloading(null);
    }
  };

  const cfgQuery = useQuery({
    queryKey: ['google-export-config'],
    queryFn: () => api.get<ConfigResp>('/google-export/config'),
  });

  // Filtr dropdownlari uchun mavjud Объект/Тип qiymatlari
  const distinctQuery = useQuery({
    queryKey: ['export-distinct-filters'],
    queryFn: () => api.get<{ objects: string[]; txTypes: string[] }>('/google-export/distinct-filters'),
    staleTime: 300_000,
  });
  const distinctObjects = distinctQuery.data?.objects || [];
  const distinctTxTypes = distinctQuery.data?.txTypes || [];

  // Config yuklangach local state'ni to'ldiramiz (bo'sh bo'lsa 2 ta shablon)
  useEffect(() => {
    if (!cfgQuery.data) return;
    const s = cfgQuery.data.sheets || [];
    if (s.length > 0) setSheets(s);
    else setSheets([blankSheet(0), blankSheet(1)]);
    setDirty(false);
  }, [cfgQuery.data]);

  const creds = cfgQuery.data?.credentials;

  const updateSheet = (idx: number, patch: Partial<SheetTarget>) => {
    setSheets((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    setDirty(true);
  };
  const removeSheet = (idx: number) => {
    setSheets((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };
  const addSheet = () => {
    setSheets((prev) => [...prev, blankSheet(prev.length)]);
    setDirty(true);
  };

  const saveMut = useMutation({
    mutationFn: () => api.put('/google-export/config', { sheets }),
    onSuccess: () => {
      toast.success('Sozlamalar saqlandi');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['google-export-config'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Saqlashda xato'),
  });

  // ── Ulanishni tekshirish ──
  const [testResult, setTestResult] = useState<any>(null);
  const testMut = useMutation({
    mutationFn: () => api.post('/google-export/test', {}, { timeout: 60_000 }),
    onMutate: () => setTestResult(null),
    onSuccess: (r: any) => setTestResult(r),
    onError: (e: any) => toast.error(e?.message || 'Tekshirishda xato'),
  });

  // ── Credential (UI paste) ──
  const [credJson, setCredJson] = useState('');
  const [showCredBox, setShowCredBox] = useState(false);
  const saveCredMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; clientEmail: string }>('/google-export/credentials', { json: credJson }),
    onSuccess: (r) => {
      toast.success(`Kalit saqlandi: ${r.clientEmail}`);
      setCredJson(''); setShowCredBox(false);
      qc.invalidateQueries({ queryKey: ['google-export-config'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Kalit saqlanmadi'),
  });
  const clearCredMut = useMutation({
    mutationFn: () => api.delete('/google-export/credentials'),
    onSuccess: () => {
      toast.success('Kalit o\'chirildi');
      setTestResult(null);
      qc.invalidateQueries({ queryKey: ['google-export-config'] });
    },
    onError: (e: any) => toast.error(e?.message || 'O\'chirilmadi'),
  });

  const copyEmail = async () => {
    if (!creds?.clientEmail) return;
    try {
      await navigator.clipboard.writeText(creds.clientEmail);
      setCopiedEmail(true);
      toast.success('Email nusxalandi');
      setTimeout(() => setCopiedEmail(false), 1500);
    } catch { toast.error('Nusxalab bo\'lmadi'); }
  };

  if (cfgQuery.isLoading) {
    return (
      <div className="flex-1 grid place-items-center py-24 text-slate-400 dark:text-slate-500">
        <div className="flex items-center gap-2 text-[13px]"><Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 lg:p-8 w-full space-y-5">
      {/* ─── Sub-tab bar + yuklab olish ikonasi ─── */}
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800">
          <button
            onClick={() => setTab('sheets')}
            className={cn(
              'px-3.5 h-8 rounded-lg text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors',
              tab === 'sheets'
                ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200',
            )}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Google Sheets
          </button>
          {canAutsourcing && (
            <button
              onClick={() => setTab('autsourcing')}
              className={cn(
                'px-3.5 h-8 rounded-lg text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors',
                tab === 'autsourcing'
                  ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200',
              )}
            >
              <Send className="h-3.5 w-3.5" /> Autsoursing
            </button>
          )}
          {canAutsourcing && (
            <button
              onClick={() => setTab('shmitd')}
              className={cn(
                'px-3.5 h-8 rounded-lg text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors',
                tab === 'shmitd'
                  ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200',
              )}
            >
              <Hammer className="h-3.5 w-3.5" /> SHMITD
            </button>
          )}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setCronOpen(true)}
          title="Cron — avtomatik jadval va ishga tushishlar tarixi"
          className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 grid place-items-center transition-colors"
        >
          <Clock className="h-5 w-5" />
        </button>
        {canDownload && (
          <button
            onClick={() => setDlOpen(true)}
            title="Ma'lumotni yuklab olish (JSON, SQL, Excel, TXT...)"
            className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white grid place-items-center shadow-md shadow-indigo-500/25 transition-colors"
          >
            <Download className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* ─── Cron modal (avtomatik jadval + tarix) ─── */}
      <CronModal
        open={cronOpen}
        onClose={() => setCronOpen(false)}
        sheets={sheets}
        canManage={canManage}
        dirty={dirty}
        saving={saveMut.isPending}
        onSetCron={setSheetCron}
        onSave={() => saveMut.mutate()}
      />

      {tab === 'sheets' && (<>

      {/* ─── Credential / ulanish holati ─── */}
      <Card className="border-0 shadow-soft overflow-hidden">
        {/* Premium gradient header strip */}
        <div className={cn(
          'relative px-5 py-4 flex items-center gap-3.5 border-b bg-gradient-to-r',
          creds?.available
            ? 'border-emerald-100 dark:border-emerald-950 from-emerald-500/[0.09] via-teal-500/[0.04] to-transparent'
            : 'border-rose-100 dark:border-rose-950 from-rose-500/[0.09] via-orange-500/[0.04] to-transparent',
        )}>
          <div className={cn(
            'w-11 h-11 rounded-2xl grid place-items-center shadow-md shrink-0',
            creds?.available
              ? 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/30'
              : 'bg-gradient-to-br from-rose-500 to-orange-600 shadow-rose-500/30',
          )}>
            <KeyRound className="h-5 w-5 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-bold text-slate-800 dark:text-slate-100">Google Service Account</span>
              <span className={cn(
                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ring-1',
                creds?.available
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800'
                  : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-800',
              )}>
                <span className={cn('w-1.5 h-1.5 rounded-full', creds?.available ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500')} />
                {creds?.available ? 'Ulangan' : 'Ulanmagan'}
              </span>
            </div>
            {creds?.clientEmail ? (
              <button
                onClick={copyEmail}
                title="Nusxalash — bu emailni Google jadvalga Редактор qilib qo'shing"
                className="mt-1 inline-flex items-center gap-1.5 max-w-full text-[11.5px] font-mono text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors group"
              >
                <span className="truncate">{creds.clientEmail}</span>
                {copiedEmail
                  ? <Check className="h-3 w-3 text-emerald-600 shrink-0" />
                  : <Copy className="h-3 w-3 shrink-0 opacity-60 group-hover:opacity-100" />}
              </button>
            ) : (
              <div className="mt-0.5 text-[11.5px] text-slate-400 dark:text-slate-500">Kalit kiritilmagan — pastda joylashtiring</div>
            )}
          </div>

          <Button
            onClick={() => testMut.mutate()}
            disabled={testMut.isPending || !creds?.available}
            variant="outline"
            className="h-9 gap-2 text-[12px] shrink-0 bg-white/70 dark:bg-slate-900/70 backdrop-blur"
          >
            {testMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            Tekshirish
          </Button>
        </div>

        <CardContent className="p-5 space-y-4">

          {/* Kalit manbasi + o'zgartirish/o'chirish */}
          {creds?.available && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold ring-1',
                creds.source === 'db'
                  ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-900'
                  : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-sky-200 dark:ring-sky-900',
              )}>
                {creds.source === 'db' ? <Lock className="h-3 w-3" /> : <Server className="h-3 w-3" />}
                {creds.source === 'db' ? 'App\'da shifrlangan' : 'Server env'}
              </span>
              {canManage && (
                <button onClick={() => setShowCredBox((v) => !v)} className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                  {showCredBox ? 'yopish' : 'o\'zgartirish'}
                </button>
              )}
              {canManage && creds.source === 'db' && (
                <button onClick={() => clearCredMut.mutate()} disabled={clearCredMut.isPending} className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline">
                  o'chirish
                </button>
              )}
            </div>
          )}

          {/* JSON paste — kalit yo'q bo'lsa yoki o'zgartirilayotgan bo'lsa */}
          {canManage && (!creds?.available || showCredBox) && (
            <div className="rounded-xl ring-1 ring-indigo-200 dark:ring-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/30 p-3 space-y-2">
              <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100">Service-account JSON kalitini joylashtiring</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                <b>abc_sheets.json</b> faylini bloknot/muharrirda oching → butun matnni belgilang (Ctrl+A) → nusxalang (Ctrl+C) → pastga qo'ying (Ctrl+V).
              </div>
              <textarea
                value={credJson}
                onChange={(e) => setCredJson(e.target.value)}
                spellCheck={false}
                placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n...",\n  "client_email": "...@....iam.gserviceaccount.com"\n}'}
                className="w-full h-36 rounded-lg text-[11px] font-mono bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 p-2 outline-none focus:ring-indigo-400 resize-y"
              />
              <div className="flex items-center gap-2">
                <Button onClick={() => saveCredMut.mutate()} disabled={saveCredMut.isPending || !credJson.trim()} className="h-9 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold">
                  {saveCredMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Kalitni saqlash
                </Button>
                {showCredBox && (
                  <Button variant="outline" onClick={() => { setShowCredBox(false); setCredJson(''); }} className="h-9 text-[12px]">Bekor</Button>
                )}
              </div>
              <div className="text-[10.5px] text-slate-400 dark:text-slate-500">🔒 Kalit AES-256 bilan shifrlangan holda saqlanadi. Saqlagach darrov ishlaydi — restart shart emas.</div>
            </div>
          )}

          {/* Ruxsat yo'q bo'lsa — ma'lumot */}
          {!creds?.available && !canManage && (
            <div className="rounded-xl ring-1 ring-amber-200 dark:ring-amber-900 bg-amber-50/60 dark:bg-amber-950/40 px-4 py-3 text-[12px] text-amber-900 dark:text-amber-300 flex gap-2 items-start">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <div>Service-account kaliti sozlanmagan. Buni sozlash uchun <b>export:manage</b> ruxsati kerak.</div>
            </div>
          )}

          {/* Test natijasi */}
          {testResult && (
            <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700">
              {(testResult.checks || []).length === 0 && (
                <div className="px-4 py-3 text-[12px] text-slate-500 dark:text-slate-400">
                  Sozlangan jadval yo'q — quyida spreadsheet ID kiriting va qaytadan tekshiring.
                </div>
              )}
              {(testResult.checks || []).map((c: any) => (
                <div key={c.id} className="px-4 py-2.5 flex items-start gap-2 text-[12px]">
                  {c.ok
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                    : <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />}
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{c.name}</span>
                    {c.title && <span className="text-slate-500 dark:text-slate-400"> — {c.title}</span>}
                    {!c.ok && c.error && <div className="text-rose-600 dark:text-rose-400 mt-0.5">{c.error}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Sheet kartochkalari ─── */}
      {sheets.map((sheet, idx) => (
        <SheetCard
          key={sheet.id}
          sheet={sheet}
          index={idx}
          canManage={canManage}
          canRun={canRun}
          credsAvailable={!!creds?.available}
          distinctObjects={distinctObjects}
          distinctTxTypes={distinctTxTypes}
          onChange={(patch) => updateSheet(idx, patch)}
          onRemove={() => removeSheet(idx)}
        />
      ))}

      {/* ─── Pastki panel: qo'shish + saqlash ─── */}
      {canManage && (
        <div className="flex items-center gap-3">
          <Button onClick={addSheet} variant="outline" className="h-10 gap-2 text-[13px]">
            <Plus className="h-4 w-4" /> Sheet qo'shish
          </Button>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !dirty}
            className="h-10 gap-2 ml-auto bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold"
          >
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {dirty ? 'Sozlamalarni saqlash' : 'Saqlangan'}
          </Button>
        </div>
      )}

      <HelpSection clientEmail={creds?.clientEmail || null} />
      </>)}

      {/* ─── Autsoursing tab ─── */}
      {tab === 'autsourcing' && canAutsourcing && <AutsourcingTab canManage={canManage} />}

      {/* ─── SHMITD tab ─── */}
      {tab === 'shmitd' && canAutsourcing && <ShmitdTab canManage={canManage} />}

      {/* ─── Fayl yuklab olish dialogi ─── */}
      <Dialog open={dlOpen} onOpenChange={setDlOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-indigo-600 dark:text-indigo-400" /> Ma'lumotni yuklab olish
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              Qaysi ma'lumot va qaysi formatda — formatni bosing, darrov yuklanadi.
            </DialogDescription>
          </DialogHeader>

          {/* Dataset tanlash */}
          <div className="flex gap-2">
            {DATASETS.map((d) => (
              <button
                key={d.key}
                onClick={() => setDlDataset(d.key)}
                className={cn(
                  'flex-1 h-10 px-2 rounded-lg text-[12px] font-semibold ring-1 transition-colors',
                  dlDataset === d.key
                    ? 'bg-indigo-600 text-white ring-indigo-700'
                    : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* Format tanlash */}
          <div className="grid grid-cols-2 gap-2">
            {DL_FORMATS.map((f) => {
              const Icon = f.icon;
              const busy = downloading === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => doDownload(f)}
                  disabled={!!downloading}
                  className="flex items-center gap-2.5 h-12 px-3 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-indigo-300 dark:hover:ring-indigo-700 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30 transition-colors disabled:opacity-50 text-left"
                >
                  {busy
                    ? <Loader2 className="h-4 w-4 animate-spin text-indigo-600 dark:text-indigo-400 shrink-0" />
                    : <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 truncate">{f.label}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500">.{f.ext}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="text-[10.5px] text-slate-400 dark:text-slate-500">
            Barcha qatorlar eksport qilinadi. Katta hajmda biroz kutish bo'lishi mumkin.
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CRON modal — avtomatik jadval (Rejalar) + ishga tushishlar tarixi (Log)
// ═══════════════════════════════════════════════════════════════════════
const CRON_DAYS = [
  { v: 1, l: 'Du' }, { v: 2, l: 'Se' }, { v: 3, l: 'Ch' }, { v: 4, l: 'Pa' },
  { v: 5, l: 'Ju' }, { v: 6, l: 'Sh' }, { v: 0, l: 'Ya' },
];

function CronModal({
  open, onClose, sheets, canManage, dirty, saving, onSetCron, onSave,
}: {
  open: boolean; onClose: () => void; sheets: SheetTarget[]; canManage: boolean;
  dirty: boolean; saving: boolean;
  onSetCron: (sheetId: string, cron: SheetTarget['cron']) => void; onSave: () => void;
}) {
  const [tab, setTab] = useState<'schedules' | 'logs'>('schedules');
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" /> Avtomatik jadval (Cron)</DialogTitle>
          <DialogDescription className="text-[12px]">Sheetlarni belgilangan jadval bo'yicha avtomat ishga tushiring va tarixni ko'ring.</DialogDescription>
        </DialogHeader>
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 w-fit">
          {([['schedules', 'Rejalar'], ['logs', 'Log (tarix)']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)} className={cn('px-3.5 h-8 rounded-lg text-[12.5px] font-semibold transition-colors', tab === v ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200')}>{l}</button>
          ))}
        </div>
        {tab === 'schedules'
          ? <CronSchedules sheets={sheets} canManage={canManage} dirty={dirty} saving={saving} onSetCron={onSetCron} onSave={onSave} />
          : <CronLogs />}
      </DialogContent>
    </Dialog>
  );
}

function CronSchedules({ sheets, canManage, dirty, saving, onSetCron, onSave }: {
  sheets: SheetTarget[]; canManage: boolean; dirty: boolean; saving: boolean;
  onSetCron: (sheetId: string, cron: SheetTarget['cron']) => void; onSave: () => void;
}) {
  const [page, setPage] = useState(1);
  const PAGE = 5;
  const pages = Math.max(1, Math.ceil(sheets.length / PAGE));
  const shown = sheets.slice((page - 1) * PAGE, page * PAGE);
  return (
    <div className="space-y-3">
      <div className="max-h-[52vh] overflow-y-auto space-y-2.5 pr-1">
        {sheets.length === 0
          ? <div className="text-[12px] text-slate-400 py-6 text-center">Sheet yo'q — avval qo'shing</div>
          : shown.map((s) => <CronSheetRow key={s.id} sheet={s} canManage={canManage} onSetCron={onSetCron} />)}
      </div>
      {pages > 1 && <Pager page={page} pages={pages} onPage={setPage} />}
      {canManage && (
        <div className="flex items-center justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button onClick={onSave} disabled={saving || !dirty} className="h-9 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[12.5px] font-semibold">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {dirty ? 'Saqlash' : 'Saqlangan'}
          </Button>
        </div>
      )}
    </div>
  );
}

function CronSheetRow({ sheet, canManage, onSetCron }: {
  sheet: SheetTarget; canManage: boolean; onSetCron: (sheetId: string, cron: SheetTarget['cron']) => void;
}) {
  const c = sheet.cron || {};
  const set = (patch: Partial<NonNullable<SheetTarget['cron']>>) => onSetCron(sheet.id, { ...c, ...patch });
  const days = new Set(c.days || []);
  const toggleDay = (d: number) => { const n = new Set(days); if (n.has(d)) n.delete(d); else n.add(d); set({ days: Array.from(n) }); };
  return (
    <div className={cn('rounded-xl ring-1 p-3 space-y-2.5 transition-colors', c.enabled ? 'ring-indigo-200 dark:ring-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20' : 'ring-slate-200 dark:ring-slate-700')}>
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 grid place-items-center shrink-0"><SheetIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /></span>
        <span className="text-[13px] font-bold text-slate-800 dark:text-slate-100 flex-1 truncate">{sheet.name}</span>
        <button disabled={!canManage} onClick={() => set({ enabled: !c.enabled })} className={cn('relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-60', c.enabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600')}>
          <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', c.enabled && 'translate-x-4')} />
        </button>
      </div>
      {c.enabled && (
        <div className="space-y-2 pl-1">
          <div className="flex items-center gap-2 flex-wrap text-[12px]">
            <span className="text-slate-500 dark:text-slate-400">Har</span>
            <input type="number" min={1} value={c.everyMinutes || 60} onChange={(e) => set({ everyMinutes: Math.max(1, Number(e.target.value) || 1) })} disabled={!canManage} className="w-16 h-8 rounded-lg text-center bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-indigo-400" />
            <span className="text-slate-500 dark:text-slate-400">daqiqada</span>
            <span className="mx-1 text-slate-300">·</span>
            <span className="text-slate-500 dark:text-slate-400">soat</span>
            <input type="number" min={0} max={23} placeholder="0" value={c.hourFrom ?? ''} onChange={(e) => set({ hourFrom: e.target.value === '' ? undefined : Math.min(23, Math.max(0, Number(e.target.value))) })} disabled={!canManage} className="w-14 h-8 rounded-lg text-center bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-indigo-400" />
            <span className="text-slate-500 dark:text-slate-400">dan</span>
            <input type="number" min={0} max={23} placeholder="23" value={c.hourTo ?? ''} onChange={(e) => set({ hourTo: e.target.value === '' ? undefined : Math.min(23, Math.max(0, Number(e.target.value))) })} disabled={!canManage} className="w-14 h-8 rounded-lg text-center bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-indigo-400" />
            <span className="text-slate-500 dark:text-slate-400">gacha</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] text-slate-500 dark:text-slate-400">Kunlar:</span>
            {CRON_DAYS.map((d) => {
              const on = days.has(d.v);
              return <button key={d.v} disabled={!canManage} onClick={() => toggleDay(d.v)} className={cn('w-8 h-7 rounded-lg text-[11px] font-semibold ring-1 transition-colors', on ? 'bg-indigo-600 text-white ring-indigo-700' : 'bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700')}>{d.l}</button>;
            })}
            <span className="text-[10px] text-slate-400">(bo'sh = har kun)</span>
          </div>
        </div>
      )}
    </div>
  );
}

function CronLogs() {
  const [page, setPage] = useState(1);
  const [sheetId, setSheetId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['export-cron-logs', page, sheetId, dateFrom, dateTo, status],
    queryFn: () => api.get<any>(`/google-export/cron/logs?${new URLSearchParams({ page: String(page), ...(sheetId && { sheetId }), ...(dateFrom && { dateFrom }), ...(dateTo && { dateTo }), ...(status && { status }) }).toString()}`),
  });
  const data = q.data;
  const items: any[] = data?.items || [];
  const logSheets: any[] = data?.sheets || [];
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 flex-wrap">
        <select value={sheetId} onChange={(e) => { setSheetId(e.target.value); setPage(1); }} className="h-9 rounded-lg text-[12px] bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-2 outline-none">
          <option value="">Barcha ishlar</option>
          {logSheets.map((s) => <option key={s.sheetId} value={s.sheetId}>{s.sheetName}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 rounded-lg text-[12px] bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-2 outline-none">
          <option value="">Barcha holat</option>
          <option value="ok">OK</option>
          <option value="error">Xato</option>
        </select>
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-9 rounded-lg text-[12px] bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-2 outline-none" />
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-9 rounded-lg text-[12px] bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-2 outline-none" />
        <button onClick={() => q.refetch()} title="Yangilash" className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-slate-800 grid place-items-center text-slate-500"><RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} /></button>
      </div>
      <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
        <div className="max-h-[44vh] overflow-auto">
          <table className="w-full text-[11.5px]">
            <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 text-[9.5px] uppercase text-slate-400 z-10">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Vaqt</th>
                <th className="text-left px-3 py-2 font-semibold">Ish</th>
                <th className="text-left px-3 py-2 font-semibold">Rejim</th>
                <th className="text-right px-3 py-2 font-semibold">Qator</th>
                <th className="text-left px-3 py-2 font-semibold">Holat</th>
                <th className="text-left px-3 py-2 font-semibold">Kim</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {q.isLoading ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Yozuv yo'q</td></tr>
              ) : items.map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-1.5 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">{new Date(it.startedAt).toLocaleString('ru-RU')}</td>
                  <td className="px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[140px]">{it.sheetName}</td>
                  <td className="px-3 py-1.5"><span className={cn('text-[10px] px-1.5 py-0.5 rounded', it.mode === 'cron' ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500')}>{it.mode}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{it.rowsWritten}</td>
                  <td className="px-3 py-1.5">{it.status === 'ok'
                    ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> OK</span>
                    : <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400" title={it.error || ''}><AlertTriangle className="h-3 w-3" /> Xato</span>}</td>
                  <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 truncate max-w-[120px]" title={it.triggeredBy || ''}>{it.triggeredBy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {(data?.pages || 1) > 1 && <Pager page={page} pages={data.pages} onPage={setPage} />}
    </div>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-2 text-[12px]">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="h-8 w-8 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 grid place-items-center disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
      <span className="text-slate-500 dark:text-slate-400 tabular-nums">{page} / {pages}</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="h-8 w-8 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 grid place-items-center disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Checkboxli multi-select dropdown (mavjud qiymatlardan bir nechtasini tanlash)
// ═══════════════════════════════════════════════════════════════════════
function MultiSelectDropdown({
  options, selected, onChange, disabled, placeholder,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const sel = new Set(selected);
  const filtered = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const allSelected = options.length > 0 && options.every((o) => sel.has(o));
  const toggle = (v: string) => { const n = new Set(sel); if (n.has(v)) n.delete(v); else n.add(v); onChange(Array.from(n)); };
  const toggleAll = () => onChange(allSelected ? [] : [...options]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full h-11 px-3.5 rounded-xl text-[12.5px] border border-slate-200/80 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/50 shadow-sm flex items-center gap-2 text-left disabled:opacity-60 outline-none transition-all hover:border-slate-300 dark:hover:border-slate-600',
          open && 'ring-[3px] ring-indigo-500/25 border-indigo-400 bg-white dark:bg-slate-900',
        )}
      >
        <span className={cn('flex-1 truncate', selected.length ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400')}>
          {selected.length === 0 ? (placeholder || 'Barchasi') : selected.length === options.length ? 'Barchasi tanlangan' : `${selected.length} ta tanlangan`}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform shrink-0', open && 'rotate-180')} />
      </button>
      {selected.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {selected.slice(0, 8).map((s) => (
            <span key={s} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[10px] max-w-[160px]">
              <span className="truncate">{s}</span>
              {!disabled && <button onClick={() => toggle(s)} className="shrink-0"><X className="h-2.5 w-2.5" /></button>}
            </span>
          ))}
          {selected.length > 8 && <span className="text-[10px] text-slate-400">+{selected.length - 8}</span>}
        </div>
      )}
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 shadow-xl p-1">
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish…"
            className="w-full h-8 px-2 mb-1 rounded text-[12px] bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-1 focus:ring-indigo-400"
          />
          {options.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-slate-400">Ma'lumot yo'q</div>
          ) : (
            <>
              <button onClick={toggleAll} className="w-full flex items-center gap-2 px-2 h-8 rounded hover:bg-slate-50 dark:hover:bg-slate-900 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">
                <span className={cn('w-4 h-4 rounded border grid place-items-center shrink-0', allSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 dark:border-slate-600')}>{allSelected && <Check className="h-3 w-3 text-white" />}</span>
                Barchasini tanlash
              </button>
              {filtered.length === 0 ? (
                <div className="px-2 py-2 text-[11px] text-slate-400">Topilmadi</div>
              ) : filtered.map((o) => {
                const on = sel.has(o);
                return (
                  <button key={o} onClick={() => toggle(o)} className="w-full flex items-center gap-2 px-2 h-8 rounded hover:bg-slate-50 dark:hover:bg-slate-900 text-[12px] text-left text-slate-700 dark:text-slate-200">
                    <span className={cn('w-4 h-4 rounded border grid place-items-center shrink-0', on ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 dark:border-slate-600')}>{on && <Check className="h-3 w-3 text-white" />}</span>
                    <span className="truncate">{o}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Bitta sheet kartochkasi
// ═══════════════════════════════════════════════════════════════════════
function SheetCard({
  sheet, index, canManage, canRun, credsAvailable, distinctObjects, distinctTxTypes, onChange, onRemove,
}: {
  sheet: SheetTarget;
  index: number;
  canManage: boolean;
  canRun: boolean;
  credsAvailable: boolean;
  distinctObjects: string[];
  distinctTxTypes: string[];
  onChange: (patch: Partial<SheetTarget>) => void;
  onRemove: () => void;
}) {
  const [result, setResult] = useState<RunResult | null>(null);
  const [open, setOpen] = useState(false); // kirganda yopiq tursin

  const runMut = useMutation({
    mutationFn: () => api.post<RunResult>('/google-export/run', { target: sheet }, { timeout: 300_000 }),
    onMutate: () => setResult(null),
    onSuccess: (r) => {
      setResult(r);
      if (r.ok) toast.success(`"${sheet.name}" — ${r.rowsWritten} qator yozildi`);
      else toast.error(`"${sheet.name}" — xato: ${r.error}`);
    },
    onError: (e: any) => {
      setResult({ ok: false, step: 'network', error: e?.message || 'Server bilan aloqa uzildi' });
    },
  });

  const disabledRun = !canRun || !credsAvailable || runMut.isPending;

  const setFilter = (patch: Partial<SheetTarget['filter']>) =>
    onChange({ filter: { ...sheet.filter, ...patch } });

  // Upsert — oxirgi yozilgan ID'larni .txt qilib yuklab olish
  const downloadKeys = async () => {
    try {
      const r = await api.get<{ keys: string[]; count: number }>(`/google-export/upsert-keys?sheetId=${encodeURIComponent(sheet.id)}`);
      if (!r.keys?.length) { toast.message('Hali yozilgan ix_id yo\'q — avval «Bajarish»ni bosing'); return; }
      const blob = new Blob([r.keys.join('\n')], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${(sheet.name || 'sheet').replace(/[^\w.-]+/g, '_')}-ix_id.txt`; a.click();
      URL.revokeObjectURL(url);
      toast.success(`${r.count} ta ix_id yuklab olindi`);
    } catch (e: any) { toast.error(e?.message || 'Yuklab olishda xato'); }
  };

  const toggleCategory = (val: string) => {
    const set = new Set(sheet.filter?.categories || []);
    if (set.has(val)) set.delete(val); else set.add(val);
    setFilter({ categories: Array.from(set) });
  };

  // Mapping helperlar
  const setColumn = (i: number, patch: Partial<SheetColumn>) =>
    onChange({ columns: sheet.columns.map((c, ci) => (ci === i ? { ...c, ...patch } : c)) });
  const addColumn = () => {
    const nextLetter = String.fromCharCode(65 + (sheet.columns.length % 26));
    onChange({ columns: [...sheet.columns, { col: nextLetter, field: 'contractNo' }] });
  };
  const removeColumn = (i: number) =>
    onChange({ columns: sheet.columns.filter((_, ci) => ci !== i) });

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <CardContent className="p-5 space-y-4">
        {/* Sarlavha qatori — bosilganda ochilib/yopiladi */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOpen((o) => !o)}
            title={open ? 'Yopish' : 'Ochish'}
            className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 grid place-items-center shrink-0 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          >
            <SheetIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </button>
          <input
            value={sheet.name}
            onChange={(e) => onChange({ name: e.target.value })}
            disabled={!canManage}
            className="text-[15px] font-bold text-slate-800 dark:text-slate-100 bg-transparent outline-none border-b border-transparent focus:border-indigo-400 disabled:border-transparent min-w-0 flex-1"
          />
          <button
            onClick={() => setOpen((o) => !o)}
            title={open ? 'Yopish' : 'Ochish'}
            className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {canManage && (
            <button
              onClick={onRemove}
              title="Bu sheetni o'chirish"
              className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {/* Yopiq holatda ham Bajarish — bosilganda ochilib jarayonni ko'rsatadi */}
          {!open && (
            <button
              onClick={() => { setOpen(true); runMut.mutate(); }}
              disabled={disabledRun}
              title="Bajarish"
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[12px] font-semibold shrink-0 transition-colors"
            >
              {runMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Bajarish
            </button>
          )}
        </div>

        {open && (<>
        {/* Asosiy sozlamalar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Spreadsheet ID (yoki link)" icon={<Link2 className="h-3.5 w-3.5" />}>
            <Input
              value={sheet.spreadsheetId}
              onChange={(e) => onChange({ spreadsheetId: e.target.value })}
              disabled={!canManage}
              placeholder="1AbC…xyz  yoki  to'liq havola"
              className={cn(PRO_INPUT, 'font-mono')}
            />
          </Field>
          <Field label="Jadval (list) nomi" icon={<SheetIcon className="h-3.5 w-3.5" />}>
            <Input
              value={sheet.tabName}
              onChange={(e) => onChange({ tabName: e.target.value })}
              disabled={!canManage}
              placeholder="Ойлик"
              className={cn(PRO_INPUT)}
            />
          </Field>
          <Field label="Boshlanish qatori" icon={<Hash className="h-3.5 w-3.5" />}>
            <Input
              type="number" min={1}
              value={sheet.startRow}
              onChange={(e) => onChange({ startRow: Number(e.target.value) || 1 })}
              disabled={!canManage}
              className={cn(PRO_INPUT, 'w-32')}
            />
          </Field>
          <Field label="Sana (bundan → bugungacha)" icon={<CalendarDays className="h-3.5 w-3.5" />}>
            <Input
              type="date"
              value={sheet.dateFrom || ''}
              onChange={(e) => onChange({ dateFrom: e.target.value })}
              disabled={!canManage}
              className={cn(PRO_INPUT)}
            />
          </Field>
        </div>

        {/* Manba + Filtr */}
        <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 p-3 space-y-3">
          {/* Manba tanlash */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Manba:</span>
            <div className="inline-flex rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
              {([['oplatakv', 'ОплатыКв'], ['transaction', 'Tranzaksiya']] as const).map(([sv, lbl]) => (
                <button
                  key={sv}
                  onClick={() => canManage && onChange({ source: sv })}
                  disabled={!canManage}
                  className={cn('px-3 h-7 text-[11px] font-semibold transition-colors',
                    (sheet.source || 'oplatakv') === sv ? 'bg-indigo-600 text-white' : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800')}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <FilterIcon className="h-3.5 w-3.5" /> Filtr (ixtiyoriy — bo'sh = hammasi)
          </div>

          {sheet.source === 'transaction' ? (
            <Field label="Hisob raqamlari — vergul yoki yangi qatorda (bo'sh = barcha hisob)">
              <textarea
                value={(sheet.filter?.accounts || []).join('\n')}
                onChange={(e) => setFilter({ accounts: e.target.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) })}
                disabled={!canManage}
                rows={3}
                placeholder={'20208000705500044002\n20208000505500044002\n20208000005500044001'}
                className="w-full px-3 py-2 rounded-lg text-[12px] font-mono bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
              />
            </Field>
          ) : (
            <>
              {/* Сумма оплаты filtri — 0 dan baland / 0 dan kichik (0 skip) */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Сумма:</span>
                {([['', 'Barchasi'], ['pos', '0 dan baland (+)'], ['neg', '0 dan kichik (−)']] as const).map(([v, lbl]) => {
                  const active = (sheet.filter?.amountSign || '') === v;
                  return (
                    <button key={v || 'all'} onClick={() => canManage && setFilter({ amountSign: (v || null) as any })} disabled={!canManage}
                      className={cn('px-2.5 h-7 rounded-lg text-[11px] font-semibold ring-1 transition-colors',
                        active ? 'bg-indigo-600 text-white ring-indigo-700' : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800')}>
                      {lbl}
                    </button>
                  );
                })}
                <span className="text-[10px] text-slate-400">0 ga tenglar tashlanadi</span>
              </div>
              {/* Объект / Тип — checkboxli multi-select (mavjudlaridan) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Объект(lar) — tanlang (bo'sh = hammasi)">
                  <MultiSelectDropdown options={distinctObjects} selected={sheet.filter?.objects || []} onChange={(v) => setFilter({ objects: v })} disabled={!canManage} placeholder="Barcha obyektlar" />
                </Field>
                <Field label="Тип(lar) — tanlang (bo'sh = hammasi)">
                  <MultiSelectDropdown options={distinctTxTypes} selected={sheet.filter?.txTypes || []} onChange={(v) => setFilter({ txTypes: v })} disabled={!canManage} placeholder="Barcha tiplar" />
                </Field>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Оплата:</span>
                {CATEGORIES.map((c) => {
                  const active = (sheet.filter?.categories || []).includes(c.value);
                  return (
                    <button key={c.value} onClick={() => canManage && toggleCategory(c.value)} disabled={!canManage}
                      className={cn('px-2.5 h-7 rounded-lg text-[11px] font-semibold ring-1 transition-colors',
                        active ? 'bg-indigo-600 text-white ring-indigo-700' : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800')}>
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Ustun mapping */}
        <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <Columns3 className="h-3.5 w-3.5" /> Ustun mapping — qaysi ustunga qaysi maydon
          </div>
          <div className="space-y-1.5">
            {sheet.columns.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={c.col}
                  onChange={(e) => setColumn(i, { col: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })}
                  disabled={!canManage}
                  placeholder="A"
                  className="w-16 h-11 rounded-xl text-center font-mono font-bold text-[13px] bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/40 dark:to-violet-950/30 border border-indigo-200/70 dark:border-indigo-800/60 text-indigo-700 dark:text-indigo-300 outline-none shadow-sm transition-all focus:ring-[3px] focus:ring-indigo-500/25 focus:border-indigo-400 uppercase shrink-0"
                />
                <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600 shrink-0" />
                <ProSelect value={c.field} onChange={(v) => setColumn(i, { field: v })} disabled={!canManage} className="flex-1">
                  {fieldsForSource(sheet.source).map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </ProSelect>
                {canManage && (
                  <button
                    onClick={() => removeColumn(i)}
                    className="w-11 h-11 rounded-xl grid place-items-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 ring-1 ring-transparent hover:ring-rose-200 dark:hover:ring-rose-900 transition-all shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {canManage && (
            <button
              onClick={addColumn}
              className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700"
            >
              <Plus className="h-3.5 w-3.5" /> Ustun qo'shish
            </button>
          )}
          <div className="text-[10.5px] text-slate-400 dark:text-slate-500 pt-1">
            {sheet.writeMode === 'upsert'
              ? "Jadval TOZALANMAYDI — kalit bo'yicha mavjud yangilanadi, yangisi qo'shiladi. Export o'zi yozgani ichidan DB'dan o'chgani tozalanadi; siz QO'LDA qo'shgan qatorlarga tegilmaydi."
              : `Faqat shu ustunlar ${sheet.startRow}-qatordan pastgacha tozalanadi va qayta yoziladi (boshqa ustunlarga tegilmaydi).`}
          </div>
        </div>

        {/* Yozish rejimi */}
        <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <RefreshCw className="h-3.5 w-3.5" /> Yozish rejimi
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              ['replace', 'Tozalab qayta yozish', 'Ustunlar tozalanadi, hammasi qaytadan yoziladi'],
              ['upsert', 'Yangilash (tozalamasdan)', "Mavjudni yangilaydi, yangisini qo'shadi. Qo'lda qo'shilgan qatorlarga TEGMAYDI"],
            ] as const).map(([v, title, desc]) => {
              const active = (sheet.writeMode || 'replace') === v;
              return (
                <button key={v} onClick={() => canManage && onChange({ writeMode: v })} disabled={!canManage}
                  className={cn('text-left px-3 py-2 rounded-lg ring-1 transition-colors',
                    active ? 'bg-indigo-50 dark:bg-indigo-950/40 ring-indigo-300 dark:ring-indigo-800' : 'bg-slate-50 dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800')}>
                  <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-800 dark:text-slate-100">
                    <span className={cn('w-3.5 h-3.5 rounded-full border-2 grid place-items-center shrink-0', active ? 'border-indigo-600' : 'border-slate-300 dark:border-slate-600')}>
                      {active && <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />}
                    </span>
                    {title}
                  </div>
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5 pl-5">{desc}</div>
                </button>
              );
            })}
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            {sheet.writeMode === 'upsert' && (
              <Field label="Kalit maydon (noyob — mavjud qatorni topish uchun)">
                <ProSelect
                  value={sheet.keyField || sheet.columns.find((c) => c.field === 'id' || c.field === 'externalId')?.field || sheet.columns[0]?.field || ''}
                  onChange={(v) => onChange({ keyField: v })}
                  disabled={!canManage}
                  className="w-full max-w-xs"
                >
                  {sheet.columns.filter((c) => c.field).map((c) => (
                    <option key={c.col} value={c.field}>{c.col} → {FIELD_LABEL[c.field] || c.field}</option>
                  ))}
                </ProSelect>
              </Field>
            )}
            <button
              type="button" onClick={downloadKeys}
              title="Export oxirgi marta yozgan noyob ID'lar (ix_id, .txt) — API jamosiga berish uchun. Sana emas, HAR DOIM noyob row ID."
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[11.5px] font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-950/60 transition-colors"
            >
              <Download className="h-3.5 w-3.5" /> ix_id larni yuklab olish
            </button>
          </div>
          {sheet.writeMode === 'upsert' && (
            !sheet.columns.some((c) => c.field === 'id' || c.field === 'externalId') ? (
              <div className="text-[10.5px] text-amber-600 dark:text-amber-400">⚠ Mapping'da <b>ix_id</b> ustuni yo'q — upsert to'g'ri ishlashi uchun ix_id ustunini qo'shing va uni kalit qiling (Дата / Дог № noyob emas — chalkashadi).</div>
            ) : (
              <div className="text-[10px] text-slate-400">Kalit noyob bo'lsin — <b>ix_id</b> tavsiya etiladi.</div>
            )
          )}
        </div>

        {/* Bajarish + natija */}
        <div className="flex items-center gap-3 pt-1">
          <Button
            onClick={() => runMut.mutate()}
            disabled={disabledRun}
            className="h-11 px-5 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold"
          >
            {runMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
            {runMut.isPending ? 'Bajarilmoqda…' : 'Bajarish'}
          </Button>
          {!canRun && <span className="text-[11px] text-slate-400">Ishga tushirish uchun ruxsat yo'q</span>}
          {canRun && !credsAvailable && <span className="text-[11px] text-amber-600">Avval service-account'ni ulang</span>}
        </div>

        {runMut.isPending && <RunningIndicator />}
        {result && <ResultView result={result} />}
        </>)}
      </CardContent>
    </Card>
  );
}

// ─── Yozilayotgan payt animatsiya ─────────────────────────────────────
function RunningIndicator() {
  const phases = ['Ustunlar tozalanmoqda', 'ОплатыКв ma\'lumoti olinmoqda', 'Google Sheets\'ga yozilmoqda'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((p) => (p + 1) % phases.length), 900);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="rounded-xl ring-1 ring-emerald-200 dark:ring-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 px-4 py-3 flex items-center gap-3">
      <Loader2 className="h-4 w-4 animate-spin text-emerald-600 dark:text-emerald-400" />
      <div className="text-[12px] font-medium text-emerald-800 dark:text-emerald-300">{phases[i]}…</div>
      <div className="ml-auto flex gap-1">
        {phases.map((_, pi) => (
          <span key={pi} className={cn('w-1.5 h-1.5 rounded-full transition-colors', pi === i ? 'bg-emerald-500' : 'bg-emerald-200 dark:bg-emerald-800')} />
        ))}
      </div>
    </div>
  );
}

// ─── Natija (muvaffaqiyat yoki xato) ──────────────────────────────────
function ResultView({ result }: { result: RunResult }) {
  const [open, setOpen] = useState(true);
  if (!result.ok) {
    return (
      <div className="rounded-xl ring-1 ring-rose-200 dark:ring-rose-900 bg-rose-50/50 dark:bg-rose-950/30 overflow-hidden">
        <div className="px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-rose-800 dark:text-rose-300">Xatolik yuz berdi</div>
            {result.step && (
              <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">
                Bosqich: <b>{STEP_LABEL[result.step] || result.step}</b>
              </div>
            )}
            <div className="mt-2 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-rose-200 dark:ring-rose-900 px-3 py-2 text-[12px] font-mono text-rose-700 dark:text-rose-300 whitespace-pre-wrap break-words">
              {result.error || 'Nomaʼlum xato'}
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl ring-1 ring-emerald-200 dark:ring-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/30 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full px-4 py-3 flex items-center gap-2.5 text-left">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <div className="flex-1">
          <div className="text-[13px] font-bold text-emerald-800 dark:text-emerald-300">
            Tayyor — {result.rowsWritten} qator yozildi
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
            {result.writtenRange || 'Diapazon tozalandi (qator topilmadi)'} · {Math.round((result.durationMs || 0) / 100) / 10}s
          </div>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-emerald-600" /> : <ChevronRight className="h-4 w-4 text-emerald-600" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <MiniStat label="Olingan qator" value={String(result.rowsFetched ?? 0)} />
            <MiniStat label="Yozilgan qator" value={String(result.rowsWritten ?? 0)} />
            <MiniStat label="Boshlanish" value={`${result.startRow}-qator`} />
            <MiniStat label="Davomiylik" value={`${Math.round((result.durationMs || 0) / 100) / 10}s`} />
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
            <div><b>Diapazon:</b> {result.dateFrom || '(boshi yo\'q)'} → {result.dateTo}</div>
            {result.writtenRange && <div><b>Yozildi:</b> <span className="font-mono">{result.writtenRange}</span></div>}
            {result.columns && result.columns.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {result.columns.map((c) => (
                  <span key={c.col} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[10.5px]">
                    <b className="font-mono text-indigo-700 dark:text-indigo-300">{c.col}</b>
                    <ArrowRight className="h-2.5 w-2.5 text-slate-400" />
                    {FIELD_LABEL[c.field] || c.field}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Yordamchi UI ─────────────────────────────────────────────────────
// Premium input/select uslublari — barcha maydonlarda bir xil "pro" ko'rinish.
const PRO_INPUT = 'h-11 rounded-xl border border-slate-200/80 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/50 text-[12.5px] shadow-sm transition-all focus-visible:ring-[3px] focus-visible:ring-indigo-500/25 focus-visible:border-indigo-400 focus-visible:bg-white dark:focus-visible:bg-slate-900 focus-visible:ring-offset-0 hover:border-slate-300 dark:hover:border-slate-600 placeholder:text-slate-400';

function ProSelect({ value, onChange, disabled, children, className }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <select
        value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        className="w-full h-11 pl-3.5 pr-9 rounded-xl border border-slate-200/80 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/50 text-[12.5px] text-slate-700 dark:text-slate-200 shadow-sm appearance-none outline-none transition-all focus:ring-[3px] focus:ring-indigo-500/25 focus:border-indigo-400 focus:bg-white dark:focus:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-60 cursor-pointer"
      >
        {children}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
        {icon && <span className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-500 dark:text-indigo-400 grid place-items-center shrink-0">{icon}</span>}
        <span className="tracking-tight">{label}</span>
      </label>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2">
      <div className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">{label}</div>
      <div className="text-[15px] font-bold tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Autsoursing tab — shartnomalar Excel'ini Telegram guruhga
// ═══════════════════════════════════════════════════════════════════════
interface AutsConfig {
  ok: boolean; hasToken: boolean; tokenHint: string | null; groupId: string | null;
  columns: string[]; contracts: string[]; dateFrom: string | null;
  cronEnabled: boolean; cronTime: string;
}

function AutsourcingTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const cfgQuery = useQuery({
    queryKey: ['auts-config'],
    queryFn: () => api.get<AutsConfig>('/google-export/autsourcing/config'),
  });
  const cfg = cfgQuery.data;

  const [contracts, setContracts] = useState('');
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [groupId, setGroupId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [cronEnabled, setCronEnabled] = useState(false);
  const [cronTime, setCronTime] = useState('09:00');
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!cfg || initialized) return;
    setSelectedCols(cfg.columns?.length ? cfg.columns : ['contractNo', 'date', 'paymentAmount', 'client']);
    setGroupId(cfg.groupId || '');
    setContracts((cfg.contracts || []).join('\n'));
    setDateFrom(cfg.dateFrom || '');
    setCronEnabled(!!cfg.cronEnabled);
    setCronTime(cfg.cronTime || '09:00');
    setInitialized(true);
  }, [cfg, initialized]);

  const parseContracts = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const contractCount = parseContracts(contracts).length;
  const configured = !!(cfg?.hasToken && cfg?.groupId);

  const toggleCol = (key: string) =>
    setSelectedCols((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const saveCfg = useMutation({
    mutationFn: () => api.put('/google-export/autsourcing/config', {
      botToken: botToken.trim() || undefined,
      groupId: groupId.trim(),
      columns: selectedCols,
      contracts: parseContracts(contracts),
      dateFrom: dateFrom || null,
      cronEnabled,
      cronTime,
    }),
    onSuccess: () => { toast.success('Saqlandi'); setBotToken(''); qc.invalidateQueries({ queryKey: ['auts-config'] }); },
    onError: (e: any) => toast.error(e?.message || 'Saqlanmadi'),
  });

  const sendMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string; contracts?: number; rows?: number; notFound?: string[] }>(
      '/google-export/autsourcing/send',
      { contracts: parseContracts(contracts), columns: selectedCols, dateFrom: dateFrom || null },
      { timeout: 120_000 },
    ),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(`Guruhga jo'natildi: ${r.contracts} shartnoma · ${r.rows} qator`);
        if (r.notFound?.length) toast(`⚠️ ${r.notFound.length} ta shartnoma topilmadi`, { icon: '⚠️' });
      } else {
        toast.error(r.error || 'Jo\'natilmadi');
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });

  const sendDisabled = !configured || contractCount === 0 || selectedCols.length === 0 || sendMut.isPending;

  return (
    <div className="space-y-5">
      {/* Sozlama holati */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <div className={cn(
          'px-5 py-4 flex items-center gap-3 flex-wrap border-b bg-gradient-to-r',
          configured
            ? 'border-emerald-100 dark:border-emerald-950 from-emerald-500/[0.08] to-transparent'
            : 'border-amber-100 dark:border-amber-950 from-amber-500/[0.08] to-transparent',
        )}>
          <div className={cn('w-10 h-10 rounded-xl grid place-items-center shadow-md shrink-0',
            configured ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-amber-500 to-orange-600')}>
            <Send className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-slate-800 dark:text-slate-100">Telegram guruhga jo'natish</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
              {cfg?.groupId
                ? <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" /> Guruh: <b className="font-mono">{cfg.groupId}</b></span>
                : <span className="text-amber-600 dark:text-amber-400">Guruh ID sozlanmagan</span>}
              <span className="text-slate-300 dark:text-slate-600">·</span>
              {cfg?.hasToken
                ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Lock className="h-3 w-3" /> Bot token bor {cfg.tokenHint}</span>
                : <span className="text-amber-600 dark:text-amber-400">Bot token yo'q</span>}
            </div>
          </div>
          {canManage && (
            <Button onClick={() => setShowSettings((v) => !v)} variant="outline" className="h-9 gap-2 text-[12px] shrink-0">
              <KeyRound className="h-4 w-4" /> Sozlama
            </Button>
          )}
        </div>

        {showSettings && canManage && (
          <CardContent className="p-5 space-y-3 border-b border-slate-100 dark:border-slate-800">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Bot token {cfg?.hasToken && <span className="text-emerald-600">(o'rnatilgan — bo'sh qoldirsa o'zgarmaydi)</span>}</label>
                <Input value={botToken} onChange={(e) => setBotToken(e.target.value)} type="password"
                  placeholder="123456:ABC-..." className="h-9 rounded-lg font-mono text-[12px]" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Guruh ID</label>
                <Input value={groupId} onChange={(e) => setGroupId(e.target.value)}
                  placeholder="-1001234567890" className="h-9 rounded-lg font-mono text-[12px]" />
              </div>
            </div>
            {/* Cron — avtomatik jo'natish */}
            <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-3 space-y-2.5">
              <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                <button
                  type="button"
                  onClick={() => setCronEnabled((v) => !v)}
                  className={cn('relative w-11 h-6 rounded-full transition-colors shrink-0', cronEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600')}
                >
                  <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', cronEnabled && 'translate-x-5')} />
                </button>
                <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Avtomatik jo'natish (har kuni)</span>
              </label>
              {cronEnabled && (
                <div className="flex items-center gap-2 pl-1 flex-wrap">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Soat (Toshkent):</span>
                  <Input type="time" value={cronTime} onChange={(e) => setCronTime(e.target.value)} className="h-8 w-28 rounded-lg text-[12px]" />
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">har kuni saqlangan shartnoma + ustunlar bilan avtomatik</span>
                </div>
              )}
            </div>
            <div className="text-[10.5px] text-slate-400">🔒 Bot token AES-256 bilan shifrlanadi. O'zgarishlar pastdagi «Saqlash» bilan saqlanadi.</div>
          </CardContent>
        )}
      </Card>

      {/* Asosiy — shartnomalar + ustunlar + jo'natish */}
      <Card className="border-0 shadow-soft">
        <CardContent className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Shartnoma raqamlari
            </label>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Har birini yangi qatorga yoki vergul/probel bilan ajrating.</div>
            <textarea
              value={contracts}
              onChange={(e) => setContracts(e.target.value)}
              spellCheck={false}
              placeholder={'7331MSO26KK\n7332MSO26KK\n7333MSO26KK'}
              className="w-full h-40 rounded-lg text-[12px] font-mono bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 p-2.5 outline-none focus:ring-indigo-400 resize-y"
            />
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              <b className="text-slate-700 dark:text-slate-300 tabular-nums">{contractCount}</b> ta shartnoma
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Columns3 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Qaysi ustunlar Excel'ga
            </label>
            <div className="flex flex-wrap gap-2">
              {FIELDS.map((f) => {
                const active = selectedCols.includes(f.value);
                return (
                  <button
                    key={f.value}
                    onClick={() => toggleCol(f.value)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11.5px] font-semibold ring-1 transition-colors',
                      active
                        ? 'bg-indigo-600 text-white ring-indigo-700'
                        : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800',
                    )}
                  >
                    {active ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sana filtri — bundan → bugungacha */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Sana (bundan → bugungacha)
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-44 rounded-lg text-[12px]" />
              {dateFrom
                ? <span className="text-[11px] text-slate-500 dark:text-slate-400">{dateFrom} → bugun</span>
                : <span className="text-[11px] text-slate-400 dark:text-slate-500">bo'sh = barcha sanalar</span>}
              {dateFrom && (
                <button onClick={() => setDateFrom('')} className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline">tozalash</button>
              )}
            </div>
          </div>

          {/* Saqlash + Jo'natish */}
          <div className="flex items-center gap-3 pt-1 flex-wrap">
            {canManage && (
              <Button onClick={() => saveCfg.mutate()} disabled={saveCfg.isPending} variant="outline" className="h-11 px-5 gap-2 text-[13px] font-semibold">
                {saveCfg.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />} Saqlash
              </Button>
            )}
            <Button
              onClick={() => sendMut.mutate()}
              disabled={sendDisabled}
              className="h-11 px-5 gap-2 bg-gradient-to-br from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white text-[13px] font-semibold shadow-md shadow-indigo-500/25"
            >
              {sendMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              {sendMut.isPending ? 'Jo\'natilmoqda…' : 'Guruhga jo\'natish'}
            </Button>
            {!configured && <span className="text-[11px] text-amber-600 dark:text-amber-400">Avval sozlamani to'ldiring (🔑 bot token + guruh)</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function HelpSection({ clientEmail }: { clientEmail: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full px-5 py-4 flex items-center gap-2 hover:bg-slate-50/60 dark:hover:bg-slate-800 transition-colors text-left">
        <Info className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Qanday ishlaydi / sozlash</div>
        <span className="ml-auto text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
      </button>
      {open && (
        <CardContent className="px-5 pb-5 pt-0 text-[12px] text-slate-600 dark:text-slate-300 space-y-2">
          <div>1. Har bir Google jadvalni oching → <b>Share</b> → quyidagi emailni <b>Редактор (Editor)</b> qilib qo'shing:</div>
          {clientEmail && <div className="font-mono text-[11.5px] px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 inline-block">{clientEmail}</div>}
          <div>2. <b>Spreadsheet ID</b> — jadval havolasidagi <span className="font-mono">/d/&lt;ID&gt;/</span> qismi (to'liq havolani ham qo'yish mumkin).</div>
          <div>3. <b>Jadval nomi</b> — pastdagi list (tab) nomi (masalan «Ойлик»).</div>
          <div>4. <b>Ustun mapping</b> — har bir ustun harfiga (A, B, C…) ОплатыКв maydonini biriktiring.</div>
          <div>5. <b>Bajarish</b> — o'sha ustunlar {`{boshlanish}`}-qatordan pastgacha tozalanadi va sana bo'yicha ma'lumot yoziladi.</div>
          <div className="text-amber-700 dark:text-amber-400">⚠️ «Bajarish» joriy formadagi qiymatlar bilan ishlaydi. Doimiy saqlash uchun «Sozlamalarni saqlash» tugmasini bosing.</div>
        </CardContent>
      )}
    </Card>
  );
}

// ═══════════════ SHMITD tab — Shmidt bolg'a hisoboti Telegram guruhga ═══════════════
type ShmitdConfig = {
  ok: boolean; enabled: boolean; hasToken: boolean; tokenHint: string | null;
  groupId: string | null; spreadsheetId: string | null; sheetName: string;
  hasSa: boolean; saEmail: string | null; dateOffset: number; cronTimes: string[];
};
type ShmitdRow = {
  id: string; targetDate: string; sentAt: string; totalCount: number; yellowCount: number;
  redCount: number; status: string; error: string | null; fileName: string | null; triggeredBy: string | null;
};
const OFFSET_LABEL: Record<number, string> = { 0: 'Bugun', [-1]: 'Kecha', [-2]: '2 kun oldin', [-3]: '3 kun oldin', 1: 'Ertaga' };

function ShmitdTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ['shmitd-config'], queryFn: () => api.get<ShmitdConfig>('/shmitd/config') });

  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [groupId, setGroupId] = useState('');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetName, setSheetName] = useState('SHMITD');
  const [saJson, setSaJson] = useState('');
  const [dateOffset, setDateOffset] = useState(-1);
  const [times, setTimes] = useState<string[]>([]);
  useEffect(() => {
    if (!cfg) return;
    setEnabled(cfg.enabled); setGroupId(cfg.groupId || ''); setSpreadsheetId(cfg.spreadsheetId || '');
    setSheetName(cfg.sheetName || 'SHMITD'); setDateOffset(cfg.dateOffset ?? -1); setTimes(cfg.cronTimes || []);
  }, [cfg]);

  const [showConfig, setShowConfig] = useState(true);
  const [showHistory, setShowHistory] = useState(true);

  const saveMut = useMutation({
    mutationFn: (patch: any) => api.put('/shmitd/config', patch),
    onSuccess: () => { toast.success('Saqlandi'); setBotToken(''); setSaJson(''); qc.invalidateQueries({ queryKey: ['shmitd-config'] }); },
    onError: (e: any) => toast.error(e?.message || 'Xato'),
  });
  const save = () => saveMut.mutate({
    enabled, groupId: groupId.trim(), spreadsheetId: spreadsheetId.trim(), sheetName: sheetName.trim(),
    dateOffset, cronTimes: times, ...(botToken.trim() ? { botToken: botToken.trim() } : {}), ...(saJson.trim() ? { saJson: saJson.trim() } : {}),
  });

  const sendMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; status: string; total?: number; error?: string }>('/shmitd/send', {}),
    onSuccess: (r: any) => {
      if (r.status === 'sent') toast.success(`Jo'natildi — ${r.total} qator (sariq ${r.yellow ?? 0}, qizil ${r.red ?? 0})`);
      else if (r.status === 'empty') toast.info('Bu sanada ma\'lumot yo\'q — guruhga xabar berildi');
      else toast.error(r.error || 'Xato');
      qc.invalidateQueries({ queryKey: ['shmitd-history'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Jo\'natishda xato'),
  });

  // History
  const [hPage, setHPage] = useState(1);
  const [hFrom, setHFrom] = useState('');
  const [hTo, setHTo] = useState('');
  const { data: hist, isFetching } = useQuery({
    queryKey: ['shmitd-history', hPage, hFrom, hTo],
    queryFn: () => api.get<{ ok: boolean; total: number; rows: ShmitdRow[] }>(`/shmitd/history?page=${hPage}&perPage=15${hFrom ? `&from=${hFrom}` : ''}${hTo ? `&to=${hTo}` : ''}`),
  });
  const rows = hist?.rows || [];
  const totalPages = Math.max(1, Math.ceil((hist?.total || 0) / 15));

  const addTime = () => setTimes((t) => [...t, '09:00']);
  const setTime = (i: number, v: string) => setTimes((t) => t.map((x, idx) => (idx === i ? v : x)));
  const delTime = (i: number) => setTimes((t) => t.filter((_, idx) => idx !== i));

  const fmt = (s: string) => { try { return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return s; } };
  const statusBadge = (st: string) => {
    if (st === 'sent') return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" /> Yuborildi</span>;
    if (st === 'empty') return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">Bo&apos;sh</span>;
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300"><AlertTriangle className="h-3 w-3" /> Xato</span>;
  };

  return (
    <div className="space-y-4">
      {/* ─── Config ─── */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <button onClick={() => setShowConfig((v) => !v)} className="w-full px-5 py-4 flex items-center gap-3 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
          <div className="w-10 h-10 rounded-xl grid place-items-center shrink-0 bg-gradient-to-br from-amber-500 to-yellow-600 text-white shadow-md shadow-amber-500/25"><Hammer className="h-5 w-5" /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">SHMITD — Telegram guruhga jo&apos;natish</span>
              {cfg?.enabled
                ? <span className="px-1.5 py-0.5 rounded-md text-[9.5px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">YOQILGAN</span>
                : <span className="px-1.5 py-0.5 rounded-md text-[9.5px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">O&apos;CHIQ</span>}
            </div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Google Sheet (SHMITD) → sana bo&apos;yicha HTML hisobot → guruhga (jadval bo&apos;yicha avtomat)</div>
          </div>
          {showConfig ? <Eye className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </button>
        {showConfig && (
          <CardContent className="px-5 pb-5 pt-1 space-y-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setEnabled((v) => !v)} disabled={!canManage} className={cn('w-11 h-6 rounded-full transition-colors relative shrink-0 disabled:opacity-50', enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700')}>
                <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', enabled ? 'left-[22px]' : 'left-0.5')} />
              </button>
              <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">Avtomat jo&apos;natishni yoqish (jadval bo&apos;yicha)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Bot token {cfg?.hasToken && <span className="text-emerald-600 dark:text-emerald-400">— saqlangan ({cfg.tokenHint})</span>}</label>
                <Input value={botToken} onChange={(e) => setBotToken(e.target.value)} disabled={!canManage} placeholder={cfg?.hasToken ? 'O\'zgartirish uchun yangi token…' : '123456:ABC…'} className="mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Guruh chat ID</label>
                <Input value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!canManage} placeholder="-1001234567890" className="mt-1 font-mono text-[12px]" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Spreadsheet ID</label>
                <Input value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} disabled={!canManage} placeholder="1gU5BK8…" className="mt-1 font-mono text-[12px]" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Varaq (sheet) nomi</label>
                <Input value={sheetName} onChange={(e) => setSheetName(e.target.value)} disabled={!canManage} placeholder="SHMITD" className="mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Qaysi sana</label>
                <select value={dateOffset} onChange={(e) => setDateOffset(Number(e.target.value))} disabled={!canManage} className="mt-1 w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[13px] outline-none focus:ring-2 focus:ring-amber-400">
                  {[1, 0, -1, -2, -3].map((o) => <option key={o} value={o}>{OFFSET_LABEL[o] || `${o} kun`}</option>)}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Jo&apos;natish vaqtlari (Toshkent)</label>
                  {canManage && <button onClick={addTime} className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> qo&apos;shish</button>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {times.length === 0 && <span className="text-[12px] text-slate-400">Vaqt qo&apos;shilmagan</span>}
                  {times.map((t, i) => (
                    <div key={i} className="inline-flex items-center gap-1 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-50 dark:bg-slate-900 pl-1">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <input type="time" value={t} onChange={(e) => setTime(i, e.target.value)} disabled={!canManage} className="h-8 bg-transparent text-[12px] outline-none w-[72px]" />
                      {canManage && <button onClick={() => delTime(i)} className="w-6 h-8 grid place-items-center text-slate-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Service-account JSON {cfg?.hasSa ? <span className="text-emerald-600 dark:text-emerald-400">— ulangan ({cfg.saEmail})</span> : <span className="text-amber-600">— app SA ishlatiladi yoki bu yerga qo&apos;ying</span>}</label>
              <textarea value={saJson} onChange={(e) => setSaJson(e.target.value)} disabled={!canManage} placeholder={cfg?.hasSa ? 'O\'zgartirish uchun yangi JSON…' : '{ "client_email": …, "private_key": … }'} rows={2} className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[11.5px] font-mono outline-none focus:ring-2 focus:ring-amber-400 resize-y" />
            </div>

            <div className="flex items-center gap-2 pt-1">
              {canManage && (
                <Button onClick={save} disabled={saveMut.isPending} className="gap-2">
                  {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Saqlash
                </Button>
              )}
              <Button onClick={() => sendMut.mutate()} disabled={sendMut.isPending} className="gap-2 bg-gradient-to-br from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700 text-white">
                {sendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Hozir jo&apos;natish
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── History ─── */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <button onClick={() => setShowHistory((v) => !v)} className="w-full px-5 py-4 flex items-center gap-3 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
          <div className="w-10 h-10 rounded-xl grid place-items-center shrink-0 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><History className="h-5 w-5" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-800 dark:text-slate-100">Jo&apos;natish tarixi</div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{hist?.total ?? 0} ta yozuv — sana bo&apos;yicha qidiring, hisobotni oching</div>
          </div>
          {showHistory ? <Eye className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </button>
        {showHistory && (
          <CardContent className="px-5 pb-5 pt-1 space-y-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Sana:</span>
              <input type="date" value={hFrom} onChange={(e) => { setHFrom(e.target.value); setHPage(1); }} title="Boshlanish sanasi" className="h-9 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[12.5px] outline-none focus:ring-2 focus:ring-amber-400" />
              <span className="text-slate-400 text-[12px]">—</span>
              <input type="date" value={hTo} onChange={(e) => { setHTo(e.target.value); setHPage(1); }} title="Tugash sanasi" className="h-9 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[12.5px] outline-none focus:ring-2 focus:ring-amber-400" />
              {(hFrom || hTo) && (
                <button onClick={() => { setHFrom(''); setHTo(''); setHPage(1); }} title="Tozalash" className="h-9 px-2.5 rounded-lg text-[12px] text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center gap-1"><X className="h-3.5 w-3.5" /> tozalash</button>
              )}
              <button onClick={() => qc.invalidateQueries({ queryKey: ['shmitd-history'] })} title="Yangilash" className="h-9 w-9 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 ml-auto"><RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} /></button>
            </div>

            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-100 dark:ring-slate-800">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-semibold">Sana</th>
                    <th className="px-3 py-2 font-semibold">Jo&apos;natildi</th>
                    <th className="px-3 py-2 font-semibold text-center">Jami</th>
                    <th className="px-3 py-2 font-semibold text-center">Sariq</th>
                    <th className="px-3 py-2 font-semibold text-center">Qizil</th>
                    <th className="px-3 py-2 font-semibold">Holat</th>
                    <th className="px-3 py-2 font-semibold">Kim</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Yozuv yo&apos;q</td></tr>}
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-mono font-semibold text-slate-700 dark:text-slate-200">{r.targetDate}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400 tabular-nums">{fmt(r.sentAt)}</td>
                      <td className="px-3 py-2 text-center tabular-nums font-semibold">{r.totalCount}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-amber-600 dark:text-amber-400 font-semibold">{r.yellowCount}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-rose-600 dark:text-rose-400 font-semibold">{r.redCount}</td>
                      <td className="px-3 py-2">{statusBadge(r.status)}</td>
                      <td className="px-3 py-2 text-slate-400 dark:text-slate-500 text-[10.5px] truncate max-w-[120px]">{r.triggeredBy || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        {r.status === 'sent' && (
                          <button onClick={() => apiDownload(`/shmitd/history/${r.id}/html`, `${r.fileName || 'SHMITD'}.html`)} title="Hisobotni yuklab olish" className="inline-grid place-items-center w-7 h-7 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40"><Download className="h-4 w-4" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-slate-400">{hist?.total} ta · sahifa {hPage}/{totalPages}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setHPage((p) => Math.max(1, p - 1))} disabled={hPage <= 1} className="h-8 w-8 grid place-items-center rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
                  <button onClick={() => setHPage((p) => Math.min(totalPages, p + 1))} disabled={hPage >= totalPages} className="h-8 w-8 grid place-items-center rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
