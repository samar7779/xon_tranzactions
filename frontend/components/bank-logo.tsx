import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Bank kodi → logo fayli (frontend/public/banks/ ichida)
const BANK_LOGOS: Record<string, string> = {
  KAPITALBANK: '/banks/kapital.webp',
  IPAK_YULI: '/banks/ipak.svg',
};

// Logo orqa foni — ba'zi logolar oq fonda yaxshi ko'rinmaydi
const BANK_LOGO_BG: Record<string, string> = {
  KAPITALBANK: 'bg-amber-400 ring-amber-300',  // sariq fon
  IPAK_YULI: 'bg-white ring-slate-200',
};

// Bank kodi → brand rangi (logo yo'q banklar uchun fallback gradient)
const BANK_GRADIENTS: Record<string, string> = {
  KAPITALBANK: 'from-sky-500 to-blue-700',
  IPAK_YULI: 'from-emerald-500 to-emerald-700',
  NBU: 'from-blue-700 to-indigo-900',
  HAMKORBANK: 'from-amber-500 to-orange-600',
  ASAKABANK: 'from-red-600 to-rose-800',
  ANORBANK: 'from-green-500 to-green-700',
  DAVRBANK: 'from-violet-500 to-purple-700',
  TRUSTBANK: 'from-cyan-500 to-teal-700',
  ALOQABANK: 'from-teal-500 to-teal-700',
  UNIVERSAL: 'from-slate-500 to-slate-700',
  TBC: 'from-blue-600 to-blue-800',
  TENGE: 'from-sky-600 to-blue-700',
};

export function bankAbbr(code: string, name?: string): string {
  const map: Record<string, string> = {
    KAPITALBANK: 'KB', IPAK_YULI: 'IY', NBU: 'NBU', HAMKORBANK: 'HB',
    ASAKABANK: 'AB', ANORBANK: 'AN', DAVRBANK: 'DB', TRUSTBANK: 'TB',
    ALOQABANK: 'AL', UNIVERSAL: 'UN', TBC: 'TBC', TENGE: 'TG',
  };
  if (map[code]) return map[code];
  const src = (name || code).replace(/[^A-Za-z ]/g, '').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function bankGradient(code: string): string {
  return BANK_GRADIENTS[code] || 'from-indigo-500 to-blue-700';
}

/**
 * Bank logosi — agar real logo bo'lsa (Kapital/Ipak) rasm,
 * aks holda abbreviation + gradient fallback.
 */
export function BankLogo({
  code,
  name,
  size = 44,
  className,
  rounded = 'rounded-xl',
}: {
  code: string;
  name?: string;
  size?: number;
  className?: string;
  rounded?: string;
}) {
  const logo = BANK_LOGOS[code];

  if (logo) {
    const bg = BANK_LOGO_BG[code] || 'bg-white ring-slate-200';
    return (
      <div
        className={cn('grid place-items-center ring-1 shrink-0 overflow-hidden', bg, rounded, className)}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={name || code} className="w-full h-full object-contain p-1" />
      </div>
    );
  }

  // Fallback — abbreviation + gradient
  return (
    <div
      className={cn(
        'grid place-items-center text-white font-black tracking-tight shadow-sm shrink-0 bg-gradient-to-br',
        bankGradient(code),
        rounded,
        className,
      )}
      style={{ width: size, height: size, letterSpacing: '-0.05em', fontSize: size * 0.32 }}
    >
      {bankAbbr(code, name)}
    </div>
  );
}
