'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Wifi, Send, Loader2, Eye, EyeOff, Copy, Check, ChevronRight,
  CheckCircle2, XCircle, Database, Sparkles, AlertCircle, ArrowDown,
  Building2, KeyRound, Calendar, Search, FileText, Zap, X, ArrowDownLeft, ArrowUpRight,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// Tranzaksiya field labellari (foydalanuvchiga ko'rsatish uchun)
const FIELD_LABELS: Record<string, { label: string; group: string; desc?: string }> = {
  time:       { label: 'Operatsiya vaqti',     group: 'Vaqt' },
  ddate:      { label: 'Hujjat sanasi',         group: 'Vaqt' },
  vdate:      { label: 'Value date',            group: 'Vaqt', desc: 'Mablag\' mavjud bo\'lish sanasi' },
  stime:      { label: 'Settlement vaqti',      group: 'Vaqt' },
  input_date: { label: 'Kiritilgan sana',       group: 'Vaqt' },
  input_time: { label: 'Kiritilgan vaqti',      group: 'Vaqt' },

  dir:        { label: "Yo'nalish",             group: 'Asosiy', desc: '1=chiqim, 2=kirim' },
  state:      { label: 'Holat',                 group: 'Asosiy' },
  amount:     { label: 'Summa (tiyin)',         group: 'Asosiy' },
  dtype:      { label: 'Hujjat turi',           group: 'Asosiy' },

  mfo_dt:     { label: 'Yuboruvchi MFO',        group: 'Yuboruvchi' },
  acc_dt:     { label: 'Yuboruvchi hisob',      group: 'Yuboruvchi' },
  name_dt:    { label: 'Yuboruvchi nomi',       group: 'Yuboruvchi' },
  inn_dt:     { label: 'Yuboruvchi STIR',       group: 'Yuboruvchi' },

  mfo_ct:     { label: 'Qabul qiluvchi MFO',    group: 'Qabul qiluvchi' },
  acc_ct:     { label: 'Qabul qiluvchi hisob',  group: 'Qabul qiluvchi' },
  name_ct:    { label: 'Qabul qiluvchi nomi',   group: 'Qabul qiluvchi' },
  inn_ct:     { label: 'Qabul qiluvchi STIR',   group: 'Qabul qiluvchi' },

  purpose:    { label: "To'lov maqsadi",        group: 'Tafsilot' },
  purp_code:  { label: 'Maqsad kodi',           group: 'Tafsilot' },
  num:        { label: 'Hujjat raqami',         group: 'Tafsilot' },
  client_id:  { label: 'Klient ID',             group: 'Tafsilot' },
  branch:     { label: 'Filial MFO',            group: 'Tafsilot' },

  general_id: { label: 'Global ID (NCI)',       group: 'Identifikator' },
  b2_id:      { label: 'B2 ID',                 group: 'Identifikator', desc: 'Bank ichida noyob' },
  uniq:       { label: 'Unique ID',             group: 'Identifikator' },

  err:        { label: 'Xato kodi',             group: 'Xato' },
  err_msg:    { label: 'Xato matni',            group: 'Xato' },
  anor:       { label: 'Anor 24/7',             group: 'Xato', desc: '1 = Anor xizmati orqali' },
};

const FIELDS_SAVED = new Set([
  'b2_id', 'general_id', 'ddate', 'dir', 'state', 'amount',
  'mfo_dt', 'acc_dt', 'name_dt', 'inn_dt',
  'mfo_ct', 'acc_ct', 'name_ct', 'inn_ct',
  'purpose', 'purp_code', 'num', 'dtype', 'uniq',
]);

type Step = 'login' | 'transactions' | 'account';

