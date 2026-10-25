-- Denumirea numerică a mărimilor, și lista de motive.
--
-- 2XS = 32, XS = 34, S = 36, M = 38, L = 40, XL = 42, 2XL = 44, din 2 în 2.
-- Nu e altă mărime, e alt nume pentru aceeași mărime: pe etichetă apare numărul,
-- în PSF apare litera, iar un magazin partener poate cere numărul. Dacă ar fi
-- rânduri separate, 7 mărimi ar deveni 14 și fiecare cantitate s-ar împărți în două.

BEGIN;

ALTER TABLE marime ADD COLUMN cod_numeric text;
ALTER TABLE marime ADD CONSTRAINT marime_cod_numeric_unic UNIQUE (firma_id, cod_numeric);

COMMENT ON COLUMN marime.cod      IS 'denumirea principală, cea din comenzi: XXS, M, 2XL';
COMMENT ON COLUMN marime.cod_numeric IS 'denumirea numerică EU, pentru etichete și parteneri: 32, 38, 44';

-- ---------------------------------------------------------------- motive
-- Azi, coloana de motiv din CROIT are patru variante pentru trei motive reale:
-- „Material insuficient", „MATERIAL INSUFICIENT" și două celule cu un spațiu gol.
-- La 1.660 de poziții, text liber înseamnă că nu poți număra nimic — iar numărarea
-- e tot scopul: „câte bucăți am pierdut anul ăsta din material insuficient?"

CREATE TYPE context_motiv AS ENUM ('croit', 'receptie');

CREATE TABLE motiv (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id     uuid NOT NULL REFERENCES firma(id),
    cod          text NOT NULL,
    nume         text NOT NULL,
    contexte     context_motiv[] NOT NULL DEFAULT '{}',
    activ        bool NOT NULL DEFAULT true,
    UNIQUE (firma_id, cod)
);

ALTER TABLE lot_croit_efectiv
    ADD CONSTRAINT lot_croit_efectiv_motiv_fkey FOREIGN KEY (motiv_id) REFERENCES motiv(id);

ALTER TABLE receptie
    ADD CONSTRAINT receptie_motiv_fkey FOREIGN KEY (motiv_id) REFERENCES motiv(id);

-- O recepție care închide poziția sub cantitate trebuie să spună de ce.
-- Momentul ăsta e singurul în care omul care primește marfa încă știe motivul.
ALTER TABLE receptie
    ADD CONSTRAINT receptie_inchidere_cu_motiv
    CHECK (NOT inchide_pozitia OR motiv_id IS NOT NULL);

ALTER TABLE motiv ENABLE ROW LEVEL SECURITY;
ALTER TABLE motiv FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON motiv
    USING (firma_id = firma_curenta())
    WITH CHECK (firma_id = firma_curenta());

GRANT SELECT, INSERT, UPDATE, DELETE ON motiv TO octogon_app;

COMMIT;
