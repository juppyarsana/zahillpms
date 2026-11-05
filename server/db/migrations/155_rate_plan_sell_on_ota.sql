-- ============================================================
-- 155: a meal plan can be kept away from the OTAs.
--
-- rate_plans.sell_on_ota (default true): false = the plan is for the PMS only
-- (walk-ins, direct, agents). Settings → Channel Manager refuses to link it,
-- and the channel sync never sends a price for it even if a link existed.
--
-- Backfill: at a property already linked to the channel manager, every plan
-- not linked today is set to false (Zahill: Best Available Rate and Bed &
-- Breakfast; only Breakfast Non Refund / Refundable sell on the OTAs).
-- Properties without the channel manager keep true. Additive only.
-- ============================================================

ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS sell_on_ota BOOLEAN NOT NULL DEFAULT true;

UPDATE rate_plans rp SET sell_on_ota = false
 WHERE EXISTS (SELECT 1 FROM channel_rate_plans c WHERE c.property_id = rp.property_id)
   AND NOT EXISTS (SELECT 1 FROM channel_rate_plans c WHERE c.rate_plan_id = rp.id);
