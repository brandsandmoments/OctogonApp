-- Planul de producție pe culori: în săptămâna de lucru se pune o culoare a unei comenzi
-- (o linie), toată sau doar o parte (bucăți). O culoare poate fi împărțită pe mai multe
-- săptămâni. Planul de până acum, pe comandă întreagă, se mută pe fiecare culoare a ei.
BEGIN;

CREATE TABLE plan_linie (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id    uuid NOT NULL REFERENCES firma(id),
    linie_id    uuid NOT NULL REFERENCES comanda_linie(id) ON DELETE CASCADE,
    saptamana   date NOT NULL CHECK (extract(isodow FROM saptamana) = 1),   -- lunea săptămânii
    bucati      int  NULL CHECK (bucati IS NULL OR bucati > 0),             -- gol = toată culoarea
    creat_de    uuid NULL DEFAULT utilizator_curent() REFERENCES utilizator(id),
    creat_la    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (firma_id, linie_id, saptamana)
);
CREATE INDEX ON plan_linie (firma_id, saptamana);
ALTER TABLE plan_linie ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_linie FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON plan_linie USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_linie TO octogon_app;
COMMENT ON TABLE  plan_linie IS 'Production plan per colour (order line): the working week it is scheduled in, all of it or some pieces';
COMMENT ON COLUMN plan_linie.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN plan_linie.saptamana IS 'Monday of the working week';
COMMENT ON COLUMN plan_linie.bucati IS 'Pieces scheduled that week; null means the whole colour';

DO $$ DECLARE f uuid; BEGIN
  FOR f IN SELECT id FROM firma LOOP
    PERFORM set_config('app.firma_id', f::text, true);
    INSERT INTO plan_linie (firma_id, linie_id, saptamana, creat_de, creat_la)
    SELECT ps.firma_id, cl.id, ps.saptamana, ps.creat_de, ps.creat_la
      FROM plan_saptamana ps JOIN comanda_linie cl ON cl.comanda_id = ps.comanda_id
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
DROP TABLE plan_saptamana;

COMMIT;
