// One-off (2026-10-16): groups set up as "one bill for the group" (group
// billing, migration 097) whose agent has since been switched to "bill to
// agent" (city ledger). At check-out such a room went onto the agent's
// statement AND stayed on the group's bill — owed twice. A group made today
// under a billed agent is billed room by room to the agent instead; this
// script puts the existing ones the same way.
//
// For each such group (not cancelled, no room checked out yet):
//   1. every received group payment is moved onto the group's rooms, room by
//      room in room order (each room up to its price), as received room
//      deposits with the same amount, method, received date, who took it,
//      when it was recorded, reference and notes — so the Daily Close and
//      Cashier Closing of that day don't change; the group payment is voided
//      ("moved to the rooms"), never deleted;
//   2. each room gets its unpaid rest as a pending balance line, like a room
//      booked under a billed agent (price − what it received);
//   3. the group is switched to billing room by room, each room's status is
//      worked out from its own payments, and every room's Edit History gets a
//      note.
// The money doesn't change: per group, room payments after = group payments
// before; every room's lines add up to its price (checked; the group is
// rolled back otherwise).
//
// Left alone and listed: a group with a room already checked out (look at it
// by hand — it may already be on the agent's bill), a group with a refund or
// more received than its rooms' price.
//
// Everything changed is saved to a backup file first (server/maintenance/backups/).
//
// Usage (from server/):
//   node maintenance/groupBillingToAgent.js                 dry run — shows what would change
//   node maintenance/groupBillingToAgent.js --apply         does it (writes a backup file first)
//   ... --property zahill                                   one property only (slug)
//   ... --group "Waldinger"                                 one group only (its id, or part of the booker's name)
// Safe to run more than once (a group already switched is not found again).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { CITY_LEDGER } = require('../services/agentBillingService');
const { recomputeBookingStatus } = require('../services/paymentStatusService');

const APPLY = process.argv.includes('--apply');
const opt = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const PROPERTY = opt('--property');
const GROUP = opt('--group');

const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const ACTIVE = b => !['cancelled', 'no_show'].includes(b.status);
const day = v => (v ? new Date(v).toLocaleDateString('en-CA', { timeZone: 'Asia/Makassar' }) : 'no date');

