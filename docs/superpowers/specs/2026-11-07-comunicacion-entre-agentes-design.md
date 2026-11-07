# Comunicación entre agentes (quién puede consultar a quién)

## Contexto y motivación

Los agentes de cada departamento trabajaban aislados: el Publicador no sabía qué
prospectos encontró Comercial y el Cotizador no sabía qué temas generan interés en
redes. El fundador quiere que los trabajadores se consulten entre sí, dentro de su área
y con otras áreas, y poder definir exactamente quién puede hablar con quién.

## Modelo de permisos

- Las reglas son **dirigidas**: dicen a quién puede consultar un agente. Que A pueda
  consultar a B no implica que B pueda consultar a A.
- Cada agente tiene un `alcance`:
  - `nadie`: no consulta a nadie.
  - `area`: solo a compañeros de su departamento.
  - `todos`: a cualquier agente de cualquier departamento.
  - `personalizado`: solo a los ids listados en `permitidos` (de cualquier área).
- Los agentes sin regla propia (incluidos los trabajadores a la medida que se creen
  después) usan `porDefecto`, que inicia en `area`.
- Se guardan en `backend/state/comunicacion.json`:

```json
{
  "porDefecto": "area",
  "reglas": {
    "publicador": { "alcance": "personalizado", "permitidos": ["buscador-prospectos", "cotizador"] }
  }
}
```

Los cambios aplican en caliente: cada llamada al modelo vuelve a leer las reglas.

## Cómo se comunican

- `lib/colleagues.js` expone `completionFor(agentId)`, con la misma firma que
  `createChatCompletion`. `server.js` y el registro de trabajadores a la medida lo
  inyectan en los `deps` de cada agente, así que los 5 agentes core y los trabajadores
  a la medida pueden consultar compañeros sin cambiar su código, tanto en el ciclo
  autónomo como en el chat.
- Si el agente tiene compañeros permitidos, el modelo recibe la herramienta
  `consultar_companero(agente_id, pregunta)` (function calling de OpenAI), cuyo `enum`
  contiene solo los ids permitidos. Además, cada consulta se vuelve a validar en el
  servidor: una consulta no permitida se rechaza y se le informa al modelo.
- El compañero consultado responde con su rol, el contexto de negocio y un resumen de
  sus datos de trabajo (archivos `*Path` y los 3 entregables más recientes de sus
  `*Dir`). Nunca se comparten la memoria privada ni la API key.
- Profundidad 1: quien responde no puede, a su vez, consultar a otros. Hay un máximo de
  3 rondas de consultas por llamada; después se pide la respuesta final sin herramientas.
- Cada conversación se registra en `backend/state/conversaciones.json` (últimas 200),
  con estado `en_curso`, `completada` o `error`.

## API

- `GET /api/comunicacion`: `porDefecto`, regla efectiva y lista de permitidos por agente.
- `PUT /api/comunicacion/reglas/:agentId` `{ alcance, permitidos? }` (`alcance: "heredar"`
  borra la regla propia).
- `PUT /api/comunicacion/por-defecto` `{ alcance, aplicarATodos? }`.
- `GET /api/comunicacion/conversaciones?desde=ISO&agentId=&limite=`.

## Frontend

- Botón **Comunicación** que abre una matriz: filas = quién consulta, columnas = a quién;
  regla por fila, botones "aplicar a todos" y valor por defecto.
- "Ver la red en la oficina 3D": arcos punteados entre los agentes permitidos (color del
  área si es la misma, verde Intelekia entre áreas) con flechas de dirección.
- Conversaciones en vivo (consulta cada 2 s): arco brillante con un mensaje que viaja
  entre las dos personas, que se voltean a ver; etiquetas "Consultando a…" /
  "Respondiendo a…"; feed de actividad y el historial en el panel de cada agente.

## Fuera de alcance

- Que los agentes se deleguen tareas o modifiquen los archivos de otros (solo consultan).
- Cadenas de consultas de más de un nivel.
- Notificaciones en tiempo real por WebSockets (se usa sondeo).

---

# Perfil editable de cada agente (rol, skills/plugins y memoria)

Botón **✏️ Editar** en el panel de cualquier agente, base o a la medida, con tres pestañas:

- **Rol y contexto**: en agentes base reescribe su archivo `departamentos/<área>/agentes/<id>.md`
  (aplica desde su siguiente tarea porque cada agente relee su rol en cada llamada); en
  trabajadores a la medida edita su `context`, nombre y si es autónomo (vía el registro).
  El nombre de los agentes base vive en `backend/departments.js` y no se edita desde aquí.
- **Skills y plugins**: lista de bloques `{ tipo: skill | plugin | documento, nombre,
  contenido, activo }` en `backend/state/perfiles.json` (máx. 20 000 caracteres cada uno).
  Se pueden pegar o cargar desde archivos `.md/.txt/.json`. Son **texto de referencia**: el
  agente los sigue como instrucciones, no se ejecuta código.
- **Memoria**: ver, editar, recargar y comprimir. Agentes base: `backend/state/memorias/<id>-memoria.md`;
  trabajadores a la medida: su archivo de memoria existente.

`lib/agentProfiles.js` expone `decorate(agentId, messages)`, que el envoltorio de compañeros
(`colleagues.completionFor`) aplica a toda llamada al modelo: inyecta las skills activas y,
para agentes base, las últimas ~4 000 letras de su memoria (los trabajadores a la medida ya
inyectan su memoria en su chat). Se escribe en memoria: chats del fundador con agentes base,
el resultado de cada ciclo autónomo de agentes base y cada consulta entre compañeros (en
ambos lados).

API: `GET/PUT /api/perfiles/:agentId`, `GET/PUT /api/perfiles/:agentId/memoria`,
`POST /api/perfiles/:agentId/memoria/comprimir`.
