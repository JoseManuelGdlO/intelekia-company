/**
 * Acceso directo (sin IA) al plugin MCP de GitHub que el agente tiene asignado.
 * El plugin se reconoce por sus herramientas, no por su nombre, así funciona aunque el
 * fundador lo instale con otro nombre.
 */
const HERRAMIENTAS_REQUERIDAS = ['search_pull_requests', 'pull_request_read', 'pull_request_review_write', 'merge_pull_request'];

function parsearResultado(texto) {
  if (/^Error del plugin:/.test(texto)) throw new Error(texto);
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

function createGithubPlugin({ instalables, profiles, agentId, owner }) {
  function pluginId() {
    const asignados = profiles.instaladosOf(agentId).plugins;
    const plugin = instalables
      .list()
      .plugins.find((p) => asignados.includes(p.id) && HERRAMIENTAS_REQUERIDAS.every((h) => (p.herramientas || []).some((t) => t.nombre === h)));
    return plugin ? plugin.id : null;
  }

  function estado() {
    if (!owner) return { ok: false, motivo: 'Falta GITHUB_OWNER en backend/.env' };
    const id = pluginId();
    if (!id) {
      return {
        ok: false,
        motivo: 'Instala el plugin de GitHub (URL https://api.githubcopilot.com/mcp/ con la variable GITHUB_TOKEN) y asígnalo en Editar → Instalados',
      };
    }
    return { ok: true, pluginId: id };
  }

  async function llamar(herramienta, args) {
    const e = estado();
    if (!e.ok) throw new Error(e.motivo);
    return parsearResultado(await instalables.llamar(e.pluginId, herramienta, args, { maxChars: Infinity }));
  }

  return { owner, estado, llamar };
}

module.exports = { createGithubPlugin, HERRAMIENTAS_REQUERIDAS };
