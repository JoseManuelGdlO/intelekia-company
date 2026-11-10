import * as THREE from 'three';
import { mat, box, at, shade, hashString, seededRandom } from './materials.js';
import {
  woodFloorTexture,
  signTexture,
  skylineTexture,
  whiteboardTexture,
  posterTexture,
  rugTexture,
  Screen,
} from './textures.js';
import {
  createDesk,
  createChair,
  createPlant,
  createBookshelf,
  createSofa,
  createCoffeeTable,
  createFloorLamp,
  createCoffeeStation,
  createWaterCooler,
  createWhiteboard,
  createClock,
  createWindow,
  createPoster,
  createRug,
  createStudio,
  createSalesCorner,
  createLounge,
  createLogoFrame,
  createRoundTable,
} from './furniture.js';

const MAX_COLS = 4;
const DESK_SPACING_X = 2.3;
const ROW_SPACING_Z = 2.9;
export const WALL_H = 2.7;
export const WALL_T = 0.15;

export function computeRoomSize(agentCount) {
  const cols = Math.min(Math.max(agentCount, 1), MAX_COLS);
  const rows = Math.max(1, Math.ceil(agentCount / MAX_COLS));
  return {
    width: Math.max(9.5, cols * DESK_SPACING_X + 5.5),
    depth: 6.8 + (rows - 1) * ROW_SPACING_Z,
  };
}

/**
 * Espejo para las salas de la columna derecha: todo se diseña como si la sala estuviera
 * en la columna izquierda (muro exterior en -W/2) y se refleja en X sin voltear los objetos,
 * así los letreros, pósters y pizarrones se siguen leyendo bien.
 */
export function mirrorFor(sideSign) {
  const flip = sideSign > 0 ? -1 : 1;
  return {
    flip,
    X: (x) => x * flip,
    /** Coloca un objeto en coordenadas locales "de columna izquierda" con giro opcional. */
    put(group, obj, x, y, z, rotY = 0) {
      obj.position.set(x * flip, y, z);
      if (rotY) obj.rotation.y = rotY * flip;
      group.add(obj);
      return obj;
    },
  };
}

/**
 * Cascarón de una sala: piso, muro del fondo, muro exterior (opcional), letrero y
 * acceso desde el pasillo. Lo comparten las oficinas y las salas decorativas.
 */
export function buildShell({ group, W, D, theme, label, rng, sideSign = -1, floorMap = null, outerWall = true, corridorDoor = true, partition = false, signX = null, signW: signWidth = null, doorAt = null }) {
  const { put } = mirrorFor(sideSign);
  const accent = theme.accent;

  // Piso (madera por defecto)
  const map = floorMap || woodFloorTexture(theme.floor, rng, [W / 3, D / 3]);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, D), new THREE.MeshStandardMaterial({ map, roughness: 0.55 }));
  floor.position.y = -0.05;
  floor.receiveShadow = true;
  group.add(floor);

  // Muros: fondo y exterior, con franja de color
  const wallMat = mat(theme.wall, { roughness: 0.9 });
  const accentMat = mat(accent, { roughness: 0.6 });
  const trimMat = mat(shade(theme.wall, -0.35));
  const capMat = mat(0xffffff);
  const backW = W + (outerWall ? WALL_T : 0);
  const backX = outerWall ? -WALL_T / 2 : 0;
  put(group, box(backW, WALL_H, WALL_T, wallMat), backX, WALL_H / 2, -D / 2 - WALL_T / 2);
  put(group, box(W, 0.1, 0.02, accentMat), 0, 0.95, -D / 2 + 0.01);
  put(group, box(W, 0.12, 0.03, trimMat), 0, 0.06, -D / 2 + 0.015);
  put(group, box(backW, 0.06, 0.2, capMat), backX, WALL_H + 0.03, -D / 2 - WALL_T / 2);
  if (outerWall) {
    put(group, box(WALL_T, WALL_H, D, wallMat), -W / 2 - WALL_T / 2, WALL_H / 2, 0);
    put(group, box(0.02, 0.1, D, accentMat), -W / 2 + 0.01, 0.95, 0);
    put(group, box(0.03, 0.12, D, trimMat), -W / 2 + 0.015, 0.06, 0);
    put(group, box(0.2, 0.06, D, capMat), -W / 2 - WALL_T / 2, WALL_H + 0.03, 0);
  }

  // Letrero con el nombre de la sala
  const signW = signWidth || Math.min(3.0, W - 0.8);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(signW, signW / 4),
    new THREE.MeshStandardMaterial({ map: signTexture(label, 'Intelekia Consultoría', accent), roughness: 0.4 })
  );
  const sx = signX ?? Math.min(-W / 2 + 3.3, W / 2 - signW / 2 - 0.3);
  put(group, sign, sx, 2.15, -D / 2 + 0.01);

  // Acceso desde el pasillo (lado interior): murete bajo con marco de puerta y tapete
  const doorZ = doorAt ?? 0.2;
  const doorW = 1.3;
  if (corridorDoor) addDoorway(group, put, { x: W / 2 + 0.06, D, doorZ, doorW, height: 0.55, wallMat, accent, mat: true });
  // Partición con puerta hacia la sala vecina (baño → café)
  if (partition) addDoorway(group, put, { x: W / 2 + WALL_T / 2, D, doorZ, doorW: 1.0, height: 2.2, wallMat, accent, mat: false, door: true });
}

