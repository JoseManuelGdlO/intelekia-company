import * as THREE from 'three';
import { hashString } from './materials.js';

/**
 * Letreros de papel pegados con cinta: el humor de oficina del escenario.
 * Cambian cada día (mismo letrero todo el día en todas las pantallas).
 */
const DE_CAFE = [
  ['FAVOR DE LAVAR', 'TU TAZA.', 'Sí, TÚ.'],
  ['El café es', 'para TODOS.', '— Atte: el que se lo acabó'],
  ['Si la cafetera', 'hace ruido raro,', 'NO LA TOQUES.'],
  ['Prohibido hablar', 'de trabajo antes', 'del primer café.'],
  ['¿Café', 'descafeinado?', '¿Para qué?'],
  ['Esta taza', 'tiene dueño.', 'Y memoria.'],
  ['Último café:', 'hace 5 min.', 'Próximo: ya.'],
];

const DE_PARED = [
  ['DÍAS SIN', 'INCIDENTES:', '0'],
  ['Junta para planear', 'la siguiente junta:', '10:00 am'],
  ['WIFI: NoEsTuyo', 'Clave:', 'PídeleASistemas'],
  ['SE BUSCA', 'ENGRAPADORA', 'Recompensa: gratitud'],
  ['Favor de NO', '"responder a todos".', 'Gracias.'],
  ['La impresora', 'no funciona.', 'Sí, otra vez.'],
  ['Hoy es un buen día', 'para no tener', 'juntas.'],
  ['Este refri', 'se limpia el viernes.', '(Cuál viernes: no se sabe)'],
];

function papel(lineas, { alerta = false } = {}) {
  const c = document.createElement('canvas');
  c.width = 440;
  c.height = 330;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f1e6';
  ctx.fillRect(0, 0, c.width, c.height);
  // Hoja impresa: margen y una franja de color si es "aviso oficial"
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
  if (alerta) {
    ctx.fillStyle = '#d93a2b';
    ctx.fillRect(10, 10, c.width - 20, 54);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const alto = (c.height - (alerta ? 70 : 20)) / (lineas.length + 0.4);
  lineas.forEach((linea, i) => {
    const grande = alerta && i === lineas.length - 1;
    let tam = grande ? 120 : 62;
    do {
      ctx.font = `900 ${tam}px "Segoe UI", system-ui, sans-serif`;
      tam -= 3;
    } while (ctx.measureText(linea).width > c.width - 36 && tam > 18);
    ctx.fillStyle = alerta && i === 0 ? '#ffffff' : '#0d0d0d';
    const y = alerta && i === 0 ? 37 : (alerta ? 70 : 20) + alto * (i + (alerta ? 0.2 : 0.7));
    ctx.fillText(linea, c.width / 2, y);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Hoja con dos tiras de cinta, un poquito chueca (como de verdad). */
function hoja(textura, w, h, giro) {
  const g = new THREE.Group();
  const hojaMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textura, toneMapped: false }));
  g.add(hojaMesh);
  const cinta = new THREE.MeshStandardMaterial({ color: 0xe8dcb5, transparent: true, opacity: 0.8, roughness: 0.6 });
  [-1, 1].forEach((lado) => {
    const tira = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.28, h * 0.12), cinta);
    tira.position.set(lado * w * 0.36, h * 0.47, 0.002);
    tira.rotation.z = lado * 0.5;
    g.add(tira);
  });
  g.rotation.z = giro;
  return g;
}

/** Letreros del día para una sala: uno junto al café y otro en la pared. */
export function letrerosDelDia(salaId, fecha = new Date()) {
  const dia = Math.floor(fecha.getTime() / 86400000);
  const n = hashString(salaId) + dia;
  const cafe = DE_CAFE[n % DE_CAFE.length];
  const pared = DE_PARED[(n * 7 + 3) % DE_PARED.length];
  const giro = (k) => (((n + k) % 7) - 3) * 0.012;
  return {
    cafe: hoja(papel(cafe), 0.66, 0.495, giro(1)),
    pared: hoja(papel(pared, { alerta: pared[0].startsWith('DÍAS') || pared[0].startsWith('SE BUSCA') }), 0.62, 0.465, giro(2)),
  };
}
