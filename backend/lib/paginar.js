const POR_PAGINA_DEFECTO = 20;
const POR_PAGINA_MAX = 100;

function entero(valor, porDefecto) {
  const n = Math.floor(Number(valor));
  return Number.isFinite(n) ? n : porDefecto;
}

/**
 * Pagina una lista ordenada del más viejo al más nuevo y devuelve la página pedida
 * del más reciente al más antiguo. `porPagina` se limita a 1..100 y `pagina` a ≥1;
 * una página fuera de rango devuelve `lista: []`.
 */
function paginar(lista, { pagina = 1, porPagina = POR_PAGINA_DEFECTO } = {}) {
  const tam = Math.min(POR_PAGINA_MAX, Math.max(1, entero(porPagina, POR_PAGINA_DEFECTO)));
  const num = Math.max(1, entero(pagina, 1));
  const total = lista.length;
  const fin = total - (num - 1) * tam;
  const recortada = fin > 0 ? lista.slice(Math.max(0, fin - tam), fin).reverse() : [];
  return { lista: recortada, total, pagina: num, paginas: Math.max(1, Math.ceil(total / tam)) };
}

module.exports = { paginar, POR_PAGINA_DEFECTO, POR_PAGINA_MAX };
