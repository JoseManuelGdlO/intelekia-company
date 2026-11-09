import { fetchAprobaciones, aprobarAprobacion, descartarAprobacion } from './api.js';

function $(id) {
  return document.getElementById(id);
}

function el(tag, props = {}) {
  return Object.assign(document.createElement(tag), props);
}

function fecha(iso) {
  return iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

const ESTADO = { aprobado: '✓ Aprobado', descartado: '✕ Descartado' };

// Lo que el fundador va escribiendo en cada tarjeta (id → texto). La bandeja se vuelve a pintar
// cada pocos segundos; sin esto se perderían sus ediciones y se publicaría el texto original.
const borradores = new Map();

function esCampo(node) {
  return Boolean(node) && (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT');
}

/** Bandeja general: lo que los trabajadores proponen hacer y espera tu decisión. */
export function createAprobacionesBandeja({ labelOf }) {
  const modal = $('apr-modal');
  const button = $('apr-inbox-btn');
  const toast = $('apr-toast');
  let toastTimer = null;

  function notify(text, isError = false) {
    toast.textContent = text;
    toast.classList.toggle('error', isError);
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  function original(item) {
    const box = el('div', { className: 'apr-original' });
    const c = item.contexto || {};
    box.append(el('b', { textContent: `${c.autor || 'Alguien'}: ` }), document.createTextNode(c.comentario || ''));
    if (/^https:\/\//.test(c.permalink || '')) {
      box.append(document.createTextNode(' · '), el('a', { href: c.permalink, target: '_blank', rel: 'noopener', textContent: 'Ver publicación' }));
    }
    return box;
  }

  function renderPending(items) {
    const box = $('apr-pending');
    // Conserva el foco y el cursor si el fundador estaba escribiendo.
    const activo = box.contains(document.activeElement) && esCampo(document.activeElement) ? document.activeElement : null;
    const foco = activo ? { id: activo.dataset.aprId, inicio: activo.selectionStart, fin: activo.selectionEnd } : null;
    const abiertos = new Set(items.map((i) => i.id));
    [...borradores.keys()].forEach((id) => {
      if (!abiertos.has(id)) borradores.delete(id);
    });
    box.innerHTML = '';
    if (!items.length) {
      box.append(el('div', { className: 'skill-empty', textContent: 'No hay nada esperando tu aprobación.' }));
      return;
    }
    items
      .slice()
      .reverse()
      .forEach((item) => {
        const card = el('div', { className: 'mail-item' });
        const head = el('div', { className: 'mail-item-head' });
        head.append(el('b', { textContent: `${labelOf(item.agentId)} · ${item.titulo}` }), el('span', { className: 'when', textContent: fecha(item.creadoEn) }));
        const aviso = el('div', { className: 'tool-warning', textContent: item.estado === 'error' ? `Falló: ${item.error}` : item.motivo || 'Espera tu aprobación' });
        const wrap = el('label', { className: 'mail-edit' });
        const texto = el('textarea', { rows: 4, value: borradores.has(item.id) ? borradores.get(item.id) : item.propuesta || '' });
        texto.spellcheck = true;
        texto.dataset.aprId = item.id;
        texto.addEventListener('input', () => borradores.set(item.id, texto.value));
        wrap.append(el('span', { textContent: 'Respuesta propuesta (puedes editarla)' }), texto);

        const actions = el('div', { className: 'perfil-actions' });
        const descartar = el('button', { className: 'btn ghost', textContent: 'Descartar' });
        const aprobar = el('button', { className: 'btn primary', textContent: 'Aprobar y publicar' });
        actions.append(descartar, aprobar);

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
            await descartarAprobacion(item.id);
            borradores.delete(item.id);
            notify('Descartado');
            await refresh();
          } catch (err) {
            notify(err.message, true);
          }
        });
        aprobar.addEventListener('click', async () => {
          aprobar.disabled = true;
          aprobar.textContent = 'Publicando…';
          try {
            const r = await aprobarAprobacion(item.id, { propuesta: texto.value });
            if (r.estado === 'aprobado') borradores.delete(item.id);
            notify(r.estado === 'aprobado' ? 'Publicado ✓' : `No se pudo: ${r.error}`, r.estado !== 'aprobado');
            await refresh();
          } catch (err) {
            notify(err.message, true);
          } finally {
            aprobar.disabled = false;
            aprobar.textContent = 'Aprobar y publicar';
          }
        });

        card.append(head, aviso, original(item), wrap, actions);
        box.appendChild(card);
        if (foco && foco.id === item.id) {
          texto.focus();
          try {
            texto.setSelectionRange(foco.inicio, foco.fin);
          } catch {
            // algunos campos no admiten selección
          }
        }
      });
  }

  function renderDone(items) {
    const box = $('apr-done');
    box.innerHTML = '';
    if (!items.length) {
      box.append(el('div', { className: 'skill-empty', textContent: 'Todavía no has resuelto ninguna.' }));
      return;
    }
    items
      .slice()
      .reverse()
      .forEach((item) => {
        const row = el('details', { className: 'bd-row mail-row' });
        const summary = el('summary');
        summary.append(
          el('div', { className: 'bd-meta', textContent: `${ESTADO[item.estado] || item.estado} ${fecha(item.resueltoEn)} · ${labelOf(item.agentId)} · ${item.titulo}` }),
          el('div', { className: 'mail-subject', textContent: item.propuesta || '(sin texto)' })
        );
        row.append(summary, original(item));
        box.appendChild(row);
      });
  }

  async function refresh() {
    try {
      // Los abiertos se piden aparte para que nunca se pierdan entre muchos resueltos.
      const [porAprobar, conError, recientes] = await Promise.all([
        fetchAprobaciones({ estado: 'por_aprobar', limite: 500 }),
        fetchAprobaciones({ estado: 'error', limite: 500 }),
        fetchAprobaciones({ limite: 200 }),
      ]);
      const { pendientes } = porAprobar;
      const badge = $('apr-inbox-count');
      badge.textContent = pendientes;
      badge.hidden = pendientes === 0;
      button.classList.toggle('pending', pendientes > 0);
      button.title = pendientes ? `${pendientes} acción(es) esperan tu aprobación` : 'Nada pendiente de aprobar';
      if (modal.classList.contains('visible')) {
        const abiertos = [...porAprobar.items, ...conError.items].sort((a, b) => String(a.creadoEn).localeCompare(String(b.creadoEn)));
        $('apr-pending-count').textContent = `(${abiertos.length})`;
        renderPending(abiertos);
        renderDone(recientes.items.filter((i) => i.estado === 'aprobado' || i.estado === 'descartado').slice(-20));
      }
    } catch {
      // Si el backend no responde, el botón queda sin contador.
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
  $('apr-modal-close').addEventListener('click', close);
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
