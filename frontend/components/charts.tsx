/**
 * Pure-SVG chart komponentlar — tashqi paket talab qilinmaydi.
 * Modern fintech dashboard'lari uslubida.
 */
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

// ─────────────── Smooth area chart ───────────────
interface AreaChartProps {
  data: { label: string; value: number }[];
  height?: number;
  className?: string;
  gradientFrom?: string;
  gradientTo?: string;
  stroke?: string;
  showGrid?: boolean;
  showLabels?: boolean;
}

export function AreaChart({
  data, height = 240, className,
  gradientFrom = '#6366f1', gradientTo = '#06b6d4',
  stroke = '#6366f1', showGrid = true, showLabels = true,
}: AreaChartProps) {
  const id = useMemo(() => `area-${Math.random().toString(36).slice(2, 8)}`, []);

  if (data.length === 0) return null;

  const W = 800; // viewBox bo'yi
  const H = height;
  const padL = showLabels ? 40 : 8;
  const padR = 16;
  const padT = 16;
  const padB = showLabels ? 28 : 8;

  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(0, ...data.map((d) => d.value));
  const range = max - min || 1;

  const x = (i: number) => padL + (i / Math.max(1, data.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - min) / range);

  const pts = data.map((d, i) => [x(i), y(d.value)] as [number, number]);

  // Smooth cubic curve through points
  const linePath = smoothPath(pts);
  const areaPath = `${linePath} L${pts[pts.length - 1][0]},${H - padB} L${pts[0][0]},${H - padB} Z`;

  // Grid lines (4)
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((p) => padT + (H - padT - padB) * p);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('w-full h-auto', className)} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={gradientFrom} stopOpacity="0.45" />
          <stop offset="100%" stopColor={gradientTo} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={gradientFrom} />
          <stop offset="100%" stopColor={gradientTo} />
        </linearGradient>
      </defs>

      {showGrid && gridY.map((gy, i) => (
        <line key={i} x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="#e5e7eb" strokeWidth="1" strokeDasharray={i === 0 || i === gridY.length - 1 ? '0' : '3 3'} />
      ))}

      <path d={areaPath} fill={`url(#${id}-fill)`} />
      <path d={linePath} fill="none" stroke={`url(#${id}-stroke)`} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* End point glow */}
      {pts.length > 0 && (
        <>
          <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="6" fill={stroke} opacity="0.25">
            <animate attributeName="r" values="6;12;6" dur="2.5s" repeatCount="indefinite" />
          </circle>
          <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" fill="white" stroke={stroke} strokeWidth="2.5" />
        </>
      )}

      {/* Y-axis labels (4) */}
      {showLabels && [1, 0.75, 0.5, 0.25, 0].map((p, i) => {
        const v = min + range * p;
        return (
          <text
            key={i}
            x={padL - 8}
            y={padT + (H - padT - padB) * (1 - p) + 4}
            fontSize="10"
            fill="#94a3b8"
            textAnchor="end"
            fontFamily="Inter"
          >
            {formatShort(v)}
          </text>
        );
      })}

      {/* X-axis labels (every Nth) */}
      {showLabels && data.map((d, i) => {
        if (i % Math.ceil(data.length / 8) !== 0 && i !== data.length - 1) return null;
        return (
          <text
            key={i}
            x={x(i)}
            y={H - padB + 16}
            fontSize="10"
            fill="#94a3b8"
            textAnchor="middle"
            fontFamily="Inter"
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

// ─────────────── Donut chart ───────────────
interface DonutChartProps {
  data: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  className?: string;
}

export function DonutChart({
  data, size = 200, thickness = 28, centerLabel, centerValue, className,
}: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - thickness / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;

  let offset = 0;
  const segments = data.map((d) => {
    const frac = d.value / total;
    const len = C * frac;
    const seg = {
      ...d,
      offset,
      length: len,
      gap: C - len,
    };
    offset += len;
    return seg;
  });

  return (
    <div className={cn('relative inline-block', className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${s.length} ${s.gap}`}
            strokeDashoffset={-s.offset}
            style={{ transition: 'stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease' }}
          />
        ))}
      </svg>
      {(centerLabel || centerValue) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerValue && <div className="text-2xl font-bold tracking-tight tabular-nums">{centerValue}</div>}
          {centerLabel && <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">{centerLabel}</div>}
        </div>
      )}
    </div>
  );
}

// ─────────────── Bar chart (vertical) ───────────────
interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  className?: string;
}

export function BarChart({ data, height = 180, className }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className={cn('flex items-end gap-2', className)} style={{ height }}>
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 24);
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
            <div
              className="w-full rounded-t-md bg-gradient-to-t from-indigo-500 to-blue-400 transition-all duration-700"
              style={{ height: h, backgroundColor: d.color }}
            />
            <div className="text-[10px] text-slate-500 truncate w-full text-center">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────── Helpers ───────────────
function smoothPath(pts: [number, number][]) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    const mx = (x1 + x2) / 2;
    d += ` Q${x1},${y1} ${mx},${(y1 + y2) / 2} T${x2},${y2}`;
  }
  return d;
}

function formatShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toFixed(0);
}
