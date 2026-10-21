// Who collects an OTA booking's room money — the one rule.
//
// bookings.payment_collect (migration 121, set by the channel manager or by
// front desk in Edit Details):
//   'ota'      the guest paid the OTA; the OTA pays the hotel (weekly payout)
//   'vcc'      the OTA pays with a virtual card the hotel charges itself
//   'property' the guest pays at the hotel, even though it came from an OTA
//   NULL       not set (bookings typed by hand): an OTA source means the OTA
//              collects, as before.
// 'ota' and 'vcc' mean the same for the guest: they owe nothing for the room.
const LEGACY_OTA_SOURCES = ['airbnb', 'booking_com', 'traveloka'];
const OTA_COLLECT = ['ota', 'vcc'];
const COLLECT_VALUES = ['ota', 'vcc', 'property'];

function otaCollects({ payment_collect, source, is_ota }) {
  if (payment_collect) return OTA_COLLECT.includes(payment_collect);
  return LEGACY_OTA_SOURCES.includes(source) || !!is_ota;
}

// SQL form; b = bookings alias, bs = booking_sources alias (joined on b.source).
function otaCollectsSql(b = 'b', bs = 'bs') {
  return `(CASE WHEN ${b}.payment_collect IS NOT NULL THEN ${b}.payment_collect IN ('ota', 'vcc')
               ELSE (COALESCE(${bs}.is_ota, false) OR ${b}.source IN ('airbnb', 'booking_com', 'traveloka')) END)`;
}

const COLLECT_LABEL = { ota: 'the OTA (payout)', vcc: 'the OTA (virtual card)', property: 'the guest, at the hotel' };

module.exports = { otaCollects, otaCollectsSql, LEGACY_OTA_SOURCES, OTA_COLLECT, COLLECT_VALUES, COLLECT_LABEL };
