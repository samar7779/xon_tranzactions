'use client';

import { Suspense, useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Float, Text } from '@react-three/drei';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Home, Banknote, User2, Calendar, Building2, TrendingUp, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

/**
 * 3D apartment ko'rinishi — shartnoma to'lov holatini vizual ko'rsatadi.
 *
 * Bino qavatlari "yoritiladi" to'lov foiziga qarab:
 *   - 80% to'langan → 4/5 qavat yoritilgan (oltin)
 *   - Tepa qavat — qisman yoritilgan (40% to'langan = 4/10 yorug')
 *
 * Ma'lumotlar manbai: /oplata-kv/crm-sverka — CRM'dagi shartnoma narxi va to'lovlar.
 */

type ApartmentData = {
  contractNo: string;
  object: string | null;
  client: string | null;
  totalPrice: number;        // CRM contractInfo.price
  totalPaid: number;         // initialPaid + monthlyPaid
  initialPlan: number;
  initialPaid: number;
  monthlyPlan: number;
  monthlyPaid: number;
  contractDate: string | null;
  status: string | null;
  // Xonadon ma'lumotlari (CRM dan)
  aptNumber: string | null;
  rooms: number | null;
  area: number | null;
  building: string | null;
  block: string | null;
  floor: number | null;
};

// ─── 3D BUILDING ─────────────────────────────────────────────
function Building({
  progress, accent, totalFloors, targetFloor,
}: {
  progress: number;
  accent: string;
  totalFloors: number;       // Binodagi qavatlar soni (default 9)
  targetFloor: number | null; // Mijozning qavati (highlighted)
}) {
  const groupRef = useRef<THREE.Group>(null);
  const FLOORS = Math.max(3, Math.min(20, totalFloors));

  useFrame(() => {
    if (groupRef.current) {
      // Sekin avtomatik aylanish
      groupRef.current.rotation.y += 0.002;
    }
  });

  // Har qavat necha foizda yoritilishini hisoblaymiz
  const floorFills = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < FLOORS; i++) {
      const floorStart = (i / FLOORS) * 100;
      const floorEnd = ((i + 1) / FLOORS) * 100;
      if (progress >= floorEnd) arr.push(1);
      else if (progress <= floorStart) arr.push(0);
      else arr.push((progress - floorStart) / (floorEnd - floorStart));
    }
    return arr;
  }, [progress, FLOORS]);

  // Target floor index (0-based) — pastdan boshlanadi
  const targetIdx = targetFloor ? targetFloor - 1 : -1;

  return (
    <group ref={groupRef} position={[0, -1.4, 0]}>
      {/* Asos (er) — kattalashtirilgan platforma */}
      <mesh position={[0, -0.35, 0]} receiveShadow>
        <cylinderGeometry args={[3.2, 3.4, 0.25, 32]} />
        <meshStandardMaterial color="#0f172a" roughness={0.85} metalness={0.2} />
      </mesh>
      <mesh position={[0, -0.21, 0]}>
        <cylinderGeometry args={[3.1, 3.1, 0.05, 32]} />
        <meshStandardMaterial color="#1e293b" roughness={0.6} />
      </mesh>

      {/* Bino qavatlari */}
      {Array.from({ length: FLOORS }).map((_, i) => {
        const y = i * 0.55;
        const fill = floorFills[i];
        const isTarget = i === targetIdx;
        return (
          <group key={i} position={[0, y, 0]}>
            {/* Qavat tashqi shisha */}
            <mesh castShadow>
              <boxGeometry args={[2.4, 0.55, 2.4]} />
              <meshPhysicalMaterial
                color={isTarget ? accent : fill > 0 ? accent : '#334155'}
                emissive={isTarget ? accent : fill > 0 ? accent : '#0f172a'}
                emissiveIntensity={isTarget ? Math.max(0.9, fill * 1.2) : fill * 0.7}
                metalness={0.3}
                roughness={0.15}
                transmission={isTarget ? 0.05 : 0.15}
                thickness={0.3}
                clearcoat={1}
                clearcoatRoughness={0}
              />
            </mesh>

            {/* Qavat orasidagi metall ramka */}
            <mesh position={[0, 0.275, 0]}>
              <boxGeometry args={[2.5, 0.04, 2.5]} />
              <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
            </mesh>

            {/* Window grid — har tomonda 4 ta deraza */}
            {[
              [0, 1.21, 0],     // front
              [0, -1.21, Math.PI], // back
            ].map(([offset, z, rot], side) => (
              <group key={side} position={[0, 0, z as number]} rotation={[0, rot as number, 0]}>
                {[0, 1, 2, 3].map((wx) => (
                  <mesh key={wx} position={[-0.75 + wx * 0.5, 0, 0]}>
                    <planeGeometry args={[0.32, 0.32]} />
                    <meshBasicMaterial
                      color={isTarget ? '#fef9c3' : fill > wx / 4 ? '#fef9c3' : '#0f172a'}
                      transparent
                      opacity={isTarget ? 1 : fill > wx / 4 ? 0.95 : 0.4}
                    />
                  </mesh>
                ))}
              </group>
            ))}

            {/* Target qavat uchun ko'rsatkich strelka */}
            {isTarget && (
              <>
                {/* Aylanma halqa */}
                <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[1.85, 0.04, 8, 48]} />
                  <meshBasicMaterial color={accent} />
                </mesh>
                {/* Pulsatsiya qiluvchi halqa */}
                <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[2.1, 0.02, 8, 48]} />
                  <meshBasicMaterial color={accent} transparent opacity={0.4} />
                </mesh>
                {/* "Sizning xonadoningiz" label */}
                <Float speed={1.5} rotationIntensity={0} floatIntensity={0.1}>
                  <Text
                    position={[1.8, 0, 0]}
                    fontSize={0.2}
                    color={accent}
                    anchorX="left"
                    anchorY="middle"
                    outlineWidth={0.01}
                    outlineColor="#000"
                  >
                    ← {targetFloor}-qavat
                  </Text>
                </Float>
              </>
            )}
          </group>
        );
      })}

      {/* Tom (roof) — taper bilan */}
      <mesh position={[0, FLOORS * 0.55, 0]}>
        <boxGeometry args={[2.5, 0.15, 2.5]} />
        <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, FLOORS * 0.55 + 0.15, 0]}>
        <boxGeometry args={[2.0, 0.08, 2.0]} />
        <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.3} />
      </mesh>

      {/* Antenna */}
      <mesh position={[0.8, FLOORS * 0.55 + 0.55, 0.8]}>
        <cylinderGeometry args={[0.02, 0.02, 0.7]} />
        <meshStandardMaterial color="#94a3b8" metalness={1} />
      </mesh>
      <mesh position={[0.8, FLOORS * 0.55 + 0.95, 0.8]}>
        <sphereGeometry args={[0.04]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>

      {/* Floating progress label — tepada */}
      <Float speed={2} rotationIntensity={0} floatIntensity={0.4}>
        <Text
          position={[0, FLOORS * 0.55 + 1.4, 0]}
          fontSize={0.55}
          color={accent}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000"
        >
          {Math.round(progress)}%
        </Text>
      </Float>

      {/* Light beam pastdan tepaga */}
      <pointLight position={[0, progress / 100 * FLOORS * 0.55, 0]} intensity={2} color={accent} distance={6} />

      {/* Target qavat uchun spot light */}
      {targetIdx >= 0 && (
        <pointLight position={[2, targetIdx * 0.55, 0]} intensity={3} color={accent} distance={4} />
      )}
    </group>
  );
}

