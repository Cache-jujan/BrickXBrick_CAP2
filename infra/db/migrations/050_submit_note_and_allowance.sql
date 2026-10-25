-- Why a receipt went over: the Purchaser's short reason plus what the system noticed
-- (bought more than requested, spent beyond the allowance). The PM reads it on approve.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS submitnote TEXT;

-- How far over the budget given a request may go before the Purchaser must explain.
-- The PM hands out cash with room for delivery, gas and price changes, so a little over is normal.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budgetallowancepct NUMERIC(5,2) NOT NULL DEFAULT 10
  CHECK (budgetallowancepct >= 0 AND budgetallowancepct <= 100);

-- Why a part-bought request was closed ("that's all I could buy").
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closedshortreason TEXT;
