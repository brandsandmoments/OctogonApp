-- Alimentarea benzii: loturile croite intră în producție, în una sau mai multe tranșe.
--
-- Lanțul din dashboard continuă: …/P1/C1 (lotul croit) → …/P1/C1/B1 (tranșa de pe
-- bandă). O tranșă trece prin intrare în producție, ieșire din producție, CTC și
-- predare la depozit, fiecare cu ora ei.
--
-- Accesoriile (etichete, pungi, stickere) ies din depozit aici, nu la croit. Până
-- atunci rămân rezervate: rezervarea lor ține cât lotul e croit și încă neintrat
-- pe bandă, nu se mai termină la croit.

-- Valoarea nouă de enum stă înaintea tranzacției: constrângerea de mai jos o folosește.
ALTER TYPE tip_miscare ADD VALUE IF NOT EXISTS 'consum_banda';

BEGIN;

CREATE TABLE alimentare_banda (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id            uuid NOT NULL REFERENCES firma(id),
    lot_id              uuid NOT NULL REFERENCES lot_croit(id) ON DELETE RESTRICT,
    numar               int  NOT NULL CHECK (numar > 0),        -- …/C1/B1, B2: tranșa în lot
    alimentat_la        timestamptz NOT NULL DEFAULT now(),
    alimentat_de        uuid NULL REFERENCES utilizator(id),
    responsabil         text,                                    -- șeful de bandă, până există utilizatori
    persoane            int  CHECK (persoane > 0),
    timp_min_buc        numeric(8,2) CHECK (timp_min_buc > 0),   -- minute de producție pe bucată
    intrat_productie_la timestamptz,
    iesit_productie_la  timestamptz,
    ctc_la              timestamptz,
    predat_depozit_la   timestamptz,
    observatii          text,
    UNIQUE (lot_id, numar),
    -- Drumul pe bandă merge într-un singur sens: nu iese din producție ce n-a intrat.
    CHECK (iesit_productie_la IS NULL OR intrat_productie_la IS NOT NULL),
    CHECK (ctc_la             IS NULL OR iesit_productie_la  IS NOT NULL),
    CHECK (predat_depozit_la  IS NULL OR ctc_la              IS NOT NULL)
);

CREATE TABLE alimentare_cantitate (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    alimentare_id  uuid NOT NULL REFERENCES alimentare_banda(id) ON DELETE CASCADE,
    marime_id      uuid NOT NULL REFERENCES marime(id),
    cantitate      int  NOT NULL CHECK (cantitate > 0),
    UNIQUE (alimentare_id, marime_id)
);

CREATE INDEX ON alimentare_banda (firma_id, lot_id);

-- Consumul de pe bandă își spune tranșa, cum consumul de la croit își spune lotul.
ALTER TABLE miscare_stoc ADD COLUMN alimentare_id uuid NULL REFERENCES alimentare_banda(id) ON DELETE RESTRICT;
ALTER TABLE miscare_stoc DROP CONSTRAINT miscare_stoc_semn;
ALTER TABLE miscare_stoc ADD CONSTRAINT miscare_stoc_semn CHECK (CASE tip
     WHEN 'intrare'           THEN cantitate > 0
     WHEN 'consum_croit'      THEN cantitate < 0
     WHEN 'consum_banda'      THEN cantitate < 0
     WHEN 'iesire'            THEN cantitate < 0
     WHEN 'retur_furnizor'    THEN cantitate < 0
     WHEN 'ajustare_inventar' THEN true
   END);
ALTER TABLE miscare_stoc ADD CONSTRAINT miscare_stoc_consum_banda_cu_transa
    CHECK (tip <> 'consum_banda' OR alimentare_id IS NOT NULL);

-- ---------------------------------------------------------------- vederi

-- Ce s-a croit dintr-un lot și încă n-a intrat pe bandă, pe mărimi.
CREATE VIEW lot_rest_de_alimentat WITH (security_invoker = true) AS
SELECT lc.firma_id, lc.id AS lot_id, lc.planificare_id, le.marime_id,
       le.cantitate AS croit,
       coalesce(al.q, 0)::int AS alimentat,
       greatest(le.cantitate - coalesce(al.q, 0), 0)::int AS rest
  FROM lot_croit lc
  JOIN lot_croit_efectiv le ON le.lot_id = lc.id
  LEFT JOIN (SELECT ab.lot_id, ac.marime_id, sum(ac.cantitate) AS q
               FROM alimentare_banda ab JOIN alimentare_cantitate ac ON ac.alimentare_id = ab.id
              GROUP BY ab.lot_id, ac.marime_id) al
         ON al.lot_id = lc.id AND al.marime_id = le.marime_id
 WHERE lc.croit_la IS NOT NULL;

