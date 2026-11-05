// Restaurant → Bills: every POS bill of a period in bill-number order, with
// each missing number explained — for the accountant, who ticks off the
// restaurant's printed bills day by day and asks about every gap.
//
// Sources:
//   - the POS's own list of every number it gave out (GET /api/hotel/bill-numbers,
//     hotel key): paid bills of every kind, bills reopened by a hotel void, and
//     bills deleted after they had a number (kept since POS 2026-11-05 with who
//     and why). Included breakfasts and complimentary bills are numbered too,
//     but never in a session's bill list.
//   - pos_sessions: the bills as the POS sent them to the hotel (details).
//   - sales / event_charges: what became of a bill charged to a room / an event.
// When the POS can't be reached the page still lists the sessions' bills and
// marks gaps it can't explain.
//
// A number is PREFIX-NNNNN/MM/YY, counted per calendar month of payment.
const db = require('../db');
const posRoomOrders = require('./posRoomOrders');

const KEYS = ['breakfast', 'lunch', 'dinner'];
const LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const NO = /^(.*)-(\d+)\/(\d{2})\/(\d{2})$/;
const n2 = v => (v == null ? null : Math.round(Number(v) * 100) / 100);
const base = ref => String(ref || '').replace(/~\d+$/, '');
const addDays = (d, k) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const ymd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const lastOfMonth = (yy, mm) => new Date(Date.UTC(2000 + yy, mm, 0)).toISOString().slice(0, 10);

function parseNo(billNo) {
  const m = NO.exec(String(billNo || ''));
  if (!m) return null;
  return { prefix: m[1], seq: parseInt(m[2], 10), mm: m[3], yy: m[4], width: m[2].length, run: `${m[1]}|${m[3]}/${m[4]}` };
}
const formatNo = (p, seq) => `${p.prefix}-${String(seq).padStart(Math.max(5, p.width), '0')}/${p.mm}/${p.yy}`;

// What kind of bill, for the method column and the filters.
function groupOf(method) {
  if (method === 'Room Charge') return 'room';
  if (method === 'Event Charge') return 'event';
  if (method === 'Breakfast') return 'breakfast';
  if (method === 'Complimentary') return 'comp';
  return 'outlet';
}

async function posList(propertyId, from, to) {
  const cfg = await posRoomOrders.config(propertyId);
  if (!cfg.url || !cfg.key) return { pos: null, pos_error: 'The POS link is not set up (Property Details → POS Integration → Room tablet orders)' };
  try {
    // numbers of the month before too: a bill paid just after midnight on the
    // 1st has next month's number but counts on the last day of the month
    const r = await posRoomOrders.call(cfg, 'GET', `/api/hotel/bill-numbers?from=${addDays(from, -1)}&to=${to}`, null, { timeoutMs: 15000 });
    if (!r || !Array.isArray(r.bills)) return { pos: null, pos_error: 'The POS answered without a bill list — update the POS' };
    return { pos: r, pos_error: null };
  } catch (err) {
    if (err.status === 404) return { pos: null, pos_error: 'The POS does not have the bill list yet — update the POS' };
    return { pos: null, pos_error: `The POS could not be reached: ${err.message}` };
  }
}

