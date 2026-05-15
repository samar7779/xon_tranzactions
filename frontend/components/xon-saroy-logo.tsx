import Image from 'next/image';
import { cn } from '@/lib/utils';

interface XonSaroyLogoProps {
  /** Pikselda kenglik (asl nisbat saqlanadi). Default 200. */
  size?: number;
  className?: string;
  /** Yon-atrofda yumshoq oltin glow halo */
  glow?: boolean;
  /** Image'ni eager yuklab olish (above-the-fold uchun) */
  priority?: boolean;
}

/**
 * Xon Saroy oltin brand logosi.
 * Bitta joyda saqlanadi — istalgan sahifada ishlatish mumkin.
 */
export function XonSaroyLogo({
  size = 200,
  className,
  glow = false,
  priority = false,
}: XonSaroyLogoProps) {
  return (
    <div className={cn('relative inline-block', className)} style={{ width: size }}>
      {glow && (
        <div
          className="absolute inset-0 -inset-x-8 bg-amber-400/25 blur-3xl rounded-full -z-10 pointer-events-none"
          aria-hidden
        />
      )}
      <Image
        src="/xon-saroy-logo.png"
        alt="Xon Saroy"
        width={size}
        height={size}
        priority={priority}
        className="w-full h-auto object-contain select-none drop-shadow-[0_4px_20px_rgba(245,158,11,0.25)]"
        draggable={false}
      />
    </div>
  );
}
