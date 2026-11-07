const BASE_URL = '/api/agents';
const DEPARTMENTS_URL = '/api/departments';

export async function fetchDepartments() {
  const response = await fetch(DEPARTMENTS_URL);
  if (!response.ok) {
    throw new Error(`No se pudo obtener los departamentos: ${response.status}`);
  }
  return response.json();
}

export async function fetchStatus() {
  const response = await fetch(`${BASE_URL}/status`);
  if (!response.ok) {
    throw new Error(`No se pudo obtener el estatus: ${response.status}`);
  }
  return response.json();
}

export async function sendChat(agentId, payload) {
  const response = await fetch(`${BASE_URL}/${agentId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(data.error || `Error ${response.status}`);
  }
  return response.json();
}

export async function forzarCiclo(agentId) {
  const response = await fetch(`${BASE_URL}/${agentId}/forzar`, { method: 'POST' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(data.error || `Error ${response.status}`);
  }
  return response.json();
}

const COMUNICACION_URL = '/api/comunicacion';

async function jsonOrThrow(response) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(data.error || `Error ${response.status}`);
  }
  return response.json();
}

export async function fetchComunicacion() {
  return jsonOrThrow(await fetch(COMUNICACION_URL));
}

export async function saveReglaComunicacion(agentId, { alcance, permitidos }) {
  return jsonOrThrow(
    await fetch(`${COMUNICACION_URL}/reglas/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alcance, permitidos }),
    })
  );
}

export async function savePorDefectoComunicacion(alcance, aplicarATodos = false) {
  return jsonOrThrow(
    await fetch(`${COMUNICACION_URL}/por-defecto`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alcance, aplicarATodos }),
    })
  );
}

export async function fetchConversaciones({ desde, agentId, limite } = {}) {
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (agentId) params.set('agentId', agentId);
  if (limite) params.set('limite', String(limite));
  return jsonOrThrow(await fetch(`${COMUNICACION_URL}/conversaciones?${params}`));
}

const PERFILES_URL = '/api/perfiles';

export async function fetchPerfil(agentId) {
  return jsonOrThrow(await fetch(`${PERFILES_URL}/${encodeURIComponent(agentId)}`));
}

export async function savePerfil(agentId, patch) {
  return jsonOrThrow(
    await fetch(`${PERFILES_URL}/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  );
}

export async function fetchMemoria(agentId) {
  return jsonOrThrow(await fetch(`${PERFILES_URL}/${encodeURIComponent(agentId)}/memoria`));
}

export async function saveMemoria(agentId, content) {
  return jsonOrThrow(
    await fetch(`${PERFILES_URL}/${encodeURIComponent(agentId)}/memoria`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  );
}

export async function comprimirMemoria(agentId) {
  return jsonOrThrow(await fetch(`${PERFILES_URL}/${encodeURIComponent(agentId)}/memoria/comprimir`, { method: 'POST' }));
}
