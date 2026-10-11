// Ask — /api/assistant
//   POST /ask { messages: [{ role: 'user' | 'assistant', text }] }
//        → { reply, understood, cards, ok }
// The browser sends the conversation so far (text only); the last message is
// the question. Owner, or the assistant permission; module `assistant`.
// Read-only: see services/assistant.js and assistantTools.js.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { ask, isConfigured, MAX_CHARS } = require('../services/assistant');

// Each question costs API usage — a per-person cap on top of the app-wide limit.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => 'ask:' + (req.user?.id || req.ip),
  message: { error: 'Too many questions — try again in a few minutes' },
});

router.post('/ask', limiter, async (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: 'Ask is not set up on this server yet' });
  const messages = req.body?.messages;
  const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
  if (!last || last.role !== 'user' || typeof last.text !== 'string' || !last.text.trim()) {
    return res.status(400).json({ error: 'A question is required' });
  }
  if (last.text.length > MAX_CHARS) return res.status(400).json({ error: `Keep the question under ${MAX_CHARS} characters` });
  try {
    res.json(await ask(req.propertyId, req.user, messages));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
