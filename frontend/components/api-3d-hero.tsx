'use client';

import { Suspense, useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';

/**
 * API hero — network constellation 3D vizualizatsiya.
 * Pro audit asosida qayta yozildi:
 *  - Edges memory leak tuzatildi (useMemo + dispose cleanup)
 *  - Geometry segments to'g'ri o'lchamga keltirildi (perf)
 *  - Yagona orbital rotation group (vizual ritm birligi)
 *  - prefers-reduced-motion bilan to'liq mos
 *  - Light/dark mode'da yorug'lik va opaklik moslangan
 *  - Rang palitra: indigo + cyan (rainbow yo'q)
 */

// ─── HELPER: Fibonacci sphere ─── (uniform distribution)
function fibonacciSphere(samples: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const phi = Math.PI * (Math.sqrt(5) - 1);
  for (let i = 0; i < samples; i++) {
    const y = 1 - (i / (samples - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    points.push(new THREE.Vector3(x * radius, y * radius, z * radius));
  }
  return points;
}

const NODE_COUNT = 28;
const EDGE_PER_NODE = 3;
const NODE_RADIUS = 2.6;

const NODES = fibonacciSphere(NODE_COUNT, NODE_RADIUS);

function buildEdges(): Array<[number, number]> {
  const set = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    const distances = NODES.map((n, j) => ({ j, d: NODES[i].distanceTo(n) }))
      .filter((x) => x.j !== i)
      .sort((a, b) => a.d - b.d);
    for (let k = 0; k < EDGE_PER_NODE; k++) {
      const j = distances[k].j;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!set.has(key)) {
        set.add(key);
        edges.push([i, j]);
      }
    }
  }
  return edges;
}

const EDGES = buildEdges();

// ════════════════════════════════════════════════════════
// CENTER HUB — markaziy API gateway
// ════════════════════════════════════════════════════════
function CenterHub({ dark, animate }: { dark: boolean; animate: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);

  useFrame((state, delta) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    // Yagona ritm: sekin pulsing rotation
    if (meshRef.current) {
      meshRef.current.rotation.x += delta * 0.06;
      meshRef.current.rotation.y += delta * 0.08;
    }
    if (glowRef.current) {
      const s = 1 + Math.sin(t * 1.2) * 0.05;
      glowRef.current.scale.set(s, s, s);
    }
    // Color drift — indigo→violet narrow band
    if (matRef.current) {
      const hue = 0.66 + Math.sin(t * 0.2) * 0.03;
      matRef.current.color.setHSL(hue, 0.65, dark ? 0.55 : 0.6);
    }
  });

  return (
    <group>
      {/* Inner solid hub — icosahedron */}
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[0.42, 1]} />
        <meshPhysicalMaterial
          ref={matRef}
          color="#6366f1"
          roughness={0.15}
          metalness={0.95}
          emissive={dark ? '#4338ca' : '#6366f1'}
          emissiveIntensity={dark ? 0.7 : 0.45}
          clearcoat={1}
          clearcoatRoughness={0.05}
          ior={1.6}
        />
      </mesh>
      {/* Pulsing halo — segments to'g'rilangan */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.65, 16, 16]} />
        <meshBasicMaterial
          color="#a78bfa"
          transparent
          opacity={dark ? 0.18 : 0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Outermost aura */}
      <mesh>
        <sphereGeometry args={[1.0, 12, 12]} />
        <meshBasicMaterial
          color="#818cf8"
          transparent
          opacity={dark ? 0.07 : 0.05}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ════════════════════════════════════════════════════════
// NODES — endpoint'lar
// ════════════════════════════════════════════════════════
function Nodes({ dark, animate }: { dark: boolean; animate: boolean }) {
  // Random phases hisoblanadi bir marta
  const phases = useMemo(() => NODES.map((_, i) => (i * 0.37) % (Math.PI * 2)), []);
  const refs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    refs.current.forEach((mesh, i) => {
      if (!mesh) return;
      // Soft pulse — har 3-chi node ko'proq, qolganlar minimal
      const intensity = i % 3 === 0 ? 0.12 : 0.06;
      const pulse = 1 + Math.sin(t * 1.0 + phases[i]) * intensity;
      mesh.scale.set(pulse, pulse, pulse);
    });
  });

  return (
    <group>
      {NODES.map((p, i) => (
        <mesh
          key={i}
          position={p}
          ref={(el) => { refs.current[i] = el; }}
        >
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? '#818cf8' : '#22d3ee'}
            emissive={i % 2 === 0 ? '#6366f1' : '#06b6d4'}
            emissiveIntensity={dark ? 1.6 : 1.2}
            metalness={0.4}
            roughness={0.4}
          />
        </mesh>
      ))}
    </group>
  );
}

