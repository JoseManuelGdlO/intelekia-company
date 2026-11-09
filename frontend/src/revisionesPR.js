import { fetchRevisionesPR } from './api.js';
import { fechaCorta, haceCuanto } from './fechas.js';

const ETIQUETAS = {
  aprobado_mergeado: '✅ Aprobado y mergeado',
  cambios_pedidos: '✏️ Cambios pedidos',
  bloqueado: '⛔ Bloqueado',
  error: '⚠️ Error (se reintenta)',
};

function el(tag, props = {}) {
  return Object.assign(document.createElement(tag), props);
}

/** Muestra la lista de PRs revisados en el panel, solo para el Revisor de PRs. */
export async function mostrarRevisionesPR(agentId) {
  const box = document.getElementById('panel-prs');
  box.hidden = agentId !== 'revisor-prs';
  if (box.hidden) return;
  const list = document.getElementById('panel-prs-list');
  const count = document.getElementById('panel-prs-count');
  list.innerHTML = '';
  let items;
  try {
    items = await fetchRevisionesPR();
  } catch (err) {
    list.appendChild(el('div', { className: 'team-empty', textContent: `No se pudieron cargar: ${err.message}` }));
    return;
  }
  count.textContent = items.length ? `(${items.length})` : '';
  if (!items.length) {
    list.appendChild(el('div', { className: 'team-empty', textContent: 'Todavía no ha revisado ningún PR.' }));
    return;
  }
  items.forEach((pr) => {
    const card = el('div', { className: 'team-msg' });
    const who = el('div', { className: 'who' });
    who.appendChild(el('a', { href: pr.url, target: '_blank', rel: 'noopener', textContent: `${pr.clave} · ${pr.titulo || ''}` }));
    const detalle = `${ETIQUETAS[pr.veredicto] || pr.veredicto} · de ${pr.autor || '?'} · commit ${String(pr.sha || '').slice(0, 7)} · ${fechaCorta(pr.revisadoEn)} (${haceCuanto(pr.revisadoEn)})`;
    card.append(who, el('div', { className: 'q', textContent: detalle }));
    if (pr.motivo) card.appendChild(el('div', { className: 'a', textContent: pr.motivo }));
    list.appendChild(card);
  });
}
