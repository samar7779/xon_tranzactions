'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, useTexture, Html } from '@react-three/drei';
import * as THREE from 'three';
import { X, Building2, Loader2, ImageOff, RotateCcw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api, apiObjectUrl } from '@/lib/api';

/**
 * Xonadon 3D ko'rinishi — CRM'dagi REAL planirovka rasmini 3D maket (board)
 * sifatida ko'rsatadi: chuqurlik + soya + yorug'lik, orbit bilan aylantiriladi.
 *
 * Rasm manbai: /oplata-kv/contract-plan (CRM /order/index plan_images).
 * Presigned S3 rasm blob orqali olinadi (CORS-free WebGL tekstura).
 */

type PlanMedia = {
  ok: boolean;
  contract: string;
  plans: string[];
  contractDoc: string | null;
  apartmentNumber: string | null;
  objectName: string | null;
  typeName: string | null;
  crmConnected: boolean;
};

// ─── Plan image'ni ekstruziyalangan maket ustiga qo'yadigan mesh ───
function PlanBoard({ url }: { url: string }) {
  const texture = useTexture(url);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }, [texture]);

  const { w, h } = useMemo(() => {
    const img: any = texture.image;
    const aspect = img && img.width && img.height ? img.width / img.height : 1.4;
    const BASE = 6;
    return aspect >= 1 ? { w: BASE, h: BASE / aspect } : { w: BASE * aspect, h: BASE };
  }, [texture]);

  const thickness = 0.35;

  return (
    <group>
      {/* Maket asosi (qalin plita) */}
      <mesh castShadow receiveShadow position={[0, -thickness / 2, 0]}>
        <boxGeometry args={[w + 0.45, thickness, h + 0.45]} />
        <meshStandardMaterial color="#0f172a" metalness={0.35} roughness={0.55} />
      </mesh>
      {/* Ramka aksenti (indigo yorug' chiziq) */}
      <mesh position={[0, 0.005, 0]}>
        <boxGeometry args={[w + 0.45, 0.03, h + 0.45]} />
        <meshStandardMaterial color="#4f46e5" emissive="#4f46e5" emissiveIntensity={0.35} metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Planirovka rasmi (yuqori yuza) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={texture} roughness={0.85} metalness={0} />
      </mesh>
    </group>
  );
}

function Scene({ url }: { url: string }) {
  return (
    <>
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#cdd7ff', '#0b1020', 0.55]} />
      <directionalLight
        position={[6, 11, 6]}
        intensity={1.35}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-far={40}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <directionalLight position={[-6, 5, -4]} intensity={0.35} />

      <Suspense fallback={<Html center><Loader2 className="h-8 w-8 text-indigo-400 animate-spin" /></Html>}>
        <PlanBoard url={url} />
      </Suspense>

      <ContactShadows position={[0, -0.37, 0]} opacity={0.55} scale={18} blur={2.6} far={6} resolution={1024} />

      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={4.5}
        maxDistance={16}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI / 2.05}
        autoRotate
        autoRotateSpeed={0.7}
      />
    </>
  );
}

export function Apartment3DDialog({
  open, onClose, contractNo,
}: {
  open: boolean;
  onClose: () => void;
  contractNo: string | null;
}) {
  const t = useTranslations('oplatykv');
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState(false);
  const [loadingImg, setLoadingImg] = useState(false);

  const query = useQuery({
    queryKey: ['oplata-kv-contract-plan', contractNo],
    queryFn: () => api.get<PlanMedia>(
      `/oplata-kv/contract-plan?contractNo=${encodeURIComponent(contractNo || '')}`,
      { timeout: 40000 },
    ),
    enabled: open && !!contractNo,
    staleTime: 5 * 60_000,
  });

  const data = query.data;
  const planUrl = data?.plans?.[0] || null;

  // Presigned rasmni blob orqali olib, object URL yasaymiz (CORS-free WebGL tekstura)
  useEffect(() => {
    let created: string | null = null;
    setObjUrl(null);
    setImgErr(false);
    if (!open || !planUrl) return;
    setLoadingImg(true);
    apiObjectUrl(`/oplata-kv/contract-plan/download?url=${encodeURIComponent(planUrl)}`)
      .then((u) => { created = u; setObjUrl(u); })
      .catch(() => setImgErr(true))
      .finally(() => setLoadingImg(false));
    return () => { if (created) URL.revokeObjectURL(created); };
  }, [open, planUrl]);

  const isLoading = query.isLoading || loadingImg;
  const noPlan = !isLoading && (!planUrl || imgErr);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-3 sm:p-4 pointer-events-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
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
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">3D · {t('planViewerTitle')}</div>
                <div className="text-[15px] font-bold text-white truncate">
                  {data?.objectName || t('plan3dSubtitle')}
                  {data?.apartmentNumber && <span className="ml-2 text-[12px] font-semibold text-violet-300">№ {data.apartmentNumber}</span>}
                  {contractNo && <span className="ml-2 text-[11.5px] font-mono font-normal text-slate-400">#{contractNo}</span>}
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 grid place-items-center text-slate-300 transition-colors shrink-0"
                aria-label="Close"
              >
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
              ) : noPlan ? (
                <div className="absolute inset-0 grid place-items-center text-center px-8">
                  <div>
                    <ImageOff className="h-12 w-12 text-slate-500 mx-auto mb-3" />
                    <div className="text-slate-200 font-semibold mb-1">{t('planNotFound')}</div>
                    <div className="text-[13px] text-slate-400">{t('planNotFoundHint')}</div>
                  </div>
                </div>
              ) : objUrl ? (
                <Canvas
                  shadows
                  camera={{ position: [0, 7.5, 8.5], fov: 42 }}
                  dpr={[1, 2]}
                  gl={{ antialias: true, preserveDrawingBuffer: false }}
                >
                  <color attach="background" args={['#0b1020']} />
                  <fog attach="fog" args={['#0b1020', 18, 34]} />
                  <Scene url={objUrl} />
                </Canvas>
              ) : null}

              {/* Reset hint chip */}
              {objUrl && !isLoading && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/80 ring-1 ring-slate-700 text-[11.5px] font-medium text-slate-300 pointer-events-none">
                  <RotateCcw className="h-3.5 w-3.5" /> {t('plan3dHint')}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
