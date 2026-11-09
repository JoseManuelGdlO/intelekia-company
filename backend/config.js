require('dotenv').config();

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
