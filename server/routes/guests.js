const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const { saveIdDocument, idDocumentPath } = require('../services/idDocument');

const uploadId = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/guests
router.get('/', auth, async (req, res) => {
  const { search, tier, nationality } = req.query;
  let query = `
    SELECT g.*, lt.name as tier_name, lt.emoji as tier_emoji, lt.color as tier_color
    FROM guests g
    LEFT JOIN loyalty_tiers lt ON g.loyalty_tier_id = lt.id
    WHERE g.property_id = $1
  `;
  const params = [req.propertyId];
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (g.name ILIKE $${params.length} OR g.whatsapp ILIKE $${params.length} OR g.email ILIKE $${params.length})`;
  }
  if (tier) { params.push(tier); query += ` AND g.loyalty_tier_id = $${params.length}`; }
  if (nationality) { params.push(nationality); query += ` AND g.nationality ILIKE $${params.length}`; }
  query += ' ORDER BY g.name';

  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/guests/upcoming-birthdays
router.get('/upcoming-birthdays', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT *,
        (DATE_TRUNC('year', NOW()) + (birthday - DATE_TRUNC('year', birthday))) AS birthday_this_year
      FROM guests
      WHERE property_id = $1
        AND birthday IS NOT NULL
        AND (
          (DATE_TRUNC('year', NOW()) + (birthday - DATE_TRUNC('year', birthday))) BETWEEN NOW() AND NOW() + INTERVAL '30 days'
          OR
          (DATE_TRUNC('year', NOW()) + INTERVAL '1 year' + (birthday - DATE_TRUNC('year', birthday))) BETWEEN NOW() AND NOW() + INTERVAL '30 days'
        )
      ORDER BY birthday_this_year
    `, [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/guests/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const guestQ = db.query(`
      SELECT g.*, lt.name as tier_name, lt.emoji as tier_emoji, lt.color as tier_color
      FROM guests g
      LEFT JOIN loyalty_tiers lt ON g.loyalty_tier_id = lt.id
      WHERE g.id = $1 AND g.property_id = $2`, [req.params.id, req.propertyId]);
    const prefsQ = db.query('SELECT * FROM guest_preferences WHERE guest_id = $1 ORDER BY category', [req.params.id]);
    const staysQ = db.query(`
      SELECT b.*, u.name as unit_name
      FROM bookings b
      JOIN units u ON b.unit_id = u.id
      WHERE b.guest_id = $1 AND b.property_id = $2
      ORDER BY b.check_in_date DESC`, [req.params.id, req.propertyId]);

    const [{ rows: [guest] }, { rows: prefs }, { rows: stays }] = await Promise.all([guestQ, prefsQ, staysQ]);
    if (!guest) return res.status(404).json({ error: 'Guest not found' });

    const totalNights = stays.reduce((sum, s) => sum + (s.nights || 0), 0);
    const totalSpend = stays.reduce((sum, s) =>
      sum + parseFloat(s.room_revenue ?? s.total_amount ?? 0) + parseFloat(s.fnb_revenue || 0), 0);

    res.json({ ...guest, preferences: prefs, stay_history: stays, lifetime: { stays: stays.length, nights: totalNights, spend: totalSpend } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/guests
router.post('/', auth, async (req, res) => {
  const { name, nationality, id_number, whatsapp, email, birthday, anniversary, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Guest name required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO guests (name, nationality, id_number, whatsapp, email, birthday, anniversary, notes, property_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, nationality, id_number, whatsapp, email, birthday || null, anniversary || null, notes, req.propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/guests/:id
router.put('/:id', auth, async (req, res) => {
  const { name, nationality, id_number, whatsapp, email, birthday, anniversary, notes, address, preferences } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE guests SET
        name = COALESCE($1, name),
        nationality = COALESCE($2, nationality),
        id_number = COALESCE($3, id_number),
        whatsapp = COALESCE($4, whatsapp),
        email = COALESCE($5, email),
        birthday = COALESCE($6, birthday),
        anniversary = COALESCE($7, anniversary),
        notes = COALESCE($8, notes),
        address = COALESCE($11, address)
       WHERE id = $9 AND property_id = $10 RETURNING *`,
      [name, nationality, id_number, whatsapp, email, birthday || null, anniversary || null, notes, req.params.id, req.propertyId, address]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Guest not found' }); }

    if (Array.isArray(preferences)) {
      await client.query('DELETE FROM guest_preferences WHERE guest_id = $1', [req.params.id]);
      for (const p of preferences) {
        await client.query(
          'INSERT INTO guest_preferences (guest_id, category, value) VALUES ($1,$2,$3)',
          [req.params.id, p.category, p.value]
        );
      }
    }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/guests/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rows: bookings } = await db.query(
      "SELECT id FROM bookings WHERE guest_id = $1 AND property_id = $2 AND status NOT IN ('cancelled','no_show') LIMIT 1",
      [req.params.id, req.propertyId]
    );
    if (bookings.length > 0) {
      return res.status(409).json({ error: 'Cannot delete guest with existing bookings' });
    }
    const { rows } = await db.query('DELETE FROM guests WHERE id = $1 AND property_id = $2 RETURNING id', [req.params.id, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Guest not found' });
    res.json({ message: 'Guest deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/guests/:id/id-document — the guest's ID photo / scan, only for
// staff of the guest's own property (the file itself is never public).
router.get('/:id/id-document', auth, async (req, res) => {
  try {
    const { rows: [g] } = await db.query('SELECT id_document_url FROM guests WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!g) return res.status(404).json({ error: 'Guest not found' });
    const file = idDocumentPath(g.id_document_url);
    if (!file) return res.status(404).json({ error: 'No ID document on file' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(file);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/guests/:id/id-document — add or replace the guest's ID (field
// "id_document": a photo, or a PDF from the scanner). Front desk often scans
// the ID after the guest hands it over, separately from the check-in steps.
router.post('/:id/id-document', auth, uploadId.single('id_document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'id_document file required' });
  try {
    const { rows: [g] } = await db.query('SELECT id FROM guests WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!g) return res.status(404).json({ error: 'Guest not found' });
    const url = await saveIdDocument(req.file, `guest-${g.id}`);
    await db.query('UPDATE guests SET id_document_url = $1 WHERE id = $2 AND property_id = $3', [url, g.id, req.propertyId]);
    res.status(201).json({ has_id_document: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
