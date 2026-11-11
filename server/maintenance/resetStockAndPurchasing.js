// Starts purchasing and stock from zero for one property, then loads the item list the
// purchasing staff cleaned up (maintenance/stockResetList.txt, the hotel items = "H").
//
// WIPES (for the property): every purchase request, purchase order (with its deliveries, approvals
// and kitchen handovers), stock transfer, stock opname, stock item (with its movements and the
// quantity in each store). Supplier bills and expenses that belong to a purchase order are
// VOIDED first with a reason (kept, struck through), then the order is deleted.
// KEEPS: suppliers, stores, supplier bills and expenses with no purchase order, Sales items,
// everything about reservations. Nothing is paid back or posted, so no accounting day may be closed.
//
// Then adds the hotel stock items (H) with stock 0; the opening quantities come from a stock opname.
//
//   node maintenance/resetStockAndPurchasing.js --property zahill            dry run: done and rolled back
//   node maintenance/resetStockAndPurchasing.js --property zahill --apply    do it
// Take a backup first (bash deploy.sh --backup-only). Undo = restore that backup.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const APPLY = args.includes('--apply');
const REASON = 'Test purchasing data removed before the new item list (reset 2026-11)';
const CAT = { G: 'guest_supplies', S: 'supplies', U: 'utilities', M: 'maintenance' };
const rp = v => 'Rp ' + Number(v).toLocaleString('id-ID');

function loadList() {
  return fs.readFileSync(path.join(__dirname, 'stockResetList.txt'), 'utf8').split(/\r?\n/)
    .filter(l => l.trim() && !l.startsWith('#')).map(l => {
      const [no, name, where, unit, code] = l.split('|');
      return { no: Number(no), name: name.trim(), where, unit, code };
    });
}

