import * as THREE from 'three';
import { mat, pick, at, box, rbox, sphere, cyl, shade } from './materials.js';
import { keepDynamic, mergeStatic } from './optimize.js';

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd9a066, 0xb07a4f];
const HAIR = [0x2c1b10, 0x4a2c17, 0x0f0f0f, 0x8b5a2b, 0xc89f5d, 0x6b4423, 0x9a3b2a, 0x1b1b2f];
const SHIRTS = [0x3b6ea5, 0xf2f2f2, 0x2f3e46, 0x7a4fa0, 0xe07a5f, 0x4d9078, 0xf4d35e, 0x264653, 0xb5838d];
const PANTS = [0x22313f, 0x3d3d3d, 0x5a4632, 0x1d3557, 0x6c757d, 0x2b2d42];
const SHOES = [0x1a1a1a, 0x5b3a29, 0xeeeeee, 0x7b2d26];
const STYLES = ['short', 'long', 'bun', 'curly', 'ponytail', 'bald', 'side', 'short', 'long'];

const SEATED_PELVIS = 0.5;
const STANDING_PELVIS = 0.9;
const WALK_SPEED = 1.15;
// Distancia mínima entre los centros de dos personas (cuerpo + espacio personal).
const PERSONAL_SPACE = 0.62;
// Si alguien le bloquea el paso más de esto, se rinde y regresa a su lugar.
const MAX_WAIT = 3.5;
// Direcciones alternativas para esquivar (primero hacia su derecha, como en un pasillo).
const DETOURS = [-0.6, 0.6, -1.15, 1.15];
const HALF_PI = Math.PI / 2;
const JOINTS = ['pelvisY', 'torsoX', 'headX', 'headY', 'headZ', 'sX0', 'sZ0', 'eX0', 'sX1', 'sZ1', 'eX1', 'hX0', 'kX0', 'hX1', 'kX1'];

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function blob(r, material, [x, y, z], [sx, sy, sz], segs = [16, 12]) {
  const m = at(sphere(r, material, segs[0], segs[1]), x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}

/** Cápsula con más caras que la genérica: se ve lisa aunque la cámara esté muy cerca. */
function smoothCapsule(r, len, material) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 16), material);
  m.castShadow = true;
  return m;
}

function rgb(n) {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Distancia aproximada entre dos colores (0-441). */
function colorDistance(a, b) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function hairShell(r, hairMat, phiStart, phiLength, thetaStart, thetaLength) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16, phiStart, phiLength, thetaStart, thetaLength), hairMat);
  m.castShadow = true;
  m.position.y = 0.165;
  return m;
}

function buildHair(style, hairMat, head) {
  if (style === 'bald') {
    // Solo una banda corta en la nuca, de oreja a oreja por detrás.
    const band = hairShell(0.172, hairMat, Math.PI * 1.02, Math.PI * 0.96, Math.PI * 0.42, Math.PI * 0.2);
    head.add(band);
    return;
  }
  // Casquete: cubre la coronilla y baja más por detrás que por delante.
  const cap = hairShell(0.178, hairMat, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cap.rotation.x = -0.32;
  cap.scale.set(1.03, 1.06, 1.06);
  head.add(cap);
  // Nuca: media esfera trasera para que no se vea "pegado" por detrás.
  const nape = hairShell(0.176, hairMat, Math.PI, Math.PI, Math.PI * 0.3, Math.PI * 0.35);
  nape.scale.set(1.03, 1.05, 1.06);
  head.add(nape);

  if (style === 'long') {
    const back = smoothCapsule(0.12, 0.2, hairMat);
    back.scale.set(1.35, 1, 0.55);
    head.add(at(back, 0, 0.05, -0.1));
    [-1, 1].forEach((s) => {
      const side = smoothCapsule(0.045, 0.16, hairMat);
      head.add(at(side, s * 0.15, 0.09, -0.02));
    });
  } else if (style === 'bun') {
    head.add(at(sphere(0.07, hairMat, 20, 14), 0, 0.33, -0.1));
  } else if (style === 'curly') {
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * Math.PI * 2;
      const y = 0.24 + Math.sin(i * 1.7) * 0.025;
      if (Math.sin(a) > 0.75) continue; // deja libre la frente
      head.add(at(sphere(0.055, hairMat, 14, 10), Math.cos(a) * 0.155, y, Math.sin(a) * 0.15 - 0.02));
    }
    head.add(at(sphere(0.085, hairMat, 18, 12), 0, 0.31, -0.02));
  } else if (style === 'ponytail') {
    const tie = sphere(0.035, hairMat, 14, 10);
    head.add(at(tie, 0, 0.24, -0.17));
    const tail = smoothCapsule(0.042, 0.17, hairMat);
    tail.rotation.x = 0.35;
    head.add(at(tail, 0, 0.12, -0.21));
  } else if (style === 'side') {
    const fringe = sphere(0.1, hairMat, 20, 14);
    fringe.scale.set(1.45, 0.42, 0.85);
    fringe.rotation.z = -0.2;
    head.add(at(fringe, 0.04, 0.285, 0.085));
  } else {
    // 'short': flequillo corto
    const fringe = sphere(0.1, hairMat, 20, 14);
    fringe.scale.set(1.35, 0.35, 0.7);
    head.add(at(fringe, 0, 0.29, 0.1));
  }
}

