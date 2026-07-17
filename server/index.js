require('dotenv').config();
const express = require('express');

process.on('uncaughtException',      err => console.error('[CRASH] Uncaught exception:',       err));
process.on('unhandledRejection', (reason) => console.error('[CRASH] Unhandled rejection:', reason));
const mqttClient = require('./mqtt');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

app.set('trust proxy', 1); // Trust Nginx reverse proxy
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// Each *_URL env var may be a comma-separated list (e.g. localhost + a LAN IP
// for testing on a real tablet/TV on the same network).
function parseOrigins(value, fallback) {
  return (value || fallback).split(',').map(s => s.trim()).filter(Boolean);
}
const allowedOrigins = [
  ...parseOrigins(process.env.CLIENT_URL,  'http://localhost:5174'),
  ...parseOrigins(process.env.DISPLAY_URL, 'http://localhost:5175'),
  ...parseOrigins(process.env.TV_URL,      'http://localhost:5176'),
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);

// Protected uploads (served only to authenticated users via separate route)
const auth = require('./middleware/auth');
app.use('/uploads', auth, express.static(path.join(__dirname, 'uploads')));

// Board card images are guest-facing — served without auth
app.use('/board-images', express.static(path.join(__dirname, 'uploads/board')));

// Routes
const moduleGuard = require('./middleware/moduleGuard');
const authSuperAdmin = require('./middleware/authSuperAdmin');

// Superadmin — separate auth layer above the property level, no moduleGuard
app.use('/api/admin', authSuperAdmin, require('./routes/admin'));

// Core routes — no module guard (always on)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/units', require('./routes/units'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/display', require('./routes/display'));

// Module-gated routes — auth runs here so moduleGuard has req.propertyId
// (each route file also calls auth internally per-handler; running it twice
// is redundant but harmless — same JWT, same result)
app.use('/api/bookings', auth, moduleGuard('reservations'), require('./routes/bookings'));
app.use('/api/checkin', auth, moduleGuard('front_desk'), require('./routes/checkin'));
app.use('/api/allotments', auth, moduleGuard('reservations'), require('./routes/allotments'));
app.use('/api/pricing', auth, moduleGuard('reservations'), require('./routes/pricing'));
app.use('/api/guests', auth, moduleGuard('guest_crm'), require('./routes/guests'));
app.use('/api/loyalty', auth, moduleGuard('guest_crm'), require('./routes/loyalty'));
app.use('/api/payments', auth, moduleGuard('financial'), require('./routes/payments'));
app.use('/api/reports', auth, moduleGuard('financial'), require('./routes/reports'));
app.use('/api/night-audit', auth, moduleGuard('financial'), require('./routes/nightAudit'));
app.use('/api/tasks', auth, moduleGuard('operations'), require('./routes/tasks'));
app.use('/api/products', auth, moduleGuard('sales'), require('./routes/products'));
app.use('/api/sales', auth, moduleGuard('sales'), require('./routes/sales'));
app.use('/api/board', auth, moduleGuard('in_room_media'), require('./routes/board'));
app.use('/api/iot', auth, moduleGuard('room_controller'), require('./routes/iot'));
app.use('/api/insights', auth, moduleGuard('insights'), require('./routes/insights'));

// /api/calls mixes three auth mechanisms (staff auth, authDisplay for the
// room's own call actions, authQueryToken for the staff SSE stream) — a
// blanket `auth` here would 401 every authDisplay-protected room endpoint.
// moduleGuard('room_controller') is applied per-route inside routes/calls.js instead.
app.use('/api/calls', require('./routes/calls'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Zahill PMS server running on port ${PORT}`);
  if (process.env.MQTT_BROKER) {
    mqttClient.connect();
  } else {
    console.log('[MQTT] MQTT_BROKER not set — skipping MQTT connection');
  }
  require('./jobs').registerJobs();
});
