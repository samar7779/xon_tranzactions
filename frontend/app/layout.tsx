import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    template: '%s · Xon Tranzaksiyalar',
    default: 'Xon Tranzaksiyalar',
  },
  description: 'Xon Saroy — banklar tranzaksiyalari monitoring tizimi',
  applicationName: 'Xon Tranzaksiyalar',
  authors: [{ name: 'Xon Saroy' }],
  themeColor: '#4f46e5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
