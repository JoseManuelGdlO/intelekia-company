import { createScene } from './scene.js';
import { createPanel } from './ui.js';
import { fetchStatus, fetchDepartments, sendChat, forzarCiclo } from './api.js';

const POLL_INTERVAL_MS = 4000;

let latestStatus = {};
let agentLabels = {};
let scene = null;

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
});

async function refreshStatus() {
  try {
    latestStatus = await fetchStatus();
    if (scene) {
      scene.updateStatusColors(latestStatus);
    }
    if (panel.getCurrentAgentId()) {
      panel.renderStatus(latestStatus[panel.getCurrentAgentId()]);
    }
  } catch (err) {
    console.error('No se pudo actualizar el estatus', err);
  }
}

async function bootstrap() {
  const departments = await fetchDepartments();

  departments.forEach((department) => {
    department.agents.forEach((agent) => {
      agentLabels[agent.id] = agent.label;
    });
  });

  scene = createScene({
    container: document.getElementById('scene-container'),
    departments,
    onAgentClick: (agentId) => {
      panel.open(agentId, agentLabels[agentId] || agentId, latestStatus[agentId]);
    },
  });

  await refreshStatus();
  setInterval(refreshStatus, POLL_INTERVAL_MS);
}

bootstrap();
