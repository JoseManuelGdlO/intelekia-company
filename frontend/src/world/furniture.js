import * as THREE from 'three';
import { mat, box, rbox, cyl, sphere, at, pick, shade } from './materials.js';
import { BRAND } from './brand.js';
import { iconTexture, logoPanelTexture } from './textures.js';

let iconDecalMaterial = null;
/** Calcomanía con el ícono de Intelekia (material compartido). */
export function createLogoDecal(size) {
  if (!iconDecalMaterial) {
    iconDecalMaterial = new THREE.MeshStandardMaterial({ map: iconTexture(BRAND.green), transparent: true, roughness: 0.5, depthWrite: false });
  }
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(size, size), iconDecalMaterial);
  decal.renderOrder = 1;
  return decal;
}

const WOOD_LIGHT = 0xd8b88f;
const WOOD_DARK = 0x8a5a3b;
const METAL = 0x3a3f47;
const WHITE = 0xf2f2f0;
const MUG_COLORS = [0xffffff, 0x198f70, 0x06212c, 0x198f70, 0xf4a261, 0xffffff];

/**
 * Escritorio con monitor, teclado, mouse y objetos personales.
 * Origen: centro del escritorio a nivel de piso. La persona se sienta del lado -z.
 */
export function createDesk({ rng, accent, screen }) {
  const g = new THREE.Group();
  const top = rbox(1.4, 0.05, 0.7, 0.015, mat(WOOD_LIGHT, { roughness: 0.55 }));
  g.add(at(top, 0, 0.72, 0));
  [-0.65, 0.65].forEach((x) => {
    [-0.3, 0.3].forEach((z) => g.add(at(cyl(0.025, 0.025, 0.7, mat(METAL, { metalness: 0.6, roughness: 0.4 }), 10), x, 0.35, z)));
  });
  g.add(at(box(1.3, 0.42, 0.02, mat(0xf4f6f5)), 0, 0.46, 0.31));
  g.add(at(box(1.3, 0.04, 0.022, mat(accent)), 0, 0.27, 0.311));
  g.add(at(createLogoDecal(0.26), 0, 0.48, 0.322));

  // Monitor (pantalla mira hacia la persona: -z)
  g.add(at(rbox(0.22, 0.015, 0.15, 0.006, mat(METAL)), 0, 0.753, 0.14));
  g.add(at(box(0.04, 0.26, 0.03, mat(METAL)), 0, 0.88, 0.18));
  g.add(at(rbox(0.66, 0.4, 0.035, 0.012, mat(0x1d1f24, { roughness: 0.4 })), 0, 1.08, 0.16));
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.36), screen.material);
  screenMesh.rotation.y = Math.PI;
  g.add(at(screenMesh, 0, 1.08, 0.141));
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0x888888, toneMapped: false }));
  g.add(at(led, 0, 1.08, 0.18));

  // Teclado y mouse
  g.add(at(rbox(0.45, 0.02, 0.15, 0.008, mat(0x2b2d33)), 0, 0.755, -0.17));
  g.add(at(rbox(0.38, 0.006, 0.1, 0.003, mat(0x50545e)), 0, 0.768, -0.17));
  g.add(at(rbox(0.06, 0.025, 0.1, 0.012, mat(0x2b2d33)), 0.34, 0.757, -0.15));

  // Taza de café
  const mug = new THREE.Group();
  const mugMat = mat(pick(rng, MUG_COLORS), { roughness: 0.35 });
  mug.add(at(cyl(0.04, 0.036, 0.09, mugMat, 16), 0, 0.045, 0));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 16), mugMat);
  handle.position.set(0.045, 0.05, 0);
  mug.add(handle);
  g.add(at(mug, -0.52, 0.745, -0.08));

  // Objetos variables por persona
  const extras = ['plant', 'papers', 'frame', 'pencils', 'books'];
  const chosen = new Set([pick(rng, extras), pick(rng, extras)]);
  if (chosen.has('plant')) {
    g.add(at(cyl(0.05, 0.04, 0.08, mat(0xf4f1ea), 14), 0.55, 0.785, 0.2));
    const leaves = sphere(0.075, mat(0x4c9a5a), 10, 8);
    leaves.scale.set(1, 1.2, 1);
    g.add(at(leaves, 0.55, 0.88, 0.2));
  }
  if (chosen.has('papers')) {
    const p = box(0.21, 0.01, 0.29, mat(0xfafafa));
    p.rotation.y = (rng() - 0.5) * 0.6;
    g.add(at(p, -0.38, 0.75, 0.12));
  }
  if (chosen.has('frame')) {
    const f = box(0.12, 0.15, 0.015, mat(WOOD_DARK));
    f.rotation.x = -0.2;
    f.rotation.y = Math.PI + 0.4;
    g.add(at(f, -0.55, 0.83, 0.18));
  }
  if (chosen.has('pencils')) {
    g.add(at(cyl(0.035, 0.035, 0.1, mat(accent), 12), 0.55, 0.795, -0.05));
    [0xe63946, 0xffb703, 0x219ebc].forEach((col, i) => {
      const pen = cyl(0.006, 0.006, 0.16, mat(col), 6);
      pen.rotation.z = (i - 1) * 0.2;
      g.add(at(pen, 0.55 + (i - 1) * 0.012, 0.85, -0.05));
    });
  }
  if (chosen.has('books')) {
    [0x264653, 0xe76f51, 0xe9c46a].forEach((col, i) => {
      g.add(at(box(0.22, 0.035, 0.16, mat(col)), 0.4, 0.765 + i * 0.036, 0.2));
    });
  }
  return { group: g, led };
}

