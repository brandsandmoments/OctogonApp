-- Zona de financiar, etapa 1 (doar citire): coletele trimise prin Fan Courier și GLS,
-- așa cum le știu curierii (și cele făcute direct în selfAWB / MyGLS, de exemplu
-- schimburile), facturile din xConnector (SmartBill) pe fiecare comandă și rambursurile
-- virate de Fan în cont. Din ele: ce a plecat fără factură, ce e de stornat (refuzat,
-- returnat), ce ramburs n-a venit încă și ce s-a încasat.
--
-- Și un drept nou, „financiar".
BEGIN;

-- Contul de client Fan Courier al fiecărui brand (ID Client din selfAWB).
ALTER TABLE magazin ADD COLUMN fan_client_id text NULL;
COMMENT ON COLUMN magazin.fan_client_id IS 'FAN Courier client id of this brand (selfAWB), used to read its AWBs and COD transfers';
UPDATE magazin SET fan_client_id = '7370637' WHERE cod = 'MAISON_LOULOU';
UPDATE magazin SET fan_client_id = '7370638' WHERE cod = 'PARSEEA';
UPDATE magazin SET fan_client_id = '7388539' WHERE cod = 'SLEEVY';

-- Coletele, de la curier.
CREATE TABLE colet_curier (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    curier         text NOT NULL CHECK (curier IN ('fan', 'gls')),
    awb            text NOT NULL,
    sens           text NOT NULL DEFAULT 'iese' CHECK (sens IN ('iese', 'intra')),  -- intra: retur / schimb trimis de client către noi
    magazin_id     uuid NULL REFERENCES magazin(id),      -- Fan: din contul de client; GLS: din comanda potrivită
    creat_zi       date NOT NULL,                          -- ziua AWB-ului (Fan) / a etichetei (GLS)
    destinatar     text NULL,                              -- clientul: destinatarul, iar la „intra" expeditorul
    telefon        text NULL,
    oras           text NULL,
    referinta      text NULL,                              -- observații Fan / referința clientului GLS
    ramburs        numeric(12,2) NOT NULL DEFAULT 0,
    cost           numeric(12,2) NULL,
    stare          text NOT NULL DEFAULT 'creat' CHECK (stare IN ('creat', 'in_tranzit', 'livrat', 'refuzat', 'returnat')),
    stare_la       timestamptz NULL,
    stare_text     text NULL,                              -- ultimul mesaj al curierului
    awb_retur      text NULL,
    comanda        text NULL,                              -- „#17274", potrivită după AWB, referință („Schimb 23142") sau telefon
    potrivire      text NULL CHECK (potrivire IN ('awb', 'referinta', 'telefon')),
    urmarit_la     timestamptz NULL,
    actualizat_la  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (firma_id, curier, awb)
);
CREATE INDEX ON colet_curier (firma_id, creat_zi DESC);

-- Comenzile, din xConnector: AWB-urile și facturile (SmartBill) fiecăreia.
CREATE TABLE xc_comanda (
    firma_id       uuid NOT NULL REFERENCES firma(id),
    magazin_id     uuid NOT NULL REFERENCES magazin(id) ON DELETE CASCADE,
    order_id       text NOT NULL,
    nume           text NOT NULL,
    creata_la      timestamptz NULL,
    total          numeric(12,2) NULL,
    plata          text NULL,                              -- paid, pending, refunded, voided…
    stare          text NULL,                              -- IN_PROGRESS, CANCELED…
    client         text NULL,
    telefon        text NULL,
    awb            text[] NOT NULL DEFAULT '{}',
    facturi        text[] NOT NULL DEFAULT '{}',           -- facturile valide, „BZ-33893"
    stornari       text[] NOT NULL DEFAULT '{}',           -- facturile de stornare
    actualizat_la  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (magazin_id, order_id)
);
CREATE INDEX ON xc_comanda USING gin (awb);
CREATE INDEX ON xc_comanda (firma_id, right(regexp_replace(coalesce(telefon, ''), '\D', '', 'g'), 9));

-- Rambursurile virate de curier în cont.
CREATE TABLE ramburs_virat (
    firma_id       uuid NOT NULL REFERENCES firma(id),
    curier         text NOT NULL CHECK (curier IN ('fan', 'gls')),
    awb            text NOT NULL,
    sens           text NOT NULL DEFAULT 'iese' CHECK (sens IN ('iese', 'intra')),  -- intra: retur / schimb trimis de client către noi
    magazin_id     uuid NULL REFERENCES magazin(id),
    suma           numeric(12,2) NOT NULL,
    incasat_zi     date NULL,
    virat_zi       date NOT NULL,
    awb_ramburs    text NULL,
    PRIMARY KEY (firma_id, curier, awb, virat_zi)
);
CREATE INDEX ON ramburs_virat (firma_id, virat_zi DESC);

-- Până unde s-a citit fiecare sursă.
CREATE TABLE sursa_financiar (
    firma_id       uuid NOT NULL REFERENCES firma(id),
    sursa          text NOT NULL,                          -- „fan:7370638", „gls", „xc:PARSEEA"
    ultima_zi      date NULL,
    citit_la       timestamptz NULL,
    eroare         text NULL,
    PRIMARY KEY (firma_id, sursa)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['colet_curier', 'xc_comanda', 'ramburs_virat', 'sursa_financiar'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY izolare_firma ON %I USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO octogon_app', t);
  END LOOP;
END $$;

COMMENT ON TABLE  colet_curier IS 'Parcels as the couriers (FAN Courier, GLS) report them, including ones created directly in their portals';
COMMENT ON COLUMN colet_curier.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN colet_curier.creat_zi IS 'Day the AWB / label was created';
COMMENT ON COLUMN colet_curier.ramburs IS 'Cash-on-delivery amount to collect from the recipient';
COMMENT ON COLUMN colet_curier.sens IS 'iese = sent to a customer; intra = sent by a customer to us (return or exchange), so destinatar/telefon hold the customer as sender';
COMMENT ON COLUMN colet_curier.comanda IS 'Shopify order this parcel belongs to, matched by AWB (xConnector), by the order number in the reference, or by phone';
COMMENT ON TABLE  xc_comanda IS 'Shopify orders as xConnector knows them: shipping labels and SmartBill invoices per order';
COMMENT ON COLUMN xc_comanda.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN xc_comanda.facturi IS 'Valid (non-reversed) invoice numbers, e.g. BZ-33893';
COMMENT ON COLUMN xc_comanda.stornari IS 'Reversal invoices issued for this order';
COMMENT ON TABLE  ramburs_virat IS 'Cash-on-delivery amounts the courier transferred to the company bank account';
COMMENT ON COLUMN ramburs_virat.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON TABLE  sursa_financiar IS 'How far each finance data source (courier account, xConnector store) has been read';
COMMENT ON COLUMN sursa_financiar.firma_id IS 'Owning company. Row-level security filters every query by it.';

-- Dreptul nou, „financiar".
DO $$ DECLARE n text; BEGIN
  SELECT conname INTO n FROM pg_constraint WHERE conrelid = 'drept'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%zona%';
  EXECUTE format('ALTER TABLE drept DROP CONSTRAINT %I', n);
END $$;
ALTER TABLE drept ADD CONSTRAINT drept_zona_check CHECK (zona IN (
    'comenzi', 'centralizator', 'kam', 'necesar', 'planificare', 'croit',
    'banda', 'receptie', 'materiale', 'dezvoltare', 'expediere', 'aprobare', 'retete', 'financiar'));

COMMIT;
