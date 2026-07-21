const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const { rows } = await db.query(
      `SELECT u.*, r.allowed_menus
       FROM users u LEFT JOIN roles r ON u.role = r.id AND r.property_id = u.property_id
       WHERE u.email = $1
       LIMIT 1`,
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const tokenPayload = user.is_superadmin
      ? { id: user.id, name: user.name, email: user.email, role: user.role, isSuperAdmin: true }
      : { id: user.id, name: user.name, email: user.email, role: user.role, propertyId: user.property_id };

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    const userPayload = {
      id: user.id, name: user.name, email: user.email, role: user.role,
      allowed_menus: user.allowed_menus || [],
      is_superadmin: user.is_superadmin || false,
    };
    res.json({ token, user: userPayload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout  (stateless JWT — client drops token)
router.post('/logout', (req, res) => res.json({ message: 'Logged out' }));

// POST /api/auth/seed-owner  (one-time setup, disable in production)
router.post('/seed-owner', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'Forbidden' });
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password_hash, role, property_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, property_id',
      [name, email.toLowerCase(), hash, 'owner', process.env.ZAHILL_PROPERTY_ID]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
