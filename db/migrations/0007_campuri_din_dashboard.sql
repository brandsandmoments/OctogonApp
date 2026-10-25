-- Câmpuri pe care dashboard-ul le are și structura nu le avea încă.
--
-- Prețul de referință face posibil costul pe bucată; familia grupează materialele
-- așa cum le caută omul de la aprovizionare (Stofă, Nasturi, Mercerie, Elastic);
-- „principal" marchează stofa după care se croiește — cea care decide dacă un
-- lot se poate porni sau nu.

BEGIN;

ALTER TABLE material ADD COLUMN familie text;
ALTER TABLE material ADD COLUMN pret_referinta numeric(10,2) CHECK (pret_referinta >= 0);

ALTER TABLE model_componenta ADD COLUMN principal bool NOT NULL DEFAULT false;

-- Cel mult o componentă principală pe model: două ar face întrebarea
-- „avem stofă pentru lotul ăsta?" fără răspuns.
CREATE UNIQUE INDEX model_componenta_un_principal ON model_componenta (model_id) WHERE principal;

COMMENT ON COLUMN material.familie         IS 'Material family as purchasing groups it: fabric, buttons, haberdashery, elastic';
COMMENT ON COLUMN material.pret_referinta  IS 'Reference unit price, RON, per unit of measure';
COMMENT ON COLUMN model_componenta.principal IS 'Main fabric of the model: the one cutting depends on. At most one per model.';

COMMIT;
