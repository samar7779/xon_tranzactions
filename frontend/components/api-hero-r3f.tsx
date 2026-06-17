'use client';

import { Suspense, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, MeshDistortMaterial, Float, ContactShadows, MeshTransmissionMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Premium 3D hero — React Three Fiber + drei.
 * 2025 trendi: iridescent distorted mesh + transmission glass + HDR env.
 *  - Asosiy: MeshDistortMaterial bilan morphing icosahedron (iridescent metal)
 *  - O'rab turuvchi: MeshTransmissionMaterial bilan glass torus (real refraction)
 *  - HDR environment ("city" preset) — chiroyli reflexion va rim light
 *  - ContactShadows pastdan — grounding effekti
 *  - Float wrapper: tabiiy up-down + rotation
 *  - Linear/Vercel/Apple Vision Pro uslubi
 */

// ─── CORE MESH — iridescent distorted icosahedron ─────────
function CoreMesh({ animate }: { animate: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<any>(null);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    if (meshRef.current) {
      meshRef.current.rotation.x = Math.sin(t * 0.2) * 0.15;
      meshRef.current.rotation.y = t * 0.15;
    }
    if (matRef.current) {
      // Iridescent color shift — hue drift between indigo, violet, fuchsia, cyan
      const hue = (Math.sin(t * 0.18) * 0.5 + 0.5) * 0.18 + 0.65; // 0.65..0.83
      matRef.current.color.setHSL(hue, 0.75, 0.55);
    }
  });

  return (
    <mesh ref={meshRef} scale={1.6}>
      <icosahedronGeometry args={[1, 6]} />
      <MeshDistortMaterial
        ref={matRef}
        color="#7c3aed"
        roughness={0.05}
        metalness={1.0}
        distort={0.32}
        speed={animate ? 1.8 : 0}
        envMapIntensity={1.6}
        // Iridescence — Three.js 0.150+ ishlatadi
      />
    </mesh>
  );
}

// ─── GLASS TORUS — transmission material wrapping the core ─
function GlassTorus({ animate }: { animate: boolean }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (!animate) return;
    if (ref.current) {
      ref.current.rotation.x = state.clock.elapsedTime * 0.1;
      ref.current.rotation.z = state.clock.elapsedTime * 0.07;
    }
  });

  return (
    <mesh ref={ref} scale={2.4} rotation={[Math.PI / 3, 0, 0]}>
      <torusGeometry args={[1, 0.04, 32, 200]} />
      <MeshTransmissionMaterial
        color="#a5b4fc"
        thickness={0.5}
        roughness={0.05}
        transmission={1}
        ior={1.4}
        chromaticAberration={0.08}
        backside={false}
        backsideThickness={0.2}
        anisotropy={0.4}
        distortion={0.2}
        distortionScale={0.4}
        temporalDistortion={animate ? 0.15 : 0}
      />
    </mesh>
  );
}

// ─── PARTICLE FIELD — floating points ─────────────────────
function ParticleField({ count = 220, animate }: { count?: number; animate: boolean }) {
  const ref = useRef<THREE.Points>(null);

  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [
      [0.43, 0.5, 1.0],   // indigo
      [0.65, 0.45, 1.0],  // violet
      [0.95, 0.55, 0.95], // fuchsia
      [0.35, 0.85, 0.95], // cyan
    ];
    for (let i = 0; i < count; i++) {
      const r = 3.5 + Math.random() * 4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const c = palette[Math.floor(Math.random() * palette.length)];
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
    }
    return { positions, colors };
  }, [count]);

  useFrame((state, delta) => {
    if (!animate) return;
    if (ref.current) {
      ref.current.rotation.y += delta * 0.03;
      ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.1;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.06}
        vertexColors
        transparent
        opacity={0.7}
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
      {/* HDR Environment — premium reflexion */}
      <Environment preset="city" background={false} environmentIntensity={0.6} />

      {/* Key lights — colored rim lighting */}
      <ambientLight intensity={dark ? 0.18 : 0.3} />
      <pointLight position={[5, 5, 5]} intensity={2.5} color="#a78bfa" />
      <pointLight position={[-5, 3, -3]} intensity={2.0} color="#22d3ee" />
      <pointLight position={[0, -4, 4]} intensity={1.5} color="#f472b6" />
      <pointLight position={[3, -2, -4]} intensity={1.2} color="#fbbf24" />

      {/* Floating particles */}
      <ParticleField count={animate ? 220 : 80} animate={animate} />

      {/* Main floating mesh — wrap in Float for natural drift */}
      <Float
        speed={animate ? 1.2 : 0}
        rotationIntensity={0.6}
        floatIntensity={0.8}
        floatingRange={[-0.2, 0.2]}
      >
        <GlassTorus animate={animate} />
        <CoreMesh animate={animate} />
      </Float>

      {/* Contact shadow underneath for grounding */}
      <ContactShadows
        position={[0, -2.6, 0]}
        opacity={dark ? 0.6 : 0.4}
        scale={10}
        blur={2.4}
        far={3}
        color={dark ? '#7c3aed' : '#6366f1'}
      />
    </>
  );
}

export function ApiHeroR3F({ dark = false, className }: { dark?: boolean; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const animate = !reduced;
  return (
    <div className={className} style={{ width: '100%', height: '100%' }} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 45 }}
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
