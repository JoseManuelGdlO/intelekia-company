# Switch "Autónomo", bandeja de aprobaciones y trabajador "Respuestas en Redes" — diseño

Fecha: 2026-11-09

## Objetivo

1. **Switch "Autónomo" por trabajador**: encendido, el trabajador ejecuta sus acciones solo;
   apagado (supervisado), toda acción que proponga va a una bandeja de aprobación.
2. **Bandeja de aprobaciones general**: un solo lugar donde el fundador aprueba, edita y aprueba,
   o descarta lo que proponen los trabajadores.
3. **Trabajador "Respuestas en Redes"** (Marketing): vigila los comentarios en la página de
   Facebook y la cuenta de Instagram Business de Intelekia y los contesta usando la API de Meta.
   Es el primer trabajador que usa el switch y la bandeja.

Fuera de alcance de esta entrega: conectar los demás trabajadores (PM/correos, Revisor de PRs,
Publicador…) al switch; mensajes directos (DM); comentarios en anuncios pagados; migrar la
bandeja de correos a la bandeja general.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Autonomía | Switch por trabajador: `autonomia: 'autonomo' \| 'supervisado'` en su perfil; por defecto `supervisado` |
| Lo escalado | Siempre va a la bandeja, aunque el trabajador sea autónomo |
| Conexión con Meta | Graph API directa desde código (`lib/meta.js`), token de página en `.env`; la IA solo redacta |
| Frecuencia | Ciclo cada ~10 min (`cicloHoras: 0.17`, editable), ciclos sin novedades silenciosos |
| Primer arranque | Solo comentarios de los últimos 3 días |
| Tope | Máximo 20 comentarios por ciclo |

## Arquitectura

### A. Switch "Autónomo" (`lib/agentProfiles.js`)

- Nuevo campo en el perfil: `autonomia` con valores `autonomo` | `supervisado` (por defecto
  `supervisado`). Se lee con `profiles.autonomiaOf(agentId)` y se guarda con `updateProfile`.
- No confundir con el `autonomous` existente de los trabajadores a la medida (que decide si
  corren ciclos solos).
- Frontend: en ✏️ Editar → Rol y contexto, un switch "🤖 Autónomo: actúa solo / ✋ Supervisado:
  todo lo manda a aprobación".

### B. Bandeja de aprobaciones (`lib/aprobaciones.js`, `routes/aprobaciones.js`)

- Store en `backend/state/aprobaciones.json` (ignorado en git). Cada elemento:
  `{ id, agentId, tipo, titulo, propuesta, contexto, estado, motivo, creadoEn, resueltoEn, error }`
  con `estado` ∈ `por_aprobar` | `aprobado` | `descartado` | `error`.
- `registrarEjecutor(tipo, fn)`: cada tipo de acción registra cómo se ejecuta al aprobarse.
  Primer tipo: `responder_comentario`.
- `proponer({ agentId, tipo, titulo, propuesta, contexto, motivo })` → crea `por_aprobar`.
- `aprobar(id, { propuesta })` (opcionalmente editada) → ejecuta con el ejecutor del tipo;
  `aprobado` si funciona, `error` (con mensaje) si falla; se puede reintentar un `error`.
- `descartar(id)`.
- Rutas: `GET /api/aprobaciones?estado=`, `POST /api/aprobaciones/:id/aprobar`,
  `POST /api/aprobaciones/:id/descartar`.
- Frontend: botón "✋ Aprobaciones (N)" en la barra superior (como la bandeja de correos) que
  abre un modal con los pendientes: red, enlace a la publicación, comentario original con autor,
  respuesta propuesta editable, y botones Aprobar / Descartar.

### C. Acceso a Meta (`lib/meta.js`)

- Configuración en `.env` / `config.js`: `META_PAGE_TOKEN` (token de página de larga duración),
  `META_PAGE_ID`, `META_IG_USER_ID` (cuenta de Instagram Business vinculada a la página),
  `META_API_VERSION` (por defecto `v21.0`).
- Funciones (con `fetch` inyectable para pruebas):
  - `comentariosRecientes({ desde, maxPublicaciones = 10 })` → lista normalizada
    `{ id, red: 'facebook'|'instagram', texto, autor, autorId, creadoEn, publicacionId,
    publicacionTexto, permalink }` de las últimas publicaciones de la página y de la cuenta de IG.
    - Facebook: `GET /{page-id}/posts?fields=id,message,permalink_url&limit=N`, luego
      `GET /{post-id}/comments?fields=id,message,from,created_time&filter=toplevel&order=reverse_chronological`.
    - Instagram: `GET /{ig-user-id}/media?fields=id,caption,permalink&limit=N`, luego
      `GET /{media-id}/comments?fields=id,text,username,timestamp`.
    - Excluye comentarios escritos por la propia página o cuenta.
  - `responder({ red, comentarioId, mensaje })`:
    - Facebook: `POST /{comment-id}/comments` con `message`.
    - Instagram: `POST /{comment-id}/replies` con `message`.
  - `estado()` → si falta configuración, motivo claro.