/** Muro a lo largo de Z en x (local) con hueco de puerta en doorZ. */
function addDoorway(group, put, { x, D, doorZ, doorW, height, wallMat, accent, mat: withMat, door = false }) {
  const t = 0.12;
  const capMat = mat(0xffffff);
  const segs = [
    [-D / 2, doorZ - doorW / 2],
    [doorZ + doorW / 2, D / 2],
  ];
  segs.forEach(([z0, z1]) => {
    if (z1 - z0 < 0.05) return;
    put(group, box(t, height, z1 - z0, wallMat), x, height / 2, (z0 + z1) / 2);
    put(group, box(t + 0.06, 0.05, z1 - z0, capMat), x, height + 0.025, (z0 + z1) / 2);
  });
  // Marco de puerta
  const frameMat = mat(shade(accent, -0.25), { roughness: 0.5 });
  const frameH = 2.25;
  [doorZ - doorW / 2, doorZ + doorW / 2].forEach((z) => put(group, box(t + 0.04, frameH, 0.08, frameMat), x, frameH / 2, z));
  put(group, box(t + 0.04, 0.1, doorW + 0.08, frameMat), x, frameH + 0.05, doorZ);
  if (door) {
    // Hoja de puerta entreabierta
    const leaf = new THREE.Group();
    leaf.add(at(box(0.04, 2.1, doorW - 0.06, mat(0xf4f1ea, { roughness: 0.6 })), 0, 1.05, (doorW - 0.06) / 2));
    leaf.add(at(box(0.06, 0.04, 0.14, mat(0x9aa1a9, { metalness: 0.7 })), 0.04, 1.0, doorW - 0.2));
    put(group, leaf, x - 0.02, 0, doorZ - doorW / 2 + 0.03, -0.6);
  }
  if (withMat) {
    const rug = box(0.9, 0.02, doorW - 0.1, mat(shade(accent, -0.15), { roughness: 1 }));
    rug.castShadow = false;
    put(group, rug, x + 0.55, 0.01, doorZ);
  }
}

/**
 * Construye una oficina amueblada para un departamento.
 * Devuelve los asientos (en coordenadas de mundo) y las rutas para ir por café.
 * sideSign: -1 columna izquierda (muro exterior a la izquierda), +1 columna derecha (reflejada).
 */
