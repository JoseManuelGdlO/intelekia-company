const crypto = require('crypto');

/**
 * Acceso con usuario y contraseña (HTTP Basic Auth) para la oficina.
 * Solo se activa si OFICINA_USUARIO y OFICINA_PASSWORD están definidos: en tu compu puede
 * quedar abierto; en un servidor público (EasyPanel) siempre hay que definirlos.
 * El webhook de WhatsApp vive en otra app/puerto y no pasa por aquí (Meta no manda contraseña;
 * se protege con la firma de Meta).
 */
function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createAcceso({ usuario, password } = {}) {
  const activo = Boolean(usuario && password);

  function acceso(req, res, next) {
    if (!activo) return next();
    const [tipo, valor] = String(req.get('authorization') || '').split(' ');
    if (tipo === 'Basic' && valor) {
      const [u, ...resto] = Buffer.from(valor, 'base64').toString('utf-8').split(':');
      if (iguales(u, usuario) && iguales(resto.join(':'), password)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Oficina Intelekia", charset="UTF-8"');
    return res.status(401).send('Acceso restringido');
  }

  acceso.activo = activo;
  return acceso;
}

module.exports = { createAcceso };
