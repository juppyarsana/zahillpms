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

// 'PR-0003', … — the purchase requests these PO lines order, for the PO's log.
async function requestNumbers(client, items) {
  const ids = items.map(i => i.request_line_id).filter(Boolean);
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT DISTINCT r.request_no FROM purchase_request_lines l JOIN purchase_requests r ON r.id = l.request_id
     WHERE l.id = ANY($1::uuid[]) ORDER BY r.request_no`, [ids]);
  return rows.map(r => `PR-${String(r.request_no).padStart(4, '0')}`);
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

// One PO line, checked: a sellable product kept in stock, a stock item, a POS
// inventory item (restaurant — received goods go to the POS, migration 144)
// or free text (kept in no stock). request_line_id = the purchase request
// line it orders. → { item } or { error }.
async function resolveItem(client, propertyId, raw) {
  const targets = [raw.product_id, raw.raw_material_id, raw.pos_item_id].filter(Boolean).length;
  if (targets > 1) return { error: 'Each line item can only be one kind of item' };
  const quantity = parseFloat(raw.quantity);
  const unitCost = parseFloat(raw.unit_cost);
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'Each line item needs a positive quantity' };
  if (!Number.isFinite(unitCost) || unitCost < 0) return { error: 'Each line item needs a non-negative unit cost' };
  let requestLineId = null;
  if (raw.request_line_id) {
    const rl = await require('./purchaseRequestService').checkRequestLine(client, propertyId, raw.request_line_id);
    if (!rl) return { error: 'A purchase request on this order is no longer open' };
    requestLineId = rl.id;
  }
  const base = { product_id: null, raw_material_id: null, pos_item_id: null, unit: null, quantity, unit_cost: unitCost, request_line_id: requestLineId };

  if (raw.product_id) {
    if (!Number.isInteger(quantity)) return { error: 'Sellable product quantities must be whole numbers' };
    const { rows: [product] } = await client.query(
      'SELECT id, name, track_stock, per_night, open_price FROM products WHERE id = $1 AND property_id = $2', [raw.product_id, propertyId]);
    if (!product) return { error: 'A referenced product was not found' };
    if (!product.track_stock || product.per_night || product.open_price) return { error: `${product.name} is not kept in stock — only sales items with Track stock (Sales → Items) can be bought on a purchase order` };
    return { item: { ...base, product_id: product.id, description: product.name } };
  }
  if (raw.raw_material_id) {
    const { rows: [material] } = await client.query(
      'SELECT id, name FROM raw_materials WHERE id = $1 AND property_id = $2', [raw.raw_material_id, propertyId]);
    if (!material) return { error: 'A referenced raw material was not found' };
    return { item: { ...base, raw_material_id: material.id, description: material.name } };
  }
  const description = String(raw.description || '').trim().slice(0, 255);
  if (!description) return { error: 'Each line item needs a name' };
  const unit = String(raw.unit || '').trim().slice(0, 20) || null;
  if (raw.pos_item_id) return { item: { ...base, pos_item_id: String(raw.pos_item_id).slice(0, 64), description, unit } };
  return { item: { ...base, description, unit } };
}

async function resolveItems(client, propertyId, items) {
  const out = [];
  for (const raw of items) {
    const r = await resolveItem(client, propertyId, raw);
    if (r.error) return r;
    out.push(r.item);
  }
  return { items: out };
}

async function insertItems(client, poId, items) {
  for (const item of items) {
    await client.query(
      `INSERT INTO purchase_order_items (purchase_order_id, product_id, raw_material_id, pos_item_id, unit, request_line_id, description, quantity, unit_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [poId, item.product_id, item.raw_material_id, item.pos_item_id, item.unit, item.request_line_id, item.description, item.quantity, item.unit_cost]);
  }
}

