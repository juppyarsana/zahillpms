const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

const MIGRATIONS = [
  '001_initial.sql',
  '002_pricing_periods.sql',
  '003_deposit_amount.sql',
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const file of MIGRATIONS) {
      const sql = fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8');
      await client.query(sql);
      console.log(`✓ ${file}`);
    }
    console.log('All migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
