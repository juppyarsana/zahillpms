const router = require('express').Router();
const db = require('../db');
const credit = require('../services/agentCredit');
const { refundHandler } = require('./payments');

// Agent credit (see services/agentCredit.js). Mounted with auth + the reservations
// module, open to every staff member who works with reservations: front desk handles an
// agent's cancelled rooms, so using or refunding the credit is front desk's job too —
// a reason is required, the booking's Edit History records it and the owner control alert fires.

// GET /api/agent-credit — every agent with credit held
router.get('/', async (req, res) => {
  try { res.json(await credit.summary(req.propertyId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/agent-credit/agent/:agentId — one agent's credit, item per cancelled booking
router.get('/agent/:agentId', async (req, res) => {
  try {
    const out = await credit.creditFor(req.propertyId, req.params.agentId);
    if (!out) return res.status(404).json({ error: 'Agent not found' });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/agent-credit/agent/:agentId/targets — the agent's stays that can take credit
router.get('/agent/:agentId/targets', async (req, res) => {
  try { res.json(await credit.targetsFor(req.propertyId, req.params.agentId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/agent-credit/use { from_booking_id, to_booking_id, amount, reason }
router.post('/use', async (req, res) => {
  try {
    const out = await credit.useCredit(req.propertyId, req.user.id, {
      fromBookingId: req.body.from_booking_id, toBookingId: req.body.to_booking_id,
      amount: req.body.amount, reason: String(req.body.reason || '').trim().slice(0, 500),
    });
    if (out.error) return res.status(out.status || 400).json({ error: out.error, code: out.code });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/agent-credit/refund { booking_id, amount, method, refunded_at?, reference?, reason }
// The existing refund, for a cancelled / no-show booking of an agent only (not an OTA: the money is the guest's —
// that is an ordinary Refund with the Corrections permission).
router.post('/refund', async (req, res, next) => {
  try {
    const { rows: [b] } = await db.query(
      `SELECT b.status, b.agent_id, ag.agent_type FROM bookings b LEFT JOIN agents ag ON ag.id = b.agent_id
        WHERE b.id = $1 AND b.property_id = $2`, [req.body.booking_id, req.propertyId]);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    if (!b.agent_id || b.agent_type === 'ota' || !['cancelled', 'no_show'].includes(b.status)) {
      return res.status(409).json({ error: 'This is not an agent\'s cancelled booking — use ⋮ → Refund on the booking (Corrections permission)' });
    }
    return refundHandler(req, res, next);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
