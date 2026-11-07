import * as THREE from 'three';
import { mat, pick, at, box, sphere, capsule, cyl } from './materials.js';

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd9a066, 0xb07a4f];
const HAIR = [0x2c1b10, 0x4a2c17, 0x0f0f0f, 0x8b5a2b, 0xc89f5d, 0x6b4423, 0x9a3b2a, 0x1b1b2f];
const SHIRTS = [0x3b6ea5, 0xf2f2f2, 0x2f3e46, 0x7a4fa0, 0xe07a5f, 0x4d9078, 0xf4d35e, 0x264653, 0xb5838d];
const PANTS = [0x22313f, 0x3d3d3d, 0x5a4632, 0x1d3557, 0x6c757d, 0x2b2d42];
const SHOES = [0x1a1a1a, 0x5b3a29, 0xeeeeee, 0x7b2d26];
const STYLES = ['short', 'long', 'bun', 'curly', 'ponytail', 'bald', 'side', 'short', 'long'];

const SEATED_PELVIS = 0.5;
const STANDING_PELVIS = 0.9;
const WALK_SPEED = 1.15;
const HALF_PI = Math.PI / 2;
const JOINTS = ['pelvisY', 'torsoX', 'headX', 'headY', 'headZ', 'sX0', 'sZ0', 'eX0', 'sX1', 'sZ1', 'eX1', 'hX0', 'kX0', 'hX1', 'kX1'];

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function blob(r, material, [x, y, z], [sx, sy, sz]) {
  const m = at(sphere(r, material, 8, 6), x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}

function buildHair(style, hairMat, head) {
  const cap = (thetaLen = Math.PI * 0.55) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.172, 20, 14, 0, Math.PI * 2, 0, thetaLen), hairMat);
    m.castShadow = true;
    m.position.y = 0.17;
    m.rotation.x = -0.25;
    m.scale.set(1.02, 1.08, 1.05);
    return m;
  };
  if (style === 'bald') {
    // Herradura de cabello solo en la nuca y los lados
    const ring = new THREE.Mesh(new THREE.SphereGeometry(0.168, 18, 10, Math.PI * 0.85, Math.PI * 1.3, Math.PI * 0.38, Math.PI * 0.2), hairMat);
    ring.position.y = 0.16;
    head.add(ring);
    return;
  }
  head.add(cap());
  if (style === 'long') {
    const back = capsule(0.13, 0.18, hairMat);
    back.scale.set(1.25, 1, 0.6);
    head.add(at(back, 0, 0.06, -0.08));
  } else if (style === 'bun') {
    head.add(at(sphere(0.075, hairMat, 12, 10), 0, 0.33, -0.08));
  } else if (style === 'curly') {
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      head.add(at(sphere(0.06, hairMat, 8, 6), Math.cos(a) * 0.15, 0.25 + Math.sin(i * 1.7) * 0.03, Math.sin(a) * 0.15 - 0.02));
    }
    head.add(at(sphere(0.08, hairMat, 10, 8), 0, 0.33, 0));
  } else if (style === 'ponytail') {
    const tail = capsule(0.045, 0.18, hairMat);
    tail.rotation.x = 0.5;
    head.add(at(tail, 0, 0.18, -0.2));
  } else if (style === 'side') {
    const fringe = sphere(0.09, hairMat, 10, 8);
    fringe.scale.set(1.4, 0.5, 0.9);
    head.add(at(fringe, 0.05, 0.29, 0.08));
  }
}

/**
 * Persona low-poly procedural. La apariencia sale del id del agente (determinista).
 * Mira hacia +z en su espacio local; su origen está en el piso entre los pies.
 */
