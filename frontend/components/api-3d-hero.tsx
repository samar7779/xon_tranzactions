'use client';

import { Suspense, useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * API hero — network/constellation 3D vizualizatsiya.
 * Markaziy hub + orbital nodelar + edges (connections) + traveling data packets.
 * Cloudflare/Vercel uslubidagi pro dizayn.
 */

// ─── HELPER: Fibonacci sphere ─── (uniform distribution on sphere)
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
const EDGE_PER_NODE = 3; // har node 3 yaqin qo'shni bilan ulanadi
const NODE_RADIUS = 2.6;

// Generate once
const NODES = fibonacciSphere(NODE_COUNT, NODE_RADIUS);

// Build edges (closest neighbors)
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

// ─── CENTER HUB ─── (markaziy element)
function CenterHub({ dark }: { dark: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (meshRef.current) {
      meshRef.current.rotation.x += delta * 0.18;
      meshRef.current.rotation.y += delta * 0.24;
    }
    if (glowRef.current) {
      const s = 1 + Math.sin(t * 1.2) * 0.06;
      glowRef.current.scale.set(s, s, s);
    }
    if (matRef.current) {
      const hue = 0.66 + Math.sin(t * 0.2) * 0.04; // indigo→violet drift
      matRef.current.color.setHSL(hue, 0.7, dark ? 0.55 : 0.6);
      matRef.current.emissive.setHSL(hue, 0.9, 0.3);
    }
  });

  return (
    <group>
      {/* Inner solid hub — octahedron uchun zamonaviy ko'rinish */}
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[0.42, 1]} />
        <meshPhysicalMaterial
          ref={matRef}
          color="#6366f1"
          roughness={0.15}
          metalness={0.95}
          emissive="#4338ca"
          emissiveIntensity={0.7}
          clearcoat={1}
          clearcoatRoughness={0.05}
          ior={1.6}
        />
      </mesh>
      {/* Outer pulsing halo */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.65, 32, 32]} />
        <meshBasicMaterial
          color="#a78bfa"
          transparent
          opacity={dark ? 0.18 : 0.14}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Outermost subtle aura */}
      <mesh>
        <sphereGeometry args={[1.0, 24, 24]} />
        <meshBasicMaterial
          color="#7c3aed"
          transparent
          opacity={dark ? 0.07 : 0.05}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ─── NODES ─── (each node has its own pulse phase)
function Nodes({ dark }: { dark: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const phases = useMemo(() => NODES.map(() => Math.random() * Math.PI * 2), []);
  const refs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) groupRef.current.rotation.y = t * 0.04;
    refs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const pulse = 1 + Math.sin(t * 1.5 + phases[i]) * 0.25;
      mesh.scale.set(pulse, pulse, pulse);
    });
  });

  return (
    <group ref={groupRef}>
      {NODES.map((p, i) => (
        <mesh
          key={i}
          position={p}
          ref={(el) => { refs.current[i] = el; }}
        >
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshStandardMaterial
            color={i % 3 === 0 ? '#22d3ee' : i % 3 === 1 ? '#a78bfa' : '#f472b6'}
            emissive={i % 3 === 0 ? '#06b6d4' : i % 3 === 1 ? '#7c3aed' : '#e11d48'}
            emissiveIntensity={dark ? 1.8 : 1.4}
            metalness={0.4}
            roughness={0.4}
          />
        </mesh>
      ))}
    </group>
  );
}

