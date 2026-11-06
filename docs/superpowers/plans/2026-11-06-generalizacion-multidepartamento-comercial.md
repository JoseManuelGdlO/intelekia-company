# Generalización multi-departamento + Comercial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the backend/frontend so departments and agents come from a declarative registry instead of hardcoded names, migrate Marketing onto it without changing its behavior, and add the Comercial department (3 new agents) as proof it works, per `docs/superpowers/specs/2026-11-06-generalizacion-multidepartamento-comercial-design.md`.

**Architecture:** Every agent module exports `{ runCycle, chat, describeSuccess }`. Two small shared libraries (`parseJsonArrayResponse`, `validateItemId`) remove duplicated parsing/validation logic across agent modules. A new `backend/departments.js` builds a declarative list of departments/agents with their dependencies; `backend/server.js` iterates over it instead of hand-wiring two named agents. A uniform chat payload `{ message, guardar, itemId }` replaces the old agent-specific shapes. The frontend fetches `GET /api/departments` instead of hardcoding an agents array, and `scene.js` renders one room per department instead of one fixed room.

**Tech Stack:** Same as the Marketing prototype — Node.js >= 18, Express 4, `dotenv`, Node's built-in `node:test`, Three.js via CDN ES modules.

## Global Constraints

- Node.js >= 18 required; backend uses CommonJS; frontend uses native ES modules, no bundler.
- Agent status is always one of exactly: `idle`, `trabajando`, `listo_para_revision`, `error`.
- The OpenAI API key lives only in `backend/.env`, never hardcoded or committed.
- Every agent module exports exactly `{ runCycle, chat, describeSuccess }`. `describeSuccess(result)` returns the status patch for a successful autonomous cycle — it lives in the agent module, not in `server.js`.
- Every chat handler receives the same payload shape: `{ message, guardar, itemId }`. Each agent uses only the fields relevant to it and ignores the rest.
- `itemId` is read by the frontend from `status[agentId].ultimoItemId` (a generic field — not `ultimoIdeaId`, which was Publicador-specific).
- Reading/writing `departamentos/comercial/content/prospectos.json` always goes through `backend/lib/prospectosStore.js` — no module re-implements its own read/write for it (mirrors the existing `ideasStore.js` rule for Marketing).
- Parsing a markdown-fenced JSON array from an LLM response always goes through `backend/lib/parseJsonArrayResponse.js` — no agent module re-implements its own fence-stripping/parsing.
- Validating a safe, path-traversal-free `itemId` always goes through `backend/lib/validateItemId.js` — no agent module re-implements its own regex check.
- `GET /api/departments` must never expose `deps`, file paths, or the API key — only `id`/`label` per department and per agent.
- Auto-publishing or real CRM integration remain out of scope — agents only write local files; the founder acts on them manually.

---

### Task 1: Shared libraries — JSON array response parser and itemId validator

**Files:**
- Create: `backend/lib/parseJsonArrayResponse.js`
- Create: `backend/lib/validateItemId.js`
- Test: `backend/test/parseJsonArrayResponse.test.js`
- Test: `backend/test/validateItemId.test.js`

**Interfaces:**
- Produces: `parseJsonArrayResponse(raw, { emptyArrayErrorMessage }) -> Array<any>` — strips a leading/trailing markdown code fence (with or without a `json` language tag), parses the result as JSON, throws a clear error if parsing fails or the result isn't an array. Task 2 (Buscador de Tendencias) and Task 5 (Buscador de Prospectos) both import this instead of each defining their own copy.
- Produces: `assertSafeItemId(itemId, errorMessage) -> void` (throws `errorMessage` if `itemId` is falsy or contains characters outside `[\w-]`) and the exported `SAFE_ITEM_ID_PATTERN` regex. Task 2 (Publicador), Task 6 (Seguimiento/CRM), and Task 7 (Cotizador) all import `assertSafeItemId` instead of each writing their own regex check.

- [ ] **Step 1: Write the failing tests for parseJsonArrayResponse**

Create `backend/test/parseJsonArrayResponse.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJsonArrayResponse } = require('../lib/parseJsonArrayResponse');

test('parses a plain JSON array with no fences', () => {
  const result = parseJsonArrayResponse('["a", "b"]');
  assert.deepEqual(result, ['a', 'b']);
});

test('strips a ```json fenced array before parsing', () => {
  const result = parseJsonArrayResponse('```json\n["a", "b"]\n```');
  assert.deepEqual(result, ['a', 'b']);
});

test('strips a plain ``` fenced array (no language tag) before parsing', () => {
  const result = parseJsonArrayResponse('```\n["a", "b"]\n```');
  assert.deepEqual(result, ['a', 'b']);
});

test('throws wrapping the original error when the response is not valid JSON', () => {
  assert.throws(() => parseJsonArrayResponse('esto no es json'), /La respuesta del modelo no es JSON válido/);
});

test('throws with the given message when valid JSON is not an array', () => {
  assert.throws(
    () => parseJsonArrayResponse('{}', { emptyArrayErrorMessage: 'mensaje personalizado' }),
    /mensaje personalizado/
  );
});

test('throws with a default message when valid JSON is not an array and no custom message is given', () => {
  assert.throws(() => parseJsonArrayResponse('{}'), /La respuesta del modelo no es un arreglo/);
});
```

- [ ] **Step 2: Write the failing tests for validateItemId**

Create `backend/test/validateItemId.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeItemId } = require('../lib/validateItemId');

test('does not throw for a valid itemId', () => {
  assert.doesNotThrow(() => assertSafeItemId('idea-123-0', 'no debería lanzarse'));
});

test('throws the given message when itemId is undefined', () => {
  assert.throws(() => assertSafeItemId(undefined, 'itemId inválido o faltante'), /itemId inválido o faltante/);
});

test('throws the given message when itemId contains path-traversal characters', () => {
  assert.throws(() => assertSafeItemId('../../etc/passwd', 'itemId inválido o faltante'), /itemId inválido o faltante/);
});
```

- [ ] **Step 3: Run both test files to confirm they fail**

Run: `cd backend && node --test test/parseJsonArrayResponse.test.js test/validateItemId.test.js`
Expected: FAIL — `Cannot find module '../lib/parseJsonArrayResponse'` / `'../lib/validateItemId'`

- [ ] **Step 4: Write parseJsonArrayResponse.js**

Create `backend/lib/parseJsonArrayResponse.js`:

```js
function parseJsonArrayResponse(raw, { emptyArrayErrorMessage } = {}) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`La respuesta del modelo no es JSON válido: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(emptyArrayErrorMessage || 'La respuesta del modelo no es un arreglo');
  }
  return parsed;
}

module.exports = { parseJsonArrayResponse };
```

- [ ] **Step 5: Write validateItemId.js**

Create `backend/lib/validateItemId.js`:

```js
const SAFE_ITEM_ID_PATTERN = /^[\w-]+$/;

function assertSafeItemId(itemId, errorMessage) {
  if (!itemId || !SAFE_ITEM_ID_PATTERN.test(itemId)) {
    throw new Error(errorMessage);
  }
}

module.exports = { assertSafeItemId, SAFE_ITEM_ID_PATTERN };
```

- [ ] **Step 6: Run both test files to confirm they pass**

Run: `cd backend && node --test test/parseJsonArrayResponse.test.js test/validateItemId.test.js`
Expected: PASS — 6 tests in parseJsonArrayResponse.test.js, 3 tests in validateItemId.test.js.

- [ ] **Step 7: Commit**

```bash
git add backend/lib/parseJsonArrayResponse.js backend/lib/validateItemId.js backend/test/parseJsonArrayResponse.test.js backend/test/validateItemId.test.js
git commit -m "Add shared parseJsonArrayResponse and validateItemId libraries"
```

---

### Task 2: Generalize Marketing's two agents onto the uniform contract

**Files:**
- Modify: `backend/agents/buscadorTendencias.js`
- Modify: `backend/agents/publicador.js`
- Modify: `backend/test/buscadorTendencias.test.js`
- Modify: `backend/test/publicador.test.js`

**Interfaces:**
- Consumes: `parseJsonArrayResponse` and `assertSafeItemId` (Task 1).
- Produces: both modules now export `{ runCycle, chat, describeSuccess }`. `buscadorTendencias.chat` now takes `guardar` instead of `saveAsIdea`. `publicador.chat` now takes `itemId` instead of `ideaId`. `publicador.describeSuccess`'s success patch now uses the key `ultimoItemId` instead of `ultimoIdeaId`. Every later task that wires these two agents (Task 8, Task 10) depends on this exact shape.

