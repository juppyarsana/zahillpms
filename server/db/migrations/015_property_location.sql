ALTER TABLE property_settings ADD COLUMN latitude NUMERIC(9,6);
ALTER TABLE property_settings ADD COLUMN longitude NUMERIC(9,6);
UPDATE property_settings SET latitude = -8.242188, longitude = 115.399688 WHERE id = 1;

ALTER TABLE competitors ADD CONSTRAINT competitors_place_id_unique UNIQUE (place_id);
