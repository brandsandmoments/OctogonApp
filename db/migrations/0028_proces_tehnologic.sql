-- Procesul tehnologic al unui model: operațiile, în ordine, cu utilajul și timpul pe
-- bucată. Suma timpilor e timpul modelului pe bucată (model.timp_min_buc, 0020), din
-- care banda își calculează orele și data estimată în depozit.
--
-- Și un drept nou, „retete": cine poate schimba rețetele și procesul tehnologic.
-- Până acum le schimba oricine avea „necesar"; acum doar cine are „retete" (șefa de
-- croit, dezvoltarea produsului) și conturile master. Ceilalți le văd.
BEGIN;

CREATE TABLE model_operatie (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id    uuid NOT NULL REFERENCES firma(id),
    model_id    uuid NOT NULL REFERENCES model(id) ON DELETE CASCADE,
    ordine      int  NOT NULL,
    denumire    text NOT NULL CHECK (btrim(denumire) <> ''),  -- „Cusut buzunare"
    utilaj      text NULL,                                    -- „Mașină simplă", „Surfilat", „Fier de călcat"
    timp_min    numeric(8,2) NOT NULL CHECK (timp_min >= 0),  -- minute pe bucată
    observatii  text NULL
);
CREATE INDEX ON model_operatie (firma_id, model_id, ordine);
ALTER TABLE model_operatie ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_operatie FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON model_operatie USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON model_operatie TO octogon_app;

COMMENT ON TABLE  model_operatie IS 'Technological process of a model: sewing and finishing operations in order, with machine and minutes per piece';
COMMENT ON COLUMN model_operatie.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN model_operatie.ordine IS 'Position in the process, 1 first';
COMMENT ON COLUMN model_operatie.denumire IS 'Operation name, e.g. sewing pockets';
COMMENT ON COLUMN model_operatie.utilaj IS 'Machine or station used';
COMMENT ON COLUMN model_operatie.timp_min IS 'Minutes per piece; the sum over operations is model.timp_min_buc';

-- Dreptul nou, „retete".
DO $$ DECLARE n text; BEGIN
  SELECT conname INTO n FROM pg_constraint WHERE conrelid = 'drept'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%zona%';
  EXECUTE format('ALTER TABLE drept DROP CONSTRAINT %I', n);
END $$;
ALTER TABLE drept ADD CONSTRAINT drept_zona_check CHECK (zona IN (
    'comenzi', 'centralizator', 'kam', 'necesar', 'planificare', 'croit',
    'banda', 'receptie', 'materiale', 'dezvoltare', 'expediere', 'aprobare', 'retete'));

COMMIT;
