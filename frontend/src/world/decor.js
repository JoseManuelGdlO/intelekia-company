import * as THREE from 'three';
import { mat, box, rbox, cyl, at, shade, hashString, seededRandom } from './materials.js';
import { BRAND } from './brand.js';
import { skylineTexture, posterTexture, rugTexture, tileFloorTexture } from './textures.js';
import {
  createChair,
  createPlant,
  createSofa,
  createCoffeeTable,
  createFloorLamp,
  createBookshelf,
  createCoffeeStation,
  createWaterCooler,
  createClock,
  createWindow,
  createPoster,
  createRug,
  createLogoFrame,
  createRoundTable,
  createArmchair,
  createReceptionDesk,
} from './furniture.js';
import { buildShell, mirrorFor } from './room.js';

const WHITE = 0xf4f5f3;
const STEEL = 0x9aa1a9;

/** Temas de las salas sin agentes. */
export const DECOR_THEMES = {
  recepcion: { accent: BRAND.green, wall: 0xf1f5f3, floor: 0xc4a484, sofa: 0x2f4858, rug: 0xcfe7de },
  cafe: { accent: 0xc8693f, wall: 0xfbf2ea, floor: 0xb8875f, sofa: 0x7a4b33, rug: 0xf3d9c4 },
  bano: { accent: 0x3a9fc0, wall: 0xeef6f8, floor: 0xe6edf0, sofa: 0x3a9fc0, rug: 0xd3ecf3 },
};

/** Tarja con mueble y llave, al estilo del mueble de café. Mira hacia +z. */
function createSinkCounter(width = 1.6) {
  const g = new THREE.Group();
  g.add(at(rbox(width, 0.88, 0.6, 0.02, mat(WHITE, { roughness: 0.5 })), 0, 0.44, 0));
  g.add(at(box(width + 0.02, 0.04, 0.62, mat(0x3b3f45, { roughness: 0.3 })), 0, 0.9, 0));
  g.add(at(box(0.55, 0.012, 0.38, mat(0xc9ced3, { metalness: 0.7, roughness: 0.25 })), 0, 0.925, 0.02));
  g.add(at(cyl(0.02, 0.02, 0.28, mat(STEEL, { metalness: 0.8, roughness: 0.25 }), 10), 0, 1.06, -0.2));
  const spout = box(0.03, 0.03, 0.18, mat(STEEL, { metalness: 0.8, roughness: 0.25 }));
  g.add(at(spout, 0, 1.19, -0.12));
  for (let i = 0; i < 2; i += 1) {
    g.add(at(box(width / 2 - 0.06, 0.7, 0.01, mat(0xe9e4dc)), (i - 0.5) * (width / 2), 0.45, 0.302));
  }
  return g;
}

/** Refrigerador alto. */
function createFridge() {
  const g = new THREE.Group();
  g.add(at(rbox(0.75, 1.9, 0.68, 0.04, mat(0xdfe3e6, { metalness: 0.3, roughness: 0.35 })), 0, 0.95, 0));
  g.add(at(box(0.74, 0.01, 0.01, mat(0x9aa1a9)), 0, 1.25, 0.345));
  [0.95, 1.55].forEach((y) => g.add(at(box(0.03, 0.35, 0.04, mat(STEEL, { metalness: 0.8 })), -0.28, y, 0.36)));
  return g;
}

/** Excusado con tanque, mirando hacia +z. */
function createToilet() {
  const g = new THREE.Group();
  const porcelain = mat(0xffffff, { roughness: 0.25 });
  g.add(at(cyl(0.14, 0.17, 0.38, porcelain, 20), 0, 0.19, 0.12));
  const bowl = cyl(0.21, 0.16, 0.12, porcelain, 24);
  bowl.scale.set(1, 1, 1.25);
  g.add(at(bowl, 0, 0.42, 0.14));
  const seat = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 24), porcelain);
  seat.rotation.x = Math.PI / 2;
  seat.scale.set(1, 1.25, 1);
  g.add(at(seat, 0, 0.49, 0.14));
  g.add(at(rbox(0.46, 0.4, 0.2, 0.03, porcelain), 0, 0.68, -0.15));
  g.add(at(box(0.08, 0.02, 0.03, mat(STEEL, { metalness: 0.8 })), 0.14, 0.86, -0.15));
  return g;
}

