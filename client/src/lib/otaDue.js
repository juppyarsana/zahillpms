// An OTA booking's unpaid room lines (deposit / balance) are the OTA's money:
// the guest paid the OTA, the OTA still pays the hotel. The booking keeps them
// open until that money is recorded, but the guest owes nothing for them — the
// same rule as the checkout screens (server services/checkoutBalance.js).
const OTA_SOURCES = ['airbnb', 'booking_com', 'traveloka'];   // same as server

// The OTA's name when the OTA pays the room, else null. `collect` = the
// booking's payment_collect (migration 121, set by the channel manager):
// 'property' = the hotel collects even from an OTA booking ("pay at hotel").
export function otaName(sources, sourceId, collect = null) {
  const s = (sources || []).find(x => x.id === sourceId);
  if (collect === 'property') return null;
  if (collect === 'ota' || s?.is_ota || OTA_SOURCES.includes(sourceId)) return s?.label || sourceId;
  return null;
}

// What is still open on the room's deposit / balance lines.
export function roomPending(payments) {
  return (payments || [])
    .filter(p => (p.type === 'deposit' || p.type === 'balance') && p.status === 'pending' && parseFloat(p.amount) > 0)
    .reduce((s, p) => s + parseFloat(p.amount), 0);
}
