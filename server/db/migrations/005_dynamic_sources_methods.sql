-- Dynamic booking sources and payment methods
-- Replaces hardcoded CHECK constraints so channels/methods can be managed in Settings

CREATE TABLE IF NOT EXISTS booking_sources (
  id          VARCHAR(50)  PRIMARY KEY,
  label       VARCHAR(100) NOT NULL,
  is_ota      BOOLEAN      NOT NULL DEFAULT false,
  color       VARCHAR(20)  NOT NULL DEFAULT '#6b7280',
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  sort_order  INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id          VARCHAR(50)  PRIMARY KEY,
  label       VARCHAR(100) NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  sort_order  INT          NOT NULL DEFAULT 0
);

INSERT INTO booking_sources (id, label, is_ota, color, sort_order) VALUES
  ('direct',      'Direct',       false, '#16a34a', 0),
  ('airbnb',      'Airbnb',       true,  '#FF5A5F', 1),
  ('booking_com', 'Booking.com',  true,  '#003580', 2),
  ('traveloka',   'Traveloka',    true,  '#0770CF', 3),
  ('walkin',      'Walk-in',      false, '#6b7280', 4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payment_methods (id, label, sort_order) VALUES
  ('bank_transfer', 'Bank Transfer', 0),
  ('qris',          'QRIS',          1),
  ('cash',          'Cash',          2),
  ('ota_managed',   'OTA Managed',   3),
  ('wise',          'Wise',          4)
ON CONFLICT (id) DO NOTHING;

-- Remove hardcoded CHECK constraints so any value from the tables is valid
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_source_check;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
