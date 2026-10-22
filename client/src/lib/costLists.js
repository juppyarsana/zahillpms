// Cost categories and departments — same lists as server/services/costCategories.js
// (shared by Expenses and Payables; keep the two files in step).
export const COST_CATEGORIES = [
  { key: 'food', label: 'Food', department: 'fnb' },
  { key: 'drinks', label: 'Drinks', department: 'fnb' },
  { key: 'guest_supplies', label: 'Guest supplies & amenities', department: 'housekeeping' },
  { key: 'laundry', label: 'Laundry', department: 'housekeeping' },
  { key: 'utilities', label: 'Utilities', department: 'engineering' },
  { key: 'maintenance', label: 'Maintenance & repairs', department: 'engineering' },
  { key: 'supplies', label: 'Supplies', department: 'admin' },
  { key: 'marketing', label: 'Marketing', department: 'sales' },
  { key: 'staff', label: 'Staff', department: 'admin' },
  { key: 'admin_fees', label: 'Admin & Bank Fees', department: 'admin' },
  { key: 'ota_commission', label: 'OTA Commission', department: 'front_office' },
  { key: 'other', label: 'Other', department: 'admin' },
];
export const DEPARTMENTS = [
  { key: 'front_office', label: 'Front Office' },
  { key: 'housekeeping', label: 'Housekeeping' },
  { key: 'fnb', label: 'F&B' },
  { key: 'engineering', label: 'Engineering / Maintenance' },
  { key: 'activities', label: 'Activities' },
  { key: 'sales', label: 'Sales & Marketing' },
  { key: 'admin', label: 'Admin & General' },
];
export const DEPARTMENT_LABEL = Object.fromEntries(DEPARTMENTS.map(d => [d.key, d.label]));
export const categoryDepartment = key => COST_CATEGORIES.find(c => c.key === key)?.department || 'admin';
