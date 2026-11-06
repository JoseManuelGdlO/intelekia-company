# Trabajadores a la medida (custom agents) con memoria

## Contexto y motivación

Hasta ahora, cada agente de la oficina (Marketing: Buscador de Tendencias, Publicador;
Comercial: Buscador de Prospectos, Seguimiento/CRM, Cotizador) requiere un ciclo de
ingeniería completo para existir: un módulo JS a la medida, una entrada en
`backend/departments.js`, tests, revisión. Eso tiene sentido para los agentes "core" del
negocio, pero no escala para la idea del fundador de "si mañana encuentro un skill,
plugin o repo interesante para ventas (o cualquier área), quiero venir a la plataforma,
crear un trabajador nuevo ahí mismo, darle el contexto, y que funcione" — sin pedirle a
nadie que programe un agente nuevo cada vez.

Este spec cubre un nuevo tipo de agente, **genérico y creado por el usuario en tiempo de
ejecución** ("trabajador a la medida"), que:

1. Se crea con solo un nombre y un texto de contexto/skill (lo que el fundador pegue de
   un skill, plugin o repo que encontró), dentro de un departamento existente.
2. Puede ser **reactivo únicamente** (solo responde cuando se le pregunta) o también
   **autónomo** (además corre un ciclo periódico), configurable al crearlo.
3. Tiene **memoria conversacional propia**: recuerda intercambios de chat anteriores,
   de forma automática, editable directamente por el fundador, y comprimible a demanda.
4. Puede **editarse** después de creado (nombre, contexto, si es autónomo) sin perder su
   memoria.

Esto es la generalización del registro de departamentos un paso más allá: de "N agentes
declarados en código" a "N agentes declarados en código + M agentes creados en caliente
por el usuario, persistidos, sin reinicio del servidor".

## Alcance

### Fase 1 — Backend

- Un módulo de agente genérico (fábrica, no un módulo fijo) cuyo comportamiento viene
  enteramente del texto de contexto/skill que se le dio al crearlo.
- Persistencia de los trabajadores a la medida en disco (`backend/state/custom-agents.json`),
  de forma que sobrevivan un reinicio del servidor.
- Registro en caliente: crear, editar, o cargar al inicio un trabajador a la medida no
  requiere reiniciar el servidor — se refleja de inmediato en `/api/departments`, en el
  chat, y (si es autónomo) en el scheduler.
- Memoria conversacional en texto plano por trabajador, que se lee y actualiza sola en
  cada chat, y que se puede leer, sobrescribir o comprimir vía API.
- Nuevos endpoints: crear trabajador, editar trabajador, leer/editar/comprimir memoria.

### Fase 2 — Frontend (diseño incluido aquí, implementación puede ir después)

- Un botón "Agregar trabajador" por cuarto/departamento en la escena 3D, que abre un
  formulario (nombre, contexto, checkbox "autónomo") y crea el trabajador en vivo.
- Para trabajadores a la medida específicamente (no para los 5 agentes core), el panel
  de chat gana controles extra: "Editar trabajador" (nombre/contexto/autónomo) y
  "Ver/editar memoria" + "Comprimir memoria".

## Fuera de alcance

- Crear departamentos nuevos desde el formulario — solo agregar trabajadores a
  departamentos que ya existen (Marketing, Comercial, y los que se agreguen después de
  la forma tradicional).
- Borrar un trabajador a la medida.
- Memoria conversacional para los 5 agentes core existentes (Buscador de Tendencias,
  Publicador, Buscador de Prospectos, Seguimiento/CRM, Cotizador) — no se pidió y
  cambiaría su comportamiento actual, que es explícitamente sin memoria entre llamadas.
- Compresión automática de memoria — solo botón manual.
- Ejecutar o integrar de verdad un plugin/repo externo que el fundador haya encontrado —
  por ahora, "darle el skill" significa pegar su texto como contexto, no conectar
  herramientas o APIs externas.

## Arquitectura y stack

```
backend/
  agents/
    customAgent.js            → NUEVO: fábrica createCustomAgentModule({ role })
  lib/
    customAgentsRegistry.js   → NUEVO: registro en memoria + persistencia + alta/edición en caliente
  routes/
    departments.js            → MODIFICADO: + POST /:departmentId/agents,
                                              + PATCH /:departmentId/agents/:agentId,
                                              + GET/PUT /:departmentId/agents/:agentId/memory,
                                              + POST /:departmentId/agents/:agentId/memory/compress
  state/
    custom-agents.json         → NUEVO: lista persistida de trabajadores a la medida
    custom-agents/
      <agentId>-memoria.md      → NUEVO: memoria en texto plano, uno por trabajador
      <agentId>-notas.json      → NUEVO: notas del ciclo autónomo (solo si es autónomo), mismo
                                  patrón que ideasStore/prospectosStore: arreglo de {id, texto, creadoEn}
```

## El módulo de agente genérico

`backend/agents/customAgent.js` exporta `createCustomAgentModule({ role }) -> { runCycle, chat, describeSuccess }` —
una fábrica, porque cada trabajador a la medida tiene un `role` (el contexto/skill que
le dio el fundador) distinto.

**`chat({ message, contextPath, memoryPath, apiKey, model, createChatCompletion })`**
- Lee el contexto de negocio (`CONTEXTO-INTELEKIA.md`) y la memoria actual
  (`memoryPath`, vacía si no existe aún).
- Arma los mensajes: `role` (system) + contexto de negocio (system) + memoria previa
  (system, solo si no está vacía) + el mensaje del fundador (user).
