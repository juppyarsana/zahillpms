const router = require('express').Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const svc = require('../services/ratePlanService');

// GET /api/rate-plans?active=1
router.get('/', auth, async (req, res) => {
  try {
    res.json(await svc.listRatePlans(req.propertyId, { activeOnly: req.query.active === '1' }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rate-plans/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const plan = await svc.getRatePlan(req.propertyId, req.params.id);
    if (!plan) return res.status(404).json({ error: 'Rate plan not found' });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rate-plans  (owner)
router.post('/', auth, requireRole('owner'), async (req, res) => {
  try {
    const result = await svc.createRatePlan(req.propertyId, req.body);
    if (result.error) return res.status(result.error.includes('already exists') ? 409 : 400).json({ error: result.error });
    res.status(201).json(result.ratePlan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rate-plans/:id  (owner)
router.put('/:id', auth, requireRole('owner'), async (req, res) => {
  try {
    const result = await svc.updateRatePlan(req.propertyId, req.params.id, req.body);
    if (result.error) {
      const code = result.error === 'Rate plan not found' ? 404 : result.error.includes('already exists') ? 409 : 400;
      return res.status(code).json({ error: result.error });
    }
    res.json(result.ratePlan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/rate-plans/:id  (owner) — soft deactivate
router.delete('/:id', auth, requireRole('owner'), async (req, res) => {
  try {
    const result = await svc.deactivateRatePlan(req.propertyId, req.params.id);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json(result.ratePlan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
