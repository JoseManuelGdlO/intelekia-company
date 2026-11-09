/**
 * Acceso mínimo a la Graph API de Meta para el trabajador de Respuestas en Redes:
 * leer comentarios recientes de la página de Facebook y de la cuenta de Instagram Business,
 * y publicar respuestas. El token viaja en la cabecera Authorization (nunca en la URL).
 */
const GRAPH = 'https://graph.facebook.com';
const MAX_COMENTARIOS_POR_PUBLICACION = 50;
const TIMEOUT_MS = 20000;
const enc = encodeURIComponent;
const TOKEN_INVALIDO = 'Meta: el token venció o no es válido (genera uno nuevo y actualiza META_PAGE_TOKEN)';

function createMeta({ config, fetchImpl = (...a) => fetch(...a), timeoutMs = TIMEOUT_MS }) {
  const { pageToken, pageId, igUserId, apiVersion = 'v21.0' } = config || {};

  function estado() {
    if (!pageToken) return { ok: false, motivo: 'Falta META_PAGE_TOKEN en backend/.env' };
    if (!pageId && !igUserId) return { ok: false, motivo: 'Falta META_PAGE_ID o META_IG_USER_ID en backend/.env' };
    return { ok: true, facebook: Boolean(pageId), instagram: Boolean(igUserId) };
  }

  async function api(ruta, { method = 'GET', params = {}, body = null } = {}) {
    const url = new URL(`${GRAPH}/${apiVersion}/${ruta}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const headers = { Authorization: `Bearer ${pageToken}` };
    const opts = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
    if (body) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetchImpl(url.toString(), opts);
    } catch (err) {
      throw new Error(`Meta: no se pudo conectar (${err.message})`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      if (data.error?.code === 190) throw new Error(TOKEN_INVALIDO);
      throw new Error(`Meta: ${data.error?.message || `respuesta ${res.status}`}`);
    }
    return data;
  }

  // Usuario de la cuenta de Instagram: se pide una vez y se guarda.
  let igUsername = null;
  async function usuarioInstagram() {
    if (igUsername === null) igUsername = (await api(enc(igUserId), { params: { fields: 'username' } })).username || '';
    return igUsername;
  }

  /** Recorre las publicaciones aislando fallas: si una falla, se anota y se sigue con las demás. */
  async function porPublicacion(items, red, errores, fn) {
    const lista = [];
    for (const item of items) {
      try {
        lista.push(...(await fn(item)));
      } catch (err) {
        errores.push(`${red}: ${item.id}: ${err.message}`);
      }
    }
    return lista;
  }

  // Facebook devuelve "2026-11-09T10:00:00+0000" (sin ":" en la zona): se normaliza antes de parsear.
  const fechaDe = (valor) => new Date(String(valor).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  const iso = (valor) => fechaDe(valor).toISOString();

  async function comentariosFacebook(desde, maxPublicaciones, errores) {
    const posts = (await api(`${enc(pageId)}/posts`, { params: { fields: 'id,message,permalink_url', limit: maxPublicaciones } })).data || [];
    return porPublicacion(posts, 'Facebook', errores, async (post) => {
      const comentarios = (
        await api(`${enc(post.id)}/comments`, {
          params: { fields: 'id,message,from,created_time', filter: 'toplevel', order: 'reverse_chronological', limit: MAX_COMENTARIOS_POR_PUBLICACION },
        })
      ).data || [];
      // Sin "from" (Meta lo oculta sin pages_read_user_content) se trata como externo.
      return comentarios
        .filter((c) => c.from?.id !== pageId && fechaDe(c.created_time) >= desde)
        .map((c) => ({
          id: c.id,
          red: 'facebook',
          texto: c.message || '',
          autor: c.from?.name || 'Desconocido',
          creadoEn: iso(c.created_time),
          publicacionId: post.id,
          publicacionTexto: post.message || '',
          permalink: post.permalink_url || null,
        }));
    });
  }

  async function comentariosInstagram(desde, maxPublicaciones, errores) {
    const usuario = await usuarioInstagram();
    const media = (await api(`${enc(igUserId)}/media`, { params: { fields: 'id,caption,permalink', limit: maxPublicaciones } })).data || [];
    return porPublicacion(media, 'Instagram', errores, async (m) => {
      const comentarios = (await api(`${enc(m.id)}/comments`, { params: { fields: 'id,text,username,timestamp', limit: MAX_COMENTARIOS_POR_PUBLICACION } })).data || [];
      return comentarios
        .filter((c) => c.username !== usuario && fechaDe(c.timestamp) >= desde)
        .map((c) => ({
          id: c.id,
          red: 'instagram',
          texto: c.text || '',
          autor: c.username || 'Alguien',
          creadoEn: iso(c.timestamp),
          publicacionId: m.id,
          publicacionTexto: m.caption || '',
          permalink: m.permalink || null,
        }));
    });
  }

  /** Comentarios de las últimas publicaciones; si una red falla, devuelve la otra y reporta el error. */
  async function comentariosRecientes({ desde, maxPublicaciones = 10 }) {
    if (!(desde instanceof Date) || Number.isNaN(desde.getTime())) throw new Error('desde debe ser una fecha válida');
    const e = estado();
    if (!e.ok) throw new Error(e.motivo);
    const comentarios = [];
    const errores = [];
    if (e.facebook) {
      try {
        comentarios.push(...(await comentariosFacebook(desde, maxPublicaciones, errores)));
      } catch (err) {
        errores.push(`Facebook: ${err.message}`);
      }
    }
    if (e.instagram) {
      try {
        comentarios.push(...(await comentariosInstagram(desde, maxPublicaciones, errores)));
      } catch (err) {
        errores.push(`Instagram: ${err.message}`);
      }
    }
    comentarios.sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
    return { comentarios, errores };
  }

  async function responder({ red, comentarioId, mensaje }) {
    const texto = String(mensaje || '').trim();
    if (!texto) throw new Error('El mensaje de respuesta está vacío');
    if (red === 'facebook') return api(`${enc(comentarioId)}/comments`, { method: 'POST', body: { message: texto } });
    if (red === 'instagram') return api(`${enc(comentarioId)}/replies`, { method: 'POST', body: { message: texto } });
    throw new Error(`Red desconocida: ${red}`);
  }

  /** ¿La página/cuenta ya respondió este comentario (p. ej. el fundador a mano)? */
  async function yaRespondido({ red, comentarioId }) {
    if (red === 'facebook') {
      const respuestas = (await api(`${enc(comentarioId)}/comments`, { params: { fields: 'from', limit: MAX_COMENTARIOS_POR_PUBLICACION } })).data || [];
      return respuestas.some((r) => r.from?.id === pageId);
    }
    if (red === 'instagram') {
      const usuario = await usuarioInstagram();
      const respuestas = (await api(`${enc(comentarioId)}/replies`, { params: { fields: 'username', limit: MAX_COMENTARIOS_POR_PUBLICACION } })).data || [];
      return Boolean(usuario) && respuestas.some((r) => r.username === usuario);
    }
    throw new Error(`Red desconocida: ${red}`);
  }

  return { estado, comentariosRecientes, responder, yaRespondido };
}

module.exports = { createMeta };
