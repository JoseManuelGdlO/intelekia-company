import { fetchOficina, guardarHorario, guardarLimiteGasto, abrirOficina, cerrarOficina } from './api.js';

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
const dinero = (n) => `$${Number(n || 0).toFixed(2)}`;
const miles = (n) => Number(n || 0).toLocaleString('es-MX');

function $(id) {
  return document.getElementById(id);
}

/** Botón "Oficina abierta/cerrada" y ventana de horario de trabajo. */
export function createOficinaHorario() {
  const boton = $('oficina-btn');
  const botonHorario = $('horario-btn');
  const chipGasto = $('gasto-chip');
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
    if (!estado.abierta) boton.textContent = '🔴 Oficina cerrada';
    else if (estado.puedeTrabajar) boton.textContent = '🟢 Oficina abierta';
    else boton.textContent = estado.frenadoPorGasto ? '💵 Límite alcanzado' : '🌙 Fuera de horario';
    boton.title = `${estado.motivo}\nClic para ${estado.abierta ? 'cerrar' : 'abrir'} la oficina.`;
    botonHorario.title = estado.respetarHorario ? `Horario: ${estado.entrada}–${estado.salida}` : 'Sin horario (clic para configurarlo)';
    pintarGasto();
  }

  /** Chip "💵 Hoy: $1.20 / $5.00": ámbar desde el 80 % del límite y rojo al llegar. */
  function pintarGasto() {
    const g = estado.gasto;
    chipGasto.hidden = !g;
    if (!g) return;
    const limite = g.limiteUsd;
    chipGasto.textContent = `💵 Hoy: ${dinero(g.usd)}${limite ? ` / ${dinero(limite)}` : ''}`;
    chipGasto.classList.toggle('excedido', !!g.excedido);
    chipGasto.classList.toggle('alerta', !g.excedido && !!limite && g.usd >= limite * 0.8);
    chipGasto.title = [
      `Gasto estimado de hoy en OpenAI: ${dinero(g.usd)}${limite ? ` de ${dinero(limite)}` : ' (sin límite)'}`,
      `${miles(g.llamadas)} llamadas · ${miles(g.tokensEntrada)} tokens de entrada · ${miles(g.tokensSalida)} de salida`,
      g.excedido ? 'Límite alcanzado: los ciclos automáticos vuelven mañana.' : 'Clic para poner o cambiar el límite.',
    ].join('\n');
  }

  function pintarModal() {
    if (!estado) return;
    $('horario-respetar').checked = estado.respetarHorario;
    $('horario-entrada').value = estado.entrada;
    $('horario-salida').value = estado.salida;
    $('horario-limite').value = estado.gasto?.limiteUsd ?? '';
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

  async function abrirModal() {
    await refresh();
    pintarModal();
    modal.classList.add('visible');
  }
  botonHorario.addEventListener('click', abrirModal);
  chipGasto.addEventListener('click', abrirModal);

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
    const textoLimite = $('horario-limite').value.trim();
    const limite = textoLimite === '' ? null : Number(textoLimite);
    if (limite !== null && (!Number.isFinite(limite) || limite < 0)) {
      notify('El límite de gasto debe ser 0 o más (vacío = sin límite)', true);
      return;
    }
    try {
      await guardarHorario({ respetarHorario, dias, entrada: $('horario-entrada').value, salida: $('horario-salida').value });
      estado = await guardarLimiteGasto(limite);
      pintarBoton();
      pintarModal();
      notify('Horario y límite guardados');
    } catch (err) {
      notify(err.message, true);
    }
  });

  refresh();
  return { refresh };
}
