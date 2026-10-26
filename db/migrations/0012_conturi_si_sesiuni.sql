-- Conturi, sesiuni și logarea din atelier.
--
-- Biroul (KAM, manager, admin) intră cu email și parolă. Atelierul (croit, bandă,
-- depozit) intră pe telefonul sau tableta comună: alegi numele și bagi un PIN.
-- Tableta e înregistrată o dată de admin, deci știe a cărei firme e — un PIN
-- de 4 cifre nu e niciodată singura barieră în fața datelor.
--
-- Parolele și PIN-urile nu ies din bază. Se verifică aici, cu bcrypt (pgcrypto),
-- prin câteva funcții SECURITY DEFINER. Tabelele `cont`, `sesiune` și `dispozitiv`
-- nu au niciun drept acordat rolului aplicației: nici un bug de interogare, nici un
-- SELECT * uitat nu poate scoate un hash. Aplicația vede doar ce întorc funcțiile.
--
-- Sesiunea e un token aleator de 32 de octeți; în bază stă doar amprenta lui
-- SHA-256. Cine citește tabela de sesiuni nu poate intra în cont.
--
-- Funcțiile nu se bazează pe faptul că proprietarul ar ocoli izolarea pe firme:
-- tabelele închise țin și firma, iar fiecare funcție o declară (app.firma_id)
-- înainte să citească `utilizator`. Merg la fel cu un proprietar fără BYPASSRLS.

-- Rolurile noi stau înaintea tranzacției: o valoare de enum nu se poate folosi în
-- tranzacția care a adăugat-o.
ALTER TYPE rol ADD VALUE IF NOT EXISTS 'head_of_sales';
ALTER TYPE rol ADD VALUE IF NOT EXISTS 'dezvoltare';

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Un email, un cont, în toată aplicația: logarea caută după email înainte să știe firma.
CREATE UNIQUE INDEX utilizator_email_unic ON utilizator (email) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------- cine a făcut
-- Omul logat, declarat de aplicație la începutul fiecărei tranzacții, ca firma.
-- Coloanele „cine" îl primesc implicit: orice rând nou își știe autorul, fără ca
-- fiecare INSERT să-și amintească să-l scrie. Din scripturi (import, sincronizare)
-- rămâne gol — acolo n-a făcut nimeni nimic de mână.
CREATE FUNCTION utilizator_curent() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.utilizator_id', true), '')::uuid
$$;

ALTER TABLE receptie         ALTER COLUMN scanat_de     SET DEFAULT utilizator_curent();
ALTER TABLE planificare      ALTER COLUMN planificat_de SET DEFAULT utilizator_curent();
ALTER TABLE lot_croit        ALTER COLUMN lansat_de     SET DEFAULT utilizator_curent();
ALTER TABLE lot_etapa        ALTER COLUMN bifat_de      SET DEFAULT utilizator_curent();
ALTER TABLE alimentare_banda ALTER COLUMN alimentat_de  SET DEFAULT utilizator_curent();
ALTER TABLE miscare_stoc     ALTER COLUMN creat_de      SET DEFAULT utilizator_curent();
ALTER TABLE eticheta         ALTER COLUMN tiparita_de   SET DEFAULT utilizator_curent();

-- ---------------------------------------------------------------- tabele închise

CREATE TABLE cont (
    utilizator_id     uuid PRIMARY KEY REFERENCES utilizator(id) ON DELETE CASCADE,
    firma_id          uuid NOT NULL REFERENCES firma(id),
    email             citext UNIQUE,  -- copia emailului din utilizator, ținută la zi de un trigger
    parola_hash       text,          -- bcrypt; null: nu intră cu parolă
    pin_hash          text,          -- bcrypt; null: nu intră din atelier
    incercari_esuate  int  NOT NULL DEFAULT 0,
    blocat_pana       timestamptz,   -- după 5 încercări greșite, 15 minute
    parola_schimbata_la timestamptz
);

