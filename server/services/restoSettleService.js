const db = require('../db');

// Settlement for the resto "open tab" flow (migration 050). Guest QR orders
// and staff-entered orders both land as payment_method = 'unpaid' — placed
// and fired to the kitchen, but not paid. When the party's done, staff pick
// ONE payment method for the whole table from the resto app; this flips every
// unpaid, non-rejected sale in the open session to that method in a single
// transaction, stamps settled_at/settled_by, posts folio charges if the
// method is room_charge, and closes the session + frees the table.
//
// One payment per table, no split — a deliberate scope choice (see CLAUDE.md).
// A comped table with nothing owed can still be closed via the plain
// /tables/:id/close endpoint; that one refuses if anything is still unpaid.

async function settleAndClose(propertyId, tableId, { paymentMethod, bookingId, userId }) {
  if (!paymentMethod || paymentMethod === 'unpaid') {
    return { error: 'A payment method is required to settle' };
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the table row — serializes against a concurrent guest QR order
    // opening/using the same session (same lock salesService.createSale takes).
    const { rows: [table] } = await client.query(
      'SELECT id, name FROM restaurant_tables WHERE id = $1 AND property_id = $2 FOR UPDATE',
      [tableId, propertyId]
    );
    if (!table) {
      await client.query('ROLLBACK');
      return { error: 'Table not found' };
    }

    const { rows: [session] } = await client.query(
      `SELECT id FROM table_sessions WHERE table_id = $1 AND property_id = $2 AND status = 'open' LIMIT 1`,
      [tableId, propertyId]
    );
    if (!session) {
      await client.query('ROLLBACK');
      return { error: 'This table has no open bill' };
    }

    // Validate the target method the same way salesService.createSale does.
    let resolvedBookingId = null;
    if (paymentMethod === 'room_charge') {
      if (!bookingId) {
        await client.query('ROLLBACK');
        return { error: 'Select a room to charge the bill to' };
      }
      const { rows: [booking] } = await client.query(
        `SELECT id FROM bookings WHERE id = $1 AND property_id = $2 AND status = 'checked_in'`,
        [bookingId, propertyId]
      );
      if (!booking) {
        await client.query('ROLLBACK');
        return { error: 'That room is not currently checked in' };
      }
      resolvedBookingId = booking.id;
    } else {
      const { rows: [pm] } = await client.query(
        'SELECT id FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active = true',
        [paymentMethod, propertyId]
      );
      if (!pm) {
        await client.query('ROLLBACK');
        return { error: 'Invalid payment method' };
      }
    }

    const { rows: unpaid } = await client.query(
      `SELECT id, total_amount FROM sales
        WHERE table_session_id = $1 AND property_id = $2
          AND payment_method = 'unpaid'
          AND confirmation_status IS DISTINCT FROM 'rejected'
        FOR UPDATE`,
      [session.id, propertyId]
    );

    let settledTotal = 0;
    if (unpaid.length > 0) {
      const ids = unpaid.map(s => s.id);
      await client.query(
        `UPDATE sales
            SET payment_method = $1,
                settled_at = NOW(),
                settled_by = $2,
                booking_id = COALESCE($3, booking_id)
          WHERE id = ANY($4)`,
        [paymentMethod, userId || null, resolvedBookingId, ids]
      );

      if (paymentMethod === 'room_charge') {
        // Mirror salesService.createSale's folio posting — one 'sale' charge
        // per order, described from its line items, voidable later via sale_id.
        const { rows: lineItems } = await client.query(
          `SELECT si.sale_id, si.quantity, p.name
             FROM sale_items si JOIN products p ON p.id = si.product_id
            WHERE si.sale_id = ANY($1)`,
          [ids]
        );
        const itemsBySale = new Map();
        for (const li of lineItems) {
          if (!itemsBySale.has(li.sale_id)) itemsBySale.set(li.sale_id, []);
          itemsBySale.get(li.sale_id).push(`${li.quantity}× ${li.name}`);
        }
        for (const sale of unpaid) {
          const desc = (itemsBySale.get(sale.id) || ['Restaurant order']).join(', ').slice(0, 200);
          await client.query(
            `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, posted_by, sale_id)
             VALUES ($1,'sale',$2,1,$3,$3,$4,$5)`,
            [resolvedBookingId, desc, sale.total_amount, userId || null, sale.id]
          );
        }
      }

      settledTotal = unpaid.reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
    }

    await client.query(
      `UPDATE table_sessions SET status = 'closed', closed_at = NOW(), closed_by = $1 WHERE id = $2`,
      [userId || null, session.id]
    );
    await client.query(
      "UPDATE restaurant_tables SET status = 'available' WHERE id = $1 AND property_id = $2",
      [tableId, propertyId]
    );

    await client.query('COMMIT');
    return { ok: true, settled_count: unpaid.length, settled_total: settledTotal };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Is anything still owed on this table's open session? Used to stop a plain
// "Close Table" from silently stranding unpaid orders.
async function hasUnpaid(propertyId, tableId) {
  const { rows } = await db.query(
    `SELECT 1 FROM sales s
       JOIN table_sessions ts ON ts.id = s.table_session_id AND ts.status = 'open'
      WHERE ts.table_id = $1 AND s.property_id = $2
        AND s.payment_method = 'unpaid'
        AND s.confirmation_status IS DISTINCT FROM 'rejected'
      LIMIT 1`,
    [tableId, propertyId]
  );
  return rows.length > 0;
}

module.exports = { settleAndClose, hasUnpaid };
