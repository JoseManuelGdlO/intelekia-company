function createScheduler({ intervalMs, agentRunners }) {
  let timer = null;

  function start() {
    timer = setInterval(() => {
      runAllOnce().catch(() => {});
    }, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function isRunning() {
    return timer !== null;
  }

  async function runAllOnce() {
    const ids = Object.keys(agentRunners);
    for (const id of ids) {
      await agentRunners[id]();
    }
  }

  async function runOne(agentId) {
    const runner = agentRunners[agentId];
    if (!runner) {
      throw new Error(`Agente desconocido: ${agentId}`);
    }
    return runner();
  }

  return { start, stop, runAllOnce, runOne, isRunning };
}

module.exports = { createScheduler };
