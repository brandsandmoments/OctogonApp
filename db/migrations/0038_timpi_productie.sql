-- Timpii de producție pe model, din „NOMENCLATOR TIMPI PRODUCTIE - Parseea + Maison Loulou"
-- (minute pe bucată, făcută de un singur om), și calculatorul de timp: din câte bucăți
-- și câți operatori, câte ore-om, câte zile lucrătoare și când iese gata.
--
-- Zilele lucrătoare sar peste sâmbătă și duminică. Parametrii noi: costul unui minut-om
-- (manopera, din foaia MANOPERA) și câți operatori presupune o estimare când nu se spune.
BEGIN;

-- Data după n zile lucrătoare (luni–vineri) de la o zi dată.
CREATE FUNCTION adauga_zile_lucratoare(d date, n int) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN n <= 0 THEN d ELSE (
    SELECT z::date FROM generate_series(d + 1, d + n * 2 + 7, interval '1 day') z
     WHERE extract(isodow FROM z) < 6 ORDER BY z OFFSET n - 1 LIMIT 1) END
$$;
COMMENT ON FUNCTION adauga_zile_lucratoare(date, int) IS 'The date n working days (Monday to Friday) after d';
GRANT EXECUTE ON FUNCTION adauga_zile_lucratoare(date, int) TO octogon_app;

