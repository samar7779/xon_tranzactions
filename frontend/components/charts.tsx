/**
 * Pure-SVG chart komponentlar — tashqi paket talab qilinmaydi.
 * Modern fintech dashboard'lari uslubida.
 */
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

// ─────────────── Dual area chart (kirim/chiqim) ───────────────
interface DualAreaChartProps {
  data: { label: string; inflow: number; outflow: number; weekend?: boolean }[];
  height?: number;
  className?: string;
}

/**
 * Ikki maydonli (kirim yashil, chiqim qizil) kunma-kun grafik.
 * Glow effekt, chizilish animatsiyasi, pulsing nuqtalar, hover tooltip.
 */
export function DualAreaChart({ data, height = 300, className }: DualAreaChartProps) {
  const id = useMemo(() => `dual-${Math.random().toString(36).slice(2, 8)}`, []);
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className={cn('grid place-items-center text-xs text-slate-400', className)} style={{ height }}>
        Ma'lumot yo'q
      </div>
    );
  }

  const W = 800;
  const H = height;
  const n = data.length;
  const max = Math.max(...data.map((d) => Math.max(d.inflow, d.outflow)), 1);

  const xFrac = (i: number) => (n === 1 ? 0.5 : i / (n - 1));
  const yFrac = (v: number) => v / max;
  const X = (i: number) => xFrac(i) * W;
  const Y = (v: number) => (1 - yFrac(v)) * H;

  const inPts = data.map((d, i) => [X(i), Y(d.inflow)] as [number, number]);
  const outPts = data.map((d, i) => [X(i), Y(d.outflow)] as [number, number]);

  const inLine = smoothPath(inPts);
  const outLine = smoothPath(outPts);
  const inArea = `${inLine} L${inPts[n - 1][0]},${H} L${inPts[0][0]},${H} Z`;
  const outArea = `${outLine} L${outPts[n - 1][0]},${H} L${outPts[0][0]},${H} Z`;

  const gridYs = [0, 0.25, 0.5, 0.75, 1];
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((p) => formatShort(max * p));
  const step = Math.max(1, Math.ceil(n / 8));

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const idx = Math.min(n - 1, Math.max(0, Math.round(frac * (n - 1))));
    setHover(idx);
  }

  const h = hover;

  return (
    <div className={cn('w-full', className)}>
      <div className="flex">
        {/* Y o'qi belgilari */}
        <div className="w-14 shrink-0 relative" style={{ height: H }}>
          {yTicks.map((t, i) => (
            <div
              key={i}
              className="absolute right-2 text-[10px] text-slate-400 tabular-nums font-medium -translate-y-1/2"
              style={{ top: `${(i / (yTicks.length - 1)) * 100}%` }}
            >
              {t}
            </div>
          ))}
        </div>

        {/* Plot maydoni */}
        <div
          className="flex-1 relative rounded-lg bg-gradient-to-b from-slate-50/40 to-transparent overflow-hidden"
          style={{ height: H }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* Dam olish kunlari (shanba/yakshanba) — yengil sariq fon */}
          {data.map((d, i) => {
            if (!d.weekend) return null;
            const sp = n > 1 ? 1 / (n - 1) : 1;
            const left = Math.max(0, xFrac(i) - sp / 2);
            const right = Math.min(1, xFrac(i) + sp / 2);
            return (
              <div
                key={`wk-${i}`}
                className="absolute top-0 bottom-0 bg-amber-50 pointer-events-none"
                style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}
              />
            );
          })}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
            <defs>
              <linearGradient id={`${id}-in`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.38" />
                <stop offset="60%" stopColor="#10b981" stopOpacity="0.09" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`${id}-out`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.30" />
                <stop offset="60%" stopColor="#f43f5e" stopOpacity="0.07" />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Grid */}
            {gridYs.map((p, i) => (
              <line
                key={i}
                x1={0}
                y1={p * H}
                x2={W}
                y2={p * H}
                stroke="#e2e8f0"
                strokeWidth="1"
                strokeDasharray={i === gridYs.length - 1 ? '0' : '4 4'}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Maydonlar */}
            <path d={outArea} fill={`url(#${id}-out)`} />
            <path d={inArea} fill={`url(#${id}-in)`} />

            {/* Chiziqlar — toza, aniq */}
            <path
              d={outLine}
              fill="none"
              stroke="#f43f5e"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={inLine}
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Hover qatlami */}
          {h !== null && (
            <>
              <div
                className="absolute top-0 bottom-0 w-px pointer-events-none
                           bg-gradient-to-b from-slate-400/0 via-slate-400/60 to-slate-400/0"
                style={{ left: `${xFrac(h) * 100}%` }}
              />
              <div
                className="absolute w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white shadow-md pointer-events-none -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${xFrac(h) * 100}%`, top: `${(1 - yFrac(data[h].inflow)) * 100}%` }}
              />
              <div
                className="absolute w-3 h-3 rounded-full bg-rose-500 ring-2 ring-white shadow-md pointer-events-none -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${xFrac(h) * 100}%`, top: `${(1 - yFrac(data[h].outflow)) * 100}%` }}
              />
              {/* Tooltip */}
              <div
                className="absolute z-10 pointer-events-none -translate-x-1/2 bg-white rounded-xl
                           shadow-[0_8px_30px_-6px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/80 overflow-hidden"
                style={{ left: `${Math.min(82, Math.max(18, xFrac(h) * 100))}%`, top: 10 }}
              >
                <div className="bg-slate-900 text-white text-[11px] font-bold tabular-nums px-3 py-1.5">
                  {data[h].label}
                </div>
                <div className="px-3 py-2 space-y-1">
                  <div className="flex items-center gap-2 whitespace-nowrap text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-slate-500">Kirim</span>
                    <span className="ml-auto font-bold text-emerald-700 tabular-nums">{formatFull(data[h].inflow)}</span>
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <span className="text-slate-500">Chiqim</span>
                    <span className="ml-auto font-bold text-rose-700 tabular-nums">{formatFull(data[h].outflow)}</span>
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap text-[11px] pt-1 border-t border-slate-100">
                    <span className="text-slate-500">Sof</span>
                    <span className={cn(
                      "ml-auto font-bold tabular-nums",
                      data[h].inflow - data[h].outflow >= 0 ? "text-emerald-700" : "text-rose-700",
                    )}>
                      {data[h].inflow - data[h].outflow >= 0 ? '+' : ''}{formatFull(data[h].inflow - data[h].outflow)}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* X o'qi belgilari */}
      <div className="flex mt-2">
        <div className="w-14 shrink-0" />
        <div className="flex-1 relative h-4">
          {data.map((d, i) => {
            if (i % step !== 0 && i !== n - 1) return null;
            return (
              <div
                key={i}
                className="absolute text-[10px] text-slate-400 tabular-nums font-medium -translate-x-1/2"
                style={{ left: `${xFrac(i) * 100}%` }}
              >
                {d.label}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

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

// ─────────────── Daily grouped bar chart (kirim / chiqim / tranzaksiya soni) ───────────────
interface DailyBarChartProps {
  data: { label: string; inflow: number; outflow: number; count: number; weekend?: boolean }[];
  height?: number;
  className?: string;
}

/**
 * Kunma-kun 3 ta ustun: kirim (yashil), chiqim (qizil), tranzaksiya soni (ko'k).
 * Pul chap o'qda, soni o'ng o'qda (ikki xil masshtab).
 */
export function DailyBarChart({ data, height = 260, className }: DailyBarChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className={cn('grid place-items-center text-xs text-slate-400', className)} style={{ height }}>
        Ma'lumot yo'q
      </div>
    );
  }

  const maxMoney = Math.max(...data.map((d) => Math.max(d.inflow, d.outflow)), 1);
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const plotH = height - 28;
  const moneyTicks = [1, 0.75, 0.5, 0.25, 0].map((p) => formatShort(maxMoney * p));
  const countTicks = [1, 0.75, 0.5, 0.25, 0].map((p) => Math.round(maxCount * p).toString());

  return (
    <div className={cn('w-full', className)}>
      <div className="flex" style={{ height: plotH }}>
        {/* Chap o'q — pul */}
        <div className="w-14 shrink-0 relative">
          {moneyTicks.map((t, i) => (
            <div key={i} className="absolute right-2 text-[10px] text-slate-400 tabular-nums -translate-y-1/2"
              style={{ top: `${(i / 4) * 100}%` }}>{t}</div>
          ))}
        </div>

        {/* Plot */}
        <div className="flex-1 relative" onMouseLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
            <div key={i} className="absolute left-0 right-0 border-t border-slate-100" style={{ top: `${p * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-1">
            {data.map((d, i) => (
              <div
                key={i}
                className={cn(
                  'flex-1 h-full flex items-end justify-center gap-[2px] min-w-0 relative rounded-sm transition-colors',
                  hover === i ? 'bg-slate-100' : d.weekend ? 'bg-amber-50' : '',
                )}
                onMouseEnter={() => setHover(i)}
              >
                <div className="w-full max-w-[9px] rounded-t-sm bg-emerald-500" style={{ height: `${(d.inflow / maxMoney) * 100}%` }} />
                <div className="w-full max-w-[9px] rounded-t-sm bg-rose-500" style={{ height: `${(d.outflow / maxMoney) * 100}%` }} />
                <div className="w-full max-w-[9px] rounded-t-sm bg-blue-500" style={{ height: `${(d.count / maxCount) * 100}%` }} />

                {hover === i && (
                  <div className="absolute z-10 bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-white rounded-xl
                                  shadow-[0_8px_30px_-6px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/80 overflow-hidden">
                    <div className="bg-slate-900 text-white text-[11px] font-bold tabular-nums px-3 py-1.5">{d.label}</div>
                    <div className="px-3 py-2 space-y-1">
                      <div className="flex items-center gap-2 whitespace-nowrap text-[11px]">
                        <span className="w-2 h-2 rounded-sm bg-emerald-500" />
                        <span className="text-slate-500">Kirim</span>
                        <span className="ml-auto font-bold text-emerald-700 tabular-nums">{formatFull(d.inflow)}</span>
                      </div>
                      <div className="flex items-center gap-2 whitespace-nowrap text-[11px]">
                        <span className="w-2 h-2 rounded-sm bg-rose-500" />
                        <span className="text-slate-500">Chiqim</span>
                        <span className="ml-auto font-bold text-rose-700 tabular-nums">{formatFull(d.outflow)}</span>
                      </div>
                      <div className="flex items-center gap-2 whitespace-nowrap text-[11px] pt-1 border-t border-slate-100">
                        <span className="w-2 h-2 rounded-sm bg-blue-500" />
                        <span className="text-slate-500">Tranzaksiya</span>
                        <span className="ml-auto font-bold text-blue-700 tabular-nums">{d.count} ta</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* O'ng o'q — soni */}
        <div className="w-10 shrink-0 relative">
          {countTicks.map((t, i) => (
            <div key={i} className="absolute left-1.5 text-[10px] text-blue-400 tabular-nums -translate-y-1/2"
              style={{ top: `${(i / 4) * 100}%` }}>{t}</div>
          ))}
        </div>
      </div>

      {/* X o'qi belgilari — barchasi ko'rsatiladi, dam olish kunlari sariq */}
      <div className="flex mt-1.5">
        <div className="w-14 shrink-0" />
        <div className="flex-1 flex gap-1">
          {data.map((d, i) => (
            <div
              key={i}
              className={cn(
                'flex-1 text-[8px] text-center leading-tight tabular-nums',
                d.weekend ? 'text-amber-600 font-semibold' : 'text-slate-400',
              )}
            >
              {d.label}
            </div>
          ))}
        </div>
        <div className="w-10 shrink-0" />
      </div>

      {/* Legenda */}
      <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> Kirim</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500" /> Chiqim</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500" /> Tranzaksiya soni</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-100 ring-1 ring-amber-300" /> Dam olish kuni</span>
      </div>
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

// To'liq raqam — mingliklar probel bilan ajratiladi (1 234 567)
function formatFull(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
