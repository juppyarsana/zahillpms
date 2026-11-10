-- OTA bookings paid with a virtual card the hotel charges itself (Booking.com):
-- Channex says payment_collect "ota" and puts the card in `guarantee`
-- (is_virtual). The channel manager saved them as 'ota' (a payout), so front
-- desk was never told to charge the card. They become 'vcc' with the card's
-- first charge day (services/channelBookings.js now does this for new ones).
-- Stays not yet checked out only; a note goes in each booking's Edit History.
-- A date typed in an OTA's note may not be a real day (2026-02-30): such a
-- value is treated as "not known" instead of aborting the migration.
CREATE FUNCTION pg_temp.safe_day(t text) RETURNS date AS $$
BEGIN
  IF t IS NULL OR t !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  RETURN t::date;
EXCEPTION WHEN others THEN RETURN NULL;
END $$ LANGUAGE plpgsql;

WITH card AS (
  SELECT DISTINCT ON (bid) bid, ota_name,
         NULLIF(r.raw->'attributes'->'guarantee'->'meta'->>'virtual_card_effective_date', '') AS eff,
         substring(r.raw->'attributes'->>'notes' FROM '(?i)(?:tanggal|from|mulai)\s+(\d{4}-\d{2}-\d{2})') AS from_note
  FROM channel_revisions r, unnest(r.booking_ids) AS bid
  WHERE (r.raw->'attributes'->'guarantee'->>'is_virtual') = 'true'
    AND r.raw->'attributes'->>'payment_collect' = 'ota'
  ORDER BY bid, r.received_at DESC
), fixed AS (
  UPDATE bookings b
  SET payment_collect = 'vcc',
      vcc_charge_from = COALESCE(b.vcc_charge_from,
        COALESCE(pg_temp.safe_day(card.eff), pg_temp.safe_day(card.from_note))),
      updated_at = NOW()
  FROM card
  WHERE b.id = card.bid AND b.payment_collect = 'ota'
    AND b.status IN ('pending', 'deposit_paid', 'confirmed', 'checked_in')
  RETURNING b.id, card.ota_name, b.vcc_charge_from
)
INSERT INTO booking_events (booking_id, note, created_by)
SELECT id, 'Who pays the room: ' || ota_name || ' (payout) → ' || ota_name || ' virtual card'
       || COALESCE(', charge it from ' || to_char(vcc_charge_from, 'DD Mon YYYY'), '')
       || ' — the card is in the ' || ota_name || ' extranet; record it with OTA virtual card.', NULL
FROM fixed;

UPDATE channel_bookings cb SET payment_collect = 'vcc', updated_at = NOW()
WHERE cb.payment_collect = 'ota'
  AND EXISTS (SELECT 1 FROM channel_booking_rooms cbr JOIN bookings b ON b.id = cbr.booking_id
              WHERE cbr.channel_booking_id = cb.id AND b.payment_collect = 'vcc');
