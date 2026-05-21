import { AuthGuard } from '@/components/auth-guard';
import { RouteGuard } from '@/components/route-guard';
import { Sidebar } from '@/components/sidebar';
import { ScrollToTop } from '@/components/scroll-to-top';
import { DeployModal } from '@/components/deploy-modal';

// Panel sahifalari faqat login'dan keyin ko'rinadi — statik render kerak emas
export const dynamic = 'force-dynamic';

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="h-screen flex bg-muted/30 overflow-hidden">
        <Sidebar />
        <main id="panel-scroll" className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <RouteGuard>{children}</RouteGuard>
        </main>
        <ScrollToTop />
        {/* Deploy bildirishnoma modali — barcha panel sahifalarida */}
        <DeployModal />
      </div>
    </AuthGuard>
  );
}