/**
 * Persona low-poly procedural. La apariencia sale del id del agente (determinista).
 * Mira hacia +z en su espacio local; su origen está en el piso entre los pies.
 * `crowd` (opcional) le dice dónde están los demás y le reparte lugares libres en la zona de café,
 * para que nunca ocupen el mismo espacio.
 */
export function createCharacter({ agentId, rng, accent, crowd = null }) {
  const look = {
    skin: pick(rng, SKIN),
    hair: pick(rng, HAIR),
    style: pick(rng, STYLES),
    shirt: rng() < 0.45 ? accent : pick(rng, SHIRTS),
    pants: pick(rng, PANTS),
    shoes: pick(rng, SHOES),
    glasses: rng() < 0.35,
    longSleeves: rng() < 0.5,
    beard: rng() < 0.2,
    height: 0.95 + rng() * 0.1,
    build: 0.92 + rng() * 0.16,
  };
  // La camisa nunca del mismo tono que la piel (si no, de lejos parece que no trae ropa).
  if (colorDistance(look.shirt, look.skin) < 120) {
    look.shirt = SHIRTS.filter((c) => colorDistance(c, look.skin) >= 120)[Math.floor(rng() * 4)] || accent;
  }
  const skinMat = mat(look.skin, { roughness: 0.55 });
  const hairMat = mat(look.hair, { roughness: 0.75 });
  const shirtMat = mat(look.shirt, { roughness: 0.82 });
  const collarMat = mat(shade(look.shirt, look.shirt > 0xcccccc ? -0.12 : 0.18), { roughness: 0.8 });
  const pantsMat = mat(look.pants, { roughness: 0.85 });
  const shoeMat = mat(look.shoes, { roughness: 0.45 });
  const irisMat = mat(0x2a1d16, { roughness: 0.2 });
  const scleraMat = mat(0xffffff, { roughness: 0.35 });
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const root = new THREE.Group();
  root.userData.agentId = agentId;
  const pelvis = new THREE.Group();
  root.add(pelvis);
  const hips = smoothCapsule(0.15, 0.1, pantsMat);
  hips.rotation.z = HALF_PI;
  hips.scale.set(0.75, 1, 0.75);
  pelvis.add(at(hips, 0, 0, 0));
  pelvis.add(at(cyl(0.165, 0.165, 0.035, mat(0x2b2b2b, { roughness: 0.5 }), 24), 0, 0.075, 0)); // cinturón

  const torso = new THREE.Group();
  torso.position.y = 0.06;
  torso.scale.set(look.build, look.height, look.build);
  pelvis.add(torso);
  const chest = smoothCapsule(0.165, 0.24, shirtMat);
  chest.scale.set(1.08, 1, 0.74);
  torso.add(at(chest, 0, 0.25, 0));
  // Hombros redondeados para que los brazos no se vean "pegados".
  [-1, 1].forEach((s) => torso.add(at(sphere(0.075, shirtMat, 18, 12), s * 0.2, 0.42, 0)));
  // Cuello de la camisa
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 10, 24), collarMat);
  collar.rotation.x = HALF_PI;
  torso.add(at(collar, 0, 0.5, 0.005));
  // Gafete con el color del departamento
  torso.add(at(rbox(0.06, 0.08, 0.01, 0.006, mat(0xffffff)), 0.08, 0.28, 0.127));
  torso.add(at(box(0.06, 0.022, 0.012, mat(0x198f70)), 0.08, 0.305, 0.128));
  torso.add(at(box(0.04, 0.008, 0.012, mat(accent)), 0.08, 0.26, 0.128));
  torso.add(at(cyl(0.055, 0.06, 0.1, skinMat, 20), 0, 0.53, 0));

  const head = new THREE.Group();
  head.position.y = 0.56;
  torso.add(head);
  const skull = sphere(0.165, skinMat, 40, 30);
  skull.scale.set(1, 1.06, 0.98);
  head.add(at(skull, 0, 0.16, 0));
  // Orejas
  [-1, 1].forEach((s) => head.add(blob(0.04, skinMat, [s * 0.162, 0.155, -0.005], [0.45, 0.85, 0.65])));
  // Ojos: blanco + iris + brillo (antes eran bolas negras que de cerca se veían raras).
  const eyes = [-1, 1].map((s) => {
    const eye = new THREE.Group();
    eye.position.set(s * 0.058, 0.172, 0.14);
    eye.rotation.y = s * 0.28;
    eye.add(blob(0.029, scleraMat, [0, 0, 0], [1, 1.12, 0.5], [20, 14]));
    eye.add(blob(0.019, irisMat, [0, -0.002, 0.009], [1, 1.05, 0.45], [18, 12]));
    eye.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), shineMat), 0.007, 0.008, 0.0185));
    head.add(eye);
    const brow = smoothCapsule(0.009, 0.04, hairMat);
    brow.rotation.z = HALF_PI + s * 0.12;
    head.add(at(brow, s * 0.06, 0.222, 0.148));
    return eye;
  });
  head.add(blob(0.02, skinMat, [0, 0.138, 0.162], [1, 0.9, 0.85]));
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0055, 8, 20, Math.PI), mat(0x8a3b3b, { roughness: 0.6 }));
  mouth.rotation.set(-0.25, 0, Math.PI);
  head.add(at(mouth, 0, 0.098, 0.151));
  const blush = new THREE.MeshStandardMaterial({ color: 0xf28b82, roughness: 0.9, transparent: true, opacity: 0.45, depthWrite: false });
  [-1, 1].forEach((s) => head.add(blob(0.024, blush, [s * 0.095, 0.122, 0.128], [1, 0.6, 0.35])));
  buildHair(look.style, hairMat, head);
  if (look.beard) {
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.168, 24, 12, Math.PI * 0.05, Math.PI * 0.9, Math.PI * 0.56, Math.PI * 0.32), hairMat);
    beard.position.set(0, 0.16, 0.004);
    beard.castShadow = true;
    head.add(beard);
    head.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 18, Math.PI), hairMat), 0, 0.112, 0.152)); // bigote
  }
  if (look.glasses) {
    const frameMat = mat(0x16161c, { roughness: 0.3, metalness: 0.3 });
    [-1, 1].forEach((s) => {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.0045, 8, 28), frameMat);
      lens.rotation.y = s * 0.28;
      head.add(at(lens, s * 0.06, 0.172, 0.163));
    });
    head.add(at(box(0.034, 0.005, 0.005, frameMat), 0, 0.178, 0.17));
  }

  const sleeveMat = look.longSleeves ? shirtMat : skinMat;
  const arms = [-1, 1].map((s) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.22, 0.42, 0);
    torso.add(shoulder);
    shoulder.add(at(smoothCapsule(0.058, 0.19, shirtMat), 0, -0.13, 0));
    const elbow = new THREE.Group();
    elbow.position.y = -0.27;
    shoulder.add(elbow);
    elbow.add(at(sphere(0.05, sleeveMat, 14, 10), 0, 0, 0));
    elbow.add(at(smoothCapsule(0.048, 0.16, sleeveMat), 0, -0.11, 0));
    if (!look.longSleeves) {
      // Manga corta: borde de la manga sobre el brazo
      elbow.parent.add(at(cyl(0.064, 0.066, 0.05, collarMat, 20), 0, -0.2, 0));
    }
    // Mano tipo mitón con pulgar
    const hand = blob(0.048, skinMat, [0, -0.25, 0], [0.85, 1.1, 0.7], [16, 12]);
    hand.add(blob(0.02, skinMat, [-s * 0.03, 0.01, 0.02], [0.9, 1.3, 0.9], [10, 8]));
    elbow.add(hand);
    return { shoulder, elbow, hand, side: s };
  });

  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.09, -0.02, 0);
    pelvis.add(hip);
    hip.add(at(smoothCapsule(0.074, 0.28, pantsMat), 0, -0.19, 0));
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    knee.add(at(sphere(0.07, pantsMat, 14, 10), 0, 0, 0));
    knee.add(at(smoothCapsule(0.064, 0.28, pantsMat), 0, -0.19, 0));
    knee.add(at(rbox(0.11, 0.07, 0.22, 0.03, shoeMat), 0, -0.42, 0.04));
    return { hip, knee };
  });

  // Taza que carga cuando va por café
  const heldMug = new THREE.Group();
  heldMug.add(at(cyl(0.04, 0.036, 0.09, mat(0x198f70, { roughness: 0.35 }), 20), 0, 0, 0));
  heldMug.add(at(cyl(0.034, 0.034, 0.005, mat(0x4a2c17), 20), 0, 0.04, 0));
  heldMug.position.set(0, -0.04, 0.05);
  heldMug.visible = false;
  arms[1].hand.add(heldMug);

  // Anillo de estatus en el piso
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 64), ringMat);
  ring.rotation.x = -HALF_PI;
  ring.position.y = 0.012;
  ring.renderOrder = 2;
  root.add(ring);

  // Rendimiento: cada articulación queda aparte y sus piezas fijas se fusionan en pocas mallas.
  const joints = [pelvis, torso, head, ...arms.flatMap((a) => [a.shoulder, a.elbow]), ...legs.flatMap((l) => [l.hip, l.knee])];
  [...joints, ...eyes, ...arms.map((a) => a.hand), heldMug, ring].forEach(keepDynamic);
  [root, ...joints, ...eyes].forEach(mergeStatic);

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.material !== shineMat && o.material !== blush;
      o.userData.agentId = agentId;
    }
  });
  ring.castShadow = false;

  const cur = Object.fromEntries(JOINTS.map((j) => [j, 0]));
  cur.pelvisY = SEATED_PELVIS;
  cur.hX0 = -HALF_PI;
  cur.hX1 = -HALF_PI;
  cur.kX0 = HALF_PI;
  cur.kX1 = HALF_PI;

  const state = {
    status: 'idle',
    mode: 'seated',
    seat: new THREE.Vector3(),
    route: [],
    path: [],
    passed: [],
    returning: false,
    timer: 0,
    spotTime: 0,
    targetYaw: 0,
    walkPhase: 0,
    nextOutingAt: 8 + rng() * 35,
    idleAction: 'rest',
    idleActionUntil: 0,
    nextBlink: 1 + rng() * 3,
    blinkUntil: 0,
    hovered: false,
    selected: false,
    lookAt: null,
    seed: rng() * 100,
    waited: 0,
  };

  function setSeat(position, route) {
    state.seat.copy(position);
    state.route = route;
    root.position.copy(position);
    root.rotation.y = 0;
  }

  function setStatus(status) {
    state.status = status || 'idle';
  }

  function startReturn() {
    state.returning = true;
    state.path = [...state.passed].reverse().map((p) => p.clone());
    state.path.push(state.seat.clone());
    state.mode = 'walking';
    state.passed = [];
  }

  /** ¿Se puede parar en (x, z) sin invadir el espacio de nadie? */
  function isFree(x, z) {
    if (!crowd) return true;
    const here = root.position;
    return crowd.others().every((o) => {
      const after = Math.hypot(o.x - x, o.z - z);
      if (after >= PERSONAL_SPACE) return true;
      // Si ya estaban encimados (p. ej. al cargar), solo se permite alejarse.
      return after > Math.hypot(o.x - here.x, o.z - here.z) + 1e-4;
    });
  }

  /** Avanza hacia (ux, uz); si alguien estorba, prueba rodearlo. Devuelve si se movió. */
  function tryStep(ux, uz, step) {
    const options = [0, ...DETOURS];
    for (const angle of options) {
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      const vx = ux * c + uz * sn;
      const vz = -ux * sn + uz * c;
      const len = angle === 0 ? step : step * 0.75;
      const nx = root.position.x + vx * len;
      const nz = root.position.z + vz * len;
      if (isFree(nx, nz)) {
        root.position.x = nx;
        root.position.z = nz;
        state.targetYaw = Math.atan2(vx, vz);
        return true;
      }
    }
    return false;
  }

  /** Paso lateral o hacia atrás (orden aleatorio) para destrabar a dos que se bloquean. */
  function sidestep(ux, uz, step) {
    const angles = [HALF_PI, -HALF_PI, Math.PI * 0.75, -Math.PI * 0.75, Math.PI].sort(() => Math.random() - 0.5);
    for (const angle of angles) {
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      const nx = root.position.x + (ux * c + uz * sn) * step;
      const nz = root.position.z + (-ux * sn + uz * c) * step;
      if (isFree(nx, nz)) {
        root.position.x = nx;
        root.position.z = nz;
        return true;
      }
    }
    return false;
  }

  function think(dt, t) {
    const out = state.mode !== 'seated';
    if (out && state.status !== 'idle' && !state.returning && state.mode !== 'toSit') {
      if (state.mode === 'toStand') state.mode = 'seated';
      else startReturn();
    }

    switch (state.mode) {
      case 'seated':
        if (state.status === 'idle' && state.route.length && t > state.nextOutingAt) {
          // Pide un lugar libre en la zona de café; si están todos ocupados, lo intenta más tarde.
          const spot = crowd ? crowd.reserveSpot() : null;
          if (crowd && !spot) {
            state.nextOutingAt = t + 10 + Math.random() * 15;
            break;
          }
          state.mode = 'toStand';
          state.timer = 0.7;
          state.returning = false;
          state.passed = [];
          state.waited = 0;
          state.path = state.route.map((p) => p.clone());
          if (spot) state.path.push(new THREE.Vector3(spot.x, 0, state.path[state.path.length - 1].z), spot);
        }
        break;
      case 'toStand':
        state.timer -= dt;
        if (state.timer <= 0) state.mode = 'walking';
        break;
      case 'walking': {
        const wp = state.path[0];
        if (!wp) break;
        const dx = wp.x - root.position.x;
        const dz = wp.z - root.position.z;
        const dist = Math.hypot(dx, dz);
        const arrived = () => {
          state.path.shift();
          if (!state.returning) state.passed.push(wp);
          if (!state.path.length) {
            if (state.returning) {
              state.mode = 'toSit';
              state.timer = 0.8;
              state.targetYaw = 0;
            } else {
              state.mode = 'atSpot';
              state.timer = 6 + Math.random() * 5;
              state.spotTime = 0;
            }
          }
        };
        if (dist < 0.04) {
          // Se acomoda en el punto exacto solo si no invade a nadie.
          if (isFree(wp.x, wp.z)) {
            root.position.x = wp.x;
            root.position.z = wp.z;
          }
          arrived();
        } else {
          const step = Math.min(dist, WALK_SPEED * dt);
          const moved = tryStep(dx / dist, dz / dist, step);
          if (moved) {
            state.waited = 0;
            state.walkPhase += dt * WALK_SPEED * 6.2;
          } else if (state.path.length > 1 && dist < PERSONAL_SPACE + 0.15) {
            // Alguien está parado sobre un punto intermedio de la ruta: lo da por alcanzado.
            arrived();
          } else {
            // Bloqueado: espera mirando hacia donde iba.
            state.targetYaw = Math.atan2(dx, dz);
            state.waited += dt;
            if (state.waited > 1.2 && sidestep(dx / dist, dz / dist, WALK_SPEED * dt * 0.6)) {
              // Se hizo a un lado para destrabar un cara a cara.
              state.walkPhase += dt * WALK_SPEED * 3;
            }
            if (state.waited > MAX_WAIT && !state.returning) {
              state.waited = 0;
              startReturn();
            }
          }
        }
        break;
      }
      case 'atSpot':
        state.spotTime += dt;
        state.timer -= dt;
        state.targetYaw = state.spotTime < 1.8 ? Math.PI : 0;
        heldMug.visible = state.spotTime > 1.6;
        if (state.timer <= 0) startReturn();
        break;
      case 'toSit':
        state.timer -= dt;
        if (state.timer <= 0) {
          state.mode = 'seated';
          state.returning = false;
          crowd?.releaseSpot();
          heldMug.visible = false;
          state.nextOutingAt = t + 30 + Math.random() * 60;
        }
        break;
      default:
        break;
    }

    root.rotation.y += angleDiff(state.targetYaw, root.rotation.y) * Math.min(1, dt * 7);
  }

  function setArm(p, i, sx, outward, ex) {
    const s = arms[i].side;
    p[`sX${i}`] = sx;
    p[`sZ${i}`] = s * outward;
    p[`eX${i}`] = ex;
  }

  function pose(t, cameraPos) {
    const p = {
      pelvisY: SEATED_PELVIS,
      torsoX: 0,
      headX: 0,
      headY: 0,
      headZ: 0,
      hX0: -HALF_PI,
      hX1: -HALF_PI,
      kX0: HALF_PI,
      kX1: HALF_PI,
    };
    const seated = state.mode === 'seated' || (state.mode === 'toSit' && state.timer < 0.45);
    const k = state.seed;

    if (!seated) {
      p.pelvisY = STANDING_PELVIS;
      p.hX0 = 0;
      p.hX1 = 0;
      p.kX0 = 0.05;
      p.kX1 = 0.05;
      setArm(p, 0, 0.05, 0.08, -0.15);
      setArm(p, 1, 0.05, 0.08, -0.15);
      if (state.mode === 'walking') {
        const ph = state.walkPhase;
        p.hX0 = -Math.sin(ph) * 0.5;
        p.hX1 = Math.sin(ph) * 0.5;
        p.kX0 = 0.1 + Math.max(0, Math.sin(ph + 1.2)) * 0.7;
        p.kX1 = 0.1 + Math.max(0, -Math.sin(ph + 1.2)) * 0.7;
        p.pelvisY = STANDING_PELVIS + Math.abs(Math.cos(ph)) * 0.025;
        setArm(p, 0, Math.sin(ph) * 0.45, 0.08, -0.3);
        if (heldMug.visible) setArm(p, 1, -0.35, 0.05, -1.3);
        else setArm(p, 1, -Math.sin(ph) * 0.45, 0.08, -0.3);
        p.torsoX = 0.05;
      } else if (state.mode === 'atSpot' && heldMug.visible) {
        const sip = Math.sin(state.spotTime * 1.6) > 0.6;
        setArm(p, 1, sip ? -0.7 : -0.35, 0.05, sip ? -2.1 : -1.3);
        p.headX = sip ? -0.2 : 0.05;
        p.headY = Math.sin(t * 0.7 + k) * 0.4;
      }
      return p;
    }

    switch (state.status) {
      case 'trabajando': {
        const type0 = Math.sin(t * 17 + k) * 0.07;
        const type1 = Math.sin(t * 19 + k + 1.3) * 0.07;
        setArm(p, 0, -0.78 + type0, -0.18, -0.85);
        const mouse = Math.sin(t * 0.5 + k) > 0.7;
        setArm(p, 1, mouse ? -0.7 : -0.78 + type1, mouse ? 0.1 : -0.18, mouse ? -0.95 : -0.85);
        p.torsoX = 0.14;
        p.headX = 0.12 + Math.sin(t * 2.3 + k) * 0.03;
        p.headY = Math.sin(t * 0.4 + k) * 0.08;
        break;
      }
      case 'listo_para_revision': {
        const waving = Math.sin(t * 0.9 + k) > 0.1;
        setArm(p, 0, -0.55, -0.1, -0.9);
        if (waving) setArm(p, 1, -0.2, 2.5 + Math.sin(t * 9) * 0.22, -0.4);
        else setArm(p, 1, -0.55, -0.1, -0.9);
        p.headZ = Math.sin(t * 2.2 + k) * 0.08;
        p.headX = -0.05;
        p.torsoX = -0.05;
        break;
      }
      case 'error':
        setArm(p, 0, -2.4, -0.35, -1.5);
        setArm(p, 1, -2.4, -0.35, -1.5);
        p.torsoX = 0.3;
        p.headX = 0.25;
        p.headY = Math.sin(t * 2.5) * 0.3;
        break;
      default: {
        if (t > state.idleActionUntil) {
          const r = Math.random();
          state.idleAction = r < 0.5 ? 'rest' : r < 0.72 ? 'look' : r < 0.86 ? 'think' : 'stretch';
          state.idleActionUntil = t + (state.idleAction === 'rest' ? 3 + Math.random() * 4 : 2.2);
          state.lookDir = Math.random() < 0.5 ? -1 : 1;
        }
        setArm(p, 0, -0.55, -0.1, -0.9);
        setArm(p, 1, -0.55, -0.1, -0.9);
        p.headX = 0.05;
        if (state.idleAction === 'look') {
          p.headY = state.lookDir * 0.7;
        } else if (state.idleAction === 'think') {
          setArm(p, 1, -1.0, -0.2, -2.25);
          p.headX = 0.12;
          p.headZ = -0.1;
        } else if (state.idleAction === 'stretch') {
          setArm(p, 0, -2.9, 0.25, -0.25);
          setArm(p, 1, -2.9, 0.25, -0.25);
          p.torsoX = -0.15;
          p.headX = -0.2;
        }
      }
    }

    // Mira hacia la cámara si está seleccionado, o hacia el compañero con quien conversa.
    const lookTarget = state.selected && cameraPos ? cameraPos : state.lookAt;
    if (lookTarget && state.status !== 'error') {
      const yaw = Math.atan2(lookTarget.x - root.position.x, lookTarget.z - root.position.z);
      p.headY = THREE.MathUtils.clamp(angleDiff(yaw, root.rotation.y), -1.1, 1.1);
      p.headX = -0.08;
    }
    return p;
  }

  function apply() {
    pelvis.position.y = cur.pelvisY;
    torso.rotation.x = cur.torsoX;
    head.rotation.set(cur.headX, cur.headY, cur.headZ);
    arms.forEach((arm, i) => {
      arm.shoulder.rotation.set(cur[`sX${i}`], 0, cur[`sZ${i}`]);
      arm.elbow.rotation.x = cur[`eX${i}`];
    });
    legs.forEach((leg, i) => {
      leg.hip.rotation.x = cur[`hX${i}`];
      leg.knee.rotation.x = cur[`kX${i}`];
    });
  }

  function update(dt, t, cameraPos) {
    think(dt, t);
    const target = pose(t, cameraPos);
    const f = 1 - Math.exp(-dt * 11);
    JOINTS.forEach((j) => {
      cur[j] += (target[j] - cur[j]) * f;
    });
    apply();

    if (t > state.nextBlink) {
      state.blinkUntil = t + 0.12;
      state.nextBlink = t + 2 + Math.random() * 4;
    }
    const blink = t < state.blinkUntil ? 0.15 : 1;
    eyes.forEach((e) => e.scale.set(1, blink, 1));

    let opacity = 0.85;
    if (state.status === 'trabajando') opacity = 0.55 + Math.sin(t * 5) * 0.3;
    if (state.status === 'error') opacity = 0.5 + Math.sin(t * 9) * 0.4;
    ringMat.opacity = opacity;
    const s = state.selected ? 1.25 : state.hovered ? 1.15 : 1;
    ring.scale.setScalar(ring.scale.x + (s - ring.scale.x) * f);
  }

  return {
    root,
    head,
    ringMaterial: ringMat,
    setSeat,
    setStatus,
    update,
    setHovered: (v) => {
      state.hovered = v;
    },
    /** Posición de mundo hacia la que voltea la cabeza (null para dejar de mirar). */
    setLookAt: (v) => {
      state.lookAt = v;
    },
    setSelected: (v) => {
      state.selected = v;
    },
    /** Lo que está haciendo físicamente (para la etiqueta). */
    activity: () => (state.mode === 'seated' ? null : 'coffee'),
    focusPoint: (target) => head.getWorldPosition(target),
  };
}
