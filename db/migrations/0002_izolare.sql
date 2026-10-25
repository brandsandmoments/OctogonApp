-- Izolarea între firme, impusă de baza de date.
--
-- Motivul pentru care asta nu se adaugă mai târziu: o aplicație mono-firmă scrie
-- peste tot „dă-mi comenzile deschise". Una multi-firmă scrie „dă-mi comenzile
-- deschise ale firmei X". Diferența e într-o mie de locuri, iar prima dată când
-- se uită un filtru, un client vede datele altui client. În fashion, unde clienții
-- sunt concurenți între ei, asta e sfârșitul produsului.
--
-- Cu regulile de mai jos, un filtru uitat întoarce zero rânduri, nu tot.

BEGIN;

-- Firma curentă vine din sesiunea de conexiune, setată de aplicație la fiecare
-- cerere. Dacă nu e setată, funcția întoarce NULL și nicio politică nu trece.
CREATE OR REPLACE FUNCTION firma_curenta() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.firma_id', true), '')::uuid
$$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'utilizator', 'brand', 'marime', 'marime_alias', 'culoare', 'categorie',
        'produs', 'comanda', 'comanda_linie', 'comanda_cantitate',
        'planificare', 'planificare_cantitate',
        'lot_croit', 'etapa_croit', 'lot_etapa', 'lot_croit_efectiv',
        'eticheta', 'receptie'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format($f$
            CREATE POLICY izolare_firma ON %I
            USING (firma_id = firma_curenta())
            WITH CHECK (firma_id = firma_curenta())
        $f$, t);
    END LOOP;
END $$;

-- Rolul cu care se conectează aplicația. Nu e proprietarul tabelelor, deci nu
-- poate ocoli politicile de mai sus.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'octogon_app') THEN
        CREATE ROLE octogon_app LOGIN;
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO octogon_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO octogon_app;

COMMIT;
