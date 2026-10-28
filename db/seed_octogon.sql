-- Nomenclatoarele Octogon Fashion, luate din Dashboard_OCTOGON (fila NOM_LISTE).
-- Se poate rula de mai multe ori: nu suprascrie nimic.

BEGIN;

INSERT INTO firma (id, nume, slug) VALUES
  ('0c706000-0000-4000-8000-000000000001', 'Octogon Fashion', 'octogon')
ON CONFLICT (slug) DO NOTHING;

DO $seed$
DECLARE
    f uuid := '0c706000-0000-4000-8000-000000000001';
    r record;
BEGIN

-- ---- branduri
INSERT INTO brand (firma_id, nume)
SELECT f, x FROM unnest(ARRAY['Parseea', 'Maison Loulou', 'Sleevy']) x
ON CONFLICT (firma_id, nume) DO NOTHING;

-- ---- mărimi, cu denumirea numerică EU alături
FOR r IN SELECT * FROM (VALUES
    ('XXS', 1, '32'), ('XS', 2, '34'), ('S', 3, '36'), ('M', 4, '38'),
    ('L', 5, '40'),   ('XL', 6, '42'), ('2XL', 7, '44')
) AS v(cod, ordine, numeric_)
LOOP
    INSERT INTO marime (firma_id, cod, ordine, cod_numeric)
    VALUES (f, r.cod, r.ordine, r.numeric_)
    ON CONFLICT (firma_id, cod) DO UPDATE SET cod_numeric = EXCLUDED.cod_numeric;
END LOOP;

-- ---- aliasuri: cum scriu alte sisteme aceleași mărimi
--      Sleevy scrie 2XS unde noi scriem XXS, și unele magazine scriu XXL în loc de 2XL.
FOR r IN SELECT * FROM (VALUES
    ('XXS', 'shopify', '2XS'),
    ('2XL', 'shopify', 'XXL'),
    ('XXS', 'partener', '32'), ('XS', 'partener', '34'), ('S', 'partener', '36'),
    ('M',   'partener', '38'), ('L',  'partener', '40'), ('XL', 'partener', '42'),
    ('2XL', 'partener', '44')
) AS v(cod, sursa, alias)
LOOP
    INSERT INTO marime_alias (firma_id, marime_id, sursa, alias)
    SELECT f, m.id, r.sursa, r.alias FROM marime m WHERE m.firma_id = f AND m.cod = r.cod
    ON CONFLICT (firma_id, sursa, alias) DO NOTHING;
END LOOP;

-- ---- culori (NOM_LISTE coloana AC, 44 de valori)
INSERT INTO culoare (firma_id, nume)
SELECT f, x FROM unnest(ARRAY[
    'Alb','Albastru','Albastru Electric','Aramiu','Argintiu','Auriu','Baby Blue',
    'Baby Green','Baby Pink','Baby Yellow','Bleu','Burgundy','Cappuccino','Copper',
    'Crem','Ecru','Fistic','Fuchsia','Fucsia','Galben','Gri','Gri Deschis',
    'Gri Inchis','Ivoire','Ivory','Latte Rose','Lila','Maro','Mint','Mocha Mousse',
    'Mov','Navy','Negru','Ocru','Olive','Plum','Rosu','Roz','Roz Prafuit',
    'Sage Green','Turcoaz','Verde','Verde Marin','Visiniu'
]) x
ON CONFLICT (firma_id, nume) DO NOTHING;

-- ---- categorii
INSERT INTO categorie (firma_id, nume)
SELECT f, x FROM unnest(ARRAY[
    'Rochie','Rochie Midi','Costum','Set','Palton','Trening','Salopeta','Corset','Fusta'
]) x
ON CONFLICT (firma_id, nume) DO NOTHING;

