-- Croitul pe taiere: cine întinde, cine taie, cât material, ce defecte.
--
-- Taierile le face croitul, nu planificarea. Planificarea trimite la croit
-- comenzile (planificările), în ordinea ei; din „rămas de croit" șefa de croit
-- hotărăște ce taie odată: o parte dintr-un PSF, un PSF cu alt PSF, un PSF cu un
-- PSC de pe același model. Fiecare bucată de comandă dintr-o taiere e un lot
-- (…/P1/C1); un PSF tăiat în două taieri are două loturi. Ce nu intră în nicio
-- taiere rămâne de croit, până se croiește sau până îl închide șefa de croit, cu
-- observații. Gruparea de la planificare (0015, planificare.taiere_id) dispare.
--
-- O taiere se întinde și se taie pe fiecare tip de material al modelului —
-- stofă de bază, căptușeală, paiete, mesh, contrast: componentele din rețetă
-- (model_componenta). Pe fiecare se scrie cine a întins și între ce ore (și că a
-- verificat fața materialului), cine a tăiat și între ce ore, iar dacă se
-- termocolează, cine și când. La final, cineva împerechează piesele, le separă pe
-- culori și le pregătește pentru intrat în lucru.
--
-- Metrii folosiți și defectele de țesătură se scriu pe fiecare culoare — într-o
-- taiere cu trei culori, stofa de bază se întinde din trei materiale. La
-- înregistrarea croitului, metrii unei culori se împart pe comenzile ei (un PSF și
-- un PSC pe aceeași culoare) după bucățile croite.
--
-- Operatorii de croit bifează operațiile; șefa de croit le corectează și
-- închide comenzile.

-- O valoare nouă de enum nu se poate folosi în tranzacția care o adaugă, iar
-- funcția de mai jos o folosește: amândouă stau înaintea tranzacției.
ALTER TYPE rol ADD VALUE IF NOT EXISTS 'operator_croit';

-- Operatorii de croit intră cu PIN de pe tableta atelierului.
CREATE OR REPLACE FUNCTION rol_de_atelier(r rol[]) RETURNS bool LANGUAGE sql IMMUTABLE AS $$
    SELECT r && ARRAY['croit', 'banda', 'depozit', 'operator_croit']::rol[]
$$;

BEGIN;

-- Lotul știe în ce taiere s-a croit. Loturile de până acum își iau taierea de la
-- planificarea lor (0015); taierile fără niciun lot erau doar grupări la
-- planificare și dispar.
ALTER TABLE lot_croit ADD COLUMN taiere_id uuid NULL REFERENCES taiere(id);
CREATE INDEX ON lot_croit (taiere_id);
DO $$
DECLARE f uuid;
BEGIN
    FOR f IN SELECT id FROM firma LOOP
        PERFORM set_config('app.firma_id', f::text, true);
        UPDATE lot_croit lc SET taiere_id = pl.taiere_id FROM planificare pl
         WHERE pl.id = lc.planificare_id AND lc.taiere_id IS NULL;
        UPDATE planificare SET taiere_id = NULL
         WHERE taiere_id IN (SELECT t.id FROM taiere t WHERE NOT EXISTS (SELECT 1 FROM lot_croit WHERE taiere_id = t.id));
        DELETE FROM taiere t WHERE NOT EXISTS (SELECT 1 FROM lot_croit WHERE taiere_id = t.id);
        -- Orice taiere rămasă e deja la croit.
        UPDATE taiere SET trimis_la = coalesce(trimis_la, creat_la);
    END LOOP;
END $$;
COMMENT ON COLUMN lot_croit.taiere_id IS 'The cut this batch was cut in';

DROP TRIGGER taiere_acelasi_model ON planificare;
DROP FUNCTION taiere_acelasi_model();
ALTER TABLE planificare DROP COLUMN taiere_id;

-- Într-o taiere intră doar loturi de pe același model: altfel nu se pot întinde pe
-- aceeași masă. Fără model, același produs.
CREATE FUNCTION taiere_acelasi_model() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.taiere_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM lot_croit alt
          JOIN planificare pa   ON pa.id = alt.planificare_id
          JOIN comanda_linie la ON la.id = pa.linie_id
          JOIN produs xa        ON xa.id = la.produs_id,
               planificare pn
          JOIN comanda_linie ln ON ln.id = pn.linie_id
          JOIN produs xn        ON xn.id = ln.produs_id
         WHERE alt.taiere_id = NEW.taiere_id AND alt.id <> NEW.id AND pn.id = NEW.planificare_id
           AND coalesce(xa.model_id, xa.id) <> coalesce(xn.model_id, xn.id))
    THEN
        RAISE EXCEPTION 'O taiere are comenzi de pe un singur model.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER taiere_acelasi_model BEFORE INSERT OR UPDATE OF taiere_id ON lot_croit
    FOR EACH ROW EXECUTE FUNCTION taiere_acelasi_model();

