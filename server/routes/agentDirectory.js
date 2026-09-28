const router = require('express').Router();
const auth = require('../middleware/auth');
const agentService = require('../services/agentService');
const agentBilling = require('../services/agentBillingService');

// Agents & companies list (migration 084). Mounted at /api/agent-directory
// behind auth + moduleGuard('reservations') in server/index.js — front desk
// picks and adds agents from a booking. Billing terms (payment status,
// credit, default commission) can only be set by the owner; statements,
// payments and invoices stay owner-only under /api/agents.
const canBill = req => req.user?.role === 'owner';

// GET /api/agent-directory?q=&active=true
router.get('/', auth, async (req, res) => {
  try {
    res.json(await agentService.listAgents(req.propertyId, { q: req.query.q, active: req.query.active }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const agent = await agentService.getAgent(req.propertyId, req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const result = await agentService.createAgent(req.propertyId, req.body, { userId: req.user.id, canBill: canBill(req) });
    if (result.error) return res.status(result.code === 'DUPLICATE' ? 409 : 400).json(result);
    res.status(201).json(result.agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const result = await agentService.updateAgent(req.propertyId, req.params.id, req.body, { canBill: canBill(req) });
    if (result.error) return res.status(result.code === 'NOT_FOUND' ? 404 : result.code === 'DUPLICATE' ? 409 : 400).json({ error: result.error });
    res.json(result.agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Credit-limit check (warn only — never blocks). `amount` = the prospective
// booking's total; omit to just read what the agent owes now.
router.get('/:id/credit-check', auth, async (req, res) => {
  try {
    const agent = await agentService.getAgent(req.propertyId, req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const amount = Math.max(0, parseFloat(req.query.amount) || 0);
    const current_outstanding = await agentBilling.getAgentOutstanding(req.propertyId, agent.id);
    const projected_outstanding = Math.round((current_outstanding + amount) * 100) / 100;
    const credit_limit = agent.credit_limit == null ? null : parseFloat(agent.credit_limit);
    const would_exceed = credit_limit != null && projected_outstanding > credit_limit;
    res.json({
      agent_id: agent.id, name: agent.name, credit_limit, current_outstanding, amount, projected_outstanding,
      would_exceed, over_by: would_exceed ? Math.round((projected_outstanding - credit_limit) * 100) / 100 : 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
