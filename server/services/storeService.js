// Stores (migration 156, STORES_PLAN.md): where stock is kept.
//   main — Main Store: everything bought goes here unless another store is picked.
//   pms  — another store whose stock the PMS keeps (Engineering, Housekeeping…).
//   pos  — Kitchen / Resto: listed so they can be picked, but their stock is the
//          POS's (one figure per item there, marked kitchen / resto).
// Quantities per PMS store are in store_stock, kept in step with the movement
// ledgers by a database trigger: a movement row's change is added to its
// store_id (no store_id = Main Store). So moving stock = writing a movement with
// the right store_id; nothing here writes store_stock directly.
const db = require('../db');

const fail = (status, error, code) => ({ status, error, code });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_LABEL = { main: 'Main store', pms: 'Kept in the PMS', pos: 'Kept in the restaurant app (POS)' };

async function mainStoreId(propertyId, q = db) {
  const { rows: [r] } = await q.query('SELECT ensure_main_store($1) AS id', [propertyId]);
  return r.id;
}

// The hidden "on the way" store (migration 157): goods sent to another store
// sit here until it confirms them. Made the first time it is needed.
async function transitStoreId(propertyId, q = db) {
  await mainStoreId(propertyId, q);
  await q.query(
    `INSERT INTO stores (property_id, name, kind, sort_order) VALUES ($1, 'On the way', 'transit', 999)
     ON CONFLICT DO NOTHING`, [propertyId]);
  const { rows: [r] } = await q.query(`SELECT id FROM stores WHERE property_id = $1 AND kind = 'transit'`, [propertyId]);
  return r.id;
}

async function listStores(propertyId, { inactive = false } = {}, q = db) {
  await mainStoreId(propertyId, q);   // a property that never had stock gets its stores now
  const { rows } = await q.query(
    `SELECT s.id, s.name, s.kind, s.section, s.sort_order, s.is_active,
       (SELECT COUNT(*) FROM store_stock ss WHERE ss.store_id = s.id AND ss.quantity <> 0)::int AS items_held
     FROM stores s WHERE s.property_id = $1 AND s.kind <> 'transit' ${inactive ? '' : 'AND s.is_active'}
     ORDER BY s.sort_order, lower(s.name)`, [propertyId]);
  return rows.map(s => ({ ...s, kind_label: KIND_LABEL[s.kind], holds_stock: s.kind !== 'pos' }));
}

// A store the PMS keeps stock for (Main Store or another PMS store), active.
// Empty / missing = Main Store. Returns { store } or a fail().
async function pmsStore(propertyId, storeId, q = db) {
  if (!storeId) {
    const id = await mainStoreId(propertyId, q);
    const { rows: [s] } = await q.query('SELECT id, name, kind FROM stores WHERE id = $1', [id]);
    return { store: s };
  }
  if (!UUID_RE.test(String(storeId))) return fail(400, 'Choose a store');
  const { rows: [s] } = await q.query(
    'SELECT id, name, kind, is_active FROM stores WHERE id = $1 AND property_id = $2', [storeId, propertyId]);
  if (!s || s.kind === 'transit') return fail(400, 'Choose a store');
  if (s.kind === 'pos') return fail(400, `${s.name}'s stock is kept in the restaurant app (POS)`, 'POS_STORE');
  if (!s.is_active) return fail(400, `${s.name} is no longer used`, 'STORE_INACTIVE');
  return { store: s };
}

// What one store holds of one item ('rm' / 'p'). Callers lock the item's own
// row (raw_materials / products FOR UPDATE) first, which serialises changes.
async function storeQty(q, storeId, kind, id) {
  const col = kind === 'p' ? 'product_id' : 'raw_material_id';
  const { rows: [r] } = await q.query(`SELECT quantity FROM store_stock WHERE store_id = $1 AND ${col} = $2`, [storeId, id]);
  return r ? parseFloat(r.quantity) || 0 : 0;
}

