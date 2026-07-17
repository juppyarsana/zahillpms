const db = require('../db');

// Room Display / TV Display auth — each property has its own display_token
// (see migration 021). Devices send that token instead of a staff JWT.
module.exports = async function authDisplay(req, res, next) {
  const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const token = headerToken || (req.query.token || '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { rows } = await db.query(
      'SELECT id FROM properties WHERE display_token = $1 AND is_active = true',
      [token]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Unauthorized' });
    req.propertyId = rows[0].id;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