async function run() {
  const { rows: properties } = await db.query(
    `SELECT id, slug, name FROM properties ${PROPERTY ? 'WHERE slug = $1' : ''} ORDER BY name`, PROPERTY ? [PROPERTY] : []);
  if (!properties.length) { console.log(PROPERTY ? `No property with slug "${PROPERTY}"` : 'No properties'); return; }
  console.log(`Database: ${(process.env.DATABASE_URL || '').replace(/\/\/[^@]*@/, '//…@')}`);
  console.log(APPLY ? '=== APPLY ===\n' : '=== DRY RUN — nothing is changed. Run again with --apply to do it. ===\n');

  const backup = [];
  const backupFile = path.join(__dirname, 'backups', `groupBillingToAgent-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const totals = { groups: 0, payments: 0, amount: 0, skipped: 0, failed: 0 };

  for (const p of properties) {
    const { rows: groups } = await db.query(
      `SELECT rg.*, g.name AS booker FROM reservation_groups rg JOIN guests g ON g.id = rg.primary_guest_id
       WHERE rg.property_id = $1 AND rg.group_billing AND rg.status <> 'cancelled'
         AND EXISTS (SELECT 1 FROM bookings b JOIN agents a ON a.id = b.agent_id
                     WHERE b.reservation_group_id = rg.id AND b.status NOT IN ('cancelled', 'no_show')
                       AND a.payment_status = ANY($2))
         AND ($3::text IS NULL OR rg.id::text = $3 OR g.name ILIKE '%' || $3 || '%')
       ORDER BY rg.check_in_date`, [p.id, CITY_LEDGER, GROUP]);
    console.log(`── ${p.name} (${p.slug}) — ${groups.length} group${groups.length === 1 ? '' : 's'} billed as a whole under a billed agent ──`);

    for (const g of groups) {
      const { rows: rooms } = await db.query(
        `SELECT b.id, b.status, b.total_amount, b.discount_amount, b.deposit_amount, b.folio_status, u.name AS unit_name, ag.name AS agent_name
         FROM bookings b JOIN units u ON u.id = b.unit_id LEFT JOIN agents ag ON ag.id = b.agent_id
         WHERE b.reservation_group_id = $1 ORDER BY u.name`, [g.id]);
      const { rows: gps } = await db.query(
        'SELECT * FROM group_payments WHERE group_id = $1 AND NOT is_voided ORDER BY received_at, created_at', [g.id]);
      const { rows: [lineCount] } = await db.query(
        "SELECT count(*)::int n FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.reservation_group_id = $1 AND p.type IN ('deposit', 'balance')", [g.id]);
      const active = rooms.filter(ACTIVE);
      const price = r => r2(parseFloat(r.total_amount) - parseFloat(r.discount_amount || 0));
      const due = r2(active.reduce((s, r) => s + price(r), 0));
      const received = r2(gps.reduce((s, x) => s + parseFloat(x.amount), 0));
      const agents = [...new Set(active.map(r => r.agent_name).filter(Boolean))].join(', ');
      const label = `${g.booker} · ${day(g.check_in_date)} · ${agents} · ${active.length} room${active.length === 1 ? '' : 's'} (${active.map(r => r.unit_name).join(', ')})`;

      const why = active.some(r => r.status === 'checked_out' || r.folio_status) ? 'a room is already checked out / on the agent\'s bill — look at it by hand'
        : gps.some(x => x.is_refund || parseFloat(x.amount) < 0) ? 'it has a refund — look at it by hand'
        : received > due + 0.05 ? `more received (${rp(received)}) than the rooms' price (${rp(due)}) — look at it by hand`
        : lineCount.n > 0 ? 'its rooms already have payment lines — look at it by hand'
        : !active.length ? 'no active room' : null;
      if (why) { totals.skipped++; console.log(`   – skip ${label}\n       ${why}`); continue; }

      // Spread each group payment over the rooms, room by room in room order.
      const left = new Map(active.map(r => [r.id, price(r)]));
      const moves = [];   // { gp, room, amount }
      for (const gp of gps) {
        let amt = r2(parseFloat(gp.amount));
        for (const r of active) {
          if (amt <= 0.004) break;
          const take = r2(Math.min(amt, left.get(r.id)));
          if (take <= 0.004) continue;
          moves.push({ gp, room: r, amount: take });
          left.set(r.id, r2(left.get(r.id) - take));
          amt = r2(amt - take);
        }
      }

      console.log(`   • ${label}`);
      console.log(`       rooms' price ${rp(due)} · received by the group ${rp(received)} · still owed ${rp(due - received)} (now by the agent, room by room)`);
      for (const gp of gps) {
        const parts = moves.filter(m => m.gp === gp).map(m => `room ${m.room.unit_name} ${rp(m.amount)}`).join(' + ');
        console.log(`       group payment ${rp(gp.amount)} · ${gp.method} · ${day(gp.received_at)}${gp.reference ? ` · ref ${gp.reference}` : ''} → ${parts}`);
      }
      console.log(`       each room: a pending balance line for what it still owes${gps.length ? '' : ' (its whole price)'}`);
      if (!APPLY) { totals.groups++; totals.payments += gps.length; totals.amount = r2(totals.amount + received); continue; }

      backup.push({ group_id: g.id, property: p.slug, group: { group_billing: g.group_billing, billing_mode: g.billing_mode, status: g.status },
        rooms: rooms.map(r => ({ booking_id: r.id, unit: r.unit_name, status: r.status, deposit_amount: r.deposit_amount })), group_payments: gps });
      fs.mkdirSync(path.dirname(backupFile), { recursive: true });
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 1));

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: [locked] } = await client.query('SELECT group_billing FROM reservation_groups WHERE id = $1 FOR UPDATE', [g.id]);
        if (!locked.group_billing) { await client.query('ROLLBACK'); console.log('       already switched — skipped'); continue; }
        await client.query("UPDATE reservation_groups SET group_billing = false, updated_at = NOW() WHERE id = $1", [g.id]);

        for (const m of moves) {
          const { gp } = m;
          const notes = [gp.notes, 'moved from the group payment (billed room by room to the agent)'].filter(Boolean).join(' · ');
          const { rows: [pay] } = await client.query(
            `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, reference, notes, created_at)
             VALUES ($1, 'deposit', $2, 'received', $3, $4, $5, $6, $7, $8) RETURNING id`,
            [m.room.id, m.amount, gp.method, gp.received_at, gp.received_by, gp.reference, notes, gp.created_at]);
          // the trigger stamps recorded_at = now on insert — keep when it was really recorded
          await client.query('UPDATE payments SET recorded_at = $2 WHERE id = $1', [pay.id, gp.recorded_at || gp.created_at]);
        }
        for (const r of active) {
          const rest = left.get(r.id);
          if (rest > 0.004) {
            await client.query(
              "INSERT INTO payments (booking_id, type, amount, status, notes) VALUES ($1, 'balance', $2, 'pending', 'Billed to the agent')", [r.id, rest]);
          }
          const paid = r2(price(r) - rest);
          await client.query('UPDATE bookings SET deposit_amount = $2, updated_at = NOW() WHERE id = $1', [r.id, paid]);
        }
        for (const gp of gps) {
          await client.query(
            `UPDATE group_payments SET is_voided = true, voided_at = NOW(), void_reason = $2 WHERE id = $1`,
            [gp.id, `Moved to the rooms — group now billed room by room to the agent (${moves.filter(m => m.gp === gp).map(m => `room ${m.room.unit_name} ${rp(m.amount)}`).join(', ')})`]);
        }
        for (const r of active) await recomputeBookingStatus(client, r.id);

        // The money must not change, and every room's lines = its price.
        const { rows: [chk] } = await client.query(
          `SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'received'), 0) recv
           FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.reservation_group_id = $1 AND p.type IN ('deposit', 'balance')`, [g.id]);
        if (Math.abs(parseFloat(chk.recv) - received) > 0.005) throw new Error(`received ${rp(received)} before but ${rp(chk.recv)} on the rooms after`);
        for (const r of active) {
          const { rows: [s] } = await client.query(
            "SELECT COALESCE(SUM(amount), 0) s FROM payments WHERE booking_id = $1 AND type IN ('deposit', 'balance')", [r.id]);
          if (Math.abs(parseFloat(s.s) - price(r)) > 0.005) throw new Error(`room ${r.unit_name}: lines ${rp(s.s)} ≠ price ${rp(price(r))}`);
        }
        const note = `Group now billed room by room to ${agents || 'the agent'} (was one bill for the group)${received ? `; ${rp(received)} received by the group moved onto the rooms` : ''}.`;
        await client.query(
          'INSERT INTO booking_events (booking_id, note) SELECT id, $2 FROM bookings WHERE reservation_group_id = $1', [g.id, note]);
        await client.query('COMMIT');
        totals.groups++; totals.payments += gps.length; totals.amount = r2(totals.amount + received);
        console.log('       ✓ switched');
      } catch (err) {
        await client.query('ROLLBACK');
        totals.failed++;
        console.log(`       ✗ NOT switched: ${err.message}`);
      } finally {
        client.release();
      }
    }
    console.log('');
  }
  console.log(`${APPLY ? 'Switched' : 'Would switch'} ${totals.groups} group${totals.groups === 1 ? '' : 's'}: ${totals.payments} group payment${totals.payments === 1 ? '' : 's'} (${rp(totals.amount)}) moved onto rooms.${totals.skipped ? ` Skipped ${totals.skipped} — see above.` : ''}${totals.failed ? ` ${totals.failed} FAILED (nothing changed for them) — see above.` : ''}`);
  if (APPLY && backup.length) console.log(`Backup: ${backupFile}`);
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
