// The one list of cost categories, shared by Expenses (paid on the spot) and
// Payables (supplier bills paid later). Each category is one mapping key
// `expense.<key>` in Accounting → Accounts (accountingService MAP_KEYS), so
// the accountant chooses its account once for both. Keep in step with the
// CHECK constraints of expenses / supplier_bills (migration 130).
// [key, label, standard account, usual department]
const COST_CATEGORIES = [
  ['food', 'Food', '500-21-001', 'fnb'],
  ['drinks', 'Drinks', '500-21-002', 'fnb'],
  ['guest_supplies', 'Guest supplies & amenities', '602-12-002', 'housekeeping'],
  ['laundry', 'Laundry', '602-12-005', 'housekeeping'],
  ['utilities', 'Utilities (electricity, water, internet, gas)', '751-75-001', 'engineering'],
  ['maintenance', 'Maintenance & repairs', '732-74-037', 'engineering'],
  ['supplies', 'Supplies (cleaning, office…)', '602-12-003', 'admin'],
  ['marketing', 'Marketing', '722-73-031', 'sales'],
  ['staff', 'Staff', '712-72-029', 'admin'],
  ['admin_fees', 'Admin & bank fees', '702-71-021', 'admin'],
  ['ota_commission', 'OTA commission', '602-11-019', 'front_office'],
  ['other', 'Other', '702-71-099', 'admin'],
];
// Departments a cost is for (migration 131) — a management tag for
// "which department costs the most"; the category still decides the account.
const DEPARTMENTS = [
  ['front_office', 'Front Office'],
  ['housekeeping', 'Housekeeping'],
  ['fnb', 'F&B'],
  ['engineering', 'Engineering / Maintenance'],
  ['activities', 'Activities'],
  ['sales', 'Sales & Marketing'],
  ['admin', 'Admin & General'],
];
const DEPARTMENT_KEYS = DEPARTMENTS.map(d => d[0]);
const DEPARTMENT_LABEL = Object.fromEntries(DEPARTMENTS);
const CATEGORY_DEPARTMENT = Object.fromEntries(COST_CATEGORIES.map(c => [c[0], c[3]]));
// The department a cost goes to: the one chosen, else the supplier's usual, else the category's usual.
const departmentFor = (chosen, supplierDefault, category) =>
  (DEPARTMENT_KEYS.includes(chosen) && chosen) || (DEPARTMENT_KEYS.includes(supplierDefault) && supplierDefault)
  || CATEGORY_DEPARTMENT[category] || 'admin';
const CATEGORY_KEYS = COST_CATEGORIES.map(c => c[0]);
const CATEGORY_LABEL = Object.fromEntries(COST_CATEGORIES.map(([k, l]) => [k, l]));

// Every cost the Reports page counts, one row each: Expenses on the date
// incurred and supplier bills (Payables) on the bill date — never voided ones.
// A subquery with property_id, category, department, amount, day.
const COSTS_SQL = `(
  SELECT property_id, category, department, amount, incurred_on AS day FROM expenses WHERE is_voided = false
  UNION ALL
  SELECT property_id, category, department, total AS amount, bill_date AS day FROM supplier_bills WHERE is_voided = false
)`;

module.exports = { COST_CATEGORIES, CATEGORY_KEYS, CATEGORY_LABEL, COSTS_SQL,
  DEPARTMENTS, DEPARTMENT_KEYS, DEPARTMENT_LABEL, CATEGORY_DEPARTMENT, departmentFor };
