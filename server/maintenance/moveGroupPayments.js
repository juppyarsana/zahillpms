// One-off, after migration 097 (group billing): move every existing group
// booking onto group billing — one bill and one payment record per group,
// as the accountant asked.
//
// For each group still paid room by room (reservation_groups.group_billing =
// false):
//   1. every RECEIVED room deposit / balance payment of its rooms (cancelled
//      rooms too — that money now counts for the group instead of sitting on
//      a cancelled room) becomes a group payment with the same amount,
//      method, received date, who took it, reference and notes
//      (group_payments.legacy_payment_id = the old row);
//   2. the rooms' deposit / balance lines (received and still pending) are
//      removed and bookings.deposit_amount set to 0 — what's owed is now the
//      group's bill minus the group's payments;
//   3. the group switches to group billing, "Group pays: room & meal plan"
//      (change it on the group page if the group pays everything);
//   4. the rooms not arrived yet get the group's status (pending / deposit
//      paid / confirmed) and every room's Edit History gets a note.
// Extras paid at the desk ('incidental' payments) stay on their room.
// The money doesn't change: per group the total received before = after
// (checked, the group is rolled back otherwise).
//
// Skipped (left paid room by room): a group with a room billed to a
// city-ledger agent or already on the agent's bill (folio_status set) —
// those keep per-room agent billing, as new groups do.
//
// Every removed payment row is saved to a backup file first
// (server/maintenance/backups/, gitignored).
//
// Usage (from server/):
//   node maintenance/moveGroupPayments.js                 dry run — shows what would change
//   node maintenance/moveGroupPayments.js --apply         does it (writes a backup file first)
//   ... --property zahill                                 one property only (slug)
//   ... --group "Lia Etika"                               one group only (its id, or part of the booker's name)
//   ... --no-merge                                        keep same-day lines recorded before 093 as separate payments
// Safe to run more than once (a group already moved is skipped).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { CITY_LEDGER } = require('../services/agentBillingService');
const { recomputeGroupStatus } = require('../services/paymentStatusService');

const APPLY = process.argv.includes('--apply');
const propIdx = process.argv.indexOf('--property');
const PROPERTY = propIdx > -1 ? process.argv[propIdx + 1] : null;
const grpIdx = process.argv.indexOf('--group');
const GROUP = grpIdx > -1 ? process.argv[grpIdx + 1] : null;
const MERGE_DAY = !process.argv.includes('--no-merge');

const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const ACTIVE = b => !['cancelled', 'no_show'].includes(b.status);
// Same rule as paymentStatusService.recomputeGroupStatus, for the dry run.
function groupStatus(due, received, deposit) {
  const depositOk = deposit > 0 ? received >= deposit - 0.05 : (received > 0.05 || due <= 0.05);
  const balanceOk = received >= due - 0.05;
  return depositOk && balanceOk ? 'confirmed' : depositOk ? 'deposit_paid' : 'pending';
}

