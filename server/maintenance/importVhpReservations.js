// Import the old PMS's (VHP) forward reservations from its Excel export.
//
// Every reservation number (ResNo) becomes a normal booking — or a group when
// it has 2+ rooms — made through the same code as New Booking
// (services/bookingCreateService.js), so prices, the room / breakfast split,
// payment lines and group billing come out as if FO had typed them. Nothing
// is sent: no confirmation email, no Telegram alert.
//
//   • Every booking holds a real room: the one VHP gave if it is free, else a
//     free room of the same type for the whole stay (a small number in RmNo,
//     e.g. "12", = that many rooms of the type). A reservation that doesn't
//     fit is NOT imported and is listed.
//   • What the file leaves unclear goes on the booking's "To check" list
//     (migration 109): room picked automatically, agent not in the PMS, no
//     rate, placeholder guest names, number of guests guessed…
//   • Rates are per room per night, incl. service & tax; status Pending, no
//     deposit (deposits paid in VHP are not in the file — "To check").
//   • Booked on = VHP's CreateDate (so the Dashboard / Daily Close don't show
//     hundreds of reservations "made today").
//   • Already in the PMS (same room + dates, or same arrival + a shared name
//     word) → skipped; partly in the PMS → skipped and listed, check by hand.
//   • Each booking's internal notes start "IMPORT:vhp-2026-10 · ResNo <n>";
//     a second run never imports the same ResNo twice.
//
// Usage (from server/):
//   node maintenance/importVhpReservations.js --property zahill --file <xlsx> [--from 2026-11-01] [--to 2026-12-31]
//       dry run: everything is done and then rolled back — the report is exactly what --apply would do
//   ... --apply                 do it; writes a run file to maintenance/backups/ (needed for --undo)
//   ... --create-agents         create agents not in the PMS (guest pays the hotel, no commission) instead of listing them
//   ... --user owner@x.com      who the bookings are "made by" (default: the property's first owner)
//   ... --verbose               list every reservation, not only the ones with something to say
//   node maintenance/importVhpReservations.js --undo maintenance/backups/vhp-import-<…>.json [--apply]
//       removes the imported bookings nobody has touched since (dry run first)
// The arrival range: --from defaults to tomorrow; a reservation is in range when its first arrival is.
// Pointed at another database with DATABASE_URL=… (the script prints which one it is on).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../db');
const bookingCreate = require('../services/bookingCreateService');
const M = require('./importVhpMapping');

const TAG = 'IMPORT:vhp-2026-10';
const guestPaysAgents = new Set();   // existing agents used by the file that are not billed to the agent
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const APPLY = flag('--apply');
const VERBOSE = flag('--verbose');
const CREATE_AGENTS = flag('--create-agents');

const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const ymd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : null);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nightsBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const fmtDay = s => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const todayWITA = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const keyOf = s => String(s || '').toUpperCase().replace(/^PT\.?\s+/, '').replace(/[^A-Z0-9]/g, '');
const words = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/)
  .filter(w => w.length > 2 && !['mrs', 'mr', 'ms', 'miss', 'ibu', 'bapak', 'the'].includes(w));

// ── reading the file ──────────────────────────────────────────────────────
function cellText(v) {
  if (v == null) return '';
  if (v.richText) return v.richText.map(t => t.text).join('');
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
  return v instanceof Date ? v : String(v);
}
function parseRate(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'string') return Math.round(Number(v.replace(/[,\s]/g, '')) || 0);
  const n = Number(v) || 0;
  return Math.round(n < 10000 ? n * 1000 : n);   // Excel dropped the trailing zeros: 950 = 950.000
}
function parseAC(v) {
  if (v instanceof Date) return { adults: v.getUTCMonth() + 1, children: v.getUTCDate(), guessed: true };  // "2/5" became 5 Feb
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(v || '').trim());
  if (m) return { adults: +m[1], children: +m[2], guessed: false };
  return { adults: 2, children: 0, guessed: true };
}
function cleanName(raw) {
  const parts = String(raw || '').split(',').map(p => p.replace(/\s+/g, ' ').trim())
    .map(p => p.split(' ').filter(w => !M.TITLES.test(w)).join(' ')).filter(Boolean);
  if (parts.length >= 2) return `${parts.slice(1).join(' ')} ${parts[0]}`.trim();   // "LAST, First" → "First LAST"
  return parts[0] || String(raw || '').trim();
}
function phoneOf(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (!d || d.length < 6) return null;
  if (d.startsWith('8')) d = '0' + d;      // Excel dropped the leading 0 of 08…
  return d;
}

