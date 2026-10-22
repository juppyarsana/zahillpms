// The one list of cost categories, shared by Expenses (paid on the spot) and
// Payables (supplier bills paid later). Each category is one mapping key
// `expense.<key>` in Accounting → Accounts (accountingService MAP_KEYS), so
// the accountant chooses its account once for both. Keep in step with the
// CHECK constraints of expenses / supplier_bills (migration 130).
const COST_CATEGORIES = [
  ['food', 'Food', '5220'],
  ['drinks', 'Drinks', '5230'],
  ['guest_supplies', 'Guest supplies & amenities', '5130'],
  ['laundry', 'Laundry', '6220'],
  ['utilities', 'Utilities (electricity, water, internet, gas)', '6210'],
  ['maintenance', 'Maintenance & repairs', '6230'],
  ['supplies', 'Supplies (cleaning, office…)', '6250'],
  ['marketing', 'Marketing', '6260'],
  ['staff', 'Staff', '6240'],
  ['admin_fees', 'Admin & bank fees', '6270'],
  ['ota_commission', 'OTA commission', '5120'],
  ['other', 'Other', '6290'],
];
const CATEGORY_KEYS = COST_CATEGORIES.map(c => c[0]);
const CATEGORY_LABEL = Object.fromEntries(COST_CATEGORIES.map(([k, l]) => [k, l]));

// Every cost the Reports page counts, one row each: Expenses on the date
// incurred and supplier bills (Payables) on the bill date — never voided ones.
// A subquery with property_id, category, amount, day.
const COSTS_SQL = `(
  SELECT property_id, category, amount, incurred_on AS day FROM expenses WHERE is_voided = false
  UNION ALL
  SELECT property_id, category, total AS amount, bill_date AS day FROM supplier_bills WHERE is_voided = false
)`;

module.exports = { COST_CATEGORIES, CATEGORY_KEYS, CATEGORY_LABEL, COSTS_SQL };
