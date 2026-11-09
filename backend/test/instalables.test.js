const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createInstalables, parseGithubUrl, nombreFuncion, textoDeResultado } = require('../lib/instalables');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'instalables-'));
}

// GitHub simulado: una carpeta skills/demo con SKILL.md, un ejemplo y un binario que se ignora.
const ARCHIVOS = {
  'skills/demo/SKILL.md': '---\nname: demo-skill\ndescription: Escribe reportes\nlicense: MIT\n---\n# Demo\nUsa examples/a.md',
  'skills/demo/examples/a.md': 'Ejemplo A',
};
function fakeFetch(url) {
  const resp = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => body });
  const m = url.match(/contents\/([^?]*)/);
  if (m) {
    const ruta = m[1];
    if (ruta === 'skills/demo') {
      return resp([
        { type: 'file', name: 'SKILL.md', size: 80, download_url: 'raw:skills/demo/SKILL.md' },
        { type: 'file', name: 'logo.png', size: 10, download_url: 'raw:x' },
        { type: 'dir', name: 'examples' },
      ]);
    }
    if (ruta === 'skills/demo/examples') return resp([{ type: 'file', name: 'a.md', size: 9, download_url: 'raw:skills/demo/examples/a.md' }]);
    if (ruta === 'skills/nada') return resp([{ type: 'file', name: 'README.md', size: 3, download_url: 'raw:r' }]);
    return resp({ message: 'Not Found' }, 404);
  }
  return resp(ARCHIVOS[url.replace('raw:', '')] || 'x');
}

function fakeMcp(llamadas = []) {
  return async () => ({
    listTools: async () => ({ tools: [{ name: 'ask_question', description: 'Pregunta', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }] }),
    callTool: async (req) => {
      llamadas.push(req);
      return { content: [{ type: 'text', text: `respuesta a ${req.arguments.q}` }] };
    },
    close: async () => {},
  });
}

test('parseGithubUrl entiende carpetas, SKILL.md y repos', () => {
  assert.deepStrictEqual(parseGithubUrl('https://github.com/anthropics/skills/tree/main/skills/internal-comms'), {
    owner: 'anthropics', repo: 'skills', ref: 'main', ruta: 'skills/internal-comms',
  });
  assert.strictEqual(parseGithubUrl('https://github.com/a/b/blob/main/x/SKILL.md').ruta, 'x');
  assert.strictEqual(parseGithubUrl('https://github.com/a/b').ruta, '');
  assert.throws(() => parseGithubUrl('https://gitlab.com/a/b'), /github.com/);
  assert.throws(() => parseGithubUrl('nada'), /URL inválida/);
});

test('instalarSkill descarga SKILL.md y archivos de texto, lee el frontmatter', async () => {
  const dir = tmp();
  const inst = createInstalables({ dir, fetchImpl: fakeFetch });
  const skill = await inst.instalarSkill('https://github.com/acme/skills/tree/main/skills/demo');
  assert.strictEqual(skill.id, 'demo-skill');
  assert.strictEqual(skill.descripcion, 'Escribe reportes');
  assert.deepStrictEqual(skill.archivos, ['SKILL.md', 'examples/a.md']);
  assert.strictEqual(inst.leerArchivoSkill('demo-skill', 'examples/a.md'), 'Ejemplo A');
  assert.throws(() => inst.leerArchivoSkill('demo-skill', '../../instalados.json'), /Ruta inválida/);
  // Reinstalar no pisa: crea otro id.
  assert.strictEqual((await inst.instalarSkill('https://github.com/acme/skills/tree/main/skills/demo')).id, 'demo-skill-2');
  inst.quitarSkill('demo-skill-2');
  assert.deepStrictEqual(inst.list().skills.map((s) => s.id), ['demo-skill']);
});

