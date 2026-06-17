'use client';

import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, MeshDistortMaterial, Float } from '@react-three/drei';
import * as THREE from 'three';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Login sahifasida kichkina iridescent 3D orb — visual aksent.
 * Asosiy hero'dan farqli o'laroq kichkina, bezakdan ko'ra ko'proq.
 */

function MiniOrb({ animate }: { animate: boolean }) {
  const matRef = useRef<any>(null);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    if (matRef.current) {
      // Iridescent shift
      const hue = (Math.sin(t * 0.3) * 0.5 + 0.5) * 0.18 + 0.65;
      matRef.current.color.setHSL(hue, 0.78, 0.58);
    }
  });

  return (
    <Float speed={animate ? 1.6 : 0} rotationIntensity={1} floatIntensity={1.2}>
      <mesh scale={1.1}>
        <icosahedronGeometry args={[1, 5]} />
        <MeshDistortMaterial
          ref={matRef}
          color="#7c3aed"
          roughness={0.05}
          metalness={1.0}
          distort={0.42}
          speed={animate ? 2.2 : 0}
          envMapIntensity={1.4}
        />
      </mesh>
    </Float>
  );
}

function Scene({ animate }: { animate: boolean }) {
  return (
    <>
      <Environment preset="city" environmentIntensity={0.5} />
      <ambientLight intensity={0.25} />
      <pointLight position={[3, 3, 3]} intensity={2.2} color="#a78bfa" />
      <pointLight position={[-3, -2, -2]} intensity={1.6} color="#22d3ee" />
      <pointLight position={[0, -3, 2]} intensity={1.2} color="#f472b6" />
      <MiniOrb animate={animate} />
    </>
  );
}

export function ApiLogin3dOrb({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion();
  const animate = !reduced;
  return (
    <div className={className} style={{ width: '100%', height: '100%' }} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 3.4], fov: 40 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        frameloop={reduced ? 'demand' : 'always'}
      >
        <Suspense fallback={null}>
          <Scene animate={animate} />
        </Suspense>
      </Canvas>
    </div>
  );
}
