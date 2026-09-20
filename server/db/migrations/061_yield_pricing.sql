-- ============================================================
-- Migration 061 — Yield / dynamic pricing v1
--
-- Per-room-type (units.type) automatic rate adjustment. Automation is just
-- another WRITER into pricing_periods (source='auto', lower sort_order than
-- any manual period), so /suggest, /calendar and the Channex push need no
-- changes: a manual Pricing rule always wins over an auto period.
--
-- See ROADMAP.md "Channel Manager Integration + Dynamic Pricing" step 4.
-- ============================================================

-- ── 1. Module row, default OFF (paid add-on tier) ────────────
INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'yield_management', false FROM properties
ON CONFLICT (property_id, module) DO NOTHING;

-- ── 2. Mark auto-written periods ─────────────────────────────
ALTER TABLE pricing_periods
  ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto'));
CREATE INDEX IF NOT EXISTS idx_pricing_periods_property_source
  ON pricing_periods(property_id, source);

-- ── 3. Per-room-type settings ────────────────────────────────
-- tier_mode 'percent'    → tiers [{from:0,pct:-10},{from:40,pct:0},...]  (occupancy % ≥ from)
-- tier_mode 'rooms_left' → tiers [{left:1,pct:25},{left:2,pct:10},...]   (unsold rooms)
-- dow_factors: 7 multipliers indexed 0=Sun..6=Sat (1 = no change).
CREATE TABLE IF NOT EXISTS yield_settings (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id    UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_type      VARCHAR(100) NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  tier_mode      VARCHAR(12) NOT NULL DEFAULT 'percent' CHECK (tier_mode IN ('percent', 'rooms_left')),
  tiers          JSONB NOT NULL DEFAULT '[]',
  dow_factors    JSONB NOT NULL DEFAULT '[1,1,1,1,1,1,1]',
  floor_pct      NUMERIC(6,2) NOT NULL DEFAULT -20,
  ceiling_pct    NUMERIC(6,2) NOT NULL DEFAULT 40,
  lookahead_days INT NOT NULL DEFAULT 60 CHECK (lookahead_days BETWEEN 7 AND 365),
  -- Occupancy-tier DISCOUNTS (negative %) only apply to nights within this many days of today
  -- (far-future nights are always empty, so discounting them would hit almost every date).
  -- NULL = no limit. Increases and day-of-week/holiday effects are never limited by this.
  discount_window_days INT CHECK (discount_window_days IS NULL OR discount_window_days BETWEEN 0 AND 365) DEFAULT 14,
  last_run_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, room_type)
);

-- ── 4. Holiday uplifts (per property, keyed by date so an API refresh of the
--      global `holidays` table never clobbers an owner's edit) ─────────────
CREATE TABLE IF NOT EXISTS yield_holiday_uplifts (
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  uplift_pct   NUMERIC(6,2) NOT NULL,
  PRIMARY KEY (property_id, holiday_date)
);

-- Owner-added or (v1.1) AI-suggested local events, per property.
CREATE TABLE IF NOT EXISTS yield_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  date_from   DATE NOT NULL,
  date_to     DATE NOT NULL,
  uplift_pct  NUMERIC(6,2) NOT NULL DEFAULT 0,
  source      VARCHAR(10) NOT NULL DEFAULT 'custom' CHECK (source IN ('custom', 'ai')),
  status      VARCHAR(10) NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'suggested', 'rejected')),
  source_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_yield_events_property ON yield_events(property_id, date_from);

-- ── 5. Append-only change log ("why did this rate change") ───
CREATE TABLE IF NOT EXISTS yield_rate_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_type   VARCHAR(100) NOT NULL,
  stay_date   DATE NOT NULL,
  multiplier  NUMERIC(8,4) NOT NULL,
  factors     JSONB NOT NULL,          -- {occupancy:{...}, dow:{...}, event:{...}, clamped:bool}
  sources     JSONB NOT NULL,          -- which signals were active on this run
  old_multiplier NUMERIC(8,4),
  run_id      UUID NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_yield_log_lookup ON yield_rate_log(property_id, room_type, stay_date, created_at DESC);

-- ── 6. Holidays: track provenance + joint-leave flag; seed official SKB ──
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS is_joint_leave BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'manual';

