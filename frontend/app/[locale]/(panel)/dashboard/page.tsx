'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, Wallet, Building2,
  RefreshCw, TrendingUp, ArrowRight, ChevronRight,
  Activity, AlertTriangle, CheckCircle2, XCircle, Clock,
  Filter, MoreHorizontal, Eye, AlertCircle, Zap, Server,
  Search, Download, ChevronDown, Settings2, Database,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/skeleton';
import { OnboardingCard } from '@/components/onboarding-card';
import { api } from '@/lib/api';
import { cn, formatDateTime, formatMoney, formatDate } from '@/lib/utils';

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
  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ['recent'],
    queryFn: () => api.get<{ items: any[]; total: number }>('/transactions?perPage=12'),
  });
  const { data: syncLogs } = useQuery({
    queryKey: ['sync-logs-dashboard'],
    queryFn: () => api.get<{ items: any[] }>('/sync/logs?limit=20'),
    refetchInterval: 30_000,
  });

  // KPI computations
  const totalBalance = (accounts?.items || []).reduce((s, a) => s + Number(a.balance || 0), 0);
  const totalAccounts = accounts?.items?.length || 0;
  const inSum = (stats?.groups || []).filter((g: any) => g.direction === 'IN').reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const outSum = (stats?.groups || []).filter((g: any) => g.direction === 'OUT').reduce((s: number, g: any) => s + Number(g._sum?.amount || 0), 0);
  const txnCount = stats?.total ?? (stats?.groups || []).reduce((s: number, g: any) => s + Number(typeof g._count === 'number' ? g._count : g._count?._all || 0), 0);
  const netFlow = inSum - outSum;

  const isEmpty = totalAccounts === 0;
  const banksCount = new Set((accounts?.items || []).map((a: any) => a.bankId)).size;
  const credentialsCount = new Set((accounts?.items || []).map((a: any) => a.credentialId)).size;

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

        {/* ═══ ONBOARDING for empty state ═══ */}
        {isEmpty && (
          <OnboardingCard banksCount={banksCount} credentialsCount={credentialsCount} accountsCount={totalAccounts} />
        )}

        {/* ═══ MAIN GRID: 3 columns ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* ═══ LEFT: Transactions table (8 cols) ═══ */}
          <div className="lg:col-span-8 space-y-4">

            {/* Recent transactions table */}
            <DataPanel
              title="Oxirgi tranzaksiyalar"
              count={recent?.total}
              actions={
                <Link href={`/${locale}/transactions`}>
                  <button className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                    Barchasi <ChevronRight className="h-3 w-3" />
                  </button>
                </Link>
              }
            >
              {recentLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
                </div>
              ) : (recent?.items || []).length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">Tranzaksiyalar yo'q</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200">
                        <th className="text-left px-3 py-2 w-32">Sana</th>
                        <th className="text-left px-3 py-2 w-20">Yo'nalish</th>
                        <th className="text-left px-3 py-2">Kontragent</th>
                        <th className="text-left px-3 py-2 w-32">Bank</th>
                        <th className="text-right px-3 py-2 w-32">Summa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recent!.items.slice(0, 10).map((it: any) => {
                        const counterparty = it.direction === 'IN' ? it.fromName : it.toName;
                        return (
                          <tr key={it.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-2 whitespace-nowrap">
                              <div className="tabular-nums text-slate-700">{formatDate(it.txnDate)}</div>
                              <div className="text-[10px] text-slate-500 tabular-nums">
                                {it.operationTime
                                  ? it.operationTime.slice(0, 5)
                                  : new Date(it.txnDate).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border",
                                it.direction === 'IN'
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-rose-50 text-rose-700 border-rose-200",
                              )}>
                                {it.direction === 'IN' ? <ArrowDownLeft className="h-2.5 w-2.5" /> : <ArrowUpRight className="h-2.5 w-2.5" />}
                                {it.direction === 'IN' ? 'IN' : 'OUT'}
                              </span>
                            </td>
                            <td className="px-3 py-2 max-w-[280px]">
                              <div className="truncate font-medium text-slate-900">{counterparty || '—'}</div>
                              <div className="font-mono text-[10px] text-slate-500 truncate">
                                {it.direction === 'IN' ? it.fromInn : it.toAccount || ''}
                              </div>
                            </td>
                            <td className="px-3 py-2 max-w-[140px] truncate text-slate-700">{it.account?.bank?.name || '—'}</td>
                            <td className={cn(
                              "px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap",
                              it.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700',
                            )}>
                              {it.direction === 'IN' ? '+' : '−'}{formatMoney(it.amount, it.currency)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </DataPanel>

            {/* Top accounts table */}
            <DataPanel
              title="Eng katta hisoblar"
              count={totalAccounts}
              actions={
                <Link href={`/${locale}/setup/accounts`}>
                  <button className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                    Barchasi <ChevronRight className="h-3 w-3" />
                  </button>
                </Link>
              }
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
            <DataPanel title="Sync holati" subtitle="oxirgi 10 ta operatsiya">
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
            <DataPanel title="Banklar bo'yicha taqsimot" subtitle={`${byBank.length} ta bank`}>
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
            <DataPanel title="Sof pul oqimi · 30 kun">
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
  title, subtitle, count, actions, children, tone,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  tone?: 'warning' | 'danger';
}) {
  const headBg = tone === 'warning' ? 'bg-amber-50/40 border-amber-200' : tone === 'danger' ? 'bg-rose-50/40 border-rose-200' : 'bg-white border-slate-200';
  return (
    <div className={cn("bg-white border rounded overflow-hidden", headBg)}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50/60">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[12px] font-bold text-slate-900 tracking-tight truncate">{title}</div>
          {count !== undefined && (
            <span className="text-[10px] font-semibold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded tabular-nums">
              {count}
            </span>
          )}
          {subtitle && <div className="text-[10px] text-slate-500 truncate">· {subtitle}</div>}
        </div>
        {actions}
      </div>
      <div className="bg-white">{children}</div>
    </div>
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
