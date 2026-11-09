function parseJsonArrayResponse(raw, { emptyArrayErrorMessage } = {}) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    // A veces el modelo antepone o agrega texto ("No tengo acceso… aquí hay ideas: [...]"):
    // se rescata el arreglo JSON que venga dentro de la respuesta.
    const inicio = cleaned.indexOf('[');
    const fin = cleaned.lastIndexOf(']');
    try {
      if (inicio === -1 || fin <= inicio) throw err;
      parsed = JSON.parse(cleaned.slice(inicio, fin + 1));
    } catch {
      throw new Error(`La respuesta del modelo no es JSON válido: ${err.message}`);
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error(emptyArrayErrorMessage || 'La respuesta del modelo no es un arreglo');
  }
  return parsed;
}

module.exports = { parseJsonArrayResponse };
