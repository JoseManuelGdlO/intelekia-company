const fs = require('fs');
const path = require('path');
const { assertSafeItemId } = require('../lib/validateItemId');
const { slugify } = require('../lib/slugify');

function readServicios(serviciosPath) {
  return JSON.parse(fs.readFileSync(serviciosPath, 'utf-8'));
}

function cotizacionFileName(servicio) {
  return `cotizacion-${slugify(servicio)}.md`;
}

async function runCycle({ contextPath, rolePath, serviciosPath, cotizacionesDir, apiKey, model, createChatCompletion }) {
  const servicios = readServicios(serviciosPath);
  fs.mkdirSync(cotizacionesDir, { recursive: true });

  const faltante = servicios.find((servicio) => !fs.existsSync(path.join(cotizacionesDir, cotizacionFileName(servicio))));

  if (!faltante) {
    return { plantillaCreada: null };
  }

  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `Redacta una cotización tipo (sin cliente específico) para el servicio: ${faltante}`;

  const cotizacion = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  const cotizacionPath = path.join(cotizacionesDir, cotizacionFileName(faltante));
  fs.writeFileSync(cotizacionPath, cotizacion);

  return { plantillaCreada: { servicio: faltante, cotizacionPath, slug: slugify(faltante) } };
}

async function chat({ message, itemId, cotizacionesDir, contextPath, rolePath, apiKey, model, createChatCompletion }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');

  let plantilla = '';
  if (itemId) {
    assertSafeItemId(itemId, 'itemId inválido');
    const plantillaPath = path.join(cotizacionesDir, `cotizacion-${itemId}.md`);
    if (fs.existsSync(plantillaPath)) {
      plantilla = fs.readFileSync(plantillaPath, 'utf-8');
    }
  }

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    (plantilla ? `Plantilla de referencia:\n${plantilla}\n\n` : '') +
    `Petición del fundador: ${message}`;

  const reply = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  return { reply };
}

function describeSuccess(result) {
  return result.plantillaCreada
    ? {
        estatus: 'listo_para_revision',
        ultimaAccion: `Generó cotización tipo para: ${result.plantillaCreada.servicio}`,
        ultimoItemId: result.plantillaCreada.slug,
      }
    : { estatus: 'idle', ultimaAccion: 'Biblioteca de cotizaciones tipo completa' };
}

module.exports = { runCycle, chat, describeSuccess, slugify, cotizacionFileName };
