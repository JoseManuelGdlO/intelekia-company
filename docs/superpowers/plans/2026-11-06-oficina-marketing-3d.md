# Oficina de Marketing 3D — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working vertical-slice prototype — a 3D "Marketing office" where the founder can click on two AI agents (a trend-finder and a publisher) to chat with them or watch their autonomous work cycle, as specified in `docs/superpowers/specs/2026-11-06-oficina-marketing-3d-design.md`.

**Architecture:** A Node.js + Express backend runs two file-backed AI agents (OpenAI-powered) on a configurable scheduler, exposing status/chat/force-cycle over a small REST API; a dependency-free Three.js frontend (ES modules via CDN) renders the office, lets the founder click an avatar to open a chat/status panel, and polls the API to reflect live status.

**Tech Stack:** Node.js >= 18, Express 4, `dotenv`, Node's built-in `node:test` + `node:assert/strict` for backend tests, Three.js (loaded as an ES module from a CDN, no bundler) for the frontend.

## Global Constraints

- Node.js >= 18 is required (the code relies on the global `fetch` and on `node:test`).
- Backend code uses CommonJS (`require`/`module.exports`); no `"type": "module"` in `backend/package.json`.
- Frontend code uses native ES modules (`<script type="module">`), loaded directly by the browser — no bundler, no build step.
- Agent status is always one of exactly: `idle`, `trabajando`, `listo_para_revision`, `error`.
- The OpenAI API key lives only in `backend/.env` (gitignored), never hardcoded or committed.
- Shared business context file: `CONTEXTO-INTELEKIA.md` (repo root).
- Agent status file: `backend/state/agents-status.json`.
- Ideas file: `departamentos/marketing/content/ideas.json`.
- Drafts directory: `departamentos/marketing/content/drafts/`.
- Reading/writing `ideas.json` always goes through `backend/lib/ideasStore.js` — no module re-implements its own `readIdeas`/`writeIdeas`.
- Auto-publishing to Instagram/TikTok is out of scope — the Publicador only ever writes a draft file; the founder publishes manually.

---

### Task 1: Project scaffolding and shared content

**Files:**
- Create: `CONTEXTO-INTELEKIA.md`
- Create: `departamentos/marketing/agentes/buscador-tendencias.md`
- Create: `departamentos/marketing/agentes/publicador.md`
- Create: `departamentos/marketing/content/ideas.json`
- Create: `departamentos/marketing/content/drafts/.gitkeep`
- Create: `backend/package.json`
- Create: `backend/.env.example`
- Create: `backend/state/agents-status.json`
- Create: `.gitignore`

**Interfaces:**
- Produces: the on-disk paths every later task reads from — `CONTEXTO-INTELEKIA.md`, `departamentos/marketing/agentes/*.md`, `departamentos/marketing/content/ideas.json`, `departamentos/marketing/content/drafts/`, `backend/state/agents-status.json` (shape: `{ "<agentId>": { "estatus": string, "ultimaAccion": string, "error": string|null, "updatedAt": string|null } }`).

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p departamentos/marketing/agentes
mkdir -p departamentos/marketing/content/drafts
mkdir -p backend/lib
mkdir -p backend/agents
mkdir -p backend/routes
mkdir -p backend/state
mkdir -p backend/test
mkdir -p frontend/src
```

- [ ] **Step 2: Write the shared business context file**

Create `CONTEXTO-INTELEKIA.md` with this exact content:

```markdown
# Contexto empresarial: Intelekia Consultoría

## 1. ¿Qué es Intelekia?

**Intelekia Consultoría** es una empresa mexicana de consultoría tecnológica y desarrollo de software, fundada por José Manuel García de la O, ingeniero en sistemas computacionales, desarrollador Full Stack y líder técnico.

**Sitio web:** https://intelekia.cloud
**Instagram:** @intelekiaconsultoria
**Ubicación:** Durango, México.

Nuestra misión es ayudar a empresas, emprendedores y negocios a modernizar sus operaciones mediante tecnología, automatización e inteligencia artificial.

No nos limitamos a desarrollar páginas web. Analizamos los problemas de cada negocio y diseñamos soluciones tecnológicas que permitan ahorrar tiempo, reducir costos, mejorar la atención al cliente, automatizar procesos y aumentar la productividad.

Nuestro enfoque es convertir ideas y necesidades empresariales en productos digitales funcionales.

## 2. ¿Qué servicios ofrecemos?

### Desarrollo de software a la medida

Creamos aplicaciones y plataformas personalizadas según las necesidades de cada cliente: aplicaciones web, aplicaciones móviles (Android/iOS), sistemas administrativos y empresariales, plataformas SaaS, CRM, sistemas de reservaciones y agendas, plataformas de comercio electrónico, dashboards y reportes, integraciones mediante APIs, y modernización de procesos.

### Inteligencia artificial aplicada a negocios

Agentes inteligentes para atención al cliente, chatbots conectados a WhatsApp, automatización de conversaciones y seguimiento comercial, procesamiento inteligente de documentos, extracción de información mediante OCR e IA, asistentes virtuales especializados, análisis y clasificación de información, automatización de tareas mediante modelos de lenguaje, integraciones con OpenAI y Gemini.

### Automatización empresarial

Confirmación automática de citas, recordatorios y notificaciones, seguimiento de clientes potenciales, procesamiento de solicitudes, automatización de WhatsApp, integración con calendarios, gestión de reservaciones, generación de reportes, automatización de flujos administrativos.

### Consultoría tecnológica

Asesoramiento sobre arquitectura de software, selección de tecnologías, infraestructura, escalabilidad y modernización de sistemas.

## 3. Productos y proyectos de Intelekia

### Plataforma de bots inteligentes para WhatsApp

Atención automatizada mediante IA, respuestas personalizadas según el negocio, gestión de citas y reservaciones, integración con Google Calendar, configuración de horarios por negocio, administración de disponibilidad y espacios por hora, recordatorios automáticos, integración con WhatsApp Business. Sectores atendidos o explorados: consultorios médicos, abogados, comercios y empresas de servicios.

### Alanna: gestión y confirmación de invitados

Solución para organizadores de eventos: administración de invitados, familias, acompañantes y confirmaciones de asistencia, importación de listas, mensajes programados, panel de seguimiento, control de acompañantes, estadísticas del evento. Pensado para bodas, XV años y otros eventos sociales.

### Sistemas para negocios y sectores especializados

Puntos de venta con integración a WhatsApp, plataformas para consultorios médicos y odontológicos, sistemas de RRHH y capacitación, CRM para inmobiliarias, aplicaciones de logística y transporte, plataformas de comercio electrónico, procesamiento de facturas mediante IA, gestión de eventos, plataformas educativas y simuladores.

## 4. Nuestro modelo de negocio

A. Desarrollo a la medida (cliente presenta necesidad, Intelekia analiza, diseña, cotiza y desarrolla).
B. Productos por suscripción (plataformas comercializables mediante pagos mensuales).
C. Implementación y personalización (reutilizar componentes existentes para distintos clientes).
D. Consultoría e integraciones (servicios técnicos especializados e implementación de tecnologías).

## 5. Nuestra forma de trabajar

1. Descubrimiento. 2. Análisis. 3. Prototipado (frecuentemente con Lovable). 4. Validación. 5. Cotización. 6. Desarrollo. 7. Pruebas. 8. Implementación. 9. Evolución.

