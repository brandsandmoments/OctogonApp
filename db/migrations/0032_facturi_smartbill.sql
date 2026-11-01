-- Facturile făcute direct în SmartBill (de mână: schimburi, retrimiteri, corecturi),
-- pe care xConnector nu le știe. SmartBill nu dă lista facturilor, așa că aplicația ia
-- numerele din serie care lipsesc din xConnector și citește din PDF-ul fiecăreia data,
-- clientul, telefonul, comanda (dacă e scrisă) și totalul. Un total negativ = stornare.
BEGIN;

CREATE TABLE factura_smartbill (
    firma_id       uuid NOT NULL REFERENCES firma(id),
    serie          text NOT NULL,
    numar          int  NOT NULL,
    data           date NULL,
    client         text NULL,
    telefon        text NULL,
    email          text NULL,
    comanda        text NULL,                         -- „#17191", când e scrisă pe factură
    total          numeric(12,2) NULL,
    exista         boolean NOT NULL DEFAULT true,     -- false: numărul nu e (încă) folosit în SmartBill
    citit_la       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (firma_id, serie, numar)
);
CREATE INDEX ON factura_smartbill (firma_id, right(regexp_replace(coalesce(telefon, ''), '\D', '', 'g'), 9));
CREATE INDEX ON factura_smartbill (firma_id, comanda);

ALTER TABLE factura_smartbill ENABLE ROW LEVEL SECURITY;
ALTER TABLE factura_smartbill FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON factura_smartbill USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON factura_smartbill TO octogon_app;

COMMENT ON TABLE  factura_smartbill IS 'Invoices issued directly in SmartBill (not through xConnector), read from each invoice PDF';
COMMENT ON COLUMN factura_smartbill.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN factura_smartbill.comanda IS 'Shopify order name printed on the invoice, when present';
COMMENT ON COLUMN factura_smartbill.total IS 'Invoice total; negative for a reversal (storno)';
COMMENT ON COLUMN factura_smartbill.exista IS 'False when the number has not been issued in SmartBill (yet)';

COMMIT;
