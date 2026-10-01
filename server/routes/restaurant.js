// Restaurant page (🍽) — everything F&B that comes from the property's POS,
// in one place. Needs the pos_integration module and the Restaurant
// permission (owner always).
//
//   GET /api/restaurant/overview?date=        the day at a glance + trends
//   GET /api/restaurant/sessions?from=&to=    sessions sent by the POS
//   GET /api/restaurant/sessions/:id          one session: every bill + every send (history)
//   GET /api/restaurant/kitchen?date=         breakfast / dinner counts (was Guest Lists → Kitchen) + who came
//   GET /api/restaurant/room-charges?from=&to=  POS room charges vs the guests' folios
const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const moduleGuard = require('../middleware/moduleGuard');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const { todayWITA } = require('../services/roomChargeService');

const gate = [auth, moduleGuard('pos_integration'), requireOwnerOrMenu('restaurant')];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDate = d => ISO.test(String(d || '')) && !isNaN(Date.parse(d));
const r2 = v => Math.round((parseFloat(v) || 0) * 100) / 100;
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ymd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const KEYS = ['breakfast', 'lunch', 'dinner'];
const LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };

function range(q, days = 31) {
  const to = isDate(q.to) ? q.to : todayWITA();
  const from = isDate(q.from) ? q.from : addDays(to, -(days - 1));
  if (from > to) return { error: 'from must be on or before to' };
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) return { error: 'At most one year at a time' };
  return { from, to };
}

const sessionRow = s => ({
  id: s.id, date: ymd(s.business_date), session: s.session_key, label: s.label || LABEL[s.session_key],
  started_at: s.started_at, ended_at: s.ended_at, bills: s.bills,
  outlet_bills: s.outlet_bills, outlet_net: r2(s.outlet_net), outlet_service: r2(s.outlet_service), outlet_tax: r2(s.outlet_tax),
  outlet_total: r2(s.outlet_total), room_charge_total: r2(s.room_charge_total),
  breakfast_pax_expected: s.breakfast_pax_expected, breakfast_pax_came: s.breakfast_pax_came,
  sent_by: s.sent_by, sent_at: s.sent_at, first_sent_at: s.first_sent_at, send_count: s.send_count,
  comp_bills: s.summary?.complimentary?.bills || 0, comp_value: r2(s.summary?.complimentary?.value || 0),
});

// Restaurant complimentary (bills given away in the POS, charged to a
// department) over a period, from the sessions the POS sent: menu value + cost
// per department. Never revenue.
async function complimentary(propertyId, from, to) {
  const { rows } = await db.query(
    `SELECT summary->'complimentary' AS c FROM pos_sessions
      WHERE property_id = $1 AND business_date BETWEEN $2::date AND $3::date`, [propertyId, from, to]);
  const byDept = new Map();
  let bills = 0, value = 0, cost = 0;
  for (const { c } of rows) {
    if (!c) continue;
    bills += c.bills || 0; value += Number(c.value) || 0; cost += Number(c.cost) || 0;
    for (const d of c.by_department || []) {
      const x = byDept.get(d.department) || { department: d.department, bills: 0, value: 0, cost: 0 };
      x.bills += d.bills || 0; x.value += Number(d.value) || 0; x.cost += Number(d.cost) || 0;
      byDept.set(d.department, x);
    }
  }
  return { bills, value: r2(value), cost: r2(cost),
    by_department: [...byDept.values()].map(d => ({ ...d, value: r2(d.value), cost: r2(d.cost) })).sort((a, b) => b.value - a.value) };
}

// Room charges from the POS, NET (what the reports count) and as the guest saw
// it (gross), by WITA day.
async function roomChargesByDay(propertyId, from, to) {
  const { rows } = await db.query(
    `SELECT (s.created_at AT TIME ZONE 'Asia/Makassar')::date AS day, COUNT(*)::int AS bills,
            COALESCE(SUM(s.total_amount), 0) AS net, COALESCE(SUM(COALESCE(s.shown_total, s.total_amount)), 0) AS gross
       FROM sales s
      WHERE s.property_id = $1 AND s.order_source = 'external_pos'
        AND (s.created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date
      GROUP BY 1`, [propertyId, from, to]);
  return new Map(rows.map(r => [ymd(r.day), { bills: r.bills, net: r2(r.net), gross: r2(r.gross) }]));
}

