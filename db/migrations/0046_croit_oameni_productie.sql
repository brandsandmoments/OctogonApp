-- La croit se alocă oamenii din producție (Oameni producție, 0037), nu conturile din
-- aplicație: taietorii și ajutoarele n-au cont. O operație ține acum omul din producție;
-- cele scrise înainte rămân cu contul de atunci.
BEGIN;
ALTER TABLE taiere_operatie ALTER COLUMN operator_id DROP NOT NULL;
ALTER TABLE taiere_operatie ADD COLUMN angajat_id uuid NULL REFERENCES angajat(id);
ALTER TABLE taiere_operatie ADD CONSTRAINT taiere_operatie_are_om CHECK (operator_id IS NOT NULL OR angajat_id IS NOT NULL);
ALTER TABLE taiere_operatie DROP CONSTRAINT taiere_operatie_un_om_pe_operatie;
ALTER TABLE taiere_operatie ADD CONSTRAINT taiere_operatie_un_om_pe_operatie
  UNIQUE NULLS NOT DISTINCT (taiere_id, componenta_id, operatie, operator_id, angajat_id);
CREATE INDEX ON taiere_operatie (firma_id, angajat_id);
COMMENT ON COLUMN taiere_operatie.angajat_id IS 'Production staff member who did it (from the staff list); older rows have an app account in operator_id instead';
COMMIT;
