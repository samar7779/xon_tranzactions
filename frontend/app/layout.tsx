import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: {
    template: '%s · Xon Tranzaksiyalar',
    default: 'Xon Tranzaksiyalar',
  },
  description: 'Xon Saroy — banklar tranzaksiyalari va billing monitoring tizimi',
  applicationName: 'Xon Tranzaksiyalar',
  authors: [{ name: 'Xon Saroy' }],
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
