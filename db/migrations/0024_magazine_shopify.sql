-- Magazinele Shopify legate de aplicație: produsele lor (variantele, cu stocul) și
-- comenzile intrate, ca să se vadă într-un singur loc ce se poate trimite, ce e de
-- sunat (avem doar o parte) și ce a rămas fără stoc, pe fiecare magazin.
--
-- Legătura: aplicația Octogon din Shopify se instalează pe fiecare magazin (OAuth).
-- Tokenul primit stă criptat în baza de date (AES-256-GCM, cheia doar în mediu,
-- SHOPIFY_CHEIE): un dump al bazei, fără cheie, nu dă acces la magazin. Magazinele
-- legate prin tokenul unei aplicații custom din mediu (SHOPIFY_TOKEN_<COD>, 0011)
-- merg mai departe ca înainte.
--
-- Shopify e sursa: variantele și comenzile se rescriu la fiecare sincronizare și la
-- fiecare webhook. Aplicația nu scrie nimic înapoi în magazin.
BEGIN;

ALTER TABLE magazin
    ADD COLUMN domeniu        text NULL CHECK (domeniu ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
    ADD COLUMN token_criptat  text NULL,
    ADD COLUMN permisiuni     text NULL,
    ADD COLUMN instalat_la    timestamptz NULL,
    ADD COLUMN produse_sincronizate_la timestamptz NULL;
CREATE UNIQUE INDEX magazin_domeniu_unic ON magazin (domeniu) WHERE domeniu IS NOT NULL;

COMMENT ON COLUMN magazin.domeniu IS 'The store''s myshopify.com domain, set when the Octogon Shopify app is installed';
COMMENT ON COLUMN magazin.token_criptat IS 'Admin API access token from the OAuth install, AES-256-GCM encrypted with SHOPIFY_CHEIE (iv.tag.ciphertext, base64)';
COMMENT ON COLUMN magazin.permisiuni IS 'Access scopes the store granted at install';
COMMENT ON COLUMN magazin.instalat_la IS 'When the app was installed on the store; null when not connected through OAuth';
COMMENT ON COLUMN magazin.produse_sincronizate_la IS 'Last full read of products, variants and stock';

-- ---------------------------------------------------------------- variantele, cu stocul

CREATE TABLE magazin_varianta (
    firma_id        uuid NOT NULL REFERENCES firma(id),
    magazin_id      uuid NOT NULL REFERENCES magazin(id) ON DELETE CASCADE,
    varianta_gid    text NOT NULL,              -- gid://shopify/ProductVariant/…
    articol_gid     text NULL,                  -- gid://shopify/InventoryItem/…, pentru webhook-urile de stoc
    produs_gid      text NOT NULL,
    sku             text NULL,
    titlu_produs    text NOT NULL,              -- „Costum Artemis Negru"
    titlu_varianta  text NULL,                  -- „M" sau „Negru / M"
    tip_produs      text NULL,                  -- „Costum"
    optiuni         jsonb NOT NULL DEFAULT '{}', -- {"Mărime": "M", "Culoare": "Negru"}
    stoc_fizic      int  NOT NULL DEFAULT 0,    -- on hand, toate locațiile
    stoc_disponibil int  NOT NULL DEFAULT 0,    -- available: on hand minus ce e rezervat de comenzi
    pret            numeric(12,2) NULL,
    activ           bool NOT NULL DEFAULT true, -- produsul e activ în magazin
    produs_id       uuid NULL REFERENCES produs(id),  -- legătura cu catalogul aplicației, după SKU
    marime_id       uuid NULL REFERENCES marime(id),
    actualizat_la   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (magazin_id, varianta_gid)
);
CREATE INDEX ON magazin_varianta (firma_id, magazin_id, articol_gid);
CREATE INDEX ON magazin_varianta (firma_id, sku);

COMMENT ON TABLE  magazin_varianta IS 'Product variants of a connected Shopify store, with stock, rewritten on every sync and webhook';
COMMENT ON COLUMN magazin_varianta.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN magazin_varianta.articol_gid IS 'Shopify InventoryItem id, how inventory webhooks name the variant';
COMMENT ON COLUMN magazin_varianta.optiuni IS 'Variant options by name, e.g. size and colour';
COMMENT ON COLUMN magazin_varianta.stoc_fizic IS 'On-hand quantity summed over all locations; what the picking lists check';
COMMENT ON COLUMN magazin_varianta.stoc_disponibil IS 'Shopify available quantity: on hand minus what unfulfilled orders already reserve';
COMMENT ON COLUMN magazin_varianta.produs_id IS 'Matching product in the app catalog, by SKU; null when the SKU is unknown';
COMMENT ON COLUMN magazin_varianta.marime_id IS 'Matching size in the app, from the variant options';

-- ---------------------------------------------------------------- comenzile

CREATE TABLE magazin_comanda (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id        uuid NOT NULL REFERENCES firma(id),
    magazin_id      uuid NOT NULL REFERENCES magazin(id) ON DELETE CASCADE,
    comanda_gid     text NOT NULL,
    nume            text NOT NULL,              -- „#25448", ca în Shopify
    creata_la       timestamptz NOT NULL,
    actualizata_la  timestamptz NOT NULL,
    client          text NULL,
    telefon         text NULL,
    oras            text NULL,
    stare_plata     text NULL,                  -- PENDING, PAID, REFUNDED, …
    stare_livrare   text NULL,                  -- UNFULFILLED, PARTIALLY_FULFILLED, FULFILLED, …
    anulata_la      timestamptz NULL,
    inchisa_la      timestamptz NULL,
    total           numeric(12,2) NULL,
    nota            text NULL,
    etichete        text[] NOT NULL DEFAULT '{}',
    UNIQUE (magazin_id, comanda_gid)
);
CREATE INDEX ON magazin_comanda (firma_id, magazin_id, creata_la DESC);

CREATE TABLE magazin_comanda_linie (
    firma_id        uuid NOT NULL REFERENCES firma(id),
    comanda_id      uuid NOT NULL REFERENCES magazin_comanda(id) ON DELETE CASCADE,
    linie_gid       text NOT NULL,
    varianta_gid    text NULL,
    sku             text NULL,
    titlu           text NOT NULL,              -- titlul produsului
    titlu_varianta  text NULL,
    cantitate       int  NOT NULL,              -- cât s-a comandat
    de_livrat       int  NOT NULL,              -- cât mai e de trimis (fără ce s-a livrat sau scos din comandă)
    PRIMARY KEY (comanda_id, linie_gid)
);

COMMENT ON TABLE  magazin_comanda IS 'Orders from connected Shopify stores, rewritten on every sync and webhook';
COMMENT ON COLUMN magazin_comanda.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN magazin_comanda.nume IS 'Order name as Shopify shows it, e.g. #25448';
COMMENT ON COLUMN magazin_comanda.client IS 'Customer name from the shipping address, or the customer record';
COMMENT ON COLUMN magazin_comanda.telefon IS 'Phone from the shipping address or the customer, for calling about partial shipments';
COMMENT ON COLUMN magazin_comanda.stare_plata IS 'Shopify financial status';
COMMENT ON COLUMN magazin_comanda.stare_livrare IS 'Shopify fulfillment status';
COMMENT ON COLUMN magazin_comanda.inchisa_la IS 'When the order was archived (closed) in Shopify';
COMMENT ON TABLE  magazin_comanda_linie IS 'Line items of a Shopify store order';
COMMENT ON COLUMN magazin_comanda_linie.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN magazin_comanda_linie.de_livrat IS 'Quantity still to ship: Shopify unfulfilled quantity, after removals and fulfillments';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['magazin_varianta', 'magazin_comanda', 'magazin_comanda_linie'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY izolare_firma ON %I USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO octogon_app', t);
  END LOOP;
END $$;

COMMIT;
