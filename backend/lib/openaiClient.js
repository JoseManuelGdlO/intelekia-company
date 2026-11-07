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
  return data.choices[0].message;
}

async function createChatCompletion({ apiKey, model, messages, fetchImpl = fetch }) {
  const message = await createChatCompletionMessage({ apiKey, model, messages, fetchImpl });
  return message.content;
}

module.exports = { createChatCompletion, createChatCompletionMessage };