/** Lavabo doble con espejo. Mira hacia +z (el espejo queda contra el muro). */
function createVanity(length = 1.7) {
  const g = new THREE.Group();
  g.add(at(rbox(length, 0.82, 0.55, 0.02, mat(0x8a5a3b, { roughness: 0.6 })), 0, 0.41, 0));
  g.add(at(box(length + 0.04, 0.05, 0.58, mat(0xf2f2f0, { roughness: 0.2 })), 0, 0.845, 0));
  [-length / 4, length / 4].forEach((x) => {
    const basin = cyl(0.19, 0.15, 0.05, mat(0xffffff, { roughness: 0.15 }), 24);
    basin.scale.set(1, 1, 0.75);
    g.add(at(basin, x, 0.885, 0.04));
    g.add(at(cyl(0.015, 0.015, 0.18, mat(STEEL, { metalness: 0.85, roughness: 0.2 }), 8), x, 0.96, -0.2));
    g.add(at(box(0.025, 0.025, 0.12, mat(STEEL, { metalness: 0.85, roughness: 0.2 })), x, 1.04, -0.15));
  });
  const mirror = new THREE.Mesh(
    new THREE.PlaneGeometry(length - 0.1, 0.85),
    new THREE.MeshStandardMaterial({ color: 0xdfeef5, metalness: 1, roughness: 0.06 })
  );
  g.add(at(box(length, 0.93, 0.03, mat(0xf2f2f0)), 0, 1.65, -0.27));
  g.add(at(mirror, 0, 1.65, -0.25));
  return g;
}

/** Contenido de la recepción (lado exterior a la izquierda en coordenadas locales). */
function furnishRecepcion({ group, put, W, D, theme, rng, updatables }) {
  const accent = theme.accent;
  // Mostrador frente a la entrada con el logotipo detrás
  const deskX = W / 2 - 3.4;
  put(group, createReceptionDesk(accent), deskX, 0, -0.3);
  put(group, createChair(accent), deskX + 0.4, 0, -1.25);
  put(group, createLogoFrame(1.7, 1.2), deskX, 1.55, -D / 2 + 0.03);
  put(group, createWindow(skylineTexture(rng), 1.8, 1.3), -0.4, 1.45, -D / 2 + 0.01);
  const clock = createClock(accent);
  put(group, clock.group, -W / 2 + 3.3, 1.35, -D / 2 + 0.04);
  updatables.push(clock.update);

  // Sala de espera junto al muro exterior
  put(group, createRug(rugTexture(theme.rug), 2.6, 3.2), -W / 2 + 1.9, 0.008, 0.6);
  put(group, createSofa(theme.sofa, accent), -W / 2 + 0.65, 0, 0.6, Math.PI / 2);
  put(group, createCoffeeTable(rng), -W / 2 + 1.85, 0, 0.6, Math.PI / 2);
  put(group, createArmchair(shade(theme.sofa, 0.25), accent), -W / 2 + 3.0, 0, 0.6, -Math.PI / 2);
  put(group, createFloorLamp(), -W / 2 + 0.5, 0, -0.95);
  put(group, createBookshelf(rng, accent), -W / 2 + 0.2, 0, -2.2, Math.PI / 2);
  // Sillones para visitas frente al mostrador
  put(group, createRug(rugTexture(shade(theme.rug, -0.08)), 3.0, 1.6), deskX, 0.008, D / 2 - 1.3);
  [-0.8, 0.8].forEach((dx) => put(group, createArmchair(theme.sofa, accent), deskX + dx, 0, D / 2 - 1.2, Math.PI));
  put(group, createWaterCooler(), -W / 2 + 0.35, 0, -D / 2 + 0.45);
  put(group, createPoster(posterTexture(['Bienvenido', 'a', 'Intelekia.'], accent, rng)), -W / 2 + 0.02, 1.6, D / 2 - 1.0, Math.PI / 2);

  [
    [W / 2 - 0.45, D / 2 - 0.45, 1.1],
    [W / 2 - 0.45, -D / 2 + 0.45, 1.15],
    [-W / 2 + 0.45, D / 2 - 0.45, 1.0],
    [deskX - 1.9, -D / 2 + 0.45, 0.9],
  ].forEach(([x, z, s]) => {
    const plant = createPlant(rng, s);
    put(group, plant.group, x, 0, z);
    updatables.push(plant.update);
  });
}

