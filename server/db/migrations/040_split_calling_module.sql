-- ============================================================
-- Migration 040 — Split calling out of the room_controller module
--
-- Two-way calling (routes/calls.js, WebRTC) was piggybacking on the
-- room_controller moduleGuard purely because it also identifies a room via
-- units.controller_id — it has no actual ESP32/MQTT/relay dependency. That
-- meant a property without Room Controller hardware couldn't get calling
-- either. New standalone 'calling' module, default ON like every other
-- non-hardware module (room_controller is the one deliberate exception,
-- since it's genuinely hardware-dependent).
-- ============================================================

INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'calling', true FROM properties
ON CONFLICT (property_id, module) DO NOTHING;
