-- ============================================================
-- Migration 085 — per-agent choice: show or hide the room rate on guest
-- documents (Registration Card, invoice / pro forma guest copy).
--
-- Until now the rate was hidden for every agent that bills the hotel. That
-- suits a travel agent reselling the room at its own price, but a company or
-- government office often needs its employee's invoice WITH the rate (travel
-- claim / SPPD). So each agent gets:
--   auto — hidden for a billed travel agent / wholesaler / OTA, shown for a
--          company / other and whenever the guest pays the hotel (default)
--   show — always shown
--   hide — always hidden
-- The rule lives in server/services/publishRate.js. Additive only.
-- ============================================================

ALTER TABLE agents ADD COLUMN IF NOT EXISTS publish_rate VARCHAR(10) NOT NULL DEFAULT 'auto';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_publish_rate_check') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_publish_rate_check CHECK (publish_rate IN ('auto', 'show', 'hide'));
  END IF;
END $$;
