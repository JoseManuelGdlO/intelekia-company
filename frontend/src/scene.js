import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { themeFor, hashString, seededRandom, hex } from './world/materials.js';
import { buildRoom, computeRoomSize, WALL_T } from './world/room.js';
import { buildDecorRoom } from './world/decor.js';
import { createCharacter } from './world/character.js';
import { createEntrance, createPlant } from './world/furniture.js';
import { trimShadows } from './world/optimize.js';
import { BRAND } from './world/brand.js';

export const STATUS_COLORS = {
  idle: 0x9aa0a6,
  trabajando: 0xffb020,
  listo_para_revision: 0x22c55e,
  error: 0xef4444,
};

export const STATUS_LABELS = {
  idle: 'Disponible',
  trabajando: 'Trabajando',
  listo_para_revision: 'Listo para revisión',
  error: 'Error',
};

const CORRIDOR_W = 3.0;
const MIN_ROOM_W = 9.5;
const MIN_ROW_D = 7.0;
const BANO_W = 3.8;
const CAFE_MIN_W = 7.0;
const CLICK_DRAG_TOLERANCE = 6;

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/**
 * Planta de la oficina (vista desde arriba, el frente/entrada es +Z):
 *   Desarrollo | pasillo | Diseño
 *   Ventas     | pasillo | Dirección y Reuniones
 *   Recepción  | pasillo | Café · Baño
 *                ENTRADA
 * Los departamentos que no estén en el plano se agregan en filas extra al fondo.
 */
const PLANTA = [
  { left: { dept: 'desarrollo', label: 'Desarrollo' }, right: { dept: 'marketing', label: 'Diseño' } },
  { left: { dept: 'comercial', label: 'Ventas' }, right: { dept: 'administracion', label: 'Dirección y Reuniones' } },
  { left: { decor: 'recepcion', label: 'Recepción' }, right: { decor: 'cafe-bano' } },
];

/** Arma la cuadrícula de filas (del fondo al frente) con lo que cada lugar contiene. */
function planLayout(departments) {
  const byId = new Map(departments.map((d, index) => [d.id, { department: d, index }]));
  const fill = (slot) => {
    if (!slot) return null;
    if (slot.decor) return { ...slot };
    const found = byId.get(slot.dept);
    return found ? { ...found, label: slot.label } : null;
  };
  const mapped = new Set(PLANTA.flatMap((r) => [r.left?.dept, r.right?.dept]).filter(Boolean));
  const extras = departments.map((d, index) => ({ department: d, index })).filter(({ department }) => !mapped.has(department.id));
  const extraRows = [];
  for (let i = 0; i < extras.length; i += 2) extraRows.unshift({ left: extras[i], right: extras[i + 1] || null });
  return [...extraRows, ...PLANTA.map((r) => ({ left: fill(r.left), right: fill(r.right) }))];
}

/** Tamaño mínimo que pide un lugar de la cuadrícula. */
function slotSize(slot) {
  if (!slot) return { width: 0, depth: 0 };
  if (slot.decor === 'cafe-bano') return { width: CAFE_MIN_W + BANO_W + WALL_T, depth: MIN_ROW_D };
  if (slot.decor) return { width: MIN_ROOM_W, depth: MIN_ROW_D };
  return computeRoomSize(slot.department.agents.length);
}

/** Ajusta la cámara de sombras del sol para cubrir justo el edificio y la entrada. */
function fitShadowCamera(sun, bounds) {
  const probe = new THREE.OrthographicCamera();
  probe.position.copy(sun.position);
  probe.lookAt(sun.target.position);
  probe.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  [bounds.minX - 1, bounds.maxX + 1].forEach((x) => [bounds.minZ - 1, bounds.maxZ + 4].forEach((z) => [0, 3].forEach((y) => {
    box.expandByPoint(p.set(x, y, z).applyMatrix4(probe.matrixWorldInverse));
  })));
  Object.assign(sun.shadow.camera, {
    left: box.min.x,
    right: box.max.x,
    bottom: box.min.y,
    top: box.max.y,
    near: Math.max(0.5, -box.max.z - 1),
    far: -box.min.z + 1,
  });
  sun.shadow.camera.updateProjectionMatrix();
}

