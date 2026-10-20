-- ============================================================
-- Migration 122 — Channel Manager, stage 4: health + go-live
--
-- When sending free rooms / prices or reading OTA bookings keeps failing,
-- the owner hears it on Telegram once (alert `alert_channel_manager`, 15
-- minutes after it started failing) and again when it works again.
-- ============================================================

ALTER TABLE channel_sync_state
  ADD COLUMN IF NOT EXISTS send_failing_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_alerted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pull_failing_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pull_alerted_at    TIMESTAMPTZ;
