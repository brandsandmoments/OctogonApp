-- Cine poate face taieri direct din Centralizator („Croiește" pe Rămas de croit): un
-- drept pe om, nu pe rol — rolul de croit îl au și operatorii. Azi, doar Adriana Corbu.
BEGIN;
ALTER TABLE utilizator ADD COLUMN croieste_din_centralizator boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN utilizator.croieste_din_centralizator IS 'May turn remaining-to-cut orders into a cutting session straight from the summary screen';
DO $$ DECLARE f uuid; BEGIN
  FOR f IN SELECT id FROM firma LOOP
    PERFORM set_config('app.firma_id', f::text, true);
    UPDATE utilizator SET croieste_din_centralizator = true WHERE nume = 'Adriana Corbu';
  END LOOP;
END $$;
COMMIT;
