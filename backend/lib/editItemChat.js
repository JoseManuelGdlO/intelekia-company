const fs = require('fs');
const path = require('path');
const { assertSafeItemId } = require('./validateItemId');

async function editItemChat({
  message,
  itemId,
  dir,
  fileNameFor,
  invalidIdErrorMessage,
  contentLabel,
  contextPath,
  rolePath,
  apiKey,
  model,
  createChatCompletion,
}) {
  assertSafeItemId(itemId, invalidIdErrorMessage);
  const filePath = path.join(dir, fileNameFor(itemId));
  const context = fs.readFileSync(contextPath, 'utf-8');
  const role = fs.readFileSync(rolePath, 'utf-8');
  const currentContent = fs.readFileSync(filePath, 'utf-8');

  const userPrompt =
    `Contexto de negocio:\n${context}\n\n` +
    `${contentLabel} actual:\n${currentContent}\n\n` +
    `Instrucción del fundador: ${message}`;

  const updatedContent = await createChatCompletion({
    apiKey,
    model,
    messages: [
      { role: 'system', content: role },
      { role: 'user', content: userPrompt },
    ],
  });

  fs.writeFileSync(filePath, updatedContent);

  return { reply: updatedContent };
}

module.exports = { editItemChat };
