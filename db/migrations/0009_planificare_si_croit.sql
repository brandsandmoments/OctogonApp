-- Planificarea și croitul: ce intră în producție, ce primește croitul, ce s-a croit.
--
-- Lanțul e cel din dashboard: comanda → planificarea (…/P1) → lotul de croit
-- (…/P1/C1). Ce adaugă structura:
--
-- - Lotul știe ce i s-a cerut. Până acum lot_croit avea doar ce s-a croit efectiv;
--   „cerut 35, croit 33, diferență 2" avea nevoie de o coloană care nu exista.
-- - Lotul știe când s-a croit. Fără croit_la, „ce e de croit" și „ce s-a croit"
--   nu se pot despărți decât ghicind după cantități.
-- - Planificarea se poate încheia. Fără asta, o planificare croită incomplet
--   („material insuficient, restul nu mai vine") rămânea activă și își ținea
--   rezervarea de material la nesfârșit.

-- 'incheiat' nu e în lista stadiilor active din rezervare_material și
-- planificare_rest_de_croit (0008), deci încheierea eliberează rezervarea.
-- Stă înaintea tranzacției: o valoare nouă de enum nu poate fi folosită în
-- tranzacția care a adăugat-o, iar vederea de mai jos o folosește.
ALTER TYPE stadiu_planificare ADD VALUE IF NOT EXISTS 'incheiat';

BEGIN;

ALTER TABLE planificare ADD COLUMN incheiat_la timestamptz;
ALTER TABLE planificare ADD COLUMN motiv_incheiere_id uuid NULL REFERENCES motiv(id);

-- Ce i s-a cerut lotului, pe mărimi: restul de croit al planificării în clipa
-- lansării. Rămâne neschimbat după aceea — e referința față de care se măsoară
-- ce a croit croitul.
CREATE TABLE lot_croit_cantitate (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id   uuid NOT NULL REFERENCES firma(id),
    lot_id     uuid NOT NULL REFERENCES lot_croit(id) ON DELETE CASCADE,
    marime_id  uuid NOT NULL REFERENCES marime(id),
    cantitate  int  NOT NULL CHECK (cantitate > 0),
    UNIQUE (lot_id, marime_id)
);

ALTER TABLE lot_croit ADD COLUMN croit_la timestamptz;
ALTER TABLE lot_croit ADD COLUMN croit_de uuid NULL REFERENCES utilizator(id);

CREATE INDEX ON lot_croit (firma_id, croit_la);

ALTER TABLE lot_croit_cantitate ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_croit_cantitate FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON lot_croit_cantitate
    USING (firma_id = firma_curenta())
    WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON lot_croit_cantitate TO octogon_app;

COMMENT ON TABLE  lot_croit_cantitate IS 'What a cutting batch was asked to cut, per size: the planning batch''s remaining pieces at release time. Fixed afterwards; the cut quantities are measured against it.';
COMMENT ON COLUMN lot_croit_cantitate.firma_id  IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN lot_croit_cantitate.cantitate IS 'Pieces asked of the cutting room';
COMMENT ON COLUMN lot_croit.croit_la            IS 'When the cut was recorded. Null means still to cut.';
COMMENT ON COLUMN lot_croit.croit_de            IS 'Who recorded the cut';
COMMENT ON COLUMN planificare.incheiat_la       IS 'When the planning batch was closed: fully cut, or closed short. Closing releases its material reservation.';
COMMENT ON COLUMN planificare.motiv_incheiere_id IS 'Reason, when closed with pieces left uncut';
COMMENT ON COLUMN planificare.stadiu IS 'Stage: fara_cantitate (nothing planned), blocat_materiale (blocked, missing materials), gata_de_lansat (ready to release), lansat_spre_croit (released to cutting), in_croit (in cutting), incheiat (closed), anulat (cancelled)';

-- Cât acoperă planificările dintr-o poziție, pe mărimi. O planificare activă
-- contează cu ce a planificat; una încheiată, doar cu ce a croit efectiv — restul
-- nu se mai croiește din ea, deci comanda îl cere din nou și redevine de planificat.
-- Anulatele nu contează deloc. Aceeași regulă în planificare, stoc și centralizator.
CREATE VIEW planificat_pe_pozitie WITH (security_invoker = true) AS
SELECT pl.firma_id, pl.linie_id, pc.marime_id,
       sum(CASE WHEN pl.stadiu = 'incheiat'
                THEN coalesce((SELECT sum(le.cantitate) FROM lot_croit lc
                                 JOIN lot_croit_efectiv le ON le.lot_id = lc.id
                                WHERE lc.planificare_id = pl.id AND le.marime_id = pc.marime_id), 0)
                ELSE pc.cantitate END)::int AS cantitate
  FROM planificare pl
  JOIN planificare_cantitate pc ON pc.planificare_id = pl.id
 WHERE pl.stadiu <> 'anulat'
 GROUP BY pl.firma_id, pl.linie_id, pc.marime_id;

GRANT SELECT ON planificat_pe_pozitie TO octogon_app;
COMMENT ON VIEW planificat_pe_pozitie IS 'Pieces covered by planning per order line and size: planned for active batches, actually cut for closed ones. What remains is still to plan.';

COMMIT;
