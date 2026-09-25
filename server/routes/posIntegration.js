const router = require('express').Router();
const authPos = require('../middleware/authPos');
const moduleGuard = require('../middleware/moduleGuard');
const pos = require('../services/posIntegrationService');
const db = require('../db');
const fs = require('fs');
const path = require('path');

// External POS API (migration 070) — called by the POS's backend with the
// property's pos_api_key as a Bearer token. Per-route guard, same convention
// as /api/kitchen and /api/resto.
const gate = [authPos, moduleGuard('pos_integration')];

// GET /api/pos/rooms — every checked-in room, for a room picker.
router.get('/rooms', gate, async (req, res) => {
  try {
    res.json(await pos.listInHouseRooms(req.propertyId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/rooms/:room — one room by name or Room ID, 404 if nobody is
// checked in there.
router.get('/rooms/:room', gate, async (req, res) => {
  try {
    const found = await pos.lookupRoom(req.propertyId, req.params.room);
    if (!found) return res.status(404).json({ error: 'No guest is checked in to that room' });
    res.json(found);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/transactions — charge a bill to a room.
// Body: { room | booking_id, amount (NET: after discount, before service/tax),
//         description, external_ref (the POS transaction id — makes retries safe) }
router.post('/transactions', gate, async (req, res) => {
  const { room, booking_id, amount, description, external_ref } = req.body || {};
  try {
    const result = await pos.postTransaction(req.propertyId, {
      bookingId: booking_id, room, amount, description, externalRef: external_ref,
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/branding — the property's name, contact details, brand colour
// and logo, so the POS can copy them (Setup → Branding → "Copy from hotel
// PMS"). The logo is sent inline (base64) rather than as a URL: the POS
// server then doesn't depend on how /property-logos is proxied here.
router.get('/branding', gate, async (req, res) => {
  try {
    const { rows: [b] } = await db.query(
      `SELECT COALESCE(ps.property_name, p.name) AS name, ps.property_address AS address,
              ps.property_phone AS phone, ps.property_email AS email, ps.brand_color, ps.logo_url
       FROM properties p LEFT JOIN property_settings ps ON ps.property_id = p.id
       WHERE p.id = $1`, [req.propertyId]);
    if (!b) return res.status(404).json({ error: 'Property not found' });
    let logo = null;
    if (b.logo_url) {
      const file = path.join(__dirname, '../uploads/property-logos', path.basename(b.logo_url));
      try {
        const data = await fs.promises.readFile(file);
        const ext = path.extname(file).toLowerCase();
        logo = { mime: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png', data: data.toString('base64') };
      } catch (_) { /* logo file missing — send the rest */ }
    }
    res.json({ name: b.name, address: b.address, phone: b.phone, email: b.email, brand_color: b.brand_color, logo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