/** Silla de oficina con ruedas. Origen: centro del asiento a nivel de piso. */
export function createChair(accent) {
  const g = new THREE.Group();
  const cushion = mat(shade(accent, -0.35), { roughness: 0.85 });
  const dark = mat(0x26282d, { roughness: 0.5 });
  g.add(at(rbox(0.5, 0.08, 0.48, 0.035, cushion), 0, 0.38, 0));
  g.add(at(rbox(0.46, 0.52, 0.07, 0.035, cushion), 0, 0.74, -0.26));
  g.add(at(box(0.05, 0.3, 0.04, dark), 0, 0.5, -0.24));
  g.add(at(cyl(0.03, 0.03, 0.28, dark, 10), 0, 0.2, 0));
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    const leg = box(0.28, 0.03, 0.04, dark);
    leg.rotation.y = a;
    g.add(at(leg, Math.cos(a) * 0.13, 0.06, -Math.sin(a) * 0.13));
    g.add(at(sphere(0.03, dark, 8, 6), Math.cos(a) * 0.26, 0.03, -Math.sin(a) * 0.26));
  }
  return g;
}

/** Planta en maceta con hojas que se mecen. */
export function createPlant(rng, scale = 1) {
  const g = new THREE.Group();
  const potColors = [0xc8693f, 0xf1ede4, 0x2f3437, 0xd9c7a7];
  g.add(at(cyl(0.2, 0.15, 0.35, mat(pick(rng, potColors), { roughness: 0.6 })), 0, 0.175, 0));
  g.add(at(cyl(0.19, 0.19, 0.02, mat(0x4a3423)), 0, 0.34, 0));
  const foliage = new THREE.Group();
  foliage.position.y = 0.34;
  g.add(foliage);
  const greens = [0x3f8f4f, 0x2f7a43, 0x5aa65f, 0x4b8b3b];
  const kind = pick(rng, ['bush', 'snake', 'palm']);
  if (kind === 'bush') {
    for (let i = 0; i < 9; i += 1) {
      const s = sphere(0.14 + rng() * 0.08, mat(pick(rng, greens), { roughness: 0.8 }), 10, 8);
      at(s, (rng() - 0.5) * 0.3, 0.2 + rng() * 0.45, (rng() - 0.5) * 0.3);
      foliage.add(s);
    }
  } else if (kind === 'snake') {
    for (let i = 0; i < 9; i += 1) {
      const h = 0.5 + rng() * 0.45;
      const leaf = box(0.07, h, 0.015, mat(pick(rng, greens), { roughness: 0.7 }));
      leaf.position.set((rng() - 0.5) * 0.22, h / 2, (rng() - 0.5) * 0.22);
      leaf.rotation.set((rng() - 0.5) * 0.3, rng() * Math.PI, (rng() - 0.5) * 0.3);
      foliage.add(leaf);
    }
  } else {
    foliage.add(at(cyl(0.025, 0.035, 0.6, mat(0x6b4f2a), 8), 0, 0.3, 0));
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const leaf = sphere(0.22, mat(pick(rng, greens), { roughness: 0.75 }), 10, 6);
      leaf.scale.set(0.35, 0.08, 1);
      const holder = new THREE.Group();
      holder.position.y = 0.6;
      holder.rotation.y = a;
      leaf.position.z = 0.2;
      leaf.rotation.x = 0.45;
      holder.add(leaf);
      foliage.add(holder);
    }
  }
  g.scale.setScalar(scale);
  const phase = rng() * Math.PI * 2;
  return {
    group: g,
    update: (t) => {
      foliage.rotation.z = Math.sin(t * 0.8 + phase) * 0.03;
      foliage.rotation.x = Math.cos(t * 0.6 + phase) * 0.02;
    },
  };
}

