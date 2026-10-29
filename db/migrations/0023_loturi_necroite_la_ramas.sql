-- Loturile trimise la croit în dashboard, dar netăiate, ajung în „rămas de croit".
--
-- În dashboard, „trimis la croit" însemna un lot pe fiecare comandă. În aplicație
-- (0016) taierile le face șefa de croit, din „rămas de croit": ea hotărăște ce taie
-- împreună — Alizee gri cu Alizee negru, cele trei culori de Melissa. Un lot importat
-- și încă necroit, cu taierea lui neatinsă în aplicație (nimic întins, nimic tăiat),
-- se șterge, iar bucățile lui redevin de croit; planificarea rămâne trimisă la croit.
-- La fel restul unei comenzi croite parțial în dashboard (lotul C2 de lângă un C1
-- croit): taierea rămâne doar cu ce s-a croit. Importul
-- o face la fiecare rulare.

BEGIN;

CREATE OR REPLACE FUNCTION loturi_necroite_la_ramas() RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
    CREATE TEMP TABLE de_sters ON COMMIT DROP AS
    SELECT lc.id, lc.taiere_id FROM lot_croit lc
     WHERE lc.croit_la IS NULL
       AND lc.observatii LIKE 'Import din dashboard%'
       AND NOT EXISTS (SELECT 1 FROM lot_croit_efectiv e WHERE e.lot_id = lc.id)
       AND NOT EXISTS (SELECT 1 FROM alimentare_banda ab WHERE ab.lot_id = lc.id)
       AND NOT EXISTS (SELECT 1 FROM miscare_stoc ms WHERE ms.lot_id = lc.id)
       AND (lc.taiere_id IS NULL OR (
            NOT EXISTS (SELECT 1 FROM taiere_operatie o WHERE o.taiere_id = lc.taiere_id)
        AND NOT EXISTS (SELECT 1 FROM taiere_material tm WHERE tm.taiere_id = lc.taiere_id)
        AND NOT EXISTS (SELECT 1 FROM lot_croit x WHERE x.taiere_id = lc.taiere_id AND x.id <> lc.id
                         AND x.observatii NOT LIKE 'Import din dashboard%')));
    DELETE FROM lot_croit WHERE id IN (SELECT id FROM de_sters);
    GET DIAGNOSTICS n = ROW_COUNT;
    DELETE FROM taiere t WHERE t.id IN (SELECT taiere_id FROM de_sters)
       AND NOT EXISTS (SELECT 1 FROM lot_croit WHERE taiere_id = t.id);
    DROP TABLE de_sters;
    RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION loturi_necroite_la_ramas() TO octogon_app;

COMMIT;
