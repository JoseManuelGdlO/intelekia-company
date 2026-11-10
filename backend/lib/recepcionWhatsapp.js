const fs = require('fs');
const path = require('path');

/**
 * Recepción del canal de WhatsApp: decide qué hacer con cada mensaje del fundador.
 * Comandos (pendientes / aprobar N / descartar N / ayuda), ruteo al trabajador (por nombre,
 * seguimiento de 15 min o IA), conversación o ciclo forzado, respuesta en texto y voz, y avisos
 * de la bandeja de aprobaciones respetando la ventana de 24 h de WhatsApp.
 */
const SEGUIMIENTO_MS = 15 * 60 * 1000;
const VENTANA_MS = 24 * 3600 * 1000;
const MAX_VISTOS = 500;
const ABIERTOS = ['por_aprobar', 'error'];

function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** "PM, ¿cómo va?" → { agente: PM, resto: "¿cómo va?" }. Acepta nombre completo o primera palabra única. */
function detectarPorNombre(texto, agentes) {
  const original = String(texto || '').normalize('NFC').trimStart();
  const t = normalizar(original);
  const primeras = {};
  agentes.forEach((a) => {
    const p = normalizar(a.label).split(/\s+/)[0];
    primeras[p] = (primeras[p] || 0) + 1;
  });
  const candidatos = [];
  agentes.forEach((a) => {
    const completo = normalizar(a.label);
    candidatos.push({ agente: a, c: completo });
    const p = completo.split(/\s+/)[0];
    if (p !== completo && p.length >= 2 && primeras[p] === 1) candidatos.push({ agente: a, c: p });
  });
  candidatos.sort((x, y) => y.c.length - x.c.length);
  for (const { agente, c } of candidatos) {
    if (t.startsWith(c) && !/[a-z0-9ñ]/.test(t.charAt(c.length))) {
      return { agente, resto: original.slice(c.length).replace(/^[\s,:;.\-–—]+/, '').trim() };
    }
  }
  return null;
}

/** Enrutador con IA (sin herramientas): a qué trabajador va el mensaje y si es chat o ciclo. */
function crearEnrutadorIA({ createChatCompletion, apiKey, model }) {
  return async function enrutarConIA(texto, agentes) {
    const ids = agentes.map((a) => a.id);
    let raw = '';
    try {
      raw = await createChatCompletion({
        apiKey,
        model,
        messages: [
          {
            role: 'system',
            content:
              'Eres la recepción de la oficina virtual de Intelekia. Decide a qué trabajador va el mensaje del fundador ' +
              'y si quiere conversar ("chat") o que el trabajador corra su ciclo automático ahora ("forzar_ciclo", p. ej. ' +
              '"revisa los PRs ahora", "genera las ideas de hoy"). Responde SOLO JSON: ' +
              '{"agentId": "id o null", "accion": "chat" | "forzar_ciclo", "duda": ["id1", "id2"]}. ' +
              'Si dos o más trabajadores encajan igual de bien, usa agentId null y pon sus ids en duda.',
          },
          { role: 'user', content: `Trabajadores (JSON):\n${JSON.stringify(agentes)}\n\nMensaje del fundador:\n${texto}` },
        ],
      });
    } catch {
      return { agentId: null, accion: 'chat', duda: [] };
    }
    try {
      const s = String(raw || '');
      const d = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
      return {
        agentId: ids.includes(d.agentId) ? d.agentId : null,
        accion: d.accion === 'forzar_ciclo' ? 'forzar_ciclo' : 'chat',
        duda: (Array.isArray(d.duda) ? d.duda : []).filter((id) => ids.includes(id)).slice(0, 3),
      };
    } catch {
      return { agentId: null, accion: 'chat', duda: [] };
    }
  };
}

function estadoVacio() {
  return { ultimoMensaje: {}, vistos: [], numeros: {}, siguienteNumero: 1, cola: {}, ultimoAgente: {}, sinRuta: {}, plantillaEnviadaEn: {} };
}

