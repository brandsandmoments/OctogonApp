-- Traducerea schemei în engleză, ca text stocat în bază.
--
-- Numele rămân în română, pentru că asta vorbește echipa și pentru că „PSF" și
-- „croit" n-au echivalent curat. Dar fiecare tabel și fiecare coloană care nu se
-- ghicește poartă o descriere în engleză, vizibilă în orice unealtă de baze de
-- date și în `\d+` din psql. Un dezvoltator din afară citește schema fără
-- dicționar, iar traducerea nu se desincronizează de cod: stă în cod.
--
-- `docs/glosar.md` are aceleași perechi, pentru citit pe hârtie.

BEGIN;

-- ---------------------------------------------------------------- firme, oameni

COMMENT ON TABLE  firma IS 'Tenant. One garment company. Every other table carries firma_id and is isolated by row-level security.';
COMMENT ON COLUMN firma.nume     IS 'Company name';
COMMENT ON COLUMN firma.slug     IS 'URL-safe short name';
COMMENT ON COLUMN firma.activa   IS 'Active';
COMMENT ON COLUMN firma.creat_la IS 'Created at';

COMMENT ON TABLE  utilizator IS 'User. Belongs to exactly one company.';
COMMENT ON COLUMN utilizator.nume     IS 'Full name';
COMMENT ON COLUMN utilizator.email    IS 'Email, unique within the company; used to sign in';
COMMENT ON COLUMN utilizator.roluri   IS 'Roles: kam (key account manager), planificator (planner), croit (cutting), banda (assembly line), depozit (warehouse), admin';
COMMENT ON COLUMN utilizator.activ    IS 'Active';
COMMENT ON COLUMN utilizator.creat_la IS 'Created at';

-- ---------------------------------------------------------------- nomenclatoare

COMMENT ON TABLE  brand IS 'Brand. A company may run several (Parseea, Maison Loulou, Sleevy).';
COMMENT ON COLUMN brand.nume  IS 'Brand name';
COMMENT ON COLUMN brand.activ IS 'Active';

COMMENT ON TABLE  marime IS 'Size. Rows, not columns: one company uses XXS-2XL, another 36-46. A size list in code would make the product unsellable.';
COMMENT ON COLUMN marime.cod         IS 'Primary size code as used on orders: XXS, M, 2XL';
COMMENT ON COLUMN marime.ordine      IS 'Display order, smallest first';
COMMENT ON COLUMN marime.cod_numeric IS 'Parallel EU numeric name for the same size: 32, 38, 44';

COMMENT ON TABLE  marime_alias IS 'Size alias. How an external system spells a size we already have: Shopify sends 2XS where we store XXS.';
COMMENT ON COLUMN marime_alias.sursa IS 'Source system: shopify, easyscan, partener';
COMMENT ON COLUMN marime_alias.alias IS 'Spelling used by that source';

COMMENT ON TABLE  culoare   IS 'Colour.';
COMMENT ON COLUMN culoare.nume IS 'Colour name';
COMMENT ON TABLE  categorie IS 'Product category: dress, coat, suit, tracksuit.';
COMMENT ON COLUMN categorie.nume IS 'Category name';

COMMENT ON TABLE  produs IS 'Product. One row per model and colour, matching one Shopify product.';
COMMENT ON COLUMN produs.cod_sku   IS 'SKU prefix shared by all size variants: PSA-SOPHIE-NEGRU';
COMMENT ON COLUMN produs.denumire  IS 'Product name, identical to the Shopify title so sales match automatically';
COMMENT ON COLUMN produs.activ     IS 'Active';
COMMENT ON COLUMN produs.creat_la  IS 'Created at';

-- ---------------------------------------------------------------- comenzi

COMMENT ON TABLE  comanda IS 'Production order header. PSF = firm seasonal order placed by a key account manager; PSC = supplementary order. Written once; its lines hang off it.';
COMMENT ON COLUMN comanda.numar        IS 'Order number: psc-sep-26-1';
COMMENT ON COLUMN comanda.tip          IS 'Order type: PSF or PSC';
COMMENT ON COLUMN comanda.data_lansare IS 'Launch date. Required: a line without it used to be invisible to the whole chain.';
COMMENT ON COLUMN comanda.kam_id       IS 'Key account manager who placed it';
COMMENT ON COLUMN comanda.prioritate   IS 'Priority, 1 urgent to 5 lowest';
COMMENT ON COLUMN comanda.stare        IS 'State: ciorna (draft), lansata (launched), in_productie (in production), inchisa (closed), anulata (cancelled)';
COMMENT ON COLUMN comanda.observatii   IS 'Notes';
COMMENT ON COLUMN comanda.creat_la     IS 'Created at';

