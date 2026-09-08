const db = require('../db');

// Guest QR self-order auth (resto-display/'s /t/:qrToken surface).
// Deliberately NOT authDisplay: properties.display_token is a property-wide
// shared secret held by staff-configured devices (Room/TV/Kitchen Display) —
// printing that on a table would let anyone who scans it reach unrelated
// endpoints for arbitrary rooms. A qr_token resolves to exactly one table on
// one property and nothing else. Read from the path (:qrToken) since that's
// how the guest's browser reaches it; ?token= is also accepted for symmetry
// with authDisplay in case an SSE stream is ever added on this surface.
module.exports = async function authTableQR(req, res, next) {
  const token = (req.params.qrToken || req.query.token || '').toString().trim();
  if (!token || token.length > 64) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { rows } = await db.query(
      `SELECT t.id AS table_id, t.name AS table_name, t.property_id
         FROM restaurant_tables t
         JOIN properties p ON p.id = t.property_id
        WHERE t.qr_token = $1 AND p.is_active = true`,
      [token]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Unauthorized' });
    req.propertyId = rows[0].property_id;
    req.tableId = rows[0].table_id;
    req.tableName = rows[0].table_name;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
