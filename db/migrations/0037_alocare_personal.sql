-- Oamenii din producție și cine lucrează la ce. Personalul atelierului (nu conturile
-- din aplicație): numele și funcțiile fiecăruia. Utilajele și posturile benzii. Și
-- alocarea: la o tranșă de pe bandă (…/P1/C1/B1, deci la un PSF sau PSC), pe faza din
-- procesul tehnologic al modelului, cu mașina, omul, când a început și când a ieșit gata.
BEGIN;

CREATE TABLE angajat (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id   uuid NOT NULL REFERENCES firma(id),
    nume       text NOT NULL CHECK (btrim(nume) <> ''),
    functii    text[] NOT NULL DEFAULT '{}' CHECK (functii <@ ARRAY['alimentator', 'control_interfazic', 'operator', 'sef_sectie',
                 'modelier', 'sef_modele', 'calcator_interfazic', 'calcator_final', 'ctc_ambalat', 'taietor', 'croit_auxiliar',
                 'auxiliar_sectie', 'sef_croit']::text[]),
    activ      boolean NOT NULL DEFAULT true,
    UNIQUE (firma_id, nume)
);

CREATE TABLE utilaj (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id   uuid NOT NULL REFERENCES firma(id),
    nume       text NOT NULL CHECK (btrim(nume) <> ''),
    masina     boolean NOT NULL DEFAULT true,        -- false: post fără mașină (alimentare, control, călcat, CTC)
    ordine     int NOT NULL DEFAULT 0,
    UNIQUE (firma_id, nume)
);

CREATE TABLE alocare_operatie (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firma_id       uuid NOT NULL REFERENCES firma(id),
    alimentare_id  uuid NOT NULL REFERENCES alimentare_banda(id) ON DELETE CASCADE,
    operatie_id    uuid NULL REFERENCES model_operatie(id) ON DELETE SET NULL,
    faza           text NOT NULL CHECK (btrim(faza) <> ''),   -- numele fazei, păstrat și dacă procesul se schimbă
    utilaj         text NULL,
    angajat_id     uuid NOT NULL REFERENCES angajat(id),
    incepe_la      timestamptz NULL,
    gata_la        timestamptz NULL CHECK (gata_la IS NULL OR incepe_la IS NULL OR gata_la >= incepe_la),
    observatii     text NULL,
    creat_de       uuid NULL DEFAULT utilizator_curent() REFERENCES utilizator(id),
    creat_la       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON alocare_operatie (firma_id, alimentare_id);
CREATE INDEX ON alocare_operatie (firma_id, angajat_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['angajat', 'utilaj', 'alocare_operatie'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY izolare_firma ON %I USING (firma_id = firma_curenta()) WITH CHECK (firma_id = firma_curenta())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO octogon_app', t);
  END LOOP;
END $$;

COMMENT ON TABLE  angajat IS 'Production staff (not app accounts): who can be allocated to operations';
COMMENT ON COLUMN angajat.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN angajat.functii IS 'Roles: alimentator, operator (sewing machine), control_interfazic, calcator_*, ctc_ambalat, croit roles, heads';
COMMENT ON TABLE  utilaj IS 'Sewing machines and band posts an operation can run on';
COMMENT ON COLUMN utilaj.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN utilaj.masina IS 'True for a sewing machine, false for a post without one (feeding, control, pressing, CTC)';
COMMENT ON TABLE  alocare_operatie IS 'Who works on which operation of a band tranche (PSF/PSC), on which machine, from when until done';
COMMENT ON COLUMN alocare_operatie.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN alocare_operatie.faza IS 'Operation name, kept even if the technological process changes later';
COMMENT ON COLUMN alocare_operatie.gata_la IS 'When the person finished this operation on the tranche';

-- Personalul și utilajele de azi, în fiecare firmă (rulează ca proprietar, prin RLS).
DO $$
DECLARE
  f uuid;
  oameni jsonb := '[
    ["Sava Alexandrina", ["alimentator"]], ["Nicoleta", ["control_interfazic", "calcator_final"]],
    ["Negoiță Mihaela", ["operator"]], ["Mirela Dobre", ["operator"]], ["Cristina Chiorpec", ["operator"]], ["Suzana Baboi", ["operator"]],
    ["Aurelia", ["operator"]], ["Neta", ["operator"]], ["Staicu Gabriela", ["operator"]], ["Hampu Lenuța", ["operator"]],
    ["Nelușa Matei", ["operator"]], ["Teo", ["operator"]], ["Monica Badea", ["operator"]], ["Steluța", ["operator"]],
    ["Craița", ["operator"]], ["Ramona Buzilă", ["operator"]], ["Lidia", ["operator"]], ["Șuțu Nicoleta", ["operator"]],
    ["Laura Bubulac", ["operator"]], ["Coleș Cristina", ["operator"]], ["Jeni", ["operator"]], ["Ionela", ["operator"]],
    ["Ifrim Mihaela", ["operator"]], ["Aura Lăcrămioara", ["operator"]], ["Nicoleta Cujbă", ["operator"]], ["Mariana", ["operator"]],
    ["Veronica Grigore", ["sef_sectie"]], ["Lili", ["modelier"]], ["Geta", ["modelier"]], ["Mirela", ["sef_modele"]],
    ["Aura", ["calcator_interfazic", "ctc_ambalat"]], ["Mutulica", ["calcator_interfazic"]], ["Carmen", ["calcator_interfazic"]],
    ["Ana", ["calcator_final"]], ["Lili Dodin", ["ctc_ambalat"]], ["Valerica", ["ctc_ambalat"]],
    ["Ștefănel", ["taietor"]], ["Cristi", ["taietor"]], ["Mimi", ["croit_auxiliar"]], ["Irina", ["croit_auxiliar"]],
    ["Mihaela", ["croit_auxiliar"]], ["Emilia", ["auxiliar_sectie"]], ["Adriana Corbu", ["sef_croit"]]
  ]';
  utilaje jsonb := '[
    ["Liniară simplă", true], ["Triplok 3 fire", true], ["Triplok 4 fire", true], ["Triplok 5 fire", true], ["Yuber", true],
    ["Butonieră", true], ["Cheiță", true], ["Mașină benzi", true], ["Mașină de surjat", true], ["Mașină nasturi", true],
    ["Mașini speciale", true], ["Mașină elastic", true], ["Bentiță", true],
    ["Alimentare", false], ["Control interfazic", false], ["Călcat interfazic", false], ["Călcat final", false], ["CTC și ambalat", false]
  ]';
  x jsonb;
  i int;
BEGIN
  FOR f IN SELECT id FROM firma LOOP
    PERFORM set_config('app.firma_id', f::text, true);
    FOR x IN SELECT * FROM jsonb_array_elements(oameni) LOOP
      INSERT INTO angajat (firma_id, nume, functii)
      VALUES (f, x->>0, ARRAY(SELECT jsonb_array_elements_text(x->1))) ON CONFLICT DO NOTHING;
    END LOOP;
    i := 0;
    FOR x IN SELECT * FROM jsonb_array_elements(utilaje) LOOP
      i := i + 1;
      INSERT INTO utilaj (firma_id, nume, masina, ordine) VALUES (f, x->>0, (x->>1)::boolean, i) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
