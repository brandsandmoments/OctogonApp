-- Un material pe fiecare culoare.
--
-- În nomenclatorul adus din dashboard, „STOFA DAMARIS" era un singur material
-- pentru toate culorile, deci necesarul, stocul și lista de cumpărături adunau
-- stofa roșie cu cea ivoire: 28 m, când de fapt trebuie 18 m roșie și 10 m albă.
-- Fizic sunt două suluri, cumpărate separat, cu stoc separat.
--
-- Fiecare material folosit de produse în mai multe culori se împarte: câte unul
-- pe culoare („STOFA DAMARIS · ROSU", cod MP-098-ROSU), legat de produsele culorii
-- lui. Rămân comune doar accesoriile care sunt aceleași pe orice culoare:
-- etichete, stickere, pungi, acul împușcat, balene, cupe, bureți, pernuțe,
-- umerași, thermo, elastic. Mișcările de stoc legate de un lot sau de o tranșă de
-- pe bandă trec pe materialul culorii lor; materialul vechi, rămas fără folosință,
-- se dezactivează.

BEGIN;

CREATE FUNCTION pg_temp.comun(denumire text) RETURNS bool LANGUAGE sql IMMUTABLE AS $$
    SELECT denumire ~* '^\s*(eticheta|sticker|punga|ac impuscat|balene|capete balene|cupe|bureti|burete|pernute|umerasi|thermo|banda thermo|elastic|banda elastica)'
$$;

CREATE FUNCTION pg_temp.slug(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT upper(regexp_replace(translate(t, 'ăâîșşțţĂÂÎȘŞȚŢ', 'aaissttAAISSTT'), '[^A-Za-z0-9]+', '-', 'g'))
$$;

DO $$
DECLARE f uuid; m record; c record; nou uuid;
BEGIN
    FOR f IN SELECT id FROM firma LOOP
        PERFORM set_config('app.firma_id', f::text, true);

        FOR m IN
            SELECT mt.*, (SELECT count(DISTINCT p.culoare_id) FROM produs_material pm JOIN produs p ON p.id = pm.produs_id
                           WHERE pm.material_id = mt.id) AS culori
              FROM material mt
             WHERE mt.culoare_id IS NULL AND NOT pg_temp.comun(mt.denumire)
               AND EXISTS (SELECT 1 FROM produs_material pm WHERE pm.material_id = mt.id)
        LOOP
            IF m.culori = 1 THEN
                -- O singură culoare: materialul e deja al ei; i se spune culoarea.
                UPDATE material mt SET culoare_id = x.culoare_id, denumire = mt.denumire || ' · ' || upper(x.nume)
                  FROM (SELECT DISTINCT p.culoare_id, cu.nume FROM produs_material pm JOIN produs p ON p.id = pm.produs_id
                          JOIN culoare cu ON cu.id = p.culoare_id WHERE pm.material_id = m.id) x
                 WHERE mt.id = m.id;
                CONTINUE;
            END IF;

            FOR c IN
                SELECT DISTINCT p.culoare_id, cu.nume FROM produs_material pm JOIN produs p ON p.id = pm.produs_id
                  JOIN culoare cu ON cu.id = p.culoare_id WHERE pm.material_id = m.id
            LOOP
                INSERT INTO material (firma_id, tip, cod, denumire, culoare_id, unitate, furnizor, familie, pret_referinta, activ)
                VALUES (f, m.tip, m.cod || '-' || pg_temp.slug(c.nume), m.denumire || ' · ' || upper(c.nume), c.culoare_id,
                        m.unitate, m.furnizor, m.familie, m.pret_referinta, true)
                ON CONFLICT (firma_id, cod) DO UPDATE SET culoare_id = EXCLUDED.culoare_id
                RETURNING id INTO nou;

                UPDATE produs_material pm SET material_id = nou
                  FROM produs p WHERE p.id = pm.produs_id AND pm.material_id = m.id AND p.culoare_id = c.culoare_id;

                -- Consumul la croit (pe lot) și la bandă (pe tranșă) își știe produsul, deci culoarea.
                UPDATE miscare_stoc ms SET material_id = nou
                  FROM lot_croit lc JOIN planificare pl ON pl.id = lc.planificare_id
                  JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN produs p ON p.id = cl.produs_id
                 WHERE ms.material_id = m.id AND ms.lot_id = lc.id AND p.culoare_id = c.culoare_id;
                UPDATE miscare_stoc ms SET material_id = nou
                  FROM alimentare_banda ab JOIN lot_croit lc ON lc.id = ab.lot_id JOIN planificare pl ON pl.id = lc.planificare_id
                  JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN produs p ON p.id = cl.produs_id
                 WHERE ms.material_id = m.id AND ms.alimentare_id = ab.id AND p.culoare_id = c.culoare_id;
                UPDATE planificare_material b SET material_id = nou
                  FROM planificare pl JOIN comanda_linie cl ON cl.id = pl.linie_id JOIN produs p ON p.id = cl.produs_id
                 WHERE b.material_id = m.id AND b.planificare_id = pl.id AND p.culoare_id = c.culoare_id
                   AND NOT EXISTS (SELECT 1 FROM planificare_material x WHERE x.planificare_id = b.planificare_id AND x.material_id = nou);
                UPDATE taiere_material tm SET material_id = nou
                  FROM produs p WHERE tm.material_id = m.id AND tm.produs_id = p.id AND p.culoare_id = c.culoare_id;
                UPDATE fisa_culoare_material fm SET material_id = nou
                 WHERE fm.material_id = m.id AND lower(fm.culoare) = lower(c.nume);
            END LOOP;

            -- Fără produse și fără mișcări rămase, materialul vechi nu mai e folosit.
            UPDATE material SET activ = false
             WHERE id = m.id
               AND NOT EXISTS (SELECT 1 FROM produs_material WHERE material_id = m.id)
               AND NOT EXISTS (SELECT 1 FROM miscare_stoc WHERE material_id = m.id);
        END LOOP;
    END LOOP;
END $$;

COMMENT ON COLUMN material.culoare_id IS 'Colour of the material: a fabric or a button in red is a different material from the same in ivory, with its own stock';

COMMIT;