Un prototipo no necesariamente tiene backend funcional — en etapas iniciales puede ser solo interfaz para validar experiencia y propuesta comercial.

## 6. Tecnologías que utilizamos

Frontend: React, React Native, Angular, Ionic, TypeScript, JavaScript, HTML/CSS.
Backend: Node.js, Python, .NET, Laravel, Django.
IA: OpenAI, Gemini, LangGraph, n8n, OCR y procesamiento documental.
Infraestructura: AWS, Azure, Firebase, Docker, VPS, Hostinger, EasyPanel.
Bases de datos: PostgreSQL, MySQL, Redis.
Integraciones: WhatsApp Business Cloud API, Google Calendar, APIs REST, plataformas de pago.

## 7. Filosofía y diferenciadores

Enfoque empresarial primero, soluciones personalizadas, IA práctica (no por moda), prototipado rápido, escalabilidad hacia SaaS cuando conviene, comunicación cercana y no excesivamente técnica, visión comercial además de técnica.

## 8. Marketing y posicionamiento

Instagram, Reels y TikTok como canales principales. Contenido: videos cortos con humor, situaciones cotidianas de negocios, historias con giros inesperados, demostraciones de automatización, explicaciones sencillas de IA, casos de uso. Se evita sonar excesivamente técnico; se muestran problemas reales con los que un empresario se identifique. Comunicación profesional, moderna, creativa, cercana, adaptada al público mexicano.

## 9. Visión de crecimiento

Evolucionar de consultoría de desarrollo personalizado a empresa tecnológica con productos propios, ingresos recurrentes y soluciones escalables: más cartera de clientes, consolidar la plataforma de automatización e IA, convertir desarrollos reutilizables en productos comerciales, ingresos recurrentes por suscripción, mejor posicionamiento de marca, procesos estandarizados, soluciones comercializables en distintos sectores, IA para incrementar capacidad operativa.
```

- [ ] **Step 3: Write the Buscador de Tendencias role file**

Create `departamentos/marketing/agentes/buscador-tendencias.md`:

```markdown
# Agente: Buscador de Tendencias (Marketing)

## Rol
Eres el Buscador de Tendencias del equipo de Marketing de Intelekia Consultoría.
Tu trabajo es encontrar ideas de contenido (posts y reels) para Instagram, Reels y
TikTok que ayuden a posicionar a Intelekia ante dueños de negocio en México.

## Cómo piensas
- Te basas en el contexto de negocio de Intelekia (servicios, productos,
  diferenciadores) para proponer ideas relevantes, no genéricas.
- Prefieres ideas que muestren problemas reales de negocios (citas perdidas, WhatsApp
  saturado, procesos manuales) y cómo la tecnología/IA los resuelve.
- Evitas sonar excesivamente técnico; buscas que un dueño de negocio sin conocimientos
  técnicos se sienta identificado.
- No repites ideas que ya existen en la lista que se te comparte.

## Formato de salida
Cuando te pidan ideas nuevas, responde ÚNICAMENTE con un arreglo JSON de strings,
sin texto adicional antes o después. Ejemplo:

["Idea de post 1", "Idea de post 2", "Idea de post 3"]

Cuando te hagan una pregunta de chat normal, responde en texto plano, de forma breve
y directa, sin el formato JSON anterior.
```

- [ ] **Step 4: Write the Publicador role file**

Create `departamentos/marketing/agentes/publicador.md`:

```markdown
# Agente: Publicador (Marketing)

## Rol
Eres el Publicador del equipo de Marketing de Intelekia Consultoría. Tu trabajo es
tomar una idea de post/reel y convertirla en el caption/copy final, listo para que el
fundador lo revise y publique manualmente.

## Cómo piensas
- Escribes en español, tono profesional pero cercano y creativo, adaptado a audiencia
  mexicana.
- Usas la estructura: gancho inicial, desarrollo breve, llamado a la acción.
- Incluyes 2-4 hashtags relevantes al final, nunca más de eso.
- Si te piden ajustar un draft existente (más corto, otro tono, etc.), editas el texto
  que te compartan en vez de escribir uno nuevo desde cero.

## Formato de salida
Responde ÚNICAMENTE con el texto final del post (incluyendo hashtags), sin
explicaciones adicionales antes o después.
```

- [ ] **Step 5: Create the initial ideas file**

Create `departamentos/marketing/content/ideas.json`:

```json
[]
```

- [ ] **Step 6: Create a placeholder so the empty drafts directory is tracked by git**

Create `departamentos/marketing/content/drafts/.gitkeep` (empty file).

- [ ] **Step 7: Write the backend package manifest**

Create `backend/package.json`:

```json
{
  "name": "intelekia-marketing-office",
  "version": "0.1.0",
  "private": true,
  "description": "Prototipo de oficina de Marketing en 3D con agentes de IA",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test \"test/**/*.test.js\""
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2"
  }
}
```

- [ ] **Step 8: Write the env example file**

Create `backend/.env.example`:

```
PORT=3000
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o-mini
AGENT_INTERVAL_HOURS=6
```

- [ ] **Step 9: Create the initial agent status file**

Create `backend/state/agents-status.json`:

```json
{
  "buscador-tendencias": {
    "estatus": "idle",
    "ultimaAccion": "Sin actividad todavía",
    "error": null,
    "updatedAt": null
  },
  "publicador": {
    "estatus": "idle",
    "ultimaAccion": "Sin actividad todavía",
    "error": null,
    "updatedAt": null
  }
}
```

- [ ] **Step 10: Write the root .gitignore**

Create `.gitignore`:

```
node_modules/
backend/.env
.env
```

- [ ] **Step 11: Install backend dependencies**

Run: `cd backend && npm install`
Expected: `express` and `dotenv` installed under `backend/node_modules`, `backend/package-lock.json` created, no errors.

- [ ] **Step 12: Commit**

```bash
cd ..
git add CONTEXTO-INTELEKIA.md departamentos backend/package.json backend/package-lock.json backend/.env.example backend/state/agents-status.json .gitignore
git commit -m "Scaffold Marketing office prototype: shared context, agent roles, backend manifest"
```

---

### Task 2: Status store module

**Files:**
- Create: `backend/lib/statusStore.js`
- Test: `backend/test/statusStore.test.js`

**Interfaces:**
- Produces: `readStatus(filePath) -> object`, `writeStatus(filePath, status) -> void`, `updateAgentStatus(filePath, agentId, patch) -> object` (the merged agent entry, always including `updatedAt`). Every later backend task that touches `agents-status.json` uses these three functions.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/statusStore.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readStatus, writeStatus, updateAgentStatus } = require('../lib/statusStore');

function tempStatusPath() {
  return path.join(os.tmpdir(), `agents-status-${Date.now()}-${Math.random()}.json`);
}

test('readStatus returns empty object when file does not exist', () => {
  const filePath = tempStatusPath();
  assert.deepEqual(readStatus(filePath), {});
});

test('writeStatus then readStatus returns the same data', () => {
  const filePath = tempStatusPath();
  writeStatus(filePath, { foo: { estatus: 'idle' } });
  assert.deepEqual(readStatus(filePath), { foo: { estatus: 'idle' } });
  fs.unlinkSync(filePath);
});

test('updateAgentStatus merges patch into existing agent status and sets updatedAt', () => {
  const filePath = tempStatusPath();
  writeStatus(filePath, { buscador: { estatus: 'idle', ultimaAccion: 'nada' } });

  const result = updateAgentStatus(filePath, 'buscador', { estatus: 'trabajando' });

  assert.equal(result.estatus, 'trabajando');
  assert.equal(result.ultimaAccion, 'nada');
  assert.ok(result.updatedAt);

  const onDisk = readStatus(filePath);
  assert.equal(onDisk.buscador.estatus, 'trabajando');
  fs.unlinkSync(filePath);
});

test('updateAgentStatus creates a new agent entry if it does not exist yet', () => {
  const filePath = tempStatusPath();
  writeStatus(filePath, {});

  const result = updateAgentStatus(filePath, 'publicador', { estatus: 'idle' });

  assert.equal(result.estatus, 'idle');
  fs.unlinkSync(filePath);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/statusStore.test.js`
