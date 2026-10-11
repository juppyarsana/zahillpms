-- 107: Agreed price per person on an event's meals.
-- Sales quotes a meeting with its coffee breaks / lunch / dinner up front, so
-- the pro forma must show them before the restaurant has rung anything up.
--   unit_price  — NET per person (before service & tax), like every bill line
--   shown_price — per person as typed, when prices include service & tax
-- NULL = no price agreed here (the restaurant's own bill decides).
-- An agreed meal is NOT revenue and not on the bill: it is what the client is
-- expected to pay, replaced by the restaurant's bill (event_charges.type =
-- 'pos' with this meal_id) once the POS charges it. Additive only.
ALTER TABLE event_meals ADD COLUMN IF NOT EXISTS unit_price  NUMERIC(14,2);
ALTER TABLE event_meals ADD COLUMN IF NOT EXISTS shown_price NUMERIC(14,2);
CREATE INDEX IF NOT EXISTS idx_event_charges_meal ON event_charges (meal_id) WHERE meal_id IS NOT NULL;