export function createBookshelf(rng, accent) {
  const g = new THREE.Group();
  const wood = mat(WOOD_DARK, { roughness: 0.6 });
  const W = 1.2;
  const H = 1.9;
  const D = 0.35;
  g.add(at(box(0.04, H, D, wood), -W / 2, H / 2, 0));
  g.add(at(box(0.04, H, D, wood), W / 2, H / 2, 0));
  g.add(at(box(W, H, 0.02, mat(shade(WOOD_DARK, -0.2))), 0, H / 2, -D / 2));
  const colors = [0x264653, 0x2a9d8f, 0xe9c46a, 0xf4a261, 0xe76f51, 0x6d597a, 0x355070, accent, 0xf1faee];
  for (let s = 0; s < 5; s += 1) {
    const y = 0.02 + s * 0.45;
    g.add(at(box(W, 0.03, D, wood), 0, y, 0));
    if (s === 4) break;
    let x = -W / 2 + 0.06;
    while (x < W / 2 - 0.12) {
      if (rng() < 0.12) {
        x += 0.15;
        continue;
      }
      const bw = 0.04 + rng() * 0.05;
      const bh = 0.24 + rng() * 0.14;
      const book = box(bw, bh, 0.24, mat(pick(rng, colors), { roughness: 0.8 }));
      book.position.set(x + bw / 2, y + 0.015 + bh / 2, 0.02);
      if (rng() < 0.08) book.rotation.z = 0.25;
      g.add(book);
      x += bw + 0.005;
    }
  }
  // Trofeo / adorno
  g.add(at(sphere(0.07, mat(0xd4a017, { metalness: 0.8, roughness: 0.25 }), 12, 10), 0.4, 1.92, 0));
  return g;
}

export function createSofa(color, accent) {
  const g = new THREE.Group();
  const fabric = mat(color, { roughness: 0.9 });
  g.add(at(rbox(2.0, 0.32, 0.85, 0.06, fabric), 0, 0.22, 0));
  [-0.48, 0.48].forEach((x) => g.add(at(rbox(0.94, 0.16, 0.72, 0.07, mat(shade(color, 0.12), { roughness: 0.95 })), x, 0.45, 0.05)));
  g.add(at(rbox(2.0, 0.58, 0.22, 0.08, fabric), 0, 0.6, -0.33));
  [-0.95, 0.95].forEach((x) => g.add(at(rbox(0.2, 0.52, 0.85, 0.07, fabric), x, 0.4, 0)));
  const pillowA = rbox(0.38, 0.36, 0.12, 0.05, mat(accent, { roughness: 0.9 }));
  pillowA.rotation.set(-0.25, 0.2, 0.1);
  g.add(at(pillowA, -0.62, 0.68, -0.15));
  const pillowB = rbox(0.36, 0.34, 0.12, 0.05, mat(0xf1e9da, { roughness: 0.9 }));
  pillowB.rotation.set(-0.25, -0.15, -0.08);
  g.add(at(pillowB, 0.6, 0.67, -0.15));
  [-0.9, 0.9].forEach((x) => [-0.35, 0.35].forEach((z) => g.add(at(cyl(0.03, 0.02, 0.08, mat(WOOD_DARK), 8), x, 0.04, z))));
  return g;
}

