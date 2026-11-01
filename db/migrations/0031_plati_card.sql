-- Încasările cu cardul, din Shopify Payments: fiecare plată (sau rambursare) cu
-- comisionul și netul ei, și viramentele (payouts) către contul firmei. Completează
-- zona de financiar: banii din ramburs vin de la curier, cei din card de la Shopify.
BEGIN;

CREATE TABLE card_tranzactie (
    firma_id       uuid NOT NULL REFERENCES firma(id),
    magazin_id     uuid NOT NULL REFERENCES magazin(id) ON DELETE CASCADE,
    id             text NOT NULL,                      -- gid Shopify
    tip            text NOT NULL,                      -- CHARGE, REFUND, ADJUSTMENT, DISPUTE…
    data           timestamptz NOT NULL,
    comanda        text NULL,                          -- „#25561"
    suma           numeric(12,2) NOT NULL,
    comision       numeric(12,2) NOT NULL DEFAULT 0,
    net            numeric(12,2) NOT NULL,
    virament_id    text NULL,
    virament_stare text NULL,                          -- PAID, IN_TRANSIT, PENDING…
    PRIMARY KEY (magazin_id, id)
);
CREATE INDEX ON card_tranzactie (firma_id, data DESC);

CREATE TABLE card_virament (
    firma_id       uuid NOT NULL REFERENCES firma(id),
    magazin_id     uuid NOT NULL REFERENCES magazin(id) ON DELETE CASCADE,
    id             text NOT NULL,
    data           timestamptz NOT NULL,               -- când a plecat spre bancă
    stare          text NOT NULL,
    net            numeric(12,2) NOT NULL,
    brut           numeric(12,2) NULL,
    comision       numeric(12,2) NULL,
    PRIMARY KEY (magazin_id, id)
);
CREATE INDEX ON card_virament (firma_id, data DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['card_tranzactie', 'card_virament'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY izolare_firma ON %I USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO octogon_app', t);
  END LOOP;
END $$;

COMMENT ON TABLE  card_tranzactie IS 'Shopify Payments balance transactions: card charges and refunds per order, with fee and net';
COMMENT ON COLUMN card_tranzactie.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN card_tranzactie.comision IS 'Fee Shopify Payments kept';
COMMENT ON COLUMN card_tranzactie.virament_id IS 'Payout this transaction was (or will be) paid out in';
COMMENT ON TABLE  card_virament IS 'Shopify Payments payouts to the company bank account';
COMMENT ON COLUMN card_virament.firma_id IS 'Owning company. Row-level security filters every query by it.';

COMMIT;
