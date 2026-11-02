-- Codurile brandurilor din numărul comenzii (ms, ps, sl). 0021 le punea cu un UPDATE
-- simplu, care pe server (rulat ca proprietar, prin RLS, fără firmă aleasă) n-a atins
-- niciun rând: fără cod, numărul unei comenzi noi ieșea gol și salvarea cădea.
BEGIN;
DO $$ DECLARE f uuid; BEGIN
  FOR f IN SELECT id FROM firma LOOP
    PERFORM set_config('app.firma_id', f::text, true);
    UPDATE brand SET cod = CASE lower(nume) WHEN 'maison loulou' THEN 'ms' WHEN 'parseea' THEN 'ps' WHEN 'sleevy' THEN 'sl' END
     WHERE cod IS NULL AND lower(nume) IN ('maison loulou', 'parseea', 'sleevy');
  END LOOP;
END $$;
COMMIT;