// Paid at the restaurant (from sessions) + charged to rooms (from sales), over a period.
async function takings(propertyId, from, to) {
  const { rows: [s] } = await db.query(
    `SELECT COALESCE(SUM(outlet_net), 0) AS net, COALESCE(SUM(outlet_total), 0) AS gross, COALESCE(SUM(outlet_bills), 0)::int AS bills
       FROM pos_sessions WHERE property_id = $1 AND business_date BETWEEN $2::date AND $3::date`, [propertyId, from, to]);
  const rc = await roomChargesByDay(propertyId, from, to);
  const room = [...rc.values()].reduce((a, v) => ({ bills: a.bills + v.bills, net: a.net + v.net, gross: a.gross + v.gross }), { bills: 0, net: 0, gross: 0 });
  const bills = s.bills + room.bills;
  return {
    outlet: { bills: s.bills, net: r2(s.net), gross: r2(s.gross) },
    rooms: { bills: room.bills, net: r2(room.net), gross: r2(room.gross) },
    net: r2(parseFloat(s.net) + room.net), gross: r2(parseFloat(s.gross) + room.gross), bills,
    average_bill: bills ? r2((parseFloat(s.gross) + room.gross) / bills) : null,
  };
}

router.get('/overview', gate, async (req, res) => {
  try {
    const today = todayWITA();
    const date = isDate(req.query.date) ? req.query.date : today;
    const pid = req.propertyId;
    const monthStart = date.slice(0, 8) + '01';
    const prevMonthStart = addDays(monthStart, -1).slice(0, 8) + '01';
    const prevSameDay = (() => { const d = addDays(prevMonthStart, parseInt(date.slice(8), 10) - 1); return d.slice(0, 7) === prevMonthStart.slice(0, 7) ? d : addDays(monthStart, -1); })();

    const { rows: sess } = await db.query(
      'SELECT * FROM pos_sessions WHERE property_id = $1 AND business_date = $2', [pid, date]);
    const sessions = KEYS.map(k => { const s = sess.find(x => x.session_key === k); return s ? sessionRow(s) : { session: k, label: LABEL[k], sent_at: null }; });

    const [day, lastWeek, month, prevMonth] = await Promise.all([
      takings(pid, date, date), takings(pid, addDays(date, -7), addDays(date, -7)),
      takings(pid, monthStart, date), takings(pid, prevMonthStart, prevSameDay),
    ]);

    // Breakfast: expected from the bookings, came from the POS breakfast session.
    const { loadKitchen } = require('./bookings');
    const kitchen = await loadKitchen(pid, date);
    const bf = sess.find(x => x.session_key === 'breakfast');
    const breakfast = { expected: kitchen.breakfast.pax, rooms: kitchen.breakfast.rooms,
      came: bf ? bf.breakfast_pax_came : null, not_came: bf?.summary?.breakfast?.not_came || [],
      // Sent by the POS since its breakfast recap: buffet / à la carte and the
      // NET value of the included breakfasts eaten.
      mode: bf?.summary?.breakfast?.mode || null, value: bf?.summary?.breakfast?.value ?? null };

    // Breakfast take-up, last 14 days (only days the POS sent breakfast).
    const { rows: trend } = await db.query(
      `SELECT business_date, breakfast_pax_expected AS expected, breakfast_pax_came AS came
         FROM pos_sessions WHERE property_id = $1 AND session_key = 'breakfast'
          AND business_date BETWEEN $2::date AND $3::date ORDER BY business_date`, [pid, addDays(date, -13), date]);

    // Sessions not sent, last 7 days before the date: a day with any POS
    // activity (a session or a room charge) but a missing session.
    const from7 = addDays(date, -7), to7 = addDays(date, -1);
    const { rows: sent7 } = await db.query(
      `SELECT business_date, array_agg(session_key) AS keys FROM pos_sessions
        WHERE property_id = $1 AND business_date BETWEEN $2::date AND $3::date GROUP BY 1`, [pid, from7, to7]);
    const rc7 = await roomChargesByDay(pid, from7, to7);
    const sentMap = new Map(sent7.map(r => [ymd(r.business_date), r.keys]));
    const missing = [];
    for (let d = from7; d <= to7; d = addDays(d, 1)) {
      const keys = sentMap.get(d) || [];
      if (!keys.length && !rc7.has(d)) continue;
      const miss = KEYS.filter(k => !keys.includes(k));
      if (miss.length) missing.push({ date: d, sessions: miss.map(k => LABEL[k]) });
    }

    // Top items, last 7 days up to the date (from the bills the POS sent).
    const { rows: recent } = await db.query(
      `SELECT summary->'bill_list' AS bills FROM pos_sessions
        WHERE property_id = $1 AND business_date BETWEEN $2::date AND $3::date`, [pid, addDays(date, -6), date]);
    const items = new Map();
    for (const r of recent) for (const b of (r.bills || [])) for (const i of (b.items || [])) {
      if (i.included) continue;   // included breakfast (Rp 0) — not a sale
      const it = items.get(i.name) || { name: i.name, qty: 0, amount: 0 };
      it.qty += parseInt(i.qty, 10) || 0; it.amount += parseFloat(i.amount) || 0;
      items.set(i.name, it);
    }
    const topItems = [...items.values()].sort((a, b) => b.qty - a.qty).slice(0, 10).map(i => ({ ...i, amount: r2(i.amount) }));

    // F&B share of the hotel's revenue this month (same figures as Reports).
    const { getReport } = require('./reports');
    const rep = await getReport(pid, monthStart, date);
    const fnbShare = rep.total_revenue > 0 ? {
      fnb: r2(rep.fnb_revenue), total: r2(rep.total_revenue), share: Math.round((rep.fnb_revenue / rep.total_revenue) * 1000) / 10,
      breakdown: rep.fnb_breakdown,
    } : null;

    res.json({
      date, today, sessions, day, last_week: lastWeek, month, prev_month: prevMonth,
      month_from: monthStart, prev_month_from: prevMonthStart, prev_month_to: prevSameDay,
      breakfast, breakfast_trend: trend.map(t => ({ date: ymd(t.business_date), expected: t.expected, came: t.came })),
      missing, top_items: topItems, fnb_share: fnbShare,
      complimentary: { day: await complimentary(pid, date, date), month: await complimentary(pid, monthStart, date) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions', gate, async (req, res) => {
  const p = range(req.query);
  if (p.error) return res.status(400).json({ error: p.error });
  try {
    const { rows } = await db.query(
      `SELECT * FROM pos_sessions WHERE property_id = $1 AND business_date BETWEEN $2::date AND $3::date
        ORDER BY business_date DESC, CASE session_key WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 ELSE 3 END`,
      [req.propertyId, p.from, p.to]);
    res.json({ from: p.from, to: p.to, sessions: rows.map(sessionRow) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions/:id', gate, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
  try {
    const { rows: [s] } = await db.query('SELECT * FROM pos_sessions WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const { rows: versions } = await db.query(
      `SELECT version, sent_by, sent_at, changes,
              (summary->'outlet'->>'total')::numeric AS outlet_total, (summary->>'bills')::int AS bills
         FROM pos_session_versions WHERE session_id = $1 ORDER BY version DESC`, [s.id]);
    const sum = s.summary || {};
    res.json({
      ...sessionRow(s),
      by_method: sum.by_method || [], categories: sum.categories || [], discounts: sum.discounts || 0,
      open_bills: sum.open_bills || null, breakfast: sum.breakfast || null, complimentary: sum.complimentary || null,
      room_charges: sum.room_charges?.list || [], bill_list: sum.bill_list || null,
      versions: versions.map(v => ({ version: v.version, sent_by: v.sent_by, sent_at: v.sent_at, changes: v.changes,
        outlet_total: r2(v.outlet_total), bills: v.bills })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/kitchen', gate, async (req, res) => {
  try {
    const { loadKitchen } = require('./bookings');
    const data = await loadKitchen(req.propertyId, req.query.date);
    if (!data) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const { rows: [bf] } = await db.query(
      `SELECT breakfast_pax_came, sent_at, summary->'breakfast' AS breakfast FROM pos_sessions
        WHERE property_id = $1 AND business_date = $2 AND session_key = 'breakfast'`, [req.propertyId, data.date]);
    data.breakfast.came = bf ? { pax: bf.breakfast_pax_came, rooms: bf.breakfast?.rooms_came ?? null,
      not_came: bf.breakfast?.not_came || [], sent_at: bf.sent_at } : null;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POS room charges vs the folios: each charge the PMS received (sales with
// order_source 'external_pos') and whether its folio line is still there, plus
// room charges a POS session lists that never reached the PMS.
router.get('/room-charges', gate, async (req, res) => {
  const p = range(req.query, 7);
  if (p.error) return res.status(400).json({ error: p.error });
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.created_at, s.external_ref, s.description, s.total_amount AS net,
              COALESCE(s.shown_total, s.total_amount) AS gross, s.booking_id,
              g.name AS guest_name, u.name AS room, b.status AS booking_status,
              fc.id AS folio_charge_id, fc.is_voided, fc.voided_at, s.pos_void_sent_at
         FROM sales s
         LEFT JOIN bookings b ON b.id = s.booking_id
         LEFT JOIN guests g ON g.id = b.guest_id
         LEFT JOIN units u ON u.id = b.unit_id
         LEFT JOIN folio_charges fc ON fc.sale_id = s.id
        WHERE s.property_id = $1 AND s.order_source = 'external_pos'
          AND (s.created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date
        ORDER BY s.created_at DESC`, [req.propertyId, p.from, p.to]);
    const { rows: sess } = await db.query(
      `SELECT business_date, session_key, summary->'room_charges'->'list' AS list FROM pos_sessions
        WHERE property_id = $1 AND business_date BETWEEN $2::date AND $3::date`, [req.propertyId, p.from, p.to]);
    const inSession = new Map();
    for (const s of sess) for (const rc of (s.list || [])) inSession.set(rc.id, { date: ymd(s.business_date), session: LABEL[s.session_key], total: r2(rc.total), room: rc.room, guest: rc.guest });
    // A bill charged to a room again after the hotel voided it carries
    // "<POS bill id>~<n>" (migration 095); the POS session lists the bill id.
    const base = ref => String(ref || '').replace(/~\d+$/, '');
    const refs = new Set(rows.map(r => base(r.external_ref)).filter(Boolean));
    const charges = rows.map(r => {
      const sessionHit = r.external_ref && !r.is_voided ? inSession.get(base(r.external_ref)) : null;
      const problems = [];
      if (!r.folio_charge_id) problems.push('Not on the folio');
      else if (r.is_voided && !r.pos_void_sent_at) problems.push('Voided on the folio — the POS was not told');
      if (sessionHit && Math.abs(sessionHit.total - r2(r.gross)) > 1) problems.push(`POS says ${sessionHit.total}`);
      return { id: r.id, created_at: r.created_at, pos_ref: r.external_ref, description: r.description,
        net: r2(r.net), gross: r2(r.gross), booking_id: r.booking_id, guest_name: r.guest_name, room: r.room,
        booking_status: r.booking_status, folio: !r.folio_charge_id ? 'missing' : r.is_voided ? 'voided' : 'posted',
        pos_reopened: !!r.pos_void_sent_at,
        session: sessionHit ? `${sessionHit.session} ${sessionHit.date}` : null, problems };
    });
    const missingInPms = [...inSession.entries()].filter(([id]) => !refs.has(id))
      .map(([id, v]) => ({ pos_ref: id, ...v }));
    res.json({ from: p.from, to: p.to, charges, missing_in_pms: missingInPms,
      problems: charges.filter(c => c.problems.length).length + missingInPms.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
