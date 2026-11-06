const fs = require('fs');

function readProspectos(prospectosPath) {
  if (!fs.existsSync(prospectosPath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(prospectosPath, 'utf-8'));
}

function writeProspectos(prospectosPath, prospectos) {
  fs.writeFileSync(prospectosPath, JSON.stringify(prospectos, null, 2));
}

module.exports = { readProspectos, writeProspectos };
