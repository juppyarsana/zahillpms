// One-off correction: part of a received room payment belongs to another
// room of the same stay (a guest moved rooms by shortening one booking and
// adding another — the money stayed on the first). Puts it on the room that
// took over the nights, as a received line with the SAME date, method,
// recorder, reference and recorded-at time, so every day's money stays as
// it was.
//
//   --restore  the amount was wrongly REMOVED from the first room already
//              (Edit Price with "received payment was a typo") — the first
//              room is left as it is and the money comes back on the second;
//              money received that day goes UP by the amount, back to what
//              really came in.
//
//   node maintenance/moveRoomPayment.js --property zahill --group "Tim Walker" \
//        --from 203 --to 104 --amount 2850000 [--restore] [--apply]
//
// Dry run unless --apply (runs everything, prints, rolls back). Backup JSON
// of the rows before the change goes to maintenance/backups/.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { recomputeBookingStatus } = require('../services/paymentStatusService');

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const has = (name) => process.argv.includes(name);
const rp = (n) => 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID');

(async () => {
  const slug = arg('--property'), groupName = arg('--group'), fromRoom = arg('--from'), toRoom = arg('--to');
  const amount = Math.round(parseFloat(arg('--amount')) * 100) / 100;
  const restore = has('--restore'), apply = has('--apply');
  if (!slug || !groupName || !fromRoom || !toRoom || !(amount > 0)) {
    console.error('Usage: --property <slug> --group "<booker>" --from <room> --to <room> --amount <n> [--restore] [--apply]');
    process.exit(1);
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: rooms } = await client.query(`
      SELECT b.id, u.name AS room, b.status, b.reservation_group_id,
             (b.total_amount - COALESCE(b.discount_amount, 0))::numeric AS price
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = b.property_id
      JOIN reservation_groups rg ON rg.id = b.reservation_group_id
      JOIN guests g ON g.id = rg.primary_guest_id
      WHERE p.slug = $1 AND g.name ILIKE $2 AND u.name = ANY($3) AND b.status NOT IN ('cancelled', 'no_show')
      FOR UPDATE OF b`, [slug, groupName + '%', [fromRoom, toRoom]]);
    const from = rooms.filter(r => r.room === fromRoom), to = rooms.filter(r => r.room === toRoom);
    if (from.length !== 1 || to.length !== 1) throw new Error(`Expected one booking each for rooms ${fromRoom} and ${toRoom} in group "${groupName}", found ${from.length} / ${to.length}`);
    const [src, dst] = [from[0], to[0]];
    if (src.reservation_group_id !== dst.reservation_group_id) throw new Error('The two rooms are not in the same group');

    const lines = async (id) => (await client.query(
      `SELECT * FROM payments WHERE booking_id = $1 AND type IN ('deposit', 'balance') ORDER BY created_at`, [id])).rows;
    const before = { src: await lines(src.id), dst: await lines(dst.id) };
    const received = before.src.filter(p => p.status === 'received').sort((a, b) => Number(b.amount) - Number(a.amount));
    if (!received.length) throw new Error(`Room ${fromRoom} has no received payment`);
    const source = received[0];
    if (!restore && Number(source.amount) - amount < -0.005) throw new Error(`Room ${fromRoom}'s payment is ${rp(source.amount)} — less than ${rp(amount)}`);
    const pending = before.dst.filter(p => p.status === 'pending');
    const pendingTotal = pending.reduce((s, p) => s + Number(p.amount), 0);
    if (Math.abs(pendingTotal - amount) > 0.005) throw new Error(`Room ${toRoom} has ${rp(pendingTotal)} unpaid, not ${rp(amount)} — check by hand`);

    // 1. The first room keeps the rest (unless the amount was already removed).
    if (!restore) {
      await client.query('UPDATE payments SET amount = amount - $1 WHERE id = $2', [amount, source.id]);
    }
    // 2. The second room's unpaid lines become ONE received line, copied from the source.
    const keep = pending[pending.length - 1];
    for (const p of pending.slice(0, -1)) await client.query('DELETE FROM payments WHERE id = $1', [p.id]);
    const note = `From room ${fromRoom}'s payment of ${new Date(source.received_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'short', year: 'numeric' })} — guest moved rooms`;
    await client.query(`
      UPDATE payments SET amount = $1, status = 'received', method = $2, received_at = $3, received_by = $4,
             reference = $5, notes = $6
      WHERE id = $7`, [amount, source.method, source.received_at, source.received_by, source.reference,
      [source.notes, note].filter(Boolean).join(' · '), keep.id]);
    // The trigger stamped recorded_at = now; put the original back (status
    // unchanged now, so the trigger leaves it).
    await client.query('UPDATE payments SET recorded_at = $1 WHERE id = $2', [source.recorded_at, keep.id]);

    await recomputeBookingStatus(client, src.id);
    await recomputeBookingStatus(client, dst.id);

    const what = restore
      ? `${rp(amount)} of the payment received on room ${fromRoom} (removed from it by mistake with Edit Price) put on room ${toRoom}`
      : `${rp(amount)} of room ${fromRoom}'s payment moved to room ${toRoom}`;
    await client.query(`INSERT INTO booking_events (booking_id, note) VALUES ($1, $2), ($3, $4)`, [
      src.id, `Payment corrected: ${what} — the guest moved to room ${toRoom} for the rest of the stay.`,
      dst.id, `Payment corrected: ${what} — the guest moved here from room ${fromRoom}.`,
    ]);

    const after = { src: await lines(src.id), dst: await lines(dst.id) };
    const { rows: st } = await client.query('SELECT id, status FROM bookings WHERE id = ANY($1)', [[src.id, dst.id]]);
    const show = (label, b, ls) => {
      const recv = ls.filter(p => p.status === 'received').reduce((s, p) => s + Number(p.amount), 0);
      const pend = ls.filter(p => p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0);
      console.log(`  room ${b.room} (${label}) price ${rp(b.price)} · received ${rp(recv)} · unpaid ${rp(pend)} · status ${st.find(s => s.id === b.id).status}`);
    };
    console.log(`${apply ? 'APPLIED' : 'DRY RUN'} — ${what}`);
    show('from', src, after.src);
    show('to', dst, after.dst);
    console.log(`  money received that day: ${restore ? '+' + rp(amount) + ' (back to what really came in)' : 'unchanged'}`);

    if (apply) {
      const dir = path.join(__dirname, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `moveRoomPayment-${slug}-${fromRoom}-${toRoom}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(file, JSON.stringify({ args: process.argv.slice(2), before }, null, 2));
      await client.query('COMMIT');
      console.log('  backup: ' + file);
    } else {
      await client.query('ROLLBACK');
      console.log('  (nothing saved — add --apply)');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('✗ ' + err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit();
  }
})();