// ════════════════════════════════════════════════════════
// EDGES — animated dashed lines (MEMORY LEAK FIXED)
// ════════════════════════════════════════════════════════
function Edges({ dark, animate }: { dark: boolean; animate: boolean }) {
  // Geometry + material faqat BIR MARTA yaratiladi (useMemo)
  const lineObjs = useMemo(() => {
    return EDGES.map(([a, b], i) => {
      const geom = new THREE.BufferGeometry().setFromPoints([NODES[a], NODES[b]]);
      const mat = new THREE.LineDashedMaterial({
        color: i % 2 === 0 ? '#818cf8' : '#22d3ee',
        dashSize: 0.08,
        gapSize: 0.06,
        transparent: true,
        opacity: dark ? 0.5 : 0.38,
      });
      const line = new THREE.Line(geom, mat);
      line.computeLineDistances();
      return line;
    });
    // Note: dark prop change'da regenerate qilmaymiz — opacity material orqali
    // dinamik o'rnatiladi (useEffect orqali pastda)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dark mode o'zgarganda material opacity yangilash
  useEffect(() => {
    lineObjs.forEach((line) => {
      const mat = line.material as THREE.LineDashedMaterial;
      mat.opacity = dark ? 0.5 : 0.38;
      mat.needsUpdate = true;
    });
  }, [dark, lineObjs]);

  // Memory cleanup — komponent unmount bo'lganda geometry/material yo'q qilinadi
  useEffect(() => {
    return () => {
      lineObjs.forEach((line) => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
    };
  }, [lineObjs]);

  // Faqat dashOffset'ni mutatsiya qilamiz — yangi obyekt yaratilmaydi
  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    lineObjs.forEach((line, i) => {
      const mat = line.material as any;
      mat.dashOffset = -t * 0.5 - i * 0.08;
    });
  });

  return (
    <>
      {lineObjs.map((line, i) => (
        <primitive key={i} object={line} />
      ))}
    </>
  );
}

// ════════════════════════════════════════════════════════
// DATA PACKETS — bir tomonga oqayotgan zarralar
// ════════════════════════════════════════════════════════
function DataPackets({ dark, animate }: { dark: boolean; animate: boolean }) {
  const packets = useMemo(() => {
    return EDGES.map((edge, i) => ({
      a: NODES[edge[0]],
      b: NODES[edge[1]],
      phase: (i * 0.13) % 1,
      speed: 0.18 + ((i * 0.05) % 0.15),
      direction: i % 2 === 0 ? 1 : -1, // har boshqa tomonga
      color: i % 2 === 0 ? '#a5b4fc' : '#67e8f9',
    }));
  }, []);

  const refs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    refs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const p = packets[i];
      // Modulo bir tomonga oqim — wraparound
      const u = ((p.direction * t * p.speed + p.phase) % 1 + 1) % 1;
      mesh.position.lerpVectors(p.a, p.b, u);
      const m = mesh.material as THREE.MeshBasicMaterial;
      m.opacity = 0.55 + Math.sin(t * 1.8 + p.phase) * 0.25;
    });
  });

  return (
    <group>
      {packets.map((p, i) => (
        <mesh
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          position={[0, 0, 0]}
        >
          <sphereGeometry args={[0.035, 4, 4]} />
          <meshBasicMaterial
            color={p.color}
            transparent
            opacity={0.7}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ════════════════════════════════════════════════════════
// STAR FIELD — depth fon
// ════════════════════════════════════════════════════════
function StarField({ dark }: { dark: boolean }) {
  const points = useMemo(() => {
    const count = 160;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 8 + Math.random() * 4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const brightness = 0.35 + Math.random() * 0.45;
      colors[i * 3] = brightness;
      colors[i * 3 + 1] = brightness * 0.95;
      colors[i * 3 + 2] = brightness;
    }
    return { positions, colors };
  }, []);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[points.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.03}
        vertexColors
        transparent
        opacity={dark ? 0.6 : 0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// ════════════════════════════════════════════════════════
// ORBITAL ROOT — yagona rotation source (visual rhythm)
// ════════════════════════════════════════════════════════
function OrbitalRoot({ dark, animate, children }: { dark: boolean; animate: boolean; children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!animate) return;
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.04;
    }
  });
  return <group ref={groupRef}>{children}</group>;
}

// ════════════════════════════════════════════════════════
// CAMERA — gentle drift
// ════════════════════════════════════════════════════════
function CameraDrift({ animate }: { animate: boolean }) {
  const { camera } = useThree();
  const base = useRef({ x: 0, y: 0, z: 6.2 });

  useFrame((state) => {
    if (!animate) {
      camera.position.set(0, 0, 6.2);
      camera.lookAt(0, 0, 0);
      return;
    }
    const t = state.clock.elapsedTime;
    camera.position.x = base.current.x + Math.sin(t * 0.06) * 0.4;
    camera.position.y = base.current.y + Math.cos(t * 0.05) * 0.25;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function Scene({ dark, animate }: { dark: boolean; animate: boolean }) {
  return (
    <>
      {/* Fog — light/dark uchun farqli rang */}
      <fog attach="fog" args={[dark ? '#020617' : '#f8fafc', 6, 14]} />

      <ambientLight intensity={dark ? 0.4 : 0.55} />
      {/* Lights — light mode'da ham past intensity, har xil rang yo'q (indigo+cyan) */}
      <pointLight position={[5, 4, 3]} intensity={dark ? 1.4 : 0.7} color={dark ? '#a78bfa' : '#c4b5fd'} />
      <pointLight position={[-4, -3, -3]} intensity={dark ? 1.0 : 0.5} color={dark ? '#22d3ee' : '#a5f3fc'} />
      <pointLight position={[0, 5, 5]} intensity={dark ? 0.7 : 0.35} color={dark ? '#818cf8' : '#c7d2fe'} />

      <CameraDrift animate={animate} />
      <StarField dark={dark} />
      {/* Yagona orbital root — barcha network elementlari birga aylanadi */}
      <OrbitalRoot dark={dark} animate={animate}>
        <Edges dark={dark} animate={animate} />
        <Nodes dark={dark} animate={animate} />
        <DataPackets dark={dark} animate={animate} />
      </OrbitalRoot>
      <CenterHub dark={dark} animate={animate} />
    </>
  );
}

export function Api3dHero({ className, dark = false }: { className?: string; dark?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const animate = !reduced;
  return (
    <div className={className} style={{ width: '100%', height: '100%' }} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 6.2], fov: 50 }}
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
