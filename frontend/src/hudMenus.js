/**
 * Menús desplegables de la barra superior (Vista, Bandeja, Oficina).
 * Se abren con clic, se cierran con clic afuera, Esc o al elegir una opción.
 * Además suma los pendientes de Aprobaciones y Correos en el globo de "Bandeja".
 */
export function createHudMenus() {
  const menus = [...document.querySelectorAll('.hud-menu')];

  function cerrarTodos(excepto = null) {
    menus.forEach((m) => {
      if (m === excepto) return;
      m.classList.remove('open');
      m.querySelector('.hud-btn')?.setAttribute('aria-expanded', 'false');
    });
  }

  menus.forEach((menu) => {
    const boton = menu.querySelector('.hud-btn');
    boton.addEventListener('click', (e) => {
      e.stopPropagation();
      const abrir = !menu.classList.contains('open');
      cerrarTodos(menu);
      menu.classList.toggle('open', abrir);
      boton.setAttribute('aria-expanded', String(abrir));
    });
    // Elegir una opción cierra el menú (la acción de la opción sigue su curso).
    menu.querySelector('.hud-dropdown').addEventListener('click', (e) => {
      if (e.target.closest('.menu-item')) cerrarTodos();
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.hud-menu')) cerrarTodos();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarTodos();
  });

  // Globo de Bandeja = Aprobaciones + Correos pendientes (los módulos de cada bandeja actualizan su propio globo).
  const total = document.getElementById('bandeja-count');
  const bandejaBtn = document.getElementById('bandeja-btn');
  const fuentes = ['apr-inbox-count', 'mail-inbox-count'].map((id) => document.getElementById(id)).filter(Boolean);
  function sumar() {
    const n = fuentes.reduce((acc, el) => acc + (el.hidden || el.closest('[hidden]') ? 0 : Number(el.textContent) || 0), 0);
    total.textContent = n;
    total.hidden = n === 0;
    bandejaBtn.classList.toggle('pending', n > 0);
    bandejaBtn.title = n ? `${n} pendiente(s) de tu decisión` : 'Nada pendiente';
  }
  const observer = new MutationObserver(sumar);
  fuentes.forEach((el) => {
    observer.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    const item = el.closest('.menu-item');
    if (item) observer.observe(item, { attributes: true, attributeFilter: ['hidden'] });
  });
  sumar();

  return { cerrarTodos };
}
