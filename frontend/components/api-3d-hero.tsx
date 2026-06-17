'use client';

import { Suspense, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Developer API sahifasidagi hero 3D model.
 * Aylanayotgan icosahedron + uning ichida wireframe sphere + orbiting particles.
 * Pure Three.js, drei kerak emas — bundle hajmini past saqlash uchun.
 */

function RotatingCore() {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.x += delta * 0.18;
      meshRef.current.rotation.y += delta * 0.24;
    }
    if (wireRef.current) {
      wireRef.current.rotation.x -= delta * 0.12;
      wireRef.current.rotation.y -= delta * 0.16;
    }
  });

  return (
    <group>
      {/* Asosiy icosahedron — yarim shaffof gradient */}
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[1.4, 0]} />
        <meshStandardMaterial
          color="#6366f1"
          roughness={0.2}
          metalness={0.85}
          emissive="#4338ca"
          emissiveIntensity={0.3}
          flatShading
        />
      </mesh>

      {/* Tashqi wireframe sphere */}
      <mesh ref={wireRef}>
        <icosahedronGeometry args={[2.2, 1]} />
        <meshBasicMaterial
          color="#a78bfa"
          wireframe
          transparent
          opacity={0.35}
        />
      </mesh>
    </group>
  );
}

function OrbitingDots() {
  const groupRef = useRef<THREE.Group>(null);
  // 60 ta nuqta — 3 ta halqa bo'ylab
  const positions = useMemo(() => {
    const arr: { pos: [number, number, number]; size: number }[] = [];
    const rings = 3;
    const perRing = 20;
    for (let r = 0; r < rings; r++) {
      const radius = 2.6 + r * 0.4;
      const tilt = (r * Math.PI) / 4;
      for (let i = 0; i < perRing; i++) {
        const angle = (i / perRing) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * Math.cos(tilt);
        const z = Math.sin(angle) * radius * Math.sin(tilt);
        arr.push({ pos: [x, y, z], size: 0.04 + Math.random() * 0.03 });
      }
    }
    return arr;
  }, []);

  useFrame((state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.08;
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.3) * 0.1;
    }
  });

  return (
    <group ref={groupRef}>
      {positions.map((p, i) => (
        <mesh key={i} position={p.pos}>
          <sphereGeometry args={[p.size, 8, 8]} />
          <meshBasicMaterial color={i % 3 === 0 ? '#f472b6' : i % 3 === 1 ? '#a78bfa' : '#22d3ee'} />
        </mesh>
      ))}
    </group>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.45} />
      <pointLight position={[5, 5, 5]} intensity={1.5} color="#a78bfa" />
      <pointLight position={[-5, -3, -5]} intensity={1.2} color="#f472b6" />
      <pointLight position={[0, 0, 6]} intensity={0.6} color="#22d3ee" />
      <RotatingCore />
      <OrbitingDots />
    </>
  );
}

export function Api3dHero({ className }: { className?: string }) {
  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [0, 0, 6.5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
    </div>
  );
}
