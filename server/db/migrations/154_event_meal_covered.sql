-- 154: One restaurant bill can cover several of an event's meals. The POS
-- ticks the meals a combined bill covers (lunch + coffee breaks + the room on
-- one bill); each ticked meal points at that bill line, and its agreed price
-- stops counting on top of it. Voiding the line makes the agreed price count
-- again. A bill for ONE meal keeps using event_charges.meal_id. Additive only.

ALTER TABLE event_meals ADD COLUMN IF NOT EXISTS covered_by_charge_id UUID REFERENCES event_charges(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_meals_covered ON event_meals (covered_by_charge_id) WHERE covered_by_charge_id IS NOT NULL;
