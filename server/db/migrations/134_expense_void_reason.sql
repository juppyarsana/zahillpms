-- 134: Expenses — why an expense was voided (owner, 2026-10-23).
-- Finance → Expenses now opens each expense (description, who recorded it,
-- when) and Void asks for a reason, kept with the voided expense (shown with
-- "Show voided"). NULL for expenses voided before this.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS void_reason TEXT;
