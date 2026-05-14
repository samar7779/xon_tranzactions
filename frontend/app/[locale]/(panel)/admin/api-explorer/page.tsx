'use client';

import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Wifi, Send, Loader2, Eye, EyeOff, Copy, Check, ChevronRight,
  CheckCircle2, XCircle, Database, Sparkles, AlertCircle, ArrowDown,
  Building2, KeyRound, Calendar, Search, FileText, Zap, X, ArrowDownLeft, ArrowUpRight,
  Plus, Wallet, Layers,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BankLogo } from '@/components/bank-logo';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// Valyuta kodini normallashtirish — bank ISO raqam yoki harf qaytarishi mumkin
function normCurrency(val?: string): string {
  if (val === undefined || val === null || val === '') return 'UZS';
  const v = String(val).toUpperCase().trim();
  if (['UZS', '860', '000', '00', '0'].includes(v)) return 'UZS';
  if (['USD', '840'].includes(v)) return 'USD';
  if (['RUB', '643'].includes(v)) return 'RUB';
  if (['EUR', '978'].includes(v)) return 'EUR';
  return v;
}
const CURRENCY_ORDER = ['UZS', 'RUB', 'USD', 'EUR'];

// Hisob raqami prefiksi → tur nomi
const ACC_TYPE_LABELS: Record<string, string> = {
  '20208': 'Joriy hisob',
  '20210': 'Joriy hisob (valyuta)',
  '22613': 'Maxsus hisob',
  '22618': 'Akkreditiv hisobi',
  '16401': 'Foiz hisobi',
  '16403': 'Foiz hisobi',
  '17402': 'Karta hisobi',
  '23402': "G'azna / transit hisob",
  '23106': 'Oylik (ZP) transit',
};
function accTypeLabel(accountNo?: string): string {
  const p = (accountNo || '').slice(0, 5);
  return ACC_TYPE_LABELS[p] || `Hisob ${p || '—'}`;
}

// Hujjat turi kodlari (KapitalBank PDF §9.6)
const DTYPE_LABELS: Record<string, string> = {
  '01': "To'lov topshiriq",
  '21': 'Bankaro o\'tkazma',
  '35': "Memorial order",
  '16': 'SWIFT',
  '97': 'Karta operatsiyasi',
  '98': "G'azna",
  '99': 'Byudjet',
};

