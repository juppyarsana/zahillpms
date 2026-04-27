const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Migrations that existed before the tracker was introduced.
// Only used once — when _migrations is empty but the DB is already set up.
const PRE_TRACKER = [
  '001_initial.sql',
  '002_pricing_periods.sql',
  '003_deposit_amount.sql',
];

async function migrate() {
  const client = await pool.connect();
  try {
    // Create the tracker table on first ever run
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // Auto-baseline: if tracker is empty but the DB is already set up,
    // mark pre-tracker migrations as applied without re-running them.
    const { rows: [{ count }] } = await client.query('SELECT COUNT(*) FROM _migrations');
    if (count === '0') {
      const { rows: [{ t }] } = await client.query(`SELECT to_regclass('public.bookings') AS t`);
      if (t) {
        for (const file of PRE_TRACKER) {
          await client.query(
            'INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [file]
          );
        }
        console.log('Existing DB detected — baseline migrations marked as applied.');
      }
    }

    // Fetch already-applied migrations
    const { rows } = await client.query('SELECT filename FROM _migrations');
    const applied = new Set(rows.map(r => r.filename));

    // Auto-scan: pick up every .sql file in the folder, sorted by name
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ ${file}`);
      ran++;
    }

    console.log(ran > 0 ? `Done — ${ran} migration(s) applied.` : 'Done — nothing new to apply.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
