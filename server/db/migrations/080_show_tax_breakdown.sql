-- 080: show the service charge & tax inside an all-in total, or not.
--
-- Only matters when prices include service & tax (migration 079): on, the
-- invoice / pro forma / receipt and the staff screens say "Includes service
-- charge Rp … and tax Rp …" under the total; off (default — owner's choice),
-- they show just the total. With prices before tax ("++") the service and
-- tax are added on top, so they're always listed. Reports always count them.
-- Additive only.

ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS show_tax_breakdown BOOLEAN NOT NULL DEFAULT false;
