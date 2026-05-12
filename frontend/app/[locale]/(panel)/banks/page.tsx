'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  Building2, Check, KeyRound, Wallet, Plus, ExternalLink,
  Globe, Shield, Sparkles, MoreVertical,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// Bank brand mapping
const BANK_BRAND: Record<string, { color: string; gradient: string; abbr: string; name?: string }> = {
  KAPITALBANK:    { color: '#005baa', gradient: 'from-sky-500 to-blue-700',         abbr: 'KB'  },
  IPAK_YULI:      { color: '#0f7a3e', gradient: 'from-emerald-500 to-emerald-700',  abbr: 'IY'  },
  NBU:            { color: '#1e3a8a', gradient: 'from-blue-700 to-indigo-900',      abbr: 'NBU' },
  HAMKORBANK:     { color: '#f59e0b', gradient: 'from-amber-500 to-orange-600',     abbr: 'HB'  },
  ASAKABANK:      { color: '#b91c1c', gradient: 'from-red-600 to-rose-800',         abbr: 'AB'  },
  ANORBANK:       { color: '#22c55e', gradient: 'from-green-500 to-green-700',      abbr: 'AN'  },
  DAVRBANK:       { color: '#7c3aed', gradient: 'from-violet-500 to-purple-700',    abbr: 'DB'  },
  TRUSTBANK:      { color: '#0891b2', gradient: 'from-cyan-500 to-teal-700',        abbr: 'TB'  },
  ALOQABANK:      { color: '#0d9488', gradient: 'from-teal-500 to-teal-700',        abbr: 'AL'  },
  UNIVERSALBANK:  { color: '#475569', gradient: 'from-slate-500 to-slate-700',      abbr: 'UN'  },
  TBC:            { color: '#1e40af', gradient: 'from-blue-600 to-blue-800',        abbr: 'TBC' },
  TENGE:          { color: '#0284c7', gradient: 'from-sky-600 to-blue-700',         abbr: 'TG'  },
};

function getBrand(code: string) {
  return BANK_BRAND[code] || { color: '#6366f1', gradient: 'from-indigo-500 to-blue-700', abbr: code.slice(0, 2).toUpperCase() };
}

