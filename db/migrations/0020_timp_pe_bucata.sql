-- Timpul de lucru pe bucată, din fișa de produs, pentru estimarea benzii.
--
-- Dezvoltarea îl scrie pe fișă odată cu manopera; la aprobare trece pe model. La
-- alimentarea benzii, timpul unei tranșe = bucăți × minute pe bucată, ajustat după
-- cantitate (sub 50 de bucăți +20%, peste 200 −15%), împărțit la oamenii de pe bandă.

BEGIN;

ALTER TABLE dezvoltare ADD COLUMN timp_min_buc numeric(8,2) CHECK (timp_min_buc > 0);
ALTER TABLE model ADD COLUMN timp_min_buc numeric(8,2) CHECK (timp_min_buc > 0);

COMMENT ON COLUMN dezvoltare.timp_min_buc IS 'Working time per piece, in minutes, on the product sheet';
COMMENT ON COLUMN model.timp_min_buc IS 'Working time per piece, in minutes: the basis for the line time estimate';

COMMIT;
