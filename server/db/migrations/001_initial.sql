-- Birdnest PMS — Initial Schema Migration

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users (staff + owner)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'staff')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Units (glamping nests)
CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL UNIQUE,
  type VARCHAR(100),
  description TEXT,
  base_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_guests INT NOT NULL DEFAULT 2,
  status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied','maintenance','blocked')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Loyalty tiers (must exist before guests FK)
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  emoji VARCHAR(10),
  color VARCHAR(20),
  threshold_type VARCHAR(20) NOT NULL CHECK (threshold_type IN ('nights','spend','visits')),
  threshold_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_perks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier_id UUID NOT NULL REFERENCES loyalty_tiers(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

-- Guests
CREATE TABLE IF NOT EXISTS guests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  nationality VARCHAR(100),
  whatsapp VARCHAR(50),
  email VARCHAR(255),
  birthday DATE,
  anniversary DATE,
  id_document_url TEXT,
  loyalty_tier_id UUID REFERENCES loyalty_tiers(id) ON DELETE SET NULL,
  tier_override BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Guest preferences (flexible tags)
CREATE TABLE IF NOT EXISTS guest_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  category VARCHAR(20) NOT NULL CHECK (category IN ('dietary','room','habit','special')),
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bookings
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  nights INT NOT NULL GENERATED ALWAYS AS (check_out_date - check_in_date) STORED,
  num_guests INT NOT NULL DEFAULT 1,
  source VARCHAR(30) NOT NULL DEFAULT 'direct' CHECK (source IN ('direct','airbnb','booking_com','traveloka','walkin')),
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','pending','checked_in','checked_out','cancelled','no_show')),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  special_requests TEXT,
  internal_notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL CHECK (type IN ('deposit','balance')),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received')),
  method VARCHAR(20) CHECK (method IN ('bank_transfer','qris','cash','ota_managed','wise')),
  received_at TIMESTAMPTZ,
  received_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Check-in records
CREATE TABLE IF NOT EXISTS checkin_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  checkin_time TIMESTAMPTZ,
  checkout_time TIMESTAMPTZ,
  id_captured BOOLEAN NOT NULL DEFAULT FALSE,
  checklist_data JSONB DEFAULT '{}',
  condition_notes TEXT,
  processed_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Room allotments
CREATE TABLE IF NOT EXISTS allotments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('direct','airbnb','booking_com','traveloka','buffer')),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INT NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(unit_id, month, year)
);

-- Operations tasks
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  type VARCHAR(20) NOT NULL DEFAULT 'housekeeping' CHECK (type IN ('housekeeping','maintenance','supplies','grounds','guest_request')),
  priority VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  due_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Booking notes (staff notes per booking)
CREATE TABLE IF NOT EXISTS booking_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products (ancillary sales)
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'other' CHECK (category IN ('drinks','food','merchandise','tour','other')),
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  description TEXT,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ancillary sales
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash','qris','room_charge')),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  served_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sale items
CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INT NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- Seed: 5 glamping units
INSERT INTO units (name, type, description, base_rate, max_guests) VALUES
  ('Nest 1', 'Glamping Tent', 'Cozy nest with volcano view', 1500000, 2),
  ('Nest 2', 'Glamping Tent', 'Secluded forest nest', 1500000, 2),
  ('Nest 3', 'Glamping Tent', 'Sunrise panorama nest', 1800000, 2),
  ('Nest 4', 'Family Nest', 'Spacious family nest', 2200000, 4),
  ('Nest 5', 'Premium Nest', 'Premium nest with private terrace', 2500000, 2)
ON CONFLICT (name) DO NOTHING;
