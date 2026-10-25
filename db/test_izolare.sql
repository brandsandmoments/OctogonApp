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
\echo '=== gata'
