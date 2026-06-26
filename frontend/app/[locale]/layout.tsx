import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Toaster } from 'sonner';
import { locales } from '@/i18n/config';
import { ReactQueryProvider } from '@/components/providers';
import '@/app/globals.css';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  if (!locales.includes(locale as any)) notFound();
  // next-intl: locale'ni server contextga o'rnatish, statik render uchun shart
  unstable_setRequestLocale(locale);
  const messages = await getMessages();

  return (
    // suppressHydrationWarning — bootstrap script <html>ga 'dark' klass qo'shadi,
    // server HTML'da u yo'q. Bu attribute bo'lmasa React hydration paytida
    // nomuvofiqlikni "tuzatib" klassni olib tashlaydi → dark rejim refresh'da yo'qoladi.
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Theme bootstrap — JS bilan birinchi render'da darrov apply qiladi (FOUC oldini olish) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='dark'){d.classList.add('dark');}else{d.classList.remove('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ReactQueryProvider>{children}</ReactQueryProvider>
          <Toaster position="top-right" richColors />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