export default function BanksPage() {
  const t = useTranslations('nav');
  const { locale } = useParams<{ locale: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });

  const banks = data?.items || [];
  const totalAccounts = banks.reduce((s, b: any) => s + (b._count?.accounts || 0), 0);
  const totalCreds = banks.reduce((s, b: any) => s + (b._count?.credentials || 0), 0);
  const activeBanks = banks.filter((b: any) => b.isActive).length;

  return (
    <>
      <Topbar title={t('banks')} subtitle="Mavjud banklar va ulanish holati" />
      <div className="flex-1 p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto w-full">

        {/* ═══ KPI ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile label="Banklar" value={String(banks.length)} icon={Building2} color="indigo" />
          <KpiTile label="Faol" value={String(activeBanks)} icon={Check} color="emerald" />
          <KpiTile label="Ulanishlar" value={String(totalCreds)} icon={KeyRound} color="purple" />
          <KpiTile label="Hisoblar" value={String(totalAccounts)} icon={Wallet} color="amber" />
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-52 w-full" />
            ))}
          </div>
        ) : banks.length === 0 ? (
          <Card><CardContent className="p-0"><EmptyState icon={Building2} title="Banklar yo'q" /></CardContent></Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {banks.map((b: any) => {
              const brand = getBrand(b.code);
              const isWired = (b._count?.credentials || 0) > 0;
              return (
                <Card key={b.id} className="group relative border-0 shadow-soft card-hover overflow-hidden">
                  {/* Top color bar */}
                  <div className={cn("h-1.5 bg-gradient-to-r", brand.gradient)} />

                  {/* Decorative bg */}
                  <div className={cn("absolute -top-12 -right-12 w-44 h-44 rounded-full blur-3xl opacity-25 bg-gradient-to-br", brand.gradient)} />

                  <CardContent className="p-5 relative">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          "w-14 h-14 rounded-2xl grid place-items-center text-white text-base font-black tracking-tight shadow-md bg-gradient-to-br",
                          brand.gradient,
                        )} style={{ letterSpacing: '-0.05em' }}>
                          {brand.abbr}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[15px] font-bold truncate tracking-tight">{b.name}</div>
                          <div className="text-[10px] font-mono text-slate-500">{b.code}</div>
                        </div>
                      </div>
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ring-1 ring-inset",
                        b.isActive
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : "bg-slate-50 text-slate-500 ring-slate-200",
                      )}>
                        <span className="relative flex h-1.5 w-1.5">
                          {b.isActive && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />}
                          <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", b.isActive ? "bg-emerald-500" : "bg-slate-300")} />
                        </span>
                        {b.isActive ? 'Faol' : 'Faolsiz'}
                      </span>
                    </div>

                    <div className="rounded-xl bg-slate-50/60 ring-1 ring-slate-100 px-3 py-2.5 space-y-1.5 mb-4">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500 flex items-center gap-1.5"><Shield className="h-3 w-3" /> API turi</span>
                        <span className="font-mono font-semibold text-slate-700">{b.apiKind}</span>
                      </div>
                      {b.apiBaseUrl && (
                        <div className="flex items-start justify-between text-[11px] gap-2">
                          <span className="text-slate-500 flex items-center gap-1.5 shrink-0"><Globe className="h-3 w-3" /> Endpoint</span>
                          <span className="font-mono truncate text-right text-slate-700" title={b.apiBaseUrl}>
                            {b.apiBaseUrl.replace(/^https?:\/\//, '')}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className="rounded-lg bg-indigo-50/60 ring-1 ring-indigo-100 px-3 py-2">
                        <div className="flex items-center gap-1.5 text-[10px] text-indigo-700 font-semibold uppercase tracking-wider">
                          <KeyRound className="h-3 w-3" /> Ulanish
                        </div>
                        <div className="text-xl font-bold text-indigo-900 tabular-nums">{b._count?.credentials || 0}</div>
                      </div>
                      <div className="rounded-lg bg-emerald-50/60 ring-1 ring-emerald-100 px-3 py-2">
                        <div className="flex items-center gap-1.5 text-[10px] text-emerald-700 font-semibold uppercase tracking-wider">
                          <Wallet className="h-3 w-3" /> Hisob
                        </div>
                        <div className="text-xl font-bold text-emerald-900 tabular-nums">{b._count?.accounts || 0}</div>
                      </div>
                    </div>

                    <Link href={`/${locale}/credentials`}>
                      <Button size="sm" variant="outline" className="w-full h-9 rounded-xl text-xs font-medium gap-1.5 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700">
                        {isWired ? 'Ulanishlarni ko\'rish' : 'Ulanish qo\'shish'}
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Hint card — premium look */}
        <Card className="border-0 shadow-soft overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-blue-50 to-cyan-50 opacity-50" />
          <CardContent className="p-6 relative">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 grid place-items-center shrink-0 shadow-md">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold tracking-tight">Yangi bank qo'shish kerakmi?</div>
                <div className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                  Hozircha to'liq ishlaydigan: <span className="font-semibold text-slate-900">KapitalBank V3</span> va <span className="font-semibold text-slate-900">Ipak Yo'li</span> (bank24.uz protocol).
                  Hamkorbank, NBU, Asaka va boshqa banklar uchun API integratsiya talab qilinadi.
                </div>
                <div className="flex items-center gap-2 mt-3 text-[11px] text-indigo-700 font-medium">
                  <span className="px-2 py-1 rounded-full bg-white/80 ring-1 ring-indigo-100">Server adminga murojaat qiling</span>
                  <span className="text-slate-400">·</span>
                  <span>support@xonapps.uz</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function KpiTile({
  label, value, icon: Icon, color,
}: {
  label: string;
  value: string;
  icon: any;
  color: 'indigo' | 'emerald' | 'purple' | 'amber';
}) {
  const m = {
    indigo:  { grad: 'from-indigo-500 to-blue-600' },
    emerald: { grad: 'from-emerald-500 to-teal-600' },
    purple:  { grad: 'from-purple-500 to-fuchsia-600' },
    amber:   { grad: 'from-amber-500 to-orange-600' },
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
        <div className="text-3xl font-bold tracking-tight tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
