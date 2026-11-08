-- A restaurant phone line (services/callLines.js, routes/posCalls.js).
-- A call belongs to a line: 'front_desk' (as before — the PMS staff screens and,
-- later, the front desk phone) or 'restaurant' (answered in the POS). Calls
-- answered / placed from the POS have no PMS user, so the name is kept as text.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS line TEXT NOT NULL DEFAULT 'front_desk'
  CHECK (line IN ('front_desk', 'restaurant'));
ALTER TABLE calls ADD COLUMN IF NOT EXISTS answered_by_name TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS initiated_by_name TEXT;

-- Owner switches the restaurant line on (Property Details → POS Integration).
ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS restaurant_line BOOLEAN NOT NULL DEFAULT false;
