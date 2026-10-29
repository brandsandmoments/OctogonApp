-- Numere date de aplicație, pe lună: psf-ms-26-noi-1, psc-ps-26-noi-3, t-26-noi-12.
--
-- Numărul unei comenzi se scria de mână și ieșea cum ieșea („psc-ps-ssssssss").
-- Acum îl dă aplicația: tipul, codul brandului, anul, luna, numărul de ordine în
-- luna aceea — pe tip și brand, de la 1 în fiecare lună. Taierile la fel:
-- t-anul-luna-nr, de la 1 în fiecare lună.

BEGIN;

ALTER TABLE brand ADD COLUMN cod text;
COMMENT ON COLUMN brand.cod IS 'Short code used in order numbers: ms, ps, sl';

ALTER TABLE taiere ADD COLUMN cod text;
CREATE UNIQUE INDEX ON taiere (firma_id, cod);
COMMENT ON COLUMN taiere.cod IS 'Cut code: t-year-month-number, numbered from 1 each month';

CREATE FUNCTION luna_scurta(d date) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT (ARRAY['ian','feb','mar','apr','mai','iun','iul','aug','sep','oct','noi','dec'])[extract(month FROM d)::int]
$$;
GRANT EXECUTE ON FUNCTION luna_scurta(date) TO octogon_app;

DO $$
DECLARE f uuid;
BEGIN
    FOR f IN SELECT id FROM firma LOOP
        PERFORM set_config('app.firma_id', f::text, true);
        UPDATE brand SET cod = CASE lower(nume) WHEN 'maison loulou' THEN 'ms' WHEN 'parseea' THEN 'ps' WHEN 'sleevy' THEN 'sl'
                                   ELSE lower(left(regexp_replace(nume, '[^A-Za-z]', '', 'g'), 2)) END
         WHERE cod IS NULL;
        UPDATE taiere t SET cod = x.cod
          FROM (SELECT id, 't-' || to_char(coalesce(trimis_la, creat_la), 'YY') || '-' || luna_scurta(coalesce(trimis_la, creat_la)::date)
                       || '-' || row_number() OVER (PARTITION BY date_trunc('month', coalesce(trimis_la, creat_la)) ORDER BY numar) AS cod
                  FROM taiere) x
         WHERE t.id = x.id;
    END LOOP;
END $$;

COMMIT;
