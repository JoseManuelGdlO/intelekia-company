const express = require('express');
const { createRevisionesStore } = require('../lib/revisionesPR');

/** PRs revisados por el Revisor de PRs (más recientes primero). */
function createRevisionesPRRouter({ filePath }) {
  const router = express.Router();
  router.get('/', (req, res) => {
    res.json(createRevisionesStore({ filePath }).lista());
  });
  return router;
}

module.exports = { createRevisionesPRRouter };
