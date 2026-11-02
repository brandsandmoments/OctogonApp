-- Drum mai scurt: un PSF sau PSC lansat pleacă singur la croit — fără pasul de
-- planificare (planificat, bifat materialele, trimis). Și planul de producție pe
-- săptămâni: managerul de producție pune comenzile pe săptămâna (luni–vineri) în
-- care se lucrează; croitul și banda văd ce e de făcut în săptămâna aceea.
BEGIN;

-- Planifică tot ce n-a acoperit încă nicio planificare (în afară de cele anulate)
-- și trimite direct la croit. O planificare încheiată cu rest necroit rămâne închisă:
-- restul ei nu se mai planifică din nou. Cantitățile adăugate apoi pe comandă, da.
CREATE FUNCTION planifica_automat(p_comanda uuid DEFAULT NULL) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  l record;
  pid uuid;
  n int := 0;
BEGIN
  LOCK TABLE planificare IN SHARE ROW EXCLUSIVE MODE;
  FOR l IN
    SELECT cl.id, cl.comanda_id
      FROM comanda_linie cl JOIN comanda c ON c.id = cl.comanda_id
     WHERE c.stare IN ('lansata', 'in_productie') AND (p_comanda IS NULL OR c.id = p_comanda)
       AND EXISTS (SELECT 1 FROM comanda_cantitate cc
                    WHERE cc.linie_id = cl.id
                      AND cc.cantitate > coalesce((SELECT sum(pc.cantitate) FROM planificare pl
                                                     JOIN planificare_cantitate pc ON pc.planificare_id = pl.id
                                                    WHERE pl.linie_id = cl.id AND pc.marime_id = cc.marime_id
                                                      AND pl.stadiu <> 'anulat'), 0))
     ORDER BY c.prioritate, c.data_lansare, c.numar, cl.id
  LOOP
    INSERT INTO planificare (firma_id, linie_id, numar_transa, stadiu, ordine_croit, observatii)
    VALUES (firma_curenta(), l.id,
            (SELECT coalesce(max(pl.numar_transa), 0) + 1 FROM planificare pl JOIN comanda_linie x ON x.id = pl.linie_id
              WHERE x.comanda_id = l.comanda_id),
            'lansat_spre_croit', (SELECT coalesce(max(ordine_croit), 0) + 1 FROM planificare), 'automat, la lansare')
    RETURNING id INTO pid;
    INSERT INTO planificare_cantitate (firma_id, planificare_id, marime_id, cantitate)
    SELECT firma_curenta(), pid, cc.marime_id, cc.cantitate - coalesce(p.q, 0)
      FROM comanda_cantitate cc
      LEFT JOIN LATERAL (SELECT sum(pc.cantitate)::int AS q FROM planificare pl
                           JOIN planificare_cantitate pc ON pc.planificare_id = pl.id
                          WHERE pl.linie_id = l.id AND pc.marime_id = cc.marime_id AND pl.stadiu <> 'anulat' AND pl.id <> pid) p ON true
     WHERE cc.linie_id = l.id AND cc.cantitate > coalesce(p.q, 0);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION planifica_automat(uuid) TO octogon_app;
COMMENT ON FUNCTION planifica_automat(uuid) IS 'Plans every launched order quantity not yet covered by a non-cancelled planning batch and sends it straight to cutting';

CREATE TABLE plan_saptamana (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id    uuid NOT NULL REFERENCES firma(id),
    comanda_id  uuid NOT NULL REFERENCES comanda(id) ON DELETE CASCADE,
    saptamana   date NOT NULL CHECK (extract(isodow FROM saptamana) = 1),   -- lunea săptămânii
    ordine      int  NOT NULL DEFAULT 0,
    creat_de    uuid NULL DEFAULT utilizator_curent() REFERENCES utilizator(id),
    creat_la    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (firma_id, comanda_id)
);
CREATE INDEX ON plan_saptamana (firma_id, saptamana);
ALTER TABLE plan_saptamana ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_saptamana FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON plan_saptamana USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_saptamana TO octogon_app;
COMMENT ON TABLE  plan_saptamana IS 'Production plan: the working week (Monday to Friday) each PSF/PSC is scheduled in';
COMMENT ON COLUMN plan_saptamana.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN plan_saptamana.saptamana IS 'Monday of the working week';
COMMENT ON COLUMN plan_saptamana.ordine IS 'Order within the week, as the production manager sets it';

-- Ce stătea în planificare netrimis pleacă la croit; ce nu era planificat, se planifică.
DO $$ DECLARE f uuid; BEGIN
  FOR f IN SELECT id FROM firma LOOP
    PERFORM set_config('app.firma_id', f::text, true);
    UPDATE planificare pl SET stadiu = 'lansat_spre_croit', ordine_croit = o.n
      FROM (SELECT id, (SELECT coalesce(max(ordine_croit), 0) FROM planificare) + row_number() OVER (ORDER BY data_planificare, id) AS n
              FROM planificare WHERE stadiu IN ('gata_de_lansat', 'blocat_materiale')) o
     WHERE pl.id = o.id;
    PERFORM planifica_automat(NULL);
  END LOOP;
END $$;

COMMIT;