- Una cuenta de IG o FB sin configurar simplemente se omite (se puede usar solo una red).

### D. Trabajador "Respuestas en Redes" (`agents/respuestasRedes.js`)

- Departamento Marketing, id `respuestas-redes`, `cicloHoras: 0.17`, `cicloSilencioso: true`.
- Rol en `departamentos/marketing/agentes/respuestas-redes.md`.
- Estado en `backend/state/comentarios-atendidos.json` (ignorado en git): ids de comentarios ya
  atendidos con su decisión y fecha, y la fecha de la última revisión.
- **Ciclo:**
  1. Si Meta no está configurado → omitido (silencioso, motivo visible).
  2. Trae comentarios recientes desde la última revisión (primer arranque: últimos 3 días);
     descarta los ya atendidos; máximo 20.
  3. Por cada comentario, una llamada a la IA (sin herramientas) que devuelve JSON
     `{ "accion": "responder" | "ignorar" | "escalar", "respuesta": "...", "motivo": "..." }`.
     El comentario va como dato entre delimitadores; el rol indica no seguir instrucciones que
     vengan en él.
  4. Según la acción y el switch:
     - `ignorar` → se marca atendido, no se publica nada.
     - `responder` + autónomo → se publica con `meta.responder`; si falla, va a la bandeja con
       el error.
     - `responder` + supervisado → `aprobaciones.proponer(tipo responder_comentario)`.
     - `escalar` → siempre a la bandeja (con la respuesta sugerida, si la hay, y el motivo).
  5. Todo se registra en la bitácora de actividad y en `comentarios-atendidos.json`.
- **Chat:** responde sobre los comentarios recientes y lo que ha hecho, con el estado como contexto.
- El ejecutor `responder_comentario` (registrado en el servidor) llama a `meta.responder` con la
  red y el id guardados en `contexto`.

## Cómo responde (rol)

- Español, cálido, breve (1 a 3 frases), tono de marca de Intelekia; usa el nombre de la persona.
- Precio o cotización: respuesta general e invitación a seguir por DM o WhatsApp; nunca inventa
  precios fuera del contexto de negocio.
- Quejas: reconoce, ofrece seguimiento por privado y escala.
- Nunca promete fechas, descuentos ni compromisos, ni comparte datos internos.
- Ignora spam, bots y emojis sueltos que no piden nada.

## Errores

- Falta configuración de Meta o token vencido → ciclo omitido con motivo claro (visible en su
  estado); el error de Meta se muestra tal cual.
- Error al publicar una respuesta → el elemento queda en `error` en la bandeja, con el mensaje;
  se puede reintentar o descartar.
- Un comentario que falla al procesarse no detiene a los demás.
- Respuesta de la IA que no es JSON válido → el comentario se manda a la bandeja como `escalar`
  con motivo "No pude decidir automáticamente".
- Un comentario nunca se publica dos veces: se marca atendido antes de publicar y la bandeja
  no permite aprobar dos veces el mismo elemento.

## Pruebas (`node:test`, Meta simulada)

- `meta`: normaliza comentarios de FB e IG, excluye los propios, usa los endpoints correctos
  para responder, explica la configuración faltante.
- `aprobaciones`: proponer, listar, aprobar (con y sin edición), error del ejecutor y reintento,
  descartar, no aprobar dos veces.
- `agentProfiles`: `autonomia` por defecto `supervisado`, se guarda y valida.
- `respuestasRedes.runCycle`: omitido sin configuración; sin comentarios nuevos no llama a la IA;
  ignora ya atendidos y viejos; tope de 20; las tres acciones; autónomo vs supervisado;
  escalar siempre a la bandeja; JSON inválido → escalar; fallo al publicar → bandeja con error.
- Rutas de aprobaciones.

## Validación en vivo (requiere al fundador)

1. Crear una app en developers.facebook.com (modo desarrollo), agregar los productos
   Facebook Login / Instagram Graph API, y generar un token de página de larga duración con
   permisos `pages_show_list`, `pages_read_engagement`, `pages_manage_engagement`,
   `instagram_basic`, `instagram_manage_comments`.
2. Poner `META_PAGE_TOKEN`, `META_PAGE_ID` y `META_IG_USER_ID` en `backend/.env`; reiniciar.
3. Con el trabajador supervisado: comentar en una publicación y verificar que aparece en la
   bandeja; aprobar y verificar la respuesta publicada.
4. Encender el switch y verificar que responde solo; probar un comentario de queja y verificar
   que se escala a la bandeja.
