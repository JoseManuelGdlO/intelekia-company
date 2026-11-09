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

---

# Herramienta: consultar la base de datos (solo lectura)

Pestaña **🔌 Herramientas** del editor de perfil: se activa por agente
(`herramientas.baseDatos` en `backend/state/perfiles.json`). Con ella, el agente recibe la
herramienta `consultar_base_datos(sql, motivo)` en su ciclo autónomo y en el chat, con el
esquema visible (tablas permitidas, sin columnas bloqueadas) en la descripción. Puede hacer
hasta 6 rondas de consultas por tarea.

Conexión: variables `DB_*` en `backend/.env` (ver `.env.example`). `DB_ALLOWED_TABLES` y
`DB_BLOCKED_COLUMNS` definen qué puede ver.

Tres capas de protección:
1. `lib/sqlGuard.js`: una sola sentencia SELECT/WITH, sin comentarios, sin palabras de
   escritura o administración, solo tablas permitidas, sin esquemas del sistema, sin
   columnas bloqueadas y sin `SELECT *`.
2. `lib/database.js`: cada consulta corre en `START TRANSACTION READ ONLY` con
   `MAX_EXECUTION_TIME` de 8 s y `ROLLBACK`; resultados recortados a 200 filas y 500
   caracteres por celda; bitácora en `backend/state/consultas-bd.json`.
3. Usuario MySQL con permisos SELECT únicamente (recomendado; el servidor advierte si
   `DB_USER` es root).

API: `GET /api/base-datos/estado`, `POST /api/base-datos/probar`,
`GET /api/base-datos/consultas?agentId=`.

---

# Seguimiento / CRM → Seguimiento de Proyectos

El agente `seguimiento-crm` (mismo id, para conservar estatus, reglas y perfil) cambió de
propósito: ya no redacta mensajes a prospectos ni toca `prospectos.json`.

- **Ciclo autónomo**: genera un reporte de seguimiento consultando la base de proyectos con
  `consultar_base_datos` y lo guarda en
  `departamentos/comercial/content/reportes-seguimiento/reporte-AAAA-MM-DD-HHmm.md` (hora de
  Durango). Recibe el reporte anterior para señalar qué cambió. Estatus `listo_para_revision`
  con la primera línea del Resumen como última acción.
- Si el agente no tiene activada la herramienta de base de datos, responde `SIN_ACCESO_BD`:
  no se guarda nada y la última acción indica cómo activarla (nunca inventa un reporte).
- **Chat**: preguntas libres sobre proyectos; recibe el último reporte como referencia y
  consulta la base si necesita datos actuales. Ya no edita archivos.
- Como `reportesDir` está en sus deps, los compañeros que lo consultan ven sus últimos reportes.
- Los mensajes previos en `content/seguimientos/` se conservan; los prospectos "nuevo" ya no
  reciben mensaje automático.

---

# Área de Administración y PM (seguimiento de los agentes de IA)

Nueva área `administracion` con el agente base `pm` (rol en
`departamentos/administracion/agentes/pm.md`, editable desde ✏️ Editar).

- **Panorama real del equipo** (`lib/teamSnapshot.js`): por cada agente (menos el propio PM),
  estatus, horas sin actualizar, última acción, error, conversaciones de las últimas 24 h,
  a cuántos compañeros puede consultar, skills activas, si tiene la base de datos activada y
  sus consultas con error. `server.js` lo conecta en `deps.getTeamSnapshot`.
- **Ciclo autónomo**: con ese panorama (y el reporte anterior) escribe un reporte del equipo
  en `departamentos/administracion/content/reportes-equipo/reporte-equipo-AAAA-MM-DD-HHmm.md`.
  Al ser la última área, el scheduler lo corre después de los demás agentes.
- **Chat**: responde sobre el estado del equipo con el panorama actual y su último reporte.
- **Comunicación**: los agentes pueden declarar `comunicacionPorDefecto` en `departments.js`;
  el PM declara `todos`, así puede preguntarle a cualquier agente sin configurar nada. Se
  puede cambiar en el editor de Comunicación ("Aplicar a todos" también le aplica).
- El PM solo observa y consulta: no fuerza ciclos ni modifica a otros agentes.

---

# Herramienta: enviar correo (SMTP, Hostinger)

Segunda herramienta en **🔌 Herramientas** (`herramientas.correo`). El agente recibe
`enviar_correo(para[], cc[], asunto, cuerpo)`.

- **Credenciales** en `backend/.env`: `SMTP_HOST` (Hostinger: `smtp.hostinger.com`),
  `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`,
  `SMTP_REPLY_TO` (opcional) y `SMTP_FIRMA` (por defecto aclara que lo envía un asistente de IA).
- **Lista blanca y límite diario** editables en la app (`backend/state/correo.json`), compartidos
  por todos los agentes: correos exactos o dominios completos (`@intelekia.cloud`; no incluye
  subdominios ni dominios que solo terminen igual).
- **Reglas de envío** (`lib/correo.js`): si todos los destinatarios (incluido CC) están en la
  lista y no se rebasa el límite diario (20 por defecto), se envía directo; si no, queda
  `por_aprobar`. Se rechazan duplicados (mismo destinatario y asunto en 12 h), más de 10
  destinatarios y correos inválidos; el asunto se limpia de saltos de línea.
- **Bandeja "✉️ Por aprobar"** en la barra superior (aparece solo si hay pendientes): el
  fundador edita para/CC/asunto/mensaje y envía, o descarta. Los correos también aparecen en
  el feed de actividad y en el historial del agente.
- Bitácora en `backend/state/correos.json` (últimos 300).

API: `GET /api/correo/estado`, `PUT /api/correo/config`, `POST /api/correo/probar`,
`GET /api/correo/correos?estado=&agentId=`, `POST /api/correo/correos/:id/aprobar`,
`POST /api/correo/correos/:id/descartar`.

