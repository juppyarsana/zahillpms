// Restaurant report — what the restaurant took over a period, for the
// accountant to check restaurant revenue. One builder for the page
// (Restaurant → Report) and the Excel (services/restaurantReportXlsx.js), so
// the two can never disagree.
//
// Sources:
//   - pos_sessions: each Breakfast / Lunch / Dinner the POS sent (business day,
//     every bill, payment methods, complimentary, breakfast). Bills paid at the
//     restaurant (outlet_*) count on the session's business day.
//   - sales with order_source 'external_pos': POS bills charged to a room, on
//     the WITA day the PMS got them; only those still on the folio count.
//   - event_charges type 'pos': POS bills charged to an event, not voided.
// Net = what Reports and the journal count as F&B restaurant revenue
// (routes/reports.js SALES_SQL / SALE_OFF_BILL_SQL, routes/restaurant.js takings()).
const db = require('../db');

const KEYS = ['breakfast', 'lunch', 'dinner'];
const LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const n = v => Math.round((Number(v) || 0) * 100) / 100;
const base = ref => String(ref || '').replace(/~\d+$/, '');
const addDays = (d, k) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
function daysBetween(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }

// A session's own totals add up: the bills listed, the payment methods and
// restaurant + rooms + events (all as the guest paid, incl. service & tax).
function sessionCheck(s) {
  const sm = s.summary || {};
  const billsTotal = (sm.bill_list || []).reduce((a, b) => a + n(b.total), 0);
  const methodsTotal = (sm.by_method || []).reduce((a, m) => a + n(m.total), 0);
  const parts = n(s.outlet_total) + n(s.room_charge_total) + n(sm.event_charges?.total);
  const hasList = Array.isArray(sm.bill_list);
  const ok = Math.abs(methodsTotal - parts) <= 1 && (!hasList || Math.abs(billsTotal - methodsTotal) <= 1);
  return { bills_total: n(billsTotal), methods_total: n(methodsTotal), parts_total: n(parts), has_bill_list: hasList, ok };
}

