-- 070: External POS integration (guest lookup + charge-to-room).
-- A separate POS product (e.g. Separuh) keeps its own menu/recipes/stock and
-- only tells the PMS about the sales a guest charges to their room. Those land
-- as a `sales` row with NO sale_items (the POS menu is never mirrored into
-- `products`) plus a `folio_charges` row. See POS_INTEGRATION_PLAN.md.

-- ── 1. Module (default off, backfilled) ─────────────────────────
INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'pos_integration', false FROM properties
ON CONFLICT (property_id, module) DO NOTHING;

-- ── 2. Per-property POS API key (rotatable, unlike display_token) ──
ALTER TABLE properties ADD COLUMN IF NOT EXISTS pos_api_key VARCHAR(64) UNIQUE;

-- ── 3. sales: external source, idempotency ref, free-text description ──
DO $$
DECLARE con_name TEXT;
BEGIN
  SELECT conname INTO con_name
    FROM pg_constraint
   WHERE conrelid = 'sales'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%order_source%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sales DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE sales ADD CONSTRAINT sales_order_source_check
  CHECK (order_source IN ('pos', 'room_display', 'guest_qr', 'resto_staff', 'external_pos'));

-- The POS's own transaction id — a retried POST returns the original sale
-- instead of charging the room twice.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS external_ref VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_external_ref
  ON sales (property_id, external_ref) WHERE external_ref IS NOT NULL;

-- What was sold, as the POS describes it (there are no sale_items to join).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS description VARCHAR(500);
