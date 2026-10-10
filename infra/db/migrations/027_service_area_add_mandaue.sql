-- 027_service_area_add_mandaue.sql
--
-- The team confirmed Mandaue is also within the company's service area
-- (Oct 2026), alongside Consolacion. Names are compared after dropping
-- "City"/"Municipality" (see normalizeMunicipality in lib/projectRules.js),
-- so "Mandaue City" matches "Mandaue".
--
-- Only changes the row if it still holds the 026 default, so a value the GM
-- or team already customised is left alone. Add more places later with:
--   UPDATE system_settings SET settingValue = 'Consolacion, Mandaue, Liloan'
--    WHERE settingKey = 'service_area_municipalities';

UPDATE system_settings
   SET settingValue = 'Consolacion, Mandaue', updatedAt = NOW()
 WHERE settingKey = 'service_area_municipalities'
   AND settingValue = 'Consolacion';
