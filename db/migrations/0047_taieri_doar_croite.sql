-- Taierile se fac acum la croire, din „rămas de croit" (deja croite). Taierile făcute
-- dinainte și neatinse (nicio operație, nimic croit) se desfac: bucățile lor se întorc
-- în „rămas de croit", de unde se croiesc și se transformă în taieri.
BEGIN;
DO $$ DECLARE f uuid; BEGIN
  FOR f IN SELECT id FROM firma LOOP
    PERFORM set_config('app.firma_id', f::text, true);
    CREATE TEMP TABLE IF NOT EXISTS de_desfacut (id uuid) ON COMMIT DROP;
    DELETE FROM de_desfacut;
    INSERT INTO de_desfacut
      SELECT t.id FROM taiere t
       WHERE NOT EXISTS (SELECT 1 FROM taiere_operatie o WHERE o.taiere_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM lot_croit lc WHERE lc.taiere_id = t.id AND lc.croit_la IS NOT NULL)
         AND EXISTS (SELECT 1 FROM lot_croit lc WHERE lc.taiere_id = t.id)
         -- nimic legat de loturile ei (bandă, croit efectiv, mișcări de stoc)
         AND NOT EXISTS (SELECT 1 FROM lot_croit lc WHERE lc.taiere_id = t.id
                            AND (EXISTS (SELECT 1 FROM alimentare_banda ab WHERE ab.lot_id = lc.id)
                              OR EXISTS (SELECT 1 FROM lot_croit_efectiv le WHERE le.lot_id = lc.id)
                              OR EXISTS (SELECT 1 FROM miscare_stoc ms WHERE ms.lot_id = lc.id)));
    DELETE FROM lot_croit_cantitate WHERE lot_id IN (SELECT lc.id FROM lot_croit lc WHERE lc.taiere_id IN (SELECT id FROM de_desfacut));
    DELETE FROM lot_etapa WHERE lot_id IN (SELECT lc.id FROM lot_croit lc WHERE lc.taiere_id IN (SELECT id FROM de_desfacut));
    DELETE FROM lot_croit WHERE taiere_id IN (SELECT id FROM de_desfacut);
    DELETE FROM taiere_material WHERE taiere_id IN (SELECT id FROM de_desfacut);
    DELETE FROM taiere WHERE id IN (SELECT id FROM de_desfacut);
  END LOOP;
END $$;
COMMIT;