// { name } adds a PMS store; with an id: { name?, is_active?, sort_order? }.
// Main Store can't be switched off; a store still holding stock can't either.
async function saveStore(propertyId, body, id = null) {
  const name = body.name != null ? String(body.name).trim().slice(0, 60) : null;
  if (!id && !name) return fail(400, 'Enter the store\'s name');
  if (name != null && !name) return fail(400, 'Enter the store\'s name');
  if (name) {
    const { rows: [dup] } = await db.query(
      'SELECT id FROM stores WHERE property_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3', [propertyId, name, id]);
    if (dup) return fail(409, 'A store with this name already exists', 'DUPLICATE');
  }
  if (!id) {
    await mainStoreId(propertyId);
    const { rows: [n] } = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM stores WHERE property_id = $1', [propertyId]);
    const { rows: [s] } = await db.query(
      `INSERT INTO stores (property_id, name, kind, sort_order) VALUES ($1, $2, 'pms', $3) RETURNING id`, [propertyId, name, n.n]);
    return { stores: await listStores(propertyId, { inactive: true }), id: s.id };
  }
  if (!UUID_RE.test(String(id))) return fail(404, 'Store not found');
  const { rows: [s] } = await db.query('SELECT * FROM stores WHERE id = $1 AND property_id = $2', [id, propertyId]);
  if (!s || s.kind === 'transit') return fail(404, 'Store not found');
  if (body.is_active === false && s.is_active) {
    if (s.kind === 'main') return fail(409, 'Main Store is always used', 'MAIN');
    if (s.kind === 'pos') return fail(409, `${s.name} is the restaurant's — it stays`, 'POS_STORE');
    const { rows: [held] } = await db.query('SELECT COUNT(*)::int AS n FROM store_stock WHERE store_id = $1 AND quantity <> 0', [id]);
    if (held.n) return fail(409, `${s.name} still holds ${held.n} item${held.n > 1 ? 's' : ''} — move or count them out first`, 'NOT_EMPTY');
    const { rows: [open] } = await db.query(`SELECT 1 FROM stock_opnames WHERE store_id = $1 AND status = 'draft'`, [id]);
    if (open) return fail(409, `A stock opname of ${s.name} is still being counted`, 'OPEN');
    const { rows: [moving] } = await db.query(
      `SELECT 1 FROM stock_transfers WHERE (from_store_id = $1 OR to_store_id = $1) AND status = 'sent' LIMIT 1`, [id]);
    if (moving) return fail(409, `Items are still on the way to or from ${s.name} — confirm or cancel that transfer first`, 'OPEN_TRANSFER');
  }
  const order = body.sort_order != null && Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : null;
  await db.query(
    `UPDATE stores SET name = COALESCE($1, name), is_active = COALESCE($2, is_active), sort_order = COALESCE($3, sort_order) WHERE id = $4`,
    [name, typeof body.is_active === 'boolean' ? body.is_active : null, order, id]);
  return { stores: await listStores(propertyId, { inactive: true }) };
}

// The PMS stock item that stands for a POS inventory item (migration 158), so
// a PMS store can hold restaurant goods. Made the first time it is needed.
// pos = { id, name, unit, fnb_kind? }; fnb_kind decides the cost category
// (food / drinks — counted in Cost of sales — or supplies). Returns its id.
const MIRROR_CATEGORY = { food: 'food', drink: 'drinks', both: 'food', other: 'supplies' };
async function mirrorItem(q, propertyId, pos) {
  const posId = String(pos.id).slice(0, 64);
  const category = pos.fnb_kind ? MIRROR_CATEGORY[pos.fnb_kind] || 'food' : null;
  const { rows: [had] } = await q.query(
    'SELECT id FROM raw_materials WHERE property_id = $1 AND pos_item_id = $2', [propertyId, posId]);
  if (had) {
    if (category) await q.query('UPDATE raw_materials SET category = $2 WHERE id = $1 AND category IS DISTINCT FROM $2', [had.id, category]);
    return had.id;
  }
  const { rows: [r] } = await q.query(
    `INSERT INTO raw_materials (property_id, name, unit_of_measure, category, pos_item_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (property_id, pos_item_id) WHERE pos_item_id IS NOT NULL DO UPDATE SET name = raw_materials.name
     RETURNING id`,
    [propertyId, String(pos.name || 'Restaurant item').slice(0, 255), String(pos.unit || 'pcs').slice(0, 20), category || 'food', posId]);
  return r.id;
}

// A store for receiving or moving restaurant goods: a PMS store keeps them as
// the mirror item; Kitchen / Resto (kind pos) means "send to the POS".
async function anyStore(propertyId, storeId, q = db) {
  if (!storeId) return pmsStore(propertyId, null, q);
  if (!UUID_RE.test(String(storeId))) return fail(400, 'Choose a store');
  const { rows: [s] } = await q.query(
    'SELECT id, name, kind, section, is_active FROM stores WHERE id = $1 AND property_id = $2', [storeId, propertyId]);
  if (!s || s.kind === 'transit') return fail(400, 'Choose a store');
  if (!s.is_active) return fail(400, `${s.name} is no longer used`, 'STORE_INACTIVE');
  return { store: s };
}

module.exports = { KIND_LABEL, mainStoreId, transitStoreId, listStores, pmsStore, anyStore, storeQty, saveStore, mirrorItem };
