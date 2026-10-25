-- Modele, materiale și rețete: de unde vine necesarul de materie primă și accesorii.
--
-- Rețeta e a modelului, nu a produsului. „Trening Echo" consumă la fel în roșu,
-- bleu sau negru; culoarea schimbă doar CE stofă și CE fermoar intră, nu CÂT.
-- Shopify o spune deja: fiecare produs Sleevy poartă un tag `model:echo`.
--
-- Așa că rețeta are două jumătăți:
--   model_componenta  — pe model: „stofă principală, 2,10 m pe bucată"
--   produs_material   — pe produs (model + culoare): „stofa principală e Jerseu negru"
--
-- Necesarul unei comenzi = cantitatea cerută × consumul componentei, adunat pe
-- materialul ales pentru produsul respectiv. Nimic din el nu se ține într-o
-- coloană: se calculează, deci nu poate rămâne în urmă după o modificare de rețetă.

BEGIN;

-- ---------------------------------------------------------------- modele

CREATE TABLE model (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id      uuid NOT NULL REFERENCES firma(id),
    brand_id      uuid NOT NULL REFERENCES brand(id),
    cod           text NOT NULL,           -- 'echo', ca în tagul Shopify model:echo
    denumire      text NOT NULL,           -- 'Trening Echo'
    categorie_id  uuid     NULL REFERENCES categorie(id),
    activ         bool NOT NULL DEFAULT true,
    creat_la      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (firma_id, brand_id, cod)
);

-- Produsele existente n-au încă model; de aceea coloana e opțională. Un produs fără
-- model nu are rețetă, iar necesarul îl arată ca atare, nu ca zero.
ALTER TABLE produs ADD COLUMN model_id uuid NULL REFERENCES model(id);
CREATE INDEX ON produs (firma_id, model_id);

-- Perechea (id, model_id) e țintă pentru cheia compusă din produs_material: așa
-- baza refuză să lege stofa unui produs de componenta altui model.
ALTER TABLE produs ADD CONSTRAINT produs_id_model_unic UNIQUE (id, model_id);

-- ---------------------------------------------------------------- materiale

CREATE TYPE tip_material AS ENUM ('materie_prima', 'accesoriu');
CREATE TYPE unitate_masura AS ENUM ('m', 'kg', 'buc', 'set', 'm2');

CREATE TABLE material (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id      uuid NOT NULL REFERENCES firma(id),
    tip           tip_material NOT NULL,
    cod           text NOT NULL,           -- codul intern sau al furnizorului
    denumire      text NOT NULL,           -- 'Jerseu bumbac 280g'
    culoare_id    uuid     NULL REFERENCES culoare(id),
    unitate       unitate_masura NOT NULL,
    furnizor      text,
    activ         bool NOT NULL DEFAULT true,
    creat_la      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (firma_id, cod),
    UNIQUE (id, tip, unitate)              -- țintă pentru produs_material
);

-- ---------------------------------------------------------------- rețeta

CREATE TABLE model_componenta (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id      uuid NOT NULL REFERENCES firma(id),
    model_id      uuid NOT NULL REFERENCES model(id) ON DELETE CASCADE,
    nume          text NOT NULL,           -- 'Stofă principală', 'Fermoar', 'Etichetă compoziție'
    tip           tip_material NOT NULL,
    unitate       unitate_masura NOT NULL,
    consum        numeric(10,3) NOT NULL CHECK (consum > 0),  -- pe bucată de produs finit
    ordine        int  NOT NULL DEFAULT 1,
    UNIQUE (model_id, nume),
    UNIQUE (id, model_id),
    UNIQUE (id, tip, unitate)
);

-- Ce material concret umple fiecare componentă, pentru un produs anume.
-- Cheile compuse fac trei lucruri imposibile, fără nicio linie de cod:
--   - componenta altui model decât al produsului;
--   - un nasture pus în locul stofei (tipul trebuie să coincidă);
--   - o stofă în bucăți acolo unde rețeta vorbește în metri (unitatea la fel).
CREATE TABLE produs_material (
    firma_id      uuid NOT NULL REFERENCES firma(id),
    produs_id     uuid NOT NULL,
    model_id      uuid NOT NULL,
    componenta_id uuid NOT NULL,
    material_id   uuid NOT NULL,
    tip           tip_material NOT NULL,
    unitate       unitate_masura NOT NULL,
    PRIMARY KEY (produs_id, componenta_id),
    FOREIGN KEY (produs_id, model_id)          REFERENCES produs (id, model_id),
    FOREIGN KEY (componenta_id, model_id)      REFERENCES model_componenta (id, model_id) ON DELETE CASCADE,
    FOREIGN KEY (componenta_id, tip, unitate)  REFERENCES model_componenta (id, tip, unitate),
    FOREIGN KEY (material_id, tip, unitate)    REFERENCES material (id, tip, unitate)
);

