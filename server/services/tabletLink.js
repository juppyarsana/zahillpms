// Room tablet connection history (migration 115) — Settings → Property →
// Room tablets.
//
// Recording (cheap on purpose — the tablets ask every 10 s):
//   seen()          every GET /api/display/room/:roomId/state. The last request
//                   time per room is kept in memory; a request after more than
//                   GAP_MS of silence writes ONE drop row (went quiet → back).
//                   The day's first / last request is buffered and written by
//                   flushDays() every 5 minutes.
//   recordReading() every kiosk-app telemetry report, at most one row per
//                   tablet per READING_EVERY_MS, plus any access-point /
//                   network / internet change.
// A restart forgets the last request times, so the minute of a deploy is never
// counted as a drop. Everything older than KEEP_DAYS is deleted nightly.
//
// Reading: drops where MASS or more rooms were down at the same time are
// "together" (internet line, router or server), the rest are the tablet's own.
const db = require('../db');

const GAP_MS = 60 * 1000;
const MASS = 5;
const TOGETHER_MS = 90 * 1000;
const KEEP_DAYS = 30;
const READING_EVERY_MS = 5 * 60 * 1000;
const TZ = 'Asia/Makassar';
const TZ_OFFSET_MS = 8 * 3600 * 1000;

const startedAt = new Date();
const lastSeen = new Map();     // `${pid}|${room}` -> ms
const dayBuffer = new Map();    // `${pid}|${room}|${day}` -> { pid, room, day, first, last }
const lastReading = new Map();  // `${pid}|${room}` -> { at, bssid, network_type, internet_ok }

const dayOf = (ms) => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);

function seen(propertyId, room) {
  const now = Date.now();
  const key = `${propertyId}|${room}`;
  const prev = lastSeen.get(key);
  lastSeen.set(key, now);
  if (prev && now - prev > GAP_MS) {
    db.query(
      `INSERT INTO room_tablet_drops (property_id, controller_id, offline_from, back_at, seconds, source)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0), $5, 'live')
       ON CONFLICT DO NOTHING`,
      [propertyId, room, prev, now, Math.round((now - prev) / 1000)]
    ).catch((err) => console.error('[TabletLink] drop not saved:', err.message));
  }
  const day = dayOf(now);
  const dk = `${key}|${day}`;
  const d = dayBuffer.get(dk);
  if (d) d.last = now;
  else dayBuffer.set(dk, { pid: propertyId, room, day, first: now, last: now });
}

async function flushDays() {
  const rows = [...dayBuffer.entries()];
  if (!rows.length) return 0;
  for (const [k, d] of rows) {
    const written = d.last;
    try {
      await db.query(
        `INSERT INTO room_tablet_days (property_id, controller_id, day, first_seen, last_seen)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0))
         ON CONFLICT (property_id, day, controller_id) DO UPDATE
           SET first_seen = LEAST(room_tablet_days.first_seen, EXCLUDED.first_seen),
               last_seen  = GREATEST(room_tablet_days.last_seen, EXCLUDED.last_seen)`,
        [d.pid, d.room, d.day, d.first, written]
      );
      // A request that arrived meanwhile moved `last` on — keep it for next time.
      if (dayBuffer.get(k) === d && d.last === written) dayBuffer.delete(k);
    } catch (err) {
      console.error('[TabletLink] day not saved:', err.message);
    }
  }
  return rows.length;
}

