-- Mostre și comenzi de croit date chiar de la croit (șefa de croit, dezvoltare produs):
-- comenzi PSF interne, fără KAM, care pleacă direct la croit și apoi în producție ca
-- oricare alta. Produsul poate fi unul nou, scris de mână, care încă nu e în Shopify.
BEGIN;

ALTER TABLE comanda ADD COLUMN origine text NOT NULL DEFAULT 'kam' CHECK (origine IN ('kam', 'mostra', 'croit'));
COMMENT ON COLUMN comanda.origine IS 'Who gave the order: kam (normal PSF/PSC), mostra (sample given to cutting), croit (cut order the cutting team gave itself)';

ALTER TABLE comanda ADD COLUMN creat_de uuid NULL REFERENCES utilizator(id);
ALTER TABLE comanda ALTER COLUMN creat_de SET DEFAULT utilizator_curent();
COMMENT ON COLUMN comanda.creat_de IS 'User who created the order (NULL for orders created before this column)';

ALTER TABLE produs ADD COLUMN din_aplicatie boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN produs.din_aplicatie IS 'True for a product typed in the app (sample, test) that is not yet in Shopify';

CREATE INDEX ON comanda (firma_id, origine) WHERE origine <> 'kam';

COMMIT;
