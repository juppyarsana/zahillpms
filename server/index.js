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
  ...parseOrigins(process.env.KITCHEN_URL, 'http://localhost:5177'),
  ...parseOrigins(process.env.RESTO_URL,   'http://localhost:5178'),
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
// (uploads/ is no longer served statically: guest ID documents are personal
// data and are only served per property via GET /api/guests/:id/id-document.
// Logos and Guest Board images keep their own public routes below.)

// Board card images are guest-facing — served without auth
app.use('/board-images', express.static(path.join(__dirname, 'uploads/board')));

// Property logos — needed pre-auth (login screen), by display_token apps
// (Room Display/TV Display), and by external email clients — no auth possible
app.use('/property-logos', express.static(path.join(__dirname, 'uploads/property-logos')));

// Routes
const moduleGuard = require('./middleware/moduleGuard');
const authSuperAdmin = require('./middleware/authSuperAdmin');
const requireRole = require('./middleware/role');

// Superadmin — separate auth layer above the property level, no moduleGuard
app.use('/api/admin', authSuperAdmin, require('./routes/admin'));

// Core routes — no module guard (always on)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/public', require('./routes/public'));
app.use('/api/units', require('./routes/units'));
app.use('/api/room-types', require('./routes/roomTypes'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/communications', auth, requireRole('owner'), require('./routes/communications'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/display', require('./routes/display'));

// Module-gated routes — auth runs here so moduleGuard has req.propertyId
// (each route file also calls auth internally per-handler; running it twice
// is redundant but harmless — same JWT, same result)
app.use('/api/bookings', auth, moduleGuard('reservations'), require('./routes/bookings'));
app.use('/api/checkin', auth, moduleGuard('front_desk'), require('./routes/checkin'));
app.use('/api/allotments', auth, moduleGuard('reservations'), require('./routes/allotments'));
app.use('/api/pricing', auth, moduleGuard('reservations'), require('./routes/pricing'));
app.use('/api/rate-plans', auth, moduleGuard('reservations'), require('./routes/ratePlans'));
app.use('/api/guests', auth, moduleGuard('guest_crm'), require('./routes/guests'));
app.use('/api/loyalty', auth, moduleGuard('guest_crm'), require('./routes/loyalty'));
app.use('/api/payments', auth, moduleGuard('financial'), require('./routes/payments'));
app.use('/api/reports', auth, moduleGuard('financial'), require('./routes/reports'));
app.use('/api/night-audit', auth, moduleGuard('financial'), require('./routes/nightAudit'));
app.use('/api/folio', auth, moduleGuard('financial'), require('./routes/folio'));
app.use('/api/agents', auth, moduleGuard('financial'), require('./routes/agents'));
app.use('/api/tasks', auth, moduleGuard('operations'), require('./routes/tasks'));
app.use('/api/products', auth, moduleGuard('sales'), require('./routes/products'));
app.use('/api/sales', auth, moduleGuard('sales'), require('./routes/sales'));
app.use('/api/tables', auth, moduleGuard('sales'), require('./routes/tables'));
app.use('/api/board', auth, moduleGuard('in_room_media'), require('./routes/board'));
app.use('/api/iot', auth, moduleGuard('room_controller'), require('./routes/iot'));
app.use('/api/insights', auth, moduleGuard('insights'), require('./routes/insights'));
app.use('/api/activities', auth, moduleGuard('activities'), require('./routes/activities'));
app.use('/api/purchasing', auth, moduleGuard('back_office'), require('./routes/purchasing'));
app.use('/api/expenses', auth, moduleGuard('back_office'), require('./routes/expenses'));
app.use('/api/yield', auth, moduleGuard('yield_management'), requireRole('owner'), require('./routes/yield'));
app.use('/api/channel-manager', auth, moduleGuard('channel_manager'), require('./routes/channelManager'));
// Reports & Alerts: free instant Telegram alerts for every property; the
// scheduled reports are the paid `smart_reports` module, checked per report
// inside the route file.
app.use('/api/smart-reports', auth, requireRole('owner'), require('./routes/smartReports'));

// /api/calls mixes three auth mechanisms (staff auth, authDisplay for the
// room's own call actions, authQueryToken for the staff SSE stream) — a
// blanket `auth` here would 401 every authDisplay-protected room endpoint.
// moduleGuard('calling') is applied per-route inside routes/calls.js instead.
app.use('/api/calls', require('./routes/calls'));

// /api/kitchen — kitchen-display/ kiosk app, authDisplay (device token) on
// every route, same as /api/display. moduleGuard('sales') applied per-route
// inside routes/kitchen.js instead of here.
app.use('/api/kitchen', require('./routes/kitchen'));

// /api/resto — resto-display/ app. Two auth models in one feature:
//   - /api/resto/guest/* uses authTableQR (per-table QR token, printed on the
//     table — NOT the property-wide display_token, which must never be public)
//   - /api/resto/*       uses staff JWT (auth), plus authQueryToken for /stream
// moduleGuard('resto_ordering') is applied per-route inside both files rather
// than here, same reason as /api/kitchen and /api/calls. Mount order matters:
// /api/resto/guest must be registered before the bare /api/resto mount.
app.use('/api/resto/guest', require('./routes/restoGuest'));
app.use('/api/resto', require('./routes/resto'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`Zahill PMS server running on port ${PORT}`);
  if (!process.env.MQTT_BROKER) {
    console.log('[MQTT] MQTT_BROKER not set — skipping MQTT connection');
  } else {
    // MQTT is one app-wide connection, not per-property — only worth opening (and
    // retrying on failure) if at least one active property actually uses Room
    // Controller. Otherwise a deployment with zero IoT-hardware clients would spend
    // forever retrying a broker nothing needs. Re-checked whenever a property's
    // room_controller module is toggled on (see routes/admin.js), so this doesn't
    // require a server restart to take effect later.
    const { rows } = await require('./db').query(
      `SELECT 1 FROM property_modules pm JOIN properties p ON p.id = pm.property_id
       WHERE pm.module = 'room_controller' AND pm.is_enabled = true AND p.is_active = true LIMIT 1`
    );
    if (rows.length) {
      mqttClient.connect();
    } else {
      console.log('[MQTT] No active property has Room Controller enabled — skipping MQTT connection');
    }
  }
  require('./jobs').registerJobs();
});
