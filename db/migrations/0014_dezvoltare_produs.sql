-- Dezvoltarea de produs: de la tiparul de făcut până la mostra aprobată.
--
-- Înlocuiește „Situație Tipare". Acolo statusul se scria de mână lângă bifele
-- TIPAR / MOSTRA / FIȘĂ / APROBAT și se contrazicea cu ele: rânduri „Gata" cu toate
-- bifele goale, un rezumat cu 4 tipare gata și altul cu 0. Aici drumul unui model e
-- un jurnal de pași — început, probă, corecturi, tipar gata, mostră gata, fișă,
-- aprobat —, fiecare cu data și omul lui, iar statusul se calculează din pași. Nu
-- se poate contrazice, și fiecare rundă de corecturi rămâne în istoric.
--
-- Mostra o aprobă KAM-ul care a cerut-o. La aprobare, modelul intră în catalog cu
-- culorile lui (0006: model, produs), gata de rețetă — ca să nu mai apară modele
-- în producție fără fișă.

BEGIN;

CREATE TYPE tip_lucrare AS ENUM ('tipar_nou', 'modificare_tipar', 'gradare_marimi', 'variatie_model');
CREATE TYPE pas_dezvoltare AS ENUM (
    'inceput', 'proba', 'corecturi', 'tipar_gata', 'mostra_gata', 'fisa_gata', 'aprobat', 'anulat');

CREATE TABLE dezvoltare (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    brand_id       uuid NOT NULL REFERENCES brand(id),
    model          text NOT NULL,                 -- 'Melissa'
    culori         text[] NOT NULL DEFAULT '{}',  -- cum le cere marketingul: 'Negru cu Corset Gri'
    categorie_id   uuid NULL REFERENCES categorie(id),
    tip            tip_lucrare NOT NULL DEFAULT 'tipar_nou',
    marime_de_la   uuid NULL REFERENCES marime(id),
    marime_pana_la uuid NULL REFERENCES marime(id),
    prioritate     int  NOT NULL DEFAULT 3 CHECK (prioritate BETWEEN 1 AND 5),
    termen         date,
    kam_id         uuid NULL REFERENCES utilizator(id),   -- cine a cerut-o și cine aprobă mostra
    link_poze      text,
    link_fisa      text,
    observatii     text,
    model_id       uuid NULL REFERENCES model(id),        -- modelul din catalog, după aprobare
    creat_de       uuid NULL REFERENCES utilizator(id) DEFAULT utilizator_curent(),
    creat_la       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (firma_id, brand_id, model)
);

CREATE TABLE dezvoltare_pas (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    dezvoltare_id  uuid NOT NULL REFERENCES dezvoltare(id) ON DELETE CASCADE,
    pas            pas_dezvoltare NOT NULL,
    la             timestamptz NOT NULL DEFAULT now(),
    de             uuid NULL REFERENCES utilizator(id) DEFAULT utilizator_curent(),
    observatii     text,
    -- Corecturile au nevoie de un motiv: altfel tiparistul nu știe ce să schimbe.
    CHECK (pas <> 'corecturi' OR nullif(btrim(observatii), '') IS NOT NULL)
);
CREATE INDEX ON dezvoltare_pas (dezvoltare_id, la);

-- Statusul, din pași. Ordinea contează: aprobat și anulat închid drumul; mostra e
-- „de aprobat" doar dacă după ea n-au venit corecturi; altfel contează ultimul pas
-- de lucru. Cât timp nu există niciun pas, tiparul e de făcut.
CREATE VIEW dezvoltare_stare WITH (security_invoker = true) AS
SELECT d.id AS dezvoltare_id, d.firma_id,
       CASE
         WHEN bool_or(p.pas = 'anulat')  THEN 'anulat'
         WHEN bool_or(p.pas = 'aprobat') THEN 'aprobat'
         WHEN max(p.la) FILTER (WHERE p.pas = 'mostra_gata')
              > coalesce(max(p.la) FILTER (WHERE p.pas = 'corecturi'), '-infinity') THEN 'mostra_gata'
         WHEN count(p.id) = 0 THEN 'de_facut'
         ELSE (array_agg(p.pas::text ORDER BY p.la DESC)
                 FILTER (WHERE p.pas IN ('inceput', 'proba', 'corecturi', 'tipar_gata')))[1]
       END AS stare,
       bool_or(p.pas = 'tipar_gata') AS tipar_gata,
       max(p.la) FILTER (WHERE p.pas = 'mostra_gata')
         > coalesce(max(p.la) FILTER (WHERE p.pas = 'corecturi'), '-infinity') AS mostra_gata,
       bool_or(p.pas = 'fisa_gata') AS fisa_gata,
       max(p.la) AS ultimul_pas_la
  FROM dezvoltare d LEFT JOIN dezvoltare_pas p ON p.dezvoltare_id = d.id
 GROUP BY d.id, d.firma_id;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['dezvoltare', 'dezvoltare_pas']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON dezvoltare, dezvoltare_pas TO octogon_app;
-- Jurnalul de pași nu se rescrie: o greșeală se corectează cu un pas nou.
REVOKE UPDATE, DELETE ON dezvoltare_pas FROM octogon_app;
GRANT SELECT ON dezvoltare_stare TO octogon_app;

COMMENT ON TABLE  dezvoltare IS 'A model in development: pattern to make, sample, approval. Replaces the Situatie Tipare sheet.';
COMMENT ON COLUMN dezvoltare.model          IS 'Model name';
COMMENT ON COLUMN dezvoltare.culori         IS 'Colours requested, as marketing wrote them';
COMMENT ON COLUMN dezvoltare.tip            IS 'Kind of work: new pattern, pattern change, size grading, model variation';
COMMENT ON COLUMN dezvoltare.marime_de_la   IS 'Smallest size to grade';
COMMENT ON COLUMN dezvoltare.marime_pana_la IS 'Largest size to grade';
COMMENT ON COLUMN dezvoltare.prioritate     IS 'Priority, 1 urgent to 5 lowest';
COMMENT ON COLUMN dezvoltare.termen         IS 'Deadline';
COMMENT ON COLUMN dezvoltare.kam_id         IS 'KAM who asked for it; approves the sample';
COMMENT ON COLUMN dezvoltare.link_poze      IS 'Drive folder with photos';
COMMENT ON COLUMN dezvoltare.link_fisa      IS 'Product sheet';
COMMENT ON COLUMN dezvoltare.observatii     IS 'Notes';
COMMENT ON COLUMN dezvoltare.model_id       IS 'Catalogue model created on approval';
COMMENT ON COLUMN dezvoltare.creat_de       IS 'Created by';
COMMENT ON COLUMN dezvoltare.creat_la       IS 'Created at';
COMMENT ON TABLE  dezvoltare_pas IS 'Step log of a model in development. Append-only; the status is derived from it.';
COMMENT ON COLUMN dezvoltare_pas.pas        IS 'Step: inceput (started), proba (fitting), corecturi (corrections, with reason), tipar_gata (pattern done), mostra_gata (sample done), fisa_gata (product sheet done), aprobat (approved by the KAM), anulat (cancelled)';
COMMENT ON COLUMN dezvoltare_pas.la         IS 'When';
COMMENT ON COLUMN dezvoltare_pas.de         IS 'By whom';
COMMENT ON COLUMN dezvoltare_pas.observatii IS 'Notes; required for corrections';
COMMENT ON VIEW   dezvoltare_stare IS 'Current status of each model in development, derived from its steps.';

COMMIT;
