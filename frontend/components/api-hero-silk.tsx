'use client';

import { Suspense, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float } from '@react-three/drei';
import * as THREE from 'three';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Premium hero — Liquid Silk Wave
 *  - Katta plane mesh (vertex displacement bilan)
 *  - Sin/cos to'lqinlar — silk/aurora effect
 *  - Iridescent metalik material — rangi viewing angle'ga qarab o'zgaradi
 *  - Wireframe overlay — texno detail
 *  - Apple Vision Pro intro / Apple Music wave uslubi
 *  - Real-time vertex animation (shader emas — useFrame'da matematika)
 */

// ─── LIQUID SILK PLANE — vertex-animated wave ─────────────
function LiquidSilk({ animate, dark }: { animate: boolean; dark: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);

  // Yuqori detallikdagi plane geometry
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(7, 7, 80, 80);
    g.rotateX(-Math.PI / 2.4); // Kameraga qaratib biroz tilt
    return g;
  }, []);

  // Original positions saqlaymiz — animatsiya uchun
  const originalPositions = useMemo(() => {
    return new Float32Array(geom.attributes.position.array);
  }, [geom]);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    const pos = geom.attributes.position as THREE.BufferAttribute;

    // Multi-wave displacement — silk effect
    for (let i = 0; i < pos.count; i++) {
      const x = originalPositions[i * 3];
      const z = originalPositions[i * 3 + 2];
      // Asosiy uzun to'lqin
      const w1 = Math.sin(x * 0.5 + t * 0.6) * 0.4;
      // O'rta to'lqin
      const w2 = Math.cos(z * 0.7 + t * 0.4) * 0.3;
      // Mayda ripples
      const w3 = Math.sin((x + z) * 1.5 + t * 1.5) * 0.08;
      // Radial wave
      const dist = Math.sqrt(x * x + z * z);
      const w4 = Math.sin(dist * 0.8 - t * 1.2) * 0.2;

      const y = w1 + w2 + w3 + w4;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    // Iridescent color shift — viewing angle + time
    if (matRef.current) {
      const hue = 0.65 + Math.sin(t * 0.2) * 0.06; // indigo→violet→pink narrow band
      matRef.current.color.setHSL(hue, 0.75, dark ? 0.5 : 0.6);
      matRef.current.iridescence = 1.0;
      matRef.current.iridescenceIOR = 1.3 + Math.sin(t * 0.3) * 0.2;
    }

    // Rotate slowly — extra dynamic
    if (meshRef.current) {
      meshRef.current.rotation.y = Math.sin(t * 0.1) * 0.1;
    }
    if (wireRef.current) {
      wireRef.current.rotation.y = Math.sin(t * 0.1) * 0.1;
    }
  });

  return (
    <group position={[0, -0.5, 0]}>
      {/* Asosiy silk surface — iridescent metal */}
      <mesh ref={meshRef} geometry={geom}>
        <meshPhysicalMaterial
          ref={matRef}
          color="#7c3aed"
          metalness={1}
          roughness={0.15}
          // Iridescence — Three.js v0.150+ feature
          iridescence={1}
          iridescenceIOR={1.4}
          iridescenceThicknessRange={[100, 800]}
          envMapIntensity={1.8}
          side={THREE.DoubleSide}
          flatShading={false}
        />
      </mesh>

      {/* Wireframe overlay — sub-detail */}
      <mesh ref={wireRef} geometry={geom}>
        <meshBasicMaterial
          color="#c4b5fd"
          wireframe
          transparent
          opacity={dark ? 0.18 : 0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// ─── FLOATING SHARDS — accent geometry ─────────────────────
function FloatingShards({ animate }: { animate: boolean }) {
  const items = useMemo(() => [
    { pos: [-2.5, 2, -1] as [number, number, number], scale: 0.35, color: '#a78bfa', speed: 1.2 },
    { pos: [2.8, 1.5, 0.5] as [number, number, number], scale: 0.28, color: '#22d3ee', speed: 0.9 },
    { pos: [1.5, 2.5, -1.5] as [number, number, number], scale: 0.22, color: '#f472b6', speed: 1.5 },
    { pos: [-1.8, 1.8, 0.8] as [number, number, number], scale: 0.32, color: '#fbbf24', speed: 1.1 },
  ], []);

  return (
    <>
      {items.map((item, i) => (
        <Float key={i} speed={animate ? item.speed : 0} rotationIntensity={0.5} floatIntensity={0.6}>
          <mesh position={item.pos} scale={item.scale}>
            <octahedronGeometry args={[1, 0]} />
            <meshPhysicalMaterial
              color={item.color}
              metalness={1}
              roughness={0.1}
              iridescence={0.8}
              iridescenceIOR={1.5}
              envMapIntensity={2}
            />
          </mesh>
        </Float>
      ))}
    </>
  );
}

// ─── AURORA STRIPS — vertical light beams ─────────────────
function AuroraStrips({ animate }: { animate: boolean }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    refs.current.forEach((mesh, i) => {
      if (!mesh) return;
      mesh.position.x = -3 + i * 1.5 + Math.sin(t * 0.3 + i) * 0.5;
      (mesh.material as THREE.MeshBasicMaterial).opacity =
        0.15 + Math.sin(t * 0.5 + i * 0.8) * 0.08;
    });
  });

  const strips = [0, 1, 2, 3, 4];

  return (
    <group position={[0, 0, -3]}>
      {strips.map((i) => (
        <mesh
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          position={[-3 + i * 1.5, 1, 0]}
        >
          <planeGeometry args={[0.6, 6]} />
          <meshBasicMaterial
            color={i % 2 === 0 ? '#a78bfa' : '#22d3ee'}
            transparent
            opacity={0.15}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

function Scene({ dark, animate }: { dark: boolean; animate: boolean }) {
  return (
    <>
      {/* HDR — chiroyli iridescent ko'rinadi */}
      <Environment preset="city" background={false} environmentIntensity={1.0} />

      <ambientLight intensity={dark ? 0.2 : 0.35} />

      {/* Key colored lights */}
      <pointLight position={[5, 5, 3]} intensity={3.0} color="#a78bfa" />
      <pointLight position={[-5, 4, -2]} intensity={2.5} color="#22d3ee" />
      <pointLight position={[0, 6, 5]} intensity={2.0} color="#f472b6" />
      <pointLight position={[0, -3, 4]} intensity={1.5} color="#fbbf24" />

      <AuroraStrips animate={animate} />
      <LiquidSilk dark={dark} animate={animate} />
      <FloatingShards animate={animate} />
    </>
  );
}

export function ApiHeroSilk({ dark = false, className }: { dark?: boolean; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const animate = !reduced;
  return (
    <div className={className} style={{ width: '100%', height: '100%' }} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 2, 5], fov: 50 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        frameloop={reduced ? 'demand' : 'always'}
      >
        <Suspense fallback={null}>
          <Scene dark={dark} animate={animate} />
        </Suspense>
      </Canvas>
    </div>
  );
}