---

# Flujo: tickets atrasados → PM → correo a cada responsable

Al **iniciar cada ciclo de Seguimiento de Proyectos** (`deps.notificarAtrasados`, conectado en
`server.js` a `lib/atrasados.js`):

1. Consulta FIJA en código (`SQL_ATRASADOS`, vía `database.queryInterna`, sin pasar por la IA):
   tickets no entregados cuya fecha (de calendario, guardada a las 00:00) ya pasó en Durango,
   de proyectos "trabajando" o "parado", con responsable y su email. Agrupa por responsable;
   los que no tienen responsable se cuentan aparte.
2. Se registra como conversación Seguimiento → PM (rayo en la oficina 3D y feed).
3. El PM envía un correo por responsable con plantilla fija, p. ej.:
   "Hola Javier Karim, Tienes tres tickets atrasados: 1. [TLO] … — Por revisar — venció el
   31/10/2026 (7 días de atraso) …". Asunto: "Tickets atrasados al DD/MM/AAAA — N pendientes".
   Pasa por `mailer.enviar`, así que aplica la lista blanca (fuera de ella → por aprobar),
   el límite diario y la firma.
4. Máximo un aviso por persona por día (aunque el ciclo corra cada 6 h).
5. Resultado en la última acción del PM y de Seguimiento, en su memoria y en la conversación.

Requisitos (si falta alguno, no se envía nada y la última acción lo explica):
Seguimiento con **Base de datos** activa, permiso de **Comunicación** Seguimiento → PM, y el
PM con **Correo** activo. Si el usuario MySQL es de solo lectura con permisos por columna,
debe incluir `Users.email`: `GRANT SELECT (id, name, role, email) ON \`admin-intelekia\`.Users …`.

**Copia oculta:** `SMTP_BCC` (una o varias direcciones separadas por coma) recibe una copia
oculta de cada correo enviado por los agentes, incluidos los aprobados desde la bandeja. No
cuenta para la lista blanca ni para el límite diario. Los correos enviados por SMTP no se
guardan en la carpeta "Enviados" del buzón; esta copia es el registro en el correo.

---

# Bitácora de actividad y fechas

- `lib/actividad.js`: por agente, últimos 150 pasos con fecha y hora (`backend/state/actividad.json`).
  Tipos: inicio, pensando, nota, herramienta, resultado, chat, respuesta, fin, error.
- Se registran: inicio/fin/error de cada ciclo (`conActividad` en `server.js`, también para
  trabajadores a la medida), cada mensaje del fundador (`routes/agents.js`), cada ronda del
  modelo, la frase con la que el agente explica qué va a hacer antes de usar una herramienta
  (se le pide en las instrucciones), cada herramienta con su detalle (SQL, cuerpo del correo) y
  su resultado, las consultas que le hacen sus compañeros y el flujo de tickets atrasados.
  No es el razonamiento interno del modelo (no está disponible), sino sus pasos y decisiones.
- `GET /api/agents/:id/actividad?desde=ISO&limite=`. El panel del agente la consulta cada 1.5 s
  mientras está abierto (sección "🧠 Actividad", lo más reciente arriba, "● EN VIVO" mientras trabaja).
- Fecha y hora en mensajes del chat, conversaciones con compañeros y feed (hoy/ayer/DD-MM).

# Ciclo automático por agente

- `scheduler.js` revisa cada minuto qué agentes cumplieron su intervalo y los ejecuta de uno en
  uno; guarda la última ejecución en `backend/state/ciclos.json` (sobrevive reinicios). Un agente
  nuevo empieza a contar desde que se ve por primera vez. "Forzar ciclo" reinicia su contador.
- Intervalo de cada agente (`profiles.cicloOf`): el propio editado en la app (✏️ Editar → Rol y
  contexto → ⏱️ Ciclo automático, en horas; 0 = no corre solo), si no el de `departments.js`
  (`cicloHoras`: Buscador de Tendencias 6 h, Seguimiento de Proyectos 24 h), si no el general
  `AGENT_INTERVAL_HOURS`.
- `GET /api/agents/ciclos`: intervalo, última y próxima ejecución; el panel muestra "⏱️ Próximo ciclo".

## Skills y plugins instalables (desde internet)

- **Skill** = carpeta de GitHub con `SKILL.md` (formato Agent Skills, p. ej. `anthropics/skills`). Se descargan
  `SKILL.md` y sus archivos de texto a `backend/state/instalados/skills/<id>/`. Al agente se le entrega el cuerpo
  del `SKILL.md` y puede leer los archivos de apoyo con la herramienta `leer_archivo_skill`. Scripts no se ejecutan.
- **Plugin** = servidor MCP: remoto por URL (Streamable HTTP) o paquete npm lanzado con `npx -y`. Al instalarlo
  se conecta y se guardan sus herramientas; cada una se expone al agente como función `mcp_<plugin>__<tool>`.
- Catálogo compartido en `backend/state/instalados/instalados.json`; cada agente elige cuáles usa
  (`perfiles.json → instalados: { skills, plugins }`). UI: ✏️ Editar → 🧩 Skills y plugins → 📦 Instalados.
- API: `GET /api/instalables`, `POST /skills {url}`, `DELETE /skills/:id`, `POST /plugins {nombre, url|paquete, args}`,
  `POST /plugins/:id/probar`, `DELETE /plugins/:id`.
- Límites: solo github.com, 40 archivos / 200 KB c/u / 1 MB total; resultados de plugin recortados a 12 000 caracteres;
  60 s por conexión/llamada. Plugins con API key todavía no soportados (no se guardan secretos en `state/`, que está en git).