export function createCoffeeTable(rng) {
  const g = new THREE.Group();
  g.add(at(rbox(1.0, 0.05, 0.55, 0.02, mat(WOOD_LIGHT, { roughness: 0.5 })), 0, 0.4, 0));
  [-0.44, 0.44].forEach((x) => [-0.22, 0.22].forEach((z) => g.add(at(cyl(0.02, 0.02, 0.38, mat(METAL), 8), x, 0.19, z))));
  const mag = box(0.22, 0.012, 0.3, mat(0xe63946));
  mag.rotation.y = 0.3;
  g.add(at(mag, -0.22, 0.432, 0));
  const mag2 = box(0.22, 0.012, 0.3, mat(0x1d3557));
  mag2.rotation.y = -0.2;
  g.add(at(mag2, -0.2, 0.444, 0.03));
  g.add(at(cyl(0.05, 0.07, 0.16, mat(0xf4f1ea, { roughness: 0.3 }), 14), 0.25, 0.505, 0));
  const flowers = [0xff006e, 0xffbe0b, 0xfb5607];
  for (let i = 0; i < 3; i += 1) {
    g.add(at(sphere(0.035, mat(pick(rng, flowers)), 8, 6), 0.25 + (i - 1) * 0.04, 0.63 + (i % 2) * 0.03, (i - 1) * 0.02));
  }
  return g;
}

/** Lámpara de pie con luz cálida real (sin sombras para no saturar). */
export function createFloorLamp() {
  const g = new THREE.Group();
  g.add(at(cyl(0.16, 0.18, 0.03, mat(METAL, { metalness: 0.6 })), 0, 0.015, 0));
  g.add(at(cyl(0.015, 0.015, 1.5, mat(METAL, { metalness: 0.6 }), 8), 0, 0.75, 0));
  const shadeMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.26, 0.3, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc77a, emissiveIntensity: 0.9, side: THREE.DoubleSide })
  );
  g.add(at(shadeMesh, 0, 1.55, 0));
  const light = new THREE.PointLight(0xffc98a, 5, 6, 2);
  light.position.set(0, 1.45, 0);
  g.add(light);
  return g;
}

export function createCoffeeStation(rng, accent) {
  const g = new THREE.Group();
  g.add(at(rbox(1.8, 0.88, 0.6, 0.02, mat(WHITE, { roughness: 0.5 })), 0, 0.44, 0));
  g.add(at(box(1.82, 0.04, 0.62, mat(0x3b3f45, { roughness: 0.3 })), 0, 0.9, 0));
  for (let i = 0; i < 3; i += 1) {
    g.add(at(box(0.56, 0.7, 0.01, mat(shade(accent, 0.55))), -0.6 + i * 0.6, 0.45, 0.302));
    g.add(at(box(0.12, 0.02, 0.02, mat(METAL, { metalness: 0.7 })), -0.6 + i * 0.6, 0.72, 0.315));
  }
  g.add(at(createLogoDecal(0.32), 0, 0.5, 0.31));
  // Cafetera
  const machine = new THREE.Group();
  machine.add(at(rbox(0.32, 0.42, 0.3, 0.03, mat(0x1f2124, { roughness: 0.35 })), 0, 0.21, 0));
  machine.add(at(rbox(0.26, 0.06, 0.12, 0.02, mat(0x9aa1a9, { metalness: 0.8, roughness: 0.3 })), 0, 0.33, 0.12));
  machine.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 })), 0.1, 0.36, 0.152));
  machine.add(at(cyl(0.035, 0.032, 0.07, mat(0xffffff), 12), 0, 0.075, 0.08));
  g.add(at(machine, -0.45, 0.92, -0.05));
  // Tazas y frutero
  for (let i = 0; i < 3; i += 1) {
    g.add(at(cyl(0.04, 0.036, 0.09, mat(pick(rng, MUG_COLORS), { roughness: 0.35 }), 14), 0.05 + i * 0.11, 0.965, 0.12));
  }
  g.add(at(cyl(0.16, 0.1, 0.07, mat(WOOD_LIGHT), 18), 0.55, 0.955, 0));
  [0xffb703, 0xe63946, 0x8ac926, 0xfb8500].forEach((c, i) => {
    g.add(at(sphere(0.05, mat(c, { roughness: 0.5 }), 10, 8), 0.5 + (i % 2) * 0.09, 1.01 + Math.floor(i / 2) * 0.05, (i - 1.5) * 0.04));
  });
  // Repisa en la pared
  g.add(at(box(1.4, 0.04, 0.25, mat(WOOD_LIGHT)), 0, 1.6, -0.18));
  for (let i = 0; i < 4; i += 1) {
    g.add(at(cyl(0.05, 0.05, 0.16, mat(pick(rng, [0xd8e2dc, 0xffe5d9, 0xf4acb7, 0x9d8189])), 12), -0.5 + i * 0.33, 1.7, -0.18));
  }
  return g;
}

