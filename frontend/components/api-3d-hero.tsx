'use client';

import { Suspense, useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Developer API hero — pro darajadagi 3D sahna:
 *  - Yuqori polygonli morphing icosphere (vertex displacement + sin-wave)
 *  - Yarim shaffof gradient material (matcap-like, color shift)
 *  - 2 ta wireframe sphere (qarama-qarshi aylanish)
 *  - Yengil glow (additive layered spheres)
 *  - Volumetrik particles (300+, parallax)
 *  - Sekin kamera dreyfi (parallax effekt)
 */

// ─── DISTORTED CORE — vertex-animated icosphere ──────────────────
function DistortedCore({ dark }: { dark: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);

  // Yuqori detallik — 4-darajali subdivision = 320+ verteks
  const geom = useMemo(() => new THREE.IcosahedronGeometry(1.5, 5), []);
  const originalPositions = useMemo(() => {
    const arr = geom.attributes.position.array.slice();
    return new Float32Array(arr);
  }, [geom]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (meshRef.current) {
      meshRef.current.rotation.x = t * 0.12;
      meshRef.current.rotation.y = t * 0.18;
    }
    if (glowRef.current) {
      glowRef.current.rotation.x = t * 0.08;
      glowRef.current.rotation.y = t * 0.1;
      const s = 1 + Math.sin(t * 0.7) * 0.05;
      glowRef.current.scale.set(s, s, s);
    }
    // Vertex displacement — pulsatsiya
    const pos = geom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = originalPositions[i * 3];
      const y = originalPositions[i * 3 + 1];
      const z = originalPositions[i * 3 + 2];
      const r = Math.sqrt(x * x + y * y + z * z);
      // Sin-wave displacement
      const noise = Math.sin(x * 1.7 + t * 0.8) * Math.cos(y * 1.4 + t * 0.6) * Math.sin(z * 1.5 + t * 0.7);
      const displaced = r + noise * 0.18;
      const k = displaced / r;
      pos.setXYZ(i, x * k, y * k, z * k);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    // Color shift
    if (matRef.current) {
      const hue = (Math.sin(t * 0.15) * 0.5 + 0.5) * 0.1 + 0.66; // 0.66..0.76 (indigo→violet→pink)
      matRef.current.color.setHSL(hue, 0.85, dark ? 0.55 : 0.6);
      matRef.current.emissive.setHSL(hue, 0.95, 0.25);
    }
  });

  return (
    <group>
      {/* Asosiy core */}
      <mesh ref={meshRef} geometry={geom}>
        <meshPhysicalMaterial
          ref={matRef}
          color="#6366f1"
          roughness={0.15}
          metalness={0.92}
          emissive="#4338ca"
          emissiveIntensity={0.45}
          clearcoat={1}
          clearcoatRoughness={0.1}
          ior={1.5}
          reflectivity={0.7}
          flatShading={false}
        />
      </mesh>

      {/* Inner glow — additive sphere for halo */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[1.8, 32, 32]} />
        <meshBasicMaterial
          color="#a78bfa"
          transparent
          opacity={dark ? 0.18 : 0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ─── WIREFRAMES ─────────────────────────────────────────────────
function WireframeShells({ dark }: { dark: boolean }) {
  const outerRef = useRef<THREE.Mesh>(null);
  const middleRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (outerRef.current) {
      outerRef.current.rotation.x -= delta * 0.06;
      outerRef.current.rotation.y -= delta * 0.09;
    }
    if (middleRef.current) {
      middleRef.current.rotation.x += delta * 0.14;
      middleRef.current.rotation.y -= delta * 0.18;
      middleRef.current.rotation.z += delta * 0.04;
    }
  });

  return (
    <>
      <mesh ref={outerRef}>
        <icosahedronGeometry args={[2.6, 2]} />
        <meshBasicMaterial
          color="#c4b5fd"
          wireframe
          transparent
          opacity={dark ? 0.4 : 0.3}
        />
      </mesh>
      <mesh ref={middleRef}>
        <icosahedronGeometry args={[2.15, 1]} />
        <meshBasicMaterial
          color="#f0abfc"
          wireframe
          transparent
          opacity={dark ? 0.3 : 0.22}
        />
      </mesh>
    </>
  );
}

// ─── PARTICLE FIELD ─────────────────────────────────────────────
function ParticleField({ dark }: { dark: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const count = 320;

  const { positions, colors, sizes, orbitRadii, orbitSpeeds, orbitPhases, axes } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const orbitRadii = new Float32Array(count);
    const orbitSpeeds = new Float32Array(count);
    const orbitPhases = new Float32Array(count);
    const axes = new Float32Array(count * 3); // 3D rotation axis

    const palette = [
      [0.40, 0.40, 1.0],  // indigo
      [0.65, 0.55, 1.0],  // violet
      [0.95, 0.45, 0.85], // pink
      [0.40, 0.85, 0.95], // cyan
    ];

    for (let i = 0; i < count; i++) {
      // Distribute on multiple shells
      const shell = Math.floor(Math.random() * 4); // 0..3
      const radius = 3.0 + shell * 0.5 + Math.random() * 0.4;
      const phi = Math.random() * Math.PI * 2;
      orbitRadii[i] = radius;
      orbitSpeeds[i] = 0.05 + Math.random() * 0.18;
      orbitPhases[i] = phi;

      // Random axis for full 3D scattering
      const ax = Math.random() * 2 - 1;
      const ay = Math.random() * 2 - 1;
      const az = Math.random() * 2 - 1;
      const al = Math.sqrt(ax * ax + ay * ay + az * az);
      axes[i * 3 + 0] = ax / al;
      axes[i * 3 + 1] = ay / al;
      axes[i * 3 + 2] = az / al;

      // Color
      const c = palette[Math.floor(Math.random() * palette.length)];
      colors[i * 3 + 0] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];

      sizes[i] = 0.5 + Math.random() * 2.5;

      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
    }
    return { positions, colors, sizes, orbitRadii, orbitSpeeds, orbitPhases, axes };
  }, [count]);

  const points = useRef<THREE.Points>(null);

  useFrame((state) => {
    if (!points.current) return;
    const t = state.clock.elapsedTime;
    const pos = points.current.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const r = orbitRadii[i];
      const angle = orbitPhases[i] + t * orbitSpeeds[i];
      // Initial flat orbit in XY plane
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      const z = 0;
      // Rotate around random axis to scatter in 3D
      const ax = axes[i * 3 + 0], ay = axes[i * 3 + 1], az = axes[i * 3 + 2];
      const cosT = Math.cos(orbitPhases[i] * 0.5);
      const sinT = Math.sin(orbitPhases[i] * 0.5);
      const dot = x * ax + y * ay + z * az;
      const nx = x * cosT + (ay * z - az * y) * sinT + ax * dot * (1 - cosT);
      const ny = y * cosT + (az * x - ax * z) * sinT + ay * dot * (1 - cosT);
      const nz = z * cosT + (ax * y - ay * x) * sinT + az * dot * (1 - cosT);
      pos.setXYZ(i, nx, ny, nz);
    }
    pos.needsUpdate = true;

    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.04;
    }
  });

  return (
    <group ref={groupRef}>
      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
          <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.05}
          vertexColors
          transparent
          opacity={dark ? 0.9 : 0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

// ─── CAMERA DRIFT — gentle parallax ─────────────────────────────
function CameraDrift() {
  const { camera } = useThree();
  const base = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 7 });

  useEffect(() => {
    base.current = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  }, [camera]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    camera.position.x = base.current.x + Math.sin(t * 0.18) * 0.4;
    camera.position.y = base.current.y + Math.cos(t * 0.14) * 0.3;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function Scene({ dark }: { dark: boolean }) {
  return (
    <>
      <ambientLight intensity={dark ? 0.3 : 0.5} />
      <pointLight position={[6, 5, 4]} intensity={2.2} color="#a78bfa" />
      <pointLight position={[-5, -3, -4]} intensity={1.6} color="#f472b6" />
      <pointLight position={[0, 4, 6]} intensity={1.2} color="#22d3ee" />
      <pointLight position={[0, -5, -2]} intensity={0.8} color="#fbbf24" />

      <CameraDrift />
      <DistortedCore dark={dark} />
      <WireframeShells dark={dark} />
      <ParticleField dark={dark} />
    </>
  );
}

export function Api3dHero({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [0, 0, 7], fov: 50 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <Scene dark={dark} />
        </Suspense>
      </Canvas>
    </div>
  );
}