// The department a PO is for: chosen, else the one its purchase requests share.
async function poDepartment(client, propertyId, chosen, items) {
  const { DEPARTMENT_KEYS } = require('./costCategories');
  if (DEPARTMENT_KEYS.includes(chosen)) return chosen;
  const ids = items.map(i => i.request_line_id).filter(Boolean);
  if (!ids.length) return null;
  const { rows } = await client.query(
    `SELECT DISTINCT r.department FROM purchase_request_lines l JOIN purchase_requests r ON r.id = l.request_id
     WHERE l.id = ANY($1::uuid[]) AND r.property_id = $2`, [ids, propertyId]);
  return rows.length === 1 ? rows[0].department : null;
}

// items: [{ product_id? | raw_material_id? | pos_item_id? (+ description, unit) | description (+ unit), quantity, unit_cost, request_line_id? }]
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

    const resolved = await resolveItems(client, propertyId, items);
    if (resolved.error) { await client.query('ROLLBACK'); return { error: resolved.error }; }
    const resolvedItems = resolved.items;

    const totalAmount = round2(resolvedItems.reduce((s, i) => s + i.quantity * i.unit_cost, 0));
    const poNumber = await nextPoNumber(client, propertyId);
    const department = await poDepartment(client, propertyId, body.department, resolvedItems);

    const { rows: [po] } = await client.query(
      `INSERT INTO purchase_orders (property_id, supplier_id, po_number, status, total_amount, notes, requested_by, department)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7) RETURNING *`,
      [propertyId, supplier_id, poNumber, totalAmount, notes || null, userId || null, department]
    );

    await insertItems(client, po.id, resolvedItems);
    const reqNos = await requestNumbers(client, resolvedItems);
    await logEvent(client, po.id, reqNos.length ? `Purchase order created from ${reqNos.join(', ')}` : 'Purchase order created', userId);

    await client.query('COMMIT');
    return { purchase_order: po };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// What each line's item usually costs (per its own unit): a stock item's or a
// Sales item's weighted-average cost, a restaurant item's average in the POS.
// Adds usual_cost (null when unknown) and price_jump (the share above it, when
// the line's price is more than 20% higher). Never throws — a POS that can't be
// reached leaves its lines without a usual cost.
const PRICE_JUMP = 0.2;
// The POS's average costs, per property, for a minute: a PO window waiting for
// approval refreshes every few seconds and must not ask the POS each time; the
// POS gets 2 s to answer (it may be on another server) — slower = no warning.
const POS_COST_TTL_MS = 60 * 1000;
const POS_COST_TIMEOUT_MS = 2000;
const posCostCache = new Map(); // propertyId → { at, costs: Map(pos item id → avg cost) }
async function posAverageCosts(propertyId) {
  const hit = posCostCache.get(propertyId);
  if (hit && Date.now() - hit.at < POS_COST_TTL_MS) return hit.costs;
  try {
    const inv = await require('./posPurchases').inventory(propertyId, { timeoutMs: POS_COST_TIMEOUT_MS });
    const costs = new Map(inv.items.map(i => [i.id, i.avg_cost]));
    posCostCache.set(propertyId, { at: Date.now(), costs });
    return costs;
  } catch (err) {
    console.error('[PO usual cost] POS:', err.message);
    // Not answering: try again in a minute, not on every refresh.
    posCostCache.set(propertyId, { at: Date.now(), costs: hit?.costs || new Map() });
    return hit?.costs || new Map();
  }
}
async function withUsualCosts(propertyId, items) {
  const ids = kind => [...new Set(items.map(i => i[kind]).filter(Boolean))];
  const usual = new Map();
  const rm = ids('raw_material_id'), pr = ids('product_id'), pos = ids('pos_item_id');
  if (rm.length) (await db.query('SELECT id, cost_per_unit FROM raw_materials WHERE id = ANY($1::uuid[]) AND property_id = $2', [rm, propertyId]))
    .rows.forEach(r => usual.set(`rm:${r.id}`, r.cost_per_unit));
  if (pr.length) (await db.query('SELECT id, cost_per_unit FROM products WHERE id = ANY($1::uuid[]) AND property_id = $2', [pr, propertyId]))
    .rows.forEach(r => usual.set(`p:${r.id}`, r.cost_per_unit));
  if (pos.length) (await posAverageCosts(propertyId)).forEach((cost, id) => usual.set(`pos:${id}`, cost));
  return items.map(it => {
    const key = it.raw_material_id ? `rm:${it.raw_material_id}` : it.product_id ? `p:${it.product_id}` : it.pos_item_id ? `pos:${it.pos_item_id}` : null;
    const u = key && usual.get(key) != null ? Number(usual.get(key)) : null;
    const per = Number(it.unit_cost);
    const jump = u > 0 && per > u * (1 + PRICE_JUMP) ? per / u - 1 : null;
    return { ...it, usual_cost: u, price_jump: jump };
  });
}