// Holat kodlari (PDF §9.1)
const STATE_LABELS: Record<number, { label: string; tone: 'emerald' | 'amber' | 'rose' | 'slate' }> = {
  1: { label: 'Yaratilgan',  tone: 'slate' },
  2: { label: 'Tasdiqlangan', tone: 'amber' },
  3: { label: 'Bajarilgan',   tone: 'emerald' },
  6: { label: "O'chirilgan",  tone: 'rose' },
  16: { label: 'Kechiktirilgan', tone: 'amber' },
};

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
  const [useProxy, setUseProxy] = useState(false); // ahost orqali yuborish

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
      useProxy,
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
      useProxy,
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
      useProxy,
    }),
    onSuccess: (r) => {
      if (r.ok) toast.success('✓ Hisob ma\'lumotlari olindi');
      else toast.error(r.error || 'Xato');
    },
    onError: (e: any) => toast.error(e?.message),
  });

  function selectBank(code: string) {
    const b = banks?.items.find((x: any) => x.code === code);
    if (b && b.isActive) {
      setForm({ ...form, baseUrl: b.apiBaseUrl || '', bankPreset: code });
    }
  }

  // Aktivlar yuqorida, qolganlari pastda (alfavit bo'yicha)
  const sortedBanks = [...(banks?.items || [])].sort((a: any, b: any) => {
    if (a.isActive && !b.isActive) return -1;
    if (!a.isActive && b.isActive) return 1;
    return a.name.localeCompare(b.name);
  });
  const activeBanks = sortedBanks.filter((b: any) => b.isActive);
  const inactiveBanks = sortedBanks.filter((b: any) => !b.isActive);

  return (
    <>
      <div className="flex-1 p-6 lg:p-8 space-y-5 w-full">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold tracking-tight">API Explorer</div>
            <div className="text-xs text-slate-500">Bank API'dan keladigan barcha ma'lumotlarni tekshirish</div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 ring-1 ring-amber-200 text-[11px] font-semibold text-amber-700">
            <Zap className="h-3 w-3" /> DEV / DEBUG
          </span>
        </div>

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
            <div className="space-y-2.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Bank tanlash</Label>

              {/* Aktiv banklar — rangli, effektli */}
              <div className="flex flex-wrap gap-2">
                {activeBanks.map((b: any) => {
                  const selected = form.bankPreset === b.code;
                  return (
                    <button
                      key={b.id}
                      onClick={() => selectBank(b.code)}
                      className={cn(
                        "group inline-flex items-center gap-2.5 pl-2 pr-4 py-2 rounded-xl text-sm font-semibold transition-all",
                        selected
                          ? "bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-lg shadow-indigo-500/30 ring-2 ring-indigo-300 scale-105"
                          : "bg-gradient-to-br from-emerald-50 to-teal-50 text-emerald-700 ring-1 ring-emerald-200 hover:ring-emerald-300 hover:shadow-md hover:-translate-y-0.5",
                      )}
                    >
                      <BankLogo code={b.code} name={b.name} size={28} rounded="rounded-lg" />
                      {b.name}
                      {selected && <Check className="h-3.5 w-3.5" />}
                    </button>
                  );
                })}
              </div>

              {/* Noaktiv banklar — kulrang, yopiq */}
              {inactiveBanks.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mt-3 mb-1.5">
                    Kelajakda — integratsiya yo'q
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {inactiveBanks.map((b: any) => (
                      <span
                        key={b.id}
                        title="Bu bank uchun API integratsiyasi hali yo'q"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-slate-50 text-slate-400 ring-1 ring-slate-150 cursor-not-allowed"
                      >
                        <Building2 className="h-3 w-3" />
                        {b.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ahost proxy toggle */}
            <div className={cn(
              "rounded-2xl p-4 transition-all flex items-center gap-4 ring-1",
              useProxy
                ? "bg-gradient-to-br from-emerald-50 to-teal-50 ring-emerald-200"
                : "bg-slate-50 ring-slate-200",
            )}>
              <button
                type="button"
                onClick={() => setUseProxy(!useProxy)}
                className={cn(
                  "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full ring-1 ring-inset transition-colors",
                  useProxy
                    ? "bg-emerald-500 ring-emerald-600"
                    : "bg-slate-300 ring-slate-400",
                )}
              >
                <span className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-1 ring-black/5 transition-transform mt-1",
                  useProxy ? "translate-x-6" : "translate-x-1",
                )} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[13px] font-bold text-slate-900">ahost orqali yuborish</span>
                  {useProxy ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                      YOQILGAN
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600">
                      OFF
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-600 leading-relaxed">
                  {useProxy
                    ? <>So'rovlar <code className="font-mono bg-white px-1 py-0.5 rounded text-emerald-700">ahost (37.153.159.11)</code> orqali yuboriladi — bank whitelist'da bo'lgan IP</>
                    : <>So'rovlar to'g'ridan-to'g'ri bizning serverdan (<code className="font-mono bg-white px-1 py-0.5 rounded">185.228.88.247</code>) yuboriladi</>}
                </div>
              </div>
              <Zap className={cn("h-5 w-5 shrink-0 transition-colors", useProxy ? "text-emerald-600" : "text-slate-400")} />
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
  // Hooks — early return'dan oldin chaqirilishi shart
  const [addTarget, setAddTarget] = useState<any>(null);

  const { data: dbAccounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<{ items: any[] }>('/bank-accounts'),
  });
  const { data: creds } = useQuery({
    queryKey: ['bank-credentials'],
    queryFn: () => api.get<{ items: any[] }>('/bank-credentials'),
  });

  const result = data?.result;
  const summary = data?.summary;

  // Bankdan kelgan barcha hisoblar (flat) — oylik transit hisoblar ham
  const allAccs = useMemo(() => {
    const out: any[] = [];
    for (const c of result?.clients || []) {
      for (const a of c.accounts || []) {
        out.push({ ...a, clientName: c.name, clientInn: c.inn });
      }
      // Oylik (ZP) transit hisoblari — bank alohida arraylarda qaytaradi ({branch, account})
      // bu hisoblardan faqat oylik chiqariladi, kirim bo'lmaydi
      const zp = [...(c.zp_accs || []), ...(c.zp_humo_accs || []), ...(c.zp_upi_accs || [])];
      for (const z of zp) {
        if ((c.accounts || []).some((a: any) => a.account === z.account)) continue; // takror emas
        out.push({
          ...z,
          clientName: c.name,
          clientInn: c.inn,
          name: c.name,
          val: 'UZS',
          __salary: true,
        });
      }
    }
    return out;
  }, [result]);

  // Bazada bor hisoblar to'plami
  const dbSet = useMemo(
    () => new Set((dbAccounts?.items || []).map((a: any) => a.accountNo)),
    [dbAccounts],
  );

  // Guruhlash: valyuta → tur → hisoblar
  const grouped = useMemo(() => {
    const byCur = new Map<string, Map<string, any[]>>();
    for (const a of allAccs) {
      const cur = normCurrency(a.val);
      const type = a.__salary ? 'Oylik (ZP) hisob' : accTypeLabel(a.account);
      if (!byCur.has(cur)) byCur.set(cur, new Map());
      const byType = byCur.get(cur)!;
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(a);
    }
    // Valyutalarni tartiblash
    const curs = Array.from(byCur.keys()).sort((a, b) => {
      const ia = CURRENCY_ORDER.indexOf(a);
      const ib = CURRENCY_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return curs.map((cur) => {
      const byType = byCur.get(cur)!;
      const types = Array.from(byType.keys()).sort();
      const count = types.reduce((s, t) => s + byType.get(t)!.length, 0);
      return { cur, count, types: types.map((t) => ({ type: t, accs: byType.get(t)! })) };
    });
  }, [allAccs]);

  if (!data.ok) return <ErrorCard error={data.error} duration={data.durationMs} />;

  const addedCount = allAccs.filter((a: any) => dbSet.has(a.account)).length;

  return (
    <>
      <SuccessCard
        title="APILogin muvaffaqiyatli"
        duration={data.durationMs}
        summary={[
          { label: 'Klient', value: summary?.name || '—' },
          { label: 'STIR', value: summary?.inn || '—', mono: true },
          { label: 'Hisoblar', value: String(summary?.totalAccounts || allAccs.length || 0) },
          { label: 'Bazada bor', value: `${addedCount} / ${allAccs.length}` },
        ]}
      />

      {/* Accounts — valyuta + tur bo'yicha guruhlangan */}
      <Card className="border-0 shadow-soft overflow-hidden">
        <CardContent className="p-0">
          <div className="px-6 py-4 border-b border-slate-100">
            <div className="text-base font-semibold tracking-tight">
              Mavjud hisoblar <span className="text-slate-400 font-normal">({allAccs.length})</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Valyuta va hisob turi bo'yicha guruhlangan · qatorni bosing → tranzaksiyalar · <span className="text-emerald-600 font-medium">+ Qo'shish</span> → bazaga
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {grouped.map((g) => (
              <details key={g.cur} open className="group">
                <summary className="px-6 py-2.5 cursor-pointer bg-slate-50/70 hover:bg-slate-100/70 flex items-center gap-2 select-none">
                  <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" />
                  <Wallet className="h-3.5 w-3.5 text-indigo-500" />
                  <span className="text-[13px] font-bold text-slate-800">{g.cur}</span>
                  <span className="text-[11px] text-slate-500">· {g.count} ta hisob</span>
                </summary>

                {g.types.map((t) => {
                  const isSalary = t.type.includes('Oylik');
                  return (
                  <div key={t.type}>
                    <div className={cn(
                      "px-6 py-1.5 flex items-center gap-1.5 border-t border-slate-50",
                      isSalary ? "bg-amber-50/70" : "bg-white",
                    )}>
                      <Layers className={cn("h-3 w-3", isSalary ? "text-amber-500" : "text-slate-300")} />
                      <span className={cn(
                        "text-[10px] uppercase tracking-wider font-semibold",
                        isSalary ? "text-amber-700" : "text-slate-400",
                      )}>
                        {t.type}
                      </span>
                      <span className={cn("text-[10px]", isSalary ? "text-amber-400" : "text-slate-300")}>· {t.accs.length}</span>
                      {isSalary && (
                        <span className="text-[10px] text-amber-600/80 ml-1">— faqat oylik chiqariladi, kirim bo'lmaydi</span>
                      )}
                    </div>
                    {t.accs.map((a: any, i: number) => {
                      const inDb = dbSet.has(a.account);
                      return (
                        <div
                          key={a.account + i}
                          className="pl-10 pr-6 py-2.5 flex items-center gap-3 hover:bg-slate-50/60 transition-colors"
                        >
                          <button
                            onClick={() => onPickAccount(a.branch, a.account)}
                            className="flex items-center gap-3 flex-1 min-w-0 text-left"
                          >
                            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 grid place-items-center text-white shrink-0">
                              <Building2 className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-mono text-[12px] font-semibold truncate">{a.account}</div>
                              <div className="text-[11px] text-slate-500 truncate">MFO {a.branch} · {a.name || a.clientName}</div>
                            </div>
                          </button>

                          {inDb ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 shrink-0">
                              <CheckCircle2 className="h-3 w-3" /> Bazada
                            </span>
                          ) : (
                            <button
                              onClick={() => setAddTarget(a)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shrink-0"
                            >
                              <Plus className="h-3 w-3" /> Qo'shish
                            </button>
                          )}
                          <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                  );
                })}
              </details>
            ))}
          </div>
        </CardContent>
      </Card>

      <AddBankAccountDialog account={addTarget} creds={creds?.items || []} onClose={() => setAddTarget(null)} />

      {/* Raw JSON — yopiq holatda, bosilganda ochiladi */}
      <details className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <summary className="px-4 py-2.5 cursor-pointer text-[12px] font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
          <FileText className="h-3.5 w-3.5" /> To'liq raw JSON ko'rsatish ({(JSON.stringify(result).length / 1024).toFixed(1)} KB)
        </summary>
        <JsonViewer title="" json={result} />
      </details>
    </>
  );
}

// Bankdan kelgan hisobni bazaga qo'shish — credential tanlash bilan
function AddBankAccountDialog({ account, creds, onClose }: { account: any; creds: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [credentialId, setCredentialId] = useState('');

  const mut = useMutation({
    mutationFn: () => api.post('/bank-accounts', {
      credentialId,
      branch: (account.branch || '').padStart(5, '0'),
      accountNo: account.account,
      ownerName: account.name || account.clientName || undefined,
      currency: normCurrency(account.val),
    }),
    onSuccess: () => {
      toast.success('Hisob bazaga qo\'shildi');
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
      onClose();
      setCredentialId('');
    },
    onError: (e: any) => toast.error(e?.message || 'Qo\'shishda xato'),
  });

  if (!account) return null;

  return (
    <Dialog open={!!account} onOpenChange={(o) => { if (!o) { onClose(); setCredentialId(''); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-indigo-600" /> Hisobni bazaga qo'shish
          </DialogTitle>
          <DialogDescription>Hisobni qaysi bank ulanishiga biriktiramiz?</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tanlangan hisob */}
          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3 space-y-1">
            <div className="font-mono text-[13px] font-semibold text-slate-900">{account.account}</div>
            <div className="text-[11px] text-slate-500">
              MFO {account.branch} · {normCurrency(account.val)} · {account.name || account.clientName || '—'}
            </div>
          </div>

          {/* Credential tanlash */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
              Bank ulanishi <span className="text-rose-500">*</span>
            </Label>
            <Select value={credentialId} onValueChange={setCredentialId}>
              <SelectTrigger className={cn(!credentialId && 'ring-1 ring-rose-200')}>
                <SelectValue placeholder="Ulanishni tanlang" />
              </SelectTrigger>
              <SelectContent>
                {creds.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-500">Saqlangan bank ulanishi yo'q</div>
                ) : (
                  creds.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.label} · {c.bank?.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {creds.length === 0 && (
              <div className="text-[10px] text-slate-500">
                Avval Sozlash → Bank ulanishlari bo'limidan ulanish qo'shing
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setCredentialId(''); }}>Bekor qilish</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !credentialId}>
            {mut.isPending ? 'Qo\'shilmoqda...' : 'Qo\'shish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

// Tranzaksiya tafsiloti modal — tozalangan, biznes ma'lumotga ustivor
function TransactionDetailModal({ txn, onClose }: { txn: any; onClose: () => void }) {
  if (!txn) return null;
  const fmt = (n: number) => new Intl.NumberFormat('uz-UZ').format((n || 0) / 100);

  const isIn = txn.dir === 2;
  const state = STATE_LABELS[txn.state] || { label: `#${txn.state}`, tone: 'slate' as const };
  const stateClass = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber:   'bg-amber-50 text-amber-700 ring-amber-200',
    rose:    'bg-rose-50 text-rose-700 ring-rose-200',
    slate:   'bg-slate-50 text-slate-700 ring-slate-200',
  }[state.tone];
  const dtypeLabel = DTYPE_LABELS[txn.dtype] || `${txn.dtype} (Boshqa)`;

  // Yuboruvchi va qabul qiluvchi — agar kirim bo'lsa, biz qabul qiluvchimiz
  const sender = { name: txn.name_dt, inn: txn.inn_dt, account: txn.acc_dt, mfo: txn.mfo_dt };
  const receiver = { name: txn.name_ct, inn: txn.inn_ct, account: txn.acc_ct, mfo: txn.mfo_ct };

  return (
    <Dialog open={!!txn} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-0 max-h-[90vh] gap-0 flex flex-col overflow-hidden">
        {/* ─── Header ─── */}
        <div className={cn(
          "relative px-6 py-5 text-white shrink-0",
          isIn ? "bg-gradient-to-br from-emerald-600 to-teal-700" : "bg-gradient-to-br from-rose-600 to-red-700",
        )}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-[11px] font-bold">
                  {isIn ? <><ArrowDownLeft className="h-3 w-3" /> KIRIM</> : <><ArrowUpRight className="h-3 w-3" /> CHIQIM</>}
                </span>
                <span className="text-[11px] text-white/85">{txn.ddate}{txn.time && ` · ${txn.time}`}</span>
                {txn.anor === 1 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-300/20 backdrop-blur-sm text-amber-100 ring-1 ring-amber-200/40">
                    <Zap className="h-2.5 w-2.5" /> ANOR 24/7
                  </span>
                )}
              </div>
              <div className="text-4xl font-bold tabular-nums tracking-tight">
                {isIn ? '+' : '−'}{fmt(txn.amount)} <span className="text-lg text-white/70 font-medium">UZS</span>
              </div>
              <div className="text-sm text-white/90 mt-1.5 truncate font-medium">
                {isIn ? sender.name : receiver.name}
              </div>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white shrink-0 -mt-1 -mr-1 p-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ─── Body ─── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4 bg-white">

          {/* Status & document */}
          <div className="grid grid-cols-2 gap-3">
            <DetailField label="Holat">
              <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset", stateClass)}>
                <span className={cn("w-1.5 h-1.5 rounded-full", state.tone === 'emerald' && "bg-emerald-500", state.tone === 'amber' && "bg-amber-500", state.tone === 'rose' && "bg-rose-500", state.tone === 'slate' && "bg-slate-400")} />
                {state.label}
              </span>
            </DetailField>
            <DetailField label="Hujjat turi">
              <div className="text-[13px] font-semibold text-slate-900">{dtypeLabel}</div>
              {txn.num && <div className="font-mono text-[11px] text-slate-500 mt-0.5">#{txn.num}</div>}
            </DetailField>
          </div>

          {/* Sender */}
          <Party
            title="Yuboruvchi"
            color="rose"
            highlighted={!isIn}
            name={sender.name}
            inn={sender.inn}
            account={sender.account}
            mfo={sender.mfo}
          />

          {/* Receiver */}
          <Party
            title="Qabul qiluvchi"
            color="emerald"
            highlighted={isIn}
            name={receiver.name}
            inn={receiver.inn}
            account={receiver.account}
            mfo={receiver.mfo}
          />

          {/* Purpose */}
          {txn.purpose && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 mb-1.5">To'lov maqsadi</div>
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
                <div className="text-[13px] text-slate-900 leading-relaxed whitespace-pre-wrap">{txn.purpose.trim()}</div>
                {txn.purp_code && (
                  <div className="mt-2 pt-2 border-t border-slate-200 flex items-center gap-2 text-[11px]">
                    <span className="text-slate-500">Maqsad kodi:</span>
                    <span className="font-mono font-semibold text-slate-700">{txn.purp_code}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Value date if differs */}
          {txn.vdate && txn.vdate !== txn.ddate && (
            <DetailField label="Value date (mablag' mavjud bo'lish sanasi)">
              <div className="text-[13px] font-semibold text-slate-900 tabular-nums">{txn.vdate}</div>
            </DetailField>
          )}

          {/* Error if any */}
          {(txn.err && txn.err !== '0' && txn.err !== 0) || txn.err_msg ? (
            <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-rose-700 mb-1">Bank xatosi</div>
              <div className="text-[12px] text-rose-900">
                {txn.err_msg || `Kod: ${txn.err}`}
              </div>
            </div>
          ) : null}

          {/* Technical details (collapsed by default) */}
          <details className="rounded-xl border border-slate-200 overflow-hidden">
            <summary className="px-4 py-2.5 cursor-pointer text-[11px] font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2 uppercase tracking-wider">
              <FileText className="h-3.5 w-3.5" /> Texnik tafsilot (ID, vaqt, raw)
            </summary>
            <div className="px-4 py-3 bg-slate-50/60 space-y-2 text-[11px]">
              <TechRow label="B2 ID" value={txn.b2_id} mono />
              <TechRow label="Global ID (NCI)" value={txn.general_id} mono />
              <TechRow label="Unique ID" value={txn.uniq} mono />
              <TechRow label="Klient ID" value={txn.client_id} mono />
              <TechRow label="Filial MFO" value={txn.branch} mono />
              <TechRow label="Hujjat sanasi (ddate)" value={txn.ddate} />
              <TechRow label="Value date (vdate)" value={txn.vdate} />
              <TechRow label="Operatsiya vaqti" value={txn.time} />
              <TechRow label="Kiritilgan" value={`${txn.input_date || '—'} ${txn.input_time || ''}`} />
              <TechRow label="Settlement vaqti (stime)" value={txn.stime} />
              <TechRow label="Anor 24/7" value={txn.anor === 1 ? 'Ha' : "Yo'q"} />
              <details className="pt-2">
                <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-700">Raw JSON</summary>
                <pre className="mt-2 p-2 bg-white border border-slate-200 rounded text-[10px] font-mono overflow-x-auto max-h-60 overflow-y-auto">{JSON.stringify(txn, null, 2)}</pre>
              </details>
            </div>
          </details>

        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function Party({
  title, color, highlighted, name, inn, account, mfo,
}: {
  title: string;
  color: 'rose' | 'emerald';
  highlighted: boolean;
  name?: string;
  inn?: string;
  account?: string;
  mfo?: string;
}) {
  const c = {
    rose:    { bg: 'bg-rose-50/60',    ring: 'ring-rose-200', dot: 'bg-rose-500', label: 'text-rose-700' },
    emerald: { bg: 'bg-emerald-50/60', ring: 'ring-emerald-200', dot: 'bg-emerald-500', label: 'text-emerald-700' },
  }[color];
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 mb-1.5 flex items-center gap-1.5">
        <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
        {title}
        {highlighted && <span className={cn("text-[9px] font-bold uppercase", c.label)}>· siz</span>}
      </div>
      <div className={cn("rounded-xl ring-1 px-4 py-3 space-y-1.5", highlighted ? `${c.bg} ${c.ring}` : 'bg-slate-50 ring-slate-200')}>
        <div className="text-[14px] font-bold text-slate-900 truncate">{name || '—'}</div>
        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <div>
            <div className="text-slate-500 mb-0.5">STIR</div>
            <div className="font-mono text-slate-900">{inn || '—'}</div>
          </div>
          <div>
            <div className="text-slate-500 mb-0.5">Bank MFO</div>
            <div className="font-mono text-slate-900">{mfo || '—'}</div>
          </div>
          <div className="col-span-2">
            <div className="text-slate-500 mb-0.5">Hisob raqami</div>
            <div className="font-mono text-slate-900 truncate">{account || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TechRow({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  const isEmpty = value === null || value === undefined || value === '' || value === 'null';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="text-slate-500 shrink-0">{label}</div>
      <div className={cn("text-slate-900 text-right truncate", mono && "font-mono", isEmpty && "text-slate-400 italic")}>
        {isEmpty ? "bo'sh" : String(value)}
      </div>
    </div>
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
