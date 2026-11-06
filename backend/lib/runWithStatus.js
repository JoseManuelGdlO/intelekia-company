const { updateAgentStatus } = require('./statusStore');

function wrapRunCycle({ agentId, statusPath, runCycle, deps, describeSuccess }) {
  return async function runWrapped() {
    updateAgentStatus(statusPath, agentId, {
      estatus: 'trabajando',
      ultimaAccion: 'Ejecutando ciclo autónomo',
      error: null,
    });

    try {
      const result = await runCycle(deps);
      const patch = describeSuccess(result);
      updateAgentStatus(statusPath, agentId, { ...patch, error: null });
      return result;
    } catch (err) {
      updateAgentStatus(statusPath, agentId, {
        estatus: 'error',
        ultimaAccion: 'Fallo en el ciclo autónomo',
        error: err.message,
      });
      throw err;
    }
  };
}

module.exports = { wrapRunCycle };