- [ ] **Step 1: Update buscadorTendencias.test.js to the new contract (will fail against the current implementation)**

In `backend/test/buscadorTendencias.test.js`, rename `saveAsIdea: false` to `guardar: false` (in the "chat returns the reply without saving" test) and `saveAsIdea: true` to `guardar: true` (in the "chat saves the reply" test) — these are the only two occurrences. Then change the import line and add one new test at the end of the file:

```js
const { runCycle, chat, describeSuccess } = require('../agents/buscadorTendencias');
```

```js
test('describeSuccess reports how many ideas were found', () => {
  const patch = describeSuccess({ addedIdeas: [1, 2, 3] });
  assert.deepEqual(patch, {
    estatus: 'idle',
    ultimaAccion: 'Encontró 3 idea(s) nueva(s)',
  });
});
```

- [ ] **Step 2: Update publicador.test.js to the new contract (will fail against the current implementation)**

In `backend/test/publicador.test.js`, rename every `ideaId:` object key passed into a `chat(...)` call to `itemId:` — there are exactly 3: in the "chat overwrites the draft file" test (`ideaId,` on its own line, used as a shorthand property), in the "chat throws a clear error when ideaId is missing" test (`ideaId: undefined`), and in the "chat throws a clear error... path-traversal" test (`ideaId: '../../etc/passwd'`). Also rename the two test titles and their regex assertions from `ideaId` to `itemId`: `/ideaId inválido o faltante/` → `/itemId inválido o faltante/` (2 occurrences). Then change the import line and add two new tests at the end of the file:

```js
const { runCycle, chat, draftFileName, describeSuccess } = require('../agents/publicador');
```

```js
test('describeSuccess reports listo_para_revision with ultimoItemId when a draft was created', () => {
  const patch = describeSuccess({
    draftCreated: { ideaId: 'idea-9', ideaTexto: 'una idea', draftPath: '/tmp/x.md' },
  });
  assert.deepEqual(patch, {
    estatus: 'listo_para_revision',
    ultimaAccion: 'Redactó un draft para: una idea',
    ultimoItemId: 'idea-9',
  });
});

test('describeSuccess reports idle when there was nothing to draft', () => {
  const patch = describeSuccess({ draftCreated: null });
  assert.deepEqual(patch, {
    estatus: 'idle',
    ultimaAccion: 'Sin ideas pendientes por redactar',
  });
});
```

- [ ] **Step 3: Run both test files to confirm they fail**

Run: `cd backend && node --test test/buscadorTendencias.test.js test/publicador.test.js`
Expected: FAIL — the `guardar`/`itemId` tests fail because the implementations still read `saveAsIdea`/`ideaId`, and the `describeSuccess` tests fail with `describeSuccess is not a function`.

- [ ] **Step 4: Update buscadorTendencias.js**

Replace the contents of `backend/agents/buscadorTendencias.js` with:

```js
const fs = require('fs');
const { readIdeas, writeIdeas } = require('../lib/ideasStore');
const { parseJsonArrayResponse } = require('../lib/parseJsonArrayResponse');

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

  const nuevasIdeas = parseJsonArrayResponse(raw, {
    emptyArrayErrorMessage: 'La respuesta del modelo no es un arreglo de ideas',
  });

  const addedIdeas = nuevasIdeas.map((texto, index) => ({
    id: `idea-${Date.now()}-${index}`,
    texto,
    estatus: 'pendiente',
    creadaEn: new Date().toISOString(),
  }));

  writeIdeas(ideasPath, [...existingIdeas, ...addedIdeas]);

  return { addedIdeas };
}

async function chat({ message, guardar, contextPath, rolePath, ideasPath, apiKey, model, createChatCompletion }) {
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
  if (guardar) {
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

function describeSuccess(result) {
  return {
    estatus: 'idle',
    ultimaAccion: `Encontró ${result.addedIdeas.length} idea(s) nueva(s)`,
  };
}

module.exports = { runCycle, chat, describeSuccess };
```

- [ ] **Step 5: Update publicador.js**

Replace the contents of `backend/agents/publicador.js` with:

```js
const fs = require('fs');
const path = require('path');
const { readIdeas, writeIdeas } = require('../lib/ideasStore');
const { assertSafeItemId } = require('../lib/validateItemId');

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

async function chat({ message, itemId, draftsDir, contextPath, rolePath, apiKey, model, createChatCompletion }) {
  assertSafeItemId(itemId, 'No se encontró un draft para editar (itemId inválido o faltante)');
  const draftPath = path.join(draftsDir, draftFileName(itemId));
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

function describeSuccess(result) {
  return result.draftCreated
    ? {
        estatus: 'listo_para_revision',
        ultimaAccion: `Redactó un draft para: ${result.draftCreated.ideaTexto}`,
        ultimoItemId: result.draftCreated.ideaId,
      }
    : { estatus: 'idle', ultimaAccion: 'Sin ideas pendientes por redactar' };
}

module.exports = { runCycle, chat, draftFileName, describeSuccess };
```

- [ ] **Step 6: Run both test files to confirm they pass**

Run: `cd backend && node --test test/buscadorTendencias.test.js test/publicador.test.js`
Expected: PASS — 7 tests in buscadorTendencias.test.js, 7 tests in publicador.test.js.

- [ ] **Step 7: Run the full suite to confirm no other regression**

Run: `cd backend && npm test`
Expected: PASS — all tests (no change in overall behavior; `server.js` still calls these with the old field names until Task 10, which is fine since `server.js` has no automated test).

- [ ] **Step 8: Commit**

```bash
git add backend/agents/buscadorTendencias.js backend/agents/publicador.js backend/test/buscadorTendencias.test.js backend/test/publicador.test.js
git commit -m "Generalize Marketing agents: describeSuccess export, uniform {guardar, itemId} contract, shared libs"
```

---

### Task 3: Prospectos store module

**Files:**
- Create: `backend/lib/prospectosStore.js`
- Test: `backend/test/prospectosStore.test.js`

