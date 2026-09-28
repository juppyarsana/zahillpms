// Whether a guest-facing document (Registration Card, invoice / pro forma)
// shows the room rate — one rule for every place that prints it.
//
// The booking's agent can choose (agents.publish_rate, migration 085):
//   show / hide — always shown / always hidden
//   auto (default):
//     hidden when the source has Publish Rate off (OTAs, migration 065), or
//     the agent bills the hotel (city ledger) AND is a travel agent /
//     wholesaler / OTA — it resold the room at its own price, which is private;
//     shown otherwise — a company / government office billed later (its
//     employee often needs the rate for a travel claim), and every booking
//     where the guest pays the hotel, so the guest sees what they owe.
// "Arranged by" names the agent when there is one, else the source.
//
// Aliases: b = bookings, bs = booking_sources, ag = agents (LEFT JOINed).
const CITY_LEDGER_IN = `('city_ledger', 'city_ledger_payment', 'commission_and_city_ledger')`;
const PUBLISH_RATE_SQL = `(CASE COALESCE(ag.publish_rate, 'auto')
  WHEN 'show' THEN true
  WHEN 'hide' THEN false
  ELSE COALESCE(bs.publish_rate, true)
       AND NOT (COALESCE(ag.payment_status, 'normal') IN ${CITY_LEDGER_IN}
                AND COALESCE(ag.agent_type, 'travel_agent') IN ('travel_agent', 'wholesaler', 'ota'))
END)`;
const ARRANGED_BY_SQL = 'COALESCE(ag.name, bs.label)';

// The same rule in JS (maintenance/splitAgentSources.js dry run).
function publishesRate({ sourcePublish = true, agent = null }) {
  const mode = agent?.publish_rate || 'auto';
  if (mode === 'show') return true;
  if (mode === 'hide') return false;
  const billed = ['city_ledger', 'city_ledger_payment', 'commission_and_city_ledger'].includes(agent?.payment_status);
  const reseller = ['travel_agent', 'wholesaler', 'ota'].includes(agent?.agent_type || 'travel_agent');
  return sourcePublish !== false && !(agent && billed && reseller);
}

module.exports = { PUBLISH_RATE_SQL, ARRANGED_BY_SQL, publishesRate };