-- Rezervarea, în două părți:
--   - tot materialul pentru ce a rămas de croit (ca în 0008);
--   - accesoriile pentru ce s-a croit și încă n-a intrat pe bandă — ele ies din
--     depozit abia la alimentare, deci până atunci sunt promise.
CREATE OR REPLACE VIEW rezervare_material WITH (security_invoker = true) AS
SELECT firma_id, planificare_id, material_id, sum(rezervat)::numeric(12,3) AS rezervat
  FROM (
    SELECT r.firma_id, r.planificare_id, pm.material_id, r.rest * mc.consum AS rezervat
      FROM planificare_rest_de_croit r
      JOIN comanda_linie cl    ON cl.id = r.linie_id
      JOIN produs_material pm  ON pm.produs_id = cl.produs_id
      JOIN model_componenta mc ON mc.id = pm.componenta_id
     WHERE r.rest > 0
    UNION ALL
    SELECT ra.firma_id, ra.planificare_id, pm.material_id, ra.rest * mc.consum
      FROM lot_rest_de_alimentat ra
      JOIN planificare pl      ON pl.id = ra.planificare_id
      JOIN comanda_linie cl    ON cl.id = pl.linie_id
      JOIN produs_material pm  ON pm.produs_id = cl.produs_id AND pm.tip = 'accesoriu'
      JOIN model_componenta mc ON mc.id = pm.componenta_id
     WHERE ra.rest > 0
  ) x
 GROUP BY firma_id, planificare_id, material_id;

-- ---------------------------------------------------------------- izolare

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['alimentare_banda', 'alimentare_cantitate']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON alimentare_banda, alimentare_cantitate TO octogon_app;
GRANT SELECT ON lot_rest_de_alimentat TO octogon_app;

-- ---------------------------------------------------------------- traduceri

COMMENT ON TABLE  alimentare_banda IS 'Line feeding tranche: part of a cut batch sent into sewing. A batch may go in several tranches (…/C1/B1, B2).';
COMMENT ON COLUMN alimentare_banda.numar               IS 'Tranche number within the cutting batch';
COMMENT ON COLUMN alimentare_banda.alimentat_la        IS 'Fed to the line at';
COMMENT ON COLUMN alimentare_banda.alimentat_de        IS 'Fed by';
COMMENT ON COLUMN alimentare_banda.responsabil         IS 'Line lead responsible, as free text until users exist';
COMMENT ON COLUMN alimentare_banda.persoane            IS 'People assigned on the line';
COMMENT ON COLUMN alimentare_banda.timp_min_buc        IS 'Production minutes per piece';
COMMENT ON COLUMN alimentare_banda.intrat_productie_la IS 'Entered production at';
COMMENT ON COLUMN alimentare_banda.iesit_productie_la  IS 'Left production at';
COMMENT ON COLUMN alimentare_banda.ctc_la              IS 'Through quality control and packing at';
COMMENT ON COLUMN alimentare_banda.predat_depozit_la   IS 'Handed to the warehouse at';
COMMENT ON COLUMN alimentare_banda.observatii          IS 'Notes';
COMMENT ON TABLE  alimentare_cantitate IS 'Pieces fed to the line in one tranche, per size. Never more than was cut.';
COMMENT ON COLUMN alimentare_cantitate.cantitate IS 'Pieces fed';
COMMENT ON COLUMN miscare_stoc.alimentare_id IS 'Line feeding tranche that consumed it. Required on line consumption.';
COMMENT ON COLUMN miscare_stoc.tip IS 'Movement kind: intrare (receipt from supplier), consum_croit (raw material used in cutting), consum_banda (accessories used on the line), ajustare_inventar (stock count correction), iesire (other issue), retur_furnizor (return to supplier)';
COMMENT ON VIEW   lot_rest_de_alimentat IS 'Per cut batch and size: cut, fed to the line so far, and what remains to feed.';
COMMENT ON VIEW   rezervare_material IS 'Material reserved per planning batch: everything for pieces still to cut, plus accessories for pieces cut but not yet fed to the line.';

COMMIT;