Expected: FAIL — `Cannot find module '../lib/statusStore'`

- [ ] **Step 3: Write the implementation**

Create `backend/lib/statusStore.js`:

```js
const fs = require('fs');

function readStatus(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writeStatus(filePath, status) {
  fs.writeFileSync(filePath, JSON.stringify(status, null, 2));
}

function updateAgentStatus(filePath, agentId, patch) {
  const status = readStatus(filePath);
  const current = status[agentId] || {};
  status[agentId] = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeStatus(filePath, status);
  return status[agentId];
}

module.exports = { readStatus, writeStatus, updateAgentStatus };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/statusStore.test.js`
Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/lib/statusStore.js backend/test/statusStore.test.js
git commit -m "Add statusStore module for reading/writing agent status"
```

---

### Task 3: Ideas store module

**Files:**
- Create: `backend/lib/ideasStore.js`
- Test: `backend/test/ideasStore.test.js`

**Interfaces:**
- Produces: `readIdeas(ideasPath) -> Array<{id, texto, estatus, creadaEn}>` (returns `[]` if the file does not exist) and `writeIdeas(ideasPath, ideas) -> void`. Task 5 (Buscador de Tendencias) and Task 6 (Publicador) both import these two functions instead of each defining their own — this is the shared module the Global Constraints section requires.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/ideasStore.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readIdeas, writeIdeas } = require('../lib/ideasStore');

function tempIdeasPath() {
  return path.join(os.tmpdir(), `ideas-${Date.now()}-${Math.random()}.json`);
}

test('readIdeas returns an empty array when the file does not exist', () => {
  const filePath = tempIdeasPath();
  assert.deepEqual(readIdeas(filePath), []);
});

test('writeIdeas then readIdeas returns the same array', () => {
  const filePath = tempIdeasPath();
  const ideas = [{ id: 'idea-1', texto: 'una idea', estatus: 'pendiente', creadaEn: '2026-01-01T00:00:00.000Z' }];

  writeIdeas(filePath, ideas);

  assert.deepEqual(readIdeas(filePath), ideas);
  fs.unlinkSync(filePath);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/ideasStore.test.js`
Expected: FAIL — `Cannot find module '../lib/ideasStore'`

- [ ] **Step 3: Write the implementation**

Create `backend/lib/ideasStore.js`:

```js
const fs = require('fs');

function readIdeas(ideasPath) {
  if (!fs.existsSync(ideasPath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(ideasPath, 'utf-8'));
}

function writeIdeas(ideasPath, ideas) {
  fs.writeFileSync(ideasPath, JSON.stringify(ideas, null, 2));
}

module.exports = { readIdeas, writeIdeas };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/ideasStore.test.js`
Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/lib/ideasStore.js backend/test/ideasStore.test.js
git commit -m "Add ideasStore module for reading/writing ideas.json"
```

---

### Task 4: OpenAI client module

**Files:**
- Create: `backend/lib/openaiClient.js`
- Test: `backend/test/openaiClient.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createChatCompletion({ apiKey, model, messages, fetchImpl }) -> Promise<string>` — returns the assistant's text content, or throws an `Error` with the HTTP status in its message on failure. `fetchImpl` defaults to the global `fetch` and is the injection point every agent module's tests use to avoid real network calls.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/openaiClient.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatCompletion } = require('../lib/openaiClient');

test('createChatCompletion returns the message content on success', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-4o-mini');
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hola' } }] }),
    };
  };

  const result = await createChatCompletion({
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl: fakeFetch,
  });

  assert.equal(result, 'hola');
});

test('createChatCompletion throws when the response is not ok', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'invalid api key',
  });

  await assert.rejects(
    createChatCompletion({
      apiKey: 'bad-key',
      model: 'gpt-4o-mini',
      messages: [],
      fetchImpl: fakeFetch,
    }),
    /OpenAI request failed: 401/
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/openaiClient.test.js`
Expected: FAIL — `Cannot find module '../lib/openaiClient'`

- [ ] **Step 3: Write the implementation**

Create `backend/lib/openaiClient.js`:

```js
async function createChatCompletion({ apiKey, model, messages, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

module.exports = { createChatCompletion };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/openaiClient.test.js`
Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/lib/openaiClient.js backend/test/openaiClient.test.js
git commit -m "Add openaiClient module wrapping OpenAI chat completions"
```

---

### Task 5: Buscador de Tendencias agent module

**Files:**
- Create: `backend/agents/buscadorTendencias.js`
- Test: `backend/test/buscadorTendencias.test.js`

**Interfaces:**
- Consumes: `readIdeas`, `writeIdeas` (Task 3's `backend/lib/ideasStore.js`); `createChatCompletion` (Task 4, injected directly as a function, not via `fetchImpl`).
- Produces: `runCycle({ contextPath, rolePath, ideasPath, apiKey, model, createChatCompletion }) -> Promise<{ addedIdeas: Array<{id, texto, estatus, creadaEn}> }>` and `chat({ message, saveAsIdea, contextPath, rolePath, ideasPath, apiKey, model, createChatCompletion }) -> Promise<{ reply: string, savedIdea: object|null }>`. Later tasks (scheduler wiring, routes) call these two functions by name.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/buscadorTendencias.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat } = require('../agents/buscadorTendencias');

function tempFile(name, content) {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

test('runCycle appends new ideas with estatus pendiente and does not duplicate existing texts', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de tendencias.');
  const ideasPath = tempFile(
    'ideas',
    JSON.stringify([
      { id: 'idea-1', texto: 'idea vieja', estatus: 'pendiente', creadaEn: '2026-01-01T00:00:00.000Z' },
    ])
  );

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.equal(messages[0].role, 'system');
    assert.match(messages[1].content, /idea vieja/);
    return JSON.stringify(['idea nueva 1', 'idea nueva 2']);
  };

  const result = await runCycle({
    contextPath,
    rolePath,
    ideasPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.addedIdeas.length, 2);
  assert.equal(result.addedIdeas[0].estatus, 'pendiente');

  const onDisk = JSON.parse(fs.readFileSync(ideasPath, 'utf-8'));
  assert.equal(onDisk.length, 3);

  [contextPath, rolePath, ideasPath].forEach((p) => fs.unlinkSync(p));
});

test('chat returns the reply without saving an idea by default', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de tendencias.');
  const ideasPath = tempFile('ideas', JSON.stringify([]));

  const fakeCreateChatCompletion = async () => 'una respuesta cualquiera';

  const result = await chat({
    message: 'dame una idea sobre dentistas',
    saveAsIdea: false,
    contextPath,
    rolePath,
    ideasPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'una respuesta cualquiera');
  assert.equal(result.savedIdea, null);

  const onDisk = JSON.parse(fs.readFileSync(ideasPath, 'utf-8'));
  assert.equal(onDisk.length, 0);

  [contextPath, rolePath, ideasPath].forEach((p) => fs.unlinkSync(p));
});

test('chat saves the reply as a pending idea when saveAsIdea is true', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de tendencias.');
  const ideasPath = tempFile('ideas', JSON.stringify([]));

  const fakeCreateChatCompletion = async () => 'idea para guardar';

  const result = await chat({
    message: 'dame una idea sobre dentistas',
    saveAsIdea: true,
    contextPath,
    rolePath,
    ideasPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.savedIdea.texto, 'idea para guardar');
  assert.equal(result.savedIdea.estatus, 'pendiente');

  const onDisk = JSON.parse(fs.readFileSync(ideasPath, 'utf-8'));
  assert.equal(onDisk.length, 1);

  [contextPath, rolePath, ideasPath].forEach((p) => fs.unlinkSync(p));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/buscadorTendencias.test.js`
