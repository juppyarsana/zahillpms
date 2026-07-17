const db = require('../db');

function moduleGuard(moduleName) {
  return async (req, res, next) => {
    try {
      const { rows } = await db.query(
        'SELECT is_enabled FROM property_modules WHERE property_id = $1 AND module = $2',
        [req.propertyId, moduleName]
      );
      if (!rows[0] || !rows[0].is_enabled) {
        return res.status(403).json({ error: 'Module not enabled for this property' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = moduleGuard;
