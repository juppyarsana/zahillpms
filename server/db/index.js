const { Pool, types } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Return DATE as plain 'YYYY-MM-DD' string instead of a JavaScript Date object.
// Without this, pg applies a local timezone offset which shifts dates by one day
// on UTC+8 servers (e.g. Bali), causing display bugs and incorrect availability checks.
types.setTypeParser(1082, val => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  options: '-c timezone=Asia/Makassar',
});

pool.on('error', (err) => {
  console.error('[DB] Idle client error:', err.message);
  // Pool automatically creates a new connection on the next query — no restart needed
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
