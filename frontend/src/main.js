import { createScene } from './scene.js';
import { createPanel } from './ui.js';
import { fetchStatus, fetchDepartments, sendChat, forzarCiclo, fetchComunicacion, fetchConversaciones, fetchConversacionesPagina, fetchActividad, fetchActividadPagina, fetchCiclos } from './api.js';
import { fechaCorta } from './fechas.js';
import { createComunicacionEditor } from './comunicacionEditor.js';
import { createPerfilEditor } from './perfilEditor.js';
import { createCorreoBandeja } from './correoBandeja.js';
import { createAprobacionesBandeja } from './aprobacionesBandeja.js';
import { createOficinaHorario } from './oficinaHorario.js';
import { mostrarRevisionesPR } from './revisionesPR.js';
import { themeFor, hex } from './world/materials.js';
import { loadBrandAssets } from './world/brand.js';
import { icon, hydrateIcons } from './icons.js';
import { createHudMenus } from './hudMenus.js';

// Íconos de la página (los <i data-icon>) y menús de la barra superior.
hydrateIcons();
createHudMenus();

const POLL_INTERVAL_MS = 4000;
const TALK_POLL_INTERVAL_MS = 2000;
const FEED_MAX = 4;
const ACTIVIDAD_POLL_MS = 1500;
const POR_PAGINA = 20;

let latestStatus = {};
const agentLabels = {};
const agentAccents = {};
let scene = null;
let departmentsList = [];
let conversations = [];
let conversationsCursor = null;
let comunicacionSnapshot = null;
const feedItems = new Map();

const panel = createPanel({
  onSend: async (agentId, message, guardar) => {
    try {
      const payload = {
        message,
        guardar,
        itemId: latestStatus[agentId]?.ultimoItemId,
      };
      const result = await sendChat(agentId, payload);
      panel.appendMessage(agentLabels[agentId] || agentId, result.reply);
    } catch (err) {
      panel.appendMessage('Error', err.message);
    }
  },
  onForzar: async (agentId) => {
    try {
      await forzarCiclo(agentId);
      panel.appendMessage('Sistema', 'Ciclo forzado. Actualizando estatus...');
      await refreshStatus();
    } catch (err) {
      panel.appendMessage('Error', err.message);
    }
  },
  onClose: () => {
    if (scene) scene.setSelected(null);
    seguirActividad(null);
    seguirTeam(null);
  },
  onEdit: (agentId) => perfilEditor.open(agentId),
  onActividadPagina: (pagina) => irActividadPagina(pagina),
  onTeamPagina: (pagina) => irTeamPagina(pagina),
});

const perfilEditor = createPerfilEditor({
  accentOf: (departmentId) => hex(themeFor(departmentId, departmentsList.findIndex((d) => d.id === departmentId)).accent),
  onSaved: (perfil, { labelChanged }) => {
    if (!labelChanged) return;
    agentLabels[perfil.id] = perfil.label;
    scene?.setAgentLabel(perfil.id, perfil.label);
    if (panel.getCurrentAgentId() === perfil.id) panel.setTitle(perfil.label);
  },
});

function updateLegend() {
  const counts = { idle: 0, trabajando: 0, listo_para_revision: 0, error: 0 };
  Object.keys(agentLabels).forEach((id) => {
    const estatus = latestStatus[id]?.estatus || 'idle';
    if (counts[estatus] !== undefined) counts[estatus] += 1;
  });
  document.querySelectorAll('#legend .legend-item').forEach((item) => {
    item.querySelector('b').textContent = counts[item.dataset.status] ?? 0;
  });
}

// --- Bitácora de actividad del agente abierto en el panel (en vivo) ---
// `pagina` 1 = en vivo; páginas > 1 se muestran fijas (el sondeo sigue, pero no repinta la lista).
const actividadState = { agentId: null, eventos: [], cursor: null, timer: null, cargando: false, pagina: 1, paginas: 1, total: 0, navegacion: 0 };
const TIPOS_CIERRE = new Set(['fin', 'respuesta', 'error']);