function createAgentTag(label, accent) {
  const el = document.createElement('div');
  el.className = 'agent-tag status-idle';
  el.style.setProperty('--accent', hex(accent));
  el.innerHTML = `
    <div class="agent-bubble"><span class="bubble-content"></span></div>
    <div class="agent-name"><span class="dot"></span><span class="name"></span></div>
    <div class="agent-state"></div>`;
  el.querySelector('.name').textContent = label;
  return el;
}

const BUBBLES = {
  trabajando: '<span class="typing"><i></i><i></i><i></i></span>',
  listo_para_revision: '✓',
  error: '!',
  coffee: '☕',
};

export function createScene({ container, departments, onAgentClick }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe9e6);
  scene.fog = new THREE.Fog(0xdfe9e6, 45, 110);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  // --- Planta: dos columnas de salas con un pasillo central ---
  const rows = planLayout(departments);
  const colW = { left: MIN_ROOM_W, right: MIN_ROOM_W };
  rows.forEach((r) => ['left', 'right'].forEach((side) => {
    colW[side] = Math.max(colW[side], slotSize(r[side]).width);
  }));
  const rowD = rows.map((r) => Math.max(MIN_ROW_D, slotSize(r.left).depth, slotSize(r.right).depth));
  const totalDepth = rowD.reduce((acc, d) => acc + d + WALL_T, 0);
  const bounds = {
    minX: -CORRIDOR_W / 2 - colW.left - WALL_T,
    maxX: CORRIDOR_W / 2 + colW.right + WALL_T,
    minZ: -totalDepth / 2,
    maxZ: totalDepth / 2,
  };
  const totalWidth = bounds.maxX - bounds.minX;
  const maxDepth = totalDepth;
  const midX = (bounds.minX + bounds.maxX) / 2;
  const colCenter = { left: -CORRIDOR_W / 2 - colW.left / 2, right: CORRIDOR_W / 2 + colW.right / 2 };
  const sideSign = { left: -1, right: 1 };

  const rooms = [];
  const agents = {};
  const pickables = [];

  // Registro compartido para que las personas no se encimen: posiciones y lugares de café.
  const people = new Map(); // agentId -> character
  const spotOwners = new Map(); // roomId -> [{ pos, owner }]
  function crowdFor(agentId, roomId) {
    return {
      others: () => [...people].filter(([id]) => id !== agentId).map(([, c]) => c.root.position),
      reserveSpot() {
        const libres = (spotOwners.get(roomId) || []).filter((s) => !s.owner);
        if (!libres.length) return null;
        const s = libres[Math.floor(Math.random() * libres.length)];
        s.owner = agentId;
        return s.pos.clone();
      },
      releaseSpot() {
        (spotOwners.get(roomId) || []).forEach((s) => {
          if (s.owner === agentId) s.owner = null;
        });
      },
    };
  }

  const decorRooms = [];
  function addDecor(opts) {
    const room = buildDecorRoom(opts);
    scene.add(room.group);
    decorRooms.push(room);
  }

  function buildDepartmentRoom({ department, index, label }, placement) {
    const theme = themeFor(department.id, index);
    const room = buildRoom({ department, theme, label, ...placement });
    scene.add(room.group);
    rooms.push({ id: department.id, ...room });
    spotOwners.set(department.id, (room.spots || []).map((pos) => ({ pos, owner: null })));

    room.seats.forEach(({ agent, seat, route, screen, led, pickTargets }) => {
      const character = createCharacter({
        agentId: agent.id,
        rng: seededRandom(hashString(agent.id) ^ 0x9e3779b9),
        accent: theme.accent,
        crowd: crowdFor(agent.id, department.id),
      });
      character.setSeat(seat, route);
      people.set(agent.id, character);
      scene.add(character.root);

      const tagEl = createAgentTag(agent.label, theme.accent);
      tagEl.addEventListener('click', (e) => {
        e.stopPropagation();
        onAgentClick(agent.id);
      });
      tagEl.addEventListener('pointerenter', () => setHovered(agent.id));
      tagEl.addEventListener('pointerleave', () => setHovered(null));
      const tag = new CSS2DObject(tagEl);
      tag.position.set(0, 0.55, 0);
      character.head.add(tag);

      character.root.traverse((o) => o.isMesh && pickables.push(o));
      pickTargets.forEach((obj) => obj.traverse((o) => o.isMesh && pickables.push(o)));

      agents[agent.id] = {
        character,
        screen,
        led,
        tagEl,
        label: agent.label,
        seat: seat.clone(),
        accent: theme.accent,
        status: 'idle',
        bubbleKey: null,
        talk: null,
        department: department.id,
      };
    });
  }

  let zCursor = bounds.minZ;
  rows.forEach((row, r) => {
    const depth = rowD[r];
    zCursor += WALL_T;
    const centerZ = zCursor + depth / 2;
    zCursor += depth;
    ['left', 'right'].forEach((side) => {
      const slot = row[side];
      if (!slot) return;
      const width = colW[side];
      const centerX = colCenter[side];
      const sx = sideSign[side];
      if (slot.decor === 'cafe-bano') {
        // Café junto al pasillo y baño pequeño hacia el exterior, separados por una partición.
        const cafeW = width - BANO_W - WALL_T;
        const inner = centerX - (sx * width) / 2;
        addDecor({ tipo: 'cafe', label: 'Café', centerX: inner + sx * (cafeW / 2), centerZ, width: cafeW, depth, sideSign: sx });
        addDecor({ tipo: 'bano', label: 'Baño', centerX: inner + sx * (cafeW + WALL_T + BANO_W / 2), centerZ, width: BANO_W, depth, sideSign: sx });
      } else if (slot.decor) {
        addDecor({ tipo: slot.decor, label: slot.label, centerX, centerZ, width, depth, sideSign: sx });
      } else {
        buildDepartmentRoom(slot, { centerX, centerZ, width, depth, sideSign: sx });
      }
    });
  });

  // Pasillo central (piso azul claro como en el plano) con un par de plantas
  const corridor = new THREE.Mesh(new THREE.BoxGeometry(CORRIDOR_W, 0.1, totalDepth), new THREE.MeshStandardMaterial({ color: 0xa9cfee, roughness: 0.6 }));
  corridor.position.set(0, -0.052, 0);
  corridor.receiveShadow = true;
  scene.add(corridor);
  const corridorRng = seededRandom(0x5a551110);
  const rowEdges = rowD.map((_, r) => bounds.minZ + rowD.slice(0, r + 1).reduce((acc, d) => acc + d + WALL_T, 0));
  [
    [-CORRIDOR_W / 2 + 0.4, bounds.minZ + 0.6, 1.1],
    [CORRIDOR_W / 2 - 0.4, rowEdges[rows.length - 3] ?? 0, 1.0],
    [-CORRIDOR_W / 2 + 0.4, rowEdges[rows.length - 2] ?? 0, 0.9],
  ].forEach(([x, z, s]) => {
    const plant = createPlant(corridorRng, s);
    plant.group.position.set(x, 0, z);
    scene.add(plant.group);
    decorRooms.push({ update: plant.update });
  });

  // Entrada con tapete y tótem de Intelekia, al frente del pasillo
  const entrance = createEntrance();
  entrance.position.set(0, 0, bounds.maxZ + 1.75);
  scene.add(entrance);

  // Piso exterior
  const ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(totalWidth, maxDepth) * 1.6 + 20, 48), new THREE.MeshStandardMaterial({ color: 0xcdd8d4, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.11;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Luces ---
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9b79c, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(midX - totalWidth * 0.3 - 6, 22, maxDepth * 0.6 + 10);
  sun.target.position.set(midX, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  fitShadowCamera(sun, bounds);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // --- Cámara ---
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 250);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.minDistance = 2.5;
  controls.maxDistance = 70;
  controls.screenSpacePanning = true;

  const overviewDir = new THREE.Vector3(0.12, 1.05, 1).normalize();
  function overviewDistance() {
    const aspect = camera.aspect;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    // La planta se ve inclinada: su profundidad aparente se reduce con la elevación de la cámara.
    const fitH = ((maxDepth + 7) * overviewDir.y * 1.15 + 4) / (2 * Math.tan(vFov / 2));
    const fitW = (totalWidth * 1.3) / (2 * Math.tan(vFov / 2) * aspect);
    return Math.max(fitH, fitW, 8);
  }
  const overviewTarget = new THREE.Vector3(midX, 0.6, 2.2);
  controls.target.copy(overviewTarget);
  camera.position.copy(controls.target).addScaledVector(overviewDir, overviewDistance());

  let tween = null;
  function flyTo(target, distance, dir) {
    const direction = (dir || camera.position.clone().sub(controls.target)).clone().normalize();
    tween = {
      fromT: controls.target.clone(),
      fromP: camera.position.clone(),
      toT: target.clone(),
      toP: target.clone().addScaledVector(direction, distance),
      t: 0,
      dur: 1.1,
    };
  }
  controls.addEventListener('start', () => {
    tween = null;
  });

  // --- Interacción ---
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoveredId = null;
  let selectedId = null;
  let downPos = null;

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    return hit ? hit.object.userData.agentId : null;
  }

  function setHovered(agentId) {
    if (hoveredId === agentId) return;
    if (hoveredId && agents[hoveredId]) {
      agents[hoveredId].character.setHovered(false);
      agents[hoveredId].tagEl.classList.remove('hover');
    }
    hoveredId = agentId;
    if (agentId && agents[agentId]) {
      agents[agentId].character.setHovered(true);
      agents[agentId].tagEl.classList.add('hover');
    }
    renderer.domElement.style.cursor = agentId ? 'pointer' : '';
  }

  renderer.domElement.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    setHovered(pick(e));
  });
  renderer.domElement.addEventListener('pointerleave', () => setHovered(null));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > CLICK_DRAG_TOLERANCE || e.button !== 0) return;
    const agentId = pick(e);
    if (agentId) onAgentClick(agentId);
  });

  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  // --- Estado de agentes ---
  function refreshTag(entry) {
    const { tagEl, status, character } = entry;
    const activity = status === 'idle' ? character.activity() : null;
    const talk = entry.talk;
    const key = talk ? `talk-${talk.role}-${talk.other}` : activity || status;
    if (entry.bubbleKey === key && tagEl.dataset.status === status) return;
    entry.bubbleKey = key;
    tagEl.dataset.status = status;
    tagEl.className = `agent-tag status-${status}${tagEl.classList.contains('hover') ? ' hover' : ''}${tagEl.classList.contains('selected') ? ' selected' : ''}${talk ? ' talking' : ''}`;
    let stateText = activity === 'coffee' ? 'Por un café' : STATUS_LABELS[status] || status;
    if (talk) stateText = talk.role === 'asks' ? `Consultando a ${talk.other}` : `Respondiendo a ${talk.other}`;
    tagEl.querySelector('.agent-state').textContent = stateText;
    const bubble = talk ? (talk.role === 'asks' ? '💬' : '💡') : BUBBLES[key];
    tagEl.querySelector('.bubble-content').innerHTML = bubble || '';
    tagEl.classList.toggle('has-bubble', Boolean(bubble));
  }

  function updateStatusColors(statusById) {
    Object.entries(agents).forEach(([agentId, entry]) => {
      const status = statusById[agentId]?.estatus || 'idle';
      entry.status = STATUS_COLORS[status] !== undefined ? status : 'idle';
      entry.character.setStatus(entry.status);
      const color = STATUS_COLORS[entry.status];
      entry.character.ringMaterial.color.setHex(color);
      entry.led.material.color.setHex(color);
      refreshTag(entry);
    });
  }

  function setSelected(agentId) {
    if (selectedId && agents[selectedId]) {
      agents[selectedId].character.setSelected(false);
      agents[selectedId].tagEl.classList.remove('selected');
    }
    selectedId = agentId && agents[agentId] ? agentId : null;
    if (selectedId) {
      agents[selectedId].character.setSelected(true);
      agents[selectedId].tagEl.classList.add('selected');
    }
  }

  const tmp = new THREE.Vector3();
  function focusAgent(agentId) {
    const entry = agents[agentId];
    if (!entry) return;
    entry.character.focusPoint(tmp);
    tmp.y -= 0.25;
    flyTo(tmp, 4.2, new THREE.Vector3(0.35, 0.45, 1));
  }

  function focusDepartment(departmentId) {
    const room = rooms.find((r) => r.id === departmentId);
    if (!room) return;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const dist = Math.max(
      (room.depth * 1.45) / (2 * Math.tan(vFov / 2)),
      (room.width * 1.1) / (2 * Math.tan(vFov / 2) * camera.aspect)
    );
    // Más desde arriba para que el muro de la sala de enfrente no tape el frente de esta.
    flyTo(room.center.clone().setY(0.6), dist, new THREE.Vector3(0.1, 1.25, 1));
  }

  function focusOverview() {
    flyTo(overviewTarget, overviewDistance(), overviewDir);
  }

  // --- Red de comunicación (quién puede consultar a quién) ---
  const networkGroup = new THREE.Group();
  scene.add(networkGroup);
  const BRAND_LIGHT = 0x3ee0b0;

  function disposeGroup(group) {
    group.children.slice().forEach((child) => {
      child.geometry?.dispose();
      child.material?.dispose();
      group.remove(child);
    });
  }

  function arcBetween(a, b) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += 0.5 + a.distanceTo(b) * 0.16;
    return new THREE.QuadraticBezierCurve3(a, mid, b);
  }

  function arrowAt(curve, u, color) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 12), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    cone.position.copy(curve.getPointAt(u));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(u).normalize());
    return cone;
  }

  /** Dibuja arcos punteados para cada par permitido. `permitidos`: { agentId: [ids] } o null para ocultar. */
  function showNetwork(permitidos) {
    disposeGroup(networkGroup);
    if (!permitidos) return;
    const pairs = new Map();
    Object.entries(permitidos).forEach(([from, targets]) => {
      if (!agents[from]) return;
      targets.forEach((to) => {
        if (!agents[to]) return;
        const key = [from, to].sort().join('|');
        const pair = pairs.get(key) || { a: from, b: to, dirs: new Set() };
        pair.dirs.add(`${from}>${to}`);
        pairs.set(key, pair);
      });
    });
    pairs.forEach(({ a, b, dirs }) => {
      const sameArea = agents[a].department === agents[b].department;
      const color = sameArea ? agents[a].accent : BRAND.green;
      const curve = arcBetween(agents[a].seat.clone().setY(2.0), agents[b].seat.clone().setY(2.0));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)),
        new THREE.LineDashedMaterial({ color, dashSize: 0.22, gapSize: 0.12, transparent: true, opacity: 0.85, toneMapped: false })
      );
      line.computeLineDistances();
      networkGroup.add(line);
      if (dirs.has(`${a}>${b}`)) networkGroup.add(arrowAt(curve, 0.88, color));
      if (dirs.has(`${b}>${a}`)) {
        const back = arcBetween(agents[b].seat.clone().setY(2.0), agents[a].seat.clone().setY(2.0));
        networkGroup.add(arrowAt(back, 0.88, color));
      }
    });
  }

  // --- Conversaciones en vivo entre agentes ---
  const talks = new Map();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const TALK_POINTS = 40;

  /** Muestra (o actualiza) una conversación: arco brillante con un mensaje viajando entre ambos. */
  function playConversation(conv) {
    const from = agents[conv.de];
    const to = agents[conv.para];
    if (!from || !to) return;
    let talk = talks.get(conv.id);
    if (!talk) {
      // Si llega ya terminada (ocurrió entre dos consultas), igual se muestra brevemente.
      const line = new THREE.Line(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(TALK_POINTS * 3), 3)),
        new THREE.LineBasicMaterial({ color: BRAND_LIGHT, transparent: true, opacity: 0.95, toneMapped: false })
      );
      line.frustumCulled = false;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 16, 12),
        new THREE.MeshBasicMaterial({ color: BRAND_LIGHT, transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false })
      );
      orb.add(halo);
      scene.add(line, orb);
      talk = { conv, line, orb, doneAt: null };
      talks.set(conv.id, talk);
      from.talk = { role: 'asks', other: to.label, id: conv.id };
      to.talk = { role: 'answers', other: from.label, id: conv.id };
    }
    talk.conv = conv;
    if (conv.estado !== 'en_curso' && talk.doneAt === null) talk.doneAt = -1; // se fija en el siguiente frame
  }

  function endTalk(id, talk) {
    [talk.line, talk.orb].forEach((obj) => {
      scene.remove(obj);
      obj.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    });
    [talk.conv.de, talk.conv.para].forEach((agentId) => {
      const entry = agents[agentId];
      if (entry?.talk?.id === id) {
        entry.talk = null;
        entry.character.setLookAt(null);
      }
    });
    talks.delete(id);
  }

  function updateTalks(t) {
    talks.forEach((talk, id) => {
      const from = agents[talk.conv.de];
      const to = agents[talk.conv.para];
      if (talk.doneAt === -1) talk.doneAt = t;
      from.character.focusPoint(tmpA);
      to.character.focusPoint(tmpB);
      tmpA.y += 0.45;
      tmpB.y += 0.45;
      if (from.talk?.id === id) from.character.setLookAt(tmpB.clone());
      if (to.talk?.id === id) to.character.setLookAt(tmpA.clone());

      const curve = arcBetween(tmpA.clone(), tmpB.clone());
      const pos = talk.line.geometry.attributes.position;
      for (let i = 0; i < TALK_POINTS; i += 1) {
        const p = curve.getPoint(i / (TALK_POINTS - 1));
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;

      if (talk.doneAt === null) {
        // Pregunta viajando hacia el compañero, una y otra vez mientras responde.
        talk.orb.position.copy(curve.getPoint((t * 0.6) % 1));
        talk.orb.scale.setScalar(1 + Math.sin(t * 8) * 0.12);
      } else {
        // Respuesta regresando a quien preguntó y luego se desvanece.
        const since = t - talk.doneAt;
        talk.orb.position.copy(curve.getPoint(1 - Math.min(since / 1.3, 1)));
        talk.orb.material.color.setHex(talk.conv.estado === 'error' ? 0xef4444 : 0xffe066);
        const fade = Math.max(0, 1 - Math.max(0, since - 1.3) / 2);
        talk.line.material.opacity = 0.95 * fade;
        talk.orb.visible = fade > 0.05;
        if (since > 3.6) endTalk(id, talk);
      }
    });
  }

  // --- Loop (pausa con la pestaña oculta y calidad adaptable) ---
  const clock = new THREE.Clock();
  const BLUR_IDLE_MS = 20000; // tras 20 s sin foco se dibuja a ~2 cuadros por segundo
  let rafId = null;
  let blurredAt = null;
  let lastFrameAt = 0;
  const perf = { frames: 0, since: performance.now(), degraded: false, frame: 0 };

  /** Si el promedio de ~3 s baja de 30 fps: menos resolución y sombras cada dos cuadros. */
  function adaptQuality(now) {
    perf.frames += 1;
    const elapsed = now - perf.since;
    if (elapsed < 3000) return;
    const fps = (perf.frames * 1000) / elapsed;
    perf.frames = 0;
    perf.since = now;
    if (perf.degraded || fps >= 30) return;
    perf.degraded = true;
    renderer.setPixelRatio(1);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    Object.values(agents).forEach((entry) => trimShadows(entry.character.root, { minSize: 0.35, minThickness: 0.08 }));
  }

  function resetPerfWindow() {
    perf.frames = 0;
    perf.since = performance.now();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    } else if (rafId === null) {
      clock.getDelta(); // no "saltar" el tiempo acumulado mientras estuvo oculta
      resetPerfWindow();
      animate();
    }
  });
  window.addEventListener('blur', () => {
    blurredAt = performance.now();
  });
  window.addEventListener('focus', () => {
    blurredAt = null;
    resetPerfWindow();
  });

  function animate() {
    rafId = requestAnimationFrame(animate);
    const now = performance.now();
    if (blurredAt !== null && now - blurredAt > BLUR_IDLE_MS) {
      if (now - lastFrameAt < 500) return;
      resetPerfWindow();
    } else {
      adaptQuality(now);
    }
    lastFrameAt = now;
    perf.frame += 1;
    if (perf.degraded) renderer.shadowMap.needsUpdate = perf.frame % 2 === 0;
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;

    if (tween) {
      tween.t += rawDt / tween.dur;
      const e = easeInOutCubic(Math.min(tween.t, 1));
      controls.target.lerpVectors(tween.fromT, tween.toT, e);
      camera.position.lerpVectors(tween.fromP, tween.toP, e);
      if (tween.t >= 1) tween = null;
    }

    Object.values(agents).forEach((entry) => {
      entry.character.update(dt, t, camera.position);
      entry.screen.update(entry.status, t);
      refreshTag(entry);
    });
    rooms.forEach((room) => room.update(t));
    decorRooms.forEach((room) => room.update(t));
    updateTalks(t);

    controls.update();
    labelRenderer.domElement.classList.toggle('far', camera.position.distanceTo(controls.target) > 15);
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();

  function setAgentLabel(agentId, label) {
    const entry = agents[agentId];
    if (!entry) return;
    entry.label = label;
    entry.tagEl.querySelector('.name').textContent = label;
  }

  return { updateStatusColors, setAgentLabel, setSelected, focusAgent, focusDepartment, focusOverview, showNetwork, playConversation };
}
