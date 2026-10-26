-- Drepturi pe om și pe zonă: vede sau modifică.
--
-- Rolurile (KAM, șef croit) spun ce e omul; drepturile spun ce poate face, și
-- diferă de la om la om chiar în același rol: șefa de croit vede PSF-urile și
-- planificarea fără să le poată schimba, dar lucrează la croit și în gestiunea de
-- materii prime. Fiecare zonă are două niveluri — vede, modifică — iar „modifică"
-- îl include pe „vede". Adminul (contul master) are totul, fără rânduri aici.
--
-- Rolurile rămân pentru ce țin de identitate: lista de KAM din formularul de PSF
-- și cine poate intra cu PIN din atelier.

BEGIN;

CREATE TYPE nivel_drept AS ENUM ('vede', 'modifica');

CREATE TABLE drept (
    firma_id       uuid NOT NULL REFERENCES firma(id),
    utilizator_id  uuid NOT NULL REFERENCES utilizator(id) ON DELETE CASCADE,
    zona           text NOT NULL CHECK (zona IN (
                       'comenzi', 'centralizator', 'kam', 'necesar', 'planificare', 'croit',
                       'banda', 'receptie', 'materiale', 'dezvoltare', 'expediere')),
    nivel          nivel_drept NOT NULL,
    PRIMARY KEY (utilizator_id, zona)
);

ALTER TABLE drept ENABLE ROW LEVEL SECURITY;
ALTER TABLE drept FORCE ROW LEVEL SECURITY;
CREATE POLICY izolare_firma ON drept
    USING (firma_id = firma_curenta())
    WITH CHECK (firma_id = firma_curenta());
GRANT SELECT, INSERT, UPDATE, DELETE ON drept TO octogon_app;

COMMENT ON TABLE  drept IS 'What a person may do, per area: see (vede) or change (modifica, which includes seeing). Admins need no rows: they may do everything.';
COMMENT ON COLUMN drept.firma_id IS 'Owning company. Row-level security filters every query by it.';
COMMENT ON COLUMN drept.zona     IS 'Area: comenzi (PSF/PSC orders), centralizator, kam (KAM efficiency), necesar (material requirement, recipes), planificare (planning), croit (cutting), banda (line), receptie (finished-goods receipt, labels), materiale (raw-material stock and stock counts), dezvoltare (product development), expediere (shipping)';
COMMENT ON COLUMN drept.nivel    IS 'Level: vede (see) or modifica (change)';

COMMIT;
