import { fetchComunicacion, saveReglaComunicacion, savePorDefectoComunicacion } from './api.js';

const ALCANCE_LABELS = {
  nadie: 'Nadie',
  area: 'Solo su área',
  todos: 'Todos',
  personalizado: 'Personalizado',
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') Object.entries(v).forEach(([prop, val]) => node.style.setProperty(prop, val));
    else node.setAttribute(k, v);
  });
  children.forEach((c) => c && node.appendChild(c));
  return node;
}

/**
 * Editor de "quién puede consultar a quién": una matriz donde cada fila es el trabajador
 * que pregunta y cada columna el compañero al que puede preguntarle.
 */
export function createComunicacionEditor({ getDepartments, accentOf, onChange, onToggleNetwork }) {
  const modal = document.getElementById('com-modal');
  const body = document.getElementById('com-body');
  const toast = document.getElementById('com-toast');
  const defaultSelect = document.getElementById('com-default');
  const networkToggle = document.getElementById('com-network');
  let data = null;
  let toastTimer = null;

  function notify(text, isError = false) {
    toast.textContent = text;
    toast.classList.toggle('error', isError);
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
  }

  async function apply(promise) {
    try {
      data = await promise;
      render();
      onChange(data);
      notify('Guardado ✓');
    } catch (err) {
      notify(err.message, true);
    }
  }

  function render() {
    const departments = getDepartments();
    const agents = departments.flatMap((d) => d.agents.map((a) => ({ ...a, departmentId: d.id })));
    defaultSelect.value = data.porDefecto;

    const table = el('table', { className: 'com-matrix' });
    const head1 = el('tr', {}, [
      el('th', { className: 'corner', rowspan: '2' }, [
        el('div', { text: 'Quién consulta ↓' }),
        el('div', { className: 'muted', text: 'a quién puede preguntarle →' }),
      ]),
      el('th', { className: 'rule-col', rowspan: '2', text: 'Regla' }),
    ]);
    const head2 = el('tr');
    departments.forEach((d) => {
      if (!d.agents.length) return;
      head1.appendChild(el('th', { className: 'dept-head', colspan: String(d.agents.length), style: { '--accent': accentOf(d.id) }, text: d.label }));
      d.agents.forEach((a) => {
        head2.appendChild(el('th', { className: 'agent-head', style: { '--accent': accentOf(d.id) }, title: a.label }, [el('span', { text: a.label })]));
      });
    });
    table.appendChild(el('thead', {}, [head1, head2]));

    const tbody = el('tbody');
    departments.forEach((d) => {
      if (!d.agents.length) return;
      tbody.appendChild(
        el('tr', { className: 'dept-row' }, [
          el('td', { colspan: String(agents.length + 2), style: { '--accent': accentOf(d.id) } }, [el('span', { text: d.label })]),
        ])
      );
      d.agents.forEach((origin) => {
        const rule = data.reglas[origin.id] || { alcance: data.porDefecto, heredada: true };
        const allowed = new Set(data.permitidos[origin.id] || []);

        const select = el('select', { 'aria-label': `Regla de ${origin.label}` });
        // Algunos agentes (como el PM) tienen su propio valor por defecto.
        const heredado = rule.heredada ? rule.alcance : data.porDefecto;
        select.appendChild(el('option', { value: 'heredar', text: `Por defecto (${ALCANCE_LABELS[heredado]})` }));
        Object.entries(ALCANCE_LABELS).forEach(([value, label]) => select.appendChild(el('option', { value, text: label })));
        select.value = rule.heredada ? 'heredar' : rule.alcance;
        select.addEventListener('change', () => {
          const alcance = select.value;
          apply(
            saveReglaComunicacion(origin.id, {
              alcance,
              permitidos: alcance === 'personalizado' ? [...allowed] : undefined,
            })
          );
        });

        const row = el('tr', {}, [
          el('th', { className: 'row-head', style: { '--accent': accentOf(d.id) } }, [el('span', { className: 'swatch' }), el('span', { text: origin.label })]),
          el('td', { className: 'rule-col' }, [select]),
        ]);

        agents.forEach((target) => {
          const cell = el('td', { className: `cell${target.departmentId === origin.departmentId ? ' same-area' : ''}` });
          cell.style.setProperty('--accent', accentOf(target.departmentId));
          if (target.id === origin.id) {
            cell.classList.add('self');
            cell.textContent = '—';
          } else {
            const box = el('input', { type: 'checkbox', title: `${origin.label} puede consultar a ${target.label}` });
            box.checked = allowed.has(target.id);
            box.addEventListener('change', () => {
              const next = new Set(allowed);
              if (box.checked) next.add(target.id);
              else next.delete(target.id);
              apply(saveReglaComunicacion(origin.id, { alcance: 'personalizado', permitidos: [...next] }));
            });
            cell.appendChild(box);
          }
          row.appendChild(cell);
        });
        tbody.appendChild(row);
      });
    });
    table.appendChild(tbody);
    body.innerHTML = '';
    body.appendChild(table);
  }

  async function open() {
    modal.classList.add('visible');
    try {
      data = await fetchComunicacion();
      render();
    } catch (err) {
      body.textContent = `No se pudieron cargar las reglas: ${err.message}`;
    }
  }

  function close() {
    modal.classList.remove('visible');
  }

  document.getElementById('com-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('visible')) close();
  });
  defaultSelect.addEventListener('change', () => apply(savePorDefectoComunicacion(defaultSelect.value, false)));
  document.querySelectorAll('[data-com-all]').forEach((button) => {
    button.addEventListener('click', () => apply(savePorDefectoComunicacion(button.dataset.comAll, true)));
  });
  networkToggle.addEventListener('change', () => onToggleNetwork(networkToggle.checked));

  return { open, close, isNetworkVisible: () => networkToggle.checked };
}
