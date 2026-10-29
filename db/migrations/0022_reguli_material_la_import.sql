-- Regulile de material ale aplicației, ca funcții: importul din dashboard le aplică
-- de fiecare dată, nu doar o dată, la migrarea care le-a introdus.
--
-- - tip_material_dupa_nume: materie primă e doar ce se întinde și se taie (0018);
--   ața, banda thermo, fermoarele, nasturii, balenele, thermo-ul — accesorii, chiar
--   dacă dashboard-ul le ține la MP.
-- - material_comun: accesoriile identice pe orice culoare (0019).
-- - imparte_materiale_pe_culori: un produs legat de un material al altei culori
--   (sau de unul fără culoare) trece pe materialul culorii lui, creat la nevoie.
-- - taieri_pentru_loturi: un lot importat fără taiere primește una (0016), cu cod
--   pe luna lui (0021).

BEGIN;

CREATE FUNCTION tip_material_dupa_nume(denumire text, unitate unitate_masura) RETURNS tip_material
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN unitate IN ('m', 'm2')
                 AND denumire !~* '(^|·|\s)(a[tț]a|balene|capete|siret|șiret|elastic|banda|therm|canal|fermoar|nastur|snur|cupe|bureti|burete|pernute|umerasi)'
                THEN 'materie_prima' ELSE 'accesoriu' END::tip_material
$$;

CREATE FUNCTION material_comun(denumire text) RETURNS bool LANGUAGE sql IMMUTABLE AS $$
    SELECT denumire ~* '^\s*(eticheta|sticker|punga|ac impuscat|balene|capete balene|cupe|bureti|burete|pernute|umerasi|thermo|banda thermo|elastic|banda elastica)'
$$;

CREATE FUNCTION imparte_materiale_pe_culori() RETURNS int LANGUAGE plpgsql AS $$
DECLARE r record; tinta uuid; n int := 0;
BEGIN
    FOR r IN
        SELECT pm.produs_id, pm.componenta_id, m.id AS material_id, m.tip, m.cod, m.unitate, m.furnizor, m.familie,
               m.pret_referinta, p.culoare_id, cu.nume AS culoare,
               CASE WHEN m.culoare_id IS NULL THEN m.denumire ELSE regexp_replace(m.denumire, '\s·\s[^·]*$', '') END AS baza
          FROM produs_material pm
          JOIN material m ON m.id = pm.material_id
          JOIN produs p   ON p.id = pm.produs_id
          JOIN culoare cu ON cu.id = p.culoare_id
         WHERE NOT material_comun(m.denumire)
           AND (m.culoare_id IS NULL OR m.culoare_id <> p.culoare_id)
    LOOP
        SELECT id INTO tinta FROM material
         WHERE cod = r.cod || '-' || upper(regexp_replace(translate(r.culoare, 'ăâîșşțţĂÂÎȘŞȚŢ', 'aaissttAAISSTT'), '[^A-Za-z0-9]+', '-', 'g'));
        IF tinta IS NULL THEN
            INSERT INTO material (firma_id, tip, cod, denumire, culoare_id, unitate, furnizor, familie, pret_referinta)
            VALUES (firma_curenta(), r.tip,
                    r.cod || '-' || upper(regexp_replace(translate(r.culoare, 'ăâîșşțţĂÂÎȘŞȚŢ', 'aaissttAAISSTT'), '[^A-Za-z0-9]+', '-', 'g')),
                    r.baza || ' · ' || upper(r.culoare), r.culoare_id, r.unitate, r.furnizor, r.familie, r.pret_referinta)
            RETURNING id INTO tinta;
        END IF;
        UPDATE produs_material SET material_id = tinta WHERE produs_id = r.produs_id AND componenta_id = r.componenta_id;
        n := n + 1;
    END LOOP;
    -- Materialele fără culoare rămase fără produse și fără mișcări nu mai sunt folosite.
    UPDATE material m SET activ = false
     WHERE m.activ AND m.culoare_id IS NULL AND NOT material_comun(m.denumire)
       AND EXISTS (SELECT 1 FROM material x WHERE x.cod LIKE m.cod || '-%' AND x.culoare_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM produs_material WHERE material_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM miscare_stoc WHERE material_id = m.id);
    RETURN n;
END $$;

CREATE FUNCTION taieri_pentru_loturi() RETURNS int LANGUAGE plpgsql AS $$
DECLARE r record; t uuid; prefix text; n int := 0;
BEGIN
    LOCK TABLE taiere IN SHARE ROW EXCLUSIVE MODE;
    FOR r IN
        SELECT lc.planificare_id, min(lc.data_primire) AS zi
          FROM lot_croit lc WHERE lc.taiere_id IS NULL
         GROUP BY lc.planificare_id ORDER BY min(lc.data_primire), lc.planificare_id
    LOOP
        prefix := 't-' || to_char(r.zi, 'YY') || '-' || luna_scurta(r.zi) || '-';
        INSERT INTO taiere (firma_id, numar, ordine, creat_la, trimis_la, cod)
        VALUES (firma_curenta(), (SELECT coalesce(max(numar), 0) + 1 FROM taiere),
                (SELECT coalesce(max(ordine), 0) + 1 FROM taiere), r.zi, r.zi,
                prefix || (SELECT coalesce(max(substr(cod, length(prefix) + 1)::int), 0) + 1 FROM taiere
                            WHERE cod LIKE prefix || '%' AND substr(cod, length(prefix) + 1) ~ '^[0-9]+$'))
        RETURNING id INTO t;
        UPDATE lot_croit SET taiere_id = t WHERE planificare_id = r.planificare_id AND taiere_id IS NULL;
        n := n + 1;
    END LOOP;
    -- Planificările plecate la croit își iau locul la coada croitului.
    UPDATE planificare pl SET ordine_croit = o.n
      FROM (SELECT id, (SELECT coalesce(max(ordine_croit), 0) FROM planificare) + row_number() OVER (ORDER BY data_planificare, id) AS n
              FROM planificare WHERE stadiu IN ('lansat_spre_croit', 'in_croit') AND ordine_croit IS NULL) o
     WHERE o.id = pl.id;
    RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION tip_material_dupa_nume(text, unitate_masura), material_comun(text),
                          imparte_materiale_pe_culori(), taieri_pentru_loturi() TO octogon_app;

COMMIT;
