-- Front desk ↔ restaurant calls (staff to staff, no room). Such a call has no
-- unit: property_id says whose it is, line = the side that called, to_line =
-- the side that rings. services/callLines.js placeToLine.
ALTER TABLE calls ALTER COLUMN unit_id DROP NOT NULL;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS to_line TEXT CHECK (to_line IN ('front_desk', 'restaurant'));
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_direction_check;
ALTER TABLE calls ADD CONSTRAINT calls_direction_check CHECK (direction IN ('room_to_staff', 'staff_to_room', 'staff_to_staff'));
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_room_or_line;
ALTER TABLE calls ADD CONSTRAINT calls_room_or_line CHECK (
  (direction = 'staff_to_staff' AND unit_id IS NULL AND property_id IS NOT NULL AND to_line IS NOT NULL AND to_line <> line)
  OR (direction <> 'staff_to_staff' AND unit_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_calls_line_to_line ON calls (property_id, to_line, created_at) WHERE direction = 'staff_to_staff';
