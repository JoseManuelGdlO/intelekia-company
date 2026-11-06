const fs = require('fs');

function readIdeas(ideasPath) {
  if (!fs.existsSync(ideasPath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(ideasPath, 'utf-8'));
}

function writeIdeas(ideasPath, ideas) {
  fs.writeFileSync(ideasPath, JSON.stringify(ideas, null, 2));
}

module.exports = { readIdeas, writeIdeas };