- Llama al modelo, obtiene la respuesta.
- **Actualiza la memoria sola**: agrega al final del archivo
  `\n\nTú: <message>\nAgente: <respuesta>`.
- Retorna `{ reply }`.

**`runCycle({ contextPath, memoryPath, notesPath, apiKey, model, createChatCompletion })`**
(solo se invoca si el trabajador se creó como autónomo)
- Usa el contexto de negocio y las notas previas para pedirle al modelo una observación
  u sugerencia breve y accionable relevante ahora mismo, según su `role`.
- Guarda la nota en `notesPath` (mismo patrón que `ideasStore`/`prospectosStore`, pero
  genérico: un arreglo de `{id, texto, creadoEn}`).
- Retorna `{ notaCreada }`.

**`describeSuccess(result)`**
- Si hay `notaCreada`: `{ estatus: 'listo_para_revision', ultimaAccion: '...', ultimoItemId: notaCreada.id }`.
- Si no: `{ estatus: 'idle', ultimaAccion: 'Sin observaciones nuevas' }`.

## El registro de trabajadores a la medida

`backend/lib/customAgentsRegistry.js` expone
`createCustomAgentRegistry({ rootDir, customAgentsPath, contextPath, config, createChatCompletion, departments, agentRunners, chatHandlers, wrapRunCycle, statusPath })`,
que retorna:

- `createAgent({ departmentId, label, context, autonomous }) -> { id, label }` — crea el
  trabajador: genera un id único, lo agrega al departamento correspondiente dentro del
  arreglo `departments` **en memoria** (el mismo que ya usan `server.js` y
  `routes/departments.js`), lo registra en `chatHandlers` siempre y en `agentRunners`
  solo si es autónomo, y persiste la lista completa a `custom-agents.json`.
- `updateAgent(id, { label?, context?, autonomous? }) -> { id, label }` — actualiza lo que
  se le pase; si cambia `context`, reconstruye el módulo (`createCustomAgentModule`) sin
  tocar la memoria; si cambia `autonomous`, agrega o quita el trabajador de
  `agentRunners` según corresponda; persiste el cambio.
- `loadAllAtStartup()` — lee `custom-agents.json` (si existe) y registra cada trabajador
  en memoria, para que el estado sobreviva un reinicio del servidor.
- `getMemory(id) -> string`, `setMemory(id, content) -> void`,
  `compressMemory(id) -> Promise<string>` — leer, sobrescribir, o pedirle al modelo que
  resuma la memoria actual y reemplazarla con el resumen.

Como `chatHandlers`/`agentRunners`/`departments` son los mismos objetos/arreglos que ya
usan el scheduler y los routers (pasados por referencia, mutados en el lugar), un
trabajador creado o editado en caliente queda disponible de inmediato sin reiniciar nada.

## API nueva

```
POST   /api/departments/:departmentId/agents
  body: { label, context, autonomous }
  → 201 { id, label }

PATCH  /api/departments/:departmentId/agents/:agentId
  body: { label?, context?, autonomous? }
  → 200 { id, label }

GET    /api/departments/:departmentId/agents/:agentId/memory
  → 200 { content: string }

PUT    /api/departments/:departmentId/agents/:agentId/memory
  body: { content }
  → 200 { content: string }

POST   /api/departments/:departmentId/agents/:agentId/memory/compress
  → 200 { content: string }   (la memoria ya comprimida)
```

Validación: `label`/`context` no pueden venir vacíos al crear; `departmentId` debe
existir en el registro; `agentId` debe existir para editar/leer/escribir memoria.

`GET /api/departments` (ya existente) sigue sanitizando igual que antes — nunca expone
`deps` ni rutas de archivo — y automáticamente incluye cualquier trabajador a la medida
ya registrado, porque lee el mismo arreglo `departments` en memoria.

## Flujo de datos

```
[Fundador] ──crea trabajador──> POST /api/departments/comercial/agents
                              └─> customAgentsRegistry.createAgent(...)
                                  ├─> departments['comercial'].agents.push(nuevoAgente)
                                  ├─> chatHandlers['custom-...'] = ...
                                  ├─> (si autónomo) agentRunners['custom-...'] = wrapRunCycle(...)
                                  └─> persiste en custom-agents.json

[Fundador] ──chatea──> POST /api/agents/:id/chat
                     └─> customAgent.chat(...) ──lee+actualiza──> <id>-memoria.md

[Fundador] ──comprime──> POST /api/departments/:dept/agents/:id/memory/compress
                       └─> lee memoria actual ──LLM resume──> sobreescribe <id>-memoria.md
```

## Cómo se valida

- **Módulo genérico**: tests para `chat` (usa memoria si existe, la actualiza después),
  `runCycle` (genera y guarda una nota), `describeSuccess`.
- **Registro**: tests para `createAgent` (aparece en `departments`, en `chatHandlers`, y
  en `agentRunners` solo si autónomo; se persiste), `updateAgent` (cambia lo que se le
  pide, conserva memoria, mueve de/hacia `agentRunners` si cambia `autonomous`),
  `loadAllAtStartup` (reconstruye el estado desde el archivo persistido).
- **Rutas nuevas**: tests para las 5 rutas (crear, editar, leer/editar/comprimir
  memoria), incluyendo validación de campos vacíos y de ids inexistentes.
- **Validación en vivo**: crear un trabajador de prueba con un skill real, chatear dos
  veces seguidas y confirmar que la segunda respuesta refleja la primera (memoria
  funcionando), editar su contexto y confirmar que el chat cambia de comportamiento,
  comprimir su memoria y confirmar que el archivo se reemplaza por una versión corta.
