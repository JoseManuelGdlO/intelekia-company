const fs = require('fs');
const path = require('path');

/**
 * Lógica sin IA del Revisor de PRs: estado persistente por PR y detección de PRs pendientes.
 * (Las restricciones de herramientas y el candado del merge se agregan en este mismo archivo.)
 */
const MAX_POR_CICLO = 5;

function claveDe({ owner, repo, numero }) {
  return `${owner}/${repo}#${numero}`;
}

/** https://github.com/OWNER/REPO/pull/N → { owner, repo, numero } */
function parsePrUrl(url) {
  const m = String(url || '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return m ? { owner: m[1], repo: m[2], numero: Number(m[3]) } : null;
}

/** Hilos de review sin resolver (los "outdated" también cuentan: el autor debe marcarlos). */
function hilosAbiertos(respuesta) {
  const hilos = Array.isArray(respuesta?.review_threads) ? respuesta.review_threads : [];
  return hilos.filter((h) => !h.is_resolved).length;
}

function createRevisionesStore({ filePath, now = () => new Date() }) {
  function leer() {
    if (!filePath || !fs.existsSync(filePath)) return { prs: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return { prs: raw && raw.prs && typeof raw.prs === 'object' ? raw.prs : {} };
    } catch {
      return { prs: {} };
    }
  }

  function get(clave) {
    return leer().prs[clave] || null;
  }

  function registrar(clave, datos) {
    const estado = leer();
    estado.prs[clave] = { ...datos, revisadoEn: now().toISOString() };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(estado, null, 2));
    return estado.prs[clave];
  }

  function lista() {
    return Object.entries(leer().prs)
      .map(([clave, datos]) => ({ clave, ...datos }))
      .sort((a, b) => String(b.revisadoEn).localeCompare(String(a.revisadoEn)));
  }

  return { get, registrar, lista };
}

/**
 * PRs abiertos de los repos de `github.owner` que hay que revisar en este ciclo:
 *  - nuevos (sin registro) o en `error` (el agente decide si ya agotó sus intentos);
 *  - `bloqueado` solo si llegó un commit nuevo;
 *  - `cambios_pedidos` solo si llegó un commit nuevo Y no quedan hilos sin resolver.
 */
async function detectar({ github, store, max = MAX_POR_CICLO }) {
  const owner = String(github.owner);
  const busqueda = await github.llamar('search_pull_requests', { query: `is:pr is:open draft:false user:${owner}`, perPage: 50 });
  const items = Array.isArray(busqueda?.items) ? busqueda.items : [];
  const pendientes = [];

  for (const item of items) {
    if (pendientes.length >= max) break;
    const ref = parsePrUrl(item.html_url);
    if (!ref || item.draft) continue;
    const autor = String(item.user?.login || '');
    if (autor.toLowerCase() === owner.toLowerCase()) continue;

    const pr = await github.llamar('pull_request_read', { method: 'get', owner: ref.owner, repo: ref.repo, pullNumber: ref.numero });
    const sha = pr?.head?.sha;
    if (!sha) continue;
    const clave = claveDe(ref);
    const candidato = { ...ref, clave, sha, titulo: item.title || pr.title || '', autor, url: item.html_url, mergeableState: pr.mergeable_state || null };

    const previo = store.get(clave);
    const shaNuevo = previo && previo.sha !== sha;
    if (!previo || previo.veredicto === 'error') {
      pendientes.push(candidato);
    } else if (previo.veredicto === 'bloqueado') {
      if (shaNuevo) pendientes.push(candidato);
    } else if (previo.veredicto === 'cambios_pedidos' && shaNuevo) {
      const hilos = await github.llamar('pull_request_read', { method: 'get_review_comments', owner: ref.owner, repo: ref.repo, pullNumber: ref.numero, perPage: 100 });
      if (hilosAbiertos(hilos) === 0) pendientes.push(candidato);
    }
  }
  return pendientes;
}

module.exports = { createRevisionesStore, detectar, parsePrUrl, hilosAbiertos, claveDe, MAX_POR_CICLO };
