ALTER TABLE competitor_snapshots ADD COLUMN price_level SMALLINT;

-- Zahill's own Google listing, resolved 2026-07-06 — used as the self-benchmark row.
-- Not subject to the discovery shortlist/review-count filters that apply to competitors.
INSERT INTO competitors (name, place_id, matched_address, is_self, is_active)
VALUES (
  'Zahill Glamping Kintamani',
  'ChIJIeAIVbj30S0RrtFkwfPDn_E',
  'Q95X+4V Songan A, Bangli Regency, Bali 80652, Indonesia',
  true,
  true
)
ON CONFLICT (place_id) DO UPDATE SET is_self = true, is_active = true;
