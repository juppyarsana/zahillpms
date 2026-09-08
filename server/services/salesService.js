const db = require('../db');
const sse = require('../sse');
const tableSessionService = require('./tableSessionService');

const KITCHEN_CATEGORIES = ['drinks', 'food'];

// Validates products belong to the property, computes the total and whether
// the order needs a kitchen ticket, and inserts the sale + sale_items in one
// transaction. Callers are responsible for validating booking_id (if any)
// and for supplying trustworthy unit_price per item before calling this —
// see routes/display.js's guest order endpoint for why that matters when
// the caller isn't an authenticated staff member.
//
// Stock (for products with track_stock) is decremented in the same
// transaction, row-locked via FOR UPDATE to avoid a race between two
// concurrent sales of the last unit; insufficient stock rolls the whole
// sale back rather than partially fulfilling it. tableId (dine-in only)
// resolves to the table's current name for the denormalized table_number
// column, opens/reuses that table's open session, and flips the table to
// 'occupied' — pass tableNumber instead for properties that haven't set up
// table entities yet (free-text fallback).
//
// holdForConfirmation (room-service only) lands the sale in a pre-kitchen
// "pending" bucket instead of firing straight to the kitchen board — see
// routes/resto.js's confirm/reject endpoints. orderSource just labels where
// an order came from for the resto app's UI; it's not load-bearing for any
// gate.
async function createSale(propertyId, { bookingId, paymentMethod, items, orderType, tableNumber, tableId, servedBy, holdForConfirmation, orderSource }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const productIds = items.map(i => i.product_id);
    const { rows: ownedProducts } = await client.query(
      'SELECT id, category, track_stock, stock_quantity, name FROM products WHERE id = ANY($1) AND property_id = $2 FOR UPDATE',
      [productIds, propertyId]
    );
    if (ownedProducts.length !== new Set(productIds).size) {
      await client.query('ROLLBACK');
      return { error: 'One or more products not found' };
    }
    const productById = new Map(ownedProducts.map(p => [p.id, p]));

    const outOfStock = items
      .filter(i => productById.get(i.product_id).track_stock && productById.get(i.product_id).stock_quantity < parseInt(i.quantity))
      .map(i => ({ product_id: i.product_id, name: productById.get(i.product_id).name, available: productById.get(i.product_id).stock_quantity, requested: parseInt(i.quantity) }));
    if (outOfStock.length > 0) {
      await client.query('ROLLBACK');
      return { error: 'Insufficient stock', code: 'OUT_OF_STOCK', items: outOfStock };
    }

    // payment_method used to be a DB CHECK (cash/qris/room_charge only,
    // migration 001). Migration 048 dropped that so the resto app can accept
    // any of a property's configured payment_methods — this is now the one
    // choke point every caller (staff POS, Room Display, resto app) goes
    // through. room_charge is special-cased: it isn't a real payment_methods
    // row, it means "post to the guest's folio," which requires a booking.
    if (paymentMethod === 'room_charge') {
      if (!bookingId) {
        await client.query('ROLLBACK');
        return { error: 'room_charge requires a booking' };
      }
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

    let resolvedTableNumber = tableNumber || null;
    let sessionId = null;
    if (tableId) {
      const { rows: [table] } = await client.query(
        'SELECT id, name FROM restaurant_tables WHERE id = $1 AND property_id = $2 FOR UPDATE',
        [tableId, propertyId]
      );
      if (!table) {
        await client.query('ROLLBACK');
        return { error: 'Table not found' };
      }
      resolvedTableNumber = table.name;
      const session = await tableSessionService.ensureOpenSession(client, propertyId, tableId, servedBy);
      sessionId = session.id;
    }

    const needsKitchen = items.some(i => KITCHEN_CATEGORIES.includes(productById.get(i.product_id).category));
    const pending = !!holdForConfirmation;
    const total = items.reduce((sum, i) => sum + parseFloat(i.unit_price) * parseInt(i.quantity), 0);
    const { rows: [sale] } = await client.query(
      `INSERT INTO sales (booking_id, payment_method, total_amount, served_by, property_id, order_type, table_number, table_id, kitchen_status,
                          table_session_id, confirmation_status, order_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [bookingId || null, paymentMethod, total, servedBy || null, propertyId, orderType || 'takeaway', resolvedTableNumber, tableId || null, needsKitchen ? 'new' : null,
       sessionId, pending ? 'pending' : null, orderSource || null]
    );
    for (const item of items) {
      const subtotal = parseFloat(item.unit_price) * parseInt(item.quantity);
      await client.query(
        'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES ($1,$2,$3,$4,$5)',
        [sale.id, item.product_id, item.quantity, item.unit_price, subtotal]
      );
      const product = productById.get(item.product_id);
      if (product.track_stock) {
        await client.query('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2', [item.quantity, item.product_id]);
        await client.query(
          `INSERT INTO stock_movements (property_id, product_id, change_qty, reason, reference_id, created_by)
           VALUES ($1,$2,$3,'sale',$4,$5)`,
          [propertyId, item.product_id, -item.quantity, sale.id, servedBy || null]
        );
      }
    }
    if (tableId) {
      await client.query("UPDATE restaurant_tables SET status = 'occupied' WHERE id = $1", [tableId]);
    }

    // room_charge means "post to the guest's folio" — folio_charges.type
    // has allowed 'sale' since migration 028 but nothing ever wrote one here,
    // so a room-service/POS-charged-to-room sale never showed up on the
    // guest's own Folio tab even though it was always billable. Posted
    // whether or not the order is still pending confirmation (same reasoning
    // as decrementing stock immediately — the charge is real from the moment
    // the guest orders); a rejected room-service order's charge is voided by
    // routes/resto.js's reject handler via sale_id.
    if (paymentMethod === 'room_charge') {
      const desc = items
        .map(i => `${i.quantity}× ${productById.get(i.product_id).name}`)
        .join(', ')
        .slice(0, 200);
      await client.query(
        `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, posted_by, sale_id)
         VALUES ($1,'sale',$2,1,$3,$3,$4,$5)`,
        [bookingId, desc, total, servedBy || null, sale.id]
      );
    }

    await client.query('COMMIT');
    if (needsKitchen && !pending) sse.notify('kitchen:' + propertyId);
    sse.notify('resto:' + propertyId); // no-op if no clients — free for properties without the resto app
    return { sale };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createSale };