export function buildRoom({ department, theme, centerX, centerZ = 0, width, depth, sideSign = -1, label }) {
  const rng = seededRandom(hashString(department.id));
  const size = computeRoomSize(department.agents.length);
  const W = width || size.width;
  const D = depth || size.depth;
  const group = new THREE.Group();
  group.position.set(centerX, 0, centerZ);
  const updatables = [];
  const accent = theme.accent;
  const { X, put } = mirrorFor(sideSign);

  buildShell({ group, W, D, theme, label: label || department.label, rng, sideSign });

  // Ventana con vista a la ciudad
  put(group, createWindow(skylineTexture(rng), 1.8, 1.3), 0.95, 1.45, -D / 2 + 0.01);

  // Pizarrón
  put(group, createWhiteboard(whiteboardTexture(theme.board, accent, rng)), W / 2 - 1.6, 1.5, -D / 2 + 0.03);

  // Reloj
  const clock = createClock(accent);
  put(group, clock.group, -W / 2 + 3.3, 1.35, -D / 2 + 0.04);
  updatables.push(clock.update);

  // Rincón de café (fondo, junto al muro exterior)
  put(group, createCoffeeStation(rng, accent), -W / 2 + 1.0, 0, -D / 2 + 0.32);
  put(group, createWaterCooler(), -W / 2 + 0.35, 0, -D / 2 + 1.6);

  // Librero y pósters en el muro exterior
  put(group, createBookshelf(rng, accent), -W / 2 + 0.2, 0, Math.min(D / 2 - 2.6, 0.4), Math.PI / 2);
  const posterLines = {
    marketing: ['Crea.', 'Publica.', 'Conecta.'],
    comercial: ['Cada cliente', 'es una', 'historia.'],
    desarrollo: ['Código', 'limpio,', 'ideas claras.'],
    administracion: ['Decide', 'con datos.'],
  }[department.id] || ['Hazlo', 'simple.'];
  put(group, createPoster(posterTexture(posterLines, accent, rng)), -W / 2 + 0.02, 1.6, D / 2 - 1.2, Math.PI / 2);

  // Cuadro con el logotipo de Intelekia en el muro exterior
  put(group, createLogoFrame(1.0, 0.93), -W / 2 + 0.02, 1.7, -D / 2 + 2.45, Math.PI / 2);

  // Lounge al frente
  put(group, createRug(rugTexture(theme.rug), 3.0, 2.0), -W / 2 + 3.0, 0.008, D / 2 - 1.15);
  put(group, createSofa(theme.sofa, accent), -W / 2 + 3.0, 0, D / 2 - 1.75);
  put(group, createCoffeeTable(rng), -W / 2 + 3.0, 0, D / 2 - 0.75);
  put(group, createFloorLamp(), -W / 2 + 1.5, 0, D / 2 - 1.9);

  // Dirección y Reuniones: mesa redonda para juntas
  if (department.id === 'administracion') {
    put(group, createRoundTable({ accent, chairs: 4, radius: 0.62 }), W / 2 - 2.7, 0, -D / 2 + 2.6);
  }

  // Esquina especial del departamento (frente, lado del pasillo)
  const specials = { studio: createStudio, sales: createSalesCorner, lounge: createLounge };
  const special = (specials[theme.special] || createLounge)(accent);
  put(group, special, W / 2 - 1.6, 0, D / 2 - 1.3);

  // Plantas
  [
    [W / 2 - 0.45, D / 2 - 0.45, 1.1],
    [W / 2 - 0.38, -D / 2 + 0.42, 1.15],
    [-0.5, -D / 2 + 0.45, 0.85],
    [-W / 2 + 0.45, D / 2 - 0.45, 1.0],
  ].forEach(([x, z, s]) => {
    const plant = createPlant(rng, s);
    put(group, plant.group, x, 0, z);
    updatables.push(plant.update);
  });

  // Escritorios: filas mirando hacia el frente (la cámara ve las caras)
  const laneX = -W / 2 + 1.0;
  const spotZ = -D / 2 + 1.05;
  const world = (x, z) => new THREE.Vector3(centerX + X(x), 0, centerZ + z);
  const agents = department.agents;
  const seats = agents.map((agent, i) => {
    const row = Math.floor(i / MAX_COLS);
    const col = i % MAX_COLS;
    const inRow = Math.min(MAX_COLS, agents.length - row * MAX_COLS);
    const x = (col - (inRow - 1) / 2) * DESK_SPACING_X + 0.9;
    const z = -D / 2 + 2.4 + row * ROW_SPACING_Z;
    const agentRng = seededRandom(hashString(agent.id));
    const screen = new Screen(accent, agent.id);
    const desk = createDesk({ rng: agentRng, accent, screen });
    put(group, desk.group, x, 0, z + 0.65);
    const chair = createChair(accent);
    put(group, chair, x, 0, z - 0.02);
    [desk.group, chair].forEach((obj) => obj.traverse((o) => {
      if (o.isMesh) o.userData.agentId = agent.id;
    }));

    const seat = world(x, z);
    // Ruta hasta la entrada de la zona de café; el lugar exacto se reserva al salir (spots).
    const route = [
      world(x + 0.62, z),
      world(x + 0.62, z - 0.95),
      world(laneX, z - 0.95),
      world(laneX, spotZ + 0.72),
    ];
    return { agent, seat, route, screen, led: desk.led, pickTargets: [desk.group, chair] };
  });

  // Lugares de la zona de café, separados para que dos personas nunca queden encimadas.
  const spots = [0, 1, 2].map((k) => world(laneX + k * 0.75, spotZ));

  return {
    group,
    seats,
    spots,
    width: W,
    depth: D,
    center: new THREE.Vector3(centerX, 0, centerZ),
    update: (t) => updatables.forEach((fn) => fn(t)),
  };
}
