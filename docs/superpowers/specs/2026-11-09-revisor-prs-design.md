# Revisor de PRs — diseño

Fecha: 2026-11-09

## Objetivo

Un nuevo trabajador, **Revisor de PRs** (`revisor-prs`), que vigila los Pull Requests abiertos en los
repositorios de la cuenta de GitHub del fundador, los revisa con IA y:

- si encuentra errores, publica un review **Request changes** con comentarios en línea;
- si no encuentra errores, **aprueba y hace merge**;
- tras pedir cambios, no vuelve a aprobar ni a hacer merge hasta que el autor suba commits nuevos
  **y** marque como resueltos todos los comentarios; entonces vuelve a revisar.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Acción al terminar | Aprobar + merge si pasa; Request changes con comentarios si no |
| Repos vigilados | Todos los repos de la cuenta del fundador (`user:<GITHUB_OWNER>`) |
| Conexión con GitHub | Plugin MCP oficial de GitHub, instalado desde Instalables |
| Cuenta que opera | Token del fundador (`GITHUB_TOKEN`). Los PRs los abre el equipo; los PRs del propio fundador se ignoran (GitHub no permite aprobar PRs propios) |
| Cómo escucha | Sondeo cada 5 min con el scheduler existente (sin webhook: el servidor es local y sin autenticación) |
| Condición de merge | Ningún hilo de review sin resolver; además PR pendiente en este ciclo y no propio |

## Arquitectura

### Departamento y agente

- Nuevo departamento **Desarrollo** (`departamentos/desarrollo/`) en `backend/departments.js`, con un
  agente `revisor-prs`, `cicloHoras: 5/60` (editable en la app).
- Rol en `departamentos/desarrollo/agentes/revisor-prs.md`.
- Módulo `backend/agents/revisorPRs.js` con la interfaz habitual: `runCycle`, `chat`, `describeSuccess`.
- Estado persistente en `backend/state/revisiones-pr.json`.

### Plugin MCP de GitHub

- Servidor remoto oficial: `https://api.githubcopilot.com/mcp/`.
- `lib/instalables.js` se extiende para que un plugin `http` pueda declarar una **variable de entorno
  con el token** (`tokenEnv: "GITHUB_TOKEN"`). Al conectar, se envía `Authorization: Bearer <valor>`
  mediante `requestInit.headers` del `StreamableHTTPClientTransport`. En `instalados.json` se guarda
  solo el nombre de la variable, nunca el token.
- La ruta `POST /api/instalables/plugins` y el formulario del frontend aceptan el campo opcional
  `tokenEnv`.
- Configuración nueva en `.env` / `config.js`:
  - `GITHUB_TOKEN` — token del fundador con permisos de lectura/escritura de PRs y contenido.
  - `GITHUB_OWNER` — cuenta cuyos repos se vigilan (p. ej. `JoseManuelGdlO`).
- Los nombres de herramientas usados por el código (`search_pull_requests`, `pull_request_read`,
  `merge_pull_request`) viven en un solo mapa en `lib/revisionesPR.js`. Al implementar se confirman
  contra la lista real que devuelve el plugin al instalarse (`herramientas` en `instalados.json`) y
  se ajusta solo ese mapa si difieren.
- El revisor encuentra su plugin buscando entre sus plugins activos (perfil → instalados) el que
  tenga la herramienta `search_pull_requests`. Si no hay ninguno, el ciclo se omite con un mensaje
  claro.

### Nuevo módulo `lib/revisionesPR.js`

Lógica sin IA, probada de forma aislada:

- `leerEstado()` / `guardarEstado()` sobre `revisiones-pr.json`. Por PR (`owner/repo#n`) guarda:
  `ultimoShaRevisado`, `veredicto` (`aprobado_mergeado` | `aprobado_sin_merge` | `cambios_pedidos` | `error` | `bloqueado`),
  `motivo`, `revisadoEn`, `url`.
