# Generalización multi-departamento + Departamento Comercial

## Contexto y motivación

El prototipo de la Oficina de Marketing (ver
`docs/superpowers/specs/2026-11-06-oficina-marketing-3d-design.md`) validó la idea
completa de punta a punta: un cuarto 3D con agentes de IA que trabajan de forma
autónoma y reactiva, expuestos por un backend Node.js y visibles en una escena
Three.js. Esa implementación hardcodea los 2 agentes de Marketing (`buscador-tendencias`,
`publicador`) directamente en `backend/server.js` y en el frontend (`frontend/src/main.js`,
`frontend/src/scene.js`, `frontend/src/ui.js`).

Ahora se va a agregar el departamento Comercial (3 agentes nuevos), y después de este
vendrán más (Desarrollo, Producto/IA, Soporte, Administración). Agregar cada
departamento a mano, duplicando el código de `server.js` y `scene.js`, se vuelve
insostenible rápidamente. Este spec cubre dos cosas, en orden:

1. **Generalizar** el backend y el frontend para soportar N departamentos con N
   agentes cada uno, mediante un registro declarativo, migrando Marketing al nuevo
   esquema sin cambiar su comportamiento observable.
2. **Agregar Comercial** como el segundo departamento — la prueba de que la
   generalización funciona — con 3 agentes nuevos: Buscador de Prospectos,
   Seguimiento/CRM y Cotizador.

Los demás departamentos (Desarrollo, Producto/IA, Soporte, Administración) quedan
fuera de alcance de este spec; se agregarán después, reutilizando lo que aquí se
construye.

## Alcance

### Parte 1 — Generalización

- Cada módulo de agente exporta exactamente `{ runCycle, chat, describeSuccess }`.
  `describeSuccess` se mueve desde `backend/server.js` (donde hoy vive a mano para
  cada uno de los 2 agentes de Marketing) hacia cada módulo de agente.
- Un nuevo archivo `backend/departments.js` arma declarativamente la lista completa
  de departamentos y sus agentes (con sus `deps`: rutas de archivo, API key, modelo).
- `backend/server.js` deja de construir `agentRunners`/`chatHandlers` a mano para 2
  agentes — itera sobre lo que `departments.js` le entrega.
- Nuevo endpoint `GET /api/departments` que expone `id`/`label` de cada departamento
  y sus agentes — nunca `deps` ni la API key.
- Un **contrato uniforme de chat** para todos los agentes, presentes y futuros:
  `sendChat(agentId, { message, guardar, itemId })`.
  - `guardar`: agentes tipo "buscador" (Buscador de Tendencias, Buscador de
    Prospectos) lo usan para decidir si la respuesta del chat se guarda como un
    item nuevo.
  - `itemId`: agentes tipo "redactor" (Publicador, Seguimiento/CRM, Cotizador) lo
    usan para saber qué borrador están editando. Se lee de
    `status[agentId].ultimoItemId` — campo genérico que reemplaza al específico
    `ultimoIdeaId` que tenía el Publicador.
- El frontend dejar de tener arreglos de agentes/labels hardcodeados
  (`AGENTS`, `AGENT_LABELS`) — los obtiene de `GET /api/departments`.
- `frontend/src/scene.js` genera un "cuarto" (piso) por departamento, colocados en
  fila a lo largo del eje X, con los agentes de cada cuarto repartidos según cuántos
  tenga (ya no una posición fija para exactamente 2 agentes).
- Migración de Marketing al nuevo esquema sin cambiar su comportamiento observable:
  los 34 tests existentes deben seguir pasando (ajustados solo donde el renombre de
  `ultimoIdeaId` a `ultimoItemId` lo requiera).

### Parte 2 — Departamento Comercial

Tres agentes nuevos, todos con ciclo autónomo + chat reactivo:

**Buscador de Prospectos**
- Autónomo: lee `CONTEXTO-INTELEKIA.md` + `prospectos.json` existente, pide entre 3
  y 5 prospectos nuevos (negocio, giro, por qué encaja con lo que ofrece Intelekia),
  evitando duplicar prospectos ya sugeridos, los agrega con `estatus: "nuevo"`.
- Reactivo: preguntas libres sobre prospección; si `guardar` es true, la respuesta
  se agrega como un prospecto nuevo.

