-- ============================================================
-- Migration 027 — Un-namespace cloned roles/booking_sources/payment_methods ids
--
-- seedPropertyDefaults.js (since 023) cloned these three tables' global
-- templates using id = '<template_id>-<property_uuid>' (e.g.
-- 'owner-65926b31-86b6-4f5e-bb93-9b54e9f5ee5d'). That's unnecessary — the
-- (id, property_id) composite unique index added in migration 020 already
-- lets every property reuse the same bare id — and it's actively wrong,
-- because a long list of code compares these ids literally against bare
-- strings ('owner', 'direct', 'cash', ...): requireRole('owner'),
-- AuthContext.can()/firstAllowedPath, every owner-only settings page,
-- OTA_SOURCES checks in checkin.js, etc. Zahill's rows predate
-- multi-tenancy and kept bare ids, so this only surfaced once a second
-- property (Birdnest) was actually onboarded through the real flow —
-- every one of those checks silently fails for Birdnest's owner.
--
-- This strips the '-<property_id>' suffix back off, for any property
-- (not just Birdnest) that already got namespaced rows, and repairs the
-- columns that stored a copy of the namespaced id (users.role,
-- bookings.source, payments.method — the latter scoped via bookings,
-- since payments has no property_id of its own).
--
-- seedPropertyDefaults.js is fixed in the same change so no new property
-- picks up namespaced ids going forward.
-- ============================================================

UPDATE roles
SET id = regexp_replace(id, '-' || property_id::text || '$', '')
WHERE property_id IS NOT NULL
  AND id LIKE '%-' || property_id::text;

UPDATE booking_sources
SET id = regexp_replace(id, '-' || property_id::text || '$', '')
WHERE property_id IS NOT NULL
  AND id LIKE '%-' || property_id::text;

UPDATE payment_methods
SET id = regexp_replace(id, '-' || property_id::text || '$', '')
WHERE property_id IS NOT NULL
  AND id LIKE '%-' || property_id::text;

UPDATE users
SET role = regexp_replace(role, '-' || property_id::text || '$', '')
WHERE property_id IS NOT NULL
  AND role LIKE '%-' || property_id::text;

UPDATE bookings
SET source = regexp_replace(source, '-' || property_id::text || '$', '')
WHERE property_id IS NOT NULL
  AND source LIKE '%-' || property_id::text;

UPDATE payments p
SET method = regexp_replace(p.method, '-' || b.property_id::text || '$', '')
FROM bookings b
WHERE p.booking_id = b.id
  AND p.method LIKE '%-' || b.property_id::text;
