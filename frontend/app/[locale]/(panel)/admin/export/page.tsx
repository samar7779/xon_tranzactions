'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Sheet as SheetIcon, Loader2, AlertTriangle, CheckCircle2, Info, Plus, Trash2,
  Play, Save, PlugZap, Copy, Check, ChevronDown, ChevronRight, ArrowRight,
  Columns3, CalendarDays, Filter as FilterIcon, Hash, Link2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

// ─── Turlar ──────────────────────────────────────────────────────────
interface SheetColumn { col: string; field: string; }
interface SheetTarget {
  id: string;
  name: string;
  spreadsheetId: string;
  tabName: string;
  startRow: number;
  dateFrom: string | null;
  filter: { objects?: string[]; categories?: string[]; txTypes?: string[] };
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
  { value: 'id',              label: 'ID (external)' },
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
const FIELD_LABEL: Record<string, string> = Object.fromEntries(FIELDS.map((f) => [f.value, f.label]));

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'MONTHLY', label: 'ежемесячный' },
  { value: 'FIRST',   label: '1 взнос' },
  { value: 'GENERAL', label: 'Общий' },
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
    spreadsheetId: '',
    tabName: '',
    startRow: 2,
    dateFrom: '',
    filter: { objects: [], categories: [], txTypes: [] },
    columns: [{ col: 'A', field: 'date' }, { col: 'B', field: 'contractNo' }],
  };
}

