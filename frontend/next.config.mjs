import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Deploy paytida temp papkaga build qilib, keyin atomik almashtirish uchun.
  // Server (next start) NEXT_DIST_DIR'siz ishlaydi → har doim '.next' o'qiydi.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Build tezligi uchun — TS va ESLint validatsiya lokalda push'dan oldin amalga oshiriladi
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false }, // TS check kerak — agar lokalda o'tmasligi mumkin
  // Production build'da `next start` uchun image optimizatsiyasini standartda qoldiramiz
  experimental: {
    typedRoutes: false,
  },
  // Source maps production'da kerakmas — build tezroq
  productionBrowserSourceMaps: false,
};

export default withNextIntl(nextConfig);
