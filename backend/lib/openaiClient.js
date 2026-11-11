// Escucha global del consumo (medidor de gasto): se llama con (model, usage) en cada respuesta OK.
let usageListener = null;

/** Define quién recibe el consumo de tokens de cada respuesta (null lo quita). */
function setUsageListener(fn) {
  usageListener = typeof fn === 'function' ? fn : null;
}

/**
 * Llama a Chat Completions y devuelve el mensaje completo del asistente
 * (incluye `tool_calls` cuando el modelo decide usar una herramienta).
 */
async function createChatCompletionMessage({ apiKey, model, messages, tools, toolChoice, fetchImpl = fetch }) {
  const body = { model, messages };
  if (tools && tools.length) {
    body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
  }

  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  if (usageListener && data.usage) {
    try {
      usageListener(data.model || model, data.usage);
    } catch {
      // El medidor de gasto nunca debe romper la llamada.
    }
  }
  return data.choices[0].message;
}

async function createChatCompletion({ apiKey, model, messages, fetchImpl = fetch }) {
  const message = await createChatCompletionMessage({ apiKey, model, messages, fetchImpl });
  return message.content;
}

module.exports = { createChatCompletion, createChatCompletionMessage, setUsageListener };