Expected: FAIL — `Cannot find module '../agents/buscadorTendencias'`

- [ ] **Step 3: Write the implementation**

Create `backend/agents/buscadorTendencias.js`:

```js
const fs = require('fs');
const { readIdeas, writeIdeas } = require('../lib/ideasStore');

async function runCycle({ contextPath, rolePath, ideasPath, apiKey, model, createChatCompletion }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const existingIdeas = readIdeas(ideasPath);
  const existingTexts = existingIdeas.map((idea) => idea.texto);

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Ideas que ya existen (no las repitas):\n${JSON.stringify(existingTexts)}\n\n` +
    'Dame entre 3 y 5 ideas nuevas de post/reel.';

  const raw = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  const nuevasIdeas = JSON.parse(raw);

  const addedIdeas = nuevasIdeas.map((texto, index) => ({
    id: `idea-${Date.now()}-${index}`,
    texto,
    estatus: 'pendiente',
    creadaEn: new Date().toISOString(),
  }));

  writeIdeas(ideasPath, [...existingIdeas, ...addedIdeas]);

  return { addedIdeas };
}

async function chat({ message, saveAsIdea, contextPath, rolePath, ideasPath, apiKey, model, createChatCompletion }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');

  const reply = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'system', content: `Contexto de negocio:\n${context}` },
      { role: 'user', content: message },
    ],
  });

  let savedIdea = null;
  if (saveAsIdea) {
    const existingIdeas = readIdeas(ideasPath);
    savedIdea = {
      id: `idea-${Date.now()}`,
      texto: reply,
      estatus: 'pendiente',
      creadaEn: new Date().toISOString(),
    };
    writeIdeas(ideasPath, [...existingIdeas, savedIdea]);
  }

  return { reply, savedIdea };
}

module.exports = { runCycle, chat };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/buscadorTendencias.test.js`
Expected: PASS — 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/agents/buscadorTendencias.js backend/test/buscadorTendencias.test.js
git commit -m "Add Buscador de Tendencias agent: autonomous cycle and chat"
```

---

### Task 6: Publicador agent module

**Files:**
- Create: `backend/agents/publicador.js`
- Test: `backend/test/publicador.test.js`

