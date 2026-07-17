-- ============================================================
-- Migration 026 — Widen columns that store a per-property-scoped id
--
-- seedPropertyDefaults.js clones booking_sources/payment_methods/roles
-- for each new property using an id scheme of `<original_id>-<property_uuid>`
-- (e.g. 'owner-65926b31-86b6-4f5e-bb93-9b54e9f5ee5d', ~42 chars), matching
-- the 50-char width of booking_sources.id / payment_methods.id / roles.id.
--
-- But the columns that actually STORE a copy of those ids on other tables
-- were never widened to match:
--   users.role      VARCHAR(20) — can't hold a namespaced role id at all
--   bookings.source VARCHAR(30) — can't hold a namespaced booking_sources id
--   payments.method VARCHAR(20) — can't hold a namespaced payment_methods id
--
-- Without this, creating a user/booking/payment for any newly onboarded
-- property fails outright with "value too long for type character varying".
-- ============================================================

ALTER TABLE users    ALTER COLUMN role   TYPE VARCHAR(50);
ALTER TABLE bookings  ALTER COLUMN source TYPE VARCHAR(50);
ALTER TABLE payments  ALTER COLUMN method TYPE VARCHAR(50);
