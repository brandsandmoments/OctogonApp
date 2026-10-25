-- Verifică purtarea structurii, nu doar că migrările rulează.
-- Se rulează ca proprietar (creează datele), apoi comută pe rolul aplicației.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

-- ---- date de pornire: două firme concurente
INSERT INTO firma (id, nume, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Octogon Fashion', 'octogon'),
  ('22222222-2222-2222-2222-222222222222', 'Alta Firma',      'alta');

INSERT INTO brand (id, firma_id, nume) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Parseea'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Altceva');

-- grile de mărimi diferite, ca să se vadă că nomenclatorul e date
INSERT INTO marime (id, firma_id, cod, ordine) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'M',  4),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '38', 2);

INSERT INTO produs (id, firma_id, cod_sku, denumire, brand_id) VALUES
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'PSA-SOPHIE-NEGRU', 'Rochie Sophie Negru', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'X-ALTCEVA', 'Produsul altcuiva', 'aaaaaaaa-0000-0000-0000-000000000002');

INSERT INTO comanda (id, firma_id, numar, tip, brand_id, data_lansare, stare) VALUES
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'psc-sep-26-1', 'PSC', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-09-26', 'lansata');

INSERT INTO comanda_linie (id, firma_id, comanda_id, produs_id, data_ceruta) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '2026-10-11');

INSERT INTO comanda_cantitate (firma_id, linie_id, marime_id, cantitate) VALUES
  ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001', 7);

INSERT INTO eticheta (id, firma_id, cod, linie_id, marime_id, pozitie) VALUES
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'OCT-7F3K2M9', 'eeeeeeee-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001', 4);

\echo '=== pregatire: 2 firme, 2 produse, 1 comanda cu 1 pozitie de 7 buc'

SET ROLE octogon_app;

\echo ''
\echo '--- 1. fara firma setata, aplicatia nu vede nimic (asteptat: 0)'
SELECT count(*) FROM produs;

\echo '--- 2. cu firma Octogon setata, vede doar produsele ei (asteptat: 1 | PSA-SOPHIE-NEGRU)'
SET app.firma_id = '11111111-1111-1111-1111-111111111111';
SELECT count(*) || ' | ' || coalesce(max(cod_sku), '-') FROM produs;

\echo '--- 3. comenzile altei firme sunt invizibile (asteptat: 0)'
SET app.firma_id = '22222222-2222-2222-2222-222222222222';
SELECT count(*) FROM comanda;

\echo '--- 4. nu poate scrie in contul altei firme (asteptat: EROARE de politica)'
SET app.firma_id = '11111111-1111-1111-1111-111111111111';
\set ON_ERROR_STOP off
INSERT INTO produs (firma_id, cod_sku, denumire, brand_id)
VALUES ('22222222-2222-2222-2222-222222222222', 'FURAT', 'Furat',
        'aaaaaaaa-0000-0000-0000-000000000002');

\echo '--- 5. lot de croit fara planificare (asteptat: EROARE, coloana NOT NULL)'
INSERT INTO lot_croit (firma_id, planificare_id)
VALUES ('11111111-1111-1111-1111-111111111111', NULL);

\echo '--- 6. stergerea unei comenzi cu linii in productie (asteptat: EROARE, RESTRICT)'
DELETE FROM comanda WHERE numar = 'psc-sep-26-1';