- `detectar({ llamarHerramienta, owner, now })`:
  1. Llama directo (sin IA) a `search_pull_requests` con `is:pr is:open draft:false user:<owner>`.
  2. Descarta PRs cuyo autor es `owner`.
  3. Para cada PR obtiene el SHA del head (`pull_request_read` método `get`) y, si antes se pidieron
     cambios, los hilos de review (`pull_request_read` método `get_review_comments`, campo
     `isResolved`).
  4. Devuelve los **pendientes**: PRs nuevos (sin registro), PRs con `veredicto: error`, o PRs con
     `cambios_pedidos` que tengan un SHA distinto **y** cero hilos sin resolver. Los PRs `bloqueado`
     (conflictos, demasiado grande) solo vuelven cuando cambia el SHA.
  5. Máximo 5 pendientes por ciclo.
- `candadoMerge({ pendientes, owner, llamarHerramienta })`: envuelve el manejador de
  `merge_pull_request`. Antes de ejecutar, verifica que el PR esté en `pendientes`, que su autor no
  sea `owner` y que no tenga hilos sin resolver (consultándolo de nuevo con el plugin). Si algo
  falla, no llama a GitHub y devuelve al agente el texto `Merge bloqueado: <motivo>`.

## Flujo de un ciclo

1. Validar: `GITHUB_TOKEN`/`GITHUB_OWNER` configurados y plugin de GitHub activo en el perfil. Si
   falta algo → `omitido` con el motivo (visible en la app).
2. `detectar()`. Si no hay pendientes → termina sin llamar a la IA; `ultimaAccion: "Sin PRs nuevos"`.
3. Por cada pendiente, una conversación con IA (el bucle de herramientas existente en
   `openaiClient`/`colleagues`) con:
   - el rol, el contexto del PR (repo, número, título, autor, SHA) y la instrucción de revisarlo;
   - las herramientas del plugin, con `merge_pull_request` envuelta por `candadoMerge`.
   El agente lee diff y archivos, y publica el review (Request changes con comentarios en línea, o
   Approve) y, si aprueba, llama a merge.
4. Tras la conversación, el código confirma el resultado consultando el PR con el plugin
   (¿mergeado? ¿último review del revisor?) y guarda el veredicto con el SHA revisado. No se fía de
   lo que el modelo dice que hizo.
5. Registrar en la bitácora de actividad y en la memoria del agente; `describeSuccess` resume:
   `"PRs: 2 aprobados y mergeados, 1 con cambios pedidos"`.

## Qué revisa la IA (rol)

- Bloquean merge: bugs y errores de lógica; seguridad (secretos, inyección, endpoints expuestos);
  datos sensibles commiteados; código roto o incompleto; falta de pruebas en lógica nueva.
- No bloquean: estilo y preferencias; se mencionan como sugerencia en el resumen.
- Comentarios en español, en la línea exacta: qué está mal, por qué importa, cómo arreglarlo.
- Resumen del review con los hallazgos y la frase: "Cuando corrijas, marca cada comentario como
  resuelto y lo vuelvo a revisar."
- Al aprobar: comentario corto de lo revisado; merge con el método por defecto del repo.
- PRs grandes: si el diff pasa de ~60 000 caracteres, revisar archivo por archivo; si aun así no
  alcanza, comentar que es demasiado grande para revisión automática y no hacer merge
  (`veredicto: bloqueado`).

## Interfaz

- Sala **Desarrollo** en la oficina 3D con el revisor.
- Chat: responde sobre las revisiones usando `revisiones-pr.json` como contexto.
- Panel del agente: lista de PRs con repo, número, veredicto, SHA revisado, fecha y enlace a GitHub
  (nueva ruta `GET /api/revisiones-pr`).
- **Forzar ciclo** existente.
- Formulario de plugins de Instalables: campo opcional "Variable del token (.env)".

## Errores

