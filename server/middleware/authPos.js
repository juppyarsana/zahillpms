const db = require('../db');

// External POS auth — each property has its own pos_api_key (migration 070),
// generated/rotated by the owner in Settings → Property Details. A POS backend
// can always set headers, so there's no ?token= fallback (unlike authDisplay).
module.exports = async function authPos(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { rows } = await db.query(
      'SELECT id FROM properties WHERE pos_api_key = $1 AND is_active = true',
      [token]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Unauthorized' });
    req.propertyId = rows[0].id;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
