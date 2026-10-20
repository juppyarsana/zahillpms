-- ============================================================
-- Migration 124 — Channel Manager: the last sends to Channex
--
-- channel_sync_state.send_log  the last 20 sends (newest first): when, what
--                        kind (change / nightly full / Send everything now),
--                        what changed (room type / meal plan + dates), the
--                        Channex task IDs, or the error. Shown on Settings →
--                        Channel Manager, card 3 — Channex's certification asks
--                        for a task ID from each test.
-- ============================================================

ALTER TABLE channel_sync_state ADD COLUMN IF NOT EXISTS send_log JSONB NOT NULL DEFAULT '[]'::jsonb;
