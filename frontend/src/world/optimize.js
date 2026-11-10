import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Marca un objeto (y todo lo que contiene) para que no se fusione: animado, seleccionable o referenciado. */
export function keepDynamic(obj) {
  obj.userData.dynamic = true;
  return obj;
}

const tmpBox = new THREE.Box3();
const tmpSize = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

/**
 * Sombras solo donde importan: los objetos chicos o delgados (tazas, libros, franjas,
 * zoclos, letreros, hojas) dejan de proyectar sombra. Todo sigue recibiendo sombra.
 */
export function trimShadows(root, { minSize = 0.3, minThickness = 0.05 } = {}) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.castShadow) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    tmpBox.copy(o.geometry.boundingBox).getSize(tmpSize);
    o.getWorldScale(tmpScale);
    tmpSize.multiply(tmpScale);
    const largest = Math.max(tmpSize.x, tmpSize.y, tmpSize.z);
    const smallest = Math.min(tmpSize.x, tmpSize.y, tmpSize.z);
    if (largest < minSize || smallest < minThickness) o.castShadow = false;
  });
}

function isMergeable(mesh) {
  const m = mesh.material;
  if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh || Array.isArray(m)) return false;
  if (m.transparent || mesh.renderOrder !== 0 || mesh.userData.agentId) return false;
  return true;
}

// Materiales de color liso que se pueden unir usando colores por vértice.
const vertexColorMaterials = new Map();

/** Llave de un material "liso" (estándar, sin texturas ni brillo propio) o null si no lo es. */
function plainKey(m) {
  if (m.userData.vcKey) return m.userData.vcKey;
  if (m.type !== 'MeshStandardMaterial' || m.map || m.normalMap || m.roughnessMap || m.vertexColors) return null;
  if (m.emissive.getHex() !== 0 || m.opacity !== 1 || m.flatShading) return null;
  return `vc|${m.roughness}|${m.metalness}|${m.side}|${m.envMapIntensity}`;
}

function vertexColorMaterial(key, src) {
  if (!vertexColorMaterials.has(key)) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: src.roughness, metalness: src.metalness, side: src.side, envMapIntensity: src.envMapIntensity });
    m.userData.vcKey = key;
    vertexColorMaterials.set(key, m);
  }
  return vertexColorMaterials.get(key);
}

/** Copia de la geometría en el espacio del grupo, sin índice y solo con lo necesario. */
function bakeGeometry(mesh, matrix, withColor) {
  let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  g.applyMatrix4(matrix);
  const keep = withColor ? ['position', 'normal', 'color'] : Object.keys(g.attributes);
  const out = new THREE.BufferGeometry();
  keep.forEach((name) => {
    if (g.attributes[name]) out.setAttribute(name, g.attributes[name]);
  });
  if (withColor && !out.attributes.color) {
    const { r, g: gg, b } = mesh.material.color;
    const n = out.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      colors[i * 3] = r;
      colors[i * 3 + 1] = gg;
      colors[i * 3 + 2] = b;
    }
    out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  g.dispose();
  return out;
}

/**
 * Fusiona las mallas estáticas de un grupo en pocas mallas (menos draw calls): las de color liso
 * se unen por tipo de acabado con colores por vértice; el resto, por material compartido.
 * Respeta lo marcado con keepDynamic y lo que no es fusionable.
 */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const toLocal = root.matrixWorld.clone().invert();
  const buckets = new Map();

  const visit = (obj) => {
    if (obj.userData.dynamic) return;
    if (obj.isMesh && isMergeable(obj)) {
      const shadows = `${obj.castShadow ? 1 : 0}${obj.receiveShadow ? 1 : 0}`;
      const pk = plainKey(obj.material);
      const attrs = Object.keys(obj.geometry.attributes).sort().join(',');
      const key = pk ? `${pk}|${shadows}` : `${obj.material.uuid}|${attrs}|${shadows}`;
      if (!buckets.has(key)) buckets.set(key, { plain: pk, meshes: [] });
      buckets.get(key).meshes.push(obj);
    }
    obj.children.forEach(visit);
  };
  root.children.forEach(visit);

  const matrix = new THREE.Matrix4();
  buckets.forEach(({ plain, meshes }) => {
    if (meshes.length < 2) return;
    const geos = meshes.map((mesh) => bakeGeometry(mesh, matrix.multiplyMatrices(toLocal, mesh.matrixWorld), Boolean(plain)));
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    const material = plain ? vertexColorMaterial(plain, meshes[0].material) : meshes[0].material;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = meshes[0].castShadow;
    mesh.receiveShadow = meshes[0].receiveShadow;
    meshes.forEach((m) => m.parent?.remove(m));
    root.add(mesh);
  });

  // Quita grupos que quedaron vacíos.
  const prune = (obj) => {
    obj.children.slice().forEach(prune);
    if (obj !== root && obj.type === 'Group' && !obj.children.length && !obj.userData.dynamic) obj.parent?.remove(obj);
  };
  prune(root);
}
