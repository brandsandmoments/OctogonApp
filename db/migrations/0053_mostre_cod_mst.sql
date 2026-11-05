-- Mostrele au numărul lor, nu de PSF: mst-<brand>-<an>-<lună>-<nr> (ex. mst-ms-26-noi-1), ca să se vadă
-- din prima că e o mostră. Mostrele deja date se renumerotează (în ordinea lansării, pe brand și lună);
-- numărul vechi rămâne în observații, iar taierile lor își iau numele din numărul nou.
BEGIN;
DO $$
DECLARE
  f record; r record; pre text; n int;
BEGIN
  FOR f IN SELECT id FROM firma LOOP
    PERFORM set_config('app.firma_id', f.id::text, true);
    FOR r IN
      SELECT c.id, c.numar, b.cod AS brand, c.data_lansare
        FROM comanda c JOIN brand b ON b.id = c.brand_id
       WHERE c.firma_id = f.id AND c.origine = 'mostra' AND c.numar NOT LIKE 'mst-%' AND b.cod IS NOT NULL
       ORDER BY c.data_lansare, c.creat_la, c.numar
    LOOP
      pre := 'mst-' || r.brand || '-' || to_char(r.data_lansare, 'YY') || '-' || luna_scurta(r.data_lansare) || '-';
      n := coalesce((SELECT max(substr(numar, length(pre) + 1)::int) FROM comanda
                      WHERE firma_id = f.id AND numar LIKE pre || '%' AND substr(numar, length(pre) + 1) ~ '^[0-9]+$'), 0) + 1;
      UPDATE comanda SET numar = pre || n, observatii = concat_ws(' · ', nullif(observatii, ''), 'număr vechi ' || r.numar)
       WHERE id = r.id;
    END LOOP;
    UPDATE taiere t SET cod = coalesce(cod_taiere(t.id), t.cod)
     WHERE t.firma_id = f.id AND EXISTS (
       SELECT 1 FROM lot_croit lc JOIN planificare pl ON pl.id = lc.planificare_id JOIN comanda_linie cl ON cl.id = pl.linie_id
         JOIN comanda c ON c.id = cl.comanda_id WHERE lc.taiere_id = t.id AND c.origine = 'mostra');
  END LOOP;
END $$;
COMMIT;
