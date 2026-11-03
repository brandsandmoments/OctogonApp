-- Produsele cu mai multe materiale (stofă, căptușeală, inserții…): pe fiecare taiere, la
-- fiecare comandă din ea, câte bucăți s-au croit din fiecare material, pe mărimi. Materialul
-- nu e predefinit: croitul îi scrie numele, iar bucățile pornesc de la ale comenzii de croit
-- și se corectează în plus sau în minus.
BEGIN;

CREATE TABLE taiere_material_croit (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id    uuid NOT NULL REFERENCES firma(id),
    taiere_id   uuid NOT NULL REFERENCES taiere(id) ON DELETE CASCADE,
    lot_id      uuid NOT NULL REFERENCES lot_croit(id) ON DELETE CASCADE,
    material    text NOT NULL CHECK (btrim(material) <> ''),
    marime_id   uuid NOT NULL REFERENCES marime(id),
    cantitate   int  NOT NULL CHECK (cantitate >= 0),
    scris_de    uuid NULL DEFAULT utilizator_curent() REFERENCES utilizator(id),
    scris_la    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (lot_id, material, marime_id)
);
CREATE INDEX ON taiere_material_croit (firma_id, taiere_id);
ALTER TABLE taiere_material_croit ENABLE ROW LEVEL SECURITY;
ALTER TABLE taiere_material_croit FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON taiere_material_croit USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON taiere_material_croit TO octogon_app;
COMMENT ON TABLE  taiere_material_croit IS 'Pieces cut from each extra material (lining, inserts...) per order in a cut, per size; free-text material name';
COMMENT ON COLUMN taiere_material_croit.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN taiere_material_croit.material IS 'Material name as typed by the cutting team (not predefined)';
COMMENT ON COLUMN taiere_material_croit.cantitate IS 'Pieces cut from this material for this size (can differ from the order: extra or missing)';

COMMIT;