-- Ordinea în care planificarea vrea comenzile croite: croitul le vede în „rămas de
-- croit" în ordinea asta.
ALTER TABLE planificare ADD COLUMN ordine_croit int;
DO $$
DECLARE f uuid;
BEGIN
    FOR f IN SELECT id FROM firma LOOP
        PERFORM set_config('app.firma_id', f::text, true);
        UPDATE planificare pl SET ordine_croit = o.n
          FROM (SELECT pl.id, row_number() OVER (ORDER BY c.prioritate, cl.data_ceruta, c.numar, pl.numar_transa) AS n
                  FROM planificare pl JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN comanda c ON c.id = cl.comanda_id
                 WHERE pl.stadiu IN ('lansat_spre_croit', 'in_croit')) o
         WHERE o.id = pl.id;
    END LOOP;
END $$;
COMMENT ON COLUMN planificare.ordine_croit IS 'Order in which planning wants it cut; the cutting room sees what is left to cut in this order';
COMMENT ON TABLE  taiere IS 'A cut: what the cutting room spreads and cuts at once — part of an order, or orders of the same model together. Each order''s share is a cutting batch (lot_croit).';
COMMENT ON COLUMN taiere.ordine    IS 'Order of creation in the cutting room';
COMMENT ON COLUMN taiere.trimis_la IS 'When the cut was put together in the cutting room';
COMMENT ON COLUMN taiere.trimis_de IS 'Who put it together';

-- Ce se întinde și se taie pe masă: stofele, căptușeala, termoul — nu ața,
-- balenele, șiretul, elasticul, benzile, fermoarele sau nasturii, deși dashboard-ul
-- le ține tot la materie primă. Pornește de la unitate (metri) și nume, și se
-- schimbă din rețetă.
ALTER TABLE model_componenta ADD COLUMN se_croieste bool NOT NULL DEFAULT false;
DO $$
DECLARE f uuid;
BEGIN
    FOR f IN SELECT id FROM firma LOOP
        PERFORM set_config('app.firma_id', f::text, true);
        UPDATE model_componenta SET se_croieste = true
         WHERE tip = 'materie_prima' AND unitate IN ('m', 'm2') AND nume !~* '(^|·)\s*(a[tț]a|balene|siret|elastic|banda)\M';
    END LOOP;
END $$;
COMMENT ON COLUMN model_componenta.se_croieste IS 'Spread and cut on the table (fabric, lining, interfacing). Cutting operations and metres are recorded for these components.';

CREATE TYPE operatie_croit AS ENUM ('intins', 'taiat', 'termocolat', 'imperecheat');

CREATE TABLE taiere_operatie (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id        uuid NOT NULL REFERENCES firma(id),
    taiere_id       uuid NOT NULL REFERENCES taiere(id) ON DELETE CASCADE,
    componenta_id   uuid NULL REFERENCES model_componenta(id),   -- null la împerechere: e a toată taierea
    operatie        operatie_croit NOT NULL,
    operator_id     uuid NOT NULL REFERENCES utilizator(id),
    inceput_la      timestamptz NOT NULL,
    terminat_la     timestamptz,
    fata_verificata bool NOT NULL DEFAULT false,                 -- la întins: a înțeles care e fața materialului
    observatii      text,
    scris_de        uuid NULL REFERENCES utilizator(id) DEFAULT utilizator_curent(),
    scris_la        timestamptz NOT NULL DEFAULT now(),
    CHECK (terminat_la IS NULL OR terminat_la >= inceput_la),
    CHECK ((operatie = 'imperecheat') = (componenta_id IS NULL)),
    -- Întinsul nu se termină fără fața verificată: o piesă tăiată pe dos e o piesă pierdută.
    CHECK (operatie <> 'intins' OR terminat_la IS NULL OR fata_verificata),
    UNIQUE NULLS NOT DISTINCT (taiere_id, componenta_id, operatie)
);

