-- OTA bookings the OTA pays are confirmed, not pending (same rule as
-- check-in / check-out / the booking page, services/otaCollect.js).
-- Migration 123 did this only for payment_collect = 'ota'; bookings typed by
-- hand or imported (payment_collect NULL, OTA source) stayed Pending even
-- though the guest owes nothing for the room. Rooms of a group billed as a
-- whole follow the group's payments and are left alone.
UPDATE bookings b
SET status = 'confirmed', updated_at = NOW()
FROM booking_sources bs
WHERE bs.id = b.source AND bs.property_id = b.property_id
  AND b.status IN ('pending', 'deposit_paid')
  AND (CASE WHEN b.payment_collect IS NOT NULL THEN b.payment_collect IN ('ota', 'vcc')
            ELSE (COALESCE(bs.is_ota, false) OR b.source IN ('airbnb', 'booking_com', 'traveloka')) END)
  AND NOT EXISTS (SELECT 1 FROM reservation_groups rg
                  WHERE rg.id = b.reservation_group_id AND rg.group_billing);
