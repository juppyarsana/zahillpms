-- 092: what a property prints at the foot of its pro forma invoice.
--
-- { terms: "one line per term", bank: { account_name, account_no, bank_name },
--   signers: [{ label, name, title }] (up to 3) } — payment terms, the bank
-- account to transfer to, and the "Prepared by / Acknowledged by" signature
-- lines. NULL (every property until its owner fills it in) = the pro forma
-- prints as before. Additive only.

ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS proforma_footer JSONB;
