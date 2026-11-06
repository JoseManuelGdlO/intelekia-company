function parseJsonArrayResponse(raw, { emptyArrayErrorMessage } = {}) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`La respuesta del modelo no es JSON válido: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(emptyArrayErrorMessage || 'La respuesta del modelo no es un arreglo');
  }
  return parsed;
}

module.exports = { parseJsonArrayResponse };
