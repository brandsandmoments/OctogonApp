-- Gradul de dificultate, pe trei niveluri (1 ușor, 2 mediu, 3 greu), ca să conteze în clasament:
-- pe taiere (toate operațiile ei de la croit: întins, tăiat, separat, termocolat) și pe omul pus
-- pe o fază a comenzii (cusut, călcat, control…). Ce e deja trecut pornește de la mediu.
BEGIN;

ALTER TABLE taiere ADD COLUMN dificultate smallint NOT NULL DEFAULT 2 CHECK (dificultate BETWEEN 1 AND 3);
COMMENT ON COLUMN taiere.dificultate IS 'Difficulty of this cut for the ranking: 1 easy, 2 medium, 3 hard (applies to all its cutting operations)';

ALTER TABLE alocare_comanda ADD COLUMN dificultate smallint NOT NULL DEFAULT 2 CHECK (dificultate BETWEEN 1 AND 3);
COMMENT ON COLUMN alocare_comanda.dificultate IS 'Difficulty of this phase of the order for this person, for the ranking: 1 easy, 2 medium, 3 hard';

ALTER TABLE alocare_operatie ADD COLUMN dificultate smallint NOT NULL DEFAULT 2 CHECK (dificultate BETWEEN 1 AND 3);
COMMENT ON COLUMN alocare_operatie.dificultate IS 'Difficulty of this phase of the batch for this person, for the ranking: 1 easy, 2 medium, 3 hard';

COMMIT;
