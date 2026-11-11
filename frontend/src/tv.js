// Pantalla de TV de la oficina: solo vista, sin botones ni chat.
// Su ÚNICA fuente de datos es GET /api/tv/estado (el usuario "tv" no puede leer nada más).
import { createScene } from './scene.js';
import { loadBrandAssets } from './world/brand.js';
import { createCharlas, entrevistaPara } from './charlas.js';

const ESTADO_URL = '/api/tv/estado';
const POLL_MS = 10000;
const PANEL_MS = 25000;
const TOUR_MS = 20000;
const CELEBRACION_MS = 4000;
const TICKER_PX_POR_SEG = 140;
const ACTIVIDAD_FILAS = 10;
const TICKER_ITEMS = 15;

const $ = (id) => document.getElementById(id);

let ultimoEstado = null;
let scene = null;
let firmaDeptos = '';
let modoNoche = null; // null = aún sin decidir
let tourTimer = null;
let tourIndice = 0;
let charlas = null;
const WA_AVISO_MS = 7000;
const ENTREVISTA_MS = 16000;

// ---------- Utilidades ----------
const formatoHora = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
const formatoFecha = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

function hora(fecha) {
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? '' : formatoHora.format(d);
}

function el(tag, className, texto) {
  const nodo = document.createElement(tag);
  if (className) nodo.className = className;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

function dinero(usd) {
  return `$${(Number(usd) || 0).toFixed(2)}`;
}

// ---------- Reloj ----------
function tickReloj() {
  const ahora = new Date();
  const h = formatoHora.format(ahora);
  const f0 = formatoFecha.format(ahora);
  const f = f0.charAt(0).toUpperCase() + f0.slice(1); // "Miércoles, 11 de noviembre"
  $('tv-reloj').textContent = h;
  $('tv-fecha').textContent = f;
  $('tv-noche-reloj').textContent = h;
  $('tv-noche-fecha').textContent = f;
}

// Para evitar que la imagen se "queme" en la pantalla, el reloj nocturno se mueve un poco cada minuto.
function moverRelojNoche() {
  const x = (Math.random() - 0.5) * 16; // vw
  const y = (Math.random() - 0.5) * 30; // vh
  $('tv-noche-caja').style.transform = `translate(calc(-50% + ${x.toFixed(1)}vw), calc(-50% + ${y.toFixed(1)}vh))`;
}

// ---------- Estado de la oficina ----------
function estadoOficina(estado) {
  const { oficina, gasto } = estado;
  if (!oficina.abierta) return { clase: 'cerrada', texto: '🔴 Cerrada' };
  if (gasto?.excedido) return { clase: 'limite', texto: '💵 Límite alcanzado' };
  if (!oficina.puedeTrabajar) return { clase: 'fuera', texto: '🌙 Fuera de horario' };
  return { clase: 'trabajando', texto: '🟢 Trabajando' };
}

function pintarEstado(estado) {
  const { clase, texto } = estadoOficina(estado);
  const pill = $('tv-estado');
  pill.className = `tv-pill ${clase}`;
  pill.textContent = texto;
  $('tv-noche-motivo').textContent = estado.oficina.motivo || (clase === 'cerrada' ? 'La oficina está cerrada.' : 'Fuera de horario.');
}

// ---------- Oficina 3D ----------
/** Convierte los departamentos de /api/tv/estado a la forma que espera createScene. */
function departamentosParaEscena(departamentos) {
  return departamentos.map((d) => ({
    id: d.id,
    label: d.label,
    agents: (d.agentes || []).map((a) => ({ id: a.id, label: a.label })),
  }));
}

function firmaDe(departamentos) {
  return departamentos.map((d) => `${d.id}:${(d.agentes || []).map((a) => a.id).join(',')}`).join('|');
}

function estatusPorAgente(departamentos) {
  const mapa = {};
  departamentos.forEach((d) => (d.agentes || []).forEach((a) => {
    mapa[a.id] = { estatus: a.estatus };
  }));
  return mapa;
}

function crearEscena(estado) {
  firmaDeptos = firmaDe(estado.departamentos);
  scene = createScene({
    container: $('tv-scene-container'),
    departments: departamentosParaEscena(estado.departamentos),
  });
  scene.updateStatusColors(estatusPorAgente(estado.departamentos));
  // Vida de oficina: charlas casuales en globos de cómic (guion fijo, sin IA).
  charlas = createCharlas({ scene, agentes: listaAgentes });
  charlas.iniciar();
  iniciarRecorrido();
}

/** [{ id, label, departamento }] de todos los trabajadores, según el último estado. */
function listaAgentes() {
  return (ultimoEstado?.departamentos || []).flatMap((d) => (d.agentes || []).map((a) => ({ id: a.id, label: a.label, departamento: d.id })));
}

/**
 * Recorrido de cámara: vista general, cada departamento (~20 s cada uno) y al final un
 * recorrido virtual caminando por los pasillos (una vuelta completa, ~1 min).
 */
function paradasRecorrido() {
  const deptos = ultimoEstado?.departamentos || [];
  return [
    { tipo: 'general', label: 'Toda la oficina' },
    ...deptos.map((d) => ({ tipo: 'depto', id: d.id, label: d.label })),
    { tipo: 'entrevista', label: 'Entrevista' },
    { tipo: 'caminar', label: 'Recorrido virtual' },
  ];
}

function mostrarLugar(texto) {
  const lugar = $('tv-escena-lugar');
  lugar.classList.remove('visible');
  setTimeout(() => {
    lugar.textContent = texto;
    lugar.classList.add('visible');
  }, 600);
}

function siguienteParada() {
  if (!scene || modoNoche) return;
  const paradas = paradasRecorrido();
  const parada = paradas[tourIndice % paradas.length];
  tourIndice += 1;
  if (parada.tipo === 'caminar') {
    // Mientras camina no corre el temporizador: al terminar la vuelta sigue con la siguiente parada.
    clearInterval(tourTimer);
    tourTimer = null;
    scene.startWalk({ onVuelta: () => iniciarRecorrido() });
    mostrarLugar(`🚶 ${parada.label}`);
    return;
  }
  if (parada.tipo === 'entrevista') {
    if (entrevistar()) return;
    scene.focusOverview();
    mostrarLugar('📍 Toda la oficina');
    return;
  }
  if (parada.tipo === 'general') scene.focusOverview();
  else scene.focusDepartment(parada.id);
  mostrarLugar(`📍 ${parada.label}`);
}

/** "Entrevista a cámara" estilo documental: acerca la cámara a alguien y muestra su frase abajo. */
function entrevistar() {
  const deptos = ultimoEstado?.departamentos || [];
  const todos = deptos.flatMap((d) => (d.agentes || []).map((a) => ({ ...a, area: d.label })));
  if (!todos.length) return false;
  const a = todos[Math.floor(Math.random() * todos.length)];
  scene.focusAgent(a.id);
  mostrarLugar('🎥 Entrevista');
  const caja = $('tv-entrevista');
  $('tv-entrevista-nombre').textContent = a.label;
  $('tv-entrevista-area').textContent = a.area;
  $('tv-entrevista-frase').textContent = `“${entrevistaPara(a.id)}”`;
  caja.classList.remove('visible');
  clearTimeout(entrevistar.timer);
  setTimeout(() => caja.classList.add('visible'), 1200);
  entrevistar.timer = setTimeout(() => caja.classList.remove('visible'), Math.min(ENTREVISTA_MS, TOUR_MS - 1500));
  return true;
}

// ---------- Avisos de WhatsApp ----------
const waVistos = new Map(); // id → agente (null mientras se rutea)
const colaWa = [];
let mostrandoWa = false;

function registrarWhatsapp(avisos, { primeraCarga }) {
  avisos.forEach((w) => {
    if (!w?.id) return;
    const conocido = waVistos.has(w.id);
    const antes = waVistos.get(w.id);
    waVistos.set(w.id, w.agente || null);
    if (primeraCarga) return; // lo que ya había al encender la pantalla no se anuncia
    if (!conocido) colaWa.push(w);
    // Ya se sabe para quién era: ese trabajador reacciona en la oficina.
    if (w.agente && !antes) reaccionarWhatsapp(w.agente);
  });
  siguienteAvisoWa();
}

function reaccionarWhatsapp(label) {
  const a = listaAgentes().find((x) => x.label === label);
  if (a && !modoNoche) charlas?.reaccionar('whatsapp', { conId: a.id });
}

function siguienteAvisoWa() {
  if (mostrandoWa || !colaWa.length) return;
  mostrandoWa = true;
  const w = colaWa.shift();
  const caja = $('tv-aviso-wa');
  $('tv-aviso-wa-para').textContent = w.agente ? `Para ${w.agente}` : 'La recepción ya lo está leyendo';
  caja.classList.add('visible');
  setTimeout(() => {
    caja.classList.remove('visible');
    setTimeout(() => {
      mostrandoWa = false;
      siguienteAvisoWa();
    }, 600);
  }, WA_AVISO_MS);
}

function iniciarRecorrido() {
  clearInterval(tourTimer);
  tourTimer = null;
  siguienteParada();
  if (!scene?.isWalking()) tourTimer = setInterval(siguienteParada, TOUR_MS);
}

// ---------- Pantalla de noche ----------
function aplicarNoche(noche) {
  if (noche === modoNoche) return;
  const veniaDeNoche = modoNoche === true;
  modoNoche = noche;
  $('tv-noche').hidden = !noche;
  charlas?.pausar(noche);
  if (noche) {
    scene?.pause();
    moverRelojNoche();
  } else if (veniaDeNoche && scene) {
    scene.resume();
    iniciarRecorrido();
  }
}

// ---------- Panel rotativo ----------
const VISTAS = [
  { id: 'tablero', titulo: '📊 Hoy en la oficina' },
  { id: 'actividad', titulo: '⚡ Actividad en vivo' },
  { id: 'gasto', titulo: '💵 Gasto de hoy' },
];
let vistaActual = 0;

function mostrarVista(indice) {
  vistaActual = indice % VISTAS.length;
  const vista = VISTAS[vistaActual];
  document.querySelectorAll('.tv-vista').forEach((v) => v.classList.toggle('activa', v.dataset.vista === vista.id));
  $('tv-panel-titulo').textContent = vista.titulo;
  [...$('tv-dots').children].forEach((dot, i) => dot.classList.toggle('activo', i === vistaActual));
}

function iniciarPanel() {
  const dots = $('tv-dots');
  VISTAS.forEach(() => dots.appendChild(el('span')));
  mostrarVista(0);
  setInterval(() => {
    if (!modoNoche) mostrarVista(vistaActual + 1);
  }, PANEL_MS);
}

function pintarTablero(dia) {
  const tarjetas = [
    { num: dia.ciclos, label: 'Ciclos de trabajo' },
    { num: dia.ideas, label: 'Ideas nuevas' },
    { num: dia.prospectos, label: 'Prospectos nuevos' },
    { num: dia.prsRevisados, label: 'PRs revisados' },
    { num: dia.aprobadasHoy, label: 'Aprobadas hoy' },
    { num: dia.aprobacionesPendientes, label: 'Por aprobar', destacada: dia.aprobacionesPendientes > 0 },
    { num: dia.conversaciones, label: 'Conversaciones entre agentes', ancha: true },
  ];
  const cont = $('tv-tablero');
  cont.replaceChildren(...tarjetas.map((t) => {
    const card = el('div', `tv-card${t.ancha ? ' ancha' : ''}${t.destacada ? ' destacada' : ''}`);
    card.append(el('div', 'tv-card-num', String(Number(t.num) || 0)), el('div', 'tv-card-label', t.label));
    return card;
  }));
}

function pintarActividad(actividad) {
  const lista = $('tv-actividad');
  const filas = actividad.slice(0, ACTIVIDAD_FILAS);
  if (!filas.length) {
    lista.replaceChildren(el('li', 'tv-vacio', 'Aún no hay actividad hoy.'));
    return;
  }
  lista.replaceChildren(...filas.map((e) => {
    const li = el('li');
    li.append(el('span', 'tv-act-hora', hora(e.fecha)), el('span', 'tv-act-agente', e.agente), el('span', 'tv-act-texto', e.texto));
    return li;
  }));
}

function pintarGasto(gasto) {
  const cont = $('tv-gasto');
  const usd = Number(gasto.usd) || 0;
  const limite = gasto.limiteUsd;
  const pct = limite ? (usd / limite) * 100 : 0;
  cont.className = `tv-gasto${gasto.excedido || (limite && pct >= 100) ? ' rojo' : limite && pct >= 80 ? ' ambar' : ''}`;
  const hijos = [el('div', 'tv-gasto-num', dinero(usd)), el('div', 'tv-gasto-sub', 'en OpenAI hoy')];
  if (limite) {
    const barra = el('div', 'tv-barra');
    const relleno = el('div', 'tv-barra-relleno');
    relleno.style.width = `${Math.min(100, pct).toFixed(1)}%`;
    barra.appendChild(relleno);
    const sub = gasto.excedido
      ? `Límite de ${dinero(limite)} alcanzado: los ciclos automáticos esperan a mañana`
      : `${Math.round(pct)} % del límite diario de ${dinero(limite)}`;
    hijos.push(barra, el('div', 'tv-gasto-sub', sub));
  } else {
    hijos.push(el('div', 'tv-gasto-sub', 'Sin límite diario'));
  }
  cont.replaceChildren(...hijos);
}

// ---------- Ticker ----------
let tickerPendiente = null;
let tickerClave = '';

function contenidoTicker(actividad) {
  const frag = document.createDocumentFragment();
  actividad.slice(0, TICKER_ITEMS).forEach((e, i) => {
    if (i) frag.appendChild(el('span', 'sep', '•'));
    frag.append(el('b', '', e.agente), document.createTextNode(` · ${e.texto}`));
  });
  if (!actividad.length) frag.appendChild(document.createTextNode('Intelekia · Software inteligente, decisiones brillantes'));
  return frag;
}

function aplicarTicker(frag) {
  const track = $('tv-ticker-track');
  track.classList.remove('corriendo');
  track.replaceChildren(frag);
  const distancia = track.scrollWidth || window.innerWidth;
  track.style.setProperty('--dur', `${Math.max(20, distancia / TICKER_PX_POR_SEG).toFixed(1)}s`);
  void track.offsetWidth; // reinicia la animación desde el inicio (texto fuera de pantalla, sin salto)
  track.classList.add('corriendo');
}

function pintarTicker(actividad) {
  const clave = actividad.slice(0, TICKER_ITEMS).map((e) => `${e.fecha}|${e.texto}`).join('¦');
  if (clave === tickerClave) return;
  const primera = !tickerClave;
  tickerClave = clave;
  if (primera) aplicarTicker(contenidoTicker(actividad));
  // Para no cortar el texto a la mitad, el contenido nuevo entra cuando termina la vuelta actual.
  else tickerPendiente = actividad;
}

$('tv-ticker-track').addEventListener('animationiteration', () => {
  if (!tickerPendiente) return;
  const actividad = tickerPendiente;
  tickerPendiente = null;
  aplicarTicker(contenidoTicker(actividad));
});

// ---------- Celebraciones ----------
const celebracionesVistas = new Set();
const colaCelebraciones = [];
let celebrando = false;
const EMOJIS = { pr: '🚀', prospecto: '🤝', aprobacion: '✅' };
const COLORES_CONFETI = ['#5fd3ad', '#198f70', '#ffb020', '#ffffff', '#3ee0b0', '#ef4444', '#60a5fa'];

function registrarCelebraciones(celebraciones, { primeraCarga }) {
  celebraciones.forEach((c) => {
    if (!c?.id || celebracionesVistas.has(c.id)) return;
    celebracionesVistas.add(c.id);
    // Lo que ya existía al encender la pantalla no se celebra (pueden ser muchas).
    if (!primeraCarga) {
      colaCelebraciones.push(c);
      setTimeout(() => charlas?.reaccionar('celebracion'), CELEBRACION_MS + 800);
    }
  });
  siguienteCelebracion();
}

function lanzarConfeti(cont) {
  const piezas = [];
  for (let i = 0; i < 90; i += 1) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = COLORES_CONFETI[i % COLORES_CONFETI.length];
    p.style.setProperty('--d', `${(2.4 + Math.random() * 1.8).toFixed(2)}s`);
    p.style.setProperty('--delay', `${(Math.random() * 1.2).toFixed(2)}s`);
    p.style.setProperty('--x', `${((Math.random() - 0.5) * 30).toFixed(1)}vw`);
    p.style.setProperty('--r', `${Math.round((Math.random() - 0.5) * 1440)}deg`);
    if (Math.random() < 0.3) p.style.borderRadius = '50%';
    piezas.push(p);
  }
  cont.replaceChildren(...piezas);
}

