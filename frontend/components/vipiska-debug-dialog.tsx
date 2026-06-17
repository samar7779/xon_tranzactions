'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Search, Loader2, X, AlertTriangle, Database,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface BankAccount {
  id: string;
  accountNo: string;
  branch: string;
  ownerName: string | null;
  bank: { name: string; code: string };
}

interface VipiskaDebugResult {
  ok: boolean;
  error?: string;
  account?: { accountNo: string };
  bank?: { name: string; code: string };
  totals?: { fetched: number; matched: number };
  errors?: string[];
  items?: Array<{
    ddate: string;
    num: string;
    amount: number;
    direction: 'IN' | 'OUT';
    compositeId: string;
    sender?: { name: string; inn: string };
  }>;
}

export function VipiskaDebugDialog({
  open, onClose,
}: { open: boolean; onClose: () => void }) {
  const t = useTranslations('vipiskaDebug');
  const tc = useTranslations('common');
  const [accountId, setAccountId] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [date, setDate] = useState('');
  const [nums, setNums] = useState('');
  const [result, setResult] = useState<VipiskaDebugResult | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['bank-accounts-debug'],
    queryFn: () => api.get<{ items: BankAccount[] }>('/bank-accounts'),
    enabled: open,
  });

  const fetchMut = useMutation({
    mutationFn: () => api.post<VipiskaDebugResult>('/sync/debug-fetch-raw', {
      accountId,
      dates: [date],
      searchNums: nums.trim()
        ? nums.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
        : undefined,
    }, { timeout: 60_000 }),
    onSuccess: (r) => {
      setResult(r);
      if (r?.ok) toast.success(t('rowsFound', { matched: r.totals?.matched ?? 0, fetched: r.totals?.fetched ?? 0 }));
      else toast.error(r?.error || tc('error'));
    },
    onError: (e: any) => {
      setResult({ ok: false, error: e?.message || t('requestError') });
      toast.error(e?.message || t('requestError'));
    },
  });

  const reset = () => {
    setAccountId('');
    setAccountSearch('');
    setDate('');
    setNums('');
    setResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) { reset(); onClose(); }
    }}>
      <DialogContent className="sm:max-w-[1280px] w-[96vw] p-0 overflow-hidden gap-0 h-[88vh] max-h-[88vh] flex flex-col">
        <div className="bg-gradient-to-br from-cyan-600 via-sky-600 to-blue-600 px-6 pt-5 pb-4 text-white shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-white/15 grid place-items-center">
              <Search className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-widest font-bold text-white/70">{t('bankApi')}</div>
              <div className="text-xl font-black tracking-tight">{t('title')}</div>
            </div>
          </div>
          <div className="text-[11.5px] text-white/80 mt-2">
            {t('description')}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* Searchable account combobox — kengaytirildi (6 ustun) */}
            <div className="relative md:col-span-6">
              <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-1 flex items-center justify-between">
                <span>{t('accountLabel')}</span>
                {accountId && (
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold normal-case tracking-normal">
                    ✓ {t('selected')}
                  </span>
                )}
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
                <Input
                  type="text"
                  value={accountSearch}
                  onChange={(e) => {
                    setAccountSearch(e.target.value);
                    setAccountOpen(true);
                    if (accountId) setAccountId('');
                  }}
                  onFocus={() => setAccountOpen(true)}
                  placeholder={accountsQuery.isLoading ? tc('loading') : t('searchPlaceholder')}
                  className={cn(
                    "h-10 pl-9 text-[12.5px]",
                    accountId ? "pr-9 text-ellipsis" : "pr-3",
                  )}
                  title={accountSearch}
                />
                {accountId && (
                  <button
                    type="button"
                    onClick={() => {
                      setAccountId('');
                      setAccountSearch('');
                      setAccountOpen(true);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                    title={tc('clear')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {accountOpen && (accountsQuery.data?.items?.length || 0) > 0 && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setAccountOpen(false)} />
                  <div className="absolute z-30 left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-lg">
                    {(() => {
                      const q = accountSearch.trim().toLowerCase();
                      const allItems = accountsQuery.data?.items || [];
                      const filtered = q
                        ? allItems.filter((a) => {
                            const haystack = [
                              a.accountNo, a.ownerName, a.branch,
                              a.bank?.name, a.bank?.code,
                            ].filter(Boolean).join(' ').toLowerCase();
                            return haystack.includes(q);
                          })
                        : allItems;
                      if (filtered.length === 0) {
                        return (
                          <div className="px-3 py-4 text-center text-[12px] text-slate-500 dark:text-slate-400">
                            {t('nothingFound')}
                          </div>
                        );
                      }
                      return filtered.slice(0, 100).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            setAccountId(a.id);
                            setAccountSearch(`${a.accountNo}${a.ownerName ? ' · ' + a.ownerName : ''}`);
                            setAccountOpen(false);
                          }}
                          className={cn(
                            'w-full text-left px-3 py-2 hover:bg-cyan-50 dark:hover:bg-cyan-950/40 transition-colors border-b border-slate-100 dark:border-slate-800 last:border-b-0',
                            accountId === a.id && 'bg-cyan-50 dark:bg-cyan-950/40',
                          )}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[9.5px] uppercase font-bold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
                              {a.bank?.name || '?'}
                            </span>
                            <span className="font-mono text-[12px] font-bold text-slate-800 dark:text-slate-200">{a.accountNo}</span>
                          </div>
                          {a.ownerName && (
                            <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 truncate">{a.ownerName}</div>
                          )}
                        </button>
                      ));
                    })()}
                  </div>
                </>
              )}
            </div>

            <div className="md:col-span-2">
              <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                {t('dateLabel')}
              </Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-10"
              />
            </div>

            <div className="md:col-span-4">
              <Label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                {t('docNumbers')}
              </Label>
              <Input
                type="text"
                value={nums}
                onChange={(e) => setNums(e.target.value)}
                placeholder="13142667, 13162958, 13162995"
                className="h-10 text-[12.5px] font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => { setResult(null); fetchMut.mutate(); }}
              disabled={!accountId || !date || fetchMut.isPending}
              className="h-10 px-5 gap-2 bg-gradient-to-br from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white"
            >
              {fetchMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {t('checkFromBank')}
            </Button>
            {result && (
              <Button variant="ghost" onClick={() => setResult(null)} className="text-slate-500 dark:text-slate-400">
                <X className="h-4 w-4 mr-1" /> {tc('clear')}
              </Button>
            )}
          </div>

          {result && result.ok && (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-600 text-white grid place-items-center">
                  <Database className="h-5 w-5" />
                </div>
                <div className="flex-1 grid grid-cols-3 gap-3 text-[12px]">
                  <div>
                    <div className="text-[9.5px] uppercase font-bold text-slate-500 dark:text-slate-400">{t('bankResponse')}</div>
                    <div className="text-[14px] font-black text-slate-800 dark:text-slate-200">{t('rowsCount', { n: result.totals?.fetched ?? 0 })}</div>
                  </div>
                  <div>
                    <div className="text-[9.5px] uppercase font-bold text-slate-500 dark:text-slate-400">{t('filterResults')}</div>
                    <div className="text-[14px] font-black text-cyan-700 dark:text-cyan-300">{t('matchCount', { n: result.totals?.matched ?? 0 })}</div>
                  </div>
                  <div>
                    <div className="text-[9.5px] uppercase font-bold text-slate-500 dark:text-slate-400">{tc('bank')}</div>
                    <div className="text-[12.5px] font-bold text-slate-700 dark:text-slate-300">{result.bank?.name}</div>
                  </div>
                </div>
              </div>

              {(result.errors?.length || 0) > 0 && (
                <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-3 py-2 text-[12px] text-rose-800 dark:text-rose-300">
                  <b>{t('errorsLabel')}</b> {result.errors!.join(' · ')}
                </div>
              )}

              {(result.items || []).length === 0 ? (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 px-4 py-6 text-center">
                  <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400 mx-auto mb-2" />
                  <div className="text-[13px] font-bold text-amber-800 dark:text-amber-300">
                    {t('noRowsInBank')}
                  </div>
                  <div className="text-[11.5px] text-amber-700 dark:text-amber-300 mt-1">
                    {t('mismatch')}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                  <table className="w-full text-[11.5px]">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      <tr>
                        <th className="px-3 py-2 text-left">{t('docNumberHeader')}</th>
                        <th className="px-3 py-2 text-left">{tc('date')}</th>
                        <th className="px-3 py-2 text-right">{tc('amount')}</th>
                        <th className="px-3 py-2 text-center">{t('directionHeader')}</th>
                        <th className="px-3 py-2 text-left">{t('senderHeader')}</th>
                        <th className="px-3 py-2 text-left">{t('compositeIdHeader')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items!.map((it, i: number) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800">
                          <td className="px-3 py-2 font-mono font-bold">{it.num}</td>
                          <td className="px-3 py-2">{it.ddate}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {new Intl.NumberFormat('ru-RU').format(it.amount)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={cn(
                              'px-1.5 py-0.5 rounded text-[9.5px] font-bold',
                              it.direction === 'IN' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
                            )}>
                              {it.direction === 'IN' ? t('inflow') : t('outflow')}
                            </span>
                          </td>
                          <td className="px-3 py-2 truncate max-w-[180px]" title={it.sender?.name || ''}>
                            {it.sender?.name || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] truncate max-w-[260px]" title={it.compositeId}>
                            {it.compositeId}
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(it.compositeId);
                                toast.success(t('compositeIdCopied'));
                              }}
                              className="ml-1 text-cyan-600 dark:text-cyan-400 hover:text-cyan-800 dark:hover:text-cyan-300"
                              title={tc('copy')}
                            >
                              📋
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {result && !result.ok && (
            <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-4 py-3 flex items-start gap-2.5">
              <X className="h-5 w-5 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
              <div className="text-[13px] text-rose-800 dark:text-rose-300">
                <div className="font-bold mb-0.5">{tc('error')}</div>
                <div className="text-rose-700 dark:text-rose-300">{result.error || t('unknownError')}</div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