DO $$ DECLARE f uuid; BEGIN
  FOR f IN SELECT id FROM firma LOOP
    PERFORM set_config('app.firma_id', f::text, true);
    INSERT INTO parametru (firma_id, cheie, valoare, descriere) VALUES
      (f, 'cost_minut_om', 1.5026, 'Manopera: cât costă un minut-om (costul fabricii pe lună / minutele-om lucrate)'),
      (f, 'operatori_impliciti', 6, 'Câți operatori presupune o estimare de timp când nu se spune altfel')
    ON CONFLICT (firma_id, cheie) DO NOTHING;
    -- Timpii pe model: produsele modelului au SKU-ul care începe cu codul din nomenclator.
    UPDATE model m SET timp_min_buc = t.minute
      FROM (VALUES
    ('PSA-JOSEPHINE', 100),
    ('PSA-ALINA', 74),
    ('PSA-ALMA', 90),
    ('PSA-ANASTASIA', 160),
    ('PSA-ANIA', 60),
    ('PSA-ANNA', 60),
    ('PSA-ARIANA', 84),
    ('PSA-ARITZIA', 80),
    ('PSA-AURELLIA', 300),
    ('PSA-BELLA', 180),
    ('PSA-BIANCA', 67),
    ('PSA-CASSIOPIA', 300),
    ('PSA-CLARISSE', 100),
    ('PSA-CLEO', 180),
    ('PSA-CORINNE', 74),
    ('PSA-DAHLIA', 84),
    ('PSA-DAMARIS', 74),
    ('PSA-DARIA', 64),
    ('PSA-DENISA', 60),
    ('PSA-ELINA', 74),
    ('PSA-ELIZA', 120),
    ('PSA-EMILY', 94),
    ('PSA-ESME', 200),
    ('PSA-ESTELLE', 80),
    ('PSA-FELICES', 94),
    ('PSA-HERA', 87),
    ('PSA-INNA', 200),
    ('PSA-ISABELLE', 80),
    ('PSA-KAIA', 90),
    ('PSA-KATY', 100),
    ('PSA-LEYLA', 120),
    ('PSA-LILITH', 100),
    ('PSA-LILITHTWIST', 100),
    ('PSA-LORA', 69),
    ('PSA-LUNA', 100),
    ('PSA-MADELEINE', 94),
    ('PSA-MARA', 74),
    ('PSA-MARIA', 60),
    ('PSA-MIRA', 74),
    ('PSA-MIRABELLE', 67),
    ('PSA-NADINE', 84),
    ('PSA-NICOLLE', 87),
    ('PSA-NINA', 80),
    ('PSA-NONNA', 87),
    ('PSA-NORA', 94),
    ('PSA-OLLIE', 74),
    ('PSA-OPHELIA', 80),
    ('PSA-PARIS', 94),
    ('PSA-PENELOPE', 200),
    ('PSA-REVERIE', 94),
    ('PSA-ROSA', 87),
    ('PSA-SERENE', 94),
    ('PSA-SIENNA', 60),
    ('PSA-SOPHIE', 60),
    ('PSA-THEIA', 67),
    ('PSA-VALENCIA', 100),
    ('PSA-VALERIE', 100),
    ('PSA-VERSAILLES', 84),
    ('PSA-VIVIANA', 120),
    ('PSA-ZARIA', 80),
    ('PSA-KATHYA', 84),
    ('PSA-RAFA', 94),
    ('PSA-VANILLA', 54),
    ('MSLL-COSTUMAMALYA', 100),
    ('MSLL-COSTUMANTONIQ', 117),
    ('MSLL-COSTUMARTEMIS', 87),
    ('MSLL-COSTUMATHENA', 84),
    ('MSLL-COSTUMAUGUST', 87),
    ('MSLL-COSTUMCALYA', 107),
    ('MSLL-COSTUMCAMELLIA', 100),
    ('MSLL-COSTUMCOCO', 87),
    ('MSLL-COSTUMELISE', 94),
    ('MSLL-COSTUMIRIS', 100),
    ('MSLL-COSTUMJACKIE', 77),
    ('MSLL-COSTUMJASMINE', 87),
    ('MSLL-COSTUMJOJO', 90),
    ('MSLL-COSTUMLURESSA', 94),
    ('MSLL-COSTUMMADA', 120),
    ('MSLL-COSTUMMAIA', 87),
    ('MSLL-COSTUMMARLENNE', 87),
    ('MSLL-COSTUMMEDEEA', 107),
    ('MSLL-COSTUMMONROE', 87),
    ('MSLL-COSTUMRENEE', 87),
    ('MSLL-COSTUMSOPHYE', 100),
    ('MSLL-PALTONELORIA', 94),
    ('MSLL-PALTONNAELINE', 94),
    ('MSLL-ROCHIEAMELISSE', 60),
    ('MSLL-ROCHIEAYA', 60),
    ('MSLL-ROCHIEAZALEEA', 74),
    ('MSLL-ROCHIEEVANE', 67),
    ('MSLL-ROCHIEHELEN', 60),
    ('MSLL-ROCHIEIRYNE', 80),
    ('MSLL-ROCHIEMIREEA', 60),
    ('MSLL-ROCHIEMONACO', 67),
    ('MSLL-ROCHIENUAGE', 90),
    ('MSLL-ROCHIESERAPHYNE', 67),
    ('MSLL-ROCHIESERENZA', 67),
    ('MSLL-ROCHIETHABITA', 67),
    ('MSLL-ROCHIETHEONA', 67),
    ('MSLL-ROCHIEANABELLE', 54),
    ('MSLL-ROCHIEBRILLIA', 54),
    ('MSLL-ROCHIECALLISTA', 54),
    ('MSLL-ROCHIELIANA', 67),
    ('MSLL-ROCHIEPOSITANO', 54),
    ('MSLL-ROCHIECINDERELLA', 80),
    ('MSLL-ROCHIEMARLA', 54),
    ('MSLL-ROCHIENAELLA', 67),
    ('MSLL-ROCHIENERRISA', 60),
    ('MSLL-ROCHIENOIRE', 50),
    ('MSLL-ROCHIEOLIVIA', 67),
    ('MSLL-ROCHIETHALASSA', 50),
    ('MSLL-ROCHIEVLORE', 60),
    ('MSLL-SETLOULOU', 90)
      ) AS t(cod, minute)
     WHERE m.timp_min_buc IS NULL
       AND m.id = (SELECT p.model_id FROM produs p WHERE p.cod_sku LIKE t.cod || '-%' AND p.model_id IS NOT NULL LIMIT 1);
  END LOOP;
END $$;

COMMIT;
