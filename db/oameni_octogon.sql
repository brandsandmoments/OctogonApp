-- Oamenii Octogon Fashion și drepturile lor, cum le-a dat conducerea (26.10.2026).
-- Se poate rula de mai multe ori: actualizează, nu dublează.
--
-- Fără parole: fiecare cont master își pune parola cu `npm run cont:admin`, iar
-- restul le primesc de la un cont master, din „Oameni și conturi". Emailurile
-- se completează acolo.

BEGIN;
SET LOCAL app.firma_id = '0c706000-0000-4000-8000-000000000001';

-- Doi oameni existau deja, din dashboard, sub alt nume: își păstrează istoricul.
UPDATE utilizator SET nume = 'Alexandru Stanciu' WHERE nume = 'Alex Stanciu';
UPDATE utilizator SET nume = 'Venita Manea'      WHERE nume = 'Nela Manea';

INSERT INTO utilizator (firma_id, nume, roluri)
SELECT firma_curenta(), x.nume, x.roluri::rol[]
  FROM (VALUES
    ('Madalina Bari',     '{admin,kam}'),
    ('Alexandru Stanciu', '{admin,kam}'),
    ('Adelina Neagu',     '{kam,depozit}'),
    ('Luminita Stanciu',  '{dezvoltare,croit}'),
    ('Venita Manea',      '{banda,planificator}'),
    ('Delia Jurubita',    '{kam,depozit}'),
    ('Teodora Bobocel',   '{kam,depozit}'),
    ('Valentina Stefan',  '{kam,depozit}'),
    ('Adriana Corbu',     '{croit}'),
    -- Operatorii de croit: numele adevărate se pun mai târziu, din „Oameni și conturi".
    ('Operator 1',        '{operator_croit}'),
    ('Operator 2',        '{operator_croit}'),
    ('Operator 3',        '{operator_croit}'),
    ('Operator 4',        '{operator_croit}'),
    ('Operator 5',        '{operator_croit}')
  ) x(nume, roluri)
ON CONFLICT (firma_id, nume) DO UPDATE SET roluri = EXCLUDED.roluri, activ = true;

-- Drepturile: vede sau modifică, pe zonă. Contul master (admin) nu are nevoie de rânduri.
DELETE FROM drept WHERE utilizator_id IN (
    SELECT id FROM utilizator WHERE nume IN ('Madalina Bari', 'Alexandru Stanciu', 'Adelina Neagu', 'Luminita Stanciu',
      'Venita Manea', 'Delia Jurubita', 'Teodora Bobocel', 'Valentina Stefan', 'Adriana Corbu',
      'Operator 1', 'Operator 2', 'Operator 3', 'Operator 4', 'Operator 5'));

INSERT INTO drept (firma_id, utilizator_id, zona, nivel)
SELECT firma_curenta(), u.id, d.zona, d.nivel::nivel_drept
  FROM (VALUES
    -- KAM; la depozit; la expediere: vede comenzile intrate și nelivrate; dă PSC și PSF
    ('Adelina Neagu', 'comenzi', 'modifica'), ('Adelina Neagu', 'kam', 'vede'),
    ('Adelina Neagu', 'centralizator', 'vede'), ('Adelina Neagu', 'receptie', 'modifica'),
    ('Adelina Neagu', 'expediere', 'modifica'),
    -- dezvoltă produs; croit; centralizator; planificare comandă
    ('Luminita Stanciu', 'dezvoltare', 'modifica'), ('Luminita Stanciu', 'croit', 'modifica'),
    ('Luminita Stanciu', 'centralizator', 'vede'), ('Luminita Stanciu', 'planificare', 'modifica'),
    -- șef bandă; planifică PSF și PSC; necesar materiale; vede croitul fără să-l modifice; alimentează
    ('Venita Manea', 'banda', 'modifica'), ('Venita Manea', 'planificare', 'modifica'),
    ('Venita Manea', 'necesar', 'modifica'), ('Venita Manea', 'croit', 'vede'),
    ('Venita Manea', 'comenzi', 'vede'), ('Venita Manea', 'centralizator', 'vede'),
    -- KAM; dau PSC și PSF; la depozit: introduc în gestiune, scanează, împerechează PSF/PSC cu ce vine fizic
    ('Delia Jurubita', 'comenzi', 'modifica'), ('Delia Jurubita', 'kam', 'vede'),
    ('Delia Jurubita', 'centralizator', 'vede'), ('Delia Jurubita', 'receptie', 'modifica'),
    ('Teodora Bobocel', 'comenzi', 'modifica'), ('Teodora Bobocel', 'kam', 'vede'),
    ('Teodora Bobocel', 'centralizator', 'vede'), ('Teodora Bobocel', 'receptie', 'modifica'),
    ('Valentina Stefan', 'comenzi', 'modifica'), ('Valentina Stefan', 'kam', 'vede'),
    ('Valentina Stefan', 'centralizator', 'vede'), ('Valentina Stefan', 'receptie', 'modifica'),
    -- șefa croit: vede PSC/PSF, centralizatorul și planificarea fără să le modifice; materii prime
    -- (intrări, inventar, gestiune); necesar; trece la croit ce croiește
    ('Adriana Corbu', 'comenzi', 'vede'), ('Adriana Corbu', 'centralizator', 'vede'),
    ('Adriana Corbu', 'planificare', 'vede'), ('Adriana Corbu', 'croit', 'modifica'),
    ('Adriana Corbu', 'materiale', 'modifica'), ('Adriana Corbu', 'necesar', 'modifica'),
    -- operatorii de croit: văd croitul și bifează operațiile (întins, tăiat, termocolat,
    -- împerecheat), cu metrii și defectele; nu corectează și nu închid comenzi
    ('Operator 1', 'croit', 'vede'), ('Operator 2', 'croit', 'vede'), ('Operator 3', 'croit', 'vede'),
    ('Operator 4', 'croit', 'vede'), ('Operator 5', 'croit', 'vede')
  ) d(nume, zona, nivel)
  JOIN utilizator u ON u.nume = d.nume;

-- Ceilalți oameni importați din dashboard nu mai lucrează în aplicație: dezactivați,
-- nu șterși, ca istoricul lor (cine a planificat, cine a dat PSC-ul) să rămână.
-- Cine are email a primit un cont de mână și nu e atins.
UPDATE utilizator SET activ = false
 WHERE email IS NULL
   AND nume NOT IN ('Madalina Bari', 'Alexandru Stanciu', 'Adelina Neagu', 'Luminita Stanciu', 'Venita Manea',
                    'Delia Jurubita', 'Teodora Bobocel', 'Valentina Stefan', 'Adriana Corbu',
                    'Operator 1', 'Operator 2', 'Operator 3', 'Operator 4', 'Operator 5');

COMMIT;
