'use client';

import { Suspense, useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Float } from '@react-three/drei';
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

// ═══════════════════════════════════════════════════════════════
//                    PREMIUM RESIDENTIAL BUILDING
// ═══════════════════════════════════════════════════════════════

// Bino o'lchamlari (umumiy konstanta)
const BUILDING_WIDTH = 2.6;
const BUILDING_DEPTH = 1.9;
const FLOOR_HEIGHT = 0.62;
const LOBBY_HEIGHT = 0.85;

// ─── BIR QAVAT (qatlam) ─────────────────────────────────────
function ResidentialFloor({
  y, fill, isTarget, accent, floorNumber,
}: {
  y: number;
  fill: number;            // 0..1 — qancha yoritilgan
  isTarget: boolean;       // mijoz qavatimi
  accent: string;
  floorNumber: number;     // qavat raqami (1-based)
}) {
  // Qavat rangi va emission — fill ga qarab
  const litColor = isTarget ? accent : '#fef3c7';     // warm yellow window
  const dimColor = '#0a1322';                          // dark off window
  const emissiveIntensity = isTarget ? 1.3 : fill * 0.85;

  // Front + back window grid — har tomonda 5 ta katta deraza
  const WINDOWS = 5;
  const winW = 0.38;
  const winH = 0.42;
  const gap = (BUILDING_WIDTH - WINDOWS * winW) / (WINDOWS + 1);

  // Yon tomonlarda 3 ta deraza
  const SIDE_WINDOWS = 3;
  const sideWinW = 0.32;
  const sideGap = (BUILDING_DEPTH - SIDE_WINDOWS * sideWinW) / (SIDE_WINDOWS + 1);

  return (
    <group position={[0, y, 0]}>
      {/* ─── ASOSIY DEVOR (concrete) — yon ramkalar ─── */}
      {/* Chap concrete pilastri */}
      <mesh castShadow>
        <boxGeometry args={[0.18, FLOOR_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} metalness={0.1} />
      </mesh>
      <mesh position={[-BUILDING_WIDTH / 2 + 0.09, 0, 0]} castShadow>
        <boxGeometry args={[0.18, FLOOR_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} metalness={0.1} />
      </mesh>
      <mesh position={[BUILDING_WIDTH / 2 - 0.09, 0, 0]} castShadow>
        <boxGeometry args={[0.18, FLOOR_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} metalness={0.1} />
      </mesh>

      {/* ─── SHISHA FASAD (front + back) ─── */}
      {[
        { z: BUILDING_DEPTH / 2 + 0.002, rot: 0 },
        { z: -BUILDING_DEPTH / 2 - 0.002, rot: Math.PI },
      ].map(({ z, rot }, side) => (
        <group key={side} position={[0, 0, z]} rotation={[0, rot, 0]}>
          {/* Asosiy shisha panel (qora oyna) */}
          <mesh>
            <planeGeometry args={[BUILDING_WIDTH - 0.36, FLOOR_HEIGHT]} />
            <meshPhysicalMaterial
              color="#0a1322"
              metalness={0.4}
              roughness={0.1}
              clearcoat={1}
              clearcoatRoughness={0}
              emissive={isTarget ? accent : '#000'}
              emissiveIntensity={isTarget ? 0.08 : 0}
            />
          </mesh>

          {/* Derazalar — 5 ta */}
          {Array.from({ length: WINDOWS }).map((_, wx) => {
            const isLit = isTarget || fill > (wx + 0.5) / WINDOWS;
            const partial = !isTarget && fill > wx / WINDOWS && fill < (wx + 1) / WINDOWS;
            return (
              <mesh
                key={wx}
                position={[-BUILDING_WIDTH / 2 + 0.18 + gap + winW / 2 + wx * (winW + gap), 0, 0.001]}
              >
                <planeGeometry args={[winW, winH]} />
                <meshBasicMaterial
                  color={isLit ? litColor : dimColor}
                  transparent
                  opacity={isLit ? 0.96 : 0.55}
                />
              </mesh>
            );
          })}

          {/* Deraza ramkalari (vertical/horizontal mullions) — har deraza orasi */}
          {Array.from({ length: WINDOWS - 1 }).map((_, mx) => (
            <mesh
              key={`m-${mx}`}
              position={[-BUILDING_WIDTH / 2 + 0.18 + gap + winW + mx * (winW + gap) + gap / 2, 0, 0.002]}
            >
              <planeGeometry args={[0.025, winH + 0.05]} />
              <meshBasicMaterial color="#475569" />
            </mesh>
          ))}
        </group>
      ))}

      {/* ─── YON TOMONLAR (chap/o'ng) — 3 ta kichik deraza ─── */}
      {[
        { x: BUILDING_WIDTH / 2 + 0.002, rot: Math.PI / 2 },
        { x: -BUILDING_WIDTH / 2 - 0.002, rot: -Math.PI / 2 },
      ].map(({ x, rot }, side) => (
        <group key={`s-${side}`} position={[x, 0, 0]} rotation={[0, rot, 0]}>
          <mesh>
            <planeGeometry args={[BUILDING_DEPTH - 0.2, FLOOR_HEIGHT]} />
            <meshPhysicalMaterial
              color="#0a1322"
              metalness={0.4}
              roughness={0.1}
              emissive={isTarget ? accent : '#000'}
              emissiveIntensity={isTarget ? 0.05 : 0}
            />
          </mesh>
          {Array.from({ length: SIDE_WINDOWS }).map((_, wx) => {
            const isLit = isTarget || fill > (wx + 0.5) / SIDE_WINDOWS;
            return (
              <mesh
                key={wx}
                position={[-BUILDING_DEPTH / 2 + 0.1 + sideGap + sideWinW / 2 + wx * (sideWinW + sideGap), 0, 0.001]}
              >
                <planeGeometry args={[sideWinW, winH]} />
                <meshBasicMaterial
                  color={isLit ? litColor : dimColor}
                  transparent
                  opacity={isLit ? 0.96 : 0.55}
                />
              </mesh>
            );
          })}
        </group>
      ))}

      {/* ─── BALKON (front, har 2 qavatda bitta) ─── */}
      {floorNumber % 2 === 0 && (
        <group position={[0, -FLOOR_HEIGHT / 2 + 0.04, BUILDING_DEPTH / 2 + 0.18]}>
          {/* Balkon platformasi */}
          <mesh castShadow>
            <boxGeometry args={[BUILDING_WIDTH - 0.4, 0.06, 0.4]} />
            <meshStandardMaterial color="#334155" roughness={0.7} metalness={0.3} />
          </mesh>
          {/* Panjara (railing) — 3 ta vertikal panel */}
          {[-0.7, 0, 0.7].map((dx, i) => (
            <mesh key={i} position={[dx, 0.18, 0.18]}>
              <boxGeometry args={[0.04, 0.32, 0.04]} />
              <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
          {/* Yuqori reyling */}
          <mesh position={[0, 0.35, 0.18]}>
            <boxGeometry args={[BUILDING_WIDTH - 0.45, 0.04, 0.04]} />
            <meshStandardMaterial color="#64748b" metalness={0.9} roughness={0.2} />
          </mesh>
        </group>
      )}

      {/* ─── QAVAT ORASIDAGI PLITA (slab) ─── */}
      <mesh position={[0, FLOOR_HEIGHT / 2 + 0.01, 0]}>
        <boxGeometry args={[BUILDING_WIDTH + 0.05, 0.05, BUILDING_DEPTH + 0.05]} />
        <meshStandardMaterial color="#475569" metalness={0.4} roughness={0.5} />
      </mesh>

      {/* ─── TARGET QAVAT MARKER — halqalar va spotlight ─── */}
      {isTarget && (
        <>
          {/* Asosiy aylanma halqa — bino atrofida */}
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.95, 0.04, 12, 64]} />
            <meshBasicMaterial color={accent} />
          </mesh>
          {/* Tashqi pulsatsiya halqa */}
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[2.25, 0.025, 8, 64]} />
            <meshBasicMaterial color={accent} transparent opacity={0.5} />
          </mesh>
          {/* Eng tashqi yorug' halqa */}
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[2.55, 0.015, 6, 64]} />
            <meshBasicMaterial color={accent} transparent opacity={0.25} />
          </mesh>
          {/* Yon tarafda yorqin sphere */}
          <Float speed={1.5} rotationIntensity={0} floatIntensity={0.15}>
            <mesh position={[2.5, 0, 0]}>
              <sphereGeometry args={[0.11, 16, 16]} />
              <meshBasicMaterial color={accent} />
            </mesh>
            <mesh position={[2.5, 0, 0]}>
              <sphereGeometry args={[0.22, 16, 16]} />
              <meshBasicMaterial color={accent} transparent opacity={0.35} />
            </mesh>
          </Float>
        </>
      )}
    </group>
  );
}

// ─── PASTKI QAVAT (LOBBY) — kirish, eshik, sign ────────────
function GroundLobby({ accent }: { accent: string }) {
  return (
    <group position={[0, LOBBY_HEIGHT / 2 - 0.05, 0]}>
      {/* Pastki concrete asos */}
      <mesh castShadow>
        <boxGeometry args={[BUILDING_WIDTH + 0.15, LOBBY_HEIGHT, BUILDING_DEPTH + 0.15]} />
        <meshStandardMaterial color="#1e293b" roughness={0.85} metalness={0.15} />
      </mesh>

      {/* Front facade — kirish */}
      <group position={[0, 0, (BUILDING_DEPTH + 0.15) / 2 + 0.005]}>
        {/* Asosiy oyna devor */}
        <mesh>
          <planeGeometry args={[BUILDING_WIDTH, LOBBY_HEIGHT - 0.1]} />
          <meshPhysicalMaterial
            color="#0a1322"
            metalness={0.5}
            roughness={0.1}
            emissive="#fef3c7"
            emissiveIntensity={0.15}
          />
        </mesh>

        {/* Kirish eshigi (yorug' to'rtburchak) — lobby interyer chiroyi */}
        <mesh position={[0, -0.1, 0.001]}>
          <planeGeometry args={[0.6, 0.55]} />
          <meshBasicMaterial color="#fef3c7" />
        </mesh>

        {/* Eshik ramkasi */}
        <mesh position={[0, -0.1, 0.003]}>
          <planeGeometry args={[0.04, 0.6]} />
          <meshBasicMaterial color={accent} />
        </mesh>

        {/* Yorqin chiziq — kirish ustida (LED strip) */}
        <mesh position={[0, 0.28, 0.002]}>
          <planeGeometry args={[BUILDING_WIDTH - 0.3, 0.025]} />
          <meshBasicMaterial color={accent} />
        </mesh>
      </group>

      {/* Kirish ustidagi kichik kozyorek */}
      <mesh position={[0, LOBBY_HEIGHT / 2 - 0.05, (BUILDING_DEPTH + 0.15) / 2 + 0.18]} castShadow>
        <boxGeometry args={[BUILDING_WIDTH - 0.2, 0.06, 0.4]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.4} />
      </mesh>
    </group>
  );
}

// ─── TOM (ROOF) — parapet + AC unitlar + antenna ───────────
function Roof({ accent, totalFloors }: { accent: string; totalFloors: number }) {
  const roofY = LOBBY_HEIGHT + totalFloors * FLOOR_HEIGHT;
  return (
    <group position={[0, roofY, 0]}>
      {/* Parapet devori (atrofida) */}
      <mesh position={[0, 0.15, BUILDING_DEPTH / 2 - 0.02]} castShadow>
        <boxGeometry args={[BUILDING_WIDTH, 0.3, 0.05]} />
        <meshStandardMaterial color="#334155" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.15, -BUILDING_DEPTH / 2 + 0.02]} castShadow>
        <boxGeometry args={[BUILDING_WIDTH, 0.3, 0.05]} />
        <meshStandardMaterial color="#334155" roughness={0.8} />
      </mesh>
      <mesh position={[BUILDING_WIDTH / 2 - 0.02, 0.15, 0]} castShadow>
        <boxGeometry args={[0.05, 0.3, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#334155" roughness={0.8} />
      </mesh>
      <mesh position={[-BUILDING_WIDTH / 2 + 0.02, 0.15, 0]} castShadow>
        <boxGeometry args={[0.05, 0.3, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#334155" roughness={0.8} />
      </mesh>

      {/* Tom yuzasi */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[BUILDING_WIDTH - 0.05, 0.04, BUILDING_DEPTH - 0.05]} />
        <meshStandardMaterial color="#1e293b" roughness={0.9} />
      </mesh>

      {/* AC unitlar (2 ta) */}
      <mesh position={[-0.7, 0.18, 0.4]} castShadow>
        <boxGeometry args={[0.45, 0.32, 0.35]} />
        <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0.6, 0.16, -0.3]} castShadow>
        <boxGeometry args={[0.38, 0.28, 0.3]} />
        <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.4} />
      </mesh>

      {/* Antenna asosi */}
      <mesh position={[0.9, 0.12, 0.5]}>
        <boxGeometry args={[0.12, 0.2, 0.12]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.5} />
      </mesh>
      {/* Antenna pilon */}
      <mesh position={[0.9, 0.65, 0.5]}>
        <cylinderGeometry args={[0.015, 0.015, 0.9]} />
        <meshStandardMaterial color="#94a3b8" metalness={1} roughness={0.3} />
      </mesh>
      {/* Antenna pichoq */}
      <mesh position={[0.9, 1.0, 0.5]}>
        <boxGeometry args={[0.25, 0.02, 0.02]} />
        <meshStandardMaterial color="#94a3b8" metalness={1} />
      </mesh>
      {/* Pulsatsiya qiluvchi qizil chiroq */}
      <mesh position={[0.9, 1.15, 0.5]}>
        <sphereGeometry args={[0.05]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      <mesh position={[0.9, 1.15, 0.5]}>
        <sphereGeometry args={[0.1]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.3} />
      </mesh>

      {/* Yon panjarali to'siq (yon balkonlar) */}
      <mesh position={[-0.5, 0.32, 0.6]}>
        <boxGeometry args={[0.4, 0.02, 0.02]} />
        <meshStandardMaterial color="#64748b" metalness={0.8} />
      </mesh>

      {/* Tomda yorqin top sphere — progress ko'rsatkichi */}
      <Float speed={2} rotationIntensity={0} floatIntensity={0.45}>
        <mesh position={[0, 1.6, 0]}>
          <sphereGeometry args={[0.15, 24, 24]} />
          <meshBasicMaterial color={accent} />
        </mesh>
        <mesh position={[0, 1.6, 0]}>
          <sphereGeometry args={[0.28, 24, 24]} />
          <meshBasicMaterial color={accent} transparent opacity={0.3} />
        </mesh>
        <mesh position={[0, 1.6, 0]}>
          <sphereGeometry args={[0.45, 24, 24]} />
          <meshBasicMaterial color={accent} transparent opacity={0.12} />
        </mesh>
      </Float>
    </group>
  );
}

// ─── ASOSIY BINO ─────────────────────────────────────────
function Building({
  progress, accent, totalFloors, targetFloor,
}: {
  progress: number;
  accent: string;
  totalFloors: number;
  targetFloor: number | null;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const FLOORS = Math.max(3, Math.min(20, totalFloors));

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.0015;
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

  const targetIdx = targetFloor ? targetFloor - 1 : -1;

  return (
    <group ref={groupRef} position={[0, -1.5, 0]}>
      {/* Lobby (kirish) */}
      <GroundLobby accent={accent} />

      {/* Qavatlar — lobby ustida */}
      {Array.from({ length: FLOORS }).map((_, i) => {
        const y = LOBBY_HEIGHT + 0.05 + i * FLOOR_HEIGHT + FLOOR_HEIGHT / 2;
        return (
          <ResidentialFloor
            key={i}
            y={y}
            fill={floorFills[i]}
            isTarget={i === targetIdx}
            accent={accent}
            floorNumber={i + 1}
          />
        );
      })}

      {/* Tom */}
      <Roof accent={accent} totalFloors={FLOORS} />

      {/* Pastdan tepa light beam — fill progress */}
      <pointLight
        position={[0, LOBBY_HEIGHT + (progress / 100) * FLOORS * FLOOR_HEIGHT, 0]}
        intensity={2}
        color={accent}
        distance={6}
      />

      {/* Target qavat uchun maxsus spot light */}
      {targetIdx >= 0 && (
        <>
          <pointLight
            position={[2.2, LOBBY_HEIGHT + targetIdx * FLOOR_HEIGHT + FLOOR_HEIGHT / 2, 0]}
            intensity={3}
            color={accent}
            distance={4}
          />
          <pointLight
            position={[-2.2, LOBBY_HEIGHT + targetIdx * FLOOR_HEIGHT + FLOOR_HEIGHT / 2, 0]}
            intensity={3}
            color={accent}
            distance={4}
          />
        </>
      )}
    </group>
  );
}

// ─── ATROF MUHIT: ER + TROTUAR ─────────────────────────────
function Ground() {
  return (
    <group position={[0, -1.55, 0]}>
      {/* Asosiy diskli platforma */}
      <mesh receiveShadow>
        <cylinderGeometry args={[5.5, 5.7, 0.15, 64]} />
        <meshStandardMaterial color="#0a1322" roughness={0.95} metalness={0.05} />
      </mesh>
      {/* Yuqori plyonka — toshlar imitatsiyasi */}
      <mesh position={[0, 0.08, 0]} receiveShadow>
        <cylinderGeometry args={[5.4, 5.4, 0.02, 64]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.1} />
      </mesh>
      {/* Yorug' halqa — er chetida */}
      <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[5.3, 5.4, 64]} />
        <meshBasicMaterial color="#334155" transparent opacity={0.5} />
      </mesh>
      {/* Markaziy plitka — bino tagida */}
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <boxGeometry args={[BUILDING_WIDTH + 1, 0.02, BUILDING_DEPTH + 1]} />
        <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.2} />
      </mesh>
      {/* Trotuar liniyalari */}
      {[-2, -1, 1, 2].map((x, i) => (
        <mesh key={i} position={[x * 0.6, 0.11, 2.5]}>
          <planeGeometry args={[0.05, 0.6]} />
          <meshBasicMaterial color="#475569" />
        </mesh>
      ))}
    </group>
  );
}

// ─── KO'CHA CHIROQLARI ─────────────────────────────────────
function StreetLamps() {
  // 4 ta chiroq — binoga simmetrik
  const lamps = [
    { pos: [3.5, 0, 2.5] as [number, number, number] },
    { pos: [-3.5, 0, 2.5] as [number, number, number] },
    { pos: [3.5, 0, -2.5] as [number, number, number] },
    { pos: [-3.5, 0, -2.5] as [number, number, number] },
  ];
  return (
    <>
      {lamps.map((lamp, i) => (
        <group key={i} position={[lamp.pos[0], -1.5, lamp.pos[2]]}>
          {/* Asos */}
          <mesh>
            <cylinderGeometry args={[0.1, 0.15, 0.15]} />
            <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.5} />
          </mesh>
          {/* Pilon */}
          <mesh position={[0, 0.85, 0]}>
            <cylinderGeometry args={[0.04, 0.05, 1.7]} />
            <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* Eg'rilik — yuqori qism */}
          <mesh position={[0, 1.75, 0]} rotation={[0, 0, Math.PI / 6]}>
            <cylinderGeometry args={[0.035, 0.045, 0.3]} />
            <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* Chiroq sharcha */}
          <mesh position={[0.1, 1.85, 0]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshBasicMaterial color="#fef3c7" />
          </mesh>
          {/* Chiroq glow */}
          <mesh position={[0.1, 1.85, 0]}>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshBasicMaterial color="#fef3c7" transparent opacity={0.3} />
          </mesh>
          {/* Real point light — soyalar uchun */}
          <pointLight position={[0.1, 1.85, 0]} intensity={1.2} color="#fbbf24" distance={4} decay={1.5} />
        </group>
      ))}
    </>
  );
}

