-- 096: Reports & Alerts recipients can have the role 'housekeeping'.
-- Migration 091 (room check / minibar) added the housekeeping recipient role
-- to the page and the server, but the role check from migration 068 still
-- only allowed owner / manager / front_desk / kitchen / other, so saving a
-- housekeeping recipient failed.
ALTER TABLE notification_recipients DROP CONSTRAINT IF EXISTS notification_recipients_role_check;
ALTER TABLE notification_recipients ADD CONSTRAINT notification_recipients_role_check
  CHECK (role IN ('owner', 'manager', 'front_desk', 'kitchen', 'housekeeping', 'other'));
