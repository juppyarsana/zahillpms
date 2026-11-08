const router = require('express').Router();
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const svc = require('../services/transferService');
const stores = require('../services/storeService');

// Stock → Transfers (migration 157): moving stock between stores. Mounted at
// /api/stock-transfers behind auth + moduleGuard('back_office'). Seeing and
// confirming: owner, `stock` or `store_transfers` (the head of a store who
// receives goods). Sending and cancelling: owner or `stock`.
router.use(requireOwnerOrMenu(['stock', 'store_transfers']));
const sender = requireOwnerOrMenu('stock');

const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));
const send = (res, r, ok = 200) => (r?.error ? res.status(r.status || 400).json({ error: r.error, code: r.code }) : res.status(ok).json(r));

router.get('/setup', wrap(async (req, res) => {
  const list = await stores.listStores(req.propertyId);
  res.json({ stores: list, open: await svc.openCount(req.propertyId) });   // Kitchen / Resto too: restaurant items go there
}));
// ?status=open | done | all, ?store=<id>
router.get('/', wrap(async (req, res) => res.json(await svc.list(req.propertyId, { status: req.query.status || 'open', storeId: req.query.store || null }))));
router.get('/count', wrap(async (req, res) => res.json({ open: await svc.openCount(req.propertyId) })));
router.get('/:id', wrap(async (req, res) => {
  const t = await svc.get(req.propertyId, req.params.id);
  return t ? res.json(t) : res.status(404).json({ error: 'Transfer not found' });
}));
router.post('/', sender, wrap(async (req, res) => send(res, await svc.create(req.propertyId, req.body || {}, req.user), 201)));
// { lines: [{ line_id, accepted, note }] }
router.post('/:id/confirm', wrap(async (req, res) => send(res, await svc.confirm(req.propertyId, req.params.id, req.body || {}, req.user))));
router.post('/:id/pos-send', sender, wrap(async (req, res) => {
  const t = await svc.get(req.propertyId, req.params.id);
  if (!t) return res.status(404).json({ error: 'Transfer not found' });
  const pos = await svc.sendToPos(req.propertyId, t.id);
  res.json({ pos, transfer: await svc.get(req.propertyId, t.id) });
}));
router.post('/:id/cancel', sender, wrap(async (req, res) => send(res, await svc.cancel(req.propertyId, req.params.id, req.body?.reason, req.user))));

module.exports = router;
