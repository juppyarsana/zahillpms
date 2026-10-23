// Import a property's history from an OLD single-hotel copy of this PMS
// (an early version, migrations ≤ 017, one hotel per database) into a
// property of this one. Built for Birdnest (2026-10-23): everything from a
// date on, so the property's Reports are complete from that date.
//
// What comes over, for every booking with a night on / after --from
// (upcoming ones too):
//   • guests — all of them (CRM history), matched by name + WhatsApp on a re-run
//   • bookings — room by NAME (Nest 1 → Nest 1), dates, guests, source (old
//     "traveloka" = Agoda, --map-source to change), status, price as the guest
//     paid it (tax included — the property must be set to its real rates and
//     "prices include tax" first), discount, notes, booked-on date
//   • payments — deposit / balance, amount, method, status and the date
//     received (so Daily Close / Cashier Closing / Reports → Money per day are right)
//   • check-in / check-out times
//   • the room nights on the folio of every checked-out stay (posted with
//     their own night, like the night audit would have)
//   • extras sold (sales + items; the product is made in the property when
//     it doesn't exist, by name), charged to the room
// Not: ID photos (files of the old server), loyalty, tasks, the old reports.
//
// Usage (from server/):
//   node maintenance/importOldPms.js --old postgresql://…/old_db --property birdnest --from 2026-07-01
//       dry run: everything is done and then rolled back — the report is exactly what --apply does
//   ... --apply            do it; writes a run file to maintenance/backups/ (needed for --undo)
//   ... --user x@y.com     "made by" for the bookings (default: the property's first owner)
//   ... --map-source old=new   (repeatable; default traveloka=agoda)
//   node maintenance/importOldPms.js --undo maintenance/backups/old-pms-import-<…>.json [--apply]
//       removes what the import made, except bookings changed since (dry run first)
// Each booking's internal notes start "IMPORT:old-pms · <old id>"; a second run
// skips bookings already imported.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const db = require('../db');
const { grossFactor, splitRevenue } = require('../services/bookingPriceService');
const { postStay } = require('../services/roomChargeService');

const TAG = 'IMPORT:old-pms';
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const opts = n => args.reduce((a, v, i) => (v === n && args[i + 1] ? [...a, args[i + 1]] : a), []);
const APPLY = flag('--apply');
const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const ymd = v => (v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(v).slice(0, 10));
const num = v => parseFloat(v || 0);
const round2 = n => Math.round(n * 100) / 100;

