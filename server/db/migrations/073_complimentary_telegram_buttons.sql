-- 073: Approve / Decline buttons on the Telegram approval message
-- (complimentary stays, migration 072). Each approver's message is kept so it
-- can be edited afterwards ("Approved by …") and a button press is only
-- accepted from the chat the message was sent to. A request can now also be
-- declined. The 6-digit code in the same message still works as a fallback.
ALTER TABLE complimentary_request_codes ADD COLUMN IF NOT EXISTS chat_id VARCHAR(64);
ALTER TABLE complimentary_request_codes ADD COLUMN IF NOT EXISTS message_id BIGINT;

ALTER TABLE complimentary_requests ADD COLUMN IF NOT EXISTS declined_by_name VARCHAR(100);
ALTER TABLE complimentary_requests ADD COLUMN IF NOT EXISTS approved_via VARCHAR(10);   -- 'code' | 'button' | NULL

DO $$
DECLARE con_name TEXT;
BEGIN
  SELECT conname INTO con_name FROM pg_constraint
   WHERE conrelid = 'complimentary_requests'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%status%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE complimentary_requests DROP CONSTRAINT %I', con_name);
  END IF;
END $$;
ALTER TABLE complimentary_requests ADD CONSTRAINT complimentary_requests_status_check
  CHECK (status IN ('pending', 'approved', 'declined', 'cancelled'));
