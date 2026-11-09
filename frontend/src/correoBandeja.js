import { fetchCorreoEstado, fetchCorreos, aprobarCorreo, descartarCorreo } from './api.js';

function $(id) {
  return document.getElementById(id);
}

function splitList(value) {
  return value
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Lo que el fundador va editando en cada correo (id → { para, cc, asunto, cuerpo }). La bandeja
// se vuelve a pintar cada pocos segundos; sin esto se perderían sus ediciones.
const borradores = new Map();
const CAMPOS = ['para', 'cc', 'asunto', 'cuerpo'];

function esCampo(node) {
  return Boolean(node) && (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT');
}

/**
 * Bandeja de correos "por aprobar": los que los agentes quisieron enviar fuera de la lista
 * permitida o por encima del límite diario. El fundador los edita, envía o descarta.
 */
export function createCorreoBandeja({ labelOf, onCorreo }) {
  const modal = $('mail-modal');
  const button = $('mail-inbox-btn');
  const toast = $('mail-toast');
  const seen = new Set();
  let primed = false;
  let toastTimer = null;

  function notify(text, isError = false) {
    toast.textContent = text;
    toast.classList.toggle('error', isError);
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  function field(label, value, { multiline = false, rows = 8 } = {}) {
    const wrap = document.createElement('label');
    wrap.className = 'mail-edit';
    const span = Object.assign(document.createElement('span'), { textContent: label });
    const input = document.createElement(multiline ? 'textarea' : 'input');
    if (multiline) input.rows = rows;
    else input.type = 'text';
    input.value = value;
    input.spellcheck = multiline;
    wrap.append(span, input);
    return { wrap, input };
  }

  function renderPending(items) {
    const box = $('mail-pending');
    // Conserva el foco y el cursor si el fundador estaba escribiendo.
    const activo = box.contains(document.activeElement) && esCampo(document.activeElement) ? document.activeElement : null;
    const foco = activo ? { id: activo.dataset.mailId, campo: activo.dataset.campo, inicio: activo.selectionStart, fin: activo.selectionEnd } : null;
    const abiertos = new Set(items.map((i) => i.id));
    [...borradores.keys()].forEach((id) => {
      if (!abiertos.has(id)) borradores.delete(id);
    });
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = '<div class="skill-empty">No hay correos esperando tu aprobación.</div>';
      return;
    }
    items
      .slice()
      .reverse()
      .forEach((item) => {
        const card = document.createElement('div');
        card.className = 'mail-item';
        const head = document.createElement('div');
        head.className = 'mail-item-head';
        const fecha = new Date(item.creadoEn).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
        head.innerHTML = '<b class="who"></b><span class="when"></span>';
        head.querySelector('.who').textContent = `${labelOf(item.agentId)} quiere enviar`;
        head.querySelector('.when').textContent = fecha;
        const motivo = Object.assign(document.createElement('div'), {
          className: 'tool-warning',
          textContent: item.estado === 'error' ? `Falló al enviar: ${item.error}` : item.motivo,
        });
        const guardado = borradores.get(item.id) || {};
        const para = field('Para', guardado.para ?? item.para.join(', '));
        const cc = field('CC', guardado.cc ?? (item.cc || []).join(', '));
        const asunto = field('Asunto', guardado.asunto ?? item.asunto);
        const cuerpo = field('Mensaje', guardado.cuerpo ?? item.cuerpo, { multiline: true });
        const campos = { para, cc, asunto, cuerpo };
        CAMPOS.forEach((nombre) => {
          const { input } = campos[nombre];
          input.dataset.mailId = item.id;
          input.dataset.campo = nombre;
          input.addEventListener('input', () => {
            borradores.set(item.id, Object.fromEntries(CAMPOS.map((n) => [n, campos[n].input.value])));
          });
        });

        const actions = document.createElement('div');
        actions.className = 'perfil-actions';
        const descartar = Object.assign(document.createElement('button'), { className: 'btn ghost', textContent: 'Descartar' });
        const enviar = Object.assign(document.createElement('button'), { className: 'btn primary', textContent: 'Enviar correo' });
        actions.append(descartar, enviar);

        descartar.addEventListener('click', async () => {
          if (!descartar.classList.contains('armed')) {
            descartar.classList.add('armed');
            descartar.textContent = '¿Descartar? Clic de nuevo';
            setTimeout(() => {
              descartar.classList.remove('armed');
              descartar.textContent = 'Descartar';
            }, 3000);
            return;
          }
          try {
            await descartarCorreo(item.id);
            borradores.delete(item.id);
            notify('Correo descartado');
            await refresh();
          } catch (err) {
            notify(err.message, true);
          }
        });
        enviar.addEventListener('click', async () => {
          enviar.disabled = true;
          enviar.textContent = 'Enviando…';
          try {
            const result = await aprobarCorreo(item.id, {
              para: splitList(para.input.value),
              cc: splitList(cc.input.value),
              asunto: asunto.input.value,
              cuerpo: cuerpo.input.value,
            });
            if (result.estado === 'enviado') borradores.delete(item.id);
            notify(result.estado === 'enviado' ? `Enviado a ${result.para.join(', ')} ✓` : `No se pudo enviar: ${result.error}`, result.estado !== 'enviado');
            await refresh();
          } catch (err) {
            notify(err.message, true);
          } finally {
            enviar.disabled = false;
            enviar.textContent = 'Enviar correo';
          }
        });

        card.append(head, motivo, para.wrap, cc.wrap, asunto.wrap, cuerpo.wrap, actions);
        box.appendChild(card);
        if (foco && foco.id === item.id && campos[foco.campo]) {
          const { input } = campos[foco.campo];
          input.focus();
          try {
            input.setSelectionRange(foco.inicio, foco.fin);
          } catch {
            // algunos campos no admiten selección
          }
        }
      });
  }

  function renderSent(items) {
    const box = $('mail-sent');
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = '<div class="skill-empty">Aún no se ha enviado ningún correo.</div>';
      return;
    }
    items
      .slice()
      .reverse()
      .forEach((item) => {
        const row = document.createElement('details');
        row.className = 'bd-row mail-row sent-row';
        const fecha = new Date(item.enviadoEn || item.creadoEn).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
        const summary = document.createElement('summary');
        summary.append(
          Object.assign(document.createElement('div'), { className: 'bd-meta', textContent: `✓ Enviado ${fecha} · ${labelOf(item.agentId)} → ${item.para.join(', ')}` }),
          Object.assign(document.createElement('div'), { className: 'mail-subject', textContent: item.asunto })
        );
        const body = Object.assign(document.createElement('pre'), { className: 'mail-body', textContent: item.cuerpo });
        row.append(summary, body);
        box.appendChild(row);
      });
  }

  /** Actualiza el contador; avisa de correos nuevos (enviados o por aprobar) al feed. */
  async function refresh() {
    try {
      const [estado, recientes] = await Promise.all([fetchCorreoEstado(), fetchCorreos({ limite: 100 })]);
      // Siempre visible si el correo está configurado; el número indica cuántos esperan aprobación.
      button.hidden = !estado.configurado;
      const badge = $('mail-inbox-count');
      badge.textContent = estado.porAprobar;
      badge.hidden = estado.porAprobar === 0;
      button.classList.toggle('pending', estado.porAprobar > 0);
      button.title = estado.porAprobar ? `${estado.porAprobar} correo(s) esperan tu aprobación` : `Correos enviados por los agentes · hoy: ${estado.enviadosHoy}`;
      recientes.forEach((item) => {
        const key = `${item.id}:${item.estado}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (primed && ['enviado', 'por_aprobar', 'error'].includes(item.estado)) onCorreo?.(item);
      });
      primed = true;
      if (modal.classList.contains('visible')) {
        const pendientes = recientes.filter((c) => c.estado === 'por_aprobar' || c.estado === 'error');
        const enviados = recientes.filter((c) => c.estado === 'enviado').slice(-30);
        $('mail-pending-count').textContent = `(${pendientes.length})`;
        $('mail-sent-count').textContent = `(${enviados.length})`;
        renderPending(pendientes);
        renderSent(enviados);
      }
    } catch (err) {
      // El correo es opcional: si el backend no lo soporta, simplemente no se muestra.
      button.hidden = true;
    }
  }

  async function open() {
    modal.classList.add('visible');
    await refresh();
  }

  function close() {
    modal.classList.remove('visible');
    refresh();
  }

  button.addEventListener('click', open);
  $('mail-modal-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !modal.classList.contains('visible')) return;
    // Esc dentro de un campo solo quita el foco: no cierra ni pierde lo escrito.
    if (esCampo(e.target) && modal.contains(e.target)) {
      e.target.blur();
      return;
    }
    close();
  });

  return { refresh, open };
}