CREATE TABLE taiere_material (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    taiere_id      uuid NOT NULL REFERENCES taiere(id) ON DELETE CASCADE,
    componenta_id  uuid NOT NULL REFERENCES model_componenta(id),
    produs_id      uuid NOT NULL REFERENCES produs(id),           -- culoarea
    material_id    uuid NOT NULL REFERENCES material(id),
    metri          numeric(12,3) CHECK (metri >= 0),
    defecte        text,
    scris_de       uuid NULL REFERENCES utilizator(id) DEFAULT utilizator_curent(),
    scris_la       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (taiere_id, componenta_id, produs_id)
);

-- O comandă de croit se poate închide cu mărimi necroite — s-a renunțat la mărime,
-- materialul n-a ajuns, era defect —, dar doar cu observații, ca să nu rămână
-- neexplicat. NOT VALID: se aplică închiderilor de acum înainte.
ALTER TABLE planificare ADD COLUMN observatii_incheiere text;
ALTER TABLE planificare ADD CONSTRAINT incheiere_cu_observatii
    CHECK (motiv_incheiere_id IS NULL OR nullif(btrim(observatii_incheiere), '') IS NOT NULL) NOT VALID;

DO $$
DECLARE t text; f uuid;
BEGIN
    FOREACH t IN ARRAY ARRAY['taiere_operatie', 'taiere_material']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format($f$
            CREATE POLICY izolare_firma ON %I
            USING (firma_id = firma_curenta())
            WITH CHECK (firma_id = firma_curenta())
        $f$, t);
        EXECUTE format('COMMENT ON COLUMN %I.firma_id IS %L', t,
            'Owning company. Row-level security filters every query by it.');
    END LOOP;
    -- Motivul care lipsea din listă, la firmele care au deja motive.
    FOR f IN SELECT DISTINCT firma_id FROM motiv LOOP
        PERFORM set_config('app.firma_id', f::text, true);
        INSERT INTO motiv (firma_id, cod, nume, contexte)
        VALUES (f, 'renuntat_marime', 'S-a renuntat la marime', '{croit}')
        ON CONFLICT (firma_id, cod) DO NOTHING;
    END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON taiere_operatie, taiere_material TO octogon_app;

COMMENT ON TABLE  taiere_operatie IS 'Work done on a cut, per material component: spreading, cutting, thermofusing; pairing for the whole cut. Who, from when to when.';
COMMENT ON COLUMN taiere_operatie.componenta_id   IS 'Material component of the model (main fabric, lining, sequins). Null for pairing, which covers the whole cut.';
COMMENT ON COLUMN taiere_operatie.operatie        IS 'Operation: intins (spreading), taiat (cutting), termocolat (thermofusing), imperecheat (pairing, sorting by colour, preparing for sewing)';
COMMENT ON COLUMN taiere_operatie.operator_id     IS 'Who did it';
COMMENT ON COLUMN taiere_operatie.inceput_la      IS 'Started at';
COMMENT ON COLUMN taiere_operatie.terminat_la     IS 'Finished at. Null means still in progress.';
COMMENT ON COLUMN taiere_operatie.fata_verificata IS 'Spreading: the operator confirmed the right side of the fabric. Required to finish spreading.';
COMMENT ON COLUMN taiere_operatie.observatii      IS 'Notes';
COMMENT ON COLUMN taiere_operatie.scris_de        IS 'Who recorded it';
COMMENT ON COLUMN taiere_operatie.scris_la        IS 'Recorded at';
COMMENT ON TABLE  taiere_material IS 'Material actually used by a cut, per component and colour: metres and fabric defects. The metres of a colour are split across its orders by pieces cut.';
COMMENT ON COLUMN taiere_material.componenta_id   IS 'Material component of the model';
COMMENT ON COLUMN taiere_material.produs_id       IS 'Product, that is the colour';
COMMENT ON COLUMN taiere_material.material_id     IS 'Material of that colour for the component';
COMMENT ON COLUMN taiere_material.metri           IS 'Metres actually used';
COMMENT ON COLUMN taiere_material.defecte         IS 'Fabric defects found';
COMMENT ON COLUMN taiere_material.scris_de        IS 'Who recorded it';
COMMENT ON COLUMN taiere_material.scris_la        IS 'Recorded at';
COMMENT ON COLUMN planificare.observatii_incheiere IS 'Notes on closing with pieces left uncut; required with a reason';

COMMIT;