function agenteEnVivo() {
  const { agentId, eventos } = actividadState;
  if (!agentId) return false;
  if (latestStatus[agentId]?.estatus === 'trabajando') return true;
  const ultimo = eventos[eventos.length - 1];
  return Boolean(ultimo && !TIPOS_CIERRE.has(ultimo.tipo) && Date.now() - new Date(ultimo.fecha).getTime() < 120000);
}

async function pollActividad() {
  const { agentId } = actividadState;
  if (!agentId || actividadState.cargando) return;
  actividadState.cargando = true;
  try {
    if (!actividadState.cursor) {
      // Primera carga: la página 1 del servidor trae los eventos recientes y el total de páginas.
      const primera = await fetchActividadPagina(agentId, { pagina: 1, porPagina: POR_PAGINA });
      if (agentId !== actividadState.agentId) return; // se cambió de agente mientras cargaba
      actividadState.eventos = primera.eventos.slice().reverse();
      actividadState.cursor = primera.eventos[0]?.fecha || null;
      Object.assign(actividadState, { total: primera.total, paginas: primera.paginas });
    } else {
      const nuevos = await fetchActividad(agentId, { desde: actividadState.cursor });
      if (agentId !== actividadState.agentId) return;
      if (nuevos.length) {
        actividadState.eventos = [...actividadState.eventos, ...nuevos].slice(-150);
        actividadState.cursor = nuevos[nuevos.length - 1].fecha;
        // Llegaron eventos: se actualiza el total de páginas con una consulta ligera a la página 1.
        const meta = await fetchActividadPagina(agentId, { pagina: 1, porPagina: 1 });
        if (agentId !== actividadState.agentId) return;
        Object.assign(actividadState, { total: meta.total, paginas: Math.max(1, Math.ceil(meta.total / POR_PAGINA)) });
      }
    }
    if (actividadState.pagina === 1) renderActividadEnVivo();
    else panel.setActividadEnVivo(agenteEnVivo());
  } catch (err) {
    console.error('No se pudo leer la actividad', err);
  } finally {
    actividadState.cargando = false;
  }
}

/** Página 1 (en vivo): los eventos más recientes que ya se tienen en memoria. */
function renderActividadEnVivo() {
  const { eventos, total, paginas } = actividadState;
  panel.renderActividad(eventos.slice(-POR_PAGINA), { enVivo: agenteEnVivo(), pagina: 1, paginas, total: Math.max(total, eventos.length) });
}

/** Cambia de página en la Actividad. La 1 vuelve al modo en vivo; las demás se piden al servidor y quedan fijas. */
async function irActividadPagina(pagina) {
  const { agentId } = actividadState;
  if (!agentId) return;
  const navegacion = ++actividadState.navegacion;
  if (pagina <= 1) {
    actividadState.pagina = 1;
    renderActividadEnVivo();
    return;
  }
  try {
    const res = await fetchActividadPagina(agentId, { pagina, porPagina: POR_PAGINA });
    if (agentId !== actividadState.agentId || navegacion !== actividadState.navegacion) return;
    Object.assign(actividadState, { pagina: res.pagina, total: res.total, paginas: res.paginas });
    panel.renderActividad(res.eventos.slice().reverse(), { enVivo: agenteEnVivo(), pagina: res.pagina, paginas: res.paginas, total: res.total });
  } catch (err) {
    console.error('No se pudo leer la página de actividad', err);
  }
}

function seguirActividad(agentId) {
  clearInterval(actividadState.timer);
  Object.assign(actividadState, { agentId, eventos: [], cursor: null, timer: null, pagina: 1, paginas: 1, total: 0 });
  actividadState.navegacion += 1;
  if (!agentId) return;
  panel.renderActividad([], {});
  pollActividad();
  actividadState.timer = setInterval(pollActividad, ACTIVIDAD_POLL_MS);
}

// --- Comunicación entre agentes ---
function labelOf(agentId) {
  return agentLabels[agentId] || agentId;
}

