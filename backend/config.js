require('dotenv').config();
const { normalizarNumero } = require('./lib/whatsapp');

const DEFAULT_DB_TABLES = 'Projects,Tasks,BoardColumns,TaskActivities,Notes,ProjectMembers,Users,FinanceItems';
const DEFAULT_DB_BLOCKED_COLUMNS = 'passwordHash,email';

function list(value) {
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    openaiApiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || 'gpt-4o-mini',
    agentIntervalHours: Number(env.AGENT_INTERVAL_HOURS || 6),
    // Revisor de PRs: cuenta de GitHub cuyos repos vigila (el token va en GITHUB_TOKEN, lo usa el plugin).
    githubOwner: env.GITHUB_OWNER || '',
    // Respuestas en Redes: Graph API de Meta (token de página de larga duración).
    meta: {
      pageToken: env.META_PAGE_TOKEN || '',
      pageId: env.META_PAGE_ID || '',
      igUserId: env.META_IG_USER_ID || '',
      apiVersion: env.META_API_VERSION || 'v21.0',
    },
    // Canal de WhatsApp (Cloud API de Meta).
    // Acceso a la oficina (Basic Auth). Obligatorio en un servidor público como EasyPanel.
    acceso: {
      usuario: env.OFICINA_USUARIO || '',
      password: env.OFICINA_PASSWORD || '',
    },
    whatsapp: {
      token: env.WHATSAPP_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      permitidos: list(env.WHATSAPP_PERMITIDOS || '').map(normalizarNumero).filter(Boolean),
      plantillaAviso: env.WHATSAPP_PLANTILLA_AVISO || '',
      plantillaIdioma: env.WHATSAPP_PLANTILLA_IDIOMA || 'es_MX',
      apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
      voz: env.WHATSAPP_VOZ || 'alloy',
      // Puerto aparte SOLO para el webhook: es el único que se expone con ngrok (nunca el de la oficina).
      webhookPort: Number(env.WHATSAPP_WEBHOOK_PORT || 3100),
    },
    // Base de datos externa que los agentes pueden consultar en SOLO LECTURA.
    db: {
      host: env.DB_HOST || '',
      port: Number(env.DB_PORT || 3306),
      name: env.DB_NAME || '',
      user: env.DB_USER || '',
      password: env.DB_PASSWORD || '',
      allowedTables: list(env.DB_ALLOWED_TABLES || DEFAULT_DB_TABLES),
      blockedColumns: list(env.DB_BLOCKED_COLUMNS || DEFAULT_DB_BLOCKED_COLUMNS),
    },
    // Correo saliente por SMTP (p. ej. Hostinger). La lista blanca se edita en la app.
    smtp: {
      host: env.SMTP_HOST || '',
      port: Number(env.SMTP_PORT || 465),
      secure: (env.SMTP_SECURE || 'true') !== 'false',
      user: env.SMTP_USER || '',
      password: env.SMTP_PASSWORD || '',
      fromName: env.SMTP_FROM_NAME || 'PM · Intelekia',
      replyTo: env.SMTP_REPLY_TO || '',
      // Copia oculta de TODOS los correos que envían los agentes (p. ej. tu propio buzón).
      bcc: env.SMTP_BCC || '',
      firma: env.SMTP_FIRMA ?? 'Enviado por el PM, asistente de IA de Intelekia Consultoría.',
    },
  };
}

module.exports = { loadConfig };
