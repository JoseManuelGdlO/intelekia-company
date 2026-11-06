import { createScene } from './scene.js';
import { createPanel } from './ui.js';
import { fetchStatus, sendChat, forzarCiclo } from './api.js';

const AGENTS = [{ id: 'buscador-tendencias' }, { id: 'publicador' }];
const POLL_INTERVAL_MS = 4000;

let latestStatus = {};

function agentLabel(agentId) {
  return agentId === 'buscador-tendencias' ? 'Buscador' : 'Publicador';
}

const panel = createPanel({
  onSend: async (agentId, message, saveAsIdea) => {
    try {
      const payload =
        agentId === 'buscador-tendencias'
          ? { message, saveAsIdea }
          : { message, ideaId: latestStatus[agentId]?.ultimoIdeaId };
      const result = await sendChat(agentId, payload);
      panel.appendMessage(agentLabel(agentId), result.reply);
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
});

const scene = createScene({
  container: document.getElementById('scene-container'),
  agents: AGENTS,
  onAgentClick: (agentId) => {
    panel.open(agentId, latestStatus[agentId]);
  },
});

async function refreshStatus() {
  try {
    latestStatus = await fetchStatus();
    scene.updateStatusColors(latestStatus);
    if (panel.getCurrentAgentId()) {
      panel.renderStatus(latestStatus[panel.getCurrentAgentId()]);
    }
  } catch (err) {
    console.error('No se pudo actualizar el estatus', err);
  }
}

refreshStatus();
setInterval(refreshStatus, POLL_INTERVAL_MS);
