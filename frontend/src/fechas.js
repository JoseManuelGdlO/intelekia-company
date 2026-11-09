/** Formatos de fecha/hora para la interfaz (hora local del navegador). */
function mismoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "hoy 15:30", "ayer 09:12" o "05/11 18:40" (con segundos si se pide). */
export function fechaCorta(iso, { segundos = false } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', ...(segundos ? { second: '2-digit' } : {}) });
  const hoy = new Date();
  const ayer = new Date(hoy.getTime() - 86400000);
  if (mismoDia(d, hoy)) return `hoy ${hora}`;
  if (mismoDia(d, ayer)) return `ayer ${hora}`;
  return `${d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

/** "hace 12 s", "hace 5 min", "hace 3 h", "hace 2 días". */
export function haceCuanto(iso) {
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `hace ${Math.round(diff)} s`;
  if (diff < 3600) return `hace ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.round(diff / 3600)} h`;
  return `hace ${Math.round(diff / 86400)} día(s)`;
}

/** Para fechas futuras: "en 12 min", "en 3 h", "en 1 día(s)"; si ya pasó, "en cualquier momento". */
export function enCuanto(iso) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  if (diff <= 60) return 'en cualquier momento';
  if (diff < 3600) return `en ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `en ${Math.round(diff / 3600)} h`;
  return `en ${Math.round(diff / 86400)} día(s)`;
}

/** Fecha completa para el tooltip. */
export function fechaLarga(iso) {
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'medium' });
}
