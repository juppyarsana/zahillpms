-- ============================================================
-- Migration 065 — Booking source "Publish Rate" toggle
--
-- The Registration Card prints Room Rate and Deposit as real numbers —
-- fine for a direct/walk-in guest, but wrong for an OTA or travel-agent
-- booking where the rate the hotel actually receives (net of
-- commission) differs from what the guest paid the channel, and isn't
-- something the property wants printed on a guest-facing document.
--
-- New booking_sources.publish_rate: when true (default — matches
-- today's behavior for every existing source), the Registration Card
-- shows the real Room Rate/Deposit. When false, it shows a neutral
-- "arranged by <source>" line instead of numbers. Independent of
-- is_ota/source_type on purpose — the owner controls it per source
-- explicitly, rather than the system assuming every OTA/agent wants
-- this (see CLAUDE.md for the full reasoning).
--
-- Backfill: default existing OTA and travel-agent sources to false,
-- since that's the real-world case this was built for — everything
-- else (direct, walk-in, booking_engine, company, wholesaler) keeps
-- publishing the real rate unless the owner opts out per source.
-- ============================================================

ALTER TABLE booking_sources ADD COLUMN IF NOT EXISTS publish_rate BOOLEAN NOT NULL DEFAULT true;

UPDATE booking_sources SET publish_rate = false WHERE is_ota = true OR source_type = 'travel_agent';