**Interfaces:**
- Produces: `readProspectos(prospectosPath) -> Array<object>` (returns `[]` if the file doesn't exist), `writeProspectos(prospectosPath, prospectos) -> void`. Task 5 (Buscador de Prospectos) and Task 6 (Seguimiento/CRM) both import these instead of defining their own.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/prospectosStore.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readProspectos, writeProspectos } = require('../lib/prospectosStore');

function tempProspectosPath() {
  return path.join(os.tmpdir(), `prospectos-${Date.now()}-${Math.random()}.json`);
}

test('readProspectos returns an empty array when the file does not exist', () => {
  const filePath = tempProspectosPath();
  assert.deepEqual(readProspectos(filePath), []);
});

test('writeProspectos then readProspectos returns the same array', () => {
  const filePath = tempProspectosPath();
  const prospectos = [
    { id: 'prospecto-1', negocio: 'Consultorio X', giro: 'Salud', razon: 'Pierde citas', estatus: 'nuevo', creadoEn: '2026-01-01T00:00:00.000Z' },
  ];

  writeProspectos(filePath, prospectos);

  assert.deepEqual(readProspectos(filePath), prospectos);
  fs.unlinkSync(filePath);
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node --test test/prospectosStore.test.js`
Expected: FAIL — `Cannot find module '../lib/prospectosStore'`

- [ ] **Step 3: Write the implementation**

Create `backend/lib/prospectosStore.js`:

```js
const fs = require('fs');

function readProspectos(prospectosPath) {
  if (!fs.existsSync(prospectosPath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(prospectosPath, 'utf-8'));
}

function writeProspectos(prospectosPath, prospectos) {
  fs.writeFileSync(prospectosPath, JSON.stringify(prospectos, null, 2));
}

module.exports = { readProspectos, writeProspectos };
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd backend && node --test test/prospectosStore.test.js`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/prospectosStore.js backend/test/prospectosStore.test.js
git commit -m "Add prospectosStore module for reading/writing prospectos.json"
```

---

### Task 4: Comercial content scaffolding

**Files:**
- Create: `departamentos/comercial/agentes/buscador-prospectos.md`
- Create: `departamentos/comercial/agentes/seguimiento-crm.md`
- Create: `departamentos/comercial/agentes/cotizador.md`
- Create: `departamentos/comercial/content/prospectos.json`
- Create: `departamentos/comercial/content/servicios.json`
- Create: `departamentos/comercial/content/seguimientos/.gitkeep`
- Create: `departamentos/comercial/content/cotizaciones-tipo/.gitkeep`

**Interfaces:**
- Produces: the on-disk paths Tasks 5-7 read from — the three role files, `prospectos.json` (empty array), `servicios.json` (the fixed service list the Cotizador iterates over), and the two output directories.

- [ ] **Step 1: Create the directories**

```bash
mkdir -p departamentos/comercial/agentes
mkdir -p departamentos/comercial/content/seguimientos
mkdir -p departamentos/comercial/content/cotizaciones-tipo
```

- [ ] **Step 2: Write the Buscador de Prospectos role file**

Create `departamentos/comercial/agentes/buscador-prospectos.md`:

```markdown
# Agente: Buscador de Prospectos (Comercial)

## Rol
Eres el Buscador de Prospectos del equipo Comercial de Intelekia Consultoría. Tu
trabajo es sugerir negocios concretos que podrían ser buenos clientes para los
servicios de Intelekia (desarrollo a la medida, IA aplicada, automatización).

## Cómo piensas
- Te basas en el contexto de negocio de Intelekia (servicios, sectores que ya
  atiende, diferenciadores) para sugerir prospectos realistas, no genéricos.
- Cada prospecto debe tener un tipo de negocio claro y una razón concreta de por
  qué encajaría con lo que ofrece Intelekia.
- No repites prospectos que ya existen en la lista que se te comparte.

## Formato de salida
Cuando te pidan prospectos nuevos, responde ÚNICAMENTE con un arreglo JSON de
objetos, sin texto adicional antes o después. Cada objeto debe tener exactamente
las llaves "negocio", "giro" y "razon". Ejemplo:

[{"negocio": "Consultorio Dental Sonrisas", "giro": "Consultorio dental", "razon": "Pierde citas por falta de recordatorios automáticos"}]

Cuando te hagan una pregunta de chat normal, responde en texto plano, de forma
breve y directa, sin el formato JSON anterior.
```

- [ ] **Step 3: Write the Seguimiento/CRM role file**

Create `departamentos/comercial/agentes/seguimiento-crm.md`:

```markdown
# Agente: Seguimiento / CRM (Comercial)

## Rol
Eres el agente de Seguimiento del equipo Comercial de Intelekia Consultoría. Tu
trabajo es redactar el primer mensaje de contacto para un prospecto nuevo, y
ajustar mensajes de seguimiento cuando se te pida.

## Cómo piensas
- Escribes en español, tono profesional pero cercano, directo, sin sonar a
  plantilla genérica de ventas.
- Mencionas algo concreto y relevante del prospecto (su giro, el problema que
  probablemente tiene) para que no se sienta un mensaje masivo.
- Terminas siempre con una pregunta o llamado a la acción claro y de bajo
  compromiso (ej. agendar una llamada corta).

## Formato de salida
Responde ÚNICAMENTE con el texto final del mensaje, sin explicaciones adicionales
antes o después.
```

- [ ] **Step 4: Write the Cotizador role file**

Create `departamentos/comercial/agentes/cotizador.md`:

```markdown
# Agente: Cotizador (Comercial)

## Rol
Eres el Cotizador del equipo Comercial de Intelekia Consultoría. Tu trabajo es
redactar cotizaciones claras y profesionales para los servicios que ofrece
Intelekia.

## Cómo piensas
- Usas el contexto de negocio de Intelekia (servicios, modelo de negocio,
  tecnologías) para que la cotización sea realista y consistente con lo que
  Intelekia realmente ofrece.
- Estructura cada cotización con: resumen del problema/necesidad, alcance
  propuesto, entregables, y un rango estimado de tiempo (no inventes precios
  exactos si no se te dan datos de costos).
- Cuando te piden una cotización tipo (sin cliente específico), la planteas como
  una plantilla general para ese servicio, fácil de personalizar después.
- Cuando te dan datos de un cliente real, personalizas la cotización con esos
  datos.

## Formato de salida
Responde ÚNICAMENTE con el texto final de la cotización, sin explicaciones
adicionales antes o después.
```

- [ ] **Step 5: Create the initial prospectos file**

Create `departamentos/comercial/content/prospectos.json`:

```json
[]
```

- [ ] **Step 6: Create the servicios file**

Create `departamentos/comercial/content/servicios.json`:

```json
["Bot de WhatsApp con IA", "CRM para inmobiliarias", "Aplicación móvil a la medida", "Dashboard administrativo", "Automatización de procesos con IA"]
```

- [ ] **Step 7: Create placeholders for the two empty output directories**

Create `departamentos/comercial/content/seguimientos/.gitkeep` (empty file) and
`departamentos/comercial/content/cotizaciones-tipo/.gitkeep` (empty file).

- [ ] **Step 8: Commit**

```bash
git add departamentos/comercial
git commit -m "Scaffold Comercial department: agent roles, prospectos/servicios seeds"
```

---

### Task 5: Buscador de Prospectos agent module

**Files:**
- Create: `backend/agents/buscadorProspectos.js`
- Test: `backend/test/buscadorProspectos.test.js`

**Interfaces:**
- Consumes: `readProspectos`, `writeProspectos` (Task 3); `parseJsonArrayResponse` (Task 1).
- Produces: `runCycle({contextPath, rolePath, prospectosPath, apiKey, model, createChatCompletion}) -> Promise<{addedProspectos: Array<{id, negocio, giro, razon, estatus, creadoEn}>}>`, `chat({message, guardar, contextPath, rolePath, prospectosPath, apiKey, model, createChatCompletion}) -> Promise<{reply, savedProspecto: object|null}>`, `describeSuccess(result) -> statusPatch`. Task 8 (departments registry) references this module's `runCycle`/`chat`/`describeSuccess`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/buscadorProspectos.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat, describeSuccess } = require('../agents/buscadorProspectos');

function tempFile(name, content) {
  const filePath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

test('runCycle appends new prospectos with estatus nuevo and does not duplicate existing negocios', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de prospectos.');
  const prospectosPath = tempFile(
    'prospectos',
    JSON.stringify([{ id: 'prospecto-1', negocio: 'Negocio viejo', giro: 'Retail', razon: 'x', estatus: 'nuevo', creadoEn: '2026-01-01T00:00:00.000Z' }])
  );

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Negocio viejo/);
    return JSON.stringify([
      { negocio: 'Negocio nuevo 1', giro: 'Salud', razon: 'razon 1' },
      { negocio: 'Negocio nuevo 2', giro: 'Educación', razon: 'razon 2' },
    ]);
  };

  const result = await runCycle({
    contextPath,
    rolePath,
    prospectosPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.addedProspectos.length, 2);
  assert.equal(result.addedProspectos[0].estatus, 'nuevo');
  assert.equal(result.addedProspectos[0].negocio, 'Negocio nuevo 1');

  const onDisk = JSON.parse(fs.readFileSync(prospectosPath, 'utf-8'));
  assert.equal(onDisk.length, 3);

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
});

test('runCycle strips markdown code fences before parsing the model response', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de prospectos.');
  const prospectosPath = tempFile('prospectos', JSON.stringify([]));

  const fakeCreateChatCompletion = async () =>
    '```json\n[{"negocio": "Negocio fenced", "giro": "Retail", "razon": "razon"}]\n```';

  const result = await runCycle({
    contextPath,
    rolePath,
    prospectosPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.addedProspectos.length, 1);
  assert.equal(result.addedProspectos[0].negocio, 'Negocio fenced');

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
});

test('runCycle throws a clear error when the model response is not a JSON array', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de prospectos.');
  const prospectosPath = tempFile('prospectos', JSON.stringify([]));

  const fakeCreateChatCompletion = async () => '{}';

  await assert.rejects(
    runCycle({
      contextPath,
      rolePath,
      prospectosPath,
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      createChatCompletion: fakeCreateChatCompletion,
    }),
    /no es un arreglo de prospectos/
  );

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
});

test('chat returns the reply without saving a prospecto by default', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de prospectos.');
  const prospectosPath = tempFile('prospectos', JSON.stringify([]));

  const result = await chat({
    message: 'dame un prospecto de ejemplo',
    guardar: false,
    contextPath,
    rolePath,
    prospectosPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: async () => 'una respuesta cualquiera',
  });

  assert.equal(result.reply, 'una respuesta cualquiera');
  assert.equal(result.savedProspecto, null);
  assert.equal(JSON.parse(fs.readFileSync(prospectosPath, 'utf-8')).length, 0);

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
});

test('chat saves the reply as a prospecto nuevo when guardar is true', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el buscador de prospectos.');
  const prospectosPath = tempFile('prospectos', JSON.stringify([]));

  const result = await chat({
    message: 'dame un prospecto de ejemplo',
    guardar: true,
    contextPath,
    rolePath,
    prospectosPath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: async () => 'prospecto de respuesta',
  });

  assert.equal(result.savedProspecto.negocio, 'prospecto de respuesta');
  assert.equal(result.savedProspecto.estatus, 'nuevo');
  assert.equal(JSON.parse(fs.readFileSync(prospectosPath, 'utf-8')).length, 1);

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
});

