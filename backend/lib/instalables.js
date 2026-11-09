const fs = require('fs');
const path = require('path');

/**
 * Skills y plugins INSTALABLES (sacados de internet), compartidos por toda la empresa;
 * cada agente elige cuáles usa (perfil → instalados).
 *
 *  - Skill: una carpeta de GitHub con SKILL.md (formato de Agent Skills, p. ej. anthropics/skills).
 *    Se descargan SKILL.md y sus archivos de texto. Al agente se le entrega el SKILL.md completo
 *    y puede leer los demás archivos (ejemplos, referencias) con la herramienta leer_archivo_skill.
 *    Los scripts (.py, .sh…) se guardan como referencia pero NO se ejecutan.
 *  - Plugin: un servidor MCP (Model Context Protocol). Remoto por URL (Streamable HTTP) o local
 *    por paquete npm (se lanza con npx). Sus herramientas se le dan al agente como funciones reales.
 */
const MAX_ARCHIVOS = 40;
const MAX_ARCHIVO = 200 * 1024;
const MAX_TOTAL = 1024 * 1024;
const MAX_RESULTADO = 12000;
const TEXTO_RE = /\.(md|markdown|txt|json|ya?ml|csv|html?|xml|py|js|ts|sh|toml|ini|cfg)$/i;
const CLIENTE = { name: 'intelekia-oficina', version: '1.0.0' };

function slug(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'item';
}

/** github.com/OWNER/REPO[/tree|blob/REF[/RUTA]] → { owner, repo, ref, ruta } */
function parseGithubUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    throw new Error('URL inválida. Usa una carpeta de GitHub, ej. https://github.com/anthropics/skills/tree/main/skills/internal-comms');
  }
  if (url.hostname !== 'github.com') throw new Error('Por ahora solo se instalan skills desde github.com');
  const [owner, repo, modo, ref, ...resto] = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (!owner || !repo) throw new Error('La URL debe incluir usuario y repositorio de GitHub');
  let ruta = resto.join('/');
  if (modo === 'blob') ruta = ruta.replace(/\/?SKILL\.md$/i, ''); // apuntaron al SKILL.md
  else if (modo && modo !== 'tree') throw new Error('Usa la URL de la carpeta (…/tree/main/ruta) o del SKILL.md');
  return { owner, repo: repo.replace(/\.git$/, ''), ref: ref || null, ruta };
}

