-- OctogonApp — structura de bază
-- Lanțul: comandă → linie → planificare → lot de croit → tranșă de bandă → intrare în depozit
--
-- Două principii care nu se negociază, și din care decurge aproape tot ce e mai jos:
--   1. Fiecare tabel poartă firma_id. Izolarea e impusă de bază, nu de aplicație (vezi 0002).
--   2. Legăturile se fac prin id, niciodată prin poziție de rând sau prin cheie compusă din text.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- firme, oameni

CREATE TABLE firma (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nume         text NOT NULL,
    slug         text NOT NULL UNIQUE,
    activa       bool NOT NULL DEFAULT true,
    creat_la     timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE rol AS ENUM ('kam', 'planificator', 'croit', 'banda', 'depozit', 'admin');

CREATE TABLE utilizator (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id     uuid NOT NULL REFERENCES firma(id),
    nume         text NOT NULL,
    email        citext NOT NULL,
    roluri       rol[] NOT NULL DEFAULT '{}',
    activ        bool NOT NULL DEFAULT true,
    creat_la     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (firma_id, email)
);

-- ---------------------------------------------------------------- nomenclatoare
-- Sunt date, nu cod. Grila de mărimi a Octogon e XXS–2XL; a altei firme e 36–46.
-- Dacă mărimile ar fi coloane sau un enum, produsul nu s-ar putea vinde decât
-- firmelor care cos exact ca tine.

CREATE TABLE brand (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id     uuid NOT NULL REFERENCES firma(id),
    nume         text NOT NULL,
    activ        bool NOT NULL DEFAULT true,
    UNIQUE (firma_id, nume)
);

CREATE TABLE marime (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id     uuid NOT NULL REFERENCES firma(id),
    cod          text NOT NULL,            -- 'XXS', 'M', '2XL', '38'
    ordine       int  NOT NULL,            -- ordinea de afișare, de la cea mai mică
    UNIQUE (firma_id, cod),
    UNIQUE (firma_id, ordine) DEFERRABLE INITIALLY DEFERRED
);

-- Shopify scrie '2XS' unde sheet-ul scrie 'XXS'. Aliasul trăiește lângă mărime,
-- nu într-o constantă din cod, și e per sursă externă.
CREATE TABLE marime_alias (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id     uuid NOT NULL REFERENCES firma(id),
    marime_id    uuid NOT NULL REFERENCES marime(id) ON DELETE CASCADE,
    sursa        text NOT NULL,            -- 'shopify', 'easyscan', 'import_sheets'
    alias        text NOT NULL,
    UNIQUE (firma_id, sursa, alias)
);

CREATE TABLE culoare (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id     uuid NOT NULL REFERENCES firma(id),
    nume         text NOT NULL,
    UNIQUE (firma_id, nume)
);

CREATE TABLE categorie (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id     uuid NOT NULL REFERENCES firma(id),
    nume         text NOT NULL,
    UNIQUE (firma_id, nume)
);

-- ---------------------------------------------------------------- catalog

CREATE TABLE produs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id      uuid NOT NULL REFERENCES firma(id),
    cod_sku       text NOT NULL,           -- prefixul comun al variantelor: 'PSA-SOPHIE-NEGRU'
    denumire      text NOT NULL,           -- identică cu titlul din Shopify
    brand_id      uuid NOT NULL REFERENCES brand(id),
    culoare_id    uuid     NULL REFERENCES culoare(id),
    categorie_id  uuid     NULL REFERENCES categorie(id),
    activ         bool NOT NULL DEFAULT true,
    creat_la      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (firma_id, cod_sku),
    UNIQUE (firma_id, denumire)
);

-- ---------------------------------------------------------------- comenzi
-- Antetul se scrie o dată; liniile atârnă de el. În Sheets, 'psf-ps-oct-39' apare
-- de trei ori cu data și KAM-ul repetate pe fiecare rând — și exact așa s-a ajuns
-- ca o linie să aibă data iar alta statusul.

CREATE TYPE tip_comanda AS ENUM ('PSF', 'PSC');
CREATE TYPE stare_comanda AS ENUM ('ciorna', 'lansata', 'in_productie', 'inchisa', 'anulata');

CREATE TABLE comanda (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    numar          text NOT NULL,          -- 'psf-ps-oct-39'
    tip            tip_comanda NOT NULL,
    brand_id       uuid NOT NULL REFERENCES brand(id),
    data_lansare   date NOT NULL,          -- obligatorie: fără ea, linia era invizibilă
    kam_id         uuid     NULL REFERENCES utilizator(id),
    prioritate     int  NOT NULL DEFAULT 3 CHECK (prioritate BETWEEN 1 AND 5),
    stare          stare_comanda NOT NULL DEFAULT 'ciorna',
    observatii     text,
    creat_la       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (firma_id, numar)
);

CREATE TABLE comanda_linie (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    comanda_id     uuid NOT NULL REFERENCES comanda(id) ON DELETE RESTRICT,
    produs_id      uuid NOT NULL REFERENCES produs(id),
    data_ceruta    date NOT NULL,
    vanzare_de_la  date,
    vanzare_pana_la date,
    observatii     text,
    UNIQUE (comanda_id, produs_id),
    CHECK (vanzare_pana_la IS NULL OR vanzare_de_la IS NULL OR vanzare_pana_la >= vanzare_de_la)
);