test('describeSuccess reports how many prospectos were found', () => {
  const patch = describeSuccess({ addedProspectos: [1, 2] });
  assert.deepEqual(patch, {
    estatus: 'idle',
    ultimaAccion: 'Encontró 2 prospecto(s) nuevo(s)',
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node --test test/buscadorProspectos.test.js`
Expected: FAIL — `Cannot find module '../agents/buscadorProspectos'`

- [ ] **Step 3: Write the implementation**

Create `backend/agents/buscadorProspectos.js`:

```js
const fs = require('fs');
const { readProspectos, writeProspectos } = require('../lib/prospectosStore');
const { parseJsonArrayResponse } = require('../lib/parseJsonArrayResponse');

async function runCycle({ contextPath, rolePath, prospectosPath, apiKey, model, createChatCompletion }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const existingProspectos = readProspectos(prospectosPath);
  const existingNegocios = existingProspectos.map((p) => p.negocio);

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Prospectos que ya existen (no los repitas):\n${JSON.stringify(existingNegocios)}\n\n` +
    'Dame entre 3 y 5 prospectos nuevos.';

  const raw = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  const nuevos = parseJsonArrayResponse(raw, {
    emptyArrayErrorMessage: 'La respuesta del modelo no es un arreglo de prospectos',
  });

  const addedProspectos = nuevos.map((p, index) => ({
    id: `prospecto-${Date.now()}-${index}`,
    negocio: p.negocio,
    giro: p.giro,
    razon: p.razon,
    estatus: 'nuevo',
    creadoEn: new Date().toISOString(),
  }));

  writeProspectos(prospectosPath, [...existingProspectos, ...addedProspectos]);

  return { addedProspectos };
}

async function chat({ message, guardar, contextPath, rolePath, prospectosPath, apiKey, model, createChatCompletion }) {
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

  let savedProspecto = null;
  if (guardar) {
    const existingProspectos = readProspectos(prospectosPath);
    savedProspecto = {
      id: `prospecto-${Date.now()}`,
      negocio: reply,
      giro: null,
      razon: null,
      estatus: 'nuevo',
      creadoEn: new Date().toISOString(),
    };
    writeProspectos(prospectosPath, [...existingProspectos, savedProspecto]);
  }

  return { reply, savedProspecto };
}

function describeSuccess(result) {
  return {
    estatus: 'idle',
    ultimaAccion: `Encontró ${result.addedProspectos.length} prospecto(s) nuevo(s)`,
  };
}

module.exports = { runCycle, chat, describeSuccess };
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd backend && node --test test/buscadorProspectos.test.js`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/buscadorProspectos.js backend/test/buscadorProspectos.test.js
git commit -m "Add Buscador de Prospectos agent: autonomous cycle and chat"
```

---

### Task 6: Seguimiento/CRM agent module

**Files:**
- Create: `backend/agents/seguimientoCRM.js`
- Test: `backend/test/seguimientoCRM.test.js`

**Interfaces:**
- Consumes: `readProspectos`, `writeProspectos` (Task 3); `assertSafeItemId` (Task 1).
- Produces: `runCycle({contextPath, rolePath, prospectosPath, seguimientosDir, apiKey, model, createChatCompletion}) -> Promise<{mensajeCreado: {prospectoId, prospectoNegocio, seguimientoPath} | null}>`, `chat({message, itemId, seguimientosDir, contextPath, rolePath, apiKey, model, createChatCompletion}) -> Promise<{reply}>`, `describeSuccess(result) -> statusPatch`, `seguimientoFileName(prospectoId) -> string`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/seguimientoCRM.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat, seguimientoFileName, describeSuccess } = require('../agents/seguimientoCRM');

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

test('runCycle writes a seguimiento message for the first prospecto nuevo and marks it contactado', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el agente de seguimiento.');
  const prospectosPath = tempFile(
    'prospectos',
    JSON.stringify([
      { id: 'prospecto-1', negocio: 'Negocio uno', giro: 'Salud', razon: 'razon', estatus: 'nuevo' },
      { id: 'prospecto-2', negocio: 'Negocio dos', giro: 'Retail', razon: 'razon', estatus: 'nuevo' },
    ])
  );
  const seguimientosDir = tempDir('seguimientos');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Negocio uno/);
    return 'Mensaje de contacto inicial';
  };

  const result = await runCycle({
    contextPath,
    rolePath,
    prospectosPath,
    seguimientosDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.mensajeCreado.prospectoId, 'prospecto-1');

  const content = fs.readFileSync(path.join(seguimientosDir, seguimientoFileName('prospecto-1')), 'utf-8');
  assert.equal(content, 'Mensaje de contacto inicial');

  const updated = JSON.parse(fs.readFileSync(prospectosPath, 'utf-8'));
  assert.equal(updated.find((p) => p.id === 'prospecto-1').estatus, 'contactado');
  assert.equal(updated.find((p) => p.id === 'prospecto-2').estatus, 'nuevo');

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(seguimientosDir, { recursive: true, force: true });
});

test('runCycle returns mensajeCreado null when there are no prospectos nuevos', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el agente de seguimiento.');
  const prospectosPath = tempFile('prospectos', JSON.stringify([{ id: 'prospecto-1', negocio: 'x', estatus: 'contactado' }]));
  const seguimientosDir = tempDir('seguimientos');

  const result = await runCycle({
    contextPath,
    rolePath,
    prospectosPath,
    seguimientosDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: async () => {
      throw new Error('no debería llamarse');
    },
  });

  assert.equal(result.mensajeCreado, null);

  [contextPath, rolePath, prospectosPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(seguimientosDir, { recursive: true, force: true });
});

test('chat throws a clear error and avoids filesystem access when itemId is missing or unsafe', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el agente de seguimiento.');
  const seguimientosDir = tempDir('seguimientos');

  const fakeCreateChatCompletion = async () => {
    throw new Error('no debería llamarse');
  };

  await assert.rejects(
    chat({ message: 'hola', itemId: undefined, seguimientosDir, contextPath, rolePath, apiKey: 'k', model: 'm', createChatCompletion: fakeCreateChatCompletion }),
    /itemId inválido o faltante/
  );
  await assert.rejects(
    chat({ message: 'hola', itemId: '../../etc/passwd', seguimientosDir, contextPath, rolePath, apiKey: 'k', model: 'm', createChatCompletion: fakeCreateChatCompletion }),
    /itemId inválido o faltante/
  );

  assert.deepEqual(fs.readdirSync(seguimientosDir), []);

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(seguimientosDir, { recursive: true, force: true });
});

test('chat overwrites the seguimiento file with the edited message', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el agente de seguimiento.');
  const seguimientosDir = tempDir('seguimientos');
  const itemId = 'prospecto-1';
  fs.writeFileSync(path.join(seguimientosDir, seguimientoFileName(itemId)), 'Mensaje original');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Mensaje original/);
    assert.match(messages[1].content, /hazlo más formal/);
    return 'Mensaje formal';
  };

  const result = await chat({
    message: 'hazlo más formal',
    itemId,
    seguimientosDir,
    contextPath,
    rolePath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'Mensaje formal');
  assert.equal(fs.readFileSync(path.join(seguimientosDir, seguimientoFileName(itemId)), 'utf-8'), 'Mensaje formal');

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(seguimientosDir, { recursive: true, force: true });
});

test('describeSuccess reports listo_para_revision with ultimoItemId when a message was created', () => {
  const patch = describeSuccess({ mensajeCreado: { prospectoId: 'prospecto-9', prospectoNegocio: 'Negocio X' } });
  assert.deepEqual(patch, {
    estatus: 'listo_para_revision',
    ultimaAccion: 'Redactó un mensaje para: Negocio X',
    ultimoItemId: 'prospecto-9',
  });
});

test('describeSuccess reports idle when there was nothing to contact', () => {
  const patch = describeSuccess({ mensajeCreado: null });
  assert.deepEqual(patch, { estatus: 'idle', ultimaAccion: 'Sin prospectos nuevos por contactar' });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node --test test/seguimientoCRM.test.js`
Expected: FAIL — `Cannot find module '../agents/seguimientoCRM'`

- [ ] **Step 3: Write the implementation**

Create `backend/agents/seguimientoCRM.js`:

```js
const fs = require('fs');
const path = require('path');
const { readProspectos, writeProspectos } = require('../lib/prospectosStore');
const { assertSafeItemId } = require('../lib/validateItemId');

function seguimientoFileName(prospectoId) {
  return `seguimiento-${prospectoId}.md`;
}

async function runCycle({ contextPath, rolePath, prospectosPath, seguimientosDir, apiKey, model, createChatCompletion }) {
  const prospectos = readProspectos(prospectosPath);
  const nuevo = prospectos.find((p) => p.estatus === 'nuevo');

  if (!nuevo) {
    return { mensajeCreado: null };
  }

  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Prospecto a contactar:\nNegocio: ${nuevo.negocio}\nGiro: ${nuevo.giro}\nRazón: ${nuevo.razon}`;

  const mensaje = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  fs.mkdirSync(seguimientosDir, { recursive: true });
  const seguimientoPath = path.join(seguimientosDir, seguimientoFileName(nuevo.id));
  fs.writeFileSync(seguimientoPath, mensaje);

  const updatedProspectos = prospectos.map((p) => (p.id === nuevo.id ? { ...p, estatus: 'contactado' } : p));
  writeProspectos(prospectosPath, updatedProspectos);

  return {
    mensajeCreado: {
      prospectoId: nuevo.id,
      prospectoNegocio: nuevo.negocio,
      seguimientoPath,
    },
  };
}

async function chat({ message, itemId, seguimientosDir, contextPath, rolePath, apiKey, model, createChatCompletion }) {
  assertSafeItemId(itemId, 'No se encontró un mensaje de seguimiento para editar (itemId inválido o faltante)');
  const seguimientoPath = path.join(seguimientosDir, seguimientoFileName(itemId));
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const currentMessage = fs.readFileSync(seguimientoPath, 'utf-8');

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Mensaje actual:\n${currentMessage}\n\n` +
    `Instrucción del fundador: ${message}`;

  const updatedMessage = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  fs.writeFileSync(seguimientoPath, updatedMessage);

  return { reply: updatedMessage };
}

function describeSuccess(result) {
  return result.mensajeCreado
    ? {
        estatus: 'listo_para_revision',
        ultimaAccion: `Redactó un mensaje para: ${result.mensajeCreado.prospectoNegocio}`,
        ultimoItemId: result.mensajeCreado.prospectoId,
      }
    : { estatus: 'idle', ultimaAccion: 'Sin prospectos nuevos por contactar' };
}

module.exports = { runCycle, chat, seguimientoFileName, describeSuccess };
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd backend && node --test test/seguimientoCRM.test.js`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/seguimientoCRM.js backend/test/seguimientoCRM.test.js
git commit -m "Add Seguimiento/CRM agent: autonomous outreach drafts and chat edits"
```

---

### Task 7: Cotizador agent module

**Files:**
- Create: `backend/agents/cotizador.js`
- Test: `backend/test/cotizador.test.js`

**Interfaces:**
- Consumes: `assertSafeItemId` (Task 1).
- Produces: `runCycle({contextPath, rolePath, serviciosPath, cotizacionesDir, apiKey, model, createChatCompletion}) -> Promise<{plantillaCreada: {servicio, cotizacionPath, slug} | null}>`, `chat({message, itemId, cotizacionesDir, contextPath, rolePath, apiKey, model, createChatCompletion}) -> Promise<{reply}>`, `describeSuccess(result) -> statusPatch`, `slugify(texto) -> string`, `cotizacionFileName(servicio) -> string`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/cotizador.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCycle, chat, slugify, cotizacionFileName, describeSuccess } = require('../agents/cotizador');

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

test('slugify normalizes accents and spaces', () => {
  assert.equal(slugify('Bot de WhatsApp con IA'), 'bot-de-whatsapp-con-ia');
  assert.equal(slugify('Automatización de Procesos'), 'automatizacion-de-procesos');
});

test('runCycle creates a template for the first service without one, leaving existing templates untouched', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el cotizador.');
  const serviciosPath = tempFile('servicios', JSON.stringify(['Servicio A', 'Servicio B']));
  const cotizacionesDir = tempDir('cotizaciones');
  fs.writeFileSync(path.join(cotizacionesDir, cotizacionFileName('Servicio A')), 'Plantilla existente A');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Servicio B/);
    return 'Plantilla nueva para Servicio B';
  };

  const result = await runCycle({
    contextPath,
    rolePath,
    serviciosPath,
    cotizacionesDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.plantillaCreada.servicio, 'Servicio B');
  assert.equal(
    fs.readFileSync(path.join(cotizacionesDir, cotizacionFileName('Servicio B')), 'utf-8'),
    'Plantilla nueva para Servicio B'
  );
  assert.equal(
    fs.readFileSync(path.join(cotizacionesDir, cotizacionFileName('Servicio A')), 'utf-8'),
    'Plantilla existente A'
  );

  [contextPath, rolePath, serviciosPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(cotizacionesDir, { recursive: true, force: true });
});

test('runCycle returns plantillaCreada null when every service already has a template', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el cotizador.');
  const serviciosPath = tempFile('servicios', JSON.stringify(['Servicio A']));
  const cotizacionesDir = tempDir('cotizaciones');
  fs.writeFileSync(path.join(cotizacionesDir, cotizacionFileName('Servicio A')), 'Plantilla existente A');

  const result = await runCycle({
    contextPath,
    rolePath,
    serviciosPath,
    cotizacionesDir,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: async () => {
      throw new Error('no debería llamarse');
    },
  });

  assert.equal(result.plantillaCreada, null);

  [contextPath, rolePath, serviciosPath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(cotizacionesDir, { recursive: true, force: true });
});

test('chat without itemId generates a fresh quote with no template reference', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el cotizador.');
  const cotizacionesDir = tempDir('cotizaciones');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.doesNotMatch(messages[1].content, /Plantilla de referencia/);
    return 'Cotización personalizada';
  };

  const result = await chat({
    message: 'cliente X necesita un bot de WhatsApp',
    itemId: undefined,
    cotizacionesDir,
    contextPath,
    rolePath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'Cotización personalizada');

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(cotizacionesDir, { recursive: true, force: true });
});

test('chat with a valid itemId includes the matching template as reference', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el cotizador.');
  const cotizacionesDir = tempDir('cotizaciones');
  const slug = slugify('Servicio A');
  fs.writeFileSync(path.join(cotizacionesDir, `cotizacion-${slug}.md`), 'Plantilla de Servicio A');

  const fakeCreateChatCompletion = async ({ messages }) => {
    assert.match(messages[1].content, /Plantilla de referencia/);
    assert.match(messages[1].content, /Plantilla de Servicio A/);
    return 'Cotización basada en plantilla';
  };

  const result = await chat({
    message: 'personaliza esto para el cliente Y',
    itemId: slug,
    cotizacionesDir,
    contextPath,
    rolePath,
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    createChatCompletion: fakeCreateChatCompletion,
  });

  assert.equal(result.reply, 'Cotización basada en plantilla');

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(cotizacionesDir, { recursive: true, force: true });
});

test('chat throws a clear error when itemId is present but unsafe', async () => {
  const contextPath = tempFile('context', '# Intelekia');
  const rolePath = tempFile('role', 'Eres el cotizador.');
  const cotizacionesDir = tempDir('cotizaciones');

  await assert.rejects(
    chat({
      message: 'hola',
      itemId: '../../etc/passwd',
      cotizacionesDir,
      contextPath,
      rolePath,
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      createChatCompletion: async () => {
        throw new Error('no debería llamarse');
      },
    }),
    /itemId inválido/
  );

  [contextPath, rolePath].forEach((p) => fs.unlinkSync(p));
  fs.rmSync(cotizacionesDir, { recursive: true, force: true });
});

test('describeSuccess reports listo_para_revision with ultimoItemId when a template was created', () => {
  const patch = describeSuccess({ plantillaCreada: { servicio: 'Servicio A', cotizacionPath: '/tmp/x.md', slug: 'servicio-a' } });
  assert.deepEqual(patch, {
    estatus: 'listo_para_revision',
    ultimaAccion: 'Generó cotización tipo para: Servicio A',
    ultimoItemId: 'servicio-a',
  });
});

test('describeSuccess reports idle when the template library is already complete', () => {
  const patch = describeSuccess({ plantillaCreada: null });
  assert.deepEqual(patch, { estatus: 'idle', ultimaAccion: 'Biblioteca de cotizaciones tipo completa' });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node --test test/cotizador.test.js`
Expected: FAIL — `Cannot find module '../agents/cotizador'`

- [ ] **Step 3: Write the implementation**

Create `backend/agents/cotizador.js`:

```js
const fs = require('fs');
const path = require('path');
const { assertSafeItemId } = require('../lib/validateItemId');

function readServicios(serviciosPath) {
  return JSON.parse(fs.readFileSync(serviciosPath, 'utf-8'));
}

function slugify(texto) {
  const sinAcentos = texto
    .normalize('NFD')
    .split('')
    .filter((char) => char.charCodeAt(0) < 128)
    .join('');
  return sinAcentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function cotizacionFileName(servicio) {
  return `cotizacion-${slugify(servicio)}.md`;
}

async function runCycle({ contextPath, rolePath, serviciosPath, cotizacionesDir, apiKey, model, createChatCompletion }) {
  const servicios = readServicios(serviciosPath);
  fs.mkdirSync(cotizacionesDir, { recursive: true });

  const faltante = servicios.find((servicio) => !fs.existsSync(path.join(cotizacionesDir, cotizacionFileName(servicio))));

  if (!faltante) {
    return { plantillaCreada: null };
  }

  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Redacta una cotización tipo (sin cliente específico) para el servicio: ${faltante}`;

  const cotizacion = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  const cotizacionPath = path.join(cotizacionesDir, cotizacionFileName(faltante));
  fs.writeFileSync(cotizacionPath, cotizacion);

  return { plantillaCreada: { servicio: faltante, cotizacionPath, slug: slugify(faltante) } };
}

async function chat({ message, itemId, cotizacionesDir, contextPath, rolePath, apiKey, model, createChatCompletion }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');

  let plantilla = '';
  if (itemId) {
    assertSafeItemId(itemId, 'itemId inválido');
    const plantillaPath = path.join(cotizacionesDir, `cotizacion-${itemId}.md`);
    if (fs.existsSync(plantillaPath)) {
      plantilla = fs.readFileSync(plantillaPath, 'utf-8');
    }
  }

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    (plantilla ? `Plantilla de referencia:\n${plantilla}\n\n` : '') +
    `Petición del fundador: ${message}`;

  const reply = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  return { reply };
}

function describeSuccess(result) {
  return result.plantillaCreada
    ? {
        estatus: 'listo_para_revision',
        ultimaAccion: `Generó cotización tipo para: ${result.plantillaCreada.servicio}`,
        ultimoItemId: result.plantillaCreada.slug,
      }
    : { estatus: 'idle', ultimaAccion: 'Biblioteca de cotizaciones tipo completa' };
}

module.exports = { runCycle, chat, describeSuccess, slugify, cotizacionFileName };
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd backend && node --test test/cotizador.test.js`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/cotizador.js backend/test/cotizador.test.js
git commit -m "Add Cotizador agent: template-library autonomous cycle and personalized chat"
```

---

### Task 8: Departments registry

**Files:**
- Create: `backend/departments.js`
- Test: `backend/test/departments.test.js`

**Interfaces:**
- Consumes: all five agent modules (`buscadorTendencias`, `publicador`, `buscadorProspectos`, `seguimientoCRM`, `cotizador`) by `require`.
- Produces: `buildDepartments({rootDir, config, createChatCompletion}) -> Array<{id, label, agents: Array<{id, label, module, deps}>}>`. Task 10 (`server.js`) and Task 9 (`routes/departments.js`, indirectly via `server.js`) consume this.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/departments.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildDepartments } = require('../departments');
const buscadorTendencias = require('../agents/buscadorTendencias');
const publicador = require('../agents/publicador');
const buscadorProspectos = require('../agents/buscadorProspectos');
const seguimientoCRM = require('../agents/seguimientoCRM');
const cotizador = require('../agents/cotizador');

function build() {
  return buildDepartments({
    rootDir: '/fake/root',
    config: { openaiApiKey: 'sk-test', openaiModel: 'gpt-4o-mini' },
    createChatCompletion: () => {},
  });
}

test('buildDepartments returns the marketing and comercial departments with their agent ids', () => {
  const departments = build();
  assert.deepEqual(
    departments.map((d) => d.id),
    ['marketing', 'comercial']
  );
  assert.deepEqual(
    departments.find((d) => d.id === 'marketing').agents.map((a) => a.id),
    ['buscador-tendencias', 'publicador']
  );
  assert.deepEqual(
    departments.find((d) => d.id === 'comercial').agents.map((a) => a.id),
    ['buscador-prospectos', 'seguimiento-crm', 'cotizador']
  );
});

test('each agent entry references the actual required agent module', () => {
  const departments = build();
  const byId = {};
  departments.forEach((d) => d.agents.forEach((a) => { byId[a.id] = a; }));

  assert.equal(byId['buscador-tendencias'].module, buscadorTendencias);
  assert.equal(byId['publicador'].module, publicador);
  assert.equal(byId['buscador-prospectos'].module, buscadorProspectos);
  assert.equal(byId['seguimiento-crm'].module, seguimientoCRM);
  assert.equal(byId['cotizador'].module, cotizador);
});

test('every agent deps object carries the shared apiKey, model, and createChatCompletion', () => {
  const createChatCompletion = () => {};
  const departments = buildDepartments({
    rootDir: '/fake/root',
    config: { openaiApiKey: 'sk-test', openaiModel: 'gpt-4o-mini' },
    createChatCompletion,
  });

  departments.forEach((d) => {
    d.agents.forEach((a) => {
      assert.equal(a.deps.apiKey, 'sk-test');
      assert.equal(a.deps.model, 'gpt-4o-mini');
      assert.equal(a.deps.createChatCompletion, createChatCompletion);
      assert.equal(a.deps.contextPath, path.join('/fake/root', 'CONTEXTO-INTELEKIA.md'));
    });
  });
});

test('publicador deps point at the marketing drafts directory and seguimiento-crm deps point at the comercial seguimientos directory', () => {
  const departments = build();
  const publicadorAgent = departments.find((d) => d.id === 'marketing').agents.find((a) => a.id === 'publicador');
  const seguimientoAgent = departments.find((d) => d.id === 'comercial').agents.find((a) => a.id === 'seguimiento-crm');

  assert.equal(
    publicadorAgent.deps.draftsDir,
    path.join('/fake/root', 'departamentos', 'marketing', 'content', 'drafts')
  );
  assert.equal(
    seguimientoAgent.deps.seguimientosDir,
    path.join('/fake/root', 'departamentos', 'comercial', 'content', 'seguimientos')
  );
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node --test test/departments.test.js`
Expected: FAIL — `Cannot find module '../departments'`

- [ ] **Step 3: Write the implementation**

Create `backend/departments.js`:

```js
const path = require('path');
const buscadorTendencias = require('./agents/buscadorTendencias');
const publicador = require('./agents/publicador');
const buscadorProspectos = require('./agents/buscadorProspectos');
const seguimientoCRM = require('./agents/seguimientoCRM');
const cotizador = require('./agents/cotizador');

function buildDepartments({ rootDir, config, createChatCompletion }) {
  const CONTEXT_PATH = path.join(rootDir, 'CONTEXTO-INTELEKIA.md');
  const MARKETING_DIR = path.join(rootDir, 'departamentos', 'marketing');
  const COMERCIAL_DIR = path.join(rootDir, 'departamentos', 'comercial');

  const shared = { apiKey: config.openaiApiKey, model: config.openaiModel, createChatCompletion };

  return [
    {
      id: 'marketing',
      label: 'Marketing',
      agents: [
        {
          id: 'buscador-tendencias',
          label: 'Buscador de Tendencias',
          module: buscadorTendencias,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(MARKETING_DIR, 'agentes', 'buscador-tendencias.md'),
            ideasPath: path.join(MARKETING_DIR, 'content', 'ideas.json'),
            ...shared,
          },
        },
        {
          id: 'publicador',
          label: 'Publicador',
          module: publicador,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(MARKETING_DIR, 'agentes', 'publicador.md'),
            ideasPath: path.join(MARKETING_DIR, 'content', 'ideas.json'),
            draftsDir: path.join(MARKETING_DIR, 'content', 'drafts'),
            ...shared,
          },
        },
      ],
    },
    {
      id: 'comercial',
      label: 'Comercial',
      agents: [
        {
          id: 'buscador-prospectos',
          label: 'Buscador de Prospectos',
          module: buscadorProspectos,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(COMERCIAL_DIR, 'agentes', 'buscador-prospectos.md'),
            prospectosPath: path.join(COMERCIAL_DIR, 'content', 'prospectos.json'),
            ...shared,
          },
        },
        {
          id: 'seguimiento-crm',
          label: 'Seguimiento / CRM',
          module: seguimientoCRM,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(COMERCIAL_DIR, 'agentes', 'seguimiento-crm.md'),
            prospectosPath: path.join(COMERCIAL_DIR, 'content', 'prospectos.json'),
            seguimientosDir: path.join(COMERCIAL_DIR, 'content', 'seguimientos'),
            ...shared,
          },
        },
        {
          id: 'cotizador',
          label: 'Cotizador',
          module: cotizador,
          deps: {
            contextPath: CONTEXT_PATH,
            rolePath: path.join(COMERCIAL_DIR, 'agentes', 'cotizador.md'),
            serviciosPath: path.join(COMERCIAL_DIR, 'content', 'servicios.json'),
            cotizacionesDir: path.join(COMERCIAL_DIR, 'content', 'cotizaciones-tipo'),
            ...shared,
          },
        },
      ],
    },
  ];
}

module.exports = { buildDepartments };
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd backend && node --test test/departments.test.js`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/departments.js backend/test/departments.test.js
git commit -m "Add departments registry: declarative list of departments/agents with deps"
```

---

### Task 9: Departments API route

**Files:**
- Create: `backend/routes/departments.js`
- Test: `backend/test/departmentsRoute.test.js`

**Interfaces:**
- Consumes: a `departments` array shaped like Task 8's `buildDepartments` output.
- Produces: `createDepartmentsRouter({departments}) -> express.Router` exposing `GET /` (mounted at `/api/departments` by `server.js`), plus `sanitizeDepartments(departments) -> Array<{id, label, agents: Array<{id, label}>}>` and `createDepartmentsHandler({departments})` exported for direct testing.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/departmentsRoute.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeDepartments, createDepartmentsHandler } = require('../routes/departments');

