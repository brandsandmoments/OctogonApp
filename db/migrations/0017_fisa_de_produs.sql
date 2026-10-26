-- Referințele unei cereri de tipar și fișa de produs.
--
-- Cine cere un tipar pune lângă cerere ce are: linkuri de Drive (clipuri,
-- foldere), observații, poze. Pozele stau în aplicație — intră și în fișa de
-- produs descărcată —, clipurile și fișierele mari rămân pe Drive.
--
-- Fișa de produs o face dezvoltarea odată cu tiparul, ca în „Palton Eloria.xlsx":
-- componentele (material de bază 1, 2, contrast, căptușeală, accesorii), fiecare
-- cu furnizor, cod, consum pe bucată și preț; materialul fiecărei culori; tabelul
-- de mărimi; manopera pe bucată. Din ea se calculează costul pe bucată și se
-- descarcă fișa în Excel sau PDF. La aprobarea mostrei, fișa devine rețeta
-- modelului din catalog (model_componenta, produs_material).

BEGIN;

CREATE TYPE tip_referinta AS ENUM ('link', 'nota', 'poza');

CREATE TABLE dezvoltare_referinta (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    dezvoltare_id  uuid NOT NULL REFERENCES dezvoltare(id) ON DELETE CASCADE,
    tip            tip_referinta NOT NULL,
    text           text,                 -- nota, sau descrierea linkului / pozei
    url            text,                 -- link
    fisier         bytea,                -- poza
    mime           text,
    culoare        text,                 -- poza produsului într-o culoare: intră în fișă
    creat_de       uuid NULL REFERENCES utilizator(id) DEFAULT utilizator_curent(),
    creat_la       timestamptz NOT NULL DEFAULT now(),
    CHECK (tip <> 'link' OR url ~* '^https?://'),
    CHECK (tip <> 'nota' OR nullif(btrim(text), '') IS NOT NULL),
    -- Pozele, până la 8 MB: o poză de telefon, nu un clip.
    CHECK (tip <> 'poza' OR (fisier IS NOT NULL AND octet_length(fisier) <= 8 * 1024 * 1024 AND mime LIKE 'image/%'))
);
CREATE INDEX ON dezvoltare_referinta (dezvoltare_id, creat_la);

ALTER TABLE dezvoltare ADD COLUMN manopera numeric(12,2) CHECK (manopera >= 0);

CREATE TABLE fisa_componenta (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    dezvoltare_id  uuid NOT NULL REFERENCES dezvoltare(id) ON DELETE CASCADE,
    ordine         int  NOT NULL,
    nume           text NOT NULL,                   -- 'Material de bază 1', 'Căptușeală', 'Nasturi mari'
    tip            tip_material NOT NULL,
    unitate        unitate_masura NOT NULL,
    consum         numeric(12,4) NOT NULL CHECK (consum > 0),
    principal      bool NOT NULL DEFAULT false,     -- stofa principală: ea oprește lansarea la planificare
    se_croieste    bool NOT NULL DEFAULT false,
    furnizor       text,
    cod            text,                            -- codul furnizorului, când e același pe toate culorile
    material_id    uuid NULL REFERENCES material(id),  -- materialul, când e același pe toate culorile
    pret           numeric(12,4) CHECK (pret >= 0),    -- pe unitate
    UNIQUE (dezvoltare_id, nume)
);

-- Materialul unei componente pe o culoare, când diferă de la culoare la culoare.
-- Se alege din nomenclator sau se scrie cod + denumire; la aprobare, un material
-- nou intră în nomenclator.
CREATE TABLE fisa_culoare_material (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    componenta_id  uuid NOT NULL REFERENCES fisa_componenta(id) ON DELETE CASCADE,
    culoare        text NOT NULL,
    material_id    uuid NULL REFERENCES material(id),
    cod            text,
    denumire       text,
    pret           numeric(12,4) CHECK (pret >= 0),
    CHECK (material_id IS NOT NULL OR nullif(btrim(denumire), '') IS NOT NULL),
    UNIQUE (componenta_id, culoare)
);