CREATE TABLE sesiune (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    utilizator_id     uuid NOT NULL REFERENCES utilizator(id) ON DELETE CASCADE,
    firma_id          uuid NOT NULL REFERENCES firma(id),
    amprenta          bytea NOT NULL UNIQUE,     -- sha256(token); tokenul e doar în cookie
    din_atelier       bool NOT NULL DEFAULT false,
    creat_la          timestamptz NOT NULL DEFAULT now(),
    expira_la         timestamptz NOT NULL,
    folosita_la       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sesiune (utilizator_id);

CREATE TABLE dispozitiv (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id          uuid NOT NULL REFERENCES firma(id),
    nume              text NOT NULL,              -- 'Tableta croit', 'Telefon depozit'
    amprenta          bytea NOT NULL UNIQUE,
    inregistrat_de    uuid NULL REFERENCES utilizator(id),
    inregistrat_la    timestamptz NOT NULL DEFAULT now(),
    revocat_la        timestamptz
);

REVOKE ALL ON cont, sesiune, dispozitiv FROM octogon_app;

-- ---------------------------------------------------------------- funcții

-- Rolurile care intră din atelier, cu PIN.
CREATE FUNCTION rol_de_atelier(r rol[]) RETURNS bool LANGUAGE sql IMMUTABLE AS $$
    SELECT r && ARRAY['croit', 'banda', 'depozit']::rol[]
$$;

CREATE FUNCTION sesiune_noua(u uuid, f uuid, atelier bool) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE token text := encode(gen_random_bytes(32), 'hex');
BEGIN
    INSERT INTO sesiune (utilizator_id, firma_id, amprenta, din_atelier, expira_la)
    VALUES (u, f, digest(token, 'sha256'), atelier,
            -- Atelierul: o tură. Biroul: o săptămână.
            now() + CASE WHEN atelier THEN interval '12 hours' ELSE interval '7 days' END);
    RETURN token;
END $$;

-- O încercare greșită numărată; a cincea blochează contul 15 minute.
CREATE FUNCTION incercare_esuata(u uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE cont SET incercari_esuate = incercari_esuate + 1,
                    blocat_pana = CASE WHEN incercari_esuate + 1 >= 5 THEN now() + interval '15 minutes' END
     WHERE utilizator_id = u
$$;

/**
 * Logare cu email și parolă. Întoarce tokenul sesiunii, sau NULL. Un răspuns NULL
 * nu spune de ce (email necunoscut, parolă greșită, cont blocat): cine ghicește
 * nu află nici măcar dacă emailul există.
 */
CREATE FUNCTION logare_parola(p_email text, p_parola text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
    SELECT c.utilizator_id AS id, c.firma_id, c.parola_hash, c.blocat_pana INTO r
      FROM cont c WHERE c.email = p_email::citext;
    IF NOT FOUND OR r.parola_hash IS NULL THEN RETURN NULL; END IF;
    PERFORM set_config('app.firma_id', r.firma_id::text, true);
    IF NOT EXISTS (SELECT 1 FROM utilizator WHERE id = r.id AND activ) THEN RETURN NULL; END IF;
    IF r.blocat_pana IS NOT NULL AND r.blocat_pana > now() THEN RETURN NULL; END IF;
    IF crypt(p_parola, r.parola_hash) <> r.parola_hash THEN
        PERFORM incercare_esuata(r.id);
        RETURN NULL;
    END IF;
    UPDATE cont SET incercari_esuate = 0, blocat_pana = NULL WHERE utilizator_id = r.id;
    RETURN sesiune_noua(r.id, r.firma_id, false);
END $$;

/** Logare din atelier: dispozitivul trebuie să fie al firmei omului, PIN-ul al lui. */
CREATE FUNCTION logare_pin(p_dispozitiv text, p_utilizator uuid, p_pin text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
    SELECT c.utilizator_id AS id, c.firma_id, c.pin_hash, c.blocat_pana INTO r
      FROM dispozitiv d JOIN cont c ON c.firma_id = d.firma_id AND c.utilizator_id = p_utilizator
     WHERE d.amprenta = digest(p_dispozitiv, 'sha256') AND d.revocat_la IS NULL;
    IF NOT FOUND OR r.pin_hash IS NULL THEN RETURN NULL; END IF;
    PERFORM set_config('app.firma_id', r.firma_id::text, true);
    IF NOT EXISTS (SELECT 1 FROM utilizator WHERE id = r.id AND activ AND rol_de_atelier(roluri)) THEN
        RETURN NULL;
    END IF;
    IF r.blocat_pana IS NOT NULL AND r.blocat_pana > now() THEN RETURN NULL; END IF;
    IF crypt(p_pin, r.pin_hash) <> r.pin_hash THEN
        PERFORM incercare_esuata(r.id);
        RETURN NULL;
    END IF;
    UPDATE cont SET incercari_esuate = 0, blocat_pana = NULL WHERE utilizator_id = r.id;
    RETURN sesiune_noua(r.id, r.firma_id, true);
END $$;

/** Cine e în spatele unui token de sesiune; nimic dacă a expirat sau omul e dezactivat. */
CREATE FUNCTION sesiune_curenta(p_token text)
RETURNS TABLE (utilizator_id uuid, firma_id uuid, nume text, roluri text[], din_atelier bool)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
    UPDATE sesiune x SET folosita_la = now()
     WHERE x.amprenta = digest(p_token, 'sha256') AND x.expira_la > now()
    RETURNING x.utilizator_id, x.firma_id, x.din_atelier INTO s;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM set_config('app.firma_id', s.firma_id::text, true);
    RETURN QUERY SELECT u.id, u.firma_id, u.nume, u.roluri::text[], s.din_atelier
                   FROM utilizator u WHERE u.id = s.utilizator_id AND u.activ;
END $$;

CREATE FUNCTION sesiune_inchide(p_token text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM sesiune WHERE amprenta = digest(p_token, 'sha256')
$$;

/** Oamenii care pot intra pe un dispozitiv de atelier: ai firmei lui, cu PIN, cu rol de atelier. */
CREATE FUNCTION dispozitiv_oameni(p_dispozitiv text)
RETURNS TABLE (id uuid, nume text, dispozitiv text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record;
BEGIN
    SELECT x.firma_id, x.nume INTO d FROM dispozitiv x
     WHERE x.amprenta = digest(p_dispozitiv, 'sha256') AND x.revocat_la IS NULL;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM set_config('app.firma_id', d.firma_id::text, true);
    RETURN QUERY SELECT u.id, u.nume, d.nume
                   FROM utilizator u JOIN cont c ON c.utilizator_id = u.id AND c.pin_hash IS NOT NULL
                  WHERE u.firma_id = d.firma_id AND u.activ AND rol_de_atelier(u.roluri)
                  ORDER BY u.nume;
END $$;

-- ---- administrare: lucrează doar în firma sesiunii (firma_curenta), ca orice altceva

CREATE FUNCTION cont_seteaza_parola(p_utilizator uuid, p_parola text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF length(p_parola) < 10 THEN RAISE EXCEPTION 'Parola trebuie să aibă cel puțin 10 caractere.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM utilizator WHERE id = p_utilizator AND firma_id = firma_curenta()) THEN
        RAISE EXCEPTION 'Utilizator inexistent în firma curentă.';
    END IF;
    IF (SELECT email FROM utilizator WHERE id = p_utilizator) IS NULL THEN
        RAISE EXCEPTION 'Omul nu are email: cu parolă se intră pe email.';
    END IF;
    INSERT INTO cont (utilizator_id, firma_id, email, parola_hash, parola_schimbata_la)
    SELECT p_utilizator, firma_curenta(), email, crypt(p_parola, gen_salt('bf', 10)), now()
      FROM utilizator WHERE id = p_utilizator
    ON CONFLICT (utilizator_id) DO UPDATE
       SET parola_hash = EXCLUDED.parola_hash, email = EXCLUDED.email, parola_schimbata_la = now(),
           incercari_esuate = 0, blocat_pana = NULL;
    -- O parolă nouă închide sesiunile vechi: cine o știa pe cea veche iese.
    DELETE FROM sesiune WHERE utilizator_id = p_utilizator AND NOT din_atelier;
END $$;

CREATE FUNCTION cont_seteaza_pin(p_utilizator uuid, p_pin text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_pin !~ '^[0-9]{4,6}$' THEN RAISE EXCEPTION 'PIN-ul are 4–6 cifre.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM utilizator WHERE id = p_utilizator AND firma_id = firma_curenta()) THEN
        RAISE EXCEPTION 'Utilizator inexistent în firma curentă.';
    END IF;
    INSERT INTO cont (utilizator_id, firma_id, email, pin_hash)
    SELECT p_utilizator, firma_curenta(), email, crypt(p_pin, gen_salt('bf', 8)) FROM utilizator WHERE id = p_utilizator
    ON CONFLICT (utilizator_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, incercari_esuate = 0, blocat_pana = NULL;
    DELETE FROM sesiune WHERE utilizator_id = p_utilizator AND din_atelier;
END $$;

-- Emailul de logare e copia celui din utilizator: dacă adminul îl schimbă, se
-- schimbă și pentru logare. Trigger-ul e SECURITY DEFINER pentru că aplicația nu
-- are drepturi pe `cont`.
CREATE FUNCTION cont_email_la_zi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE cont SET email = NEW.email WHERE utilizator_id = NEW.id;
    RETURN NEW;
END $$;
CREATE TRIGGER cont_email_la_zi AFTER UPDATE OF email ON utilizator
    FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email) EXECUTE FUNCTION cont_email_la_zi();

/** Ce știe adminul despre conturi: dacă au parolă, PIN, dacă sunt blocate. Niciodată hash-ul. */
CREATE FUNCTION conturi_stare()
RETURNS TABLE (utilizator_id uuid, are_parola bool, are_pin bool, blocat bool, sesiuni int)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, c.parola_hash IS NOT NULL, c.pin_hash IS NOT NULL,
           coalesce(c.blocat_pana > now(), false),
           (SELECT count(*)::int FROM sesiune s WHERE s.utilizator_id = u.id AND s.expira_la > now())
      FROM utilizator u LEFT JOIN cont c ON c.utilizator_id = u.id
     WHERE u.firma_id = firma_curenta()
$$;

CREATE FUNCTION dispozitiv_inregistreaza(p_nume text, p_de uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE token text := encode(gen_random_bytes(32), 'hex');
BEGIN
    IF firma_curenta() IS NULL THEN RAISE EXCEPTION 'Fără firmă.'; END IF;
    INSERT INTO dispozitiv (firma_id, nume, amprenta, inregistrat_de)
    VALUES (firma_curenta(), p_nume, digest(token, 'sha256'), p_de);
    RETURN token;
END $$;

CREATE FUNCTION dispozitive()
RETURNS TABLE (id uuid, nume text, inregistrat_la timestamptz, revocat bool)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT id, nume, inregistrat_la, revocat_la IS NOT NULL FROM dispozitiv
     WHERE firma_id = firma_curenta() ORDER BY inregistrat_la DESC
$$;

CREATE FUNCTION dispozitiv_revoca(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE dispozitiv SET revocat_la = now() WHERE id = p_id AND firma_id = firma_curenta()
$$;

-- Funcțiile sunt singurul drum. Implicit, PUBLIC le poate apela pe toate; restrângem
-- la rolul aplicației.
DO $$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'sesiune_noua(uuid,uuid,bool)', 'incercare_esuata(uuid)', 'cont_email_la_zi()', 'logare_parola(text,text)',
        'logare_pin(text,uuid,text)', 'sesiune_curenta(text)', 'sesiune_inchide(text)',
        'dispozitiv_oameni(text)', 'cont_seteaza_parola(uuid,text)', 'cont_seteaza_pin(uuid,text)',
        'conturi_stare()', 'dispozitiv_inregistreaza(text,uuid)', 'dispozitive()', 'dispozitiv_revoca(uuid)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION logare_parola(text,text), logare_pin(text,uuid,text), sesiune_curenta(text),
    sesiune_inchide(text), dispozitiv_oameni(text), cont_seteaza_parola(uuid,text), cont_seteaza_pin(uuid,text),
    conturi_stare(), dispozitiv_inregistreaza(text,uuid), dispozitive(), dispozitiv_revoca(uuid) TO octogon_app;
-- sesiune_noua și incercare_esuata rămân interne: le cheamă doar celelalte funcții.

COMMENT ON FUNCTION utilizator_curent() IS 'The signed-in person, declared by the application per transaction (app.utilizator_id). Default of every who-did-it column.';
COMMENT ON TABLE cont       IS 'Credentials: bcrypt password and PIN hashes, failed attempts, lockout. No privileges for the application role; reachable only through SECURITY DEFINER functions.';
COMMENT ON TABLE sesiune    IS 'Sign-in sessions. Only the SHA-256 of the token is stored; the token lives in the browser cookie.';
COMMENT ON TABLE dispozitiv IS 'Shared workshop device registered by an admin. Its token lets the people of that company sign in with a PIN.';
COMMENT ON COLUMN cont.firma_id    IS 'Company of the account, so sign-in never needs to bypass row-level security';
COMMENT ON COLUMN cont.email       IS 'Sign-in email, kept equal to utilizator.email by a trigger';
COMMENT ON COLUMN sesiune.firma_id IS 'Company of the session';
COMMENT ON COLUMN cont.parola_hash IS 'bcrypt hash of the password; null when the person does not sign in with a password';
COMMENT ON COLUMN cont.pin_hash    IS 'bcrypt hash of the workshop PIN; null when the person does not sign in from the workshop';
COMMENT ON COLUMN cont.incercari_esuate IS 'Consecutive failed sign-in attempts';
COMMENT ON COLUMN cont.blocat_pana IS 'Locked until; set after 5 failed attempts';
COMMENT ON COLUMN cont.parola_schimbata_la IS 'Password last changed at';
COMMENT ON COLUMN sesiune.amprenta    IS 'SHA-256 of the session token';
COMMENT ON COLUMN sesiune.din_atelier IS 'Signed in from a workshop device with a PIN; such sessions last one shift';
COMMENT ON COLUMN sesiune.creat_la    IS 'Created at';
COMMENT ON COLUMN sesiune.expira_la   IS 'Expires at';
COMMENT ON COLUMN sesiune.folosita_la IS 'Last used at';
COMMENT ON COLUMN dispozitiv.nume     IS 'Device name';
COMMENT ON COLUMN dispozitiv.amprenta IS 'SHA-256 of the device token';
COMMENT ON COLUMN dispozitiv.inregistrat_la IS 'Registered at';
COMMENT ON COLUMN dispozitiv.revocat_la IS 'Revoked at; a revoked device cannot sign anyone in';
COMMENT ON COLUMN utilizator.roluri IS 'Roles: kam (key account manager), head_of_sales, planificator (production manager), croit (cutting lead), banda (line lead), depozit (warehouse keeper), dezvoltare (product development), admin';

COMMIT;
