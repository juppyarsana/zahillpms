module.exports = function authDisplay(req, res, next) {
  const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const token = headerToken || (req.query.token || '');
  if (!token || token !== process.env.DISPLAY_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
