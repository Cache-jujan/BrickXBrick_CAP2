-- 038_bom_cost_categories.sql
-- F2 (adviser item 6): the BOM must justify the WHOLE budget, not only
-- materials, and allow for price increases when construction is next year.
--
--   1. bomSections.costCategory: what kind of cost each section is. The list
--      follows the DPWH split of direct costs (materials, labor, equipment)
--      and indirect costs (overhead, fees, permits). Existing sections become
--      'Materials & Labor', so current BOMs keep their totals.
--   2. boms.escalationRate (0 to 0.10) and escalationNote: an allowance for
--      construction-year price movement. Target Budget = the agreed BOM total
--      + this allowance; the price agreed with the client stays the BOM total.
--      Existing BOMs get 0 so approved budgets don't change.
--   3. system_settings 'bom_escalation_rate_default' = 0.05: the rate a NEW
--      BOM starts with (the adviser suggested 5 to 6%). The GM can change it
--      per BOM.
-- Safe to re-run.

ALTER TABLE bomSections
  ADD COLUMN IF NOT EXISTS costCategory VARCHAR(40) NOT NULL DEFAULT 'Materials & Labor';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bomsections_cost_category_check') THEN
    ALTER TABLE bomSections
      ADD CONSTRAINT bomsections_cost_category_check
      CHECK (costCategory IN (
        'Materials & Labor', 'Manpower', 'Equipment', 'Utilities',
        'Travel & Transport', 'Professional Fees',
        'Permits & Documentation', 'Overhead & Contingency'
      ));
  END IF;
END $$;

ALTER TABLE boms ADD COLUMN IF NOT EXISTS escalationRate DECIMAL(5,4) NOT NULL DEFAULT 0;
ALTER TABLE boms ADD COLUMN IF NOT EXISTS escalationNote TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boms_escalation_rate_range') THEN
    ALTER TABLE boms
      ADD CONSTRAINT boms_escalation_rate_range CHECK (escalationRate >= 0 AND escalationRate <= 0.10);
  END IF;
END $$;

INSERT INTO system_settings (settingKey, settingValue, description)
VALUES ('bom_escalation_rate_default', '0.05',
        'Escalation allowance a new BOM starts with (0.00 to 0.10), for construction-year price increases')
ON CONFLICT (settingKey) DO NOTHING;
