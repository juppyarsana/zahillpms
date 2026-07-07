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
const allowedOrigins = [
  process.env.CLIENT_URL   || 'http://localhost:5173',
  process.env.DISPLAY_URL  || 'http://localhost:5174',
  process.env.TV_URL       || 'http://localhost:5176',
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
app.use('/api/auth', require('./routes/auth'));
app.use('/api/units', require('./routes/units'));
app.use('/api/guests', require('./routes/guests'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/checkin', require('./routes/checkin'));
app.use('/api/allotments', require('./routes/allotments'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/loyalty', require('./routes/loyalty'));
app.use('/api/products', require('./routes/products'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/pricing', require('./routes/pricing'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/iot', require('./routes/iot'));
app.use('/api/board', require('./routes/board'));
app.use('/api/display', require('./routes/display'));
app.use('/api/night-audit', require('./routes/nightAudit'));
app.use('/api/insights', require('./routes/insights'));

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
