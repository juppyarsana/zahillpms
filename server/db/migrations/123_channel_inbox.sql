-- ============================================================
-- Migration 123 — Channel Manager: OTA bookings for front desk
--
-- channel_revisions.seen_at / seen_by  someone at the hotel pressed OK on
--                        the pop-up (or "All seen") for this OTA booking /
--                        change / cancellation. NULL = still shown as new.
--                        One OK clears it for everyone: it is a notice, the
--                        booking itself is on Reservations.
-- channel_sync_state.webhook_*   the Channex webhook that tells the PMS a
--                        booking came in, so it is read within seconds instead
--                        of on the next one-minute read. The token is the
--                        secret in the callback address; the one-minute read
--                        stays as the safety net.
-- ============================================================

ALTER TABLE channel_revisions
  ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seen_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Everything already read counts as seen — no flood of pop-ups on deploy.
UPDATE channel_revisions SET seen_at = COALESCE(processed_at, received_at) WHERE seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_channel_revisions_unseen ON channel_revisions (property_id) WHERE seen_at IS NULL;

ALTER TABLE channel_sync_state
  ADD COLUMN IF NOT EXISTS webhook_id      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS webhook_token   VARCHAR(64) UNIQUE,
  ADD COLUMN IF NOT EXISTS webhook_url     TEXT,
  ADD COLUMN IF NOT EXISTS webhook_error   TEXT,
  ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ;

-- Paid to the OTA → confirmed (paymentStatusService.recomputeBookingStatus
-- now says so; this puts bookings already in on the same footing).
UPDATE bookings SET status = 'confirmed', updated_at = NOW()
 WHERE payment_collect = 'ota' AND status IN ('pending', 'deposit_paid');
