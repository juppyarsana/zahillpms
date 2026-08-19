-- ============================================================
-- Migration 039 — Two-way room-to-desk calls
--
-- Calls were room -> staff only (guest taps "Call Front Desk"). Adds the
-- reverse direction: staff can call a specific room. Same calls table,
-- same WebRTC signaling relay (routes/calls.js's generic /signal and
-- /signal-from-room already work for either direction) — just needs to
-- know which way a given row runs, and who on the staff side placed it.
-- ============================================================

ALTER TABLE calls ADD COLUMN IF NOT EXISTS direction VARCHAR(20) NOT NULL DEFAULT 'room_to_staff'
  CHECK (direction IN ('room_to_staff', 'staff_to_room'));
ALTER TABLE calls ADD COLUMN IF NOT EXISTS initiated_by UUID REFERENCES users(id) ON DELETE SET NULL;
