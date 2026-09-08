const db = require('../db');

// A table session is one dining visit — introduced so multiple orders across
// a single visit can be grouped, and an old QR scan can't leak into the next
// party's visit once the table has turned over. One open session per table is
// enforced by a partial unique index (migration 048); this service is the
// only place that opens/closes them, and restaurant_tables.status is kept in
// sync as a derived display flag rather than a second source of truth.

// Transaction-aware: takes the caller's client because salesService.createSale
// opens the session inside the same transaction as the sale, immediately
// after the restaurant_tables row is locked FOR UPDATE — that lock serializes
// two concurrent first-orders on the same table. The partial unique index
// (uq_table_sessions_one_open_per_table) is the backstop if a future caller
// forgets to hold that lock.
async function ensureOpenSession(client, propertyId, tableId, openedBy) {
  const { rows: [existing] } = await client.query(
    `SELECT * FROM table_sessions WHERE table_id = $1 AND property_id = $2 AND status = 'open' LIMIT 1`,
    [tableId, propertyId]
  );
  if (existing) return existing;
  const { rows: [created] } = await client.query(
    `INSERT INTO table_sessions (property_id, table_id, opened_by) VALUES ($1,$2,$3) RETURNING *`,
    [propertyId, tableId, openedBy || null]
  );
  return created;
}

async function getOpenSession(propertyId, tableId) {
  const { rows: [session] } = await db.query(
    `SELECT * FROM table_sessions WHERE table_id = $1 AND property_id = $2 AND status = 'open' LIMIT 1`,
    [tableId, propertyId]
  );
  return session || null;
}

// Staff "Seat Party" action — own transaction, locks the table row so it
// can't race a guest's first QR order opening the same session.
async function openSession(propertyId, tableId, openedBy) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [table] } = await client.query(
      'SELECT id FROM restaurant_tables WHERE id = $1 AND property_id = $2 FOR UPDATE',
      [tableId, propertyId]
    );
    if (!table) {
      await client.query('ROLLBACK');
      return { error: 'Table not found' };
    }
    const session = await ensureOpenSession(client, propertyId, tableId, openedBy);
    await client.query("UPDATE restaurant_tables SET status = 'occupied' WHERE id = $1", [tableId]);
    await client.query('COMMIT');
    return { session };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Staff "Close Table" action — idempotent if there's no open session, so it
// can unconditionally back a "clear this table" button regardless of state.
async function closeSession(propertyId, tableId, closedBy) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE table_sessions SET status = 'closed', closed_at = NOW(), closed_by = $1
        WHERE table_id = $2 AND property_id = $3 AND status = 'open'`,
      [closedBy || null, tableId, propertyId]
    );
    await client.query("UPDATE restaurant_tables SET status = 'available' WHERE id = $1 AND property_id = $2", [tableId, propertyId]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Orders + items + running total for one session (Table Management's "View Bill").
async function sessionSummary(propertyId, sessionId) {
  const { rows: sales } = await db.query(
    `SELECT id, created_at, total_amount, kitchen_status, confirmation_status, order_source,
            payment_method, settled_at
       FROM sales WHERE table_session_id = $1 AND property_id = $2
      ORDER BY created_at ASC`,
    [sessionId, propertyId]
  );
  if (sales.length === 0) return { session_id: sessionId, orders: [], total: 0, unpaid_total: 0 };

  const { rows: items } = await db.query(
    `SELECT si.sale_id, p.name, si.quantity, si.unit_price, si.subtotal
       FROM sale_items si JOIN products p ON p.id = si.product_id
      WHERE si.sale_id = ANY($1)`,
    [sales.map(s => s.id)]
  );
  const itemsBySale = new Map();
  for (const item of items) {
    if (!itemsBySale.has(item.sale_id)) itemsBySale.set(item.sale_id, []);
    itemsBySale.get(item.sale_id).push({ name: item.name, quantity: item.quantity, unit_price: item.unit_price, subtotal: item.subtotal });
  }
  const orders = sales.map(s => ({ ...s, items: itemsBySale.get(s.id) || [] }));
  const billable = sales.filter(s => s.confirmation_status !== 'rejected');
  const total = billable.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
  const unpaid_total = billable
    .filter(s => s.payment_method === 'unpaid')
    .reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
  return { session_id: sessionId, orders, total, unpaid_total };
}

module.exports = { ensureOpenSession, getOpenSession, openSession, closeSession, sessionSummary };
