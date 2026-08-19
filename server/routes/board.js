const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const activitiesService = require('../services/activitiesService');

async function activitiesModuleEnabled(propertyId) {
  const { rows } = await db.query(
    "SELECT is_enabled FROM property_modules WHERE property_id = $1 AND module = 'activities'",
    [propertyId]
  );
  return !!rows[0]?.is_enabled;
}

// Resolves what a card's activity_id should become when going Free -> Paid:
// either link to an existing, unlinked activities row (linkActivityId) or
// create a new one from the card's own title/body (price). excludeCardId
// scopes the "already linked to another card" check on PUT (a card is never
// "linked to itself" yet at this point since existing.activity_id is null
// in the only branch that calls this, but pass it through for correctness).
async function linkOrCreateActivity(propertyId, { name, description, price, linkActivityId, excludeCardId }) {
  if (linkActivityId) {
    const { rows: [activity] } = await db.query(
      'SELECT id FROM activities WHERE id = $1 AND property_id = $2',
      [linkActivityId, propertyId]
    );
    if (!activity) return { error: 'Activity not found', status: 404 };
    const { rows: [taken] } = await db.query(
      'SELECT id FROM guest_board_cards WHERE activity_id = $1 AND property_id = $2 AND id IS DISTINCT FROM $3',
      [linkActivityId, propertyId, excludeCardId || null]
    );
    if (taken) return { error: 'That activity is already linked to another card', status: 409 };
    return { activityId: linkActivityId };
  }
  if (price === undefined || price === '') return { error: 'price or link_activity_id required for a paid card', status: 400 };
  const activity = await activitiesService.createActivity(propertyId, { name, description, category: 'tour', price });
  return { activityId: activity.id };
}

const UPLOAD_DIR = path.join(__dirname, '../uploads/board');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function saveResized(buffer, filename) {
  const outPath = path.join(UPLOAD_DIR, filename);
  await sharp(buffer)
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(outPath);
  return `/board-images/${filename}`;
}

// GET /api/board — all cards ordered by category priority then sort_order
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT c.*, a.price AS activity_price, a.is_available AS activity_available
      FROM guest_board_cards c
      LEFT JOIN activities a ON a.id = c.activity_id
      WHERE c.property_id = $1
      ORDER BY
        CASE c.category WHEN 'notice' THEN 0 WHEN 'activity' THEN 1 WHEN 'dining' THEN 2 WHEN 'property' THEN 3 END,
        c.sort_order, c.id
    `, [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/board — create card
router.post('/', auth, upload.single('image'), async (req, res) => {
  const { title, body, category, meta, active, sort_order, paid, price, link_activity_id } = req.body;
  if (!title || !body || !category) {
    return res.status(400).json({ error: 'title, body, and category are required' });
  }
  if (paid === 'true' && !(await activitiesModuleEnabled(req.propertyId))) {
    return res.status(403).json({ error: 'Module not enabled for this property' });
  }
  try {
    let activityId = null;
    if (paid === 'true') {
      const result = await linkOrCreateActivity(req.propertyId, { name: title, description: body, price, linkActivityId: link_activity_id });
      if (result.error) return res.status(result.status).json({ error: result.error });
      activityId = result.activityId;
    }
    const filename = req.file ? `board-${Date.now()}.jpg` : null;
    const imageUrl = req.file ? await saveResized(req.file.buffer, filename) : null;
    const { rows: [card] } = await db.query(
      `INSERT INTO guest_board_cards (title, body, category, meta, image_url, active, sort_order, property_id, activity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [title, body, category, meta || null, imageUrl, active !== 'false', parseInt(sort_order) || 0, req.propertyId, activityId]
    );
    res.status(201).json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/board/:id — update card (with optional new image)
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  const { title, body, category, meta, active, sort_order, paid, price, link_activity_id } = req.body;
  try {
    const { rows: [existing] } = await db.query('SELECT * FROM guest_board_cards WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!existing) return res.status(404).json({ error: 'Card not found' });

    let activityId = existing.activity_id;
    if (paid === 'true' && !existing.activity_id) {
      // Free -> Paid: link to an existing activity or create a new one.
      // Module must be on — a property without it has no booking backend
      // for this card to point at.
      if (!(await activitiesModuleEnabled(req.propertyId))) {
        return res.status(403).json({ error: 'Module not enabled for this property' });
      }
      const result = await linkOrCreateActivity(req.propertyId, {
        name: title ?? existing.title, description: body ?? existing.body, price, linkActivityId: link_activity_id, excludeCardId: existing.id,
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      activityId = result.activityId;
    } else if (paid === 'false' && existing.activity_id) {
      // Paid -> Free: never delete the activities row (booking history may
      // reference it), just deactivate and unlink.
      await activitiesService.setAvailability(req.propertyId, existing.activity_id, false);
      activityId = null;
    }
    // Once linked, price/commerce fields stay read-only from Guest Board — any
    // `price` sent while already linked is ignored, on purpose.

    let imageUrl = existing.image_url;
    if (req.file) {
      if (existing.image_url) {
        const oldFile = path.join(UPLOAD_DIR, path.basename(existing.image_url));
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      }
      const filename = `board-${Date.now()}.jpg`;
      imageUrl = await saveResized(req.file.buffer, filename);
    }

    const { rows: [card] } = await db.query(
      `UPDATE guest_board_cards SET title=$1, body=$2, category=$3, meta=$4, image_url=$5,
       active=$6, sort_order=$7, activity_id=$8, updated_at=NOW() WHERE id=$9 AND property_id=$10 RETURNING *`,
      [
        title ?? existing.title,
        body ?? existing.body,
        category ?? existing.category,
        meta !== undefined ? (meta || null) : existing.meta,
        imageUrl,
        active !== undefined ? active !== 'false' : existing.active,
        sort_order !== undefined ? parseInt(sort_order) : existing.sort_order,
        activityId,
        req.params.id,
        req.propertyId,
      ]
    );
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/board/:id/toggle — quick active toggle
router.patch('/:id/toggle', auth, async (req, res) => {
  try {
    const { rows: [card] } = await db.query(
      'UPDATE guest_board_cards SET active = NOT active, updated_at = NOW() WHERE id = $1 AND property_id = $2 RETURNING *',
      [req.params.id, req.propertyId]
    );
    if (!card) return res.status(404).json({ error: 'Card not found' });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/board/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rows: [card] } = await db.query('DELETE FROM guest_board_cards WHERE id=$1 AND property_id=$2 RETURNING *', [req.params.id, req.propertyId]);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    if (card.activity_id) {
      await activitiesService.setAvailability(req.propertyId, card.activity_id, false);
    }
    if (card.image_url) {
      const file = path.join(UPLOAD_DIR, path.basename(card.image_url));
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
