const db = require('../db');

// Back Office Slice A — Purchase Order creation, status transitions, and
// receiving. Suppliers and Raw Materials CRUD stay inline in routes/purchasing.js
// (simple enough not to need a service, same as routes/tables.js/products.js) —
// this file only holds the parent+children transactional logic, same house
// convention as server/services/agentStatementService.js.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const STATUS_TRANSITIONS = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['cancelled'], // receiving happens via receivePurchaseOrder, not a plain status PATCH
  received: [],
  cancelled: [],
};

const STATUS_EVENT_NOTES = {
  pending_approval: 'Submitted for approval',
  draft: 'Reverted to draft',
  approved: 'Approved',
  cancelled: 'Cancelled',
};

// Append-only activity log (migration 054) — one row per milestone, shown
// as a timeline on the PO detail view. `client` so it always rides inside
// the caller's own transaction.
async function logEvent(client, poId, note, userId) {
  await client.query(
    'INSERT INTO purchase_order_events (purchase_order_id, note, created_by) VALUES ($1,$2,$3)',
    [poId, note, userId || null]
  );
}

async function nextPoNumber(client, propertyId) {
  const now = new Date();
  const prefix = `PO-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const { rows: [{ count }] } = await client.query(
    `SELECT COUNT(*) AS count FROM purchase_orders WHERE property_id = $1 AND po_number LIKE $2`,
    [propertyId, prefix + '%']
  );
  return prefix + String(parseInt(count) + 1).padStart(3, '0');
}

// items: [{ product_id? , raw_material_id?, quantity, unit_cost }]
async function createPurchaseOrder(propertyId, body, userId) {
  const { supplier_id, notes, items } = body;
  if (!supplier_id) return { error: 'supplier_id required' };
  if (!Array.isArray(items) || items.length === 0) return { error: 'At least one line item is required' };

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [supplier] } = await client.query(
      'SELECT id FROM suppliers WHERE id = $1 AND property_id = $2', [supplier_id, propertyId]
    );
    if (!supplier) { await client.query('ROLLBACK'); return { error: 'Supplier not found' }; }

    const resolvedItems = [];
    for (const raw of items) {
      const hasProduct = !!raw.product_id;
      const hasRawMaterial = !!raw.raw_material_id;
      if (hasProduct === hasRawMaterial) { // both or neither set
        await client.query('ROLLBACK');
        return { error: 'Each line item must reference exactly one product or raw material' };
      }
      const quantity = parseFloat(raw.quantity);
      const unitCost = parseFloat(raw.unit_cost);
      if (!Number.isFinite(quantity) || quantity <= 0) { await client.query('ROLLBACK'); return { error: 'Each line item needs a positive quantity' }; }
      if (!Number.isFinite(unitCost) || unitCost < 0) { await client.query('ROLLBACK'); return { error: 'Each line item needs a non-negative unit cost' }; }

      if (hasProduct) {
        if (!Number.isInteger(quantity)) { await client.query('ROLLBACK'); return { error: 'Sellable product quantities must be whole numbers' }; }
        const { rows: [product] } = await client.query(
          'SELECT id, name FROM products WHERE id = $1 AND property_id = $2', [raw.product_id, propertyId]
        );
        if (!product) { await client.query('ROLLBACK'); return { error: 'A referenced product was not found' }; }
        resolvedItems.push({ product_id: product.id, raw_material_id: null, description: product.name, quantity, unit_cost: unitCost });
      } else {
        const { rows: [material] } = await client.query(
          'SELECT id, name FROM raw_materials WHERE id = $1 AND property_id = $2', [raw.raw_material_id, propertyId]
        );
        if (!material) { await client.query('ROLLBACK'); return { error: 'A referenced raw material was not found' }; }
        resolvedItems.push({ product_id: null, raw_material_id: material.id, description: material.name, quantity, unit_cost: unitCost });
      }
    }

    const totalAmount = round2(resolvedItems.reduce((s, i) => s + i.quantity * i.unit_cost, 0));
    const poNumber = await nextPoNumber(client, propertyId);

    const { rows: [po] } = await client.query(
      `INSERT INTO purchase_orders (property_id, supplier_id, po_number, status, total_amount, notes, requested_by)
       VALUES ($1,$2,$3,'draft',$4,$5,$6) RETURNING *`,
      [propertyId, supplier_id, poNumber, totalAmount, notes || null, userId || null]
    );

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, product_id, raw_material_id, description, quantity, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [po.id, item.product_id, item.raw_material_id, item.description, item.quantity, item.unit_cost]
      );
    }
    await logEvent(client, po.id, 'Purchase order created', userId);

    await client.query('COMMIT');
    return { purchase_order: po };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Replaces the full item set — draft only, so an approved/received PO's
// items can't shift under an already-issued or already-fulfilled order.
async function updatePurchaseOrderItems(propertyId, poId, body) {
  const { items, notes } = body;
  if (!Array.isArray(items) || items.length === 0) return { error: 'At least one line item is required' };

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [po] } = await client.query(
      'SELECT * FROM purchase_orders WHERE id = $1 AND property_id = $2 FOR UPDATE', [poId, propertyId]
    );
    if (!po) { await client.query('ROLLBACK'); return { error: 'Purchase order not found' }; }
    if (po.status !== 'draft') { await client.query('ROLLBACK'); return { error: 'Only a draft purchase order can be edited' }; }

    const resolvedItems = [];
    for (const raw of items) {
      const hasProduct = !!raw.product_id;
      const hasRawMaterial = !!raw.raw_material_id;
      if (hasProduct === hasRawMaterial) { await client.query('ROLLBACK'); return { error: 'Each line item must reference exactly one product or raw material' }; }
      const quantity = parseFloat(raw.quantity);
      const unitCost = parseFloat(raw.unit_cost);
      if (!Number.isFinite(quantity) || quantity <= 0) { await client.query('ROLLBACK'); return { error: 'Each line item needs a positive quantity' }; }
      if (!Number.isFinite(unitCost) || unitCost < 0) { await client.query('ROLLBACK'); return { error: 'Each line item needs a non-negative unit cost' }; }

      if (hasProduct) {
        if (!Number.isInteger(quantity)) { await client.query('ROLLBACK'); return { error: 'Sellable product quantities must be whole numbers' }; }
        const { rows: [product] } = await client.query('SELECT id, name FROM products WHERE id = $1 AND property_id = $2', [raw.product_id, propertyId]);
        if (!product) { await client.query('ROLLBACK'); return { error: 'A referenced product was not found' }; }
        resolvedItems.push({ product_id: product.id, raw_material_id: null, description: product.name, quantity, unit_cost: unitCost });
      } else {
        const { rows: [material] } = await client.query('SELECT id, name FROM raw_materials WHERE id = $1 AND property_id = $2', [raw.raw_material_id, propertyId]);
        if (!material) { await client.query('ROLLBACK'); return { error: 'A referenced raw material was not found' }; }
        resolvedItems.push({ product_id: null, raw_material_id: material.id, description: material.name, quantity, unit_cost: unitCost });
      }
    }

    const totalAmount = round2(resolvedItems.reduce((s, i) => s + i.quantity * i.unit_cost, 0));

    await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, product_id, raw_material_id, description, quantity, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [poId, item.product_id, item.raw_material_id, item.description, item.quantity, item.unit_cost]
      );
    }
    const { rows: [updated] } = await client.query(
      `UPDATE purchase_orders SET total_amount = $1, notes = COALESCE($2, notes), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [totalAmount, notes, poId]
    );
    await client.query('COMMIT');
    return { purchase_order: updated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function setPurchaseOrderStatus(propertyId, poId, newStatus, userId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [po] } = await client.query(
      'SELECT * FROM purchase_orders WHERE id = $1 AND property_id = $2 FOR UPDATE', [poId, propertyId]
    );
    if (!po) { await client.query('ROLLBACK'); return { error: 'Purchase order not found' }; }

    const allowed = STATUS_TRANSITIONS[po.status] || [];
    if (!allowed.includes(newStatus)) {
      await client.query('ROLLBACK');
      return { error: `Cannot move a ${po.status} purchase order to ${newStatus}` };
    }

    const { rows: [updated] } = await client.query(
      `UPDATE purchase_orders SET status = $1, updated_at = NOW(),
         approved_by = CASE WHEN $4 THEN $2 ELSE approved_by END
       WHERE id = $3 RETURNING *`,
      [newStatus, userId || null, poId, newStatus === 'approved']
    );
    await logEvent(client, poId, STATUS_EVENT_NOTES[newStatus] || `Status changed to ${newStatus}`, userId);
    await client.query('COMMIT');
    return { purchase_order: updated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// items: [{ item_id, receive_quantity }] — receive_quantity is the amount
// being received THIS call (a delta), not a cumulative total. Clamped so an
// item can never be over-received across multiple partial receipts.
async function receivePurchaseOrder(propertyId, poId, items, userId) {
  if (!Array.isArray(items) || items.length === 0) return { error: 'At least one item to receive is required' };

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [po] } = await client.query(
      'SELECT * FROM purchase_orders WHERE id = $1 AND property_id = $2 FOR UPDATE', [poId, propertyId]
    );
    if (!po) { await client.query('ROLLBACK'); return { error: 'Purchase order not found' }; }
    if (po.status !== 'approved') { await client.query('ROLLBACK'); return { error: 'Only an approved purchase order can be received' }; }

    const itemIds = items.map(i => i.item_id);
    const { rows: lockedItems } = await client.query(
      `SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
      [poId, itemIds]
    );
    const byId = Object.fromEntries(lockedItems.map(i => [i.id, i]));
    const receivedNow = []; // for the activity-log note

    for (const req of items) {
      const item = byId[req.item_id];
      if (!item) { await client.query('ROLLBACK'); return { error: 'An item to receive was not found on this purchase order' }; }
      const requestedQty = parseFloat(req.receive_quantity);
      if (!Number.isFinite(requestedQty) || requestedQty <= 0) continue; // nothing to do for this line

      const outstanding = parseFloat(item.quantity) - parseFloat(item.received_quantity);
      let delta = Math.min(requestedQty, outstanding);
      if (item.product_id) delta = Math.floor(delta); // whole units only for sellable products
      if (delta <= 0) continue;
      receivedNow.push({ description: item.description, delta });

      await client.query(
        'UPDATE purchase_order_items SET received_quantity = received_quantity + $1 WHERE id = $2',
        [delta, item.id]
      );

      if (item.product_id) {
        // Weighted-average cost — same treatment as the raw-material branch
        // below (see its comment for the reasoning): blends this receipt
        // into the existing stock's average by value, not just the last
        // price paid, so cost_per_unit reflects what the stock on hand
        // actually cost. Locks the products row itself (not just the PO
        // item) so two concurrent receipts can't blend from a stale
        // quantity.
        const { rows: [product] } = await client.query(
          'SELECT stock_quantity, cost_per_unit FROM products WHERE id = $1 FOR UPDATE',
          [item.product_id]
        );
        const oldQty = product.stock_quantity; // INT column, unlike raw_materials' NUMERIC
        const oldAvg = product.cost_per_unit != null ? parseFloat(product.cost_per_unit) : 0;
        const newQty = oldQty + delta;
        const newAvg = newQty > 0 ? round2((oldQty * oldAvg + delta * item.unit_cost) / newQty) : oldAvg;
        await client.query(
          'UPDATE products SET stock_quantity = $1, cost_per_unit = $2 WHERE id = $3',
          [newQty, newAvg, item.product_id]
        );
        await client.query(
          `INSERT INTO stock_movements (property_id, product_id, change_qty, reason, purchase_order_id, created_by)
           VALUES ($1,$2,$3,'restock',$4,$5)`,
          [propertyId, item.product_id, delta, poId, userId || null]
        );
      } else {
        // Weighted-average cost — blends this receipt into the existing
        // stock's average by value, not just the last price paid, so
        // cost_per_unit reflects what the stock on hand actually cost
        // (standard inventory-valuation method; matters once Recipe
        // Costing/COGS reporting reads this field). Locks the raw_materials
        // row itself (not just the PO item) so two concurrent receipts
        // against the same ingredient can't blend from a stale quantity.
        const { rows: [material] } = await client.query(
          'SELECT stock_quantity, cost_per_unit FROM raw_materials WHERE id = $1 FOR UPDATE',
          [item.raw_material_id]
        );
        const oldQty = parseFloat(material.stock_quantity);
        const oldAvg = material.cost_per_unit != null ? parseFloat(material.cost_per_unit) : 0;
        const newQty = oldQty + delta;
        const newAvg = newQty > 0 ? round2((oldQty * oldAvg + delta * item.unit_cost) / newQty) : oldAvg;
        await client.query(
          'UPDATE raw_materials SET stock_quantity = $1, cost_per_unit = $2 WHERE id = $3',
          [newQty, newAvg, item.raw_material_id]
        );
        await client.query(
          `INSERT INTO raw_material_movements (property_id, raw_material_id, change_qty, reason, purchase_order_id, created_by)
           VALUES ($1,$2,$3,'purchase',$4,$5)`,
          [propertyId, item.raw_material_id, delta, poId, userId || null]
        );
      }
    }

    const { rows: freshItems } = await client.query(
      'SELECT quantity, received_quantity FROM purchase_order_items WHERE purchase_order_id = $1', [poId]
    );
    const fullyReceived = freshItems.every(i => parseFloat(i.received_quantity) >= parseFloat(i.quantity));
    const { rows: [updated] } = await client.query(
      `UPDATE purchase_orders SET status = CASE WHEN $1 THEN 'received' ELSE status END, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [fullyReceived, poId]
    );

    if (receivedNow.length > 0) {
      const summary = receivedNow.map(r => `${r.description} ×${r.delta}`).join(', ');
      const note = fullyReceived ? `Received ${summary} — fully received` : `Received ${summary}`;
      await logEvent(client, poId, note, userId);
    }

    await client.query('COMMIT');
    return { purchase_order: updated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getPurchaseOrder(propertyId, poId) {
  const { rows: [po] } = await db.query(
    `SELECT po.*, s.name AS supplier_name
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.id = $1 AND po.property_id = $2`,
    [poId, propertyId]
  );
  if (!po) return null;
  const { rows: items } = await db.query(
    `SELECT poi.*, rm.unit_of_measure
     FROM purchase_order_items poi
     LEFT JOIN raw_materials rm ON rm.id = poi.raw_material_id
     WHERE poi.purchase_order_id = $1
     ORDER BY poi.description`,
    [poId]
  );
  const { rows: events } = await db.query(
    `SELECT poe.*, u.name AS created_by_name
     FROM purchase_order_events poe LEFT JOIN users u ON u.id = poe.created_by
     WHERE poe.purchase_order_id = $1
     ORDER BY poe.created_at ASC`,
    [poId]
  );
  return { ...po, items, events };
}

async function listPurchaseOrders(propertyId, { status } = {}) {
  const params = [propertyId];
  let query = `SELECT po.*, s.name AS supplier_name FROM purchase_orders po
               JOIN suppliers s ON s.id = po.supplier_id WHERE po.property_id = $1`;
  if (status) { params.push(status); query += ` AND po.status = $${params.length}`; }
  query += ' ORDER BY po.created_at DESC';
  const { rows } = await db.query(query, params);
  return rows;
}

module.exports = {
  createPurchaseOrder,
  updatePurchaseOrderItems,
  setPurchaseOrderStatus,
  receivePurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
};
