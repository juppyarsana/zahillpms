// The Reports library's list (pages/ReportsLibrary.jsx): every printable
// report, the page permission + modules it follows, its fields and files.
// The menu shows Reports when reportsFor() is not empty. To add a report: one
// entry in REPORTS.
import { propertyToday, addDaysYmd } from './propertyTime';

export const thisMonth = () => propertyToday().slice(0, 7);
const lastMonth = () => { const [y, m] = thisMonth().split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const monthStart = () => `${thisMonth()}-01`;

// Field kinds: date (YYYY-MM-DD), month (YYYY-MM), select.
const D = (key, label, init) => ({ key, label, type: 'date', init });
const M = (key, label, init) => ({ key, label, type: 'month', init });

// group, id, title, what it is, who (can / module), fields, files [{ label, url(v), params(v), name(v) }], schedule note
export const REPORTS = [
  // ── Front desk ──
  { group: 'Front desk', id: 'guest-lists', title: 'Guest lists', what: 'Arriving, staying and leaving on a day — rooms, pax, notes.',
    can: c => c('guest_lists'), mod: ['reservations'], fields: [D('date', 'Day', propertyToday)],
    files: [{ label: 'PDF', url: () => '/api/bookings/guest-lists/pdf', params: v => ({ date: v.date }), name: v => `guest-lists-${v.date}.pdf` }] },
  { group: 'Front desk', id: 'arrival-cards', title: 'Registration cards for arrivals', what: 'One card per arriving guest, one per page — to print the evening before.',
    can: c => c('guest_lists'), mod: ['reservations'], fields: [D('date', 'Arrival day', () => addDaysYmd(propertyToday(), 1))],
    files: [{ label: 'PDF', url: () => '/api/checkin/registration-cards', params: v => ({ date: v.date }), name: v => `registration-cards-${v.date}.pdf` }] },
  { group: 'Front desk', id: 'police', title: 'Police guest report (lapor tamu)', what: 'Every guest staying in the period, with ID number and nationality.',
    can: c => c('reservations'), mod: ['reservations'], fields: [D('from', 'From', propertyToday), D('to', 'To', propertyToday)],
    files: [{ label: 'PDF', url: () => '/api/bookings/guest-report/pdf', params: v => ({ date_from: v.from, date_to: v.to }), name: v => `guest-report-${v.from}_to_${v.to}.pdf` }] },
  { group: 'Front desk', id: 'balance-due', title: 'Balance due', what: 'What guests leaving, overdue and staying still owe — to collect.',
    can: c => c('checkin_full'), mod: ['reservations'], fields: [D('date', 'Day', propertyToday)],
    files: [{ label: 'PDF', url: () => '/api/bookings/balance-due/pdf', params: v => ({ date: v.date }), name: v => `balance-due-${v.date}.pdf` }] },
  { group: 'Front desk', id: 'cashier', title: 'Cashier closing', what: 'Every payment received on a day, by method and by user.',
    can: c => c('cashier_closing'), mod: ['financial'], fields: [D('date', 'Day', propertyToday)],
    files: [{ label: 'PDF', url: () => '/api/cashier-closing/pdf', params: v => ({ date: v.date }), name: v => `cashier-closing-${v.date}.pdf` }] },
  { group: 'Front desk', id: 'night-audit', title: 'Night audit', what: 'The closed day: rooms, charges posted, money received, what the audit found.',
    can: c => c('night_audit'), mod: ['financial'], fields: [D('date', 'Business day', () => addDaysYmd(propertyToday(), -1))],
    files: [{ label: 'PDF', url: v => `/api/night-audit/${v.date}/pdf`, params: () => ({}), name: v => `night-audit-${v.date}.pdf` }],
    schedule: 'The Daily Close is sent by Telegram / email every night.' },

  // ── Restaurant & stock ──
  { group: 'Restaurant & stock', id: 'kitchen', title: 'Kitchen & breakfast list', what: 'Breakfast that morning and dinner that night, room by room.',
    can: c => c('guest_lists') || c('restaurant'), mod: ['reservations'], fields: [D('date', 'Day', () => addDaysYmd(propertyToday(), 1))],
    files: [{ label: 'PDF', url: () => '/api/bookings/kitchen/pdf', params: v => ({ date: v.date }), name: v => `kitchen-${v.date}.pdf` }] },
  { group: 'Restaurant & stock', id: 'stock', title: 'Stock count sheet & stock usage', what: 'Printed from a stock opname, usage between two opnames.',
    can: c => c('stock'), mod: ['back_office'], link: { to: '/stock', label: 'Open Stock' } },

  // ── Insights ──
  { group: 'Insights', id: 'revenue', title: 'Manager report', what: 'The full figures: revenue, rooms, channels, money — with room nights and reservations in the Excel.',
    can: c => c('reports'), mod: ['financial'], fields: [D('from', 'From', monthStart), D('to', 'To', propertyToday)],
    files: [
      { label: 'Excel', url: () => '/api/reports/full/xlsx', params: v => ({ from: v.from, to: v.to }), name: v => `report-${v.from}_to_${v.to}.xlsx` },
      { label: 'PDF', url: () => '/api/reports/full/pdf', params: v => ({ from: v.from, to: v.to }), name: v => `report-${v.from}_to_${v.to}.pdf` },
      { label: 'CSV', url: () => '/api/reports/revenue/export', params: v => ({ from: v.from, to: v.to }), name: v => `revenue-${v.from}_to_${v.to}.csv` },
    ],
    page: { to: '/reports/revenue', label: 'Open on screen' },
    schedule: 'The Monthly Report emails it on the 1st, with the Excel / CSV attached.' },
  { group: 'Insights', id: 'costs', title: 'Costs by department', what: 'Departments, their categories and every expense and supplier bill.',
    can: c => c('costs'), mod: ['back_office', 'accounting'], anyMod: true, fields: [M('month', 'Month', thisMonth)],
    files: [{ label: 'Excel', url: () => '/api/costs/xlsx', params: v => ({ month: v.month }), name: v => `costs-by-department-${v.month}.xlsx` }],
    page: { to: '/costs', label: 'Open on screen' } },
  { group: 'Insights', id: 'forecast', title: 'Forecast', what: 'The days ahead: arrivals, departures, rooms sold, guests and meals.',
    can: c => c('forecast'), mod: ['reservations'],
    fields: [D('from', 'First day', propertyToday), { key: 'days', label: 'Days', type: 'select', options: ['7', '14', '30'], init: () => '14' }],
    files: [{ label: 'PDF', url: () => '/api/forecast/pdf', params: v => ({ from: v.from, days: v.days }), name: v => `forecast-${v.from}.pdf` }],
    page: { to: '/forecast', label: 'Open on screen' } },

  // ── Finance & accounting ──
  { group: 'Finance & accounting', id: 'expenses', title: 'Expenses', what: 'Every expense of the month — for the accountant.',
    can: c => c('expenses'), mod: ['back_office'], fields: [M('month', 'Month', lastMonth)],
    files: [{ label: 'CSV', url: () => '/api/expenses/export', params: v => ({ month: Number(v.month.slice(5)), year: Number(v.month.slice(0, 4)) }), name: v => `expenses-${v.month}.csv` }] },
  { group: 'Finance & accounting', id: 'purchase-orders', title: 'Purchase orders', what: 'Every purchase order with its supplier, status and total.',
    can: c => c('purchasing'), mod: ['back_office'], fields: [],
    files: [{ label: 'CSV', url: () => '/api/purchasing/purchase-orders/export', params: () => ({}), name: () => 'purchase-orders.csv' }] },
  { group: 'Finance & accounting', id: 'journal', title: 'Daily journal', what: 'The day-by-day journal, account totals and every posting (up to 92 days).',
    can: c => c('accounting'), mod: ['accounting'], fields: [D('from', 'From', monthStart), D('to', 'To', () => addDaysYmd(propertyToday(), -1))],
    files: [{ label: 'Excel', url: () => '/api/accounting/journal/xlsx', params: v => ({ from: v.from, to: v.to }), name: v => `journal-${v.from}_to_${v.to}.xlsx` }] },
  { group: 'Finance & accounting', id: 'pl', title: 'Profit & Loss', what: 'The month, the month before and the year to date.',
    can: c => c('accounting'), mod: ['accounting'], fields: [M('month', 'Month', lastMonth)],
    files: [
      { label: 'Excel', url: () => '/api/accounting/pl/xlsx', params: v => ({ month: v.month }), name: v => `profit-and-loss-${v.month}.xlsx` },
      { label: 'PDF', url: () => '/api/accounting/pl/pdf', params: v => ({ month: v.month }), name: v => `profit-and-loss-${v.month}.pdf` },
    ] },
  { group: 'Finance & accounting', id: 'balance-sheet', title: 'Balance sheet', what: 'Assets, liabilities and equity on a day.',
    can: c => c('accounting'), mod: ['accounting'], fields: [D('date', 'On', propertyToday)],
    files: [
      { label: 'Excel', url: () => '/api/accounting/balance-sheet/xlsx', params: v => ({ date: v.date }), name: v => `balance-sheet-${v.date}.xlsx` },
      { label: 'PDF', url: () => '/api/accounting/balance-sheet/pdf', params: v => ({ date: v.date }), name: v => `balance-sheet-${v.date}.pdf` },
    ] },
  { group: 'Finance & accounting', id: 'trial-balance', title: 'Trial balance', what: 'Every account: balance before, debits, credits, balance at the end.',
    can: c => c('accounting'), mod: ['accounting'], fields: [D('from', 'From', monthStart), D('to', 'To', propertyToday)],
    files: [{ label: 'Excel', url: () => '/api/accounting/trial-balance/xlsx', params: v => ({ from: v.from, to: v.to }), name: v => `trial-balance-${v.from}_to_${v.to}.xlsx` }] },
  { group: 'Finance & accounting', id: 'agents', title: 'Agent statements & invoices', what: 'Each agent\'s statement and invoices, on the agent\'s page.',
    can: c => c('receivables'), mod: ['financial'], link: { to: '/agents', label: 'Open Receivables' } },
  { group: 'Finance & accounting', id: 'vendors', title: 'Vendor payout slips', what: 'Each payout to a tour / transport vendor, printed from Vendor payouts.',
    can: c => c('vendors'), mod: ['activities'], link: { to: '/vendor-payouts', label: 'Open Vendor payouts' } },
];

// Which reports a user may download — the Reports menu item shows when this is not empty.
export function reportsFor(can, hasModule) {
  return REPORTS.filter(r => r.can(can) && (r.anyMod ? r.mod.some(hasModule) : r.mod.every(hasModule)));
}