COMMENT ON TABLE  comanda_linie IS 'Order line. One product in one order.';
COMMENT ON COLUMN comanda_linie.data_ceruta     IS 'Date the goods are required in the warehouse';
COMMENT ON COLUMN comanda_linie.vanzare_de_la   IS 'Selling window, from';
COMMENT ON COLUMN comanda_linie.vanzare_pana_la IS 'Selling window, to';
COMMENT ON COLUMN comanda_linie.observatii      IS 'Notes';

COMMENT ON TABLE  comanda_cantitate IS 'Ordered quantity per size. Rows, not seven columns.';
COMMENT ON COLUMN comanda_cantitate.linie_id  IS 'Order line';
COMMENT ON COLUMN comanda_cantitate.cantitate IS 'Quantity, pieces';

-- ---------------------------------------------------------------- planificare

COMMENT ON TABLE  planificare IS 'Planning batch. Decides how much of an order line goes into production now; one line may yield several batches.';
COMMENT ON COLUMN planificare.linie_id         IS 'Order line being planned';
COMMENT ON COLUMN planificare.numar_transa     IS 'Batch number within that line';
COMMENT ON COLUMN planificare.planificat_de    IS 'Planned by';
COMMENT ON COLUMN planificare.data_planificare IS 'Planning date';
COMMENT ON COLUMN planificare.stadiu           IS 'Stage: fara_cantitate (nothing planned), blocat_materiale (blocked, missing materials), gata_de_lansat (ready to release), lansat_spre_croit (released to cutting), in_croit (in cutting), anulat (cancelled)';
COMMENT ON COLUMN planificare.observatii       IS 'Notes';

COMMENT ON TABLE  planificare_cantitate IS 'Planned quantity per size. What will actually be cut, which may be less than ordered.';
COMMENT ON COLUMN planificare_cantitate.cantitate IS 'Quantity, pieces';

-- ---------------------------------------------------------------- croit

COMMENT ON TABLE  lot_croit IS 'Cutting batch. Cannot exist without a planning batch: that constraint is what prevents the orphan batches the spreadsheet accumulated.';
COMMENT ON COLUMN lot_croit.planificare_id IS 'Planning batch it came from, required';
COMMENT ON COLUMN lot_croit.numar_lot      IS 'Batch number within that planning batch';
COMMENT ON COLUMN lot_croit.lansat_de      IS 'Released by';
COMMENT ON COLUMN lot_croit.data_primire   IS 'Date cutting received the batch';
COMMENT ON COLUMN lot_croit.responsabil_id IS 'Cutting room lead responsible';
COMMENT ON COLUMN lot_croit.observatii     IS 'Notes';

COMMENT ON TABLE  etapa_croit IS 'Cutting stage. Data, not checkbox columns: this company has nine, another has seven.';
COMMENT ON COLUMN etapa_croit.cod    IS 'Stage code';
COMMENT ON COLUMN etapa_croit.nume   IS 'Stage name';
COMMENT ON COLUMN etapa_croit.ordine IS 'Stage order';

COMMENT ON TABLE  lot_etapa IS 'Stage reached by a cutting batch, with who ticked it and when.';
COMMENT ON COLUMN lot_etapa.bifat_la IS 'Ticked at';
COMMENT ON COLUMN lot_etapa.bifat_de IS 'Ticked by';

COMMENT ON TABLE  lot_croit_efectiv IS 'Pieces actually cut, per size. Differs from planned when fabric runs short, and then carries a reason.';
COMMENT ON COLUMN lot_croit_efectiv.cantitate IS 'Pieces actually cut';
COMMENT ON COLUMN lot_croit_efectiv.motiv_id  IS 'Reason for the difference against the planned quantity';

-- ---------------------------------------------------------------- etichete, recepție

