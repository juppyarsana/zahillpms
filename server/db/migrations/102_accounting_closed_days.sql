-- 102: Accounting — closed days.
-- Once a day is closed, its journal postings are kept here exactly as they
-- were (each with the account it had that day) and the journal of that day is
-- read from this row instead of being rebuilt. A later change to a closed day
-- is posted as a correction ("adjust" postings, each naming the day it
-- corrects) in the next day that is closed — services/journalService.js.
-- Closed days are an unbroken run: closing goes forward day by day, and only
-- the last closed day can be opened again. Additive only.
CREATE TABLE IF NOT EXISTS gl_closed_days (
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  closed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  -- [{ entry, key, amount (+ debit / − credit), ref, memo, account { id, code, name, type },
  --    of_entry, for_date (corrections only) }]
  postings      JSONB NOT NULL,
  PRIMARY KEY (property_id, business_date)
);
