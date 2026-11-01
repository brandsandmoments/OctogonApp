-- O tranzacție fără REF (schimb valutar, debit direct) se salva de două ori la
-- reîncărcarea extrasului: în UNIQUE, două NULL-uri erau „diferite". Acum sunt egale.
--
-- Rulează ca proprietar, prin RLS: dublurile se caută în fiecare firmă, cu firma setată.
BEGIN;

DO $$ DECLARE f uuid; BEGIN
  FOR f IN SELECT id FROM firma LOOP
    PERFORM set_config('app.firma_id', f::text, true);
    DELETE FROM banca_tranzactie b
     WHERE EXISTS (SELECT 1 FROM banca_tranzactie x
                    WHERE x.firma_id = b.firma_id AND x.cont = b.cont AND x.zi = b.zi AND x.sens = b.sens AND x.suma = b.suma
                      AND x.ref IS NOT DISTINCT FROM b.ref AND (x.importat_la, x.id) < (b.importat_la, b.id));
  END LOOP;
END $$;

ALTER TABLE banca_tranzactie DROP CONSTRAINT banca_tranzactie_firma_id_cont_zi_ref_sens_suma_key;
ALTER TABLE banca_tranzactie ADD CONSTRAINT banca_tranzactie_unica UNIQUE NULLS NOT DISTINCT (firma_id, cont, zi, ref, sens, suma);

COMMIT;
