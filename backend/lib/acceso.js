const crypto = require('crypto');

/**
 * Acceso con usuario y contraseña (HTTP Basic Auth) para la oficina.
 * Solo se activa si OFICINA_USUARIO y OFICINA_PASSWORD están definidos: en tu compu puede
 * quedar abierto; en un servidor público (EasyPanel) siempre hay que definirlos.
 * El webhook de WhatsApp vive en otra app/puerto y no pasa por aquí (Meta no manda contraseña;
 * se protege con la firma de Meta).
 *
 * Roles:
 *  - `admin` (OFICINA_USUARIO/OFICINA_PASSWORD): todo, como siempre.
 *  - `tv` (OFICINA_TV_USUARIO/OFICINA_TV_PASSWORD): solo lectura de la pantalla de la oficina
 *    (GET/HEAD de /tv.html, estáticos y /api/tv). Cualquier otra cosa → 403.
 * Si solo se configura el usuario de TV (sin admin) la oficina sigue abierta como en desarrollo:
 * así nunca se queda nadie fuera por olvidar el usuario admin.
 */
function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const METODOS_TV = ['GET', 'HEAD'];
const RUTAS_TV = ['/tv.html', '/tv.css', '/styles.css', '/api/tv'];
const PREFIJOS_TV = ['/src/', '/assets/', '/vendor/', '/api/tv/'];

/**
 * Ruta decodificada y segura para comparar contra la lista permitida, o null si es sospechosa:
 * codificación inválida, segmentos '.'/'..', barras invertidas, NUL o '%' tras decodificar
 * (doble codificación).
 */
function rutaSegura(ruta) {
  let decodificada;
  try {
    decodificada = decodeURIComponent(String(ruta || ''));
  } catch {
    return null;
  }
  if (!decodificada.startsWith('/') || /[\\%\0]/.test(decodificada)) return null;
  if (decodificada.split('/').some((s) => s === '.' || s === '..')) return null;
  return decodificada;
}

function permitidaParaTv(ruta) {
  if (RUTAS_TV.includes(ruta)) return true;
  if (ruta.startsWith('/favicon') && !ruta.slice(1).includes('/')) return true;
  return PREFIJOS_TV.some((p) => ruta.startsWith(p) && ruta.length > p.length);
}

function createAcceso({ usuario, password, tvUsuario, tvPassword } = {}) {
  const activo = Boolean(usuario && password);
  const tvActivo = activo && Boolean(tvUsuario && tvPassword);

  /** 'admin' | 'tv' | null según el encabezado Authorization. */
  function rolDe(req) {
    const [tipo, valor] = String(req.get('authorization') || '').split(' ');
    if (tipo !== 'Basic' || !valor) return null;
    const [u, ...resto] = Buffer.from(valor, 'base64').toString('utf-8').split(':');
    const p = resto.join(':');
    // Se comparan ambas siempre para no revelar por tiempo cuál existe.
    const esAdmin = iguales(u, usuario) && iguales(p, password);
    const esTv = tvActivo && iguales(u, tvUsuario) && iguales(p, tvPassword);
    if (esAdmin) return 'admin';
    if (esTv) return 'tv';
    return null;
  }

  function acceso(req, res, next) {
    if (!activo) {
      req.rolAcceso = 'admin';
      return next();
    }
    const rol = rolDe(req);
    if (rol === 'admin') {
      req.rolAcceso = 'admin';
      return next();
    }
    if (rol === 'tv') {
      req.rolAcceso = 'tv';
      const metodoOk = METODOS_TV.includes(req.method);
      // Para el modo kiosco: abrir la raíz lleva directo a la pantalla de la TV.
      if (metodoOk && req.path === '/') return res.redirect(302, '/tv.html');
      const ruta = rutaSegura(req.path);
      if (metodoOk && ruta && permitidaParaTv(ruta)) return next();
      return res.status(403).send('Solo lectura (pantalla de la oficina)');
    }
    res.set('WWW-Authenticate', 'Basic realm="Oficina Intelekia", charset="UTF-8"');
    return res.status(401).send('Acceso restringido');
  }

  acceso.activo = activo;
  return acceso;
}

module.exports = { createAcceso };
