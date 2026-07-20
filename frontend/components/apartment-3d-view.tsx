'use client';

import { useMemo, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Html } from '@react-three/drei';
import * as THREE from 'three';
import { X, Building2, AlertCircle, RotateCcw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

/**
 * Xonadon 3D ko'rinishi — CRM'dagi xona soni + m² dan protsedural 3D
 * "dollhouse" model quradi: devorlar tik turadi (yarim balandlik), pol,
 * mebel bloklari, xona yorliqlari; orbit bilan aylantiriladi.
 *
 * Bu TAXMINIY model (rejani aynan takrorlamaydi) — real planirovka rasmi
 * "Planirovka" tugmasida alohida ko'rsatiladi.
 */

// ═══════════════════ PROTSEDURAL LAYOUT (2D → 3D) ═══════════════════
type RoomKind = 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'wc' | 'corridor' | 'balcony';
type Room = { kind: RoomKind; label: string; x: number; y: number; w: number; h: number; area: number };
type FloorPlan = { totalWidth: number; totalHeight: number; totalArea: number; rooms: Room[] };

function generatePlan(rooms: number | null, area: number | null): FloorPlan {
  const totalArea = area || 50;
  const roomCount = Math.max(1, Math.min(5, rooms || 2));
  const aspectRatio = 1.45;
  const W = Math.sqrt(totalArea * aspectRatio);
  const H = totalArea / W;

  if (roomCount === 1) {
    const livingW = W * 0.65, livingH = H * 0.6, kitchenW = W * 0.35, kitchenH = H * 0.6;
    const corrH = H * 0.18, bathW = W * 0.35, bathH = H * 0.22;
    return { totalWidth: W, totalHeight: H, totalArea, rooms: [
      { kind: 'living', label: 'Zal', x: 0, y: 0, w: livingW, h: livingH, area: livingW * livingH },
      { kind: 'kitchen', label: 'Oshxona', x: livingW, y: 0, w: kitchenW, h: kitchenH, area: kitchenW * kitchenH },
      { kind: 'corridor', label: 'Dahliz', x: 0, y: livingH, w: W, h: corrH, area: W * corrH },
      { kind: 'bathroom', label: 'Vanna', x: W - bathW, y: livingH + corrH, w: bathW, h: bathH, area: bathW * bathH },
    ] };
  }
  if (roomCount === 2) {
    const livingW = W * 0.55, livingH = H * 0.55, bedW = W * 0.45, bedH = H * 0.55;
    const kitchenW = W * 0.4, kitchenH = H * 0.25, bathW = W * 0.25, bathH = H * 0.25;
    const corrW = W * 0.35, balconyH = H * 0.2;
    return { totalWidth: W, totalHeight: H, totalArea, rooms: [
      { kind: 'living', label: 'Zal', x: 0, y: 0, w: livingW, h: livingH, area: livingW * livingH },
      { kind: 'bedroom', label: 'Yotoq', x: livingW, y: 0, w: bedW, h: bedH, area: bedW * bedH },
      { kind: 'corridor', label: 'Dahliz', x: livingW - corrW, y: livingH, w: corrW, h: H * 0.25, area: corrW * H * 0.25 },
      { kind: 'kitchen', label: 'Oshxona', x: 0, y: livingH, w: kitchenW, h: kitchenH, area: kitchenW * kitchenH },
      { kind: 'bathroom', label: 'Vanna', x: livingW, y: bedH, w: bathW, h: bathH, area: bathW * bathH },
      { kind: 'balcony', label: 'Balkon', x: 0, y: H - balconyH, w: livingW, h: balconyH, area: livingW * balconyH },
    ] };
  }
  if (roomCount === 3) {
    const livingW = W * 0.48, livingH = H * 0.5, bed1W = W * 0.52, bed1H = H * 0.42;
    const bed2W = W * 0.32, bed2H = H * 0.32, kitchenW = W * 0.32, kitchenH = H * 0.3;
    const bathW = W * 0.2, bathH = H * 0.18, wcW = W * 0.16, corrW = W * 0.36, balconyH = H * 0.18;
    return { totalWidth: W, totalHeight: H, totalArea, rooms: [
      { kind: 'living', label: 'Zal', x: 0, y: 0, w: livingW, h: livingH, area: livingW * livingH },
      { kind: 'bedroom', label: 'Yotoq 1', x: livingW, y: 0, w: bed1W, h: bed1H, area: bed1W * bed1H },
      { kind: 'kitchen', label: 'Oshxona', x: 0, y: livingH, w: kitchenW, h: kitchenH, area: kitchenW * kitchenH },
      { kind: 'bathroom', label: 'Vanna', x: kitchenW, y: livingH, w: bathW, h: bathH, area: bathW * bathH },
      { kind: 'wc', label: 'WC', x: kitchenW + bathW, y: livingH, w: wcW, h: bathH, area: wcW * bathH },
      { kind: 'bedroom', label: 'Yotoq 2', x: livingW + bed1W - bed2W, y: bed1H, w: bed2W, h: bed2H, area: bed2W * bed2H },
      { kind: 'corridor', label: 'Dahliz', x: kitchenW, y: livingH + bathH, w: corrW, h: H - livingH - bathH, area: corrW * (H - livingH - bathH) },
      { kind: 'balcony', label: 'Balkon', x: 0, y: H - balconyH, w: livingW * 0.7, h: balconyH, area: livingW * 0.7 * balconyH },
    ] };
  }
  // 4+ xona
  const livingW = W * 0.45, livingH = H * 0.45, bed1W = W * 0.32, bed1H = H * 0.4;
  const bed2W = W * 0.23, bed2H = H * 0.4, bed3W = W * 0.3, bed3H = H * 0.3;
  const kitchenW = W * 0.45, kitchenH = H * 0.3, bathW = W * 0.22, bathH = H * 0.2, corrW = W * 0.45, corrH = H * 0.25;
  return { totalWidth: W, totalHeight: H, totalArea, rooms: [
    { kind: 'living', label: 'Zal', x: 0, y: 0, w: livingW, h: livingH, area: livingW * livingH },
    { kind: 'bedroom', label: 'Yotoq 1', x: livingW, y: 0, w: bed1W, h: bed1H, area: bed1W * bed1H },
    { kind: 'bedroom', label: 'Yotoq 2', x: livingW + bed1W, y: 0, w: bed2W, h: bed2H, area: bed2W * bed2H },
    { kind: 'kitchen', label: 'Oshxona', x: 0, y: livingH, w: kitchenW, h: kitchenH, area: kitchenW * kitchenH },
    { kind: 'bedroom', label: 'Yotoq 3', x: livingW, y: bed1H, w: bed3W, h: bed3H, area: bed3W * bed3H },
    { kind: 'bathroom', label: 'Vanna', x: 0, y: livingH + kitchenH, w: bathW, h: bathH, area: bathW * bathH },
    { kind: 'wc', label: 'WC', x: bathW, y: livingH + kitchenH, w: bathW * 0.7, h: bathH, area: bathW * 0.7 * bathH },
    { kind: 'corridor', label: 'Dahliz', x: kitchenW, y: livingH + bed3H, w: corrW, h: corrH, area: corrW * corrH },
  ] };
}

// Rang: pol (light) + aksent (accent) + yorliq
const ROOM_COLOR: Record<RoomKind, { floor: string; accent: string }> = {
  living:   { floor: '#fde68a', accent: '#f59e0b' },
  bedroom:  { floor: '#bfdbfe', accent: '#3b82f6' },
  kitchen:  { floor: '#bbf7d0', accent: '#10b981' },
  bathroom: { floor: '#a5f3fc', accent: '#06b6d4' },
  wc:       { floor: '#bae6fd', accent: '#0ea5e9' },
  corridor: { floor: '#e5e7eb', accent: '#9ca3af' },
  balcony:  { floor: '#f5d0fe', accent: '#a855f7' },
};

const WALL_H = 1.6;      // yarim devor (dollhouse) — tepadan xonalar ko'rinadi
const WALL_T = 0.1;      // devor qalinligi

// ─── Mebel (oddiy 3D bloklar) ───
function Furniture({ kind, w, h }: { kind: RoomKind; w: number; h: number }) {
  const c = ROOM_COLOR[kind].accent;
  const mat = <meshStandardMaterial color={c} roughness={0.7} metalness={0.1} />;
  switch (kind) {
    case 'living':
      return (
        <group>
          <mesh castShadow position={[-w * 0.15, 0.22, h * 0.28]}><boxGeometry args={[w * 0.5, 0.44, h * 0.22]} />{mat}</mesh>
          <mesh castShadow position={[-w * 0.15, 0.12, -h * 0.05]}><boxGeometry args={[w * 0.35, 0.12, h * 0.18]} /><meshStandardMaterial color="#7c5a2e" roughness={0.8} /></mesh>
        </group>
      );
    case 'bedroom':
      return (
        <group>
          <mesh castShadow position={[0, 0.2, 0]}><boxGeometry args={[w * 0.55, 0.4, h * 0.65]} />{mat}</mesh>
          <mesh castShadow position={[0, 0.34, -h * 0.24]}><boxGeometry args={[w * 0.5, 0.14, h * 0.14]} /><meshStandardMaterial color="#e2e8f0" roughness={0.9} /></mesh>
        </group>
      );
    case 'kitchen':
      return (
        <group>
          <mesh castShadow position={[0, 0.3, -h * 0.32]}><boxGeometry args={[w * 0.72, 0.6, h * 0.16]} />{mat}</mesh>
          <mesh castShadow position={[-w * 0.28, 0.3, 0]}><boxGeometry args={[w * 0.16, 0.6, h * 0.5]} />{mat}</mesh>
        </group>
      );
    case 'bathroom':
      return <mesh castShadow position={[0, 0.2, 0]}><boxGeometry args={[w * 0.62, 0.4, h * 0.4]} />{mat}</mesh>;
    case 'wc':
      return <mesh castShadow position={[0, 0.25, 0]}><cylinderGeometry args={[Math.min(w, h) * 0.22, Math.min(w, h) * 0.26, 0.5, 20]} />{mat}</mesh>;
    case 'balcony':
      return (
        <group>
          <mesh castShadow position={[w * 0.28, 0.25, 0]}><cylinderGeometry args={[0.14, 0.18, 0.5, 12]} /><meshStandardMaterial color="#16a34a" roughness={0.8} /></mesh>
        </group>
      );
    default:
      return null;
  }
}

// ─── Butun xonadon (pol + devor + mebel + yorliq) ───
function Apartment({ plan }: { plan: FloorPlan }) {
  const { totalWidth: W, totalHeight: H, rooms } = plan;
  const s = 8 / Math.max(W, H);       // ~8 birlik o'lchamga miqyoslaymiz
  const offX = -W / 2, offZ = -H / 2;

  // Devor segmentlarini yig'ib, takrorlanadiganlarni chiqaramiz (z-fighting oldini olish)
  const walls = useMemo(() => {
    type Seg = { o: 'h' | 'v'; fixed: number; a: number; b: number };
    const raw: Seg[] = [];
    for (const r of rooms) {
      raw.push({ o: 'h', fixed: r.y, a: r.x, b: r.x + r.w });
      raw.push({ o: 'h', fixed: r.y + r.h, a: r.x, b: r.x + r.w });
      raw.push({ o: 'v', fixed: r.x, a: r.y, b: r.y + r.h });
      raw.push({ o: 'v', fixed: r.x + r.w, a: r.y, b: r.y + r.h });
    }
    const seen = new Set<string>();
    return raw.filter((sg) => {
      const k = `${sg.o}:${sg.fixed.toFixed(2)}:${sg.a.toFixed(2)}:${sg.b.toFixed(2)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [rooms]);

  return (
    <group scale={[s, s, s]}>
      {/* Pol plitalari (xona rangi) */}
      {rooms.map((r, i) => (
        <mesh key={`f${i}`} receiveShadow position={[r.x + r.w / 2 + offX, -0.05, r.y + r.h / 2 + offZ]}>
          <boxGeometry args={[r.w, 0.1, r.h]} />
          <meshStandardMaterial color={ROOM_COLOR[r.kind].floor} roughness={0.9} metalness={0} />
        </mesh>
      ))}

      {/* Devorlar (yarim balandlik) */}
      {walls.map((sg, i) => {
        const len = sg.b - sg.a;
        const mid = (sg.a + sg.b) / 2;
        const pos: [number, number, number] = sg.o === 'h'
          ? [mid + offX, WALL_H / 2, sg.fixed + offZ]
          : [sg.fixed + offX, WALL_H / 2, mid + offZ];
        const args: [number, number, number] = sg.o === 'h' ? [len + WALL_T, WALL_H, WALL_T] : [WALL_T, WALL_H, len + WALL_T];
        return (
          <mesh key={`w${i}`} castShadow receiveShadow position={pos}>
            <boxGeometry args={args} />
            <meshStandardMaterial color="#f8fafc" roughness={0.85} metalness={0} />
          </mesh>
        );
      })}

      {/* Mebel + yorliq */}
      {rooms.map((r, i) => {
        const cx = r.x + r.w / 2 + offX, cz = r.y + r.h / 2 + offZ;
        return (
          <group key={`r${i}`}>
            <group position={[cx, 0, cz]}>
              <Furniture kind={r.kind} w={r.w} h={r.h} />
            </group>
            <Html position={[cx, WALL_H + 0.35, cz]} center distanceFactor={12} zIndexRange={[10, 0]}>
              <div style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
                className="px-2 py-0.5 rounded-md bg-slate-950/85 ring-1 text-center"
              >
                <div style={{ color: ROOM_COLOR[r.kind].floor, fontSize: 12, fontWeight: 700, lineHeight: 1.1 }}>{r.label}</div>
                <div style={{ color: '#94a3b8', fontSize: 10, fontFamily: 'monospace' }}>{r.area.toFixed(1)} m²</div>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function Scene({ plan }: { plan: FloorPlan }) {
  return (
    <>
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#dbe4ff', '#0b1020', 0.5]} />
      <directionalLight
        position={[7, 12, 7]} intensity={1.35} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-far={40}
        shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12}
      />
      <directionalLight position={[-6, 6, -5]} intensity={0.35} />
      <Apartment plan={plan} />
      <ContactShadows position={[0, -0.02, 0]} opacity={0.5} scale={20} blur={2.5} far={6} resolution={1024} />
      <OrbitControls
        makeDefault enablePan={false}
        minDistance={5} maxDistance={22}
        minPolarAngle={0.1} maxPolarAngle={Math.PI / 2.15}
        autoRotate autoRotateSpeed={0.65}
      />
    </>
  );
}

type SverkaResp = {
  ok: boolean;
  crmConnected: boolean;
  crm: {
    apartmentInfo: { number: string | null; rooms: number | null; area: number | null; object: string | null } | null;
  };
};

export function Apartment3DDialog({
  open, onClose, contractNo,
}: {
  open: boolean;
  onClose: () => void;
  contractNo: string | null;
}) {
  const t = useTranslations('oplatykv');

  const query = useQuery({
    queryKey: ['oplata-kv-crm-sverka', contractNo],
    queryFn: () => api.get<SverkaResp>(`/oplata-kv/crm-sverka?contractNo=${encodeURIComponent(contractNo || '')}`, { timeout: 40000 }),
    enabled: open && !!contractNo,
    staleTime: 5 * 60_000,
  });

  const ai = query.data?.crm?.apartmentInfo || null;
  const rooms = ai?.rooms != null ? Number(ai.rooms) : null;
  const area = ai?.area != null ? Number(ai.area) : null;
  const plan = useMemo(() => (rooms != null || area != null ? generatePlan(rooms, area) : null), [rooms, area]);

  const isLoading = query.isLoading;
  const noData = !isLoading && !plan;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-3 sm:p-4 pointer-events-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[1200px] h-[92vh] rounded-2xl overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 ring-1 ring-slate-800 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative px-5 py-3.5 border-b border-slate-800 bg-gradient-to-r from-slate-900 to-slate-950 flex items-center gap-3 shrink-0 z-10">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 grid place-items-center shadow-lg shrink-0">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">3D · {t('plan3dSubtitle')}</div>
                <div className="text-[15px] font-bold text-white truncate">
                  {ai?.object || t('planViewerTitle')}
                  {ai?.number && <span className="ml-2 text-[12px] font-semibold text-violet-300">№ {ai.number}</span>}
                  {rooms != null && <span className="ml-2 text-[12px] font-normal text-slate-400">{rooms} xona · {area ?? '—'} m²</span>}
                </div>
              </div>
              <button onClick={onClose} className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 grid place-items-center text-slate-300 transition-colors shrink-0" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 3D canvas */}
            <div className="flex-1 relative min-h-0">
              {isLoading ? (
                <div className="absolute inset-0 grid place-items-center text-slate-400">
                  <div className="text-center">
                    <div className="w-11 h-11 mx-auto mb-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                    <div className="text-[13px]">{t('planLoading')}</div>
                  </div>
                </div>
              ) : noData ? (
                <div className="absolute inset-0 grid place-items-center text-center px-8">
                  <div>
                    <AlertCircle className="h-12 w-12 text-amber-400 mx-auto mb-3" />
                    <div className="text-amber-200 font-semibold mb-1">{t('plan3dNoData')}</div>
                    <div className="text-[13px] text-slate-400">{t('plan3dNoDataHint')}</div>
                  </div>
                </div>
              ) : plan ? (
                <Canvas shadows camera={{ position: [0, 10, 12], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
                  <color attach="background" args={['#0b1020']} />
                  <fog attach="fog" args={['#0b1020', 22, 42]} />
                  <Suspense fallback={null}>
                    <Scene plan={plan} />
                  </Suspense>
                </Canvas>
              ) : null}

              {plan && !isLoading && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/80 ring-1 ring-slate-700 text-[11.5px] font-medium text-slate-300 pointer-events-none">
                  <RotateCcw className="h-3.5 w-3.5" /> {t('plan3dHint')}
                </div>
              )}

              {/* Taxminiy model ogohlantirishi */}
              {plan && !isLoading && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-amber-500/15 ring-1 ring-amber-500/30 text-[11px] font-medium text-amber-300 pointer-events-none">
                  {t('plan3dApprox')}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
