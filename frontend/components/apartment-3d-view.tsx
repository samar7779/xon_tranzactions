'use client';

import { useMemo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Home, User2, Calendar, Building2, TrendingUp, AlertCircle, Compass,
  ArrowLeft, ArrowRight, ArrowUp, DoorOpen, Bath, Bed, ChefHat, Sofa,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

/**
 * Xonadon planirovka ko'rinishi — top-down arxitekturali plan.
 *
 * Top-down SVG floor plan: xonalar, devorlar, eshiklar, derazalar,
 * mebellar (qisqacha), m² label'lar bilan.
 *
 * Ma'lumotlar manbai: /oplata-kv/crm-sverka — CRM'dagi shartnoma narxi,
 * xonadon ma'lumotlari (xonalar soni, m², qavat, blok).
 *
 * Planirovka procedurally yaratiladi:
 *   - 1 xona: studio (zal+oshxona birga + vanna)
 *   - 2 xona: zal + yotoq + oshxona + vanna
 *   - 3 xona: zal + 2 yotoq + oshxona + vanna + WC
 *   - 4+ xona: zal + 3 yotoq + oshxona + 2 vanna
 */

type ApartmentData = {
  contractNo: string;
  object: string | null;
  client: string | null;
  totalPrice: number;
  totalPaid: number;
  initialPlan: number;
  initialPaid: number;
  monthlyPlan: number;
  monthlyPaid: number;
  contractDate: string | null;
  status: string | null;
  aptNumber: string | null;
  rooms: number | null;
  area: number | null;
  building: string | null;
  block: string | null;
  floor: number | null;
};

// ═══════════════════════════════════════════════════════════════
//                    PROCEDURAL FLOOR PLAN GENERATOR
// ═══════════════════════════════════════════════════════════════

type RoomKind = 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'wc' | 'corridor' | 'balcony';

type Room = {
  kind: RoomKind;
  label: string;
  x: number;       // top-left x (m)
  y: number;       // top-left y (m)
  w: number;       // width (m)
  h: number;       // height (m)
  area: number;    // m²
};

type Door = {
  x: number;       // hinge x (m)
  y: number;       // hinge y (m)
  width: number;   // door width (m)
  direction: 'N' | 'E' | 'S' | 'W';  // qaysi tomonga ochiladi
  swing: 'left' | 'right';
};

type Window = {
  x: number;       // start x
  y: number;       // start y
  length: number;
  orientation: 'horizontal' | 'vertical';
};

type FloorPlan = {
  totalWidth: number;  // m
  totalHeight: number; // m
  totalArea: number;   // m²
  rooms: Room[];
  doors: Door[];
  windows: Window[];
};

// Procedural plan generation based on room count + area
function generatePlan(rooms: number | null, area: number | null): FloorPlan {
  const totalArea = area || 50;
  const roomCount = Math.max(1, Math.min(5, rooms || 2));

  // Aspect ratio depending on area (real apartments ~1.4:1)
  const aspectRatio = 1.45;
  const totalWidth  = Math.sqrt(totalArea * aspectRatio);
  const totalHeight = totalArea / totalWidth;

  // ROOM SIZE PROPORTIONS — generate based on roomCount
  // (proportions are typical for Uzbek apartments)
  if (roomCount === 1) {
    // 1-xona / studio
    const W = totalWidth, H = totalHeight;
    const livingW = W * 0.65, livingH = H * 0.6;
    const kitchenW = W * 0.35, kitchenH = H * 0.6;
    const corrW = W, corrH = H * 0.18;
    const bathW = W * 0.35, bathH = H * 0.22;
    return {
      totalWidth: W, totalHeight: H, totalArea,
      rooms: [
        { kind: 'living',   label: 'Zal',     x: 0,        y: 0,                w: livingW,  h: livingH,  area: livingW * livingH },
        { kind: 'kitchen',  label: 'Oshxona', x: livingW,  y: 0,                w: kitchenW, h: kitchenH, area: kitchenW * kitchenH },
        { kind: 'corridor', label: 'Dahliz',  x: 0,        y: livingH,          w: corrW,    h: corrH,    area: corrW * corrH },
        { kind: 'bathroom', label: 'Vanna',   x: W - bathW, y: livingH + corrH, w: bathW,    h: bathH,    area: bathW * bathH },
      ],
      doors: [
        { x: W * 0.4,        y: H - 0.05,  width: 0.9, direction: 'S', swing: 'left' },  // entrance
        { x: livingW * 0.3,  y: livingH,   width: 0.8, direction: 'N', swing: 'right' }, // living from corridor
        { x: livingW + 0.4,  y: livingH,   width: 0.8, direction: 'N', swing: 'left' },  // kitchen from corridor
        { x: W - bathW + 0.3, y: livingH + corrH, width: 0.7, direction: 'N', swing: 'right' }, // bathroom
      ],
      windows: [
        { x: livingW * 0.15, y: 0, length: livingW * 0.7,  orientation: 'horizontal' },
        { x: livingW + kitchenW * 0.2, y: 0, length: kitchenW * 0.6, orientation: 'horizontal' },
      ],
    };
  }

  if (roomCount === 2) {
    // 2-xona
    const W = totalWidth, H = totalHeight;
    const livingW = W * 0.55, livingH = H * 0.55;
    const bedW = W * 0.45, bedH = H * 0.55;
    const kitchenW = W * 0.4, kitchenH = H * 0.25;
    const bathW = W * 0.25, bathH = H * 0.25;
    const corrW = W * 0.35, corrH = H * 0.25;
    const balconyW = livingW, balconyH = H * 0.2;
    return {
      totalWidth: W, totalHeight: H, totalArea,
      rooms: [
        { kind: 'living',   label: 'Zal',     x: 0,        y: 0,                  w: livingW,  h: livingH,  area: livingW * livingH },
        { kind: 'bedroom',  label: 'Yotoq',   x: livingW,  y: 0,                  w: bedW,     h: bedH,     area: bedW * bedH },
        { kind: 'corridor', label: 'Dahliz',  x: livingW - corrW, y: livingH,     w: corrW,    h: corrH,    area: corrW * corrH },
        { kind: 'kitchen',  label: 'Oshxona', x: 0,        y: livingH,            w: kitchenW, h: kitchenH, area: kitchenW * kitchenH },
        { kind: 'bathroom', label: 'Vanna',   x: livingW,  y: bedH,               w: bathW,    h: bathH,    area: bathW * bathH },
        { kind: 'balcony',  label: 'Balkon',  x: 0,        y: H - balconyH,       w: balconyW, h: balconyH, area: balconyW * balconyH },
      ],
      doors: [
        { x: livingW - corrW + 0.4, y: H - 0.05, width: 0.9, direction: 'S', swing: 'left' },
        { x: corrW * 0.3 + (livingW - corrW), y: livingH, width: 0.8, direction: 'N', swing: 'right' },
        { x: livingW + 0.3, y: livingH * 0.3, width: 0.8, direction: 'E', swing: 'left' },
        { x: 0.5, y: livingH, width: 0.8, direction: 'N', swing: 'left' },
        { x: livingW + 0.3, y: bedH, width: 0.7, direction: 'N', swing: 'right' },
        { x: 0.4, y: H - balconyH, width: 0.8, direction: 'N', swing: 'left' },
      ],
      windows: [
        { x: livingW * 0.2, y: 0, length: livingW * 0.6, orientation: 'horizontal' },
        { x: livingW + bedW * 0.2, y: 0, length: bedW * 0.6, orientation: 'horizontal' },
        { x: W - 0.05, y: bedH + bathH + 0.2, length: H - bedH - bathH - 0.4, orientation: 'vertical' },
      ],
    };
  }

  if (roomCount === 3) {
    // 3-xona (foydalanuvchining holati: 68.4m²)
    const W = totalWidth, H = totalHeight;
    const livingW = W * 0.48, livingH = H * 0.5;
    const bed1W = W * 0.52, bed1H = H * 0.42;
    const bed2W = W * 0.32, bed2H = H * 0.32;
    const kitchenW = W * 0.32, kitchenH = H * 0.3;
    const bathW = W * 0.2, bathH = H * 0.18;
    const wcW = W * 0.16, wcH = H * 0.18;
    const corrW = W * 0.36, corrH = H * 0.5;
    const balconyW = livingW * 0.7, balconyH = H * 0.18;
    return {
      totalWidth: W, totalHeight: H, totalArea,
      rooms: [
        // Top row
        { kind: 'living',   label: 'Zal',      x: 0,                  y: 0,                w: livingW,  h: livingH,  area: livingW * livingH },
        { kind: 'bedroom',  label: 'Yotoq 1',  x: livingW,            y: 0,                w: bed1W,    h: bed1H,    area: bed1W * bed1H },
        // Middle row
        { kind: 'kitchen',  label: 'Oshxona',  x: 0,                  y: livingH,          w: kitchenW, h: kitchenH, area: kitchenW * kitchenH },
        { kind: 'bathroom', label: 'Vanna',    x: kitchenW,           y: livingH,          w: bathW,    h: bathH,    area: bathW * bathH },
        { kind: 'wc',       label: 'WC',       x: kitchenW + bathW,   y: livingH,          w: wcW,      h: wcH,      area: wcW * wcH },
        { kind: 'bedroom',  label: 'Yotoq 2',  x: livingW + bed1W - bed2W, y: bed1H,       w: bed2W,    h: bed2H,    area: bed2W * bed2H },
        // Bottom row — corridor + balcony
        { kind: 'corridor', label: 'Dahliz',   x: kitchenW - 0.4,     y: livingH + bathH,  w: corrW,    h: H - livingH - bathH, area: corrW * (H - livingH - bathH) },
        { kind: 'balcony',  label: 'Balkon',   x: 0,                  y: H - balconyH,     w: balconyW, h: balconyH, area: balconyW * balconyH },
      ],
      doors: [
        { x: kitchenW + 0.4, y: H - 0.05,             width: 1.0, direction: 'S', swing: 'left' },  // entrance
        { x: corrW * 0.2 + kitchenW, y: livingH + 0.3, width: 0.85, direction: 'N', swing: 'right' }, // to living
        { x: livingW + 0.3,  y: livingH * 0.5,        width: 0.8, direction: 'E', swing: 'left' },   // to bedroom1
        { x: 0.5,            y: livingH,              width: 0.8, direction: 'N', swing: 'left' },   // to kitchen
        { x: kitchenW + 0.3, y: livingH,              width: 0.75, direction: 'N', swing: 'right' }, // to bathroom
        { x: kitchenW + bathW + 0.2, y: livingH,      width: 0.6, direction: 'N', swing: 'left' },   // to wc
        { x: livingW + bed1W - bed2W + 0.3, y: bed1H, width: 0.8, direction: 'N', swing: 'right' },  // to bedroom2
        { x: 0.4,            y: H - balconyH,         width: 0.8, direction: 'N', swing: 'left' },   // to balcony
      ],
      windows: [
        { x: livingW * 0.15, y: 0, length: livingW * 0.7,  orientation: 'horizontal' },
        { x: livingW + bed1W * 0.2, y: 0, length: bed1W * 0.6, orientation: 'horizontal' },
        { x: W - 0.05, y: bed1H * 0.3, length: bed1H * 0.4, orientation: 'vertical' },
        { x: W - 0.05, y: bed1H + bed2H * 0.3, length: bed2H * 0.4, orientation: 'vertical' },
      ],
    };
  }

  // 4+ xona
  const W = totalWidth, H = totalHeight;
  const livingW = W * 0.45, livingH = H * 0.45;
  const bed1W = W * 0.32, bed1H = H * 0.4;
  const bed2W = W * 0.23, bed2H = H * 0.4;
  const bed3W = W * 0.3, bed3H = H * 0.3;
  const kitchenW = W * 0.45, kitchenH = H * 0.3;
  const bathW = W * 0.22, bathH = H * 0.2;
  const corrW = W * 0.45, corrH = H * 0.25;
  return {
    totalWidth: W, totalHeight: H, totalArea,
    rooms: [
      { kind: 'living',   label: 'Zal',     x: 0,                  y: 0,                w: livingW,  h: livingH,  area: livingW * livingH },
      { kind: 'bedroom',  label: 'Yotoq 1', x: livingW,            y: 0,                w: bed1W,    h: bed1H,    area: bed1W * bed1H },
      { kind: 'bedroom',  label: 'Yotoq 2', x: livingW + bed1W,    y: 0,                w: bed2W,    h: bed2H,    area: bed2W * bed2H },
      { kind: 'kitchen',  label: 'Oshxona', x: 0,                  y: livingH,          w: kitchenW, h: kitchenH, area: kitchenW * kitchenH },
      { kind: 'bedroom',  label: 'Yotoq 3', x: livingW,            y: bed1H,            w: bed3W,    h: bed3H,    area: bed3W * bed3H },
      { kind: 'bathroom', label: 'Vanna',   x: 0,                  y: livingH + kitchenH, w: bathW,  h: bathH,    area: bathW * bathH },
      { kind: 'wc',       label: 'WC',      x: bathW,              y: livingH + kitchenH, w: bathW * 0.7, h: bathH, area: bathW * 0.7 * bathH },
      { kind: 'corridor', label: 'Dahliz',  x: kitchenW,           y: livingH + bed3H,  w: corrW,    h: corrH,    area: corrW * corrH },
    ],
    doors: [
      { x: kitchenW + 0.4, y: H - 0.05,   width: 1.0, direction: 'S', swing: 'left' },
      { x: 0.5,            y: livingH,    width: 0.85, direction: 'N', swing: 'left' },
      { x: livingW + 0.3,  y: livingH * 0.5, width: 0.8, direction: 'E', swing: 'left' },
      { x: livingW + bed1W + 0.2, y: bed2H, width: 0.7, direction: 'N', swing: 'right' },
      { x: livingW + 0.3,  y: bed1H,      width: 0.8, direction: 'N', swing: 'left' },
    ],
    windows: [
      { x: livingW * 0.2, y: 0, length: livingW * 0.6, orientation: 'horizontal' },
      { x: livingW + bed1W * 0.2, y: 0, length: bed1W * 0.6, orientation: 'horizontal' },
      { x: livingW + bed1W + bed2W * 0.2, y: 0, length: bed2W * 0.5, orientation: 'horizontal' },
      { x: W - 0.05, y: bed1H + bed3H * 0.3, length: bed3H * 0.4, orientation: 'vertical' },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════
//                    ROOM COLORS & ICONS
// ═══════════════════════════════════════════════════════════════

const ROOM_STYLE: Record<RoomKind, { fill: string; stroke: string; fillDark: string }> = {
  living:   { fill: '#fef3c7', stroke: '#f59e0b', fillDark: '#451a03' },
  bedroom:  { fill: '#dbeafe', stroke: '#3b82f6', fillDark: '#172554' },
  kitchen:  { fill: '#dcfce7', stroke: '#10b981', fillDark: '#052e16' },
  bathroom: { fill: '#cffafe', stroke: '#06b6d4', fillDark: '#083344' },
  wc:       { fill: '#e0f2fe', stroke: '#0ea5e9', fillDark: '#0c4a6e' },
  corridor: { fill: '#f3f4f6', stroke: '#9ca3af', fillDark: '#1f2937' },
  balcony:  { fill: '#fae8ff', stroke: '#a855f7', fillDark: '#3b0764' },
};

// ═══════════════════════════════════════════════════════════════
//                    SVG FLOOR PLAN COMPONENT
// ═══════════════════════════════════════════════════════════════

function FloorPlanSVG({
  plan, aptNumber, areaActual, accent,
}: {
  plan: FloorPlan;
  aptNumber: string | null;
  areaActual: number | null;
  accent: string;
}) {
  // SVG scale: 1m = SCALE pixels
  const SCALE = 50;
  const PADDING = 60;
  const svgW = plan.totalWidth * SCALE + PADDING * 2;
  const svgH = plan.totalHeight * SCALE + PADDING * 2;

  // Mapping helpers
  const mx = (x: number) => PADDING + x * SCALE;
  const my = (y: number) => PADDING + y * SCALE;
  const ms = (s: number) => s * SCALE;

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      className="w-full h-full max-h-[80vh]"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {/* Grid pattern (kichik kvadratlar fonda) */}
        <pattern id="floorGrid" x="0" y="0" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#1e293b" strokeWidth="0.5" opacity="0.4" />
        </pattern>
        {/* Wall hatching pattern */}
        <pattern id="wallHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#475569" strokeWidth="3" />
        </pattern>
        {/* Drop shadow for rooms */}
        <filter id="roomShadow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
          <feOffset dx="0" dy="2" result="offsetblur" />
          <feComponentTransfer><feFuncA type="linear" slope="0.25" /></feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Grid background */}
      <rect width={svgW} height={svgH} fill="url(#floorGrid)" />

      {/* ─── OUTER WALL (qora qalin chiziq) ─── */}
      <rect
        x={mx(0) - 4}
        y={my(0) - 4}
        width={ms(plan.totalWidth) + 8}
        height={ms(plan.totalHeight) + 8}
        fill="#0f172a"
        opacity="0.4"
      />

      {/* ─── ROOMS ─── */}
      {plan.rooms.map((room, i) => {
        const style = ROOM_STYLE[room.kind];
        return (
          <g key={i} filter="url(#roomShadow)">
            {/* Room fill */}
            <rect
              x={mx(room.x)}
              y={my(room.y)}
              width={ms(room.w)}
              height={ms(room.h)}
              fill={style.fillDark}
              stroke={style.stroke}
              strokeWidth={1.5}
              opacity={0.95}
            />
            {/* Top-left light */}
            <rect
              x={mx(room.x)}
              y={my(room.y)}
              width={ms(room.w)}
              height={ms(room.h)}
              fill="url(#floorGrid)"
              opacity={0.3}
            />
          </g>
        );
      })}

      {/* ─── INNER WALLS (xonalar orasidagi) ─── */}
      {/* Outer thick wall */}
      <rect
        x={mx(0)}
        y={my(0)}
        width={ms(plan.totalWidth)}
        height={ms(plan.totalHeight)}
        fill="none"
        stroke="#cbd5e1"
        strokeWidth={6}
      />

      {/* ─── WINDOWS (qo'sh chiziq) ─── */}
      {plan.windows.map((w, i) => {
        if (w.orientation === 'horizontal') {
          return (
            <g key={i}>
              <line x1={mx(w.x)} y1={my(w.y)} x2={mx(w.x + w.length)} y2={my(w.y)} stroke="#0f172a" strokeWidth={6} />
              <line x1={mx(w.x)} y1={my(w.y) - 2} x2={mx(w.x + w.length)} y2={my(w.y) - 2} stroke="#60a5fa" strokeWidth={1.5} />
              <line x1={mx(w.x)} y1={my(w.y) + 2} x2={mx(w.x + w.length)} y2={my(w.y) + 2} stroke="#60a5fa" strokeWidth={1.5} />
              {/* Cross pattern (oyna tartibi) */}
              <line x1={mx(w.x + w.length / 2)} y1={my(w.y) - 3} x2={mx(w.x + w.length / 2)} y2={my(w.y) + 3} stroke="#3b82f6" strokeWidth={1} />
            </g>
          );
        } else {
          return (
            <g key={i}>
              <line x1={mx(w.x)} y1={my(w.y)} x2={mx(w.x)} y2={my(w.y + w.length)} stroke="#0f172a" strokeWidth={6} />
              <line x1={mx(w.x) - 2} y1={my(w.y)} x2={mx(w.x) - 2} y2={my(w.y + w.length)} stroke="#60a5fa" strokeWidth={1.5} />
              <line x1={mx(w.x) + 2} y1={my(w.y)} x2={mx(w.x) + 2} y2={my(w.y + w.length)} stroke="#60a5fa" strokeWidth={1.5} />
              <line x1={mx(w.x) - 3} y1={my(w.y + w.length / 2)} x2={mx(w.x) + 3} y2={my(w.y + w.length / 2)} stroke="#3b82f6" strokeWidth={1} />
            </g>
          );
        }
      })}

      {/* ─── DOORS (eshik + arc) ─── */}
      {plan.doors.map((d, i) => {
        const cx = mx(d.x);
        const cy = my(d.y);
        const r = ms(d.width);
        // Arc start/end depending on direction + swing
        let path = '';
        if (d.direction === 'S') {
          path = `M ${cx} ${cy} L ${cx + r} ${cy} A ${r} ${r} 0 0 0 ${cx} ${cy - r}`;
        } else if (d.direction === 'N') {
          path = `M ${cx} ${cy} L ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy + r}`;
        } else if (d.direction === 'E') {
          path = `M ${cx} ${cy} L ${cx} ${cy + r} A ${r} ${r} 0 0 1 ${cx - r} ${cy}`;
        } else {
          path = `M ${cx} ${cy} L ${cx} ${cy + r} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`;
        }
        return (
          <g key={i}>
            {/* Gap in wall (white slot) */}
            <rect
              x={cx - 2}
              y={cy - 4}
              width={r}
              height={8}
              fill="#0f172a"
            />
            {/* Arc (door swing) */}
            <path d={path} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 2" />
            {/* Door line */}
            <line
              x1={cx}
              y1={cy}
              x2={cx + r}
              y2={cy}
              stroke="#cbd5e1"
              strokeWidth={2.5}
            />
          </g>
        );
      })}

      {/* ─── FURNITURE ICONS ─── */}
      {plan.rooms.map((room, i) => {
        const cx = mx(room.x + room.w / 2);
        const cy = my(room.y + room.h / 2);
        const sz = Math.min(ms(room.w), ms(room.h)) * 0.5;
        return (
          <g key={`f-${i}`}>
            {renderFurniture(room.kind, cx, cy, sz)}
          </g>
        );
      })}

      {/* ─── ROOM LABELS ─── */}
      {plan.rooms.map((room, i) => {
        const cx = mx(room.x + room.w / 2);
        const cy = my(room.y + room.h / 2);
        const style = ROOM_STYLE[room.kind];
        return (
          <g key={`l-${i}`}>
            {/* Label background */}
            <rect
              x={cx - 38}
              y={cy + ms(room.h) * 0.18}
              width={76}
              height={28}
              rx={6}
              fill="#020617"
              fillOpacity={0.85}
              stroke={style.stroke}
              strokeWidth={1}
            />
            <text x={cx} y={cy + ms(room.h) * 0.18 + 12} textAnchor="middle" fontSize={11} fontWeight={700} fill={style.fill}>
              {room.label}
            </text>
            <text x={cx} y={cy + ms(room.h) * 0.18 + 23} textAnchor="middle" fontSize={9} fill="#cbd5e1" fontFamily="monospace">
              {room.area.toFixed(1)} m²
            </text>
          </g>
        );
      })}

      {/* ─── DIMENSIONS (tashqi o'lchamlar) ─── */}
      {/* Top width */}
      <g>
        <line x1={mx(0)} y1={my(0) - 30} x2={mx(plan.totalWidth)} y2={my(0) - 30} stroke="#64748b" strokeWidth={1} />
        <line x1={mx(0)} y1={my(0) - 35} x2={mx(0)} y2={my(0) - 25} stroke="#64748b" strokeWidth={1} />
        <line x1={mx(plan.totalWidth)} y1={my(0) - 35} x2={mx(plan.totalWidth)} y2={my(0) - 25} stroke="#64748b" strokeWidth={1} />
        <text x={mx(plan.totalWidth / 2)} y={my(0) - 36} textAnchor="middle" fontSize={11} fill="#94a3b8" fontFamily="monospace">
          {plan.totalWidth.toFixed(2)} m
        </text>
      </g>
      {/* Left height */}
      <g>
        <line x1={mx(0) - 30} y1={my(0)} x2={mx(0) - 30} y2={my(plan.totalHeight)} stroke="#64748b" strokeWidth={1} />
        <line x1={mx(0) - 35} y1={my(0)} x2={mx(0) - 25} y2={my(0)} stroke="#64748b" strokeWidth={1} />
        <line x1={mx(0) - 35} y1={my(plan.totalHeight)} x2={mx(0) - 25} y2={my(plan.totalHeight)} stroke="#64748b" strokeWidth={1} />
        <text
          x={mx(0) - 40}
          y={my(plan.totalHeight / 2)}
          textAnchor="middle"
          fontSize={11}
          fill="#94a3b8"
          fontFamily="monospace"
          transform={`rotate(-90, ${mx(0) - 40}, ${my(plan.totalHeight / 2)})`}
        >
          {plan.totalHeight.toFixed(2)} m
        </text>
      </g>

      {/* ─── NORTH ARROW (compass) ─── */}
      <g transform={`translate(${svgW - 50}, 50)`}>
        <circle r={22} fill="#020617" fillOpacity={0.8} stroke={accent} strokeWidth={1.5} />
        <path d="M 0 -14 L 5 6 L 0 2 L -5 6 Z" fill={accent} />
        <text x={0} y={-18} textAnchor="middle" fontSize={10} fontWeight={700} fill={accent}>N</text>
      </g>

      {/* ─── TITLE BLOCK ─── */}
      <g transform={`translate(${PADDING - 10}, ${svgH - 50})`}>
        <rect width={200} height={36} rx={6} fill="#020617" fillOpacity={0.85} stroke="#334155" strokeWidth={1} />
        <text x={10} y={15} fontSize={9} fontWeight={700} fill="#64748b" fontFamily="monospace" letterSpacing={1.5}>PLANIROVKA</text>
        <text x={10} y={29} fontSize={12} fontWeight={700} fill="#f1f5f9">
          {aptNumber ? `№ ${aptNumber}` : 'Xonadon'} · {areaActual ? `${areaActual} m²` : `${plan.totalArea.toFixed(1)} m²`}
        </text>
      </g>
    </svg>
  );
}

// ─── FURNITURE RENDERER ──────────────────────────────────────
function renderFurniture(kind: RoomKind, cx: number, cy: number, sz: number): React.ReactNode {
  const size = Math.min(sz, 60);
  switch (kind) {
    case 'living':
      // Divan (sofa)
      return (
        <g opacity={0.55}>
          <rect x={cx - size * 0.6} y={cy - size * 0.3} width={size * 1.2} height={size * 0.5} rx={4} fill="#f59e0b" />
          <rect x={cx - size * 0.6} y={cy - size * 0.45} width={size * 1.2} height={size * 0.2} rx={3} fill="#fbbf24" />
          {/* TV stand */}
          <rect x={cx - size * 0.4} y={cy + size * 0.35} width={size * 0.8} height={size * 0.12} fill="#92400e" />
        </g>
      );
    case 'bedroom':
      // Krovat (bed)
      return (
        <g opacity={0.55}>
          <rect x={cx - size * 0.45} y={cy - size * 0.6} width={size * 0.9} height={size * 1.0} rx={4} fill="#3b82f6" />
          <rect x={cx - size * 0.4} y={cy - size * 0.55} width={size * 0.8} height={size * 0.25} rx={3} fill="#60a5fa" />
          {/* Side table */}
          <rect x={cx + size * 0.45} y={cy - size * 0.5} width={size * 0.18} height={size * 0.18} fill="#1d4ed8" />
        </g>
      );
    case 'kitchen':
      // L-shaped kitchen counter
      return (
        <g opacity={0.55}>
          <rect x={cx - size * 0.55} y={cy - size * 0.55} width={size * 1.1} height={size * 0.25} fill="#10b981" />
          <rect x={cx - size * 0.55} y={cy - size * 0.55} width={size * 0.25} height={size * 1.0} fill="#10b981" />
          {/* Hob (gas stove) — 4 circles */}
          <circle cx={cx + size * 0.1} cy={cy - size * 0.42} r={size * 0.05} fill="#064e3b" />
          <circle cx={cx + size * 0.3} cy={cy - size * 0.42} r={size * 0.05} fill="#064e3b" />
          {/* Sink */}
          <rect x={cx - size * 0.5} y={cy - size * 0.15} width={size * 0.18} height={size * 0.18} fill="#064e3b" rx={2} />
        </g>
      );
    case 'bathroom':
      // Bath + sink
      return (
        <g opacity={0.55}>
          <rect x={cx - size * 0.45} y={cy - size * 0.4} width={size * 0.9} height={size * 0.45} rx={6} fill="#06b6d4" />
          <ellipse cx={cx} cy={cy - size * 0.18} rx={size * 0.35} ry={size * 0.15} fill="#155e75" />
          {/* Sink */}
          <ellipse cx={cx} cy={cy + size * 0.3} rx={size * 0.2} ry={size * 0.1} fill="#06b6d4" />
        </g>
      );
    case 'wc':
      // Toilet
      return (
        <g opacity={0.55}>
          <ellipse cx={cx} cy={cy} rx={size * 0.25} ry={size * 0.35} fill="#0ea5e9" />
          <rect x={cx - size * 0.18} y={cy - size * 0.5} width={size * 0.36} height={size * 0.2} rx={2} fill="#075985" />
        </g>
      );
    case 'corridor':
      // No furniture
      return null;
    case 'balcony':
      // Stool + plant
      return (
        <g opacity={0.55}>
          <circle cx={cx - size * 0.3} cy={cy} r={size * 0.15} fill="#a855f7" />
          {/* Plant */}
          <circle cx={cx + size * 0.3} cy={cy} r={size * 0.18} fill="#22c55e" />
          <rect x={cx + size * 0.25} y={cy + size * 0.1} width={size * 0.1} height={size * 0.15} fill="#854d0e" />
        </g>
      );
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//                    MAIN DIALOG COMPONENT
// ═══════════════════════════════════════════════════════════════

export function Apartment3DDialog({
  open, onClose, contractNo,
}: {
  open: boolean;
  onClose: () => void;
  contractNo: string | null;
}) {
  const [animatedProgress, setAnimatedProgress] = useState(0);

  // CRM'dan ma'lumot
  const dataQuery = useQuery({
    queryKey: ['oplata-kv-3d-view', contractNo],
    queryFn: () => api.get<{
      ok: boolean;
      contractNo: string;
      crmConnected: boolean;
      oplata: { items: any[]; count: number; totalPayment: number; initial: number; monthly: number };
      crm: {
        connected: boolean;
        error: string | null;
        contractInfo: { price: number; contractDate: string | null; status: string | null; initialPlan: number; initialPaid: number; monthlyPlan: number; monthlyPaid: number } | null;
        apartmentInfo: { number: string | null; rooms: number | null; area: number | null; building: string | null; block: string | null; floor: number | null; object: string | null } | null;
        clientInfo: { fullName: string | null; phone: string | null } | null;
        totalPaid: number;
      };
    }>(`/oplata-kv/crm-sverka?contractNo=${encodeURIComponent(contractNo || '')}`),
    enabled: open && !!contractNo,
  });

  const metaQuery = useQuery({
    queryKey: ['oplata-kv-by-contract', contractNo],
    queryFn: () => api.get<{
      ok: boolean;
      meta: { client: string | null; object: string | null; paymentMethod: string | null } | null;
    }>(`/oplata-kv/by-contract?contractNo=${encodeURIComponent(contractNo || '')}`),
    enabled: open && !!contractNo,
  });

  const apt: ApartmentData | null = useMemo(() => {
    if (!dataQuery.data?.ok || !contractNo) return null;
    const ci = dataQuery.data.crm.contractInfo;
    const ai = dataQuery.data.crm.apartmentInfo;
    const cli = dataQuery.data.crm.clientInfo;
    const meta = metaQuery.data?.meta || null;
    if (!ci) return null;
    return {
      contractNo,
      object: ai?.object || meta?.object || null,
      client: cli?.fullName || meta?.client || null,
      totalPrice: ci.price || 0,
      totalPaid: (ci.initialPaid || 0) + (ci.monthlyPaid || 0),
      initialPlan: ci.initialPlan || 0,
      initialPaid: ci.initialPaid || 0,
      monthlyPlan: ci.monthlyPlan || 0,
      monthlyPaid: ci.monthlyPaid || 0,
      contractDate: ci.contractDate,
      status: ci.status,
      aptNumber: ai?.number || null,
      rooms: ai?.rooms != null ? Number(ai.rooms) : null,
      area: ai?.area != null ? Number(ai.area) : null,
      building: ai?.building || null,
      block: ai?.block || null,
      floor: ai?.floor != null ? Number(ai.floor) : null,
    };
  }, [dataQuery.data, metaQuery.data, contractNo]);

  const targetProgress = useMemo(() => {
    if (!apt || apt.totalPrice <= 0) return 0;
    return Math.min(100, (apt.totalPaid / apt.totalPrice) * 100);
  }, [apt]);

  useEffect(() => {
    if (!open) {
      setAnimatedProgress(0);
      return;
    }
    setAnimatedProgress(0);
    const startTime = performance.now();
    const duration = 1800;
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedProgress(targetProgress * eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [open, targetProgress]);

  const accent = useMemo(() => {
    if (targetProgress >= 100) return '#10b981';
    if (targetProgress >= 70) return '#f59e0b';
    if (targetProgress >= 40) return '#eab308';
    if (targetProgress > 0) return '#f97316';
    return '#ef4444';
  }, [targetProgress]);

  const remaining = (apt?.totalPrice || 0) - (apt?.totalPaid || 0);
  const crmNotConnected = dataQuery.data && !dataQuery.data.crmConnected;
  const noContractInfo = dataQuery.data?.ok && dataQuery.data.crmConnected && !dataQuery.data.crm.contractInfo;

  // Generate floor plan
  const plan = useMemo(() => {
    if (!apt) return null;
    return generatePlan(apt.rooms, apt.area);
  }, [apt]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[1200px] h-[90vh] rounded-2xl overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 ring-1 ring-slate-800 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-slate-900 to-slate-950 flex items-center gap-3 shrink-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center shadow-lg">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Planirovka</div>
                <div className="text-base font-bold text-white truncate">
                  {apt?.object || 'Xonadon plani'}
                  {contractNo && (
                    <span className="ml-2 text-[12px] font-mono font-normal text-slate-400">#{contractNo}</span>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 grid place-items-center text-slate-300 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body: SVG plan + info panel */}
            <div className="flex-1 grid lg:grid-cols-[1fr_360px] min-h-0">
              {/* SVG floor plan */}
              <div className="relative bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-auto">
                {dataQuery.isLoading || metaQuery.isLoading ? (
                  <div className="absolute inset-0 grid place-items-center text-slate-400">
                    <div className="text-center">
                      <div className="w-10 h-10 mx-auto mb-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <div className="text-[13px]">CRM dan ma'lumot olinmoqda...</div>
                    </div>
                  </div>
                ) : crmNotConnected ? (
                  <div className="absolute inset-0 grid place-items-center text-center px-8">
                    <div>
                      <AlertCircle className="h-12 w-12 text-amber-400 mx-auto mb-3" />
                      <div className="text-amber-200 font-semibold mb-1">CRM bog'lanmagan</div>
                      <div className="text-[13px] text-slate-400">
                        Planirovka uchun CRM'da xonalar soni va m² kerak.
                      </div>
                    </div>
                  </div>
                ) : noContractInfo ? (
                  <div className="absolute inset-0 grid place-items-center text-center px-8">
                    <div>
                      <AlertCircle className="h-12 w-12 text-rose-400 mx-auto mb-3" />
                      <div className="text-rose-200 font-semibold mb-1">CRM da topilmadi</div>
                      <div className="text-[13px] text-slate-400">
                        Bu shartnoma raqami XonSaroy CRM bazasida yo'q yoki noto'g'ri.
                      </div>
                    </div>
                  </div>
                ) : plan && apt ? (
                  <div className="w-full h-full p-6 flex items-center justify-center">
                    <FloorPlanSVG plan={plan} aptNumber={apt.aptNumber} areaActual={apt.area} accent={accent} />
                  </div>
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-slate-500 text-[13px]">
                    Planirovka uchun ma'lumot yetarli emas
                  </div>
                )}
              </div>

              {/* Right info panel */}
              <div className="bg-slate-900 border-l border-slate-800 overflow-y-auto p-5 space-y-4">
                {apt ? (
                  <>
                    {/* Progress card */}
                    <div className="rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 ring-1 ring-slate-700/60 p-4">
                      <div className="text-[9.5px] uppercase tracking-widest text-slate-400 font-bold mb-2">To'lov darajasi</div>
                      <div className="flex items-baseline gap-2 mb-3">
                        <div
                          className="text-3xl font-black tabular-nums"
                          style={{ color: accent }}
                        >
                          {targetProgress.toFixed(1)}%
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {targetProgress >= 100 ? "to'la to'langan" : targetProgress >= 50 ? 'yarmidan oshgan' : 'jarayonda'}
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${targetProgress}%` }}
                          transition={{ duration: 1.5, ease: 'easeOut' }}
                          className="h-full rounded-full"
                          style={{
                            background: `linear-gradient(90deg, ${accent}, ${accent}cc)`,
                            boxShadow: `0 0 12px ${accent}80`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Apartment specs */}
                    {(apt.aptNumber || apt.rooms != null || apt.area != null || apt.floor != null || apt.block || apt.building) && (
                      <div className="rounded-xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 ring-1 ring-indigo-500/20 p-3.5">
                        <div className="text-[9.5px] uppercase tracking-widest text-indigo-300 font-bold mb-2.5 flex items-center gap-1.5">
                          <Home className="h-3 w-3" />
                          Xonadon ma'lumotlari
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {apt.aptNumber && <Chip color="violet">№ {apt.aptNumber}</Chip>}
                          {apt.rooms != null && <Chip color="indigo">{apt.rooms} xonalar</Chip>}
                          {apt.area != null && <Chip color="cyan">{apt.area} m²</Chip>}
                          {apt.building && <Chip color="emerald">{apt.building}</Chip>}
                          {apt.block && <Chip color="amber">{apt.block}-blok</Chip>}
                          {apt.floor != null && <Chip color="rose">⬆ {apt.floor}-qavat</Chip>}
                        </div>
                      </div>
                    )}

                    {/* Room legend */}
                    {plan && (
                      <div>
                        <div className="text-[9.5px] uppercase tracking-widest text-slate-400 font-bold mb-2">Xonalar</div>
                        <div className="space-y-1.5">
                          {plan.rooms.map((r, i) => {
                            const style = ROOM_STYLE[r.kind];
                            return (
                              <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: style.stroke }} />
                                  <span className="text-slate-200 truncate">{r.label}</span>
                                </div>
                                <span className="text-slate-400 tabular-nums shrink-0">{r.area.toFixed(1)} m²</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Meta */}
                    {apt.client && <InfoRow icon={<User2 className="h-3.5 w-3.5" />} label="Mijoz" value={apt.client} />}
                    {apt.contractDate && (
                      <InfoRow icon={<Calendar className="h-3.5 w-3.5" />} label="Shartnoma sanasi" value={new Date(apt.contractDate).toLocaleDateString('ru-RU')} />
                    )}

                    {/* Sums */}
                    <div className="pt-3 border-t border-slate-800 space-y-2.5">
                      <SumRow label="Jami narx" value={apt.totalPrice} color="text-slate-200" />
                      <SumRow label="To'langan" value={apt.totalPaid} color="text-emerald-400" prefix="+" />
                      <SumRow label="Qoldiq" value={remaining} color={remaining > 0 ? 'text-rose-400' : 'text-emerald-400'} prefix={remaining > 0 ? '−' : ''} />
                    </div>

                    {/* Status badge */}
                    {apt.status && (
                      <div className="pt-3 border-t border-slate-800">
                        <div className="text-[9.5px] uppercase tracking-widest text-slate-400 font-bold mb-1.5">Status</div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-500/15 ring-1 ring-indigo-500/30 text-[11px] font-semibold text-indigo-300">
                          <TrendingUp className="h-3 w-3" />
                          {apt.status}
                        </span>
                      </div>
                    )}
                  </>
                ) : !dataQuery.isLoading && (
                  <div className="text-center py-12 text-slate-500 text-[13px]">
                    Ma'lumot mavjud emas
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-slate-800 grid place-items-center text-slate-400 shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-0.5">{label}</div>
        <div className="text-[12.5px] font-semibold text-slate-200 break-words">{value}</div>
      </div>
    </div>
  );
}

function SumRow({ label, value, color, prefix = '' }: { label: string; value: number; color: string; prefix?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={cn('text-[13.5px] font-bold tabular-nums', color)}>
        {prefix}{formatMoney(value)}
      </div>
    </div>
  );
}

const CHIP_COLORS: Record<string, string> = {
  violet:  'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  indigo:  'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30',
  cyan:    'bg-cyan-500/15 text-cyan-300 ring-cyan-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  amber:   'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  rose:    'bg-rose-500/15 text-rose-300 ring-rose-500/30',
};

function Chip({ children, color = 'indigo' }: { children: React.ReactNode; color?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-md ring-1 text-[11px] font-semibold whitespace-nowrap',
      CHIP_COLORS[color] || CHIP_COLORS.indigo,
    )}>
      {children}
    </span>
  );
}