// Conversaciones del agente abierto. `base` = página 1 traída del servidor (de la más vieja a la más nueva);
// en la página 1 se le mezclan las que llegan en vivo. Páginas > 1 se muestran fijas.
const teamState = { agentId: null, base: [], pagina: 1, paginas: 1, total: 0, navegacion: 0 };

function participa(conv, agentId) {
  return conv.de === agentId || conv.para === agentId;
}

function conLabels(conv) {
  return { ...conv, deLabel: labelOf(conv.de), paraLabel: labelOf(conv.para) };
}

function renderPanelTeam() {
  const agentId = panel.getCurrentAgentId();
  if (!agentId || teamState.agentId !== agentId || teamState.pagina !== 1) return;
  const porId = new Map(teamState.base.map((c) => [c.id, c]));
  conversations.filter((c) => participa(c, agentId)).forEach((c) => porId.set(c.id, c));
  const items = [...porId.values()].sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0)).slice(-POR_PAGINA);
  panel.renderTeam(items.map(conLabels), { pagina: 1, paginas: teamState.paginas, total: Math.max(teamState.total, items.length) });
}

/** Trae la página 1 del agente (últimas conversaciones y total de páginas) y repinta si sigue en la página 1. */
async function cargarTeamPagina1(agentId) {
  try {
    const res = await fetchConversacionesPagina({ agentId, pagina: 1, porPagina: POR_PAGINA });
    if (teamState.agentId !== agentId) return;
    Object.assign(teamState, { base: res.items.slice().reverse(), total: res.total, paginas: res.paginas });
    renderPanelTeam();
  } catch (err) {
    console.error('No se pudieron leer las conversaciones del agente', err);
  }
}

function seguirTeam(agentId) {
  Object.assign(teamState, { agentId, base: [], pagina: 1, paginas: 1, total: 0 });
  teamState.navegacion += 1;
  if (!agentId) return;
  renderPanelTeam();
  cargarTeamPagina1(agentId);
}

/** Cambia de página en las conversaciones con compañeros. La 1 vuelve al modo en vivo. */
async function irTeamPagina(pagina) {
  const { agentId } = teamState;
  if (!agentId) return;
  const navegacion = ++teamState.navegacion;
  if (pagina <= 1) {
    teamState.pagina = 1;
    renderPanelTeam();
    cargarTeamPagina1(agentId);
    return;
  }
  try {
    const res = await fetchConversacionesPagina({ agentId, pagina, porPagina: POR_PAGINA });
    if (agentId !== teamState.agentId || navegacion !== teamState.navegacion) return;
    Object.assign(teamState, { pagina: res.pagina, total: res.total, paginas: res.paginas });
    panel.renderTeam(res.items.slice().reverse().map(conLabels), { pagina: res.pagina, paginas: res.paginas, total: res.total });
  } catch (err) {
    console.error('No se pudo leer la página de conversaciones', err);
  }
}

function showInFeed(conv) {
  const feed = document.getElementById('feed');
  let item = feedItems.get(conv.id);
  if (!item) {
    item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = '<span class="tag"></span><div class="who"></div><div class="q"></div>';
    const who = item.querySelector('.who');
    who.append(labelOf(conv.de), Object.assign(document.createElement('span'), { className: 'arrow', textContent: '→' }), labelOf(conv.para));
    item.querySelector('.q').textContent = conv.pregunta;
    item.querySelector('.who').append(Object.assign(document.createElement('span'), { className: 'feed-time', textContent: fechaCorta(conv.inicio) }));
    feed.prepend(item);
    feedItems.set(conv.id, item);
    while (feed.children.length > FEED_MAX) {
      const last = feed.lastElementChild;
      feedItems.forEach((node, id) => node === last && feedItems.delete(id));
      last.remove();
    }
  }
  item.classList.toggle('done', conv.estado === 'completada');
  item.classList.toggle('error', conv.estado === 'error');
  item.querySelector('.tag').textContent = conv.estado === 'en_curso' ? 'consultando…' : conv.estado === 'error' ? 'error' : 'respondió ✓';
  if (conv.estado !== 'en_curso') {
    setTimeout(() => item.classList.add('fade'), 8000);
    setTimeout(() => {
      item.remove();
      feedItems.delete(conv.id);
    }, 8600);
  }
}