export function createWaterCooler() {
  const g = new THREE.Group();
  g.add(at(rbox(0.32, 0.95, 0.32, 0.03, mat(WHITE, { roughness: 0.5 })), 0, 0.475, 0));
  g.add(at(box(0.18, 0.12, 0.02, mat(0x3a3f47)), 0, 0.7, 0.165));
  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.42, 20),
    new THREE.MeshPhysicalMaterial({ color: 0x8ecae6, transmission: 0.6, transparent: true, opacity: 0.7, roughness: 0.1 })
  );
  g.add(at(bottle, 0, 1.17, 0));
  return g;
}

export function createWhiteboard(texture) {
  const g = new THREE.Group();
  g.add(at(box(1.9, 1.15, 0.04, mat(0xc0c5cc, { metalness: 0.6, roughness: 0.35 })), 0, 0, 0));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.82, 1.07), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.3 }));
  g.add(at(board, 0, 0, 0.021));
  g.add(at(box(0.8, 0.03, 0.08, mat(0xc0c5cc, { metalness: 0.6 })), 0, -0.6, 0.04));
  [0xe63946, 0x1d3557, 0x2a9d8f].forEach((c, i) => {
    const m = cyl(0.012, 0.012, 0.12, mat(c), 8);
    m.rotation.z = Math.PI / 2;
    g.add(at(m, -0.2 + i * 0.15, -0.575, 0.05));
  });
  return g;
}

/** Reloj de pared con la hora real. */
export function createClock(accent) {
  const g = new THREE.Group();
  const face = cyl(0.26, 0.26, 0.05, mat(0xffffff, { roughness: 0.4 }), 32);
  face.rotation.x = Math.PI / 2;
  g.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.025, 10, 40), mat(accent, { roughness: 0.4 }));
  g.add(rim);
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    g.add(at(box(0.015, i % 3 === 0 ? 0.06 : 0.035, 0.01, mat(0x222222)), Math.sin(a) * 0.2, Math.cos(a) * 0.2, 0.03));
  }
  const makeHand = (len, w, color) => {
    const pivot = new THREE.Group();
    pivot.position.z = 0.035;
    pivot.add(at(box(w, len, 0.008, mat(color)), 0, len / 2 - 0.02, 0));
    g.add(pivot);
    return pivot;
  };
  const hourHand = makeHand(0.13, 0.022, 0x222222);
  const minHand = makeHand(0.19, 0.015, 0x222222);
  const secHand = makeHand(0.21, 0.006, 0xe63946);
  return {
    group: g,
    update: () => {
      const d = new Date();
      const s = d.getSeconds() + d.getMilliseconds() / 1000;
      const m = d.getMinutes() + s / 60;
      const h = (d.getHours() % 12) + m / 60;
      secHand.rotation.z = -(s / 60) * Math.PI * 2;
      minHand.rotation.z = -(m / 60) * Math.PI * 2;
      hourHand.rotation.z = -(h / 12) * Math.PI * 2;
    },
  };
}

