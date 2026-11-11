// Start purchasing and stock from zero for one property: purchase orders, requests,
// stock opnames, store transfers, kitchen handovers, every stock movement and (unless
// --keep-items) the stock items themselves, so a new item list can be imported.
//
//   Deleted (all of the property's):
//     purchase orders (+ lines, deliveries, history, Telegram approval messages),
//     purchase requests, stock opnames, store transfers, POS handover rows,
//     stock movements of stock items, store quantities, stock items (incl. the
//     restaurant "mirror" items) — unless --keep-items
//   Deleted because they came from a purchase (a PO or "Buy without a PO"):
//     expenses and supplier bills with a purchase order, and the supplier payments that
//     paid only those bills
//   Kept: suppliers (add --suppliers to delete the ones nothing else uses), stores and their
//     settings, supplier bills / payments that are not tied to a PO (add --all-bills to
//     delete every bill and payment), Sales items (products) and their stock.
//
// Refuses when an accounting day is already closed on or after the oldest expense / bill it
// would delete (that would change closed books) — --force overrides, then the next close
// posts the difference as a correction.
//
// Usage (from server/):
//   node maintenance/resetPurchasing.js --property zahill            dry run (done, counted, rolled back)
//   node maintenance/resetPurchasing.js --property zahill --apply    do it; writes the deleted rows to maintenance/backups/
//   options: --keep-items  --suppliers  --all-bills  --force
// Take a database backup first on production:  bash deploy.sh --backup-only
// The POS has its own stock and deliveries: this does not touch them.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const APPLY = flag('--apply');
const KEEP_ITEMS = flag('--keep-items');
const SUPPLIERS = flag('--suppliers');
const ALL_BILLS = flag('--all-bills');
const FORCE = flag('--force');
const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