\echo '--- 7. acelasi cod de eticheta de doua ori (asteptat: EROARE, cod unic)'
INSERT INTO eticheta (firma_id, cod, linie_id, marime_id, pozitie)
VALUES ('11111111-1111-1111-1111-111111111111', 'OCT-7F3K2M9',
        'eeeeeeee-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 9);

\echo '--- 8. cantitate zero sau negativa la receptie (asteptat: EROARE, CHECK)'
INSERT INTO receptie (firma_id, eticheta_id, cantitate)
VALUES ('11111111-1111-1111-1111-111111111111', 'ffffffff-0000-0000-0000-000000000001', 0);
\set ON_ERROR_STOP on

\echo ''
\echo '--- 9. receptie partiala: 4 din 7, apoi progresul pe pozitie'
INSERT INTO receptie (firma_id, eticheta_id, cantitate)
VALUES ('11111111-1111-1111-1111-111111111111', 'ffffffff-0000-0000-0000-000000000001', 4);

SELECT c.numar || ' | ' || p.denumire || ' | marimea ' || m.cod
       || ' | cerut ' || cc.cantitate
       || ' | intrat ' || coalesce(sum(r.cantitate), 0)
       || ' | lipsesc ' || (cc.cantitate - coalesce(sum(r.cantitate), 0))
FROM comanda_cantitate cc
JOIN comanda_linie cl ON cl.id = cc.linie_id
JOIN comanda c        ON c.id  = cl.comanda_id
JOIN produs p         ON p.id  = cl.produs_id
JOIN marime m         ON m.id  = cc.marime_id
JOIN eticheta e       ON e.linie_id = cl.id AND e.marime_id = cc.marime_id
LEFT JOIN receptie r  ON r.eticheta_id = e.id
GROUP BY c.numar, p.denumire, m.cod, cc.cantitate;

\echo ''
\echo '--- 10. inchidere pe zero fara observatii (asteptat: EROARE, CHECK)'
INSERT INTO motiv (id, firma_id, cod, nume, contexte)
VALUES ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'extern_intarziere', 'Producator extern in intarziere', ARRAY['receptie']::context_motiv[]);
\set ON_ERROR_STOP off
INSERT INTO receptie (firma_id, eticheta_id, cantitate, motiv_id, inchide_pozitia)
VALUES ('11111111-1111-1111-1111-111111111111', 'ffffffff-0000-0000-0000-000000000001', 0,
        'dddddddd-0000-0000-0000-000000000001', true);
\set ON_ERROR_STOP on

\echo '--- 11. inchidere pe zero cu motiv si observatii (asteptat: INSERT 0 1)'
INSERT INTO receptie (firma_id, eticheta_id, cantitate, motiv_id, inchide_pozitia, observatii)
VALUES ('11111111-1111-1111-1111-111111111111', 'ffffffff-0000-0000-0000-000000000001', 0,
        'dddddddd-0000-0000-0000-000000000001', true, 'Atelierul a renuntat la rest');

