const fs = require('fs');

function readStatus(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writeStatus(filePath, status) {
  fs.writeFileSync(filePath, JSON.stringify(status, null, 2));
}

function updateAgentStatus(filePath, agentId, patch) {
  const status = readStatus(filePath);
  const current = status[agentId] || {};
  status[agentId] = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeStatus(filePath, status);
  return status[agentId];
}

module.exports = { readStatus, writeStatus, updateAgentStatus };