COMMENT ON TABLE  eticheta IS 'Label. Issued per order position (line plus size) when the order is launched, and never reused on another order. Scanning it is what credits goods to that order.';
COMMENT ON COLUMN eticheta.cod         IS 'Short opaque serial printed as Code 128 and QR: OCT-7F3K2M9. The order number and SKU are printed as readable text beside it, never encoded in the barcode, so a renumbered order does not invalidate printed labels.';
COMMENT ON COLUMN eticheta.linie_id    IS 'Order line this label belongs to';
COMMENT ON COLUMN eticheta.marime_id   IS 'Size this label belongs to';
COMMENT ON COLUMN eticheta.pozitie     IS 'Position number within the order, for humans: position 4 of 12';
COMMENT ON COLUMN eticheta.tiparita_de IS 'Printed by';
COMMENT ON COLUMN eticheta.tiparita_la IS 'Printed at';
COMMENT ON COLUMN eticheta.anulata_la  IS 'Voided at';

COMMENT ON TABLE  receptie IS 'Goods receipt. One scan of one label. Quantities are summed from here, never stored on the position, so the progress figure cannot drift.';
COMMENT ON COLUMN receptie.eticheta_id     IS 'Label scanned';
COMMENT ON COLUMN receptie.cantitate       IS 'Pieces received in this scan';
COMMENT ON COLUMN receptie.scanat_de       IS 'Scanned by';
COMMENT ON COLUMN receptie.scanat_la       IS 'Scanned at';
COMMENT ON COLUMN receptie.motiv_id        IS 'Reason, required when the position is closed short';
COMMENT ON COLUMN receptie.inchide_pozitia IS 'Closes the position short: the rest is not coming';
COMMENT ON COLUMN receptie.observatii      IS 'Notes';

COMMENT ON TABLE  motiv IS 'Reason, from a fixed list. Free text here means nothing can be counted, and counting is the point: how many pieces did we lose to short fabric this year?';
COMMENT ON COLUMN motiv.cod      IS 'Reason code';
COMMENT ON COLUMN motiv.nume     IS 'Reason as shown to the user, in Romanian';
COMMENT ON COLUMN motiv.contexte IS 'Where this reason may be picked: croit (cutting), receptie (goods receipt)';
COMMENT ON COLUMN motiv.activ    IS 'Active';

-- ---------------------------------------------------------------- comun

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'utilizator','brand','marime','marime_alias','culoare','categorie','produs',
        'comanda','comanda_linie','comanda_cantitate','planificare','planificare_cantitate',
        'lot_croit','etapa_croit','lot_etapa','lot_croit_efectiv','eticheta','receptie','motiv'
    ]
    LOOP
        EXECUTE format(
            'COMMENT ON COLUMN %I.firma_id IS %L', t,
            'Owning company. Row-level security filters every query by it.');
    END LOOP;
END $$;

-- Cheile străine rămase fără descriere o primesc din constrângerea lor: numele
-- tabelului referit spune deja ce sunt. Scrisă de mână, lista asta s-ar desincroniza
-- la prima coloană nouă; derivată din catalog, nu are cum.
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT src.relname AS tabel, a.attname AS coloana, tgt.relname AS referit
          FROM pg_constraint k
          JOIN pg_class src ON src.oid = k.conrelid
          JOIN pg_class tgt ON tgt.oid = k.confrelid
          JOIN pg_namespace n ON n.oid = src.relnamespace
          JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
         WHERE k.contype = 'f' AND n.nspname = 'public'
           AND array_length(k.conkey, 1) = 1
           AND col_description(k.conrelid, a.attnum) IS NULL
    LOOP
        EXECUTE format('COMMENT ON COLUMN %I.%I IS %L',
                       r.tabel, r.coloana, 'References ' || r.referit || '.');
    END LOOP;
END $$;

-- Glosarul, citibil din aplicație sau din psql: SELECT * FROM glosar;
CREATE OR REPLACE VIEW glosar AS
SELECT c.relname                                   AS tabel,
       a.attname                                   AS coloana,
       col_description(c.oid, a.attnum)            AS english
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND a.attnum > 0 AND NOT a.attisdropped
   AND col_description(c.oid, a.attnum) IS NOT NULL
 ORDER BY c.relname, a.attnum;

COMMENT ON VIEW glosar IS 'Romanian schema names with their English descriptions, in one place.';

GRANT SELECT ON glosar TO octogon_app;

COMMIT;
