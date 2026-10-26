-- Vânzările din Shopify și eficiența KAM-ului.
--
-- Cine dă un PSF spune și în ce perioadă crede că se vinde ce a pus în el. Din
-- vânzările reale se măsoară, săptămânal, cât de bine a citit piața. Regula e cea
-- din dashboard (KPI_KAM), extinsă la fiecare săptămână:
--
--   de vândut până acum = volum PSF × zile scurse din perioadă / zile din perioadă
--   acuratețe la zi     = 1 − |vândut până acum − de vândut până acum| / de vândut
--
-- La finalul perioadei, acuratețea la zi devine exact KPI-ul din sheet.
-- Vânzările se numără brut — comandat pe site, înainte de retururi și anulări —
-- tot ca în sheet: măsoară cererea, nu ce a rămas după.

BEGIN;

-- ---------------------------------------------------------------- oameni
-- KAM-ii trebuie să existe ca utilizatori ca să le atribuim comenzile, dar nimeni
-- nu are încă cont. Emailul devine obligatoriu odată cu autentificarea; până
-- atunci, un om fără email e un om, nu o greșeală. Unicitatea rămâne pentru cine îl are.
ALTER TABLE utilizator ALTER COLUMN email DROP NOT NULL;
ALTER TABLE utilizator ADD CONSTRAINT utilizator_nume_unic UNIQUE (firma_id, nume);

-- ---------------------------------------------------------------- magazine

CREATE TABLE magazin (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id             uuid NOT NULL REFERENCES firma(id),
    brand_id             uuid NOT NULL REFERENCES brand(id),
    -- Domeniul și tokenul NU stau în bază: sunt în mediu, ca SHOPIFY_SHOP_<COD> și
    -- SHOPIFY_TOKEN_<COD>. Baza ține doar codul, ca un dump al bazei să nu dea
    -- acces la magazin.
    cod                  text NOT NULL CHECK (cod ~ '^[A-Z0-9_]+$'),  -- 'SLEEVY'
    sincronizat_pana_la  timestamptz,
    activ                bool NOT NULL DEFAULT true,
    UNIQUE (firma_id, cod),
    UNIQUE (firma_id, brand_id)
);

-- ---------------------------------------------------------------- vânzări

CREATE TYPE sursa_vanzare AS ENUM ('shopify', 'dashboard');

CREATE TABLE vanzare (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id      uuid NOT NULL REFERENCES firma(id),
    brand_id      uuid NOT NULL REFERENCES brand(id),
    nr_comanda    text NOT NULL,                  -- '#21591', ca în Shopify
    sku           text NOT NULL,                  -- SKU-ul variantei: MSLL-ROCHIESERAPHYNE-NEGRU-S
    data          timestamptz NOT NULL,           -- când a comandat clientul
    produs_id     uuid NULL REFERENCES produs(id),-- null: SKU necunoscut în catalog; vânzarea rămâne
    marime_id     uuid NULL REFERENCES marime(id),
    cantitate     int  NOT NULL CHECK (cantitate > 0),
    valoare       numeric(12,2),                  -- RON, înainte de reduceri pe comandă
    sursa         sursa_vanzare NOT NULL,
    -- O linie de comandă e una, oricât de des se sincronizează și din oricâte surse
    -- vine: aceeași comandă importată din dashboard și apoi citită din Shopify nu se
    -- numără de două ori. Shopify, când vine, o înlocuiește.
    UNIQUE (firma_id, brand_id, nr_comanda, sku)
);

CREATE INDEX ON vanzare (firma_id, produs_id, data);

-- ---------------------------------------------------------------- eficiența, pe zile

