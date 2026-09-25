-- Birthday WhatsApp: an optional per-property offer line (e.g. "As a birthday
-- gift, enjoy a complimentary upgrade on your next stay!"). The message used
-- to promise Zahill's upgrade for every property; now each property sets its
-- own, or none. Zahill keeps the wording it had.
ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS birthday_offer TEXT;

UPDATE property_settings ps SET birthday_offer =
  'As a special birthday gift, we''d love to invite you back for a complimentary upgrade on your next stay!'
FROM properties p
WHERE p.id = ps.property_id AND p.slug = 'zahill' AND ps.birthday_offer IS NULL;
