-- PSF-urile date de KAM-i trec printr-o aprobare: un responsabil (dreptul „aprobare",
-- dat din Oameni și conturi) le aprobă — și atunci se lansează — sau le respinge, cu
-- motiv. Până atunci stau „de aprobat": nu intră în producție, în depozit sau în
-- țintele KAM.
--
-- Valoarea nouă a enum-ului se adaugă înainte de tranzacție: Postgres nu lasă o
-- valoare nouă să fie folosită în aceeași tranzacție în care a fost adăugată.
ALTER TYPE stare_comanda ADD VALUE IF NOT EXISTS 'de_aprobat' AFTER 'ciorna';

BEGIN;

ALTER TABLE comanda
    ADD COLUMN aprobata_de      uuid NULL REFERENCES utilizator(id),
    ADD COLUMN aprobata_la      timestamptz NULL,
    ADD COLUMN motiv_respingere text NULL;
COMMENT ON COLUMN comanda.stare IS 'State: ciorna (draft), de_aprobat (awaiting approval), lansata (launched), in_productie (in production), inchisa (closed), anulata (cancelled or rejected)';
COMMENT ON COLUMN comanda.aprobata_de IS 'Who approved or rejected a KAM PSF';
COMMENT ON COLUMN comanda.aprobata_la IS 'When it was approved or rejected';
COMMENT ON COLUMN comanda.motiv_respingere IS 'Why the PSF was rejected; set only on rejection';

-- Zona nouă de drepturi: „aprobare".
DO $$ DECLARE n text; BEGIN
  SELECT conname INTO n FROM pg_constraint WHERE conrelid = 'drept'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%zona%';
  EXECUTE format('ALTER TABLE drept DROP CONSTRAINT %I', n);
END $$;
ALTER TABLE drept ADD CONSTRAINT drept_zona_check CHECK (zona IN (
    'comenzi', 'centralizator', 'kam', 'necesar', 'planificare', 'croit',
    'banda', 'receptie', 'materiale', 'dezvoltare', 'expediere', 'aprobare'));

-- Țintele KAM: un PSF neaprobat încă nu e o promisiune.
CREATE OR REPLACE VIEW psf_tinta_zilnica WITH (security_invoker = true) AS
SELECT c.firma_id, cl.id AS linie_id, c.id AS comanda_id, c.kam_id, cl.produs_id,
       z.zi::date AS zi,
       t.volum::numeric / (cl.vanzare_pana_la - cl.vanzare_de_la + 1) AS tinta
  FROM comanda c
  JOIN comanda_linie cl ON cl.comanda_id = c.id
  JOIN LATERAL (SELECT sum(cantitate) AS volum FROM comanda_cantitate WHERE linie_id = cl.id) t ON true
  CROSS JOIN LATERAL generate_series(cl.vanzare_de_la, cl.vanzare_pana_la, interval '1 day') z(zi)
 WHERE c.tip = 'PSF' AND c.stare NOT IN ('anulata', 'de_aprobat')
   AND cl.vanzare_de_la IS NOT NULL AND cl.vanzare_pana_la IS NOT NULL;

COMMIT;
