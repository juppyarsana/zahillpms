const router = require('express').Router();
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const svc = require('../services/purchaseRequestService');
const stock = require('../services/stockService');
const posPurchases = require('../services/posPurchases');
const { DEPARTMENTS } = require('../services/costCategories');

// Operations → Purchase requests (migration 144). Mounted at
// /api/purchase-requests behind auth + moduleGuard('back_office').
// Asking: owner or `purchase_request`. Ordering / declining / closing:
// owner or `purchasing` (they also see every request).
const canAsk = requireOwnerOrMenu(['purchase_request', 'purchasing']);
const canOrder = requireOwnerOrMenu('purchasing');
const isPurchasing = req => req.user?.role === 'owner' || (req.user?.allowed_menus || []).includes('purchasing');
const send = (res, r, ok = 200) => (r.error ? res.status(r.status || 400).json({ error: r.error, code: r.code }) : res.status(ok).json(r));

router.get('/setup', canAsk, async (req, res) => {
  try {
    const items = await stock.listItems(req.propertyId);
    res.json({
      departments: DEPARTMENTS.map(([key, label]) => ({ key, label })),
      items: items.map(i => ({ key: i.key, name: i.name, unit: i.unit, on_hand: i.on_hand, low: i.low, out: i.out, category_label: i.category_label })),
      can_order: isPurchasing(req),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// The restaurant's items (POS inventory), for a request or a PO line.
router.get('/pos-items', canAsk, async (req, res) => {
  try { res.json(await posPurchases.inventory(req.propertyId)); }
  catch (err) { res.status(err.status || 502).json({ error: err.message, code: err.code }); }
});

router.get('/', canAsk, async (req, res) => {
  try {
    res.json(await svc.list(req.propertyId, { show: req.query.show, department: req.query.department, days: req.query.show === 'open' ? null : 90 }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', canAsk, async (req, res) => {
  try {
    const r = await svc.get(req.propertyId, req.params.id);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST / { department, needed_by?, note?, lines: [{ item_key | pos_item_id?, description, unit, quantity, note? }] }
router.post('/', canAsk, async (req, res) => {
  try {
    const r = await svc.create(req.propertyId, req.body || {}, { userId: req.user.id, name: req.user.name, source: 'pms' });
    if (r.error) return send(res, r);
    res.status(201).json(r.request);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cancel: whoever asked, or purchasing. Decline / close: purchasing, with a reason.
router.post('/:id/cancel', canAsk, async (req, res) => {
  try {
    const r = await svc.get(req.propertyId, req.params.id);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (!isPurchasing(req) && r.requested_by !== req.user.id) return res.status(403).json({ error: 'Only the person who asked, or purchasing, can cancel it' });
    send(res, await svc.closeRequest(req.propertyId, r.id, 'cancelled', { reason: req.body?.reason, userId: req.user.id }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/decline', canOrder, async (req, res) => {
  try { send(res, await svc.closeRequest(req.propertyId, req.params.id, 'declined', { reason: req.body?.reason, userId: req.user.id })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/close', canOrder, async (req, res) => {
  try { send(res, await svc.closeRequest(req.propertyId, req.params.id, 'done', { reason: req.body?.reason, userId: req.user.id })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
