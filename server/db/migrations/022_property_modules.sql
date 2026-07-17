-- ============================================================
-- Migration 022 — Property modules
-- Lets each property enable/disable feature modules independently
-- (e.g. a property with no Room Controller hardware can turn that
-- module off). Routes are gated by middleware/moduleGuard.js.
-- ============================================================

CREATE TABLE property_modules (
  property_id  UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  module       VARCHAR(50) NOT NULL,
  is_enabled   BOOLEAN     NOT NULL DEFAULT true,
  PRIMARY KEY (property_id, module)
);

-- Seed all modules for Zahill. All enabled except room_controller
-- (Zahill has no IoT hardware).
INSERT INTO property_modules (property_id, module, is_enabled) VALUES
  ('00000000-0000-0000-0000-000000000001', 'reservations',    true),
  ('00000000-0000-0000-0000-000000000001', 'front_desk',      true),
  ('00000000-0000-0000-0000-000000000001', 'guest_crm',       true),
  ('00000000-0000-0000-0000-000000000001', 'financial',       true),
  ('00000000-0000-0000-0000-000000000001', 'operations',      true),
  ('00000000-0000-0000-0000-000000000001', 'sales',           true),
  ('00000000-0000-0000-0000-000000000001', 'in_room_media',   true),
  ('00000000-0000-0000-0000-000000000001', 'room_controller', false),
  ('00000000-0000-0000-0000-000000000001', 'insights',        true)
ON CONFLICT DO NOTHING;
