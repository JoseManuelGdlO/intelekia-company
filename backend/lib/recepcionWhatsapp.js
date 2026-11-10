const fs = require('fs');
const path = require('path');
const { normalizarNumero } = require('./whatsapp');

/**
 * Recepción del canal de WhatsApp: decide qué hacer con cada mensaje del fundador.
 * Comandos (pendientes / aprobar N / descartar N / ayuda), ruteo al trabajador (por nombre,
 * seguimiento de 15 min o IA), conversación o ciclo forzado, respuesta en texto y voz, y avisos
 * de la bandeja de aprobaciones respetando la ventana de 24 h de WhatsApp.
 */
const SEGUIMIENTO_MS = 15 * 60 * 1000;
const VENTANA_MS = 24 * 3600 * 1000;
const MAX_VISTOS = 500;
const TARDE_MS = 10 * 60 * 1000;
const ABIERTOS = ['por_aprobar', 'error'];
// Palabras que sugieren "corre tu ciclo"; si no aparece ninguna, ni se le pregunta a la IA.
const CICLO_RE = /\b(ciclo|corre|ejecuta|revisa|genera|ahora|forzar|fuerza)\b/;
const RELLENO = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'para', 'con', 'a', 'al']);
const NUMEROS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };

function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** "Aprobar tres." → "aprobar 3"; "¿pendientes?" → "pendientes" (comandos escritos o dictados). */
function formaComando(texto) {
  return normalizar(texto)
    .replace(/[^\p{L}\p{N}#\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/g, (w) => String(NUMEROS[w]));
}

function esPendientes(texto) {
  return /^(pendientes?|aprobaciones)$/.test(formaComando(texto));
}

/** Palabras normalizadas, sin puntuación. */
function palabras(s) {
  return normalizar(s)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function contar(lista) {
  const cuenta = {};
  lista.forEach((x) => {
    cuenta[x] = (cuenta[x] || 0) + 1;
  });
  return cuenta;
}

/**
 * "PM, ¿cómo va?" → { agente: PM, resto: "¿cómo va?" }. Acepta (siempre al inicio del mensaje):
 * nombre completo, nombre sin la última palabra ("Revisor de PR"), primera palabra única ("Revisor")
 * o una palabra que solo tiene ese nombre ("Tendencias", "Prospectos").
 */
function detectarPorNombre(texto, agentes) {
  const original = String(texto || '').normalize('NFC').trimStart();
  const t = normalizar(original);
  const etiquetas = agentes.map((agente) => ({ agente, completo: normalizar(agente.label).trim(), ps: palabras(agente.label) }));
  // Variantes del nombre: sin la última palabra ("Seguimiento de Proyectos" → "Seguimiento") y en
  // singular ("Revisor de PRs" → "Revisor de PR").
  const variantes = (ps) => {
    if (ps.length < 2) return [];
    const sin = ps.slice(0, -1);
    while (sin.length && RELLENO.has(sin.at(-1))) sin.pop();
    const lista = [sin.join(' ')];
    const ultima = ps.at(-1);
    if (ultima.length > 2 && ultima.endsWith('s')) lista.push([...ps.slice(0, -1), ultima.slice(0, -1)].join(' '));
    return lista.filter(Boolean);
  };
  const primeras = contar(etiquetas.map((e) => e.ps[0]));
  const porVariante = contar(etiquetas.flatMap((e) => [...new Set(variantes(e.ps))]));
  const porPalabra = contar(etiquetas.flatMap((e) => [...new Set(e.ps)]));
  const completos = new Set(etiquetas.map((e) => e.completo));

  const candidatos = [];
  etiquetas.forEach(({ agente, completo, ps }) => {
    if (completo) candidatos.push({ agente, c: completo });
    if (ps.length < 2) return;
    const alias = new Set();
    if (ps[0].length >= 2 && primeras[ps[0]] === 1) alias.add(ps[0]);
    variantes(ps).forEach((v) => {
      if (porVariante[v] === 1) alias.add(v);
    });
    // Palabra distintiva: ningún otro nombre la tiene.
    ps.forEach((p) => {
      if (p.length >= 3 && !RELLENO.has(p) && porPalabra[p] === 1) alias.add(p);
    });
    alias.forEach((c) => {
      if (c !== completo && !completos.has(c)) candidatos.push({ agente, c });
    });
  });
  // Un alias que apunte a dos trabajadores distintos no sirve.
  const duenos = {};
  candidatos.forEach(({ agente, c }) => {
    duenos[c] = duenos[c] || new Set();
    duenos[c].add(agente.id);
  });
  for (let i = candidatos.length - 1; i >= 0; i -= 1) {
    if (duenos[candidatos[i].c].size > 1 && !completos.has(candidatos[i].c)) candidatos.splice(i, 1);
  }
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
  zonaHoraria = 'America/Mexico_City',
}) {
  // Meta manda los celulares de México como 521…; se comparan y se contestan como 52….
  const permitidosN = [...new Set(permitidos.map(normalizarNumero).filter(Boolean))];
  // Cola de trabajo por número: sus mensajes se atienden uno tras otro, en orden.
  const cadenas = {};

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

  // Los números cortos nunca se reutilizan: un "aprobar 3" viejo jamás aprueba otra cosa.
  function limpiarNumeros() {
    const ids = new Set(abiertos().map((i) => i.id));
    Object.entries(estado.numeros).forEach(([n, id]) => {
      if (!ids.has(id)) delete estado.numeros[n];
    });
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
    for (const num of permitidosN) {
      if (ventanaAbierta(num)) {
        await responder(num, formatoAviso(n, item));
        continue;
      }
      estado.cola[num] = [...new Set([...(estado.cola[num] || []), item.id])];
      const yaAvisado = estado.plantillaEnviadaEn[num] && estado.plantillaEnviadaEn[num] > (estado.ultimoMensaje[num] || '');
      if (plantilla?.nombre && !yaAvisado) {
        // Se marca ANTES de enviar para que dos avisos simultáneos no manden dos plantillas.
        const previo = estado.plantillaEnviadaEn[num];
        estado.plantillaEnviadaEn[num] = now().toISOString();
        guardar();
        try {
          await whatsapp.enviarPlantilla(num, plantilla.nombre, plantilla.idioma || 'es_MX', [String(estado.cola[num].length)]);
        } catch (err) {
          if (previo === undefined) delete estado.plantillaEnviadaEn[num];
          else estado.plantillaEnviadaEn[num] = previo;
          registrar(null, 'error', `WhatsApp: no pude mandar la plantilla de aviso (${err.message})`);
        }
      }
      guardar();
    }
  }

  // ---------- Comandos ----------
  async function comando(num, texto) {
    const t = formaComando(texto);
    if (esPendientes(texto)) {
      limpiarNumeros();
      const items = abiertos();
      const cuerpo = items.length
        ? `Tienes ${items.length} pendiente(s):\n\n${items.map((i) => formatoAviso(numeroDe(i.id), i)).join('\n\n')}`
        : 'No hay pendientes ✨';
      guardar();
      await responder(num, cuerpo);
      return true;
    }
    if (t === 'ayuda' || /^\s*[¿?]+\s*$/.test(texto)) {
      const nombres = agentes().map((a) => a.label).join(', ');
      await responder(
        num,
        'Escríbeme o mándame un audio. Empieza con el nombre del trabajador para ir directo (p. ej. "PM, ¿cómo va el equipo?"); ' +
          'si no, yo elijo. También: *pendientes*, *aprobar N*, *descartar N*.\n' +
          `Trabajadores: ${nombres}`
      );
      return true;
    }
    const m = t.match(/^(aprobar|aprueba|apruebo|descartar|descarta|descarto)\s+#?\s*(\d+)$/);
    if (!m) return false;
    const n = Number(m[2]);
    limpiarNumeros();
    const id = estado.numeros[n];
    guardar();
    const item = id ? abiertos().find((i) => i.id === id) : null;
    if (!item) {
      await responder(num, `No encuentro el pendiente #${n}. Escribe *pendientes* para ver la lista.`);
      return true;
    }
    const titulo = item.titulo ? ` (${item.titulo})` : '';
    const aprobar = m[1].startsWith('apr'); // aprobar | aprueba | apruebo
    try {
      if (aprobar) {
        const r = await aprobaciones.aprobar(id);
        await responder(num, r.estado === 'aprobado' ? `✅ #${n} aprobado y ejecutado${titulo}.` : `⚠️ #${n}${titulo} falló: ${r.error}`);
      } else {
        aprobaciones.descartar(id);
        await responder(num, `🗑️ #${n} descartado${titulo}.`);
      }
    } catch (err) {
      await responder(num, `⚠️ No pude ${aprobar ? 'aprobar' : 'descartar'} #${n}: ${err.message}`);
    }
    return true;
  }

  // ---------- Ruteo ----------
  /** ¿Conversar o correr el ciclo? Solo pregunta a la IA si el texto suena a ciclo. */
  async function accionPara(texto, agente) {
    if (!CICLO_RE.test(palabras(texto).join(' '))) return 'chat';
    try {
      const r = await enrutarConIA(texto, [agente]);
      return r?.accion === 'forzar_ciclo' ? 'forzar_ciclo' : 'chat';
    } catch {
      return 'chat'; // si la IA falla, se conversa
    }
  }

  /** "Prospectos", "Buscador de Prospectos, va", "Seguimiento proyectos": solo el nombre, sin pedido. */
  function soloNombre(resto, agente) {
    if (resto.length <= 3) return true;
    const delNombre = new Set(palabras(agente.label));
    return palabras(resto).every((p) => delNombre.has(p) || RELLENO.has(p));
  }

  async function rutear(num, texto) {
    const lista = agentes();
    const directo = detectarPorNombre(texto, lista);
    if (directo) {
      let resto = directo.resto;
      const previo = estado.sinRuta[num];
      if (previo && reciente(previo.at, SEGUIMIENTO_MS) && soloNombre(resto, directo.agente)) resto = previo.texto;
      delete estado.sinRuta[num];
      if (!resto) {
        await responder(num, `¿Qué le digo a ${directo.agente.label}?`);
        return null;
      }
      return { agentId: directo.agente.id, accion: await accionPara(resto, directo.agente), texto: resto };
    }

    const ultimo = estado.ultimoAgente[num];
    const agenteUltimo = ultimo && reciente(ultimo.at, SEGUIMIENTO_MS) && lista.find((a) => a.id === ultimo.agentId);
    if (agenteUltimo) {
      return { agentId: agenteUltimo.id, accion: await accionPara(texto, agenteUltimo), texto };
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
    const marcar = () => {
      estado.ultimoAgente[num] = { agentId, at: now().toISOString() };
      guardar();
    };
    marcar();
    registrar(agentId, 'chat', `📱 WhatsApp: ${texto}`);
    if (accion === 'forzar_ciclo') {
      await responder(num, `⏳ Le pido a ${label} que corra su ciclo ahora…`);
      try {
        await responderAgente(num, label, `✅ Ciclo terminado: ${await forzarCiclo(agentId)}`, conVoz);
      } catch (err) {
        await responder(num, `⚠️ ${label} no pudo correr su ciclo: ${err.message}`);
      }
    } else {
      await responder(num, `⏳ Se lo paso a ${label}…`);
      try {
        await responderAgente(num, label, await chatDe(agentId, texto), conVoz);
      } catch (err) {
        await responder(num, `⚠️ No pude completar tu pedido con ${label}: ${err.message}`);
      }
    }
    // Los 15 min de seguimiento cuentan desde que el fundador recibió la respuesta.
    marcar();
  }

  function horaLocal(ms) {
    try {
      return new Date(ms).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: zonaHoraria });
    } catch {
      return new Date(ms).toISOString();
    }
  }

  async function manejar(num, m) {
    // La ventana de 24 h cuenta desde que el fundador escribió (no desde que Meta lo entregó).
    const ahora = now().getTime();
    const enviadoMs = m.fecha ? Date.parse(m.fecha) : NaN;
    const momento = Number.isFinite(enviadoMs) ? Math.min(enviadoMs, ahora) : ahora;
    const iso = new Date(momento).toISOString();
    if (!estado.ultimoMensaje[num] || estado.ultimoMensaje[num] < iso) estado.ultimoMensaje[num] = iso;
    guardar();

    // Mensaje viejo (p. ej. reintento de Meta tras una caída): no se ejecuta nada.
    if (ahora - momento > TARDE_MS) {
      const extracto = Array.from(String(m.texto || '').trim()).slice(0, 80).join('') || (m.tipo === 'audio' ? 'nota de voz' : 'sin texto');
      await responder(num, `⏰ Me llegó tarde tu mensaje del ${horaLocal(momento)} («${extracto}»). Si aún lo necesitas, mándamelo de nuevo.`);
      return;
    }

    if (m.tipo === 'otro') {
      await entregarCola(num);
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
        await entregarCola(num);
        await responder(num, `⚠️ No pude entender el audio: ${err.message}`);
        return;
      }
      await responder(num, `🎙️ Entendí: "${texto}"`);
    }
    texto = String(texto || '').trim();
    // "pendientes" ya lista todo lo abierto: no se repiten los avisos acumulados.
    if (esPendientes(texto)) {
      if (estado.cola[num]) {
        delete estado.cola[num];
        guardar();
      }
    } else {
      await entregarCola(num);
    }
    if (!texto) return;
    if (await comando(num, texto)) return;
    const ruta = await rutear(num, texto);
    if (ruta) await ejecutar(num, ruta, fueAudio);
  }

  function procesar(m) {
    if (!m?.id || estado.vistos.includes(m.id)) return Promise.resolve();
    estado.vistos.push(m.id);
    estado.vistos = estado.vistos.slice(-MAX_VISTOS);
    const num = normalizarNumero(m.de);
    if (!permitidosN.includes(num)) {
      guardar();
      registrar(null, 'error', `WhatsApp: ignoré un mensaje de un número no permitido (${enmascarar(num)})`);
      return Promise.resolve();
    }
    // Uno tras otro por número: la respuesta del primero llega antes que el aviso del segundo.
    const cadena = (cadenas[num] || Promise.resolve())
      .then(() => manejar(num, m))
      .catch((err) => registrar(null, 'error', `WhatsApp: ${err.message}`));
    cadenas[num] = cadena;
    return cadena;
  }

  function estadoCanal() {
    return {
      permitidos: permitidosN.map(enmascarar),
      ventanas: Object.fromEntries(permitidosN.map((n) => [enmascarar(n), ventanaAbierta(n)])),
    };
  }

  return { procesar, avisarAprobacion, estadoCanal };
}

module.exports = { createRecepcionWhatsapp, crearEnrutadorIA, detectarPorNombre, normalizar };
