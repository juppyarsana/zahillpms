// When a booking stops occupying its room, for availability checks. Normally
// its check-out date — but a guest still checked in AFTER their check-out
// date (overdue: staff haven't checked them out yet) is physically still in
// the room, so it stays occupied through tonight until someone checks them
// out or extends the stay. A guest due out today isn't affected (they leave
// before the next arrival). `a` = the bookings table alias ('' for none).
const TODAY_WITA_SQL = "(NOW() AT TIME ZONE 'Asia/Makassar')::date";
// The day a checked-out guest actually left (WITA), from checkin_records.
function checkoutDaySql(a = 'b') {
  const c = a ? `${a}.` : 'bookings.';
  return `(SELECT (cr.checkout_time AT TIME ZONE 'Asia/Makassar')::date FROM checkin_records cr WHERE cr.booking_id = ${c}id)`;
}
// A checked-out booking frees the room from the day the guest actually left
// — a same-day departure keeps its 1 charged night on the books but the
// room can be sold again that evening.
function occupiedUntilSql(a = 'b') {
  const c = a ? `${a}.` : 'bookings.';
  return `(CASE WHEN ${c}status = 'checked_in' AND ${c}check_out_date < ${TODAY_WITA_SQL}
               THEN ${TODAY_WITA_SQL} + 1
               WHEN ${c}status = 'checked_out'
               THEN LEAST(${c}check_out_date, COALESCE(${checkoutDaySql(a)}, ${c}check_out_date))
               ELSE ${c}check_out_date END)`;
}
function overdueSql(a = 'b') {
  const c = a ? `${a}.` : 'bookings.';
  return `(${c}status = 'checked_in' AND ${c}check_out_date < ${TODAY_WITA_SQL})`;
}

module.exports = { TODAY_WITA_SQL, checkoutDaySql, occupiedUntilSql, overdueSql };
