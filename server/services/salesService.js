const db = require('../db');
const sse = require('../sse');

const KITCHEN_CATEGORIES = ['drinks', 'food'];

// Validates products belong to the property, computes the total and whether
// the order needs a kitchen ticket, and inserts the sale + sale_items in one
// transaction. Callers are responsible for validating booking_id (if any)
// and for supplying trustworthy unit_price per item before calling this —
// see routes/display.js's guest order endpoint for why that matters when
// the caller isn't an authenticated staff member.
async function createSale(propertyId, { bookingId, paymentMethod, items, orderType, tableNumber, servedBy }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const productIds = items.map(i => i.product_id);
    const { rows: ownedProducts } = await client.query('SELECT id, category FROM products WHERE id = ANY($1) AND property_id = $2', [productIds, propertyId]);
    if (ownedProducts.length !== new Set(productIds).size) {
      await client.query('ROLLBACK');
      return { error: 'One or more products not found' };
    }
    const categoryById = new Map(ownedProducts.map(p => [p.id, p.category]));
    const needsKitchen = items.some(i => KITCHEN_CATEGORIES.includes(categoryById.get(i.product_id)));
    const total = items.reduce((sum, i) => sum + parseFloat(i.unit_price) * parseInt(i.quantity), 0);
    const { rows: [sale] } = await client.query(
      `INSERT INTO sales (booking_id, payment_method, total_amount, served_by, property_id, order_type, table_number, kitchen_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [bookingId || null, paymentMethod, total, servedBy || null, propertyId, orderType || 'takeaway', tableNumber || null, needsKitchen ? 'new' : null]
    );
    for (const item of items) {
      const subtotal = parseFloat(item.unit_price) * parseInt(item.quantity);
      await client.query(
        'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES ($1,$2,$3,$4,$5)',
        [sale.id, item.product_id, item.quantity, item.unit_price, subtotal]
      );
    }
    await client.query('COMMIT');
    if (needsKitchen) sse.notify('kitchen:' + propertyId);
    return { sale };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createSale };
