const router = require('express').Router();
const hk = require('../services/housekeeping');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');

// /api/housekeeping (migration 132) — mounted with auth + the operations
// module. The board needs the Housekeeping page's permission ('operations');
// the room actions are open to any staff, like PATCH /api/units/:id/housekeeping,
// because front desk asks for cleans and marks rooms clean from the Dashboard.

const send = (res, r) => (r.error ? res.status(r.status || 400).json({ error: r.error }) : res.json(r));
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

router.get('/', requireOwnerOrMenu('operations'), wrap(async (req, res) => res.json(await hk.board(req.propertyId))));

router.post('/rooms/:unitId/clean', wrap(async (req, res) =>
  send(res, await hk.markClean(req.propertyId, req.params.unitId, { source: 'pms', userId: req.user.id }))));

router.post('/rooms/:unitId/to-clean', wrap(async (req, res) =>
  send(res, await hk.markToClean(req.propertyId, req.params.unitId))));

router.post('/rooms/:unitId/request', wrap(async (req, res) =>
  send(res, await hk.requestClean(req.propertyId, req.params.unitId, { via: 'front_desk', userId: req.user.id }))));

router.delete('/rooms/:unitId/request', wrap(async (req, res) =>
  send(res, await hk.cancelRequest(req.propertyId, req.params.unitId))));

module.exports = router;
