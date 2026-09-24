const PDFDocument = require('pdfkit');
const { CARD_TABLE_OPEN, CARD_TABLE_CLOSE, CARD_HEIGHT, card } = require('./emailCards');
const db = require('../db');
const telegram = require('./telegramService');
const { todayWITA } = require('./roomChargeService');
const { drawDocumentHeader } = require('./pdfHeader');
const { collected } = require('./dailyClose');

// Monthly Report (Reports & Alerts, paid — smart_reports): the 1st of the
// month at 08:00 WITA, for the month that just ended — for the owner and
// their accountant. Revenue / occupancy / net income vs the month before and
// the same month last year (all from the Reports page's getReport()), money
// received by method, sources, and what agents owe. The email carries the
// files an accountant needs: a one-page PDF summary, the revenue CSV (same
// file as Reports → Export CSV) and, when there are any, the expenses CSV.

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const pctChange = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);
function monthRange(y, m) {   // m: 1–12
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${y}-${String(m).padStart(2, '0')}-${last}`, days: last };
}
function shiftMonth(y, m, delta) {
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1];
}
const monthName = (y, m) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

async function monthFigures(propertyId, y, m, sellable) {
  const { getReport } = require('../routes/reports');
  const { from, to, days } = monthRange(y, m);
  const r = await getReport(propertyId, from, to);
  const capacity = sellable * days;
  return {
    y, m, from, to, label: monthName(y, m), report: r,
    room: r.room_revenue, fnb: r.fnb_revenue, extras: r.ancillary_revenue, total: r.total_revenue,
    expenses: r.expenses_total, net_income: r.net_income,
    rooms_sold: r.total_nights, bookings: r.bookings_count,
    occupancy: capacity ? Math.round((r.total_nights / capacity) * 100) : 0,
    adr: r.total_nights ? r.room_revenue / r.total_nights : 0,
    revpar: capacity ? r.room_revenue / capacity : 0,
    by_source: r.by_source.map(s => ({ source: s.source, count: parseInt(s.count, 10), revenue: parseFloat(s.revenue) }))
      .filter(s => s.revenue > 0).sort((a, b) => b.revenue - a.revenue),
    best_day: r.daily_revenue.reduce((best, d) => {
      const total = parseFloat(d.room_revenue) + parseFloat(d.fnb_revenue) + d.ancillary_revenue;
      return total > (best?.total || 0) ? { date: String(d.date instanceof Date ? d.date.toISOString() : d.date).slice(0, 10), total } : best;
    }, null),
  };
}

function monthlyPdf(b) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawDocumentHeader(doc, b.property, { title: 'Monthly Report', refLine: b.month.label });
    const colX = [50, 250, 350, 450];
    const row = (cells, { bold = false, color = '#000' } = {}) => {
      if (doc.y > 760) doc.addPage();
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(color);
      cells.forEach((c, i) => doc.text(String(c ?? ''), colX[i], y, { width: i === 0 ? 195 : 95, align: i === 0 ? 'left' : 'right' }));
      doc.fillColor('#000');
      doc.y = y + 15;
    };
    const heading = t => {
      if (doc.y > 720) doc.addPage();
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(11).text(t, 50, doc.y);
      doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#ccc').stroke();
      doc.y += 8;
    };
    const cm = b.month, pm = b.prev, ly = b.last_year;
    const pct = v => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);

    heading('Summary');
    row(['', cm.label, pm.label, ly ? ly.label : 'Last year'], { bold: true, color: '#555' });
    row(['Room revenue', fmtIDR(cm.room), fmtIDR(pm.room), ly ? fmtIDR(ly.room) : '—']);
    row(['Meals (rate plan)', fmtIDR(cm.fnb), fmtIDR(pm.fnb), ly ? fmtIDR(ly.fnb) : '—']);
    row(['Extras', fmtIDR(cm.extras), fmtIDR(pm.extras), ly ? fmtIDR(ly.extras) : '—']);
    row(['Total revenue', fmtIDR(cm.total), fmtIDR(pm.total), ly ? fmtIDR(ly.total) : '—'], { bold: true });
    if (b.has_expenses) {
      row(['Expenses', fmtIDR(cm.expenses), fmtIDR(pm.expenses), ly ? fmtIDR(ly.expenses) : '—']);
      row(['Net income', fmtIDR(cm.net_income), fmtIDR(pm.net_income), ly ? fmtIDR(ly.net_income) : '—'], { bold: true });
    }
    row(['Occupancy', `${cm.occupancy}%`, `${pm.occupancy}%`, ly ? `${ly.occupancy}%` : '—']);
    row(['Room-nights sold', cm.rooms_sold, pm.rooms_sold, ly ? ly.rooms_sold : '—']);
    row(['ADR', fmtIDR(cm.adr), fmtIDR(pm.adr), ly ? fmtIDR(ly.adr) : '—']);
    row(['RevPAR', fmtIDR(cm.revpar), fmtIDR(pm.revpar), ly ? fmtIDR(ly.revpar) : '—']);
    row(['Revenue change', '', pct(b.change.vs_prev), ly ? pct(b.change.vs_last_year) : '—'], { color: '#555' });

    heading('Money received');
    for (const m of b.collected.by_method) row([m.method, fmtIDR(m.amount)]);
    row(['Total', fmtIDR(b.collected.total)], { bold: true });

    heading('Stays by source');
    row(['Source', 'Bookings', 'Revenue', 'Share'], { bold: true, color: '#555' });
    const stayRev = cm.room + cm.fnb;
    for (const s of cm.by_source) row([s.source, s.count, fmtIDR(s.revenue), stayRev ? `${Math.round((s.revenue / stayRev) * 100)}%` : '']);

    if (b.agents.total > 0) {
      heading('What agents owe (today)');
      row(['Agent', 'Owed', 'Overdue'], { bold: true, color: '#555' });
      for (const a of b.agents.agents) row([a.agent, fmtIDR(a.total), a.overdue > 0 ? fmtIDR(a.overdue) : '—']);
      row(['Total', fmtIDR(b.agents.total), fmtIDR(b.agents.overdue)], { bold: true });
    }

    doc.moveDown(1.5);
    doc.font('Helvetica').fontSize(8).fillColor('#888')
      .text('Revenue is net of discounts and before tax: room and meals are counted per night stayed, extras on the day sold. Same figures as the PMS Reports page; the attached revenue CSV has the day-by-day breakdown.', 50, doc.y, { width: 495 });
    doc.end();
  });
}

// date: any day in the month AFTER the one to report (default today → last month).
async function buildMonthlyReport(propertyId, { date } = {}) {
  const [ty, tm] = (date || todayWITA()).split('-').map(Number);
  const [y, m] = shiftMonth(ty, tm, -1);
  const [py, pmo] = shiftMonth(y, m, -1);
  const [{ rows: [ps] }, { rows: [u] }] = await Promise.all([
    db.query(`SELECT property_name, property_address, property_phone, property_email, logo_url
              FROM property_settings WHERE property_id = $1`, [propertyId]),
    db.query(`SELECT COUNT(*) FILTER (WHERE status <> 'out_of_order') AS sellable FROM units WHERE property_id = $1`, [propertyId]),
  ]);
  const sellable = parseInt(u.sellable, 10) || 0;
  const { aging } = require('./agentStatementService');
  const { expensesCsv } = require('../routes/expenses');
  const { revenueCsv } = require('../routes/reports');
  const range = monthRange(y, m);
  const [month, prev, lastYear, money, agingRows, expCsv] = await Promise.all([
    monthFigures(propertyId, y, m, sellable),
    monthFigures(propertyId, py, pmo, sellable),
    monthFigures(propertyId, y - 1, m, sellable),
    collected(propertyId, range.from, range.to),
    aging(propertyId, {}),
    expensesCsv(propertyId, range.from, range.to),
  ]);
  const open = agingRows.filter(r => r.total_outstanding > 0)
    .map(r => ({ agent: r.source_label, total: r.total_outstanding, overdue: r.total_outstanding - r.current }))
    .sort((a, b) => b.total - a.total);
  const hasLastYear = lastYear.total > 0 || lastYear.rooms_sold > 0;

  const data = {
    property: ps || {},
    property_name: ps?.property_name || 'Your property',
    sellable,
    month, prev, last_year: hasLastYear ? lastYear : null,
    change: {
      vs_prev: pctChange(month.total, prev.total),
      vs_last_year: hasLastYear ? pctChange(month.total, lastYear.total) : null,
      occupancy_pts: month.occupancy - prev.occupancy,
    },
    collected: money,
    agents: { total: open.reduce((s, r) => s + r.total, 0), overdue: open.reduce((s, r) => s + r.overdue, 0), agents: open },
    has_expenses: month.expenses > 0 || prev.expenses > 0,
  };
  const tag = `${y}-${String(m).padStart(2, '0')}`;
  data.attachments = [
    { filename: `monthly-report-${tag}.pdf`, content: await monthlyPdf(data), contentType: 'application/pdf' },
    { filename: `revenue-${tag}.csv`, content: revenueCsv(month.report), contentType: 'text/csv' },
    ...(expCsv ? [{ filename: `expenses-${tag}.csv`, content: expCsv, contentType: 'text/csv' }] : []),
  ];
  return data;
}

const arrowTxt = (pct, suffix = '%') => pct == null ? '' : pct === 0 ? ' (same)' : ` (${pct > 0 ? '▲' : '▼'}${Math.abs(pct)}${suffix})`;

function monthlyTelegram(b) {
  const e = telegram.escapeHtml;
  const c = b.month;
  const L = [];
  L.push(`🗓 <b>${e(b.property_name)}</b> · ${e(c.label)}`);
  L.push('<i>Monthly Report</i>');
  L.push('');
  const vs = [
    b.change.vs_prev != null && `${arrowTxt(b.change.vs_prev).trim()} vs ${b.prev.label.split(' ')[0]}`,
    b.change.vs_last_year != null && `${arrowTxt(b.change.vs_last_year).trim()} vs last year`,
  ].filter(Boolean).join(' · ');
  L.push(`💰 Revenue: <b>${e(fmtIDR(c.total))}</b>${vs ? ` ${e(vs)}` : ''}`);
  L.push(`     Room ${e(fmtIDR(c.room))}${c.fnb ? ` · Meals ${e(fmtIDR(c.fnb))}` : ''}${c.extras ? ` · Extras ${e(fmtIDR(c.extras))}` : ''}`);
  if (b.has_expenses) L.push(`🧾 Expenses ${e(fmtIDR(c.expenses))} · Net income <b>${e(fmtIDR(c.net_income))}</b>`);
  L.push(`🛏 Occupancy: <b>${c.occupancy}%</b>${arrowTxt(b.change.occupancy_pts, ' pts')} · ${c.rooms_sold} room-nights`);
  L.push(`💵 ADR ${e(fmtIDR(c.adr))} · RevPAR ${e(fmtIDR(c.revpar))}`);
  L.push(`💳 Money received: <b>${e(fmtIDR(b.collected.total))}</b>`);
  if (c.best_day) L.push(`⭐ Best day: ${e(new Date(c.best_day.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))} · ${e(fmtIDR(c.best_day.total))}`);
  if (b.agents.total > 0) L.push(`🧾 Agents owe: <b>${e(fmtIDR(b.agents.total))}</b>${b.agents.overdue > 0 ? ` · ${e(fmtIDR(b.agents.overdue))} overdue` : ''}`);
  L.push('');
  L.push('📎 Full report (PDF) and CSV files for the accountant are in the email version.');
  return L.join('\n');
}

function monthlyEmail(b) {
  const esc = telegram.escapeHtml;
  const c = b.month;
  const cmp = (pct, label, suffix = '%') => pct == null ? '' :
    `<div style="font-size:12px;line-height:17px;margin-top:2px;color:${pct > 0 ? '#15803d' : pct < 0 ? '#b91c1c' : '#6b7280'};">${pct === 0 ? `same as ${label}` : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}${suffix} vs ${label}`}</div>`;
  const tile = (label, value, sub) => card(label, value, sub, { height: CARD_HEIGHT.two });
  const section = (title, inner) => `<div style="margin-top:22px;"><div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px;">${title}</div>${inner}</div>`;
  const table = (heads, rows, empty) => rows.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr>${heads.map(h => `<th style="text-align:${h.right ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;font-size:11px;text-transform:uppercase;">${h.label}</th>`).join('')}</tr>
      ${rows.map(r => `<tr>${r.map((cell, i) => `<td style="padding:8px;border-bottom:1px solid #f3f4f6;text-align:${heads[i].right ? 'right' : 'left'};">${cell}</td>`).join('')}</tr>`).join('')}
    </table>` : `<div style="font-size:13px;color:#9ca3af;">${empty}</div>`;
  const prevShort = b.prev.label.split(' ')[0];
  const cols = [{ label: '' }, { label: esc(c.label), right: true }, { label: esc(b.prev.label), right: true }, ...(b.last_year ? [{ label: esc(b.last_year.label), right: true }] : [])];
  const line = (k, f) => [k, esc(f(c)), esc(f(b.prev)), ...(b.last_year ? [esc(f(b.last_year))] : [])];
  const rows = [
    line('Room', x => fmtIDR(x.room)), line('Meals (rate plan)', x => fmtIDR(x.fnb)), line('Extras', x => fmtIDR(x.extras)),
    line('<b>Total revenue</b>', x => fmtIDR(x.total)),
    ...(b.has_expenses ? [line('Expenses', x => fmtIDR(x.expenses)), line('<b>Net income</b>', x => fmtIDR(x.net_income))] : []),
    line('Occupancy', x => `${x.occupancy}%`), line('ADR', x => fmtIDR(x.adr)), line('RevPAR', x => fmtIDR(x.revpar)),
  ];
  const stayRev = c.room + c.fnb;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px 16px;color:#111827;">
    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">Monthly Report</div>
    <div style="font-size:22px;font-weight:700;margin:4px 0 2px;">${esc(b.property_name)}</div>
    <div style="font-size:14px;color:#6b7280;margin-bottom:16px;">${esc(c.label)}</div>

    ${CARD_TABLE_OPEN}<tr>
      ${tile('Revenue', esc(fmtIDR(c.total)), cmp(b.change.vs_prev, prevShort) + (b.last_year ? cmp(b.change.vs_last_year, 'last year') : ''))}
      ${tile(b.has_expenses ? 'Net income' : 'Money received', esc(fmtIDR(b.has_expenses ? c.net_income : b.collected.total)), '')}
      ${tile('Occupancy', `${c.occupancy}%`, `<div style="font-size:12px;line-height:17px;color:#6b7280;margin-top:2px;">${c.rooms_sold} room-nights</div>` + cmp(b.change.occupancy_pts, prevShort, ' pts'))}
    </tr><tr>
      ${tile('ADR', esc(fmtIDR(c.adr)), '')}
      ${tile('RevPAR', esc(fmtIDR(c.revpar)), '')}
      ${tile('Agents owe', esc(fmtIDR(b.agents.total)), b.agents.overdue > 0 ? `<div style="font-size:12px;line-height:17px;color:#b91c1c;margin-top:2px;">${esc(fmtIDR(b.agents.overdue))} overdue</div>` : '')}
    </tr>${CARD_TABLE_CLOSE}

    ${section('Month by month', table(cols, rows, ''))}
    ${section('Money received', table([{ label: 'Method' }, { label: 'Amount', right: true }],
      [...b.collected.by_method.map(m => [esc(m.method), esc(fmtIDR(m.amount))]), ['<b>Total</b>', `<b>${esc(fmtIDR(b.collected.total))}</b>`]], ''))}
    ${section('Stays by source', table([{ label: 'Source' }, { label: 'Bookings', right: true }, { label: 'Revenue', right: true }, { label: 'Share', right: true }],
      c.by_source.map(s => [esc(s.source), s.count, esc(fmtIDR(s.revenue)), `${stayRev ? Math.round((s.revenue / stayRev) * 100) : 0}%`]), 'No stays this month.'))}
    ${b.agents.total > 0 ? section('What agents owe (today)', table([{ label: 'Agent' }, { label: 'Owed', right: true }, { label: 'Overdue', right: true }],
      b.agents.agents.map(a => [esc(a.agent), esc(fmtIDR(a.total)), a.overdue > 0 ? `<span style="color:#b91c1c;">${esc(fmtIDR(a.overdue))}</span>` : '—']), '')) : ''}
    ${section('Attached for your accountant', `<div style="font-size:13px;line-height:1.7;">${(b.attachments || []).map(a => `📎 ${esc(a.filename)}`).join('<br>')}</div>`)}
    <div style="margin-top:28px;font-size:11px;color:#9ca3af;">Sent by Smart Reports.</div>
  </div>`;
  return {
    subject: `🗓 ${b.property_name} — ${c.label}: ${fmtIDR(c.total)} revenue, ${c.occupancy}% occupancy`,
    html,
    attachments: b.attachments,
  };
}

module.exports = { buildMonthlyReport, monthlyTelegram, monthlyEmail };
