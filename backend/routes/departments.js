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

function createDepartmentsRouter({ departments }) {
  const router = express.Router();
  router.get('/', createDepartmentsHandler({ departments }));
  return router;
}

module.exports = { createDepartmentsRouter, createDepartmentsHandler, sanitizeDepartments };