CREATE INDEX ON produs_material (firma_id, material_id);

-- ---------------------------------------------------------------- necesarul
-- Pe comandă, pe material. `security_invoker` face ca vederea să se supună
-- politicilor de izolare ale celui care o citește, nu ale proprietarului.
-- Rândurile fără material (rețetă lipsă sau componentă nealocată) rămân în
-- vedere cu material_id NULL: o lipsă trebuie să se vadă, nu să dispară din sumă.

CREATE VIEW necesar_comanda WITH (security_invoker = true) AS
SELECT c.firma_id,
       c.id                 AS comanda_id,
       c.numar              AS comanda,
       p.id                 AS produs_id,
       p.model_id,
       mc.id                AS componenta_id,
       mc.nume              AS componenta,
       mc.tip,
       mc.unitate,
       pm.material_id,
       sum(cc.cantitate)::int                     AS bucati,
       mc.consum,
       sum(cc.cantitate) * mc.consum              AS necesar
  FROM comanda c
  JOIN comanda_linie cl     ON cl.comanda_id = c.id
  JOIN comanda_cantitate cc ON cc.linie_id = cl.id
  JOIN produs p             ON p.id = cl.produs_id
  LEFT JOIN model_componenta mc ON mc.model_id = p.model_id
  LEFT JOIN produs_material pm  ON pm.produs_id = p.id AND pm.componenta_id = mc.id
 GROUP BY c.firma_id, c.id, c.numar, p.id, p.model_id, mc.id, mc.nume, mc.tip,
          mc.unitate, pm.material_id, mc.consum;

-- ---------------------------------------------------------------- izolare

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['model', 'material', 'model_componenta', 'produs_material']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format($f$
            CREATE POLICY izolare_firma ON %I
            USING (firma_id = firma_curenta())
            WITH CHECK (firma_id = firma_curenta())
        $f$, t);
        EXECUTE format('COMMENT ON COLUMN %I.firma_id IS %L', t,
            'Owning company. Row-level security filters every query by it.');
    END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON model, material, model_componenta, produs_material TO octogon_app;
GRANT SELECT ON necesar_comanda TO octogon_app;

-- ---------------------------------------------------------------- traduceri

COMMENT ON TABLE  model IS 'Garment model, shared by all its colours: Trening Echo. The recipe belongs here, so a new colour needs no new recipe.';
COMMENT ON COLUMN model.cod          IS 'Model code, as in the Shopify tag model:echo';
COMMENT ON COLUMN model.denumire     IS 'Model name';
COMMENT ON COLUMN model.activ        IS 'Active';
COMMENT ON COLUMN model.creat_la     IS 'Created at';
COMMENT ON COLUMN produs.model_id    IS 'Model this product is a colour of. Optional while products are being mapped; without it the product has no recipe.';

COMMENT ON TABLE  material IS 'Raw material (fabric, lining) or accessory (zip, button, label) kept in stock.';
COMMENT ON COLUMN material.tip       IS 'Kind: materie_prima (raw material, fabric) or accesoriu (accessory, trim)';
COMMENT ON COLUMN material.cod       IS 'Material code, internal or supplier''s';
COMMENT ON COLUMN material.denumire  IS 'Material name';
COMMENT ON COLUMN material.unitate   IS 'Unit of measure: m, kg, buc (pieces), set, m2';
COMMENT ON COLUMN material.furnizor  IS 'Supplier';
COMMENT ON COLUMN material.activ     IS 'Active';
COMMENT ON COLUMN material.creat_la  IS 'Created at';

COMMENT ON TABLE  model_componenta IS 'Recipe line of a model: which component, how much per finished piece. The material that fills it is chosen per product.';
COMMENT ON COLUMN model_componenta.nume    IS 'Component name: main fabric, lining, zip';
COMMENT ON COLUMN model_componenta.tip     IS 'Raw material or accessory';
COMMENT ON COLUMN model_componenta.unitate IS 'Unit the consumption is expressed in';
COMMENT ON COLUMN model_componenta.consum  IS 'Consumption per finished piece, in that unit';
COMMENT ON COLUMN model_componenta.ordine  IS 'Display order';

COMMENT ON TABLE  produs_material IS 'Which material fills each recipe component for one product (model + colour). Composite keys keep model, kind and unit consistent.';
COMMENT ON COLUMN produs_material.tip     IS 'Copied from the component; the composite key keeps it equal to the material''s';
COMMENT ON COLUMN produs_material.unitate IS 'Copied from the component; the composite key keeps it equal to the material''s';

COMMENT ON VIEW   necesar_comanda IS 'Material requirement per order and product: ordered pieces times recipe consumption. Rows with no material_id are recipe gaps, kept visible on purpose.';

COMMIT;
