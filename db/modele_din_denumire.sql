-- Modele pentru produsele care n-au: „Trench Melissa Crem / Maro / Negru" sunt
-- culorile modelului Melissa. Dashboard-ul nu le-a dat model pentru că n-aveau
-- rețetă, iar fără model croitul nu le poate tăia împreună și rețeta nu se poate
-- scrie o dată pentru toate culorile.
--
-- Modelul se ia din denumire: tip + model + culoare („Trench Melissa Crem"). Se
-- grupează produsele aceluiași brand care încep cu aceleași două cuvinte și sunt
-- măcar două; modelul e al doilea cuvânt. Cele singure sau cu denumiri neobișnuite
-- („Manusi Maro") rămân fără model și se leagă de mână, din „Modele și rețete".
-- Dacă brandul are deja un model cu codul ăsta, produsele se leagă de el.
--
-- Se poate rula de mai multe ori: atinge doar produsele fără model.

DO $$
DECLARE f uuid;
BEGIN
    FOR f IN SELECT id FROM firma LOOP
        PERFORM set_config('app.firma_id', f::text, true);

        CREATE TEMP TABLE grupa ON COMMIT DROP AS
        WITH x AS (
            SELECT p.id, p.brand_id, p.categorie_id,
                   regexp_split_to_array(btrim(regexp_replace(p.denumire, '\s+', ' ', 'g')), ' ') AS w
              FROM produs p WHERE p.model_id IS NULL)
        SELECT brand_id, lower(w[1]) AS tip, w[2] AS model,
               array_agg(id) AS produse, (array_agg(categorie_id) FILTER (WHERE categorie_id IS NOT NULL))[1] AS categorie_id
          FROM x WHERE array_length(w, 1) >= 3
         GROUP BY brand_id, lower(w[1]), w[2]
        HAVING count(*) >= 2;

        INSERT INTO model (firma_id, brand_id, cod, denumire, categorie_id)
        SELECT f, g.brand_id, lower(g.model), g.model, g.categorie_id
          FROM grupa g
        ON CONFLICT (firma_id, brand_id, cod) DO NOTHING;

        UPDATE produs p SET model_id = m.id
          FROM grupa g JOIN model m ON m.brand_id = g.brand_id AND m.cod = lower(g.model)
         WHERE p.id = ANY (g.produse) AND p.model_id IS NULL;

        DROP TABLE grupa;
    END LOOP;
END $$;
