// Room TV Home (migration 142): the settings on the Guest Board page → TV Home, and the
// `tv` object the room's /state hands the TV launcher (routes/display.js).
const db = require('../db');

const SLOTS = ['morning', 'day', 'night'];
const DEFAULT_START = { morning: '05:00', day: '11:00', night: '18:00' };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// Watch row (migration 143): Android package names, at most MAX_WATCH_APPS.
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const MAX_WATCH_APPS = 6;

const clean = (v, max) => {
  if (v === undefined) return undefined;
  const s = v === null ? '' : String(v).trim();
  return s === '' ? null : s.slice(0, max);
};

function backgroundsOf(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return SLOTS.map(slot => {
    const b = list.find(x => x && x.slot === slot) || {};
    return { slot, start: HHMM.test(b.start || '') ? b.start : DEFAULT_START[slot], image_url: b.image_url || null };
  });
}

async function settings(propertyId) {
  const { rows: [ps] } = await db.query(
    `SELECT tv_backgrounds, tv_bg_use_board, guest_wifi_ssid, guest_wifi_password,
            breakfast_hours, breakfast_outlet, checkout_time, tv_watch_apps
     FROM property_settings WHERE property_id = $1`, [propertyId]);
  return {
    use_board: ps ? ps.tv_bg_use_board !== false : true,
    backgrounds: backgroundsOf(ps?.tv_backgrounds),
    wifi_ssid: ps?.guest_wifi_ssid || '',
    wifi_password: ps?.guest_wifi_password || '',
    breakfast_hours: ps?.breakfast_hours || '',
    breakfast_outlet: ps?.breakfast_outlet || '',
    checkout_time: ps?.checkout_time || '',
    watch_apps: Array.isArray(ps?.tv_watch_apps) ? ps.tv_watch_apps : [],
  };
}

// PUT body: { use_board?, starts?: { morning, day, night }, wifi_ssid?, wifi_password?,
//             breakfast_hours?, breakfast_outlet?, checkout_time?, watch_apps?: [package] }
// — a field left out is kept; watch_apps [] = the TV app's own list.
async function save(propertyId, body = {}) {
  const fields = {
    guest_wifi_ssid: clean(body.wifi_ssid, 64),
    guest_wifi_password: clean(body.wifi_password, 64),
    breakfast_hours: clean(body.breakfast_hours, 40),
    breakfast_outlet: clean(body.breakfast_outlet, 60),
    checkout_time: clean(body.checkout_time, 5),
  };
  if (fields.checkout_time && !HHMM.test(fields.checkout_time)) {
    const e = new Error('Check-out time must be HH:MM, e.g. 12:00'); e.status = 400; throw e;
  }
  if (body.use_board !== undefined && typeof body.use_board !== 'boolean') {
    const e = new Error('use_board must be true or false'); e.status = 400; throw e;
  }
  let watchApps;
  if (body.watch_apps !== undefined) {
    if (!Array.isArray(body.watch_apps)) { const e = new Error('watch_apps must be a list'); e.status = 400; throw e; }
    watchApps = [...new Set(body.watch_apps.map(p => String(p).trim()).filter(Boolean))];
    const bad = watchApps.find(p => !PACKAGE.test(p) || p.length > 120);
    if (bad) { const e = new Error(`"${bad}" is not an Android package name (like com.netflix.ninja)`); e.status = 400; throw e; }
    if (watchApps.length > MAX_WATCH_APPS) { const e = new Error(`At most ${MAX_WATCH_APPS} apps fit on the Watch row`); e.status = 400; throw e; }
  }
  let backgrounds;
  if (body.starts !== undefined) {
    const cur = (await settings(propertyId)).backgrounds;
    for (const slot of SLOTS) {
      const v = body.starts?.[slot];
      if (v !== undefined && !HHMM.test(String(v))) {
        const e = new Error(`${slot} start must be HH:MM`); e.status = 400; throw e;
      }
    }
    backgrounds = cur.map(b => ({ ...b, start: body.starts?.[b.slot] ?? b.start }));
  }
  const sets = [];
  const vals = [propertyId];
  for (const [col, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  }
  if (body.use_board !== undefined) { vals.push(body.use_board); sets.push(`tv_bg_use_board = $${vals.length}`); }
  if (backgrounds) { vals.push(JSON.stringify(backgrounds)); sets.push(`tv_backgrounds = $${vals.length}`); }
  if (watchApps) { vals.push(watchApps.length ? JSON.stringify(watchApps) : null); sets.push(`tv_watch_apps = $${vals.length}`); }
  if (sets.length) await db.query(`UPDATE property_settings SET ${sets.join(', ')} WHERE property_id = $1`, vals);
  return settings(propertyId);
}

// One time-of-day photo set or cleared. Returns { settings, removed } — the URL no longer used.
async function setBackground(propertyId, slot, imageUrl) {
  const cur = (await settings(propertyId)).backgrounds;
  const removed = cur.find(b => b.slot === slot)?.image_url || null;
  const next = cur.map(b => (b.slot === slot ? { ...b, image_url: imageUrl } : b));
  await db.query('UPDATE property_settings SET tv_backgrounds = $2 WHERE property_id = $1', [propertyId, JSON.stringify(next)]);
  return { settings: await settings(propertyId), removed: removed !== imageUrl ? removed : null };
}

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// The hotel's time now as minutes after midnight (WITA, like everything else).
function nowMinutesWita(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date);
  const get = (t) => Number(p.find(x => x.type === t).value);
  return get('hour') * 60 + get('minute');
}

// The time-of-day photo for now: the slot with a photo whose start is the latest one
// not after now (wrapping round midnight). Only one photo → that one all day.
function photoForNow(backgrounds, nowMin) {
  const withPhoto = backgrounds.filter(b => b.image_url).sort((a, b) => minutes(a.start) - minutes(b.start));
  if (!withPhoto.length) return null;
  const earlier = withPhoto.filter(b => minutes(b.start) <= nowMin);
  return (earlier.length ? earlier[earlier.length - 1] : withPhoto[withPhoto.length - 1]).image_url;
}

// The `tv` object in /state. `cards` = the room's Guest Board cards (already in /state).
async function tvForState(propertyId, cards, brandColor, now = new Date()) {
  const s = await settings(propertyId);
  const boardPhotos = s.use_board ? [...new Set((cards || []).map(c => c.image_url).filter(Boolean))] : [];
  const timed = photoForNow(s.backgrounds, nowMinutesWita(now));
  return {
    background_urls: boardPhotos.length ? boardPhotos : (timed ? [timed] : []),
    accent: brandColor || null,
    wifi: s.wifi_ssid ? { ssid: s.wifi_ssid, password: s.wifi_password || null } : null,
    breakfast: s.breakfast_hours ? { hours: s.breakfast_hours, outlet: s.breakfast_outlet || null } : null,
    checkout_time: s.checkout_time || null,
    watch_apps: s.watch_apps.length ? s.watch_apps : null,
  };
}

module.exports = { MAX_WATCH_APPS, SLOTS, settings, save, setBackground, tvForState, photoForNow };