async function run() {
  const slug = opt('--property');
  if (!slug) throw new Error('Give --property <slug>');
  const { rows: [prop] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
  if (!prop) throw new Error(`No property "${slug}"`);
  const P = prop.id;
  const { rows: [dbName] } = await db.query('SELECT current_database() AS d');
  console.log(`Database: ${dbName.d} · Property: ${prop.name}`);
  console.log(APPLY ? 'APPLY — changes will be kept\n' : 'DRY RUN — nothing is kept (add --apply)\n');

  const client = await db.pool.connect();
  const report = [];
  const saved = {};
  // Save the rows first (for the run file), then delete them.
  async function del(label, selectSql, deleteSql, params = [P], { save = true } = {}) {
    if (save) {
      const { rows } = await client.query(selectSql, params);
      saved[label] = rows;
    }
    const r = await client.query(deleteSql, params);
    report.push([label, r.rowCount]);
    return r.rowCount;
  }

  try {
    await client.query('BEGIN');

    // ── Money rows that came from a purchase ──
    const billFilter = ALL_BILLS ? '' : 'AND purchase_order_id IS NOT NULL';
    const { rows: [old] } = await client.query(
      `SELECT
         (SELECT min(incurred_on) FROM expenses WHERE property_id = $1 AND purchase_order_id IS NOT NULL) AS exp_from,
         (SELECT min(bill_date) FROM supplier_bills WHERE property_id = $1 ${billFilter}) AS bill_from`, [P]);
    const first = [old.exp_from, old.bill_from].filter(Boolean).map(d => String(d).slice(0, 10)).sort()[0];
    if (first) {
      const { rows: [closed] } = await client.query(
        'SELECT max(business_date) AS last FROM gl_closed_days WHERE property_id = $1', [P]);
      const last = closed.last ? String(closed.last).slice(0, 10) : null;
      if (last && last >= first) {
        const msg = `Accounting is closed through ${last}, and the oldest expense / bill to delete is dated ${first}.`;
        if (!FORCE) throw new Error(msg + ' Deleting would change closed books. Use --force to go on (the next close posts the difference as a correction).');
        console.log('! ' + msg + ' — going on because of --force\n');
      }
    }

    const delBills = `SELECT id FROM supplier_bills WHERE property_id = $1 ${billFilter}`;
    // Payments that only paid the bills being deleted go with them
    await del('supplier payments (paid only deleted bills)',
      `SELECT * FROM supplier_payments WHERE property_id = $1 AND id IN (
         SELECT a.payment_id FROM supplier_payment_allocations a WHERE a.bill_id IN (${delBills})
         AND NOT EXISTS (SELECT 1 FROM supplier_payment_allocations b WHERE b.payment_id = a.payment_id AND b.bill_id NOT IN (${delBills})))`,
      `DELETE FROM supplier_payments WHERE property_id = $1 AND id IN (
         SELECT a.payment_id FROM supplier_payment_allocations a WHERE a.bill_id IN (${delBills})
         AND NOT EXISTS (SELECT 1 FROM supplier_payment_allocations b WHERE b.payment_id = a.payment_id AND b.bill_id NOT IN (${delBills})))`)
      .catch(e => { throw new Error('supplier payments: ' + e.message); });
    await del('supplier bills' + (ALL_BILLS ? ' (all)' : ' (from a PO)'),
      `SELECT * FROM supplier_bills WHERE id IN (${delBills})`,
      `DELETE FROM supplier_bills WHERE id IN (${delBills})`);
    await del('expenses from a purchase',
      'SELECT * FROM expenses WHERE property_id = $1 AND purchase_order_id IS NOT NULL',
      'DELETE FROM expenses WHERE property_id = $1 AND purchase_order_id IS NOT NULL');

    // ── Stock side ──
    await del('POS handover rows', 'SELECT * FROM pos_handovers WHERE property_id = $1', 'DELETE FROM pos_handovers WHERE property_id = $1');
    await del('purchase orders (+ lines, deliveries, history, approval messages)',
      'SELECT * FROM purchase_orders WHERE property_id = $1', 'DELETE FROM purchase_orders WHERE property_id = $1');
    await del('purchase requests (+ lines)', 'SELECT * FROM purchase_requests WHERE property_id = $1', 'DELETE FROM purchase_requests WHERE property_id = $1');
    await del('stock transfers (+ lines)', 'SELECT * FROM stock_transfers WHERE property_id = $1', 'DELETE FROM stock_transfers WHERE property_id = $1');
    await del('stock opnames (+ lines)', 'SELECT * FROM stock_opnames WHERE property_id = $1', 'DELETE FROM stock_opnames WHERE property_id = $1');

    if (KEEP_ITEMS) {
      await del('stock movements of stock items', 'SELECT * FROM raw_material_movements WHERE property_id = $1', 'DELETE FROM raw_material_movements WHERE property_id = $1');
      // quantities go to 0 with their movements; the triggers keep store_stock in step only for new rows
      await del('store quantities', 'SELECT * FROM store_stock WHERE property_id = $1', 'DELETE FROM store_stock WHERE property_id = $1');
      const r = await client.query('UPDATE raw_materials SET stock_quantity = 0 WHERE property_id = $1', [P]);
      report.push(['stock items set to 0 stock (kept)', r.rowCount]);
    } else {
      await del('stock movements of stock items', 'SELECT * FROM raw_material_movements WHERE property_id = $1', 'DELETE FROM raw_material_movements WHERE property_id = $1');
      await del('store quantities', 'SELECT * FROM store_stock WHERE property_id = $1', 'DELETE FROM store_stock WHERE property_id = $1');
      await del('stock items (incl. restaurant mirror items)', 'SELECT * FROM raw_materials WHERE property_id = $1', 'DELETE FROM raw_materials WHERE property_id = $1');
    }

    if (SUPPLIERS) {
      await del('suppliers not used anywhere else',
        `SELECT * FROM suppliers s WHERE property_id = $1 AND NOT EXISTS (SELECT 1 FROM supplier_bills WHERE supplier_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM supplier_payments WHERE supplier_id = s.id) AND NOT EXISTS (SELECT 1 FROM activity_vendors WHERE supplier_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM activity_booking_vendors WHERE supplier_id = s.id) AND NOT EXISTS (SELECT 1 FROM vendor_payouts WHERE supplier_id = s.id)`,
        `DELETE FROM suppliers s WHERE property_id = $1 AND NOT EXISTS (SELECT 1 FROM supplier_bills WHERE supplier_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM supplier_payments WHERE supplier_id = s.id) AND NOT EXISTS (SELECT 1 FROM activity_vendors WHERE supplier_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM activity_booking_vendors WHERE supplier_id = s.id) AND NOT EXISTS (SELECT 1 FROM vendor_payouts WHERE supplier_id = s.id)`);
    }

    // Left alone, but worth knowing
    const { rows: [left] } = await client.query(
      `SELECT
         (SELECT count(*)::int FROM stock_movements WHERE property_id = $1) AS product_moves,
         (SELECT count(*)::int FROM supplier_bills WHERE property_id = $1) AS bills_left,
         (SELECT count(*)::int FROM suppliers WHERE property_id = $1) AS suppliers_left`, [P]);
    const { rows: [cogs] } = await client.query(
      "SELECT count(*)::int AS n FROM gl_entries WHERE property_id = $1 AND reference LIKE 'COGS-%'", [P]);
    left.cogs_entries = cogs.n;

    console.log('What this does:');
    for (const [label, n] of report) console.log(`  ${String(n).padStart(6)}  ${label}`);
    console.log('\nLeft as they are:');
    if (left.suppliers_left != null) console.log(`  ${left.suppliers_left} suppliers${SUPPLIERS ? '' : ' (add --suppliers to remove the unused ones)'}`);
    if (left.bills_left) console.log(`  ${left.bills_left} supplier bills not tied to a PO${ALL_BILLS ? ' — none left because of --all-bills' : ' (add --all-bills to remove them too)'}`);
    if (left.product_moves) console.log(`  ${left.product_moves} stock movements of Sales items (their stock stays; fix those in an opname)`);
    if (left.cogs_entries) console.log(`  ! ${left.cogs_entries} Cost of sales journal entries (COGS-…) built on the old stock value — void them in Accounting if they were based on test data`);
    console.log('  The POS inventory and its deliveries are not touched here.');

    if (APPLY) {
      await client.query('COMMIT');
      const dir = path.join(__dirname, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `reset-purchasing-${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(file, JSON.stringify({ property: slug, property_id: P, options: { KEEP_ITEMS, SUPPLIERS, ALL_BILLS }, deleted: saved }, null, 1));
      console.log(`\nDone. The deleted rows are saved in: ${file}`);
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run — nothing was changed.');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

run().then(() => process.exit(0)).catch(e => { console.error('✗ ' + e.message); process.exit(1); });
