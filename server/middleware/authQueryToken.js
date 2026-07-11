const jwt = require('jsonwebtoken');

// Same JWT staff auth as auth.js, but reads the token from ?token= instead of
// the Authorization header — EventSource can't set custom headers.
module.exports = function authQueryToken(req, res, next) {
  const token = (req.query.token || '').toString();
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
