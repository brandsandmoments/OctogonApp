-- La croit, pe aceeași operație (întins, tăiat, separat piese, termocolat) lucrează
-- adesea mai mulți oameni: fiecare cu rândul lui — cine, de la ce oră, până la ce oră.
-- Și o operație nouă: separatul pieselor după tăiat.
ALTER TYPE operatie_croit ADD VALUE IF NOT EXISTS 'separat' BEFORE 'termocolat';
BEGIN;
ALTER TABLE taiere_operatie DROP CONSTRAINT taiere_operatie_taiere_id_componenta_id_operatie_key;
ALTER TABLE taiere_operatie ADD CONSTRAINT taiere_operatie_un_om_pe_operatie
  UNIQUE NULLS NOT DISTINCT (taiere_id, componenta_id, operatie, operator_id);
COMMENT ON COLUMN taiere_operatie.operator_id IS 'Who did it; several people can work the same operation, one row each';
COMMIT;
