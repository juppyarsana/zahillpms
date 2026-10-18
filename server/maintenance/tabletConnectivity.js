// Read-only: room tablet connectivity from the web server's access log.
//
// Every Room Display tablet asks GET /api/display/room/<room>/state every 10 s,
// so a silence longer than --gap seconds (default 60) means the tablet could not
// reach the server. Per room and per day this prints the number of drops, the
// minutes lost and which public IP (network) the tablet came from.
//
// Silences shared by the whole hotel (no tablet at all reached the server) are
// listed apart and not counted against any room. Drops where --mass (default 5)
// or more rooms were down together are listed as "together" (internet line or
// server, not one tablet's WiFi).
//
// Usage (on the server):
//   zcat -f /var/log/nginx/access.log* | node maintenance/tabletConnectivity.js
//   ... | node maintenance/tabletConnectivity.js --gap 60 --mass 5 --from 2026-10-05
//   ... --upgraded 201,202,103 --since "2026-10-18 14:00"   (before / after a WiFi change)
//   ... --save --property zahill [--apply]   (one-off: put the drops and the days
//       each tablet was running into Room tablets, migration 115; without
//       --apply it only says what it would save. Re-running replaces what an
//       earlier import saved and never touches drops the PMS recorded itself.)
// Only GET .../state is counted (the tablet's 10-second request), the same as
// the PMS's own recording.
// The public IP shows the internet line a request went out on (two lines with a
// load-balancing router = both letters are normal), not which WiFi the tablet is on.
// The display token is never printed.

const readline = require('readline');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const GAP_S = Number(arg('gap', 60));
const MASS = Number(arg('mass', 5));
const TOGETHER_MS = 90 * 1000; // drops that start within 90 s of each other