**Seguimiento / CRM**
- Autónomo: toma el primer prospecto con `estatus: "nuevo"`, redacta un mensaje de
  contacto inicial, lo guarda en `content/seguimientos/`, marca ese prospecto como
  `"contactado"`.
- Reactivo: ajusta el mensaje de seguimiento de un prospecto específico, identificado
  por `itemId`.

**Cotizador**
- Autónomo: mantiene una biblioteca de cotizaciones tipo. Lee una lista fija de
  servicios desde `departamentos/comercial/content/servicios.json`; por cada
  servicio sin una cotización plantilla existente en `content/cotizaciones-tipo/`,
  genera una y la guarda.
- Reactivo: el fundador describe un cliente real; el Cotizador arma una cotización
  personalizada, opcionalmente partiendo de una plantilla (`itemId`) o desde cero.

## Arquitectura y stack

```
backend/
  departments.js              → arma la lista de departamentos/agentes con sus deps
  server.js                   → itera sobre departments.js, ya no hardcodea agentes
  routes/
    agents.js                 → sin cambios de contrato (status/chat/forzar genéricos)
    departments.js            → NUEVO: GET /api/departments (sanitizado, sin deps/apiKey)
  lib/
    ideasStore.js             → sin cambios (ya existente, usado por Marketing)
    prospectosStore.js        → NUEVO: mismo patrón que ideasStore.js, para prospectos
  agents/
    buscadorTendencias.js     → se agrega describeSuccess exportado
    publicador.js             → se agrega describeSuccess exportado; ultimoIdeaId -> ultimoItemId
    buscadorProspectos.js     → NUEVO
    seguimientoCRM.js         → NUEVO
    cotizador.js              → NUEVO

departamentos/
  marketing/                  → sin cambios de contenido
  comercial/
    agentes/
      buscador-prospectos.md
      seguimiento-crm.md
      cotizador.md
    content/
      prospectos.json
      servicios.json
      seguimientos/
      cotizaciones-tipo/

frontend/
  src/
    api.js                    → se agrega fetchDepartments()
    scene.js                  → createScene recibe `departments`, genera N cuartos
    ui.js                     → labels vienen de departments, ya no AGENT_LABELS fijo
    main.js                   → arranca pidiendo /api/departments, contrato uniforme de chat
```

## Contrato de agente (generalización)

Todo módulo de agente exporta:

```js
module.exports = { runCycle, chat, describeSuccess };
```

- `runCycle(deps) -> Promise<result>` — igual que antes.
- `chat({ message, guardar, itemId, ...deps }) -> Promise<{ reply, ... }>` — mismo
  shape de entrada para todos los agentes; cada uno usa lo que le sirve e ignora el
  resto.
- `describeSuccess(result) -> statusPatch` — la lógica de qué estatus/ultimaAccion
  poner tras un ciclo autónomo exitoso, antes vivía a mano en `server.js` para cada
  agente de Marketing; ahora vive junto al agente que la produce.

## El registro de departamentos

`backend/departments.js` expone `buildDepartments({ rootDir, config, createChatCompletion })`
que retorna:

```js
[
  {
    id: 'marketing',
    label: 'Marketing',
    agents: [
      { id: 'buscador-tendencias', label: 'Buscador de Tendencias', module: <buscadorTendencias>, deps: {...} },
      { id: 'publicador', label: 'Publicador', module: <publicador>, deps: {...} },
    ],
  },
  {
    id: 'comercial',
    label: 'Comercial',
    agents: [
      { id: 'buscador-prospectos', label: 'Buscador de Prospectos', module: <buscadorProspectos>, deps: {...} },
      { id: 'seguimiento-crm', label: 'Seguimiento / CRM', module: <seguimientoCRM>, deps: {...} },
      { id: 'cotizador', label: 'Cotizador', module: <cotizador>, deps: {...} },
    ],
  },
]
```

`server.js` recorre esta lista para construir `agentRunners` (con `wrapRunCycle`,
usando el `describeSuccess` del propio módulo) y `chatHandlers` (uno por agente,
mismo contrato), sin importar cuántos departamentos/agentes haya.

`routes/departments.js` expone `GET /api/departments`, que retorna la misma
estructura pero **sin** `module` ni `deps` — solo `id`/`label` por departamento y por
agente. Esto es lo que consume el frontend.

