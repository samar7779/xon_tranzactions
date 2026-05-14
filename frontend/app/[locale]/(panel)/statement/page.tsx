'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, Download, Calendar, Building2, Wallet, Loader2 } from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { BankLogo } from '@/components/bank-logo';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api, apiDownload } from '@/lib/api';
import { cn } from '@/lib/utils';

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function StatementPage() {
  const [bankId, setBankId] = useState('');
  const [accountId, setAccountId] = useState('');
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

  // Aktiv banklar boshida
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
  const selectedAccount = useMemo(
    () => bankAccounts.find((a: any) => a.id === accountId),
    [bankAccounts, accountId],
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
      toast.success('Vipiska yuklab olindi');
    } catch (e: any) {
      toast.error(e?.message || 'Vipiska yuklashda xato');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <Topbar title="Vipiska" subtitle="Bank hisobi bo'yicha tranzaksiyalarni Excel formatida yuklab olish" />

      <div className="flex-1 p-6 lg:p-8 w-full">
        <div className="max-w-2xl mx-auto">
          <Card className="border-0 shadow-soft overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 px-6 py-5 text-white">
              <div className="flex items-center gap-1.5 mb-1.5 text-white/80">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span className="text-[10px] uppercase tracking-[0.15em] font-bold">Выписка лицевых счетов</span>
              </div>
              <div className="text-lg font-bold tracking-tight">Bank vipiskasi</div>
              <div className="text-white/75 text-xs mt-0.5">
                Bank → hisob raqami → sana oralig'ini tanlang, Excel fayl yuklab oling
              </div>
            </div>

            <CardContent className="p-6 space-y-5">
              {/* 1. Bank */}
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1.5">
                  <Building2 className="h-3 w-3" /> Bank
                </Label>
                <Select
                  value={bankId}
                  onValueChange={(v) => { setBankId(v); setAccountId(''); }}
                >
                  <SelectTrigger><SelectValue placeholder="Bankni tanlang" /></SelectTrigger>
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
                        Aktiv emas
                      </div>
                    )}
                    {sortedBanks.filter((b: any) => !b.isActive).map((b: any) => (
                      <SelectItem key={b.id} value={b.id} disabled className="opacity-60">
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 2. Hisob raqami */}
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1.5">
                  <Wallet className="h-3 w-3" /> Hisob raqami
                </Label>
                <Select value={accountId} onValueChange={setAccountId} disabled={!bankId}>
                  <SelectTrigger>
                    <SelectValue placeholder={bankId ? 'Hisobni tanlang' : 'Avval bankni tanlang'} />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-500">Bu bankda hisob yo'q</div>
                    ) : (
                      bankAccounts.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="flex flex-col text-left">
                            <span className="font-mono text-xs">{a.accountNo}</span>
                            <span className="text-[10px] text-slate-500">{a.ownerName || '—'}</span>
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* 3. Sana oralig'i */}
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" /> Sana oralig'i
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    type="date"
                    value={dateFrom}
                    max={dateTo || undefined}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                  <Input
                    type="date"
                    value={dateTo}
                    min={dateFrom || undefined}
                    max={today()}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>

              {/* Tanlangan hisob — qisqa ko'rinish */}
              {selectedAccount && (
                <div className="rounded-xl bg-slate-50 ring-1 ring-slate-100 px-4 py-3 flex items-center gap-3">
                  <BankLogo code={selectedAccount.bank?.code || ''} name={selectedAccount.bank?.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold truncate">{selectedAccount.ownerName || '—'}</div>
                    <div className="font-mono text-[11px] text-slate-500">{selectedAccount.accountNo}</div>
                  </div>
                  <div className="text-[10px] text-slate-400 text-right">
                    MFO {selectedAccount.branch}<br />{selectedAccount.currency}
                  </div>
                </div>
              )}

              {/* Yuklab olish */}
              <Button
                onClick={handleDownload}
                disabled={!canDownload}
                className={cn(
                  'w-full h-11 rounded-xl font-semibold gap-2',
                  'bg-emerald-600 hover:bg-emerald-700 text-white',
                )}
              >
                {downloading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Tayyorlanmoqda...</>
                ) : (
                  <><Download className="h-4 w-4" /> Excel vipiskani yuklab olish</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
