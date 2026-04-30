module.exports = function authDisplay(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token !== process.env.DISPLAY_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
