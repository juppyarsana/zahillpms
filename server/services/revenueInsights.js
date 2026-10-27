// Revenue — the Insights → Revenue page (owner, or the `reports` permission:
// the same figures as the Reports page, in an owner's layout). What came in,
// where it came from, how the rooms sold — one month at a time.
//
// Built on fullReport.buildFullReport (so every figure equals Reports for the
// same days) for the month — up to today while it is running — and on
// getReport for the comparisons: the month before (the same days while the
// month runs, the Dashboard rule, see costsService.costPeriod) and the same
// days a year earlier (only when that year has any revenue). Nothing stored.
const db = require('../db');
const { costPeriod } = require('./costsService');
const { todayWITA } = require('./roomChargeService');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const pctChange = (now, before) => (before > 0 ? r2(((now - before) / before) * 100) : null);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}`; };
const ymd = d => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
const monthLen = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// The same days one year earlier (29 Feb → 28 Feb).
function yearBefore(from, to) {
  const shift = d => {
    const [y, m, day] = d.split('-').map(Number);
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(day, monthLen(y - 1, m))).padStart(2, '0')}`;
  };
  return { from: shift(from), to: shift(to) };
}

async function buildRevenue(propertyId, month, { today = todayWITA() } = {}) {
  const p = costPeriod(month, today);
  if (p.error) return p;
  const { buildFullReport } = require('./fullReport');
  const { getReport } = require('../routes/reports');   // lazy: route file
  const ly = yearBefore(p.from, p.to);

  const [full, prev, last, { rows: sources }] = await Promise.all([
    buildFullReport(propertyId, p.from, p.to),
    getReport(propertyId, p.prev.from, p.prev.to),
    getReport(propertyId, ly.from, ly.to),
    db.query(`SELECT label, is_ota, source_type FROM booking_sources WHERE property_id = $1`, [propertyId]),
  ]);

  // Room figures for a comparison period, on the same rooms-for-sale basis as
  // the month itself (rooms not out of order today × days).
  const sellable = full.rooms.sellable_rooms;
  const figures = (r, from, to) => {
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    const avail = sellable * days;
    return {
      revenue: r2(r.total_revenue),
      occupancy: avail ? r2((r.total_nights / avail) * 100) : 0,
      nights_sold: r.total_nights,
      adr: r.paid_nights > 0 ? r2(r.room_revenue / r.paid_nights) : 0,
      revpar: avail ? r2(r.room_revenue / avail) : 0,
    };
  };
  const now = {
    revenue: r2(full.revenue.total), occupancy: full.rooms.occupancy, nights_sold: full.rooms.nights_sold,
    available_nights: full.rooms.available_nights, adr: r2(full.rooms.adr), revpar: r2(full.rooms.revpar),
  };
  const before = figures(prev, p.prev.from, p.prev.to);
  const lastYear = last.total_revenue > 0 ? figures(last, ly.from, ly.to) : null;
  const compare = b => b && {
    revenue: pctChange(now.revenue, b.revenue),
    occupancy_pts: r2(now.occupancy - b.occupancy),
    adr: pctChange(now.adr, b.adr),
    revpar: pctChange(now.revpar, b.revpar),
  };

  // ── Where it came from ──
  const rv = full.revenue;
  const otherTotal = r2(rv.extras.total + rv.activities.total + rv.events.total);
  const mix = [
    { key: 'rooms', label: 'Rooms', amount: r2(rv.room) },
    { key: 'fnb', label: 'Food & beverage', amount: r2(rv.fnb.total), parts: [
      { label: 'Breakfast & meals in the room rate', amount: r2(rv.fnb.rate_plan) },
      { label: 'Breakfast with extra beds', amount: r2(rv.fnb.extras) },
      { label: 'Restaurant & POS', amount: r2(rv.fnb.outlets) },
    ].filter(x => Math.abs(x.amount) > 0.004) },
    { key: 'other', label: 'Extras, activities & events', amount: otherTotal, parts: [
      ...rv.extras.by_category.map(c => ({ label: c.label, amount: r2(c.amount) })),
      ...(rv.activities.total ? [{ label: `Activities (${rv.activities.bookings} booked)`, amount: r2(rv.activities.total) }] : []),
      ...(rv.events.total ? [{ label: 'Meeting room & events', amount: r2(rv.events.total) }] : []),
    ].filter(x => Math.abs(x.amount) > 0.004) },
  ].map(m => ({ ...m, share: rv.total > 0 ? r2((m.amount / rv.total) * 100) : 0 }));

  // ── Channels: room revenue by source, and how much of it pays an OTA ──
  const otaLabels = new Set(sources.filter(s => s.is_ota || s.source_type === 'ota').map(s => s.label));
  const channels = full.channels.map(c => ({
    source: c.source, bookings: c.bookings, nights: c.nights, room_revenue: r2(c.room_revenue),
    revenue: r2(c.revenue), adr: r2(c.adr), share: c.share, ota: otaLabels.has(c.source),
  }));
  const stayTotal = channels.reduce((s, c) => s + c.revenue, 0);
  const otaTotal = channels.filter(c => c.ota).reduce((s, c) => s + c.revenue, 0);

  return {
    month, month_label: monthName(month), from: p.from, to: p.to, partial: p.partial, today,
    prev: { ...p.prev, label: monthName(p.prev.month) },
    last_year: lastYear && { from: ly.from, to: ly.to, label: monthName(ly.from.slice(0, 7)) },
    now, before, compare_prev: compare(before), compare_last_year: compare(lastYear), last_year_figures: lastYear,
    mix,
    complimentary: rv.complimentary,
    daily: full.daily.map(d => ({
      date: ymd(d.date),
      rooms: r2(parseFloat(d.room_revenue)),
      fnb: r2(d.fnb_revenue),
      other: r2((d.ancillary_revenue || 0) + (d.activity_revenue || 0) + (d.event_revenue || 0)),
      total: r2(d.total_revenue),
      nights: parseInt(d.nights_sold, 10) || 0,
    })),
    channels,
    ota_share: stayTotal > 0 ? r2((otaTotal / stayTotal) * 100) : null,
    room_types: full.rooms.by_room_type.map(t => ({
      room_type: t.room_type, rooms: t.rooms, nights: t.nights, occupancy: t.occupancy,
      revenue: r2(t.revenue), adr: r2(t.adr), revpar: r2(t.revpar),
    })),
    nationalities: full.rooms.by_nationality.slice(0, 6).map(n => ({
      nationality: n.nationality, bookings: n.bookings, room_nights: n.room_nights, revenue: r2(n.revenue),
    })),
    guest_nights: full.rooms.guest_nights,
    arrivals: full.rooms.arrivals,
  };
}

module.exports = { buildRevenue };
