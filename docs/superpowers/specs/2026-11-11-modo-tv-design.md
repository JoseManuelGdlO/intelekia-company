# Modo TV vertical, medidor de gasto y paginación — diseño

Fecha: 2026-11-11 · Aprobado por el fundador en conversación.

## Objetivo
Poner la oficina virtual en pantallas **verticales** (1080×1920) de la oficina real, sin exponer datos
sensibles ni permitir cambios desde la TV; medir el gasto diario de OpenAI con un límite que frena los
ciclos automáticos; y paginar la bitácora de actividad y las conversaciones entre agentes.

## 1. Paginación (actividad y conversaciones entre agentes)
- `lib/actividad.js`: `MAX_POR_AGENTE` 150 → **1000**. Nueva función `pagina(agentId, { pagina = 1, porPagina = 20 })`
  → `{ eventos, total, pagina, paginas }`, eventos ordenados **del más reciente al más antiguo**; página fuera de
  rango → `eventos: []` y `pagina` normalizada a ≥1. `list()` (en vivo con `desde`) no cambia.
- `lib/conversacionesStore.js`: `MAX_CONVERSACIONES` 200 → **2000**. Nueva `pagina({ agentId, pagina, porPagina })`
  con la misma forma (`items` en lugar de `eventos`), más reciente primero.
- Rutas: `GET /api/agents/:id/actividad?pagina=N&porPagina=20` devuelve la forma paginada **solo si viene `pagina`**;
  sin `pagina` responde como hoy (compatibilidad). Igual `GET /api/comunicacion/conversaciones?agentId=X&pagina=N`.
  `porPagina` máximo 100.
- Panel del agente (Actividad y "Conversaciones con compañeros"): controles
  `‹ Más recientes · Página X de Y · Más antiguas ›`. Página 1 = en vivo (como hoy). Páginas > 1 = estáticas.

## 2. Medidor de gasto diario
- `lib/gasto.js` — `createGasto({ filePath, now, timeZone, precios })`:
  - `registrarTokens({ model, prompt_tokens, completion_tokens })`, `registrarAudio({ tipo: 'transcripcion'|'voz', segundos|caracteres })`
    (estimado), acumulados **por día local** (America/Monterrey) en `state/gasto.json` (se conservan 31 días).
  - Precios USD por 1M tokens en una tabla (gpt-4o-mini: 0.15 in / 0.60 out; gpt-4o: 2.50 / 10; gpt-4.1-mini 0.40/1.60;
    modelo desconocido → precios de gpt-4o como estimación conservadora). Audio: transcripción 0.003 USD/min; voz 0.015 USD/1000 caracteres.
  - `hoy()` → `{ fecha, usd, llamadas, tokensEntrada, tokensSalida, limiteUsd, excedido }`.
  - `limite` se guarda en el mismo archivo; `setLimite(usd|null)`; 0/null = sin límite.
- Punto único: `lib/openaiClient.js` acepta un `onUsage(model, usage)` global (`setUsageListener`) que se llama con
  `data.usage` en cada respuesta OK. `lib/voz.js` recibe un callback opcional `onUso` para audio.
- `puedeTrabajar` del planificador = `horario.puedeTrabajar() && !gasto.hoy().excedido`. El motivo aparece en el
  estado de la oficina ("Límite de gasto del día alcanzado: vuelve mañana"). Chat, WhatsApp, Forzar ciclo siguen.
- API: `GET /api/oficina` incluye `gasto: hoy()`; `PUT /api/oficina/limite-gasto { usd }`.
- UI oficina: en la ventana 🕘 Horario, campo "Límite de gasto diario (USD)"; chip en la barra `💵 Hoy: $1.20 / $5.00`
  (ámbar ≥80 %, rojo al excederse).

## 3. Usuario de solo lectura para la TV
- `lib/acceso.js`: además de `OFICINA_USUARIO/OFICINA_PASSWORD` (rol `admin`), acepta `OFICINA_TV_USUARIO/OFICINA_TV_PASSWORD`
  (rol `tv`). El rol `tv` solo puede `GET` de: `/tv.html`, `/src/**`, `/assets/**`, `/styles.css`, `/tv.css`, `/vendor/**` (si existe),
  `/favicon*`, y `/api/tv/**`. Cualquier otra cosa → **403**. Si no hay usuario admin configurado, el acceso sigue abierto
  como hoy (desarrollo local).
- `GET /api/tv/estado` (lo pueden usar admin y tv) devuelve SOLO datos limpios:
  - `oficina`: `{ abierta, puedeTrabajar, motivo, entrada, salida }`
  - `gasto`: `{ usd, limiteUsd, excedido }`
  - `departamentos`: `[{ id, label, agentes: [{ id, label, estatus }] }]` (sin rol ni memoria)
  - `dia`: contadores de HOY (zona local): `ciclos` (eventos `inicio` de actividad), `ideas` (ideas creadas hoy),
    `prospectos` (creados hoy), `prsRevisados` (revisadoEn hoy), `aprobacionesPendientes`, `aprobadasHoy`,
    `conversaciones` (entre agentes hoy)
  - `actividad`: últimos 30 eventos de toda la oficina `{ fecha, agente (label), tipo, texto }` con el texto **sanitizado**:
    se quitan correos, teléfonos (≥8 dígitos), URLs, y se recorta a 120 caracteres; los tipos `chat` y `respuesta`
    (conversaciones privadas del fundador) se excluyen.
  - `celebraciones`: eventos recientes (últimas 24 h) `{ id, tipo: 'pr'|'prospecto'|'aprobacion', texto }` con texto genérico
    sin datos personales (ej. "PR aprobado en intelekia-web", "Nuevo prospecto: Cafetería", "Publicación aprobada").
    Para prospectos se usa el **giro**, no el nombre del negocio.

## 4. Pantalla vertical `/tv.html`
- Layout vertical: barra superior (logo, reloj, estado), **3D arriba (~45 %)** con recorrido automático de cámara
  por departamentos cada ~20 s, **panel que rota cada ~25 s** (Tablero del día · Actividad en vivo · Gasto de hoy),
  ticker inferior con la actividad. Letras grandes (legibles a 3 m), sin chat ni botones.
- Reutiliza `scene.js` (misma oficina 3D) en modo solo-vista; consulta `/api/tv/estado` cada 10 s.
- **Celebraciones**: al ver un id de celebración nuevo (no visto desde que cargó la página), overlay de 4 s con confeti CSS.
- **Pantalla de noche**: si `oficina.puedeTrabajar` es false, se detiene el render 3D y se muestra fondo oscuro con reloj
  y el motivo ("Abrimos mañana a las 09:00"). Al volver, se reanuda.
- Funciona también en horizontal (se adapta), pero está diseñada para vertical.

## Fuera de alcance
Una pantalla por departamento, sonidos, control remoto de la TV.

## Pruebas
Unitarias para: paginación (totales, orden, fuera de rango, filtro por agente, máximo porPagina), gasto (precios,
día local, límite, persistencia, archivo dañado), acceso por rol (tv solo lo permitido, 403 en lo demás, admin todo),
`/api/tv/estado` (no filtra correos/teléfonos/URLs, excluye chat, usa giro en prospectos), y planificador frenado por gasto.
