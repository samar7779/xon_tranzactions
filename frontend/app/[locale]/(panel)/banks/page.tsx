'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Building2, Check, KeyRound, Wallet, Plus, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// Bank brand mapping — code'ga qarab rang va belgi
const BANK_BRAND: Record<string, { color: string; gradient: string; abbr: string }> = {
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
  const tc = useTranslations('common');
  const { locale } = useParams<{ locale: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: any[] }>('/banks'),
  });

  return (
    <>
      <Topbar title={t('banks')} subtitle="Mavjud banklar va ulanish holati" />
      <div className="flex-1 p-6 lg:p-8 space-y-4">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        ) : (data?.items?.length ?? 0) === 0 ? (
          <Card><CardContent className="p-0"><EmptyState icon={Building2} title="Banklar yo'q" /></CardContent></Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data!.items.map((b: any) => {
              const brand = getBrand(b.code);
              return (
                <Card key={b.id} className="group hover:shadow-pop transition-all hover:-translate-y-0.5 overflow-hidden">
                  <div className={cn("h-1 bg-gradient-to-r", brand.gradient)} />
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn("w-12 h-12 rounded-xl grid place-items-center text-white font-bold shadow-sm bg-gradient-to-br", brand.gradient)}>
                          {brand.abbr}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{b.name}</div>
                          <div className="text-xs font-mono text-muted-foreground">{b.code}</div>
                        </div>
                      </div>
                      <Badge variant={b.isActive ? 'success' : 'muted'}>
                        {b.isActive ? <><Check className="h-3 w-3 mr-1" /> Faol</> : 'Faolsiz'}
                      </Badge>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">API turi</span>
                        <Badge variant="outline" className="font-mono text-[10px]">{b.apiKind}</Badge>
                      </div>
                      {b.apiBaseUrl && (
                        <div className="flex items-start justify-between text-xs gap-2">
                          <span className="text-muted-foreground shrink-0">API URL</span>
                          <span className="font-mono text-[10px] truncate text-right" title={b.apiBaseUrl}>
                            {b.apiBaseUrl.replace(/^https?:\/\//, '')}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t flex items-center justify-between">
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><KeyRound className="h-3 w-3" /> {b._count?.credentials || 0} ulanish</span>
                        <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" /> {b._count?.accounts || 0} hisob</span>
                      </div>
                      <Link href={`/${locale}/credentials?bankId=${b.id}`}>
                        <Button size="sm" variant="ghost" className="h-7 text-xs">
                          Ulanish <ExternalLink className="h-3 w-3 ml-1" />
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Hint card */}
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
                <Plus className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium">Boshqa bank qo'shish</div>
                <div className="text-xs text-muted-foreground mt-1 max-w-xl">
                  Yangi banklarni server admin orqali qo'shamiz — har biri uchun API integratsiya kerak.
                  Hozircha to'liq ishlaydigan: <span className="font-medium">KapitalBank V3</span>.
                  Ipak Yo'li, NBU, Hamkorbank va boshqalar kelyapti.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
