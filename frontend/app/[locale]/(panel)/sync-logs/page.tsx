'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2, XCircle, Loader2, AlertTriangle, Activity, Clock,
  TrendingUp, Zap, Database, RefreshCcw,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { Sparkline } from '@/components/sparkline';
import { api } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';

const STATUS_CONFIG: Record<string, { icon: any; label: string; cls: string; dot: string }> = {
  SUCCESS: { icon: CheckCircle2, label: 'Muvaffaqiyatli', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  FAILED:  { icon: XCircle, label: 'Xato', cls: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  RUNNING: { icon: Loader2, label: 'Bajarilmoqda', cls: 'bg-blue-50 text-blue-700 ring-blue-200', dot: 'bg-blue-500' },
  PARTIAL: { icon: AlertTriangle, label: 'Qisman', cls: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
};

export default function SyncLogsPage() {
  const t = useTranslations('syncLogs');

  const { data, isLoading } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: () => api.get<{ items: any[] }>('/sync/logs?limit=100'),
    refetchInterval: 10_000,
  });

  const stats = useMemo(() => {
    const items = data?.items || [];
    const success = items.filter((l) => l.status === 'SUCCESS').length;
    const failed = items.filter((l) => l.status === 'FAILED').length;
    const totalFetched = items.reduce((s, l) => s + (l.fetched || 0), 0);
    const totalSaved = items.reduce((s, l) => s + (l.saved || 0), 0);
    const avgDuration = items.length
      ? Math.round(items.filter((l) => l.durationMs).reduce((s, l) => s + l.durationMs, 0) / items.filter((l) => l.durationMs).length)
      : 0;
    const successRate = items.length > 0 ? Math.round((success / items.length) * 100) : 0;
    return { success, failed, totalFetched, totalSaved, avgDuration, successRate, count: items.length };
  }, [data]);

  // Mini sparkline from last N logs durations
  const durationSpark = (data?.items || []).slice(0, 20).reverse().map((l) => l.durationMs || 0);

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} actions={
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/20 text-[11px] font-medium text-white">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          Live · 10s yangilanish
        </span>
      } />

      <div className="flex-1 p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto w-full">

        {/* ═══ KPI ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Muvaffaqiyat darajasi" value={`${stats.successRate}%`} sub={`${stats.success} muvaffaqiyatli`} icon={CheckCircle2} color="emerald" spark={durationSpark} />
          <KpiCard label="Xatolar" value={String(stats.failed)} sub={`${stats.count} ta operatsiya`} icon={XCircle} color="rose" />
          <KpiCard label="Olingan / Saqlangan" value={`${stats.totalFetched} / ${stats.totalSaved}`} sub="Jami tranzaksiya" icon={Database} color="indigo" />
          <KpiCard label="O'rtacha vaqt" value={`${stats.avgDuration} ms`} sub="Bir sync ishi" icon={Zap} color="amber" />
        </div>

        {/* ═══ TIMELINE ═══ */}
        <Card className="border-0 shadow-soft overflow-hidden">
          <CardContent className="p-0">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-base font-semibold tracking-tight flex items-center gap-2">
                  <Activity className="h-4 w-4 text-indigo-600" />
                  Sync tarixi
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Oxirgi 100 ta operatsiya · har 10 soniyada yangilanadi</div>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {stats.success}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 ring-1 ring-rose-200 text-rose-700 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> {stats.failed}
                </span>
              </div>
            </div>

            {isLoading ? (
              <div className="p-6 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : (data?.items?.length ?? 0) === 0 ? (
              <EmptyState
                icon={RefreshCcw}
                title="Sync logi yo'q"
                description="Cron har 5 daqiqada ishlaydi yoki bank hisobini qo'lda sync qilganingizda log yoziladi"
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {data!.items.map((l: any) => {
                  const cfg = STATUS_CONFIG[l.status] || STATUS_CONFIG.SUCCESS;
                  const Icon = cfg.icon;
                  return (
                    <div key={l.id} className="px-6 py-3.5 hover:bg-slate-50/60 transition-colors">
                      <div className="flex items-start gap-4">
                        {/* Status pill */}
                        <div className="shrink-0 mt-0.5">
                          <div className={cn(
                            "w-9 h-9 rounded-xl grid place-items-center ring-1 ring-inset",
                            cfg.cls,
                          )}>
                            <Icon className={cn("h-4 w-4", l.status === 'RUNNING' && 'animate-spin')} />
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={cn(
                                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset",
                                  cfg.cls,
                                )}>
                                  {cfg.label}
                                </span>
                                <span className="font-mono text-[11px] text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded">{l.source}</span>
                                <span className="text-[11px] text-slate-500 tabular-nums">{formatDateTime(l.startedAt)}</span>
                              </div>
                              {l.errorMessage && (
                                <div className="mt-1.5 text-[11px] text-rose-600 line-clamp-2 leading-relaxed">
                                  <AlertTriangle className="h-3 w-3 inline mr-1" /> {l.errorMessage}
                                </div>
                              )}
                            </div>

                            {/* Stats */}
                            <div className="flex items-center gap-4 text-[11px] shrink-0">
                              <Stat icon={Database} value={l.fetched ?? 0} label="olindi" />
                              <Stat icon={CheckCircle2} value={l.saved ?? 0} label="saqlandi" tone={l.saved > 0 ? 'emerald' : 'slate'} />
                              {(l.errors ?? 0) > 0 && <Stat icon={XCircle} value={l.errors} label="xato" tone="rose" />}
                              {l.durationMs && (
                                <span className="inline-flex items-center gap-1 text-slate-500">
                                  <Clock className="h-3 w-3" />
                                  <span className="font-medium tabular-nums">{l.durationMs} ms</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function KpiCard({
  label, value, sub, icon: Icon, color, spark,
}: {
  label: string;
  value: string;
  sub: string;
  icon: any;
  color: 'emerald' | 'rose' | 'indigo' | 'amber';
  spark?: number[];
}) {
  const m = {
    emerald: { grad: 'from-emerald-500 to-teal-600', accent: '#10b981' },
    rose:    { grad: 'from-rose-500 to-red-600',     accent: '#f43f5e' },
    indigo:  { grad: 'from-indigo-500 to-blue-600',  accent: '#6366f1' },
    amber:   { grad: 'from-amber-500 to-orange-600', accent: '#f59e0b' },
  }[color];
  return (
    <Card className="border-0 shadow-soft card-hover relative overflow-hidden">
      <div className={cn("absolute -top-12 -right-12 w-32 h-32 rounded-full blur-2xl opacity-25 bg-gradient-to-br", m.grad)} />
      <CardContent className="p-5 relative">
        <div className="flex items-start justify-between mb-2">
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500">{label}</div>
          <div className={cn("w-9 h-9 rounded-xl grid place-items-center bg-gradient-to-br text-white shadow-sm", m.grad)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-2xl lg:text-3xl font-bold tracking-tight tabular-nums">{value}</div>
        <div className="text-[11px] text-slate-500 mt-1 truncate">{sub}</div>
        {spark && spark.length > 0 && (
          <div className="mt-1 -mx-1">
            <Sparkline data={spark} width={200} height={28} stroke={m.accent} fill={m.accent} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, value, label, tone = 'slate' }: { icon: any; value: number; label: string; tone?: 'slate' | 'emerald' | 'rose' }) {
  const cls = tone === 'emerald' ? 'text-emerald-600'
    : tone === 'rose' ? 'text-rose-600'
    : 'text-slate-500';
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", cls)}>
      <Icon className="h-3 w-3" />
      <span className="font-semibold">{value}</span>
      <span className="text-slate-400">{label}</span>
    </span>
  );
}