export default function ApiExplorerPage() {
  const [step, setStep] = useState<Step>('login');
  const [showPwd, setShowPwd] = useState(false);
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const [form, setForm] = useState({
    baseUrl: 'https://m.bank24.uz:2713/Mobile.svc',
    bankPreset: 'kapitalbank',
    login: '',
    loginPrefix: 'IB#',
    password: '',
    smsCode: '',
    branch: '',
    account: '',
    dateFrom: todayISO,
    dateTo: todayISO,
  });

  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });

  const fullLogin = form.loginPrefix + form.login;
  // MFO 5 xonalik bo'lishi kerak — leading zero qo'shamiz (974 → 00974)
  const branchPadded = form.branch.padStart(5, '0');

  const loginMut = useMutation({
    mutationFn: () => api.post<any>('/api-explorer/kapitalbank/login', {
      baseUrl: form.baseUrl,
      login: fullLogin,
      password: form.password,
      smsCode: form.smsCode || undefined,
    }),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(`✓ Ulanish muvaffaqiyatli (${r.summary?.totalAccounts} hisob)`);
        // Auto-fill first account/branch if found
        if (r.result?.clients?.[0]?.accounts?.[0]) {
          const a = r.result.clients[0].accounts[0];
          setForm((s) => ({ ...s, branch: a.branch, account: a.account }));
        }
      } else toast.error(r.error || 'Xato');
    },
    onError: (e: any) => toast.error(e?.message),
  });

  // ISO sanani dd.MM.yyyy ga aylantirib uzatamiz
  const isoToBank = (iso: string) => {
    if (!iso) return undefined;
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  };

  const txnsMut = useMutation({
    mutationFn: () => api.post<any>('/api-explorer/kapitalbank/transactions', {
      baseUrl: form.baseUrl,
      login: fullLogin,
      password: form.password,
      branch: branchPadded,
      account: form.account,
      dateFrom: isoToBank(form.dateFrom),
      dateTo: isoToBank(form.dateTo),
    }),
    onSuccess: (r) => {
      if (r.ok) toast.success(`✓ ${r.summary?.itemsCount} ta tranzaksiya olindi`);
      else toast.error(r.error || 'Xato');
    },
    onError: (e: any) => toast.error(e?.message),
  });

  const accMut = useMutation({
    mutationFn: () => api.post<any>('/api-explorer/kapitalbank/account', {
      baseUrl: form.baseUrl,
      login: fullLogin,
      password: form.password,
      branch: branchPadded,
      account: form.account,
    }),
    onSuccess: (r) => {
      if (r.ok) toast.success('✓ Hisob ma\'lumotlari olindi');
      else toast.error(r.error || 'Xato');
    },
    onError: (e: any) => toast.error(e?.message),
  });

  function selectBank(code: string) {
    const b = banks?.items.find((x: any) => x.code === code);
    if (b) {
      setForm({ ...form, baseUrl: b.apiBaseUrl || '', bankPreset: code });
    }
  }

  return (
    <>
      <Topbar
        title="API Explorer"
        subtitle="Bank API'dan keladigan barcha ma'lumotlarni tekshirish"
        actions={
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/20 ring-1 ring-amber-200/40 text-[11px] font-semibold text-white backdrop-blur-sm">
            <Zap className="h-3 w-3" /> DEV / DEBUG
          </span>
        }
      />

      <div className="flex-1 p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto w-full">

        {/* ═══ STEPS PROGRESS ═══ */}
        <div className="flex items-center gap-2">
          <StepChip num={1} label="Bank ulanishi" active={step === 'login'} done={loginMut.data?.ok} onClick={() => setStep('login')} />
          <ChevronRight className="h-4 w-4 text-slate-300" />
          <StepChip num={2} label="Tranzaksiyalar" active={step === 'transactions'} done={txnsMut.data?.ok} onClick={() => setStep('transactions')} disabled={!loginMut.data?.ok} />
          <ChevronRight className="h-4 w-4 text-slate-300" />
          <StepChip num={3} label="Hisob saldo" active={step === 'account'} done={accMut.data?.ok} onClick={() => setStep('account')} disabled={!loginMut.data?.ok} />
        </div>

        {/* ═══ FORM ═══ */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <CardContent className="p-6 space-y-4">
            {/* Bank presets */}
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Bank tanlash</Label>
              <div className="flex flex-wrap gap-2">
                {(banks?.items || []).map((b: any) => (
                  <button
                    key={b.id}
                    onClick={() => selectBank(b.code)}
                    className={cn(
                      "inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all",
                      form.bankPreset === b.code
                        ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                        : "bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100",
                    )}
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    {b.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Form fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">API Endpoint</Label>
                <Input
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  className="font-mono text-sm h-10 rounded-xl"
                  placeholder="https://..."
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Login prefix</Label>
                <Input
                  value={form.loginPrefix}
                  onChange={(e) => setForm({ ...form, loginPrefix: e.target.value })}
                  className="font-mono text-sm h-10 rounded-xl"
                  placeholder="IB#"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Login nomi</Label>
                <Input
                  value={form.login}
                  onChange={(e) => setForm({ ...form, login: e.target.value })}
                  className="font-mono text-sm h-10 rounded-xl"
                  placeholder="username"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Parol</Label>
                <div className="relative">
                  <Input
                    type={showPwd ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="font-mono text-sm h-10 rounded-xl pr-10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {step !== 'login' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 flex items-center justify-between">
                      <span>Branch (MFO)</span>
                      {form.branch && form.branch !== branchPadded && (
                        <span className="text-[10px] text-amber-700 font-medium normal-case tracking-normal">→ {branchPadded} (5 xonalik)</span>
                      )}
                    </Label>
                    <Input
                      value={form.branch}
                      onChange={(e) => setForm({ ...form, branch: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                      className="font-mono text-sm h-10 rounded-xl"
                      placeholder="00974"
                      maxLength={5}
                    />
                    <div className="text-[10px] text-slate-500">5 xonalik MFO kod (74 / 974 → 00074 / 00974)</div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Hisob raqami</Label>
                    <Input
                      value={form.account}
                      onChange={(e) => setForm({ ...form, account: e.target.value.replace(/\D/g, '').slice(0, 20) })}
                      className="font-mono text-sm h-10 rounded-xl"
                      placeholder="20208000..."
                      maxLength={20}
                    />
                    <div className="text-[10px] text-slate-500">20 xonalik hisob raqami</div>
                  </div>
                </>
              )}

              {step === 'transactions' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Boshlanish sanasi</Label>
                    <Input
                      type="date"
                      value={form.dateFrom}
                      onChange={(e) => setForm({ ...form, dateFrom: e.target.value })}
                      className="text-sm h-10 rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Tugash sanasi</Label>
                    <Input
                      type="date"
                      value={form.dateTo}
                      onChange={(e) => setForm({ ...form, dateTo: e.target.value })}
                      className="text-sm h-10 rounded-xl"
                    />
                    <div className="text-[10px] text-slate-500">Maksimal 31 kun oralig'i</div>
                  </div>
                </>
              )}
            </div>

            {/* Run button */}
            <div className="flex items-center gap-3 pt-2">
              {step === 'login' && (
                <Button
                  onClick={() => loginMut.mutate()}
                  disabled={loginMut.isPending || !form.login || !form.password}
                  className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                >
                  {loginMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wifi className="h-4 w-4 mr-2" />}
                  APILogin tekshirish
                </Button>
              )}
              {step === 'transactions' && (
                <Button
                  onClick={() => txnsMut.mutate()}
                  disabled={txnsMut.isPending || !form.branch || !form.account}
                  className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                >
                  {txnsMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                  GetDoc1C — Tranzaksiyalarni olish
                </Button>
              )}
              {step === 'account' && (
                <Button
                  onClick={() => accMut.mutate()}
                  disabled={accMut.isPending || !form.branch || !form.account}
                  className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                >
                  {accMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
                  GetAcc1C — Hisob saldo
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ═══ RESULTS ═══ */}
        {step === 'login' && loginMut.data && <LoginResult data={loginMut.data} onPickAccount={(branch, account) => { setForm({ ...form, branch, account }); setStep('transactions'); }} />}
        {step === 'transactions' && txnsMut.data && <TransactionsResult data={txnsMut.data} />}
        {step === 'account' && accMut.data && <AccountResult data={accMut.data} />}
      </div>
    </>
  );
}

// ────────────── Components ──────────────

function StepChip({
  num, label, active, done, disabled, onClick,
}: {
  num: number;
  label: string;
  active?: boolean;
  done?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
        active && "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
        !active && done && "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        !active && !done && !disabled && "bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100",
        disabled && "bg-slate-50 text-slate-400 ring-1 ring-slate-100 cursor-not-allowed",
      )}
    >
      <span className={cn(
        "w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold",
        active && "bg-indigo-600 text-white",
        !active && done && "bg-emerald-500 text-white",
        !active && !done && "bg-slate-200 text-slate-700",
      )}>{done ? <Check className="h-3 w-3" /> : num}</span>
      {label}
    </button>
  );
}

function LoginResult({ data, onPickAccount }: { data: any; onPickAccount: (branch: string, account: string) => void }) {
  if (!data.ok) return <ErrorCard error={data.error} duration={data.durationMs} />;

  const { summary, result } = data;
  return (
    <>
      <SuccessCard
        title="APILogin muvaffaqiyatli"
        duration={data.durationMs}
        summary={[
          { label: 'Klient', value: summary?.name || '—' },
          { label: 'STIR', value: summary?.inn || '—', mono: true },
          { label: 'Hisoblar', value: String(summary?.totalAccounts || 0) },
          { label: 'Session ID', value: summary?.sid?.slice(0, 12) + '...' || '—', mono: true },
        ]}
      />

      {/* Accounts list */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <CardContent className="p-0">
          <div className="px-6 py-4 border-b border-slate-100">
            <div className="text-base font-semibold tracking-tight">Mavjud hisoblar</div>
            <div className="text-xs text-slate-500 mt-0.5">Tranzaksiyalarini olish uchun birini tanlang</div>
          </div>
          <div className="divide-y divide-slate-100">
            {(result?.clients || []).flatMap((c: any) =>
              (c.accounts || []).map((a: any) => ({ ...a, clientName: c.name, clientInn: c.inn }))
            ).map((a: any, i: number) => (
              <button
                key={i}
                onClick={() => onPickAccount(a.branch, a.account)}
                className="w-full px-6 py-3.5 flex items-center gap-4 hover:bg-slate-50/60 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 grid place-items-center text-white shrink-0">
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[12px] font-semibold">{a.account}</div>
                  <div className="text-[11px] text-slate-500">MFO {a.branch} · {a.name || a.clientName}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Raw JSON */}
      <JsonViewer title="To'liq raw javob" json={result} />
    </>
  );
}

function TransactionsResult({ data }: { data: any }) {
  if (!data.ok) return <ErrorCard error={data.error} duration={data.durationMs} />;

  const { summary, result, perDay = [], days = 1 } = data;
  const items: any[] = result?.content || [];
  const fmt = (n: number) => new Intl.NumberFormat('uz-UZ').format((n || 0) / 100);

  const [selectedDate, setSelectedDate] = useState<string | null>(perDay.length === 1 ? perDay[0]?.date : null);
  const [selectedTxn, setSelectedTxn] = useState<any>(null);

  // Sana bo'yicha guruhlash
  const itemsByDate = new Map<string, any[]>();
  for (const it of items) {
    const d = it.ddate || '—';
    if (!itemsByDate.has(d)) itemsByDate.set(d, []);
    itemsByDate.get(d)!.push(it);
  }
  const itemsForSelected = selectedDate ? (itemsByDate.get(selectedDate) || []) : [];

  return (
    <>
      <SuccessCard
        title={`${summary?.itemsCount || 0} ta tranzaksiya · ${data.dateFrom} → ${data.dateTo} (${days} kun)`}
        duration={data.durationMs}
        summary={[
          { label: 'Kunlar soni', value: String(days) },
          { label: 'Operatsiyalar', value: String(summary?.itemsCount || 0) },
          { label: 'Jami kirim', value: fmt(summary?.totalCredit) + ' UZS', accent: 'emerald' },
          { label: 'Jami chiqim', value: fmt(summary?.totalDebit) + ' UZS', accent: 'rose' },
        ]}
      />

      {/* Step 1: Per-day list (clickable) */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <CardContent className="p-0">
          <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between">
            <div className="text-[12px] font-bold text-slate-900">Kunma-kun taqsimot</div>
            <div className="text-[10px] text-slate-500">Sanani bosing → o'sha kun tranzaksiyalari ko'rinadi</div>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200">
                <th className="text-left px-3 py-2">Sana</th>
                <th className="text-right px-3 py-2">Operatsiyalar</th>
                <th className="text-right px-3 py-2">Kirim (UZS)</th>
                <th className="text-right px-3 py-2">Chiqim (UZS)</th>
                <th className="text-left px-3 py-2">Holat</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {perDay.map((d: any) => {
                const isSelected = selectedDate === d.date;
                const hasItems = d.count > 0;
                return (
                  <tr
                    key={d.date}
                    onClick={() => hasItems && setSelectedDate(isSelected ? null : d.date)}
                    className={cn(
                      "transition-colors",
                      hasItems && "cursor-pointer",
                      isSelected ? "bg-indigo-50/50" : "hover:bg-slate-50",
                      d.error && "bg-rose-50/30",
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-slate-900 font-semibold">{d.date}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{d.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(d.credit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-700">{fmt(d.debit)}</td>
                    <td className="px-3 py-2">
                      {d.error ? (
                        <span className="text-[10px] text-rose-700 truncate max-w-[200px] inline-block" title={d.error}>{d.error}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
                          OK
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {hasItems && (
                        <ChevronRight className={cn(
                          "h-3.5 w-3.5 text-slate-400 transition-transform",
                          isSelected && "rotate-90 text-indigo-600",
                        )} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Step 2: Transactions of selected day */}
      {selectedDate && itemsForSelected.length > 0 && (
        <Card className="border-0 shadow-soft overflow-hidden">
          <CardContent className="p-0">
            <div className="px-4 py-2.5 border-b border-slate-200 bg-indigo-50/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-indigo-700" />
                <div className="text-[12px] font-bold text-slate-900">{selectedDate} — {itemsForSelected.length} ta tranzaksiya</div>
              </div>
              <div className="text-[10px] text-slate-500">Tranzaksiyani bosing → barcha 29 ta field modal'da ochiladi</div>
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200">
                  <th className="text-left px-3 py-2 w-20">Vaqt</th>
                  <th className="text-left px-3 py-2 w-20">Yo'nalish</th>
                  <th className="text-left px-3 py-2">Kontragent</th>
                  <th className="text-left px-3 py-2">Maqsad</th>
                  <th className="text-right px-3 py-2 w-32">Summa (UZS)</th>
                  <th className="text-left px-3 py-2 w-16">Hujjat</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itemsForSelected.map((it: any, i: number) => {
                  const counterparty = it.dir === 2 ? it.name_dt : it.name_ct;
                  const cpInn = it.dir === 2 ? it.inn_dt : it.inn_ct;
                  return (
                    <tr
                      key={i}
                      onClick={() => setSelectedTxn(it)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2 font-mono text-slate-700">{it.time || it.stime || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border",
                          it.dir === 2 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200",
                        )}>
                          {it.dir === 2 ? 'KIRIM' : 'CHIQIM'}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-[280px]">
                        <div className="truncate font-medium text-slate-900">{counterparty || '—'}</div>
                        <div className="font-mono text-[10px] text-slate-500 truncate">{cpInn || ''}</div>
                      </td>
                      <td className="px-3 py-2 max-w-[200px] truncate text-slate-600">{(it.purpose || '').trim() || '—'}</td>
                      <td className={cn(
                        "px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap",
                        it.dir === 2 ? "text-emerald-700" : "text-rose-700",
                      )}>
                        {it.dir === 2 ? '+' : '−'}{fmt(it.amount)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-slate-600">{it.num || '—'}</td>
                      <td className="px-3 py-2"><ChevronRight className="h-3.5 w-3.5 text-slate-400" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Modal with all fields */}
      <TransactionDetailModal txn={selectedTxn} onClose={() => setSelectedTxn(null)} />

      {/* Field saved/not-saved analysis */}
      {summary?.fieldsInFirstItem?.length > 0 && (
        <Card className="border-0 shadow-soft overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <div className="text-base font-semibold tracking-tight">Tranzaksiya field tahlili</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-semibold mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Saqlanyapti ({summary.fieldsSaved.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {summary.fieldsSaved.filter((f: string) => summary.fieldsInFirstItem.includes(f)).map((f: string) => (
                    <span key={f} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">{f}</span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wider text-rose-700 font-semibold mb-2 flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Saqlanmaydi ({summary.fieldsNotSaved.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {summary.fieldsNotSaved.map((f: string) => (
                    <span key={f} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 ring-1 ring-rose-200">{f}</span>
                  ))}
                </div>
                {summary.fieldsNotSaved.length > 0 && (
                  <div className="text-[10px] text-slate-500 mt-2">
                    Bu fieldlar bizning DB'da saqlanmaydi. Agar kerak bo'lsa schema'ga qo'shamiz.
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Raw JSON (collapsed by default) */}
      <details className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <summary className="px-4 py-2.5 cursor-pointer text-[12px] font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
          <FileText className="h-3.5 w-3.5" /> To'liq raw JSON ko'rsatish ({(JSON.stringify(result).length / 1024).toFixed(1)} KB)
        </summary>
        <JsonViewer title="" json={result} />
      </details>
    </>
  );
}

// Tranzaksiya tafsiloti modal — barcha 29 ta field guruh bo'yicha
function TransactionDetailModal({ txn, onClose }: { txn: any; onClose: () => void }) {
  if (!txn) return null;
  const fmt = (n: number) => new Intl.NumberFormat('uz-UZ').format((n || 0) / 100);

  // Field'larni group'lar bo'yicha guruhlash
  const groups: Record<string, { key: string; label: string; value: any; desc?: string; saved: boolean }[]> = {};
  for (const [key, val] of Object.entries(txn)) {
    const meta = FIELD_LABELS[key] || { label: key, group: 'Boshqa' };
    if (!groups[meta.group]) groups[meta.group] = [];
    groups[meta.group].push({ key, label: meta.label, value: val, desc: meta.desc, saved: FIELDS_SAVED.has(key) });
  }
  const orderedGroups = ['Asosiy', 'Vaqt', 'Yuboruvchi', 'Qabul qiluvchi', 'Tafsilot', 'Identifikator', 'Xato', 'Boshqa'];

  return (
    <Dialog open={!!txn} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className={cn(
          "relative px-6 py-5 text-white",
          txn.dir === 2 ? "bg-gradient-to-br from-emerald-600 to-teal-700" : "bg-gradient-to-br from-rose-600 to-red-700",
        )}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-[11px] font-bold">
                  {txn.dir === 2 ? <><ArrowDownLeft className="h-3 w-3" /> KIRIM</> : <><ArrowUpRight className="h-3 w-3" /> CHIQIM</>}
                </span>
                <span className="text-[11px] text-white/85">{txn.ddate} · {txn.time || txn.stime}</span>
              </div>
              <div className="text-3xl font-bold tabular-nums tracking-tight">
                {txn.dir === 2 ? '+' : '−'}{fmt(txn.amount)} <span className="text-base text-white/70 font-medium">UZS</span>
              </div>
              <div className="text-sm text-white/85 mt-1 truncate">
                {txn.dir === 2 ? txn.name_dt : txn.name_ct}
              </div>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white shrink-0">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto px-6 py-5 space-y-4">
          {orderedGroups.filter((g) => groups[g]?.length).map((g) => (
            <div key={g}>
              <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 mb-2">{g}</div>
              <div className="rounded-xl bg-slate-50/60 ring-1 ring-slate-100 px-4 py-2 divide-y divide-slate-100">
                {groups[g].map((f) => (
                  <div key={f.key} className="py-2 grid grid-cols-12 gap-3 items-start">
                    <div className="col-span-4 min-w-0">
                      <div className="text-[12px] text-slate-700 font-medium truncate">{f.label}</div>
                      <div className="font-mono text-[10px] text-slate-400 truncate">{f.key}</div>
                      {f.desc && <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{f.desc}</div>}
                    </div>
                    <div className="col-span-7 min-w-0">
                      <div className="font-mono text-[12px] text-slate-900 break-words">
                        {f.value === null || f.value === undefined || f.value === ''
                          ? <span className="text-slate-400 italic font-sans">bo'sh</span>
                          : typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value)}
                      </div>
                      {f.key === 'amount' && Number(f.value) > 0 && (
                        <div className="text-[10px] text-slate-500 mt-0.5">≈ {fmt(Number(f.value))} UZS</div>
                      )}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      {f.saved ? (
                        <span title="DB'da saqlanyapti" className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700">
                          <Check className="h-3 w-3" />
                        </span>
                      ) : (
                        <span title="DB'da column yo'q (faqat metadata JSON'da)" className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700">
                          <AlertCircle className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Legend */}
          <div className="flex items-center gap-3 text-[10px] text-slate-500 pt-2 border-t border-slate-100">
            <span className="inline-flex items-center gap-1">
              <Check className="h-3 w-3 text-emerald-600" /> DB column'da saqlanadi
            </span>
            <span className="inline-flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-amber-600" /> Faqat metadata JSON'da
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AccountResult({ data }: { data: any }) {
  if (!data.ok) return <ErrorCard error={data.error} duration={data.durationMs} />;
  const accounts = data.result || [];
  return (
    <>
      <SuccessCard
        title="GetAcc1C muvaffaqiyatli"
        duration={data.durationMs}
        summary={[
          { label: 'Topilgan hisoblar', value: String(accounts.length) },
          { label: 'Field soni', value: String(data.summary?.fieldsInFirst?.length || 0) },
        ]}
      />
      <JsonViewer title="To'liq raw javob (GetAcc1C)" json={data.result} />
    </>
  );
}

function SuccessCard({
  title, duration, summary,
}: {
  title: string;
  duration: number;
  summary: { label: string; value: string; mono?: boolean; accent?: 'emerald' | 'rose' }[];
}) {
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-emerald-500 to-teal-600" />
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-bold tracking-tight">{title}</div>
              <div className="text-xs text-slate-500">{duration} ms da bajarildi</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summary.map((s, i) => (
            <div key={i} className="rounded-xl bg-slate-50/60 ring-1 ring-slate-100 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">{s.label}</div>
              <div className={cn(
                "text-sm font-bold tracking-tight truncate",
                s.mono && "font-mono text-[12px]",
                s.accent === 'emerald' && "text-emerald-700",
                s.accent === 'rose' && "text-rose-700",
              )}>{s.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorCard({ error, duration }: { error: string; duration: number }) {
  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-rose-500 to-red-600" />
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 grid place-items-center text-white shrink-0">
            <XCircle className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold tracking-tight">Xato</div>
            <div className="text-xs text-slate-500 mb-2">{duration} ms</div>
            <div className="text-sm text-rose-700 bg-rose-50 ring-1 ring-rose-200 rounded-lg px-3 py-2 font-mono break-words">
              {error}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function JsonViewer({ title, json }: { title: string; json: any }) {
  const [copied, setCopied] = useState(false);
  const str = JSON.stringify(json, null, 2);

  function copy() {
    navigator.clipboard.writeText(str);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <CardContent className="p-0">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-600" />
            <div className="text-base font-semibold tracking-tight">{title}</div>
            <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
              {str.length.toLocaleString()} bayt
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={copy} className="h-8 gap-1.5 rounded-full text-xs">
            {copied ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Nusxalandi</> : <><Copy className="h-3.5 w-3.5" /> Nusxalash</>}
          </Button>
        </div>
        <pre className="px-6 py-4 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-[600px] overflow-y-auto bg-slate-50/40">
          <code className="text-slate-700">{str}</code>
        </pre>
      </CardContent>
    </Card>
  );
}