/** Contenido del café (lado del baño a la izquierda en coordenadas locales). */
function furnishCafe({ group, put, W, D, theme, rng, updatables }) {
  const accent = theme.accent;
  put(group, createCoffeeStation(rng, accent), -W / 2 + 1.2, 0, -D / 2 + 0.32);
  put(group, createSinkCounter(1.5), -W / 2 + 2.95, 0, -D / 2 + 0.32);
  put(group, createFridge(), -W / 2 + 4.2, 0, -D / 2 + 0.4);
  put(group, createPoster(posterTexture(['Café', 'recién', 'hecho.'], accent, rng)), W / 2 - 3.3, 1.55, -D / 2 + 0.03);
  const clock = createClock(accent);
  put(group, clock.group, -W / 2 + 2.95, 1.85, -D / 2 + 0.04);
  updatables.push(clock.update);

  put(group, createRug(rugTexture(theme.rug), 2.6, 2.6), 0.9, 0.008, 0.7);
  put(group, createRoundTable({ accent, chairs: 3, radius: 0.55, top: 0xf4f1ea }), 0.9, 0, 0.7);
  put(group, createRoundTable({ accent: shade(accent, 0.2), chairs: 2, radius: 0.42 }), -W / 2 + 1.6, 0, D / 2 - 1.5);
  [
    [W / 2 - 0.45, -D / 2 + 0.45, 1.1],
    [W / 2 - 0.45, D / 2 - 0.45, 1.0],
    [-W / 2 + 0.45, -D / 2 + 1.25, 0.9],
  ].forEach(([x, z, s]) => {
    const plant = createPlant(rng, s);
    put(group, plant.group, x, 0, z);
    updatables.push(plant.update);
  });
}

/** Contenido del baño (muro exterior a la izquierda en coordenadas locales). */
function furnishBano({ group, put, W, D, rng, updatables }) {
  // Dos cubículos al fondo
  const stallW = 1.25;
  for (let i = 0; i < 2; i += 1) {
    const x = -W / 2 + stallW / 2 + 0.05 + i * stallW;
    put(group, createToilet(), x, 0, -D / 2 + 0.3);
    put(group, box(0.05, 1.8, 1.5, mat(0xd7e7ec, { roughness: 0.5 })), x + stallW / 2, 0.95, -D / 2 + 0.75);
  }
  // Lavabos con espejo en el muro exterior
  put(group, createVanity(1.7), -W / 2 + 0.3, 0, 0.6, Math.PI / 2);
  put(group, box(0.05, 0.35, 0.25, mat(0xffffff)), -W / 2 + 0.03, 1.3, -0.6);
  put(group, cyl(0.15, 0.13, 0.4, mat(STEEL, { metalness: 0.6, roughness: 0.4 }), 16), -W / 2 + 0.3, 0.2, D / 2 - 0.5);
  const plant = createPlant(rng, 0.85);
  put(group, plant.group, W / 2 - 0.45, 0, D / 2 - 0.45);
  updatables.push(plant.update);
}

const FURNISH = { recepcion: furnishRecepcion, cafe: furnishCafe, bano: furnishBano };

/**
 * Sala decorativa sin agentes (Recepción, Café, Baño). Mismo estilo de piso, muros y letrero
 * que las oficinas. sideSign: -1 columna izquierda, +1 columna derecha (reflejada).
 */
export function buildDecorRoom({ tipo, label, theme = DECOR_THEMES[tipo], centerX, centerZ, width: W, depth: D, sideSign = -1 }) {
  const rng = seededRandom(hashString(`decor-${tipo}`));
  const group = new THREE.Group();
  group.position.set(centerX, 0, centerZ);
  const updatables = [];
  const { put } = mirrorFor(sideSign);

  const shell = {
    recepcion: {},
    // El café no tiene muro exterior propio: colinda con el baño.
    cafe: { outerWall: false, signX: W / 2 - 1.5, signW: 2.4 },
    // El baño solo se abre hacia el café.
    bano: { corridorDoor: false, partition: true, signX: 0.35, floorMap: tileFloorTexture(theme.floor, [W / 1.2, D / 1.2]) },
  }[tipo] || {};
  buildShell({ group, W, D, theme, label, rng, sideSign, ...shell });
  FURNISH[tipo]?.({ group, put, W, D, theme, rng, updatables });

  return {
    group,
    width: W,
    depth: D,
    center: new THREE.Vector3(centerX, 0, centerZ),
    update: (t) => updatables.forEach((fn) => fn(t)),
  };
}
