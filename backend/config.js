require('dotenv').config();

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    openaiApiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || 'gpt-4o-mini',
    agentIntervalHours: Number(env.AGENT_INTERVAL_HOURS || 6),
  };
}

module.exports = { loadConfig };
