'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  RefreshCw, KeyRound, Wallet, UserPlus, Zap, ArrowRight,
} from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Action {
  label: string;
  description: string;
  icon: any;
  color: string;
  href?: string;
  onClick?: () => void;
  badge?: string;
}

export function QuickActions({ accountsCount = 0 }: { accountsCount?: number }) {
  const { locale } = useParams<{ locale: string }>();
  const qc = useQueryClient();

  // Sync all accounts
  const syncMut = useMutation({
    mutationFn: async () => {
      const accs = await api.get<{ items: any[] }>('/bank-accounts');
      const results = await Promise.allSettled(
        (accs.items || [])
          .filter((a: any) => a.syncEnabled)
          .map((a: any) => api.post(`/sync/account/${a.id}`)),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      return { ok, total: results.length };
    },
    onSuccess: (r: any) => {
      toast.success(`✓ ${r.ok} / ${r.total} hisob sync qilindi`);
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message),
  });

  const actions: Action[] = [
    {
      label: 'Hozir sync',
      description: 'Barcha hisoblarni yangilash',
      icon: RefreshCw,
      color: 'from-indigo-500 to-blue-600',
      onClick: () => syncMut.mutate(),
      badge: syncMut.isPending ? 'Yuklanmoqda...' : undefined,
    },
    {
      label: 'Bank ulanishi',
      description: 'Yangi bank API qo\'shish',
      icon: KeyRound,
      color: 'from-emerald-500 to-teal-600',
      href: `/${locale}/setup/credentials`,
    },
    {
      label: 'Hisob qo\'shish',
      description: '20-belgili hisob raqami',
      icon: Wallet,
      color: 'from-purple-500 to-fuchsia-600',
      href: `/${locale}/setup/accounts`,
    },
    {
      label: 'Foydalanuvchi',
      description: 'Yangi admin yoki hisobchi',
      icon: UserPlus,
      color: 'from-amber-500 to-orange-600',
      href: `/${locale}/admin/users`,
    },
  ];

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <Zap className="h-4 w-4 text-amber-500" />
          <div className="text-sm font-semibold tracking-tight">Tezkor amallar</div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {actions.map((a) => {
            const Icon = a.icon;
            const content = (
              <div className="group relative rounded-2xl bg-slate-50 hover:bg-white hover:shadow-pop hover:-translate-y-0.5 transition-all p-4 ring-1 ring-slate-100 cursor-pointer h-full">
                <div className="flex items-start justify-between mb-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl bg-gradient-to-br grid place-items-center shadow-sm text-white",
                    a.color,
                  )}>
                    <Icon className={cn("h-5 w-5", a.label === 'Hozir sync' && syncMut.isPending && 'animate-spin')} />
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                </div>
                <div className="font-semibold text-sm tracking-tight">{a.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{a.badge || a.description}</div>
              </div>
            );
            if (a.href) {
              return <Link key={a.label} href={a.href}>{content}</Link>;
            }
            return <button key={a.label} onClick={a.onClick} className="text-left" disabled={a.label === 'Hozir sync' && (accountsCount === 0 || syncMut.isPending)}>{content}</button>;
          })}
        </div>
      </CardContent>
    </Card>
  );
}
