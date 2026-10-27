// The period of the Insights pages Rooms, Guests and Bookings: a month, three
// months, or a calendar year — capped at today while it is running — and what
// it is compared with:
//   prev      the same length just before (a month: the same days of the
//             month before, the Dashboard rule; 3 months: the 3 before; a
//             year: the year before)
//   last_year the same dates one year earlier
// ?period=month|quarter|year  &at=YYYY-MM (month: that month; quarter: the
// last of the three months) or YYYY (year). Default: this month.
const { todayWITA } = require('./roomChargeService');

const pad = n => String(n).padStart(2, '0');
const monthLen = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
// The same date `years` earlier (29 Feb → 28 Feb).
function shiftYears(ymd, years) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${y + years}-${pad(m)}-${pad(Math.min(d, monthLen(y + years, m)))}`;
}
// A run of `days` days starting `months` months earlier, never past the day
// before `from` (a whole month → the whole month before).
function back(from, days, months) {
  const f = `${shiftMonth(from.slice(0, 7), -months)}-01`;
  const end = addDays(from, -1);
  const t = addDays(f, days - 1);
  return { from: f, to: t < end ? t : end };
}
const label = (from, to) => {
  const f = d => `${+d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
  return `${f(from)} – ${f(to)}`;
};

// → { period, at, from, to, days, partial, label, prev, last_year } or { error }.
function insightPeriod(query = {}, today = todayWITA()) {
  const period = ['month', 'quarter', 'year'].includes(query.period) ? query.period : 'month';
  let from, end;
  let at = query.at;
  if (period === 'year') {
    at = /^\d{4}$/.test(at || '') ? at : today.slice(0, 4);
    from = `${at}-01-01`; end = `${at}-12-31`;
  } else {
    at = /^\d{4}-(0[1-9]|1[0-2])$/.test(at || '') ? at : today.slice(0, 7);
    const [y, m] = at.split('-').map(Number);
    from = period === 'quarter' ? `${shiftMonth(at, -2)}-01` : `${at}-01`;
    end = `${at}-${pad(monthLen(y, m))}`;
  }
  if (from > today) return { error: 'That period has not started yet' };
  if (from < '2000-01-01') return { error: 'Choose a later period' };
  const partial = end > today;
  const to = partial ? today : end;
  const days = daysBetween(from, to);
  const prev = period === 'year' ? { from: shiftYears(from, -1), to: shiftYears(to, -1) }
    : back(from, days, period === 'quarter' ? 3 : 1);
  const lastYear = { from: shiftYears(from, -1), to: shiftYears(to, -1) };
  return {
    period, at, from, to, days, partial, label: label(from, to),
    prev: { ...prev, label: label(prev.from, prev.to) },
    last_year: { ...lastYear, label: label(lastYear.from, lastYear.to) },
  };
}

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const pctChange = (now, before) => (before > 0 ? r2(((now - before) / before) * 100) : null);

// Room figures of a getReport() result on a fixed rooms-for-sale basis
// (rooms not out of order today × days — the Reports page's rule).
function roomFigures(r, from, to, sellable) {
  const avail = sellable * daysBetween(from, to);
  return {
    revenue: r2(r.total_revenue), room_revenue: r2(r.room_revenue),
    nights_sold: r.total_nights, available_nights: avail,
    occupancy: avail ? r2((r.total_nights / avail) * 100) : 0,
    adr: r.paid_nights > 0 ? r2(r.room_revenue / r.paid_nights) : 0,
    revpar: avail ? r2(r.room_revenue / avail) : 0,
  };
}

module.exports = { insightPeriod, roomFigures, pctChange, r2, addDays, daysBetween, MONTHS };
