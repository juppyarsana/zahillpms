-- ============================================================
-- Migration 060 — Channel Manager (Channex) — spike/validation
--
-- Testing whether a channel-manager integration (OTA distribution via
-- Channex's staging sandbox) is viable against our real data model, before
-- committing to any vendor or building production automation. See
-- CLAUDE.md's Open Decisions / the yield-pricing research thread for the
-- fuller reasoning (Channex vs STAAH vs Beds24).
--
-- New `channel_manager` module, default OFF — same paid-add-on-tier
-- philosophy as `back_office`/`resto_ordering`.
--
-- `channex_property_id` lives directly on `properties`, mirroring
-- `display_token`'s placement (migration 021) — it's the one thing that's
-- genuinely per-our-property. The actual Channex API key is a platform-level
-- env var (CHANNEX_API_KEY), not per-property, since Channex's own auth
-- model is one account key covering every property in that account.
--
-- `channel_manager_mappings` deliberately uses vendor-agnostic column names
-- (`provider`, `external_room_type_id`, `external_rate_plan_id`) rather than
-- `channex_*` — if we later switch to or add Beds24/STAAH, this table's
-- shape doesn't need to change, only a new `provider` value and a new
-- adapter service. Each `units` row maps 1:1 to one external "Room Type"
-- (quantity 1) since there's no room-type-grouping concept in this schema —
-- every unit is a single physical room, priced/tracked independently.
-- ============================================================

-- ── 1. Module row, default OFF ───────────────────────────────
INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'channel_manager', false FROM properties
ON CONFLICT (property_id, module) DO NOTHING;

-- ── 2. Per-property external property id ─────────────────────
ALTER TABLE properties ADD COLUMN IF NOT EXISTS channex_property_id VARCHAR(100);

-- ── 3. Vendor-agnostic unit/rate-plan ↔ external mapping ─────
CREATE TABLE IF NOT EXISTS channel_manager_mappings (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id            UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  provider               VARCHAR(20) NOT NULL DEFAULT 'channex',
  unit_id                UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  rate_plan_id           UUID REFERENCES rate_plans(id) ON DELETE CASCADE,
  external_room_type_id  VARCHAR(100),
  external_rate_plan_id  VARCHAR(100),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, provider, unit_id, rate_plan_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_mappings_property ON channel_manager_mappings(property_id);
