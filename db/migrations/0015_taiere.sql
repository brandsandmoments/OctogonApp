-- Taierea: mai multe PSF și PSC pe același model, tăiate împreună.
--
-- La croit, comenzile pe același model se pot întinde pe aceeași masă și tăia
-- dintr-o dată, apoi se împart înapoi pe comenzi. Planificarea rămâne pe linia de
-- comandă (…/P1) — ea știe cât îi trebuie fiecărei comenzi și ce i s-a croit —, iar
-- taierea le adună: o taiere are una sau mai multe planificări, toate pe același
-- model (sau pe același produs, când produsul n-are model).
--
-- Planificatorul (Asigură stoc) face taierile, le pune în ordine și le trimite la
-- croit. Ce se croiește efectiv rămâne treaba croitului.

BEGIN;

CREATE TABLE taiere (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id    uuid NOT NULL REFERENCES firma(id),
    numar       int  NOT NULL CHECK (numar > 0),        -- T12
    ordine      int  NOT NULL,                          -- locul în coada spre croit
    creat_de    uuid NULL REFERENCES utilizator(id) DEFAULT utilizator_curent(),
    creat_la    timestamptz NOT NULL DEFAULT now(),
    trimis_la   timestamptz,                            -- null: încă în planificare
    trimis_de   uuid NULL REFERENCES utilizator(id),
    observatii  text,
    UNIQUE (firma_id, numar)
);
CREATE INDEX ON taiere (firma_id, trimis_la, ordine);

ALTER TABLE planificare ADD COLUMN taiere_id uuid NULL REFERENCES taiere(id);
CREATE INDEX ON planificare (taiere_id);

-- Într-o taiere intră doar planificări de pe același model: altfel nu se pot
-- întinde pe aceeași masă. Fără model, același produs.
CREATE FUNCTION taiere_acelasi_model() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.taiere_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM planificare alta
          JOIN comanda_linie la ON la.id = alta.linie_id
          JOIN produs pa        ON pa.id = la.produs_id,
               comanda_linie ln JOIN produs pn ON pn.id = ln.produs_id
         WHERE alta.taiere_id = NEW.taiere_id AND alta.id <> NEW.id AND ln.id = NEW.linie_id
           AND coalesce(pa.model_id, pa.id) <> coalesce(pn.model_id, pn.id))
    THEN
        RAISE EXCEPTION 'O taiere are planificări de pe un singur model.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER taiere_acelasi_model BEFORE INSERT OR UPDATE OF taiere_id ON planificare
    FOR EACH ROW EXECUTE FUNCTION taiere_acelasi_model();

ALTER TABLE taiere ENABLE ROW LEVEL SECURITY;
ALTER TABLE taiere FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON taiere
    USING (firma_id = firma_curenta())
    WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON taiere TO octogon_app;

-- Planificările de până acum devin câte o taiere fiecare: așa a fost croită
-- fiecare. Cele lansate au plecat la croit odată cu primul lor lot. Pe rând, pe
-- firme: izolarea e impusă și proprietarului tabelelor.
DO $$
DECLARE f uuid;
BEGIN
    FOR f IN SELECT id FROM firma LOOP
        PERFORM set_config('app.firma_id', f::text, true);
        INSERT INTO taiere (id, firma_id, numar, ordine, creat_de, creat_la, trimis_la)
        SELECT pl.id, pl.firma_id, row_number() OVER w, row_number() OVER w,
               pl.planificat_de, pl.data_planificare,
               (SELECT min(lc.data_primire) FROM lot_croit lc WHERE lc.planificare_id = pl.id)
          FROM planificare pl
         WHERE pl.stadiu <> 'anulat'
        WINDOW w AS (ORDER BY pl.data_planificare, pl.id);
        UPDATE planificare SET taiere_id = id WHERE stadiu <> 'anulat';
    END LOOP;
END $$;

COMMENT ON TABLE  taiere IS 'A cut: one or more planning batches of the same model, spread and cut together, then split back per order.';
COMMENT ON COLUMN taiere.firma_id   IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN taiere.numar      IS 'Cut number, shown as T12';
COMMENT ON COLUMN taiere.ordine     IS 'Place in the queue to the cutting room';
COMMENT ON COLUMN taiere.creat_de   IS 'Created by';
COMMENT ON COLUMN taiere.creat_la   IS 'Created at';
COMMENT ON COLUMN taiere.trimis_la  IS 'When it was sent to the cutting room. Null means still in planning.';
COMMENT ON COLUMN taiere.trimis_de  IS 'Who sent it';
COMMENT ON COLUMN taiere.observatii IS 'Notes';
COMMENT ON COLUMN planificare.taiere_id IS 'The cut this planning batch is part of';

COMMIT;