test('instalarSkill rechaza carpetas sin SKILL.md o inexistentes', async () => {
  const inst = createInstalables({ dir: tmp(), fetchImpl: fakeFetch });
  await assert.rejects(inst.instalarSkill('https://github.com/acme/skills/tree/main/skills/nada'), /no tiene SKILL.md/);
  await assert.rejects(inst.instalarSkill('https://github.com/acme/skills/tree/main/skills/otra'), /No se encontró/);
});

test('instalarPlugin descubre las herramientas del servidor MCP y valida la entrada', async () => {
  const inst = createInstalables({ dir: tmp(), conectar: fakeMcp() });
  const plugin = await inst.instalarPlugin({ nombre: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp' });
  assert.strictEqual(plugin.id, 'deepwiki');
  assert.strictEqual(plugin.transporte, 'http');
  assert.deepStrictEqual(plugin.herramientas.map((h) => h.nombre), ['ask_question']);
  await assert.rejects(inst.instalarPlugin({}), /URL del servidor MCP o el paquete/);
  await assert.rejects(inst.instalarPlugin({ url: 'ftp://x' }), /http/);
  await assert.rejects(inst.instalarPlugin({ paquete: 'x; rm -rf /' }), /paquete npm inválido/);
  await assert.rejects(inst.instalarPlugin({ paquete: 'ok-pkg', args: 'a $(b)' }), /caracteres de shell/);
  const npm = await inst.instalarPlugin({ paquete: '@acme/mcp-server-demo' });
  assert.strictEqual(npm.transporte, 'npm');
  assert.strictEqual(npm.nombre, 'mcp-server-demo');
});

test('si el servidor MCP no conecta, no se instala', async () => {
  const inst = createInstalables({ dir: tmp(), conectar: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(inst.instalarPlugin({ url: 'https://x.test/mcp' }), /No se pudo instalar el plugin: ECONNREFUSED/);
  assert.strictEqual(inst.list().plugins.length, 0);
});

test('paraAgente arma instrucciones y herramientas solo con lo asignado', async () => {
  const llamadas = [];
  const inst = createInstalables({ dir: tmp(), fetchImpl: fakeFetch, conectar: fakeMcp(llamadas) });
  await inst.instalarSkill('https://github.com/acme/skills/tree/main/skills/demo');
  await inst.instalarPlugin({ nombre: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp' });

  assert.deepStrictEqual(inst.paraAgente({}).tools, []);
  const extra = inst.paraAgente({ skills: ['demo-skill', 'borrado'], plugins: ['deepwiki'] });
  assert.match(extra.instrucciones[0], /Skill instalado: demo-skill/);
  assert.match(extra.instrucciones[0], /Usa examples\/a.md/);
  assert.doesNotMatch(extra.instrucciones[0], /license: MIT/); // sin frontmatter
  const nombres = extra.tools.map((t) => t.function.name);
  assert.deepStrictEqual(nombres, ['leer_archivo_skill', 'mcp_deepwiki__ask_question']);
  assert.strictEqual(await extra.handlers.leer_archivo_skill({ skill: 'demo-skill', ruta: 'examples/a.md' }), 'Ejemplo A');
  assert.strictEqual(await extra.handlers.mcp_deepwiki__ask_question({ q: 'hola' }), 'respuesta a hola');
  assert.deepStrictEqual(llamadas, [{ name: 'ask_question', arguments: { q: 'hola' } }]);
  assert.match(extra.describir.mcp_deepwiki__ask_question({ q: 'hola' }), /Plugin DeepWiki → ask_question/);
});

test('nombreFuncion y textoDeResultado', () => {
  assert.strictEqual(nombreFuncion('mi-plugin', 'read.wiki'), 'mcp_mi_plugin__read_wiki');
  assert.ok(nombreFuncion('x'.repeat(80), 'y').length <= 64);
  assert.strictEqual(textoDeResultado({ content: [{ type: 'text', text: 'a' }, { type: 'image' }] }), 'a\n[image]');
  assert.strictEqual(textoDeResultado({ isError: true, content: [{ type: 'text', text: 'mal' }] }), 'Error del plugin: mal');
});
