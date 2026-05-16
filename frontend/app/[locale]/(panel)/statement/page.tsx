'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  FileSpreadsheet, Download, Calendar, Building2, Search, Check,
  Loader2, Wallet, X, ChevronRight, ScanLine, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { TransactionsTabs } from '@/components/transactions-tabs';
import { BankLogo } from '@/components/bank-logo';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api, apiDownload } from '@/lib/api';
import { cn, formatMoney, formatDate } from '@/lib/utils';

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function firstOfMonth() {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
}
function today() {
  return iso(new Date());
}

const DATE_PRESETS: { key: 'rangeToday' | 'rangeWeek' | 'rangeMonth' | 'rangeLastMonth'; range: () => [string, string] }[] = [
  { key: 'rangeToday', range: () => [today(), today()] },
  {
    key: 'rangeWeek',
    range: () => {
      const d = new Date();
      const day = (d.getDay() + 6) % 7; // Mon=0
      const mon = new Date(d); mon.setDate(d.getDate() - day);
      return [iso(mon), today()];
    },
  },
  { key: 'rangeMonth', range: () => [firstOfMonth(), today()] },
  {
    key: 'rangeLastMonth',
    range: () => {
      const d = new Date();
      const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const last = new Date(d.getFullYear(), d.getMonth(), 0);
      return [iso(first), iso(last)];
    },
  },
];

