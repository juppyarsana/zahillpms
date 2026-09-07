-- Guest ID/passport number — needed for the daily guest report Bali
-- properties must submit to the local police (STPM/lapor tamu). Not
-- previously captured; guests only had name + nationality.
ALTER TABLE guests ADD COLUMN IF NOT EXISTS id_number VARCHAR(50);