// ─── PARTICLES — pul belgilari uchayotgan effekt ──────────
function MoneyParticles({ enabled }: { enabled: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const count = 80;

  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 1] = Math.random() * 6 - 1;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 8;
      velocities[i * 3 + 1] = 0.005 + Math.random() * 0.015;
    }
    return { positions, velocities };
  }, []);

  useFrame(() => {
    if (!enabled || !ref.current) return;
    const pos = ref.current.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const y = pos.getY(i) + velocities[i * 3 + 1];
      pos.setY(i, y > 7 ? -1 : y);
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.06} color="#fbbf24" transparent opacity={0.7} sizeAttenuation />
    </points>
  );
}

// ─── ASOSIY SCENE ─────────────────────────────────────────
function Scene({
  progress, accent, totalFloors, targetFloor,
}: {
  progress: number;
  accent: string;
  totalFloors: number;
  targetFloor: number | null;
}) {
  return (
    <>
      {/* Environment preset olib tashlandi — HDR worker 'window is not defined' beradi.
          Manual lighting bilan ham yaxshi ko'rinadi. */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1.5} castShadow />
      <directionalLight position={[-5, 6, -3]} intensity={0.6} color="#818cf8" />
      <pointLight position={[-5, 4, -3]} intensity={2} color="#818cf8" />
      <pointLight position={[5, 2, -3]} intensity={1.5} color="#f472b6" />
      <pointLight position={[0, 8, 0]} intensity={1} color="#fff" />

      <Building progress={progress} accent={accent} totalFloors={totalFloors} targetFloor={targetFloor} />
      <MoneyParticles enabled={progress > 0} />

      {/* Kamera nazorati — foydalanuvchi qo'l bilan ham aylantirishi mumkin */}
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={6}
        maxDistance={14}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 1.8}
        autoRotate={false}
      />
    </>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────
export function Apartment3DDialog({
  open, onClose, contractNo,
}: {
  open: boolean;
  onClose: () => void;
  contractNo: string | null;
}) {
  const [animatedProgress, setAnimatedProgress] = useState(0);

  // CRM'dan ma'lumot — narx, to'lovlar, mijoz, xonadon
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

  // Meta — client, object (alohida endpoint'dan, fallback uchun)
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

  // Bino qavatlar soni — agar mijoz qavati ma'lum bo'lsa, undan kamida 2 qavat ko'p qilamiz
  // Aks holda standart 9 qavat
  const totalFloors = useMemo(() => {
    if (!apt?.floor) return 9;
    return Math.max(9, apt.floor + 2);
  }, [apt?.floor]);

  const targetProgress = useMemo(() => {
    if (!apt || apt.totalPrice <= 0) return 0;
    return Math.min(100, (apt.totalPaid / apt.totalPrice) * 100);
  }, [apt]);

  // Smooth animation pastdan tepaga
  useEffect(() => {
    if (!open) {
      setAnimatedProgress(0);
      return;
    }
    setAnimatedProgress(0);
    const startTime = performance.now();
    const duration = 2200; // 2.2 sek
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedProgress(targetProgress * eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [open, targetProgress]);

  // Accent color progress'ga qarab — qizil (qarz) → sariq → yashil (to'la)
  const accent = useMemo(() => {
    if (targetProgress >= 100) return '#10b981'; // emerald
    if (targetProgress >= 70) return '#f59e0b';  // amber
    if (targetProgress >= 40) return '#eab308';  // yellow
    if (targetProgress > 0) return '#f97316';    // orange
    return '#ef4444';                            // red
  }, [targetProgress]);

  const remaining = (apt?.totalPrice || 0) - (apt?.totalPaid || 0);
  const crmNotConnected = dataQuery.data && !dataQuery.data.crmConnected;
  const noContractInfo = dataQuery.data?.ok && dataQuery.data.crmConnected && !dataQuery.data.crm.contractInfo;

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
            className="relative w-full max-w-[1100px] h-[88vh] rounded-2xl overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 ring-1 ring-slate-800 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-slate-900 to-slate-950 flex items-center gap-3 shrink-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center shadow-lg">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">3D Ko'rinish</div>
                <div className="text-base font-bold text-white truncate">
                  {apt?.object || 'Shartnoma 3D'}
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

            {/* Body: 3D scene + info panel */}
            <div className="flex-1 grid lg:grid-cols-[1fr_360px] min-h-0">
              {/* 3D scene */}
              <div className="relative bg-gradient-to-b from-slate-900 to-black">
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
                        3D ko'rinish uchun CRM'da shartnoma narxi va to'lov rejasi kerak.
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
                ) : (
                  <>
                    <Canvas
                      shadows
                      camera={{ position: [8, 4, 8], fov: 45 }}
                      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
                      dpr={[1, 2]}
                    >
                      <color attach="background" args={['#020617']} />
                      <fog attach="fog" args={['#020617', 12, 22]} />
                      <Suspense fallback={null}>
                        <Scene
                          progress={animatedProgress}
                          accent={accent}
                          totalFloors={totalFloors}
                          targetFloor={apt?.floor || null}
                        />
                      </Suspense>
                    </Canvas>

                    {/* Bottom hint */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-slate-900/70 backdrop-blur-sm text-[10px] text-slate-400 font-medium pointer-events-none">
                      Sichqoncha bilan aylantirish · scroll bilan zoom
                    </div>
                  </>
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
                          {targetProgress >= 100 ? 'to\'la to\'langan' : targetProgress >= 50 ? 'yarmidan oshgan' : 'jarayonda'}
                        </div>
                      </div>
                      {/* Progress bar */}
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

                    {/* Apartment specs — chip'lar to'plami (eng yuqorida, ko'zga tashlanadi) */}
                    {(apt.aptNumber || apt.rooms != null || apt.area != null || apt.floor != null || apt.block || apt.building) && (
                      <div className="rounded-xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 ring-1 ring-indigo-500/20 p-3.5">
                        <div className="text-[9.5px] uppercase tracking-widest text-indigo-300 font-bold mb-2.5 flex items-center gap-1.5">
                          <Home className="h-3 w-3" />
                          Xonadon ma'lumotlari
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {apt.aptNumber && (
                            <Chip color="violet">№ {apt.aptNumber}</Chip>
                          )}
                          {apt.rooms != null && (
                            <Chip color="indigo">{apt.rooms} xonalar</Chip>
                          )}
                          {apt.area != null && (
                            <Chip color="cyan">{apt.area} m²</Chip>
                          )}
                          {apt.building && (
                            <Chip color="emerald">{apt.building}</Chip>
                          )}
                          {apt.block && (
                            <Chip color="amber">{apt.block}-blok</Chip>
                          )}
                          {apt.floor != null && (
                            <Chip color="rose">⬆ {apt.floor}-qavat</Chip>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Meta */}
                    {apt.client && (
                      <InfoRow icon={<User2 className="h-3.5 w-3.5" />} label="Mijoz" value={apt.client} />
                    )}
                    {apt.object && (
                      <InfoRow icon={<Home className="h-3.5 w-3.5" />} label="Obyekt" value={apt.object} />
                    )}
                    {apt.contractDate && (
                      <InfoRow icon={<Calendar className="h-3.5 w-3.5" />} label="Shartnoma sanasi" value={new Date(apt.contractDate).toLocaleDateString('ru-RU')} />
                    )}

                    {/* Sums */}
                    <div className="pt-3 border-t border-slate-800 space-y-2.5">
                      <SumRow label="Jami narx" value={apt.totalPrice} color="text-slate-200" />
                      <SumRow label="To'langan" value={apt.totalPaid} color="text-emerald-400" prefix="+" />
                      <SumRow
                        label="Qoldiq"
                        value={remaining}
                        color={remaining > 0 ? 'text-rose-400' : 'text-emerald-400'}
                        prefix={remaining > 0 ? '−' : ''}
                      />
                    </div>

                    {/* Breakdown */}
                    <div className="pt-3 border-t border-slate-800">
                      <div className="text-[9.5px] uppercase tracking-widest text-slate-400 font-bold mb-2">Reja bo'yicha</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-slate-800/60 p-2.5">
                          <div className="text-[9px] uppercase text-slate-500 mb-1">1 vznos</div>
                          <div className="text-[12px] font-bold tabular-nums text-slate-200">
                            {formatMoney(apt.initialPaid)}
                          </div>
                          <div className="text-[10px] text-slate-500 tabular-nums">
                            / {formatMoney(apt.initialPlan)}
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-800/60 p-2.5">
                          <div className="text-[9px] uppercase text-slate-500 mb-1">Oylik</div>
                          <div className="text-[12px] font-bold tabular-nums text-slate-200">
                            {formatMoney(apt.monthlyPaid)}
                          </div>
                          <div className="text-[10px] text-slate-500 tabular-nums">
                            / {formatMoney(apt.monthlyPlan)}
                          </div>
                        </div>
                      </div>
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
