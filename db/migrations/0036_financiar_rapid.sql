-- Financiar mai rapid: factura fiecărui colet (din xConnector sau din SmartBill) se
-- potrivește o dată, la sincronizare, și se ține pe colet — pagina doar citește. Plus
-- telefonul normalizat (ultimele 9 cifre), cu index, pentru potrivirea după telefon.
BEGIN;

ALTER TABLE colet_curier
  ADD COLUMN tel9 text GENERATED ALWAYS AS (CASE WHEN length(regexp_replace(coalesce(telefon, ''), '\D', '', 'g')) >= 9
                                                 THEN right(regexp_replace(telefon, '\D', '', 'g'), 9) END) STORED,
  ADD COLUMN facturi text[] NOT NULL DEFAULT '{}',
  ADD COLUMN facturi_sigure text[] NOT NULL DEFAULT '{}',
  ADD COLUMN stornari text[] NOT NULL DEFAULT '{}',
  ADD COLUMN total numeric(12,2) NULL;
ALTER TABLE xc_comanda
  ADD COLUMN tel9 text GENERATED ALWAYS AS (CASE WHEN length(regexp_replace(coalesce(telefon, ''), '\D', '', 'g')) >= 9
                                                 THEN right(regexp_replace(telefon, '\D', '', 'g'), 9) END) STORED;
ALTER TABLE factura_smartbill
  ADD COLUMN tel9 text GENERATED ALWAYS AS (CASE WHEN length(regexp_replace(coalesce(telefon, ''), '\D', '', 'g')) >= 9
                                                 THEN right(regexp_replace(telefon, '\D', '', 'g'), 9) END) STORED;

CREATE INDEX ON colet_curier (firma_id, comanda);
CREATE INDEX ON colet_curier (firma_id, tel9);
CREATE INDEX ON xc_comanda (firma_id, tel9);
CREATE INDEX ON xc_comanda (firma_id, nume);
CREATE INDEX ON factura_smartbill (firma_id, tel9);
CREATE INDEX ON factura_smartbill (firma_id, lower(btrim(client)));
CREATE INDEX ON ramburs_virat (firma_id, curier, awb);

COMMENT ON COLUMN colet_curier.tel9 IS 'Last 9 digits of the phone, for matching across sources';
COMMENT ON COLUMN colet_curier.facturi IS 'Invoices for this parcel (xConnector and SmartBill, certain or probable), refreshed at sync';
COMMENT ON COLUMN colet_curier.facturi_sigure IS 'Invoices matched with certainty: by AWB/order in xConnector or the order printed on the SmartBill invoice';
COMMENT ON COLUMN colet_curier.stornari IS 'Reversal invoices for this parcel';
COMMENT ON COLUMN colet_curier.total IS 'Order total from xConnector';
COMMENT ON COLUMN xc_comanda.tel9 IS 'Last 9 digits of the phone, for matching across sources';
COMMENT ON COLUMN factura_smartbill.tel9 IS 'Last 9 digits of the phone, for matching across sources';

COMMIT;