export function createWindow(texture, w = 2.2, h = 1.3) {
  const g = new THREE.Group();
  const frame = mat(0xf7f7f7, { roughness: 0.5 });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  glass.material.color.setScalar(0.92);
  g.add(at(glass, 0, 0, 0.0));
  g.add(at(box(w + 0.12, 0.08, 0.1, frame), 0, h / 2 + 0.02, 0.03));
  g.add(at(box(w + 0.12, 0.08, 0.1, frame), 0, -h / 2 - 0.02, 0.03));
  g.add(at(box(w + 0.3, 0.04, 0.2, frame), 0, -h / 2 - 0.08, 0.08));
  g.add(at(box(0.08, h + 0.12, 0.1, frame), -w / 2 - 0.02, 0, 0.03));
  g.add(at(box(0.08, h + 0.12, 0.1, frame), w / 2 + 0.02, 0, 0.03));
  g.add(at(box(0.05, h, 0.06, frame), 0, 0, 0.02));
  return g;
}

export function createPoster(texture, w = 0.7, h = 0.98) {
  const g = new THREE.Group();
  g.add(at(box(w + 0.06, h + 0.06, 0.03, mat(0x222222)), 0, 0, 0));
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 }));
  g.add(at(art, 0, 0, 0.016));
  return g;
}

export function createRug(texture, w, d) {
  const rug = new THREE.Mesh(new THREE.BoxGeometry(w, 0.015, d), new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
  rug.receiveShadow = true;
  return rug;
}

/** Marketing: set de grabación para Reels/TikTok con aro de luz y cámara. */
export function createStudio(accent) {
  const g = new THREE.Group();
  const dark = mat(0x222428, { roughness: 0.5 });
  const tripod = (x, z, height) => {
    const t = new THREE.Group();
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2;
      const leg = cyl(0.012, 0.012, height * 0.62, dark, 6);
      leg.position.set(Math.cos(a) * 0.14, height * 0.29, Math.sin(a) * 0.14);
      leg.rotation.set(Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28);
      t.add(leg);
    }
    t.add(at(cyl(0.015, 0.015, height * 0.5, dark, 8), 0, height * 0.75, 0));
    t.position.set(x, 0, z);
    g.add(t);
    return t;
  };
  const ringStand = tripod(0, 0, 1.6);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.26, 0.03, 12, 40),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 1.6 })
  );
  ring.position.y = 1.62;
  ringStand.add(ring);
  ringStand.add(at(rbox(0.08, 0.15, 0.012, 0.01, mat(0x111111)), 0, 1.62, 0.01));
  const camStand = tripod(0.8, 0.25, 1.35);
  camStand.add(at(rbox(0.2, 0.13, 0.1, 0.02, dark), 0, 1.4, 0));
  const lens = cyl(0.045, 0.05, 0.1, mat(0x111111, { roughness: 0.2 }), 16);
  lens.rotation.x = Math.PI / 2;
  camStand.add(at(lens, 0, 1.4, -0.09));
  camStand.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2d55 })), 0.07, 1.45, 0.05));
  camStand.rotation.y = Math.PI + 0.35;
  // Banquito para grabar
  g.add(at(cyl(0.2, 0.2, 0.05, mat(accent, { roughness: 0.8 }), 18), -0.1, 0.62, 0.75));
  g.add(at(cyl(0.025, 0.025, 0.6, dark, 8), -0.1, 0.3, 0.75));
  return g;
}

