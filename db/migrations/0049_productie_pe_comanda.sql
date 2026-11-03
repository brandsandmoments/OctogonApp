-- Dashboard-ul de producție: pe fiecare comandă, câți oameni lucrează la ea și cine pe ce
-- fază (fază, mașină, om). Minutele pe bucată rămân pe model (model.timp_min_buc).
BEGIN;

ALTER TABLE comanda ADD COLUMN oameni_productie int NULL CHECK (oameni_productie IS NULL OR oameni_productie > 0);
COMMENT ON COLUMN comanda.oameni_productie IS 'How many people work on this order in production (for the finish estimate)';

CREATE TABLE alocare_comanda (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id    uuid NOT NULL REFERENCES firma(id),
    comanda_id  uuid NOT NULL REFERENCES comanda(id) ON DELETE CASCADE,
    faza        text NOT NULL CHECK (btrim(faza) <> ''),
    utilaj      text NULL,
    angajat_id  uuid NOT NULL REFERENCES angajat(id),
    creat_de    uuid NULL DEFAULT utilizator_curent() REFERENCES utilizator(id),
    creat_la    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON alocare_comanda (firma_id, comanda_id);
ALTER TABLE alocare_comanda ENABLE ROW LEVEL SECURITY;
ALTER TABLE alocare_comanda FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON alocare_comanda USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON alocare_comanda TO octogon_app;
COMMENT ON TABLE  alocare_comanda IS 'Who works on which production phase of an order, on which machine';
COMMENT ON COLUMN alocare_comanda.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN alocare_comanda.faza IS 'Production phase (sewing, overlocking, pressing, QC...)';

COMMIT;
