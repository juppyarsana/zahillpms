-- ============================================================
-- Migration 048 — Resto Ordering (new resto_ordering module)
--
-- Adds the infrastructure behind the new standalone resto-display/ app:
--   1. the module row itself, default OFF for every existing property
--      (paid add-on tier, same philosophy as the planned back_office module)
--   2. a per-table QR credential (qr_token) — deliberately NOT the
--      property-wide properties.display_token, which is a shared secret held
--      by staff-configured Room/TV/Kitchen Display devices; printing that on
--      a table would hand anyone who scans it access to unrelated endpoints
--      for arbitrary rooms. qr_token resolves to exactly one table.
--   3. table_sessions — a dining visit identity. restaurant_tables.status was
--      a bare available/occupied flag with no session identity, so multiple
--      orders across one visit couldn't be grouped and an old QR scan could
--      leak into the next party's visit. One open session per table is
--      enforced by a partial unique index (no denormalized pointer column).
--   4. sales.confirmation_status — the pre-kitchen "requested" bucket for
--      ROOM-SERVICE orders only (Room Display guest ordering). QR self-order
--      and staff-entered orders still fire straight to the kitchen, matching
--      real POS/KDS practice. Deliberately a separate column from
--      kitchen_status so kitchen_status keeps one meaning and its existing
--      CHECK constraint needs no surgery.
--   5. sales.payment_method loses its hardcoded cash/qris/room_charge CHECK
--      and is widened to VARCHAR(50) — the same latent width bug migration
--      026 already fixed for payments.method/bookings.source (namespaced
--      payment_methods.id can run ~42+ chars), just never triggered here
--      because sales never stored a real payment_methods.id before. New
--      validation moves into salesService.createSale (see that file).
-- ============================================================

-- ── 1. Module row, default OFF ───────────────────────────────
INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'resto_ordering', false FROM properties
ON CONFLICT (property_id, module) DO NOTHING;

-- ── 2. Per-table QR credential ───────────────────────────────
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS qr_token VARCHAR(64);
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS qr_token_rotated_at TIMESTAMPTZ;

UPDATE restaurant_tables
   SET qr_token = replace(uuid_generate_v4()::text, '-', '') || replace(uuid_generate_v4()::text, '-', '')
 WHERE qr_token IS NULL;

ALTER TABLE restaurant_tables
  ALTER COLUMN qr_token SET DEFAULT replace(uuid_generate_v4()::text, '-', '') || replace(uuid_generate_v4()::text, '-', '');
ALTER TABLE restaurant_tables ALTER COLUMN qr_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_tables_qr_token ON restaurant_tables(qr_token);

-- ── 3. Table sessions (one dining visit) ─────────────────────
CREATE TABLE IF NOT EXISTS table_sessions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  table_id    UUID NOT NULL REFERENCES restaurant_tables(id) ON DELETE CASCADE,
  status      VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by   UUID REFERENCES users(id) ON DELETE SET NULL,   -- NULL = opened implicitly by a guest QR order
  opened_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_table_sessions_property ON table_sessions(property_id);
CREATE INDEX IF NOT EXISTS idx_table_sessions_table    ON table_sessions(table_id);

-- Invariant: a table can have at most one open session at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_table_sessions_one_open_per_table
  ON table_sessions(table_id) WHERE status = 'open';

ALTER TABLE sales ADD COLUMN IF NOT EXISTS table_session_id UUID REFERENCES table_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_table_session ON sales(table_session_id);

-- ── 4. Room-service confirmation step ────────────────────────
ALTER TABLE sales ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(20)
  CHECK (confirmation_status IN ('pending', 'confirmed', 'rejected'));
ALTER TABLE sales ADD COLUMN IF NOT EXISTS confirmed_by     UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS confirmed_at     TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_pending_confirmation
  ON sales(property_id, created_at) WHERE confirmation_status = 'pending';

-- Where an order was entered — not load-bearing for any gate, used to label
-- tickets and (later) split reporting by channel. NULL for historical rows.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS order_source VARCHAR(20)
  CHECK (order_source IN ('pos', 'room_display', 'guest_qr', 'resto_staff'));

-- ── 5. Payment method — drop the hardcoded CHECK, widen the column ──────
-- Dynamically locate the auto-generated constraint name from migration 001
-- rather than hardcoding it, since Postgres's default naming isn't something
-- to depend on blindly across environments.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'sales'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%payment_method%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sales DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE sales ALTER COLUMN payment_method TYPE VARCHAR(50);
