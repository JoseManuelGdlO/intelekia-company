import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const materialCache = new Map();

/** Material estándar cacheado por color + opciones (se comparte entre meshes). */
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...opts }));
  }
  return materialCache.get(key);
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** PRNG determinista (mulberry32): el mismo agente siempre se ve igual. */
export function seededRandom(seed) {
  let s = seed || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function prep(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Geometrías compartidas: la misma medida se crea una sola vez (no se deben modificar ni liberar).
const geometryCache = new Map();
function cachedGeometry(key, make) {
  if (!geometryCache.has(key)) geometryCache.set(key, make());
  return geometryCache.get(key);
}
const r3 = (n) => Math.round(n * 1000) / 1000;

export function box(w, h, d, material) {
  const geo = cachedGeometry(`box|${r3(w)}|${r3(h)}|${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
  return prep(new THREE.Mesh(geo, material));
}

export function rbox(w, h, d, r, material) {
  const rr = Math.min(r, w / 2, h / 2, d / 2);
  const geo = cachedGeometry(`rbox|${r3(w)}|${r3(h)}|${r3(d)}|${r3(rr)}`, () => new RoundedBoxGeometry(w, h, d, 2, rr));
  return prep(new THREE.Mesh(geo, material));
}

export function cyl(rt, rb, h, material, seg = 20) {
  const geo = cachedGeometry(`cyl|${r3(rt)}|${r3(rb)}|${r3(h)}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  return prep(new THREE.Mesh(geo, material));
}

export function sphere(r, material, ws = 18, hs = 14) {
  const geo = cachedGeometry(`sphere|${r3(r)}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
  return prep(new THREE.Mesh(geo, material));
}

export function capsule(r, len, material) {
  const geo = cachedGeometry(`capsule|${r3(r)}|${r3(len)}`, () => new THREE.CapsuleGeometry(r, len, 4, 12));
  return prep(new THREE.Mesh(geo, material));
}

export function at(obj, x, y, z) {
  obj.position.set(x, y, z);
  return obj;
}

/** Aclara (amt > 0) u oscurece (amt < 0) un color hex en espacio sRGB. */
export function shade(n, amt) {
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255);
}

export function hex(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}

const KNOWN_THEMES = {
  marketing: {
    accent: 0xd9468f,
    wall: 0xf7eef2,
    floor: 0xc79f78,
    sofa: 0x5b4b8a,
    rug: 0xf3c5dc,
    board: 'notes',
    special: 'studio',
  },
  comercial: {
    accent: 0x198f70,
    wall: 0xebf5f3,
    floor: 0xb08968,
    sofa: 0x2f4858,
    rug: 0xc4e6da,
    board: 'chart',
    special: 'sales',
  },
};

KNOWN_THEMES.administracion = {
  accent: 0x2f6fde,
  wall: 0xeef3fb,
  floor: 0xb89b7d,
  sofa: 0x1f3a5f,
  rug: 0xc9d9f3,
  board: 'team',
  special: 'lounge',
};

const FALLBACK_ACCENTS = [0x4f46e5, 0xf08c00, 0x1c7ed6, 0x2f9e44, 0xc2255c, 0x0b7285];

export function themeFor(departmentId, index) {
  if (KNOWN_THEMES[departmentId]) return KNOWN_THEMES[departmentId];
  const accent = FALLBACK_ACCENTS[(hashString(departmentId) + index) % FALLBACK_ACCENTS.length];
  return {
    accent,
    wall: shade(accent, 0.9),
    floor: 0xbfa58a,
    sofa: shade(accent, -0.45),
    rug: shade(accent, 0.7),
    board: 'kanban',
    special: 'lounge',
  };
}