// ─── DARAXTLAR (atrof) ──────────────────────────────────────
function Trees() {
  // 6 ta daraxt — atrofda
  const trees = [
    { pos: [4.2, -1.5, 1.2] as [number, number, number], scale: 1.0 },
    { pos: [-4.2, -1.5, 1.2] as [number, number, number], scale: 1.1 },
    { pos: [4.2, -1.5, -1.2] as [number, number, number], scale: 0.9 },
    { pos: [-4.2, -1.5, -1.2] as [number, number, number], scale: 1.05 },
    { pos: [2.8, -1.5, 3.8] as [number, number, number], scale: 0.85 },
    { pos: [-2.8, -1.5, 3.8] as [number, number, number], scale: 0.95 },
  ];
  return (
    <>
      {trees.map((t, i) => (
        <group key={i} position={t.pos} scale={t.scale}>
          {/* Tana (trunk) */}
          <mesh castShadow>
            <cylinderGeometry args={[0.06, 0.08, 0.5]} />
            <meshStandardMaterial color="#3f2a1d" roughness={0.95} />
          </mesh>
          {/* Yuqori barglar (konus) */}
          <mesh position={[0, 0.7, 0]} castShadow>
            <coneGeometry args={[0.4, 0.8, 8]} />
            <meshStandardMaterial color="#15803d" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.95, 0]} castShadow>
            <coneGeometry args={[0.3, 0.6, 8]} />
            <meshStandardMaterial color="#16a34a" roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.15, 0]} castShadow>
            <coneGeometry args={[0.2, 0.4, 8]} />
            <meshStandardMaterial color="#22c55e" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ─── YULDUZLAR (sky) ────────────────────────────────────────
function Starfield() {
  const positions = useMemo(() => {
    const arr = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      // Hemisphere ustida tarqalgan
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random()) - 0.1; // ustki yarmida
      const r = 18 + Math.random() * 4;
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.cos(phi) + 2;
      arr[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    return arr;
  }, []);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.08} color="#e0e7ff" transparent opacity={0.85} sizeAttenuation />
    </points>
  );
}