async function run() {
  const oldUrl = opt('--old'), slug = opt('--property'), from = opt('--from');
  if (!oldUrl || !slug || !/^\d{4}-\d{2}-\d{2}$/.test(from || '')) {
    console.error('Usage: node maintenance/importOldPms.js --old <postgres url> --property <slug> --from YYYY-MM-DD [--apply]');
    process.exit(1);
  }
  const sourceMap = { traveloka: 'agoda' };
  for (const m of opts('--map-source')) { const [a, b] = m.split('='); if (a && b) sourceMap[a] = b; }

  const old = new Pool({ connectionString: oldUrl });
  const client = await db.pool.connect();
  const dbName = (await client.query('SELECT current_database() d')).rows[0].d;
  const oldName = (await old.query('SELECT current_database() d')).rows[0].d;
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · from ${oldName} (old) into ${dbName} · property ${slug} · stays with a night on/after ${from}\n`);

  const report = { notes: [], skipped: [] };
  const created = { guests: [], bookings: [], products: [], sales: [] };
  try {
    await client.query('BEGIN');
    const { rows: [prop] } = await client.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
    if (!prop) throw new Error(`No property "${slug}"`);
    const P = prop.id;
    const user = opt('--user')
      ? (await client.query('SELECT id, name FROM users WHERE email = $1 AND property_id = $2', [opt('--user'), P])).rows[0]
      : (await client.query(`SELECT id, name FROM users WHERE property_id = $1 AND role = 'owner' ORDER BY created_at LIMIT 1`, [P])).rows[0];
    if (!user) throw new Error('No user to record the bookings as made by (--user)');

    // The property's rates: the old prices are what guests paid, tax included.
    const basis = await grossFactor(client, P);
    console.log(`Property: ${prop.name} · tax ${basis.tax_rate}% · service ${basis.service_charge_rate}% · prices ${basis.include ? 'include' : 'EXCLUDE'} tax · made by ${user.name}`);
    if (!basis.include && (basis.tax_rate || basis.service_charge_rate)) {
      console.log('  ⚠ The property enters prices BEFORE tax, but the old prices include it — set "prices include service & tax" first.');
    }

    // Lookups in the new property
    const units = new Map((await client.query('SELECT id, name FROM units WHERE property_id = $1', [P])).rows.map(u => [u.name.trim().toLowerCase(), u.id]));
    const sources = new Set((await client.query('SELECT id FROM booking_sources WHERE property_id = $1', [P])).rows.map(s => s.id));
    const methods = new Set((await client.query('SELECT id FROM payment_methods WHERE property_id = $1', [P])).rows.map(m => m.id));
    const { rows: [ratePlan] } = await client.query(
      'SELECT * FROM rate_plans WHERE property_id = $1 AND is_active ORDER BY is_default DESC, sort_order LIMIT 1', [P]);
    const already = new Set((await client.query(
      `SELECT substring(internal_notes from '${TAG} · ([0-9a-f-]{36})') AS old_id FROM bookings WHERE property_id = $1 AND internal_notes LIKE '${TAG}%'`, [P]))
      .rows.map(r => r.old_id));

    // ── guests ───────────────────────────────────────────────
    const guestMap = new Map();
    const { rows: oldGuests } = await old.query('SELECT * FROM guests ORDER BY created_at');
    let guestsNew = 0, guestsMatched = 0;
    for (const g of oldGuests) {
      const { rows: [hit] } = await client.query(
        `SELECT id FROM guests WHERE property_id = $1 AND lower(trim(name)) = lower(trim($2))
           AND COALESCE(regexp_replace(whatsapp, '\\D', '', 'g'), '') = COALESCE(regexp_replace($3, '\\D', '', 'g'), '') LIMIT 1`,
        [P, g.name, g.whatsapp || null]);
      if (hit) { guestMap.set(g.id, hit.id); guestsMatched++; continue; }
      const { rows: [ng] } = await client.query(
        `INSERT INTO guests (property_id, name, nationality, whatsapp, email, birthday, anniversary, notes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [P, g.name, g.nationality, g.whatsapp, g.email, g.birthday, g.anniversary, g.notes, g.created_at]);
      guestMap.set(g.id, ng.id); created.guests.push(ng.id); guestsNew++;
    }
    console.log(`Guests: ${oldGuests.length} in the old app → ${guestsNew} new, ${guestsMatched} already here`);

    // ── bookings ─────────────────────────────────────────────
    const { rows: oldBookings } = await old.query(
      `SELECT b.*, u.name AS unit_name, g.name AS guest_name
         FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
        WHERE b.check_out_date > $1::date ORDER BY b.check_in_date, u.name`, [from]);
    const bookingMap = new Map();
    const counts = {};
    for (const ob of oldBookings) {
      const label = `${ymd(ob.check_in_date)} ${ob.unit_name} ${ob.guest_name}`;
      if (already.has(ob.id)) { report.skipped.push(`${label} — imported before`); continue; }
      const unitId = units.get(ob.unit_name.trim().toLowerCase());
      if (!unitId) { report.skipped.push(`${label} — no room "${ob.unit_name}" in the new property`); continue; }
      const source = sourceMap[ob.source] || ob.source;
      if (!sources.has(source)) { report.skipped.push(`${label} — no source "${source}" in the new property`); continue; }

      // The price as the guest paid it (before discount). A price typed in
      // thousands by mistake (346,97 for 346.970) is put right from the
      // money actually received.
      let total = num(ob.total_amount);
      const { rows: [recv] } = await old.query(`SELECT COALESCE(SUM(amount), 0) s FROM payments WHERE booking_id = $1 AND status = 'received'`, [ob.id]);
      if (total > 0 && total < 1000 && Math.abs(num(recv.s) - total * 1000) < 1) {
        report.notes.push(`${label}: price ${rp(total)} in the old app — a typing slip; imported as ${rp(total * 1000)} (= the money received)`);
        total = total * 1000;
      }
      const discount = ob.discount_type === 'percentage' && num(ob.discount_value) === 100 ? total : num(ob.discount_amount);
      const nights = Math.max(1, Math.round((new Date(ymd(ob.check_out_date)) - new Date(ymd(ob.check_in_date))) / 86400000));
      const { roomNet, mealNet } = splitRevenue({
        grossNet: round2(total - discount), nights, ratePlan, numGuests: ob.num_guests || 1, F: basis.F,
        divisor: basis.divisor, tax_rate: basis.tax_rate, service_charge_rate: basis.service_charge_rate,
      });
      const stamp = ob.status === 'checked_out';
      const notes = `${TAG} · ${ob.id}${ob.internal_notes ? ` · ${ob.internal_notes}` : ''}`;
      const { rows: [nb] } = await client.query(
        `INSERT INTO bookings (property_id, guest_id, unit_id, check_in_date, check_out_date, num_guests, source, status,
                               total_amount, special_requests, internal_notes, created_by, created_at, updated_at,
                               deposit_amount, discount_type, discount_value, discount_amount, rate_plan_id,
                               room_revenue, fnb_revenue, bill_tax_rate, bill_service_charge_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
        [P, guestMap.get(ob.guest_id), unitId, ymd(ob.check_in_date), ymd(ob.check_out_date), ob.num_guests || 1, source, ob.status,
         total, ob.special_requests, notes, user.id, ob.created_at,
         num(ob.deposit_amount), ob.discount_type || null, ob.discount_value, discount, ratePlan?.id || null,
         roomNet, mealNet, stamp ? basis.tax_rate : null, stamp ? basis.service_charge_rate : null]);
      bookingMap.set(ob.id, nb);
      created.bookings.push(nb.id);
      if (discount >= total && total > 0) report.notes.push(`${label}: free stay in the old app (100% discount) — imported the same way, revenue 0`);

      // payments, with the day they were received
      const { rows: pays } = await old.query('SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at', [ob.id]);
      let paid = 0, pending = 0;
      for (const p of pays) {
        let method = p.method || null;
        if (method && !methods.has(method)) { report.notes.push(`${label}: payment method "${method}" not in the new property — saved as is`); }
        const { rows: [np] } = await client.query(
          `INSERT INTO payments (booking_id, type, amount, status, method, received_at, notes, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [nb.id, p.type, num(p.amount), p.status, method, p.received_at, p.notes, p.created_at]);
        if (p.status === 'received') {
          // recorded_at would be "now" (trigger) — it is when the old app received it
          await client.query('UPDATE payments SET recorded_at = $2 WHERE id = $1', [np.id, p.received_at || p.created_at]);
          paid += num(p.amount);
        } else pending += num(p.amount);
      }
      if (ob.status === 'checked_out' && pending > 0) {
        report.notes.push(`${label}: checked out with ${rp(pending)} still pending in the old app (${source}) — kept pending`);
      }
      if (['cancelled', 'no_show'].includes(ob.status) && paid > 0) {
        report.notes.push(`${label}: ${ob.status.replace('_', '-')} with ${rp(paid)} received — kept (refund or keep, as in the old app)`);
      }

      // check-in / check-out record
      const { rows: [ci] } = await old.query('SELECT * FROM checkin_records WHERE booking_id = $1 ORDER BY checkin_time LIMIT 1', [ob.id]);
      if (ci) {
        await client.query(
          `INSERT INTO checkin_records (booking_id, checkin_time, checkout_time, id_captured, checklist_data, condition_notes)
           VALUES ($1,$2,$3,$4,$5,$6)`, [nb.id, ci.checkin_time, ci.checkout_time, ci.id_captured, ci.checklist_data, ci.condition_notes]);
      }

      // the room nights on the folio of a checked-out stay
      if (ob.status === 'checked_out') await postStay(client, nb, { actorUserId: user.id });

      await client.query('INSERT INTO booking_events (booking_id, note, created_by, created_at) VALUES ($1, $2, $3, $4)',
        [nb.id, `Imported from the old app (booking made ${ymd(ob.created_at)})`, user.id, ob.created_at]);
      counts[ob.status] = (counts[ob.status] || 0) + 1;
    }

    // ── extras sold ──────────────────────────────────────────
    const { rows: oldSales } = await old.query(
      `SELECT s.* FROM sales s WHERE s.created_at >= $1::date AND (s.booking_id IS NULL OR s.booking_id = ANY($2::uuid[])) ORDER BY s.created_at`,
      [from, [...bookingMap.keys()]]);
    const productIds = new Map();
    for (const s of oldSales) {
      const nb = s.booking_id ? bookingMap.get(s.booking_id) : null;
      const { rows: items } = await old.query(
        `SELECT si.*, p.name, p.category, p.price FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = $1`, [s.id]);
      if (!items.length) continue;
      let net = 0;
      const lines = [];
      for (const it of items) {
        let pid = productIds.get(it.name);
        if (!pid) {
          const { rows: [hit] } = await client.query('SELECT id FROM products WHERE property_id = $1 AND lower(name) = lower($2) LIMIT 1', [P, it.name]);
          if (hit) pid = hit.id;
          else {
            const category = ['food', 'drinks', 'transport', 'laundry', 'merchandise', 'room_addon', 'service', 'other'].includes(it.category) ? it.category : 'service';
            const { rows: [np] } = await client.query(
              `INSERT INTO products (name, category, price, property_id, is_available) VALUES ($1,$2,$3,$4,true) RETURNING id`,
              [it.name, category, num(it.price), P]);
            pid = np.id; created.products.push(pid);
          }
          productIds.set(it.name, pid);
        }
        // the old price is what the guest paid (tax included) → NET
        const unitNet = round2(num(it.unit_price) / basis.divisor);
        const subNet = round2(num(it.subtotal) / basis.divisor);
        net += subNet;
        lines.push({ pid, qty: it.quantity, unitNet, subNet, name: it.name });
      }
      const method = s.payment_method === 'room_charge' && nb ? 'room_charge' : (s.payment_method === 'room_charge' ? 'cash' : s.payment_method);
      const { rows: [ns] } = await client.query(
        `INSERT INTO sales (booking_id, payment_method, total_amount, served_by, property_id, order_type, created_at, shown_total)
         VALUES ($1,$2,$3,$4,$5,'takeaway',$6,$7) RETURNING id`,
        [nb?.id || null, method, round2(net), user.id, P, s.created_at, basis.include ? num(s.total_amount) : null]);
      created.sales.push(ns.id);
      for (const l of lines) {
        await client.query(`INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES ($1,$2,$3,$4,$5)`,
          [ns.id, l.pid, l.qty, l.unitNet, l.subNet]);
      }
      if (method === 'room_charge' && nb) {
        await client.query(
          `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, posted_by, sale_id, posted_at, created_at)
           VALUES ($1,'sale',$2,1,$3,$3,$4,$5,$6,$6)`,
          [nb.id, lines.map(l => `${l.qty}× ${l.name}`).join(', '), round2(net), user.id, ns.id, s.created_at]);
      }
      if (method !== 'room_charge') report.notes.push(`Sale ${ymd(s.created_at)} ${rp(s.total_amount)} paid ${method} — no payment row in the old app, counted as paid directly`);
    }

    // ── report ───────────────────────────────────────────────
    console.log(`Bookings: ${created.bookings.length} imported (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')})`);
    console.log(`Extras: ${created.sales.length} sale(s)${created.products.length ? `, ${created.products.length} new item(s) in Sales → Items` : ''}`);
    if (report.skipped.length) { console.log(`\nNot imported (${report.skipped.length}):`); report.skipped.forEach(s => console.log('  ' + s)); }
    if (report.notes.length) { console.log(`\nTo know (${report.notes.length}):`); report.notes.forEach(s => console.log('  • ' + s)); }

    // Revenue per month after the import, as Reports will show it
    const months = [];
    for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(); d.setUTCMonth(d.getUTCMonth() + 1)) {
      const a = d.toISOString().slice(0, 7) + '-01';
      const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      months.push([a, e]);
    }
    console.log('\nReports after the import (net = before tax):');
    for (const [a, e] of months) {
      const { rows: [r] } = await client.query(
        `SELECT COALESCE(SUM(b.room_revenue / b.nights * GREATEST(0, LEAST(b.check_out_date, $3::date + 1) - GREATEST(b.check_in_date, $2::date))), 0) room,
                COUNT(*) FILTER (WHERE b.check_in_date BETWEEN $2 AND $3) arrivals
           FROM bookings b WHERE b.property_id = $1 AND b.status NOT IN ('cancelled','no_show')
            AND b.check_in_date <= $3 AND b.check_out_date > $2`, [P, a, e]);
      const { rows: [x] } = await client.query(
        `SELECT COALESCE(SUM(total_amount), 0) s FROM sales WHERE property_id = $1 AND (created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2 AND $3`, [P, a, e]);
      console.log(`  ${a.slice(0, 7)}: rooms ${rp(r.room)} · extras ${rp(x.s)} · ${r.arrivals} arrival(s)`);
    }

    if (APPLY) {
      await client.query('COMMIT');
      const dir = path.join(__dirname, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const runFile = path.join(dir, `old-pms-import-${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(runFile, JSON.stringify({ tag: TAG, property: slug, property_id: P, at: new Date().toISOString(), from, created }, null, 2));
      console.log(`\nAPPLIED. Run file (for --undo): ${path.relative(process.cwd(), runFile)}`);
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — nothing saved. Add --apply to import.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await old.end();
  }
}

// ── undo ──────────────────────────────────────────────────────────────────
// Removes what the run made. A booking changed since (a payment, charge or
// note added after the import, or its status changed) is kept and listed.
async function undo(runFile) {
  const r = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · undo ${r.tag} for ${r.property} (${r.created.bookings.length} bookings)\n`);
  const at = new Date(new Date(r.at).getTime() + 60000);   // anything after the run (+1 min) = a change since
  const client = await db.pool.connect();
  let removed = 0; const kept = [];
  try {
    await client.query('BEGIN');
    for (const id of r.created.sales) {
      await client.query('DELETE FROM folio_charges WHERE sale_id = $1', [id]);
      await client.query('DELETE FROM sale_items WHERE sale_id = $1', [id]);
      await client.query('DELETE FROM sales WHERE id = $1 AND property_id = $2', [id, r.property_id]);
    }
    for (const id of r.created.bookings) {
      const { rows: [b] } = await client.query(`
        SELECT b.id, u.name room, g.name guest, b.updated_at > $2 AS changed,
               EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.created_at > $2) AS paid,
               EXISTS (SELECT 1 FROM folio_charges f WHERE f.booking_id = b.id AND f.created_at > $2) AS charged,
               EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id AND e.created_at > $2) AS noted
        FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
        WHERE b.id = $1 AND b.property_id = $3`, [id, at, r.property_id]);
      if (!b) continue;
      if (b.changed || b.paid || b.charged || b.noted) { kept.push(`${b.room} ${b.guest}`); continue; }
      for (const t of ['booking_events', 'payments', 'folio_charges', 'checkin_records', 'booking_night_rates']) {
        await client.query(`DELETE FROM ${t} WHERE booking_id = $1`, [id]);
      }
      await client.query('DELETE FROM bookings WHERE id = $1', [id]);
      removed++;
    }
    let guests = 0;
    for (const id of r.created.guests) {
      const { rowCount } = await client.query(`DELETE FROM guests WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM bookings WHERE guest_id = $1)`, [id]);
      guests += rowCount;
    }
    for (const id of r.created.products) {
      await client.query('DELETE FROM products WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM sale_items WHERE product_id = $1)', [id]);
    }
    console.log(`Removed: ${removed} bookings, ${guests} guests, ${r.created.sales.length} sales.`);
    if (kept.length) { console.log(`Kept — changed since the import (${kept.length}):`); kept.forEach(k => console.log('  ' + k)); }
    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
    console.log(APPLY ? 'Done.' : '\nDRY RUN — nothing removed. Add --apply to remove.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

(opt('--undo') ? undo(opt('--undo')) : run())
  .then(() => db.pool.end())
  .catch(err => { console.error('FAILED:', err.message); db.pool.end(); process.exit(1); });
