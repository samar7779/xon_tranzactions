/**
 * Sparkline — SVG mini chart. Hech qanday tashqi paket talab qilinmaydi.
 */
import { cn } from '@/lib/utils';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
}

export function Sparkline({
  data, width = 120, height = 36, stroke = 'currentColor', fill = 'currentColor', className,
}: SparklineProps) {
  // Bo'sh bo'lsa — flat liniya
  const points = data.length > 0 ? data : [0, 0];
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const pts = points.map((v, i) => {
    const x = pad + (i / Math.max(1, points.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return [x, y];
  });

  const linePath = pts.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(' ');
  const areaPath = `${linePath} L${pad + w},${pad + h} L${pad},${pad + h} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('overflow-visible', className)}>
      <defs>
        <linearGradient id={`spark-grad-${stroke.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.35" />
          <stop offset="100%" stopColor={fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-grad-${stroke.replace(/[^a-z0-9]/gi, '')})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.length > 0 && (
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={stroke}>
          <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}