async function readFile(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const lines = [];
  wb.eachSheet(ws => {
    const head = {};
    ws.getRow(1).eachCell((c, i) => { head[String(c.value).replace(/\s+/g, ' ').trim()] = i; });
    const need = ['RmNo', 'ResNo', 'GuestName', 'Segment', 'Arrangement', 'RmCat', 'RoomRate', 'A/C', 'Nat', 'Company/TA', 'CreateDate', 'Arrival', 'Departure'];
    const missing = need.filter(h => !head[h]);
    if (missing.length) throw new Error(`Sheet "${ws.name}" has no column ${missing.join(', ')}`);
    ws.eachRow((r, n) => {
      if (n < 3) return;
      const g = h => (head[h] ? cellText(r.getCell(head[h]).value) : '');
      const arrival = ymd(g('Arrival')), departure = ymd(g('Departure'));
      if (!arrival || !departure || !g('ResNo')) return;
      lines.push({
        sheet: ws.name, row: n, res: String(g('ResNo')).trim(), rm: String(g('RmNo')).trim(),
        guestRaw: String(g('GuestName')).trim(), segment: String(g('Segment')).trim().toUpperCase(),
        arrangement: String(g('Arrangement')).trim().toUpperCase(), cat: String(g('RmCat')).trim().toUpperCase(),
        ratecode: String(g('Ratecode')).trim(), rate: parseRate(r.getCell(head.RoomRate).value),
        ac: parseAC(r.getCell(head['A/C']).value), nat: String(g('Nat')).trim().toUpperCase(),
        dob: ymd(g('Date of Birth')), company: String(g('Company/TA')).split(',')[0].trim(),
        created: ymd(g('CreateDate')), arrival, departure,
        email: (/[^\s,;]+@[^\s,;]+\.[a-z]{2,}/i.exec(String(g('Email Address'))) || [null])[0],
        phone: phoneOf(g('Phone Number')), remarks: String(g('Remarks')).replace(/\s+/g, ' ').trim(),
      });
    });
  });
  return lines;
}

