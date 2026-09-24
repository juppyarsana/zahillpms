const db = require('../db');

// A unit's normal room rate for each night of a stay (NET, before tax):
// the unit's base rate, overridden per night by the highest-priority active
// pricing period covering that night (manual periods and the yield engine's
// 'auto' ones alike). Shared by GET /api/pricing/suggest (New Booking's
// price suggestion) and the Change Room upgrade quote, so both always price a
// room the same way. Nights run check_in .. check_out-1 (no charge for the
// departure day — same convention as roomChargeService.stayNights).
// Returns null when the unit isn't found for the property.
async function nightlyRoomRates(propertyId, unitId, checkIn, checkOut, client = db) {
  const { rows: [unit] } = await client.query('SELECT * FROM units WHERE id = $1 AND property_id = $2', [unitId, propertyId]);
  if (!unit) return null;
  const baseRate = parseFloat(unit.base_rate);

  // Every active period overlapping ANY night of the stay, highest-priority first.
  const { rows: periods } = await client.query(`
    SELECT * FROM pricing_periods
    WHERE property_id = $3
      AND is_active = true
      AND date_from < $2
      AND date_to >= $1
      AND (unit_ids = '[]'::jsonb OR unit_ids @> $4::jsonb)
    ORDER BY sort_order DESC
  `, [checkIn, checkOut, propertyId, JSON.stringify([unitId])]);

  const night_breakdown = [];
  for (let t = new Date(checkIn + 'T00:00:00Z').getTime(); t < new Date(checkOut + 'T00:00:00Z').getTime(); t += 86400000) {
    const dateStr = new Date(t).toISOString().slice(0, 10);
    const period = periods.find(p => p.date_from <= dateStr && p.date_to >= dateStr) || null;
    const room_rate = Math.round(period
      ? (period.type === 'fixed' ? parseFloat(period.value) : baseRate * parseFloat(period.value))
      : baseRate);
    night_breakdown.push({
      date: dateStr,
      room_rate,
      period: period ? { name: period.name, type: period.type, value: period.value, color: period.color } : null,
    });
  }
  const room_total = night_breakdown.reduce((sum, n) => sum + n.room_rate, 0);
  return { unit, baseRate, night_breakdown, room_total };
}

module.exports = { nightlyRoomRates };
