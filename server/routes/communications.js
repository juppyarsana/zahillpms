const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { sendBookingEmail } = require('../services/mailer');

const TRIGGERS = ['booking_confirmed', 'pre_arrival', 'post_checkout'];

// GET /api/communications/templates
router.get('/templates', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM email_templates WHERE property_id = $1 ORDER BY trigger',
      [req.propertyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/communications/templates/:trigger
router.put('/templates/:trigger', auth, async (req, res) => {
  const { trigger } = req.params;
  if (!TRIGGERS.includes(trigger)) return res.status(400).json({ error: `trigger must be one of ${TRIGGERS.join(', ')}` });

  const { subject, body_html, is_active } = req.body;
  if (!subject || !subject.trim()) return res.status(400).json({ error: 'subject required' });
  if (!body_html || !body_html.trim()) return res.status(400).json({ error: 'body_html required' });

  try {
    const { rows: [tmpl] } = await db.query(
      `INSERT INTO email_templates (property_id, trigger, subject, body_html, is_active)
       VALUES ($1, $2, $3, $4, COALESCE($5, true))
       ON CONFLICT (property_id, trigger) DO UPDATE SET
         subject   = EXCLUDED.subject,
         body_html = EXCLUDED.body_html,
         is_active = COALESCE($5, email_templates.is_active),
         updated_at = NOW()
       RETURNING *`,
      [req.propertyId, trigger, subject.trim(), body_html, is_active ?? null]
    );
    res.json(tmpl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/communications/log?bookingId=&limit=50
router.get('/log', auth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const params = [req.propertyId];
    let query = 'SELECT * FROM communication_log WHERE property_id = $1';
    if (req.query.bookingId) {
      params.push(req.query.bookingId);
      query += ` AND booking_id = $${params.length}`;
    }
    params.push(limit);
    query += ` ORDER BY sent_at DESC LIMIT $${params.length}`;

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/communications/test/:trigger  { booking_id }
// Sends immediately, ignoring the cron dedup guard — for owners to preview with real data.
router.post('/test/:trigger', auth, async (req, res) => {
  const { trigger } = req.params;
  if (!TRIGGERS.includes(trigger)) return res.status(400).json({ error: `trigger must be one of ${TRIGGERS.join(', ')}` });

  const { booking_id } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const { rows: [booking] } = await db.query('SELECT id FROM bookings WHERE id = $1 AND property_id = $2', [booking_id, req.propertyId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const result = await sendBookingEmail(req.propertyId, booking_id, trigger);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
