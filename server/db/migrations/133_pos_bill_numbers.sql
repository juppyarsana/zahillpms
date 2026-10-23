-- 133: POS bill numbers on the hotel's invoice (owner, 2026-10-23).
--
-- A restaurant bill charged to a room or an event used to print every item on
-- the hotel invoice / pro forma. The guest already has the restaurant's
-- itemised receipt, so the printed documents now show the restaurant's name
-- and the bill number on that receipt instead — "SISI GEGE · SG-00001/10/26".
-- The POS sends both with each charge (bill_no, outlet); the Folio tab, Sales
-- History and the event page keep the items (sales.description).
-- NULL = sent by a POS without bill numbers: the POS id (external_ref) is printed.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS pos_bill_no VARCHAR(40);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS pos_outlet VARCHAR(60);
ALTER TABLE event_charges ADD COLUMN IF NOT EXISTS pos_bill_no VARCHAR(40);
ALTER TABLE event_charges ADD COLUMN IF NOT EXISTS pos_outlet VARCHAR(60);