-- Tabelul de mărimi: bust, talie, șold, lungime, pe fiecare mărime.
CREATE TABLE fisa_masura (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    dezvoltare_id  uuid NOT NULL REFERENCES dezvoltare(id) ON DELETE CASCADE,
    ordine         int  NOT NULL,
    nume           text NOT NULL,
    valori         jsonb NOT NULL DEFAULT '{}',     -- {"XS": "82-84", "S": "86-90"}
    UNIQUE (dezvoltare_id, nume)
);

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['dezvoltare_referinta', 'fisa_componenta', 'fisa_culoare_material', 'fisa_masura']
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
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON dezvoltare_referinta, fisa_componenta, fisa_culoare_material, fisa_masura TO octogon_app;

COMMENT ON TABLE  dezvoltare_referinta IS 'References attached to a pattern request: Drive links, notes, photos. Photos marked with a colour appear on the product sheet.';
COMMENT ON COLUMN dezvoltare_referinta.tip     IS 'Kind: link, nota (note), poza (photo)';
COMMENT ON COLUMN dezvoltare_referinta.text    IS 'Note text, or the description of a link or photo';
COMMENT ON COLUMN dezvoltare_referinta.url     IS 'Link (Drive folder, video)';
COMMENT ON COLUMN dezvoltare_referinta.fisier  IS 'Photo bytes, up to 8 MB';
COMMENT ON COLUMN dezvoltare_referinta.mime    IS 'Photo media type';
COMMENT ON COLUMN dezvoltare_referinta.culoare IS 'Colour the photo shows; such photos go on the product sheet';
COMMENT ON COLUMN dezvoltare_referinta.creat_de IS 'Added by';
COMMENT ON COLUMN dezvoltare_referinta.creat_la IS 'Added at';
COMMENT ON COLUMN dezvoltare.manopera IS 'Labour cost per piece, on the product sheet';
COMMENT ON TABLE  fisa_componenta IS 'Product sheet line: a material or accessory of the model, with supplier, code, consumption and price. Becomes the model recipe on approval.';
COMMENT ON COLUMN fisa_componenta.ordine      IS 'Order on the sheet';
COMMENT ON COLUMN fisa_componenta.nume        IS 'Component name: base fabric 1, contrast, lining, buttons';
COMMENT ON COLUMN fisa_componenta.tip         IS 'Raw material or accessory';
COMMENT ON COLUMN fisa_componenta.unitate     IS 'Unit';
COMMENT ON COLUMN fisa_componenta.consum      IS 'Consumption per piece';
COMMENT ON COLUMN fisa_componenta.principal   IS 'Main fabric';
COMMENT ON COLUMN fisa_componenta.se_croieste IS 'Spread and cut on the table';
COMMENT ON COLUMN fisa_componenta.furnizor    IS 'Supplier';
COMMENT ON COLUMN fisa_componenta.cod         IS 'Supplier code, when the same for every colour';
COMMENT ON COLUMN fisa_componenta.material_id IS 'Catalogue material, when the same for every colour';
COMMENT ON COLUMN fisa_componenta.pret        IS 'Price per unit';
COMMENT ON TABLE  fisa_culoare_material IS 'Material of a product sheet component in one colour, when it differs by colour';
COMMENT ON COLUMN fisa_culoare_material.culoare     IS 'Colour, as on the request';
COMMENT ON COLUMN fisa_culoare_material.material_id IS 'Catalogue material, if it exists';
COMMENT ON COLUMN fisa_culoare_material.cod         IS 'Supplier code of a new material';
COMMENT ON COLUMN fisa_culoare_material.denumire    IS 'Name of a new material; created in the catalogue on approval';
COMMENT ON COLUMN fisa_culoare_material.pret        IS 'Price per unit for this colour, if different';
COMMENT ON TABLE  fisa_masura IS 'Size chart line on the product sheet: bust, waist, hip, length, per size';
COMMENT ON COLUMN fisa_masura.ordine IS 'Order on the sheet';
COMMENT ON COLUMN fisa_masura.nume   IS 'Measurement name';
COMMENT ON COLUMN fisa_masura.valori IS 'Value per size code';

COMMIT;
