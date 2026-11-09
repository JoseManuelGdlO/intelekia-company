const fs = require('fs');
const path = require('path');

const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[a-z]{2,}$/i;
const MAX_DESTINATARIOS = 10;
const MAX_ASUNTO = 200;
const MAX_CUERPO = 10000;
const MAX_LOG = 300;
const DEDUPE_HORAS = 12;
const DEFAULT_LIMITE_DIARIO = 20;

function normalizarDireccion(raw) {
  return String(raw || '').trim().toLowerCase();
}

function esDireccionValida(email) {
  return EMAIL_RE.test(email);
}

/** Una regla de la lista blanca: correo exacto (ana@x.com) o dominio completo (@x.com). */
function normalizarRegla(raw) {
  const regla = normalizarDireccion(raw);
  if (!regla) return null;
  if (regla.startsWith('@')) {
    if (!/^@[a-z0-9.-]+\.[a-z]{2,}$/i.test(regla)) throw new Error(`Dominio inválido: ${raw}`);
    return regla;
  }
  if (!esDireccionValida(regla)) throw new Error(`Correo inválido: ${raw}`);
  return regla;
}

function cumpleRegla(email, regla) {
  return regla.startsWith('@') ? email.endsWith(regla) : email === regla;
}

/**
 * Correo saliente para los agentes (SMTP, p. ej. Hostinger).
 *
 * - Si TODOS los destinatarios están en la lista blanca y no se rebasa el límite diario,
 *   se envía directo.
 * - Si no, el correo queda "por_aprobar" hasta que el fundador lo apruebe o descarte.
 * - Se bloquean duplicados (mismo destinatario y asunto en las últimas 12 h).
 * Las credenciales viven en .env; la lista blanca y el límite, en state/correo.json.
 */
