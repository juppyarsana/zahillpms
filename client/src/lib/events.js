// Shared bits for the Events pages (migration 106).
export const STATUS = {
  enquiry:   { label: 'Enquiry',   badge: 'gray',  bg: '#F3F4F6', fg: '#374151', hint: 'Nothing is held yet' },
  tentative: { label: 'On hold',   badge: 'amber', bg: '#FEF3C7', fg: '#92400E', hint: 'Held for the client — not confirmed' },
  confirmed: { label: 'Confirmed', badge: 'green', bg: '#DCFCE7', fg: '#166534', hint: 'The venue is reserved' },
  cancelled: { label: 'Cancelled', badge: 'red',   bg: '#FEE2E2', fg: '#991B1B', hint: '' },
};

export const MEAL_KINDS = [
  ['coffee_break', 'Coffee break'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['welcome_drink', 'Welcome drink'], ['other', 'Other'],
];
export const mealLabel = k => (MEAL_KINDS.find(m => m[0] === k) || [k, k])[1];

export function fmtIDR(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }
export function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function parseYmd(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
export function fmtDay(s, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
  return s ? parseYmd(s).toLocaleDateString('en-GB', opts) : '';
}
export function whenText(e) {
  const days = e.event_date === e.end_date ? fmtDay(e.event_date) : `${fmtDay(e.event_date)} – ${fmtDay(e.end_date)}`;
  return `${days}, ${e.start_time}–${e.end_time}`;
}

// A PDF from the API, saved with the time in its name so a reprint is not
// mistaken for the earlier file.
export async function downloadPdf(api, url, name) {
  const r = await api.get(url, { responseType: 'blob' });
  const href = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
  const a = document.createElement('a');
  const t = new Date();
  a.href = href;
  a.download = `${name}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(href);
}