-- Câte bucăți „avea de vândut" fiecare linie PSF în fiecare zi a perioadei ei:
-- volumul împărțit egal pe zile. E baza atât pentru ținta săptămânii, cât și
-- pentru împărțirea vânzărilor între PSF-uri care se suprapun.
CREATE VIEW psf_tinta_zilnica WITH (security_invoker = true) AS
SELECT c.firma_id, cl.id AS linie_id, c.id AS comanda_id, c.kam_id, cl.produs_id,
       z.zi::date AS zi,
       t.volum::numeric / (cl.vanzare_pana_la - cl.vanzare_de_la + 1) AS tinta
  FROM comanda c
  JOIN comanda_linie cl ON cl.comanda_id = c.id
  JOIN LATERAL (SELECT sum(cantitate) AS volum FROM comanda_cantitate WHERE linie_id = cl.id) t ON true
  CROSS JOIN LATERAL generate_series(cl.vanzare_de_la, cl.vanzare_pana_la, interval '1 day') z(zi)
 WHERE c.tip = 'PSF' AND c.stare <> 'anulata'
   AND cl.vanzare_de_la IS NOT NULL AND cl.vanzare_pana_la IS NOT NULL;

-- Vânzările fiecărei zile, atribuite liniilor PSF active atunci pe același produs,
-- proporțional cu ținta zilnică a fiecăreia. Două PSF-uri suprapuse își împart
-- vânzările; nicio bucată nu se numără la doi KAM. O vânzare din afara oricărei
-- perioade nu e a nimănui.
CREATE VIEW psf_vandut_zilnic WITH (security_invoker = true) AS
WITH pe_zi AS (
    SELECT firma_id, produs_id, (data AT TIME ZONE 'Europe/Bucharest')::date AS zi, sum(cantitate) AS bucati
      FROM vanzare WHERE produs_id IS NOT NULL
     GROUP BY firma_id, produs_id, (data AT TIME ZONE 'Europe/Bucharest')::date),
active AS (
    SELECT t.*, sum(t.tinta) OVER (PARTITION BY t.produs_id, t.zi) AS tinta_totala
      FROM psf_tinta_zilnica t)
SELECT a.firma_id, a.linie_id, a.zi, v.bucati * a.tinta / a.tinta_totala AS vandut
  FROM active a JOIN pe_zi v ON v.produs_id = a.produs_id AND v.zi = a.zi;

-- ---------------------------------------------------------------- izolare

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['magazin', 'vanzare']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON magazin, vanzare TO octogon_app;
GRANT SELECT ON psf_tinta_zilnica, psf_vandut_zilnic TO octogon_app;

-- ---------------------------------------------------------------- traduceri

COMMENT ON TABLE  magazin IS 'Shopify store of a brand. Its domain and access token live in the environment (SHOPIFY_SHOP_<cod>, SHOPIFY_TOKEN_<cod>), never in the database.';
COMMENT ON COLUMN magazin.cod                 IS 'Store code; suffix of its environment variables';
COMMENT ON COLUMN magazin.sincronizat_pana_la IS 'Orders updated up to this moment have been read';
COMMENT ON COLUMN magazin.activ               IS 'Active';

COMMENT ON TABLE  vanzare IS 'One order line sold on a store: gross demand, before returns and cancellations. One row per order and SKU, whichever source brought it.';
COMMENT ON COLUMN vanzare.nr_comanda IS 'Store order number: #21591';
COMMENT ON COLUMN vanzare.sku        IS 'Variant SKU as sold';
COMMENT ON COLUMN vanzare.data       IS 'When the customer ordered';
COMMENT ON COLUMN vanzare.produs_id  IS 'Product the SKU belongs to; null when the SKU is not in the catalogue';
COMMENT ON COLUMN vanzare.marime_id  IS 'Size the SKU belongs to';
COMMENT ON COLUMN vanzare.cantitate  IS 'Pieces ordered';
COMMENT ON COLUMN vanzare.valoare    IS 'Line value, RON';
COMMENT ON COLUMN vanzare.sursa      IS 'Where the row came from: shopify (synced) or dashboard (imported history)';
COMMENT ON COLUMN utilizator.email   IS 'Email; required once sign-in exists, optional until then';

COMMENT ON VIEW psf_tinta_zilnica IS 'Per PSF line and day of its selling period: pieces it was expected to sell that day (volume spread evenly).';
COMMENT ON VIEW psf_vandut_zilnic IS 'Per PSF line and day: sales of its product that day, shared among overlapping PSF lines in proportion to their daily target.';

COMMIT;
