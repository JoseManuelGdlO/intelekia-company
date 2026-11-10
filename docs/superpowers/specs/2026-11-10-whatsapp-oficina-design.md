# Canal de WhatsApp de la oficina — diseño

Fecha: 2026-11-10

## Objetivo

El fundador le escribe a la oficina por WhatsApp (texto o audio). La oficina entiende a qué
trabajador va dirigido, se lo pasa y le contesta con el resultado. Además puede forzar ciclos,
recibir avisos de la bandeja ✋ Aprobaciones y aprobar/descartar desde WhatsApp. Si el mensaje
fue de audio, la respuesta también llega como nota de voz.

Fuera de alcance: otros usuarios (solo números permitidos), imágenes/documentos, grupos.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Conexión | WhatsApp Cloud API oficial de Meta; webhook público vía túnel (recomendado ngrok con dominio fijo gratuito) |
| Quién puede usarlo | Solo números en `WHATSAPP_PERMITIDOS`; el resto se ignora y se registra |
| Ruteo | Nombre del trabajador al inicio → directo; si no, IA elige trabajador y acción; si duda, pregunta; seguimiento 15 min con el último trabajador |
| Capacidades | Conversar (mismo chat del panel), forzar ciclo, avisos + aprobar/descartar pendientes, respuesta en audio si entró audio |
| Voz | OpenAI: transcripción (`gpt-4o-mini-transcribe`) y voz (`gpt-4o-mini-tts`, formato `opus`) |
| Ventana de 24 h | Avisos libres dentro de 24 h desde el último mensaje del fundador; fuera: plantilla si está configurada, si no se acumulan y se entregan al volver a escribir |

## Arquitectura

