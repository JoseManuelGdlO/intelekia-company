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
} from './furniture.js';

const MAX_COLS = 4;
const DESK_SPACING_X = 2.3;
const ROW_SPACING_Z = 2.9;
const WALL_H = 2.7;

export function computeRoomSize(agentCount) {
  const cols = Math.min(Math.max(agentCount, 1), MAX_COLS);
  const rows = Math.max(1, Math.ceil(agentCount / MAX_COLS));
  return {
    width: Math.max(9.5, cols * DESK_SPACING_X + 5.5),
    depth: 6.8 + (rows - 1) * ROW_SPACING_Z,
  };
}

/**
 * Construye una oficina amueblada para un departamento.
 * Devuelve los asientos (en coordenadas de mundo) y las rutas para ir por café.
 */
export function buildRoom({ department, theme, centerX }) {
  const rng = seededRandom(hashString(department.id));
  const { width: W, depth: D } = computeRoomSize(department.agents.length);
  const group = new THREE.Group();
  group.position.x = centerX;
  const updatables = [];
  const accent = theme.accent;

  // Piso de madera
  const floorTex = woodFloorTexture(theme.floor, rng, [W / 3, D / 3]);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 }));
  floor.position.y = -0.05;
  floor.receiveShadow = true;
  group.add(floor);

  // Muros: fondo e izquierdo, con franja de color del departamento
  const wallMat = mat(theme.wall, { roughness: 0.9 });
  const backWall = box(W + 0.15, WALL_H, 0.15, wallMat);
  group.add(at(backWall, -0.075, WALL_H / 2, -D / 2 - 0.075));
  const leftWall = box(0.15, WALL_H, D, wallMat);
  group.add(at(leftWall, -W / 2 - 0.075, WALL_H / 2, 0));
  const accentMat = mat(accent, { roughness: 0.6 });
  group.add(at(box(W, 0.1, 0.02, accentMat), 0, 0.95, -D / 2 + 0.01));
  group.add(at(box(0.02, 0.1, D, accentMat), -W / 2 + 0.01, 0.95, 0));
  const trimMat = mat(shade(theme.wall, -0.35));
  group.add(at(box(W, 0.12, 0.03, trimMat), 0, 0.06, -D / 2 + 0.015));
  group.add(at(box(0.03, 0.12, D, trimMat), -W / 2 + 0.015, 0.06, 0));
  group.add(at(box(W + 0.15, 0.06, 0.2, mat(0xffffff)), -0.075, WALL_H + 0.03, -D / 2 - 0.075));
  group.add(at(box(0.2, 0.06, D, mat(0xffffff)), -W / 2 - 0.075, WALL_H + 0.03, 0));

  // Letrero del departamento
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.6),
    new THREE.MeshStandardMaterial({ map: signTexture(department.label, 'Intelekia Consultoría', accent), roughness: 0.4 })
  );
  group.add(at(sign, -W / 2 + 3.3, 2.15, -D / 2 + 0.01));

  // Ventana con vista a la ciudad
  group.add(at(createWindow(skylineTexture(rng), 1.8, 1.3), 0.95, 1.45, -D / 2 + 0.01));

  // Pizarrón
  group.add(at(createWhiteboard(whiteboardTexture(theme.board, accent, rng)), W / 2 - 1.6, 1.5, -D / 2 + 0.03));

  // Reloj
  const clock = createClock(accent);
  group.add(at(clock.group, -W / 2 + 3.3, 1.35, -D / 2 + 0.04));
  updatables.push(clock.update);

  // Rincón de café (fondo-izquierda)
  group.add(at(createCoffeeStation(rng, accent), -W / 2 + 1.0, 0, -D / 2 + 0.32));
  const cooler = createWaterCooler();
  group.add(at(cooler, -W / 2 + 0.35, 0, -D / 2 + 1.6));

  // Librero y pósters en el muro izquierdo
  const shelf = createBookshelf(rng, accent);
  shelf.rotation.y = Math.PI / 2;
  group.add(at(shelf, -W / 2 + 0.2, 0, Math.min(D / 2 - 2.6, 0.4)));
  const posterLines = {
    marketing: ['Crea.', 'Publica.', 'Conecta.'],
    comercial: ['Cada cliente', 'es una', 'historia.'],
  }[department.id] || ['Hazlo', 'simple.'];
  const poster = createPoster(posterTexture(posterLines, accent, rng));
  poster.rotation.y = Math.PI / 2;
  group.add(at(poster, -W / 2 + 0.02, 1.6, D / 2 - 1.2));

  // Cuadro con el logotipo de Intelekia en el muro izquierdo
  const logoFrame = createLogoFrame(1.0, 0.93);
  logoFrame.rotation.y = Math.PI / 2;
  group.add(at(logoFrame, -W / 2 + 0.02, 1.7, -D / 2 + 2.45));

  // Lounge al frente
  const rug = createRug(rugTexture(theme.rug), 3.0, 2.0);
  group.add(at(rug, -W / 2 + 3.0, 0.008, D / 2 - 1.15));
  group.add(at(createSofa(theme.sofa, accent), -W / 2 + 3.0, 0, D / 2 - 1.75));
  group.add(at(createCoffeeTable(rng), -W / 2 + 3.0, 0, D / 2 - 0.75));
  group.add(at(createFloorLamp(), -W / 2 + 1.5, 0, D / 2 - 1.9));

  // Esquina especial del departamento (frente-derecha)
  const specials = { studio: createStudio, sales: createSalesCorner, lounge: createLounge };
  const special = (specials[theme.special] || createLounge)(accent);
  group.add(at(special, W / 2 - 1.6, 0, D / 2 - 1.3));

  // Plantas
  [
    [W / 2 - 0.45, D / 2 - 0.45, 1.1],
    [W / 2 - 0.38, -D / 2 + 0.42, 1.15],
    [-0.5, -D / 2 + 0.45, 0.85],
    [-W / 2 + 0.45, D / 2 - 0.45, 1.0],
  ].forEach(([x, z, s]) => {
    const plant = createPlant(rng, s);
    group.add(at(plant.group, x, 0, z));
    updatables.push(plant.update);
  });

  // Escritorios: filas mirando hacia el frente (la cámara ve las caras)
  const laneX = centerX - W / 2 + 1.0;
  const spotZ = -D / 2 + 1.05;
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
    group.add(at(desk.group, x, 0, z + 0.65));
    const chair = createChair(accent);
    group.add(at(chair, x, 0, z - 0.02));
    [desk.group, chair].forEach((obj) => obj.traverse((o) => {
      if (o.isMesh) o.userData.agentId = agent.id;
    }));

    const seat = new THREE.Vector3(centerX + x, 0, z);
    const coffeeX = laneX + (i % 3) * 0.5;
    const route = [
      new THREE.Vector3(seat.x + 0.62, 0, z),
      new THREE.Vector3(seat.x + 0.62, 0, z - 0.95),
      new THREE.Vector3(laneX, 0, z - 0.95),
      new THREE.Vector3(laneX, 0, spotZ),
      new THREE.Vector3(coffeeX, 0, spotZ),
    ];
    return { agent, seat, route, screen, led: desk.led, pickTargets: [desk.group, chair] };
  });

  return {
    group,
    seats,
    width: W,
    depth: D,
    center: new THREE.Vector3(centerX, 0, 0),
    update: (t) => updatables.forEach((fn) => fn(t)),
  };
}
