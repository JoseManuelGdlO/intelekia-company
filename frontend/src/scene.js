import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { themeFor, hashString, seededRandom, hex } from './world/materials.js';
import { buildRoom, computeRoomSize } from './world/room.js';
import { createCharacter } from './world/character.js';
import { createEntrance } from './world/furniture.js';
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

const ROOM_GAP = 1.4;
const CLICK_DRAG_TOLERANCE = 6;

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  // --- Oficinas en fila a lo largo de X ---
  const sizes = departments.map((d) => computeRoomSize(d.agents.length));
  const totalWidth = sizes.reduce((acc, s) => acc + s.width, 0) + ROOM_GAP * Math.max(departments.length - 1, 0);
  const maxDepth = Math.max(...sizes.map((s) => s.depth), 6);
  let cursor = -totalWidth / 2;

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

  departments.forEach((department, index) => {
    const theme = themeFor(department.id, index);
    const { width } = sizes[index];
    const room = buildRoom({ department, theme, centerX: cursor + width / 2 });
    cursor += width + ROOM_GAP;
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
  });

  // Entrada con tapete y tótem de Intelekia
  const entrance = createEntrance();
  entrance.position.set(0, 0, maxDepth / 2 + 2.6);
  scene.add(entrance);

  // Piso exterior / pasillo
  const ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(totalWidth, maxDepth) * 1.6 + 20, 64), new THREE.MeshStandardMaterial({ color: 0xcdd8d4, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.11;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Luces ---
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9b79c, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(-totalWidth * 0.3 - 6, 18, maxDepth + 10);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const half = Math.max(totalWidth, maxDepth) / 2 + 4;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 80 });
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

  const overviewDir = new THREE.Vector3(0.18, 0.78, 1).normalize();
  function overviewDistance() {
    const aspect = camera.aspect;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const fitH = ((maxDepth + 5) * 1.1) / (2 * Math.tan(vFov / 2));
    const fitW = (totalWidth * 1.3) / (2 * Math.tan(vFov / 2) * aspect);
    return Math.max(fitH, fitW, 8);
  }
  const overviewTarget = new THREE.Vector3(0, 0.6, 1.4);
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
      (room.depth * 1.3) / (2 * Math.tan(vFov / 2)),
      (room.width * 1.1) / (2 * Math.tan(vFov / 2) * camera.aspect)
    );
    flyTo(room.center.clone().setY(0.6), dist, new THREE.Vector3(0.1, 0.85, 1));
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

  // --- Loop ---
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
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
