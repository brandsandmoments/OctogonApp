-- Închiderea unei poziții fără nicio bucată în scanarea respectivă.
--
-- „N-a mai venit nimic, nu mai vine" e o recepție legitimă: poziția trebuie să se
-- închidă, iar motivul are nevoie de un rând pe care să stea. Până acum
-- `cantitate > 0` o refuza, iar poziția rămânea deschisă la nesfârșit.
--
-- Zero bucăți se acceptă doar când rândul închide poziția și spune, cu vorbele
-- omului, ce s-a întâmplat. Fără închidere, un zero e o scanare greșită, nu o
-- recepție. Motivul din listă rămâne obligatoriu la orice închidere (vezi 0003);
-- observațiile se adaugă pentru că un zero e cazul în care lista nu ajunge.

BEGIN;

ALTER TABLE receptie DROP CONSTRAINT receptie_cantitate_check;

ALTER TABLE receptie
    ADD CONSTRAINT receptie_cantitate_check
    CHECK (
        cantitate > 0
        OR (cantitate = 0 AND inchide_pozitia AND nullif(btrim(observatii), '') IS NOT NULL)
    );

COMMENT ON COLUMN receptie.cantitate  IS 'Pieces received in this scan. Zero only when the row closes the position and carries notes.';
COMMENT ON COLUMN receptie.observatii IS 'Notes. Required when the position is closed with zero pieces.';

COMMIT;