// ─── EDGES ─── (animated dashed lines)
function Edges({ dark }: { dark: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const lineRefs = useRef<(THREE.Line | null)[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) groupRef.current.rotation.y = t * 0.04;
    lineRefs.current.forEach((line, i) => {
      if (!line) return;
      const mat = line.material as any; // dashOffset Three.js'da bor lekin type'da yo'q
      // Dash offset — animatsiya (data flow effekti)
      mat.dashOffset = -t * 0.5 - i * 0.1;
    });
  });

  return (
    <group ref={groupRef}>
      {EDGES.map(([a, b], i) => {
        const points = [NODES[a], NODES[b]];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineDashedMaterial({
          color: i % 2 === 0 ? '#8b5cf6' : '#22d3ee',
          dashSize: 0.08,
          gapSize: 0.06,
          opacity: dark ? 0.55 : 0.42,
          transparent: true,
        });
        return (
          <primitive
            key={i}
            ref={(el: any) => { lineRefs.current[i] = el; }}
            object={(() => {
              const line = new THREE.Line(geom, mat);
              line.computeLineDistances();
              return line;
            })()}
          />
        );
      })}
    </group>
  );
}

// ─── DATA PACKETS ─── (small spheres traveling along edges)
function DataPackets({ dark }: { dark: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  // Har edge bo'ylab 1 ta paket, har biri o'z fazasida
  const packets = useMemo(() => {
    return EDGES.map((edge, i) => ({
      edgeIdx: i,
      a: NODES[edge[0]],
      b: NODES[edge[1]],
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.5,
      color: i % 4 === 0 ? '#22d3ee' : i % 4 === 1 ? '#a78bfa' : i % 4 === 2 ? '#f472b6' : '#fbbf24',
    }));
  }, []);

  const refs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) groupRef.current.rotation.y = t * 0.04;
    refs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const p = packets[i];
      // 0..1 lerp — sin orqali oldinga/orqaga
      const u = (Math.sin(t * p.speed + p.phase) + 1) / 2;
      mesh.position.lerpVectors(p.a, p.b, u);
      // Pulsing opacity
      const m = mesh.material as THREE.MeshBasicMaterial;
      m.opacity = 0.6 + Math.sin(t * 2 + p.phase) * 0.3;
    });
  });

  return (
    <group ref={groupRef}>
      {packets.map((p, i) => (
        <mesh
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          position={[0, 0, 0]}
        >
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshBasicMaterial
            color={p.color}
            transparent
            opacity={0.8}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ─── BACKGROUND STAR FIELD ─── (depth context)
function StarField({ dark }: { dark: boolean }) {
  const points = useMemo(() => {
    const count = 200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 8 + Math.random() * 4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const brightness = 0.3 + Math.random() * 0.5;
      colors[i * 3] = brightness;
      colors[i * 3 + 1] = brightness;
      colors[i * 3 + 2] = brightness * (0.8 + Math.random() * 0.2);
    }
    return { positions, colors };
  }, []);

  const ref = useRef<THREE.Points>(null);

  useFrame((state, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.01;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[points.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.03}
        vertexColors
        transparent
        opacity={dark ? 0.7 : 0.4}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// ─── CAMERA GENTLE DRIFT ─── (parallax)
function CameraDrift() {
  const { camera } = useThree();
  const base = useRef({ x: 0, y: 0, z: 6.2 });

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    camera.position.x = base.current.x + Math.sin(t * 0.12) * 0.5;
    camera.position.y = base.current.y + Math.cos(t * 0.1) * 0.35;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function Scene({ dark }: { dark: boolean }) {
  return (
    <>
      {/* Subtle fog for depth — only dark */}
      {dark && <fog attach="fog" args={['#0f172a', 5, 12]} />}

      <ambientLight intensity={dark ? 0.4 : 0.55} />
      <pointLight position={[5, 4, 3]} intensity={1.6} color="#a78bfa" />
      <pointLight position={[-4, -3, -3]} intensity={1.2} color="#22d3ee" />
      <pointLight position={[0, 5, 5]} intensity={0.9} color="#f472b6" />

      <CameraDrift />
      <StarField dark={dark} />
      <Edges dark={dark} />
      <Nodes dark={dark} />
      <DataPackets dark={dark} />
      <CenterHub dark={dark} />
    </>
  );
}

export function Api3dHero({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [0, 0, 6.2], fov: 50 }}
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