async function buildBills(propertyId, from, to, today) {
  const [{ rows: sessions }, { pos, pos_error }] = await Promise.all([
    db.query(
      `SELECT id, business_date, session_key, sent_at, sent_by, send_count, summary FROM pos_sessions
        WHERE property_id = $1 AND business_date BETWEEN $2::date - 1 AND $3::date + 1`, [propertyId, from, to]),
    posList(propertyId, from, to),
  ]);
  const inRange = d => d && d >= from && d <= to;

  // ── The sessions' bills, by POS bill id ──
  const sessionBill = new Map();
  const sessionByKey = new Map();
  for (const s of sessions) {
    const d = ymd(s.business_date);
    sessionByKey.set(`${d}:${s.session_key}`, s);
    for (const b of s.summary?.bill_list || []) {
      sessionBill.set(b.id, { ...b, date: d, session: s.session_key, session_id: s.id });
    }
    for (const c of s.summary?.complimentary?.list || []) {
      if (!sessionBill.has(c.id)) sessionBill.set(c.id, { id: c.id, paid_at: c.paid_at, method: 'Complimentary', cashier: c.cashier,
        table: c.table || null, total: 0, comp: { value: c.value, department: c.department, for: c.for, reason: c.reason },
        items: c.items || [], date: d, session: s.session_key, session_id: s.id });
    }
  }

  // ── The rows ──
  const rows = [];
  const add = r => rows.push(r);
  const fromSession = (b, extra = {}) => ({
    kind: 'bill', id: b.id, bill_no: b.bill_no || null, date: b.date, session: b.session, session_id: b.session_id,
    paid_at: b.paid_at, opened_at: b.opened_at || null, method: b.method, group: groupOf(b.method),
    table: b.table || null, room: b.room || null, guest: b.guest || null, cashier: b.cashier || null,
    subtotal: n2(b.subtotal), discount: n2(b.discount), discount_label: b.discount_label || null,
    service: n2(b.service), tax: n2(b.tax), total: n2(b.total), comp: b.comp || null, items: b.items || [], in_session: true, ...extra,
  });

  if (pos) {
    const posById = new Map(pos.bills.map(b => [b.id, b]));
    // Which number runs (prefix + month) the period touches, and their lowest
    // and highest number among bills that count in the period.
    const runs = new Map();
    const runOf = p => { if (!runs.has(p.run)) runs.set(p.run, { p, seqs: new Map(), lo: Infinity, hi: -Infinity }); return runs.get(p.run); };
    const all = [
      ...pos.bills.map(b => ({ ...b, _kind: b.status === 'paid' ? 'bill' : 'open' })),
      ...pos.deleted.map(d => ({ ...d, _kind: 'deleted' })),
    ];
    for (const b of all) {
      const p = parseNo(b.bill_no);
      if (!p) continue;
      const run = runOf(p);
      if (!run.seqs.has(p.seq)) run.seqs.set(p.seq, []);
      run.seqs.get(p.seq).push(b);
      // counts in the period: paid on a business day in it, or (reopened /
      // deleted) its number sits between bills that do
      if ((b._kind === 'bill' || b._kind === 'deleted') && inRange(b.business_date)) { run.lo = Math.min(run.lo, p.seq); run.hi = Math.max(run.hi, p.seq); }
    }
    for (const run of runs.values()) {
      if (run.hi === -Infinity) continue;
      const { p } = run;
      const monthStart = `20${p.yy}-${p.mm}-01`;
      // the period covers the month's first day → every number from 1
      if (monthStart >= from && monthStart <= to) run.lo = 1;
      // the period runs to the month's end (or today) → numbers after the last
      // paid one that were reopened / deleted belong here too
      const monthEnd = lastOfMonth(+p.yy, +p.mm);
      const tail = (monthEnd <= to || (today && today <= to)) ? Math.max(run.hi, ...run.seqs.keys()) : run.hi;
      for (let seq = run.lo; seq <= tail; seq++) {
        const found = run.seqs.get(seq) || [];
        const paid = found.find(b => b._kind === 'bill');
        const open = found.find(b => b._kind === 'open');
        const deleted = found.find(b => b._kind === 'deleted');
        const no = formatNo(p, seq);
        if (paid) {
          const s = sessionBill.get(paid.id);
          const elsewhere = !inRange(paid.business_date) ? paid.business_date : null;
          if (s) add(fromSession(s, { bill_no: paid.bill_no, counts_on: elsewhere, hotel_void: paid.hotel_void || null }));
          else {
            add({ kind: 'bill', id: paid.id, bill_no: paid.bill_no, date: paid.business_date, session: null, session_id: null,
              paid_at: paid.paid_at, opened_at: paid.opened_at, method: paid.method, group: groupOf(paid.method),
              table: paid.table, room: paid.room, guest: paid.guest, cashier: paid.cashier,
              subtotal: null, discount: n2(paid.discount), discount_label: null, service: n2(paid.service), tax: n2(paid.tax),
              total: n2(paid.total), comp: paid.comp, items: paid.items || [], in_session: false, counts_on: elsewhere,
              hotel_void: paid.hotel_void || null });
          }
        } else if (open) {
          add({ kind: 'open', id: open.id, bill_no: open.bill_no, date: null, opened_at: open.opened_at, method: null, group: 'open',
            table: open.table, room: open.room, guest: open.guest, cashier: open.cashier, total: n2(open.total), items: open.items || [],
            hotel_void: open.hotel_void || null, in_session: false });
        } else if (deleted) {
          add({ kind: 'deleted', id: deleted.id, bill_no: deleted.bill_no, date: deleted.business_date, paid_at: deleted.paid_at,
            opened_at: deleted.opened_at, method: deleted.method, group: 'deleted', table: deleted.table, room: deleted.room,
            guest: deleted.guest, cashier: deleted.cashier, total: n2(deleted.total), items: deleted.items || [],
            deleted: { reason: deleted.reason, by: deleted.deleted_by, role: deleted.deleted_role, at: deleted.deleted_at,
              status: deleted.status_when_deleted }, in_session: false });
        } else {
          add({ kind: 'missing', bill_no: no, group: 'missing', in_session: false });
        }
      }
    }
    // Paid bills with no number (paid before the POS numbered bills) that count in the period
    for (const b of pos.bills) {
      if (!b.bill_no && b.status === 'paid' && inRange(b.business_date)) {
        const s = sessionBill.get(b.id);
        if (s) add(fromSession(s));
      }
    }
    // Sessions' bills the POS no longer has (e.g. deleted before the POS kept deleted bills)
    const seen = new Set(rows.map(r => r.id).filter(Boolean));
    for (const b of sessionBill.values()) {
      if (inRange(b.date) && !seen.has(b.id) && !posById.has(b.id)) add(fromSession(b, { gone_from_pos: true }));
    }
  } else {
    // POS not reachable: the sessions' bills only, gaps unexplained
    const runs = new Map();
    for (const b of sessionBill.values()) {
      if (!inRange(b.date)) continue;
      add(fromSession(b));
      const p = parseNo(b.bill_no);
      if (p) { const r = runs.get(p.run) || { p, seqs: new Set() }; r.seqs.add(p.seq); runs.set(p.run, r); }
    }
    for (const { p, seqs } of runs.values()) {
      const list = [...seqs];
      for (let seq = Math.min(...list); seq <= Math.max(...list); seq++) {
        if (!seqs.has(seq)) add({ kind: 'missing', bill_no: formatNo(p, seq), group: 'missing', in_session: false, unchecked: true });
      }
    }
  }

  // ── What became of bills charged to a room / an event ──
  const chargeIds = rows.filter(r => r.kind === 'bill' && (r.group === 'room' || r.group === 'event')).map(r => r.id);
  if (chargeIds.length) {
    const [{ rows: sales }, { rows: evs }] = await Promise.all([
      db.query(
        `SELECT s.external_ref, s.booking_id, fc.id AS folio_id, fc.is_voided, u.name AS room, g.name AS guest
           FROM sales s LEFT JOIN folio_charges fc ON fc.sale_id = s.id
           LEFT JOIN bookings b ON b.id = s.booking_id LEFT JOIN units u ON u.id = b.unit_id LEFT JOIN guests g ON g.id = b.guest_id
          WHERE s.property_id = $1 AND s.order_source = 'external_pos' AND split_part(s.external_ref, '~', 1) = ANY($2::text[])
          ORDER BY s.created_at`, [propertyId, chargeIds]),
      db.query(
        `SELECT c.external_ref, c.event_id, c.is_voided, e.event_no, e.name FROM event_charges c JOIN events e ON e.id = c.event_id
          WHERE c.property_id = $1 AND c.type = 'pos' AND split_part(c.external_ref, '~', 1) = ANY($2::text[])
          ORDER BY c.created_at`, [propertyId, chargeIds]),
    ]);
    const by = new Map();
    for (const s of sales) {
      const k = base(s.external_ref); if (!by.has(k)) by.set(k, []);
      by.get(k).push({ kind: 'room', live: !!s.folio_id && !s.is_voided, booking_id: s.booking_id, room: s.room, guest: s.guest });
    }
    for (const c of evs) {
      const k = base(c.external_ref); if (!by.has(k)) by.set(k, []);
      by.get(k).push({ kind: 'event', live: !c.is_voided, event_id: c.event_id, event: `Event #${c.event_no}`, name: c.name });
    }
    for (const r of rows) {
      if (!(r.kind === 'bill' && (r.group === 'room' || r.group === 'event'))) continue;
      const list = by.get(r.id) || [];
      const live = list.find(x => x.live);
      const last = live || list[list.length - 1];
      r.charge = !last ? { status: 'not_in_pms' }
        : { status: live ? 'posted' : 'voided', times: list.length, ...last };
    }
  }

  // ── Order: by number run, then number; bills with no number at the end ──
  rows.sort((a, b) => {
    const pa = parseNo(a.bill_no), pb = parseNo(b.bill_no);
    if (pa && pb) return (`20${pa.yy}${pa.mm}`.localeCompare(`20${pb.yy}${pb.mm}`)) || pa.prefix.localeCompare(pb.prefix) || pa.seq - pb.seq;
    if (pa) return -1; if (pb) return 1;
    return String(a.paid_at || '').localeCompare(String(b.paid_at || ''));
  });

  // ── Sessions not sent (days up to today) ──
  const notSent = [];
  for (let d = from; d <= to && (!today || d <= today); d = addDays(d, 1)) {
    for (const k of KEYS) if (!sessionByKey.has(`${d}:${k}`)) notSent.push({ date: d, session: k, label: LABEL[k] });
  }

  const count = f => rows.filter(f).length;
  const numbered = rows.filter(r => parseNo(r.bill_no));
  const sum = f => n2(rows.filter(f).reduce((a, r) => a + (Number(r.total) || 0), 0));
  return {
    from, to, pos_checked: !!pos, pos_error,
    first: numbered[0]?.bill_no || null, last: numbered[numbered.length - 1]?.bill_no || null,
    summary: {
      bills: count(r => r.kind === 'bill'),
      outlet: { bills: count(r => r.kind === 'bill' && r.group === 'outlet'), total: sum(r => r.kind === 'bill' && r.group === 'outlet') },
      room: { bills: count(r => r.kind === 'bill' && r.group === 'room'), total: sum(r => r.kind === 'bill' && r.group === 'room') },
      event: { bills: count(r => r.kind === 'bill' && r.group === 'event'), total: sum(r => r.kind === 'bill' && r.group === 'event') },
      breakfast: count(r => r.kind === 'bill' && r.group === 'breakfast'),
      comp: count(r => r.kind === 'bill' && r.group === 'comp'),
      open: count(r => r.kind === 'open'),
      deleted: count(r => r.kind === 'deleted'),
      missing: count(r => r.kind === 'missing'),
      not_in_session: count(r => r.kind === 'bill' && !r.in_session && r.group !== 'breakfast' && r.group !== 'comp'),
      charge_problems: count(r => r.charge && r.charge.status !== 'posted'),
    },
    sessions_not_sent: notSent,
    rows,
  };
}

