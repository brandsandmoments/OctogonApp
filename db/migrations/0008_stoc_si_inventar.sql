-- Stocul de materii prime și accesorii: intrări, rezervări, consum, inventar.
--
-- Aceeași idee ca la recepția produselor finite: stocul nu e o coloană care se
-- actualizează, e suma unei fișe de magazie. Fiecare intrare de la furnizor,
-- fiecare consum la croit, fiecare corecție de inventar e un rând, cu dată și
-- motiv. Un stoc greșit se poate explica rând cu rând; o celulă suprascrisă, nu.
--
-- Rezervarea nu se scrie nicăieri: se calculează din planificări. Cât timp o
-- planificare e activă, materialul pentru ce a rămas de croit din ea e rezervat.
-- Pe măsură ce croitul înregistrează bucățile croite, rezervarea scade singură.
-- Așa nu există „rezervare uitată" după ce lotul s-a croit de mult.

BEGIN;

-- ---------------------------------------------------------------- parametri
-- Valori care țin de felul în care lucrează firma, nu de cod: pierderile la
-- croit, defectele de material. În dashboard stau în TINTE!B17:B19.

CREATE TABLE parametru (
    firma_id   uuid NOT NULL REFERENCES firma(id),
    cheie      text NOT NULL,
    valoare    numeric NOT NULL,
    descriere  text,
    PRIMARY KEY (firma_id, cheie)
);

-- ---------------------------------------------------------------- fișa de magazie

CREATE TYPE tip_miscare AS ENUM ('intrare', 'consum_croit', 'ajustare_inventar', 'iesire', 'retur_furnizor');

CREATE TABLE inventar (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id    uuid NOT NULL REFERENCES firma(id),
    data        date NOT NULL DEFAULT CURRENT_DATE,
    descriere   text,
    deschis_la  timestamptz NOT NULL DEFAULT now(),
    inchis_la   timestamptz,
    inchis_de   uuid NULL REFERENCES utilizator(id)
);

CREATE TABLE inventar_linie (
    firma_id          uuid NOT NULL REFERENCES firma(id),
    inventar_id       uuid NOT NULL REFERENCES inventar(id) ON DELETE CASCADE,
    material_id       uuid NOT NULL REFERENCES material(id),
    cantitate_numarata numeric(12,3) NOT NULL CHECK (cantitate_numarata >= 0),
    stoc_scriptic     numeric(12,3),          -- completat la închidere: ce arăta fișa atunci
    numarat_la        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (inventar_id, material_id)
);

CREATE TABLE miscare_stoc (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id     uuid NOT NULL REFERENCES firma(id),
    material_id  uuid NOT NULL REFERENCES material(id),
    tip          tip_miscare NOT NULL,
    cantitate    numeric(12,3) NOT NULL CHECK (cantitate <> 0),  -- cu semn: + intră, − iese
    data         date NOT NULL DEFAULT CURRENT_DATE,
    furnizor     text,
    document     text,                    -- factură, aviz, NIR
    pret_unitar  numeric(10,2) CHECK (pret_unitar >= 0),
    lot_id       uuid NULL REFERENCES lot_croit(id) ON DELETE RESTRICT,
    inventar_id  uuid NULL REFERENCES inventar(id) ON DELETE RESTRICT,
    observatii   text,
    creat_de     uuid NULL REFERENCES utilizator(id),
    creat_la     timestamptz NOT NULL DEFAULT now(),

    -- Semnul ține de tip: o intrare care scade stocul e o greșeală de tastare,
    -- nu o operațiune. Ajustarea de inventar poate merge în ambele sensuri.
    CONSTRAINT miscare_stoc_semn CHECK (CASE tip
             WHEN 'intrare'           THEN cantitate > 0
             WHEN 'consum_croit'      THEN cantitate < 0
             WHEN 'iesire'            THEN cantitate < 0
             WHEN 'retur_furnizor'    THEN cantitate < 0
             WHEN 'ajustare_inventar' THEN true
           END),
    -- Fiecare tip își poartă documentul: consumul spune lotul, ajustarea spune
    -- inventarul. Altfel fișa de magazie are rânduri pe care nu le poate explica.
    CONSTRAINT miscare_stoc_consum_cu_lot CHECK (tip <> 'consum_croit' OR lot_id IS NOT NULL),
    CONSTRAINT miscare_stoc_ajustare_cu_inventar CHECK (tip <> 'ajustare_inventar' OR inventar_id IS NOT NULL)
);

CREATE INDEX ON miscare_stoc (firma_id, material_id, data);
CREATE INDEX ON miscare_stoc (lot_id) WHERE lot_id IS NOT NULL;

-- ---------------------------------------------------------------- vederi

-- Stocul scriptic: suma fișei.
CREATE VIEW stoc_material WITH (security_invoker = true) AS
SELECT m.firma_id, m.id AS material_id, coalesce(sum(ms.cantitate), 0)::numeric(12,3) AS stoc
  FROM material m
  LEFT JOIN miscare_stoc ms ON ms.material_id = m.id
 GROUP BY m.firma_id, m.id;

