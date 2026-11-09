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

const BASE_DATOS_URL = '/api/base-datos';

export async function fetchBaseDatosEstado() {
  return jsonOrThrow(await fetch(`${BASE_DATOS_URL}/estado`));
}

export async function probarBaseDatos() {
  return jsonOrThrow(await fetch(`${BASE_DATOS_URL}/probar`, { method: 'POST' }));
}

export async function fetchConsultasBD({ agentId, limite } = {}) {
  const params = new URLSearchParams();
  if (agentId) params.set('agentId', agentId);
  if (limite) params.set('limite', String(limite));
  return jsonOrThrow(await fetch(`${BASE_DATOS_URL}/consultas?${params}`));
}

const CORREO_URL = '/api/correo';

export async function fetchCorreoEstado() {
  return jsonOrThrow(await fetch(`${CORREO_URL}/estado`));
}

export async function saveCorreoConfig({ permitidos, limiteDiario }) {
  return jsonOrThrow(
    await fetch(`${CORREO_URL}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permitidos, limiteDiario }),
    })
  );
}

export async function probarCorreo() {
  return jsonOrThrow(await fetch(`${CORREO_URL}/probar`, { method: 'POST' }));
}

export async function fetchCorreos({ estado, agentId, limite } = {}) {
  const params = new URLSearchParams();
  if (estado) params.set('estado', estado);
  if (agentId) params.set('agentId', agentId);
  if (limite) params.set('limite', String(limite));
  return jsonOrThrow(await fetch(`${CORREO_URL}/correos?${params}`));
}

export async function aprobarCorreo(id, cambios = {}) {
  return jsonOrThrow(
    await fetch(`${CORREO_URL}/correos/${encodeURIComponent(id)}/aprobar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios),
    })
  );
}

export async function descartarCorreo(id) {
  return jsonOrThrow(await fetch(`${CORREO_URL}/correos/${encodeURIComponent(id)}/descartar`, { method: 'POST' }));
}

export async function fetchActividad(agentId, { desde, limite } = {}) {
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (limite) params.set('limite', String(limite));
  return jsonOrThrow(await fetch(`${BASE_URL}/${encodeURIComponent(agentId)}/actividad?${params}`));
}

export async function fetchCiclos() {
  return jsonOrThrow(await fetch(`${BASE_URL}/ciclos`));
}

const INSTALABLES_URL = '/api/instalables';

export async function fetchInstalables() {
  return jsonOrThrow(await fetch(INSTALABLES_URL));
}

async function sendJson(url, method, body) {
  return jsonOrThrow(await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
}

export const instalarSkill = (url) => sendJson(`${INSTALABLES_URL}/skills`, 'POST', { url });
export const quitarSkillInstalada = (id) => sendJson(`${INSTALABLES_URL}/skills/${encodeURIComponent(id)}`, 'DELETE');
export const instalarPlugin = (datos) => sendJson(`${INSTALABLES_URL}/plugins`, 'POST', datos);
export const probarPlugin = (id) => sendJson(`${INSTALABLES_URL}/plugins/${encodeURIComponent(id)}/probar`, 'POST');
export const quitarPlugin = (id) => sendJson(`${INSTALABLES_URL}/plugins/${encodeURIComponent(id)}`, 'DELETE');
export async function fetchRevisionesPR() {
  return jsonOrThrow(await fetch('/api/revisiones-pr'));
}

const APROBACIONES_URL = '/api/aprobaciones';

export async function fetchAprobaciones(params = {}) {
  const qs = new URLSearchParams(params);
  return jsonOrThrow(await fetch(`${APROBACIONES_URL}?${qs}`));
}

export const aprobarAprobacion = (id, body) => sendJson(`${APROBACIONES_URL}/${encodeURIComponent(id)}/aprobar`, 'POST', body);
export const descartarAprobacion = (id) => sendJson(`${APROBACIONES_URL}/${encodeURIComponent(id)}/descartar`, 'POST');
