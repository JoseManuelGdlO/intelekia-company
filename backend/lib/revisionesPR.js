const fs = require('fs');
const path = require('path');

/**
 * Lógica sin IA del Revisor de PRs: estado persistente por PR y detección de PRs pendientes.
 * (Las restricciones de herramientas y el candado del merge se agregan en este mismo archivo.)
 */
const MAX_POR_CICLO = 5;

// Herramientas del plugin de GitHub que puede usar el modelo (el resto se le quita).
const REVISION_LECTURA = ['pull_request_read', 'get_file_contents'];
const REVISION_ESCRITURA = ['pull_request_review_write', 'add_comment_to_pending_review', 'merge_pull_request'];
// En pull_request_review_write el modelo solo crea/envía/descarta su review (nunca resuelve hilos).
const METODOS_REVIEW = ['create', 'submit_pending', 'delete_pending'];
const EVENTOS_REVIEW = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];
const CHAT_LECTURA =['pull_request_read', 'get_file_contents', 'search_pull_requests', 'list_pull_requests'];

function claveDe({ owner, repo, numero }) {
  return `${owner}/${repo}#${numero}`;
}

/** https://github.com/OWNER/REPO/pull/N → { owner, repo, numero } */
function parsePrUrl(url) {
  const m = String(url || '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return m ? { owner: m[1], repo: m[2], numero: Number(m[3]) } : null;
}

/**
 * Hilos de review sin resolver (los "outdated" también cuentan: el autor debe marcarlos).
 * Falla cerrado: devuelve Infinity si no puede estar seguro (respuesta mal formada,
 * sin `review_threads`, o lista parcial por paginación), para que nunca se interprete como "todo resuelto".
 */
function hilosAbiertos(respuesta) {
  if (!Array.isArray(respuesta?.review_threads)) return Infinity;
  const hilos = respuesta.review_threads;
  if (respuesta.pageInfo?.hasNextPage === true) return Infinity;
  if (Number.isFinite(respuesta.totalCount) && respuesta.totalCount > hilos.length) return Infinity;
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

/** "mcp_github__merge_pull_request" → "merge_pull_request"; null si no es de un plugin. */
function herramientaDe(nombre) {
  const n = String(nombre || '');
  if (!n.startsWith('mcp_') || !n.includes('__')) return null;
  return n.slice(n.lastIndexOf('__') + 2);
}

function esDelRepo(pr, args = {}) {
  return (
    String(args.owner || '').toLowerCase() === pr.owner.toLowerCase() &&
    String(args.repo || '').toLowerCase() === pr.repo.toLowerCase()
  );
}

function esDelPr(pr, args = {}) {
  return esDelRepo(pr, args) && Number(args.pullNumber) === pr.numero;
}

function bloqueo(pr) {
  return `Bloqueado: en esta revisión solo puedes actuar sobre ${pr.clave} (owner "${pr.owner}", repo "${pr.repo}", pullNumber ${pr.numero}).`;
}

/**
 * Para el ciclo: el modelo solo puede leer y publicar la revisión del PR en curso.
 * El diff es contenido de terceros (posible prompt injection), por eso se quitan las demás
 * herramientas y cada escritura se valida en código. El merge además exige cero hilos sin
 * resolver y se fija al SHA revisado (si llegó otro commit durante la revisión, GitHub lo rechaza).
 */
function herramientasRevision({ pr, github }) {
  return ({ tools, handlers }) => {
    const permitidas = tools.filter((t) => [...REVISION_LECTURA, ...REVISION_ESCRITURA].includes(herramientaDe(t.function.name)));
    const nuevos = {};
    permitidas.forEach((t) => {
      const nombre = t.function.name;
      const herramienta = herramientaDe(nombre);
      const original = handlers[nombre];
      if (herramienta === 'get_file_contents') {
        // Solo archivos del repo del PR. `ref` no se restringe: se esperan las ramas head y base.
        nuevos[nombre] = async (args = {}) => (esDelRepo(pr, args) ? original(args) : bloqueo(pr));
        return;
      }
      nuevos[nombre] = async (args = {}) => {
        if (!esDelPr(pr, args)) return bloqueo(pr);
        if (herramienta === 'pull_request_review_write') {
          if (!METODOS_REVIEW.includes(args.method)) {
            return `Bloqueado: no puedes usar el método "${args.method}"; solo puedes crear y enviar tu review.`;
          }
          if (args.event !== undefined && !EVENTOS_REVIEW.includes(args.event)) {
            return `Bloqueado: no puedes usar el event "${args.event}"; solo APPROVE, REQUEST_CHANGES o COMMENT.`;
          }
          return original(args.method === 'create' ? { ...args, commitID: pr.sha } : args);
        }
        if (herramienta !== 'merge_pull_request') return original(args);
        const hilos = await github.llamar('pull_request_read', { method: 'get_review_comments', owner: pr.owner, repo: pr.repo, pullNumber: pr.numero, perPage: 100 });
        const abiertos = hilosAbiertos(hilos);
        if (abiertos === Infinity) return 'Merge bloqueado: no se pudo confirmar que todos los comentarios estén resueltos.';
        if (abiertos > 0) return `Merge bloqueado: el PR tiene ${abiertos} comentario(s) sin resolver.`;
        return original({ ...args, expectedHeadSha: pr.sha });
      };
    });
    return {
      tools: permitidas,
      handlers: nuevos,
      instrucciones: [`Estás revisando ${pr.clave}. Solo tienes herramientas de GitHub para leer este PR y publicar su revisión.`],
    };
  };
}

/** Para el chat: solo consultas; nunca aprobar, comentar ni hacer merge. */
function herramientasSoloLectura() {
  return ({ tools, handlers }) => {
    const permitidas = tools.filter((t) => CHAT_LECTURA.includes(herramientaDe(t.function.name)));
    return {
      tools: permitidas,
      handlers: Object.fromEntries(permitidas.map((t) => [t.function.name, handlers[t.function.name]])),
      instrucciones: ['Puedes consultar PRs de GitHub en modo lectura. Las revisiones, aprobaciones y merges solo los haces en tu ciclo automático, nunca desde el chat.'],
    };
  };
}

module.exports = {
  createRevisionesStore,
  detectar,
  herramientasRevision,
  herramientasSoloLectura,
  herramientaDe,
  parsePrUrl,
  hilosAbiertos,
  claveDe,
  MAX_POR_CICLO,
};