function siguienteCelebracion() {
  if (celebrando || !colaCelebraciones.length) return;
  celebrando = true;
  const c = colaCelebraciones.shift();
  const overlay = $('tv-celebracion');
  $('tv-celebracion-emoji').textContent = EMOJIS[c.tipo] || '🎉';
  $('tv-celebracion-texto').textContent = c.texto || '¡Logro del equipo!';
  lanzarConfeti($('tv-confeti'));
  overlay.classList.remove('saliendo');
  overlay.hidden = false;
  setTimeout(() => {
    overlay.classList.add('saliendo');
    setTimeout(() => {
      overlay.hidden = true;
      overlay.classList.remove('saliendo');
      $('tv-confeti').replaceChildren();
      celebrando = false;
      siguienteCelebracion();
    }, 500);
  }, CELEBRACION_MS);
}

// ---------- Datos ----------
function normalizar(estado) {
  return {
    oficina: { abierta: true, puedeTrabajar: true, motivo: '', ...(estado?.oficina || {}) },
    gasto: { usd: 0, limiteUsd: null, excedido: false, ...(estado?.gasto || {}) },
    departamentos: Array.isArray(estado?.departamentos) ? estado.departamentos : [],
    dia: estado?.dia || {},
    actividad: Array.isArray(estado?.actividad) ? estado.actividad : [],
    celebraciones: Array.isArray(estado?.celebraciones) ? estado.celebraciones : [],
    whatsapp: Array.isArray(estado?.whatsapp) ? estado.whatsapp : [],
  };
}