/** Comercial: archivero con trofeo y campana de "venta cerrada". */
export function createSalesCorner(accent) {
  const g = new THREE.Group();
  const steel = mat(0x8d99ae, { metalness: 0.5, roughness: 0.45 });
  g.add(at(rbox(0.5, 1.2, 0.55, 0.02, steel), 0, 0.6, 0));
  for (let i = 0; i < 4; i += 1) {
    g.add(at(box(0.44, 0.005, 0.01, mat(0x5c677d)), 0, 0.3 + i * 0.28, 0.28));
    g.add(at(box(0.12, 0.025, 0.02, mat(0xd9d9d9, { metalness: 0.8 })), 0, 0.42 + i * 0.28 - 0.18, 0.29));
  }
  const gold = mat(0xd4a017, { metalness: 0.85, roughness: 0.25 });
  g.add(at(box(0.16, 0.06, 0.16, mat(0x2b2d42)), 0, 1.23, 0));
  g.add(at(cyl(0.025, 0.04, 0.12, gold, 12), 0, 1.32, 0));
  g.add(at(cyl(0.11, 0.05, 0.16, gold, 18), 0, 1.46, 0));
  // Campana
  g.add(at(cyl(0.05, 0.05, 0.02, mat(WOOD_DARK), 14), 0.85, 0.01, 0.1));
  const bellStand = new THREE.Group();
  bellStand.position.set(0.85, 0, 0.1);
  bellStand.add(at(cyl(0.012, 0.012, 1.0, mat(WOOD_DARK), 8), 0, 0.5, 0));
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  bell.material.side = THREE.DoubleSide;
  bell.position.y = 0.9;
  bellStand.add(bell);
  const bellRim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.01, 8, 24), mat(accent));
  bellRim.rotation.x = Math.PI / 2;
  bellStand.add(at(bellRim, 0, 0.9, 0));
  g.add(bellStand);
  return g;
}

/** Departamentos genéricos: puff y mesita. */
export function createLounge(accent) {
  const g = new THREE.Group();
  const bag = sphere(0.42, mat(accent, { roughness: 0.95 }), 18, 14);
  bag.scale.set(1, 0.6, 1);
  g.add(at(bag, 0, 0.25, 0));
  const bag2 = sphere(0.38, mat(shade(accent, 0.4), { roughness: 0.95 }), 18, 14);
  bag2.scale.set(1, 0.6, 1);
  g.add(at(bag2, 0.9, 0.23, 0.2));
  return g;
}

/** Cuadro enmarcado con el logotipo completo de Intelekia. */
export function createLogoFrame(w = 1.0, h = 1.0) {
  const g = new THREE.Group();
  g.add(at(box(w + 0.08, h + 0.08, 0.04, mat(BRAND.navy, { roughness: 0.4 })), 0, 0, 0));
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: logoPanelTexture({ dark: false, width: 512, height: Math.round(512 * (h / w)), padding: 0.1 }), roughness: 0.6 })
  );
  g.add(at(art, 0, 0, 0.021));
  return g;
}

/** Entrada de la oficina: tapete con logo y tótem de bienvenida. */
export function createEntrance() {
  const g = new THREE.Group();
  const mat_ = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.02, 3.4),
    new THREE.MeshStandardMaterial({ map: logoPanelTexture({ dark: true, width: 1024, height: 830, padding: 0.1 }), roughness: 0.9 })
  );
  mat_.receiveShadow = true;
  g.add(at(mat_, 0, 0.0, 0));

  const totem = new THREE.Group();
  totem.add(at(rbox(1.25, 2.3, 0.22, 0.05, mat(BRAND.navy, { roughness: 0.35 })), 0, 1.15, 0));
  totem.scale.setScalar(0.75);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 1.9),
    new THREE.MeshBasicMaterial({ map: logoPanelTexture({ dark: true, width: 420, height: 760, padding: 0.1 }), toneMapped: false })
  );
  totem.add(at(face, 0, 1.2, 0.112));
  totem.add(at(box(1.25, 0.06, 0.24, mat(BRAND.green, { roughness: 0.4 })), 0, 0.03, 0));
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.27, 0.03, 0.24), new THREE.MeshBasicMaterial({ color: 0x3ee0b0, toneMapped: false }));
  totem.add(at(glow, 0, 2.31, 0));
  totem.rotation.y = 0.3;
  g.add(at(totem, -2.9, 0, 1.0));
  const pot = cyl(0.22, 0.18, 0.45, mat(BRAND.navy, { roughness: 0.5 }));
  g.add(at(pot, 2.8, 0.225, 1.1));
  const bush = sphere(0.32, mat(0x3f8f4f, { roughness: 0.8 }), 12, 10);
  bush.scale.set(1, 1.25, 1);
  g.add(at(bush, 2.8, 0.75, 1.1));
  return g;
}