function showMailInFeed(item) {
  const feed = document.getElementById('feed');
  const node = document.createElement('div');
  node.className = `feed-item mail ${item.estado === 'enviado' ? 'done' : item.estado === 'error' ? 'error' : ''}`;
  node.innerHTML = '<span class="tag"></span><div class="who"></div><div class="q"></div>';
  node.querySelector('.tag').textContent =
    item.estado === 'enviado' ? 'correo enviado ✓' : item.estado === 'error' ? 'correo con error' : 'correo por aprobar';
  const who = node.querySelector('.who');
  who.insertAdjacentHTML('beforeend', icon('mail', { size: 13 }));
  who.append(` ${labelOf(item.agentId)}`, Object.assign(document.createElement('span'), { className: 'arrow', textContent: '→' }), item.para.join(', '));
  node.querySelector('.q').textContent = item.asunto;
  who.append(Object.assign(document.createElement('span'), { className: 'feed-time', textContent: fechaCorta(item.enviadoEn || item.creadoEn) }));
  if (item.estado === 'por_aprobar') {
    node.style.pointerEvents = 'auto';
    node.style.cursor = 'pointer';
    node.title = 'Abrir la bandeja de correos por aprobar';
    node.addEventListener('click', () => correoBandeja.open());
  }
  feed.prepend(node);
  while (feed.children.length > FEED_MAX) feed.lastElementChild.remove();
  setTimeout(() => node.classList.add('fade'), 12000);
  setTimeout(() => node.remove(), 12600);
}

const correoBandeja = createCorreoBandeja({ labelOf, onCorreo: showMailInFeed });
const aprobacionesBandeja = createAprobacionesBandeja({ labelOf });
const oficinaHorario = createOficinaHorario();

function mergeConversations(list, { animate }) {
  // ¿Llegó una conversación nueva del agente abierto? Entonces cambia el total de páginas.
  const abierto = teamState.agentId;
  const nuevaDelAbierto = Boolean(abierto) && list.some((conv) => participa(conv, abierto) && !conversations.some((c) => c.id === conv.id) && !teamState.base.some((c) => c.id === conv.id));
  list.forEach((conv) => {
    const index = conversations.findIndex((c) => c.id === conv.id);
    if (index >= 0) conversations[index] = conv;
    else conversations.push(conv);
    if (!conversationsCursor || conv.actualizado > conversationsCursor) conversationsCursor = conv.actualizado;
    if (animate || conv.estado === 'en_curso') {
      scene?.playConversation(conv);
      showInFeed(conv);
    }
  });
  conversations = conversations.slice(-200);
  if (list.length) renderPanelTeam();
  if (nuevaDelAbierto) cargarTeamPagina1(abierto);
}

async function pollConversations() {
  try {
    const list = await fetchConversaciones({ desde: conversationsCursor || undefined });
    mergeConversations(list, { animate: true });
  } catch (err) {
    console.error('No se pudieron obtener las conversaciones', err);
  }
}

async function refreshNetwork() {
  try {
    comunicacionSnapshot = await fetchComunicacion();
    if (comunicacionEditor.isNetworkVisible()) scene.showNetwork(comunicacionSnapshot.permitidos);
  } catch (err) {
    console.error('No se pudieron obtener las reglas de comunicación', err);
  }
}

const comunicacionEditor = createComunicacionEditor({
  getDepartments: () => departmentsList,
  accentOf: (departmentId) => hex(themeFor(departmentId, departmentsList.findIndex((d) => d.id === departmentId)).accent),
  onChange: (snapshot) => {
    comunicacionSnapshot = snapshot;
    if (comunicacionEditor.isNetworkVisible()) scene.showNetwork(snapshot.permitidos);
  },
  onToggleNetwork: async (visible) => {
    if (!visible) {
      scene.showNetwork(null);
      return;
    }
    if (!comunicacionSnapshot) await refreshNetwork();
    scene.showNetwork(comunicacionSnapshot?.permitidos || null);
  },
});