### Configuración (`.env` / `config.js` → `config.whatsapp`)
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_PERMITIDOS` (coma separada, formato internacional sin `+`, p. ej. `5218711234567`),
`WHATSAPP_PLANTILLA_AVISO` (opcional, plantilla con un parámetro numérico), `WHATSAPP_PLANTILLA_IDIOMA`
(por defecto `es_MX`), `WHATSAPP_API_VERSION` (por defecto `v21.0`), `WHATSAPP_VOZ` (por defecto `alloy`).

### `lib/whatsapp.js` — cliente de la Cloud API
- `estado()` → `{ ok }` o `{ ok:false, motivo }`.
- `enviarTexto(to, texto)` — parte en mensajes de ≤ 4000 caracteres (cortando en salto de línea o espacio).
- `enviarAudio(to, buffer, mime='audio/ogg')` — sube el archivo (`POST /{phone-id}/media`) y lo manda como audio.
- `enviarPlantilla(to, nombre, idioma, parametros)`.
- `descargarMedia(mediaId)` → `{ buffer, mime }` (`GET /{media-id}` y luego la URL con el token).
- `verificarFirma(rawBody, firmaCabecera)` → booleano (HMAC SHA-256 con `WHATSAPP_APP_SECRET`, comparación en tiempo constante).
- `extraerMensajes(payload)` → `[{ id, de, tipo:'texto'|'audio'|'otro', texto, mediaId, fecha }]` (ignora `statuses`).
- Token por cabecera `Authorization: Bearer`; timeout 20 s; errores `WhatsApp: …`.

### `lib/voz.js` — OpenAI
- `transcribir(buffer, mime)` → texto (`POST /v1/audio/transcriptions`, multipart, modelo `gpt-4o-mini-transcribe`, idioma `es`).
- `sintetizar(texto)` → `Buffer` Ogg/Opus (`POST /v1/audio/speech`, `gpt-4o-mini-tts`, `response_format: 'opus'`, voz configurable). Texto recortado a 1500 caracteres.

### `lib/recepcionWhatsapp.js` — lógica del canal (sin Express)
`createRecepcionWhatsapp({ whatsapp, voz, estadoPath, agentes, chatDe, forzarCiclo, aprobaciones, enrutarConIA, labelOf, registrar, plantilla, now })`
- `agentes()` → `[{ id, label, rol }]` (rol resumido a 300 caracteres).
- `procesar(mensaje)`:
  1. Ignora números no permitidos (lo registra) y mensajes ya vistos (guarda últimos 500 ids).
  2. Actualiza `ultimoMensaje[de]` (ventana de 24 h). Si había avisos acumulados, primero los entrega.
  3. Audio → `descargarMedia` + `transcribir`; responde con lo entendido si falla.
  4. Comandos: `pendientes` | `aprobar N` | `descartar N` | `ayuda`.
  5. Ruteo: nombre al inicio (sin acentos/mayúsculas, por label completo o primera palabra si es única) →
     agente; si no, seguimiento (último agente < 15 min); si no, `enrutarConIA(texto, agentes)` →
     `{ agentId | null, accion: 'chat'|'forzar_ciclo', duda?: [ids] }`. Con duda → pregunta.
  6. Aviso `⏳ Se lo paso a <label>…`; ejecuta `chatDe(agentId, texto)` → respuesta, o
     `forzarCiclo(agentId)` → `ultimaAccion`.
  7. Responde `*<label>:* <texto>`; si el mensaje fue audio, además nota de voz (si la voz falla, solo texto).
- `avisarAprobacion(item)`: asigna número corto; dentro de 24 h manda el aviso; fuera de 24 h manda la
  plantilla (una vez por ventana) si existe, y siempre acumula el aviso para entregarlo al volver a escribir.
- Estado persistente en `backend/state/whatsapp.json` (ignorado en git): `ultimoMensaje`, `vistos`,
  `numeros` (n → id de aprobación), `siguienteNumero`, `colaAvisos`, `ultimoAgente`, `plantillaEnviadaEn`.
  Escritura atómica; archivo dañado → respaldo `.corrupto-<ms>` y estado vacío.
- Números cortos: se reutilizan desde 1 cuando ya no hay pendientes abiertos.

### Enrutador con IA (`enrutarConIA`)
Llamada al modelo sin herramientas (`ajustarHerramientas` vacío, `sinMemoria: true`) con la lista de
trabajadores (id, nombre, rol resumido) y el mensaje; responde solo JSON
`{"agentId": "...|null", "accion": "chat|forzar_ciclo", "duda": ["id1","id2"]}`. JSON inválido o id
desconocido → pregunta al fundador con la lista de trabajadores.

### `routes/whatsapp.js`
- `GET /webhook/whatsapp`: verificación de Meta (`hub.mode=subscribe`, `hub.verify_token`, devuelve `hub.challenge`).
- `POST /webhook/whatsapp`: verifica firma con el cuerpo crudo; responde 200 de inmediato y procesa en
  segundo plano cada mensaje (`recepcion.procesar`), sin bloquear.
- `GET /api/whatsapp/estado`: `{ configurado, permitidos (enmascarados), ventanaAbierta }` para la oficina.
- `server.js`: `express.json({ verify })` guarda `req.rawBody`; la bandeja de aprobaciones avisa a la
  recepción al crear un pendiente (`aprobaciones.suscribir(fn)`).

### Cambios en módulos existentes
- `lib/aprobaciones.js`: `suscribir(fn)` — llama a `fn(item)` tras cada `proponer` (errores del listener no rompen).
- `scheduler.runOne(agentId)` ya existe y devuelve el resultado del ciclo; el estado final se lee de `agents-status.json`.

## Errores
- Sin configuración: el webhook responde 200 pero no procesa; `/api/whatsapp/estado` dice qué falta.
- Fallo de un trabajador, transcripción, voz o envío: mensaje `⚠️ No pude …: <motivo>`; si falla la voz, solo texto.
- Firma inválida → 401 y registro; número no permitido → ignorado y registro; duplicados → ignorados.
- Forzar ciclo de un agente que ya está corriendo → `⚠️ Ese trabajador ya está en su ciclo; intenta en un momento`.

## Pruebas (`node:test`, Meta y OpenAI simulados)
`whatsapp` (envío partido, audio, plantilla, descarga, firma, extracción de mensajes), `voz` (peticiones
correctas, recorte), `recepcionWhatsapp` (permitidos, duplicados, comandos, ruteo por nombre/IA/duda/seguimiento,
forzar ciclo, audio de ida y vuelta, voz que falla, avisos dentro/fuera de 24 h con y sin plantilla, números
cortos), rutas del webhook (verificación, firma, 200 inmediato), `aprobaciones.suscribir`.

## Validación en vivo (requiere al fundador)
1. App en developers.facebook.com con el producto WhatsApp; número de la oficina; token permanente de
   usuario del sistema con `whatsapp_business_messaging` y `whatsapp_business_management`.
2. ngrok con dominio fijo apuntando al puerto de la oficina; en Meta configurar el webhook
   `https://<dominio>/webhook/whatsapp` con el verify token y suscribir `messages`.
3. Variables en `backend/.env`, reiniciar, mandar texto, audio, `pendientes`, `aprobar N`, forzar ciclo.
