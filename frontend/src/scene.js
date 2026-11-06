import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const STATUS_COLORS = {
  idle: 0x888888,
  trabajando: 0xffcc00,
  listo_para_revision: 0x33cc66,
  error: 0xcc3333,
};

export function createScene({ container, agents, onAgentClick }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202030);

  const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 4, 7);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);

  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  scene.add(light);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x555566 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const avatarMeshes = {};

  agents.forEach((agent, index) => {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 1, 4, 8),
      new THREE.MeshStandardMaterial({ color: STATUS_COLORS.idle })
    );
    mesh.position.set(index === 0 ? -1.5 : 1.5, 1, 0);
    mesh.userData.agentId = agent.id;
    scene.add(mesh);
    avatarMeshes[agent.id] = mesh;
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
