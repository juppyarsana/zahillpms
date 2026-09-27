// Property time. A hotel runs on one clock: "today", arrivals and "made
// today" are the PROPERTY's day, whatever timezone the viewer is in (same as
// the server, which works in WITA — services/occupancySql.js TODAY_WITA_SQL).
// Every property is in Bali (WITA) for now; when one isn't, this becomes a
// per-property setting.
export const PROPERTY_TZ = 'Asia/Makassar';
export const PROPERTY_TZ_LABEL = 'WITA';

// Today at the property as YYYY-MM-DD.
export function propertyToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: PROPERTY_TZ });
}

export function addDaysYmd(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "Sun 27 Sep · 14:05 WITA"
export function propertyClock(now = new Date()) {
  const day = now.toLocaleDateString('en-GB', { timeZone: PROPERTY_TZ, weekday: 'short', day: 'numeric', month: 'short' });
  const time = now.toLocaleTimeString('en-GB', { timeZone: PROPERTY_TZ, hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time} ${PROPERTY_TZ_LABEL}`;
}

// A plain YYYY-MM-DD date shown as text (no timezone shift).
export function fmtYmd(ymd, opts = { day: 'numeric', month: 'short' }) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
}
