const fs = require('fs');
const path = require('path');

/** Utilidades compartidas por los agentes que generan reportes fechados (Seguimiento, PM). */
const TIME_ZONE = 'America/Monterrey'; // Hora de Durango

function fechaLocal(date) {
  return date.toLocaleString('es-MX', { timeZone: TIME_ZONE, dateStyle: 'full', timeStyle: 'short' });
}

/** `reporte-AAAA-MM-DD-HHmm` en hora de Durango. */
function reporteIdFor(date, prefix = 'reporte') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${prefix}-${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}`;
}

/** El reporte más reciente de la carpeta (el nombre incluye la fecha), o null. */
function ultimoReporte(dir, prefix = 'reporte') {
  if (!dir || !fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.md'))
    .sort();
  if (!files.length) return null;
  const file = files[files.length - 1];
  return { id: file.replace(/\.md$/, ''), contenido: fs.readFileSync(path.join(dir, file), 'utf-8') };
}

/** Primera línea de la sección "Resumen" (o del texto) para mostrar como última acción. */
function resumenDe(reporte) {
  const lines = reporte.split('\n').map((l) => l.trim());
  const start = lines.findIndex((l) => /^#+\s*resumen/i.test(l));
  const candidates = (start >= 0 ? lines.slice(start + 1) : lines).filter((l) => l && !/^#/.test(l));
  const text = (candidates[0] || 'Reporte generado').replace(/^[-*]\s*/, '');
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function guardarReporte(dir, id, contenido) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.md`);
  fs.writeFileSync(filePath, contenido);
  return filePath;
}

module.exports = { TIME_ZONE, fechaLocal, reporteIdFor, ultimoReporte, resumenDe, guardarReporte };
