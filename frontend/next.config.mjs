import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Deploy paytida temp papkaga build qilib, keyin atomik almashtirish uchun.
  // Server (next start) NEXT_DIST_DIR'siz ishlaydi → har doim '.next' o'qiydi.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    typedRoutes: false,
  },
};

export default withNextIntl(nextConfig);
