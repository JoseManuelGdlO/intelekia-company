# Prototipo: Oficina de Marketing en 3D con agentes de IA

## Contexto y motivación

Intelekia quiere construir, a futuro, un "mundo" 3D que represente su oficina, con un
cuarto por departamento (Comercial, Desarrollo, Producto/IA, Marketing, Soporte,
Administración) y agentes de IA visibles dentro de cada cuarto. Haciendo clic en un
agente, el fundador puede preguntarle algo directamente o ver en qué está trabajando.

Ese proyecto completo es grande: combina (1) la lógica/rol de cada agente de IA, (2) un
backend que orquesta y expone esos agentes, y (3) una escena 3D en Three.js con
interacción. Antes de construir las 6 oficinas, se decidió validar la idea completa de
punta a punta con **un solo departamento**: Marketing, con sus 2 agentes.

Este spec cubre únicamente ese prototipo vertical. Las otras 5 oficinas, la publicación
automática real a redes sociales, multiusuario/autenticación y tiempo real por
WebSockets quedan fuera de alcance (ver sección "Fuera de alcance").

## Alcance

Se construye la oficina de Marketing con dos agentes:

- **Buscador de tendencias** — encuentra ideas de post/reel basándose en el contexto de
  negocio de Intelekia y formatos que funcionan.
- **Publicador** — toma esas ideas y redacta el caption/copy final de un post, dejándolo
  marcado como "listo para publicar" (la publicación real a Instagram/TikTok queda
  configurable pero apagada por defecto; el fundador publica manualmente).

Ambos agentes operan de dos formas:

- **Autónoma**: corren solos cada cierto tiempo (intervalo configurable, arrancando en
  "pocas veces al día") y actualizan su propio estatus.
- **Reactiva**: el fundador les da clic en la escena 3D y les pregunta algo directamente
  (p. ej. "dame 3 ideas más cortas"), sin esperar al ciclo autónomo.

Además, cada agente puede dispararse manualmente desde el panel de la escena con un
botón "forzar ciclo ahora", para poder probar sin esperar el intervalo configurado.

## Arquitectura y stack

```
Intelekia-Company/
  CONTEXTO-INTELEKIA.md        → contexto de negocio compartido (misión, servicios,
                                  productos, modelo de negocio de Intelekia)
  departamentos/marketing/
    agentes/
      buscador-tendencias.md   → rol, tono y comportamiento del agente
      publicador.md
    content/
      ideas.json               → ideas encontradas por el Buscador
      drafts/                  → posts redactados por el Publicador (uno por archivo)
  backend/                     → Node.js + Express
    scheduler.js                → dispara los ciclos autónomos cada X horas (configurable)
    agents/
      buscadorTendencias.js     → llama a OpenAI, lee contexto + ideas.json, escribe ideas nuevas
      publicador.js             → llama a OpenAI, lee ideas pendientes, escribe drafts
    state/
      agents-status.json        → estatus actual de cada agente
    routes/
      agents.js                 → API: status, chat, forzar-ciclo
    config.js                   → intervalo del scheduler, API key de OpenAI (.env)
  frontend/                     → Three.js + HTML/JS plano
    scene.js                     → el cuarto de Marketing y los 2 personajes
    ui.js                        → panel HTML superpuesto (estatus + chat + forzar ciclo)
    api.js                       → llamadas fetch al backend
```

**Por qué Node.js en el backend**: todo el proyecto queda en JavaScript (backend +
Three.js), es el stack que el equipo ya domina, y evita mezclar lenguajes para un
prototipo de validación.

**Por qué archivos JSON en vez de base de datos**: es un prototipo de un solo usuario
corriendo en local. Una base de datos real sería sobre-ingeniería en esta etapa. Si el
proyecto avanza a producción multiusuario, se migra a Postgres/SQLite en ese momento.

**Proveedor de IA**: OpenAI (GPT), vía API key propia en `.env`. No se integra ningún
otro proveedor en este prototipo.

## Los agentes: comportamiento y datos

### Buscador de tendencias

- **Ciclo autónomo**: lee `CONTEXTO-INTELEKIA.md` y el `ideas.json` existente, le pide a
  OpenAI entre 3 y 5 ideas nuevas de post/reel (evitando repetir ideas ya sugeridas),
  las agrega a `ideas.json` con estatus `pendiente`, y al terminar vuelve su propio
  estatus a `idle`.