// ─── AURORA — tepada chiroyli rangli plyonka ────────────────
function Aurora() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) {
      const t = state.clock.elapsedTime;
      ref.current.rotation.z = Math.sin(t * 0.1) * 0.1;
    }
  });
  return (
    <group position={[0, 8, -8]}>
      <mesh ref={ref}>
        <planeGeometry args={[20, 4]} />
        <meshBasicMaterial
          color="#6366f1"
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh position={[0, -1.5, 0]}>
        <planeGeometry args={[16, 2.5]} />
        <meshBasicMaterial
          color="#a855f7"
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

// ─── OY (moon) ──────────────────────────────────────────────
function Moon() {
  return (
    <group position={[-7, 7, -10]}>
      <mesh>
        <sphereGeometry args={[0.7, 32, 32]} />
        <meshBasicMaterial color="#f1f5f9" />
      </mesh>
      {/* Glow */}
      <mesh>
        <sphereGeometry args={[1.1, 32, 32]} />
        <meshBasicMaterial color="#e0e7ff" transparent opacity={0.25} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.6, 32, 32]} />
        <meshBasicMaterial color="#c7d2fe" transparent opacity={0.1} />
      </mesh>
    </group>
  );
}

// ─── PUL ZARRACHALARI (uchayotgan tangalar) ────────────────
function MoneyParticles({ enabled, accent }: { enabled: boolean; accent: string }) {
  const ref = useRef<THREE.Points>(null);
  const count = 60;

  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 3;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = Math.random() * 7 - 1.5;
      positions[i * 3 + 2] = Math.sin(angle) * r;
      velocities[i * 3 + 1] = 0.004 + Math.random() * 0.012;
    }
    return { positions, velocities };
  }, []);

  useFrame(() => {
    if (!enabled || !ref.current) return;
    const pos = ref.current.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const y = pos.getY(i) + velocities[i * 3 + 1];
      pos.setY(i, y > 8 ? -1.5 : y);
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.09} color={accent} transparent opacity={0.85} sizeAttenuation blending={THREE.AdditiveBlending} />
    </points>
  );
}

