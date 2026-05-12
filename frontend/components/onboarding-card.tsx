'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Building2, KeyRound, Wallet, ArrowRight, Check, Sparkles } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { cn } from '@/lib/utils';

interface Step {
  num: number;
  title: string;
  description: string;
  href: string;
  icon: any;
  done: boolean;
  color: string;
}

/**
 * Onboarding karta — bo'sh tizimda nima qilish kerakligini ko'rsatadi.
 */
export function OnboardingCard({
  banksCount, credentialsCount, accountsCount,
}: { banksCount: number; credentialsCount: number; accountsCount: number }) {
  const { locale } = useParams<{ locale: string }>();

  const steps: Step[] = [
    {
      num: 1,
      title: 'Bank ulanishi qo\'shing',
      description: 'KapitalBank yoki Ipak Yo\'li uchun login va parolni kiriting',
      href: `/${locale}/credentials`,
      icon: KeyRound,
      done: credentialsCount > 0,
      color: 'from-indigo-500 to-blue-600',
    },
    {
      num: 2,
      title: 'Hisoblarni qo\'shing',
      description: 'Bank bergan 20-belgili hisob raqamlarini kiriting',
      href: `/${locale}/accounts`,
      icon: Wallet,
      done: accountsCount > 0,
      color: 'from-emerald-500 to-teal-600',
    },
    {
      num: 3,
      title: 'Avto-sync ishga tushadi',
      description: 'Tranzaksiyalar har 5 daqiqada avtomatik yuklanadi',
      href: `/${locale}/sync-logs`,
      icon: Sparkles,
      done: false,
      color: 'from-purple-500 to-fuchsia-600',
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return (
    <Card className="border-0 shadow-soft overflow-hidden">
      <div className="bg-brand-vivid animate-gradient h-1" />
      <CardContent className="p-6 lg:p-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <div className="text-base lg:text-lg font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-600" />
              Boshlash uchun yo'l-yo'riq
            </div>
            <div className="text-sm text-slate-500 mt-0.5">{completed} / {steps.length} ta qadam bajarildi</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 mb-1">Bajarildi</div>
            <div className="flex gap-1.5">
              {steps.map((s, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-8 h-1.5 rounded-full transition-all",
                    s.done ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-slate-200",
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {steps.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.num}
                href={s.href}
                className={cn(
                  "group relative overflow-hidden rounded-2xl p-5 transition-all hover:-translate-y-0.5",
                  s.done ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-slate-50 hover:bg-white hover:shadow-pop ring-1 ring-slate-100",
                )}
              >
                {/* Step number watermark */}
                <div className="absolute -top-2 -right-2 text-7xl font-black opacity-[0.04] tracking-tighter">
                  {s.num}
                </div>

                <div className="relative">
                  <div className="flex items-center justify-between mb-3">
                    <div className={cn(
                      "w-10 h-10 rounded-xl bg-gradient-to-br grid place-items-center shadow-sm text-white",
                      s.color,
                    )}>
                      <Icon className="h-5 w-5" />
                    </div>
                    {s.done ? (
                      <div className="w-6 h-6 rounded-full bg-emerald-500 text-white grid place-items-center shadow-sm">
                        <Check className="h-3.5 w-3.5" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-500 grid place-items-center text-[10px] font-bold">
                        {s.num}
                      </div>
                    )}
                  </div>
                  <div className="font-semibold text-sm tracking-tight mb-1">{s.title}</div>
                  <div className="text-xs text-slate-500 leading-relaxed">{s.description}</div>
                  <div className="flex items-center gap-1 mt-3 text-xs font-medium text-indigo-600 group-hover:gap-2 transition-all">
                    O'tish <ArrowRight className="h-3 w-3" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
