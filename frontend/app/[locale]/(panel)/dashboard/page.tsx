'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import {
  Wallet, Building2,
  RefreshCw, TrendingUp, ArrowRight, ChevronRight,
  Activity, AlertTriangle, CheckCircle2, XCircle, Clock,
  Filter, MoreHorizontal, Eye, AlertCircle, Zap, Server,
  Search, Download, ChevronDown, Settings2, Database,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/skeleton';
import { Input } from '@/components/ui/input';
import { DualAreaChart, DailyBarChart } from '@/components/charts';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

const BANK_COLORS = ['#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#8b5cf6'];

export default function DashboardPage() {
  const { locale } = useParams<{ locale: string }>();

  const { data: accounts, isLoading: accLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<{ items: any[] }>('/bank-accounts'),
  });
  const { data: stats } = useQuery({
    queryKey: ['stats-30d'],
    queryFn: () => {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      return api.get<any>(`/transactions/stats?from=${from.toISOString().slice(0, 10)}`);
    },
  });
  const { data: syncLogs } = useQuery({
    queryKey: ['sync-logs-dashboard'],
    queryFn: () => api.get<{ items: any[] }>('/sync/logs?limit=20'),
    refetchInterval: 30_000,
  });
  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });

  // ─── Kunma-kun kirim/chiqim diagrammasi ───
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'custom'>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [chartBankId, setChartBankId] = useState('all');
  const [chartAccountId, setChartAccountId] = useState('all');
  const [accSearch, setAccSearch] = useState('');

  const { from: chartFrom, to: chartTo } = useMemo(() => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    if (range === 'custom') return { from: customFrom, to: customTo };
    if (range === 'today') return { from: fmt(today), to: fmt(today) };
    const back = range === '7d' ? 6 : 29;
    const f = new Date(today);
    f.setDate(f.getDate() - back);
    return { from: fmt(f), to: fmt(today) };
  }, [range, customFrom, customTo]);

  const chartParams = new URLSearchParams();
  if (chartFrom) chartParams.set('from', chartFrom);
  if (chartTo) chartParams.set('to', chartTo);
  if (chartBankId !== 'all') chartParams.set('bankId', chartBankId);
  if (chartAccountId !== 'all') chartParams.set('accountId', chartAccountId);

  const { data: daily, isLoading: dailyLoading } = useQuery({
    queryKey: ['daily', chartFrom, chartTo, chartBankId, chartAccountId],
    queryFn: () => api.get<any>(`/transactions/daily?${chartParams}`),
    enabled: range !== 'custom' || (!!customFrom && !!customTo),
  });

  // Banklar — aktivlar boshida (chart filtri uchun)
  const sortedChartBanks = useMemo(() => {
    return [...(banks?.items || [])].sort((a: any, b: any) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [banks]);

  // Tanlangan bankka tegishli hisoblar (account filtri uchun) + qidiruv
  const chartAccounts = useMemo(() => {
    const all = accounts?.items || [];
    const byBank = chartBankId === 'all' ? all : all.filter((a: any) => a.bankId === chartBankId);
    const q = accSearch.trim().toLowerCase();
    if (!q) return byBank;
    return byBank.filter((a: any) =>
      a.accountNo?.toLowerCase().includes(q) ||
      a.ownerName?.toLowerCase().includes(q),
    );
  }, [accounts, chartBankId, accSearch]);

  const chartData = useMemo(() => {
    return (daily?.days || []).map((d: any) => ({
      label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`,
      inflow: Number(d.inflow || 0),
      outflow: Number(d.outflow || 0),
    }));
  }, [daily]);

  // Ustunli grafik uchun — kirim/chiqim/tranzaksiya soni
  const barData = useMemo(() => {
    return (daily?.days || []).map((d: any) => ({
      label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`,
      inflow: Number(d.inflow || 0),
      outflow: Number(d.outflow || 0),
      count: Number(d.count || 0),
    }));
  }, [daily]);

  // KPI computations
  const totalBalance = (accounts?.items || []).reduce((s, a) => s + Number(a.balance || 0), 0);
  const totalAccounts = accounts?.items?.length || 0;
  const inSum = (stats?.groups || []).filter((g: any) => g.direction === 'IN').reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const outSum = (stats?.groups || []).filter((g: any) => g.direction === 'OUT').reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const txnCount = stats?.total ?? (stats?.groups || []).reduce((s: number, g: any) => s + Number(typeof g._count === 'number' ? g._count : g._count?._all || 0), 0);
  const netFlow = inSum - outSum;

  const banksCount = new Set((accounts?.items || []).map((a: any) => a.bankId)).size;

  // By-bank breakdown
  const byBank = useMemo(() => {
    const map = new Map<string, { name: string; balance: number; accounts: number }>();
    for (const a of accounts?.items || []) {
      const id = a.bank?.id || 'unknown';
      const ex = map.get(id) || { name: a.bank?.name || '—', balance: 0, accounts: 0 };
      ex.balance += Number(a.balance || 0);
      ex.accounts += 1;
      map.set(id, ex);
    }
    return [...map.entries()].map(([id, v], i) => ({ id, ...v, color: BANK_COLORS[i % BANK_COLORS.length] }))
      .sort((a, b) => b.balance - a.balance);
  }, [accounts]);

  // Sync status
  const syncStats = useMemo(() => {
    const items = syncLogs?.items || [];
    const recent = items.slice(0, 10);
    const success = recent.filter((l) => l.status === 'SUCCESS').length;
    const failed = recent.filter((l) => l.status === 'FAILED').length;
    const partial = recent.filter((l) => l.status === 'PARTIAL').length;
    const running = recent.filter((l) => l.status === 'RUNNING').length;
    const successRate = recent.length > 0 ? Math.round((success / recent.length) * 100) : 100;
    return { success, failed, partial, running, total: recent.length, successRate };
  }, [syncLogs]);

  return (
    <>
      <Topbar
        title="Dashboard"
        subtitle={`${totalAccounts} hisob · ${banksCount} bank · oxirgi yangilanish: ${(accounts?.items?.[0]?.lastSyncedAt) ? formatDateTime(accounts.items[0].lastSyncedAt) : '—'}`}
      />

      <div className="flex-1 px-6 py-5 space-y-4 w-full">

        {/* ═══ KPI STRIP — Enterprise dense ═══ */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <DataTile label="Jami qoldiq" value={formatMoney(totalBalance).replace(' UZS', '')} unit="UZS" tone="primary" loading={accLoading} />
          <DataTile label="Hisoblar" value={String(totalAccounts)} unit="ta" />
          <DataTile label="Banklar" value={String(banksCount)} unit="ta" />
          <DataTile label="Kirim · 30 kun" value={formatMoney(inSum).replace(' UZS', '')} unit="UZS" tone="success" />
          <DataTile label="Chiqim · 30 kun" value={formatMoney(outSum).replace(' UZS', '')} unit="UZS" tone="danger" />
          <DataTile label="Tranzaksiya · 30 kun" value={String(txnCount)} unit="ta" />
        </div>

        {/* ═══ KUNMA-KUN KIRIM/CHIQIM DIAGRAMMASI ═══ */}
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          {/* Header + boshqaruv */}
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-slate-200 bg-slate-50/60">
            <div className="flex items-center gap-2 min-w-0">
              <div className="text-[12px] font-bold text-slate-900 tracking-tight">Kunma-kun kirim/chiqim</div>
              <div className="text-[10px] text-slate-500 truncate">· {chartFrom || '—'} → {chartTo || '—'}</div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Bank filtri — aktivlar boshida, effekt bilan */}
              <Select
                value={chartBankId}
                onValueChange={(v) => { setChartBankId(v); setChartAccountId('all'); }}
              >
                <SelectTrigger className="h-8 text-[11px] w-auto min-w-[130px] bg-white border-slate-200">
                  <SelectValue placeholder="Hamma banklar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hamma banklar</SelectItem>
                  {sortedChartBanks.filter((b: any) => b.isActive).map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="flex items-center gap-1.5">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                        </span>
                        {b.name}
                      </span>
                    </SelectItem>
                  ))}
                  {sortedChartBanks.filter((b: any) => !b.isActive).length > 0 && (
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 font-semibold border-t border-slate-100 mt-1">
                      Aktiv emas
                    </div>
                  )}
                  {sortedChartBanks.filter((b: any) => !b.isActive).map((b: any) => (
                    <SelectItem key={b.id} value={b.id} className="text-slate-400">{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Hisob filtri — qidiruv bilan */}
              <Select value={chartAccountId} onValueChange={setChartAccountId}>
                <SelectTrigger className="h-8 text-[11px] w-auto min-w-[150px] bg-white border-slate-200">
                  <SelectValue placeholder="Hamma hisoblar" />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-1.5 pt-1.5 pb-1 sticky top-0 bg-white z-10">
                    <Input
                      value={accSearch}
                      onChange={(e) => setAccSearch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder="Hisob raqami yoki egasi..."
                      className="h-8 text-[11px]"
                    />
                  </div>
                  <SelectItem value="all">Hamma hisoblar</SelectItem>
                  {chartAccounts.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-slate-400">Topilmadi</div>
                  ) : (
                    chartAccounts.slice(0, 100).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.accountNo} {a.ownerName ? `· ${a.ownerName}` : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>

              {/* Sana oralig'i presetlari */}
              <div className="flex items-center bg-white border border-slate-200 rounded overflow-hidden">
                <RangeBtn active={range === 'today'} onClick={() => setRange('today')}>Bugun</RangeBtn>
                <RangeBtn active={range === '7d'} onClick={() => setRange('7d')}>7 kun</RangeBtn>
                <RangeBtn active={range === '30d'} onClick={() => setRange('30d')}>30 kun</RangeBtn>
                <RangeBtn active={range === 'custom'} onClick={() => setRange('custom')}>Sana</RangeBtn>
              </div>

              {/* Custom sana oralig'i */}
              {range === 'custom' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-8 text-[11px] px-2 bg-white border border-slate-200 rounded outline-none focus:border-blue-400"
                  />
                  <span className="text-slate-400 text-[11px]">→</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-8 text-[11px] px-2 bg-white border border-slate-200 rounded outline-none focus:border-blue-400"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Body: jami + grafik */}
          <div className="p-4">
            {/* Jami kirim/chiqim/sof */}
            <div className="flex items-center gap-5 mb-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Kirim</span>
                <span className="text-[13px] font-bold tabular-nums text-emerald-700">
                  {formatMoney(Number(daily?.totalIn || 0)).replace(' UZS', '')}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Chiqim</span>
                <span className="text-[13px] font-bold tabular-nums text-rose-700">
                  {formatMoney(Number(daily?.totalOut || 0)).replace(' UZS', '')}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Sof oqim</span>
                <span className={cn(
                  "text-[13px] font-bold tabular-nums",
                  Number(daily?.net || 0) >= 0 ? "text-emerald-700" : "text-rose-700",
                )}>
                  {Number(daily?.net || 0) >= 0 ? '+' : ''}{formatMoney(Number(daily?.net || 0)).replace(' UZS', '')}
                </span>
              </div>
            </div>

            {/* Grafik */}
            {range === 'custom' && (!customFrom || !customTo) ? (
              <div className="h-[260px] grid place-items-center text-xs text-slate-400">
                Sana oralig'ini tanlang
              </div>
            ) : dailyLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <DualAreaChart data={chartData} height={260} />
            )}

            {/* Ustunli grafik — yopiq holatda, bosilganda ochiladi */}
            {!(range === 'custom' && (!customFrom || !customTo)) && !dailyLoading && (
              <details className="group mt-3 pt-3 border-t border-slate-100">
                <summary className="cursor-pointer select-none flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                  Kunma-kun ustunli grafik — kirim / chiqim / tranzaksiya soni
                </summary>
                <div className="mt-3">
                  <DailyBarChart data={barData} height={280} />
                </div>
              </details>
            )}
          </div>
        </div>

        {/* ═══ MAIN GRID: 3 columns ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* ═══ LEFT: Transactions table (8 cols) ═══ */}
          <div className="lg:col-span-8 space-y-4">

            {/* Top accounts table */}
            <DataPanel
              title="Eng katta hisoblar"
              count={totalAccounts}
              collapsible
            >
              {accLoading ? (
                <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : totalAccounts === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">Hisoblar yo'q</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200">
                        <th className="text-left px-3 py-2">Bank · Hisob raqami</th>
                        <th className="text-left px-3 py-2 w-24">MFO</th>
                        <th className="text-right px-3 py-2 w-32">Qoldiq</th>
                        <th className="text-left px-3 py-2 w-20">Status</th>
                        <th className="text-left px-3 py-2 w-32">Oxirgi sync</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(accounts!.items as any[])
                        .slice()
                        .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
                        .slice(0, 8)
                        .map((a) => {
                          const colorIdx = byBank.findIndex((b) => b.id === a.bankId);
                          const color = BANK_COLORS[colorIdx >= 0 ? colorIdx : 0];
                          return (
                            <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className="w-1 h-6 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-900 truncate">{a.bank?.name || '—'}</div>
                                    <div className="font-mono text-[10px] text-slate-500 truncate">{a.accountNo}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{a.branch}</td>
                              <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                                {formatMoney(Number(a.balance || 0), a.currency)}
                              </td>
                              <td className="px-3 py-2">
                                <span className={cn(
                                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border",
                                  a.syncEnabled
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-slate-50 text-slate-500 border-slate-200",
                                )}>
                                  <span className={cn("w-1 h-1 rounded-full", a.syncEnabled ? "bg-emerald-500" : "bg-slate-300")} />
                                  {a.syncEnabled ? 'ON' : 'OFF'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-[11px] text-slate-600 tabular-nums">
                                {a.lastSyncedAt ? formatDateTime(a.lastSyncedAt) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </DataPanel>

          </div>

          {/* ═══ RIGHT: System health panels (4 cols) ═══ */}
          <div className="lg:col-span-4 space-y-4">

            {/* Sync status */}
            <DataPanel title="Sync holati" subtitle="oxirgi 10 ta operatsiya" collapsible>
              <div className="px-4 py-3 space-y-3">
                {/* Big % */}
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">{syncStats.successRate}%</div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Muvaffaqiyat</div>
                  </div>
                  <Link href={`/${locale}/admin/sync-logs`}>
                    <button className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                      Tafsilot <ChevronRight className="h-3 w-3" />
                    </button>
                  </Link>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 bg-slate-100 rounded-sm overflow-hidden flex">
                  <div className="bg-emerald-500 transition-all" style={{ width: `${(syncStats.success / Math.max(1, syncStats.total)) * 100}%` }} />
                  <div className="bg-amber-500 transition-all" style={{ width: `${(syncStats.partial / Math.max(1, syncStats.total)) * 100}%` }} />
                  <div className="bg-rose-500 transition-all" style={{ width: `${(syncStats.failed / Math.max(1, syncStats.total)) * 100}%` }} />
                  <div className="bg-blue-500 transition-all" style={{ width: `${(syncStats.running / Math.max(1, syncStats.total)) * 100}%` }} />
                </div>

                {/* Counts */}
                <div className="grid grid-cols-4 gap-2 text-center pt-1">
                  <Mini label="OK" value={syncStats.success} tone="emerald" />
                  <Mini label="Qisman" value={syncStats.partial} tone="amber" />
                  <Mini label="Xato" value={syncStats.failed} tone="rose" />
                  <Mini label="Run" value={syncStats.running} tone="blue" />
                </div>
              </div>
            </DataPanel>

            {/* Banks breakdown */}
            <DataPanel title="Banklar bo'yicha taqsimot" subtitle={`${byBank.length} ta bank`} collapsible>
              {byBank.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">Banklar yo'q</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {byBank.map((b) => {
                    const pct = totalBalance > 0 ? (b.balance / totalBalance) * 100 : 0;
                    return (
                      <div key={b.id} className="px-4 py-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: b.color }} />
                            <span className="text-[12px] font-semibold text-slate-900 truncate">{b.name}</span>
                            <span className="text-[10px] text-slate-500 shrink-0">{b.accounts} hsb</span>
                          </div>
                          <span className="text-[11px] font-bold tabular-nums text-slate-700">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1 bg-slate-100 rounded-sm overflow-hidden">
                            <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: b.color }} />
                          </div>
                          <span className="text-[10px] tabular-nums text-slate-600 font-mono w-24 text-right">
                            {formatMoney(b.balance).replace(' UZS', '')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </DataPanel>

            {/* Recent failures alerts */}
            {syncStats.failed > 0 && (
              <DataPanel title="Diqqat" subtitle={`${syncStats.failed} ta sync xatosi`} tone="warning">
                <div className="divide-y divide-slate-100">
                  {(syncLogs?.items || []).filter((l) => l.status === 'FAILED').slice(0, 3).map((l) => (
                    <Link key={l.id} href={`/${locale}/admin/sync-logs`} className="block">
                      <div className="px-4 py-2.5 hover:bg-slate-50 transition-colors">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-semibold text-slate-900 truncate">{l.source}</div>
                            <div className="text-[10px] text-slate-500 line-clamp-2">{l.errorMessage}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">{formatDateTime(l.startedAt)}</div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </DataPanel>
            )}

            {/* Net flow widget */}
            <DataPanel title="Sof pul oqimi · 30 kun" collapsible>
              <div className="px-4 py-3">
                <div className={cn(
                  "text-3xl font-bold tabular-nums tracking-tight",
                  netFlow >= 0 ? "text-emerald-700" : "text-rose-700",
                )}>
                  {netFlow >= 0 ? '+' : ''}{formatMoney(netFlow).replace(' UZS', '')}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mt-0.5">UZS</div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
                  <div className="rounded bg-emerald-50 border border-emerald-200 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-emerald-700 font-bold">Kirim</div>
                    <div className="font-semibold tabular-nums text-emerald-900">{formatMoney(inSum).replace(' UZS', '')}</div>
                  </div>
                  <div className="rounded bg-rose-50 border border-rose-200 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-rose-700 font-bold">Chiqim</div>
                    <div className="font-semibold tabular-nums text-rose-900">{formatMoney(outSum).replace(' UZS', '')}</div>
                  </div>
                </div>
              </div>
            </DataPanel>

          </div>
        </div>
      </div>
    </>
  );
}

// ────────────── Components ──────────────

function DataTile({
  label, value, unit, tone, loading,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'primary' | 'success' | 'danger';
  loading?: boolean;
}) {
  const t = {
    primary: 'text-slate-900',
    success: 'text-emerald-700',
    danger: 'text-rose-700',
  }[tone || 'primary'];
  return (
    <div className="bg-white border border-slate-200 rounded px-3 py-2.5 hover:border-slate-300 transition-colors">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1 truncate">{label}</div>
      {loading ? (
        <Skeleton className="h-6 w-24" />
      ) : (
        <div className="flex items-baseline gap-1">
          <div className={cn("text-lg font-bold tracking-tight tabular-nums truncate", t)}>{value}</div>
          {unit && <div className="text-[10px] text-slate-500 font-medium">{unit}</div>}
        </div>
      )}
    </div>
  );
}

function DataPanel({
  title, subtitle, count, actions, children, tone, collapsible, defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  tone?: 'warning' | 'danger';
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headBg = tone === 'warning' ? 'bg-amber-50/40 border-amber-200' : tone === 'danger' ? 'bg-rose-50/40 border-rose-200' : 'bg-white border-slate-200';

  const head = (
    <div className="flex items-center gap-2 min-w-0">
      {collapsible && (
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform duration-300", open && "rotate-180")} />
      )}
      <div className="text-[12px] font-bold text-slate-900 tracking-tight truncate">{title}</div>
      {count !== undefined && (
        <span className="text-[10px] font-semibold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded tabular-nums">
          {count}
        </span>
      )}
      {subtitle && <div className="text-[10px] text-slate-500 truncate">· {subtitle}</div>}
    </div>
  );

  return (
    <div className={cn("bg-white border rounded overflow-hidden", headBg)}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50/60">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex-1 min-w-0 text-left hover:opacity-70 transition-opacity"
          >
            {head}
          </button>
        ) : head}
        {actions}
      </div>
      {collapsible ? (
        <div className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}>
          <div className="overflow-hidden">
            <div className="bg-white">{children}</div>
          </div>
        </div>
      ) : (
        <div className="bg-white">{children}</div>
      )}
    </div>
  );
}

function RangeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 h-8 text-[11px] font-semibold transition-colors border-r border-slate-200 last:border-r-0",
        active ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'rose' | 'blue' }) {
  const c = {
    emerald: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
    amber:   { dot: 'bg-amber-500',   text: 'text-amber-700' },
    rose:    { dot: 'bg-rose-500',    text: 'text-rose-700' },
    blue:    { dot: 'bg-blue-500',    text: 'text-blue-700' },
  }[tone];
  return (
    <div className="text-center">
      <div className={cn("text-[14px] font-bold tabular-nums", c.text)}>{value}</div>
      <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
        <span className={cn("w-1 h-1 rounded-full", c.dot)} />
        {label}
      </div>
    </div>
  );
}
