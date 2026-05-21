'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

export default function OplatyKvOverview() {
  const { locale } = useParams<{ locale: string }>();

  return (
    <div className="flex-1 p-3 sm:p-6 lg:p-8 w-full">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">ОплатыКв</h1>
          <p className="text-sm text-slate-500 mt-1">
            Kvartira to'lovlari boshqaruvi · CRM ma'lumotlari va bank sverkasi
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href={`/${locale}/oplatykv/crm`}
            className="group relative overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 shadow-soft hover:shadow-lg hover:ring-indigo-300 transition-all p-6"
          >
            <div className="flex items-start gap-4">
              <span className="relative w-14 h-14 rounded-xl overflow-hidden bg-white ring-1 ring-slate-200 shadow-sm shrink-0">
                <Image src="/xon-saroy-logo.png" alt="XonSaroy" fill sizes="56px" className="object-contain p-1.5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-slate-900 text-lg">CRM</h2>
                  <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                </div>
                <p className="text-[13px] text-slate-500 mt-1 leading-relaxed">
                  XonSaroy CRM bazasidan shartnoma, klient va to'lovlar tarixini ko'rish
                </p>
              </div>
            </div>
            <span className="pointer-events-none absolute -bottom-8 -right-8 w-32 h-32 rounded-full bg-indigo-100/50 blur-2xl group-hover:bg-indigo-200/60 transition-all" />
          </Link>

          <Link
            href={`/${locale}/oplatykv/billing`}
            className="group relative overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 shadow-soft hover:shadow-lg hover:ring-violet-300 transition-all p-6"
          >
            <div className="flex items-start gap-4">
              <span className="relative w-14 h-14 rounded-xl overflow-hidden bg-white ring-1 ring-slate-200 shadow-sm shrink-0">
                <Image src="/xonpay.jpg" alt="XonPay" fill sizes="56px" className="object-cover" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-slate-900 text-lg">Billing</h2>
                  <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-violet-600 group-hover:translate-x-1 transition-all" />
                </div>
                <p className="text-[13px] text-slate-500 mt-1 leading-relaxed">
                  XonPay to'lovlar va Kapitalbank tushumlari moslashtirilishi (sverka)
                </p>
              </div>
            </div>
            <span className="pointer-events-none absolute -bottom-8 -right-8 w-32 h-32 rounded-full bg-violet-100/50 blur-2xl group-hover:bg-violet-200/60 transition-all" />
          </Link>
        </div>
      </div>
    </div>
  );
}
