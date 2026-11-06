const express = require('express');

function sanitizeDepartments(departments) {
  return departments.map((dept) => ({
    id: dept.id,
    label: dept.label,
    agents: dept.agents.map((agent) => ({ id: agent.id, label: agent.label })),
  }));
}

function createDepartmentsHandler({ departments }) {
  return (req, res) => {
    res.json(sanitizeDepartments(departments));
  };
}

function createCreateAgentHandler({ createCustomAgent }) {
  return (req, res) => {
    const { departmentId } = req.params;
    const { label, context, autonomous } = req.body;

    if (!label || typeof label !== 'string' || !label.trim()) {
      res.status(400).json({ error: 'label es requerido' });
      return;
    }
    if (!context || typeof context !== 'string' || !context.trim()) {
      res.status(400).json({ error: 'context es requerido' });
      return;
    }

    try {
      const agent = createCustomAgent({
        departmentId,
        label: label.trim(),
        context: context.trim(),
        autonomous: Boolean(autonomous),
      });
      res.status(201).json(agent);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createUpdateAgentHandler({ updateCustomAgent }) {
  return (req, res) => {
    const { agentId } = req.params;
    const { label, context, autonomous } = req.body;

    try {
      const agent = updateCustomAgent(agentId, { label, context, autonomous });
      res.json(agent);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createGetMemoryHandler({ getMemory }) {
  return (req, res) => {
    const { agentId } = req.params;
    try {
      res.json({ content: getMemory(agentId) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createSetMemoryHandler({ setMemory }) {
  return (req, res) => {
    const { agentId } = req.params;
    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content es requerido' });
      return;
    }
    try {
      setMemory(agentId, content);
      res.json({ content });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createCompressMemoryHandler({ compressMemory }) {
  return async (req, res) => {
    const { agentId } = req.params;
    try {
      const content = await compressMemory(agentId);
      res.json({ content });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function createDepartmentsRouter({ departments, createCustomAgent, updateCustomAgent, getMemory, setMemory, compressMemory }) {
  const router = express.Router();
  router.get('/', createDepartmentsHandler({ departments }));
  router.post('/:departmentId/agents', createCreateAgentHandler({ createCustomAgent }));
  router.patch('/:departmentId/agents/:agentId', createUpdateAgentHandler({ updateCustomAgent }));
  router.get('/:departmentId/agents/:agentId/memory', createGetMemoryHandler({ getMemory }));
  router.put('/:departmentId/agents/:agentId/memory', createSetMemoryHandler({ setMemory }));
  router.post('/:departmentId/agents/:agentId/memory/compress', createCompressMemoryHandler({ compressMemory }));
  return router;
}

module.exports = {
  createDepartmentsRouter,
  createDepartmentsHandler,
  sanitizeDepartments,
  createCreateAgentHandler,
  createUpdateAgentHandler,
  createGetMemoryHandler,
  createSetMemoryHandler,
  createCompressMemoryHandler,
};
