import { fechaCorta, haceCuanto, enCuanto, fechaLarga } from './fechas.js';

const STATUS_LABELS = {
  idle: 'Disponible',
  trabajando: 'Trabajando',
  listo_para_revision: 'Listo para revisión',
  error: 'Error',
};

const STATUS_VARS = {
  idle: 'var(--c-idle)',
  trabajando: 'var(--c-trabajando)',
  listo_para_revision: 'var(--c-listo)',
  error: 'var(--c-error)',
};

export function createPanel({ onSend, onForzar, onClose, onEdit }) {
  const panel = document.getElementById('panel');
  const title = document.getElementById('panel-title');
  const avatar = document.getElementById('panel-avatar');
  const statusEl = document.getElementById('panel-status');
  const lastActionEl = document.getElementById('panel-last-action');
  const chatLog = document.getElementById('panel-chat-log');
  const saveCheckbox = document.getElementById('panel-save-idea');
  const messageInput = document.getElementById('panel-message');
  const sendButton = document.getElementById('panel-send');
  const forzarButton = document.getElementById('panel-forzar');
  const closeButton = document.getElementById('panel-close');
  const editButton = document.getElementById('panel-edit');
  const teamList = document.getElementById('panel-team-list');
  const cicloEl = document.getElementById('panel-ciclo');
  const activityList = document.getElementById('panel-activity-list');
  const activityLive = document.getElementById('panel-activity-live');
  const activityCount = document.getElementById('panel-activity-count');
  const teamCount = document.getElementById('panel-team-count');

  let currentAgentId = null;
  let currentLabel = '';

  function open(agentId, label, agentStatus, accent) {
    currentAgentId = agentId;
    currentLabel = label;
    title.textContent = label;
    avatar.textContent = label.charAt(0).toUpperCase();
    panel.style.setProperty('--accent', accent || '');
    chatLog.innerHTML = '';
    appendMessage('Sistema', `Estás hablando con ${label}.`);
    renderStatus(agentStatus);
    panel.classList.add('visible');
    setTimeout(() => messageInput.focus(), 300);
  }

  /** Conversaciones del agente con sus compañeros: [{ de, para, pregunta, respuesta, estado }] con labels ya resueltos. */
  function renderTeam(items) {
    teamList.innerHTML = '';
    teamCount.textContent = items.length ? `(${items.length})` : '';
    if (!items.length) {
      teamList.appendChild(Object.assign(document.createElement('div'), { className: 'team-empty', textContent: 'Todavía no ha conversado con nadie.' }));
      return;
    }
    items
      .slice()
      .reverse()
      .forEach((item) => {
        const card = document.createElement('div');
        card.className = 'team-msg';
        const who = document.createElement('div');
        who.className = 'who';
        who.append(item.deLabel, Object.assign(document.createElement('span'), { className: 'arrow', textContent: '→' }), item.paraLabel);
        if (item.inicio) {
          const when = Object.assign(document.createElement('span'), { className: 'team-time', textContent: `${fechaCorta(item.inicio)} · ${haceCuanto(item.inicio)}` });
          when.title = fechaLarga(item.inicio);
          who.appendChild(when);
        }
        const q = Object.assign(document.createElement('div'), { className: 'q', textContent: item.pregunta });
        const answer = item.estado === 'en_curso' ? 'Respondiendo…' : item.error ? `Error: ${item.error}` : item.respuesta;
        const a = Object.assign(document.createElement('div'), { className: 'a', textContent: answer });
        card.append(who, q, a);
        teamList.appendChild(card);
      });
  }

  function close() {
    panel.classList.remove('visible');
    currentAgentId = null;
    if (onClose) onClose();
  }

  function renderStatus(agentStatus) {
    const estatus = agentStatus?.estatus || 'idle';
    statusEl.innerHTML = '';
    const chip = document.createElement('span');
    chip.className = 'status-chip';
    chip.style.setProperty('--status', STATUS_VARS[estatus] || STATUS_VARS.idle);
    chip.textContent = agentStatus ? STATUS_LABELS[estatus] || estatus : 'Sin datos de estatus todavía';
    statusEl.appendChild(chip);
    const detail = agentStatus?.error || agentStatus?.ultimaAccion || '';
    lastActionEl.textContent = detail ? `Última acción: ${detail}` : '';
  }

  function appendMessage(author, text) {
    const kind = author === 'Tú' ? 'me' : author === 'Sistema' ? 'system' : author === 'Error' ? 'error' : 'agent';
    const line = document.createElement('div');
    line.className = `msg ${kind}`;
    if (kind === 'agent') {
      const name = document.createElement('span');
      name.className = 'author';
      name.textContent = author;
      line.appendChild(name);
    }
    line.appendChild(document.createTextNode(text));
    if (kind !== 'system') {
      const ahora = new Date().toISOString();
      const time = Object.assign(document.createElement('span'), { className: 'msg-time', textContent: fechaCorta(ahora) });
      time.title = fechaLarga(ahora);
      line.appendChild(time);
    }
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
    return line;
  }

  const ICONOS_TIPO = { inicio: 'tipo-inicio', fin: 'tipo-fin', error: 'tipo-error', respuesta: 'tipo-respuesta', chat: 'tipo-chat', pensando: 'tipo-pensando', herramienta: 'tipo-herramienta', resultado: 'tipo-resultado', nota: 'tipo-nota' };

  /** Próximo ciclo automático del agente (o que no corre solo). */
  function renderCiclo(info) {
    if (!info) {
      cicloEl.textContent = '';
      return;
    }
    if (info.enCurso) cicloEl.textContent = '⏱️ Ejecutando su ciclo ahora…';
    else if (info.enCola) cicloEl.textContent = '⏱️ En cola para ejecutar su ciclo…';
    else if (!info.cadaHoras) cicloEl.textContent = '⏱️ No corre solo (solo chat o Forzar ciclo)';
    else cicloEl.textContent = `⏱️ Próximo ciclo: ${info.proxima ? `${fechaCorta(info.proxima)} (${enCuanto(info.proxima)})` : 'pronto'} · cada ${info.cadaHoras} h`;
  }

  /** Bitácora de actividad del agente, lo más reciente arriba. */
  function renderActividad(eventos, { enVivo = false } = {}) {
    activityLive.hidden = !enVivo;
    activityCount.textContent = eventos.length ? `(${eventos.length})` : '';
    activityList.innerHTML = '';
    if (!eventos.length) {
      activityList.appendChild(Object.assign(document.createElement('div'), { className: 'team-empty', textContent: 'Todavía no hay actividad registrada. Fuerza un ciclo o escríbele para verlo trabajar.' }));
      return;
    }
    eventos
      .slice()
      .reverse()
      .forEach((e, i) => {
        const row = document.createElement(e.detalle ? 'details' : 'div');
        row.className = `act-row ${ICONOS_TIPO[e.tipo] || ''}${i === 0 && enVivo ? ' latest' : ''}`;
        const head = document.createElement(e.detalle ? 'summary' : 'div');
        head.className = 'act-head';
        const time = Object.assign(document.createElement('span'), { className: 'act-time', textContent: fechaCorta(e.fecha, { segundos: true }) });
        time.title = `${fechaLarga(e.fecha)} (${haceCuanto(e.fecha)})`;
        const text = Object.assign(document.createElement('span'), { className: 'act-text', textContent: e.texto });
        head.append(time, text);
        row.appendChild(head);
        if (e.detalle) row.appendChild(Object.assign(document.createElement('pre'), { className: 'act-detail', textContent: e.detalle }));
        activityList.appendChild(row);
      });
  }

  function showPending() {
    const line = document.createElement('div');
    line.className = 'msg agent pending';
    line.innerHTML = '<span class="author"></span><span class="typing"><i></i><i></i><i></i></span>';
    line.querySelector('.author').textContent = currentLabel;
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
    return line;
  }

  async function send() {
    const message = messageInput.value.trim();
    if (!message || !currentAgentId || sendButton.disabled) return;
    appendMessage('Tú', message);
    messageInput.value = '';
    sendButton.disabled = true;
    const pending = showPending();
    try {
      await onSend(currentAgentId, message, saveCheckbox.checked);
    } finally {
      pending.remove();
      sendButton.disabled = false;
    }
  }

  sendButton.addEventListener('click', send);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  forzarButton.addEventListener('click', async () => {
    if (!currentAgentId) return;
    forzarButton.disabled = true;
    try {
      await onForzar(currentAgentId);
    } finally {
      forzarButton.disabled = false;
    }
  });

  closeButton.addEventListener('click', close);
  editButton.addEventListener('click', () => {
    if (currentAgentId && onEdit) onEdit(currentAgentId);
  });

  function setTitle(label) {
    currentLabel = label;
    title.textContent = label;
    avatar.textContent = label.charAt(0).toUpperCase();
  }
  window.addEventListener('keydown', (e) => {
    // Si hay un editor abierto encima, Escape cierra ese editor, no el panel.
    if (e.key === 'Escape' && currentAgentId && !document.querySelector('#perfil-modal.visible, #com-modal.visible, #mail-modal.visible')) close();
  });

  return { open, close, setTitle, renderStatus, renderTeam, renderActividad, renderCiclo, appendMessage, getCurrentAgentId: () => currentAgentId };
}
