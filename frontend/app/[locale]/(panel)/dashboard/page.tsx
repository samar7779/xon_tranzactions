'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useRef } from 'react';
import {
  Wallet, Building2, BarChart3,
  RefreshCw, TrendingUp, ArrowRight, ChevronRight,
  Activity, AlertTriangle, CheckCircle2, XCircle, Clock,
  Filter, MoreHorizontal, Eye, AlertCircle, Zap, Server,
  Search, Download, ChevronDown, Settings2, Database,
  Coins, RotateCcw, EyeOff, Pin, Gauge,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/skeleton';
import { Input } from '@/components/ui/input';
import { DualAreaChart, DailyBarChart } from '@/components/charts';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog';
import { api, apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@/lib/permissions';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';
import { DailySummaryWidget } from '@/components/daily-summary-widget';

const BANK_COLORS = ['#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#8b5cf6'];

export default function DashboardPage() {
  const { locale } = useParams<{ locale: string }>();
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');

  // ─── Ruxsatlar — har bo'lim alohida (ruxsat bo'lmasa ko'rinmaydi + ma'lumot yuklanmaydi) ───
  const user = useAuth((s) => s.user);
  const has = (p: string) => !!user?.permissions?.includes(p);
  // Umumiy so'rovlar bir nechta bo'limga xizmat qiladi — kamida bittasi ruxsatli bo'lsa yuklanadi
  const needAccounts = has(PERMS.DASHBOARD_KPI_BALANCE) || has(PERMS.DASHBOARD_KPI_ACCOUNTS)
    || has(PERMS.DASHBOARD_KPI_BANKS) || has(PERMS.DASHBOARD_TOP_ACCOUNTS)
    || has(PERMS.DASHBOARD_BANKS_BREAKDOWN) || has(PERMS.DASHBOARD_DAILY) || has(PERMS.DASHBOARD_CLIENT)
    || has(PERMS.DASHBOARD_NET_FLOW);
  const needStats = has(PERMS.DASHBOARD_KPI_INFLOW) || has(PERMS.DASHBOARD_KPI_OUTFLOW)
    || has(PERMS.DASHBOARD_KPI_TXN) || has(PERMS.DASHBOARD_NET_FLOW);
  const needBanks = has(PERMS.DASHBOARD_DAILY) || has(PERMS.DASHBOARD_CLIENT);
  const needDaily = has(PERMS.DASHBOARD_DAILY) || has(PERMS.DASHBOARD_DAILY_BAR);

  const { data: accounts, isLoading: accLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<{ items: any[] }>('/bank-accounts'),
    enabled: needAccounts,
  });
  const { data: stats } = useQuery({
    queryKey: ['stats-30d'],
    queryFn: () => {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      return api.get<any>(`/transactions/stats?from=${from.toISOString().slice(0, 10)}`);
    },
    enabled: needStats,
  });
  const { data: syncLogs } = useQuery({
    queryKey: ['sync-logs-dashboard'],
    queryFn: () => api.get<{ items: any[] }>('/sync/logs?limit=20'),
    refetchInterval: 30_000,
    enabled: has(PERMS.DASHBOARD_SYNC_STATUS),
  });
  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
    enabled: needBanks,
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
    enabled: needDaily && (range !== 'custom' || (!!customFrom && !!customTo)),
  });

  // ─── Obyektlar bo'yicha to'lovlar (ОплатыКв) — jadval hisoboti ───
  const [objOpen, setObjOpen] = useState(true);
  const [objMode, setObjMode] = useState<'normal' | 'refund'>('normal');
  const [objInclSchotchik, setObjInclSchotchik] = useState(false);  // "За счетчик" ni hisobga qo'shish
  const [objRange, setObjRange] = useState<'today' | '7d' | '30d' | 'custom'>('30d');
  const [objCustomFrom, setObjCustomFrom] = useState('');
  const [objCustomTo, setObjCustomTo] = useState('');
  const { from: objFrom, to: objTo } = useMemo(() => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    if (objRange === 'custom') return { from: objCustomFrom, to: objCustomTo };
    if (objRange === 'today') return { from: fmt(today), to: fmt(today) };
    const back = objRange === '7d' ? 6 : 29;
    const f = new Date(today);
    f.setDate(f.getDate() - back);
    return { from: fmt(f), to: fmt(today) };
  }, [objRange, objCustomFrom, objCustomTo]);

  interface ObjRow { object: string; paymentAmount: number; firstInstallment: number; monthlyAmount: number; count: number }
  const { data: objReport, isLoading: objLoading } = useQuery({
    queryKey: ['oplata-by-object', objFrom, objTo, objMode, objInclSchotchik],
    queryFn: () => {
      const p = new URLSearchParams();
      if (objFrom) p.set('dateFrom', objFrom);
      if (objTo) p.set('dateTo', objTo);
      p.set('mode', objMode);
      if (objInclSchotchik) p.set('includeSchotchik', '1');
      return api.get<{ ok: boolean; rows: ObjRow[]; total: ObjRow }>(`/oplata-kv/by-object?${p}`);
    },
    enabled: has(PERMS.DASHBOARD_OBJECTS) && (objRange !== 'custom' || (!!objCustomFrom && !!objCustomTo)),
  });

  // Ustunlarni yashirish (secret) — "1 взнос" / "ежемесячный"
  const [objHidden, setObjHidden] = useState<{ first: boolean; monthly: boolean }>({ first: false, monthly: false });
  // Qatorni tepaga qadab qo'yish (ustiga bosilganda) — eng oxirgi bosilgani eng tepada
  const [objPinned, setObjPinned] = useState<string[]>([]);
  const toggleObjPin = (obj: string) =>
    setObjPinned((prev) => (prev.includes(obj) ? prev.filter((o) => o !== obj) : [obj, ...prev]));
  // Drill-down: obyekt to'lov summasiga bosilganda — o'sha to'lovlar modalda
  const [objDetail, setObjDetail] = useState<string | null>(null);

  const objSortedRows = useMemo(() => {
    const rows = objReport?.rows || [];
    if (objPinned.length === 0) return rows;
    const order = new Map(objPinned.map((o, i) => [o, i]));
    return [...rows].sort((a, b) => {
      const pa = order.has(a.object) ? (order.get(a.object) as number) : Infinity;
      const pb = order.has(b.object) ? (order.get(b.object) as number) : Infinity;
      return pa - pb; // pinned'lar bosilish tartibida tepada, qolganlari o'z joyida
    });
  }, [objReport, objPinned]);
  const mask = (n: number) => n.toLocaleString('ru-RU');

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

  // ISO sanadan: dam olish kuni (shanba/yakshanba)mi?
  const isWeekend = (iso: string) => {
    const [y, m, dd] = iso.split('-').map(Number);
    const wd = new Date(y, m - 1, dd).getDay();
    return wd === 0 || wd === 6;
  };

  const chartData = useMemo(() => {
    return (daily?.days || []).map((d: any) => ({
      label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`,
      inflow: Number(d.inflow || 0),
      outflow: Number(d.outflow || 0),
      weekend: isWeekend(d.date),
    }));
  }, [daily]);

  // Ustunli grafik uchun — kirim/chiqim/tranzaksiya soni
  const barData = useMemo(() => {
    return (daily?.days || []).map((d: any) => ({
      label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`,
      inflow: Number(d.inflow || 0),
      outflow: Number(d.outflow || 0),
      count: Number(d.count || 0),
      weekend: isWeekend(d.date),
    }));
  }, [daily]);

  // ─── 4 ta grafik kartasi uchun collapse holatlari (default: yashirin) ───
  const [kunmaOpen, setKunmaOpen] = useState(false);
  const [kunmaBarOpen, setKunmaBarOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [xonpayOpen, setXonpayOpen] = useState(false);

  // Ref'lar — PNG eksport uchun (faqat grafik DOM tugun)
  const kunmaChartRef = useRef<HTMLDivElement>(null);
  const kunmaBarChartRef = useRef<HTMLDivElement>(null);
  const clientChartRef = useRef<HTMLDivElement>(null);
  const xonpayChartRef = useRef<HTMLDivElement>(null);

  // ─── KLIENT TO'LOVLARI (CLIENT kategoriya) — mustaqil grafik ───
  const [cliRange, setCliRange] = useState<'today' | '7d' | '30d' | 'custom'>('30d');
  const [cliCustomFrom, setCliCustomFrom] = useState('');
  const [cliCustomTo, setCliCustomTo] = useState('');
  const [cliBankId, setCliBankId] = useState('all');
  const [cliAccountId, setCliAccountId] = useState('all');
  const [cliAccSearch, setCliAccSearch] = useState('');
  const [cliSubCode, setCliSubCode] = useState<string>('__all__');

  const { from: cliFrom, to: cliTo } = useMemo(() => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    if (cliRange === 'custom') return { from: cliCustomFrom, to: cliCustomTo };
    if (cliRange === 'today') return { from: fmt(today), to: fmt(today) };
    const back = cliRange === '7d' ? 6 : 29;
    const f = new Date(today);
    f.setDate(f.getDate() - back);
    return { from: fmt(f), to: fmt(today) };
  }, [cliRange, cliCustomFrom, cliCustomTo]);

  const cliParams = new URLSearchParams();
  if (cliFrom) cliParams.set('from', cliFrom);
  if (cliTo) cliParams.set('to', cliTo);
  if (cliBankId !== 'all') cliParams.set('bankId', cliBankId);
  if (cliAccountId !== 'all') cliParams.set('accountId', cliAccountId);
  cliParams.set('categoryCode', 'CLIENT');

  const { data: clientDaily, isLoading: clientLoading } = useQuery({
    queryKey: ['daily-client', cliFrom, cliTo, cliBankId, cliAccountId],
    queryFn: () => api.get<any>(`/transactions/daily?${cliParams}`),
    enabled: has(PERMS.DASHBOARD_CLIENT) && (cliRange !== 'custom' || (!!cliCustomFrom && !!cliCustomTo)),
  });

  // Tanlangan bankka tegishli hisoblar (klient filtri uchun)
  const cliChartAccounts = useMemo(() => {
    const all = accounts?.items || [];
    const byBank = cliBankId === 'all' ? all : all.filter((a: any) => a.bankId === cliBankId);
    const q = cliAccSearch.trim().toLowerCase();
    if (!q) return byBank;
    return byBank.filter((a: any) =>
      a.accountNo?.toLowerCase().includes(q) ||
      a.ownerName?.toLowerCase().includes(q),
    );
  }, [accounts, cliBankId, cliAccSearch]);

  // Tanlangan subkategoriya bo'yicha (yoki hammasi) — kunma-kun chart data
  const clientChartData = useMemo(() => {
    const days = clientDaily?.days || [];
    if (cliSubCode === '__all__') {
      return days.map((d: any) => ({
        label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`,
        inflow: Number(d.inflow || 0),
        outflow: Number(d.outflow || 0),
        weekend: isWeekend(d.date),
      }));
    }
    return days.map((d: any) => {
      const sub = (d.bySub || {})[cliSubCode] || { inflow: 0, outflow: 0 };
      return {
        label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`,
        inflow: Number(sub.inflow || 0),
        outflow: Number(sub.outflow || 0),
        weekend: isWeekend(d.date),
      };
    });
  }, [clientDaily, cliSubCode]);

  // Tanlangan sub bo'yicha jami (yoki hammasi)
  const clientTotals = useMemo(() => {
    if (cliSubCode === '__all__') {
      return {
        totalIn: Number(clientDaily?.totalIn || 0),
        totalOut: Number(clientDaily?.totalOut || 0),
        net: Number(clientDaily?.net || 0),
      };
    }
    const sub = (clientDaily?.subcategories || []).find((s: any) => s.code === cliSubCode);
    const ti = Number(sub?.totalIn || 0);
    const to = Number(sub?.totalOut || 0);
    return { totalIn: ti, totalOut: to, net: ti - to };
  }, [clientDaily, cliSubCode]);

  // ─── XONPAY DEBITOR — XonPay'da ro'yxatda lekin bankka kelmagan to'lovlar ───
  // XonPay default — kechagi sana (today-1). XonPay'da bugungi to'lov hali to'liq
  // sinxron bo'lmagan, shu sababli 'kecha' eng so'nggi to'liq ma'lumotni beradi.
  const [xonpayRange, setXonpayRange] = useState<'yesterday' | '7d' | '30d' | 'custom'>('yesterday');
  const [xonpayCustomFrom, setXonpayCustomFrom] = useState('');
  const [xonpayCustomTo, setXonpayCustomTo] = useState('');

  const { from: xonpayFrom, to: xonpayTo } = useMemo(() => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    if (xonpayRange === 'custom') return { from: xonpayCustomFrom, to: xonpayCustomTo };
    if (xonpayRange === 'yesterday') {
      const yest = new Date(today);
      yest.setDate(yest.getDate() - 1);
      return { from: fmt(yest), to: fmt(yest) };
    }
    const back = xonpayRange === '7d' ? 6 : 29;
    const f = new Date(today);
    f.setDate(f.getDate() - back);
    return { from: fmt(f), to: fmt(today) };
  }, [xonpayRange, xonpayCustomFrom, xonpayCustomTo]);

  const { data: xonpayDaily, isLoading: xonpayLoading } = useQuery({
    queryKey: ['xonpay-daily', xonpayFrom, xonpayTo],
    queryFn: () => {
      const p = new URLSearchParams();
      if (xonpayFrom) p.set('dateFrom', xonpayFrom);
      if (xonpayTo) p.set('dateTo', xonpayTo);
      return api.get<any>(`/xonpay/stats/daily?${p}`);
    },
    enabled: has(PERMS.DASHBOARD_XONPAY) && (xonpayRange !== 'custom' || (!!xonpayCustomFrom && !!xonpayCustomTo)),
  });

  // Chart uchun (matched=yashil, missing=qizil sof debitor)
  const xonpayChartData = useMemo(() => {
    const days = xonpayDaily?.days || [];
    // dailyStats teskari tartibda qaytaradi (eng yangi tepada); biz xronologik qilamiz
    return [...days].reverse().map((d: any) => ({
      label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`,
      // 'inflow' = matched (bankka kelgan), 'outflow' = missing (debitor)
      inflow: Number(d.matchedAmount || 0),
      outflow: Number(d.missingAmount || 0),
      weekend: isWeekend(d.date),
    }));
  }, [xonpayDaily]);

  const xonpayTotals = useMemo(() => {
    const days = xonpayDaily?.days || [];
    let total = 0, matched = 0, missing = 0;
    let totalCount = 0, matchedCount = 0, missingCount = 0;
    for (const d of days) {
      total += Number(d.totalAmount || 0);
      matched += Number(d.matchedAmount || 0);
      missing += Number(d.missingAmount || 0);
      totalCount += Number(d.totalCount || 0);
      matchedCount += Number(d.matchedCount || 0);
      missingCount += Number(d.missingCount || 0);
    }
    return { total, matched, missing, totalCount, matchedCount, missingCount };
  }, [xonpayDaily]);

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
        title={t('title')}
        subtitle={t('subtitle', {
          accounts: totalAccounts,
          banks: banksCount,
          lastSync: (accounts?.items?.[0]?.lastSyncedAt) ? formatDateTime(accounts.items[0].lastSyncedAt) : '—',
        })}
      />

      <div className="flex-1 px-3 sm:px-6 py-4 sm:py-5 space-y-4 w-full">

        {/* ═══ KPI STRIP — Enterprise dense (har karta alohida ruxsat) ═══ */}
        {(has(PERMS.DASHBOARD_KPI_BALANCE) || has(PERMS.DASHBOARD_KPI_ACCOUNTS) || has(PERMS.DASHBOARD_KPI_BANKS)
          || has(PERMS.DASHBOARD_KPI_INFLOW) || has(PERMS.DASHBOARD_KPI_OUTFLOW) || has(PERMS.DASHBOARD_KPI_TXN)) && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {has(PERMS.DASHBOARD_KPI_BALANCE) && <DataTile label={t('totalBalance')} value={formatMoney(totalBalance).replace(' UZS', '')} unit="UZS" tone="primary" loading={accLoading} />}
            {has(PERMS.DASHBOARD_KPI_ACCOUNTS) && <DataTile label={t('accountsLabel')} value={String(totalAccounts)} />}
            {has(PERMS.DASHBOARD_KPI_BANKS) && <DataTile label={t('banksLabel')} value={String(banksCount)} />}
            {has(PERMS.DASHBOARD_KPI_INFLOW) && <DataTile label={t('inflow30')} value={formatMoney(inSum).replace(' UZS', '')} unit="UZS" tone="success" />}
            {has(PERMS.DASHBOARD_KPI_OUTFLOW) && <DataTile label={t('outflow30')} value={formatMoney(outSum).replace(' UZS', '')} unit="UZS" tone="danger" />}
            {has(PERMS.DASHBOARD_KPI_TXN) && <DataTile label={t('txn30')} value={String(txnCount)} />}
          </div>
        )}

        {/* ═══ OBYEKTLAR BO'YICHA TO'LOVLAR (ОплатыКв) ═══ */}
        {has(PERMS.DASHBOARD_OBJECTS) && (<>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setObjOpen((o) => !o)}
              className="flex items-center gap-2 min-w-0 hover:opacity-75 transition-opacity"
            >
              <ChevronDown className={cn('h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform', !objOpen && '-rotate-90')} />
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 grid place-items-center text-white shadow-sm shadow-violet-500/30">
                <Coins className="h-4 w-4" />
              </div>
              <div className="text-[12px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">{t('objReportTitle')}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">· {objFrom || '—'} → {objTo || '—'}</div>
            </button>
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* "За счетчик" toggle — hisobga счётчик to'lovlarni ham qo'shadi */}
              <button
                type="button"
                aria-pressed={objInclSchotchik}
                aria-label="За счетчик to'lovlarni hisobga qo'shish"
                onClick={() => setObjInclSchotchik((v) => !v)}
                title={objInclSchotchik ? 'За счетчик qo\'shilgan — bosib chiqarish' : 'За счетчик to\'lovlarni ham hisobga qo\'shish'}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-semibold transition-colors',
                  objInclSchotchik
                    ? 'bg-cyan-600 text-white shadow-sm shadow-cyan-500/30'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-cyan-50 dark:hover:bg-cyan-950/40 hover:text-cyan-600 dark:hover:text-cyan-300',
                )}
              >
                <Gauge className="h-3 w-3" /> За счетчик
              </button>
              {/* Возврат toggle — 0 dan kichik (refund) summalar */}
              <button
                type="button"
                onClick={() => setObjMode((m) => (m === 'refund' ? 'normal' : 'refund'))}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-semibold transition-colors',
                  objMode === 'refund'
                    ? 'bg-rose-600 text-white shadow-sm shadow-rose-500/30'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-300',
                )}
              >
                <RotateCcw className="h-3 w-3" /> Возврат
              </button>
              <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-0.5" />
              <RangeBtn active={objRange === 'today'} onClick={() => setObjRange('today')}>{t('rangeToday')}</RangeBtn>
              <RangeBtn active={objRange === '7d'} onClick={() => setObjRange('7d')}>{t('range7d')}</RangeBtn>
              <RangeBtn active={objRange === '30d'} onClick={() => setObjRange('30d')}>{t('range30d')}</RangeBtn>
              <RangeBtn active={objRange === 'custom'} onClick={() => setObjRange('custom')}>{t('rangeCustom')}</RangeBtn>
            </div>
          </div>

          {objOpen && (
            <div className="p-3">
              {objRange === 'custom' && (
                <div className="flex items-center gap-2 mb-3 text-[12px]">
                  <input type="date" value={objCustomFrom} onChange={(e) => setObjCustomFrom(e.target.value)}
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" />
                  <span className="text-slate-400">→</span>
                  <input type="date" value={objCustomTo} onChange={(e) => setObjCustomTo(e.target.value)}
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" />
                </div>
              )}

              {objLoading ? (
                <div className="py-10 text-center text-[12px] text-slate-400 dark:text-slate-500">…</div>
              ) : (objReport?.rows?.length ?? 0) === 0 ? (
                <div className="py-10 text-center text-[12px] text-slate-400 dark:text-slate-500">{t('objEmpty')}</div>
              ) : (
                <div className="overflow-x-auto rounded ring-1 ring-slate-200 dark:ring-slate-700">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10.5px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2">{t('objColObject')}</th>
                        <th className="text-right font-semibold px-3 py-2">{t('objColPayment')}</th>
                        <th className="text-right font-semibold px-3 py-2">
                          <button type="button" onClick={() => setObjHidden((h) => ({ ...h, first: !h.first }))}
                            title="Ustunni yashirish/ko'rsatish"
                            className="inline-flex items-center gap-1 hover:text-violet-600 dark:hover:text-violet-300 transition-colors">
                            {objHidden.first && <EyeOff className="h-3 w-3" />}
                            {t('objColFirst')}
                          </button>
                        </th>
                        <th className="text-right font-semibold px-3 py-2">
                          <button type="button" onClick={() => setObjHidden((h) => ({ ...h, monthly: !h.monthly }))}
                            title="Ustunni yashirish/ko'rsatish"
                            className="inline-flex items-center gap-1 hover:text-violet-600 dark:hover:text-violet-300 transition-colors">
                            {objHidden.monthly && <EyeOff className="h-3 w-3" />}
                            {t('objColMonthly')}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {objSortedRows.map((r) => {
                        const pinned = objPinned.includes(r.object);
                        return (
                          <tr key={r.object}
                            onClick={() => toggleObjPin(r.object)}
                            title="Tepaga qadash uchun bosing"
                            className={cn(
                              'cursor-pointer transition-colors',
                              pinned ? 'bg-violet-50/70 dark:bg-violet-950/30' : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40',
                            )}>
                            <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">
                              <span className="inline-flex items-center gap-1.5">
                                {pinned && <Pin className="h-3 w-3 text-violet-500 fill-violet-500" />}
                                {r.object}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setObjDetail(r.object); }}
                                title={t('objDetailHint')}
                                className="group inline-flex items-center gap-1.5 hover:underline decoration-dotted underline-offset-2 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors"
                              >
                                <Eye className="h-3 w-3 opacity-30 group-hover:opacity-100 transition-opacity" />
                                {mask(r.paymentAmount)}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{objHidden.first ? '•••' : mask(r.firstInstallment)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{objHidden.monthly ? '•••' : mask(r.monthlyAmount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold text-slate-900 dark:text-slate-100">
                      <tr>
                        <td className="px-3 py-2.5">{t('objTotal')}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                          <button
                            type="button"
                            onClick={() => setObjDetail('__ALL__')}
                            title={t('objDetailHint')}
                            className="group inline-flex items-center gap-1.5 hover:underline decoration-dotted underline-offset-2 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors"
                          >
                            <Eye className="h-3 w-3 opacity-30 group-hover:opacity-100 transition-opacity" />
                            {mask(objReport!.total.paymentAmount)}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{objHidden.first ? '•••' : mask(objReport!.total.firstInstallment)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{objHidden.monthly ? '•••' : mask(objReport!.total.monthlyAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Drill-down modal — obyekt to'lov summasi bosilganda */}
        <ObjectDetailDialog
          object={objDetail}
          dateFrom={objFrom}
          dateTo={objTo}
          mode={objMode}
          includeSchotchik={objInclSchotchik}
          onClose={() => setObjDetail(null)}
        />
        </>)}

        {/* ═══ KUNLIK XULOSA (ОплатыКв — kun + solishtirish) ═══ */}
        <DailySummaryWidget />

        {/* ═══ KUNMA-KUN KIRIM/CHIQIM DIAGRAMMASI ═══ */}
        {has(PERMS.DASHBOARD_DAILY) && (
        <div ref={kunmaChartRef} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
          {/* Header + boshqaruv */}
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setKunmaOpen((o) => !o)}
              className="flex items-center gap-2 min-w-0 hover:opacity-75 transition-opacity"
            >
              <ChevronDown className={cn('no-export h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform', !kunmaOpen && '-rotate-90')} />
              <div className="w-6 h-6 rounded bg-emerald-600 grid place-items-center text-white">
                <Activity className="h-3.5 w-3.5" />
              </div>
              <div className="text-[12px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">{t('dailyChart')}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">· {chartFrom || '—'} → {chartTo || '—'}</div>
            </button>
            <div className="flex items-center gap-2 flex-wrap">
              <DownloadIconBtn
                title={t('downloadPng')}
                onClick={async () => {
                  if (!kunmaOpen) setKunmaOpen(true);
                  await new Promise((r) => setTimeout(r, 150));
                  downloadChartPng(kunmaChartRef.current, `kunma-kun_${chartFrom || 'all'}_${chartTo || 'all'}.png`);
                }}
              />
              {/* Bank filtri — aktivlar boshida, effekt bilan */}
              <Select
                value={chartBankId}
                onValueChange={(v) => { setChartBankId(v); setChartAccountId('all'); }}
              >
                <SelectTrigger className="h-8 text-[11px] w-auto min-w-[130px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                  <SelectValue placeholder={t('allBanks')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allBanks')}</SelectItem>
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
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold border-t border-slate-100 dark:border-slate-800 mt-1">
                      {t('inactiveBanks')}
                    </div>
                  )}
                  {sortedChartBanks.filter((b: any) => !b.isActive).map((b: any) => (
                    <SelectItem key={b.id} value={b.id} className="text-slate-400 dark:text-slate-500">{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Hisob filtri — qidiruv bilan */}
              <Select value={chartAccountId} onValueChange={setChartAccountId}>
                <SelectTrigger className="h-8 text-[11px] w-auto min-w-[150px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                  <SelectValue placeholder={t('allAccounts')} />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-1.5 pt-1.5 pb-1 sticky top-0 bg-white dark:bg-slate-900 z-10">
                    <Input
                      value={accSearch}
                      onChange={(e) => setAccSearch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder={t('accountSearch')}
                      className="h-8 text-[11px]"
                    />
                  </div>
                  <SelectItem value="all">{t('allAccounts')}</SelectItem>
                  {chartAccounts.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-slate-400 dark:text-slate-500">{t('notFound')}</div>
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
              <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
                <RangeBtn active={range === 'today'} onClick={() => setRange('today')}>{t('rangeToday')}</RangeBtn>
                <RangeBtn active={range === '7d'} onClick={() => setRange('7d')}>{t('range7d')}</RangeBtn>
                <RangeBtn active={range === '30d'} onClick={() => setRange('30d')}>{t('range30d')}</RangeBtn>
                <RangeBtn active={range === 'custom'} onClick={() => setRange('custom')}>{t('rangeCustom')}</RangeBtn>
              </div>

              {/* Custom sana oralig'i */}
              {range === 'custom' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-8 text-[11px] px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded outline-none focus:border-blue-400"
                  />
                  <span className="text-slate-400 dark:text-slate-500 text-[11px]">→</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-8 text-[11px] px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded outline-none focus:border-blue-400"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Body: jami + grafik — kollaps qilingan */}
          {kunmaOpen && (
            <div className="p-4">
              {/* Jami kirim/chiqim/sof */}
              <div className="flex items-center gap-5 mb-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{t('totalIn')}</span>
                  <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                    {formatMoney(Number(daily?.totalIn || 0)).replace(' UZS', '')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{t('totalOut')}</span>
                  <span className="text-[13px] font-bold tabular-nums text-rose-700 dark:text-rose-300">
                    {formatMoney(Number(daily?.totalOut || 0)).replace(' UZS', '')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{t('netFlow')}</span>
                  <span className={cn(
                    "text-[13px] font-bold tabular-nums",
                    Number(daily?.net || 0) >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300",
                  )}>
                    {Number(daily?.net || 0) >= 0 ? '+' : ''}{formatMoney(Number(daily?.net || 0)).replace(' UZS', '')}
                  </span>
                </div>
              </div>

              {/* Grafik */}
              <div className="bg-white dark:bg-slate-900">
                {range === 'custom' && (!customFrom || !customTo) ? (
                  <div className="h-[260px] grid place-items-center text-xs text-slate-400 dark:text-slate-500">
                    {t('selectDateRange')}
                  </div>
                ) : dailyLoading ? (
                  <Skeleton className="h-[260px] w-full" />
                ) : (
                  <DualAreaChart data={chartData} height={260} />
                )}
              </div>
            </div>
          )}
        </div>
        )}

        {/* ═══ KUNMA-KUN USTUNLI GRAFIK — alohida karta ═══ */}
        {has(PERMS.DASHBOARD_DAILY_BAR) && (
        <div ref={kunmaBarChartRef} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60">
            <button
              type="button"
              onClick={() => setKunmaBarOpen((o) => !o)}
              className="flex items-center gap-2 min-w-0 hover:opacity-75 transition-opacity"
            >
              <ChevronDown className={cn('no-export h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform', !kunmaBarOpen && '-rotate-90')} />
              <div className="w-6 h-6 rounded bg-amber-600 grid place-items-center text-white">
                <BarChart3 className="h-3.5 w-3.5" />
              </div>
              <div className="text-[12px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">{t('barChart')}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">· {chartFrom || '—'} → {chartTo || '—'}</div>
            </button>
            <div className="flex items-center gap-2">
              <DownloadIconBtn
                title={t('downloadPng')}
                onClick={async () => {
                  if (!kunmaBarOpen) setKunmaBarOpen(true);
                  await new Promise((r) => setTimeout(r, 150));
                  downloadChartPng(kunmaBarChartRef.current, `kunma-kun-ustunli_${chartFrom || 'all'}_${chartTo || 'all'}.png`);
                }}
              />
            </div>
          </div>
          {kunmaBarOpen && (
            <div className="p-4">
              <div className="bg-white dark:bg-slate-900">
                {range === 'custom' && (!customFrom || !customTo) ? (
                  <div className="h-[280px] grid place-items-center text-xs text-slate-400 dark:text-slate-500">
                    {t('selectDateRange')}
                  </div>
                ) : dailyLoading ? (
                  <Skeleton className="h-[280px] w-full" />
                ) : (
                  <DailyBarChart data={barData} height={280} />
                )}
              </div>
            </div>
          )}
        </div>
        )}

        {/* ═══ KLIENT TO'LOVLARI — Клиент / Физ.Л / Юр.Л kategoriya bo'yicha ═══ */}
        {has(PERMS.DASHBOARD_CLIENT) && (
        <div ref={clientChartRef} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
          {/* Header + boshqaruv */}
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-indigo-50/60 dark:from-indigo-950/40 to-white dark:to-slate-900">
            <button
              type="button"
              onClick={() => setClientOpen((o) => !o)}
              className="flex items-center gap-2 min-w-0 hover:opacity-75 transition-opacity"
            >
              <ChevronDown className={cn('no-export h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform', !clientOpen && '-rotate-90')} />
              <div className="w-6 h-6 rounded bg-indigo-600 grid place-items-center text-white">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
              <div className="text-[12px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">{t('clientPayments')}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">· Клиент / Физ.Л / Юр.Л · {cliFrom || '—'} → {cliTo || '—'}</div>
            </button>
            <div className="flex items-center gap-2 flex-wrap">
              <DownloadIconBtn
                title={t('downloadPng')}
                onClick={async () => {
                  if (!clientOpen) setClientOpen(true);
                  await new Promise((r) => setTimeout(r, 150));
                  downloadChartPng(clientChartRef.current, `klient-tolovlari_${cliFrom || 'all'}_${cliTo || 'all'}.png`);
                }}
              />
              {/* Bank filtri */}
              <Select
                value={cliBankId}
                onValueChange={(v) => { setCliBankId(v); setCliAccountId('all'); }}
              >
                <SelectTrigger className="h-8 text-[11px] w-auto min-w-[130px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                  <SelectValue placeholder={t('allBanks')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allBanks')}</SelectItem>
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
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold border-t border-slate-100 dark:border-slate-800 mt-1">
                      {t('inactiveBanks')}
                    </div>
                  )}
                  {sortedChartBanks.filter((b: any) => !b.isActive).map((b: any) => (
                    <SelectItem key={b.id} value={b.id} className="text-slate-400 dark:text-slate-500">{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Hisob filtri */}
              <Select value={cliAccountId} onValueChange={setCliAccountId}>
                <SelectTrigger className="h-8 text-[11px] w-auto min-w-[150px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                  <SelectValue placeholder={t('allAccounts')} />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-1.5 pt-1.5 pb-1 sticky top-0 bg-white dark:bg-slate-900 z-10">
                    <Input
                      value={cliAccSearch}
                      onChange={(e) => setCliAccSearch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder={t('accountSearch')}
                      className="h-8 text-[11px]"
                    />
                  </div>
                  <SelectItem value="all">{t('allAccounts')}</SelectItem>
                  {cliChartAccounts.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-slate-400 dark:text-slate-500">{t('notFound')}</div>
                  ) : (
                    cliChartAccounts.slice(0, 100).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.accountNo} {a.ownerName ? `· ${a.ownerName}` : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>

              {/* Sana oralig'i */}
              <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
                <RangeBtn active={cliRange === 'today'} onClick={() => setCliRange('today')}>{t('rangeToday')}</RangeBtn>
                <RangeBtn active={cliRange === '7d'} onClick={() => setCliRange('7d')}>{t('range7d')}</RangeBtn>
                <RangeBtn active={cliRange === '30d'} onClick={() => setCliRange('30d')}>{t('range30d')}</RangeBtn>
                <RangeBtn active={cliRange === 'custom'} onClick={() => setCliRange('custom')}>{t('rangeCustom')}</RangeBtn>
              </div>

              {cliRange === 'custom' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={cliCustomFrom}
                    onChange={(e) => setCliCustomFrom(e.target.value)}
                    className="h-8 text-[11px] px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded outline-none focus:border-indigo-400"
                  />
                  <span className="text-slate-400 dark:text-slate-500 text-[11px]">→</span>
                  <input
                    type="date"
                    value={cliCustomTo}
                    onChange={(e) => setCliCustomTo(e.target.value)}
                    className="h-8 text-[11px] px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded outline-none focus:border-indigo-400"
                  />
                </div>
              )}
            </div>
          </div>

          {clientOpen && (
            <>
              {/* Subkategoriya tablari */}
              <div className="px-4 pt-3 pb-2 flex items-center gap-1.5 flex-wrap border-b border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => setCliSubCode('__all__')}
                  className={cn(
                    'px-2.5 h-7 rounded-md text-[11px] font-semibold ring-1 ring-inset transition-colors',
                    cliSubCode === '__all__'
                      ? 'bg-indigo-600 text-white ring-indigo-600'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  {t('allCategory')}
                  <span className="ml-1.5 text-[10px] opacity-80 tabular-nums">
                    {formatShort(Number(clientDaily?.totalIn || 0))}
                  </span>
                </button>
                {(clientDaily?.subcategories || []).map((s: any) => {
                  const active = cliSubCode === s.code;
                  const color = s.color || '#6366f1';
                  return (
                    <button
                      key={s.code}
                      onClick={() => setCliSubCode(s.code)}
                      className={cn(
                        'px-2.5 h-7 rounded-md text-[11px] font-semibold ring-1 ring-inset transition-colors',
                        active ? 'ring-2' : 'ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
                      )}
                      style={active ? { backgroundColor: `${color}15`, color, borderColor: color } : {}}
                      title={`KIRIM: ${formatMoney(s.totalIn)} · CHIQIM: ${formatMoney(s.totalOut)} · ${s.count} ta`}
                    >
                      {s.name}
                      <span className="ml-1.5 text-[10px] opacity-80 tabular-nums">
                        {formatShort(Number(s.totalIn || 0))}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Body: jami + grafik */}
              <div className="p-4">
                <div className="flex items-center gap-5 mb-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{t('totalInShort')}</span>
                    <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                      {formatMoney(clientTotals.totalIn).replace(' UZS', '')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{t('totalOutShort')}</span>
                    <span className="text-[13px] font-bold tabular-nums text-rose-700 dark:text-rose-300">
                      {formatMoney(clientTotals.totalOut).replace(' UZS', '')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{t('netFlowShort')}</span>
                    <span className={cn(
                      "text-[13px] font-bold tabular-nums",
                      clientTotals.net >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300",
                    )}>
                      {clientTotals.net >= 0 ? '+' : ''}{formatMoney(clientTotals.net).replace(' UZS', '')}
                    </span>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900">
                  {cliRange === 'custom' && (!cliCustomFrom || !cliCustomTo) ? (
                    <div className="h-[260px] grid place-items-center text-xs text-slate-400 dark:text-slate-500">
                      {t('selectDateRange')}
                    </div>
                  ) : clientLoading ? (
                    <Skeleton className="h-[260px] w-full" />
                  ) : (
                    <DualAreaChart data={clientChartData} height={260} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        )}

        {/* ═══ XONPAY DEBITOR — XonPay'da ro'yxatda lekin bankga kelmagan to'lovlar ═══ */}
        {has(PERMS.DASHBOARD_XONPAY) && (
        <div ref={xonpayChartRef} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-violet-50/60 dark:from-violet-950/40 to-white dark:to-slate-900">
            <button
              type="button"
              onClick={() => setXonpayOpen((o) => !o)}
              className="flex items-center gap-2 min-w-0 hover:opacity-75 transition-opacity"
            >
              <ChevronDown className={cn('no-export h-4 w-4 text-slate-500 dark:text-slate-400 transition-transform', !xonpayOpen && '-rotate-90')} />
              <div className="w-7 h-7 rounded-md overflow-hidden bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 grid place-items-center shrink-0">
                <img src="/xonpay.jpg" alt="XonPay" className="w-full h-full object-cover" />
              </div>
              <div className="text-[12px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">{t('xonpayPending')}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">· {t('debitor')} · {xonpayFrom || '—'} → {xonpayTo || '—'}</div>
            </button>
            <div className="flex items-center gap-2 flex-wrap">
              <DownloadIconBtn
                title={t('downloadPng')}
                onClick={async () => {
                  if (!xonpayOpen) setXonpayOpen(true);
                  await new Promise((r) => setTimeout(r, 150));
                  downloadChartPng(xonpayChartRef.current, `xonpay-debitor_${xonpayFrom || 'all'}_${xonpayTo || 'all'}.png`);
                }}
              />
              <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
                <RangeBtn active={xonpayRange === 'yesterday'} onClick={() => setXonpayRange('yesterday')}>{tc('yesterday')}</RangeBtn>
                <RangeBtn active={xonpayRange === '7d'} onClick={() => setXonpayRange('7d')}>{t('range7d')}</RangeBtn>
                <RangeBtn active={xonpayRange === '30d'} onClick={() => setXonpayRange('30d')}>{t('range30d')}</RangeBtn>
                <RangeBtn active={xonpayRange === 'custom'} onClick={() => setXonpayRange('custom')}>{t('rangeCustom')}</RangeBtn>
              </div>
              {xonpayRange === 'custom' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={xonpayCustomFrom}
                    onChange={(e) => setXonpayCustomFrom(e.target.value)}
                    className="h-8 text-[11px] px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded outline-none focus:border-violet-400"
                  />
                  <span className="text-slate-400 dark:text-slate-500 text-[11px]">→</span>
                  <input
                    type="date"
                    value={xonpayCustomTo}
                    onChange={(e) => setXonpayCustomTo(e.target.value)}
                    className="h-8 text-[11px] px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded outline-none focus:border-violet-400"
                  />
                </div>
              )}
            </div>
          </div>

          {xonpayOpen && (
            <div className="p-4">
              {xonpayRange === 'custom' && (!xonpayCustomFrom || !xonpayCustomTo) ? (
                <div className="h-[120px] grid place-items-center text-xs text-slate-400 dark:text-slate-500">
                  {t('selectDateRange')}
                </div>
              ) : xonpayLoading ? (
                <Skeleton className="h-[160px] w-full" />
              ) : (
                /* DEBITOR — XonPay'da bor lekin Kapital bankka tushmagan */
                <div className="relative overflow-hidden rounded-2xl border border-rose-200 dark:border-rose-900 bg-gradient-to-br from-rose-50 dark:from-rose-950/40 via-rose-50/40 dark:via-rose-950/30 to-white dark:to-slate-900 p-5 sm:p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-[11px] sm:text-[12px] font-bold uppercase tracking-[0.15em] text-rose-700 dark:text-rose-300 mb-1">{t('debitorUpper')}</div>
                      <div className="text-[11px] sm:text-[12px] text-rose-600/80 dark:text-rose-400/80">{t('debitorDesc')}</div>
                    </div>
                    <div className="w-11 h-11 rounded-xl bg-rose-100 dark:bg-rose-900/30 grid place-items-center shrink-0">
                      <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400 animate-pulse" />
                    </div>
                  </div>
                  <div className="text-[28px] sm:text-[34px] font-bold tabular-nums text-rose-700 dark:text-rose-300 leading-tight">
                    {formatMoney(xonpayTotals.missing).replace(' UZS', '')}
                  </div>
                  <div className="text-[12px] text-rose-700/80 dark:text-rose-300/80 mt-3 flex items-center gap-3 flex-wrap">
                    <span>
                      <span className="font-bold tabular-nums">{xonpayTotals.missingCount.toLocaleString('uz-UZ')}</span> {t('txnAwaiting')}
                    </span>
                    {xonpayTotals.total > 0 && (
                      <span className="font-bold tabular-nums bg-rose-600 text-white px-2.5 py-1 rounded-full text-[10.5px]">
                        {t('percentOfTotal', { n: Math.round((xonpayTotals.missing / xonpayTotals.total) * 100) })}
                      </span>
                    )}
                  </div>
                  {/* Decorative orbs */}
                  <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-rose-400/20 blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-6 -left-6 w-32 h-32 rounded-full bg-rose-300/15 blur-2xl pointer-events-none" />
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* ═══ MAIN GRID: 3 columns ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* ═══ LEFT: Transactions table (8 cols) ═══ */}
          <div className="lg:col-span-8 space-y-4">

            {/* Top accounts table */}
            {has(PERMS.DASHBOARD_TOP_ACCOUNTS) && (
            <DataPanel
              title={t('topAccounts')}
              count={totalAccounts}
              collapsible
            >
              {accLoading ? (
                <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : totalAccounts === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">{t('noAccounts')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-700">
                        <th className="text-left px-3 py-2">{t('bankAccountHeader')}</th>
                        <th className="text-left px-3 py-2 w-24">{t('mfo')}</th>
                        <th className="text-right px-3 py-2 w-32">{t('balanceHeader')}</th>
                        <th className="text-left px-3 py-2 w-20">{t('statusHeader')}</th>
                        <th className="text-left px-3 py-2 w-32">{t('lastSyncHeader')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {(accounts!.items as any[])
                        .slice()
                        .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
                        .slice(0, 8)
                        .map((a) => {
                          const colorIdx = byBank.findIndex((b) => b.id === a.bankId);
                          const color = BANK_COLORS[colorIdx >= 0 ? colorIdx : 0];
                          return (
                            <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className="w-1 h-6 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{a.bank?.name || '—'}</div>
                                    <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate">{a.accountNo}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-300">{a.branch}</td>
                              <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                                {formatMoney(Number(a.balance || 0), a.currency)}
                              </td>
                              <td className="px-3 py-2">
                                <span className={cn(
                                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border",
                                  a.syncEnabled
                                    ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900"
                                    : "bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700",
                                )}>
                                  <span className={cn("w-1 h-1 rounded-full", a.syncEnabled ? "bg-emerald-500" : "bg-slate-300")} />
                                  {a.syncEnabled ? 'ON' : 'OFF'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
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
            )}

          </div>

          {/* ═══ RIGHT: System health panels (4 cols) ═══ */}
          <div className="lg:col-span-4 space-y-4">

            {/* Sync status */}
            {has(PERMS.DASHBOARD_SYNC_STATUS) && (
            <DataPanel title={t('syncStatus')} subtitle={t('syncLast10')} collapsible>
              <div className="px-4 py-3 space-y-3">
                {/* Big % */}
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">{syncStats.successRate}%</div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{t('successRate')}</div>
                  </div>
                  <Link href={`/${locale}/admin/sync-logs`}>
                    <button className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 flex items-center gap-1">
                      {t('details')} <ChevronRight className="h-3 w-3" />
                    </button>
                  </Link>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-sm overflow-hidden flex">
                  <div className="bg-emerald-500 transition-all" style={{ width: `${(syncStats.success / Math.max(1, syncStats.total)) * 100}%` }} />
                  <div className="bg-amber-500 transition-all" style={{ width: `${(syncStats.partial / Math.max(1, syncStats.total)) * 100}%` }} />
                  <div className="bg-rose-500 transition-all" style={{ width: `${(syncStats.failed / Math.max(1, syncStats.total)) * 100}%` }} />
                  <div className="bg-blue-500 transition-all" style={{ width: `${(syncStats.running / Math.max(1, syncStats.total)) * 100}%` }} />
                </div>

                {/* Counts */}
                <div className="grid grid-cols-4 gap-2 text-center pt-1">
                  <Mini label={t('syncOk')} value={syncStats.success} tone="emerald" />
                  <Mini label={t('syncPartial')} value={syncStats.partial} tone="amber" />
                  <Mini label={t('syncError')} value={syncStats.failed} tone="rose" />
                  <Mini label={t('syncRunning')} value={syncStats.running} tone="blue" />
                </div>
              </div>
            </DataPanel>
            )}

            {/* Banks breakdown */}
            {has(PERMS.DASHBOARD_BANKS_BREAKDOWN) && (
            <DataPanel title={t('banksBreakdown')} subtitle={t('banksCount', { n: byBank.length })} collapsible>
              {byBank.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">{t('noBanks')}</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                  {byBank.map((b) => {
                    const pct = totalBalance > 0 ? (b.balance / totalBalance) * 100 : 0;
                    return (
                      <div key={b.id} className="px-4 py-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: b.color }} />
                            <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100 truncate">{b.name}</span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0">{b.accounts} {t('accountsShort')}</span>
                          </div>
                          <span className="text-[11px] font-bold tabular-nums text-slate-700 dark:text-slate-300">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1 bg-slate-100 dark:bg-slate-800 rounded-sm overflow-hidden">
                            <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: b.color }} />
                          </div>
                          <span className="text-[10px] tabular-nums text-slate-600 dark:text-slate-300 font-mono w-24 text-right">
                            {formatMoney(b.balance).replace(' UZS', '')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </DataPanel>
            )}

            {/* Recent failures alerts */}
            {has(PERMS.DASHBOARD_SYNC_STATUS) && syncStats.failed > 0 && (
              <DataPanel title={t('attention')} subtitle={t('syncErrors', { n: syncStats.failed })} tone="warning">
                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                  {(syncLogs?.items || []).filter((l) => l.status === 'FAILED').slice(0, 3).map((l) => (
                    <Link key={l.id} href={`/${locale}/admin/sync-logs`} className="block">
                      <div className="px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate">{l.source}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2">{l.errorMessage}</div>
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 tabular-nums">{formatDateTime(l.startedAt)}</div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </DataPanel>
            )}

            {/* Net flow widget */}
            {has(PERMS.DASHBOARD_NET_FLOW) && (
            <DataPanel title={t('netFlow30')} collapsible>
              <div className="px-4 py-3">
                <div className={cn(
                  "text-3xl font-bold tabular-nums tracking-tight",
                  netFlow >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300",
                )}>
                  {netFlow >= 0 ? '+' : ''}{formatMoney(netFlow).replace(' UZS', '')}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mt-0.5">UZS</div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
                  <div className="rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-bold">{t('totalIn')}</div>
                    <div className="font-semibold tabular-nums text-emerald-900 dark:text-emerald-300">{formatMoney(inSum).replace(' UZS', '')}</div>
                  </div>
                  <div className="rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-rose-700 dark:text-rose-300 font-bold">{t('totalOut')}</div>
                    <div className="font-semibold tabular-nums text-rose-900 dark:text-rose-300">{formatMoney(outSum).replace(' UZS', '')}</div>
                  </div>
                </div>
              </div>
            </DataPanel>
            )}

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
    primary: 'text-slate-900 dark:text-slate-100',
    success: 'text-emerald-700 dark:text-emerald-300',
    danger: 'text-rose-700 dark:text-rose-300',
  }[tone || 'primary'];
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-3 py-2.5 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-1 truncate">{label}</div>
      {loading ? (
        <Skeleton className="h-6 w-24" />
      ) : (
        <div className="flex items-baseline gap-1">
          <div className={cn("text-lg font-bold tracking-tight tabular-nums truncate", t)}>{value}</div>
          {unit && <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{unit}</div>}
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
  const headBg = tone === 'warning' ? 'bg-amber-50/40 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900' : tone === 'danger' ? 'bg-rose-50/40 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700';

  const head = (
    <div className="flex items-center gap-2 min-w-0">
      {collapsible && (
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0 transition-transform duration-300", open && "rotate-180")} />
      )}
      <div className="text-[12px] font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">{title}</div>
      {count !== undefined && (
        <span className="text-[10px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded tabular-nums">
          {count}
        </span>
      )}
      {subtitle && <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">· {subtitle}</div>}
    </div>
  );

  return (
    <div className={cn("bg-white dark:bg-slate-900 border rounded overflow-hidden", headBg)}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60">
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
            <div className="bg-white dark:bg-slate-900">{children}</div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900">{children}</div>
      )}
    </div>
  );
}

function formatShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toFixed(0);
}

// DOM tugunini PNG sifatida yuklab olish (html-to-image dynamic import — SSR'ga kirmaydi)
// 'no-export' klassli elementlar PNG'da chiqarilmaydi (chevron, download tugma, va h.k.)
async function downloadChartPng(node: HTMLElement | null, filename: string) {
  if (!node) return;
  try {
    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(node, {
      backgroundColor: '#ffffff',
      pixelRatio: 2,
      cacheBust: true,
      filter: (el) => {
        if (!(el instanceof HTMLElement)) return true;
        return !el.classList.contains('no-export');
      },
    });
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
  } catch (e) {
    console.error('PNG eksport xatoligi:', e);
  }
}

// Kichkina yumaloq icon tugma — kartochka header'iga PNG yuklab olish uchun
function DownloadIconBtn({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="no-export h-8 w-8 grid place-items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
    >
      <Download className="h-3.5 w-3.5" />
    </button>
  );
}

function RangeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 h-8 text-[11px] font-semibold transition-colors border-r border-slate-200 dark:border-slate-700 last:border-r-0",
        active ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800",
      )}
    >
      {children}
    </button>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'rose' | 'blue' }) {
  const c = {
    emerald: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
    amber:   { dot: 'bg-amber-500',   text: 'text-amber-700 dark:text-amber-300' },
    rose:    { dot: 'bg-rose-500',    text: 'text-rose-700 dark:text-rose-300' },
    blue:    { dot: 'bg-blue-500',    text: 'text-blue-700 dark:text-blue-300' },
  }[tone];
  return (
    <div className="text-center">
      <div className={cn("text-[14px] font-bold tabular-nums", c.text)}>{value}</div>
      <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
        <span className={cn("w-1 h-1 rounded-full", c.dot)} />
        {label}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// OBYEKT DRILL-DOWN — bitta obyekt to'lov summasini tashkil qilgan qatorlar
// ═════════════════════════════════════════════════════════════════════
interface ObjDetailRow {
  id: string;
  contractNo: string;
  date: string;
  paymentAmount: number | null;
  firstInstallment: number | null;
  monthlyAmount: number | null;
  paymentCategory: string | null;
  txType: string | null;
  client: string | null;
  object: string | null;
  purpose: string | null;
  paymentMethod: string | null;
}

function ObjectDetailDialog({
  object, dateFrom, dateTo, mode, includeSchotchik, onClose,
}: {
  object: string | null;
  dateFrom: string;
  dateTo: string;
  mode: 'normal' | 'refund';
  includeSchotchik: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard');
  const open = object !== null;
  const isAll = object === '__ALL__';

  const { data, isLoading } = useQuery({
    queryKey: ['oplata-by-object-detail', object, dateFrom, dateTo, mode, includeSchotchik],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('object', object || '');
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      p.set('mode', mode);
      if (includeSchotchik) p.set('includeSchotchik', '1');
      return api.get<{
        ok: boolean; object: string; count: number; truncated?: boolean;
        rows: ObjDetailRow[];
        total: { paymentAmount: number; firstInstallment: number; monthlyAmount: number };
      }>(`/oplata-kv/by-object-detail?${p}`);
    },
    enabled: open,
  });

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (object === null) return;
    setExporting(true);
    try {
      const p = new URLSearchParams();
      p.set('object', object);
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      p.set('mode', mode);
      if (includeSchotchik) p.set('includeSchotchik', '1');
      const safe = (object === '—' ? 'obyektsiz' : object).replace(/[^\wа-яёА-ЯЁa-zA-Z0-9]+/g, '_').slice(0, 40);
      await apiDownload(`/oplata-kv/by-object-detail/export?${p.toString()}`, `obyekt-${safe}.xlsx`);
    } catch {
      /* apiDownload o'zi xatoni ko'rsatadi */
    } finally {
      setExporting(false);
    }
  };

  const fmtNum = (n: number | null) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('ru-RU'));
  const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString('ru-RU'); } catch { return d; } };
  const catLabel = (c: string | null) =>
    c === 'MONTHLY' ? 'ежемесячный' : c === 'FIRST' ? '1 взнос' : c === 'GENERAL' ? 'Общий' : '—';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[1400px] w-[98vw] p-0 overflow-hidden gap-0 max-h-[95vh] flex flex-col">
        {/* Hero header */}
        <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 px-5 pt-4 pb-3.5 text-white shrink-0">
          <div className="flex items-start justify-between gap-3">
            <DialogTitle asChild>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-white/15 grid place-items-center shrink-0">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-white/70">{t('objDetailTitle')}</div>
                  <div className="text-lg font-black tracking-tight truncate">{isAll ? t('objDetailAll') : object === '—' ? t('objDetailNoObject') : object}</div>
                </div>
              </div>
            </DialogTitle>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || (data?.rows?.length ?? 0) === 0}
              className="shrink-0 mr-8 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {exporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Excel
            </button>
          </div>
          <div className="text-[11px] text-white/80 mt-2 flex items-center gap-2 flex-wrap">
            <span>{dateFrom || '—'} → {dateTo || '—'}</span>
            <span className="w-px h-3 bg-white/30" />
            <span>{mode === 'refund' ? 'Возврат' : t('objDetailNormal')}</span>
            {data && (
              <>
                <span className="w-px h-3 bg-white/30" />
                <span>{t('objDetailCount', { n: data.count })}</span>
              </>
            )}
          </div>
        </div>

        {/* Body — scrollable table */}
        <div className="flex-1 min-h-0 overflow-auto bg-slate-50/40 dark:bg-slate-900">
          {isLoading ? (
            <div className="py-16 text-center text-[12px] text-slate-400 dark:text-slate-500">…</div>
          ) : (data?.rows?.length ?? 0) === 0 ? (
            <div className="py-16 text-center text-[12px] text-slate-400 dark:text-slate-500">{t('objDetailEmpty')}</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-[10.5px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Дог №</th>
                  <th className="text-left font-semibold px-3 py-2">Дата</th>
                  {isAll && <th className="text-left font-semibold px-3 py-2">Объект</th>}
                  <th className="text-left font-semibold px-3 py-2">Тип</th>
                  <th className="text-left font-semibold px-3 py-2">Клиент</th>
                  <th className="text-left font-semibold px-3 py-2">Оплата</th>
                  <th className="text-right font-semibold px-3 py-2">Сумма</th>
                  <th className="text-right font-semibold px-3 py-2">1 взнос</th>
                  <th className="text-right font-semibold px-3 py-2">ежемес.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                {data!.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-violet-50/40 dark:hover:bg-violet-950/20 transition-colors">
                    <td className="px-3 py-1.5 font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">{r.contractNo}</td>
                    <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">{fmtDate(r.date)}</td>
                    {isAll && <td className="px-3 py-1.5 text-violet-700 dark:text-violet-300 font-medium max-w-[160px] truncate" title={r.object || ''}>{r.object || '—'}</td>}
                    <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300 max-w-[220px] truncate" title={r.txType || ''}>{r.txType || '—'}</td>
                    <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title={r.client || ''}>{r.client || '—'}</td>
                    <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{catLabel(r.paymentCategory)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{fmtNum(r.paymentAmount)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.firstInstallment)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.monthlyAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-slate-100 dark:bg-slate-800 font-bold text-slate-900 dark:text-slate-100">
                <tr>
                  <td className="px-3 py-2.5" colSpan={isAll ? 6 : 5}>{t('objTotal')}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmtNum(data!.total.paymentAmount)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(data!.total.firstInstallment)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(data!.total.monthlyAmount)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          {data?.truncated && (
            <div className="px-4 py-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-t border-amber-200 dark:border-amber-900">
              {t('objDetailTruncated', { shown: data.rows.length, total: data.count })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