-- Cantitățile sunt rânduri, nu șapte coloane.
CREATE TABLE comanda_cantitate (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    linie_id       uuid NOT NULL REFERENCES comanda_linie(id) ON DELETE CASCADE,
    marime_id      uuid NOT NULL REFERENCES marime(id),
    cantitate      int  NOT NULL CHECK (cantitate > 0),
    UNIQUE (linie_id, marime_id)
);

-- ---------------------------------------------------------------- planificare
-- O linie poate genera mai multe tranșe: 200 acum, 300 luna viitoare.

CREATE TYPE stadiu_planificare AS ENUM (
    'fara_cantitate', 'blocat_materiale', 'gata_de_lansat', 'lansat_spre_croit', 'in_croit', 'anulat'
);

CREATE TABLE planificare (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    linie_id       uuid NOT NULL REFERENCES comanda_linie(id) ON DELETE RESTRICT,
    numar_transa   int  NOT NULL CHECK (numar_transa > 0),
    planificat_de  uuid     NULL REFERENCES utilizator(id),
    data_planificare date NOT NULL DEFAULT CURRENT_DATE,
    stadiu         stadiu_planificare NOT NULL DEFAULT 'fara_cantitate',
    observatii     text,
    UNIQUE (linie_id, numar_transa)
);

CREATE TABLE planificare_cantitate (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    planificare_id uuid NOT NULL REFERENCES planificare(id) ON DELETE CASCADE,
    marime_id      uuid NOT NULL REFERENCES marime(id),
    cantitate      int  NOT NULL CHECK (cantitate > 0),
    UNIQUE (planificare_id, marime_id)
);

-- ---------------------------------------------------------------- croit
-- Un lot fără planificare nu se poate crea. Asta e tot ce separă structura asta
-- de cele 2 loturi orfane rămase azi în Sheets după comenzi șterse.

CREATE TABLE lot_croit (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    planificare_id uuid NOT NULL REFERENCES planificare(id) ON DELETE RESTRICT,
    numar_lot      int  NOT NULL DEFAULT 1 CHECK (numar_lot > 0),
    lansat_de      uuid     NULL REFERENCES utilizator(id),
    data_primire   date NOT NULL DEFAULT CURRENT_DATE,
    responsabil_id uuid     NULL REFERENCES utilizator(id),
    observatii     text,
    UNIQUE (planificare_id, numar_lot)
);

-- Etapele sunt date, nu coloane cu bifă. Octogon are nouă; altă firmă are șapte.
CREATE TABLE etapa_croit (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    cod            text NOT NULL,
    nume           text NOT NULL,
    ordine         int  NOT NULL,
    UNIQUE (firma_id, cod),
    UNIQUE (firma_id, ordine) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE lot_etapa (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    lot_id         uuid NOT NULL REFERENCES lot_croit(id) ON DELETE CASCADE,
    etapa_id       uuid NOT NULL REFERENCES etapa_croit(id),
    bifat_la       timestamptz NOT NULL DEFAULT now(),
    bifat_de       uuid     NULL REFERENCES utilizator(id),
    UNIQUE (lot_id, etapa_id)
);

CREATE TABLE lot_croit_efectiv (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    lot_id         uuid NOT NULL REFERENCES lot_croit(id) ON DELETE CASCADE,
    marime_id      uuid NOT NULL REFERENCES marime(id),
    cantitate      int  NOT NULL CHECK (cantitate >= 0),
    motiv_id       uuid     NULL,          -- completat în 0003, odată cu lista de motive
    UNIQUE (lot_id, marime_id)
);

-- ---------------------------------------------------------------- etichete și recepție
-- Codul aparține comenzii. Se emite la lansare, pentru fiecare poziție
-- (linie + mărime), și nu se refolosește niciodată la altă comandă.

CREATE TABLE eticheta (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    cod            text NOT NULL,          -- serialul tipărit: 'OCT-7F3K2M9'
    linie_id       uuid NOT NULL REFERENCES comanda_linie(id) ON DELETE RESTRICT,
    marime_id      uuid NOT NULL REFERENCES marime(id),
    pozitie        int  NOT NULL,          -- 'poziția 4 din 12', pentru om
    tiparita_de    uuid     NULL REFERENCES utilizator(id),
    tiparita_la    timestamptz,
    anulata_la     timestamptz,
    UNIQUE (cod),                          -- unic global: un scan nu trebuie să știe firma
    UNIQUE (linie_id, marime_id)
);

-- Serialul e opac dinadins. Numărul comenzii și SKU-ul se TIPĂRESC pe etichetă,
-- cu litere, dar nu intră în codul de bare: 'psf-ps-oct-67' a fost renumerotat în
-- 'psf-ps-oct-97' după ce pornise producția, și toate etichetele ar fi mințit.
CREATE INDEX ON eticheta (firma_id, linie_id);

CREATE TABLE receptie (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    eticheta_id    uuid NOT NULL REFERENCES eticheta(id) ON DELETE RESTRICT,
    cantitate      int  NOT NULL CHECK (cantitate > 0),
    scanat_de      uuid     NULL REFERENCES utilizator(id),
    scanat_la      timestamptz NOT NULL DEFAULT now(),
    motiv_id       uuid     NULL,          -- obligatoriu când se închide sub cantitate; vezi 0003
    inchide_pozitia bool NOT NULL DEFAULT false,  -- 'nu mai vin' — poziția se închide incomplet
    observatii     text
);

CREATE INDEX ON receptie (firma_id, eticheta_id);
CREATE INDEX ON receptie (firma_id, scanat_la DESC);

COMMIT;
