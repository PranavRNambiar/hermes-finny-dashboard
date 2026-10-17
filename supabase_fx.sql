-- Finny: keep the original amount of foreign-currency spends (e.g. EUR 21.46) next to the
-- converted SGD/INR amount that everything totals. Run once in the Supabase SQL Editor.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS orig_currency TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS orig_amount   NUMERIC(14,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fx_rate       NUMERIC(14,6);  -- home per 1 unit of orig, fee included
SELECT 'fx columns ready' AS status;
