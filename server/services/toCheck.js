// "To check" points on a booking (migration 109, written by the VHP import).
// The points are stored as text; which of them are already done is worked
// out here, at read time, from what FO has since done on the booking — so a
// point disappears by itself once it is fixed, and nothing new is stored:
//   price  — "No rate in VHP" / "Complimentary in VHP": an Edit Price (single
//            or Set Prices on the group) or the stay made complimentary
//   guest  — "Guest name not known yet": Change Guest / Assign Guests
//   room   — "Room picked automatically" / "VHP had room …": Change Room
//   agent  — "Agent not in the PMS" / "several match": an agent on the booking
//   agent_created — "Agent … was created by the import": the agent has a
//            contact (owner's job in Agent Billing)
// Anything else (deposit, guests guessed, nights joined…) is done when FO
// presses Checked. A booking FO has checked still waits for its guest name
// ("Waiting for guest names") until the guest is assigned.

const KINDS = [
  ['price', /^(No rate in VHP|Complimentary in VHP)/],
  ['guest', /^Guest name not known yet/],
  ['room', /^(Room picked automatically|VHP had room)/],
  ['agent', /^(Agent not in the PMS|Agent: several match)/],
  ['agent_created', /^Agent ".*" was created by the import/],
];
const kindOf = text => (KINDS.find(([, re]) => re.test(String(text))) || ['other'])[0];

// Columns to add to a query over bookings b (with agents ag LEFT JOINed on
// b.agent_id) so points() can tell what is done.
const FLAGS_SQL = `
  EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id AND e.note LIKE 'Price corrected:%') AS tc_price_edited,
  EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id AND e.note LIKE 'Guest: %') AS tc_guest_changed,
  EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id AND e.note LIKE 'Room changed:%') AS tc_room_changed,
  (b.complimentary_scope IS NOT NULL) AS tc_complimentary,
  (b.agent_id IS NOT NULL) AS tc_has_agent,
  (COALESCE(NULLIF(TRIM(ag.contact_name), ''), NULLIF(TRIM(ag.contact_email), ''), NULLIF(TRIM(ag.contact_phone), '')) IS NOT NULL) AS tc_agent_contact`;

function isResolved(kind, f) {
  switch (kind) {
    case 'price': return !!(f.tc_price_edited || f.tc_complimentary);
    case 'guest': return !!f.tc_guest_changed;
    case 'room': return !!f.tc_room_changed;
    case 'agent': return !!f.tc_has_agent;
    case 'agent_created': return !!f.tc_agent_contact;
    default: return false;
  }
}

// [{ text, kind, resolved }] for a row carrying to_check + the FLAGS_SQL columns.
function points(row) {
  const list = Array.isArray(row.to_check) ? row.to_check : [];
  return list.map(text => { const kind = kindOf(text); return { text, kind, resolved: isResolved(kind, row) }; });
}

// Which list a booking belongs to:
//   'open'  — not checked yet and something other than the guest name is open
//   'names' — only the guest name is still open (checked, or nothing else left)
//   'done'  — nothing left (checked, or every point fixed)
//   null    — no points at all
function bucket(row) {
  const ps = points(row);
  if (!ps.length) return null;
  const open = ps.filter(p => !p.resolved);
  const guestOpen = open.some(p => p.kind === 'guest');
  const otherOpen = open.some(p => p.kind !== 'guest');
  if (!row.to_check_done_at && otherOpen) return 'open';
  if (guestOpen) return 'names';
  return 'done';
}

module.exports = { FLAGS_SQL, points, bucket, kindOf };