- **Reactivo**: al recibir un mensaje de chat, responde directamente usando el mismo
  contexto de negocio, sin modificar `ideas.json` salvo que el fundador se lo pida
  explícitamente en el mensaje.

### Publicador

- **Ciclo autónomo**: revisa `ideas.json` por ideas en estatus `pendiente`, toma la más
  relevante, le pide a OpenAI el caption/copy completo, guarda el resultado como archivo
  en `content/drafts/`, marca la idea como `redactada` y el draft como
  `listo_para_publicar`.
- **Reactivo**: al recibir un mensaje de chat sobre un draft existente (p. ej. "hazlo más
  corto", "cambia el tono"), responde editando ese draft y actualiza el archivo.

### Estatus de agente

Cada agente tiene un estatus que se refleja visualmente en la escena 3D:

| Estatus | Significado | Color en la escena |
|---|---|---|
| `idle` | sin tarea activa | gris, quieto |
| `trabajando` | ejecutando su ciclo (buscando o redactando) | pulso amarillo |
| `listo_para_revision` | hay un resultado nuevo esperando revisión del fundador | pulso verde |
| `error` | falló la llamada a OpenAI; reintenta en el siguiente ciclo | rojo |

## Flujo de datos

```
[scheduler.js] ──cada X horas (configurable)──┐
                                               ├─> buscadorTendencias.js ──OpenAI──> ideas.json (pendiente) + status=idle
                                               └─> publicador.js         ──OpenAI──> drafts/*.md (listo_para_publicar) + status=listo_para_revision

[Frontend 3D] ──clic en avatar──> GET  /api/agents/:id/status   (pinta el estado del personaje)
                                └─> POST /api/agents/:id/chat     (abre panel, manda mensaje, recibe respuesta)
                                └─> POST /api/agents/:id/forzar   (dispara el ciclo autónomo de inmediato)

El frontend hace polling a /api/agents/status cada pocos segundos para reflejar cambios
de estatus sin intervención manual.
```

## La escena 3D (alcance mínimo)

- **Un cuarto** ("Oficina de Marketing"): piso, paredes básicas, dos escritorios.
- **Dos personajes simples**: figuras low-poly o cápsulas con etiqueta de nombre
  flotante ("Buscador de Tendencias", "Publicador"). Sin modelos rigged ni animados —
  el objetivo de este prototipo es validar la interacción, no el arte.
- **Color/animación según estatus**, según la tabla de la sección anterior.
- **Cámara**: orbit controls (rotar/zoom con mouse), sin modo primera persona.
- **Clic en un personaje**: abre un panel HTML superpuesto (no texto flotante en 3D) con
  su estatus actual, su última acción, un botón "forzar ciclo ahora" y un cuadro de
  chat para preguntarle algo directo.

## Manejo de errores

- Si falla la llamada a OpenAI (rate limit, red, etc.), el agente pasa a estatus `error`
  con un mensaje corto guardado en `agents-status.json`, y el scheduler reintenta en el
  siguiente ciclo configurado.
- Si el chat falla, el panel muestra un mensaje de error amigable sin romper la escena
  3D ni perder el estatus previo del agente.

## Fuera de alcance de este prototipo

- Las otras 5 oficinas/departamentos (Comercial, Desarrollo, Producto/IA, Soporte,
  Administración) — se evalúan después de validar este prototipo.
- Publicación automática real a Instagram/TikTok (la opción existe en el diseño de datos
  pero queda apagada; el fundador publica manualmente).
- Autenticación o soporte multiusuario — corre en local, para un solo usuario.
- Animación de personajes caminando, actualización en tiempo real vía WebSockets
  (el polling es suficiente para este prototipo), y base de datos real.

## Cómo se valida

- **Backend**: correr cada agente manualmente y confirmar que `ideas.json` y los drafts
  en `content/drafts/` se generan correctamente, y que `agents-status.json` cambia de
  estado como se espera en cada paso del ciclo.
- **API**: probar `/status`, `/chat` y `/forzar` con curl o Postman.
- **Frontend**: abrir la escena, hacer clic en cada personaje, confirmar que el panel
  abre, el chat responde, y el color del personaje cambia al forzar un ciclo.
