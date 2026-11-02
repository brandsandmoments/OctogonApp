-- Taierea poartă numele comenzii: psf-ps-oct-68/T1, /T2 — a câta oară se taie din
-- PSF-ul sau PSC-ul acela până se termină croitul lui. Numărătoarea pornește de la 1
-- la fiecare comandă. O taiere cu mai multe comenzi (același model) poartă numele
-- celei cu cele mai multe bucăți.
BEGIN;

CREATE FUNCTION cod_taiere(p_taiere uuid) RETURNS text LANGUAGE sql STABLE AS $$
  WITH t AS (
      SELECT coalesce(trimis_la, creat_la) AS la, numar FROM taiere WHERE id = p_taiere),
  principala AS (
      SELECT c.id, c.numar
        FROM lot_croit lc
        JOIN planificare pl   ON pl.id = lc.planificare_id
        JOIN comanda_linie cl ON cl.id = pl.linie_id
        JOIN comanda c        ON c.id = cl.comanda_id
        LEFT JOIN lot_croit_cantitate lq ON lq.lot_id = lc.id
       WHERE lc.taiere_id = p_taiere
       GROUP BY c.id, c.numar
       ORDER BY sum(lq.cantitate) DESC NULLS LAST, c.numar
       LIMIT 1)
  SELECT p.numar || '/T' || greatest(
           -- a câta taiere cu bucăți din comanda asta (ea și cele de dinainte)
           (SELECT count(DISTINCT x.id) FROM taiere x
              JOIN lot_croit lc     ON lc.taiere_id = x.id
              JOIN planificare pl   ON pl.id = lc.planificare_id
              JOIN comanda_linie cl ON cl.id = pl.linie_id
             WHERE cl.comanda_id = p.id
               AND (coalesce(x.trimis_la, x.creat_la), x.numar) <= (t.la, t.numar)),
           -- și niciodată un nume deja dat
           (SELECT coalesce(max(substr(x.cod, length(p.numar) + 3)::int), 0) + 1 FROM taiere x
             WHERE x.id <> p_taiere AND x.cod LIKE p.numar || '/T%' AND substr(x.cod, length(p.numar) + 3) ~ '^[0-9]+$'))
    FROM t, principala p
$$;
GRANT EXECUTE ON FUNCTION cod_taiere(uuid) TO octogon_app;
COMMENT ON FUNCTION cod_taiere(uuid) IS 'Cutting session name: the order with most pieces in it, plus /T and how many sessions that order has had so far';

-- Taierile de până acum, în ordinea în care s-au făcut.
DO $$ DECLARE f uuid; t record; BEGIN
  FOR f IN SELECT id FROM firma LOOP
    PERFORM set_config('app.firma_id', f::text, true);
    FOR t IN SELECT id FROM taiere ORDER BY coalesce(trimis_la, creat_la), numar LOOP
      UPDATE taiere SET cod = coalesce(cod_taiere(t.id), cod) WHERE id = t.id;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