async function buildRestaurantReport(propertyId, from, to, { withDetail = false } = {}) {
  const [{ rows: sessions }, { rows: roomSales }, { rows: eventCharges }, { rows: nearby }, { rows: [prop] }] = await Promise.all([
    db.query(
      `SELECT *, business_date::text AS d FROM pos_sessions
        WHERE property_id = $1 AND business_date BETWEEN $2::date AND $3::date`, [propertyId, from, to]),
    // Room charges the PMS got in the period (the revenue) or a day either
    // side (to match bills paid after midnight against their session).
    db.query(
      `SELECT s.id, s.created_at, (s.created_at AT TIME ZONE 'Asia/Makassar')::date::text AS day, s.external_ref,
              s.pos_bill_no, s.description, s.total_amount AS net, COALESCE(s.shown_total, s.total_amount) AS gross,
              g.name AS guest, u.name AS room, fc.id AS folio_id, fc.is_voided
         FROM sales s
         LEFT JOIN bookings b ON b.id = s.booking_id LEFT JOIN guests g ON g.id = b.guest_id
         LEFT JOIN units u ON u.id = b.unit_id LEFT JOIN folio_charges fc ON fc.sale_id = s.id
        WHERE s.property_id = $1 AND s.order_source = 'external_pos'
          AND (s.created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date
        ORDER BY s.created_at`, [propertyId, addDays(from, -1), addDays(to, 1)]),
    db.query(
      `SELECT c.id, c.created_at, (c.created_at AT TIME ZONE 'Asia/Makassar')::date::text AS day, c.external_ref,
              c.pos_bill_no, c.description, c.amount AS net, c.is_voided, e.event_no, e.name AS event_name,
              COALESCE(c.shown_total, c.amount * (1 + COALESCE(e.bill_service_charge_rate, 0) / 100.0)
                * (1 + COALESCE(e.bill_tax_rate, 0) / 100.0)) AS gross
         FROM event_charges c JOIN events e ON e.id = c.event_id
        WHERE c.property_id = $1 AND c.type = 'pos'
          AND (c.created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date
        ORDER BY c.created_at`, [propertyId, addDays(from, -1), addDays(to, 1)]),
    // Bills listed by the sessions a day either side, so a charge the PMS got
    // just after midnight isn't reported as "in no session".
    db.query(
      `SELECT summary->'room_charges'->'list' AS rooms, summary->'event_charges'->'list' AS events FROM pos_sessions
        WHERE property_id = $1 AND business_date IN ($2::date - 1, $3::date + 1)`, [propertyId, from, to]),
    db.query(
      `SELECT COALESCE(NULLIF(ps.property_name, ''), p.name) AS name FROM properties p
         LEFT JOIN property_settings ps ON ps.property_id = p.id WHERE p.id = $1`, [propertyId]),
  ]);
  sessions.sort((a, b) => a.d.localeCompare(b.d) || KEYS.indexOf(a.session_key) - KEYS.indexOf(b.session_key));
  const inPeriod = x => x.day >= from && x.day <= to;
  const live = x => (x.folio_id !== undefined ? x.folio_id && !x.is_voided : !x.is_voided);

  // ── Revenue ──
  const outlet = { bills: 0, net: 0, service: 0, tax: 0, total: 0 };
  for (const s of sessions) {
    outlet.bills += s.outlet_bills || 0; outlet.net += n(s.outlet_net); outlet.service += n(s.outlet_service);
    outlet.tax += n(s.outlet_tax); outlet.total += n(s.outlet_total);
  }
  const sumLive = list => {
    const t = { bills: 0, net: 0, total: 0 };
    for (const x of list) if (inPeriod(x) && live(x)) { t.bills++; t.net += n(x.net); t.total += n(x.gross); }
    return { bills: t.bills, net: n(t.net), service_tax: n(t.total - t.net), total: n(t.total) };
  };
  const rooms = sumLive(roomSales), events = sumLive(eventCharges);
  const o = { bills: outlet.bills, net: n(outlet.net), service_tax: n(outlet.service + outlet.tax), service: n(outlet.service), tax: n(outlet.tax), total: n(outlet.total) };
  const totalNet = n(o.net + rooms.net + events.net), totalGross = n(o.total + rooms.total + events.total);
  const totalBills = o.bills + rooms.bills + events.bills;

  // ── Payment methods, sessions, not revenue, breakfast ──
  const methods = new Map();
  const bySession = Object.fromEntries(KEYS.map(k => [k, { key: k, label: LABEL[k], sessions: 0, bills: 0, total: 0 }]));
  let discounts = 0, openBills = 0, bfExpected = 0, bfCame = 0;
  const comp = { bills: 0, value: 0, cost: 0, by_department: new Map() };
  for (const s of sessions) {
    const sm = s.summary || {};
    for (const m of sm.by_method || []) {
      const x = methods.get(m.method) || { method: m.method, bills: 0, total: 0 };
      x.bills += m.bills || 0; x.total += n(m.total); methods.set(m.method, x);
    }
    const bs = bySession[s.session_key];
    if (bs) { bs.sessions++; bs.bills += sm.bills || 0; bs.total += n(s.outlet_total) + n(s.room_charge_total) + n(sm.event_charges?.total); }
    discounts += n(sm.discounts); openBills += n(sm.open_bills?.total);
    bfExpected += s.breakfast_pax_expected || 0; bfCame += s.breakfast_pax_came || 0;
    const c = sm.complimentary;
    if (c) {
      comp.bills += c.bills || 0; comp.value += n(c.value); comp.cost += n(c.cost);
      for (const d of c.by_department || []) {
        const x = comp.by_department.get(d.department) || { department: d.department, bills: 0, value: 0, cost: 0 };
        x.bills += d.bills || 0; x.value += n(d.value); x.cost += n(d.cost); comp.by_department.set(d.department, x);
      }
    }
  }
  const methodTotal = [...methods.values()].reduce((a, m) => a + m.total, 0);
  const special = ['Room Charge', 'Event Charge'];
  const methodList = [...methods.values()]
    .sort((a, b) => (special.indexOf(a.method) - special.indexOf(b.method)) || b.total - a.total)
    .map(m => ({ ...m, total: n(m.total), share: methodTotal ? m.total / methodTotal : 0 }));

  // ── Days ──
  const byKey = new Map(sessions.map(s => [`${s.d}:${s.session_key}`, s]));
  const days = []; const missing = [];
  for (const d of daysBetween(from, to)) {
    const rows = [];
    for (const k of KEYS) {
      const s = byKey.get(`${d}:${k}`);
      if (!s) { missing.push({ date: d, session: k, label: LABEL[k] }); continue; }
      const sm = s.summary || {};
      rows.push({
        id: s.id, session: k, label: LABEL[k], bills: sm.bills || 0,
        outlet_bills: s.outlet_bills || 0, outlet_net: n(s.outlet_net), outlet_service: n(s.outlet_service), outlet_tax: n(s.outlet_tax),
        outlet_total: n(s.outlet_total), room_total: n(s.room_charge_total), event_total: n(sm.event_charges?.total),
        total: n(n(s.outlet_total) + n(s.room_charge_total) + n(sm.event_charges?.total)),
        methods: Object.fromEntries((sm.by_method || []).map(m => [m.method, n(m.total)])),
        discounts: n(sm.discounts), comp_value: n(sm.complimentary?.value), open_total: n(sm.open_bills?.total),
        breakfast_expected: s.breakfast_pax_expected, breakfast_came: s.breakfast_pax_came,
        sent_by: s.sent_by, sent_at: s.sent_at, send_count: s.send_count, check: sessionCheck(s),
      });
    }
    const sum = f => n(rows.reduce((a, r) => a + (r[f] || 0), 0));
    days.push({ date: d, sessions: rows, missing: KEYS.filter(k => !byKey.has(`${d}:${k}`)).map(k => LABEL[k]),
      bills: rows.reduce((a, r) => a + r.bills, 0), outlet_total: sum('outlet_total'), room_total: sum('room_total'),
      event_total: sum('event_total'), total: sum('total'), comp_value: sum('comp_value'), discounts: sum('discounts') });
  }

  // ── Room & event charges: POS vs PMS ──
  const listed = []; // every room / event bill a session in the period lists
  for (const s of sessions) {
    for (const r of s.summary?.room_charges?.list || []) listed.push({ kind: 'room', date: s.d, session: LABEL[s.session_key], ...r });
    for (const e of s.summary?.event_charges?.list || []) listed.push({ kind: 'event', date: s.d, session: LABEL[s.session_key], ...e });
  }
  const group = list => { const m = new Map(); for (const x of list) { const k = base(x.external_ref); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  const pmsRooms = group(roomSales), pmsEvents = group(eventCharges);
  const charges = [];
  const listedIds = new Set(listed.map(x => x.id));
  for (const nb of nearby) for (const x of [...(nb.rooms || []), ...(nb.events || [])]) listedIds.add(x.id);
  for (const l of listed) {
    const all = (l.kind === 'room' ? pmsRooms : pmsEvents).get(l.id) || [];
    const p = all.find(live) || all[all.length - 1];
    const status = !p ? 'not_in_pms' : live(p) ? 'posted' : (l.kind === 'room' && !p.folio_id ? 'missing' : 'voided');
    const diff = p && status === 'posted' ? n(n(p.gross) - n(l.total)) : null;
    const problem = status === 'not_in_pms' ? 'The POS charged it but the PMS never got it'
      : status === 'missing' ? 'Not on the folio'
        : status === 'voided' ? (l.kind === 'room' ? 'Folio line voided' : 'Voided on the event')
          : Math.abs(diff) > 1 ? 'Amounts differ' : null;
    charges.push({ kind: l.kind, date: l.date, session: l.session, pos_bill: l.id, bill_no: p?.pos_bill_no || null,
      room: l.kind === 'room' ? l.room : (p ? `Event #${p.event_no}` : l.event), guest: (l.kind === 'room' ? l.guest : l.name || p?.event_name || '')?.trim?.() || '',
      pos_total: n(l.total), pms_total: p ? n(p.gross) : null, pms_net: p ? n(p.net) : null, status, difference: diff, problem });
  }
  for (const p of [...roomSales.map(x => ({ ...x, kind: 'room' })), ...eventCharges.map(x => ({ ...x, kind: 'event' }))]) {
    if (!inPeriod(p) || !live(p) || listedIds.has(base(p.external_ref))) continue;
    charges.push({ kind: p.kind, date: p.day, session: null, pos_bill: p.external_ref, bill_no: p.pos_bill_no,
      room: p.kind === 'room' ? p.room : `Event #${p.event_no}`, guest: (p.kind === 'room' ? p.guest : p.event_name) || '',
      pos_total: null, pms_total: n(p.gross), pms_net: n(p.net), status: 'posted', difference: null,
      problem: 'In the PMS but in no session the POS sent' });
  }
  charges.sort((a, b) => a.date.localeCompare(b.date));

  // ── Items (top items on the page, everything in the Excel) ──
  const mix = new Map();
  for (const s of sessions) for (const b of s.summary?.bill_list || []) for (const it of b.items || []) {
    if (it.included) continue; // package breakfast at Rp 0
    const key = String(it.name || '').trim().toUpperCase();
    const m = mix.get(key) || { name: String(it.name || '').trim(), qty: 0, amount: 0, bills: new Set(), breakfast: 0, lunch: 0, dinner: 0 };
    m.qty += Number(it.qty) || 0; m.amount += n(it.amount); m.bills.add(b.id); m[s.session_key] = (m[s.session_key] || 0) + (Number(it.qty) || 0);
    mix.set(key, m);
  }
  const mixTotal = [...mix.values()].reduce((a, m) => a + m.amount, 0);
  const menu = [...mix.values()].sort((a, b) => b.amount - a.amount)
    .map(m => ({ name: m.name, qty: m.qty, breakfast: m.breakfast, lunch: m.lunch, dinner: m.dinner, bills: m.bills.size, amount: n(m.amount), share: mixTotal ? m.amount / mixTotal : 0 }));

  const badSessions = days.flatMap(d => d.sessions.filter(s => !s.check.ok).map(s => ({ date: d.date, session: s.session, label: s.label, id: s.id, ...s.check })));
  const report = {
    property: prop?.name || '', from, to,
    revenue: { outlet: o, rooms, events, total: { bills: totalBills, net: totalNet, service_tax: n(totalGross - totalNet), total: totalGross },
      average_bill: totalBills ? n(totalGross / totalBills) : null },
    methods: methodList,
    sessions: KEYS.map(k => ({ ...bySession[k], total: n(bySession[k].total), average_bill: bySession[k].bills ? n(bySession[k].total / bySession[k].bills) : null })),
    not_revenue: { discounts: n(discounts), open_bills: n(openBills),
      complimentary: { bills: comp.bills, value: n(comp.value), cost: n(comp.cost),
        by_department: [...comp.by_department.values()].map(d => ({ ...d, value: n(d.value), cost: n(d.cost) })).sort((a, b) => b.value - a.value) } },
    breakfast: { expected: bfExpected, came: bfCame },
    days,
    top_items: menu.slice(0, 10),
    checks: {
      sessions_expected: days.length * 3, sessions_sent: sessions.length, missing,
      bad_sessions: badSessions, resent: sessions.filter(s => s.send_count > 1).length,
      charge_problems: charges.filter(c => c.problem),
    },
  };
  if (withDetail) {
    report.detail = {
      menu, charges,
      bills: sessions.flatMap(s => (s.summary?.bill_list || []).map(b => ({ date: s.d, session: LABEL[s.session_key], ...b }))),
      complimentary: sessions.flatMap(s => (s.summary?.complimentary?.list || []).map(c => ({ date: s.d, session: LABEL[s.session_key], ...c }))),
    };
  }
  return report;
}

module.exports = { buildRestaurantReport, LABEL };