function createMailer({
  smtp,
  settingsPath,
  logPath,
  createTransport = (opts) => require('nodemailer').createTransport(opts),
  now = () => new Date(),
}) {
  const configured = Boolean(smtp.host && smtp.user && smtp.password);
  let transport = null;
  let log = [];
  if (logPath && fs.existsSync(logPath)) {
    try {
      log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    } catch {
      log = [];
    }
  }
  let counter = 0;

  function getTransport() {
    if (!transport) {
      transport = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.password },
      });
    }
    return transport;
  }

  function readSettings() {
    if (!settingsPath || !fs.existsSync(settingsPath)) return { permitidos: [], limiteDiario: DEFAULT_LIMITE_DIARIO };
    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return {
        permitidos: Array.isArray(raw.permitidos) ? raw.permitidos : [],
        limiteDiario: Number.isInteger(raw.limiteDiario) ? raw.limiteDiario : DEFAULT_LIMITE_DIARIO,
      };
    } catch {
      return { permitidos: [], limiteDiario: DEFAULT_LIMITE_DIARIO };
    }
  }

  function saveSettings({ permitidos, limiteDiario }) {
    const current = readSettings();
    const next = { ...current };
    if (permitidos !== undefined) {
      if (!Array.isArray(permitidos)) throw new Error('permitidos debe ser una lista');
      next.permitidos = [...new Set(permitidos.map(normalizarRegla).filter(Boolean))];
    }
    if (limiteDiario !== undefined) {
      const n = Number(limiteDiario);
      if (!Number.isInteger(n) || n < 0 || n > 500) throw new Error('El límite diario debe ser un número entre 0 y 500');
      next.limiteDiario = n;
    }
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
    return next;
  }

  function persist() {
    log = log.slice(-MAX_LOG);
    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
    }
  }

  function enviadosHoy() {
    const hoy = now().toISOString().slice(0, 10);
    return log.filter((c) => c.estado === 'enviado' && (c.enviadoEn || '').slice(0, 10) === hoy).length;
  }

  function remitente() {
    return smtp.fromName ? `"${smtp.fromName.replace(/"/g, '')}" <${smtp.user}>` : smtp.user;
  }

  function firma() {
    return smtp.firma ? `\n\n--\n${smtp.firma}` : '';
  }

  function validarCorreo({ para, cc = [], asunto, cuerpo }) {
    const lista = (Array.isArray(para) ? para : [para]).map(normalizarDireccion).filter(Boolean);
    const copia = (Array.isArray(cc) ? cc : [cc]).map(normalizarDireccion).filter(Boolean);
    if (!lista.length) throw new Error('Falta el destinatario (para)');
    if (lista.length + copia.length > MAX_DESTINATARIOS) throw new Error(`Máximo ${MAX_DESTINATARIOS} destinatarios por correo`);
    const invalido = [...lista, ...copia].find((e) => !esDireccionValida(e));
    if (invalido) throw new Error(`Correo inválido: ${invalido}`);
    const subject = String(asunto || '').replace(/[\r\n]+/g, ' ').trim();
    if (!subject) throw new Error('Falta el asunto');
    if (subject.length > MAX_ASUNTO) throw new Error(`El asunto es muy largo (máximo ${MAX_ASUNTO})`);
    const body = String(cuerpo || '').trim();
    if (!body) throw new Error('Falta el cuerpo del correo');
    if (body.length > MAX_CUERPO) throw new Error(`El cuerpo es muy largo (máximo ${MAX_CUERPO} caracteres)`);
    return { para: lista, cc: copia, asunto: subject, cuerpo: body };
  }

  /** Copia oculta configurada en SMTP_BCC (tu buzón); no cuenta para la lista blanca ni el límite. */
  function copiaOculta() {
    return String(smtp.bcc || '')
      .split(',')
      .map(normalizarDireccion)
      .filter(esDireccionValida);
  }

  async function sendNow(item) {
    const bcc = copiaOculta();
    const info = await getTransport().sendMail({
      from: remitente(),
      to: item.para.join(', '),
      cc: item.cc.length ? item.cc.join(', ') : undefined,
      bcc: bcc.length ? bcc.join(', ') : undefined,
      replyTo: smtp.replyTo || undefined,
      subject: item.asunto,
      text: `${item.cuerpo}${firma()}`,
    });
    Object.assign(item, { estado: 'enviado', enviadoEn: now().toISOString(), messageId: info?.messageId || null, error: null, copiaOculta: bcc });
  }

  /**
   * Lo que llama la herramienta del agente. Devuelve el correo registrado con su estado:
   * enviado | por_aprobar | error. Lanza si los datos son inválidos o es un duplicado.
   */
  async function enviar({ agentId = null, para, cc, asunto, cuerpo }) {
    if (!configured) throw new Error('El correo no está configurado: faltan SMTP_HOST, SMTP_USER o SMTP_PASSWORD en backend/.env');
    const datos = validarCorreo({ para, cc, asunto, cuerpo });

    const limite = now().getTime() - DEDUPE_HORAS * 3600 * 1000;
    const duplicado = log.find(
      (c) =>
        ['enviado', 'por_aprobar'].includes(c.estado) &&
        Date.parse(c.creadoEn) > limite &&
        c.asunto.toLowerCase() === datos.asunto.toLowerCase() &&
        c.para.join(',') === datos.para.join(',')
    );
    if (duplicado) {
      throw new Error(`Ya existe un correo igual (${duplicado.estado === 'enviado' ? 'enviado' : 'por aprobar'}) en las últimas ${DEDUPE_HORAS} h; no lo repitas`);
    }

    counter += 1;
    const item = { id: `correo-${Date.now()}-${counter}`, agentId, ...datos, estado: 'por_aprobar', motivo: null, creadoEn: now().toISOString() };
    const { permitidos, limiteDiario } = readSettings();
    const fuera = [...datos.para, ...datos.cc].filter((e) => !permitidos.some((r) => cumpleRegla(e, r)));

    if (fuera.length) {
      item.motivo = `Destinatario(s) fuera de la lista permitida: ${fuera.join(', ')}`;
    } else if (enviadosHoy() >= limiteDiario) {
      item.motivo = `Se alcanzó el límite diario de ${limiteDiario} correos`;
    }

    log.push(item);
    if (!item.motivo) {
      try {
        await sendNow(item);
      } catch (err) {
        Object.assign(item, { estado: 'error', error: err.message });
      }
    }
    persist();
    return item;
  }

  function find(id) {
    const item = log.find((c) => c.id === id);
    if (!item) throw new Error(`Correo desconocido: ${id}`);
    return item;
  }

  /** El fundador aprueba (y opcionalmente edita) un correo pendiente o que falló. */
  async function aprobar(id, cambios = {}) {
    if (!configured) throw new Error('El correo no está configurado en backend/.env');
    const item = find(id);
    if (!['por_aprobar', 'error'].includes(item.estado)) throw new Error(`Este correo ya está ${item.estado}`);
    const datos = validarCorreo({
      para: cambios.para ?? item.para,
      cc: cambios.cc ?? item.cc,
      asunto: cambios.asunto ?? item.asunto,
      cuerpo: cambios.cuerpo ?? item.cuerpo,
    });
    Object.assign(item, datos, { aprobadoEn: now().toISOString() });
    try {
      await sendNow(item);
    } catch (err) {
      Object.assign(item, { estado: 'error', error: err.message });
    }
    persist();
    return item;
  }

  function descartar(id) {
    const item = find(id);
    if (item.estado !== 'por_aprobar' && item.estado !== 'error') throw new Error(`Este correo ya está ${item.estado}`);
    Object.assign(item, { estado: 'descartado', descartadoEn: now().toISOString() });
    persist();
    return item;
  }

  function list({ estado, agentId, limite = 50 } = {}) {
    let items = log;
    if (estado) items = items.filter((c) => c.estado === estado);
    if (agentId) items = items.filter((c) => c.agentId === agentId);
    return items.slice(-limite);
  }

  async function test() {
    if (!configured) throw new Error('El correo no está configurado en backend/.env');
    await getTransport().verify();
    return { ok: true, remitente: smtp.user };
  }

  function status() {
    const settings = readSettings();
    return {
      configurado: configured,
      remitente: configured ? smtp.user : null,
      nombre: smtp.fromName || null,
      servidor: configured ? `${smtp.host}:${smtp.port}` : null,
      copiaOculta: copiaOculta(),
      permitidos: settings.permitidos,
      limiteDiario: settings.limiteDiario,
      enviadosHoy: enviadosHoy(),
      porAprobar: log.filter((c) => c.estado === 'por_aprobar').length,
    };
  }

  return { isConfigured: () => configured, enviar, aprobar, descartar, list, test, status, saveSettings, cumpleRegla };
}

module.exports = { createMailer, normalizarRegla, esDireccionValida, cumpleRegla, MAX_DESTINATARIOS, DEDUPE_HORAS };