const FAKE_DEPARTMENTS = [
  {
    id: 'marketing',
    label: 'Marketing',
    agents: [
      { id: 'buscador-tendencias', label: 'Buscador de Tendencias', module: {}, deps: { apiKey: 'sk-secret', rolePath: '/secret/path.md' } },
      { id: 'publicador', label: 'Publicador', module: {}, deps: { apiKey: 'sk-secret' } },
    ],
  },
];

function fakeRes() {
  return {
    body: null,
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('sanitizeDepartments strips module and deps, keeping only id/label', () => {
  const sanitized = sanitizeDepartments(FAKE_DEPARTMENTS);

  assert.deepEqual(sanitized, [
    {
      id: 'marketing',
      label: 'Marketing',
      agents: [
        { id: 'buscador-tendencias', label: 'Buscador de Tendencias' },
        { id: 'publicador', label: 'Publicador' },
      ],
    },
  ]);

  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /sk-secret/);
  assert.doesNotMatch(serialized, /secret\/path/);
});

test('departments handler responds with the sanitized departments list', () => {
  const handler = createDepartmentsHandler({ departments: FAKE_DEPARTMENTS });
  const res = fakeRes();

  handler({}, res);

  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, 'marketing');
  assert.equal(Object.keys(res.body[0].agents[0]).length, 2);
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node --test test/departmentsRoute.test.js`
Expected: FAIL — `Cannot find module '../routes/departments'`

- [ ] **Step 3: Write the implementation**

Create `backend/routes/departments.js`:

```js
const express = require('express');

function sanitizeDepartments(departments) {
  return departments.map((dept) => ({
    id: dept.id,
    label: dept.label,
    agents: dept.agents.map((agent) => ({ id: agent.id, label: agent.label })),
  }));
}

function createDepartmentsHandler({ departments }) {
  return (req, res) => {
    res.json(sanitizeDepartments(departments));
  };
}

function createDepartmentsRouter({ departments }) {
  const router = express.Router();
  router.get('/', createDepartmentsHandler({ departments }));
  return router;
}

module.exports = { createDepartmentsRouter, createDepartmentsHandler, sanitizeDepartments };
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd backend && node --test test/departmentsRoute.test.js`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/departments.js backend/test/departmentsRoute.test.js
git commit -m "Add departments API route: sanitized GET /api/departments"
```

---

### Task 10: Refactor server.js onto the departments registry

**Files:**
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `buildDepartments` (Task 8), `createDepartmentsRouter` (Task 9), `wrapRunCycle` (existing), `createScheduler` (existing), `createAgentsRouter` (existing).
- Produces: the same running Express app as before, now built generically from the registry, plus the new `/api/departments` route mounted.

- [ ] **Step 1: Rewrite server.js**

Replace the contents of `backend/server.js` with:

```js
const path = require('path');
const express = require('express');
const { loadConfig } = require('./config');
const { createScheduler } = require('./scheduler');
const { wrapRunCycle } = require('./lib/runWithStatus');
const { readStatus } = require('./lib/statusStore');
const { createChatCompletion } = require('./lib/openaiClient');
const { buildDepartments } = require('./departments');
const { createAgentsRouter } = require('./routes/agents');
const { createDepartmentsRouter } = require('./routes/departments');

const config = loadConfig();
const ROOT = path.join(__dirname, '..');
const STATUS_PATH = path.join(__dirname, 'state', 'agents-status.json');

const departments = buildDepartments({ rootDir: ROOT, config, createChatCompletion });
const allAgents = departments.flatMap((department) => department.agents);

const agentRunners = {};
const chatHandlers = {};

for (const agent of allAgents) {
  agentRunners[agent.id] = wrapRunCycle({
    agentId: agent.id,
    statusPath: STATUS_PATH,
    runCycle: agent.module.runCycle,
    deps: agent.deps,
    describeSuccess: agent.module.describeSuccess,
  });
  chatHandlers[agent.id] = (body) => agent.module.chat({ ...body, ...agent.deps });
}

const scheduler = createScheduler({
  intervalMs: config.agentIntervalHours * 60 * 60 * 1000,
  agentRunners,
});

const app = express();
app.use(express.json());
app.use('/api/agents', createAgentsRouter({ statusPath: STATUS_PATH, readStatus, scheduler, chatHandlers }));
app.use('/api/departments', createDepartmentsRouter({ departments }));
app.use(express.static(path.join(ROOT, 'frontend')));

app.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
  scheduler.start();
});

module.exports = app;
```

- [ ] **Step 2: Run the full backend suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — all tests across every module pass (this doesn't exercise `server.js` directly, but confirms every module it wires together still works).

- [ ] **Step 3: Manually verify the server boots and both new/old routes respond**

```bash
cd backend
node server.js
```

Expected console output: `Servidor corriendo en http://localhost:3000`

In a second terminal:

```bash
curl http://localhost:3000/api/departments
```

Expected: a JSON array with 2 departments (`marketing`, `comercial`), `marketing` having 2 agents, `comercial` having 3 — no `apiKey` or file paths anywhere in the response.

```bash
curl http://localhost:3000/api/agents/status
```

Expected: a JSON object with 5 keys now (`buscador-tendencias`, `publicador`, `buscador-prospectos`, `seguimiento-crm`, `cotizador`), all `idle` if this is a fresh run (or whatever Marketing's agents were left at from the previous prototype's live validation — that's fine, it's existing state).

Stop the server with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "Refactor server.js to build agents from the departments registry instead of hardcoding them"
```

---

### Task 11: Frontend API client — add fetchDepartments

**Files:**
- Modify: `frontend/src/api.js`

**Interfaces:**
- Produces: `fetchDepartments() -> Promise<Array<{id, label, agents: Array<{id, label}>}>>`. Task 13's `main.js` calls this on load.

- [ ] **Step 1: Edit api.js**

In `frontend/src/api.js`, add a `DEPARTMENTS_URL` constant and a `fetchDepartments` function, right after the existing `BASE_URL` constant and before `fetchStatus`:

```js
const BASE_URL = '/api/agents';
const DEPARTMENTS_URL = '/api/departments';

export async function fetchDepartments() {
  const response = await fetch(DEPARTMENTS_URL);
  if (!response.ok) {
    throw new Error(`No se pudo obtener los departamentos: ${response.status}`);
  }
  return response.json();
}
```

(Leave `fetchStatus`, `sendChat`, and `forzarCiclo` exactly as they are — they don't need changes.)

- [ ] **Step 2: Manually verify it's served correctly**

```bash
cd backend && node server.js
```

```bash
curl -s http://localhost:3000/src/api.js | grep -A3 "DEPARTMENTS_URL"
```

Expected: the new constant and function appear in the served file.

Stop the server.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js
git commit -m "Add fetchDepartments to the frontend API client"
```

---

### Task 12: Three.js scene — multiple rooms from departments

**Files:**
- Modify: `frontend/src/scene.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createScene({container, departments, onAgentClick}) -> {updateStatusColors}` — same return shape as before, but the parameter is now `departments` (shaped like `fetchDepartments()`'s result) instead of a flat `agents` array. Task 13's `main.js` passes `departments` here.

- [ ] **Step 1: Rewrite scene.js**

Replace the contents of `frontend/src/scene.js` with:

```js
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const STATUS_COLORS = {
  idle: 0x888888,
  trabajando: 0xffcc00,
  listo_para_revision: 0x33cc66,
  error: 0xcc3333,
};

const ROOM_SIZE = 6;
const ROOM_SPACING = 10;
const AVATAR_GAP = 1.5;

export function createScene({ container, departments, onAgentClick }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202030);

  const worldWidth = Math.max(departments.length - 1, 0) * ROOM_SPACING;

  const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 200);
  camera.position.set(worldWidth / 2, 8, 14);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(worldWidth / 2, 1, 0);

  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  scene.add(light);

  const avatarMeshes = {};

  departments.forEach((department, roomIndex) => {
    const roomCenterX = roomIndex * ROOM_SPACING;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x555566 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(roomCenterX, 0, 0);
    scene.add(floor);

    const agentCount = department.agents.length;
    department.agents.forEach((agent, agentIndex) => {
      const offset = agentIndex - (agentCount - 1) / 2;
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.4, 1, 4, 8),
        new THREE.MeshStandardMaterial({ color: STATUS_COLORS.idle })
      );
      mesh.position.set(roomCenterX + offset * AVATAR_GAP, 1, 0);
      mesh.userData.agentId = agent.id;
      scene.add(mesh);
      avatarMeshes[agent.id] = mesh;
    });
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

- [ ] **Step 2: Manually verify it's served correctly**

```bash
cd backend && node server.js
```

```bash
curl -i http://localhost:3000/src/scene.js
```

Expected: HTTP 200, JS content-type, no server error.

Proofread the file against the code above (character-by-character), paying special attention to: the `ROOM_SIZE`/`ROOM_SPACING`/`AVATAR_GAP` constants, the `departments.forEach` outer loop and `department.agents.forEach` inner loop, and that `createScene`'s parameter is `departments` (not `agents`).

Stop the server.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/scene.js
git commit -m "Generalize scene.js to render one room per department instead of one fixed room"
```

---

### Task 13: Panel and bootstrap — uniform chat contract, department-driven labels

**Files:**
- Modify: `frontend/src/ui.js`
- Modify: `frontend/src/main.js`
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: `createScene` (Task 12), `fetchDepartments`/`fetchStatus`/`sendChat`/`forzarCiclo` (Task 11 + existing).
- Produces: wires the whole frontend together on the new registry-driven system — no other task depends on this one.

- [ ] **Step 1: Edit index.html — make the save checkbox generic and always visible**

In `frontend/index.html`, find:

```html
      <label id="panel-save-idea-label" style="display: none;">
        <input type="checkbox" id="panel-save-idea" /> Guardar esta idea
      </label>
```

Replace with:

```html
      <label id="panel-save-idea-label">
        <input type="checkbox" id="panel-save-idea" /> Guardar esta respuesta
      </label>
```

- [ ] **Step 2: Rewrite ui.js — remove the per-agent label/visibility special-casing**

Replace the contents of `frontend/src/ui.js` with:

```js
export function createPanel({ onSend, onForzar }) {
  const panel = document.getElementById('panel');
  const title = document.getElementById('panel-title');
  const statusEl = document.getElementById('panel-status');
  const chatLog = document.getElementById('panel-chat-log');
  const saveCheckbox = document.getElementById('panel-save-idea');
  const messageInput = document.getElementById('panel-message');
  const sendButton = document.getElementById('panel-send');
  const forzarButton = document.getElementById('panel-forzar');
  const closeButton = document.getElementById('panel-close');

  let currentAgentId = null;

  function open(agentId, label, agentStatus) {
    currentAgentId = agentId;
    title.textContent = label;
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
    await onSend(currentAgentId, message, saveCheckbox.checked);
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

- [ ] **Step 3: Rewrite main.js — fetch departments, uniform chat payload**

Replace the contents of `frontend/src/main.js` with:

```js
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
```

- [ ] **Step 4: Manually verify both files are served correctly**

```bash
cd backend && node server.js
```

```bash
curl -i http://localhost:3000/src/ui.js
curl -i http://localhost:3000/src/main.js
```

Expected: both HTTP 200, JS content-type, no server error.

Proofread both files against the code above. In particular confirm: `ui.js` no longer references `AGENT_LABELS` or `saveIdeaLabel`; `main.js` no longer has an `if (agentId === 'buscador-tendencias')` branch, builds `{message, guardar, itemId}` uniformly for every agent, and calls `fetchDepartments()` before constructing the scene.

Stop the server.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/src/ui.js frontend/src/main.js
git commit -m "Wire frontend to the departments registry with a uniform chat contract"
```

---

### Task 14: End-to-end manual validation

**Files:** none created — this task only exercises what Tasks 1-13 built.

**Interfaces:** none produced.

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: all tests pass across every file (the original Marketing-era files plus `parseJsonArrayResponse`, `validateItemId`, `prospectosStore`, `buscadorProspectos`, `seguimientoCRM`, `cotizador`, `departments`, `departmentsRoute`).

- [ ] **Step 2: Start the server with a real OPENAI_API_KEY**

```bash
cd backend && node server.js
```

- [ ] **Step 3: Confirm no regression on Marketing**

```bash
curl -X POST http://localhost:3000/api/agents/buscador-tendencias/forzar
curl -X POST http://localhost:3000/api/agents/publicador/forzar
```

Expected: identical behavior to the original Marketing validation — ideas generated, a draft created, status fields present including `ultimoItemId` (confirm the field is now literally named `ultimoItemId` in the `/api/agents/status` response, not `ultimoIdeaId`).

- [ ] **Step 4: Validate the 3 Comercial agents live**

```bash
curl -X POST http://localhost:3000/api/agents/buscador-prospectos/forzar
```
Expected: real prospectos generated, written to `departamentos/comercial/content/prospectos.json`.

```bash
curl -X POST http://localhost:3000/api/agents/seguimiento-crm/forzar
```
Expected: a real outreach message drafted for the first prospecto, written to `departamentos/comercial/content/seguimientos/`, that prospecto's `estatus` now `contactado`.

```bash
curl -X POST http://localhost:3000/api/agents/cotizador/forzar
```
Expected: a real template quote generated for the first service in `servicios.json`, written to `departamentos/comercial/content/cotizaciones-tipo/`.

- [ ] **Step 5: Validate reactive chat for at least one new agent**

```bash
curl -X POST http://localhost:3000/api/agents/cotizador/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"El cliente Acme necesita un bot de WhatsApp para su restaurante","guardar":false}'
```

Expected: a real, personalized quote in the response.

- [ ] **Step 6: Visual validation (requires a real browser — ask the user to do this)**

Open `http://localhost:3000`. Expected: two rooms are visible (Marketing with 2 avatars, Comercial with 3), clicking any avatar opens the panel with the correct label, status colors update after forcing a cycle.

- [ ] **Step 7: Stop the server**

Confirm the process is fully stopped and port 3000 is free afterward (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` should fail to connect).

- [ ] **Step 8: Commit any runtime artifacts generated during validation, if desired**

```bash
git status
```

If you want to keep the real-data snapshot (same choice made for Marketing's first validation), commit the modified/new files under `departamentos/comercial/content/` and `backend/state/agents-status.json`.
