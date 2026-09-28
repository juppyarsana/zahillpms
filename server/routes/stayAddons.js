const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { round2 } = require('../services/folioService');
const { priceBasis, shown } = require('../services/priceBasis');

// Per-night stay extras on a booking (booking_addons, migration 074 — e.g. an
// extra bed for 28 Sep). ADDED through the normal sale path (POST /api/sales
// with `nights`, from the Sales till or the reservation), so both doors write
// the same record; this file lists them and removes a night. Mounted at
// /api/bookings (reservations module), before routes/bookings.js.

// GET /api/bookings/:id/addons — every add-on night of the booking, with
// whether it's on the folio yet and whether it's still inside the stay dates
// (after Amend Dates / early departure, nights outside aren't charged).
router.get('/:id/addons', auth, async (req, res) => {
  try {
    const { rows: [b] } = await db.query(
      'SELECT id, check_in_date, check_out_date FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    const { rows } = await db.query(`
      SELECT a.id, a.sale_id, a.product_id, a.description, a.service_date, a.quantity, a.unit_price, a.meal_price, a.breakfasts,
             a.status, a.created_at, a.removed_at, a.removed_reason, cu.name AS created_by_name, ru.name AS removed_by_name,
             s.payment_method,
             EXISTS (SELECT 1 FROM folio_charges f WHERE f.addon_id = a.id AND f.is_voided = false) AS posted,
             (a.service_date >= $2::date AND a.service_date < $3::date) AS in_stay
      FROM booking_addons a
      LEFT JOIN users cu ON cu.id = a.created_by
      LEFT JOIN users ru ON ru.id = a.removed_by
      LEFT JOIN sales s ON s.id = a.sale_id
      WHERE a.booking_id = $1 AND a.property_id = $4
      ORDER BY a.service_date, a.description, a.created_at`,
      [b.id, b.check_in_date, b.check_out_date, req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bookings/:id/addons/:addonId  { reason? } — take one night off.
// Nothing is deleted: the night is marked removed (who / when / why), its
// folio line, if already posted, is voided (kept), and the sale it came from
// is reduced so Sales History shows what's really charged.
router.delete('/:id/addons/:addonId', auth, async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 250) || null;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [a] } = await client.query(
      `SELECT a.* FROM booking_addons a
       WHERE a.id = $1 AND a.booking_id = $2 AND a.property_id = $3 FOR UPDATE`,
      [req.params.addonId, req.params.id, req.propertyId]);
    if (!a) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (a.status !== 'active') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Already removed' }); }

    await client.query(
      `UPDATE booking_addons SET status = 'removed', removed_by = $1, removed_at = NOW(), removed_reason = $2 WHERE id = $3`,
      [req.user.id, reason, a.id]);
    const { rowCount: voided } = await client.query(
      `UPDATE folio_charges SET is_voided = true, voided_by = $1, voided_at = NOW()
       WHERE addon_id = $2 AND is_voided = false`, [req.user.id, a.id]);

    // Keep the sale line in step (units × nights still charged).
    if (a.sale_item_id) {
      const { rows: [line] } = await client.query('SELECT * FROM sale_items WHERE id = $1 FOR UPDATE', [a.sale_item_id]);
      if (line) {
        const qty = Math.max(0, line.quantity - a.quantity);
        const subtotal = round2(parseFloat(line.unit_price) * qty);
        const nightMeal = Math.min(a.breakfasts * parseFloat(a.meal_price), a.quantity * parseFloat(a.unit_price));
        const meal = round2(Math.max(0, parseFloat(line.meal_amount) - nightMeal));
        await client.query('UPDATE sale_items SET quantity = $1, subtotal = $2, meal_amount = $3 WHERE id = $4',
          [qty, subtotal, meal, line.id]);
        await client.query(
          `UPDATE sales SET
             shown_total = CASE WHEN shown_total IS NOT NULL AND total_amount > 0
               THEN ROUND(shown_total * (SELECT COALESCE(SUM(subtotal), 0) FROM sale_items WHERE sale_id = $1) / total_amount) END,
             total_amount = (SELECT COALESCE(SUM(subtotal), 0) FROM sale_items WHERE sale_id = $1)
           WHERE id = $1`,
          [line.sale_id]);
      }
    }
    const night = String(a.service_date instanceof Date ? a.service_date.toISOString() : a.service_date).slice(0, 10);
    const perNight = shown(a.unit_price, await priceBasis(req.propertyId, client));   // as entered (079)
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [
      a.booking_id,
      `${a.description} removed for ${night} (${a.quantity} × Rp ${Math.round(perNight).toLocaleString('id-ID')})${voided ? ' — folio line voided' : ''}${reason ? `. Reason: ${reason}` : ''}`.slice(0, 1000),
      req.user.id,
    ]);
    await client.query('COMMIT');
    res.json({ ok: true, voided: voided > 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