-- ---- etapele de croit (coloanele AG–AP din fila CROIT)
FOR r IN SELECT * FROM (VALUES
    ('comanda_primita',   'Comanda primita',              1),
    ('necesar_efectuat',  'Necesar efectuat',             2),
    ('mp_disponibila',    'Materie prima disponibila',    3),
    ('accesorii_disp',    'Accesorii disponibile',        4),
    ('model_trasat',      'Model trasat',                 5),
    ('intins',            'Intins',                       6),
    ('croit',             'Croit',                        7),
    ('separat',           'Separat',                      8),
    ('dat_spre_asamblare','Dat spre Asambleaza comanda',  9)
) AS v(cod, nume, ordine)
LOOP
    INSERT INTO etapa_croit (firma_id, cod, nume, ordine)
    VALUES (f, r.cod, r.nume, r.ordine)
    ON CONFLICT (firma_id, cod) DO NOTHING;
END LOOP;

-- ---- motive
--      Primele șapte vin din NOM_LISTE coloana U, următoarele cinci din coloana R,
--      ultimele trei lipsesc azi și au fost propuse în specificație.
FOR r IN SELECT * FROM (VALUES
    ('material_insuficient', 'Material insuficient',                  ARRAY['croit','receptie']),
    ('defect_tesatura',      'Defect de tesatura',                    ARRAY['croit','receptie']),
    ('optimizare_incadrare', 'Optimizare incadrare',                  ARRAY['croit']),
    ('sablon_lipsa',         'Sablon lipsa',                          ARRAY['croit']),
    ('comanda_modificata',   'Comanda modificata',                    ARRAY['croit','receptie']),
    ('material_in_plus',     'Material in plus disponibil',           ARRAY['croit']),
    ('altele',               'Altele',                                ARRAY['croit','receptie']),
    ('lipsa_din_croit',      'Lipsa din croit - material insuficient',ARRAY['receptie']),
    ('lipsa_din_colet',      'Lipsa produs din colet',                ARRAY['receptie']),
    ('marime_gresita',       'Marime gresita in colet',               ARRAY['receptie']),
    ('produs_gresit',        'Produs gresit expediat',                ARRAY['receptie']),
    ('colet_deteriorat',     'Colet deteriorat la transport',         ARRAY['receptie']),
    ('extern_intarziere',    'Producator extern in intarziere',       ARRAY['receptie']),
    ('rebut_ctc',            'Rebut la CTC',                          ARRAY['receptie']),
    ('anulat_de_acord',      'Anulat de comun acord',                 ARRAY['receptie']),
    ('renuntat_marime',      'S-a renuntat la marime',                ARRAY['croit'])
) AS v(cod, nume, contexte)
LOOP
    INSERT INTO motiv (firma_id, cod, nume, contexte)
    VALUES (f, r.cod, r.nume, r.contexte::context_motiv[])
    ON CONFLICT (firma_id, cod) DO NOTHING;
END LOOP;

-- ---- parametri. Pierderile din TINTE (5% + 8% + 7%) nu se mai socotesc (0018).
INSERT INTO parametru (firma_id, cheie, valoare, descriere) VALUES
    (f, 'ore_pe_zi',                8,    'Ore de lucru pe zi, pentru data estimata in depozit'),
    -- pragurile KAM din TINTE (KAM_ACC, KAM_VND): galben de la, verde de la
    (f, 'kam_acuratete_galben',     0.70, 'Acuratete forecast PSF: galben de la'),
    (f, 'kam_acuratete_verde',      0.85, 'Acuratete forecast PSF: verde de la'),
    (f, 'kam_vandut_galben',        0.70, 'Procent vandut din PSF: galben de la'),
    (f, 'kam_vandut_verde',         0.90, 'Procent vandut din PSF: verde de la')
ON CONFLICT (firma_id, cheie) DO NOTHING;

-- ---- magazinele Shopify, cate unul pe brand. Domeniul si tokenul sunt in .env.
INSERT INTO magazin (firma_id, brand_id, cod)
SELECT f, b.id, x.cod
  FROM (VALUES ('Parseea', 'PARSEEA'), ('Maison Loulou', 'MAISON_LOULOU'), ('Sleevy', 'SLEEVY')) x(brand, cod)
  JOIN brand b ON b.firma_id = f AND b.nume = x.brand
ON CONFLICT (firma_id, cod) DO NOTHING;

END $seed$;

COMMIT;
