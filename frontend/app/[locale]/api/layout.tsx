import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Developer API',
  description: 'Xon Tranzaksiyalar — tashqi tizim integratsiyasi uchun REST API. Test va dokumentatsiya.',
};

export default function ApiLayout({ children }: { children: React.ReactNode }) {
  return children;
}
