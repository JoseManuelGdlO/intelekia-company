function slugify(texto) {
  const sinAcentos = texto
    .normalize('NFD')
    .split('')
    .filter((char) => char.charCodeAt(0) < 128)
    .join('');
  return sinAcentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

module.exports = { slugify };