export function createCharacter({ agentId, rng, accent }) {
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
  const skinMat = mat(look.skin, { roughness: 0.65 });
  const hairMat = mat(look.hair, { roughness: 0.85 });
  const shirtMat = mat(look.shirt, { roughness: 0.8 });
  const pantsMat = mat(look.pants, { roughness: 0.85 });
  const shoeMat = mat(look.shoes, { roughness: 0.5 });
  const darkMat = mat(0x1a1a22, { roughness: 0.3 });

  const root = new THREE.Group();
  root.userData.agentId = agentId;
  const pelvis = new THREE.Group();
  root.add(pelvis);
  pelvis.add(at(box(0.34, 0.16, 0.22, pantsMat), 0, 0, 0));

  const torso = new THREE.Group();
  torso.position.y = 0.06;
  torso.scale.set(look.build, look.height, look.build);
  pelvis.add(torso);
  const chest = capsule(0.17, 0.26, shirtMat);
  chest.scale.set(1.05, 1, 0.72);
  torso.add(at(chest, 0, 0.24, 0));
  // Gafete con el color del departamento
  torso.add(at(box(0.06, 0.08, 0.01, mat(0xffffff)), 0.08, 0.27, 0.125));
  torso.add(at(box(0.06, 0.025, 0.012, mat(0x198f70)), 0.08, 0.3, 0.126));
  torso.add(at(box(0.06, 0.012, 0.012, mat(accent)), 0.08, 0.24, 0.126));
  torso.add(at(cyl(0.06, 0.065, 0.1, skinMat, 12), 0, 0.5, 0));

  const head = new THREE.Group();
  head.position.y = 0.55;
  torso.add(head);
  const skull = sphere(0.16, skinMat, 22, 16);
  skull.scale.set(1, 1.08, 1);
  head.add(at(skull, 0, 0.16, 0));
  const eyes = [-1, 1].map((s) => {
    const eye = sphere(0.022, darkMat, 10, 8);
    head.add(at(eye, s * 0.056, 0.175, 0.142));
    const brow = box(0.055, 0.012, 0.012, hairMat);
    brow.rotation.z = s * -0.08;
    head.add(at(brow, s * 0.058, 0.222, 0.145));
    head.add(blob(0.036, skinMat, [s * 0.16, 0.155, 0], [0.5, 1, 0.8]));
    return eye;
  });
  head.add(at(sphere(0.024, skinMat, 8, 6), 0, 0.14, 0.16));
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 12, Math.PI), mat(0x8a3b3b));
  mouth.rotation.z = Math.PI;
  head.add(at(mouth, 0, 0.1, 0.148));
  const blush = mat(0xf28b82, { roughness: 0.9 });
  [-1, 1].forEach((s) => head.add(blob(0.022, blush, [s * 0.09, 0.12, 0.13], [1, 0.6, 0.3])));
  buildHair(look.style, hairMat, head);
  if (look.beard) {
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.4), hairMat);
    beard.position.set(0, 0.15, 0.015);
    head.add(beard);
  }
  if (look.glasses) {
    const frameMat = mat(0x111111, { roughness: 0.3 });
    [-1, 1].forEach((s) => head.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 6, 18), frameMat), s * 0.058, 0.175, 0.162)));
    head.add(at(box(0.04, 0.008, 0.008, frameMat), 0, 0.18, 0.165));
  }

  const sleeveMat = look.longSleeves ? shirtMat : skinMat;
  const arms = [-1, 1].map((s) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.23, 0.42, 0);
    torso.add(shoulder);
    shoulder.add(at(capsule(0.058, 0.2, shirtMat), 0, -0.13, 0));
    const elbow = new THREE.Group();
    elbow.position.y = -0.27;
    shoulder.add(elbow);
    elbow.add(at(capsule(0.05, 0.17, sleeveMat), 0, -0.11, 0));
    const hand = sphere(0.052, skinMat, 10, 8);
    elbow.add(at(hand, 0, -0.25, 0));
    return { shoulder, elbow, hand, side: s };
  });

  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.1, -0.02, 0);
    pelvis.add(hip);
    hip.add(at(capsule(0.075, 0.28, pantsMat), 0, -0.19, 0));
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    knee.add(at(capsule(0.065, 0.28, pantsMat), 0, -0.19, 0));
    knee.add(at(box(0.11, 0.07, 0.22, shoeMat), 0, -0.42, 0.04));
    return { hip, knee };
  });

  // Taza que carga cuando va por café
  const heldMug = new THREE.Group();
  heldMug.add(at(cyl(0.04, 0.036, 0.09, mat(0x198f70, { roughness: 0.35 }), 14), 0, 0, 0));
  heldMug.add(at(cyl(0.034, 0.034, 0.005, mat(0x4a2c17), 14), 0, 0.04, 0));
  heldMug.position.set(0, -0.04, 0.05);
  heldMug.visible = false;
  arms[1].hand.add(heldMug);

  // Anillo de estatus en el piso
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 48), ringMat);
  ring.rotation.x = -HALF_PI;
  ring.position.y = 0.012;
  ring.renderOrder = 2;
  root.add(ring);

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
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

  function think(dt, t) {
    const out = state.mode !== 'seated';
    if (out && state.status !== 'idle' && !state.returning && state.mode !== 'toSit') {
      if (state.mode === 'toStand') state.mode = 'seated';
      else startReturn();
    }

    switch (state.mode) {
      case 'seated':
        if (state.status === 'idle' && state.route.length && t > state.nextOutingAt) {
          state.mode = 'toStand';
          state.timer = 0.7;
          state.returning = false;
          state.passed = [];
          state.path = state.route.map((p) => p.clone());
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
        if (dist < 0.04) {
          root.position.x = wp.x;
          root.position.z = wp.z;
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
        } else {
          const step = Math.min(dist, WALK_SPEED * dt);
          root.position.x += (dx / dist) * step;
          root.position.z += (dz / dist) * step;
          state.targetYaw = Math.atan2(dx, dz);
          state.walkPhase += dt * WALK_SPEED * 6.2;
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
