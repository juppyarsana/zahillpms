// Restaurant goods bought by hotel purchasing (migration 144). The
// restaurant's stock lives in the POS (its recipes take ingredients off it at
// each sale), so a PO line for a POS inventory item is NOT added to PMS stock:
// what is received is sent to the POS as a purchase batch, with the PO's
// price, so the POS's stock and food cost follow. The money is already in the
// PMS (Payables / Make bill) — the POS records no expense for it.
//
//   POS GET  /api/hotel/inventory          its items: id, name, unit, stock, low
//   POS POST /api/hotel/purchase-batches   { ref, po_number, supplier, received_on, by, section, handover: true,
//                                            items: [{ inventory_id, qty, total_cost }] }
//
// handover: the POS holds the goods until the chef confirms what really came
// (posHandover.js). An older POS answers without `pending` and books them at once.
//
// Same hotel key and address as room tablet orders (posRoomOrders.js). `ref`
// = '<PO line id>:<received so far>' — sending the same state again is a
// replay on the POS side, so a retry never adds the goods twice.
const db = require('../db');
const { config, call } = require('./posRoomOrders');
const { todayWITA } = require('./roomChargeService');
const { lineAmount } = require('./poFormat');
const handover = require('./posHandover');

const num = v => parseFloat(v) || 0;
const NOT_LINKED = 'The POS link is not set up (Property Details → POS Integration → Room tablet orders)';

async function inventory(propertyId, opts) {
  const cfg = await config(propertyId);
  if (!cfg.url || !cfg.key) return { linked: false, items: [] };
  const r = await call(cfg, 'GET', '/api/hotel/inventory', undefined, opts);
  return { linked: true, items: Array.isArray(r?.items) ? r.items : [] };
}

// Sends every POS line of the PO that has more received than the POS has.
// Never throws — the receipt itself is already saved; a line that could not
// be sent keeps pos_send_error and is sent again with "Send to the POS".
// → { sent, failed, error }
async function sendToPos(propertyId, poId) {
  try { return await send(propertyId, poId); } catch (err) {
    console.error('[POS purchase]', err.message);
    return { sent: 0, failed: 1, error: err.message };
  }
}

async function send(propertyId, poId) {
  const { rows: lines } = await db.query(
    `SELECT i.id, i.description, i.pos_item_id, i.quantity, i.unit_cost, i.line_total, i.received_quantity, i.pos_sent_qty,
            po.po_number, COALESCE(s.name, po.bought_from) AS supplier, pr.section,
            (SELECT to_char(MAX(r.received_on), 'YYYY-MM-DD') FROM purchase_order_receipts r WHERE r.purchase_order_id = po.id) AS received_on
     FROM purchase_order_items i
     JOIN purchase_orders po ON po.id = i.purchase_order_id
     LEFT JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN purchase_request_lines prl ON prl.id = i.request_line_id
     LEFT JOIN purchase_requests pr ON pr.id = prl.request_id
     WHERE i.purchase_order_id = $1 AND po.property_id = $2
       AND po.voided_at IS NULL
       AND i.pos_item_id IS NOT NULL AND i.received_quantity > i.pos_sent_qty`, [poId, propertyId]);
  if (!lines.length) return { sent: 0, failed: 0, error: null };
  let cfg;
  try { cfg = await config(propertyId); } catch (err) { cfg = {}; }
  let sent = 0, failed = 0, lastError = null;
  for (const l of lines) {
    const qty = Math.round((num(l.received_quantity) - num(l.pos_sent_qty)) * 1000) / 1000;
    let error = null;
    if (!cfg.url || !cfg.key) error = NOT_LINKED;
    else {
      try {
        const unitCost = lineAmount(l) / num(l.quantity);
        const ref = `${l.id}:${num(l.received_quantity)}`;
        const r = await call(cfg, 'POST', '/api/hotel/purchase-batches', {
          ref, po_number: l.po_number, supplier: l.supplier,
          received_on: l.received_on || todayWITA(), by: 'Hotel purchasing', section: l.section, handover: true,
          items: [{ inventory_id: l.pos_item_id, qty, total_cost: Math.round(qty * unitCost * 100) / 100 }],
        });
        await handover.recordSent(propertyId, { poItemId: l.id, ref, qty, unitCost, pending: !!r?.pending });
      } catch (err) { error = err.message; }
    }
    await db.query(
      `UPDATE purchase_order_items SET pos_sent_qty = CASE WHEN $2::text IS NULL THEN $3 ELSE pos_sent_qty END,
              pos_send_error = $2 WHERE id = $1`, [l.id, error, l.received_quantity]);
    if (error) { failed++; lastError = error; } else sent++;
  }
  return { sent, failed, error: lastError };
}

module.exports = { inventory, sendToPos };
