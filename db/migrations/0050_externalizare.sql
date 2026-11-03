-- Comenzi date în producție la externalizare: numele atelierului de afară și când a fost
-- dată. Cine calcă și cine controlează rămân în alocare_comanda (fazele „Călcat", „Control").
BEGIN;

ALTER TABLE comanda ADD COLUMN externalizare text NULL CHECK (externalizare IS NULL OR btrim(externalizare) <> '');
ALTER TABLE comanda ADD COLUMN externalizata_la timestamptz NULL;
COMMENT ON COLUMN comanda.externalizare IS 'Name of the outside workshop the order was given to for production; NULL when made in-house';
COMMENT ON COLUMN comanda.externalizata_la IS 'When the order was given to the outside workshop';

COMMIT;
