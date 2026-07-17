const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

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
      SELECT * FROM guest_board_cards
      WHERE property_id = $1
      ORDER BY
        CASE category WHEN 'notice' THEN 0 WHEN 'activity' THEN 1 WHEN 'dining' THEN 2 WHEN 'property' THEN 3 END,
        sort_order, id
    `, [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/board — create card
router.post('/', auth, upload.single('image'), async (req, res) => {
  const { title, body, category, meta, active, sort_order } = req.body;
  if (!title || !body || !category) {
    return res.status(400).json({ error: 'title, body, and category are required' });
  }
  try {
    const filename = req.file ? `board-${Date.now()}.jpg` : null;
    const imageUrl = req.file ? await saveResized(req.file.buffer, filename) : null;
    const { rows: [card] } = await db.query(
      `INSERT INTO guest_board_cards (title, body, category, meta, image_url, active, sort_order, property_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [title, body, category, meta || null, imageUrl, active !== 'false', parseInt(sort_order) || 0, req.propertyId]
    );
    res.status(201).json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/board/:id — update card (with optional new image)
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  const { title, body, category, meta, active, sort_order } = req.body;
  try {
    const { rows: [existing] } = await db.query('SELECT * FROM guest_board_cards WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!existing) return res.status(404).json({ error: 'Card not found' });

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
       active=$6, sort_order=$7, updated_at=NOW() WHERE id=$8 AND property_id=$9 RETURNING *`,
      [
        title ?? existing.title,
        body ?? existing.body,
        category ?? existing.category,
        meta !== undefined ? (meta || null) : existing.meta,
        imageUrl,
        active !== undefined ? active !== 'false' : existing.active,
        sort_order !== undefined ? parseInt(sort_order) : existing.sort_order,
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
