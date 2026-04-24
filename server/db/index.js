const { Pool, types } = require('pg');
require('dotenv').config();

// Return DATE as plain 'YYYY-MM-DD' string instead of a JavaScript Date object.
// Without this, pg applies a local timezone offset which shifts dates by one day
// on UTC+8 servers (e.g. Bali), causing display bugs and incorrect availability checks.
types.setTypeParser(1082, val => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected DB error', err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