function pintarSeguro(nombre, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`TV: no se pudo pintar ${nombre}`, err);
  }
}

function aplicarEstado(estado) {
  const primeraCarga = !ultimoEstado;
  ultimoEstado = estado;

  pintarSeguro('estado', () => pintarEstado(estado));
  pintarSeguro('tablero', () => pintarTablero(estado.dia));
  pintarSeguro('actividad', () => pintarActividad(estado.actividad));
  pintarSeguro('gasto', () => pintarGasto(estado.gasto));
  pintarSeguro('ticker', () => pintarTicker(estado.actividad));

  pintarSeguro('escena', () => {
    if (!scene) {
      if (estado.departamentos.length) crearEscena(estado);
    } else if (firmaDe(estado.departamentos) !== firmaDeptos) {
      // Cambió el equipo (agentes nuevos o eliminados): lo más simple y seguro es recargar.
      window.location.reload();
    } else {
      scene.updateStatusColors(estatusPorAgente(estado.departamentos));
    }
  });

  pintarSeguro('noche', () => aplicarNoche(estado.oficina.puedeTrabajar === false));
  pintarSeguro('celebraciones', () => registrarCelebraciones(estado.celebraciones, { primeraCarga }));
  pintarSeguro('whatsapp', () => registrarWhatsapp(estado.whatsapp, { primeraCarga }));

  if (primeraCarga) $('tv-cargando').classList.add('oculto');
}

