-- Children + kids eat breakfast free (owner, 2026-10-17). A reservation can
-- carry children next to its guests (num_guests stays the adults: price, meal
-- plan and pax are unchanged). When the hotel covers the children's breakfast
-- on that reservation (FO ticks it; breakfast only), the kitchen, Guest Lists,
-- the Forecast and the POS breakfast list count them as free kids'
-- breakfasts — never revenue, never on the folio.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS children SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS kids_free_breakfast BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_children_check CHECK (children BETWEEN 0 AND 20);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
