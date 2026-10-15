// Adviser item 6: what kind of cost each BOM section is, so the BOM explains
// the whole budget. Same list and order as backend/src/lib/bomRules.js
// COST_CATEGORIES and the bomsections_cost_category_check constraint.
export const COST_CATEGORIES = [
  "Materials & Labor",
  "Manpower",
  "Equipment",
  "Utilities",
  "Travel & Transport",
  "Professional Fees",
  "Permits & Documentation",
  "Overhead & Contingency",
];

export const DEFAULT_COST_CATEGORY = COST_CATEGORIES[0];

// Short examples shown next to the category picker.
export const CATEGORY_HINTS = {
  "Materials & Labor": "cement, rebar, masons",
  Manpower: "daily-paid workers, foreman",
  Equipment: "mixer rental, scaffolding, fuel",
  Utilities: "temporary power, water",
  "Travel & Transport": "hauling, delivery, mobilization",
  "Professional Fees": "architect, engineer, surveyor",
  "Permits & Documentation": "building permit, clearances",
  "Overhead & Contingency": "supervision, contingency",
};

export const MAX_ESCALATION_PCT = 10;
