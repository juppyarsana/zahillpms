const router = require('express').Router();
const authPos = require('../middleware/authPos');
const moduleGuard = require('../middleware/moduleGuard');
const pos = require('../services/posIntegrationService');
const db = require('../db');
const fs = require('fs');
const path = require('path');

// External POS API (migration 070) — called by the POS's backend with the
// property's pos_api_key as a Bearer token. Per-route guard, same convention
// as /api/kitchen and /api/resto.
const gate = [authPos, moduleGuard('pos_integration')];

// GET /api/pos/rooms — every checked-in room, for a room picker.
router.get('/rooms', gate, async (req, res) => {
  try {
    res.json(await pos.listInHouseRooms(req.propertyId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/rooms/:room — one room by name or Room ID, 404 if nobody is
// checked in there.
router.get('/rooms/:room', gate, async (req, res) => {
  try {
    const found = await pos.lookupRoom(req.propertyId, req.params.room);
    if (!found) return res.status(404).json({ error: 'No guest is checked in to that room' });
    res.json(found);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/alerts — an instant alert from the POS, sent on Telegram to
// whoever has it ticked in Reports & Alerts. Today: { type: 'complimentary',
// ref, department, for, reason, value, cost, table, cashier, at, items:[{name,qty}] }
// — a restaurant bill given away and charged to a department (no approval in
// the POS; the manager is told afterwards).
router.post('/alerts', gate, async (req, res) => {
  const a = req.body || {};
  if (a.type !== 'complimentary') return res.status(400).json({ error: 'Unknown alert type' });
  try {
    const { sendAlert, escapeHtml: h } = require('../services/telegramService');
    const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
    const items = (Array.isArray(a.items) ? a.items : []).slice(0, 15)
      .map(i => `• ${parseInt(i.qty, 10) || 1}× ${h(String(i.name || '').slice(0, 60))}`);
    const at = a.at ? new Date(a.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' }) : '';
    // Same layout as the session alert: sections separated by a blank line.
    const msg = [
      [`🎁 <b>Restaurant complimentary — ${h(String(a.department || '').slice(0, 40))}</b>`,
       `<i>${a.table ? `${h(String(a.table).slice(0, 40))} · ` : ''}by ${h(String(a.cashier || 'Staff').slice(0, 60))}${at ? ` at ${at}` : ''}</i>`],
      [`💰 <b>${rp(a.value)}</b> menu value`, `• Cost: ${rp(a.cost)}`],
      [`👤 <b>For</b>: ${h(String(a.for || '').slice(0, 120))}`, `📝 <b>Reason</b>: ${h(String(a.reason || '').slice(0, 300))}`],
      items.length ? ['🍽 <b>Items</b>', ...items] : [],
    ].filter(s => s.length).map(s => s.join('\n')).join('\n\n');
    await sendAlert(req.propertyId, 'alert_restaurant_complimentary', msg, { html: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/transactions — charge a bill to a room.
// Body: { room | booking_id, amount (NET: after discount, before service/tax)
//         OR gross_amount (all-in: what the guest pays — the PMS takes its own
//         service + tax out), description, external_ref (the POS transaction
//         id — makes retries safe) }
router.post('/transactions', gate, async (req, res) => {
  const { room, booking_id, amount, gross_amount, description, external_ref } = req.body || {};
  try {
    const result = await pos.postTransaction(req.propertyId, {
      bookingId: booking_id, room, amount, grossAmount: gross_amount, description, externalRef: external_ref,
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/sessions — a restaurant session's summary (Breakfast / Lunch /
// Dinner) sent from the POS Transactions page. Stored per business day +
// session; sending again replaces it. Body: { business_date, session, label,
// started_at, ended_at, bills, outlet: { bills, net, service, tax, total },
// room_charges: { bills, total, list }, by_method, categories, discounts,
// open_bills, breakfast: { rooms_expected, pax_expected, rooms_came, pax_came,
// not_came } | null, sent_by }. outlet.net → F&B revenue in the reports.
router.post('/sessions', gate, async (req, res) => {
  try {
    const result = await pos.saveSession(req.propertyId, req.body);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    // Telegram to whoever has "Restaurant sessions" ticked (Reports & Alerts).
    require('../services/telegramService')
      .sendAlert(req.propertyId, 'alert_restaurant_session', pos.sessionAlertText(req.body, result), { html: true }).catch(() => {});
    const { changes, ...reply } = result;
    res.status(result.replaced ? 200 : 201).json(reply);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/breakfast?date=YYYY-MM-DD (default today, WITA) — the rooms
// having breakfast that morning, for the POS waiter tablet. Same data and rule
// as Guest Lists → Kitchen (bookings.loadKitchen): guests who slept here the
// night before, on a rate plan that includes breakfast.
router.get('/breakfast', gate, async (req, res) => {
  try {
    const { loadKitchen, breakfastValues } = require('./bookings');
    const data = await loadKitchen(req.propertyId, req.query.date);
    if (!data) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const values = await breakfastValues(req.propertyId, data.date, data.breakfast.rows);
    const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
    res.json({
      date: data.date,
      rooms: data.breakfast.rooms,
      pax: data.breakfast.pax,
      without: data.breakfast.without, // in the hotel but breakfast not included
      rows: data.breakfast.rows.map(r => ({
        booking_id: r.id,
        room: r.unit_name,
        room_type: r.unit_type,
        guest_name: r.guest_name,
        pax: r.meal_pax,                     // guests with breakfast incl. extra beds
        // NET value of this room's included breakfasts (all pax), before
        // service & tax — for the POS breakfast recap.
        breakfast_value: values.get(r.id) || 0,
        rate_plan: r.rate_plan_code,
        status: r.status,
        checking_out: ymd(r.check_out_date) === data.date,
        special_requests: r.special_requests || '',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/branding — the property's name, contact details, brand colour
// and logo, so the POS can copy them (Setup → Branding → "Copy from hotel
// PMS"). The logo is sent inline (base64) rather than as a URL: the POS
// server then doesn't depend on how /property-logos is proxied here.
router.get('/branding', gate, async (req, res) => {
  try {
    const { rows: [b] } = await db.query(
      `SELECT COALESCE(ps.property_name, p.name) AS name, ps.property_address AS address,
              ps.property_phone AS phone, ps.property_email AS email, ps.brand_color, ps.logo_url
       FROM properties p LEFT JOIN property_settings ps ON ps.property_id = p.id
       WHERE p.id = $1`, [req.propertyId]);
    if (!b) return res.status(404).json({ error: 'Property not found' });
    let logo = null;
    if (b.logo_url) {
      const file = path.join(__dirname, '../uploads/property-logos', path.basename(b.logo_url));
      try {
        const data = await fs.promises.readFile(file);
        const ext = path.extname(file).toLowerCase();
        logo = { mime: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png', data: data.toString('base64') };
      } catch (_) { /* logo file missing — send the rest */ }
    }
    res.json({ name: b.name, address: b.address, phone: b.phone, email: b.email, brand_color: b.brand_color, logo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
