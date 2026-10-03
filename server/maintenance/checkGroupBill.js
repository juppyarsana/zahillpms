// Read-only: one group's bill, room by room and line by line — for "why is
// the balance not a round number" and to see what the group billing move
// (moveGroupPayments.js) will make of it. Changes nothing.
//
// Usage (from server/):
//   node maintenance/checkGroupBill.js --property zahill --group <group id, or part of the booker's name>
require('dotenv').config();
const db = require('../db');
const { computeProforma, chargeTotals } = require('../services/folioService');

const arg = name => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const rp = n => 'Rp ' + (Math.round(Number(n) * 100) / 100).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const cents = n => Math.abs(Number(n) - Math.round(Number(n))) > 0.004;

async function run() {
  const slug = arg('--property'), q = arg('--group');
  if (!slug || !q) { console.log('Usage: node maintenance/checkGroupBill.js --property <slug> --group <group id or booker name>'); return; }
  const { rows: [p] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
  if (!p) { console.log(`No property "${slug}"`); return; }
  const { rows: groups } = await db.query(
    `SELECT rg.id, rg.group_billing, rg.billing_mode, g.name AS booker, to_char(rg.check_in_date, 'YYYY-MM-DD') AS ci
     FROM reservation_groups rg JOIN guests g ON g.id = rg.primary_guest_id
     WHERE rg.property_id = $1 AND (rg.id::text = $2 OR g.name ILIKE '%' || $2 || '%') ORDER BY rg.check_in_date DESC`, [p.id, q]);
  if (!groups.length) { console.log('No group found'); return; }
  if (groups.length > 1 && !groups.some(g => g.id === q)) {
    console.log('More than one group matches — run again with --group <id>:');
    for (const g of groups) console.log(`  ${g.id}  ${g.booker} · ${g.ci}`);
    return;
  }
  const g = groups.find(x => x.id === q) || groups[0];
  const { rows: rooms } = await db.query(
    `SELECT b.id, u.name, b.status, b.total_amount, b.discount_amount, b.bill_tax_rate, b.bill_service_charge_rate
     FROM bookings b JOIN units u ON u.id = b.unit_id
     WHERE b.reservation_group_id = $1 AND b.status NOT IN ('cancelled', 'no_show') ORDER BY u.name`, [g.id]);
  console.log(`${g.booker} · ${g.ci} · ${rooms.length} rooms · ${g.group_billing ? `billed as a group (${g.billing_mode})` : 'paid room by room (not moved yet)'}\n`);

  let roomSum = 0, extraSum = 0, totalSum = 0;
  for (const r of rooms) {
    const f = await computeProforma(r.id, p.id);
    const booked = parseFloat(r.total_amount) - parseFloat(r.discount_amount || 0);
    const stay = f.charges.filter(c => c.type === 'room' || c.type === 'fnb');
    const extras = f.charges.filter(c => c.type !== 'room' && c.type !== 'fnb' && !c.complimentary);
    const stayT = chargeTotals(stay, f.tax_rate, f.service_charge_rate).total;
    const extraT = chargeTotals(extras, f.tax_rate, f.service_charge_rate).total;
    roomSum += stayT; extraSum += extraT; totalSum += f.total;
    console.log(`${r.name} (${r.status}) · rates ${f.service_charge_rate}% + ${f.tax_rate}%${r.bill_tax_rate != null ? ' (stamped)' : ''}`);
    console.log(`   room & meals: price as booked ${rp(booked)} · on the bill ${rp(stayT)}${Math.abs(booked - stayT) > 0.004 ? `  ← differs by ${rp(stayT - booked)}` : ''}`);
    if (extras.length) {
      console.log(`   extras: ${rp(extraT)}${cents(extraT) ? '  ← not a whole rupiah' : ''}`);
      for (const c of extras) {
        const one = chargeTotals([c], f.tax_rate, f.service_charge_rate).total;
        console.log(`     ${String(c.description).slice(0, 50).padEnd(50)} net ${rp(c.amount).padStart(14)} → ${rp(one)}${c.paid_method ? ` (paid · ${c.paid_method})` : ''}${cents(one) ? '  ←' : ''}`);
      }
    }
    const paidRoom = f.payments.filter(x => x.status === 'received').reduce((s, x) => s + parseFloat(x.amount), 0);
    console.log(`   room total ${rp(f.total)} · paid on the room ${rp(paidRoom)} · ${f.group ? "room's own balance (extras)" : 'balance'} ${rp(f.balance_due)}\n`);
  }
  console.log(`ROOMS & MEALS ${rp(roomSum)} · EXTRAS ${rp(extraSum)} · TOTAL ${rp(totalSum)}`);
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