function enmascarar(numero) {
  return `…${String(numero).slice(-4)}`;
}

function createRecepcionWhatsapp({
  whatsapp,
  voz,
  estadoPath,
  permitidos = [],
  agentes,
  chatDe,
  forzarCiclo,
  aprobaciones,
  enrutarConIA,
  labelOf = (id) => id,
  registrar = () => {},
  plantilla = null,
  now = () => new Date(),
}) {
  function cargar() {
    if (!fs.existsSync(estadoPath)) return estadoVacio();
    try {
      return { ...estadoVacio(), ...JSON.parse(fs.readFileSync(estadoPath, 'utf-8')) };
    } catch {
      const respaldo = `${estadoPath}.corrupto-${now().getTime()}`;
      try {
        fs.renameSync(estadoPath, respaldo);
      } catch {
        // si no se puede respaldar, se sigue con estado vacío
      }
      registrar(null, 'error', `WhatsApp: el estado estaba dañado; lo respaldé en ${respaldo}`);
      return estadoVacio();
    }
  }

  const estado = cargar();

  function guardar() {
    fs.mkdirSync(path.dirname(estadoPath), { recursive: true });
    const tmp = `${estadoPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(estado, null, 2));
    fs.renameSync(tmp, estadoPath);
  }

  const reciente = (iso, ms) => Boolean(iso) && now().getTime() - Date.parse(iso) < ms;
  const ventanaAbierta = (num) => reciente(estado.ultimoMensaje[num], VENTANA_MS);

  async function responder(num, texto) {
    try {
      await whatsapp.enviarTexto(num, texto);
    } catch (err) {
      registrar(null, 'error', `WhatsApp: no pude enviar un mensaje (${err.message})`);
    }
  }

  // ---------- Pendientes (números cortos) ----------
  function abiertos() {
    return aprobaciones.list({ limite: 500 }).filter((i) => ABIERTOS.includes(i.estado));
  }

  function limpiarNumeros() {
    const ids = new Set(abiertos().map((i) => i.id));
    Object.entries(estado.numeros).forEach(([n, id]) => {
      if (!ids.has(id)) delete estado.numeros[n];
    });
    if (!Object.keys(estado.numeros).length) estado.siguienteNumero = 1;
  }

  function numeroDe(id) {
    const existente = Object.entries(estado.numeros).find(([, v]) => v === id);
    if (existente) return Number(existente[0]);
    const n = estado.siguienteNumero;
    estado.siguienteNumero += 1;
    estado.numeros[n] = id;
    return n;
  }

  function formatoAviso(n, item) {
    const lineas = [`✋ #${n} · ${labelOf(item.agentId)} — ${item.titulo}`];
    if (item.contexto?.comentario) lineas.push(`«${item.contexto.comentario}»`);
    lineas.push(`Propone: ${item.propuesta || '(sin texto)'}`);
    if (item.estado === 'error' && item.error) lineas.push(`Falló: ${item.error}`);
    else if (item.motivo) lineas.push(`Motivo: ${item.motivo}`);
    lineas.push(`Contesta *aprobar ${n}* o *descartar ${n}*.`);
    return lineas.join('\n');
  }

  async function entregarCola(num) {
    const ids = estado.cola[num];
    if (!ids || !ids.length) return;
    delete estado.cola[num];
    limpiarNumeros();
    const items = abiertos().filter((i) => ids.includes(i.id));
    if (items.length) {
      const avisos = items.map((i) => formatoAviso(numeroDe(i.id), i)).join('\n\n');
      await responder(num, `Mientras no estabas llegaron ${items.length} pendiente(s):\n\n${avisos}`);
    }
    guardar();
  }

  async function avisarAprobacion(item) {
    limpiarNumeros();
    const n = numeroDe(item.id);
    guardar();
    for (const num of permitidos) {
      if (ventanaAbierta(num)) {
        await responder(num, formatoAviso(n, item));
        continue;
      }
      estado.cola[num] = [...new Set([...(estado.cola[num] || []), item.id])];
      const yaAvisado = estado.plantillaEnviadaEn[num] && estado.plantillaEnviadaEn[num] > (estado.ultimoMensaje[num] || '');
      if (plantilla?.nombre && !yaAvisado) {
        try {
          await whatsapp.enviarPlantilla(num, plantilla.nombre, plantilla.idioma || 'es_MX', [String(estado.cola[num].length)]);
          estado.plantillaEnviadaEn[num] = now().toISOString();
        } catch (err) {
          registrar(null, 'error', `WhatsApp: no pude mandar la plantilla de aviso (${err.message})`);
        }
      }
      guardar();
    }
  }

  // ---------- Comandos ----------
  async function comando(num, texto) {
    const t = normalizar(texto).trim();
    if (/^(pendientes?|aprobaciones)$/.test(t)) {
      limpiarNumeros();
      const items = abiertos();
      const cuerpo = items.length
        ? `Tienes ${items.length} pendiente(s):\n\n${items.map((i) => formatoAviso(numeroDe(i.id), i)).join('\n\n')}`
        : 'No hay pendientes ✨';
      guardar();
      await responder(num, cuerpo);
      return true;
    }
    if (/^(ayuda|\?)$/.test(t)) {
      const nombres = agentes().map((a) => a.label).join(', ');
      await responder(
        num,
        'Escríbeme o mándame un audio. Empieza con el nombre del trabajador para ir directo (p. ej. "PM, ¿cómo va el equipo?"); ' +
          'si no, yo elijo. También: *pendientes*, *aprobar N*, *descartar N*.\n' +
          `Trabajadores: ${nombres}`
      );
      return true;
    }
    const m = t.match(/^(aprobar|aprueba|descartar|descarta)\s+#?(\d+)$/);
    if (!m) return false;
    const n = Number(m[2]);
    limpiarNumeros();
    const id = estado.numeros[n];
    guardar();
    if (!id) {
      await responder(num, `No encuentro el pendiente #${n}. Escribe *pendientes* para ver la lista.`);
      return true;
    }
    const aprobar = m[1].startsWith('aprob');
    try {
      if (aprobar) {
        const r = await aprobaciones.aprobar(id);
        await responder(num, r.estado === 'aprobado' ? `✅ #${n} aprobado y ejecutado.` : `⚠️ #${n} falló: ${r.error}`);
      } else {
        aprobaciones.descartar(id);
        await responder(num, `🗑️ #${n} descartado.`);
      }
    } catch (err) {
      await responder(num, `⚠️ No pude ${aprobar ? 'aprobar' : 'descartar'} #${n}: ${err.message}`);
    }
    return true;
  }

  // ---------- Ruteo ----------
  async function rutear(num, texto) {
    const lista = agentes();
    const directo = detectarPorNombre(texto, lista);
    if (directo) {
      let resto = directo.resto;
      const previo = estado.sinRuta[num];
      if (!resto && previo && reciente(previo.at, SEGUIMIENTO_MS)) resto = previo.texto;
      delete estado.sinRuta[num];
      if (!resto) {
        await responder(num, `¿Qué le digo a ${directo.agente.label}?`);
        return null;
      }
      let accion = 'chat';
      try {
        const r = await enrutarConIA(resto, [directo.agente]);
        if (r?.accion === 'forzar_ciclo') accion = 'forzar_ciclo';
      } catch {
        // si la IA falla, se conversa
      }
      return { agentId: directo.agente.id, accion, texto: resto };
    }

    const ultimo = estado.ultimoAgente[num];
    if (ultimo && reciente(ultimo.at, SEGUIMIENTO_MS) && lista.some((a) => a.id === ultimo.agentId)) {
      return { agentId: ultimo.agentId, accion: 'chat', texto };
    }

    let r = { agentId: null, accion: 'chat', duda: [] };
    try {
      r = (await enrutarConIA(texto, lista)) || r;
    } catch {
      // se pregunta al fundador
    }
    if (r.agentId && lista.some((a) => a.id === r.agentId)) return { agentId: r.agentId, accion: r.accion, texto };

    estado.sinRuta[num] = { texto, at: now().toISOString() };
    guardar();
    const duda = (r.duda || []).map((id) => lista.find((a) => a.id === id)).filter(Boolean);
    if (duda.length >= 2) {
      await responder(num, `¿A quién se lo paso: ${duda.map((a) => `*${a.label}*`).join(' o ')}? Contesta con su nombre.`);
    } else {
      await responder(num, `No supe a quién pasárselo. Empieza tu mensaje con el nombre del trabajador: ${lista.map((a) => a.label).join(', ')}.`);
    }
    return null;
  }

  async function responderAgente(num, label, texto, conVoz) {
    await responder(num, `*${label}:* ${texto}`);
    if (!conVoz) return;
    try {
      await whatsapp.enviarAudio(num, await voz.sintetizar(texto));
    } catch (err) {
      registrar(null, 'error', `WhatsApp: no pude generar la nota de voz (${err.message})`);
    }
  }

  async function ejecutar(num, { agentId, accion, texto }, conVoz) {
    const label = labelOf(agentId);
    estado.ultimoAgente[num] = { agentId, at: now().toISOString() };
    guardar();
    registrar(agentId, 'chat', `📱 WhatsApp: ${texto}`);
    if (accion === 'forzar_ciclo') {
      await responder(num, `⏳ Le pido a ${label} que corra su ciclo ahora…`);
      try {
        await responderAgente(num, label, `✅ Ciclo terminado: ${await forzarCiclo(agentId)}`, conVoz);
      } catch (err) {
        await responder(num, `⚠️ ${label} no pudo correr su ciclo: ${err.message}`);
      }
      return;
    }
    await responder(num, `⏳ Se lo paso a ${label}…`);
    try {
      await responderAgente(num, label, await chatDe(agentId, texto), conVoz);
    } catch (err) {
      await responder(num, `⚠️ No pude completar tu pedido con ${label}: ${err.message}`);
    }
  }

  async function procesar(m) {
    if (!m?.id || estado.vistos.includes(m.id)) return;
    estado.vistos.push(m.id);
    estado.vistos = estado.vistos.slice(-MAX_VISTOS);
    if (!permitidos.includes(m.de)) {
      guardar();
      registrar(null, 'error', `WhatsApp: ignoré un mensaje de un número no permitido (${enmascarar(m.de)})`);
      return;
    }
    const num = m.de;
    estado.ultimoMensaje[num] = now().toISOString();
    guardar();
    await entregarCola(num);

    if (m.tipo === 'otro') {
      await responder(num, 'Por ahora solo entiendo texto y audios 🙂');
      return;
    }
    let texto = m.texto;
    const fueAudio = m.tipo === 'audio';
    if (fueAudio) {
      try {
        const { buffer, mime } = await whatsapp.descargarMedia(m.mediaId);
        texto = await voz.transcribir(buffer, mime);
      } catch (err) {
        await responder(num, `⚠️ No pude entender el audio: ${err.message}`);
        return;
      }
      await responder(num, `🎙️ Entendí: "${texto}"`);
    }
    texto = String(texto || '').trim();
    if (!texto) return;
    if (await comando(num, texto)) return;
    const ruta = await rutear(num, texto);
    if (ruta) await ejecutar(num, ruta, fueAudio);
  }

  function estadoCanal() {
    return {
      permitidos: permitidos.map(enmascarar),
      ventanas: Object.fromEntries(permitidos.map((n) => [enmascarar(n), ventanaAbierta(n)])),
    };
  }

  return { procesar, avisarAprobacion, estadoCanal };
}

module.exports = { createRecepcionWhatsapp, crearEnrutadorIA, detectarPorNombre, normalizar };