## Flujo de datos

```
[departments.js] ──arma──> lista de departamentos/agentes con deps

[server.js] ──itera──> agentRunners (wrapRunCycle genérico, describeSuccess de cada módulo)
                    └─> chatHandlers (uno por agente, mismo contrato {message, guardar, itemId})

[scheduler] ──cada X horas──> corre TODOS los agentRunners registrados

[Frontend] ──al cargar──> GET /api/departments ──> arma N cuartos con sus agentes
          ──clic en avatar──> GET /api/agents/status
          ──chat──> POST /api/agents/:id/chat { message, guardar, itemId }
          ──forzar──> POST /api/agents/:id/forzar

Comercial específicamente:
  Buscador de Prospectos ──> prospectos.json (estatus: nuevo)
  Seguimiento/CRM        ──> toma 1er "nuevo" ──> content/seguimientos/*.md (estatus: contactado)
  Cotizador              ──> servicios.json ──> content/cotizaciones-tipo/*.md (uno por servicio)
```

## Frontend: múltiples cuartos

- `scene.js` recibe `departments` (la respuesta de `/api/departments`) en vez de un
  arreglo plano `agents`. Por cada departamento arma un piso rectangular, colocados
  en fila a lo largo del eje X con separación fija entre ellos.
- Dentro de cada cuarto, los agentes se reparten en una fila cuyo ancho depende de
  cuántos agentes tenga ese departamento (ya no una posición fija para 2).
- La cámara arranca más alejada/elevada que en el prototipo de Marketing, para que
  ambos cuartos sean visibles desde el inicio. Navegación con drag (rotar) y pan
  (clic derecho o dos dedos) vía OrbitControls — sin cambio de cámara automático
  entre cuartos en esta fase.
- `ui.js` obtiene los labels de agentes desde la respuesta de `/api/departments` en
  vez de un objeto `AGENT_LABELS` fijo.
- `main.js` construye el payload de chat de forma genérica para cualquier agente:
  `{ message, guardar: checkboxState, itemId: latestStatus[agentId]?.ultimoItemId }`.

## Manejo de errores

- Igual que en Marketing: si falla `createChatCompletion`, el agente pasa a estatus
  `error` con el mensaje de la excepción; el scheduler reintenta en el siguiente
  ciclo.
- `GET /api/departments` nunca debe exponer `apiKey` ni rutas de archivo del
  servidor — un test cubre explícitamente esto.
- Si el chat de un agente "redactor" recibe un `itemId` inválido o faltante,
  responde con un error claro (mismo patrón ya usado por el Publicador de
  Marketing).

## Fuera de alcance

- Los departamentos de Desarrollo, Producto/IA, Soporte y Administración.
- Navegación de cámara automática entre cuartos.
- Cualquier integración real de CRM (HubSpot, Pipedrive, etc.) — `prospectos.json`
  es la única fuente de datos de prospectos.
- Publicación o envío automático de mensajes de seguimiento — el Seguimiento/CRM
  solo redacta el mensaje; el fundador lo envía manualmente (mismo criterio que el
  Publicador de Marketing con las redes sociales).

## Cómo se valida

- **No regresión en Marketing**: los 34 tests existentes deben seguir pasando
  (ajustados solo donde el renombre `ultimoIdeaId` → `ultimoItemId` lo requiera).
  Validación en vivo repetida (forzar ambos agentes de Marketing, chat reactivo) para
  confirmar que el comportamiento observable no cambió.
- **Backend nuevo**: tests unitarios para `prospectosStore.js`; para los 3 agentes
  de Comercial (`runCycle`, `chat`, `describeSuccess`); para `departments.js` (arma
  la lista completa con los `deps` correctos para cada agente); para
  `routes/departments.js` (nunca expone `apiKey` ni rutas de archivo).
- **Validación en vivo de Comercial**: forzar cada uno de los 3 agentes nuevos con
  la API key real y confirmar que producen prospectos/cotizaciones/seguimientos
  reales en disco.
- **Frontend**: abrir la escena y confirmar que aparecen 2 cuartos (Marketing con 2
  personajes, Comercial con 3), y que cada agente responde correctamente a
  clic/chat/forzar.
