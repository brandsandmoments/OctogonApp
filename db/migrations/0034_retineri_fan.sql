-- Fan virează uneori un lot de rambursuri doar în parte: reține o sumă (o compensează
-- cu facturile lui) și o dă înapoi mai târziu, ca „restituire reținere". Încasarea din
-- bancă se leagă atunci de lot cu diferența reținută; restituirile se marchează ca atare.
BEGIN;

ALTER TABLE banca_tranzactie ADD COLUMN diferenta numeric(14,2) NULL;
COMMENT ON COLUMN banca_tranzactie.diferenta IS 'Amount the payer withheld from the matched batch or payout (expected minus received)';

COMMIT;
