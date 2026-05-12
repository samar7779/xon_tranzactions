import { cn } from '@/lib/utils';

interface PageHeroProps {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string;
  variant?: 'brand' | 'success' | 'rose' | 'cyan' | 'purple';
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

const VARIANTS = {
  brand:   'bg-brand-vivid',
  success: 'bg-brand-success',
  rose:    'bg-brand-rose',
  cyan:    'bg-brand-cyan',
  purple:  'bg-brand-purple',
};

/**
 * Har bir sahifaning tepasidagi gradient hero — Click/Payme uslubida.
 * Title, subtitle, ikoncha, badge (status chip) va action tugmalari.
 */
export function PageHero({
  title, subtitle, icon: Icon, badge, variant = 'brand', actions, children,
}: PageHeroProps) {
  return (
    <div className={cn(
      "relative rounded-3xl overflow-hidden shadow-pop animate-fade-up",
      VARIANTS[variant],
      "animate-gradient",
    )}>
      <div className="absolute inset-0 bg-dots opacity-20" />
      <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/20 blur-3xl pointer-events-none animate-float-slow" />
      <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-white/10 blur-3xl pointer-events-none animate-float-slow" style={{ animationDelay: '3s' }} />

      <div className="relative p-6 lg:p-8 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            {Icon && (
              <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-sm ring-1 ring-white/25 grid place-items-center shrink-0">
                <Icon className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0">
              {badge && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/20 text-[10px] font-medium mb-2 uppercase tracking-wider">
                  {badge}
                </span>
              )}
              <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">{title}</h1>
              {subtitle && <p className="text-sm lg:text-[15px] text-white/85 mt-1.5 max-w-2xl">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
        </div>

        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}