\echo ''
\echo '--- 12. reteta pe model: Sophie consuma 2,1 m stofa si 6 nasturi pe bucata'
INSERT INTO model (id, firma_id, brand_id, cod, denumire) VALUES
  ('99999999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'sophie', 'Rochie Sophie');
UPDATE produs SET model_id = '99999999-0000-0000-0000-000000000001'
 WHERE id = 'cccccccc-0000-0000-0000-000000000001';
INSERT INTO model_componenta (id, firma_id, model_id, nume, tip, unitate, consum) VALUES
  ('99999999-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   '99999999-0000-0000-0000-000000000001', 'Stofa principala', 'materie_prima', 'm', 2.1),
  ('99999999-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111',
   '99999999-0000-0000-0000-000000000001', 'Nasture', 'accesoriu', 'buc', 6);
INSERT INTO material (id, firma_id, tip, cod, denumire, unitate) VALUES
  ('99999999-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'materie_prima', 'JRS-NEG', 'Jerseu negru', 'm'),
  ('99999999-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'accesoriu', 'NST-NEG', 'Nasture negru 12mm', 'buc');
INSERT INTO produs_material (firma_id, produs_id, model_id, componenta_id, material_id, tip, unitate) VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-0000000000c1',
   '99999999-0000-0000-0000-0000000000a1', 'materie_prima', 'm');

\echo '--- 13. nasture pus in locul stofei (asteptat: EROARE, cheie compusa tip/unitate)'
\set ON_ERROR_STOP off
INSERT INTO produs_material (firma_id, produs_id, model_id, componenta_id, material_id, tip, unitate) VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-0000000000c2',
   '99999999-0000-0000-0000-0000000000a1', 'accesoriu', 'buc');
\set ON_ERROR_STOP on

\echo '--- 14. necesarul comenzii: 7 buc x 2,1 m = 14,7 m; nasturii fara material raman vizibili'
SELECT componenta || ' | ' || coalesce(material_id::text, 'MATERIAL NEALOCAT')
       || ' | ' || bucati || ' buc x ' || consum || ' = ' || necesar || ' ' || unitate
  FROM necesar_comanda WHERE comanda = 'psc-sep-26-1' ORDER BY componenta DESC;

\echo ''
\echo '--- 15. intrare cu cantitate negativa (asteptat: EROARE, semnul tine de tip)'
\set ON_ERROR_STOP off
INSERT INTO miscare_stoc (firma_id, material_id, tip, cantitate)
VALUES ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-0000000000a1', 'intrare', -5);

\echo '--- 16. consum fara lot de croit (asteptat: EROARE, consumul spune lotul)'
INSERT INTO miscare_stoc (firma_id, material_id, tip, cantitate)
VALUES ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-0000000000a1', 'consum_croit', -5);
\set ON_ERROR_STOP on

\echo '--- 17. intrare de 100 m jerseu, apoi fisa nu se poate rescrie (asteptat: EROARE de permisiune)'
INSERT INTO miscare_stoc (id, firma_id, material_id, tip, cantitate, furnizor, document) VALUES
  ('99999999-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111',
   '99999999-0000-0000-0000-0000000000a1', 'intrare', 100, 'Textila SRL', 'FCT 123');
\set ON_ERROR_STOP off
UPDATE miscare_stoc SET cantitate = 1000 WHERE id = '99999999-0000-0000-0000-0000000000f1';
\set ON_ERROR_STOP on

\echo '--- 18. planificare de 7 buc M: rezervat 7 x 2,1 = 14,7 m'
INSERT INTO planificare (id, firma_id, linie_id, numar_transa, stadiu) VALUES
  ('99999999-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-0000-0000-0000-000000000001', 1, 'gata_de_lansat');
INSERT INTO planificare_cantitate (firma_id, planificare_id, marime_id, cantitate) VALUES
  ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-0000000000b1',
   'bbbbbbbb-0000-0000-0000-000000000001', 7);
SELECT 'stoc ' || s.stoc || ' | rezervat ' || coalesce(r.rezervat, 0) || ' | disponibil ' || (s.stoc - coalesce(r.rezervat, 0))
  FROM stoc_material s LEFT JOIN rezervare_material r ON r.material_id = s.material_id
 WHERE s.material_id = '99999999-0000-0000-0000-0000000000a1';

\echo '--- 19. croite 4 din 7, consumate 8,6 m: stoc 91,4, rezervat 3 x 2,1 = 6,3'
UPDATE planificare SET stadiu = 'in_croit' WHERE id = '99999999-0000-0000-0000-0000000000b1';
INSERT INTO lot_croit (id, firma_id, planificare_id) VALUES
  ('99999999-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
   '99999999-0000-0000-0000-0000000000b1');
INSERT INTO lot_croit_efectiv (firma_id, lot_id, marime_id, cantitate) VALUES
  ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-0000000000d1',
   'bbbbbbbb-0000-0000-0000-000000000001', 4);
INSERT INTO miscare_stoc (firma_id, material_id, tip, cantitate, lot_id) VALUES
  ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-0000000000a1',
   'consum_croit', -8.6, '99999999-0000-0000-0000-0000000000d1');
SELECT 'stoc ' || s.stoc || ' | rezervat ' || coalesce(r.rezervat, 0) || ' | disponibil ' || (s.stoc - coalesce(r.rezervat, 0))
  FROM stoc_material s LEFT JOIN rezervare_material r ON r.material_id = s.material_id
 WHERE s.material_id = '99999999-0000-0000-0000-0000000000a1';

\echo ''
\echo '=== gata'
