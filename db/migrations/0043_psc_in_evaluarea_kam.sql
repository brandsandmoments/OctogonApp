-- Și PSC-urile au perioada în care KAM-ul estimează că se vinde stocul cerut; cele cu
-- KAM intră în evaluarea lui alături de PSF-uri: ținta zilnică și vânzările împărțite.
BEGIN;
CREATE OR REPLACE VIEW psf_tinta_zilnica WITH (security_invoker = true) AS
SELECT c.firma_id, cl.id AS linie_id, c.id AS comanda_id, c.kam_id, cl.produs_id,
       z.zi::date AS zi,
       t.volum::numeric / (cl.vanzare_pana_la - cl.vanzare_de_la + 1) AS tinta
  FROM comanda c
  JOIN comanda_linie cl ON cl.comanda_id = c.id
  JOIN LATERAL (SELECT sum(cantitate) AS volum FROM comanda_cantitate WHERE linie_id = cl.id) t ON true
  CROSS JOIN LATERAL generate_series(cl.vanzare_de_la, cl.vanzare_pana_la, interval '1 day') z(zi)
 WHERE c.tip IN ('PSF', 'PSC') AND c.kam_id IS NOT NULL AND c.stare NOT IN ('anulata', 'de_aprobat')
   AND cl.vanzare_de_la IS NOT NULL AND cl.vanzare_pana_la IS NOT NULL;
COMMENT ON VIEW psf_tinta_zilnica IS 'Per PSF/PSC line with a KAM and day of its selling period: pieces it was expected to sell that day (volume spread evenly).';
COMMIT;