const METHOD_TEXT = { Breakfast: 'Included breakfast (no payment)', Complimentary: 'Complimentary' };
const wita = iso => (iso ? new Date(new Date(iso).getTime() + 8 * 3600e3) : null);
const fmtDay = d => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

// One line saying what a row is — the Excel's "What it is" column. The page
// says the same in its own words (RestaurantBills.jsx).
function describe(r) {
  if (r.kind === 'missing') return r.unchecked ? 'Not in any session sent to the hotel — could not ask the POS'
    : 'No record in the POS (deleted before the POS kept deleted bills)';
  if (r.kind === 'deleted') return `Deleted in the POS by ${r.deleted.by || 'someone'}${r.deleted.role ? ` (${r.deleted.role})` : ''} on ${fmtDay(wita(r.deleted.at)?.toISOString().slice(0, 10))}: ${r.deleted.reason}`;
  if (r.kind === 'open') return `Reopened in the POS after the hotel voided its charge${r.hotel_void?.reason ? ` (${r.hotel_void.reason})` : ''} — not settled again yet`;
  const parts = [];
  if (r.group === 'room') parts.push(`Charged to room ${r.charge?.room || r.room || ''}${r.charge?.guest || r.guest ? ` · ${r.charge?.guest || r.guest}` : ''}`);
  else if (r.group === 'event') parts.push(`Charged to ${r.charge?.event || 'an event'}${r.charge?.name ? ` · ${r.charge.name}` : ''}`);
  else if (r.group === 'comp') parts.push(`Complimentary — ${r.comp?.department || ''}${r.comp?.for ? ` for ${r.comp.for}` : ''}${r.comp?.reason ? ` (${r.comp.reason})` : ''}`);
  else if (r.group === 'breakfast') parts.push('Included breakfast (no payment)');
  else parts.push(`Paid at the restaurant · ${r.method}`);
  if (r.charge?.status === 'voided') parts.push('the hotel voided the charge');
  if (r.charge?.status === 'not_in_pms') parts.push('never reached the PMS');
  if (r.counts_on) parts.push(`counts on ${fmtDay(r.counts_on)}`);
  if (!r.in_session && r.group !== 'breakfast' && r.group !== 'comp') parts.push(r.gone_from_pos ? 'no longer in the POS' : 'not in a session sent to the hotel yet');
  return parts.join(' · ');
}