// ── the import ────────────────────────────────────────────────────────────
async function run() {
  const slug = opt('--property'), file = opt('--file');
  if (!slug || !file) { console.error('Usage: --property <slug> --file <xlsx> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--apply]'); process.exit(1); }
  const from = opt('--from') || addDays(todayWITA(), 1);
  const to = opt('--to') || '2099-12-31';
  console.log(`Database: ${(process.env.DATABASE_URL || '').replace(/\/\/[^@]*@/, '//…@')}`);
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN (nothing is kept)'} · property ${slug} · arrivals ${from} → ${to === '2099-12-31' ? 'any' : to}\n`);

  const { rows: [prop] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [slug]);
  if (!prop) throw new Error(`No property "${slug}"`);
  const pid = prop.id;
  const userEmail = opt('--user');
  const { rows: [user] } = await db.query(
    `SELECT id, name FROM users WHERE property_id = $1 AND ${userEmail ? 'lower(email) = lower($2)' : "role = 'owner'"} ORDER BY created_at LIMIT 1`,
    userEmail ? [pid, userEmail] : [pid]);
  if (!user) throw new Error('No user to record the bookings under (--user)');

  const all = await readFile(file);
  // Contact details that are not the guest's own: an OTA's service address
  // (Agoda puts one address on every guest), dummy numbers (1111…), or any
  // email / phone the file shows for more than one guest. Not saved, not used
  // to find an existing guest.
  const namesBy = new Map();
  for (const l of all) for (const c of [l.email && `e:${l.email.toLowerCase()}`, l.phone && `p:${l.phone}`].filter(Boolean)) {
    if (!namesBy.has(c)) namesBy.set(c, new Set());
    namesBy.get(c).add(cleanName(l.guestRaw).toLowerCase());
  }
  for (const l of all) {
    if (l.email && (/@(agoda\.com|.*expedia|.*traveloka|.*tiket\.com|.*trip\.com|.*ctrip)/i.test(l.email) || namesBy.get(`e:${l.email.toLowerCase()}`).size > 1)) l.email = null;
    if (l.phone && (/(\d)\1{5}/.test(l.phone) || namesBy.get(`p:${l.phone}`).size > 1)) l.phone = null;
  }
  const { rows: types } = await db.query('SELECT id, name, max_guests FROM room_types WHERE property_id = $1', [pid]);
  const typeByName = Object.fromEntries(types.map(t => [t.name.toLowerCase(), t]));
  for (const [code, name] of Object.entries(M.ROOM_TYPES)) {
    if (!typeByName[name.toLowerCase()]) throw new Error(`Room type "${name}" (VHP ${code}) is not in the PMS — fix importVhpMapping.js`);
  }
  const { rows: units } = await db.query('SELECT id, name, room_type_id FROM units WHERE property_id = $1', [pid]);
  units.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const unitByName = Object.fromEntries(units.map(u => [u.name, u]));
  const typeNameOf = Object.fromEntries(types.map(t => [t.id, t.name]));
  const { rows: plans } = await db.query('SELECT id, code, is_default FROM rate_plans WHERE property_id = $1', [pid]);
  const { rows: sources } = await db.query('SELECT id, label FROM booking_sources WHERE property_id = $1', [pid]);
  const sourceIds = new Set(sources.map(s => s.id));
  const { rows: agents } = await db.query('SELECT id, name, payment_status FROM agents WHERE property_id = $1', [pid]);

  // Reservations, in file order; in range by their first arrival.
  const byRes = new Map();
  for (const l of all) { if (!byRes.has(l.res)) byRes.set(l.res, []); byRes.get(l.res).push(l); }
  const reservations = [...byRes.entries()]
    .map(([res, lines]) => ({ res, lines, first: lines.reduce((m, l) => (l.arrival < m ? l.arrival : m), lines[0].arrival) }))
    .filter(r => r.first >= from && r.first <= to)
    .sort((a, b) => a.first.localeCompare(b.first) || a.res.localeCompare(b.res));
  if (!reservations.length) { console.log('No reservation arrives in that range.'); return; }
  const lastOut = reservations.reduce((m, r) => r.lines.reduce((mm, l) => (l.departure > mm ? l.departure : mm), m), from);

  // What already holds each room (active bookings), and ResNo already imported.
  const { rows: held } = await db.query(`
    SELECT b.unit_id, b.check_in_date::text ci, b.check_out_date::text co, g.name guest, u.name room, u.room_type_id, b.internal_notes
    FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN units u ON u.id = b.unit_id
    WHERE b.property_id = $1 AND b.status NOT IN ('cancelled', 'no_show')
      AND b.check_out_date > $2 AND b.check_in_date < $3`, [pid, addDays(from, -1), lastOut]);
  const { rows: tagged } = await db.query(`SELECT internal_notes FROM bookings WHERE property_id = $1 AND internal_notes LIKE $2`, [pid, `${TAG}%`]);
  const importedRes = new Set(tagged.map(t => (/ResNo (\S+)/.exec(t.internal_notes) || [])[1]).filter(Boolean));
  const occ = new Map();   // unit id → [{ ci, co, guest }]
  for (const h of held) { if (!occ.has(h.unit_id)) occ.set(h.unit_id, []); occ.get(h.unit_id).push({ ci: h.ci, co: h.co, guest: h.guest }); }
  const takenBy = (unitId, ci, co) => (occ.get(unitId) || []).find(o => o.ci < co && o.co > ci);

  // Is this line already in the PMS? Same room + overlapping dates + a shared
  // name word, or the same arrival + a shared name word in the same room type.
  function alreadyIn(l, typeId) {
    const lw = words(cleanName(l.guestRaw));
    return held.find(h => {
      const share = words(h.guest).some(w => lw.includes(w));
      if (!share) return false;
      if (h.room === l.rm && h.ci < l.departure && h.co > l.arrival) return true;
      return h.ci === l.arrival && (!typeId || h.room_type_id === typeId);
    });
  }

  const client = await db.pool.connect();
  const created = { bookings: [], groups: [], guests: [], agents: [], sources: [] };
  const report = { imported: [], skipped: [] };
  const agentCache = new Map(), guestCache = new Map();

  // An agent for a VHP company: the PMS one whose name starts like it (one
  // match only), else create it (--create-agents) or leave it out.
  async function agentFor(company, sourceId) {
    const k = keyOf(company);
    if (agentCache.has(k)) return agentCache.get(k);
    const wanted = M.AGENT_NAMES[company.toUpperCase()] || null;
    let found = wanted ? agents.filter(a => keyOf(a.name) === keyOf(wanted)) : [];
    if (!found.length) found = agents.filter(a => { const ak = keyOf(a.name); return ak && k && (ak.startsWith(k) || k.startsWith(ak)); });
    let res;
    if (found.length === 1) { res = { agent: found[0] }; if (found[0].payment_status !== 'city_ledger') guestPaysAgents.add(found[0].name); }
    else if (found.length > 1) res = { point: `Agent: several match "${company}" (${found.map(a => a.name).join(', ')}) — choose it in Edit Details` };
    else if (CREATE_AGENTS) {
      const name = wanted || company.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase());
      const { rows: [a] } = await client.query(
        `INSERT INTO agents (property_id, name, agent_type, payment_status, created_by) VALUES ($1, $2, $3, 'city_ledger', $4) RETURNING id, name, payment_status`,
        [pid, name, M.AGENT_TYPE_FOR_SOURCE[sourceId] || 'travel_agent', user.id]);
      agents.push(a); created.agents.push(a.id);
      res = { agent: a, point: `Agent "${a.name}" was created by the import (billed to the agent) — add its contact / credit terms in Agent Billing` };
    } else res = { point: `Agent not in the PMS — VHP: "${company}". Add it in Agent Billing, then choose it in Edit Details` };
    agentCache.set(k, res);
    return res;
  }

  async function sourceFor(l) {
    const company = l.company;
    if (!company || M.DIRECT_COMPANIES.some(d => company.toUpperCase().startsWith(d))) return { source: 'direct' };
    const ota = M.OTA_SOURCES[company.toUpperCase()];
    if (ota) {
      if (!sourceIds.has(ota.id)) {
        await client.query(
          `INSERT INTO booking_sources (id, label, is_ota, source_type, publish_rate, property_id) VALUES ($1, $2, true, 'ota', false, $3)`,
          [ota.id, ota.label || company, pid]);
        sourceIds.add(ota.id); created.sources.push(ota.id);
      }
      return { source: ota.id };
    }
    const source = M.AGENT_SEGMENT_SOURCE[l.segment] || 'travel_agent';
    const a = await agentFor(company, source);
    return { source, agentId: a.agent?.id || null, agentName: a.agent?.name, point: a.point };
  }

  async function guestFor(l) {
    const name = cleanName(l.guestRaw);
    // A placeholder: TBA / Group 18 / CPAB 01…, or the agent's own name
    // (VHP cut the company, so "GRINNING MONKEYS" vs "GRINNING MONKE").
    const nk = keyOf(name), coK = keyOf(l.company);
    const placeholder = M.PLACEHOLDER_NAME.test(name) || !name || name.replace(/[^A-Za-z]/g, '').length < 3
      || (coK.length >= 5 && (nk === coK || nk.startsWith(coK) || coK.startsWith(nk)));
    const ck = placeholder ? `ph:${l.res}:${name}` : `${l.email || ''}|${l.phone || ''}|${name.toLowerCase()}`;
    if (guestCache.has(ck)) return guestCache.get(ck);
    let g = null;
    if (!placeholder) {
      // By email / phone only when the name agrees too (a shared word).
      const sameName = c => c && words(c.name).some(w => words(name).includes(w));
      if (l.email) g = (await client.query('SELECT id, name FROM guests WHERE property_id = $1 AND lower(email) = lower($2)', [pid, l.email])).rows.find(sameName);
      if (!g && l.phone) g = (await client.query(`SELECT id, name FROM guests WHERE property_id = $1 AND right(regexp_replace(whatsapp, '\\D', '', 'g'), 9) = right($2, 9)`, [pid, l.phone])).rows.find(sameName);
      if (!g) g = (await client.query('SELECT id, name FROM guests WHERE property_id = $1 AND lower(name) = lower($2) LIMIT 1', [pid, name])).rows[0];
    }
    let isNew = false;
    if (!g) {
      const nationality = M.NATIONALITIES[l.nat] || null;
      const birthday = l.dob && l.dob > '1900-01-01' && l.dob < todayWITA() ? l.dob : null;
      g = (await client.query(
        `INSERT INTO guests (property_id, name, nationality, email, whatsapp, birthday) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name`,
        [pid, name || `VHP ${l.res}`, nationality, placeholder ? null : l.email, placeholder ? null : l.phone, placeholder ? null : birthday])).rows[0];
      created.guests.push(g.id); isNew = true;
    }
    const out = { id: g.id, name: g.name, placeholder, isNew };
    guestCache.set(ck, out);
    return out;
  }

  try {
    await client.query('BEGIN');
    for (const r of reservations) {
      const label = `${r.res}  ${cleanName(r.lines[0].guestRaw)}`;
      if (importedRes.has(r.res)) { report.skipped.push({ label, why: 'already in the PMS (imported by this script before)', quiet: true }); continue; }

      // Expand each line into rooms, with its room type.
      const rooms = [];
      let bad = null;
      for (const l of r.lines) {
        const typeName = M.ROOM_TYPES[l.cat.slice(0, 3)];
        if (!typeName) { bad = `unknown room type "${l.cat}" — add it to importVhpMapping.js`; break; }
        const type = typeByName[typeName.toLowerCase()];
        const given = /^\d{3,}$/.test(l.rm) ? unitByName[l.rm] : null;
        const count = given || !l.rm ? 1 : (parseInt(l.rm, 10) || 1);
        for (let i = 0; i < count; i++) rooms.push({ l, type, given: i === 0 ? given : null, count, nights: nightsBetween(l.arrival, l.departure) });
      }
      if (bad) { report.skipped.push({ label, why: bad }); continue; }

      // Guests per room. On a reservation with several lines VHP repeats one
      // figure on every line (8 lines → "8/0" each): not per room. A line
      // standing for n rooms carries the line's total. Anything that can't be
      // per room becomes 2 per room (at most what the room holds), flagged.
      const repeated = r.lines.length > 1 && r.lines.every(l => l.ac.adults + l.ac.children === r.lines.length)
        && r.lines.length > 2;
      for (const room of rooms) {
        const ac = room.l.ac, n = ac.adults + ac.children;
        if (repeated || ac.guessed || n < 1) room.guests = { n: Math.min(2, room.type.max_guests), guessed: true, vhp: n };
        // A line for n rooms: its figure is per room ("5 × DLGD, 2/0" = 2 in each).
        else room.guests = { n, guessed: false, vhp: n };
      }

      // A stay VHP split night by night (one line per night, e.g. 2 rooms on
      // the 16th, 1 on the 17th, 2 on the 18th) → join a room to one that
      // ends the day it starts, same type and rate, so it is one booking.
      for (const x of rooms) { x.arrival = x.l.arrival; x.departure = x.l.departure; }
      for (const x of [...rooms].sort((a, b) => a.arrival.localeCompare(b.arrival))) {
        const prev = rooms.find(p => p !== x && !p.merged && p.type.id === x.type.id
          && p.l.rate === x.l.rate && p.departure === x.arrival);
        if (!prev) continue;
        prev.departure = x.departure;
        prev.nights += x.nights;
        prev.joined = true;
        if (!prev.given && x.given) prev.given = x.given;
        x.merged = true;
      }
      for (let i = rooms.length - 1; i >= 0; i--) if (rooms[i].merged) rooms.splice(i, 1);

      // Already in the PMS?
      const dups = r.lines.map(l => alreadyIn(l, typeByName[(M.ROOM_TYPES[l.cat.slice(0, 3)] || '').toLowerCase()]?.id));
      if (dups.every(Boolean)) {
        report.skipped.push({ label, why: `already in the PMS (${[...new Set(dups.map(d => `${d.room} ${d.guest}`))].join('; ')})`, quiet: true });
        continue;
      }
      if (dups.some(Boolean)) {
        report.skipped.push({ label, why: `partly in the PMS (${[...new Set(dups.filter(Boolean).map(d => `${d.room} ${d.guest}`))].join('; ')}) — check this reservation by hand` });
        continue;
      }

      // Pick rooms: first every room VHP gave that is free and of the right
      // type; then, for the rest, the first free room of the type for the
      // whole stay that no other line of this reservation asked for (so one
      // taken room doesn't push the whole group along by one).
      const planned = [];
      const isFree = (unitId, ci, co) => !takenBy(unitId, ci, co) && !planned.some(p => p.unit.id === unitId); // a group never holds one room twice
      const askedFor = new Set(rooms.filter(x => x.given).map(x => x.given.id));
      for (const room of rooms) {
        room.points = [];
        const { l } = room;
        if (room.given && room.given.room_type_id === room.type.id && isFree(room.given.id, room.arrival, room.departure)) {
          room.unit = room.given;
          planned.push({ unit: room.given, ci: room.arrival, co: room.departure });
        }
      }
      for (const room of rooms) {
        if (room.unit) continue;
        const { l } = room;
        let unit = null;
        {
          const free = u => u.room_type_id === room.type.id && isFree(u.id, room.arrival, room.departure);
          unit = units.find(u => free(u) && !askedFor.has(u.id)) || units.find(free) || null;
          if (unit) {
            if (room.given && room.given.room_type_id !== room.type.id) room.points.push(`VHP had room ${room.given.name}, a ${typeNameOf[room.given.room_type_id]} — booked as ${room.type.name} (VHP room type); room picked automatically`);
            else if (room.given) { const t = takenBy(room.given.id, room.arrival, room.departure); room.points.push(`VHP had room ${room.given.name}${t ? ` (taken in the PMS by ${t.guest})` : ''} — room picked automatically, change it if needed`); }
            else room.points.push(room.count > 1 ? `Room picked automatically (VHP: ${room.count} × ${room.type.name}, no room numbers)` : 'Room picked automatically (no room number in VHP) — change it if needed');
          }
        }
        if (!unit) { bad = `no ${room.type.name} room is free for the whole stay ${fmtDay(room.arrival)} → ${fmtDay(room.departure)}`; break; }
        room.unit = unit;
        planned.push({ unit, ci: room.arrival, co: room.departure });
      }
      if (bad) { report.skipped.push({ label, why: `does not fit: ${bad}${rooms.length > 1 ? ` (${rooms.length} rooms asked)` : ''}` }); continue; }

      // Build and create the booking(s) — undone on any refusal.
      await client.query('SAVEPOINT vhp');
      try {
        const first = r.lines[0];
        const src = await sourceFor(first);
        const plan = plans.find(p => p.code === M.RATE_PLANS[first.arrangement]) || plans.find(p => p.is_default) || null;
        for (const room of rooms) {
          const { l } = room;
          const g = await guestFor(l);
          room.guest = g;
          if (room.joined) room.points.push('VHP listed this stay night by night — joined into one booking; check the nights and rooms in VHP');
          if (src.point) room.points.push(src.point);
          if (g.placeholder) room.points.push(`Guest name not known yet (VHP: "${l.guestRaw}") — Change Guest / Assign Guests`);
          if (room.guests.guessed) room.points.push(`Number of guests guessed (${room.guests.n}) — VHP's adults / children did not say per room (VHP: ${room.guests.vhp})`);
          else if (room.guests.n > room.type.max_guests) room.points.push(`${room.guests.n} guests in VHP for a room that holds ${room.type.max_guests} — check the number of guests / rooms`);
          if (!l.rate) room.points.push(l.segment === 'COMPLIMENT' ? 'Complimentary in VHP (rate 0) — make it complimentary (⋮ → Make Complimentary); until then the price is its breakfasts only' : 'No rate in VHP (Rp 0) — set the price with Edit Price (until then it is the breakfasts only)');
          if (!M.OTA_SOURCES[first.company.toUpperCase()]) room.points.push('Check in VHP whether a deposit was paid — if so, Record Payment with the date it was paid (not today)');
          room.input = {
            guest_id: g.id, unit_id: room.unit.id, check_in_date: room.arrival, check_out_date: room.departure,
            num_guests: Math.max(1, room.guests.n), total_amount: l.rate * room.nights,
            rate_plan_id: plan?.id || null, bed_preference: M.BEDS[l.cat[3]] || null,
            special_requests: l.remarks || null,
            internal_notes: `${TAG} · ResNo ${r.res}${l.ratecode ? ` · VHP rate code ${l.ratecode}` : ''}`,
          };
        }
        const common = { source: src.source, agent_id: src.agentId || undefined, status: 'pending', deposit_amount: 0 };
        let made;
        if (rooms.length === 1) {
          made = await bookingCreate.createBooking(client, { propertyId: pid, userId: user.id, input: { ...rooms[0].input, ...common } });
          if (!made.error) made = { bookings: [made.booking] };
        } else {
          made = await bookingCreate.createGroup(client, { propertyId: pid, userId: user.id, input: {
            ...common, guest_id: rooms[0].guest.id, group_deposit_amount: 0,
            check_in_date: rooms.reduce((m, x) => (x.arrival < m ? x.arrival : m), rooms[0].arrival),
            check_out_date: rooms.reduce((m, x) => (x.departure > m ? x.departure : m), rooms[0].departure),
            special_requests: first.remarks || null, internal_notes: `${TAG} · ResNo ${r.res}`,
            rooms: rooms.map(x => ({ ...x.input })),
          } });
        }
        if (made.error) throw new Error(made.error.error || JSON.stringify(made.error));

        const createdOn = r.lines.map(l => l.created).filter(Boolean).sort()[0] || null;
        for (let i = 0; i < made.bookings.length; i++) {
          const b = made.bookings[i], room = rooms.find(x => x.unit.id === b.unit_id);
          await client.query(
            `UPDATE bookings SET to_check = $2::jsonb${createdOn ? ", created_at = ($3::date + time '12:00') AT TIME ZONE 'Asia/Makassar'" : ''} WHERE id = $1`,
            createdOn ? [b.id, room.points.length ? JSON.stringify(room.points) : null, createdOn] : [b.id, room.points.length ? JSON.stringify(room.points) : null]);
          await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
            [b.id, `Imported from the old system (VHP reservation ${r.res}${createdOn ? `, booked there on ${createdOn}` : ''}).`, user.id]);
          created.bookings.push(b.id);
          occ.set(b.unit_id, [...(occ.get(b.unit_id) || []), { ci: room.arrival, co: room.departure, guest: room.guest.name }]);
        }
        if (made.group) {
          created.groups.push(made.group.id);
          if (createdOn) await client.query(`UPDATE reservation_groups SET created_at = ($2::date + time '12:00') AT TIME ZONE 'Asia/Makassar' WHERE id = $1`, [made.group.id, createdOn]);
        }
        await client.query('RELEASE SAVEPOINT vhp');
        // What the bookings really cost (a rate-0 B&B stay is never below its breakfasts).
        report.imported.push({ r, rooms, src, total: made.bookings.reduce((s, b) => s + parseFloat(b.total_amount) - parseFloat(b.discount_amount || 0), 0) });
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT vhp');
        report.skipped.push({ label, why: `refused: ${err.message}` });
      }
    }

    printReport(report, created);
    if (APPLY) {
      await client.query('COMMIT');
      const dir = path.join(__dirname, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const runFile = path.join(dir, `vhp-import-${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(runFile, JSON.stringify({ tag: TAG, property: slug, property_id: pid, from, to, at: new Date().toISOString(), created }, null, 1));
      console.log(`\nAPPLIED. Run file (for --undo): ${path.relative(process.cwd(), runFile)}`);
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — nothing was kept. Run again with --apply to import.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function printReport(report, created) {
  const imp = report.imported;
  const rooms = imp.reduce((s, x) => s + x.rooms.length, 0);
  const nights = imp.reduce((s, x) => s + x.rooms.reduce((n, y) => n + y.nights, 0), 0);
  const value = imp.reduce((s, x) => s + x.total, 0);
  const withPoints = new Map();
  for (const x of imp) for (const y of x.rooms) for (const p of y.points) {
    const k = p.replace(/"[^"]*"/g, '"…"').replace(/room \d+/g, 'room …').replace(/\(taken in the PMS by [^)]*\)/, '(taken in the PMS)')
      .replace(/\(VHP: \d+ × [^)]*\)/, '(VHP: n × type)').replace(/\(\d+\)/, '(n)').replace(/^\d+ guests in VHP for a room that holds \d+/, 'n guests in VHP for a room that holds fewer');
    withPoints.set(k, (withPoints.get(k) || 0) + 1);
  }

  console.log('══ TO IMPORT ═════════════════════════════════════════════════════');
  for (const x of imp) {
    const l = x.r.lines[0];
    const dates = `${fmtDay(x.r.first)} → ${fmtDay(x.rooms.reduce((m, y) => (y.departure > m ? y.departure : m), x.rooms[0].departure))}`;
    const src = x.src.agentName ? `${x.src.source} · ${x.src.agentName}` : x.src.source;
    console.log(`✓ ${x.r.res.padEnd(6)} ${cleanName(l.guestRaw).slice(0, 26).padEnd(26)} ${dates.padEnd(16)} ${String(x.rooms.length).padStart(2)} room${x.rooms.length === 1 ? ' ' : 's'}  ${rp(x.total).padStart(14)}  ${src}`);
    // Rooms with the same points (and guest / rate) are listed together.
    const sets = new Map();
    for (const y of x.rooms) {
      const pts = y.points.filter(p => !p.startsWith('Check in VHP whether a deposit'));
      if (!pts.length && !VERBOSE) continue;
      const k = JSON.stringify([y.type.name, y.guest.name, y.l.rate, y.nights, y.guests.n,
        pts.map(p => p.replace(/^VHP had room \d+( \(taken[^)]*\))?/, 'VHP had another room$1'))]);
      if (!sets.has(k)) sets.set(k, { y, pts, units: [] });
      sets.get(k).units.push(y.given && y.given.id !== y.unit.id ? `${y.unit.name} (VHP ${y.given.name})` : y.unit.name);
    }
    for (const { y, pts, units: us } of sets.values()) {
      console.log(`      ${us.join(', ')} · ${y.type.name} · ${y.guest.name}${y.guest.isNew ? '' : ' (existing guest)'} · ${y.guests.n} pax · ${rp(y.l.rate)}/night × ${y.nights}`);
      for (const p of pts) console.log(`         – ${us.length > 1 ? p.replace(/^VHP had room \d+/, 'VHP had another room') : p}`);
    }
  }
  console.log('\n══ NOT IMPORTED ══════════════════════════════════════════════════');
  for (const s of report.skipped.filter(s => !s.quiet)) console.log(`✗ ${s.label.slice(0, 34).padEnd(34)} ${s.why}`);
  const quiet = report.skipped.filter(s => s.quiet);
  if (quiet.length) {
    console.log(`\nAlready in the PMS (skipped, nothing to do): ${quiet.length}`);
    for (const s of quiet) console.log(`  · ${s.label.slice(0, 34).padEnd(34)} ${s.why.replace(/^already in the PMS /, '')}`);
  }
  console.log('\n══ SUMMARY ═══════════════════════════════════════════════════════');
  console.log(`Reservations imported: ${imp.length} (${imp.filter(x => x.rooms.length > 1).length} groups) · ${rooms} rooms · ${nights} room-nights · ${rp(value)} incl. service & tax`);
  console.log(`Not imported: ${report.skipped.filter(s => !s.quiet).length} to look at · ${quiet.length} already in the PMS`);
  if (guestPaysAgents.size) console.log(`
⚠ Agents set to "guest pays" in the PMS: ${[...guestPaysAgents].join(', ')}.
  If the agent pays the hotel, switch each to "bill to agent" in Agent Billing BEFORE --apply:
  a group is set up at import as one bill for the group (guest pays) or one bill per room for the agent.`);
  console.log(`New guests: ${created.guests.length} · new agents: ${created.agents.length} · new sources: ${created.sources.join(', ') || 'none'}`);
  console.log('\n"To check" points on the imported bookings (rooms):');
  for (const [k, n] of [...withPoints.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)} × ${k}`);
}

// ── undo ──────────────────────────────────────────────────────────────────
async function undo(runFile) {
  const r = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · undo ${r.tag} for ${r.property} (${r.created.bookings.length} bookings)\n`);
  const client = await db.pool.connect();
  let removed = 0; const kept = [];
  try {
    await client.query('BEGIN');
    for (const id of r.created.bookings) {
      const { rows: [b] } = await client.query(`
        SELECT b.id, b.status, u.name room, g.name guest,
               (SELECT count(*) FROM payments p WHERE p.booking_id = b.id AND p.status <> 'pending')::int paid,
               (SELECT count(*) FROM folio_charges f WHERE f.booking_id = b.id)::int charges,
               (SELECT count(*) FROM booking_events e WHERE e.booking_id = b.id)::int events,
               (SELECT count(*) FROM booking_addons a WHERE a.booking_id = b.id)::int addons
        FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
        WHERE b.id = $1 AND b.property_id = $2`, [id, r.property_id]);
      if (!b) continue;
      const touched = b.status !== 'pending' || b.paid || b.charges || b.addons || b.events > 1;
      if (touched) { kept.push(`${b.room} ${b.guest} (${b.status}${b.paid ? ', payment' : ''}${b.events > 1 ? ', changed since' : ''})`); continue; }
      for (const t of ['booking_events', 'payments', 'booking_night_rates', 'booking_notes']) await client.query(`DELETE FROM ${t} WHERE booking_id = $1`, [id]);
      await client.query('DELETE FROM bookings WHERE id = $1', [id]);
      removed++;
    }
    for (const id of r.created.groups) {
      await client.query(`DELETE FROM reservation_groups rg WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM bookings WHERE reservation_group_id = $1)
        AND NOT EXISTS (SELECT 1 FROM group_payments WHERE group_id = $1)`, [id]);
    }
    let guests = 0;
    for (const id of r.created.guests) {
      const { rowCount } = await client.query(`DELETE FROM guests WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM bookings WHERE guest_id = $1)
        AND NOT EXISTS (SELECT 1 FROM reservation_groups WHERE primary_guest_id = $1)`, [id]);
      guests += rowCount;
    }
    for (const id of r.created.agents) await client.query('DELETE FROM agents WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM bookings WHERE agent_id = $1)', [id]);
    for (const id of r.created.sources) await client.query('DELETE FROM booking_sources WHERE id = $1 AND property_id = $2 AND NOT EXISTS (SELECT 1 FROM bookings WHERE source = $1 AND property_id = $2)', [id, r.property_id]);
    console.log(`Removed: ${removed} bookings, ${guests} guests (and empty groups / unused agents and sources).`);
    if (kept.length) { console.log(`Kept — changed or used since the import (${kept.length}):`); kept.forEach(k => console.log('  ' + k)); }
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
  .catch(err => { console.error('\nFAILED:', err.message); db.pool.end(); process.exit(1); });