const FROM = arg('from', null);
const SAVE = args.includes('--save');
const APPLY = args.includes('--apply');
const PROPERTY = arg('property', null);
const UPGRADED = (arg('upgraded', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const SINCE = arg('since', null); // 'YYYY-MM-DD HH:MM' WITA
const TZ_OFFSET_MS = 8 * 3600 * 1000; // WITA
const parseWita = (s) => Date.parse(s.replace(' ', 'T') + (s.length <= 10 ? 'T00:00' : '') + ':00+08:00');

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const LINE = /^(\S+) \S+ \S+ \[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\] "\w+ \/api\/display\/room\/([^/?\s]+)\/state[?\s]/;

const seen = new Map();       // room -> number[] (ms)
const ipDay = new Map();      // room -> Map(day -> Map(ip -> count))
const ipTotal = new Map();    // ip -> count

function dayOf(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
}
function clock(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(11, 16);
}
function fmtMin(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`;
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const m = LINE.exec(line);
  if (!m) return;
  const [, ip, dd, mon, yyyy, hh, mi, ss, tz, room] = m;
  const sign = tz[0] === '-' ? -1 : 1;
  const offMs = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))) * 60000;
  const ms = Date.UTC(+yyyy, MONTHS[mon], +dd, +hh, +mi, +ss) - offMs;
  if (FROM && dayOf(ms) < FROM) return;
  if (!seen.has(room)) { seen.set(room, []); ipDay.set(room, new Map()); }
  seen.get(room).push(ms);
  const day = dayOf(ms);
  const byDay = ipDay.get(room);
  if (!byDay.has(day)) byDay.set(day, new Map());
  const c = byDay.get(day);
  c.set(ip, (c.get(ip) || 0) + 1);
  ipTotal.set(ip, (ipTotal.get(ip) || 0) + 1);
});

rl.on('close', () => {
  if (!seen.size) { console.log('No tablet requests found.'); return; }
  if (SAVE) { save().catch((err) => { console.error(err); process.exitCode = 1; }); return; }
  const gapMs = GAP_S * 1000;

  // Hotel-wide silences: gaps in the requests of all rooms together.
  let all = [];
  for (const t of seen.values()) all = all.concat(t);
  all.sort((a, b) => a - b);
  const start = all[0], end = all[all.length - 1];
  const hotelOut = [];
  for (let i = 1; i < all.length; i++) {
    if (all[i] - all[i - 1] > gapMs) hotelOut.push([all[i - 1], all[i]]);
  }

  // Per room drops, minus hotel-wide silences.
  const drops = []; // { room, a, b, lost }
  for (const [room, t] of seen) {
    t.sort((a, b) => a - b);
    for (let i = 1; i < t.length; i++) {
      const a = t[i - 1], b = t[i];
      if (b - a <= gapMs) continue;
      let lost = b - a;
      for (const [oa, ob] of hotelOut) {
        const ov = Math.min(b, ob) - Math.max(a, oa);
        if (ov > 0) lost -= ov;
      }
      if (lost > gapMs) drops.push({ room, a, b, lost });
    }
  }

  // How many rooms were down at the same time as each drop.
  const sorted = [...drops].sort((x, y) => x.a - y.a);
  for (const d of sorted) {
    const others = new Set();
    for (const e of sorted) {
      if (e.a > d.a + TOGETHER_MS) break;
      if (e.room !== d.room && Math.abs(e.a - d.a) <= TOGETHER_MS) others.add(e.room);
    }
    d.together = others.size + 1;
  }

  const days = [];
  for (let d = dayOf(start); d <= dayOf(end);) {
    days.push(d);
    const next = new Date(d + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  const rooms = [...seen.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const ips = [...ipTotal.entries()].sort((a, b) => b[1] - a[1]).map(([ip]) => ip);
  const ipLetter = new Map(ips.map((ip, i) => [ip, String.fromCharCode(65 + i)]));
  const head = (label) => label.padEnd(6) + days.map((d) => d.slice(8, 10).padStart(5)).join('');

  console.log(`Room tablets — ${dayOf(start)} ${clock(start)} to ${dayOf(end)} ${clock(end)} WITA`);
  console.log(`A drop = no request from the tablet for more than ${GAP_S} s (it asks every 10 s).`);
  console.log(`Rooms seen: ${rooms.length} — ${rooms.join(', ')}`);
  console.log('\nNetworks (public IP the tablets came from):');
  for (const ip of ips) console.log(`  ${ipLetter.get(ip)} = ${ip}  (${ipTotal.get(ip)} requests)`);

  console.log(`\nHotel-wide silences (no tablet reached the server, > ${GAP_S} s): ${hotelOut.length}`);
  for (const [a, b] of hotelOut) console.log(`  ${dayOf(a)} ${clock(a)} – ${clock(b)}  (${fmtMin(b - a)})`);

  const own = drops.filter((d) => d.together < MASS);
  const mass = drops.filter((d) => d.together >= MASS);

  // Mass events: group overlapping mass drops.
  const events = [];
  for (const d of [...mass].sort((x, y) => x.a - y.a)) {
    const last = events[events.length - 1];
    if (last && d.a - last.lastStart <= TOGETHER_MS) { last.b = Math.max(last.b, d.b); last.lastStart = d.a; last.rooms.add(d.room); }
    else events.push({ a: d.a, b: d.b, lastStart: d.a, rooms: new Set([d.room]) });
  }
  console.log(`\nDrops of ${MASS}+ rooms at the same time (internet line / server, not one tablet): ${events.length}`);
  for (const e of events) {
    const nets = new Set();
    for (const r of e.rooms) {
      const c = ipDay.get(r).get(dayOf(e.a));
      if (c) nets.add(ipLetter.get([...c.entries()].sort((x, y) => y[1] - x[1])[0][0]));
    }
    console.log(`  ${dayOf(e.a)} ${clock(e.a)} – ${clock(e.b)}  ${e.rooms.size} rooms, line ${[...nets].join('/')}`);
  }

  const table = (title, cell) => {
    console.log(`\n${title}`);
    console.log(head('Room'));
    for (const r of rooms) console.log(r.padEnd(6) + days.map((d) => String(cell(r, d)).padStart(5)).join(''));
  };
  const byRoomDay = (list) => {
    const m = new Map();
    for (const d of list) {
      const k = `${d.room}|${dayOf(d.a)}`;
      const v = m.get(k) || { n: 0, lost: 0 };
      v.n++; v.lost += d.lost;
      m.set(k, v);
    }
    return m;
  };
  const ownMap = byRoomDay(own);
  const mainIp = (r, d) => {
    const c = ipDay.get(r).get(d);
    if (!c) return '·';
    const total = [...c.values()].reduce((s, v) => s + v, 0);
    const top = [...c.entries()].sort((x, y) => y[1] - x[1]);
    return ipLetter.get(top[0][0]) + (top.length > 1 && top[1][1] / total > 0.1 ? ipLetter.get(top[1][0]).toLowerCase() : '');
  };

  table(`Drops per day — this tablet alone (fewer than ${MASS} rooms down together)`, (r, d) => {
    if (!ipDay.get(r).get(d)) return '·';
    return ownMap.get(`${r}|${d}`)?.n || 0;
  });
  table('Minutes lost per day — this tablet alone', (r, d) => {
    if (!ipDay.get(r).get(d)) return '·';
    const v = ownMap.get(`${r}|${d}`);
    return v ? Math.round(v.lost / 60000) : 0;
  });
  table('Internet line per day (main letter; lower-case = also used >10% of that day)', mainIp);

  console.log('\nLongest drops — this tablet alone (top 25):');
  for (const d of [...own].sort((x, y) => y.lost - x.lost).slice(0, 25)) {
    console.log(`  ${d.room.padEnd(6)} ${dayOf(d.a)} ${clock(d.a)} – ${dayOf(d.b) === dayOf(d.a) ? '' : dayOf(d.b) + ' '}${clock(d.b)}  ${fmtMin(d.lost)}`);
  }
  // Before / after a WiFi change, for the rooms changed vs the rest.
  if (UPGRADED.length && SINCE) {
    const cut = parseWita(SINCE);
    const rate = (r, from, to) => {
      const t = seen.get(r);
      const a = Math.max(from, t[0]), b = Math.min(to, t[t.length - 1]);
      if (b - a < 3600e3) return null; // under an hour seen: not enough
      const mine = own.filter((d) => d.room === r && d.a >= a && d.a < b);
      const perDay = 86400e3 / (b - a);
      return { drops: mine.length * perDay, lost: mine.reduce((s, d) => s + d.lost, 0) / 60000 * perDay, hours: (b - a) / 3600e3 };
    };
    const fmt = (v) => (v == null ? '      —' : `${v.drops.toFixed(1).padStart(5)} /${String(Math.round(v.lost)).padStart(4)}m`);
    console.log(`\nBefore / after ${dayOf(cut)} ${clock(cut)} WITA — this tablet alone, per 24 h (drops / minutes lost)`);
    console.log('Room   group      before          after     (hours seen after)');
    const groups = { changed: [], others: [] };
    for (const r of rooms) {
      const g = UPGRADED.includes(r) ? 'changed' : 'others';
      const b = rate(r, start, cut), a = rate(r, cut, end + 1);
      groups[g].push({ b, a });
      console.log(`${r.padEnd(6)} ${g.padEnd(8)} ${fmt(b)}   ${fmt(a)}   ${a ? a.hours.toFixed(1) : ''}`);
    }
    for (const [g, list] of Object.entries(groups)) {
      const avg = (k, f) => {
        const v = list.map((x) => x[k]).filter(Boolean);
        return v.length ? v.reduce((s, x) => s + x[f], 0) / v.length : null;
      };
      const show = (k) => (avg(k, 'drops') == null ? '—' : `${avg(k, 'drops').toFixed(1)} drops / ${Math.round(avg(k, 'lost'))} min`);
      console.log(`  average ${g.padEnd(8)} before: ${show('b')}   after: ${show('a')}  (${list.length} rooms)`);
    }
  }

  console.log('\n· = no request from that tablet that day (switched off, not installed yet, or offline all day).');
});

// --save: drops (every silence over --gap, as recorded live — the page tells
// apart the ones many rooms shared) and per room per day the first / last request.
async function save() {
  if (!PROPERTY) { console.log('--save needs --property <slug>'); process.exitCode = 1; return; }
  require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
  const db = require('../db');
  try {
    const { rows: [prop] } = await db.query('SELECT id, name FROM properties WHERE slug = $1', [PROPERTY]);
    if (!prop) { console.log(`No property with slug ${PROPERTY}`); process.exitCode = 1; return; }
    const { rows: units } = await db.query('SELECT controller_id FROM units WHERE property_id = $1 AND controller_id IS NOT NULL', [prop.id]);
    const known = new Set(units.map((u) => u.controller_id));
    const { rows: live } = await db.query(
      `SELECT controller_id, offline_from, back_at FROM room_tablet_drops WHERE property_id = $1 AND source = 'live'`, [prop.id]);
    const gapMs = GAP_S * 1000;
    const drops = [], days = [], skipped = new Set();
    for (const [room, t] of seen) {
      if (!known.has(room)) { skipped.add(room); continue; }
      t.sort((a, b) => a - b);
      const per = new Map();
      for (let i = 0; i < t.length; i++) {
        const day = dayOf(t[i]);
        const d = per.get(day);
        if (d) d.last = t[i]; else per.set(day, { first: t[i], last: t[i] });
        if (i && t[i] - t[i - 1] > gapMs) {
          const a = t[i - 1], b = t[i];
          const overlapsLive = live.some((l) => l.controller_id === room
            && new Date(l.offline_from).getTime() < b && new Date(l.back_at).getTime() > a);
          if (!overlapsLive) drops.push({ room, a, b });
        }
      }
      for (const [day, d] of per) days.push({ room, day, ...d });
    }
    console.log(`${prop.name}: ${drops.length} drops and ${days.length} room-days from ${seen.size - skipped.size} rooms` +
      (skipped.size ? ` (not a Room ID here, left out: ${[...skipped].join(', ')})` : ''));
    if (!APPLY) { console.log('Dry run — nothing saved. Add --apply to save.'); return; }
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM room_tablet_drops WHERE property_id = $1 AND source = 'log'`, [prop.id]);
      for (const d of drops) {
        await client.query(
          `INSERT INTO room_tablet_drops (property_id, controller_id, offline_from, back_at, seconds, source)
           VALUES ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0), $5, 'log') ON CONFLICT DO NOTHING`,
          [prop.id, d.room, d.a, d.b, Math.round((d.b - d.a) / 1000)]);
      }
      for (const d of days) {
        await client.query(
          `INSERT INTO room_tablet_days (property_id, controller_id, day, first_seen, last_seen)
           VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0))
           ON CONFLICT (property_id, day, controller_id) DO UPDATE
             SET first_seen = LEAST(room_tablet_days.first_seen, EXCLUDED.first_seen),
                 last_seen  = GREATEST(room_tablet_days.last_seen, EXCLUDED.last_seen)`,
          [prop.id, d.room, d.day, d.first, d.last]);
      }
      await client.query('COMMIT');
      console.log('Saved. Open Settings → Room tablets.');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await db.pool.end();
  }
}