async function buildBillsXlsx(b, property) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Bills', { views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  ws.getCell('A1').value = `${property} — Restaurant bills`; ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `${b.from} to ${b.to} · in bill-number order · times WITA${b.pos_checked ? '' : ` · ${b.pos_error}`}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };
  const cols = [['Bill no.', 20], ['Day', 12], ['Session', 11], ['Paid at', 17], ['Table', 14], ['Room', 9], ['Guest', 22],
    ['Method', 16], ['Cashier', 14], ['Total', 14], ['What it is', 70]];
  const h = ws.getRow(4);
  cols.forEach(([t, w], i) => { const c = h.getCell(i + 1); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B1E2E' } }; ws.getColumn(i + 1).width = w; });
  ws.getColumn(4).numFmt = 'dd/mm/yyyy hh:mm'; ws.getColumn(2).numFmt = 'dd/mm/yyyy'; ws.getColumn(10).numFmt = '#,##0;[Red]-#,##0';
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  for (const r of b.rows) {
    const row = ws.addRow([r.bill_no || r.id || '', r.date ? new Date(r.date + 'T00:00:00Z') : null, r.session ? LABEL[r.session] : '',
      wita(r.paid_at), r.table || '', r.charge?.room || r.room || '', r.charge?.guest || r.guest || '',
      r.kind === 'bill' ? (METHOD_TEXT[r.method] || r.method) : r.kind === 'deleted' ? 'DELETED' : r.kind === 'open' ? 'REOPENED' : 'MISSING',
      r.cashier || '', r.total == null ? null : Number(r.total), describe(r)]);
    if (r.kind !== 'bill' || (r.charge && r.charge.status !== 'posted')) {
      row.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE7E7' } }; });
    }
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { buildBills, buildBillsXlsx, describe, parseNo, groupOf };
