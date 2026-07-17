const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

function authSuperAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isSuperAdmin) {
      return res.status(403).json({ error: 'Superadmin access required' });
    }
    req.userId = decoded.id;
    req.isSuperAdmin = true;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = authSuperAdmin;