function parseFrontmatter(text) {
  const m = String(text).match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const datos = {};
  if (m) {
    m[1].split('\n').forEach((linea) => {
      const kv = linea.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (kv) datos[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
    });
  }
  return { datos, cuerpo: m ? String(text).slice(m[0].length) : String(text) };
}

/** Nombre válido para una función de OpenAI: ^[a-zA-Z0-9_-]{1,64}$ */
function nombreFuncion(pluginId, tool) {
  return `mcp_${pluginId.replace(/-/g, '_')}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function textoDeResultado(result, maxChars = MAX_RESULTADO) {
  const partes = (result?.content || []).map((c) => {
    if (c.type === 'text') return c.text;
    if (c.type === 'resource') return c.resource?.text || `[recurso ${c.resource?.uri || ''}]`;
    return `[${c.type}]`;
  });
  if (!partes.length && result?.structuredContent) partes.push(JSON.stringify(result.structuredContent));
  const texto = partes.join('\n').trim() || '(sin contenido)';
  const recortado = texto.length > maxChars ? `${texto.slice(0, maxChars)}\n…(recortado)` : texto;
  return result?.isError ? `Error del plugin: ${recortado}` : recortado;
}

/** Cabecera de autenticación para un plugin http que declara `tokenEnv` (el token vive en .env). */
function opcionesHttp(plugin, env = process.env) {
  if (!plugin.tokenEnv) return {};
  const token = env[plugin.tokenEnv];
  if (!token) throw new Error(`Falta ${plugin.tokenEnv} en backend/.env para conectar ${plugin.nombre}`);
  return { requestInit: { headers: { Authorization: `Bearer ${token}` } } };
}

/** Conexión MCP real con el SDK oficial. Separada para poder simularla en pruebas. */
async function conectarMcp(plugin, { env = process.env } = {}) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const client = new Client(CLIENTE);
  let transport;
  if (plugin.transporte === 'http') {
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    transport = new StreamableHTTPClientTransport(new URL(plugin.url), opcionesHttp(plugin, env));
  } else {
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
    transport = new StdioClientTransport({ command: 'npx', args: ['-y', plugin.paquete, ...(plugin.args || [])], stderr: 'ignore' });
  }
  await client.connect(transport);
  return client;
}

function createInstalables({ dir, fetchImpl = (...a) => fetch(...a), conectar = conectarMcp, now = () => new Date(), timeoutMs = 60000, env = process.env }) {
  const skillsDir = path.join(dir, 'skills');
  const indicePath = path.join(dir, 'instalados.json');
  const clientes = new Map(); // pluginId -> Promise<Client>

  function leerIndice() {
    if (!fs.existsSync(indicePath)) return { skills: [], plugins: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(indicePath, 'utf-8'));
      return { skills: raw.skills || [], plugins: raw.plugins || [] };
    } catch {
      return { skills: [], plugins: [] };
    }
  }

  function guardarIndice(indice) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(indicePath, JSON.stringify(indice, null, 2));
  }

  function idUnico(base, existentes) {
    let id = slug(base);
    let n = 2;
    while (existentes.some((x) => x.id === id)) id = `${slug(base)}-${n++}`;
    return id;
  }

  // ---------------- Skills ----------------

  async function gh(url) {
    const res = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'intelekia-oficina' } });
    if (res.status === 404) throw new Error('No se encontró esa carpeta en GitHub (¿repositorio privado o ruta mal escrita?)');
    if (res.status === 403) throw new Error('GitHub limitó las descargas por ahora; intenta en unos minutos');
    if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
    return res;
  }

  async function listarCarpeta({ owner, repo, ref, ruta }, prefijo = '', archivos = []) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const rutaApi = [ruta, prefijo].filter(Boolean).join('/');
    const items = await (await gh(`https://api.github.com/repos/${owner}/${repo}/contents/${rutaApi}${q}`)).json();
    if (!Array.isArray(items)) throw new Error('La URL debe apuntar a una carpeta, no a un archivo suelto');
    for (const item of items) {
      const rel = prefijo ? `${prefijo}/${item.name}` : item.name;
      if (item.type === 'dir') await listarCarpeta({ owner, repo, ref, ruta }, rel, archivos);
      else if (item.type === 'file' && (TEXTO_RE.test(item.name) || /^SKILL\.md$/i.test(item.name)) && item.size <= MAX_ARCHIVO) {
        archivos.push({ ruta: rel, url: item.download_url, size: item.size });
      }
      if (archivos.length >= MAX_ARCHIVOS) break;
    }
    return archivos;
  }

  async function instalarSkill(url) {
    const fuente = parseGithubUrl(url);
    const archivos = await listarCarpeta(fuente);
    const principal = archivos.find((a) => a.ruta.toLowerCase() === 'skill.md');
    if (!principal) throw new Error('Esa carpeta no tiene SKILL.md: no es un skill instalable');
    const total = archivos.reduce((n, a) => n + a.size, 0);
    if (total > MAX_TOTAL) throw new Error('El skill es demasiado grande (más de 1 MB de texto)');

    const contenidos = {};
    for (const a of archivos) contenidos[a.ruta] = await (await gh(a.url)).text();
    const { datos } = parseFrontmatter(contenidos[principal.ruta]);
    const nombre = datos.name || fuente.ruta.split('/').pop() || fuente.repo;

    const indice = leerIndice();
    const id = idUnico(nombre, indice.skills);
    const destino = path.join(skillsDir, id);
    fs.rmSync(destino, { recursive: true, force: true });
    Object.entries(contenidos).forEach(([rel, texto]) => {
      const file = path.join(destino, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, texto);
    });
    const skill = {
      id,
      nombre,
      descripcion: datos.description || '',
      licencia: datos.license || null,
      fuente: `https://github.com/${fuente.owner}/${fuente.repo}${fuente.ruta ? `/tree/${fuente.ref || 'main'}/${fuente.ruta}` : ''}`,
      archivos: Object.keys(contenidos).sort(),
      instaladoEn: now().toISOString(),
    };
    indice.skills.push(skill);
    guardarIndice(indice);
    return skill;
  }

  function getSkill(id) {
    const skill = leerIndice().skills.find((s) => s.id === id);
    if (!skill) throw new Error(`Skill desconocido: ${id}`);
    return skill;
  }

  function leerArchivoSkill(id, ruta) {
    const skill = getSkill(id);
    const base = path.resolve(skillsDir, id);
    const file = path.resolve(base, String(ruta || 'SKILL.md'));
    if (!file.startsWith(base + path.sep)) throw new Error('Ruta inválida');
    if (!fs.existsSync(file)) throw new Error(`El skill ${skill.nombre} no tiene el archivo ${ruta}. Archivos: ${skill.archivos.join(', ')}`);
    return fs.readFileSync(file, 'utf-8');
  }

  function quitarSkill(id) {
    getSkill(id);
    const indice = leerIndice();
    indice.skills = indice.skills.filter((s) => s.id !== id);
    guardarIndice(indice);
    fs.rmSync(path.join(skillsDir, id), { recursive: true, force: true });
    return { ok: true };
  }

  // ---------------- Plugins (MCP) ----------------

  function conTiempo(promesa, que) {
    let t;
    return Promise.race([
      promesa,
      new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error(`${que}: no respondió en ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
        if (t.unref) t.unref();
      }),
    ]).finally(() => clearTimeout(t));
  }

  function clienteDe(plugin) {
    if (!clientes.has(plugin.id)) {
      const p = conTiempo(conectar(plugin, { env }), `No se pudo conectar a ${plugin.nombre}`);
      p.catch(() => clientes.delete(plugin.id));
      clientes.set(plugin.id, p);
    }
    return clientes.get(plugin.id);
  }

  async function cerrar(pluginId) {
    const p = clientes.get(pluginId);
    clientes.delete(pluginId);
    if (p) {
      try {
        await (await p).close();
      } catch {
        // ya estaba cerrado
      }
    }
  }

  function normalizarPlugin({ nombre, url, paquete, args, tokenEnv }) {
    const u = String(url || '').trim();
    const pkg = String(paquete || '').trim();
    const variable = String(tokenEnv || '').trim();
    if (!u && !pkg) throw new Error('Indica la URL del servidor MCP o el paquete npm');
    if (u && pkg) throw new Error('Usa la URL o el paquete npm, no ambos');
    if (variable && !u) throw new Error('La variable del token solo aplica a plugins por URL');
    if (variable && !/^[A-Z_][A-Z0-9_]*$/.test(variable)) throw new Error('Nombre de variable inválido (usa MAYÚSCULAS, ej. GITHUB_TOKEN)');
    if (variable && !env[variable]) throw new Error(`La variable ${variable} no está definida en backend/.env`);
    if (u) {
      let parsed;
      try {
        parsed = new URL(u);
      } catch {
        throw new Error('URL inválida');
      }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('La URL debe ser http(s)');
      const plugin = { transporte: 'http', url: parsed.toString(), nombre: String(nombre || '').trim() || parsed.hostname };
      if (variable) plugin.tokenEnv = variable;
      return plugin;
    }
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(@[a-z0-9.^~_-]+)?$/i.test(pkg)) throw new Error('Nombre de paquete npm inválido');
    const lista = Array.isArray(args) ? args.map(String) : String(args || '').split(/\s+/).filter(Boolean);
    if (lista.some((a) => /[;&|`$<>]/.test(a))) throw new Error('Los argumentos no pueden tener caracteres de shell');
    return { transporte: 'npm', paquete: pkg, args: lista, nombre: String(nombre || '').trim() || pkg.replace(/^@[^/]+\//, '') };
  }

  async function descubrir(plugin) {
    const client = await clienteDe(plugin);
    const { tools } = await conTiempo(client.listTools(), `${plugin.nombre} no listó sus herramientas`);
    return tools.map((t) => ({ nombre: t.name, descripcion: t.description || '', esquema: t.inputSchema || { type: 'object', properties: {} } }));
  }

  async function instalarPlugin(datos) {
    const base = normalizarPlugin(datos);
    const indice = leerIndice();
    const plugin = { id: idUnico(base.nombre, indice.plugins), ...base, instaladoEn: now().toISOString() };
    try {
      plugin.herramientas = await descubrir(plugin);
    } catch (err) {
      await cerrar(plugin.id);
      throw new Error(`No se pudo instalar el plugin: ${err.message}`);
    }
    plugin.probadoEn = now().toISOString();
    indice.plugins.push(plugin);
    guardarIndice(indice);
    return plugin;
  }

  function getPlugin(id) {
    const plugin = leerIndice().plugins.find((p) => p.id === id);
    if (!plugin) throw new Error(`Plugin desconocido: ${id}`);
    return plugin;
  }

  /** Reconecta y vuelve a leer sus herramientas. */
  async function probarPlugin(id) {
    const plugin = getPlugin(id);
    await cerrar(id);
    const herramientas = await descubrir(plugin);
    const indice = leerIndice();
    const item = indice.plugins.find((p) => p.id === id);
    Object.assign(item, { herramientas, probadoEn: now().toISOString() });
    guardarIndice(indice);
    return item;
  }

  async function quitarPlugin(id) {
    getPlugin(id);
    await cerrar(id);
    const indice = leerIndice();
    indice.plugins = indice.plugins.filter((p) => p.id !== id);
    guardarIndice(indice);
    return { ok: true };
  }

  async function llamar(pluginId, herramienta, args, { maxChars = MAX_RESULTADO } = {}) {
    const plugin = getPlugin(pluginId);
    try {
      const client = await clienteDe(plugin);
      return textoDeResultado(await conTiempo(client.callTool({ name: herramienta, arguments: args || {} }), `${plugin.nombre} tardó demasiado`), maxChars);
    } catch (err) {
      await cerrar(pluginId); // la próxima vez reconecta
      throw err;
    }
  }

  /**
   * Lo que necesita un agente para usar lo instalado: texto para el prompt y herramientas
   * (formato OpenAI) con sus manejadores. Ignora ids que ya no existen.
   */
  function paraAgente({ skills = [], plugins = [] } = {}) {
    const indice = leerIndice();
    const misSkills = indice.skills.filter((s) => skills.includes(s.id));
    const misPlugins = indice.plugins.filter((p) => plugins.includes(p.id));
    const tools = [];
    const handlers = {};
    const describir = {};

    if (misSkills.some((s) => s.archivos.length > 1)) {
      tools.push({
        type: 'function',
        function: {
          name: 'leer_archivo_skill',
          description: 'Lee un archivo de apoyo (ejemplos, guías, referencias) de uno de tus skills instalados cuando el SKILL.md te indique usarlo.',
          parameters: {
            type: 'object',
            properties: {
              skill: { type: 'string', enum: misSkills.map((s) => s.id) },
              ruta: { type: 'string', description: 'Ruta del archivo dentro del skill, ej. examples/3p-updates.md' },
            },
            required: ['skill', 'ruta'],
          },
        },
      });
      handlers.leer_archivo_skill = (a) => leerArchivoSkill(a.skill, a.ruta);
      describir.leer_archivo_skill = (a) => `📖 Lee ${a.ruta} del skill ${a.skill}`;
    }

    misPlugins.forEach((p) => {
      (p.herramientas || []).forEach((h) => {
        const name = nombreFuncion(p.id, h.nombre);
        const esquema = h.esquema && h.esquema.type === 'object' ? h.esquema : { type: 'object', properties: {} };
        tools.push({ type: 'function', function: { name, description: `[Plugin ${p.nombre}] ${h.descripcion}`.slice(0, 1024), parameters: esquema } });
        handlers[name] = (a) => llamar(p.id, h.nombre, a);
        describir[name] = (a) => `🔌 Plugin ${p.nombre} → ${h.nombre}${Object.keys(a || {}).length ? `: ${JSON.stringify(a).slice(0, 200)}` : ''}`;
      });
    });

    const instrucciones = [];
    misSkills.forEach((s) => {
      let skillMd = '';
      try {
        skillMd = parseFrontmatter(leerArchivoSkill(s.id, 'SKILL.md')).cuerpo;
      } catch {
        return;
      }
      const otros = s.archivos.filter((r) => r.toLowerCase() !== 'skill.md');
      instrucciones.push(
        `## Skill instalado: ${s.nombre} (id: ${s.id})\nCuándo usarlo: ${s.descripcion}\n\n${skillMd.trim()}` +
          (otros.length ? `\n\nArchivos de apoyo (léelos con leer_archivo_skill cuando el skill lo indique): ${otros.join(', ')}` : '')
      );
    });
    if (misPlugins.length) {
      instrucciones.push(
        `Tienes plugins instalados (${misPlugins.map((p) => p.nombre).join(', ')}): sus herramientas empiezan con "mcp_". ` +
          'Úsalas cuando te den información real que necesitas, en lugar de suponer.'
      );
    }
    return { tools, handlers, describir, instrucciones };
  }

  function list() {
    return leerIndice();
  }

  async function cerrarTodo() {
    await Promise.all([...clientes.keys()].map(cerrar));
  }

  return { list, instalarSkill, quitarSkill, leerArchivoSkill, instalarPlugin, probarPlugin, quitarPlugin, llamar, paraAgente, cerrarTodo };
}

module.exports = { createInstalables, parseGithubUrl, parseFrontmatter, nombreFuncion, textoDeResultado, opcionesHttp };
