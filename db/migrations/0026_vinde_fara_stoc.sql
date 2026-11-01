-- Dacă o variantă se mai poate comanda când stocul e zero („Continue selling when
-- out of stock" în Shopify). Fără asta, o variantă terminată care nu primește comenzi
-- pare că nu mai e cerută, când de fapt clientul nici nu o poate cumpăra.
BEGIN;

ALTER TABLE magazin_varianta ADD COLUMN vinde_fara_stoc bool NOT NULL DEFAULT false;
COMMENT ON COLUMN magazin_varianta.vinde_fara_stoc IS 'Shopify inventory policy CONTINUE: customers can still order at zero stock; false means the variant cannot be bought when sold out';

COMMIT;
