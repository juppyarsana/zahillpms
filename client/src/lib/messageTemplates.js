// Quick-fill templates for the Send Message modal (BookingDetail.jsx and
// Dashboard.jsx's room popover both use these). Kept in one place so the
// wording stays consistent if/when an automated trigger (checkout reminder,
// etc.) gets built later — that would live server-side and need its own
// copy, but at least the two manual-send entry points don't drift from
// each other in the meantime.

export function checkinTemplate(guestName) {
  return `Welcome, ${guestName}! Your room is all set — let us know if you need anything 🌿`;
}

export function checkoutTemplate(guestName) {
  return `Hi ${guestName}, just a friendly reminder that check-out is at 12:00 today. Thank you for staying with us!`;
}
