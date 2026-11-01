-- Coletele expediate din magazinele Shopify și drumul lor la curier: când a fost
-- generat AWB-ul, când l-a ridicat curierul, când a ieșit în livrare, când s-a livrat
-- sau de ce nu (refuz la primire, retur). Curierul (Fan Courier, GLS…) trimite
-- evenimentele în Shopify; aplicația le citește și le păstrează pe colet.
BEGIN;

ALTER TABLE magazin ADD COLUMN livrari_pana_la timestamptz NULL;
COMMENT ON COLUMN magazin.livrari_pana_la IS 'Orders with shipments updated up to this moment have been read into magazin_livrare';

CREATE TABLE magazin_livrare (
    firma_id        uuid NOT NULL REFERENCES firma(id),
    magazin_id      uuid NOT NULL REFERENCES magazin(id) ON DELETE CASCADE,
    livrare_gid     text NOT NULL,              -- gid://shopify/Fulfillment/…
    comanda_gid     text NOT NULL,
    comanda         text NOT NULL,              -- „#25448"
    comandata_la    timestamptz NOT NULL,
    client          text NULL,
    telefon         text NULL,
    oras            text NULL,
    produse         text NOT NULL DEFAULT '',   -- „Costum Artemis Negru M ×1, …"
    bucati          int  NOT NULL DEFAULT 0,
    curier          text NULL,
    awb             text NULL,
    urmarire        text NULL,                  -- adresa de urmărire la curier
    awb_la          timestamptz NOT NULL,       -- când s-a generat AWB-ul (fulfillment creat)
    ridicat_la      timestamptz NULL,           -- primul eveniment de la curier: a preluat coletul
    in_livrare_la   timestamptz NULL,
    livrat_la       timestamptz NULL,
    esuat_la        timestamptz NULL,
    motiv           text NULL,                  -- mesajul curierului la eșec: „Refuz primire", „Retur"
    stare           text NOT NULL CHECK (stare IN ('awb', 'in_tranzit', 'in_livrare', 'livrat', 'refuzat', 'nelivrat', 'anulat')),
    actualizat_la   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (magazin_id, livrare_gid)
);
CREATE INDEX ON magazin_livrare (firma_id, magazin_id, ridicat_la);
CREATE INDEX ON magazin_livrare (firma_id, magazin_id, livrat_la);
CREATE INDEX ON magazin_livrare (firma_id, magazin_id, esuat_la);
CREATE INDEX ON magazin_livrare (firma_id, stare);
ALTER TABLE magazin_livrare ENABLE ROW LEVEL SECURITY;
ALTER TABLE magazin_livrare FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON magazin_livrare USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON magazin_livrare TO octogon_app;

COMMENT ON TABLE  magazin_livrare IS 'Shipments (Shopify fulfillments) of connected stores with the courier tracking milestones';
COMMENT ON COLUMN magazin_livrare.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN magazin_livrare.awb_la IS 'When the shipping label (AWB) was created, i.e. the fulfillment';
COMMENT ON COLUMN magazin_livrare.ridicat_la IS 'First courier event: the parcel was picked up';
COMMENT ON COLUMN magazin_livrare.esuat_la IS 'When the courier reported a failure (refused or returned)';
COMMENT ON COLUMN magazin_livrare.motiv IS 'Courier message on failure, e.g. refused on delivery, return';
COMMENT ON COLUMN magazin_livrare.stare IS 'awb (label only), in_tranzit, in_livrare, livrat, refuzat, nelivrat (returned), anulat';

COMMIT;
