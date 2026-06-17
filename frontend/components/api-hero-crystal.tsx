'use client';

import { Suspense, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, MeshTransmissionMaterial, ContactShadows, Float } from '@react-three/drei';
import * as THREE from 'three';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Premium hero — Holographic Glass Crystal (Apple Vision Pro / Linear uslubi)
 *  - Asosiy: katta dodecahedron — chiroyli geometrik sharlar
 *  - MeshTransmissionMaterial — REAL GLASS bilan strong chromatic aberration
 *    (nurni rangli komponentlarga ajratadi, prizma effekt)
 *  - Sharp facet'lar ko'rinadi (sphere'dan farqli o'laroq)
 *  - 2 ta kichik kompanyon crystal (kompozitsiya uchun)
 *  - HDR environment ('sunset' yoki 'apartment') — issiq tonlar
 *  - Caustic light patterns ContactShadows orqali
 *  - Slow orbital rotation
 */

// ─── BIG CRYSTAL — dodecahedron with strong refraction ─────
function BigCrystal({ animate }: { animate: boolean }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    if (ref.current) {
      ref.current.rotation.y = t * 0.18;
      ref.current.rotation.x = Math.sin(t * 0.15) * 0.2;
      ref.current.rotation.z = Math.cos(t * 0.1) * 0.1;
    }
  });

  return (
    <mesh ref={ref} scale={1.7}>
      <dodecahedronGeometry args={[1, 0]} />
      <MeshTransmissionMaterial
        // Real glass — strong refraction
        thickness={1.2}
        roughness={0.0}
        transmission={1}
        ior={1.7}             // Diamond-like IOR (real diamond: 2.4, but 1.7 looks more "crystal")
        chromaticAberration={0.25}  // KUCHLI — nurni rang komponentlarga ajratadi
        anisotropicBlur={0.0}
        anisotropy={0.1}
        distortion={0.0}
        distortionScale={0.2}
        temporalDistortion={animate ? 0.05 : 0}
        clearcoat={1}
        clearcoatRoughness={0.0}
        attenuationDistance={1.2}
        attenuationColor="#f0abfc"
        color="#ffffff"
        background={new THREE.Color('#a78bfa')}
      />
    </mesh>
  );
}

// ─── COMPANION CRYSTALS — smaller orbiting prisms ─────────
function CompanionCrystal({
  position, scale, geom, animate, speed = 1,
}: {
  position: [number, number, number];
  scale: number;
  geom: 'octahedron' | 'tetrahedron' | 'icosahedron';
  animate: boolean;
  speed?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    if (ref.current) {
      ref.current.rotation.x = t * 0.3 * speed;
      ref.current.rotation.y = t * 0.4 * speed;
    }
  });

  return (
    <Float speed={animate ? 1.4 * speed : 0} rotationIntensity={0.4} floatIntensity={0.7}>
      <mesh ref={ref} position={position} scale={scale}>
        {geom === 'octahedron' && <octahedronGeometry args={[1, 0]} />}
        {geom === 'tetrahedron' && <tetrahedronGeometry args={[1, 0]} />}
        {geom === 'icosahedron' && <icosahedronGeometry args={[1, 0]} />}
        <MeshTransmissionMaterial
          thickness={0.8}
          roughness={0.0}
          transmission={1}
          ior={1.5}
          chromaticAberration={0.15}
          anisotropy={0.05}
          temporalDistortion={animate ? 0.03 : 0}
          clearcoat={1}
          clearcoatRoughness={0.0}
          attenuationDistance={1}
          attenuationColor="#c4b5fd"
          color="#ffffff"
        />
      </mesh>
    </Float>
  );
}

// ─── BACKGROUND PARTICLES — subtle bokeh dust ─────────────
function BokehDust({ animate }: { animate: boolean }) {
  const ref = useRef<THREE.Points>(null);

  const { positions, colors, sizes } = useMemo(() => {
    const count = 180;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const palette = [
      [0.55, 0.42, 0.97],  // indigo-violet
      [0.85, 0.55, 0.97],  // soft fuchsia
      [0.42, 0.85, 0.97],  // soft cyan
      [0.95, 0.85, 0.85],  // warm white
    ];
    for (let i = 0; i < count; i++) {
      const r = 3 + Math.random() * 5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const c = palette[Math.floor(Math.random() * palette.length)];
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
      sizes[i] = 0.04 + Math.random() * 0.08;
    }
    return { positions, colors, sizes };
  }, []);

  useFrame((state, delta) => {
    if (!animate) return;
    if (ref.current) {
      ref.current.rotation.y += delta * 0.02;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.06}
        vertexColors
        transparent
        opacity={0.6}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

function Scene({ dark, animate }: { dark: boolean; animate: boolean }) {
  return (
    <>
      {/* HDR — 'sunset' yumshoq issiq nur */}
      <Environment preset="sunset" background={false} environmentIntensity={0.7} />

      {/* Key lights — colored rim accents */}
      <ambientLight intensity={dark ? 0.15 : 0.25} />
      <pointLight position={[6, 4, 3]} intensity={3.2} color="#fbbf24" />
      <pointLight position={[-5, 3, 2]} intensity={2.5} color="#a78bfa" />
      <pointLight position={[0, -4, 5]} intensity={2.0} color="#22d3ee" />
      <pointLight position={[3, -3, -3]} intensity={1.5} color="#f472b6" />
      <pointLight position={[-3, 5, -2]} intensity={1.2} color="#ec4899" />

      <BokehDust animate={animate} />

      {/* Asosiy crystal */}
      <Float
        speed={animate ? 0.8 : 0}
        rotationIntensity={0.3}
        floatIntensity={0.5}
      >
        <BigCrystal animate={animate} />
      </Float>

      {/* Companion crystals */}
      <CompanionCrystal
        position={[2.6, 1.4, -0.5]}
        scale={0.55}
        geom="octahedron"
        animate={animate}
        speed={1.2}
      />
      <CompanionCrystal
        position={[-2.4, -1.5, 0.3]}
        scale={0.4}
        geom="tetrahedron"
        animate={animate}
        speed={1.5}
      />
      <CompanionCrystal
        position={[1.8, -2, 0.8]}
        scale={0.32}
        geom="icosahedron"
        animate={animate}
        speed={0.9}
      />

      {/* Caustic shadow */}
      <ContactShadows
        position={[0, -2.6, 0]}
        opacity={dark ? 0.55 : 0.35}
        scale={12}
        blur={3}
        far={3.5}
        color={dark ? '#7c3aed' : '#6366f1'}
      />
    </>
  );
}

export function ApiHeroCrystal({ dark = false, className }: { dark?: boolean; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const animate = !reduced;
  return (
    <div className={className} style={{ width: '100%', height: '100%' }} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 6.5], fov: 45 }}
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
