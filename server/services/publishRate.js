// Whether a guest-facing document (Registration Card, invoice / pro forma)
// shows the room rate — one rule for every place that prints it.
//
// Hidden when the guest didn't agree the price with the hotel:
//   - the booking source has Publish Rate off (OTAs, migration 065), or
//   - the booking's agent bills the hotel (city ledger, migration 084):
//     the guest paid the agent, the hotel's price to the agent is private.
// Shown otherwise — incl. every agent booking where the guest pays the hotel,
// so the guest always sees what they owe.
// "Arranged by" names the agent when there is one, else the source.
//
// Aliases: b = bookings, bs = booking_sources, ag = agents (LEFT JOINed).
const PUBLISH_RATE_SQL = `(COALESCE(bs.publish_rate, true)
  AND COALESCE(ag.payment_status, 'normal') NOT IN ('city_ledger', 'city_ledger_payment', 'commission_and_city_ledger'))`;
const ARRANGED_BY_SQL = 'COALESCE(ag.name, bs.label)';

module.exports = { PUBLISH_RATE_SQL, ARRANGED_BY_SQL };
