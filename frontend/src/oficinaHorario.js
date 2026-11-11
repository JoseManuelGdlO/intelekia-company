import { fetchOficina, guardarHorario, abrirOficina, cerrarOficina } from './api.js';

const DIAS = [
  [1, 'L'],
  [2, 'M'],
  [3, 'Mi'],
  [4, 'J'],
  [5, 'V'],
  [6, 'S'],
  [0, 'D'],
];
const NOMBRES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function $(id) {
  return document.getElementById(id);
}

/** Botón "Oficina abierta/cerrada" y ventana de horario de trabajo. */
export function createOficinaHorario() {
  const boton = $('oficina-btn');
  const botonHorario = $('horario-btn');
  const modal = $('horario-modal');
  const toast = $('horario-toast');
  let estado = null;
  let ocupado = false;
  let toastTimer = null;

  function notify(texto, error = false) {
    toast.textContent = texto;
    toast.classList.toggle('error', error);
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  function pintarBoton() {
    if (!estado) return;
    boton.classList.toggle('cerrada', !estado.abierta);
    boton.classList.toggle('fuera', estado.abierta && !estado.puedeTrabajar);
    boton.textContent = !estado.abierta ? '🔴 Oficina cerrada' : estado.puedeTrabajar ? '🟢 Oficina abierta' : '🌙 Fuera de horario';
    boton.title = `${estado.motivo}\nClic para ${estado.abierta ? 'cerrar' : 'abrir'} la oficina.`;
    botonHorario.title = estado.respetarHorario ? `Horario: ${estado.entrada}–${estado.salida}` : 'Sin horario (clic para configurarlo)';
  }

  function pintarModal() {
    if (!estado) return;
    $('horario-respetar').checked = estado.respetarHorario;
    $('horario-entrada').value = estado.entrada;
    $('horario-salida').value = estado.salida;
    const caja = $('horario-dias');
    caja.innerHTML = '';
    DIAS.forEach(([d, letra]) => {
      const label = document.createElement('label');
      label.className = 'horario-dia';
      label.title = NOMBRES[d];
      const input = Object.assign(document.createElement('input'), { type: 'checkbox', value: String(d), checked: estado.dias.includes(d) });
      label.append(input, document.createTextNode(letra));
      caja.append(label);
    });
    $('horario-estado').textContent = `Ahora: ${estado.motivo}`;
  }

  async function refresh() {
    try {
      estado = await fetchOficina();
      pintarBoton();
    } catch (err) {
      console.error('No se pudo leer el horario de la oficina', err);
    }
  }

  boton.addEventListener('click', async () => {
    if (ocupado || !estado) return;
    if (estado.abierta && !window.confirm('¿Cerrar la oficina? Los trabajadores no iniciarán ciclos automáticos hasta que la abras.')) return;
    ocupado = true;
    try {
      estado = await (estado.abierta ? cerrarOficina() : abrirOficina());
      pintarBoton();
    } catch (err) {
      window.alert(`No se pudo cambiar: ${err.message}`);
    } finally {
      ocupado = false;
    }
  });

  botonHorario.addEventListener('click', async () => {
    await refresh();
    pintarModal();
    modal.classList.add('visible');
  });

  const cerrarModal = () => modal.classList.remove('visible');
  $('horario-close').addEventListener('click', cerrarModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('visible')) cerrarModal();
  });

  $('horario-save').addEventListener('click', async () => {
    const dias = [...$('horario-dias').querySelectorAll('input:checked')].map((i) => Number(i.value));
    const respetarHorario = $('horario-respetar').checked;
    if (respetarHorario && !dias.length) {
      notify('Marca al menos un día de trabajo', true);
      return;
    }
    try {
      estado = await guardarHorario({ respetarHorario, dias, entrada: $('horario-entrada').value, salida: $('horario-salida').value });
      pintarBoton();
      pintarModal();
      notify('Horario guardado');
    } catch (err) {
      notify(err.message, true);
    }
  });

  refresh();
  return { refresh };
}