// device = the room_display_devices row as it is after the report.
function recordReading(propertyId, room, device) {
  if (!device) return;
  const key = `${propertyId}|${room}`;
  const now = Date.now();
  const prev = lastReading.get(key);
  const changed = !prev || prev.bssid !== device.wifi_bssid || prev.network_type !== device.network_type
    || prev.internet_ok !== device.internet_ok;
  if (!changed && now - prev.at < READING_EVERY_MS) return;
  lastReading.set(key, { at: now, bssid: device.wifi_bssid, network_type: device.network_type, internet_ok: device.internet_ok });
  db.query(
    `INSERT INTO room_tablet_readings (property_id, controller_id, network_type, internet_ok, wifi_ssid, wifi_bssid,
       wifi_rssi, wifi_frequency_mhz, wifi_link_speed_mbps, battery_level, battery_charging)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [propertyId, room, device.network_type, device.internet_ok, device.wifi_ssid, device.wifi_bssid, device.wifi_rssi,
      device.wifi_frequency_mhz, device.wifi_link_speed_mbps, device.battery_level, device.battery_charging]
  ).catch((err) => console.error('[TabletLink] reading not saved:', err.message));
}

async function prune() {
  const cut = `NOW() - INTERVAL '${KEEP_DAYS} days'`;
  const a = await db.query(`DELETE FROM room_tablet_drops WHERE back_at < ${cut}`);
  const b = await db.query(`DELETE FROM room_tablet_readings WHERE at < ${cut}`);
  const c = await db.query(`DELETE FROM room_tablet_days WHERE day < (NOW() AT TIME ZONE '${TZ}')::date - ${KEEP_DAYS}`);
  return a.rowCount + b.rowCount + c.rowCount;
}

// ── Reading ────────────────────────────────────────────────────────────────

// Marks each drop with how many rooms went quiet at the same time: an internet
// line, the router or the server stops every tablet within the same few
// seconds, so drops that STARTED within TOGETHER_MS of each other belong together.
function classify(drops) {
  const sorted = [...drops].sort((x, y) => x.a - y.a);
  for (const d of sorted) {
    const others = new Set();
    for (const e of sorted) {
      if (e.a > d.a + TOGETHER_MS) break;
      if (e.room !== d.room && Math.abs(e.a - d.a) <= TOGETHER_MS) others.add(e.room);
    }
    d.together = others.size + 1;
    d.own = d.together < MASS;
  }
  return sorted;
}

function massEvents(drops) {
  const events = [];
  for (const d of drops.filter((x) => !x.own)) {
    const last = events[events.length - 1];
    if (last && d.a - last.lastStart <= TOGETHER_MS) { last.b = Math.max(last.b, d.b); last.lastStart = d.a; last.rooms.add(d.room); }
    else events.push({ a: d.a, b: d.b, lastStart: d.a, rooms: new Set([d.room]) });
  }
  return events.map((e) => ({
    from: new Date(e.a).toISOString(), to: new Date(e.b).toISOString(),
    minutes: Math.round((e.b - e.a) / 60000), rooms: [...e.rooms].sort(byRoom),
  }));
}

const byRoom = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

async function loadDrops(propertyId, fromMs, toMs = Date.now()) {
  const { rows } = await db.query(
    `SELECT controller_id, offline_from, back_at, seconds, source FROM room_tablet_drops
      WHERE property_id = $1 AND back_at > to_timestamp($2 / 1000.0) AND offline_from < to_timestamp($3 / 1000.0)
      ORDER BY offline_from`, [propertyId, fromMs, toMs]);
  return classify(rows.map((r) => ({
    room: r.controller_id, a: new Date(r.offline_from).getTime(), b: new Date(r.back_at).getTime(), source: r.source,
  })));
}

function lastDays(n) {
  const today = dayOf(Date.now());
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(today + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - i);
    out.push(t.toISOString().slice(0, 10));
  }
  return out;
}

// Units with a Room ID, tablets that reported, and rooms seen in the history.
async function roomList(propertyId, fromDay) {
  const [{ rows: units }, { rows: devices }, { rows: seenRooms }, { rows: aps }] = await Promise.all([
    db.query(`SELECT name, controller_id, room_type_id FROM units WHERE property_id = $1 AND controller_id IS NOT NULL`, [propertyId]),
    db.query(`SELECT * FROM room_display_devices WHERE property_id = $1`, [propertyId]),
    db.query(`SELECT DISTINCT controller_id FROM room_tablet_days WHERE property_id = $1 AND day >= $2`, [propertyId, fromDay]),
    db.query(`SELECT bssid, name FROM room_tablet_access_points WHERE property_id = $1`, [propertyId]),
  ]);
  const apName = new Map(aps.map((a) => [a.bssid.toLowerCase(), a.name]));
  const dev = new Map(devices.map((d) => [d.controller_id, d]));
  const names = new Map(units.map((u) => [u.controller_id, u.name]));
  const ids = new Set([...units.map((u) => u.controller_id), ...devices.map((d) => d.controller_id), ...seenRooms.map((r) => r.controller_id)]);
  return { ids: [...ids].sort(byRoom), names, dev, apName };
}

function deviceView(d, apName) {
  if (!d) return null;
  return {
    reported_at: d.last_seen_at,
    network_type: d.network_type, internet_ok: d.internet_ok,
    ssid: d.wifi_ssid, bssid: d.wifi_bssid, ap_name: d.wifi_bssid ? apName.get(d.wifi_bssid.toLowerCase()) || null : null,
    rssi: d.wifi_rssi, mhz: d.wifi_frequency_mhz, mbps: d.wifi_link_speed_mbps,
    battery: d.battery_level, charging: d.battery_charging, app_version: d.app_version, device_model: d.device_model,
  };
}

async function overview(propertyId, { days: nDays = 14 } = {}) {
  const days = lastDays(nDays);
  const fromMs = Date.parse(days[0] + 'T00:00:00+08:00');
  const [{ ids, names, dev, apName }, drops, { rows: dayRows }] = await Promise.all([
    roomList(propertyId, days[0]),
    loadDrops(propertyId, fromMs),
    db.query(`SELECT controller_id, to_char(day, 'YYYY-MM-DD') AS day, first_seen, last_seen
                FROM room_tablet_days WHERE property_id = $1 AND day >= $2`, [propertyId, days[0]]),
  ]);
  const now = Date.now();
  const rooms = ids.map((room) => {
    const per = {};
    for (const day of days) per[day] = { seen_hours: 0, drops: 0, minutes: 0, drops_all: 0, minutes_all: 0 };
    for (const r of dayRows) {
      if (r.controller_id === room && per[r.day]) {
        per[r.day].seen_hours = Math.round((new Date(r.last_seen) - new Date(r.first_seen)) / 360000) / 10;
      }
    }
    const today = days[days.length - 1];
    const mem = lastSeen.get(`${propertyId}|${room}`);
    if (mem && per[today]) {
      const first = dayRows.find((r) => r.controller_id === room && r.day === today);
      const firstMs = first ? new Date(first.first_seen).getTime() : [...dayBuffer.values()].find((d) => d.pid === propertyId && d.room === room && d.day === today)?.first;
      if (firstMs) per[today].seen_hours = Math.round((mem - firstMs) / 360000) / 10;
    }
    let totalOwn = 0, totalMin = 0;
    for (const d of drops) {
      if (d.room !== room) continue;
      const day = dayOf(d.a);
      if (!per[day]) continue;
      const min = (d.b - d.a) / 60000;
      per[day].drops_all++; per[day].minutes_all += min;
      if (d.own) { per[day].drops++; per[day].minutes += min; totalOwn++; totalMin += min; }
    }
    for (const day of days) { per[day].minutes = Math.round(per[day].minutes); per[day].minutes_all = Math.round(per[day].minutes_all); }
    const lastMs = mem || null;
    const trackedLong = now - startedAt.getTime() > GAP_MS;
    const online = lastMs ? now - lastMs <= GAP_MS : (trackedLong ? false : null);
    const lastFromDays = dayRows.filter((r) => r.controller_id === room).map((r) => new Date(r.last_seen).getTime());
    const lastAny = lastMs || (lastFromDays.length ? Math.max(...lastFromDays) : null);
    return {
      room, unit_name: names.get(room) || null,
      online, last_seen: lastAny ? new Date(lastAny).toISOString() : null,
      device: deviceView(dev.get(room), apName),
      per_day: per,
      totals: { drops: totalOwn, minutes: Math.round(totalMin) },
      has_history: lastAny != null || dev.has(room),
    };
  });
  return {
    days, mass: MASS, gap_seconds: GAP_MS / 1000, keep_days: KEEP_DAYS,
    tracking_since: startedAt.toISOString(),
    history_from: drops.length ? new Date(Math.min(...drops.map((d) => d.a))).toISOString() : null,
    rooms, mass_events: massEvents(drops),
  };
}

// Hours each room was seen in [fromMs, toMs), from the per-day first / last request.
async function hoursSeen(propertyId, fromMs, toMs) {
  const { rows } = await db.query(
    `SELECT controller_id, first_seen, last_seen FROM room_tablet_days
      WHERE property_id = $1 AND last_seen > to_timestamp($2 / 1000.0) AND first_seen < to_timestamp($3 / 1000.0)`,
    [propertyId, fromMs, toMs]);
  const out = new Map();
  for (const r of rows) {
    const a = Math.max(fromMs, new Date(r.first_seen).getTime());
    const b = Math.min(toMs, new Date(r.last_seen).getTime());
    if (b > a) out.set(r.controller_id, (out.get(r.controller_id) || 0) + (b - a) / 3600e3);
  }
  // Today's requests not flushed yet.
  for (const d of dayBuffer.values()) {
    if (d.pid !== propertyId) continue;
    const a = Math.max(fromMs, d.first), b = Math.min(toMs, d.last);
    const flushed = rows.some((r) => r.controller_id === d.room && dayOf(new Date(r.first_seen).getTime()) === d.day);
    if (b > a && !flushed) out.set(d.room, (out.get(d.room) || 0) + (b - a) / 3600e3);
  }
  return out;
}

// Before / after a change (e.g. new WiFi) at `sinceMs`, per 24 h seen.
async function compare(propertyId, { sinceMs, rooms: changed = [] }) {
  const now = Date.now();
  const fromMs = now - KEEP_DAYS * 86400e3;
  const [{ ids, names }, drops, before, after] = await Promise.all([
    roomList(propertyId, dayOf(fromMs)),
    loadDrops(propertyId, fromMs, now),
    hoursSeen(propertyId, fromMs, sinceMs),
    hoursSeen(propertyId, sinceMs, now),
  ]);
  const rate = (room, hours, a, b) => {
    if (!hours || hours < 1) return null;
    const mine = drops.filter((d) => d.room === room && d.own && d.a >= a && d.a < b);
    const lost = mine.reduce((s, d) => s + (d.b - d.a), 0) / 60000;
    return { hours: Math.round(hours * 10) / 10, drops: mine.length, minutes: Math.round(lost),
      drops_per_day: Math.round((mine.length * 24 / hours) * 10) / 10, minutes_per_day: Math.round(lost * 24 / hours) };
  };
  const set = new Set(changed.map(String));
  const rows = ids.map((room) => ({
    room, unit_name: names.get(room) || null, changed: set.has(room),
    before: rate(room, before.get(room), fromMs, sinceMs), after: rate(room, after.get(room), sinceMs, now),
  })).filter((r) => r.before || r.after);
  const avg = (group, k) => {
    const v = rows.filter((r) => r.changed === group && r[k]);
    if (!v.length) return null;
    return { rooms: v.length,
      drops_per_day: Math.round(v.reduce((s, r) => s + r[k].drops_per_day, 0) / v.length * 10) / 10,
      minutes_per_day: Math.round(v.reduce((s, r) => s + r[k].minutes_per_day, 0) / v.length) };
  };
  return {
    since: new Date(sinceMs).toISOString(), from: new Date(fromMs).toISOString(), rows,
    groups: {
      changed: { before: avg(true, 'before'), after: avg(true, 'after') },
      others: { before: avg(false, 'before'), after: avg(false, 'after') },
    },
  };
}

async function roomDetail(propertyId, room, { days: nDays = 7 } = {}) {
  const fromMs = Date.now() - nDays * 86400e3;
  const [{ names, dev, apName }, all, { rows: readings }] = await Promise.all([
    roomList(propertyId, dayOf(fromMs)),
    loadDrops(propertyId, fromMs),
    db.query(`SELECT at, network_type, internet_ok, wifi_ssid, wifi_bssid, wifi_rssi, wifi_frequency_mhz,
                     wifi_link_speed_mbps, battery_level, battery_charging
                FROM room_tablet_readings WHERE property_id = $1 AND controller_id = $2 AND at > to_timestamp($3 / 1000.0)
               ORDER BY at`, [propertyId, room, fromMs]),
  ]);
  const drops = all.filter((d) => d.room === room).map((d) => ({
    from: new Date(d.a).toISOString(), to: new Date(d.b).toISOString(), seconds: Math.round((d.b - d.a) / 1000),
    together: d.together, own: d.own, source: d.source,
  })).reverse();
  return {
    room, unit_name: names.get(room) || null, device: deviceView(dev.get(room), apName),
    drops,
    readings: readings.map((r) => ({
      at: r.at, rssi: r.wifi_rssi, bssid: r.wifi_bssid, ap_name: r.wifi_bssid ? apName.get(r.wifi_bssid.toLowerCase()) || null : null,
      ssid: r.wifi_ssid, mhz: r.wifi_frequency_mhz, mbps: r.wifi_link_speed_mbps, internet_ok: r.internet_ok,
      network_type: r.network_type, battery: r.battery_level, charging: r.battery_charging,
    })),
  };
}

async function accessPoints(propertyId) {
  const [{ rows: seen7 }, { rows: names }, { rows: now }] = await Promise.all([
    db.query(`SELECT lower(wifi_bssid) AS bssid, max(wifi_ssid) AS ssid, round(avg(wifi_rssi)) AS avg_rssi,
                     min(wifi_rssi) AS worst_rssi, max(wifi_frequency_mhz) AS mhz, max(at) AS last_at,
                     array_agg(DISTINCT controller_id) AS rooms
                FROM room_tablet_readings
               WHERE property_id = $1 AND wifi_bssid IS NOT NULL AND at > NOW() - INTERVAL '7 days'
               GROUP BY lower(wifi_bssid)`, [propertyId]),
    db.query(`SELECT lower(bssid) AS bssid, name FROM room_tablet_access_points WHERE property_id = $1`, [propertyId]),
    db.query(`SELECT lower(wifi_bssid) AS bssid, max(wifi_ssid) AS ssid, max(wifi_frequency_mhz) AS mhz,
                     array_agg(controller_id) AS rooms, round(avg(wifi_rssi)) AS avg_rssi
                FROM room_display_devices WHERE property_id = $1 AND wifi_bssid IS NOT NULL GROUP BY lower(wifi_bssid)`, [propertyId]),
  ]);
  const map = new Map();
  const get = (b) => { if (!map.has(b)) map.set(b, { bssid: b, name: null, ssid: null, mhz: null, rooms_now: [], rooms_7d: [], avg_rssi: null, worst_rssi: null }); return map.get(b); };
  for (const r of seen7) Object.assign(get(r.bssid), { ssid: r.ssid, mhz: r.mhz, rooms_7d: r.rooms.sort(byRoom), avg_rssi: Number(r.avg_rssi), worst_rssi: r.worst_rssi, last_at: r.last_at });
  for (const r of now) { const a = get(r.bssid); a.rooms_now = r.rooms.sort(byRoom); a.ssid = a.ssid || r.ssid; a.mhz = a.mhz || r.mhz; if (a.avg_rssi == null) a.avg_rssi = Number(r.avg_rssi); }
  for (const r of names) get(r.bssid).name = r.name;
  return [...map.values()].sort((a, b) => b.rooms_now.length - a.rooms_now.length || (a.name || a.bssid).localeCompare(b.name || b.bssid));
}

async function nameAccessPoint(propertyId, bssid, name) {
  const b = String(bssid || '').toLowerCase();
  if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(b)) { const e = new Error('Not an access point address'); e.status = 400; throw e; }
  const n = String(name || '').trim().slice(0, 60);
  if (!n) {
    await db.query('DELETE FROM room_tablet_access_points WHERE property_id = $1 AND lower(bssid) = $2', [propertyId, b]);
    return null;
  }
  await db.query(
    `INSERT INTO room_tablet_access_points (property_id, bssid, name) VALUES ($1, $2, $3)
     ON CONFLICT (property_id, bssid) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`, [propertyId, b, n]);
  return n;
}

module.exports = {
  GAP_MS, MASS, KEEP_DAYS,
  seen, flushDays, recordReading, prune,
  classify, overview, compare, roomDetail, accessPoints, nameAccessPoint,
};