// ─── ASOSIY SCENE — premium kechki muhit ─────────────────
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
      {/* ─── KECHKI LIGHTING ─── */}
      {/* Hemispherelight — yumshoq ko'k osmondan, qora yerdan reflection */}
      <hemisphereLight args={['#1e3a8a', '#020617', 0.55]} />

      {/* Asosiy moonlight — yuqoridan sovuq oq nur */}
      <directionalLight
        position={[-8, 12, -6]}
        intensity={1.2}
        color="#dbeafe"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {/* Yumshoq ko'k fill light — orqadan */}
      <directionalLight position={[5, 5, -8]} intensity={0.4} color="#818cf8" />

      {/* Accent rang light — yon tarafdan, mood */}
      <pointLight position={[-6, 3, 4]} intensity={1.5} color="#818cf8" distance={15} />
      <pointLight position={[6, 2, -4]} intensity={1.2} color="#f472b6" distance={15} />

      {/* Pastdan yumshoq violet glow — bino fundament accent */}
      <pointLight position={[0, -1, 0]} intensity={0.8} color="#7c3aed" distance={8} />

      {/* ─── MUHIT ELEMENTLARI ─── */}
      <Starfield />
      <Moon />
      <Aurora />
      <Ground />
      <Trees />
      <StreetLamps />

      {/* ─── ASOSIY OBYEKT ─── */}
      <Building progress={progress} accent={accent} totalFloors={totalFloors} targetFloor={targetFloor} />
      <MoneyParticles enabled={progress > 0} accent={accent} />

      {/* ─── KAMERA NAZORATI ─── */}
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={7}
        maxDistance={18}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.05}
        autoRotate={false}
        dampingFactor={0.08}
        enableDamping
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
                      camera={{ position: [10, 5, 10], fov: 42 }}
                      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
                      dpr={[1, 2]}
                    >
                      {/* Gradient sky background — kechki ko'k */}
                      <color attach="background" args={['#0a0e1a']} />
                      <fog attach="fog" args={['#0a0e1a', 14, 28]} />
                      <Suspense fallback={null}>
                        <Scene
                          progress={animatedProgress}
                          accent={accent}
                          totalFloors={totalFloors}
                          targetFloor={apt?.floor || null}
                        />
                      </Suspense>
                    </Canvas>

                    {/* HTML overlay — progress raqami (3D Text o'rniga, worker xato yo'q) */}
                    <div className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-none">
                      <div
                        className="text-4xl font-black tracking-tight tabular-nums drop-shadow-2xl"
                        style={{
                          color: accent,
                          textShadow: `0 0 20px ${accent}80, 0 2px 6px rgba(0,0,0,0.6)`,
                        }}
                      >
                        {Math.round(animatedProgress)}%
                      </div>
                    </div>

                    {/* HTML overlay — target qavat label */}
                    {apt?.floor != null && (
                      <div
                        className="absolute top-1/2 right-8 -translate-y-1/2 pointer-events-none flex items-center gap-2"
                      >
                        <div
                          className="px-3 py-1.5 rounded-full backdrop-blur-md ring-1 font-bold text-[12px] flex items-center gap-1.5"
                          style={{
                            background: `${accent}22`,
                            borderColor: `${accent}80`,
                            color: accent,
                          }}
                        >
                          <span className="text-[14px]">⬆</span>
                          {apt.floor}-qavat
                          {apt.aptNumber && <span className="text-white/70 font-normal">· №{apt.aptNumber}</span>}
                        </div>
                      </div>
                    )}

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