**Interfaces:**
- Consumes: `readIdeas`, `writeIdeas` (Task 3's `backend/lib/ideasStore.js`); `createChatCompletion` (Task 4).
- Produces: `runCycle({ contextPath, rolePath, ideasPath, draftsDir, apiKey, model, createChatCompletion }) -> Promise<{ draftCreated: {ideaId, ideaTexto, draftPath} | null }>`, `chat({ message, ideaId, draftsDir, contextPath, rolePath, apiKey, model, createChatCompletion }) -> Promise<{ reply: string }>`, and `draftFileName(ideaId) -> string`. Task 10's server wiring reads `result.draftCreated.ideaId` to store `ultimoIdeaId` in agent status, which the frontend later sends back as `ideaId` when chatting with the Publicador.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/publicador.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat, draftFileName } = require('../agents/publicador');

function tempFile(name, content) {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function tempDir(name) {
  const dirPath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

test('runCycle writes a draft file for the first pending idea and marks it redactada', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el publicador.');
  const ideasPath = tempFile(
    'ideas',
    JSON.stringify([
      { id: 'idea-1', texto: 'idea uno', estatus: 'pendiente' },
      { id: 'idea-2', texto: 'idea dos', estatus: 'pendiente' },
    ])
  );
  const draftsDir = tempDir('drafts');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /idea uno/);
    return 'Caption final con #hashtag';
  };

  const result = await runCycle({
    contextPath,
    rolePath,
    ideasPath,
    draftsDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.draftCreated.ideaId, 'idea-1');

  const draftContent = fs.readFileSync(path.join(draftsDir, draftFileName('idea-1')), 'utf-8');
  assert.equal(draftContent, 'Caption final con #hashtag');

  const updatedIdeas = JSON.parse(fs.readFileSync(ideasPath, 'utf-8'));
  assert.equal(updatedIdeas.find((i) => i.id === 'idea-1').estatus, 'redactada');
  assert.equal(updatedIdeas.find((i) => i.id === 'idea-2').estatus, 'pendiente');

  [contextPath, rolePath, ideasPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(draftsDir, { recursive: true, force: true });
});

test('runCycle returns draftCreated null when there are no pending ideas', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el publicador.');
  const ideasPath = tempFile('ideas', JSON.stringify([{ id: 'idea-1', texto: 'idea uno', estatus: 'redactada' }]));
  const draftsDir = tempDir('drafts');

  const result = await runCycle({
    contextPath,
    rolePath,
    ideasPath,
    draftsDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: async () => {
      throw new Error('no debería llamarse');
    },
  });

  assert.equal(result.draftCreated, null);

  [contextPath, rolePath, ideasPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(draftsDir, { recursive: true, force: true });
});

test('chat overwrites the draft file with the edited copy', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el publicador.');
  const draftsDir = tempDir('drafts');
  const ideaId = 'idea-1';
  fs.writeFileSync(path.join(draftsDir, draftFileName(ideaId)), 'Caption original');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Caption original/);
    assert.match(messages[1].content, /hazlo más corto/);
    return 'Caption corto';
  };

  const result = await chat({
    message: 'hazlo más corto',
    ideaId,
    draftsDir,
    contextPath,
    rolePath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'Caption corto');
  assert.equal(fs.readFileSync(path.join(draftsDir, draftFileName(ideaId)), 'utf-8'), 'Caption corto');

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(draftsDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/publicador.test.js`
Expected: FAIL — `Cannot find module '../agents/publicador'`

- [ ] **Step 3: Write the implementation**

Create `backend/agents/publicador.js`:

```js
const fs = require('fs');
const path = require('path');
const { readIdeas, writeIdeas } = require('../lib/ideasStore');

function draftFileName(ideaId) {
  return `draft-${ideaId}.md`;
}

async function runCycle({ contextPath, rolePath, ideasPath, draftsDir, apiKey, model, createChatCompletion }) {
  const ideas = readIdeas(ideasPath);
  const pendiente = ideas.find((idea) => idea.estatus === 'pendiente');

  if (!pendiente) {
    return { draftCreated: null };
  }

  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');

  const userPrompt = `Contexto de negocio:\n${context}\n\nIdea a convertir en post:\n${pendiente.texto}`;

  const copy = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  fs.mkdirSync(draftsDir, { recursive: true });
  const draftPath = path.join(draftsDir, draftFileName(pendiente.id));
  fs.writeFileSync(draftPath, copy);

  const updatedIdeas = ideas.map((idea) => (idea.id === pendiente.id ? { ...idea, estatus: 'redactada' } : idea));
  writeIdeas(ideasPath, updatedIdeas);

  return {
    draftCreated: {
      ideaId: pendiente.id,
      ideaTexto: pendiente.texto,
      draftPath,
    },
  };
}

async function chat({ message, ideaId, draftsDir, contextPath, rolePath, apiKey, model, createChatCompletion }) {
  const draftPath = path.join(draftsDir, draftFileName(ideaId));
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const currentDraft = fs.readFileSync(draftPath, 'utf-8');

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Draft actual:\n${currentDraft}\n\n` +
    `Instrucción del fundador: ${message}`;

  const updatedCopy = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  fs.writeFileSync(draftPath, updatedCopy);

  return { reply: updatedCopy };
}

module.exports = { runCycle, chat, draftFileName };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/publicador.test.js`
Expected: PASS — 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/agents/publicador.js backend/test/publicador.test.js
git commit -m "Add Publicador agent: autonomous draft cycle and chat edits"
```

---

### Task 7: Status-wrapped run cycle helper

**Files:**
- Create: `backend/lib/runWithStatus.js`
- Test: `backend/test/runWithStatus.test.js`

**Interfaces:**
- Consumes: `updateAgentStatus` (Task 2).
- Produces: `wrapRunCycle({ agentId, statusPath, runCycle, deps, describeSuccess }) -> () => Promise<result>` — a zero-argument async function that sets status to `trabajando` before calling `runCycle(deps)`, merges whatever object `describeSuccess(result)` returns into the agent's status on success (with `error: null`), or sets `estatus: 'error'` with the caught error's message on failure, then rethrows. Task 8's scheduler and Task 10's server wiring consume the returned function directly as an `agentRunner`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/runWithStatus.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { wrapRunCycle } = require('../lib/runWithStatus');
const { readStatus, writeStatus } = require('../lib/statusStore');

function tempStatusPath() {
  const filePath = path.join(os.tmpdir(), `status-${Date.now()}-${Math.random()}.json`);
  writeStatus(filePath, {});
  return filePath;
}

test('wrapRunCycle sets estatus trabajando then the success estatus on success', async () => {
  const statusPath = tempStatusPath();
  const runWrapped = wrapRunCycle({
    agentId: 'buscador-tendencias',
    statusPath,
    runCycle: async () => ({ addedIdeas: [1, 2] }),
    deps: {},
    describeSuccess: (result) => ({
      estatus: 'idle',
      ultimaAccion: `Encontró ${result.addedIdeas.length} idea(s)`,
    }),
  });

  const result = await runWrapped();

  assert.deepEqual(result, { addedIdeas: [1, 2] });
  const status = readStatus(statusPath)['buscador-tendencias'];
  assert.equal(status.estatus, 'idle');
  assert.equal(status.ultimaAccion, 'Encontró 2 idea(s)');
  assert.equal(status.error, null);

  fs.unlinkSync(statusPath);
});

test('wrapRunCycle sets estatus error and records the error message on failure', async () => {
  const statusPath = tempStatusPath();
  const runWrapped = wrapRunCycle({
    agentId: 'publicador',
    statusPath,
    runCycle: async () => {
      throw new Error('fallo de prueba');
    },
    deps: {},
    describeSuccess: () => ({ estatus: 'idle', ultimaAccion: '' }),
  });

  await assert.rejects(runWrapped(), /fallo de prueba/);

  const status = readStatus(statusPath).publicador;
  assert.equal(status.estatus, 'error');
  assert.equal(status.error, 'fallo de prueba');

  fs.unlinkSync(statusPath);
});

test('wrapRunCycle passes extra fields from describeSuccess into the status patch', async () => {
  const statusPath = tempStatusPath();
  const runWrapped = wrapRunCycle({
    agentId: 'publicador',
    statusPath,
    runCycle: async () => ({ draftCreated: { ideaId: 'idea-9' } }),
    deps: {},
    describeSuccess: (result) => ({
      estatus: 'listo_para_revision',
      ultimaAccion: 'Redactó un draft',
      ultimoIdeaId: result.draftCreated.ideaId,
    }),
  });

  await runWrapped();

  const status = readStatus(statusPath).publicador;
  assert.equal(status.ultimoIdeaId, 'idea-9');

  fs.unlinkSync(statusPath);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/runWithStatus.test.js`
Expected: FAIL — `Cannot find module '../lib/runWithStatus'`

- [ ] **Step 3: Write the implementation**

Create `backend/lib/runWithStatus.js`:

```js
const { updateAgentStatus } = require('./statusStore');

function wrapRunCycle({ agentId, statusPath, runCycle, deps, describeSuccess }) {
  return async function runWrapped() {
    updateAgentStatus(statusPath, agentId, {
      estatus: 'trabajando',
      ultimaAccion: 'Ejecutando ciclo autónomo',
      error: null,
    });

    try {
      const result = await runCycle(deps);
      const patch = describeSuccess(result);
      updateAgentStatus(statusPath, agentId, { ...patch, error: null });
      return result;
    } catch (err) {
      updateAgentStatus(statusPath, agentId, {
        estatus: 'error',
        ultimaAccion: 'Fallo en el ciclo autónomo',
        error: err.message,
      });
      throw err;
    }
  };
}

module.exports = { wrapRunCycle };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/runWithStatus.test.js`
Expected: PASS — 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/lib/runWithStatus.js backend/test/runWithStatus.test.js
git commit -m "Add wrapRunCycle helper to track agent status around a run cycle"
```

---

### Task 8: Scheduler module

**Files:**
- Create: `backend/scheduler.js`
- Test: `backend/test/scheduler.test.js`

**Interfaces:**
- Consumes: nothing concrete — takes a map of already-wrapped `agentRunners` (functions of shape `() => Promise<any>`, as produced by Task 7's `wrapRunCycle`).
- Produces: `createScheduler({ intervalMs, agentRunners }) -> { start(), stop(), runAllOnce(): Promise<void>, runOne(agentId): Promise<any>, isRunning(): boolean }`. Task 9's `forzar` route handler calls `scheduler.runOne(agentId)`; Task 10's server start-up calls `scheduler.start()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/scheduler.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduler } = require('../scheduler');

test('runOne calls the matching agent runner and returns its result', async () => {
  let calls = 0;
  const scheduler = createScheduler({
    intervalMs: 1000,
    agentRunners: {
      'buscador-tendencias': async () => {
        calls += 1;
        return { addedIdeas: [] };
      },
    },
  });

  const result = await scheduler.runOne('buscador-tendencias');

  assert.equal(calls, 1);
  assert.deepEqual(result, { addedIdeas: [] });
});

test('runOne throws for an unknown agent id', async () => {
  const scheduler = createScheduler({ intervalMs: 1000, agentRunners: {} });

  await assert.rejects(scheduler.runOne('no-existe'), /Agente desconocido: no-existe/);
});

test('runAllOnce calls every registered agent runner once', async () => {
  const calledIds = [];
  const scheduler = createScheduler({
    intervalMs: 1000,
    agentRunners: {
      a: async () => {
        calledIds.push('a');
      },
      b: async () => {
        calledIds.push('b');
      },
    },
  });

  await scheduler.runAllOnce();

  assert.deepEqual(calledIds.sort(), ['a', 'b']);
});

test('start sets isRunning to true and stop sets it back to false', () => {
  const scheduler = createScheduler({ intervalMs: 1000, agentRunners: {} });
  assert.equal(scheduler.isRunning(), false);
  scheduler.start();
  assert.equal(scheduler.isRunning(), true);
  scheduler.stop();
  assert.equal(scheduler.isRunning(), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/scheduler.test.js`
Expected: FAIL — `Cannot find module '../scheduler'`

- [ ] **Step 3: Write the implementation**

Create `backend/scheduler.js`:

```js
function createScheduler({ intervalMs, agentRunners }) {
  let timer = null;

  function start() {
    timer = setInterval(() => {
      runAllOnce().catch(() => {});
    }, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function isRunning() {
    return timer !== null;
  }

  async function runAllOnce() {
    const ids = Object.keys(agentRunners);
    for (const id of ids) {
      await agentRunners[id]();
    }
  }

  async function runOne(agentId) {
    const runner = agentRunners[agentId];
    if (!runner) {
      throw new Error(`Agente desconocido: ${agentId}`);
    }
    return runner();
  }

  return { start, stop, runAllOnce, runOne, isRunning };
}

module.exports = { createScheduler };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/scheduler.test.js`
Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/scheduler.js backend/test/scheduler.test.js
git commit -m "Add scheduler module to drive agent autonomous cycles"
```

---

### Task 9: Agents API routes

**Files:**
- Create: `backend/routes/agents.js`
- Test: `backend/test/agentsRoute.test.js`

**Interfaces:**
- Consumes: an injected `readStatus` function (Task 2's shape), a `scheduler` object exposing `runOne` (Task 8), and a `chatHandlers` map of `agentId -> (body) => Promise<result>` (Task 5/6's `chat` functions, pre-bound with their deps).
- Produces: `createAgentsRouter({ statusPath, readStatus, scheduler, chatHandlers }) -> express.Router` exposing `GET /status`, `POST /:id/chat`, `POST /:id/forzar`. Also exports the three handler factories (`createStatusHandler`, `createChatHandler`, `createForzarHandler`) for direct unit testing. Task 10 mounts this router at `/api/agents`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/agentsRoute.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatusHandler, createChatHandler, createForzarHandler } = require('../routes/agents');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('status handler responds with the result of readStatus', () => {
  const handler = createStatusHandler({
    statusPath: '/fake/path.json',
    readStatus: (p) => ({ fake: p }),
  });
  const res = fakeRes();

  handler({}, res);

  assert.deepEqual(res.body, { fake: '/fake/path.json' });
});

test('chat handler calls the matching chatHandler with the request body', async () => {
  const handler = createChatHandler({
    chatHandlers: {
      publicador: async (body) => ({ reply: `recibido: ${body.message}` }),
    },
  });
  const req = { params: { id: 'publicador' }, body: { message: 'hola' } };
  const res = fakeRes();

  await handler(req, res);

  assert.deepEqual(res.body, { reply: 'recibido: hola' });
});

test('chat handler responds 404 for an unknown agent id', async () => {
  const handler = createChatHandler({ chatHandlers: {} });
  const req = { params: { id: 'no-existe' }, body: {} };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 404);
});

test('chat handler responds 500 when the handler throws', async () => {
  const handler = createChatHandler({
    chatHandlers: {
      publicador: async () => {
        throw new Error('fallo openai');
      },
    },
  });
  const req = { params: { id: 'publicador' }, body: {} };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'fallo openai');
});

test('forzar handler calls scheduler.runOne with the agent id', async () => {
  const calledWith = [];
  const handler = createForzarHandler({
    scheduler: {
      runOne: async (id) => {
        calledWith.push(id);
        return { addedIdeas: [] };
      },
    },
  });
  const req = { params: { id: 'buscador-tendencias' } };
  const res = fakeRes();

  await handler(req, res);

  assert.deepEqual(calledWith, ['buscador-tendencias']);
  assert.equal(res.body.ok, true);
});

test('forzar handler responds 400 when scheduler.runOne rejects', async () => {
  const handler = createForzarHandler({
    scheduler: {
      runOne: async () => {
        throw new Error('Agente desconocido: x');
      },
    },
  });
  const req = { params: { id: 'x' } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/agentsRoute.test.js`
Expected: FAIL — `Cannot find module '../routes/agents'`

- [ ] **Step 3: Write the implementation**

Create `backend/routes/agents.js`:

```js
const express = require('express');

function createStatusHandler({ statusPath, readStatus }) {
  return (req, res) => {
    res.json(readStatus(statusPath));
  };
}

function createChatHandler({ chatHandlers }) {
  return async (req, res) => {
    const { id } = req.params;
    const handler = chatHandlers[id];
    if (!handler) {
      res.status(404).json({ error: `Agente desconocido: ${id}` });
      return;
    }
    try {
      const result = await handler(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

function createForzarHandler({ scheduler }) {
  return async (req, res) => {
    const { id } = req.params;
    try {
      const result = await scheduler.runOne(id);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createAgentsRouter({ statusPath, readStatus, scheduler, chatHandlers }) {
  const router = express.Router();
  router.get('/status', createStatusHandler({ statusPath, readStatus }));
  router.post('/:id/chat', createChatHandler({ chatHandlers }));
  router.post('/:id/forzar', createForzarHandler({ scheduler }));
  return router;
}

module.exports = {
  createAgentsRouter,
  createStatusHandler,
  createChatHandler,
  createForzarHandler,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/agentsRoute.test.js`
Expected: PASS — 6 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/routes/agents.js backend/test/agentsRoute.test.js
git commit -m "Add agents API routes: status, chat, forzar"
```

---

### Task 10: Config module and server wiring

**Files:**
- Create: `backend/config.js`
- Create: `backend/server.js`
- Test: `backend/test/config.test.js`

**Interfaces:**
- Consumes: `createScheduler` (Task 8), `wrapRunCycle` (Task 7), `readStatus` (Task 2), `createChatCompletion` (Task 4), `buscadorTendencias.runCycle`/`chat` (Task 5), `publicador.runCycle`/`chat` (Task 6), `createAgentsRouter` (Task 9).
- Produces: `loadConfig(env) -> { port, openaiApiKey, openaiModel, agentIntervalHours }` (Task 10 only; nothing downstream depends on it in this plan) and the running Express `app` exported from `server.js` for manual verification.

- [ ] **Step 1: Write the failing test for config**

Create `backend/test/config.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');

test('loadConfig applies defaults when env vars are missing', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.openaiModel, 'gpt-4o-mini');
  assert.equal(config.agentIntervalHours, 6);
  assert.equal(config.openaiApiKey, '');
});

test('loadConfig reads values from the given env object', () => {
  const config = loadConfig({
    PORT: '4000',
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL: 'gpt-4o',
    AGENT_INTERVAL_HOURS: '2',
  });
  assert.equal(config.port, 4000);
  assert.equal(config.openaiApiKey, 'sk-test');
  assert.equal(config.openaiModel, 'gpt-4o');
  assert.equal(config.agentIntervalHours, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/config.test.js`
Expected: FAIL — `Cannot find module '../config'`

- [ ] **Step 3: Write config.js**

Create `backend/config.js`:

```js
require('dotenv').config();

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    openaiApiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || 'gpt-4o-mini',
    agentIntervalHours: Number(env.AGENT_INTERVAL_HOURS || 6),
  };
}

module.exports = { loadConfig };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test test/config.test.js`
Expected: PASS — 2 tests passing

- [ ] **Step 5: Write server.js wiring everything together**

Create `backend/server.js`:

```js
const path = require('path');
const express = require('express');
const { loadConfig } = require('./config');
const { createScheduler } = require('./scheduler');
const { wrapRunCycle } = require('./lib/runWithStatus');
const { readStatus } = require('./lib/statusStore');
const { createChatCompletion } = require('./lib/openaiClient');
const buscadorTendencias = require('./agents/buscadorTendencias');
const publicador = require('./agents/publicador');
const { createAgentsRouter } = require('./routes/agents');

const config = loadConfig();

const ROOT = path.join(__dirname, '..');
const CONTEXT_PATH = path.join(ROOT, 'CONTEXTO-INTELEKIA.md');
const MARKETING_DIR = path.join(ROOT, 'departamentos', 'marketing');
const IDEAS_PATH = path.join(MARKETING_DIR, 'content', 'ideas.json');
const DRAFTS_DIR = path.join(MARKETING_DIR, 'content', 'drafts');
const STATUS_PATH = path.join(__dirname, 'state', 'agents-status.json');

const buscadorDeps = {
  contextPath: CONTEXT_PATH,
  rolePath: path.join(MARKETING_DIR, 'agentes', 'buscador-tendencias.md'),
  ideasPath: IDEAS_PATH,
  apiKey: config.openaiApiKey,
  model: config.openaiModel,
  createChatCompletion,
};

const publicadorDeps = {
  contextPath: CONTEXT_PATH,
  rolePath: path.join(MARKETING_DIR, 'agentes', 'publicador.md'),
  ideasPath: IDEAS_PATH,
  draftsDir: DRAFTS_DIR,
  apiKey: config.openaiApiKey,
  model: config.openaiModel,
  createChatCompletion,
};

const agentRunners = {
  'buscador-tendencias': wrapRunCycle({
    agentId: 'buscador-tendencias',
    statusPath: STATUS_PATH,
    runCycle: buscadorTendencias.runCycle,
    deps: buscadorDeps,
    describeSuccess: (result) => ({
      estatus: 'idle',
      ultimaAccion: `Encontró ${result.addedIdeas.length} idea(s) nueva(s)`,
    }),
  }),
  publicador: wrapRunCycle({
    agentId: 'publicador',
    statusPath: STATUS_PATH,
    runCycle: publicador.runCycle,
    deps: publicadorDeps,
    describeSuccess: (result) =>
      result.draftCreated
        ? {
            estatus: 'listo_para_revision',
            ultimaAccion: `Redactó un draft para: ${result.draftCreated.ideaTexto}`,
            ultimoIdeaId: result.draftCreated.ideaId,
          }
        : { estatus: 'idle', ultimaAccion: 'Sin ideas pendientes por redactar' },
  }),
};

const chatHandlers = {
  'buscador-tendencias': (body) => buscadorTendencias.chat({ ...body, ...buscadorDeps }),
  publicador: (body) => publicador.chat({ ...body, ...publicadorDeps }),
};

const scheduler = createScheduler({
  intervalMs: config.agentIntervalHours * 60 * 60 * 1000,
  agentRunners,
});

const app = express();
app.use(express.json());
app.use('/api/agents', createAgentsRouter({ statusPath: STATUS_PATH, readStatus, scheduler, chatHandlers }));
app.use(express.static(path.join(ROOT, 'frontend')));

app.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
  scheduler.start();
});

module.exports = app;
```

- [ ] **Step 6: Create a real .env and manually verify the server boots**

Run:

```bash
cd backend
cp .env.example .env
```

Edit `.env` and set a real `OPENAI_API_KEY`.

Run: `node server.js`
Expected console output: `Servidor corriendo en http://localhost:3000`

In a second terminal, run:

```bash
curl http://localhost:3000/api/agents/status
```

Expected: the JSON content of `backend/state/agents-status.json` (both agents `idle`).

```bash
curl -X POST http://localhost:3000/api/agents/buscador-tendencias/forzar
```

Expected: `{"ok":true,"result":{"addedIdeas":[...]}}` with 3-5 new idea objects, and `departamentos/marketing/content/ideas.json` updated on disk.

Stop the server with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add backend/config.js backend/server.js backend/test/config.test.js
git commit -m "Wire config and server: mount agents API, start scheduler"
```

---

### Task 11: Frontend scaffolding — HTML shell and API client

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/src/api.js`

**Interfaces:**
- Produces: `fetchStatus() -> Promise<object>`, `sendChat(agentId, payload) -> Promise<object>`, `forzarCiclo(agentId) -> Promise<object>` — all three `fetch` the `/api/agents` routes mounted in Task 10. Task 13's `main.js` imports all three.
- Also produces the DOM elements `#scene-container` and `#panel` (with its children) that Task 12's `scene.js` and Task 13's `ui.js` attach to by `id`.

- [ ] **Step 1: Write the HTML shell**

Create `frontend/index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Oficina de Marketing — Intelekia</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; font-family: sans-serif; }
      #scene-container { width: 100%; height: 100%; }
      #panel {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 320px;
        background: #1e1e1e;
        color: #f0f0f0;
        padding: 16px;
        border-radius: 8px;
        display: none;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      }
      #panel.visible { display: block; }
      #panel h2 { margin-top: 0; font-size: 16px; }
      #panel-status { font-size: 13px; margin-bottom: 8px; color: #ccc; }
      #panel-chat-log { max-height: 160px; overflow-y: auto; font-size: 13px; margin-bottom: 8px; }
      #panel textarea { width: 100%; box-sizing: border-box; }
      #panel button { margin-top: 6px; margin-right: 6px; }
      #panel label { font-size: 12px; display: block; margin: 6px 0; }
    </style>
  </head>
  <body>
    <div id="scene-container"></div>
    <div id="panel">
      <h2 id="panel-title"></h2>
      <div id="panel-status"></div>
      <div id="panel-chat-log"></div>
      <label id="panel-save-idea-label" style="display: none;">
        <input type="checkbox" id="panel-save-idea" /> Guardar esta idea
      </label>
      <textarea id="panel-message" rows="2" placeholder="Escribe tu mensaje..."></textarea>
      <div>
        <button id="panel-send">Enviar</button>
        <button id="panel-forzar">Forzar ciclo ahora</button>
        <button id="panel-close">Cerrar</button>
      </div>
    </div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the API client**

Create `frontend/src/api.js`:

```js
const BASE_URL = '/api/agents';

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
```

- [ ] **Step 3: Manually verify the shell loads**

Start the backend (`cd backend && node server.js`), then open `http://localhost:3000` in a browser.
Expected: a blank dark page (no 3D content yet — Task 12 adds it). A 404 for `/src/main.js` is expected in the console until Task 13 creates it; confirm `api.js` itself has no syntax errors by checking the Network tab once `main.js` imports it in Task 13.

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/src/api.js
git commit -m "Add frontend HTML shell and API client"
```

---

### Task 12: Three.js office scene

**Files:**
- Create: `frontend/src/scene.js`

**Interfaces:**
- Consumes: nothing from earlier frontend tasks directly (loads Three.js itself from a CDN).
- Produces: `createScene({ container, agents, onAgentClick }) -> { updateStatusColors(statusById) }`. `agents` is `Array<{id: string}>`; `onAgentClick(agentId: string)` fires on click; `updateStatusColors` expects the same shape returned by `fetchStatus()` (Task 11) — `{ [agentId]: { estatus, ... } }`. Task 13's `main.js` creates the scene and calls `updateStatusColors` on every poll.

- [ ] **Step 1: Write the scene module**

Create `frontend/src/scene.js`:

```js
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const STATUS_COLORS = {
  idle: 0x888888,
  trabajando: 0xffcc00,
  listo_para_revision: 0x33cc66,
  error: 0xcc3333,
};

export function createScene({ container, agents, onAgentClick }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202030);

  const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 4, 7);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);

  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  scene.add(light);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x555566 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const avatarMeshes = {};

  agents.forEach((agent, index) => {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 1, 4, 8),
      new THREE.MeshStandardMaterial({ color: STATUS_COLORS.idle })
    );
    mesh.position.set(index === 0 ? -1.5 : 1.5, 1, 0);
    mesh.userData.agentId = agent.id;
    scene.add(mesh);
    avatarMeshes[agent.id] = mesh;
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  renderer.domElement.addEventListener('click', (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(Object.values(avatarMeshes));
    if (intersects.length > 0) {
      onAgentClick(intersects[0].object.userData.agentId);
    }
  });

  function updateStatusColors(statusById) {
    Object.entries(avatarMeshes).forEach(([agentId, mesh]) => {
      const estatus = statusById[agentId]?.estatus || 'idle';
      mesh.material.color.setHex(STATUS_COLORS[estatus] || STATUS_COLORS.idle);
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return { updateStatusColors };
}
```

- [ ] **Step 2: Manually verify in isolation**

With the backend running, temporarily add `<script type="module">import { createScene } from '/src/scene.js'; createScene({ container: document.getElementById('scene-container'), agents: [{id:'buscador-tendencias'},{id:'publicador'}], onAgentClick: (id) => console.log('clicked', id) });</script>` before the `main.js` script tag in `frontend/index.html`, reload the page.
Expected: a dark room with two gray capsule shapes, mouse drag orbits the camera, clicking a capsule logs `clicked buscador-tendencias` or `clicked publicador` in the browser console.

Remove the temporary script tag afterwards (Task 13 wires this properly through `main.js`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/scene.js
git commit -m "Add Three.js Marketing office scene with clickable agent avatars"
```

---

### Task 13: Chat/status panel and app bootstrap

**Files:**
- Create: `frontend/src/ui.js`
- Create: `frontend/src/main.js`

**Interfaces:**
- Consumes: `createScene` (Task 12), `fetchStatus`/`sendChat`/`forzarCiclo` (Task 11).
- Produces: wires the whole frontend together — no other task depends on this one.

- [ ] **Step 1: Write the panel module**

Create `frontend/src/ui.js`:

```js
const AGENT_LABELS = {
  'buscador-tendencias': 'Buscador de Tendencias',
  publicador: 'Publicador',
};

export function createPanel({ onSend, onForzar }) {
  const panel = document.getElementById('panel');
  const title = document.getElementById('panel-title');
  const statusEl = document.getElementById('panel-status');
  const chatLog = document.getElementById('panel-chat-log');
  const saveIdeaLabel = document.getElementById('panel-save-idea-label');
  const saveIdeaCheckbox = document.getElementById('panel-save-idea');
  const messageInput = document.getElementById('panel-message');
  const sendButton = document.getElementById('panel-send');
  const forzarButton = document.getElementById('panel-forzar');
  const closeButton = document.getElementById('panel-close');

  let currentAgentId = null;

  function open(agentId, agentStatus) {
    currentAgentId = agentId;
    title.textContent = AGENT_LABELS[agentId] || agentId;
    saveIdeaLabel.style.display = agentId === 'buscador-tendencias' ? 'block' : 'none';
    chatLog.innerHTML = '';
    renderStatus(agentStatus);
    panel.classList.add('visible');
  }

  function renderStatus(agentStatus) {
    if (!agentStatus) {
      statusEl.textContent = 'Sin datos de estatus todavía.';
      return;
    }
    statusEl.textContent = `Estatus: ${agentStatus.estatus} — ${agentStatus.ultimaAccion || ''}`;
  }

  function appendMessage(author, text) {
    const line = document.createElement('div');
    line.textContent = `${author}: ${text}`;
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  sendButton.addEventListener('click', async () => {
    const message = messageInput.value.trim();
    if (!message || !currentAgentId) return;
    appendMessage('Tú', message);
    messageInput.value = '';
    await onSend(currentAgentId, message, saveIdeaCheckbox.checked);
  });

  forzarButton.addEventListener('click', async () => {
    if (!currentAgentId) return;
    await onForzar(currentAgentId);
  });

  closeButton.addEventListener('click', () => {
    panel.classList.remove('visible');
    currentAgentId = null;
  });

  return { open, renderStatus, appendMessage, getCurrentAgentId: () => currentAgentId };
}
```

- [ ] **Step 2: Write the app bootstrap**

Create `frontend/src/main.js`:

```js
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
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/ui.js frontend/src/main.js
git commit -m "Wire chat/status panel and app bootstrap to the 3D scene"
```

---

### Task 14: End-to-end manual validation

**Files:** none created — this task only exercises what Tasks 1-13 built.

**Interfaces:** none produced.

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: all tests across every `backend/test/*.test.js` file pass (statusStore, ideasStore, openaiClient, buscadorTendencias, publicador, runWithStatus, scheduler, agentsRoute, config).

- [ ] **Step 2: Start the server with a short interval for live testing**

In `backend/.env`, temporarily set `AGENT_INTERVAL_HOURS=0.02` (about 1 minute) so you don't have to wait hours to see an autonomous cycle.

Run: `cd backend && node server.js`

- [ ] **Step 3: Validate the Buscador de Tendencias end to end**

Open `http://localhost:3000`. Click the left capsule.
Expected: the panel opens titled "Buscador de Tendencias", shows its current estatus.
Click "Forzar ciclo ahora".
Expected: within a few seconds the capsule briefly turns yellow (`trabajando`), then the panel's estatus line updates, and `departamentos/marketing/content/ideas.json` on disk has new entries with `estatus: "pendiente"`.

- [ ] **Step 4: Validate the Publicador end to end**

Click the right capsule, then "Forzar ciclo ahora".
Expected: the capsule turns yellow then green (`listo_para_revision`), a new file appears in `departamentos/marketing/content/drafts/` named `draft-<ideaId>.md` containing the caption text, and the corresponding idea in `ideas.json` now has `estatus: "redactada"`.

- [ ] **Step 5: Validate reactive chat**

With the Publicador panel still open, type "hazlo más corto" and click Enviar.
Expected: a reply appears in the chat log, and the draft file on disk is overwritten with the shorter version.

- [ ] **Step 6: Restore the production-like interval**

In `backend/.env`, set `AGENT_INTERVAL_HOURS` back to the value you actually want running day to day (e.g. `4`), and restart the server.

- [ ] **Step 7: Commit the env example reminder if anything changed**

```bash
git status
```

Expected: only `backend/.env` differs (and it's gitignored, so `git status` should show no changes to commit). If `backend/.env.example` needs a new default, update and commit it:

```bash
git add backend/.env.example
git commit -m "Update default agent interval in env example"
```
