import { AuthGuard } from '@/components/auth-guard';
import { Sidebar } from '@/components/sidebar';

// Panel sahifalari faqat login'dan keyin ko'rinadi — statik render kerak emas
export const dynamic = 'force-dynamic';

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="h-screen flex bg-muted/30 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">{children}</main>
      </div>
    </AuthGuard>
  );
}