(async () => {
  const slug = opt('--property');
  if (!slug) throw new Error('Give --property <slug>');
  const { rows: [prop] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
  if (!prop) throw new Error(`No property "${slug}"`);
  const P = [prop.id];
  const items = loadList().filter(i => i.where === 'H');
  const seen = new Set();
  for (const i of items) {
    if (seen.has(i.name.toLowerCase())) throw new Error(`Duplicate name in the list: ${i.name}`);
    seen.add(i.name.toLowerCase());
  }

  const client = await db.pool.connect();
  const n = async (sql, p = P) => Number((await client.query(sql, p)).rows[0].n);
  try {
    const { rows: [d] } = await client.query('SELECT current_database() AS d');
    console.log(`Database: ${d.d} · Property: ${prop.name}`);
    console.log(APPLY ? 'APPLY — changes will be kept\n' : 'DRY RUN — nothing is kept (add --apply)\n');
    await client.query('BEGIN');

    const closed = await n('SELECT count(*) AS n FROM gl_closed_days WHERE property_id = $1');
    if (closed) throw new Error(`${closed} accounting day(s) are closed — voiding bills would need corrections. Not done.`);

    // 1. Void the bills and expenses that belong to purchase orders
    const bills = await client.query(
      `SELECT b.id, b.bill_no, b.total, po.po_number,
              COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a
                        JOIN supplier_payments p ON p.id = a.payment_id AND NOT p.is_voided WHERE a.bill_id = b.id), 0) AS paid
       FROM supplier_bills b JOIN purchase_orders po ON po.id = b.purchase_order_id
       WHERE b.property_id = $1 AND NOT b.is_voided ORDER BY b.bill_no`, P);
    for (const b of bills.rows) {
      if (Number(b.paid) > 0) throw new Error(`BILL-${String(b.bill_no).padStart(4, '0')} (${b.po_number}) has a payment — void the payment first`);
    }
    console.log('Supplier bills voided (their purchase order is removed):');
    for (const b of bills.rows) console.log(`  BILL-${String(b.bill_no).padStart(4, '0')}  ${b.po_number}  ${rp(b.total)}`);
    if (!bills.rows.length) console.log('  none');
    await client.query(
      `UPDATE supplier_bills SET is_voided = true, voided_at = NOW(), void_reason = $2, updated_at = NOW()
       WHERE property_id = $1 AND NOT is_voided AND purchase_order_id IS NOT NULL`, [prop.id, REASON]);

    const exps = await client.query(
      `SELECT e.amount, e.incurred_on::text AS d, po.po_number
       FROM expenses e JOIN purchase_orders po ON po.id = e.purchase_order_id
       WHERE e.property_id = $1 AND NOT e.is_voided ORDER BY e.incurred_on`, P);
    console.log('Expenses voided (their purchase order is removed):');
    for (const e of exps.rows) console.log(`  ${e.d}  ${e.po_number}  ${rp(e.amount)}`);
    if (!exps.rows.length) console.log('  none');
    await client.query(
      `UPDATE expenses SET is_voided = true, voided_at = NOW(), void_reason = $2
       WHERE property_id = $1 AND NOT is_voided AND purchase_order_id IS NOT NULL`, [prop.id, REASON]);

    // 2. Count, then wipe
    console.log('\nRemoved:');
    for (const [label, sql] of [
      ['purchase requests', 'SELECT count(*) AS n FROM purchase_requests WHERE property_id = $1'],
      ['purchase orders', 'SELECT count(*) AS n FROM purchase_orders WHERE property_id = $1'],
      ['kitchen handovers', 'SELECT count(*) AS n FROM pos_handovers WHERE property_id = $1'],
      ['stock transfers', 'SELECT count(*) AS n FROM stock_transfers WHERE property_id = $1'],
      ['stock opnames', 'SELECT count(*) AS n FROM stock_opnames WHERE property_id = $1'],
      ['stock items', 'SELECT count(*) AS n FROM raw_materials WHERE property_id = $1'],
      ['stock item movements', 'SELECT count(*) AS n FROM raw_material_movements WHERE property_id = $1'],
    ]) console.log(`  ${label.padEnd(24)} ${await n(sql)}`);

    await client.query('DELETE FROM purchase_requests WHERE property_id = $1', P);
    await client.query('DELETE FROM purchase_orders WHERE property_id = $1', P);
    await client.query('DELETE FROM stock_transfers WHERE property_id = $1', P);
    await client.query('DELETE FROM pos_handovers WHERE property_id = $1', P);
    await client.query('DELETE FROM stock_opnames WHERE property_id = $1', P);
    await client.query('DELETE FROM raw_materials WHERE property_id = $1', P);

    // 3. Check nothing is left
    for (const t of ['purchase_requests', 'purchase_orders', 'stock_transfers', 'stock_opnames', 'raw_materials', 'raw_material_movements', 'pos_handovers']) {
      if (await n(`SELECT count(*) AS n FROM ${t} WHERE property_id = $1`)) throw new Error(`${t} still has rows`);
    }
    const left = await n('SELECT count(*) AS n FROM store_stock WHERE property_id = $1 AND raw_material_id IS NOT NULL');
    if (left) throw new Error(`${left} store quantities left over`);

    // 4. New items
    console.log(`\nHotel stock items added (stock 0): ${items.length}`);
    const byCat = {};
    for (const i of items) {
      await client.query(
        'INSERT INTO raw_materials (property_id, name, unit_of_measure, category, stock_quantity) VALUES ($1, $2, $3, $4, 0)',
        [prop.id, i.name, i.unit, CAT[i.code]]);
      byCat[CAT[i.code]] = (byCat[CAT[i.code]] || 0) + 1;
    }
    for (const [c, k] of Object.entries(byCat)) console.log(`  ${c.padEnd(24)} ${k}`);
    if (await n('SELECT count(*) AS n FROM raw_materials WHERE property_id = $1') !== items.length) throw new Error('item count does not match the list');

    if (APPLY) {
      await client.query('COMMIT');
      console.log('\nDone. Next: a stock opname for the opening quantities.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run — rolled back. Add --apply to do it.');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
})().then(() => process.exit(0)).catch(e => { console.error('✗ ' + e.message); process.exit(1); });
