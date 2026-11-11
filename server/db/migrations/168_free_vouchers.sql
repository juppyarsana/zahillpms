-- 168: Free (complimentary) vouchers. A voucher type can be given away: no money,
-- no liability. Staff with the complimentary permission issue it; anyone else
-- asks and an approver presses Approve on Telegram (same approvers as
-- complimentary stays). Using it books the stay at its normal price and makes it
-- complimentary with the scope chosen when it was issued, so the value given
-- away shows in Reports like any complimentary stay. Additive only.

ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS free_scope VARCHAR(10) CHECK (free_scope IN ('room', 'room_meals', 'all'));
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS free_reason TEXT;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS free_approved_by VARCHAR(160);   -- NULL = issued directly by someone with the permission

-- A booking whose voucher was released (cancelled, or a no-show that doesn't use it up) can't be
-- put back: the voucher may be in use elsewhere by then.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS released_voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL;

-- A request to give a free voucher, waiting for an approver.
CREATE TABLE IF NOT EXISTS voucher_free_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  template_id      UUID NOT NULL REFERENCES voucher_templates(id) ON DELETE CASCADE,
  requested_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  scope            VARCHAR(10) NOT NULL CHECK (scope IN ('room', 'room_meals', 'all')),
  reason           TEXT NOT NULL,
  payload          JSONB NOT NULL,            -- who it is for: buyer_guest_id / buyer_name / email / phone / recipient_name
  status           VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  expires_at       TIMESTAMPTZ NOT NULL,
  approved_by_name VARCHAR(160),
  declined_by_name VARCHAR(160),
  decided_at       TIMESTAMPTZ,
  voucher_id       UUID REFERENCES vouchers(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voucher_free_requests_open ON voucher_free_requests (property_id) WHERE status = 'pending';

-- Each approver's Telegram message (to take the buttons off afterwards).
CREATE TABLE IF NOT EXISTS voucher_free_request_messages (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id     UUID NOT NULL REFERENCES voucher_free_requests(id) ON DELETE CASCADE,
  recipient_name VARCHAR(160) NOT NULL,
  chat_id        VARCHAR(40) NOT NULL,
  message_id     BIGINT
);
CREATE INDEX IF NOT EXISTS idx_voucher_free_request_messages ON voucher_free_request_messages (request_id);