-- Official SKB 3 Menteri (Kemenag/Kemnaker/KemenPANRB) national holidays + cuti
-- bersama. 2026: setneg.go.id (SKB signed 2025-09-19). 2027: setneg.go.id (SKB
-- signed 2026-09-15). Verified via web fetch 2026-09-20. Balinese entries
-- (Galungan/Kuningan/Nyepi) stay as seeded in 014.
INSERT INTO holidays (holiday_date, name, category, is_joint_leave, source) VALUES
  ('2026-01-01','Tahun Baru 2026 Masehi','national',false,'skb'),
  ('2026-01-16','Isra Mikraj Nabi Muhammad saw.','national',false,'skb'),
  ('2026-02-16','Cuti Bersama Tahun Baru Imlek','national',true,'skb'),
  ('2026-02-17','Tahun Baru Imlek 2577','national',false,'skb'),
  ('2026-03-18','Cuti Bersama Nyepi','national',true,'skb'),
  ('2026-03-19','Hari Suci Nyepi (Tahun Baru Saka 1948)','national',false,'skb'),
  ('2026-03-20','Cuti Bersama Idulfitri','national',true,'skb'),
  ('2026-03-21','Idulfitri 1447 H','national',false,'skb'),
  ('2026-03-22','Idulfitri 1447 H','national',false,'skb'),
  ('2026-03-23','Cuti Bersama Idulfitri','national',true,'skb'),
  ('2026-03-24','Cuti Bersama Idulfitri','national',true,'skb'),
  ('2026-04-03','Wafat Yesus Kristus','national',false,'skb'),
  ('2026-04-05','Kebangkitan Yesus Kristus (Paskah)','national',false,'skb'),
  ('2026-05-01','Hari Buruh Internasional','national',false,'skb'),
  ('2026-05-14','Kenaikan Yesus Kristus','national',false,'skb'),
  ('2026-05-15','Cuti Bersama Kenaikan Yesus Kristus','national',true,'skb'),
  ('2026-05-27','Iduladha 1447 H','national',false,'skb'),
  ('2026-05-28','Cuti Bersama Iduladha','national',true,'skb'),
  ('2026-05-31','Hari Raya Waisak 2570 BE','national',false,'skb'),
  ('2026-06-01','Hari Lahir Pancasila','national',false,'skb'),
  ('2026-06-16','1 Muharam Tahun Baru Islam 1448 H','national',false,'skb'),
  ('2026-08-17','Proklamasi Kemerdekaan','national',false,'skb'),
  ('2026-08-25','Maulid Nabi Muhammad saw.','national',false,'skb'),
  ('2026-12-24','Cuti Bersama Natal','national',true,'skb'),
  ('2026-12-25','Kelahiran Yesus Kristus (Natal)','national',false,'skb'),
  ('2027-01-01','Tahun Baru 2027 Masehi','national',false,'skb'),
  ('2027-01-05','Isra Mikraj Nabi Muhammad saw.','national',false,'skb'),
  ('2027-02-05','Cuti Bersama Tahun Baru Imlek','national',true,'skb'),
  ('2027-02-06','Tahun Baru Imlek 2578','national',false,'skb'),
  ('2027-03-09','Cuti Bersama Idulfitri','national',true,'skb'),
  ('2027-03-10','Idulfitri 1448 H','national',false,'skb'),
  ('2027-03-11','Idulfitri 1448 H','national',false,'skb'),
  ('2027-03-12','Cuti Bersama Idulfitri','national',true,'skb'),
  ('2027-03-15','Cuti Bersama Idulfitri','national',true,'skb'),
  ('2027-03-25','Cuti Bersama Wafat Yesus Kristus','national',true,'skb'),
  ('2027-03-26','Wafat Yesus Kristus','national',false,'skb'),
  ('2027-03-28','Kebangkitan Yesus Kristus (Paskah)','national',false,'skb'),
  ('2027-05-01','Hari Buruh Internasional','national',false,'skb'),
  ('2027-05-06','Kenaikan Yesus Kristus','national',false,'skb'),
  ('2027-05-17','Iduladha 1448 H','national',false,'skb'),
  ('2027-05-18','Cuti Bersama Iduladha','national',true,'skb'),
  ('2027-05-19','Cuti Bersama Waisak','national',true,'skb'),
  ('2027-05-20','Hari Raya Waisak 2571 BE','national',false,'skb'),
  ('2027-06-01','Hari Lahir Pancasila','national',false,'skb'),
  ('2027-06-06','1 Muharam Tahun Baru Islam 1449 H','national',false,'skb'),
  ('2027-08-15','Maulid Nabi Muhammad saw.','national',false,'skb'),
  ('2027-08-17','Proklamasi Kemerdekaan','national',false,'skb'),
  ('2027-12-24','Cuti Bersama Natal','national',true,'skb'),
  ('2027-12-25','Kelahiran Yesus Kristus (Natal)','national',false,'skb'),
  ('2027-12-26','Isra Mikraj Nabi Muhammad saw.','national',false,'skb')
ON CONFLICT (holiday_date, name) DO NOTHING;

-- Existing 014 Balinese rows keep source='manual'. Also seed Balinese holidays
-- for the rest of 2026 is unnecessary: Galungan/Kuningan fall 2026-06-17/27 (past)
-- and next 2027-01-13 (already seeded) per the 210-day pawukon cycle.