export default function StatementPage() {
  const t = useTranslations('statement');
  const tc = useTranslations('common');
  const td = useTranslations('dashboard');
  const [bankId, setBankId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accSearch, setAccSearch] = useState('');
  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(today());
  const [downloading, setDownloading] = useState(false);

  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });
  const { data: accounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<{ items: any[] }>('/bank-accounts'),
  });

  const sortedBanks = useMemo(() => {
    return [...(banks?.items || [])].sort((a: any, b: any) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [banks]);

  const bankAccounts = useMemo(
    () => (accounts?.items || []).filter((a: any) => a.bankId === bankId),
    [accounts, bankId],
  );

  const filteredAccounts = useMemo(() => {
    const q = accSearch.trim().toLowerCase();
    if (!q) return bankAccounts;
    return bankAccounts.filter((a: any) =>
      a.accountNo?.toLowerCase().includes(q) ||
      a.ownerName?.toLowerCase().includes(q) ||
      a.branch?.includes(q),
    );
  }, [bankAccounts, accSearch]);

  const selectedAccount = useMemo(
    () => bankAccounts.find((a: any) => a.id === accountId),
    [bankAccounts, accountId],
  );

  const activePreset = useMemo(
    () => DATE_PRESETS.find((p) => {
      const [f, tt] = p.range();
      return f === dateFrom && tt === dateTo;
    })?.key,
    [dateFrom, dateTo],
  );

  const canDownload = bankId && accountId && dateFrom && dateTo && !downloading;

  async function handleDownload() {
    if (!canDownload) return;
    setDownloading(true);
    try {
      await apiDownload(
        `/transactions/statement?accountId=${accountId}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
        'vipiska.xlsx',
      );
      toast.success(t('downloadSuccess'));
    } catch (e: any) {
      toast.error(e?.message || t('downloadError'));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />
      <TransactionsTabs />

      <div className="flex-1 p-6 lg:p-8 w-full space-y-5">

        {/* ═══ ID Inspector — bank API'dan tranzaksiyani qidirish ═══ */}
        <IdInspectorCard />

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">

          {/* ═══ LEFT — sozlamalar ═══ */}
          <div className="xl:col-span-4 space-y-5">
            {/* Step 1 — Bank */}
            <Card className="border-0 shadow-soft">
              <CardContent className="p-5 space-y-3">
                <StepLabel n={1} icon={Building2} text={t('step1Bank')} />
                <Select value={bankId} onValueChange={(v) => { setBankId(v); setAccountId(''); setAccSearch(''); }}>
                  <SelectTrigger className="h-11"><SelectValue placeholder={t('bankPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    {sortedBanks.filter((b: any) => b.isActive).map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>
                        <span className="flex items-center gap-2">
                          <BankLogo code={b.code || ''} name={b.name} size={20} rounded="rounded-md" />
                          {b.name}
                        </span>
                      </SelectItem>
                    ))}
                    {sortedBanks.filter((b: any) => !b.isActive).length > 0 && (
                      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 font-semibold border-t border-slate-100 mt-1">
                        {t('inactiveBanks')}
                      </div>
                    )}
                    {sortedBanks.filter((b: any) => !b.isActive).map((b: any) => (
                      <SelectItem key={b.id} value={b.id} disabled className="opacity-60">{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Step 3 — Sana */}
            <Card className="border-0 shadow-soft">
              <CardContent className="p-5 space-y-3">
                <StepLabel n={3} icon={Calendar} text={t('step3Date')} />
                <div className="flex flex-wrap gap-1.5">
                  {DATE_PRESETS.map((p) => {
                    const active = activePreset === p.key;
                    return (
                      <button
                        key={p.key}
                        onClick={() => { const [f, tt] = p.range(); setDateFrom(f); setDateTo(tt); }}
                        className={cn(
                          'px-2.5 h-7 rounded-lg text-[11px] font-medium transition-colors',
                          active
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                        )}
                      >
                        {t(p.key)}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{tc('from')}</Label>
                    <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{tc('to')}</Label>
                    <Input type="date" value={dateTo} min={dateFrom || undefined} max={today()} onChange={(e) => setDateTo(e.target.value)} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Summary + download */}
            <Card className="border-0 shadow-soft overflow-hidden">
              <div className="bg-gradient-to-br from-emerald-500 to-teal-600 px-5 py-4 text-white">
                <div className="flex items-center gap-1.5 mb-1 text-white/80">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span className="text-[10px] uppercase tracking-[0.15em] font-bold">{t('downloadCardTitle')}</span>
                </div>
                <div className="text-sm font-bold">{t('readyToDownload')}</div>
              </div>
              <CardContent className="p-5 space-y-3">
                {selectedAccount ? (
                  <div className="flex items-center gap-3">
                    <BankLogo code={selectedAccount.bank?.code || ''} name={selectedAccount.bank?.name} size={38} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate">{selectedAccount.ownerName || '—'}</div>
                      <div className="font-mono text-[11px] text-slate-500">{selectedAccount.accountNo}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">{t('noAccountSelected')}</div>
                )}
                <div className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                  <span className="text-slate-500">{t('period')}</span>
                  <span className="font-medium text-slate-700 tabular-nums">
                    {formatDate(dateFrom)} — {formatDate(dateTo)}
                  </span>
                </div>
                <Button
                  onClick={handleDownload}
                  disabled={!canDownload}
                  className="w-full h-11 rounded-xl font-semibold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {downloading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t('preparing')}</>
                  ) : (
                    <><Download className="h-4 w-4" /> {t('downloadExcel')}</>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* ═══ RIGHT — hisob tanlash ═══ */}
          <div className="xl:col-span-8">
            <Card className="border-0 shadow-soft">
              <CardContent className="p-0">
                {/* Header + search */}
                <div className="px-5 py-4 border-b border-slate-100">
                  <StepLabel n={2} icon={Wallet} text={t('step2Account')} />
                  <div className="relative mt-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      className="pl-9 h-10 rounded-xl bg-slate-50/60"
                      placeholder={t('searchAccount')}
                      value={accSearch}
                      onChange={(e) => setAccSearch(e.target.value)}
                      disabled={!bankId}
                    />
                    {accSearch && (
                      <button
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                        onClick={() => setAccSearch('')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {bankId && (
                    <div className="text-[11px] text-slate-400 mt-2">
                      {t('accountsCount', { shown: filteredAccounts.length, total: bankAccounts.length })}
                    </div>
                  )}
                </div>

                {/* List */}
                <div className="max-h-[calc(100vh-340px)] min-h-[320px] overflow-y-auto">
                  {!bankId ? (
                    <EmptyHint icon={Building2} text={t('selectBankFirst')} />
                  ) : filteredAccounts.length === 0 ? (
                    <EmptyHint icon={Search} text={accSearch ? t('noAccountsFound') : t('noAccountsInBank')} />
                  ) : (
                    <div className="divide-y divide-slate-50">
                      {filteredAccounts.map((a: any) => {
                        const selected = a.id === accountId;
                        return (
                          <button
                            key={a.id}
                            onClick={() => setAccountId(a.id)}
                            className={cn(
                              'w-full flex items-center gap-3 px-5 py-3 text-left transition-colors',
                              selected ? 'bg-indigo-50/70' : 'hover:bg-slate-50',
                            )}
                          >
                            <BankLogo code={a.bank?.code || ''} name={a.bank?.name} size={38} />
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-[13px] font-semibold text-slate-800 truncate">
                                {a.accountNo}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {a.ownerName || '—'} · MFO {a.branch}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[13px] font-bold tabular-nums text-slate-800">
                                {formatMoney(Number(a.balance || 0))}
                              </div>
                              <div className="text-[10px] text-slate-400">{a.currency}</div>
                            </div>
                            <div className={cn(
                              'w-6 h-6 rounded-full grid place-items-center shrink-0 transition-colors',
                              selected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-transparent',
                            )}>
                              {selected ? <Check className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </>
  );
}

function StepLabel({ n, icon: Icon, text }: { n: number; icon: any; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 h-5 rounded-md bg-indigo-100 text-indigo-700 text-[11px] font-bold grid place-items-center">
        {n}
      </span>
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      <span className="text-[12px] font-semibold text-slate-700">{text}</span>
    </div>
  );
}

function EmptyHint({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="grid place-items-center py-20 text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-50 grid place-items-center mb-3">
        <Icon className="h-5 w-5 text-slate-300" />
      </div>
      <div className="text-sm text-slate-400">{text}</div>
    </div>
  );
}

// ═══ ID INSPECTOR — composite ID'ni bankdan qidirish (faqat bank API)
function IdInspectorCard() {
  const [id, setId] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (rawId: string) => api.post<any>('/transactions/inspect-id', { id: rawId }),
    onSuccess: (r: any) => { setResult(r); setError(null); },
    onError: (e: any) => { setError(e?.message || 'Xato'); setResult(null); },
  });

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = id.trim();
    if (!trimmed) return;
    setResult(null);
    setError(null);
    mut.mutate(trimmed);
  }

  function clear() {
    setId('');
    setResult(null);
    setError(null);
  }

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className="bg-gradient-to-br from-indigo-600 via-fuchsia-600 to-purple-700 px-5 py-3.5 text-white">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/15 grid place-items-center">
            <ScanLine className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-white/80">
              Bank API · Tranzaksiya tekshirish
            </div>
            <div className="text-sm font-bold">ID bo'yicha bankdan qidirish</div>
          </div>
        </div>
      </div>
      <CardContent className="p-5 space-y-4">
        <form onSubmit={submit} className="flex items-stretch gap-2">
          <div className="relative flex-1">
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="Masalan: 5424816081_27185799_04.05.2026_23120000200000959001_..."
              className="h-11 pr-9 font-mono text-[12px]"
            />
            {id && (
              <button
                type="button"
                onClick={clear}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            disabled={!id.trim() || mut.isPending}
            className="h-11 px-5 rounded-xl font-semibold gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white"
          >
            {mut.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Qidirilmoqda</>
            ) : (
              <><Search className="h-4 w-4" /> Qidirish</>
            )}
          </Button>
        </form>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 ring-1 ring-rose-200 text-rose-800 text-[12px]">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="break-all">{error}</div>
          </div>
        )}

        {result && <InspectorResult data={result} />}
      </CardContent>
    </Card>
  );
}

function InspectorResult({ data }: { data: any }) {
  const p = data.parsed || {};
  const acc = data.account || {};
  const bank = data.bankResponse || {};
  const found = bank.item;

  return (
    <div className="space-y-3">
      {/* Status banner */}
      {data.bankError ? (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 ring-1 ring-amber-200 text-amber-800 text-[12px]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold mb-0.5">Bankga so'rov xato:</div>
            <div className="break-all">{data.bankError}</div>
          </div>
        </div>
      ) : found ? (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 text-emerald-800 text-[12px]">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Bankda topildi</span>
            <span className="text-emerald-600 ml-1.5">
              ({bank.matchedBy} bo'yicha — o'sha kun jami {bank.totalItemsThatDay} ta tranzaksiya)
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 ring-1 ring-rose-200 text-rose-800 text-[12px]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold mb-0.5">Bankda topilmadi (o'sha kun jami {bank.totalItemsThatDay} ta tranzaksiya)</div>
            <div className="text-rose-600">Bank tranzaksiyani o'chirgan yoki bekor qilgan bo'lishi mumkin</div>
          </div>
        </div>
      )}

      {/* Parsed + account */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <InfoBox title="ID parsed">
          <KV k="general_id" v={p.generalId} mono />
          <KV k="num" v={p.num} mono />
          <KV k="sana" v={p.ddate} />
          <KV k="summa" v={p.amountSom != null ? p.amountSom.toLocaleString('uz-UZ') + ' so\'m' : '—'} />
          <KV k="yo'nalish" v={p.direction} />
          <KV k="acc_dt (debit)" v={p.accDt} mono small />
          <KV k="acc_ct (credit)" v={p.accCt} mono small />
        </InfoBox>

        <InfoBox title="Bizning hisob">
          <KV k="bank" v={`${acc.bank?.name || '—'}${acc.bank?.code ? ` (${acc.bank.code})` : ''}`} />
          <KV k="MFO" v={acc.branch} />
          <KV k="hisob raqami" v={acc.accountNo} mono />
          <KV k="egasi" v={acc.ownerName || '—'} />
          <KV k="saldo (kun boshi)" v={bank.saldoInSom != null ? bank.saldoInSom.toLocaleString('uz-UZ') + ' so\'m' : '—'} />
          <KV k="saldo (kun oxiri)" v={bank.saldoOutSom != null ? bank.saldoOutSom.toLocaleString('uz-UZ') + ' so\'m' : '—'} />
        </InfoBox>
      </div>

      {/* Bank javobi — to'liq item */}
      {found && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
            Bank javobi (barcha maydonlar)
          </div>
          <div className="rounded-xl bg-slate-900 text-emerald-300 p-3 font-mono text-[11px] overflow-x-auto">
            <pre className="leading-relaxed">{JSON.stringify(found, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">{title}</div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function KV({ k, v, mono, small }: { k: string; v: any; mono?: boolean; small?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="text-[11px] text-slate-500 shrink-0 min-w-[110px]">{k}</span>
      <span
        className={cn(
          'flex-1 break-all text-slate-800',
          mono && 'font-mono',
          small ? 'text-[10.5px]' : 'text-[12px]',
        )}
      >
        {v ?? '—'}
      </span>
    </div>
  );
}
