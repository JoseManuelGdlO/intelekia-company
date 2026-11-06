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