// "3 pcs × Rp 350" — for the PO's edit log.
const lineText = i => `${Number(i.quantity)}${i.unit ? ' ' + i.unit : ''} × Rp ${Math.round(Number(i.unit_cost)).toLocaleString('id-ID')}`;
const lineKey = i => i.raw_material_id || i.product_id || i.pos_item_id || `t:${i.description}`;

// Replaces the full item set — draft only, so an approved/received PO's
// items can't shift under an already-issued or already-fulfilled order.
async function updatePurchaseOrderItems(propertyId, poId, body, userId) {
  const { items, notes } = body;
  if (!Array.isArray(items) || items.length === 0) return { error: 'At least one line item is required' };

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [po] } = await client.query(
      `SELECT po.*, s.name AS supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1 AND po.property_id = $2 FOR UPDATE OF po`, [poId, propertyId]
    );
    if (!po) { await client.query('ROLLBACK'); return { error: 'Purchase order not found' }; }
    if (po.status !== 'draft') { await client.query('ROLLBACK'); return { error: 'Only a draft purchase order can be edited' }; }
    if (po.is_direct) { await client.query('ROLLBACK'); return { error: 'Bought without a PO — void it instead' }; }

    // Supplier: optional, may change while the PO is a draft.
    let supplier = { id: po.supplier_id, name: po.supplier_name };
    if (body.supplier_id && body.supplier_id !== po.supplier_id) {
      const { rows: [sup] } = await client.query('SELECT id, name FROM suppliers WHERE id = $1 AND property_id = $2', [body.supplier_id, propertyId]);
      if (!sup) { await client.query('ROLLBACK'); return { error: 'Supplier not found' }; }
      supplier = sup;
    }

    const resolved = await resolveItems(client, propertyId, items);
    if (resolved.error) { await client.query('ROLLBACK'); return { error: resolved.error }; }
    const resolvedItems = resolved.items;

    const totalAmount = round2(resolvedItems.reduce((s, i) => s + i.quantity * i.unit_cost, 0));

    // What changed, for the PO's activity log.
    const { rows: oldItems } = await client.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    const oldBy = new Map(oldItems.map(i => [lineKey(i), i]));
    const newKeys = new Set(resolvedItems.map(lineKey));
    const changes = [];
    if (supplier.id !== po.supplier_id) changes.push(`supplier ${po.supplier_name || '—'} → ${supplier.name}`);
    for (const n of resolvedItems) {
      const o = oldBy.get(lineKey(n));
      if (!o) changes.push(`added ${n.description} ${lineText(n)}`);
      else if (Number(o.quantity) !== Number(n.quantity) || Number(o.unit_cost) !== Number(n.unit_cost)) {
        changes.push(`${n.description} ${lineText({ ...o, unit: n.unit })} → ${lineText(n)}`);
      }
    }
    for (const o of oldItems) if (!newKeys.has(lineKey(o))) changes.push(`removed ${o.description}`);
    const newNotes = notes === undefined ? po.notes : (String(notes || '').trim() || null);
    if ((newNotes || '') !== (po.notes || '')) changes.push('note changed');
    if (round2(Number(po.total_amount)) !== totalAmount) {
      changes.push(`total Rp ${Math.round(po.total_amount).toLocaleString('id-ID')} → Rp ${Math.round(totalAmount).toLocaleString('id-ID')}`);
    }

    await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    await insertItems(client, poId, resolvedItems);
    const { rows: [updated] } = await client.query(
      `UPDATE purchase_orders SET total_amount = $1, notes = $2, supplier_id = $4, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [totalAmount, newNotes, poId, supplier.id]
    );
    if (changes.length) await logEvent(client, poId, `Edited: ${changes.join('; ')}`, userId);
    await client.query('COMMIT');
    return { purchase_order: updated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// opts.byName / opts.via: an approval or send-back pressed on Telegram (no PMS
// user — services/poApproval.js). After the commit, a PO that went to
// pending_approval is sent to the Telegram approvers, and one that left it has
// the buttons taken off their messages.
async function setPurchaseOrderStatus(propertyId, poId, newStatus, userId, opts = {}) {
  const client = await db.pool.connect();
  let before, byName;
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

    before = po.status;
    byName = opts.byName || (userId ? (await client.query('SELECT name FROM users WHERE id = $1', [userId])).rows[0]?.name : null);
    const via = opts.via || 'pms';
    const { rows: [updated] } = await client.query(
      `UPDATE purchase_orders SET status = $1, updated_at = NOW(),
         approved_by = CASE WHEN $4 THEN $2 ELSE approved_by END,
         approved_by_name = CASE WHEN $4 THEN $5 ELSE approved_by_name END,
         approved_via = CASE WHEN $4 THEN $6 ELSE approved_via END,
         approved_at = CASE WHEN $4 THEN NOW() ELSE approved_at END
       WHERE id = $3 RETURNING *`,
      [newStatus, userId || null, poId, newStatus === 'approved', byName || null, via]
    );
    const note = STATUS_EVENT_NOTES[newStatus] || `Status changed to ${newStatus}`;
    await logEvent(client, poId, via === 'telegram' ? `${note} on Telegram by ${byName}` : note, userId);
    await client.query('COMMIT');
    const approval = require('./poApproval');
    if (newStatus === 'pending_approval') approval.sendForApproval(propertyId, poId, userId);
    else if (before === 'pending_approval') approval.closeMessages(poId, approval.leftNote(newStatus, byName, via));
    return { purchase_order: updated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Adds `delta` of a PO line's item to stock and blends `unitCost` into its
// weighted-average cost — by value, not just the last price paid, so
// cost_per_unit reflects what the stock on hand actually cost (standard
// inventory valuation; Stock value reads it). Locks the item's row so two
// receipts can't blend from a stale quantity. Used by PO receiving and by
// Buy without a PO (directPurchaseService). Returns the average before.
async function addStock(client, propertyId, item, delta, unitCost, poId, userId) {
  if (item.product_id) {
    const { rows: [product] } = await client.query(
      'SELECT stock_quantity, cost_per_unit FROM products WHERE id = $1 FOR UPDATE', [item.product_id]);
    const oldQty = product.stock_quantity; // INT column, unlike raw_materials' NUMERIC
    const oldAvg = product.cost_per_unit != null ? parseFloat(product.cost_per_unit) : null;
    const newQty = oldQty + delta;
    const newAvg = newQty > 0 ? round2(((oldQty > 0 ? oldQty : 0) * (oldAvg || 0) + delta * unitCost) / (Math.max(oldQty, 0) + delta)) : oldAvg;
    await client.query('UPDATE products SET stock_quantity = $1, cost_per_unit = $2 WHERE id = $3', [newQty, newAvg, item.product_id]);
    await client.query(
      `INSERT INTO stock_movements (property_id, product_id, change_qty, reason, purchase_order_id, created_by)
       VALUES ($1,$2,$3,'restock',$4,$5)`, [propertyId, item.product_id, delta, poId, userId || null]);
    return { oldAvg, oldQty };
  }
  const { rows: [material] } = await client.query(
    'SELECT stock_quantity, cost_per_unit FROM raw_materials WHERE id = $1 FOR UPDATE', [item.raw_material_id]);
  const oldQty = parseFloat(material.stock_quantity);
  const oldAvg = material.cost_per_unit != null ? parseFloat(material.cost_per_unit) : null;
  const newQty = oldQty + delta;
  const newAvg = newQty > 0 ? round2(((oldQty > 0 ? oldQty : 0) * (oldAvg || 0) + delta * unitCost) / (Math.max(oldQty, 0) + delta)) : oldAvg;
  await client.query('UPDATE raw_materials SET stock_quantity = $1, cost_per_unit = $2 WHERE id = $3', [newQty, newAvg, item.raw_material_id]);
  await client.query(
    `INSERT INTO raw_material_movements (property_id, raw_material_id, change_qty, reason, purchase_order_id, created_by)
     VALUES ($1,$2,$3,'purchase',$4,$5)`, [propertyId, item.raw_material_id, delta, poId, userId || null]);
  return { oldAvg, oldQty };
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
      receivedNow.push({ description: item.description, delta, where: item.pos_item_id ? ' (restaurant stock)' : '' });

      await client.query(
        'UPDATE purchase_order_items SET received_quantity = received_quantity + $1 WHERE id = $2',
        [delta, item.id]
      );

      // A POS line goes to the restaurant's stock after the commit (sendToPos);
      // a free-text line is kept in no stock.
      if (item.product_id || item.raw_material_id) {
        await addStock(client, propertyId, item, delta, parseFloat(item.unit_cost), poId, userId);
      }
    }
    await require('./purchaseRequestService').refreshAfterReceive(client, poId);

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
      const summary = receivedNow.map(r => `${r.description} ×${r.delta}${r.where}`).join(', ');
      const note = fullyReceived ? `Received ${summary} — fully received` : `Received ${summary}`;
      await logEvent(client, poId, note, userId);
    }

    await client.query('COMMIT');
    const pos = await require('./posPurchases').sendToPos(propertyId, poId);
    return { purchase_order: updated, pos };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getPurchaseOrder(propertyId, poId) {
  const { rows: [po] } = await db.query(
    `SELECT po.*, COALESCE(s.name, po.bought_from, 'No supplier') AS supplier_name, vu.name AS voided_by_name
     FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN users vu ON vu.id = po.voided_by
     WHERE po.id = $1 AND po.property_id = $2`,
    [poId, propertyId]
  );
  if (!po) return null;
  const { rows: items } = await db.query(
    `SELECT poi.*, COALESCE(rm.unit_of_measure, poi.unit) AS unit_of_measure,
            CASE WHEN poi.pos_item_id IS NOT NULL THEN 'pos' WHEN poi.product_id IS NULL AND poi.raw_material_id IS NULL THEN 'text' END AS line_kind,
            'PR-' || lpad(pr.request_no::text, 4, '0') AS request_no_text, pr.id AS request_id, pr.department AS request_department
     FROM purchase_order_items poi
     LEFT JOIN raw_materials rm ON rm.id = poi.raw_material_id
     LEFT JOIN purchase_request_lines prl ON prl.id = poi.request_line_id
     LEFT JOIN purchase_requests pr ON pr.id = prl.request_id
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
  // Approvers whose Telegram message for this submission is still open.
  const { rows: tg } = po.status === 'pending_approval'
    ? await db.query('SELECT DISTINCT recipient_name FROM purchase_order_approval_messages WHERE purchase_order_id = $1 AND is_open ORDER BY 1', [poId])
    : { rows: [] };
  return { ...po, items: await withUsualCosts(propertyId, items), events, telegram_approvers: tg.map(r => r.recipient_name) };
}

async function listPurchaseOrders(propertyId, { status } = {}) {
  const params = [propertyId];
  let query = `SELECT po.*, COALESCE(s.name, po.bought_from, 'No supplier') AS supplier_name FROM purchase_orders po
               LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE po.property_id = $1`;
  if (status) { params.push(status); query += ` AND po.status = $${params.length}`; }
  query += ' ORDER BY po.created_at DESC';
  const { rows } = await db.query(query, params);
  return rows;
}

module.exports = {
  resolveItems,
  addStock,
  logEvent,
  nextPoNumber,
  createPurchaseOrder,
  updatePurchaseOrderItems,
  setPurchaseOrderStatus,
  receivePurchaseOrder,
  getPurchaseOrder,
  withUsualCosts,
  listPurchaseOrders,
};
