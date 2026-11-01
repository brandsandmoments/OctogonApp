-- Vânzările din magazinele legate (OAuth) și alertele pe stoc: ce se termină, ce
-- nu se mișcă, ce prinde avânt. Vânzările merg în `vanzare` (0011), ca cele din
-- sincronizarea veche, pe brandul magazinului; aici doar ținem minte până unde s-au
-- citit și pragurile alertelor.
BEGIN;

ALTER TABLE magazin ADD COLUMN vanzari_pana_la timestamptz NULL;
COMMENT ON COLUMN magazin.vanzari_pana_la IS 'Orders updated up to this moment have been read into vanzare; the next sales sync starts here';

-- Pragurile, pe firmă; se schimbă din bază fără cod nou.
DO $$ DECLARE f uuid; BEGIN
  FOR f IN SELECT id FROM firma LOOP
    PERFORM set_config('app.firma_id', f::text, true);
    INSERT INTO parametru (firma_id, cheie, valoare, descriere) VALUES
      (f, 'alerta_zile_stoc',   14, 'Alertă „se termină": stocul ajunge mai puțin de atâtea zile, la ritmul ultimelor 30 de zile'),
      (f, 'stoc_mort_zile',     30, 'Alertă „nu se mișcă": nicio vânzare în atâtea zile'),
      (f, 'stoc_mort_min_buc',   3, 'Alertă „nu se mișcă": doar produsele cu cel puțin atâtea bucăți pe stoc'),
      (f, 'trend_factor',        2, 'Alertă „trend": ultimele 7 zile vând de atâtea ori mai mult decât media săptămânală de dinainte'),
      (f, 'trend_min_buc',       5, 'Alertă „trend": doar de la atâtea bucăți vândute în ultimele 7 zile')
    ON CONFLICT (firma_id, cheie) DO NOTHING;
  END LOOP;
END $$;

COMMIT;
