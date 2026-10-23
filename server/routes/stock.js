const router = require('express').Router();
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const svc = require('../services/stockService');
const { stockSheetPdf, usageXlsx } = require('../services/stockExport');

// Operations → Stock (migration 136). Mounted at /api/stock behind
// auth + moduleGuard('back_office'); owner or the `stock` permission.
router.use(requireOwnerOrMenu('stock'));

const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));
const send = (res, r, ok = 200) => (r?.error ? res.status(r.status || 400).json({ error: r.error, code: r.code }) : res.status(ok).json(r));

router.get('/items', wrap(async (req, res) => res.json(await svc.listItems(req.propertyId, { inactive: req.query.inactive === '1' }))));
router.post('/items', wrap(async (req, res) => send(res, await svc.saveStockItem(req.propertyId, req.body || {}), 201)));
router.put('/items/:key', wrap(async (req, res) => {
  const k = svc.parseKey(req.params.key);
  if (!k || k.kind !== 'rm') return res.status(400).json({ error: 'Sales items are edited in Sales → Items' });
  send(res, await svc.saveStockItem(req.propertyId, req.body || {}, k.id));
}));
router.get('/items/:key/history', wrap(async (req, res) => {
  const h = await svc.history(req.propertyId, req.params.key);
  return h ? res.json(h) : res.status(404).json({ error: 'Item not found' });
}));
// POST /items/:key/adjust { reason: waste | used | correction, quantity, direction?: up | down, note }
router.post('/items/:key/adjust', wrap(async (req, res) => send(res, await svc.adjust(req.propertyId, req.params.key, req.body || {}, req.user))));

router.get('/writeoff-alert', wrap(async (req, res) => res.json({ settings: await svc.writeoffSettings(req.propertyId) })));
router.put('/writeoff-alert', wrap(async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
  send(res, await svc.saveWriteoffSettings(req.propertyId, req.body || {}));
}));

router.get('/opnames', wrap(async (req, res) => res.json(await svc.listOpnames(req.propertyId))));
router.post('/opnames', wrap(async (req, res) => send(res, await svc.startOpname(req.propertyId, req.body || {}, req.user), 201)));
router.get('/opnames/:id', wrap(async (req, res) => {
  const o = await svc.getOpname(req.propertyId, req.params.id);
  return o ? res.json(o) : res.status(404).json({ error: 'Stock opname not found' });
}));
router.get('/opnames/:id/sheet', wrap(async (req, res) => {
  const o = await svc.getOpname(req.propertyId, req.params.id);
  if (!o) return res.status(404).json({ error: 'Stock opname not found' });
  const pdf = await stockSheetPdf(req.propertyId, o);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="stock-opname-${o.no_text}.pdf"`);
  res.send(pdf);
}));
router.put('/opnames/:id/counts', wrap(async (req, res) => send(res, await svc.saveCounts(req.propertyId, req.params.id, req.body?.counts))));
router.post('/opnames/:id/finish', wrap(async (req, res) => send(res, await svc.finishOpname(req.propertyId, req.params.id, req.user))));
router.post('/opnames/:id/cancel', wrap(async (req, res) => send(res, await svc.cancelOpname(req.propertyId, req.params.id, req.user))));

// GET /usage?from=<opname id>&to=<opname id | empty = now>
router.get('/usage', wrap(async (req, res) => send(res, await svc.usage(req.propertyId, req.query.from, req.query.to || null))));
router.get('/usage/xlsx', wrap(async (req, res) => {
  const u = await svc.usage(req.propertyId, req.query.from, req.query.to || null);
  if (u.error) return res.status(u.status || 400).json({ error: u.error });
  const buf = await usageXlsx(req.propertyId, u);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="stock-usage-${u.from.no_text}-${u.to ? u.to.no_text : 'now'}.xlsx"`);
  res.send(Buffer.from(buf));
}));

module.exports = router;