export default function AdminExportPage() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canManage = !!user?.permissions?.includes(PERMS.EXPORT_MANAGE);
  const canRun = !!user?.permissions?.includes(PERMS.EXPORT_RUN);

  const [sheets, setSheets] = useState<SheetTarget[]>([]);
  const [dirty, setDirty] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const cfgQuery = useQuery({
    queryKey: ['google-export-config'],
    queryFn: () => api.get<ConfigResp>('/google-export/config'),
  });

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
      {/* ─── Sarlavha ─── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 grid place-items-center shadow-md shadow-emerald-500/25">
          <SheetIcon className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-lg font-bold text-slate-800 dark:text-slate-100">ОплатыКв → Google Sheets</div>
          <div className="text-[12px] text-slate-500 dark:text-slate-400">Har bir jadval uchun alohida: ustunlarni tozalab, sana bo'yicha ma'lumotni yozadi</div>
        </div>
      </div>

      {/* ─── Credential / ulanish holati ─── */}
      <Card className="border-0 shadow-soft">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className={cn(
              'inline-flex items-center gap-2 px-3 h-9 rounded-xl text-[12px] font-semibold ring-1',
              creds?.available
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
            )}>
              {creds?.available
                ? <><CheckCircle2 className="h-4 w-4" /> Service-account ulandi</>
                : <><AlertTriangle className="h-4 w-4" /> Service-account topilmadi</>}
            </div>

            {creds?.clientEmail && (
              <button
                onClick={copyEmail}
                title="Nusxalash — bu emailni Google jadvalga Редактор qilib qo'shing"
                className="inline-flex items-center gap-2 px-3 h-9 rounded-xl bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-[12px] font-mono text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                {copiedEmail ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {creds.clientEmail}
              </button>
            )}

            <Button
              onClick={() => testMut.mutate()}
              disabled={testMut.isPending || !creds?.available}
              variant="outline"
              className="h-9 gap-2 ml-auto text-[12px]"
            >
              {testMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
              Ulanishni tekshirish
            </Button>
          </div>

          {/* Kalit manbasi + o'zgartirish/o'chirish */}
          {creds?.available && (
            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
              <span>Kalit manbasi: <b className="text-slate-700 dark:text-slate-300">{creds.source === 'db' ? 'App\'da saqlangan (shifrlangan 🔒)' : 'Server env'}</b></span>
              {canManage && (
                <button onClick={() => setShowCredBox((v) => !v)} className="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold">
                  {showCredBox ? 'yopish' : 'o\'zgartirish'}
                </button>
              )}
              {canManage && creds.source === 'db' && (
                <button onClick={() => clearCredMut.mutate()} disabled={clearCredMut.isPending} className="text-rose-600 dark:text-rose-400 hover:underline font-semibold">
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Bitta sheet kartochkasi
// ═══════════════════════════════════════════════════════════════════════
function SheetCard({
  sheet, index, canManage, canRun, credsAvailable, onChange, onRemove,
}: {
  sheet: SheetTarget;
  index: number;
  canManage: boolean;
  canRun: boolean;
  credsAvailable: boolean;
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

  // Filter helperlar (comma-separated matn ↔ massiv)
  const objectsText = (sheet.filter?.objects || []).join(', ');
  const txTypesText = (sheet.filter?.txTypes || []).join(', ');
  const setFilter = (patch: Partial<SheetTarget['filter']>) =>
    onChange({ filter: { ...sheet.filter, ...patch } });
  const toArr = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

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
              className="h-9 rounded-lg font-mono text-[12px]"
            />
          </Field>
          <Field label="Jadval (list) nomi" icon={<SheetIcon className="h-3.5 w-3.5" />}>
            <Input
              value={sheet.tabName}
              onChange={(e) => onChange({ tabName: e.target.value })}
              disabled={!canManage}
              placeholder="Ойлик"
              className="h-9 rounded-lg text-[12px]"
            />
          </Field>
          <Field label="Boshlanish qatori" icon={<Hash className="h-3.5 w-3.5" />}>
            <Input
              type="number" min={1}
              value={sheet.startRow}
              onChange={(e) => onChange({ startRow: Number(e.target.value) || 1 })}
              disabled={!canManage}
              className="h-9 rounded-lg text-[12px] w-32"
            />
          </Field>
          <Field label="Sana (bundan → bugungacha)" icon={<CalendarDays className="h-3.5 w-3.5" />}>
            <Input
              type="date"
              value={sheet.dateFrom || ''}
              onChange={(e) => onChange({ dateFrom: e.target.value })}
              disabled={!canManage}
              className="h-9 rounded-lg text-[12px]"
            />
          </Field>
        </div>

        {/* Filtr */}
        <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 p-3 space-y-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <FilterIcon className="h-3.5 w-3.5" /> Filtr (ixtiyoriy — bo'sh = hammasi)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Объект(lar) — vergul bilan">
              <Input
                value={objectsText}
                onChange={(e) => setFilter({ objects: toArr(e.target.value) })}
                disabled={!canManage}
                placeholder="masalan: Xon Saroy, Yangi Bino"
                className="h-9 rounded-lg text-[12px]"
              />
            </Field>
            <Field label="Тип(lar) — vergul bilan">
              <Input
                value={txTypesText}
                onChange={(e) => setFilter({ txTypes: toArr(e.target.value) })}
                disabled={!canManage}
                placeholder="masalan: Взносы за квартиры"
                className="h-9 rounded-lg text-[12px]"
              />
            </Field>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Оплата:</span>
            {CATEGORIES.map((c) => {
              const active = (sheet.filter?.categories || []).includes(c.value);
              return (
                <button
                  key={c.value}
                  onClick={() => canManage && toggleCategory(c.value)}
                  disabled={!canManage}
                  className={cn(
                    'px-2.5 h-7 rounded-lg text-[11px] font-semibold ring-1 transition-colors',
                    active
                      ? 'bg-indigo-600 text-white ring-indigo-700'
                      : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800',
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
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
                  className="w-14 h-8 rounded-lg text-center font-mono font-bold text-[12px] bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-indigo-700 dark:text-indigo-300 outline-none focus:ring-indigo-400 uppercase"
                />
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <select
                  value={c.field}
                  onChange={(e) => setColumn(i, { field: e.target.value })}
                  disabled={!canManage}
                  className="flex-1 h-8 rounded-lg text-[12px] bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 outline-none focus:ring-indigo-400 px-2"
                >
                  {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                {canManage && (
                  <button
                    onClick={() => removeColumn(i)}
                    className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
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
            Faqat shu ustunlar {sheet.startRow}-qatordan pastgacha tozalanadi va qayta yoziladi (boshqa ustunlarga tegilmaydi).
          </div>
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
function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
        {icon}{label}
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
