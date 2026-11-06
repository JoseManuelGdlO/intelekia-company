const AGENT_LABELS = {
  'buscador-tendencias': 'Buscador de Tendencias',
  publicador: 'Publicador',
};

export function createPanel({ onSend, onForzar }) {
  const panel = document.getElementById('panel');
  const title = document.getElementById('panel-title');
  const statusEl = document.getElementById('panel-status');
  const chatLog = document.getElementById('panel-chat-log');
  const saveIdeaLabel = document.getElementById('panel-save-idea-label');
  const saveIdeaCheckbox = document.getElementById('panel-save-idea');
  const messageInput = document.getElementById('panel-message');
  const sendButton = document.getElementById('panel-send');
  const forzarButton = document.getElementById('panel-forzar');
  const closeButton = document.getElementById('panel-close');

  let currentAgentId = null;

  function open(agentId, agentStatus) {
    currentAgentId = agentId;
    title.textContent = AGENT_LABELS[agentId] || agentId;
    saveIdeaLabel.style.display = agentId === 'buscador-tendencias' ? 'block' : 'none';
    chatLog.innerHTML = '';
    renderStatus(agentStatus);
    panel.classList.add('visible');
  }

  function renderStatus(agentStatus) {
    if (!agentStatus) {
      statusEl.textContent = 'Sin datos de estatus todavía.';
      return;
    }
    statusEl.textContent = `Estatus: ${agentStatus.estatus} — ${agentStatus.ultimaAccion || ''}`;
  }

  function appendMessage(author, text) {
    const line = document.createElement('div');
    line.textContent = `${author}: ${text}`;
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  sendButton.addEventListener('click', async () => {
    const message = messageInput.value.trim();
    if (!message || !currentAgentId) return;
    appendMessage('Tú', message);
    messageInput.value = '';
    await onSend(currentAgentId, message, saveIdeaCheckbox.checked);
  });

  forzarButton.addEventListener('click', async () => {
    if (!currentAgentId) return;
    await onForzar(currentAgentId);
  });

  closeButton.addEventListener('click', () => {
    panel.classList.remove('visible');
    currentAgentId = null;
  });

  return { open, renderStatus, appendMessage, getCurrentAgentId: () => currentAgentId };
}