-- Ce a rămas de croit din fiecare planificare activă, pe mărimi.
-- Planificat minus croit efectiv, din toate loturile planificării; niciodată sub zero.
CREATE VIEW planificare_rest_de_croit WITH (security_invoker = true) AS
SELECT pl.firma_id, pl.id AS planificare_id, pl.linie_id, pc.marime_id,
       pc.cantitate AS planificat,
       coalesce(cr.croit, 0)::int AS croit,
       greatest(pc.cantitate - coalesce(cr.croit, 0), 0)::int AS rest
  FROM planificare pl
  JOIN planificare_cantitate pc ON pc.planificare_id = pl.id
  LEFT JOIN (SELECT lc.planificare_id, le.marime_id, sum(le.cantitate) AS croit
               FROM lot_croit lc JOIN lot_croit_efectiv le ON le.lot_id = lc.id
              GROUP BY lc.planificare_id, le.marime_id) cr
         ON cr.planificare_id = pl.id AND cr.marime_id = pc.marime_id
 WHERE pl.stadiu IN ('blocat_materiale', 'gata_de_lansat', 'lansat_spre_croit', 'in_croit');

-- Rezervarea pe material, pe planificare: rest de croit × consumul din rețetă,
-- pe materialul ales pentru culoarea respectivă.
CREATE VIEW rezervare_material WITH (security_invoker = true) AS
SELECT r.firma_id, r.planificare_id, pm.material_id,
       sum(r.rest * mc.consum)::numeric(12,3) AS rezervat
  FROM planificare_rest_de_croit r
  JOIN comanda_linie cl     ON cl.id = r.linie_id
  JOIN produs_material pm   ON pm.produs_id = cl.produs_id
  JOIN model_componenta mc  ON mc.id = pm.componenta_id
 WHERE r.rest > 0
 GROUP BY r.firma_id, r.planificare_id, pm.material_id;

-- ---------------------------------------------------------------- izolare

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['parametru', 'inventar', 'inventar_linie', 'miscare_stoc']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON parametru, inventar, inventar_linie, miscare_stoc TO octogon_app;
GRANT SELECT ON stoc_material, planificare_rest_de_croit, rezervare_material TO octogon_app;

-- Fișa de magazie nu se rescrie: o greșeală se corectează cu o mișcare inversă,
-- care rămâne vizibilă. Aplicația poate adăuga rânduri, nu le poate schimba.
REVOKE UPDATE, DELETE ON miscare_stoc FROM octogon_app;

-- ---------------------------------------------------------------- traduceri

COMMENT ON TABLE  parametru IS 'Company operating parameters: loss percentages and the like. Data, not code.';
COMMENT ON COLUMN parametru.cheie     IS 'Parameter key';
COMMENT ON COLUMN parametru.valoare   IS 'Value; percentages as fractions (0.05 = 5%)';
COMMENT ON COLUMN parametru.descriere IS 'What the parameter means';

COMMENT ON TABLE  miscare_stoc IS 'Stock ledger for raw materials and accessories. Stock is the sum of this table, never a stored figure. Rows are append-only: mistakes are corrected with a reversing row.';
COMMENT ON COLUMN miscare_stoc.tip         IS 'Movement kind: intrare (receipt from supplier), consum_croit (used in cutting), ajustare_inventar (stock count correction), iesire (other issue), retur_furnizor (return to supplier)';
COMMENT ON COLUMN miscare_stoc.cantitate   IS 'Signed quantity in the material''s unit: positive in, negative out. The sign must match the kind.';
COMMENT ON COLUMN miscare_stoc.data        IS 'Movement date';
COMMENT ON COLUMN miscare_stoc.furnizor    IS 'Supplier, on receipts and returns';
COMMENT ON COLUMN miscare_stoc.document    IS 'Supporting document: invoice, delivery note, receiving report';
COMMENT ON COLUMN miscare_stoc.pret_unitar IS 'Unit price, RON, on receipts';
COMMENT ON COLUMN miscare_stoc.lot_id      IS 'Cutting batch that consumed it. Required on consumption.';
COMMENT ON COLUMN miscare_stoc.inventar_id IS 'Stock count that produced the adjustment. Required on adjustments.';
COMMENT ON COLUMN miscare_stoc.observatii  IS 'Notes';
COMMENT ON COLUMN miscare_stoc.creat_de    IS 'Recorded by';
COMMENT ON COLUMN miscare_stoc.creat_la    IS 'Recorded at';

COMMENT ON TABLE  inventar IS 'Physical stock count. Closing it writes the differences to the ledger as adjustments.';
COMMENT ON COLUMN inventar.data       IS 'Count date';
COMMENT ON COLUMN inventar.descriere  IS 'Description: full count, fabrics only';
COMMENT ON COLUMN inventar.deschis_la IS 'Opened at';
COMMENT ON COLUMN inventar.inchis_la  IS 'Closed at; once closed, the count is final';
COMMENT ON COLUMN inventar.inchis_de  IS 'Closed by';

COMMENT ON TABLE  inventar_linie IS 'One counted material in a stock count.';
COMMENT ON COLUMN inventar_linie.cantitate_numarata IS 'Quantity physically counted';
COMMENT ON COLUMN inventar_linie.stoc_scriptic      IS 'Book stock at closing time; the adjustment is counted minus this';
COMMENT ON COLUMN inventar_linie.numarat_la         IS 'Counted at';

COMMENT ON VIEW stoc_material             IS 'Book stock per material: the sum of its ledger.';
COMMENT ON VIEW planificare_rest_de_croit IS 'Per active planning batch and size: planned, cut so far, and what remains to cut.';
COMMENT ON VIEW rezervare_material        IS 'Material reserved by each active planning batch: remaining pieces to cut times recipe consumption. Falls as cutting is recorded.';

COMMIT;
