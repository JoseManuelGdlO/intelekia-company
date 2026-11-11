const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { assertSafeItemId } = require('../lib/validateItemId');
const { slugify } = require('../lib/slugify');

// Qué rol + plantilla generó cada cotización tipo: si cambian, se vuelve a generar (una por ciclo).
const VERSIONES = '.versiones.json';

function readServicios(serviciosPath) {
  return JSON.parse(fs.readFileSync(serviciosPath, 'utf-8'));
}

function cotizacionFileName(servicio) {
  return `cotizacion-${slugify(servicio)}.md`;
}

/** Plantilla del fundador (editable en el perfil del Cotizador). Vacía o sin archivo → ''. */
function leerPlantilla(plantillaPath) {
  if (!plantillaPath || !fs.existsSync(plantillaPath)) return '';
  const texto = fs.readFileSync(plantillaPath, 'utf-8');
  return texto.trim() ? texto : '';
}

function bloquePlantilla(plantilla) {
  if (!plantilla) return '';
  return (
    'PLANTILLA OBLIGATORIA. Usa exactamente esta estructura: mismos títulos, mismo orden de secciones, ' +
    'mismas tablas y mismo formato. Reemplaza los campos a llenar ({{campo}}, [CAMPO], ___) con contenido real; ' +
    'si no tienes un dato (por ejemplo precio, fecha o nombre del cliente), deja el campo como [POR DEFINIR]. ' +
    'No agregues secciones que la plantilla no tiene ni quites las que sí tiene.\n' +
    `--- INICIO DE LA PLANTILLA ---\n${plantilla}\n--- FIN DE LA PLANTILLA ---\n\n`
  );
}

function leerVersiones(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, VERSIONES), 'utf-8')) || {};
  } catch {
    return {};
  }
}

function huella(role, plantilla) {
  return crypto.createHash('sha256').update(`${role}\n\u0000\n${plantilla}`).digest('hex').slice(0, 16);
}

async function runCycle({ contextPath, rolePath, serviciosPath, cotizacionesDir, plantillaPath, apiKey, model, createChatCompletion }) {
  const servicios = readServicios(serviciosPath);
  fs.mkdirSync(cotizacionesDir, { recursive: true });

  const role = fs.readFileSync(rolePath, 'utf-8');
  const plantilla = leerPlantilla(plantillaPath);
  const version = huella(role, plantilla);
  const versiones = leerVersiones(cotizacionesDir);
  // Sin plantilla se respeta la biblioteca existente; con plantilla, se rehace lo que no esté en la versión actual.
  const desactualizada = (servicio) =>
    !fs.existsSync(path.join(cotizacionesDir, cotizacionFileName(servicio))) || (plantilla && versiones[slugify(servicio)] !== version);
  const faltante = servicios.find(desactualizada);

  if (!faltante) {
    return { plantillaCreada: null };
  }

  const context = fs.readFileSync(contextPath, 'utf-8');
  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    bloquePlantilla(plantilla) +
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
  fs.writeFileSync(path.join(cotizacionesDir, VERSIONES), JSON.stringify({ ...versiones, [slugify(faltante)]: version }, null, 2));

  return { plantillaCreada: { servicio: faltante, cotizacionPath, slug: slugify(faltante) } };
}

async function chat({ message, itemId, cotizacionesDir, contextPath, rolePath, plantillaPath, apiKey, model, createChatCompletion }) {
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');

  let referencia = '';
  if (itemId) {
    assertSafeItemId(itemId, 'itemId inválido');
    const referenciaPath = path.join(cotizacionesDir, `cotizacion-${itemId}.md`);
    if (fs.existsSync(referenciaPath)) {
      referencia = fs.readFileSync(referenciaPath, 'utf-8');
    }
  }

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    bloquePlantilla(leerPlantilla(plantillaPath)) +
    (referencia ? `Plantilla de referencia:\n${referencia}\n\n` : '') +
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
