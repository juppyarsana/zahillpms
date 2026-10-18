const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const os = require('os');
const activitiesService = require('../services/activitiesService');
const { checkMp4 } = require('../services/videoCheck');

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

// Uploads go to a temp file, not memory: a lobby video can be ~100 MB and the
// server has 1 GB. Pictures are resized from there, videos copied into place.
const IMAGE_MAX = 10 * 1024 * 1024;
const VIDEO_MAX = 100 * 1024 * 1024;
const VIDEO_MAX_SECONDS = 120;
const multerUpload = multer({ dest: os.tmpdir(), limits: { fileSize: VIDEO_MAX, files: 2 } })
  .fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]);
function upload(req, res, next) {
  multerUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'The file is too big — a video can be at most 100 MB, a picture 10 MB.' });
    return res.status(400).json({ error: err.message });
  });
}
const uploaded = (req, field) => req.files?.[field]?.[0] || null;
function removeTemp(req) {
  for (const list of Object.values(req.files || {})) for (const f of list) fs.rm(f.path, { force: true }, () => {});
}
function removeStored(url) {
  if (!url) return;
  const file = path.join(UPLOAD_DIR, path.basename(url));
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

const SHOW_ON = ['rooms', 'lobby', 'both'];
const parseShowOn = (v) => (v === undefined || v === '' ? undefined : SHOW_ON.includes(v) ? v : null);

// An uploaded video -> its URL, or { error } when the TV could not play it.
function takeVideo(file) {
  if (!/\.(mp4|m4v)$/i.test(file.originalname || '') && !/^video\/mp4$/i.test(file.mimetype || '')) {
    return { error: 'Upload an MP4 video (H.264). An iPhone .mov must be exported as MP4 first.' };
  }
  const check = checkMp4(file.path);
  if (!check.ok) return { error: check.error };
  if (check.seconds != null && check.seconds > VIDEO_MAX_SECONDS) {
    return { error: `This video is ${Math.round(check.seconds)} seconds — keep lobby videos to ${VIDEO_MAX_SECONDS / 60} minutes at most.` };
  }
  const filename = `board-video-${Date.now()}.mp4`;
  fs.copyFileSync(file.path, path.join(UPLOAD_DIR, filename));
  return { url: `/board-images/${filename}` };
}

async function saveResized(input, filename) {
  const outPath = path.join(UPLOAD_DIR, filename);
  await sharp(input)
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
router.post('/', auth, upload, async (req, res) => {
  try {
    await createCard(req, res);
  } finally {
    removeTemp(req);
  }
});
async function createCard(req, res) {
  const { title, body, category, meta, active, sort_order, paid, price, link_activity_id, video_sound } = req.body;
  if (!title || !body || !category) {
    return res.status(400).json({ error: 'title, body, and category are required' });
  }
  const showOn = parseShowOn(req.body.show_on);
  if (showOn === null) return res.status(400).json({ error: 'show_on must be rooms, lobby or both' });
  const image = uploaded(req, 'image');
  if (image && image.size > IMAGE_MAX) return res.status(400).json({ error: 'A picture can be at most 10 MB.' });
  if (paid === 'true' && !(await activitiesModuleEnabled(req.propertyId))) {
    return res.status(403).json({ error: 'Module not enabled for this property' });
  }
  try {
    let videoUrl = null;
    if (uploaded(req, 'video')) {
      const v = takeVideo(uploaded(req, 'video'));
      if (v.error) return res.status(400).json({ error: v.error });
      videoUrl = v.url;
    }
    let activityId = null;
    if (paid === 'true') {
      const result = await linkOrCreateActivity(req.propertyId, { name: title, description: body, price, linkActivityId: link_activity_id });
      if (result.error) return res.status(result.status).json({ error: result.error });
      activityId = result.activityId;
    }
    const filename = image ? `board-${Date.now()}.jpg` : null;
    const imageUrl = image ? await saveResized(fs.readFileSync(image.path), filename) : null;
    const { rows: [card] } = await db.query(
      `INSERT INTO guest_board_cards (title, body, category, meta, image_url, active, sort_order, property_id, activity_id,
                                      show_on, video_url, video_sound)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [title, body, category, meta || null, imageUrl, active !== 'false', parseInt(sort_order) || 0, req.propertyId, activityId,
        showOn || 'both', videoUrl, video_sound !== 'false']
    );
    res.status(201).json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PUT /api/board/:id — update card (with optional new image)
router.put('/:id', auth, upload, async (req, res) => {
  try {
    await updateCard(req, res);
  } finally {
    removeTemp(req);
  }
});
async function updateCard(req, res) {
  const { title, body, category, meta, active, sort_order, paid, price, link_activity_id, video_sound, remove_video } = req.body;
  const showOn = parseShowOn(req.body.show_on);
  if (showOn === null) return res.status(400).json({ error: 'show_on must be rooms, lobby or both' });
  const image = uploaded(req, 'image');
  if (image && image.size > IMAGE_MAX) return res.status(400).json({ error: 'A picture can be at most 10 MB.' });
  try {
    const { rows: [existing] } = await db.query('SELECT * FROM guest_board_cards WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!existing) return res.status(404).json({ error: 'Card not found' });

    let videoUrl = existing.video_url;
    if (uploaded(req, 'video')) {
      const v = takeVideo(uploaded(req, 'video'));
      if (v.error) return res.status(400).json({ error: v.error });
      videoUrl = v.url;
    } else if (remove_video === 'true') {
      videoUrl = null;
    }


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
    if (image) {
      removeStored(existing.image_url);
      const filename = `board-${Date.now()}.jpg`;
      imageUrl = await saveResized(fs.readFileSync(image.path), filename);
    }
    if (videoUrl !== existing.video_url) removeStored(existing.video_url);

    const { rows: [card] } = await db.query(
      `UPDATE guest_board_cards SET title=$1, body=$2, category=$3, meta=$4, image_url=$5,
       active=$6, sort_order=$7, activity_id=$8, show_on=$11, video_url=$12, video_sound=$13, updated_at=NOW()
       WHERE id=$9 AND property_id=$10 RETURNING *`,
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
        showOn || existing.show_on,
        videoUrl,
        video_sound !== undefined ? video_sound !== 'false' : existing.video_sound,
      ]
    );
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

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
    removeStored(card.image_url);
    removeStored(card.video_url);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