async function refreshStatus() {
  try {
    latestStatus = await fetchStatus();
    if (scene) {
      scene.updateStatusColors(latestStatus);
    }
    if (panel.getCurrentAgentId()) {
      panel.renderStatus(latestStatus[panel.getCurrentAgentId()]);
      fetchCiclos()
        .then((ciclos) => panel.renderCiclo(ciclos[panel.getCurrentAgentId()]))
        .catch(() => panel.renderCiclo(null));
    }
    updateLegend();
    correoBandeja.refresh();
    aprobacionesBandeja.refresh();
    oficinaHorario.refresh();
  } catch (err) {
    console.error('No se pudo actualizar el estatus', err);
  }
}

function buildDepartmentNav(departments) {
  const nav = document.getElementById('dept-nav');
  nav.innerHTML = '';
  const label = document.getElementById('vista-label');
  const elegir = (item, texto) => {
    nav.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('active', b === item));
    label.textContent = texto;
  };

  const overview = document.createElement('button');
  overview.className = 'menu-item active';
  overview.setAttribute('role', 'menuitem');
  overview.innerHTML = `${icon('layout-grid')}<span>Vista general</span>`;
  overview.addEventListener('click', () => {
    scene.focusOverview();
    elegir(overview, 'Vista general');
  });
  nav.append(overview, Object.assign(document.createElement('div'), { className: 'menu-sep' }));

  departments.forEach((department, index) => {
    const item = document.createElement('button');
    item.className = 'menu-item';
    item.setAttribute('role', 'menuitem');
    item.style.setProperty('--accent', hex(themeFor(department.id, index).accent));
    item.innerHTML = '<span class="swatch"></span><span class="label"></span><span class="count"></span>';
    item.querySelector('.label').textContent = department.label;
    const n = department.agents.length;
    item.querySelector('.count').textContent = `${n} agente${n === 1 ? '' : 's'}`;
    item.addEventListener('click', () => {
      scene.focusDepartment(department.id);
      elegir(item, department.label);
    });
    nav.appendChild(item);
  });
}

document.getElementById('com-btn').addEventListener('click', () => comunicacionEditor.open());

async function bootstrap() {
  const loader = document.getElementById('loader');
  let departments;
  try {
    [departments] = await Promise.all([fetchDepartments(), loadBrandAssets()]);
  } catch (err) {
    loader.classList.add('failed');
    document.getElementById('loader-text').textContent = `No se pudo conectar con el backend. ${err.message}`;
    return;
  }

  departmentsList = departments;
  departments.forEach((department, index) => {
    const accent = hex(themeFor(department.id, index).accent);
    department.agents.forEach((agent) => {
      agentLabels[agent.id] = agent.label;
      agentAccents[agent.id] = accent;
    });
  });

  scene = createScene({
    container: document.getElementById('scene-container'),
    departments,
    onAgentClick: (agentId) => {
      scene.setSelected(agentId);
      scene.focusAgent(agentId);
      panel.open(agentId, agentLabels[agentId] || agentId, latestStatus[agentId], agentAccents[agentId]);
      seguirTeam(agentId);
      seguirActividad(agentId);
      mostrarRevisionesPR(agentId);
    },
  });
  buildDepartmentNav(departments);

  await refreshStatus();
  setInterval(refreshStatus, POLL_INTERVAL_MS);
  try {
    // Historial reciente sin animar; las que sigan en curso sí se muestran.
    mergeConversations(await fetchConversaciones({ limite: 50 }), { animate: false });
  } catch (err) {
    console.error('No se pudo cargar el historial de conversaciones', err);
  }
  setInterval(pollConversations, TALK_POLL_INTERVAL_MS);
  requestAnimationFrame(() => loader.classList.add('hidden'));
}

bootstrap();