- Falta configuración o plugin → ciclo omitido con motivo claro.
- Error en un PR (GitHub caído, revisión sin VEREDICTO) → `veredicto: error`, se reintenta el
  siguiente ciclo; los demás PRs continúan. Un PR que falla al detectarse se salta sin frenar a los demás.
- Aprobado pero GitHub rechaza el merge (checks pendientes o requeridos, reglas del repo) →
  `veredicto: aprobado_sin_merge`. Con el mismo SHA, los siguientes ciclos solo reintentan el merge
  sin IA (cero hilos abiertos + `expectedHeadSha`), sin límite de intentos y en silencio mientras
  siga igual; si llega un commit nuevo se revisa completo otra vez.
- `mergeable_state: unknown` (GitHub aún lo calcula) → el PR se salta en ese ciclo, sin registrar nada.
- Conflictos de merge → comentario "tiene conflictos con la rama base, actualízalo";
  `veredicto: bloqueado` hasta que cambie el SHA.
- Un ciclo no se encima con otro (el scheduler ya lo garantiza).

## Pruebas (`node:test`, plugin simulado)

- `revisionesPR.detectar`: PR nuevo, PR propio ignorado, borrador ignorado, `cambios_pedidos` sin
  commits nuevos (no), con commits pero hilos abiertos (no), con commits y todo resuelto (sí),
  `bloqueado` solo con SHA nuevo, tope de 5.
- `candadoMerge`: bloquea PR fuera de pendientes, PR propio, PR con hilos abiertos; deja pasar el
  caso válido.
- Estado persistente: guardar/leer, archivo corrupto.
- `instalables`: plugin `http` con `tokenEnv` envía la cabecera `Authorization` y no guarda el token.
- `revisorPRs.runCycle`: omitido sin configuración; sin pendientes no llama a la IA; veredicto
  confirmado con el plugin, no con la respuesta del modelo.

## Ajustes de implementación (agregados al planear)

- **Herramientas restringidas durante una revisión.** El plugin de GitHub expone muchas herramientas
  (incluidas escrituras de archivos). Como el diff de un PR puede traer instrucciones maliciosas
  (prompt injection), en el ciclo el agente solo recibe `pull_request_read`, `get_file_contents`,
  `pull_request_review_write`, `add_comment_to_pending_review` y `merge_pull_request`, y las de
  escritura solo aceptan el `owner/repo/pullNumber` del PR en revisión. El merge fuerza
  `expectedHeadSha` = SHA revisado. Se elimina la herramienta de consultar compañeros en el ciclo.
- **Chat de solo lectura.** En el chat el agente solo tiene `pull_request_read`,
  `get_file_contents`, `search_pull_requests` y `list_pull_requests`: nunca aprueba ni hace merge
  desde el chat.
- **Veredicto verificado.** La respuesta final del modelo termina en
  `VEREDICTO: APROBADO | CAMBIOS | BLOQUEADO`. `aprobado_mergeado` solo se registra si el plugin
  confirma `merged: true`; si dijo APROBADO pero no quedó mergeado, es `aprobado_sin_merge`.
- **Reintentos acotados.** Un PR en `error` se reintenta como máximo 3 veces con el mismo SHA;
  después queda `bloqueado` hasta que llegue un commit nuevo.
- **Conflictos sin IA.** Si `mergeable_state` es `dirty`, el código publica el comentario de
  conflictos y registra `bloqueado`, sin llamar al modelo.
- **Ciclos silenciosos.** Un ciclo sin PRs pendientes no escribe en la memoria ni en la bitácora
  de actividad (corre cada 5 min y llenaría ambas).
- `instalables.llamar` acepta `{ maxChars }` para que el código reciba el JSON completo del plugin
  (el recorte por defecto de 12 000 caracteres rompería el `JSON.parse`).

## Fuera de alcance

- Webhooks.
- Lista editable de repos (se vigilan todos los de `GITHUB_OWNER`).
- Revisar PRs de organizaciones ajenas a `GITHUB_OWNER`.
