-- Material pus deoparte pentru un model: din stoc, o cantitate se rezervă pentru modelul ăla (de ex.
-- stofa venită pentru Positano Catifea), iar restul rămâne liber pentru altele. Ce rămâne rezervat
-- scade singur cu ce se consumă la croitul modelului după rezervare (din fișa de magazie).
BEGIN;

CREATE TABLE rezervare_model (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id     uuid NOT NULL REFERENCES firma(id),
    material_id  uuid NOT NULL REFERENCES material(id) ON DELETE CASCADE,
    model_id     uuid NOT NULL REFERENCES model(id) ON DELETE CASCADE,
    cantitate    numeric(12,3) NOT NULL CHECK (cantitate > 0),
    observatii   text NULL,
    creat_de     uuid NULL DEFAULT utilizator_curent() REFERENCES utilizator(id),
    creat_la     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON rezervare_model (firma_id, material_id);
ALTER TABLE rezervare_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE rezervare_model FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON rezervare_model USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON rezervare_model TO octogon_app;
COMMENT ON TABLE  rezervare_model IS 'Material stock set aside for a model; what remains reserved decreases with cutting consumption of that model after the reservation';
COMMENT ON COLUMN rezervare_model.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN rezervare_model.cantitate IS 'Quantity set aside, in the material unit';

COMMIT;