async function run() {
  const { rows: properties } = await db.query(
    `SELECT id, slug, name FROM properties ${PROPERTY ? 'WHERE slug = $1' : ''} ORDER BY name`, PROPERTY ? [PROPERTY] : []);
  if (!properties.length) { console.log(PROPERTY ? `No property with slug "${PROPERTY}"` : 'No properties'); return; }
  console.log(APPLY ? '=== APPLY ===\n' : '=== DRY RUN — nothing is changed. Run again with --apply to do it. ===\n');

  const backup = [];
  const backupFile = path.join(__dirname, 'backups', `moveGroupPayments-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const totals = { groups: 0, moved: 0, amount: 0, skipped: 0, failed: 0 };

  for (const p of properties) {
    const { rows: groups } = await db.query(
      `SELECT rg.*, g.name AS booker FROM reservation_groups rg JOIN guests g ON g.id = rg.primary_guest_id
       WHERE rg.property_id = $1 AND NOT rg.group_billing
         AND ($2::text IS NULL OR rg.id::text = $2 OR g.name ILIKE '%' || $2 || '%')
       ORDER BY rg.check_in_date`, [p.id, GROUP]);
    console.log(`── ${p.name} (${p.slug}) — ${groups.length} group${groups.length === 1 ? '' : 's'} paid room by room ──`);
    for (const g of groups) {
      const { rows: rooms } = await db.query(
        `SELECT b.id, b.status, b.total_amount, b.discount_amount, b.deposit_amount, b.folio_status, u.name AS unit_name,
                ag.payment_status AS agent_payment_status, ag.name AS agent_name
         FROM bookings b JOIN units u ON u.id = b.unit_id LEFT JOIN agents ag ON ag.id = b.agent_id
         WHERE b.reservation_group_id = $1 ORDER BY u.name`, [g.id]);
      const { rows: lines } = await db.query(
        `SELECT p.* FROM payments p JOIN bookings b ON b.id = p.booking_id
         WHERE b.reservation_group_id = $1 AND p.type IN ('deposit', 'balance') ORDER BY p.received_at NULLS LAST, p.created_at`, [g.id]);
      const label = `${g.booker} · ${String(g.check_in_date.toISOString?.() || g.check_in_date).slice(0, 10)} · ${rooms.length} room${rooms.length === 1 ? '' : 's'} (${rooms.map(r => r.unit_name).join(', ')})${g.status === 'cancelled' ? ' · CANCELLED' : ''}`;

      const agentRoom = rooms.find(r => CITY_LEDGER.includes(r.agent_payment_status) || r.folio_status);
      if (agentRoom) {
        totals.skipped++;
        console.log(`   – skip ${label}\n       billed to ${agentRoom.agent_name || 'an agent'} — stays paid room by room`);
        continue;
      }

      const byRoom = new Map(rooms.map(r => [r.id, r]));
      const received = lines.filter(l => l.status === 'received' && parseFloat(l.amount) > 0);
      // One transfer the old screens spread over several rooms → ONE group
      // payment again. Recorded with a time (migration 093 on): lines of the
      // same recorded instant, method, person and reference. Recorded before
      // that (no time): lines of the same received day (property time),
      // method, person and reference — unless --no-merge. Only rows are
      // combined; the amounts, the group's bill and balance stay the same.
      const txns = [];
      const byKey = new Map();
      const day = v => new Date(v).toLocaleDateString('en-CA', { timeZone: 'Asia/Makassar' });
      for (const l of received) {
        const who = `${l.method}|${l.received_by || ''}|${l.reference || ''}`;
        const key = l.recorded_at ? `t:${new Date(l.recorded_at).toISOString()}|${who}`
          : MERGE_DAY && l.received_at ? `d:${day(l.received_at)}|${who}` : null;
        let t = key && byKey.get(key);
        if (!t) { t = { lines: [], amount: 0 }; txns.push(t); if (key) byKey.set(key, t); }
        t.lines.push(l);
        t.amount = r2(t.amount + parseFloat(l.amount));
      }
      const pending = lines.filter(l => l.status !== 'received');
      const active = rooms.filter(ACTIVE);
      const due = r2(active.reduce((s, r) => s + parseFloat(r.total_amount) - parseFloat(r.discount_amount || 0), 0));
      const recvActive = r2(received.filter(l => ACTIVE(byRoom.get(l.booking_id))).reduce((s, l) => s + parseFloat(l.amount), 0));
      const recvCancelled = r2(received.filter(l => !ACTIVE(byRoom.get(l.booking_id))).reduce((s, l) => s + parseFloat(l.amount), 0));
      const recvAll = r2(recvActive + recvCancelled);
      const deposit = Math.min(parseFloat(g.group_deposit_amount || 0), due);
      const newStatus = groupStatus(due, recvAll, deposit);
      const changes = active.filter(r => ['pending', 'deposit_paid', 'confirmed'].includes(r.status) && r.status !== newStatus);

      console.log(`   • ${label}`);
      console.log(`       rooms' price ${rp(due)} · received ${rp(recvActive)}${recvCancelled > 0 ? ` + ${rp(recvCancelled)} on cancelled rooms (now counts for the group)` : ''}`);
      console.log(`       balance before ${rp(due - recvActive)} → after ${rp(due - recvAll)}${due - recvAll < -0.5 ? ' (CREDIT — refund or keep for the group)' : ''}`);
      console.log(`       ${received.length} room payment line${received.length === 1 ? '' : 's'} → ${txns.length} group payment${txns.length === 1 ? '' : 's'}; ${pending.length} unpaid line${pending.length === 1 ? '' : 's'} removed${deposit > 0 ? ` · group deposit ${rp(deposit)}` : ''}`);
      for (const t of txns) {
        const l = t.lines[0];
        const parts = t.lines.map(x => `${byRoom.get(x.booking_id).unit_name} ${x.type}${t.lines.length > 1 ? ` ${rp(x.amount)}` : ''}`).join(' + ');
        console.log(`         ${rp(t.amount)} · ${l.method || '?'} · ${l.received_at ? new Date(l.received_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Makassar' }) : 'no date'}${l.reference ? ` · ref ${l.reference}` : ''} — was ${parts}`);
      }
      if (changes.length) console.log(`       status: ${changes.map(r => `${r.unit_name} ${r.status} → ${newStatus}`).join(', ')}`);
      if (!APPLY) { totals.groups++; totals.moved += txns.length; totals.amount = r2(totals.amount + recvAll); continue; }
      // Backup first (the rows as they are now), then the change.
      backup.push({ group_id: g.id, property: p.slug, rooms: rooms.map(r => ({ booking_id: r.id, unit: r.unit_name, deposit_amount: r.deposit_amount, status: r.status })), payments: lines });
      fs.mkdirSync(path.dirname(backupFile), { recursive: true });
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 1));
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: [locked] } = await client.query('SELECT group_billing FROM reservation_groups WHERE id = $1 FOR UPDATE', [g.id]);
        if (locked.group_billing) { await client.query('ROLLBACK'); console.log('       already moved — skipped'); continue; }
        for (const t of txns) {
          const l = t.lines[0];
          const notes = [...new Set(t.lines.map(x => x.notes).filter(Boolean))];
          notes.push(`moved from ${t.lines.map(x => `room ${byRoom.get(x.booking_id).unit_name} ${x.type}`).join(', ')}`);
          await client.query(
            `INSERT INTO group_payments (property_id, group_id, amount, method, received_at, received_by, recorded_at, reference, notes, legacy_payment_id, created_at)
             VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, $6::timestamptz, $7::timestamptz), $8, $6::timestamptz, $9, $10, $11, $7::timestamptz)`,
            [p.id, g.id, t.amount, l.method || 'other', l.received_at, l.recorded_at, l.created_at, l.received_by,
             l.reference, notes.join(' · '), l.id]);
        }
        await client.query('DELETE FROM payments WHERE id = ANY($1)', [lines.map(l => l.id)]);
        await client.query('UPDATE bookings SET deposit_amount = 0, updated_at = NOW() WHERE reservation_group_id = $1', [g.id]);
        await client.query("UPDATE reservation_groups SET group_billing = true, billing_mode = 'room_meals', updated_at = NOW() WHERE id = $1", [g.id]);
        await recomputeGroupStatus(client, g.id);
        // the money must not change
        const { rows: [chk] } = await client.query(
          'SELECT COALESCE(SUM(amount), 0) AS s FROM group_payments WHERE group_id = $1 AND NOT is_voided', [g.id]);
        if (Math.abs(parseFloat(chk.s) - recvAll) > 0.005) throw new Error(`received ${rp(recvAll)} before but ${rp(chk.s)} after`);
        const note = `Group billing on: ${received.length ? `${rp(recvAll)} received on the rooms moved to the group (${txns.length} payment${txns.length === 1 ? '' : 's'})` : 'nothing received yet'}; payments are now recorded on the group. Group pays room & meal plan.`;
        await client.query(
          'INSERT INTO booking_events (booking_id, note) SELECT id, $2 FROM bookings WHERE reservation_group_id = $1', [g.id, note]);
        await client.query('COMMIT');
        totals.groups++; totals.moved += txns.length; totals.amount = r2(totals.amount + recvAll);
        console.log('       ✓ moved');
      } catch (err) {
        await client.query('ROLLBACK');
        totals.failed++;
        console.log(`       ✗ NOT moved: ${err.message}`);
      } finally {
        client.release();
      }
    }
    console.log('');
  }
  console.log(`${APPLY ? 'Moved' : 'Would move'} ${totals.groups} group${totals.groups === 1 ? '' : 's'}: ${totals.moved} payment${totals.moved === 1 ? '' : 's'}, ${rp(totals.amount)}.${totals.skipped ? ` Skipped ${totals.skipped} (agent-billed).` : ''}${totals.failed ? ` ${totals.failed} FAILED (nothing changed for them) — see above.` : ''}`);
  if (APPLY && backup.length) console.log(`Backup: ${backupFile}`);
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
