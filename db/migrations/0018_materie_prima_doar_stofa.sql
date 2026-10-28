-- Materie primă înseamnă doar ce se întinde și se taie: stofa, căptușeala.
--
-- Dashboard-ul ținea la materie primă și ața, banda thermo, buretii, fermoarele,
-- nasturii, balenele, termoul. Pentru atelier, acelea sunt accesorii: nu trec prin
-- masa de croit și pleacă din depozit la alimentarea benzii. Le mutăm la accesorii
-- — componentele, materialele lor și legăturile dintre ele —, iar bifa „se
-- croiește" (0016) nu mai e nevoie: materie primă = se întinde și se taie.
--
-- Pierderile (5% + 8% + 7%, din fila TINTE) nu se mai adaugă nicăieri: necesarul
-- și aprovizionarea sunt cele din rețetă.
--
-- Regula pentru ce rămâne materie primă: componentele marcate „se croiește" în
-- 0016 (stofe, căptușeli, tafta, voal, mesh…), mai puțin termoul.

BEGIN;

ALTER TABLE produs_material DROP CONSTRAINT produs_material_componenta_id_tip_unitate_fkey;
ALTER TABLE produs_material DROP CONSTRAINT produs_material_material_id_tip_unitate_fkey;

DO $$
DECLARE f uuid;
BEGIN
    FOR f IN SELECT id FROM firma LOOP
        PERFORM set_config('app.firma_id', f::text, true);

        CREATE TEMP TABLE devin_accesorii ON COMMIT DROP AS
        SELECT id FROM model_componenta
         WHERE tip = 'materie_prima' AND NOT (se_croieste AND nume !~* 'therm');

        UPDATE model_componenta SET tip = 'accesoriu' WHERE id IN (SELECT id FROM devin_accesorii);
        UPDATE produs_material SET tip = 'accesoriu' WHERE componenta_id IN (SELECT id FROM devin_accesorii);
        -- Materialul urmează componenta: nu există material folosit și ca stofă, și ca accesoriu.
        UPDATE material SET tip = 'accesoriu'
         WHERE tip = 'materie_prima'
           AND id IN (SELECT material_id FROM produs_material WHERE componenta_id IN (SELECT id FROM devin_accesorii));

        UPDATE fisa_componenta SET tip = 'accesoriu', principal = false
         WHERE tip = 'materie_prima' AND NOT (se_croieste AND nume !~* 'therm');

        DROP TABLE devin_accesorii;
        DELETE FROM parametru WHERE cheie IN ('pierderi_tehnologice', 'defecte_material', 'neconformitati_productie');
    END LOOP;
END $$;

ALTER TABLE produs_material ADD CONSTRAINT produs_material_componenta_id_tip_unitate_fkey
    FOREIGN KEY (componenta_id, tip, unitate) REFERENCES model_componenta (id, tip, unitate);
ALTER TABLE produs_material ADD CONSTRAINT produs_material_material_id_tip_unitate_fkey
    FOREIGN KEY (material_id, tip, unitate) REFERENCES material (id, tip, unitate);

ALTER TABLE model_componenta DROP COLUMN se_croieste;
ALTER TABLE fisa_componenta DROP COLUMN se_croieste;

COMMENT ON COLUMN model_componenta.tip IS 'Raw material (fabric, lining: spread and cut on the table, consumed at cutting) or accessory (thread, zips, buttons, interfacing: consumed at line feeding)';

COMMIT;

-- „Avem materialul": înainte de a trimite o planificare la croit, planificatorul
-- bifează fiecare material al ei. Stocul din aplicație nu e mereu la zi (un sul
-- adus ieri, încă neinventariat), așa că bifa omului contează, nu doar cifra.
BEGIN;

CREATE TABLE planificare_material (
    firma_id        uuid NOT NULL REFERENCES firma(id),
    planificare_id  uuid NOT NULL REFERENCES planificare(id) ON DELETE CASCADE,
    material_id     uuid NOT NULL REFERENCES material(id),
    bifat_de        uuid NULL REFERENCES utilizator(id) DEFAULT utilizator_curent(),
    bifat_la        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (planificare_id, material_id)
);
ALTER TABLE planificare_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE planificare_material FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON planificare_material
    USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON planificare_material TO octogon_app;

COMMENT ON TABLE  planificare_material IS 'Materials the planner confirmed are on hand for a planning batch, before sending it to cutting. Stock in the app may lag reality.';
COMMENT ON COLUMN planificare_material.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN planificare_material.bifat_de IS 'Who confirmed it';
COMMENT ON COLUMN planificare_material.bifat_la IS 'When';

COMMIT;
