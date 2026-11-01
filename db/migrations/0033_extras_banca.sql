-- Extrasele de cont (Banca Transilvania, PDF): fiecare tranzacție, și cu ce se
-- potrivește. Încasările de la Fan Courier se potrivesc cu un lot de rambursuri (Fan
-- virează un lot = un ordin de plată), cele de la Stripe cu un virament Shopify Payments:
-- aceeași sumă, la câteva zile după. Așa se vede exact ce bani au ajuns în bancă.
BEGIN;

-- Lotul Fan din care face parte fiecare ramburs virat, și cum a plătit clientul.
ALTER TABLE ramburs_virat ADD COLUMN lot text NULL, ADD COLUMN plata text NULL;
COMMENT ON COLUMN ramburs_virat.lot IS 'FAN Courier batch id; one batch is one bank transfer';
COMMENT ON COLUMN ramburs_virat.plata IS 'How the recipient paid the courier: cash or card';

CREATE TABLE banca_tranzactie (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    cont           text NOT NULL,                     -- IBAN-ul contului din extras
    zi             date NOT NULL,
    sens           text NOT NULL CHECK (sens IN ('credit', 'debit')),
    suma           numeric(14,2) NOT NULL,
    tip            text NOT NULL,                     -- „Incasare OP", „Plata OP intra"…
    descriere      text NULL,
    ref            text NULL,
    sursa          text NULL CHECK (sursa IN ('fan', 'gls', 'shopify')),
    potrivit       text NULL,                         -- „fan:2610023670", „card:gid://shopify/…"
    importat_la    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (firma_id, cont, zi, ref, sens, suma)
);
CREATE INDEX ON banca_tranzactie (firma_id, zi DESC);

ALTER TABLE banca_tranzactie ENABLE ROW LEVEL SECURITY;
ALTER TABLE banca_tranzactie FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON banca_tranzactie USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON banca_tranzactie TO octogon_app;

COMMENT ON TABLE  banca_tranzactie IS 'Bank statement lines imported from the bank PDF, matched to courier COD batches and card payouts';
COMMENT ON COLUMN banca_tranzactie.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN banca_tranzactie.sursa IS 'Who sent the money, when recognised: fan (FAN Courier COD), gls, shopify (Stripe / Shopify Payments)';
COMMENT ON COLUMN banca_tranzactie.potrivit IS 'What this credit was matched to: fan:<batch id> or card:<payout id>';

COMMIT;
