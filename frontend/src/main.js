import { createScene } from './scene.js';
import { createPanel } from './ui.js';
import { fetchStatus, fetchDepartments, sendChat, forzarCiclo, fetchComunicacion, fetchConversaciones, fetchActividad, fetchCiclos } from './api.js';
import { fechaCorta } from './fechas.js';
import { createComunicacionEditor } from './comunicacionEditor.js';
import { createPerfilEditor } from './perfilEditor.js';
import { createCorreoBandeja } from './correoBandeja.js';
import { createAprobacionesBandeja } from './aprobacionesBandeja.js';
import { mostrarRevisionesPR } from './revisionesPR.js';
import { themeFor, hex } from './world/materials.js';
import { loadBrandAssets } from './world/brand.js';

const POLL_INTERVAL_MS = 4000;
const TALK_POLL_INTERVAL_MS = 2000;
const FEED_MAX = 4;
const ACTIVIDAD_POLL_MS = 1500;

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
  },
  onEdit: (agentId) => perfilEditor.open(agentId),
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
const actividadState = { agentId: null, eventos: [], cursor: null, timer: null, cargando: false };
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
    const nuevos = await fetchActividad(agentId, actividadState.cursor ? { desde: actividadState.cursor } : { limite: 80 });
    if (agentId !== actividadState.agentId) return; // se cambió de agente mientras cargaba
    if (nuevos.length) {
      actividadState.eventos = [...actividadState.eventos, ...nuevos].slice(-150);
      actividadState.cursor = nuevos[nuevos.length - 1].fecha;
    }
    panel.renderActividad(actividadState.eventos, { enVivo: agenteEnVivo() });
  } catch (err) {
    console.error('No se pudo leer la actividad', err);
  } finally {
    actividadState.cargando = false;
  }
}

function seguirActividad(agentId) {
  clearInterval(actividadState.timer);
  Object.assign(actividadState, { agentId, eventos: [], cursor: null, timer: null });
  if (!agentId) return;
  panel.renderActividad([], {});
  pollActividad();
  actividadState.timer = setInterval(pollActividad, ACTIVIDAD_POLL_MS);
}

// --- Comunicación entre agentes ---
function labelOf(agentId) {
  return agentLabels[agentId] || agentId;
}

function renderPanelTeam() {
  const agentId = panel.getCurrentAgentId();
  if (!agentId) return;
  panel.renderTeam(
    conversations
      .filter((c) => c.de === agentId || c.para === agentId)
      .slice(-15)
      .map((c) => ({ ...c, deLabel: labelOf(c.de), paraLabel: labelOf(c.para) }))
  );
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
    item.estado === 'enviado' ? 'correo enviado ✓' : item.estado === 'error' ? 'correo con error' : '✉️ por aprobar';
  const who = node.querySelector('.who');
  who.append(`✉️ ${labelOf(item.agentId)}`, Object.assign(document.createElement('span'), { className: 'arrow', textContent: '→' }), item.para.join(', '));
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

function mergeConversations(list, { animate }) {
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
  } catch (err) {
    console.error('No se pudo actualizar el estatus', err);
  }
}

function buildDepartmentNav(departments) {
  const nav = document.getElementById('dept-nav');
  nav.innerHTML = '';
  const comButton = document.createElement('button');
  comButton.className = 'chip chip-com';
  comButton.textContent = '🔗 Comunicación';
  comButton.title = 'Define quién puede consultar a quién';
  comButton.addEventListener('click', () => comunicacionEditor.open());
  nav.appendChild(comButton);

  const overview = document.createElement('button');
  overview.className = 'chip';
  overview.textContent = 'Vista general';
  overview.addEventListener('click', () => scene.focusOverview());
  nav.appendChild(overview);

  departments.forEach((department, index) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.style.setProperty('--accent', hex(themeFor(department.id, index).accent));
    chip.innerHTML = '<span class="swatch"></span><span class="label"></span><span class="count"></span>';
    chip.querySelector('.label').textContent = department.label;
    chip.querySelector('.count').textContent = department.agents.length;
    chip.addEventListener('click', () => scene.focusDepartment(department.id));
    nav.appendChild(chip);
  });
}

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
      renderPanelTeam();
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
