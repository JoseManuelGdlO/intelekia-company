import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const STATUS_COLORS = {
  idle: 0x888888,
  trabajando: 0xffcc00,
  listo_para_revision: 0x33cc66,
  error: 0xcc3333,
};

const ROOM_SIZE = 6;
const ROOM_SPACING = 10;
const AVATAR_GAP = 1.5;

export function createScene({ container, departments, onAgentClick }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202030);

  const worldWidth = Math.max(departments.length - 1, 0) * ROOM_SPACING;

  const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 200);
  camera.position.set(worldWidth / 2, 8, 14);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(worldWidth / 2, 1, 0);

  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  scene.add(light);

  const avatarMeshes = {};

  departments.forEach((department, roomIndex) => {
    const roomCenterX = roomIndex * ROOM_SPACING;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x555566 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(roomCenterX, 0, 0);
    scene.add(floor);

    const agentCount = department.agents.length;
    department.agents.forEach((agent, agentIndex) => {
      const offset = agentIndex - (agentCount - 1) / 2;
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.4, 1, 4, 8),
        new THREE.MeshStandardMaterial({ color: STATUS_COLORS.idle })
      );
      mesh.position.set(roomCenterX + offset * AVATAR_GAP, 1, 0);
      mesh.userData.agentId = agent.id;
      scene.add(mesh);
      avatarMeshes[agent.id] = mesh;
    });
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  renderer.domElement.addEventListener('click', (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(Object.values(avatarMeshes));
    if (intersects.length > 0) {
      onAgentClick(intersects[0].object.userData.agentId);
    }
  });

  function updateStatusColors(statusById) {
    Object.entries(avatarMeshes).forEach(([agentId, mesh]) => {
      const estatus = statusById[agentId]?.estatus || 'idle';
      mesh.material.color.setHex(STATUS_COLORS[estatus] || STATUS_COLORS.idle);
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return { updateStatusColors };
}