async function consultar() {
  try {
    const res = await fetch(ESTADO_URL, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const estado = normalizar(await res.json());
    $('tv-reconectando').hidden = true;
    aplicarEstado(estado);
  } catch (err) {
    console.warn('TV: no se pudo consultar el estado', err);
    // Se conservan los últimos datos; solo se avisa discretamente.
    if (ultimoEstado) $('tv-reconectando').hidden = false;
    else $('tv-cargando-texto').textContent = 'Conectando con la oficina… (reintentando)';
  } finally {
    setTimeout(consultar, POLL_MS);
  }
}

// ---------- Tamaño ajustable de la oficina 3D vs. el panel ----------
const ESCENA_MIN = 25;
const ESCENA_MAX = 75;
const ESCENA_CLAVE = 'tv-escena-vh';

function fijarEscena(vh, { guardar = true } = {}) {
  const valor = Math.round(Math.min(ESCENA_MAX, Math.max(ESCENA_MIN, Number(vh) || 45)));
  document.documentElement.style.setProperty('--tv-escena-h', `${valor}vh`);
  if (guardar) {
    try {
      localStorage.setItem(ESCENA_CLAVE, String(valor));
    } catch {
      // sin almacenamiento: solo dura mientras la página esté abierta
    }
  }
  window.dispatchEvent(new Event('resize')); // el 3D se ajusta al nuevo tamaño
}

/**
 * Arrastra la barrita entre la oficina y el panel para darle más espacio a uno u otro.
 * También se puede fijar desde la dirección: /tv.html?escena=60 (porcentaje del alto).
 */
function iniciarDivisor() {
  const deUrl = new URLSearchParams(window.location.search).get('escena');
  let guardado = null;
  try {
    guardado = localStorage.getItem(ESCENA_CLAVE);
  } catch {
    guardado = null;
  }
  if (deUrl || guardado) fijarEscena(deUrl || guardado, { guardar: Boolean(deUrl) });

  const divisor = $('tv-divisor');
  let arrastrando = false;
  divisor.addEventListener('pointerdown', (e) => {
    arrastrando = true;
    divisor.setPointerCapture(e.pointerId);
    divisor.classList.add('activo');
  });
  divisor.addEventListener('pointermove', (e) => {
    if (!arrastrando) return;
    const top = $('tv-escena').getBoundingClientRect().top;
    fijarEscena(((e.clientY - top) / window.innerHeight) * 100);
  });
  const soltar = () => {
    arrastrando = false;
    divisor.classList.remove('activo');
  };
  divisor.addEventListener('pointerup', soltar);
  divisor.addEventListener('pointercancel', soltar);
  divisor.addEventListener('dblclick', () => fijarEscena(45));
}

// ---------- Arranque ----------
async function iniciar() {
  iniciarDivisor();
  tickReloj();
  setInterval(tickReloj, 1000);
  setInterval(() => {
    if (modoNoche) moverRelojNoche();
  }, 60000);
  iniciarPanel();
  await loadBrandAssets().catch(() => {});
  consultar();
}

iniciar();
