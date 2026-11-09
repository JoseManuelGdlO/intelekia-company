/**
 * Acceso mínimo a la Graph API de Meta para el trabajador de Respuestas en Redes:
 * leer comentarios recientes de la página de Facebook y de la cuenta de Instagram Business,
 * y publicar respuestas. El token viaja en la cabecera Authorization (nunca en la URL).
 */
const GRAPH = 'https://graph.facebook.com';
const MAX_COMENTARIOS_POR_PUBLICACION = 50;
const TIMEOUT_MS = 20000;
const enc = encodeURIComponent;

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
    if (!res.ok || data.error) throw new Error(`Meta: ${data.error?.message || `respuesta ${res.status}`}`);
    return data;
  }

  // Facebook devuelve "2026-11-09T10:00:00+0000" (sin ":" en la zona): se normaliza antes de parsear.
  const fechaDe = (valor) => new Date(String(valor).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  const iso = (valor) => fechaDe(valor).toISOString();

  async function comentariosFacebook(desde, maxPublicaciones) {
    const posts = (await api(`${enc(pageId)}/posts`, { params: { fields: 'id,message,permalink_url', limit: maxPublicaciones } })).data || [];
    const lista = [];
    for (const post of posts) {
      const comentarios = (
        await api(`${enc(post.id)}/comments`, {
          params: { fields: 'id,message,from,created_time', filter: 'toplevel', order: 'reverse_chronological', limit: MAX_COMENTARIOS_POR_PUBLICACION },
        })
      ).data || [];
      comentarios
        .filter((c) => c.from?.id !== pageId && fechaDe(c.created_time) >= desde)
        .forEach((c) =>
          lista.push({
            id: c.id,
            red: 'facebook',
            texto: c.message || '',
            autor: c.from?.name || 'Alguien',
            creadoEn: iso(c.created_time),
            publicacionId: post.id,
            publicacionTexto: post.message || '',
            permalink: post.permalink_url || null,
          })
        );
    }
    return lista;
  }

  async function comentariosInstagram(desde, maxPublicaciones) {
    const cuenta = await api(enc(igUserId), { params: { fields: 'username' } });
    const media = (await api(`${enc(igUserId)}/media`, { params: { fields: 'id,caption,permalink', limit: maxPublicaciones } })).data || [];
    const lista = [];
    for (const m of media) {
      const comentarios = (await api(`${enc(m.id)}/comments`, { params: { fields: 'id,text,username,timestamp', limit: MAX_COMENTARIOS_POR_PUBLICACION } })).data || [];
      comentarios
        .filter((c) => c.username !== cuenta.username && fechaDe(c.timestamp) >= desde)
        .forEach((c) =>
          lista.push({
            id: c.id,
            red: 'instagram',
            texto: c.text || '',
            autor: c.username || 'Alguien',
            creadoEn: iso(c.timestamp),
            publicacionId: m.id,
            publicacionTexto: m.caption || '',
            permalink: m.permalink || null,
          })
        );
    }
    return lista;
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
        comentarios.push(...(await comentariosFacebook(desde, maxPublicaciones)));
      } catch (err) {
        errores.push(`Facebook: ${err.message}`);
      }
    }
    if (e.instagram) {
      try {
        comentarios.push(...(await comentariosInstagram(desde, maxPublicaciones)));
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

  return { estado, comentariosRecientes, responder };
}

module.exports = { createMeta };
