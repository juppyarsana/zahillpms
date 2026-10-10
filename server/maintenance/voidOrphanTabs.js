// Restaurant-app orders left as an open tab with no table. Until 2026-10-11
// Take Order accepted "Takeaway" with no payment method: the order was kept
// 'unpaid', but an open tab is only ever paid from its table's Settle — with
// no table it could never be settled or cancelled, and the Reports page kept
// counting it. This lists them and, with --apply, voids each the way a voided
// sale is (kept, marked voided + 'rejected', stock back). No money changes:
// nothing was received for them.
//
//   node maintenance/voidOrphanTabs.js [--property <slug>] [--apply]
require('dotenv').config();
const db = require('../db');

const REASON = 'Open tab with no table (test order) — could not be settled';

(async () => {
  const i = process.argv.indexOf('--property');
  const slug = i > -1 ? process.argv[i + 1] : null;
  const apply = process.argv.includes('--apply');
  const { rows } = await db.query(
    `SELECT s.id, s.property_id, p.slug, s.total_amount::float AS amount, u.name AS entered_by,
            to_char(s.created_at AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD HH24:MI') AS made,
            (SELECT string_agg(si.quantity || 'x ' || pr.name, ', ')
               FROM sale_items si JOIN products pr ON pr.id = si.product_id WHERE si.sale_id = s.id) AS items
       FROM sales s
       JOIN properties p ON p.id = s.property_id
       LEFT JOIN users u ON u.id = s.served_by
      WHERE s.payment_method = 'unpaid' AND s.table_session_id IS NULL AND s.table_id IS NULL
        AND s.confirmation_status IS DISTINCT FROM 'rejected'
        AND ($1::text IS NULL OR p.slug = $1)
      ORDER BY p.slug, s.created_at`, [slug]);
  const rp = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  if (!rows.length) console.log('No open tab without a table.');
  for (const r of rows) {
    let done = '';
    if (apply) {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: items } = await client.query(
          `SELECT si.product_id, si.quantity, si.per_night, pr.track_stock
             FROM sale_items si JOIN products pr ON pr.id = si.product_id WHERE si.sale_id = $1 FOR UPDATE OF pr`, [r.id]);
        for (const it of items) {
          if (!it.track_stock || it.per_night) continue;
          await client.query('UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2', [it.quantity, it.product_id]);
          await client.query(
            `INSERT INTO stock_movements (property_id, product_id, change_qty, reason, reference_id, note)
             VALUES ($1, $2, $3, 'adjustment', $4, 'Sale voided')`, [r.property_id, it.product_id, it.quantity, r.id]);
        }
        await client.query(
          `UPDATE sales SET confirmation_status = 'rejected', rejection_reason = $1, kitchen_status = NULL,
                  voided_at = NOW(), void_reason = $1 WHERE id = $2`, [REASON, r.id]);
        await client.query('COMMIT');
        done = ' → voided';
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        done = ` → FAILED: ${e.message}`;
      } finally {
        client.release();
      }
    }
    console.log(`${r.slug} · ${r.made} · ${rp(r.amount)} · ${r.items || 'no items'} · entered by ${r.entered_by || 'unknown'}${done}`);
  }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  console.log(`\n${rows.length} order(s), ${rp(total)}${apply ? '.' : rows.length ? ' — run again with --apply to void them.' : '.'}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
