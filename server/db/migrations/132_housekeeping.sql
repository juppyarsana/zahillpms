-- 132: Housekeeping, step 1 (owner, 2026-10-23) — replaces the Operations
-- task board for cleaning.
--
-- A room's cleaning is now state on the room, not a task card:
--   units.housekeeping_status (051) — 'dirty' = to clean, 'clean' = done
--   units.clean_request_*           — a clean asked for while a guest is in
--                                     the room: when, by whom (the guest on the
--                                     room tablet, or front desk + the user)
-- Check-out no longer creates a "Clean & prepare unit" task; the guest's
-- Clean Room on the tablet no longer creates a task. Do Not Disturb stays a
-- task (as before) — it is the guest's switch, not cleaning work.
--
-- Telegram (free alerts, services/smartReports.js):
--   alert_housekeeping — rooms to clean after check-out, clean on request
--                        (with who asked), Do Not Disturb; to housekeeping
--   alert_room_clean   — a room marked clean; to front desk
-- Each recipient chooses the language of their messages (English / Bahasa
-- Indonesia): notification_recipients.language.

ALTER TABLE units ADD COLUMN IF NOT EXISTS clean_request_at TIMESTAMPTZ;
ALTER TABLE units ADD COLUMN IF NOT EXISTS clean_request_via VARCHAR(12);
ALTER TABLE units ADD COLUMN IF NOT EXISTS clean_request_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE units DROP CONSTRAINT IF EXISTS units_clean_request_via_check;
ALTER TABLE units ADD CONSTRAINT units_clean_request_via_check
  CHECK (clean_request_via IS NULL OR clean_request_via IN ('guest', 'front_desk'));

ALTER TABLE notification_recipients ADD COLUMN IF NOT EXISTS language VARCHAR(2) NOT NULL DEFAULT 'en';
ALTER TABLE notification_recipients DROP CONSTRAINT IF EXISTS notification_recipients_language_check;
ALTER TABLE notification_recipients ADD CONSTRAINT notification_recipients_language_check
  CHECK (language IN ('en', 'id'));

-- Open "Please clean room" requests from the tablet become clean requests on
-- the room; then those cards and the open check-out cleaning cards are done
-- (the room's housekeeping_status already says it is to clean).
UPDATE units u
SET clean_request_at = t.created_at, clean_request_via = 'guest',
    housekeeping_status = 'dirty', housekeeping_updated_at = NOW()
FROM (SELECT DISTINCT ON (unit_id) unit_id, created_at FROM tasks
      WHERE type = 'guest_request' AND title LIKE 'Please clean room%' AND status <> 'done' AND unit_id IS NOT NULL
      ORDER BY unit_id, created_at) t
WHERE u.id = t.unit_id;

UPDATE tasks SET status = 'done', updated_at = NOW()
WHERE status <> 'done'
  AND (type = 'housekeeping' OR (type = 'guest_request' AND title LIKE 'Please clean room%'));

-- Every housekeeping recipient gets "Housekeeping". A property with no
-- housekeeping recipient yet: whoever got the guests' Clean Room messages
-- before keeps getting them (so no request goes unread). Front desk
-- recipients get "Room clean".
UPDATE notification_recipients
SET reports = array_append(reports, 'alert_housekeeping')
WHERE channel = 'telegram' AND NOT ('alert_housekeeping' = ANY(reports)) AND role = 'housekeeping';

UPDATE notification_recipients r
SET reports = array_append(r.reports, 'alert_housekeeping')
WHERE r.channel = 'telegram' AND NOT ('alert_housekeeping' = ANY(r.reports))
  AND 'alert_guest_requests' = ANY(r.reports)
  AND NOT EXISTS (SELECT 1 FROM notification_recipients x
                  WHERE x.property_id = r.property_id AND x.channel = 'telegram' AND x.role = 'housekeeping');

UPDATE notification_recipients
SET reports = array_append(reports, 'alert_room_clean')
WHERE channel = 'telegram' AND NOT ('alert_room_clean' = ANY(reports))
  AND (role = 'front_desk' OR 'alert_guest_requests' = ANY(reports));
