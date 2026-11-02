-- O taiere pe un model fără rețetă: întinsul și tăiatul se scriu pe toată taierea, nu pe
-- materialul din rețetă (care lipsește). Împerecheatul rămâne mereu pe toată taierea.
BEGIN;

DO $$ DECLARE n text; BEGIN
  SELECT conname INTO n FROM pg_constraint
   WHERE conrelid = 'taiere_operatie'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%imperecheat%componenta_id IS NULL%';
  EXECUTE format('ALTER TABLE taiere_operatie DROP CONSTRAINT %I', n);
END $$;
ALTER TABLE taiere_operatie ADD CONSTRAINT taiere_operatie_imperecheat_pe_taiere CHECK (operatie <> 'imperecheat' OR componenta_id IS NULL);
COMMENT ON COLUMN taiere_operatie.componenta_id IS 'Material from the recipe the operation was done on; null for pairing, and for spreading/cutting on a model without a recipe (the whole cut)';

COMMIT;
