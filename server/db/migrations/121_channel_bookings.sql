-- ============================================================
-- Migration 121 — Channel Manager, stage 3: OTA bookings in
--
-- channel_bookings       one OTA reservation as Channex knows it (its id,
--                        the OTA and its reservation code, who collects the
--                        money) and the PMS group it became, if any.
-- channel_booking_rooms  each of its rooms (Channex booking_room_id) → the
--                        PMS booking made for it.
-- channel_revisions      every revision read from Channex's feed (new /
--                        modified / cancelled) with what the PMS did:
--                        applied / attention (FO must act — listed on the
--                        Channel Manager page and sent on Telegram) /
--                        ignored / error (not confirmed to Channex, tried
--                        again). A revision is confirmed (acked) to Channex
--                        only once its row is saved.
-- bookings.payment_collect  'ota' (the guest paid the OTA, the OTA pays the
--                        hotel) / 'property' (the hotel collects — "pay at
--                        hotel", or a virtual card) / NULL = as before (an OTA
--                        source means the OTA pays). Used by check-in,
--                        check-out and Record Payment.
-- ============================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_collect VARCHAR(10)
  CHECK (payment_collect IN ('ota', 'property'));

CREATE TABLE IF NOT EXISTS channel_bookings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id           UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  provider              VARCHAR(20) NOT NULL DEFAULT 'channex',
  external_booking_id   VARCHAR(100) NOT NULL,
  ota_name              TEXT,
  ota_code              TEXT,
  status                VARCHAR(12) NOT NULL,           -- new / modified / cancelled (Channex's)
  payment_collect       VARCHAR(10),
  reservation_group_id  UUID REFERENCES reservation_groups(id) ON DELETE SET NULL,
  last_revision_id      VARCHAR(100),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, provider, external_booking_id)
);

CREATE TABLE IF NOT EXISTS channel_booking_rooms (
  channel_booking_id  UUID NOT NULL REFERENCES channel_bookings(id) ON DELETE CASCADE,
  external_room_id    VARCHAR(100) NOT NULL,
  booking_id          UUID REFERENCES bookings(id) ON DELETE SET NULL,
  PRIMARY KEY (channel_booking_id, external_room_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_booking_rooms_booking ON channel_booking_rooms (booking_id);

CREATE TABLE IF NOT EXISTS channel_revisions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id           UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  provider              VARCHAR(20) NOT NULL DEFAULT 'channex',
  external_revision_id  VARCHAR(100) NOT NULL,
  external_booking_id   VARCHAR(100),
  channel_booking_id    UUID REFERENCES channel_bookings(id) ON DELETE SET NULL,
  revision_status       VARCHAR(12),                    -- new / modified / cancelled
  ota_name              TEXT,
  ota_code              TEXT,
  guest_name            TEXT,
  arrival               DATE,
  departure             DATE,
  result                VARCHAR(12) NOT NULL CHECK (result IN ('applied', 'attention', 'ignored', 'error')),
  message               TEXT,
  booking_ids           UUID[],
  raw                   JSONB,
  tries                 INT NOT NULL DEFAULT 1,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at          TIMESTAMPTZ,
  acked_at              TIMESTAMPTZ,
  handled_at            TIMESTAMPTZ,
  handled_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (property_id, provider, external_revision_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_revisions_open ON channel_revisions (property_id, received_at DESC);

ALTER TABLE channel_sync_state ADD COLUMN IF NOT EXISTS last_pull_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_pull_error TEXT;
